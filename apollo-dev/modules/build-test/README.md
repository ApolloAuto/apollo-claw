# Apollo 编译 / 测试 / Lint 操作手册

> ## ⚠️ 本环境（包工作区）适配 —— 先读这段，否则下面大半命令会跑不通
>
> 本环境是**独立包管理工作区** `/apollo_workspace`，不是整仓源码。**`./apollo.sh` 与 `docker/scripts/*` 都不存在**，
> 下面第 0 / 1 / 2 节（前置检查、进容器、两种 WORKSPACE 模式）整节不适用，第 3-4 节的命令需按下表换算。
>
> | 整仓形态 | 本环境等价做法 |
> |---|---|
> | `bash docker/scripts/dev_start.sh` / `dev_into.sh` | `aem start` / `aem enter`（`aem` 只管容器与环境，从不编译） |
> | `./apollo.sh build planning` | `buildtool build -p modules/planning/planning_component`（`-p` 传**相对工作区的路径**，不是模块名） |
> | `./apollo.sh build`（全量） | `buildtool build`（不带 `-p` = 编工作区内所有含 `cyberfile.xml` 的包） |
> | `./apollo.sh build_dbg/build_opt/build_gpu` | `buildtool build --dbg` / `--opt`（默认）/ `--gpu`；另有 `--cpu --prof --expunge -j N -m 百分比` |
> | `./apollo.sh test [module]` | `buildtool test` |
> | `bash scripts/bootstrap.sh` | 不用 `buildtool bootstrap`；launch 用 `cyber_launch start <launch>`，dag 用 `mainboard -d <dag>` |
> | 改代码前先有源码 | `buildtool install <pkg>` 拉进工作区，落点保留完整仓库相对路径（如 `/apollo_workspace/modules/planning/planning_component/`） |
>
> **最关键的一条差异：`buildtool build` 不是 `bazel build` 的别名。** 它实际跑两条
> `bazel run //dev/buildtool/mock:mock_install_src` 与 `:mock_install`，把产物 install 到
> `/opt/apollo/neo/{lib,include,share,src}`。`bazel-bin` 只是中间物，运行时**根本不读**
> （实测 `/apollo_workspace/bazel-bin/` 下只有 `dev`）。所以本环境**只 `bazel build` 编出 .so 等于没编** ——
> 运行时看不见，插件索引也不会更新，必须走 `buildtool build` 完成 install。
>
> 仍然成立的部分：**bazel label 写法与整仓完全一致**（`//modules/planning/planning_base:xxx`、`//cyber`），
> BUILD 文件两种形态逐字节相同；未拉进工作区的包由 `tools/apollo_package.bzl:333-470` 自动把 label
> 重写成 `@planning-base//:modules_S...` 形式，**这是自动的，不要手写 `@repo//` 前缀**。
> `bazel build --nobuild //...` 这类纯分析校验也仍可用（快速验 BUILD 语法），但别当"编译完成"。
>
> 已知缺陷：`buildtool info <pkg>` 在本环境崩溃（`core/package_identification/identifier.py:113`
> `TypeError: a bytes-like object is required, not 'list'`，buildtool 9.0.0-rc1-r19）。查依赖改为直接读
> `/opt/apollo/neo/share/packages/<pkg>/cyberfile.xml`。
>
> 下面正文保留整仓形态原文，其中的编译错误诊断（第 5 节起：alwayslink 被裁、`apollo_package` 漏调、
> proto 依赖、cyberfile.xml 漏写）**与形态无关，完全适用**，那是本 skill 在本环境最有价值的部分。

仓库根 = `/apollo`（容器内）。所有命令都在容器内 `/apollo` 目录执行。

## 0. 前置检查（每次开工先做）

```bash
uname -s                                     # 必须 Linux；非 Linux 直接 exit 1（apollo.sh:27-34）
echo $APOLLO_IN_DOCKER                       # 必须 true，否则报 "The build operation must be
                                             #   run from within docker container"（apollo_base.sh:697-699）
grep STATUS tools/package/dynamic_deps.bzl   # 0 = 源码模式，2 = 包管理模式
git status --short                           # 确认 WORKSPACE / tools/ 无意外改动
```
`.bazelrc:2-7` 只做三次 try-import：`tools/bazel.rc`（提交进仓库）、`.apollo.bazelrc`（每次跑
`apollo.sh` 被重写，`apollo.sh:99`，别手改）、`.custom.bazelrc`（本地定制写这里）。

## 1. 进容器

```bash
bash docker/setup_host/install_docker.sh     # 宿主机首次准备
bash docker/setup_host/setup_host.sh
bash docker/scripts/dev_start.sh            # 起 dev 容器（名 apollo_dev_$USER，dev_into.sh:19-20）
bash docker/scripts/dev_start.sh -f y       # fast，少拉地图 volume（-f 需带参数，dev_start.sh:157-161）
bash docker/scripts/dev_start.sh -l         # 用本地镜像不拉取；-t <TAG> 指定 tag
bash docker/scripts/dev_start.sh -g us      # 走 docker.io；默认被写死成 cn（dev_start.sh:277-290）
bash docker/scripts/dev_start.sh stop       # 停并删本人所有 apollo_* 容器
bash docker/scripts/dev_into.sh             # 进容器
```
预期：进入后 `pwd` = `/apollo`，仓库是**挂载**进来的（`-v $APOLLO_ROOT_DIR:/apollo`，
`docker/scripts/dev_start.sh:300`），容器内改文件 = 宿主机改文件。
其他容器：`cyber_start.sh`/`cyber_into.sh`、`runtime_start.sh`/`runtime_into.sh`、
`dev_start_gdb_server.sh <module> <port>`。

## 2. 两种 WORKSPACE 模式

仓库根有两份 WORKSPACE：`WORKSPACE`（当前生效）与 `WORKSPACE.source`（源码模式模板，
现仓库两者内容一致）。判定与切换：

| | 源码模式（默认，日常用这个） | 包管理模式 |
|---|---|---|
| 判定 | `grep STATUS tools/package/dynamic_deps.bzl` → `STATUS = 0` | → `STATUS = 2` |
| 编译入口 | `./apollo.sh build [module]` | `./apollo.sh build_pkg [module]` |
| 底层 | `bazel build`（`scripts/apollo_base.sh:762`） | `buildtool build`（`scripts/apollo_build_pkg.sh:266`） |
| 目标发现 | `determine_targets`（`scripts/apollo_base.sh:620-649`） | 递归找 `cyberfile.xml`（`scripts/find_all_package.py:29-41`） |

**最大的坑**：跑过 `build_pkg` 再跑 `build`，`site_restore()`（`scripts/apollo_base.sh:53-73`）会
卸载 buildtool、复原 `WORKSPACE` / `tools/proto/proto.bzl` / `dynamic_deps.bzl` / `rules_cc.patch`，
并把 `tools/bazel.rc` 的 spawn_strategy 改回 standalone。症状是 `git status` 出现这几个文件的意外改动。
修复：`git checkout -- WORKSPACE tools/`。**不要在同一个工作区来回切模式。**

## 3. 编译单个模块

`<module>` 就是 `modules/<module>` 的目录名（`determine_targets`，`scripts/apollo_base.sh:632-641`，
目录不存在直接 `error ... exit 1`）；特殊值 `cyber` → `//cyber/... union //modules/tools/visualizer/...`。

```bash
./apollo.sh build planning                    # → //modules/planning/...
./apollo.sh build planning prediction control  # 多模块空格分隔
./apollo.sh build cyber
./apollo.sh build_dbg planning                 # --config=dbg
./apollo.sh build_opt planning                 # --config=opt
./apollo.sh build_gpu planning                 # = build_nvidia；另有 build_amd / build_opt_gpu
./apollo.sh build_pnc                          # 固定 8 个模块 dbg+gpu（apollo.sh:216-218）
./apollo.sh build --bazel "--verbose_failures" planning   # 透传任意 bazel 参数
```

**3 个已核对存在的真实 target**（直接用 bazel 最精确、最快）：

```bash
bazel build //modules/planning/planning_component:libplanning_component.so
#   apollo_component，modules/planning/planning_component/BUILD:7-8
bazel build //modules/planning/tasks/lane_follow_path:liblane_follow_path.so
#   apollo_plugin，modules/planning/tasks/lane_follow_path/BUILD:13-14
bazel build //modules/control/control_component:apollo_control_lib
#   apollo_cc_library，modules/control/control_component/BUILD:8-9
```

## 4. 全量 / 增量 / 只编不链接

```bash
./apollo.sh build                       # 全量 = //modules/... union //cyber/...
bazel build //modules/planning/...      # 增量：bazel 天然增量，只需缩小 target 范围
bazel build --nobuild //modules/planning/...          # 只做分析不编译，最快验证 BUILD/宏语法
bazel build --check_up_to_date //modules/planning/... # 只检查是否已最新，不产出
# 只编译不链接：Apollo 的 apollo_component/apollo_plugin 最终是 cc_binary(.so)，没有纯编译目标；
# 但 apollo_plugin 会额外生成一个内部 cc_library「<去掉 lib 与 .so 的名字>_lib」
# （tools/apollo_package.bzl:655、:669-677），对它取 compilation_outputs 即只编译不链接：
bazel build --output_groups=compilation_outputs \
  //modules/planning/tasks/lane_follow_path:lane_follow_path_lib
```

内存不足时（编译被 OOM kill）：
```bash
CUSTOM_JOB_ARGS="--jobs=4 --local_ram_resources=HOST_RAM*0.4" ./apollo.sh build planning
```
默认是 `--jobs=$(nproc) --local_ram_resources=HOST_RAM*0.7`（`scripts/apollo_base.sh:755-760`）。

排除某些目标：`CUSTOM_DISABLED_TARGETS="//a/b/... //c/d/..."`（`scripts/apollo_base.sh:585-590`）。

## 5. 跑单测

```bash
./apollo.sh test                        # 全量单测（= apollo_test.sh --config=unit_test）
./apollo.sh test planning                # 单模块
bazel test --config=unit_test //modules/planning/...                    # 整个包
bazel test --config=unit_test //cyber/common:file_test                   # 单 target（最快）
bazel test --config=unit_test //modules/control/control_component:control_component_test
bazel test --config=unit_test --test_output=all //path:target             # 看完整输出
bazel test --config=unit_test //path:target --test_arg=--gtest_filter=Suite.Case
bazel test --config=unit_test --nocache_test_results //path:target        # 强制重跑
./apollo.sh coverage planning            # 覆盖率
```

常用 flag 与默认值（`tools/bazel.rc:97-140`）：
- `--flaky_test_attempts=3`（`:99`）—— 会掩盖偶发失败。
- `--test_size_filters=small,medium`（`:100`）—— **large / enormous 默认不跑**，本地全绿 ≠ CI 全绿。
  要跑大测试：`bazel test --config=unit_test --test_size_filters=large //path:target`。
- `--test_output=errors`（`:104`）—— 只打印失败测试输出。
- `--config=unit_test` 会加 `--test_tag_filters=-cpplint`（`:138`），把 cpplint 排除掉。

## 6. Lint / 格式化 / 清理

```bash
./apollo.sh lint                # 无参数默认只跑 cpp（scripts/apollo_lint.sh:118-121）
./apollo.sh lint --cpp          # cpplint，走 bazel test --config=cpplint（:32-34）
./apollo.sh lint --py           # flake8，读根 tox.ini
./apollo.sh lint --sh           # shellcheck -x --shell=bash
./apollo.sh lint -a             # 三者全跑
bazel test --config=cpplint //modules/planning/...    # 只 lint 一个包，等价直接命令

./apollo.sh format -a <改动目录>     # -c C++ / -p Python / -b bazel / -s shell / -m markdown / -a 全部
./apollo.sh buildify                 # 全仓 BUILD 与 *.bzl 的 buildifier -lint=fix
bash scripts/apollo_rule_check.sh    # 确认没用原生 cc_library/cc_binary/cc_test

./apollo.sh clean --bazel       # bazel clean --async（日常）
./apollo.sh clean --expunge     # 连外部依赖删掉，重编要重新联网
./apollo.sh clean -a            # = --bazel --core --log
./apollo.sh config --clean      # 只删 .apollo.bazelrc
```

⚠️ **`lint --cpp` 会改工作区**：给缺 `cpplint()` 的 BUILD 自动 `sed` 插入 load 与 `cpplint()` 并跑
buildifier（`scripts/apollo_lint.sh:42-53`）；`main()` 还会把 `dynamic_deps.bzl` 的 STATUS 强制改回 0
并用 `WORKSPACE.source` 覆盖 `WORKSPACE`（`scripts/apollo_lint.sh:156-157`）。跑完必须
`git status --short` 复查。

提交前一把梭：`./apollo.sh check` = build + test + `lint --cpp`（`apollo.sh:109-114`），
**不含 py / sh lint**。

## 7. 常见编译错误速查

| 症状 / 报错 | 原因 | 定位与修法 |
|---|---|---|
| 编译链接都过，但插件/组件运行时「注册不到」「找不到类」 | `apollo_cc_library` 的产物是 `.so` + 一个 `alwayslink=True` 的 wrapper（`tools/apollo_package.bzl:640-645`）。deps 写错层级会让注册符号被链接器裁掉 | deps 必须写 wrapper target 名（`":<name>"`）；要链 **component 的实现**只能写 `":DO_NOT_IMPORT_<name>"`（前缀定义 `tools/apollo_package.bzl:24`，实例 `modules/control/control_component/BUILD:62`、`modules/planning/planning_component/BUILD:45`），并给 test 加 `linkstatic = True` |
| `bazel native cc rule detected in <pkg>/BUILD` | 用了原生 `cc_library`/`cc_binary`/`cc_test` | 改成 `apollo_*` 宏（检查逻辑 `scripts/apollo_rule_check.sh:52-64`） |
| `name must start with 'lib' and end with '.so'` | `apollo_component`（`tools/apollo_package.bzl:584-585`）或 `apollo_plugin`（`:652-653`）的 name 不合规 | 改成 `libxxx.so` |
| `missing attribution of 'description'` | `apollo_plugin` 少了 `description` | 加 `description = ":plugins.xml"`（`tools/apollo_package.bzl:648-649`；范例 `modules/planning/tasks/lane_follow_path/BUILD:18`） |
| `'apollo_component' macro has not 'alwayslink' attribute` | 给 `apollo_component` 传了 `alwayslink` | 删掉（`tools/apollo_package.bzl:586-587`） |
| 改了 BUILD 加了新 target，但 `release`/`build_pkg` 里没有产物 | **BUILD 末尾漏了 `apollo_package()`**，或 `apollo_package()` 没写在所有 target 之后 | `apollo_package()` 靠 `native.existing_rules()` 收集（`tools/apollo_package.bzl:234-255`），必须是 BUILD 的**最后一个宏调用**（`cpplint()` 可在其后） |
| `The name of the proto_library instance must end with "proto"` | proto target 命名不合规 | 名字改成 `xxx_proto`（`tools/proto/proto.bzl:120-121`） |
| `no such target //...:xxx_cc_proto` | 该 proto 包没 load Apollo 重写版 `proto_library` | BUILD 里 `load("//tools/proto:proto.bzl", "proto_library")`；`_cc_proto` 是它自动展开的（`tools/proto/proto.bzl:116`） |
| `build_pkg` 静默漏编某个新目录 | 新包没有 `cyberfile.xml` 或依赖漏写 | 该目录必须有 `cyberfile.xml`（全仓 241 个），并补 `<depend type="binary" repo_name="...">` 与 `<src_path>`（范例 `modules/planning/tasks/lane_follow_path/cyberfile.xml`）。无任何编译期检查，只会静默漏 |
| `error: ... [-Werror=return-type / unused-but-set-variable / switch / reorder]` | `tools/bazel.rc:39-43` 把这 4 类 warning 升成 error | 必须真改代码，不要加 `-Wno-` |
| perception 怎么编都没产物 | GPU 探测失败静默退化 CPU，然后**排除整个 `//modules/perception/...`**（`scripts/apollo_base.sh:560-562`） | 看 `USE_GPU` / `GPU_PLATFORM` 的 Overview 打印（`scripts/apollo_base.sh:735-737`） |
| `Mixed use of '--config=cpu' and '--config=gpu' ...` 后 exit | 5 组互斥检查（`scripts/apollo_base.sh:437-460`） | 只给一个 config |
| `Warning: Install conflict detected` | 两个 src 装到同一 dst | 改 install 的 `dest`/`rename`（`tools/install/install.bzl:384-387`） |
| `Argument list too long` | 展开目标过多 | 缩小 target 范围（说明见 `scripts/apollo_base.sh:720-722`） |
| 插件编出来了但运行时加载失败 | 索引/类名/路径不一致 | 查 `bazel-bin/cyber_plugin_index/`、`plugins.xml` 的 `class type` 与 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN` 是否逐字相同、`APOLLO_PLUGIN_LIB_PATH` 是否含 `bazel-bin`（`scripts/apollo.bashrc:46`） |

## 8. 定位手法（照抄即可）

```bash
./apollo.sh build planning 2>&1 | grep -A2 '^+ bazel'   # apollo.sh 实际执行的 bazel 命令（set -x，apollo_base.sh:760-763）
bazel query --output=build //modules/planning/planning_component:all      # 宏展开成了什么
bazel query 'attr(srcs, "my_thing.cc", //modules/planning/...)'           # 某文件属于哪个 target
bazel query 'somepath(//modules/planning/..., @com_google_absl//:absl)'   # 为什么某库被拉进来
bazel query 'deps(//modules/planning/planning_component:libplanning_component.so)' | head -50
bazel build --verbose_failures --sandbox_debug //path:target              # 失败时要完整命令行
bazel test --test_output=all --nocache_test_results //path:target          # 单测完整输出
bazel build --announce_rc //cyber/...                                     # 打印所有生效的 rc 来源
```

更长的知识（宏完整签名与选择规则、`.bazelrc` / `tools/bazel.rc` 逐项、`scripts/` 与 `tools/` 目录、CI 流程）见 `reference.md`。

