# 04 新增 ControlTask（控制器插件）

<!--
file: references/manual/15_二次开发手册/04_新增ControlTask.md
scope: 11.0（默认，本机实测）
tags: ControlTask, 控制器插件, buildtool create, plugin 模板, plugins.xml, base_class, LoadConfig, GetPluginConfPath, pipeline.pb.txt, apollo_plugin, demo_control_task
sources:
- /opt/apollo/neo/src/modules/control/controllers/demo_control_task/demo_control_task.cc（全 408 行，五件套段精读）
- /opt/apollo/neo/src/modules/control/controllers/demo_control_task/demo_control_task.h（全 144 行）
- /opt/apollo/neo/src/modules/control/controllers/demo_control_task/{plugins.xml,BUILD,cyberfile.xml,proto/BUILD,proto/demo_control_task_conf.proto,conf/controller_conf.pb.txt,README_cn.md}（cat 全文）
- /opt/apollo/neo/src/modules/control/control_component/controller_task_base/control_task.h（100–140 行：LoadConfig/LoadCalibrationTable）
- /opt/apollo/neo/include/cyber/plugin_manager/plugin_manager.h（185–224 行：GetPluginConfPath）
- /apollo_workspace/tools/proto/proto.bzl（110–139、220–235 行：cc_proto 别名命名）
- ../13_control源码/01_control_component与数据流.md、../13_control源码/03_control_task框架与controllers清单.md（框架事实与 agent.cc 行号引用）
-->

## 0. 一句话作用

在本机 Apollo 11.0 包工作区里**从零加一个控制器**（或改一个已有控制器）的可执行流程：`buildtool create --template plugin` 出骨架 → 手写 `ControlTask` 五件套 → plugins.xml/BUILD/conf → `buildtool build -p` 完成 install → 写进**生效 pipeline（profile 层）** → 重启 control 看日志 `Controller <Name> init done!`。框架原理见 `../13_control源码/03_control_task框架与controllers清单.md`，不在本文重复。

## 1. 关键符号与文件

| 对象 | 路径（层） | 行号(已核) | 说明 |
|---|---|---|---|
| 最佳样板包 | `/opt/apollo/neo/src/modules/control/controllers/demo_control_task/`（② src，**9 个文件全在**） | — | 本机已装、已注册、**在生效 pipeline 里**（`DEMO_CONTROL_TASK`）；工作区也已有副本 `/apollo_workspace/modules/control/controllers/demo_control_task/` |
| `DemoControlTask` | 同上 `demo_control_task.h` | class 52，注册宏 141 | `: public ControlTask`，五件套 override 声明 68 / 79–83 / 88 / 94 / 100 |
| 基类纯虚 5 件套 | `/opt/apollo/neo/src/modules/control/control_component/controller_task_base/control_task.h` | Init/ComputeControlCommand/Reset/Name/Stop（见 03 篇 §1） | `Stop()` 在 :100（本轮 read 100–140 段确认） |
| `ControlTask::LoadConfig<T>` | 同上 | 120–138 | `abi::__cxa_demangle(typeid(*this).name())` 得类全名 → `GetPluginConfPath<ControlTask>(class_name, "conf/controller_conf.pb.txt")` |
| `ControlTask::LoadCalibrationTable` | 同上 | 106–117 | 纵向控制器用；读 `FLAGS_calibration_table_file` |
| `GetPluginConfPath` | `/opt/apollo/neo/include/cyber/plugin_manager/plugin_manager.h`（②′） | 191–208 | = `GetPluginClassHomePath<Base>(class_name)`（**插件描述文件所在目录**）+ `/conf/controller_conf.pb.txt`，再过 `GetFilePathWithEnv(..., "APOLLO_CONF_PATH", ...)`；本机 `APOLLO_CONF_PATH=/apollo`（env 实测） |
| 生效 pipeline | `/apollo/modules/control/control_component/conf/pipeline.pb.txt` → `/apollo_workspace/profiles/ARCF_40P/...`（readlink 实测，current→ARCF_40P） | — | 5 项，含 `DEMO_CONTROL_TASK→DemoControlTask` |
| 插件索引 | `/opt/apollo/neo/share/cyber_plugin_index/` | — | control 8 条（`ls | grep control` 实测），文件名 = lib 路径 `/`→`__` |

## 2. 步骤序列（本机可执行）

### 步 1：生成包骨架（`buildtool create --template plugin`，**control 侧无专用模板**）

`--help` 实测可用模板：`component,timer_component,plugin,planning_scenario,planning_task,planning_traffic_rule`。控制器用 `plugin`。本轮**实际跑通**的命令（生成后已删除，仅用于取证）：

```bash
cd /apollo_workspace
buildtool create modules/control/controllers/my_slow_task \
  --template plugin \
  --name my-slow-task \
  --class_name MySlowTask \
  --base_class_name apollo::control::ControlTask \
  --namespaces control \
  --config_message_name MySlowTaskConf \
  --config_file_name controller_conf \
  --dependencies control common common-msgs
```

实测产出 8 个文件：`my_slow_task.h`、`my_slow_task.cc`、`BUILD`、`cyberfile.xml`、`plugin_my_slow_task_description.xml`、`conf/controller_conf.pb.txt`、`proto/BUILD`、`proto/my_slow_task.proto`。

**四个模板参数坑（全部本轮实测）**：

| 坑 | 现象 | 正确写法 |
|---|---|---|
| `package_path` 位置 | 放在 `--dependencies`/`--namespaces`（nargs=*）后面会被吞掉 → `error: the following arguments are required: package_path` | **`package_path` 紧跟 `create`**，放最前 |
| `--namespaces` 多写 `apollo` | 模板固定外层 `apollo`；传 `apollo control` 生成 `namespace apollo{namespace apollo{namespace control` 且 type=`apollo::apollo::control::MySlowTask` | 只写 `--namespaces control` |
| `--config_file_name` 带后缀 | 传 `controller_conf.pb.txt` 生成 `conf/controller_conf.pb.txt.pb.txt` | 传 `controller_conf` |
| 文件名来源 | 文件名/`lib*.so`/描述文件名由 `--name`（`-`→`_`）派生，**与 `--class_name` 无关**；样板包 `control-controller-demo-control-task` 的文件却叫 `demo_control_task.*`（上游手工改过） | 要文件名 = 目录名就让 `--name` = 目录名；否则改名后同步改 BUILD 的 srcs/hdrs、`.cc` 的 include、描述 xml 的 `path` |

模板骨架**不能直接编译**（实测生成的 `.h` 只有一个 `bool Init();`，不 include `control_task.h`，proto 是空 message，BUILD deps 里没有 `control_task`）——它省的是 cyberfile/BUILD/描述 xml 样板，业务代码全靠手写。

### 步 2：proto（`<Task>Conf` message）

`proto/<name>.proto`：`syntax = "proto2"; package apollo.control; message MySlowTaskConf { optional double xxx = 1; }`。样板：`proto/demo_control_task_conf.proto`（22 个 optional 字段，`proto2`，`package apollo.control`）。
`proto/BUILD` 用 `proto_library(name = "..._conf_proto")`（**名字必须以 `proto` 结尾**，`tools/proto/proto.bzl:119–121` 否则 `fail`）；C++ 侧依赖的 label 是**去掉尾部 `_proto` 再加 `_cc_proto`** 的兼容别名（`proto.bzl:129–134`），即 `demo_control_task_conf_proto` → `//...:demo_control_task_conf_cc_proto`（demo BUILD 实证）。模板生成的 deps 写成 `:<target>_proto`，**按 demo 改成 `_cc_proto` 更稳**（`_proto` 本身能否作 cc 依赖：待核）。

### 步 3：类实现（五件套，摘 demo 最小要点）

继承 `ControlTask`（要用工况判定/滤波工具则继承 `ControlTaskExtend`，见 03 篇 §1）。demo `.cc` 行号：

| 成员 | 行号 | 最小实现要点 |
|---|---|---|
| 构造 | 35–37 | `: name_("demo control task")` + `AINFO << "Using " << name_`；`name_` 是 `Name()` 的唯一来源 |
| `Init` | 41–60 | ① `ControlTask::LoadConfig<DemoControlTaskConf>(&conf_)` 失败 → `return Status(ErrorCode::CONTROL_INIT_ERROR, ...)`（42–45）；② `injector_ = injector`（47，**必存，后面取车辆状态全靠它**）；③ 读 conf 字段进成员（49）；④ `vehicle_param_.CopyFrom(VehicleConfigHelper::Instance()->GetConfig().vehicle_param())`（51）；⑤ 状态量清零（53–57）；⑥ `return Status::OK()`（59） |
| `ComputeControlCommand` | 79–287 | ① 存三路输入指针 `localization/chassis/trajectory`（84–86）；② 车速/俯仰从 `injector_->vehicle_state()`（89、108）；③ **读上游控制器已填的字段**：`cmd->acceleration()`（106）、`cmd->mutable_debug()->mutable_simple_lon_debug()`（109、152）——顺序即语义；④ 业务规则修正 `command_acceleration`；⑤ 用 `vehicle_param_.max_acceleration()/max_deceleration()` 限幅（275–279）；⑥ **写回 cmd**：`cmd->set_acceleration(...)`（283）+ `debug->set_acceleration_cmd(...)`（284），改挡位用 `cmd->set_gear_location(GEAR_PARKING)`（172）；⑦ `return Status::OK()`（286） |
| `Reset` | 64–73 | 只清运行期状态量，`return Status::OK()` |
| `Name` | 75–77 | `return name_;`（`const` 方法） |
| `Stop` | 62 | 空实现即可（返回 void；何时被调用：待核，03 篇同列） |

`.h` 侧必备成员：`std::shared_ptr<DependencyInjector> injector_`（109）、`common::VehicleParam vehicle_param_`（110）、conf 对象（121）、三路输入指针（123–125）。

### 步 4：注册宏（写在 `.h` 里，namespace 内、全限定名）

```cpp
CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::control::MySlowTask, ControlTask)
```
demo 在 `demo_control_task.h:141`（namespace 结束在 143–144，即宏在 namespace 内部但第一参写全限定名）。第二参 demo 写短名 `ControlTask`，模板生成写 `apollo::control::ControlTask` —— 两种在本机都存在，**基类必须是最顶层 `ControlTask`**。

### 步 5：描述 xml（plugins.xml）

demo 原文（`plugins.xml`，cat 实测）：
```xml
<library path="modules/control/controllers/demo_control_task/libdemo_control_task.so">
    <class type="apollo::control::DemoControlTask" base_class="apollo::control::ControlTask"></class>
</library>
```
三属性 `path/type/base_class`，**没有 `class_type`**。文件名可以是 `plugins.xml`（demo）也可以是 `plugin_<target>_description.xml`（模板默认），只要 BUILD 的 `description` 指对。

### 步 6：conf

`conf/controller_conf.pb.txt`（**文件名固定**，`LoadConfig` 硬编码，control_task.h:128–129），内容是 proto 的 text 格式平铺（demo 22 行）。放在**包目录下**，不是 pipeline 别名目录。

### 步 7：BUILD 用 `apollo_plugin`

demo BUILD 实测要点：`load("//tools:apollo_package.bzl", "apollo_package", "apollo_plugin")`；`filegroup(name="runtime", srcs=glob(["conf/*"]))`；

```python
apollo_plugin(
    name = "libmy_slow_task.so",              # 必须 lib*.so
    srcs = ["my_slow_task.cc"], hdrs = ["my_slow_task.h"],
    description = ":plugins.xml",
    deps = [
        "//modules/control/control_component/controller_task_base:control_task",
        "//modules/control/control_component/common:control_gflags",
        "//cyber", "//modules/common/status",
        "//modules/control/controllers/my_slow_task/proto:my_slow_task_conf_cc_proto",
        "//modules/common_msgs/planning_msgs:planning_cc_proto",
        "//modules/common_msgs/chassis_msgs:chassis_cc_proto",   # demo 经 control_msgs/config_msgs 等一并列出
        "//modules/common_msgs/config_msgs:vehicle_config_cc_proto",
        "//modules/common_msgs/control_msgs:control_cmd_cc_proto",
    ],
)
apollo_package()
cpplint()
```
末尾必须 `apollo_package()`；`apollo_plugin` 自带 `alwayslink`，**不要手传，也不要退回 `cc_library`**。

### 步 8：cyberfile.xml

demo 原文要点：`<name>control-controller-demo-control-task</name>`、`<version>local</version>`、`<type>module</type>`、`<src_path>//modules/control/controllers/demo_control_task</src_path>`（**必须与目录一致**）、`<builder>bazel</builder>`、依赖 `bazel-extend-tools` + `<depend type="binary" repo_name="control">control</depend>` + `common` + `common-msgs`（+ demo 另有 eigen/absl）。

### 步 9：编译 install

```bash
buildtool build -p modules/control/controllers/my_slow_task
```
**必须走 buildtool**（`bazel build` 只出 bazel-bin，运行时不读；本机 `APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`）。成功后应能看到 `/opt/apollo/neo/lib/modules/control/controllers/my_slow_task/` 与 `share/cyber_plugin_index/modules__control__controllers__my_slow_task__libmy_slow_task.so`。

### 步 10：进生效 pipeline

```bash
readlink /apollo/modules/control/control_component/conf/pipeline.pb.txt   # 实测 → /apollo_workspace/profiles/ARCF_40P/...
```
在软链（写穿到 profile 层）里追加，**位置=执行顺序**，要读上游算出的加速度就排在 `LON_PLUS_CONTROLLER` 之后：
```
controller {
  name: "MY_SLOW_TASK"
  type: "MySlowTask"
}
```
`type` **只写类名**，`ControlTaskAgent` 会自动补 `apollo::control::`（03 篇 §1，agent.cc:42–43）。改 pipeline 不需要重编。

### 步 11：重启验证

```bash
mainboard -d /apollo/modules/control/control_component/dag/control.dag
```
日志出现 `Controller MySlowTask init done!`（agent.cc:37，03 篇引用）与 `Load the [apollo::control::MySlowTask] config file successfully, file path: ...`（control_task.h:135–136）即成功。

## 3. 文件 → 必须写什么（demo 核对表）

| 文件（demo 实名） | 必须写什么 | 写错的后果 |
|---|---|---|
| `demo_control_task.h` | class 继承 `ControlTask`；五件套 `override`；`injector_`/`vehicle_param_`/conf 成员；**末尾注册宏** | 漏注册宏 → so 里没工厂对象 |
| `demo_control_task.cc` | 五件套实现（见 §2 步 3 行号表）；构造里给 `name_` | `Init` 返回非 OK → 整个 control 起不来 |
| `plugins.xml` | `path`=lib 相对路径、`type`=类全名、`base_class`=`apollo::control::ControlTask` | 见 §4 第 1 行 |
| `BUILD` | `apollo_plugin(name="lib*.so", description=":plugins.xml", deps=[control_task, proto_cc_proto, ...])` + `apollo_package()` | 用 `cc_library` → `Class factory objs counts is 0` |
| `proto/*.proto` + `proto/BUILD` | `package apollo.control` + `<Task>Conf`；`proto_library` 名以 `proto` 结尾 | 名字不以 proto 结尾 → bazel `fail` |
| `conf/controller_conf.pb.txt` | conf 的 text 值，文件名固定 | 缺文件 → `LoadConfig` 失败 → Init 报错 |
| `cyberfile.xml` | `name`/`type=module`/`src_path` 与目录一致/`builder=bazel`/binary 依赖 control、common、common-msgs | `src_path` 不一致 → install 落错位置 |
| （包外）`pipeline.pb.txt` | `controller{name,type}`，profile 层软链 | 不加 = 插件永不实例化 |

## 4. ⚠️ 常见失败

| 症状 | 根因 | 处置 |
|---|---|---|
| `CreateInstance` 返回 nullptr / `Can not init controller` | plugins.xml 或注册宏第二参写成 `ControlTaskExtend`（中间基类对 PluginManager 不可见） | `base_class` 一律 `apollo::control::ControlTask`，即使类继承 `ControlTaskExtend` |
| 某帧起后面的控制器（含 debug）全不执行 | 任一控制器 `ComputeControlCommand` 返回非 OK **立即中断整条链**（agent.cc:70–72，03 篇核） | 新控制器里非致命情况一律 `return Status::OK()`，异常只打日志 |
| `Load config of apollo::control::X failed!` | conf 路径由「插件描述文件所在目录 + `conf/controller_conf.pb.txt`」推导，靠 **class_name 反查插件**（plugin_manager.h:191–208 + control_task.h:120–138）；改类名/namespace 却没同步 plugins.xml 的 `type` 与注册宏 → 查不到插件 → 路径解析失败 | 改类名时同步三处：class、注册宏、plugins.xml 的 `type`；conf 文件名不可改。**注：`../13_control源码/01_control_component与数据流.md` §3 写「task name 小写 = conf 子目录名」对 control 不成立（那是 planning task 的规则），以本节为准** |
| 编完了插件索引里没有 / 运行时找不到 | 只跑了 `bazel build`（不 install），本机不扫 bazel-bin | `buildtool build -p <包路径>` |
| 日志没有 `init done`、行为完全没变 | 忘了写进**生效** pipeline，或改了 share 层出厂 pipeline（生效档在 profile 层） | `readlink` 确认后改软链 |
| control 起不来，日志 `Empty control_pipeline` | pipeline 为空或 `FLAGS_pipeline_file` 路径错（agent.cc:35–38，03 篇核） | 恢复 pipeline 内容/路径 |
| pipeline 里 `type` 写成 `apollo::control::MySlowTask` | agent 会再补一次前缀 → `apollo::control::apollo::control::MySlowTask` 找不到 | `type` 只写类名 |
| 新控制器读到的 `cmd->acceleration()` 恒为 0 | 排在纵向控制器**之前** | 调 pipeline 顺序 |
| 改了包里 conf 没反应 | 改的是 `/apollo_workspace/<pkg>/conf/`（源码副本，要重编）；生效档是 `/apollo/modules/control/controllers/<pkg>/conf/*` 软链（demo 实测 → `profiles/current/...`） | 调参改软链，提交改源码副本再 `buildtool build -p` |

## 5. 验证命令（本机实测过路径的命令）

```bash
# ① 插件是否 install 并被索引
ls /opt/apollo/neo/lib/modules/control/controllers/
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep control
# ② 生效 pipeline 与落点
readlink /apollo/modules/control/control_component/conf/pipeline.pb.txt
cat /apollo/modules/control/control_component/conf/pipeline.pb.txt
# ③ conf 落点（profile 还是 share，逐个看）
ls -l /apollo/modules/control/controllers/demo_control_task/conf/
# ④ 前台起 control 看链是否装齐
mainboard -d /apollo/modules/control/control_component/dag/control.dag
# ⑤ 观察输出字段变化（cyber_channel -w 在本环境是坏的，勿用）
cyber_channel -e /apollo/control
cyber_channel hz /apollo/control
```

## 6. 溯源

- 蒸馏日期：2026-09-08。基线：Apollo 11.0.0 package 工作区（`profiles/current → ARCF_40P`）。
- 本轮 **read 打开核对**：`demo_control_task.cc`（全 408 行）、`demo_control_task.h`（全 144 行）、`control_task.h`（100–140）、`plugin_manager.h`（185–224）、`tools/proto/proto.bzl`（110–139）、`_template.md`、`13_control源码/01_control_component与数据流.md`、`13_control源码/03_control_task框架与controllers清单.md`。
- 本轮 **cat/ls/readlink 取证**：demo 包 9 个文件全文（plugins.xml、BUILD、cyberfile.xml、proto/BUILD、proto、conf、README_cn.md 前 73 行）、生效 pipeline 全文与 readlink、`cyber_plugin_index` control 8 条、`lib/modules/control/controllers/` 8 项、demo conf 软链落点、`env | grep APOLLO_PLUGIN/APOLLO_CONF_PATH`、`buildtool create --help` 全部参数。
- 本轮 **实跑取证**：`buildtool create --template plugin` 两次（`my_slow_task`、`ns_probe`），产出文件清单与 4 个参数坑均为实测；两个 scratch 包**已删除**（`/apollo_workspace/modules/control/controllers/` 现只剩 `BUILD` 与 `demo_control_task`）。
- 引自 03/01 篇未在本文重复核对：`control_task_agent.cc` 的 33–54 / 70–72 / 35–38 / 42–43 行号、`Controller <Name> init done!` 日志串、8 个控制器清单。
- 遗留待核：① 未真正执行 `buildtool build -p` 编译新包（避免污染工作区），因此**编译耗时、报错形态、`/apollo/modules/control/controllers/<新包>/` 视口软链是否自动生成**未实测；② 模板 BUILD 里 `:<target>_proto` 能否直接作 C++ 依赖（本文建议按 demo 改 `_cc_proto`）；③ `Stop()` 的调用点；④ `ControlTaskExtend` 子类新增时 `conf/params_pipeline.pb.txt` 是否必需（03 篇 §1 提到，未在本文验证）。
