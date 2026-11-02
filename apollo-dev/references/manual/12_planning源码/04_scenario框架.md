# 04 scenario 框架（Scenario / Stage / ScenarioManager）

<!--
file: references/manual/12_planning源码/04_scenario框架.md
scope: 11.0（默认）
tags: Scenario, ScenarioContext, ScenarioManager, IsTransferable, Enter, Exit, Process, ScenarioStatusType, StageStatusType, ScenarioResult, StagePipeline, ScenarioPipeline, pipeline.pb.txt, scenario_conf.pb.txt, LoadConfig, GetContextAs, plugins.xml, planning_scenario模板, first-match, LANE_FOLLOW
sources:
- /opt/apollo/neo/include/modules/planning/planning_interface_base/scenario_base/scenario.h（全 127 行，**src 树无此文件**）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/scenario_base/process_result.h（全 159 行）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/scenario_base/stage.h（全 99 行）
- /opt/apollo/neo/src/modules/planning/planners/public_road/scenario_manager.cc（全 87 行）
- /opt/apollo/neo/src/modules/planning/scenarios/pull_over/pull_over_scenario.h（全 62 行）
- /opt/apollo/neo/src/modules/planning/scenarios/pull_over/pull_over_scenario.cc（全 181 行）
- /opt/apollo/neo/src/modules/planning/scenarios/pull_over/context.h（全 33 行）
- /opt/apollo/neo/src/modules/planning/scenarios/lane_follow/lane_follow_scenario.cc（全 44 行）
- 以下用 cat/ls/readlink/strings/grep 核对但未 read（不引行号）：pull_over 的 conf/{pipeline,scenario_conf}.pb.txt、conf 三个 stage 子目录、plugins.xml、BUILD；scenario_base/proto/scenario_pipeline.proto；emergency_stop_scenario.cc；buildtool template_planning_scenario/*；lib/.../libapollo_planning_planning_interface_base.so 的 strings
-->

## 0. 一句话作用

scenario 层是 planning 的**有限状态机层**：`PublicRoadPlanner::Plan` 每帧先让 `ScenarioManager::Update` 从 conf 顺序里选出一个 scenario（[03 篇](03_planners_public_road.md) §2.3），再由该 scenario 按 `pipeline.pb.txt` 声明的 stage 序列执行，stage 再串起 task 链。链路：Planner →（本篇）**Scenario → Stage** → Task（task 层见 05 篇）。

## 1. 关键符号与文件

| 符号/类/概念 | 文件（绝对路径，注明层） | 行号(已核) | 说明 |
|---|---|---|---|
| `Scenario`（顶层基类） | /opt/apollo/neo/include/.../scenario_base/scenario.h（**②′ 仅 include 树**；src 侧 `scenario_base/` 只有 `proto/`，**基类 .cc 两棵树都不存在**） | 52 | 纯虚只有 `GetContext()`(64)；虚 `Init`(58-59) / `IsTransferable`(70-73，**默认 return false**) / `Process`(75-76) / `Exit`(78) / `Enter`(80) |
| `Scenario` 非虚成员函数 | 同上 | 88/90-98/103 | `CreateStage(const StagePipeline&)`(88)、`GetStatus()`(90-92)、`GetStage()`(94)、`GetMsg()`(96)、`Name()`(98)、`Reset()`(103) |
| `Scenario::LoadConfig<T>` | 同上 | 106-107, 121-124 | 模板，`return apollo::cyber::common::LoadConfig<T>(config_path_, config)` —— **只认 `config_path_`**，派生类自己声明 T |
| 保护成员 | 同上 | 109-118 | `scenario_result_`、`current_stage_`、`stage_pipeline_map_`（stage 别名→`StagePipeline*`）、`msg_`、`injector_`、`config_path_`、`config_dir_`、`name_`、`scenario_pipeline_config_` |
| `struct ScenarioContext` | 同上 | 44-47 | **空结构体**，纯作各 scenario 自定义 context 的基类 |
| `ScenarioStatusType` | .../scenario_base/process_result.h | 41-45 | `STATUS_UNKNOWN=0` / `STATUS_PROCESSING=1` / `STATUS_DONE=2` |
| `StageStatusType` | 同上 | 34-39 | `ERROR=1` / `READY=2` / `RUNNING=3` / `FINISHED=4` |
| `StageResult` | 同上 | 52-99 | 持 `common::Status task_status_` + `StageStatusType stage_status_`；`HasError()`(93)、`IsTaskError()`(94) |
| `ScenarioResult` | 同上 | 106-156 | 持 `ScenarioStatusType scenario_status_` + `StageResult stage_result_`；`SetStageResult`(135,143-144)、`SetScenarioStatus`(150-151) |
| `Stage`（顶层基类） | .../scenario_base/stage.h（同为 ②′ 仅 include） | 46 | 虚 `Init(config, injector, config_dir, void* context)`(50-52)；**纯虚 `Process()`**(61-62)；`GetContextAs<T>()`(66-69) 把 `void* context_` 强转 |
| `Stage` 执行辅助 | 同上 | 74-85 | `ExecuteTaskOnReferenceLine`(74-75)、`...ForOnlineLearning`(77-78)、`ExecuteTaskOnOpenSpace`(80)、`FinishScenario()`(82)、`RecordDebugInfo`(84-85)；成员 `task_list_`/`fallback_task_`/`next_stage_`/`context_`/`pipeline_config_`(87-92) |
| `ScenarioPipeline` / `StagePipeline` | /opt/apollo/neo/src/.../scenario_base/proto/scenario_pipeline.proto（② src 只有 proto） | 未 read（cat 核对） | `StagePipeline{name, type, enabled, repeated PluginDeclareInfo task, optional PluginDeclareInfo fallback_task}`；`ScenarioPipeline{repeated StagePipeline stage}` |
| `ScenarioManager::Update` | /opt/apollo/neo/src/.../planners/public_road/scenario_manager.cc | 56-76 | first-match 铁证，见 §2.2 |
| 样板 scenario | /opt/apollo/neo/src/.../scenarios/pull_over/pull_over_scenario.{h,cc} | h:36-59 / cc:34-178 | §2.4 |
| 兜底 scenario | /opt/apollo/neo/src/.../scenarios/lane_follow/lane_follow_scenario.cc | 29-41 | `IsTransferable` 实现，见 §5 第 1 条 |

> ⚠️ **`Scenario`/`Stage` 基类的 .cc 在本机不可读**：`find` 两棵树无 `scenario_base/*.cc`（src 侧仅 `proto/`），实现只以二进制形式存在于 `/opt/apollo/neo/lib/modules/planning/planning_interface_base/libapollo_planning_planning_interface_base.so`。故 `Scenario::Init` / `Process` / `CreateStage` / `Reset` / `GetStage` 的**函数体行号无法给出**，本篇对它们的描述来自：头文件签名 + 该 .so 的 strings（含 `conf/pipeline.pb.txt`、`conf/scenario_conf.pb.txt`、`conf/default_conf.pb.txt` 三个字面量）+ 派生类调用方式。**凡涉及基类函数体内部逻辑的断言均标「待核（无源码）」。**

## 2. 机制与数据流

### 2.1 一帧的调用链

```
OnLanePlanning::Plan                      （02 篇 §2.4）
└─ PublicRoadPlanner::Plan                （03 篇 §2.3，cc:37-66）
   ├─ ScenarioManager::Update(ego_point, frame)     选场景（下 §2.2）
   └─ Scenario::Process(planning_init_point, frame) → ScenarioResult
      └─ current_stage_->Process(...)      → StageResult（stage.h:61-62 纯虚）
         └─ Stage::ExecuteTaskOnReferenceLine / ...OnOpenSpace 跑 task_list_（stage.h:74-80）
```

返回值收敛：`StageResult`(process_result.h:52) 被塞进 `ScenarioResult`(106) → `Scenario::GetStatus()` 取的就是 `scenario_result_.GetScenarioStatus()`（scenario.h:90-92）→ 决定 `ScenarioManager::Update` 下一帧是否放行换场景。

### 2.2 选场景：first-match（`scenario_manager.cc:56-76`，已核）

1. **占先**：遍历 `scenario_list_` 时若遇到「就是当前场景」且 `GetStatus() == STATUS_PROCESSING`，**立即 return**，本帧不换（源码注释 cc:63 `// The previous scenario has higher priority`）。
2. **首个为真者胜**：按 `scenario_list_` 顺序（= conf 书写顺序）调 `scenario->IsTransferable(current_scenario_.get(), *frame)`；第一个 true 就走生命周期切换并 **return**（cc:66-74），后面的场景本帧不再被询问。**无任何 cost/score 字段**。
3. 一轮全 false → 保持 `current_scenario_` 不变（`ScenarioManager::Reset` 才回落 `default_scenario_type_`，cc:78-85；default = conf 里 name 恰为 `"LANE_FOLLOW"` 的那条，cc:46-48）。

### 2.3 场景生命周期（Exit→切换→Reset→Enter，顺序已核）

| 时机 | 调用 | 位置 | 备注 |
|---|---|---|---|
| 加载 | `Scenario::Init(injector, name)`，外层 `ACHECK` | scenario_manager.cc:43-44 | 失败 = 进程 CHECK 崩，非降级 |
| 切出旧场景 | `current_scenario_->Exit(frame)` | cc:67 | 在赋新值**之前**调，即 Exit 属于旧场景 |
| 换指针 | `current_scenario_ = scenario` | cc:70 | 日志 `switch scenario from X to Y`(cc:68-69) |
| 清状态 | `current_scenario_->Reset()` | cc:71 | `Scenario::Reset()` 声明在 scenario.h:103，函数体无源码（待核；语义为「进入前重置」，见头注释 100-102） |
| 切入新场景 | `current_scenario_->Enter(frame)` | cc:72 | 基类默认 `return true`（scenario.h:80） |
| 每帧执行 | `Scenario::Process` | scenario.h:75-76 | 基类实现无源码（待核）；职责按头注释 82-87 = 按 conf 顺序跑 stage，用 `Stage::Process` 返回值决定 stage 迁移 |

**stage 迁移的实际载体是 `Stage::next_stage_`**（stage.h:71 `NextStage()`、89 成员；stage.h:56-60 注释明说「stage 想切换就设 `next_stage_`」）；基类用 `stage_pipeline_map_`（scenario.h:111，别名→`StagePipeline*`）把 `next_stage_` 名字换成新 stage，经 `CreateStage(const StagePipeline&)`（scenario.h:88）实例化。**这条查表-实例化的具体代码无源码可引，标待核。**

### 2.4 样板：`PullOverScenario`（pull_over_scenario.h/.cc 全文已核）

- 声明（h:36-56）：`class PullOverScenario : public Scenario`，override 四个函数 `Init`(38-39) / `GetContext`(44，**返回派生 `PullOverContext*`，协变返回**) / `IsTransferable`(46-47) / `Exit`(49) / `Enter`(51)；私有 `bool init_ = false;` + `PullOverContext context_;`(54-55)。**没有 override `Process`** → 直接用基类的 stage 驱动。
- 注册宏（h:58-59）：`CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::PullOverScenario, Scenario)` —— **写在 .h**，第一参全限定名，第二参基类**非限定短名**。
- `Init`（cc:34-53）三段式，抄这个就对：`init_` 幂等短路 → `Scenario::Init(injector, name)` 失败 AERROR return false → `Scenario::LoadConfig<ScenarioPullOverConfig>(&context_.scenario_config)` 失败 AERROR return false → `init_ = true`。
- `IsTransferable`（cc:55-164）判据形态 = **一串早退 false + 一个 bool 累积**：命令类型（`frame.local_view().planning_command->has_lane_follow_command()`, cc:57）→ `other_scenario == nullptr` / `reference_line_info().empty()`（cc:60）→ gflag 开关 `FLAGS_enable_pull_over_at_destination`（cc:63）→ 终点存在性（cc:66-69）→ 终点投影在车道上（cc:73-76）→ 距离窗口用 **scenario_config 的字段**（cc:84-89 `pull_over_min_distance_buffer()` / `start_pull_over_scenario_distance()`）→ 太近排除（cc:92-95）→ 路口/信号/停车让行 overlap 8m 内排除（cc:98-117）→ 沿路必须最右车道（cc:120-162）→ `return pull_over_scenario`。
- `Enter`/`Exit`（cc:166-178）改的是**跨帧共享状态** `injector_->planning_context()->mutable_planning_status()`：Enter 置 `pull_over_type = PULL_OVER` + `plan_pull_over_path = true`，Exit `clear_pull_over()`。
- 另一形态：`EmergencyStopScenario`（cc，grep 核对未 read）**override 了 `Process`**（:60）但末尾仍 `return Scenario::Process(planning_init_point, frame);`（:69）—— 需要「每帧前置副作用」时用这个模式。

### 2.5 ScenarioContext：scenario 与其 stage 之间唯一的共享内存

- `struct ScenarioContext`（scenario.h:44-47）空基类；每个 scenario 在 `context.h` 里派生，如 `struct PullOverContext : public ScenarioContext { ScenarioPullOverConfig scenario_config; }`（context.h:28-30）。
- 传递：`Scenario::GetContext()`（纯虚，scenario.h:64）返回的指针以 `void* context` 形参进 `Stage::Init`（stage.h:50-52），stage 侧用 `GetContextAs<PullOverContext>()`（stage.h:66-69）**强转回来**——`static_cast<T*>`，**没有任何类型检查**，写错类型是 UB。
- 所以 scenario 的 conf（`scenario_conf.pb.txt`）通常存在 context 里给 stage 读；stage 自己无 scenario 级 conf。

## 3. 注册与配置

### 3.1 插件注册（三处必须对齐）

| 处 | 内容 | 证据 |
|---|---|---|
| .h 尾 | `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::XxxScenario, Scenario)` | pull_over_scenario.h:58-59（已核） |
| plugins.xml | `<library path="modules/planning/scenarios/pull_over/libpull_over_scenario.so">` 内 1 条 `base_class="apollo::planning::Scenario"` + **每个 stage 一条 `base_class="apollo::planning::Stage"`** | pull_over/plugins.xml（cat 核对） |
| BUILD | `apollo_plugin(name="libpull_over_scenario.so", srcs=[scenario.cc + 各 stage.cc + util.cc], description=":plugins.xml")` + `filegroup(name="runtime_files", srcs=glob(["conf/**"]))` | pull_over/BUILD（cat 核对） |

属性名只有 `path`/`type`/`base_class`（无 `class_type`）；`base_class` 必须是**最顶层基类** `Scenario` / `Stage`，中间基类（`BaseStageCreep`、`BaseStageTrafficLightCreep` 等，见 include 树 `scenario_base/base_stage_*.h`、`traffic_light_base/`）对 PluginManager 不可见。

### 3.2 conf 三层与路径规则

| 层级 | 文件 | 谁读 | 命名规则 |
|---|---|---|---|
| scenario 级 | `<sc>/conf/scenario_conf.pb.txt` | `Scenario::LoadConfig<T>(config_path_)`（scenario.h:121-124） | 固定名（.so strings 命中 `conf/scenario_conf.pb.txt`） |
| stage 编排 | `<sc>/conf/pipeline.pb.txt` | 基类填 `scenario_pipeline_config_`（scenario.h:118） | 固定名（strings 命中 `conf/pipeline.pb.txt`） |
| task 实例级 | `<sc>/conf/<stage.name 小写>/<task.name 小写>.pb.txt` | task 层 | `ConfigUtil::TransformToPathName` **只做 tolower，不做驼峰转下划线**（config_util.cc:26-30，行号引自 [03 篇](03_planners_public_road.md) §5 已核结论） |

pull_over 实测吻合（ls 核对）：pipeline 里 stage 别名 `PULL_OVER_APPROACH` → 目录 `conf/pull_over_approach/`；该 stage 的 task 别名 `PULL_OVER_PATH` → 文件 `pull_over_path.pb.txt`。**注意用的是 pipeline 里的 `name` 别名，不是 `type` 类名。**

`pipeline.pb.txt` 字段（scenario_pipeline.proto，cat 核对）：`stage{ name, type, enabled, task{name,type}... , fallback_task }`。`enabled: false` 的 stage 被跳过（proto 注释原文 "If the stage is disabled, it will be skipped"）——pull_over 的 `PULL_OVER_RETRY_APPROACH_PARKING` 出厂即 `enabled: false`。

### 3.3 生效档在 profile 覆盖层（本机 readlink 已核）

```
/apollo/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt
  -> /apollo_workspace/profiles/current/... -> profiles/ARCF_40P/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt
```

`scenario_conf.pb.txt` 同理；三个 stage 子目录（`pull_over_approach/` 等）在 ④ 视口下是**真目录**，里面的 `*.pb.txt` 才是软链。`profiles/current` → `ARCF_40P`（readlink 已核），profile 树下 `modules/planning/` 有 `planning_component scenarios tasks traffic_rules` 四个包的 conf 覆盖。

场景注册表（`public_road_planner_config.pb.txt`，本机 profile 版 13 条、顺序即优先级）见 [03 篇](03_planners_public_road.md) §3.2，本篇不重复。

## 4. 修改与扩展点（二次开发）

**新增一个 scenario（推荐走模板，别手写六件套）**

```bash
buildtool install planning                     # ① 工作区已含 scenarios/（inventory 已核）
buildtool create --template planning_scenario \
  --name my_scenario --class_name MyScenario \
  modules/planning/scenarios/my_scenario       # 相对工作区的包路径
```

模板产物（`ls /opt/apollo/neo/packages/buildtool/9.0.0-rc1-r19/data/templates/template_planning_scenario/` 已核）：`scenario.h.in` `scenario.cc.in` `stage.h.in` `stage.cc.in` `plugins.xml.in`（已带 `base_class="apollo::planning::Scenario"` 与每 stage 一条 `Stage`）、`BUILD.in`、`cyberfile.xml.in`、`proto/{BUILD,scenario.proto}.in`、`conf/{scenario_conf,pipeline}.pb.txt.in`（pipeline 模板生成 `stage{name:<大写下划线> type:<类名> enabled:true task{name:"" type:""}}`）。

然后按顺序填：

1. `proto/my_scenario.proto` 定义 `ScenarioMyScenarioConfig` 字段 → `conf/scenario_conf.pb.txt` 填值。
2. `context.h`（模板未生成，照 pull_over/context.h:28-30 手加）：`struct MyContext : public ScenarioContext { ScenarioMyScenarioConfig scenario_config; };`
3. `my_scenario.h`：override `Init`/`GetContext`/`IsTransferable`（+ 需要时 `Enter`/`Exit`/`Process`），确认尾部注册宏第二参是 `Scenario`。
4. `my_scenario.cc`：`Init` 抄 pull_over cc:34-53 三段式（幂等 → `Scenario::Init` → `LoadConfig<T>(&context_.scenario_config)`）；`IsTransferable` 抄 cc:55-164 的「早退 false + config 阈值」形态。
5. stage：override `Stage::Process`（stage.h:61-62 纯虚），内部调 `ExecuteTaskOnReferenceLine`（车道内）或 `ExecuteTaskOnOpenSpace`（泊车），要迁移就设 `next_stage_`，收尾 `FinishScenario()`（stage.h:82）。
6. `conf/pipeline.pb.txt` 填 stage 与 task 列表；每个 task 若要实例 conf，建目录 `conf/<stage name 小写>/<task name 小写>.pb.txt`。
7. `buildtool build -p modules/planning/scenarios/my_scenario`（**只 `bazel build` 运行时看不见**），验索引：`ls /opt/apollo/neo/share/cyber_plugin_index/ | grep my_scenario`。
8. **最后一步才是启用**：把 `scenario { name: "MY_SCENARIO" type: "MyScenario" }` 插进 ④ `/apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt`（软链写穿 profile 层），**位置必须在 `LANE_FOLLOW` 之前**（§5 第 1 条），重启 `mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag`。

**只改现有场景的行为**：改判据 → 对应 `<sc>_scenario.cc` 的 `IsTransferable` + `buildtool build -p modules/planning/scenarios/<sc>`；只调阈值 → 改 ④ `<sc>/conf/scenario_conf.pb.txt`（软链，重启即生效，不用重编）；改 stage/task 编排 → ④ `<sc>/conf/pipeline.pb.txt`；启用已装未注册的 scenario → 只改 planner conf（§5 末条清单）。

**改切换策略本身**（first-match → 带评分）：唯一改点 `scenario_manager.cc:56-76`，属 public_road 插件包（[03 篇](03_planners_public_road.md) §4.5）。

## 5. ⚠️ 本环境注意

- **「排在 `LANE_FOLLOW` 之后 = 基本不生效」已取代码证据**（03 篇的待核项在此结案）：`LaneFollowScenario::IsTransferable`（lane_follow_scenario.cc:29-41）在 `planning_command` 含 `lane_follow_command` 且 `reference_line_info()` 非空时**无条件 `return true`**（cc:37-40 两条分支都 return true）。配合 first-match（scenario_manager.cc:66-74）：**在 lane-follow 类命令下，conf 里排在 LANE_FOLLOW 之后的场景永远不会被询问**。严格说不是「任何情况下都不生效」——泊车等非 lane_follow_command 时 LANE_FOLLOW 在 cc:31-33 返回 false，后续场景仍会被遍历到。
- **planner conf 写错 type = 进程崩**：`ScenarioManager::Init` 用 `ACHECK(scenario->Init(...))`（scenario_manager.cc:43-44），且 `CreateInstance` 返回 nullptr 时 `scenario->Init` 直接空指针解引用。类名拼错、插件未装、plugins.xml `base_class` 写成中间基类 → planning 起不来而不是静默降级。对比：**stage/task 的实例 conf 找不到只是 AWARN + 用 default_conf**（.so strings 里的 `conf/default_conf.pb.txt` 即此机制，具体代码见 05 篇）。
- **scenario/stage 的基类实现在本机无源码可读**（src 侧 `planning_interface_base/scenario_base/` 只有 `proto/`，include 侧只有 .h）。要看 `Scenario::Process` 到底怎么驱动 stage，只能读 .so 或去上游仓库；本篇相关段落标了「待核（无源码）」，**不要把它当已核事实往下传**。
- **conf 生效档在 profile 覆盖层，不在 share**：改前先 `ls -l` + `readlink -f` 认落点（本机 pull_over 的两个 conf 都指向 `profiles/ARCF_40P/...`）。改 `/opt/apollo/neo/share/...` 下次 install 被覆盖；改 `/apollo_workspace/modules/...` 源码副本要 `buildtool build -p` 才生效。
- **`name` 别名不是纯显示**：scenario 的 `name` 决定 default 场景识别（必须恰为 `LANE_FOLLOW`，scenario_manager.cc:46）；stage/task 的 `name` 决定实例 conf 路径（tolower，§3.2）。改别名会静默失配。
- **`GetContextAs<T>()` 无类型检查**（stage.h:66-69 裸 `static_cast`）：stage 与 scenario 的 context 类型对不上不报错，直接读到垃圾数据。
- **19 装 / 13 注册，差集 6 个**（`ls /opt/apollo/neo/lib/modules/planning/scenarios/` = 19，已核；注册表 13 条见 03 篇 §3.2）：`lane_escape`、`lane_follow_park`、`large_curvature`、`precise_parking`、`square`（在 conf 里被 `#` 注释）、`valet_parking`（被 profile 换成 `valet_parking_park`）。**这 6 个只要按 §4 第 8 步加进 planner conf 即可启用，无需重编。**
- 搜 `/apollo/...` 一律 `grep -R`（`-r` 不跟随符号链接会假空）；插件索引只在 `/opt/apollo/neo/share/cyber_plugin_index/`，不扫 `bazel-bin`。

## 6. 验证命令

```bash
# 基类只有头文件（确认无 .cc）
ls /opt/apollo/neo/src/modules/planning/planning_interface_base/scenario_base/     # 只有 proto/
ls /opt/apollo/neo/include/modules/planning/planning_interface_base/scenario_base/ # scenario.h stage.h process_result.h ...
strings /opt/apollo/neo/lib/modules/planning/planning_interface_base/libapollo_planning_planning_interface_base.so | grep 'conf/'

# 某 scenario 的 conf 落点（判 profile 覆盖层 vs share）
ls -l /apollo/modules/planning/scenarios/pull_over/conf/
readlink -f /apollo/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt

# 装了哪些 scenario / stage 注册项
ls /opt/apollo/neo/lib/modules/planning/scenarios/                       # 19
cat /opt/apollo/neo/src/modules/planning/scenarios/pull_over/plugins.xml # 1 scenario + 3 stage

# 新增 scenario 的模板与产物
ls /opt/apollo/neo/packages/buildtool/9.0.0-rc1-r19/data/templates/template_planning_scenario/
buildtool create --template planning_scenario --name my_scenario --class_name MyScenario modules/planning/scenarios/my_scenario
buildtool build -p modules/planning/scenarios/my_scenario
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep my_scenario

# 运行期看场景切换（日志字符串来自 scenario_manager.cc，已核）
mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag
#   "Load scenario list:"           (cc:50)
#   "switch scenario from X to Y"   (cc:68-69)
#   "Reset to default scenario:"    (cc:82)
```

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线：Apollo 11.0.0 package 工作区，profile `current → ARCF_40P`。
- **read 逐行核对过的文件**（本文所有 `文件:行号` 只来自这些）：`include/.../scenario_base/scenario.h`(1-127)、`process_result.h`(1-159)、`stage.h`(1-99)、`src/.../planners/public_road/scenario_manager.cc`(1-87)、`src/.../scenarios/pull_over/pull_over_scenario.h`(1-62)、`pull_over_scenario.cc`(1-181)、`context.h`(1-33)、`src/.../scenarios/lane_follow/lane_follow_scenario.cc`(1-44)。
- **cat/ls/readlink/strings/grep 证据（未 read，不引行号）**：pull_over 的 `conf/pipeline.pb.txt`、`conf/scenario_conf.pb.txt`、三个 stage conf 子目录、`plugins.xml`、`BUILD`；`scenario_base/proto/scenario_pipeline.proto`；`emergency_stop_scenario.cc`（grep 到 Process override 在 :60、:69）；`lane_follow/` 目录清单（无 `scenario_conf.pb.txt`）；`libapollo_planning_planning_interface_base.so` strings；④ 视口 `ls -l` + `readlink -f`；`profiles/current` 指向与其下 planning 覆盖树；buildtool `template_planning_scenario/` 文件清单 + `plugins.xml.in`/`pipeline.pb.txt.in` 内容；`ls /opt/apollo/neo/lib/modules/planning/scenarios/`(19)。
- **跨引用（不重复核对）**：[03_planners_public_road.md](03_planners_public_road.md) —— `PublicRoadPlanner::Plan` cc:37-66、13 条注册表与出厂 12 条差异、`ConfigUtil::TransformToPathName` config_util.cc:26-30、`GetFullPlanningClassName` :32-40；[02_planning_component主循环.md](02_planning_component主循环.md) —— planner 加载与 `FLAGS_planner_config_path`；`.manual_work/inventory/planning_inventory.md` —— 19 scenario / 43 stage 全表、`planning_interface_base` 仅 include。
- **遗留待核项**：① `Scenario::Init/Process/CreateStage/Reset/GetStage` 与 `Stage::Init/ExecuteTaskOn*/FinishScenario` 的**函数体在本机无源码**（仅 .so），stage 迁移查表、`config_path_`/`config_dir_` 如何被拼出、`default_conf.pb.txt` 兜底时机均未取代码证据；② `Stage::Init` 的 `void* context` 与 `enabled:false` 跳过逻辑未见实现；③ `fallback_task` 触发条件未核（05 篇）；④ 未实跑 planning 观察 `switch scenario` 日志（无地图/无 planning_command，见 CLAUDE.md 五节数据资产）；⑤ 只精读了 pull_over 与 lane_follow 两个 scenario，`traffic_light_unprotected_left_turn` 等基于 `BaseStageCreep`/`traffic_light_base` 的形态未展开；⑥ profile 版 pull_over conf 与出厂版是否有内容差异未 diff。
