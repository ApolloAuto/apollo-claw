# 新增一个 cyber Component 模块

> ## ⚠️ 本环境（包工作区）适配 —— 别手写六件套，先用模板生成
>
> 本环境是独立包管理工作区 `/apollo_workspace`。本 skill 正文教的是整仓形态下**手写** BUILD / `.h/.cc` /
> proto / conf / dag / launch / cyberfile.xml，在这里应改成**模板生成 + 填业务逻辑**：
>
> ```bash
> buildtool create --template component       modules/foo/foo_component   # 消息触发 Component
> buildtool create --template timer_component modules/foo/foo_component   # 定时触发 TimerComponent
> ```
>
> 可带参数：`--name`（包名，默认 `demo-<template>`）、`--class_name`、`--channel_name`、
> `--channel_message_type`、`--config_message_name`、`--namespaces`、`--dependencies`、
> `--build_dependencies`、`--author` / `--email` / `--description`。
> `package_path` 是相对工作区的路径，默认 `modules/demo_<template>`。**已存在的文件跳过不覆盖**，可安全重跑。
>
> 生成的骨架已经把正文里最容易漏的几件事做对了：`BUILD` 里 `apollo_component(name="lib<x>_component.so")`
> + `apollo_package()` + `cpplint()`；`cyberfile.xml` 的 `<src_path>`、`<depend type="binary" repo_name="cyber">`；
> `dag` 里 `module_library` 指向 `<package_path>/lib<x>_component.so`、`config_file_path` / `flag_file_path`
> 指向 `<package_path>/conf/`；`conf/flags.conf` 里带
> `--flagfile=/apollo/modules/common/data/global_flagfile.txt`。
>
> 然后编译并安装（**注意不是 `bazel build`**，只 bazel build 运行时看不见）：
>
> ```bash
> buildtool build -p modules/foo/foo_component
> cyber_launch start /apollo/modules/foo/foo_component/launch/*.launch   # launch 用 cyber_launch；dag 用 mainboard -d <dag>
> ```
>
> **`cyberfile.xml` 在包形态下是包的身份证，比整仓形态重要得多**：`<src_path>` 必须与目录路径一致
> （它同时决定 install 到工作区的位置、编译产物在 `/opt/apollo/neo/` 的布局、bazel package 路径）；
> `<depend type="binary">` = 用预编译包，`type="src"` = 要求源码在工作区。另外 buildtool 扫描工作区找包时
> **遇到第一个含 `cyberfile.xml` 的目录就停止下钻**，所以不要把包嵌套在另一个包里，否则永远不会被发现。
>
> 其余与形态无关、正文完全适用的部分：Component vs TimerComponent 的选择、`Init()`/`Proc()` 签名、
> Reader/Writer/Service 用法、dag 与 launch 字段含义、「.so 不被加载 / Init 没被调用 / Proc 收不到消息」
> 的排查思路。
>
> **⚠️ 正文原来的两个参考实现在本环境不存在**（措辞是「本环境不存在」而不是「Apollo 删了」——
> 只在本机核对过，别的形态/版本可能还有）：`modules/guardian/` 只剩
> `modules/common_msgs/guardian_msgs/guardian.proto` 与 `/apollo/scripts/guardian.sh`（脚本还在但指向的
> launch 已没了，跑必挂）；`modules/task_manager/` 整个不存在。
> **两棵树都核对过**：`ls /opt/apollo/neo/src/modules/` 与 `ls /opt/apollo/neo/include/modules/` 都没有
> —— 这个双树核对是必要的，因为 `src/` 对二进制包只发头文件，单看 src/ 会误判成"被删了"。
> 正文已换成现存的两个模板：
> **TimerComponent → `modules/storytelling/`**（17 文件、核心 204 行、六件套齐全）；
> **消息触发 `Component<T>` → `modules/drivers/tools/image_decompress/`**（核心 107 行，dag 里
> 有多实例 + `readers` 的完整写法）。两者在本环境位于 `/opt/apollo/neo/src/` 下（只读），
> 或 `buildtool install storytelling` 后进工作区。
> 顺带一个可直接跑的验证：这两个模板的 launch 都挂在 `modules/<名>/launch/` 下，直接
> `cyber_launch start /apollo/modules/storytelling/launch/storytelling.launch` 能起；
> `image_decompress` 的 launch 在 `modules/drivers/tools/image_decompress/launch/`，用
> `cyber_launch start` 传完整 launch 路径（dag 同理用 `mainboard -d <dag>`）。

模板取自现场核对的 **`modules/storytelling/`**（TimerComponent，六件套齐全，核心 204 行），消息触发例子取自
**`modules/drivers/tools/image_decompress/`**（`Component<CompressedImage>`，核心 107 行）；
签名核对自 `cyber/component/{component,timer_component,component_base}.h`。
机制、Reader/Writer/Service 全用法、dag/launch/cyberfile 字段全表、Bazel 宏完整签名见 `reference.md`。

## 一、先做决策

| 形态 | 何时用 | 基类与签名 | dag 段 |
|---|---|---|---|
| 消息触发 | 有主驱动 channel，来一帧算一次 | `cyber::Component<M0[,M1,M2,M3]>`；`bool Init()` + `bool Proc(const std::shared_ptr<M0>&, ...)` | `components{}` + `readers[]` |
| 定时触发 | 固定频率输出（control/canbus/storytelling/monitor），输入靠自建 Reader 缓存 | `cyber::TimerComponent`；`bool Init()` + **无参** `bool Proc()` | `timer_components{}` + `interval` |
| 裸 Reader/Writer | 不需 dag 管生命周期的工具进程 | 自己 `CreateNode` + `CreateReader/CreateWriter` | 无 dag |

- **最多 4 路输入**：4 路主模板 + 0/1/2/3 路偏特化（`component.h:58-141`）；第 5 路只能在 `Init()` 里自建 Reader。
- **`readers` 数须 ≥ 模板路数**，只校验下限、多配的静默忽略（`component.h:169,255,380,520`）。`readers(0)` 是唯一驱动 channel，顺序即 `Proc` 参数顺序；副 channel 走 AllLatest，**任一副 channel 从未来过消息 → 全丢且无日志**。
- **`Init()` 返 false → 组件不上线**（`component.h:174-177`；Timer 版 `timer_component.cc:43-45`）。此刻 config/flag 已加载可 `GetProtoConfig()`，但 Reader 未建。**`Proc()` 返回值只做短路**：`Process()` 原样返回它，框架不检查不重试（`component.h:144-150`）。
- **`interval` 毫秒且须 `[1,65536)`**（`cyber/timer/timer.cc:51-60`：`period == 0` 与 `period >= TIMER_MAX_INTERVAL_MS` 都 fail；`TIMER_MAX_INTERVAL_MS = 512*64*2 = 65536`，`cyber/timer/timing_wheel.h:36-40`），取 2 的倍数（`TIMER_RESOLUTION_MS = 2`）。Timer 版 `name`/`interval` 缺一即 `Initialize` 失败（`timer_component.cc:37-40`）；仿真模式下 TimerComponent 不触发。

## 二、要建哪些文件（新模块 `modules/foo/`）

| 文件 | 作用 |
|---|---|
| `foo_component.h` / `.cc` | 类声明（含 `CYBER_REGISTER_COMPONENT`）+ `Init()`/`Proc()`；命名 `<模块>_component`，类 `FooComponent` |
| `proto/foo_conf.proto` + `proto/BUILD` | 业务配置消息，`package apollo.foo;`，被依赖时写 `:foo_conf_cc_proto` |
| `conf/foo_conf.pb.txt` / `conf/foo.conf` | 前者是 `config_file_path` 指向的 text proto；后者可选，是 `flag_file_path` 指向的 gflags |
| `dag/foo.dag` | 进程内拓扑：加载哪个 `.so`、实例化哪个类、订阅哪些 channel |
| `launch/foo.launch` | 进程边界：起哪个进程、加载哪些 dag |
| `BUILD` | `apollo_component` + `filegroup` + `apollo_package()` + `cpplint()`（后两者必须在最末） |
| `cyberfile.xml` | 包元信息与包间依赖，每个 `apollo_package()` 目录一份 |

不需动 cyber 任何文件，不需注册消息类型。**`plugins.xml` 只属于 `apollo_plugin`（planning task / control controller 那类），普通 Component 不要建。**

## 三、逐文件模板

`foo_component.h`（模板 `modules/storytelling/storytelling.h:16-50`；`#pragma once` + include
`cyber/component/timer_component.h`（消息触发换 `cyber/component/component.h`）、
自己的 `proto/foo_conf.pb.h` 与用到的消息 `.pb.h`）：

```cpp
namespace apollo { namespace foo {
class FooComponent : public apollo::cyber::TimerComponent {
 public:
  bool Init() override;
  bool Proc() override;
 private:
  apollo::foo::FooConf foo_conf_;
  std::shared_ptr<apollo::cyber::Reader<apollo::canbus::Chassis>> chassis_reader_;
  std::shared_ptr<apollo::cyber::Writer<apollo::foo::FooOutput>> foo_writer_;
  std::mutex mutex_;
};
CYBER_REGISTER_COMPONENT(FooComponent)   // 参数须与 dag 的 class_name 逐字相同
}}  // namespace apollo::foo
```
消息触发版只换两行（模板 `modules/drivers/tools/image_decompress/image_decompress.h:28-40`）：
`class FooComponent final : public cyber::Component<apollo::drivers::CompressedImage>` 与
`bool Proc(const std::shared_ptr<apollo::drivers::CompressedImage>& msg) override;`
（把消息类型换成你自己的驱动 channel 类型即可）。

`foo_component.cc`（模板 `modules/storytelling/storytelling.cc:24-59`；另需 include
`cyber/common/log.h`、`modules/common/adapters/adapter_gflags.h`、`modules/common/util/message_util.h`）：
```cpp
bool FooComponent::Init() {
  if (!GetProtoConfig(&foo_conf_)) {                        // component_base.h:62-65
    AERROR << "Unable to load conf: " << ConfigFilePath();
    return false;                                           // false → 组件不上线
  }
  chassis_reader_ = node_->CreateReader<canbus::Chassis>(    // node_ 来自 ComponentBase
      FLAGS_chassis_topic, [this](const std::shared_ptr<canbus::Chassis>& c) {
        std::lock_guard<std::mutex> lock(mutex_); /* 缓存，供 Proc 轮询 */ });
  foo_writer_ = node_->CreateWriter<FooOutput>(FLAGS_foo_topic);
  return true;
}
bool FooComponent::Proc() {   // 消息触发版签名带 msg 参数；返回值只做短路，不影响调度
  FooOutput out;
  common::util::FillHeader(node_->Name(), &out);   // 对照 storytelling.cc:54
  foo_writer_->Write(out);
  return true;
}
```
`proto/foo_conf.proto`（模板 `storytelling/proto/storytelling_config.proto:1-12`）= `syntax = "proto2";` +
`package apollo.foo;` + `message FooConf { optional bool foo_enable = 1 [default = false]; }`。
`proto/BUILD`（模板 `storytelling/proto/BUILD:1-12`，逐字可抄）= load `//tools:apollo_package.bzl` 的 `apollo_package`
与 `//tools/proto:proto.bzl` 的 `proto_library`，`package(default_visibility=["//visibility:public"])`，
`proto_library(name="foo_conf_proto", srcs=["foo_conf.proto"])`，末尾 `apollo_package()`；被依赖写 `:foo_conf_cc_proto`。
`conf/foo_conf.pb.txt`（模板 `storytelling/conf/storytelling_conf.pb.txt:1-4`，真实内容就是一个
`topic_config{}` 块）：只写要覆盖的字段，没写的取 proto default（不是 0）。

`BUILD`（模板 `modules/storytelling/BUILD:1-52`；load 行照抄它的 `//tools:apollo_package.bzl` 与
`//tools:cpplint.bzl`；不要用原生 `cc_library`/`cc_binary`，`scripts/apollo_rule_check.sh:53-66` 全仓扫描直接报错）：

```python
package(default_visibility = ["//visibility:public"])
FOO_COPTS = ['-DMODULE_NAME=\\"foo\\"']
apollo_component(
    name = "libfoo_component.so",   # 必须 lib 开头 .so 结尾；不得传 alwayslink（宏内部处理）
    srcs = ["foo_component.cc"], hdrs = ["foo_component.h"], copts = FOO_COPTS,
    deps = ["//cyber", "//modules/common/adapters:adapter_gflags",
            "//modules/foo/proto:foo_conf_cc_proto"],
)
filegroup(name = "runtime_data", srcs = glob(["conf/*.txt", "dag/*.dag", "launch/*.launch"]))
apollo_package()   # 必须最后（cpplint 之前），靠 native.existing_rules() 反射本文件
cpplint()
```

`dag/foo.dag` 定时版（模板 `modules/storytelling/dag/storytelling.dag:1-12`，12 行全部有效；消息版完整例子见
`modules/drivers/tools/image_decompress/dag/image_decompress.dag`，那里有 `components{}` + `readers{channel, pending_queue_size}`
以及**同一个 `.so` 实例化多份、每份配不同 conf 与 channel** 的标准写法）：

```protobuf
module_config {
    module_library : "modules/foo/libfoo_component.so"
    timer_components {                       # 消息触发写 components {
        class_name : "FooComponent"
        config {
            name: "foo"                      # Node 名 = 协程名 = sched conf 里的 task 名
            config_file_path: "/apollo/modules/foo/conf/foo_conf.pb.txt"
            interval: 10                     # 毫秒；消息版无此字段，改用下面两项
            # flag_file_path: "/apollo/modules/foo/conf/foo.conf"  # 可选 gflags，进程级生效
            # readers: [ { channel: "/apollo/x" qos_profile: { depth: 15 }
            #              pending_queue_size: 50 } ]   # 默认 1，高频通道必须调大
        }
    }
}
```
**dag 只写输入 channel**。段放错只有一句 `Failed to load module`（命中 `component_base.h:48-49` 默认返 false 的重载）。

`launch/foo.launch`（模板 `modules/storytelling/launch/storytelling.launch:1-7`）：`<cyber><module>` 内三项 ——
`<name>foo</name>`、`<dag_conf>/apollo/modules/foo/dag/foo.dag</dag_conf>`、`<process_name>foo</process_name>`
（→ `mainboard -p foo` → 读 `cyber/conf/foo.conf` 调度配置）。`<dag_conf>` 可重复、同进程多 dag 共享
scheduler（`modules/planning/planning_component/launch/planning.launch`）；其余可选字段见 `reference.md`。

`cyberfile.xml`：照抄 `modules/storytelling/cyberfile.xml:1-29`，只改 `<name>` / `<description>` /
`<src_path>`（storytelling 的是 `<src_path url="...">//modules/storytelling</src_path>`，`:20`）；
`<depend>` 按 BUILD 实际用到的包增删（storytelling 是 `cyber`、`common`、`map`、`common-msgs` 四个
`type="binary"` 依赖 `:22-25` + 一条 `3rd-gflags` `:27`）。**漏建整个文件**：
`_install_cyberfile` glob 到空、`find_all_package.py` 找不到该包、`build_pkg` 漏编。**漏写某条 `<depend>`**：
源码模式照样编过（BUILD 的 deps 才是真依赖），包管理模式（buildtool）拉不到依赖包、报缺头文件。

## 四、输出 channel 怎么定（在 conf/gflags，不在 dag）

`ComponentConfig`/`TimerComponentConfig` 只有 `name` / `config_file_path` / `flag_file_path` / `readers` /
`interval`（`cyber/proto/component_conf.proto:15-27`）—— **根本没有 writer 字段**，所以 dag 只能表达订阅。
① **gflags（主流，全仓权威清单）**：`modules/common/adapters/adapter_gflags.cc` 加
`DEFINE_string(foo_topic, "/apollo/foo", "Foo topic.");`、`.h` 加 `DECLARE_string(foo_topic);`（参考
`adapter_gflags.cc:253` 的 `storytelling_topic`），代码 `CreateWriter<T>(FLAGS_foo_topic)`，
BUILD deps 加 `//modules/common/adapters:adapter_gflags`，覆盖值写
`conf/foo.conf` 并在 dag 挂 `flag_file_path`；gflags 进程级，同进程后加载的覆盖同名 flag（`component_base.h:91,114`）。
② **模块自己的 proto conf**：`FooConf` 加 `foo_output_channel_name` 字段 —— **storytelling 就是这种**
（`proto/storytelling_config.proto:5-8` 的 `TopicConfig`，`storytelling.cc:34-35` 用
`config_.topic_config().storytelling_topic()` 建 Writer），perception 全系亦然。
## 五、编译与启动验证

**本环境（包工作区）**：
```bash
buildtool build -p modules/foo                   # 编译 + install，运行时才看得见
cyber_launch start /apollo/modules/foo/launch/foo.launch
```
整仓源码形态：
```bash
bazel build //modules/foo:libfoo_component.so    # 产物是 .so，不是可执行文件
./apollo.sh build foo ; ./apollo.sh lint cpp modules/foo
```
两种形态都可用的检查：
```bash
nm -C -D <libfoo_component.so 路径> | grep -i FooComponent   # 注册符号在不在
mainboard -d modules/foo/dag/foo.dag -p foo      # 前台加载 dag；-p 决定读哪个调度 conf
cyber_monitor ; cyber_channel echo /apollo/foo ; cyber_node list
```
启动日志应有 `mainboard: use dag conf`、`use module library`、`Start initialize dag`、`use config file`
（`cyber/mainboard/module_controller.cc:55-85`）。
## 六、排错表

| 现象 | 检查顺序 |
|---|---|
| `no dag conf [...] found!` / `no module library [...]` | 路径经 `APOLLO_DAG_PATH`/`APOLLO_LIB_PATH` 解析；`module_library` 写 `modules/foo/libfoo_component.so`（不带 `bazel-bin/`）；确认 `.so` 已编出 |
| `Init()` 没被调用 / `Failed to load module: <dag>` 无更多信息 | ① `components{}`/`timer_components{}` 段用错（命中 `component_base.h:48-49` 默认返 false 的重载）② Timer 版缺 `name`/`interval`（校验早于 `Init()`）③ `readers` 少于模板路数 ④ `Init()` 自己返回了 false |
| `Class factory objs counts is 0` / `CreateClassObj failed`（都只是 AWARN） | dag 的 `class_name` 与 `CYBER_REGISTER_COMPONENT(X)` 未逐字一致；或宏所在 TU 不在 `apollo_component` 的 srcs/hdrs 里 |
| `GetProtoConfig` 失败 | 日志 `conf file [...] not found!`；`config_file_path` 走 `APOLLO_CONF_PATH`；conf 字段名写错即解析失败 |
| `Proc()` 收不到消息 | ① 多路输入时任一**副** channel 从未有消息 → AllLatest 冷启动全丢且无日志，先用 `cyber_monitor` 确认每个副 channel 有流量 ② 只有 `readers(0)` 唤醒协程 ③ channel 名拼写 ④ Writer 早于 Reader 起时前几帧静默丢 |
| 偶发丢帧 / `read buffer overflow, drop_message[N]` | `pending_queue_size` 默认 1（`component_conf.proto:11-12`、`reader.h:50`），在 dag 显式调大 |
| 频率不对（Timer） | `interval` 毫秒且须 `[1,65536)`（`timer.cc:51-60` + `timing_wheel.h:36-40`）；时间轮 2ms 分辨率向上取整，取 2 的倍数；仿真模式不触发；mock clock 不影响 Timer 节拍 |
| 绑核/优先级无效 | `mainboard` 必须带 `-p <process_group>`，否则 group 名带 pid、找不到 `cyber/conf/<X>.conf`，静默落 classic+16 proc；sched conf 的 `tasks[].name` 填 dag 的 `name`，不是 `class_name` |
| 链接期符号找不到 | `apollo_cc_library` 产 `.so`，deps 写 `":<name>"`；单测要链 component 实现写 `"DO_NOT_IMPORT_foo_component"` |
| `git status` 冒出 `WORKSPACE`/`tools/` 意外改动 | `build` 与 `build_pkg` 互相污染；`git checkout -- WORKSPACE tools/`；`grep STATUS tools/package/dynamic_deps.bzl`（0=源码，2=包管理） |