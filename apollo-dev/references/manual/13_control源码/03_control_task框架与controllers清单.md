# 03 ControlTask 框架与 controllers 清单

<!--
file: references/manual/13_control源码/03_control_task框架与controllers清单.md
scope: 11.0（默认）
tags: ControlTask, ControlTaskExtend, ControlTaskAgent, pipeline, plugins.xml, base_class, LoadConfig, GetPluginConfPath, controllers, 8个控制器
sources:
- /opt/apollo/neo/src/modules/control/control_component/controller_task_base/control_task.h（40–141 行精读）
- /opt/apollo/neo/src/modules/control/control_component/controller_task_base/control_task_agent.cc（全 86 行）
- /opt/apollo/neo/src/modules/control/control_task_base_extend/control_task_extend.h（45–120 行精读）
- /opt/apollo/neo/src/modules/control/controllers/*/(lat_controller|lat_plus_controller|lon_controller|lon_plus_controller|replan_control_task|anti_slip_control_task|debug_info_control_task|demo_control_task).h（各文件 class 声明行与注册宏行）
- /apollo_workspace/.manual_work/inventory/control_inventory.md（P1 盘点：plugins.xml 原文、pipeline 两版、conf 清单）
-->

## 0. 一句话作用

control 侧**所有控制器都是插件**：统一基类 `ControlTask`（纯虚 5 件套），由 `ControlTaskAgent` 按 `pipeline.pb.txt` 的书写顺序用 PluginManager 逐个实例化，然后每个控制周期**依次**调用每个控制器的 `ComputeControlCommand`，对**同一个 `ControlCommand` 对象**逐级填充/修正。本机装了 8 个控制器包，生效 pipeline 启用 5 个。

## 1. 关键符号与文件

| 符号/类 | 文件（绝对路径，层） | 行号(已核) | 说明 |
|---|---|---|---|
| `ControlTask` | /opt/apollo/neo/src/modules/control/control_component/controller_task_base/control_task.h（② src；include 同文件） | 52 | 所有控制器的**最顶层基类**，plugins.xml 的 `base_class` 必须写它 |
| 纯虚接口 | 同上 | Init 69 / ComputeControlCommand 80–83 / Reset 89 / Name 95 / Stop 100 | 5 个纯虚，子类必须全实现 |
| `ControlTask::LoadConfig<T>` | 同上 | 103–104；实现 120–138 | 用 `PluginManager::GetPluginConfPath<ControlTask>(class_name, "conf/controller_conf.pb.txt")` 定位实例 conf（**按 demangle 得到的类全名找目录**） |
| `ControlTask::LoadCalibrationTable` | 同上 | 106–117 | 读 `FLAGS_calibration_table_file` 指向的标定表 |
| `ControlTaskExtend`（中间基类） | /opt/apollo/neo/src/modules/control/control_task_base_extend/control_task_extend.h（② src 全） | 51 | `: public ControlTask`，多出 `LoadParamsPipelineConfig`（读 `conf/params_pipeline.pb.txt`）、`VehicleStatusIdentificationUpdate`、`IsForwardModel`/`IsEdgeFollow`/`CheckInPit`/`IsLargeCurvature`/`GetVehicleSpeed`/`ThrottleCmdFilter` 等工况判定与滤波工具（78–92） |
| `ControlTaskAgent` | .../controller_task_base/control_task_agent.cc（② src 全 86 行） | Init 33–54 / ComputeControlCommand 56–75 / Reset 77–83 | 控制器链的持有者与调度者 |
| 插件实例化 | 同上 | 42–43 | `PluginManager::CreateInstance<ControlTask>("apollo::control::" + pipeline.controller(i).type())` —— **type 写类名不写 namespace，agent 自动补 `apollo::control::`** |

## 2. 机制与数据流

### 2.1 pipeline → 控制器链（Init，agent.cc:33–54）

1. `controller_size()==0` 直接返回 `CONTROL_INIT_ERROR`（"Empty control_pipeline"）——**pipeline 空或路径错 = control 起不来**。
2. 对每一项：`CreateInstance<ControlTask>("apollo::control::" + type)` → 立刻 `controller->Init(injector_)`，任一失败即整体 `CONTROL_INIT_ERROR`（日志 `Can not init controller <Name>`）。
3. 成功的按顺序 `push_back(controller_list_)`，日志 `Controller <Name> init done!`。

### 2.2 每周期执行（agent.cc:56–75）

`ControlComponent::Proc`（10 ms，见 `01_control_component与数据流.md`）→ `ProduceControlCommand` → `ControlTaskAgent::ComputeControlCommand`：**for 循环按 pipeline 顺序**把同一 `cmd` 指针传给每个控制器；每个控制器耗时记入 `cmd->latency_stats().controller_time_ms`（agent.cc:69）；**任一控制器返回非 OK 立即中断整条链**（:70–72）并把错误上抛。

⇒ 两条工程含义：① **顺序即语义**（横向先算还是纵向先算、debug/limiter 类放最后）；② 一个控制器返回错误会让后续控制器当帧不执行。

### 2.3 实例级 conf 的定位规则（control_task.h:120–138）

`LoadConfig<T>()` 用 `abi::__cxa_demangle(typeid(*this).name())` 得类全名（如 `apollo::control::LatController`），交给 `PluginManager::GetPluginConfPath<ControlTask>(class_name, "conf/controller_conf.pb.txt")` → 解析到该插件包目录下的 conf。`ControlTaskExtend` 子类另有 `LoadParamsPipelineConfig` 读同目录 `conf/params_pipeline.pb.txt`（工况分档参数表的入口）。

⇒ **conf 是按插件包目录组织的，不是按 pipeline 别名**（这点与 planning task 的「别名小写作路径」不同，别混）。

## 3. 注册与配置

### 3.1 8 个控制器（现场 read 每个 .h 的 class 行与注册宏行）

| 包目录 | 类名 | 直接基类 | class 行 | 注册宏行 | 一句话职责（据类名/conf/盘点，未逐行读实现） |
|---|---|---|---|---|---|
| lat_based_lqr_controller | `LatController` | `ControlTask` | 57 | 273 | 横向 LQR 控制器（出厂 pipeline 的 `LAT_CONTROLLER`） |
| lat_based_lqr_plus_controller | `LatPlusController` | **`ControlTaskExtend`** | 61 | 398 | 横向 LQR 增强版：带 10 个工况 param（public_road/open_space/zone_cover/edge_follow 的前进后退与转向档）；本机生效 |
| lon_based_pid_controller | `LonController` | `ControlTask` | 55 | 185 | 纵向 PID + 标定表（出厂 `LON_CONTROLLER`），含 `util/check_pit` |
| lon_based_pid_plus_controller | `LonPlusController` | **`ControlTaskExtend`** | 60 | 254 | 纵向 PID 增强版：10 个工况 param（pit/precise/open_space/zone_cover…）；本机生效 |
| replan_control_task | `ReplanControlTask` | **`ControlTaskExtend`** | 51 | 117 | 消费 `/apollo/safety/decision` 触发全量重规划请求（详见 01 篇 §2.4）；**本机生效 pipeline 未启用** |
| slope_anti_slip_control_task | `AntiSlipControlTask` | **`ControlTaskExtend`** | 53 | 218 | 坡道防溜车（`edge_follow_param`/`public_road_param`/`params_pipeline`）；本机生效 |
| debug_info_control_task | `DebugInfoControlTask` | **`ControlTaskExtend`** | 49 | 113 | 只填调试信息，**无 proto 无 conf**；本机生效（放链尾） |
| demo_control_task | `DemoControlTask` | `ControlTask` | 52 | 141 | 示例控制器（2026-08-11 补装，CLAUDE.md 记「已删」已过期）；本机生效 |

注册宏统一写法：`CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::control::Xxx, ControlTask)` —— **第一参全限定类名，第二参基类**；对应 plugins.xml 的 `type=apollo::control::Xxx`、`base_class=apollo::control::ControlTask`、`path=modules/control/controllers/<pkg>/lib*.so`（8 条原文见盘点表 §3）。索引落在 `/opt/apollo/neo/share/cyber_plugin_index/`（全库 118 条）。

⚠️ **中间基类对 PluginManager 不可见**：5 个控制器实际继承 `ControlTaskExtend`，但注册与 plugins.xml 的 `base_class` 仍必须是最顶层 `ControlTask`（与 planning 侧 `Decider`/`PathGeneration` 不出现在 plugins.xml 同理）。写成 `ControlTaskExtend` 会注册到错误的基类桶里，`CreateInstance<ControlTask>` 找不到 → 起不来。

### 3.2 生效 vs 出厂 pipeline

| 档 | 路径 | 内容 |
|---|---|---|
| 生效（profile 层） | `/apollo/modules/control/control_component/conf/pipeline.pb.txt` → `/apollo_workspace/profiles/current/...`（current→ARCF_40P） | 5 项：`LAT_PLUS_CONTROLLER→LatPlusController`、`LON_PLUS_CONTROLLER→LonPlusController`、`DEMO_CONTROL_TASK→DemoControlTask`、`ANTISLIP_TASK→AntiSlipControlTask`、`DEBUG_INFO_TASK→DebugInfoControlTask` |
| 出厂（share 层） | `/opt/apollo/neo/share/modules/control/control_component/conf/pipeline.pb.txt` | 2 项：`LAT_CONTROLLER`、`LON_CONTROLLER` |

## 4. 修改与扩展点（二次开发）

- **启停某控制器**：编辑生效 `pipeline.pb.txt` 的 `controller { name: "别名" type: "类名" }`（顺序=执行顺序），重启组件；不需要重编。
- **新写一个 ControlTask 插件**（完整流程见 `../15_二次开发手册/04_新增ControlTask.md`）：
  1. `buildtool create --template plugin ... modules/control/controllers/<your_task>`；
  2. 类 `: public ControlTask`（要用工况工具则 `: public ControlTaskExtend`），实现 5 个纯虚（`Init/ComputeControlCommand/Reset/Name/Stop`）；
  3. `.h` 末尾 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::control::YourTask, ControlTask)`；
  4. plugins.xml 三属性 `type/base_class/path`（**没有 class_type**）；BUILD 用 `apollo_plugin`（自带 alwayslink，漏了会被裁掉→`Class factory objs counts is 0`）；
  5. `conf/controller_conf.pb.txt` + proto；`buildtool build -p modules/control/controllers/<your_task>`（**必须 buildtool，bazel build 不 install**）；
  6. 进 pipeline，重启 control 验证日志 `Controller <Name> init done!`。
- **改工况分档参数**：对应包 `conf/params_pipeline.pb.txt` 与各 `*_param.pb.txt`（先 `readlink` 判定 profile/share 落点）。
- **加中间基类能力**：`control_task_base_extend` 包（`common/` 下 pid_plus、leadlag_plus、exponential_smoothing、interpolation_plus_1d、trajectory_analyzer_extend、control_checker、math_utils），改它要 `buildtool build -p modules/control/control_task_base_extend`。

## 5. ⚠️ 本环境注意

- **8 个不是 7 个**：demo_control_task 全层存在且在生效 pipeline 里（2026-09-08 实测；CLAUDE.md 已过期）。`mpc_controller` 控制器包**不存在**（仅 `control_component/submodules/mpc_controller_submodule.*` 与 `mpc_module.dag` 残迹）。
- **plugins.xml 的 base_class 只写 `apollo::control::ControlTask`**（哪怕类继承自 `ControlTaskExtend`）。
- **一个控制器返回非 OK 会掐断整条链**（agent.cc:70–72）：某控制器报错后，后面的（含 debug 类）当帧全不执行。
- **conf 定位靠类名 demangle**：改类名/namespace 会连带改变 conf 查找路径（`GetPluginConfPath` 用类全名），改名后 conf 目录要同步。
- **conf 落点混指**：controllers 的 conf 部分指 `profiles/current`、部分指 share（如 lat_plus 的 sl/sr_turn_param 仍指 share），改前逐个 `readlink`。
- **插件改完必须 `buildtool build -p` 完成 install** 才会进 `/opt/apollo/neo/lib` 与 `share/cyber_plugin_index`（本机 `APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`，不扫 bazel-bin）。
- 每个控制器 lib 目录下存在**嵌套重复 .so**（`.../<pkg>/<pkg>/lib*.so`），索引与 plugins.xml 指的是外层路径。

## 6. 验证命令

```bash
# 装了哪些控制器插件（索引条目）
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep control
# 某控制器的 plugins.xml 原文（确认 type/base_class/path）
cat /opt/apollo/neo/share/modules/control/controllers/lat_based_lqr_plus_controller/plugins.xml
# 生效 pipeline（决定实际实例化哪些）
cat /apollo/modules/control/control_component/conf/pipeline.pb.txt
readlink /apollo/modules/control/control_component/conf/pipeline.pb.txt
# 起 control 看链是否装齐（日志出现每个 Controller <Name> init done!）
mainboard -d /apollo/modules/control/control_component/dag/control.dag
```

## 7. 溯源

- 蒸馏日期：2026-09-08。基线：Apollo 11.0.0 package 工作区。
- 本文行号全部由本轮 read 打开核对：`control_task.h`（40–141）、`control_task_agent.cc`（全文）、`control_task_extend.h`（45–120）、8 个控制器 .h 的 class 行与注册宏行（grep 定位后逐个确认输出）。
- 引用盘点表未重复核对的：plugins.xml 8 条原文与索引文件名、pipeline 两版内容、各包 conf/proto 文件清单、lib 嵌套副本现象。
- 遗留待核：① 各控制器算法实现细节（LQR/PID 内部）留给 `02_横纵向控制器.md`；② `ControlTaskExtend::Name()` 非虚覆盖语义（`name_` 为 const 成员但未见赋值点，未逐行读 .cc）；③ `GetPluginConfPath` 的实现（在 cyber plugin_manager，属 `../11_cyber框架/`）；④ `Stop()` 何时被调用（未在 agent 中出现，component 侧未核）。
