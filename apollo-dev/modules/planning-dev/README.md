# Apollo Planning 开发手册

> **⚠️ 本环境（包工作区）适配**：本环境是独立包管理工作区 `/apollo_workspace`，根下没有 `modules/`、`apollo.sh`。
> 本文 `modules/planning/...` 路径：**只读** → 拼 `/opt/apollo/neo/src/`；**要改** → 先
> `buildtool install planning`，源码落到 `/apollo_workspace/modules/planning/planning_component/`
> （保留完整仓库相对路径，不用换算）。编译用
> `buildtool build -p modules/planning/planning_component`，**不能只 `bazel build`**（不做 install，运行时看不见）。
> **调 gflags / 改 pipeline 与 scenario 顺序试效果**：走 `/apollo/modules/planning/planning_component/conf/*`
> （每个文件都是指向 `/opt/apollo/neo/share/...` 的符号链接，改了立即生效）；改工作区源码副本的 conf 要重编才生效。
> task/scenario/traffic_rule 都是插件，加载与索引路径差异见 `modules/plugin-dev/` 开头适配段。
> 新建 task / scenario / traffic_rule 可用模板：`buildtool create --template {planning_task,planning_scenario,planning_traffic_rule} <package_path>`。
> 完整对照见仓库根 `CLAUDE.md`。

速查表（35 task / 19 scenario / 10 traffic_rule / **1 planner**、Frame 与 ReferenceLineInfo 成员清单、lane_follow 11-task 逐条数据流、openspace 5-task 流水线与坐标系契约、高危坑清单）见 `reference.md`。

## 0. 目录地图（`modules/planning/` 下 10 个子目录，现场核对）

| 子目录 | 放什么 |
|---|---|
| `planning_component/` | 入口 `planning_component.cc` / `on_lane_planning.cc` + **全局生效的 `conf/`**（11 文件）+ `dag/` `launch/` `integration_tests/` |
| `planning_base/` | `common/`（Frame、ReferenceLineInfo、Obstacle、PathData、util）、`gflags/`、`math/`、`reference_line/`、`proto/`、`tools/` |
| `planning_interface_base/` | 五类插件基类：`task_base/` `scenario_base/` `traffic_rules_base/` `planner_base/` |
| `tasks/` `scenarios/` `traffic_rules/` `planners/` | **35 / 19 / 10 / 1** 个插件（本环境现场 `ls /opt/apollo/neo/lib/modules/planning/*/` 逐个数），一目录一插件；`planners/public_road` 内含 `scenario_manager`。**planners 只剩 `public_road` 一个**，`lattice` / `navi` / `rtk` 三个 planner 在本环境 lib、src、include、`/apollo/modules/planning/planners/` 四处**都不存在** |
| `planning_open_space/` | `coarse_trajectory_generator/`（Hybrid A*）、`trajectory_smoother/`、`utils/` |
| `pnc_map/` `park_data_center/` | `LaneFollowMap`（routing→RouteSegments）；nudge 链路的跨 task 单例 |

## 1. 新增一个 Task

模板 `tasks/path_decider/`（现场核对 9 文件）：`.h` `.cc` `BUILD` `plugins.xml` `cyberfile.xml` `README_cn.md` `conf/default_conf.pb.txt` `proto/<n>.proto` `proto/BUILD`。

**① 选基类**（均在 `planning_interface_base/task_base/`）：

| 产物 | 基类 | override |
|---|---|---|
| Obstacle 决策 / 灌 StGraphData（参考线链路） | `common/decider.h:32` `Decider` | `Process(Frame*, ReferenceLineInfo*)` |
| 同上但 open space 链路 | `Decider` | `Process(Frame*)` **单参** |
| 产出 `path_data` | `common/path_generation.h` `PathGeneration` | `Process(Frame*, ReferenceLineInfo*)` |
| 产出 `speed_data` | `common/speed_optimizer.h:38` `SpeedOptimizer` | `Process(const PathData&, const TrajectoryPoint&, SpeedData*)` 纯虚 |
| open space 全链路 / 兜底速度 | `common/trajectory_optimizer.h:41` / `trajectory_fallback_task.h:40-41` | `Process()` 纯虚 / `GenerateFallbackSpeed` 纯虚（同文件 `:37` 的 `GenerateFallbackPath` **不是**纯虚，覆写它签名写错同样静默空跑） |
| 都不合适 | `task.h` `Task` | 自己 override `Execute` |

**致命陷阱**：`Decider` 两个 `Process` 都有默认实现 `return Status::OK()`（`decider.h:42-49`），`PathGeneration` 同理 ⇒ **签名写错则静默空跑且返回成功，编译期零提示**。

**② 建目录与上述 8 个文件（`README_cn.md` 可选）。**

**③ `proto/<n>.proto`**：`syntax="proto2"; package apollo.planning;` + `message MyNewDeciderConfig`。**每个字段必须写 `[default=]`** —— 覆盖文件缺失只 AWARN，无 default 的 optional 静默拿 0/false。

**④ `proto/BUILD`**：`proto_library(name="my_new_decider_proto")`，target 名**必须以 `proto` 结尾**（`tools/proto/proto.bzl:120-121`）；上层引用写 `:my_new_decider_cc_proto`（自动派生，BUILD 里看不到）。

**⑤ `.h`**：override `Init(config_dir, name, injector)` + private `Process`，末尾在 namespace 内加 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::MyNewDecider, Task)` —— **第二参恒为 `Task` 不是中间基类**（`stage.cc:61-63` 按 `CreateInstance<Task>` 查）。

**⑥ `.cc`**：`Init` 固定两句 `if (!Decider::Init(config_dir, name, injector)) return false;` + `return Decider::LoadConfig<MyNewDeciderConfig>(&config_);`。返回非 OK 会 **break 掉该参考线上后续所有 task 并触发 fallback task**（`stage.cc:135-145`）。

**⑦ `plugins.xml`**（照抄 `tasks/path_decider/plugins.xml`）：`<library path="modules/planning/tasks/my_new_decider/libmy_new_decider.so">` 内 `<class type="apollo::planning::MyNewDecider" base_class="apollo::planning::Task">`。`path` 与 BUILD 的 `apollo_plugin(name=)`、`type` 与 pipeline 的 `type` 都必须逐字一致。

**⑧ `BUILD`**：`filegroup(name="runtime_files", srcs=glob(["conf/**"]))` + `apollo_plugin(name="libmy_new_decider.so", description=":plugins.xml", copts=["-DMODULE_NAME=\\\"planning\\\""], deps=[".../planning_interface_base:apollo_planning_planning_interface_base", ".../proto:my_new_decider_cc_proto"])` + `apollo_package(enable_source=False)` + `cpplint()`。单测 deps 必须写 `:my_new_decider_lib`（`apollo_plugin` 自动派生，`tools/apollo_package.bzl:654`）。

**⑨ `cyberfile.xml`**：`<name>planning-task-my-new-decider</name>`（**连字符命名，目录是下划线**）+ `<src_path>` + `<depend type="binary" repo_name="planning-interface-base">`。

**⑩ `conf/default_conf.pb.txt`**：文件名不能改（`task.cc:52-54` 硬编码 `"conf/default_conf.pb.txt"`）。

**⑪ 挂进某个 stage 的 pipeline**：编辑 `scenarios/<sc>/conf/pipeline.pb.txt`，在目标 stage 的 `task{}` 列表按**期望执行顺序**插入 `task { name: "MY_NEW_DECIDER" type: "MyNewDecider" }`（name 全大写下划线）。顺序即执行顺序（`stage.cc:58-74` 按下标 push，`:121` 每帧顺序遍历），**插入位置由第 4 节数据流决定**。task 级**没有 enabled 开关**，禁用只能整块注释（现场核对：`scenarios/lane_follow/conf/pipeline.pb.txt` 尾部 `PIECEWISE_JERK_SPEED_NONLINEAR` 就是注释状态）。

**⑫ 实例级 conf 文件的命名规则（最易错）**：`scenarios/<sc>/conf/<tolower(stage.name)>/<tolower(task.name)>.pb.txt`。`ConfigUtil::TransformToPathName` **只做 tolower，不做驼峰转下划线**（现场核对 `planning_base/common/util/config_util.cc:26-30`）⇒ 文件名是 **pipeline 里 `name` 别名的小写，不是类名**。现场核对实例：`scenarios/pull_over/conf/pull_over_approach/pull_over_path.pb.txt`（stage name `PULL_OVER_APPROACH` + task name `PULL_OVER_PATH`）。**写错名字不报错，只 AWARN 并静默用 default_conf。** 同一 `type` 可挂两个不同 `name` 吃两份配置 —— `SPEED_BOUNDS_PRIORI_DECIDER` / `SPEED_BOUNDS_FINAL_DECIDER` 共用 `type: "SpeedBoundsDecider"` 就是这么做的。

**⑬ 编译验证**：本环境用 `buildtool build -p modules/planning/tasks/my_new_decider`（**光 `bazel build` 不会 install，运行时看不见**，详见第七节）；起 planning 后 grep 日志三件事 —— 无 `"Create task ... failed!"`（type 拼错，`stage.cc:64-67`）、无 `"can not load user defined config"`（⑫ 名字错）、有 `"Planning Perf: task name [MY_NEW_DECIDER]"`（`stage.cc:132`，证明真被调用）。

**只改现有 task 的最小集合**：加配置项 → `proto/*.proto` + `conf/default_conf.pb.txt` + `.cc` 使用点；改执行顺序 / 增删 task → 只改 `pipeline.pb.txt`；场景级调参 → 只加 `<stage>/<task>.pb.txt`；改共享算法 → `task_base/common/path_util/`（**改一处影响所有 path task**）。

## 2. 新增一个 Scenario + Stage

模板 `scenarios/stop_sign_unprotected/`（现场核对 23 文件：`context.h`、4 组 `stage_*.{h,cc}`、`conf/pipeline.pb.txt`、`conf/scenario_conf.pb.txt`、`plugins.xml`、`proto/`、`cyberfile.xml`）。

1. `proto/<n>.proto` + `proto/BUILD`；`context.h` 定义 `struct MyContext : public ScenarioContext`。**跨 stage 状态必须放 context** —— 切 stage 会 `CreateStage` 重新 new，stage 成员全部清零（`scenario.cc:130`）。
2. `<n>_scenario.{h,cc}` 继承 `Scenario`：**必须实现纯虚 `GetContext()`**（`scenario.h:64`）；**必须 override `IsTransferable(other, frame)`**（`scenario.h:70-73`，基类默认 `return false` 意味着永不进入）；override `Init` 时**先调 `Scenario::Init(...)`**，否则 `config_dir_` / pipeline 不会被设置。
3. `stage_xxx.{h,cc}` 继承 `Stage`（或 `scenario_base` 的 `BaseStageCreep` / `BaseStageCruise` / 两个 traffic_light 变体），**必须实现纯虚 `Process`**（`stage.h:61-62`），结束场景调 `FinishScenario()`（`stage.h:82`）。**必须 `result.SetStageStatus(...)`**，否则默认 `READY` → `STATUS_UNKNOWN` → `PublicRoadPlanner::Plan` 返回 PLANNING_ERROR（`public_road_planner.cc:60-63`），整帧规划失败。
4. `conf/pipeline.pb.txt` **必需，缺失启动直接 abort**（`ACHECK(scenario->Init(...))`，`scenario_manager.cc:43`），第一个 `stage{}` 是入口；只要 scenario 里调了 `LoadConfig` 就必须有 `conf/scenario_conf.pb.txt`（可以是空文件）。
5. `plugins.xml`：scenario 与**它的每个 stage 各一条 `<class>`**，`base_class` 分别 `apollo::planning::Scenario` / `apollo::planning::Stage`（**stage 即使继承 `BaseStageCreep` 也要写 `Stage`**）；注册宏第二参同理。`BUILD`（`apollo_plugin` 的 srcs 含所有 stage 的 .cc）+ `cyberfile.xml`（`planning-scenario-<my-name>`）。
6. **注册 —— 书写顺序即优先级（first-match，最关键的一步）**：编辑 `planning_component/conf/public_road_planner_config.pb.txt`（现场核对 48 行、12 个 `scenario {name, type}` 块，`EMERGENCY_PULL_OVER` 在 `:1-4` … `LANE_FOLLOW` 在 `:45-48`），插入 `scenario { name: "MY_FEATURE" type: "MyFeatureScenario" }`。

`ScenarioManager::Update`（`planners/public_road/scenario_manager.cc:56-76`）按该列表顺序遍历，四条规则：

- 没有任何 cost / score / priority 字段，**静态优先级 = pb.txt 的书写顺序**，调优先级只能改顺序。
- **first-match 不是 best-match**：首个 `IsTransferable` 返回 true 的场景胜出并立即 `return`（`:73`），后面的场景当帧不再被询问。
- "当前场景续期"的 early-return 在循环体内（`:60-65`），只在遍历指针走到当前场景自己那一格才生效 ⇒ **排在当前场景之前的场景即使当前场景正在 PROCESSING 也仍可抢占**，只有排在之后的会被屏蔽。这正是 `EMERGENCY_PULL_OVER` / `EMERGENCY_STOP` 放最前的原因。
- **必须插在 `LANE_FOLLOW` 之前**：`LaneFollowScenario::IsTransferable`（`scenarios/lane_follow/lane_follow_scenario.cc:29-41`）几乎无条件返回 true 且常驻 PROCESSING，排在它之后等于没注册。另注意 `default_scenario_type_` 由**硬编码字符串比较 `name == "LANE_FOLLOW"`** 决定（`:46-48`），删掉这条会段错误。

**给已有 scenario 加一个 Stage（5 处）**：新建 `stage_xxx.{h,cc}` + 注册宏 → `plugins.xml` 加一行 `<class>` → `BUILD` 的 `srcs`/`hdrs` 各加一项 → `conf/pipeline.pb.txt` 加一个 `stage{}` 块（想当入口就放最前）→ **改上游 stage 的 `FinishStage()`，把 `next_stage_` 设成新 stage 的 pipeline `name`（不是类名）**。坑：返回 `FINISHED` 但没改 `next_stage_` 会死循环留在原 stage（`stage.cc:47` 初始化 `next_stage_ = config.name()`，`scenario.cc:117-137` 在 next == 当前名字时既不换 stage 也不结束）。

## 3. 新增一条 TrafficRule

模板 `traffic_rules/crosswalk/`（现场核对 9 文件，与 task 同构）。

1. 建 `traffic_rules/<my_rule>/`，`MyRule : public TrafficRule`。**实现两个纯虚**：`ApplyRule(Frame* const, ReferenceLineInfo* const)` 与 `Reset()`（`planning_interface_base/traffic_rules_base/traffic_rule.h:46-49`）。
2. `Init(name, injector)`：先调 `TrafficRule::Init(...)` 再 `LoadConfig(&config_)`。**配置只有 `conf/default_conf.pb.txt` 一条路径，没有实例级覆盖**（与 task 不同，这是最大差异）。
3. 产出决策一律走 `util::BuildStopDecision(...)`，虚拟障碍物 id 用统一前缀常量（现有规则用 `"CW_"` / `"TL_"` / `"SS_"` / `"YS_"` / `"KC_"` / `"REF_END_"`）。
4. `plugins.xml` `base_class="apollo::planning::TrafficRule"`；注册宏第二参 `TrafficRule`；`cyberfile.xml` + **`planning_component/cyberfile.xml` 加依赖**（漏了就是 SpeedSetting 那种孤儿状态）。
5. **挂到 pipeline**：编辑 `planning_component/conf/traffic_rule_config.pb.txt`（现场核对 36 行、9 条 `rule {name, type}`：`BACKSIDE_VEHICLE` `CROSSWALK` `DESTINATION` `KEEP_CLEAR` `REFERENCE_LINE_END` `REROUTING` `STOP_SIGN` `TRAFFIC_LIGHT` `YIELD_SIGN`）加 `rule { name: "MY_RULE" type: "MyRule" }`。顺序即执行顺序。注意 `traffic_rules/speed_setting/` 有代码但**不在这份 conf 里 ⇒ 运行期未启用**。

**必须知道**：`TrafficDecider::Execute` **完全丢弃 `ApplyRule` 的返回值** —— 现场核对 `planning_interface_base/traffic_rules_base/traffic_decider.cc:116` 是裸调用 `rule->ApplyRule(frame, reference_line_info);`，外面没有任何 `if (!...)` 判断。⇒ **返回 `Status(PLANNING_ERROR, ...)` 没有任何效果，不会阻断流程**；意图必须通过决策本身（停车墙 / ignore / 限速）表达。`ReferenceLineEnd` 与 `Rerouting` 写了错误返回，实际全被吞掉。

## 4. task 之间的隐式数据流

task 之间**没有任何显式接口**，全靠 `Frame` / `ReferenceLineInfo` / `PlanningContext` / `Obstacle` 上的可变状态传递。载体字段（`planning_base/common/reference_line_info.h`）：`path_data_`(:348)、`candidate_path_data_`(:342-343)、`speed_data_`(:350)、`st_graph_data_`(:392)、`path_decision_`(:338)、`obs_sl_polygons_`(:403)、`cost_`(:334)。

主链路（现场核对 `scenarios/lane_follow/conf/pipeline.pb.txt` 的 11 个 task，逐条写读表见 `reference.md`）：LANE_CHANGE_PATH → LANE_FOLLOW_PATH → LANE_BORROW_PATH → FALLBACK_PATH（前四者写 `path_data`）→ PATH_DECIDER（读 `path_data().frenet_frame_path()`，写 Obstacle 的 stop/ignore/nudge 与 `stop_reference_line_s_`）→ RULE_BASED_STOP_DECIDER（建 3 类虚拟停车墙）→ SPEED_BOUNDS_PRIORI_DECIDER（写 `st_graph_data_`）→ SPEED_HEURISTIC_OPTIMIZER（写 `speed_data`，**只有 s/t/v，a 与 da 恒 0**）→ SPEED_DECIDER（写 FOLLOW/YIELD/OVERTAKE/STOP/IGNORE）→ SPEED_BOUNDS_FINAL_DECIDER → PIECEWISE_JERK_SPEED（写完整 `speed_data`）→ `Stage::CombinePathAndSpeedProfile`（`stage.cc:147`）。

**三条改顺序必坏的硬约束**：

1. **SpeedBoundsDecider 必须跑两次。** 分叉点是 `st_boundary_mapper.cc:85` 的 `if (!ptr_obstacle->HasLongitudinalDecision())`：PRIORI 轮多数障碍物还没决策，产出不含决策语义的 UNKNOWN 上下界供 DP（`speed_bounds_decider.cc:68` 先 `EraseStBoundaries()`，`:125-127` 再 `st_graph_data_->LoadData` 8 参）；FINAL 轮所有障碍物都有决策，才按 stop/follow/yield 膨胀出正确的 `boundary_type()`，而 `PiecewiseJerkSpeedOptimizer` 正是靠 `boundary_type()` 分支（`piecewise_jerk_speed_optimizer.cc:104-118`）。此外 **ignore 的障碍物在 FINAL 的 ST 图里彻底消失**（边界已被 `:68` 擦掉且不重画）。
2. **`path_data_` 只有一份，后写覆盖前写。** `LaneFollowPath` 守卫 `path_data().Empty() && !path_reusable()`（`lane_follow_path.cc:49-55`）、`FallbackPath` 守卫 Empty（`fallback_path.cc:45-48`），但 `LaneBorrowPath` **不查 Empty，成功即覆盖**（`lane_borrow_path.cc:80`），`ReversePath` **完全无守卫**（`reverse_path.cc:77`）。把它们挪到 `LaneFollowPath` 之前会改变实际胜出者。
3. **`path_label` 是跨模块的隐式契约，全靠 `find(substring)` 匹配。** producer：`lane_follow_path.cc:118`（`"regular/self"`）、`lane_borrow_path.cc:110-116`（`"regular/leftforward"` 等，**无分隔符拼接**）、`lane_change_path.cc:125`、`fallback_path.cc:89`。consumer 20+ 处，含 `trajectory_fallback_task.cc:76`（只挑含 `"self"` 的候选）、`reference_line_info.cc:735-756`（**转向灯**）、`path_assessment_decider_util.cc:263-264`、`rule_based_stop_decider.cc:146`、`driving_state_generator.cc:53`（Dreamview 显示）。**改 label 拼写会静默破坏转向灯与 fallback 选路。**

open space 链路完全走 `Frame::open_space_info_`（`frame.h:235`），与 ReferenceLineInfo 无关，字段级写读表见 `reference.md`。跨帧状态只能走 `PlanningContext`（`planning_base/proto/planning_status.proto`）—— Frame 每帧新建且 `FLAGS_max_frame_history_num=1`。

## 5. 调参：gflags 与 proto conf 在哪，优先级如何

**gflags（全局开关与阈值，206 个 `DEFINE_*`）**：定义在 `planning_base/gflags/planning_gflags.cc` + `.h`（**加 flag 必须两个文件都改**）；运行期覆盖在 `planning_component/conf/planning.conf`（flagfile，由 `dag/planning.dag:9` 加载），已覆盖 20 条，如 `--planning_upper_speed_limit=20.00`（默认 31.3）、`--default_cruise_speed=11.18`（默认 5.0）、`--prioritize_change_lane`（默认 false，这里打开）。**优先级：`planning.conf` > `planning_gflags.cc` 里的默认值。**

**proto conf（插件级数值参数，三层 merge）**：`proto 的 [default=]` < `tasks/<t>/conf/default_conf.pb.txt` < `scenarios/<sc>/conf/<tolower(stage)>/<tolower(task)>.pb.txt`（`MergeFrom`，`config_util.h:76-93`）。读 default 失败只 `AERROR`（`:82-84`）、读覆盖文件失败只 `AWARN` 并 **`return true`**（`:87-91`）⇒ 除 `CHECK_NOTNULL` 外恒返回 true，**路径写错没有任何硬报错**。`repeated` 字段是**追加不是覆盖**。

**全局 conf（`/apollo/modules/planning/planning_component/conf/`，本环境现场核对 11 个文件）**：`planning.conf`（gflags）、`planning_config.pb.txt`（channel / `pnc_map_class`，`planning_component.cc:53`）、`public_road_planner_config.pb.txt`（**scenario 列表 = 优先级**，`on_lane_planning.cc:159`；本环境注册 **12** 个，`LANE_FOLLOW` 排最后）、`traffic_rule_config.pb.txt`（**规则列表 + 顺序**，`traffic_decider.cc:39`；本环境注册 **9** 条，装了 10 个 —— `speed_setting` 未注册）、`planner_open_space_config.pb.txt`（开放空间全部参数）、`discrete_points_` / `qp_spline_` / `spiral_smoother_config.pb.txt`（参考线平滑器，选哪个由 `planning.conf:14` 决定）、`planning_semantic_map_config.pb.txt`。

> **⚠️ 剩下两个是孤儿 conf**：`navi_planner_config.pb.txt` 与 `planning_navi.conf` **仍在目录里，
> 但本环境没有 `NaviPlanner`**（planners 下只有 `public_road`）。改它们**不会有任何效果**，
> 也不要照抄它们的写法 —— 这是「conf 文件还在 ≠ 功能还在」的典型。同理别去找
> `lattice` / `rtk` 的 conf，它们本来就没有 conf（全靠 gflags / CSV）。

两套系统**管的是不相交的东西**，没有互相覆盖关系：全局行为开关走 gflags，单个 task/scenario/规则的数值参数走 proto conf（少数例外，如 iterative anchoring 的速度参数读 gflags 而非自己的 config，见 `reference.md`）。**planner / openspace / scenario 列表 / traffic_rule 列表以 `planning_component/conf/` 那份为准，不是插件目录里那份。**

## 6. 排错表（按此顺序检查）

**不出轨迹 / not_ready**：① `grep "Failed to run tasks["`（`stage.cc:136-138`）定位到返回非 OK 的具体 task。② `grep "Fail to aggregate planning trajectory"`（`stage.cc:150`）→ path 或 speed 为空：`path_data` 空查 4 个 `*Path` 的守卫，`speed_data` 空查 SpeedDecider 的 CROSS + blocking obstacle 分支。③ **车停下后再也起不来** → `Frame::InitFrameData` 仅在 `planning_start_point_.v() < 1e-3` 时做 `FindCollisionObstacle`，命中即整帧返回 PLANNING_ERROR（`frame.cc:386-395`）。④ 停车墙没生效 → 只 `CreateStopObstacle` 没 `reference_line_info->AddObstacle` 等于没加（两者是不同对象）；`BuildStopDecision` 的 s 越界**静默返回 0**（`planning_base/common/util/common.cc:40-42`）；同 id 建两个墙是覆盖，只 AWARN（`indexed_list.h:46-51`）。⑤ openspace 按 ROI → Hybrid A* → IPOPT → partition 分阶段查日志锚点，见 `reference.md`。

**场景不切换**：① 该 scenario 在 `public_road_planner_config.pb.txt` 里吗（19 个目录只有 12 个注册）？② 位置在 `LANE_FOLLOW` **之前**吗（在之后 = 等于没注册）？③ `IsTransferable` override 了吗（基类默认 `false`）？④ 想抢占正在 PROCESSING 的场景？只有排在它**之前**才行（`scenario_manager.cc:60-65`）。⑤ 有更靠前的场景一直返回 true 吗（first-match 会截断，`:73`）？⑥ 缺 `pipeline.pb.txt` / `scenario_conf.pb.txt` 是启动 abort，不是不切换。

**task 没被调用**：① `grep "Planning Perf: task name"`（`stage.cc:132`）确认到底跑了哪些。② 有 `"Create task <n> of <stage> failed!"`（`stage.cc:64-67`）→ pipeline 的 `type` 与 `plugins.xml` 的 `class type=` 不一致（大小写也算，如 `StBoundsDecider` vs 真实类名 `STBoundsDecider`）。③ 无任何日志 → 不在当前 stage 的 pipeline 里，或 stage 根本没进入。④ 跑了但没效果 → **override 的 `Process` 签名错**（单参 vs 双参），基类默认实现静默返回 OK。⑤ 换道参考线上没跑 → `ExecuteTaskOnReferenceLine` 跳过所有换道参考线（`stage.cc:115-119`）。

**conf 没生效**：① 文件名是 `tolower(pipeline 里的 name)` 吗（不是类名，也不做驼峰转下划线）？② 目录名是 `tolower(stage 的 name)` 吗？③ `grep "can not load user defined config"` —— 命中就是路径错。④ pb.txt 里未列的字段用 **proto default，不是 0**。⑤ 改的是插件目录里的 conf 还是 `planning_component/conf/` 里的（见第 5 节最后一句）？⑥ `repeated` 字段被追加成重复项了吗？⑦ 仓库里已有 3 处永不生效的 conf（文件名与 task name 不匹配），见 `reference.md`。

## 7. 编译与验证

> **⚠️ 本环境用 `buildtool`，不要只 `bazel build`**：`bazel build` 只产出 `bazel-bin/` 下的 `.so`，
> 而本环境 `APOLLO_LIB_PATH=/opt/apollo/neo/lib`、`APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`
> —— **`bazel-bin` 根本不在插件搜索路径里**，编出来运行时看不见。「改完代码没效果」头号原因就是漏了 install。

```bash
# 本环境正确姿势（在 /apollo_workspace 下执行）
buildtool build -p modules/planning/tasks/<my_task>      # 编 + install，一步到位
buildtool build -p modules/planning/planning_component   # 改主组件
buildtool test  -p modules/planning/tasks/<my_task>      # 跑该包的单测

# bazel 标签在两种形态下完全一致，需要只编不装/看编译错误时才直接用：
bazel build //modules/planning/tasks/<my_task>:lib<my_task>.so   # 单插件（不 install！）
bazel test  //modules/planning/tasks/<my_task>:<my_task>_test    # 单测（deps 用 :<name>_lib）
bazel test  //modules/planning/planning_base/common/...          # 改 Frame / ReferenceLineInfo 后必跑
```

验证 install 真的生效（三处都该出现你的插件）：
```bash
ls /opt/apollo/neo/lib/modules/planning/tasks/<my_task>/          # .so 装了吗
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep <my_task>     # 索引里有吗
ls /apollo/modules/planning/tasks/<my_task>/conf/                 # conf 符号链接建了吗
```

调试：`--enable_print_curve=true`（`planning.conf` 已打开）配合 `planning_base/tools/` 下的可视化脚本；复现时序问题先关 `--enable_reference_line_provider_thread=false`（参考线可能滞后 ≤50ms）。注意集成测试用 `qp_spline` 平滑器而生产用 `discrete_points`（`planning.conf:14`），golden 基线不可跨配置复用。
