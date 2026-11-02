# 05 Stage 框架（Stage 基类 · stage 切换 · pipeline 编排）

<!--
file: references/manual/12_planning源码/05_stage框架.md
scope: 11.0（默认）
tags: Stage, Stage基类, StageResult, StageStatusType, next_stage_, FinishStage, FinishScenario, ExecuteTaskOnReferenceLine, ExecuteTaskOnOpenSpace, task_list_, fallback_task, pipeline.pb.txt, StagePipeline, ScenarioPipeline, TransformToPathName, LoadMergedConfig, 实例conf, plugins.xml, base_class
sources:
- /opt/apollo/neo/include/modules/planning/planning_interface_base/scenario_base/{stage.h（全 99 行）, process_result.h（全 159 行）, scenario.h（全 127 行）}
- /opt/apollo/neo/src/modules/planning/scenarios/pull_over/{stage_approach.h（全 44 行）, stage_approach.cc（全 149 行）, conf/pipeline.pb.txt（全 119 行，出厂版）}
- /opt/apollo/neo/src/modules/planning/scenarios/bare_intersection_unprotected/stage_approach.cc（30–139 行精读）
- /opt/apollo/neo/src/modules/planning/scenarios/stop_sign_unprotected/stage_creep.cc（全 161 行）
- /apollo_workspace/profiles/ARCF_40P/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt（全 127 行，= ④ 生效档）
- /opt/apollo/neo/src/modules/planning/planning_base/common/util/config_util.cc（25–43 行精读）
- 以下用 cat/ls/diff/grep 核对内容但未用 read 打开（故不引行号）：include/.../scenario_base/base_stage_creep.h、include/.../task_base/task.h、include/.../planning_base/common/util/config_util.h、src/.../scenario_base/proto/scenario_pipeline.proto、src/.../scenarios/pull_over/plugins.xml、19 个 scenario 的 share 侧 plugins.xml、④ 视口 ls -l/readlink
-->

## 0. 一句话作用

Stage 是 scenario 内部的**状态机节点**：一个 scenario 把自己的业务拆成若干 stage，每个 stage 持有一串
task（pipeline 里声明的顺序即执行顺序），每帧由 `Scenario::Process` 调当前 stage 的 `Process()`，
stage 用返回的 `StageResult` + 成员 `next_stage_` 决定「继续本 stage / 跳下一个 stage / 结束整个 scenario」。
链路位置：`PublicRoadPlanner`（[03](03_planners_public_road.md)）→ Scenario → **Stage（本篇）** → Task。

## 1. 关键符号与文件

| 符号/类/概念 | 文件（绝对路径，注明层） | 行号(已核) | 说明 |
|---|---|---|---|
| `Stage`（顶层基类） | `/opt/apollo/neo/include/.../planning_interface_base/scenario_base/stage.h`（**②′ 仅头文件树；src 树该目录下只有 `proto/`**） | 46 | 无纯虚 `Name()`；唯一纯虚是 `Process` |
| `Stage::Init` | 同上 | 50-52 | `virtual bool Init(const StagePipeline& config, const shared_ptr<DependencyInjector>&, const string& config_dir, void* context)` —— **四参：pipeline 配置 / 注入器 / conf 目录 / scenario context** |
| `Stage::Process`（纯虚） | 同上 | 61-62 | `virtual StageResult Process(const common::TrajectoryPoint& planning_init_point, Frame* frame) = 0`；注释原文（56-60）：想切 stage 就设 `next_stage_` |
| `Name()` / `NextStage()` / `GetContextAs<T>()` | 同上 | 64 / 71 / 66-69 | `GetContextAs` 就是 `static_cast<T*>(context_)`，**无类型检查，转错类型 = UB** |
| `ExecuteTaskOnReferenceLine` / `...ForOnlineLearning` / `ExecuteTaskOnOpenSpace` | 同上 | 74-75 / 77-78 / 80 | 三条 protected 执行路径：on-lane 主路径（按 `task_list_` 顺序跑 task）、学习型规划、开放空间/泊车（无参考线） |
| `FinishScenario()`（virtual） | 同上 | 82 | 基类提供，**派生类通常直接 return 它来结束整个 scenario** |
| `RecordDebugInfo` | 同上 | 84-85 | 把单 task 耗时写进 debug |
| 成员 | 同上 | 87-92 | `std::vector<std::shared_ptr<Task>> task_list_`(87)、`std::shared_ptr<Task> fallback_task_`(88)、`std::string next_stage_`(89)、`void* context_`(90)、`injector_`(91)、`StagePipeline pipeline_config_`(92)；私有 `name_`(95) |
| `StageStatusType` | `include/.../scenario_base/process_result.h` | 34-39 | `enum class`：`ERROR=1, READY=2, RUNNING=3, FINISHED=4`（**无 UNKNOWN**） |
| `ScenarioStatusType` | 同上 | 41-45 | `STATUS_UNKNOWN=0, STATUS_PROCESSING=1, STATUS_DONE=2` |
| `StageResult` | 同上 | 52-99 | 构造默认 `(READY, Status::OK())`(54-55)；`GetTaskStatus`(61)/`GetStageStatus`(67)/`SetTaskStatus`(73)/`SetStageStatus`(79, 带 message 重载 86-87)/`HasError`(93)/`IsTaskError`(94)；私有只有 `task_status_`+`stage_status_`(97-98) |
| `ScenarioResult` | 同上 | 106-156 | 组合 `scenario_status_` + `stage_result_`(154-155)；`SetStageResult`(135, 143-144) |
| `Scenario::CreateStage` | `include/.../scenario_base/scenario.h` | 88 | `shared_ptr<Stage> CreateStage(const StagePipeline&)` —— stage 实例由 scenario 按 pipeline 现造 |
| `Scenario` 侧 stage 状态 | 同上 | 110-111 | `shared_ptr<Stage> current_stage_`、`unordered_map<string, const StagePipeline*> stage_pipeline_map_`（**按 stage 别名 name 索引**） |
| `Scenario::GetStage()` / `config_dir_` / `scenario_pipeline_config_` | 同上 | 94 / 116 / 118 | `config_dir_` 就是传给 `Stage::Init` 的第三参来源 |
| `BaseStageCreep`（中间基类） | `include/.../scenario_base/base_stage_creep.h`（未 read，cat 核对） | — | `: public Stage`，提供 `ProcessCreep/CheckCreepDone/GetCreepFinishS`，纯虚 `GetCreepStageConfig()`/`GetOverlapStopInfo()`。**对 PluginManager 不可见，从不写进 plugins.xml** |
| `BaseStageCruise` | `include/.../scenario_base/base_stage_cruise.h`（仅 ls 见到） | — | 同类中间基类，**内容待核** |
| `Task`（被 stage 持有的插件） | `include/.../task_base/task.h`（未 read，cat 核对） | — | `Init(config_dir, name, injector)`；`LoadConfig` 走 `ConfigUtil::LoadMergedConfig(default_config_path_, config_path_, config)` |
| `ConfigUtil::TransformToPathName` | `/opt/apollo/neo/src/.../planning_base/common/util/config_util.cc`（② src 全） | 26-30 | **只 `::tolower`，不做驼峰转下划线**——实例 conf 路径规则的唯一依据 |

> ⚠️ `planning_interface_base` 是**纯 binary 包**：`Stage::Init`、`ExecuteTaskOnReferenceLine`、
> `FinishScenario`、`Scenario::Process/CreateStage` 的**实现（.cc）在本机不存在**，只有头文件 + `.so`。
> 本篇凡涉及这些函数体内部行为的描述，均由「头文件签名 + 成员 + 19 个 scenario 的调用侧写法 + proto 注释」
> 推断，已逐条标注**待核**。想读实现要么装源码包（`buildtool install planning` 不含此包，见 §5），要么读上游仓库。

## 2. 机制与数据流

### 2.1 类层次

`Stage`（纯虚 `Process`，plugins.xml 的 `base_class` **只认这一层**）→ 中间基类
`BaseStageCreep`（`ProcessCreep`/`CheckCreepDone`/`GetCreepFinishS`）与 `BaseStageCruise`
（对 PluginManager 不可见，从不写进 plugins.xml）→ 43 个具体 stage（散在 19 个 scenario 包里，见 §3.1）。

### 2.2 一个 stage 的生命周期

| 阶段 | 谁调 | 做什么 | 证据 |
|---|---|---|---|
| 创建 | `Scenario::CreateStage(stage_pipeline)` | 按 `StagePipeline.type`（类名）经 PluginManager 造实例 | scenario.h:88（**函数体待核**） |
| 初始化 | `Stage::Init(config, injector, config_dir, context)` | 存 `pipeline_config_`/`injector_`/`context_`/`name_`；**按 `pipeline_config_.task()` 逐个造 task 填进 `task_list_`，按 `fallback_task` 造 `fallback_task_`** | 签名 stage.h:50-52 + 成员 87-88、92；派生类调用 `Stage::Init(...)` 于 stop_sign_unprotected/stage_creep.cc:47（**task 构造循环本身在 .so 里，待核**） |
| 每帧执行 | `Scenario::Process` → `current_stage_->Process(init_point, frame)` | 见 §2.4 典型写法 | scenario.h:75-76、110 |
| 切换/结束 | stage 自己设 `next_stage_` + 返回 `FINISHED`，或 `return FinishScenario()` | 见 §2.3 | pull_over/stage_approach.cc:139-146 |

派生类 **override `Init` 是可选的**：只有需要额外检查/取 context 的才写，且第一件事必须调 `Stage::Init(...)`
并在失败时 `AERROR` 返回 false（stop_sign_unprotected/stage_creep.cc:42-53 是标准写法）。

### 2.3 stage 切换语义（三种返回，别混）

| 想要的效果 | 写法 | 现场样本 |
|---|---|---|
| **本 stage 继续跑下一帧** | `return result.SetStageStatus(StageStatusType::RUNNING);` | pull_over/stage_approach.cc:136；bare_intersection/stage_approach.cc:130；stop_sign/stage_creep.cc:124 |
| **切到同 scenario 的另一个 stage** | 设 `next_stage_ = "<目标 stage 的 pipeline name 别名>"` 再 `return StageResult(StageStatusType::FINISHED);` | pull_over/stage_approach.cc:143-144（`next_stage_ = "PULL_OVER_RETRY_APPROACH_PARKING"`）；stop_sign/stage_creep.cc:156-157（`"STOP_SIGN_UNPROTECTED_INTERSECTION_CRUISE"`） |
| **整个 scenario 结束**（交还 ScenarioManager 重选） | `return FinishScenario();` | pull_over/stage_approach.cc:141；bare_intersection/stage_approach.cc:56、64 |

三条关键事实：

1. **`next_stage_` 填的是 pipeline 里的 `name` 别名，不是类名**——`stage_pipeline_map_` 就是按别名建的索引
   （scenario.h:111）。写成类名（`PullOverStageRetryParking`）查不到 → 切换失败。
2. **基类 `Stage` 没有 `FinishStage()`**（stage.h 全 99 行只有 `FinishScenario`）。各 stage 自己在派生类里
   私有声明 `FinishStage(...)`（pull_over/stage_approach.h:37 是 `StageResult FinishStage(const bool success)`，
   stop_sign/stage_creep.cc:155 是无参版）——**签名各不相同，属于各 stage 的私有习惯，不是框架接口**。
3. `StageResult` 双通道：`stage_status_` 表状态机走向，`task_status_` 表 task 执行成败。
   `ExecuteTaskOnReferenceLine` 返回的 result 里 task 出错时 `HasError()` 为真，
   **样本代码一律只 `AERROR` 打印、继续往下跑**（pull_over:50-52、bare_intersection:46-48、stop_sign:85-87）
   —— task 失败不自动终止 stage。

### 2.4 `Process` 里的典型写法（四段式）

以 `BareIntersectionUnprotectedStageApproach::Process`（bare_intersection_unprotected/stage_approach.cc:37-131）为例，
这是「限速 + 执行 task + 判完成」最完整的一个样本：

```cpp
// 1) 取 scenario 级配置（context 由 scenario 注入，类型是本 scenario 自己的 Context）
scenario_config_.CopyFrom(GetContextAs<BareIntersectionUnprotectedContext>()->scenario_config);  // :42-43
// 2) 先跑一遍 task 链
StageResult result = ExecuteTaskOnReferenceLine(planning_init_point, frame);                     // :45
// 3) 场景条件不成立 → 直接结束整个 scenario
if (pnc_junction_overlap_id.empty()) return FinishScenario();                                    // :55-57
// 4) 限速：改的是 ReferenceLineInfo 的巡航速度，不是 gflag
frame->mutable_reference_line_info()->front().LimitCruiseSpeed(
    scenario_config_.approach_cruise_speed());                                                  // :81-82
reference_line_info.SetJunctionRightOfWay(current_pnc_junction->start_s, false);                 // :85-86
result = ExecuteTaskOnReferenceLine(planning_init_point, frame);   // 限速后再跑一遍             // :88
... BuildStopDecision(...)                                                                      // :121-126
return result.SetStageStatus(StageStatusType::RUNNING);                                          // :130
```

要点：**限速 = `ReferenceLineInfo::LimitCruiseSpeed(v)`，且改完要重跑 `ExecuteTaskOnReferenceLine` 才生效**
（该函数把参考线上的速度上界喂给 speed 类 task）。停车用 `planning::util::BuildStopDecision(...)` 造虚拟障碍物
（pull_over/stage_approach.cc:112-116 同样写法）。creep 类 stage 另有 `ProcessCreep(frame, &rli)`
（stop_sign/stage_creep.cc:76）+ `SpeedProfileGenerator::GenerateFixedDistanceCreepProfile`（:115-116）。

### 2.5 `enabled` 字段的两种落法

`StagePipeline.enabled`（proto 注释原文：*If the stage is disabled, it will be skipped*）：
本机现场看到的是 **stage 自己检查**——`if (!pipeline_config_.enabled()) return FinishStage();`
（stop_sign_unprotected/stage_creep.cc:65-67）。框架侧是否也在 `Scenario::Process` 里跳过 disabled stage
**待核**（实现在 .so）。生效档里唯一一处 `enabled: false` 是 pull_over 的 `PULL_OVER_RETRY_APPROACH_PARKING`
（profile pipeline.pb.txt:57），而 `PullOverStageApproach::FinishStage(false)` 仍把 `next_stage_` 指向它
（stage_approach.cc:143）——**disabled 的 stage 依然会被切进去**，只是它自身应立刻跳过。

### 2.6 无独立 channel

Stage 层不注册任何 reader/writer：输入 `planning_init_point` + `Frame*`，输出全是对 `Frame` /
`ReferenceLineInfo` / `PlanningContext` 的副作用。对外发布在组件层（[02](02_planning_component主循环.md) §2.5）。

## 3. 注册与配置

### 3.1 插件注册：43 个 Stage 全在 scenario 包的 plugins.xml 里（1 library 多 class）

`src/.../scenarios/pull_over/plugins.xml` 全文（cat 核对）：

```xml
<library path="modules/planning/scenarios/pull_over/libpull_over_scenario.so">
    <class type="apollo::planning::PullOverScenario"                  base_class="apollo::planning::Scenario"></class>
    <class type="apollo::planning::PullOverStageApproach"             base_class="apollo::planning::Stage"></class>
    <class type="apollo::planning::PullOverStageRetryApproachParking" base_class="apollo::planning::Stage"></class>
    <class type="apollo::planning::PullOverStageRetryParking"         base_class="apollo::planning::Stage"></class>
</library>
```

**stage 没有自己的 .so、没有自己的目录、没有独立索引条目**：scenario 与它的全部 stage 编进同一个
`lib<scenario>_scenario.so`，共用一条 `cyber_plugin_index` 条目。注册宏写在 **stage 的 `.h`** 末尾：
`CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::PullOverStageApproach, Stage)`
（pull_over/stage_approach.h:40-41；第一参全限定名，第二参基类**短名 `Stage`**）。
各 scenario 包内 Stage class 数（`grep -c` 19 个 share 侧 plugins.xml，合计 **43**）：

| 4 个 | 3 个 | 2 个 | 1 个 |
|---|---|---|---|
| park_and_go、stop_sign_unprotected | emergency_pull_over、precise_parking、pull_over、traffic_light_unprotected_left_turn、traffic_light_unprotected_right_turn、valet_parking_park | bare_intersection_unprotected、emergency_stop、square、traffic_light_protected、valet_parking、yield_sign | free_space、lane_escape、lane_follow、lane_follow_park、large_curvature |

### 3.2 pipeline.pb.txt：stage 与 task 的编排文件

proto 定义（`src/.../scenario_base/proto/scenario_pipeline.proto`，cat 核对）：
`ScenarioPipeline { repeated StagePipeline stage = 1; }`；
`StagePipeline { required string name = 1; required string type = 2; optional bool enabled = 3;
repeated PluginDeclareInfo task = 4; optional PluginDeclareInfo fallback_task = 5; }`。

生效档（④ `/apollo/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt` 是软链，
`readlink -f` → `/apollo_workspace/profiles/ARCF_40P/...`，**profile 覆盖层**）结构：

| 行 | 内容 | 语义 |
|---|---|---|
| 1-53 | `stage { name:"PULL_OVER_APPROACH" type:"PullOverStageApproach" enabled:true task{…}×11 fallback_task{…} }` | **第一个 stage = 进入 scenario 后的起始 stage**（`Scenario::Reset/Enter` 用第一条，待核） |
| 5-48 | 11 个 `task { name: <别名> type: <类名> }` | **书写顺序 = `task_list_` 执行顺序**，无优先级字段 |
| 26-27 / 38-39 | `SPEED_BOUNDS_PRIORI_DECIDER` 与 `SPEED_BOUNDS_FINAL_DECIDER` **`type` 同为 `SpeedBoundsDecider`** | 同一个 task 类可在一条 pipeline 里出现多次，**靠 `name` 别名区分实例与各自的 conf** |
| 49-52 | `fallback_task { name:"SMOOTH_STOP_TRAJECTORY_FALLBACK" type:"SmoothStopTrajectoryFallback" }` | path/speed 规划失败时的兜底 task（proto 注释） |
| 54-106 | `PULL_OVER_RETRY_APPROACH_PARKING`（`enabled: false`，:57） | 见 §2.5 |
| 107-127 | `PULL_OVER_RETRY_PARKING`（4 个 open_space task） | 泊车分支，走 `ExecuteTaskOnOpenSpace` |

**stage 的顺序语义**：pipeline 里的顺序**不是执行顺序**——除「第一条 = 起始 stage」外，跳转完全由
`next_stage_` 显式指定（§2.3）。这与 scenario 列表「顺序 = 优先级」（[03](03_planners_public_road.md) §3.2）
和 task 列表「顺序 = 执行顺序」都不同，三层语义各不一样。

**生效档 vs 出厂档（diff 已核）**：出厂 `share/.../pull_over/conf/pipeline.pb.txt` = 119 行、**两个 stage 都没有
`fallback_task`**；profile 档 127 行，给前两个 stage 各加了 `SMOOTH_STOP_TRAJECTORY_FALLBACK` —— 排查
「fallback 行为」时看出厂档会得出错误结论。

### 3.3 实例级 conf 路径规则（写错只 AWARN）

规则：`scenarios/<scenario 包名>/conf/<stage 的 name 别名小写>/<task 的 name 别名小写>.pb.txt`。
依据链：`Scenario::config_dir_`（scenario.h:116）→ `Stage::Init` 第三参 `config_dir`（stage.h:50-52）→
`Task::Init(config_dir, name, injector)` 拼 `config_path_` → `ConfigUtil::TransformToPathName(name)`
**只做 `::tolower`**（config_util.cc:26-30）。**中间两步的拼接代码在 .so 里，属推断，待核**；
但目录事实完全吻合（ls 核对）：

| pipeline 里的别名 | 落地路径（② src 侧，安装后同构落到 share/profile） |
|---|---|
| stage `PULL_OVER_APPROACH` + task `PULL_OVER_PATH` | `scenarios/pull_over/conf/pull_over_approach/pull_over_path.pb.txt` |
| stage `PULL_OVER_RETRY_PARKING` + task `OPEN_SPACE_ROI_DECIDER` | `.../conf/pull_over_retry_parking/open_space_roi_decider.pb.txt` |
| stage `PARK_AND_GO_CRUISE` + task `PATH_DECIDER` | `scenarios/park_and_go/conf/park_and_go_cruise/path_decider.pb.txt` |

**只 tolower 的后果**：别名必须自带下划线。别名写 `PullOverApproach` → 目录名要叫 `pulloverapproach`；
把别名从 `PULL_OVER_PATH` 改成 `MY_PULL_OVER` 而不同步改文件名 → 路径失配。
失配的**失败模式**：`Task::LoadConfig` → `ConfigUtil::LoadMergedConfig`（config_util.h 内联实现，cat 核对）
先读 `default_config_path_`（= task 包自带 `conf/<task>.pb.txt`），再读实例 `config_path_`，
后者读不到只 `AWARN "can not load user defined config file[...], use default config instead"` 并 **return true**
—— **不报错、不崩、静默用默认值**，`MergeFrom` 不执行。这是「改了 conf 没效果」最常见的一种。

## 4. 修改与扩展点（二次开发）

**新增一个 stage（挂进现有 scenario）——四处改动，缺一不生效：**

1. 源码：`buildtool install planning` 后在 `/apollo_workspace/modules/planning/scenarios/<sc>/` 加
   `stage_<x>.h` / `stage_<x>.cc`。`.h` 里 `class MyStage : public Stage`（或 `BaseStageCreep`），
   `override Process`，末尾加 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::MyStage, Stage)`；
   `.cc` 里实现 `Process`（照 §2.4 四段式）+ 自己的 `FinishStage`。
2. 注册：把 `<class type="apollo::planning::MyStage" base_class="apollo::planning::Stage"></class>`
   加进**该 scenario 已有的** `plugins.xml`（不要新建 library 段，也不要新 .so）；
   `BUILD` 里把 `stage_<x>.cc` 加进该 scenario 的 `apollo_plugin(srcs=[...])`（**必须 `apollo_plugin`**，
   自带 `alwayslink`；手写 `cc_library` → 注册对象被裁 → 运行期 `Class factory objs counts is 0`）。
3. 编排：在 `<sc>/conf/pipeline.pb.txt` 追加 `stage { name:"MY_STAGE" type:"MyStage" enabled:true task{…} }`，
   并让上游 stage 的 `next_stage_ = "MY_STAGE"`（**别名，不是类名**）。
4. 实例 conf（可选）：建目录 `<sc>/conf/my_stage/`，按 task 别名小写放 `<task>.pb.txt`；不放就用 task 默认 conf。
5. 编译安装：`buildtool build -p modules/planning/scenarios/<sc>`（**只 `bazel build` 运行时看不见**，运行时只读
   `/opt/apollo/neo/{lib,share}`）→ 验证 `grep MyStage /opt/apollo/neo/share/modules/planning/scenarios/<sc>/plugins.xml`
   → 起进程 `mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag`。

**只调 stage 顺序 / task 编排 / 实例参数（不改代码、不重编）**：直接改 ④
`/apollo/modules/planning/scenarios/<sc>/conf/pipeline.pb.txt`（软链，写穿到 profile 层，重启 planning 生效）。
要进版本管理则改 ① `/apollo_workspace/modules/planning/scenarios/<sc>/conf/...` 再 `buildtool build -p`。
**新增 scenario**（含 stage 骨架）用 `buildtool create --template planning_scenario <package_path>`，新增 task 用
`--template planning_task`；**没有 `--template planning_stage`**（模板清单见 CLAUDE.md 三节③）。

## 5. ⚠️ 本环境注意

- **Stage 基类只有头文件，没有 .cc**：`planning_interface_base` 是 binary 包（`ls /opt/apollo/neo/src/.../planning_interface_base/`
  只有 `scenario_base/proto` 与 `traffic_rules_base/proto`），`buildtool install planning` **拉不到它**（① 已装 8 个
  planning 包，不含 `planning_base` / `planning_interface_base`）。所以 `Stage::Init` 建 task 的循环、
  `ExecuteTaskOnReferenceLine` 的 fallback 逻辑、`FinishScenario` 的具体置位**本机无法读源码核实**。
- **scenario 的 conf 生效档在 profile 层，不是 share**：`ls -l /apollo/modules/planning/scenarios/pull_over/conf/`
  显示 `pipeline.pb.txt`、`scenario_conf.pb.txt` 及 stage 子目录里的文件**全部软链到
  `/apollo_workspace/profiles/current/...`（current → ARCF_40P）**；19 个 scenario 在 profile 树下都有目录。
  出厂档改了下次 install 会被覆盖，而且**本机根本不读**。CLAUDE.md「conf 软链一律指向 share」已过期（2026-09-08 实测）。
- **搜 ④ 目录一律 `grep -R`**（`-r` 不跟随软链，会把「没人引用」判成真）。
- **43 个 Stage 共享 scenario 的 .so 与索引条目**：查「stage 装没装」不要去 `ls /opt/apollo/neo/lib/.../stage_*`
  （不存在），要 `grep base_class=\"apollo::planning::Stage\" share/modules/planning/scenarios/*/plugins.xml`。
- **`base_class` 必须写 `apollo::planning::Stage`**：写 `BaseStageCreep`/`BaseStageCruise` 这类中间基类
  PluginManager 找不到（现场 43 条无一例外）；属性名只有 `type`/`base_class`/`path`，**没有 `class_type`**。
- **三层顺序语义别串**：scenario 列表顺序 = 优先级（first-match）；stage 列表顺序 ≠ 执行顺序（靠 `next_stage_`，
  只有第一条是入口）；task 列表顺序 = 执行顺序。
- **大小写与别名**：`next_stage_` / conf 目录名 / conf 文件名全部依赖 pipeline 的 `name` 别名，
  转路径只 tolower（config_util.cc:26-30）。改别名要同步改三处，否则：`next_stage_` 失配 → stage 切不过去（表现为卡在原 stage）；
  conf 路径失配 → **只 AWARN 后静默用 default_conf**（§3.3）。
- 与 planner/scenario 层的差别：scenario **注册**写错是 `ACHECK` 崩（[03](03_planners_public_road.md) §5），
  **stage/task 的实例 conf** 写错是 AWARN 静默降级 —— 两种失败模式不要互相套用。

## 6. 验证命令

```bash
# Stage 基类与结果类型（只在 include 树；src 侧只有两个 proto 目录）
ls /opt/apollo/neo/include/modules/planning/planning_interface_base/scenario_base/
ls /opt/apollo/neo/src/modules/planning/planning_interface_base/

# 43 个 Stage 的注册全景（1 library 多 class）
grep -R -c 'base_class="apollo::planning::Stage"' /opt/apollo/neo/share/modules/planning/scenarios/*/plugins.xml
cat /opt/apollo/neo/share/modules/planning/scenarios/pull_over/plugins.xml

# 生效 pipeline 与实例 conf（认清 profile 层）
ls -l /apollo/modules/planning/scenarios/pull_over/conf/
readlink -f /apollo/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt
diff /opt/apollo/neo/share/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt \
     /apollo/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt
ls /apollo/modules/planning/scenarios/*/conf/*/                 # stage 级子目录 = stage 别名小写

# 跑起来看 stage 切换（关键字来自源码字符串，已核）
mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag
#   stage 进入:    "stage: Approach" / "stage: Creep"        (stage_approach.cc:42 / stage_creep.cc:57)
#   task 报错:     "<StageName> planning error"              (stage_approach.cc:51 等)
#   实例 conf 失配: "can not load user defined config file[" (config_util.h LoadMergedConfig)
```

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线：Apollo 11.0.0 package 工作区，`profiles/current` → `ARCF_40P`。
- **read 工具逐行核对过的文件**（本文所有 `文件:行号` 只来自这些）：
  `include/.../scenario_base/{stage.h（1-99）, process_result.h（1-159）, scenario.h（1-127）}`、
  `src/.../scenarios/pull_over/{stage_approach.h（1-44）, stage_approach.cc（1-149）, conf/pipeline.pb.txt（1-119，出厂）}`、
  `src/.../scenarios/bare_intersection_unprotected/stage_approach.cc`（30-139）、
  `src/.../scenarios/stop_sign_unprotected/stage_creep.cc`（1-161）、
  `profiles/ARCF_40P/.../scenarios/pull_over/conf/pipeline.pb.txt`（1-127，生效）、
  `src/.../planning_base/common/util/config_util.cc`（25-43）。
- **cat/ls/diff/grep 证据（未 read，故不引行号）**：`scenario_pipeline.proto`、`task.h`、`config_util.h`、
  `base_stage_creep.h` 全文；pull_over 的 plugins.xml 全文；19 个 share 侧 scenario plugins.xml 的 Stage class 计数（43）；
  ④ `/apollo/modules/planning/scenarios/` 19 个目录 `ls -l`+`readlink -f`；profile 树 scenarios 19 个目录；
  出厂↔profile pipeline diff；park_and_go / pull_over 的 conf stage 子目录清单；
  `grep -R "enabled: false"` 生效 pipeline（仅 pull_over 一处）。
- **遗留待核项**：① `Stage::Init` 如何遍历 `pipeline_config_.task()` 造 `task_list_`、`fallback_task_` 在哪被调用、
  三个 `ExecuteTask*` 的内部差异 —— 实现全在 `.so`，本机无源码；
  ② `Scenario::Process` 如何用 `next_stage_` 查 `stage_pipeline_map_`、是否跳过 `enabled:false` 的 stage、
  `FinishScenario` 是否置 `STATUS_DONE` —— 同上，均为推断；③ `BaseStageCruise` 内容未看；
  ④ `Task::Init` 拼 `config_path_`/`default_config_path_` 的确切代码未见（路径规则由目录事实 + tolower 反推）；
  ⑤ `ReferenceLineInfo::LimitCruiseSpeed` 实现与限速优先级（与 traffic_rule speed limit 的叠加关系）未核；
  ⑥ 43 个 stage 只 read 了 3 个，open_space 类 stage（`ExecuteTaskOnOpenSpace` 路径）未 read；⑦ 未实跑 planning 验证日志关键字。
