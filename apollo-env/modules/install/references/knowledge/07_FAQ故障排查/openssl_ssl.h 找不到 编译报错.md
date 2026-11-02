# 编译报错 fatal error: openssl/ssl.h: No such file or directory

> 来源：实测排查（Apollo EDU 9.1.1，hslidar / hesai2 驱动）

## 报错样貌

```
ERROR: /apollo_workspace/modules/drivers/lidar/hslidar/BUILD:9:17:
Compiling modules/drivers/lidar/hslidar/driver/hesai_component.cc failed
In file included from /usr/local/include/hesai2/PtcClient/ptc_client.h:36:0,
                 from /usr/local/include/hesai2/hesai_lidar_sdk.hpp:29,
                 from modules/drivers/lidar/hslidar/driver/hesai_component.cc:16:
/usr/local/include/hesai2/PtcClient/tcp_ssl_client.h:31:10:
fatal error: openssl/ssl.h: No such file or directory
```

## 不是缺 libssl-dev

先确认，多数情况下它已经装好了：

```bash
dpkg -l | grep libssl-dev          # 应有 ii libssl-dev
ls /usr/include/openssl/ssl.h      # 应存在

# 直接用 gcc 验证头文件可用（绕开 bazel）
printf '#include "openssl/ssl.h"\nint main(){SSL_library_init();return 0;}\n' > /tmp/t.c
gcc -c /tmp/t.c -o /tmp/t.o && echo "头文件本身没问题"
```

如果 gcc 能编过，`sudo apt-get install -y libssl-dev` 就是空操作，装完还会同样报错。

## 真正的原因

Bazel 只把 `deps` 里声明过的头文件提供给编译动作。出问题的 target 往往只在 `linkopts` 写了 `-lssl`：

```python
apollo_component(
    name = "libhesai_driver_component_2.so",
    deps = [ ... ],                                    # 没有 openssl
    linkopts = ["-lgomp", "-lssl", "-pthread", ...],   # 只解决链接
)
```

`-lssl` 管的是**链接**阶段。而 hesai2 SDK 的 `tcp_ssl_client.h` 在**编译**阶段 `#include "openssl/ssl.h"`，没有声明依赖就找不到头文件——所以报的是 `No such file or directory`，不是 undefined reference。

## 修复

工程 WORKSPACE 里通常已备好本地 openssl 仓库：

```python
new_local_repository(
    name = "boringssl",
    build_file = "openssl.BUILD",   # includes=["include"], strip_include_prefix="include"
    path = "/usr",
)
```

在报错 target 的 `deps` 里补上它：

```python
deps = [
    ...
    # hesai2 SDK 的 tcp_ssl_client.h 会 #include "openssl/ssl.h"，
    # 编译期需要显式声明 openssl 头文件依赖；仅靠 linkopts 的 -lssl 只解决链接。
    "@boringssl//:ssl",
],
```

然后重新编译：

```bash
buildtool build -p modules/drivers/lidar/hslidar
```

## 判断依据

区分「缺库」和「缺依赖声明」看两点：

| 现象 | 结论 |
|------|------|
| gcc 直接编译能过，bazel 编不过 | 缺 BUILD 依赖声明，装包无用 |
| gcc 也报同样的找不到头文件 | 真的缺 dev 包，需要安装 |
| 报 undefined reference to `SSL_*` | 缺链接参数 `-lssl` |
