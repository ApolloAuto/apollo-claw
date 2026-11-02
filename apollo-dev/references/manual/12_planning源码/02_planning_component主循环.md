# 02 planning_component 主循环

<!--
file: references/manual/12_planning源码/02_planning_component主循环.md
scope: 11.0（默认）
tags: planning_component, PlanningComponent, 主循环, Proc, Frame, LocalView, dag, 消息触发, 融合, ADCTrajectory, PlanningCommand, OnLanePlanning, conf
sources:
- /opt/apollo/neo/src/modules/planning/planning_component/planning_component.h
- /opt/apollo/neo/src/modules/planning/planning_component/planning_component.cc
- /opt/apollo/neo/src/modules/planning/planning_component/planning_base.h
- /opt/apollo/neo/src/modules/planning/planning_component/planning_base.cc
- /opt/apollo/neo/src/modules/planning/planning_component/on_lane_planning.h
- /opt/apollo/neo/src/modules/planning/planning_component/on_lane_planning.cc（1–730 行精读）
- /opt/apollo/neo/src/modules/planning/planning_component/BUILD
- /opt/apollo/neo/src/modules/planning/planning_component/dag/planning.dag
- /opt/apollo/neo/src/modules/planning/planning_component/launch/planning.launch
- /opt/apollo/neo/src/modules/planning/planning_base/common/local_view.h
- /opt/apollo/neo/src/modules/planning/planning_base/common/frame.h
- /opt/apollo/neo/src/modules/planning/planning_base/proto/planning_config.proto
- /opt/apollo/neo/src/modules/planning/planning_base/gflags/planning_gflags.cc（15–89 行）
- /opt/apollo/neo/src/modules/common/adapters/adapter_gflags.cc（33–62 行）
- /opt/apollo/neo/src/modules/common/configs/config_gflags.cc（55–72 行）
- /opt/apollo/neo/src/cyber/component/component.h
- /opt/apollo/neo/src/cyber/data/data_visitor.h
- /opt/apollo/neo/src/cyber/data/fusion/all_latest.h
- /opt/apollo/neo/src/cyber/mainboard/module_controller.cc（55–129 行）
- /apollo_workspace/profiles/current/modules/planning/planning_component/conf/planning_config.pb.txt（当前生效档）
- /apollo_workspace/profiles/current/modules/planning/planning_component/conf/planning.conf（当前生效档）
- /opt/apollo/neo/src/modules/planning/planning_component/conf/planning.conf（出厂档）
-->

## 0. 一句话作用

planning 的**进程级入口与主循环**：`PlanningComponent` 是一个被 dag 拉起的消息触发型 cyber Component，收到预测/底盘/定位三路消息（以 prediction 为节拍）后，把 `LocalView` 快照交给 `PlanningBase`（默认 `OnLanePlanning`）跑一次「建 Frame → 参考线/决策 → planner 求解 → 填 ADCTrajectory」的完整规划周期，最终写出 `/apollo/planning`。位置：上游 prediction/localization/canbus → **本组件** → `/apollo/planning` 供 control 消费（消费端见 `../14_数据与消息/01_PnC链路channel全景.md`）。

## 1. 关键符号与文件

| 符号/类/概念 | 文件（绝对路径，注明 src/include 完整度） | 行号(已核) | 说明 |
|---|---|---|---|
| `PlanningComponent` | /opt/apollo/neo/src/modules/planning/planning_component/planning_component.h（src 全） | 45-47 | `final class`，继承 `cyber::Component<prediction::PredictionObstacles, canbus::Chassis, localization::LocalizationEstimate>`：三输入消息组件 |
| 注册宏 `CYBER_REGISTER_COMPONENT` | 同上 | 104 | 注册名 `PlanningComponent`（非限定名），供 class_loader 实例化 |
| 组件实现 | /opt/apollo/neo/src/modules/planning/planning_component/planning_component.cc（src 全） | Init 44-130 / Proc 132-266 | reader 注册、writer 创建、主流程都在这里 |
| `PlanningBase`（抽象基类） | /opt/apollo/neo/src/modules/planning/planning_component/planning_base.h（src 全） | 58；RunOnce 70-71 | 持 `local_view_`(98)/`frame_`(106)/`planner_`(107) 等成员（98-109）；`LoadPlanner` 96 |
| `OnLanePlanning`（默认实现） | /opt/apollo/neo/src/modules/planning/planning_component/on_lane_planning.h/.cc（src 全） | h:39；cc RunOnce 232-454 | 主循环实体；`InitFrame` 建 Frame（cc 162-207） |
| `NaviPlanning`（navi 分支） | /opt/apollo/neo/src/modules/planning/planning_component/navi_planning.h/.cc | 未读行号 | `FLAGS_use_navigation_mode=true` 才实例化（cc 47-51）；本机默认 false |
| `Frame` | /opt/apollo/neo/src/modules/planning/planning_base/common/frame.h（src 全，本手册读 1-150） | 59；62；ctor 66-69 | 「holds all data for one planning cycle」：一触发周期一帧 |
| `LocalView` | /opt/apollo/neo/src/modules/planning/planning_base/common/local_view.h | 40-52 | Proc 组装的全部输入快照（含侧信道） |
| `PlanningConfig`/`TopicConfig` | /opt/apollo/neo/src/modules/planning/planning_base/proto/planning_config.proto | 27-41 / 5-20 | 组件唯一 proto（**没有** planning_component.proto）；topic 全在 `topic_config` |
| 组件库 | /opt/apollo/neo/src/modules/planning/planning_component/BUILD | 7-33 | `apollo_component(name="libplanning_component.so")`：**无 main.cc**，入口即注册宏+class_loader |
| dag / launch | /opt/apollo/neo/src/modules/planning/planning_component/dag/planning.dag、launch/planning.launch | dag 全文 31 行 / launch 8 行 | dag 只声明 3 个输入 reader + conf/flag 路径 |

## 2. 机制与数据流

### 2.1 组件如何被拉起（dag → mainboard → class_loader）

1. launch 层：`planning.launch:4-5` 声明两个 dag_conf —— external_command_process.dag 与 planning.dag，同一 `process_name: "planning"`（:6），即 planning 进程里同时跑 external_command 处理器组件与本组件（cyber_launch 形态见 §6）。
2. mainboard 读 dag：`mainboard` 按 `module_config.module_library()` 用 `GetFilePathWithEnv(..., "APOLLO_LIB_PATH")` 解析库路径（src/cyber/mainboard/module_controller.cc:79-80），本机落到 `/opt/apollo/neo/lib/modules/planning/planning_component/libplanning_component.so`（存在，已 ls 核对）；`LoadLibrary`（:87）后对每个 `components{}` 调 `class_loader_manager_.CreateClassObj<ComponentBase>(class_name)`（:91-92，即 CyberComponentFactory/class_loader 概念在本仓的实现点）再 `Initialize(component.config())`（:93）。`class_name: "PlanningComponent"`、`name: "planning"` 见 dag/planning.dag:5、:7。
3. `Component<M0,M1,M2>::Initialize`（src/cyber/component/component.h:375-501）：先 `LoadConfigFiles(config)`（:378，按 dag 的 `config_file_path`/`flag_file_path` 预载 conf 与 flag 文件）→ 再调用户 `Init()`（:385）→ 后按 dag readers 建 reader 与调度任务。

### 2.2 触发方式：消息触发，prediction 为节拍（不是定时器）

- dag 只声明 3 个 reader（src 版与生效版逐字节一致）：`/apollo/prediction`、`/apollo/canbus/chassis`（qos depth 15、pending_queue_size 50）、`/apollo/localization/pose`（同）——planning.dag:10-28。
- reality 模式（component.h:390-501）：三 reader 共用一个 `DataVisitor<M0,M1,M2>`（component.h:494-501，M0=prediction），融合策略 `fusion::AllLatest`（data_visitor.h:106-107）。`AllLatest` 把融合回调**只挂到 M0（prediction）的 channel buffer** 上（all_latest.h:107-118）：每条 prediction 到达时取 chassis/localization 两 buffer 的 `Latest()`，**两路都有最新值才合成一组触发**（all_latest.h:111-113 空则直接 return）；DataVisitor 也只给 M0 channel 注册 notifier（data_visitor.h:105），m1/m2 只更新 buffer 不唤醒。即：
  - **prediction 停 → planning 停**（源码注释互证：on_lane_planning.cc:303-304 "planning is triggered by prediction data"）；
  - chassis 或 localization 断流 → 融合不产出，prediction 到了也白到（空转无 Proc）；
  - Proc 拿到的 chassis/localization 是「到 prediction 那一刻为止的最新值」。
- 非 reality（仿真 blocker）模式：prediction 到达且 m1/m2 的 blocker 非空才 `Process`（component.h:426-434），语义一致。
- 规划周期无定时器字段；`FLAGS_planning_loop_rate`（默认 10，planning_gflags.cc:21）只用于**估算** stitching 周期（`1.0/loop_rate`，on_lane_planning.cc:305-306），不驱动触发。实车周期≈prediction 到率；本机实际频率未做记录回放实测，补测方法见 §6。

### 2.3 Proc 主流程（每触发一次执行一遍，planning_component.cc:132-266）

| 步 | 做的事 | 位置（已核） |
|---|---|---|
| 0 | 重路由检查：`planning_context` 里 `need_rerouting` 则经 service client 发 LaneFollowCommand | 141 → 268-282（发 280、清标志 281） |
| 1 | 组装 `local_view_`：prediction/chassis/localization 直指参数（144-146）；planning_command、traffic_light、relative_map、pad_msg、stories、control_interactive_msg 取各自成员最新副本（147-188，全部加 mutex；比较 header 变化避免重复拷贝） | 144-188 |
| 2 | 输入检查 `CheckInput`：localization 空→"localization not ready"；chassis 空→"chassis not ready"；hdmap 空→"map not ready"；navi 要求 relative_map 有 header；on-lane 要求 planning_command 有 header。失败时填 `decision.not_ready.reason` 并把**空轨迹**写 `/apollo/planning` 后 return false | 190-193、284-320（写 316） |
| 3 | 学习模式：`learning_mode != NO_LEARNING` 时把各输入灌给 `message_process_`（195-206）；`RL_TEST` 时写一帧 learning data 后直接 return（209-223） | 195-223 |
| 4 | `planning_base_->RunOnce(local_view_, &adc_trajectory_pb)` 跑规划主循环（见 2.4），随后 FillHeader/SetLocation/修正 relative_time 并 `planning_writer_->Write` 写 `/apollo/planning` | 225-236（写 236） |
| 5 | 命令状态回执：按轨迹 error_code 与 `IsPlanningFinished` 判 ERROR/FINISHED/RUNNING，写 `/apollo/planning/command_status`（每帧一条） | 238-259（写 259） |
| 6 | 当前轨迹入 history（供 stitching 与展示） | 262-263 |

**侧信道 reader 回调（Init 内注册，planning_component.cc:67-117）**：全是「互斥锁内拷一份到成员」的缓存式回调，供 Proc 第 1 步取用：

| reader（topic 来自 conf topic_config，见 §3） | 消息类型 → 成员 | 位置（已核） |
|---|---|---|
| `planning_command_topic` = `/apollo/planning/command` | `PlanningCommand` → `planning_command_` | 67-74 |
| `traffic_light_detection_topic` = `/apollo/perception/traffic_light` | `TrafficLightDetection` → `traffic_light_` | 76-82 |
| `planning_pad_topic` = `/apollo/planning/pad` | `PadMessage` → `pad_msg_`（`CLEAR_PLANNING` 动作在 Proc:167-171 清空任务） | 84-90 |
| `story_telling_topic` = `/apollo/storytelling` | `Stories` → `stories_` | 92-98 |
| `control_interative_topic`（proto 拼写即 interative） = `/apollo/control/interactive` | `ControlInteractiveMsg` → `control_interactive_msg_` | 100-107 |
| `relative_map_topic` = `/apollo/relative_map`（**仅 navi 模式**创建） | `MapMsg` → `relative_map_` | 109-117 |

### 2.4 规划主循环与 Frame 构造时机（OnLanePlanning::RunOnce，on_lane_planning.cc:232-454）

每触发一次（=每来一条可融合的 prediction，见 2.2）执行一轮：

1. `vehicle_state` 更新：`VehicleStateProvider::Update(localization, chassis)`（250-251）；vehicle_state 时间戳与 start_timestamp 的差值落在 `FLAGS_message_latency_threshold` 以内时用 `AlignTimeStamp` 对齐到当前时刻（282-285）。
2. stitching：`TrajectoryStitcher::ComputeStitchingTrajectory`（309-314）产出拼接起点，ego_info 更新（316）。
3. **Frame 构造**：`frame_num = seq_num_++`（317）→ `InitFrame(frame_num, stitching_trajectory.back(), vehicle_state)`（319）→ 内部 `frame_.reset(new Frame(seq, local_view_, planning_start_point, vehicle_state, reference_line_provider_.get()))`（165-166，ctor 声明 frame.h:66-69）→ `GetReferenceLines` 取参考线（174）→ 按车位置裁剪参考线/route segments（180-197）→ `frame_->Init(...)`（199-201，声明 frame.h:79-84）。**即：收到触发消息才建帧，一触发周期一帧。**
4. traffic rule 逐条参考线执行 `traffic_decider_.Execute`（362-370）；`Plan()`（372，实现 528-697）内调 planner 插件 `planner_->Plan(stitching_trajectory.back(), frame_.get(), ptr_trajectory_pb)`（540-541）→ planner 内部跑 scenario/stage/task 链（另见 03-13 各篇）。
5. 结果处理：失败路径（estop/停驶轨迹，333-360、404-416）；成功路径填 trajectory_pb、选 best reference line、导出 decision/debug（583-692）；帧末 `frame_history()->Add`（453）。规划输出仍在 `ADCTrajectory` 内存对象里，**真正对外发布在 component 层**（2.3 步 4）。

planner 插件选择：`PlanningBase::LoadPlanner`（planning_base.cc:113-123）默认 `apollo::planning::PublicRoadPlanner`（:115-119），经 `PluginManager::CreateInstance<Planner>`（:120-122）加载；`config_.planner()` 可覆盖（conf 见 §3）。`OnLanePlanning::Init` 里 `planner_->Init(..., FLAGS_planner_config_path)`（on_lane_planning.cc:159）。

### 2.5 输出 writer 创建点与写点（全部在 component 层，不散在 planning_base）

| 输出 | 消息类型 | 创建点（已核） | 写点（已核） | 触发条件 |
|---|---|---|---|---|
| `/apollo/planning` | `ADCTrajectory` | planning_component.cc:118-119（topic=`topic_config.planning_trajectory_topic`） | 236（正常周期）；316（输入不齐的空轨迹） | 每 Proc |
| `/apollo/planning/command_status` | `external_command::CommandStatus` | 127-128（gflag `FLAGS_planning_command_status`，默认见 adapter_gflags.cc:43-44） | 259 | 每 Proc，ERROR/FINISHED/RUNNING |
| `/apollo/planning/learning_data` | `PlanningLearningData` | 125-126（`topic_config.planning_learning_data_topic`） | 217 | 仅 `learning_mode=RL_TEST` |
| service client（非 writer）：`/apollo/external_command/lane_follow` | `LaneFollowCommand` ↔ `CommandStatus` | 121-124（`topic_config.routing_request_topic` 即此 service 名） | `SendRequest` 280 | 仅重路由请求时 |

> dag 只声明输入，**输出与侧输入 topic 全在 conf proto / gflags 里**（本节与 §3 表即全景；与 11_cyber 通用规则一致，见 `../11_cyber框架/02_dag_launch与conf查找.md`）。

## 3. 注册与配置

### 3.1 dag 要素（生效版 = profiles 版，与出厂逐字节一致，diff 已核）

planning.dag:3 `module_library: "modules/planning/planning_component/libplanning_component.so"`；:5 `class_name: "PlanningComponent"`；:7 `name: "planning"`；:8 `config_file_path: /apollo/modules/planning/planning_component/conf/planning_config.pb.txt`；:9 `flag_file_path: /apollo/modules/planning/planning_component/conf/planning.conf`；:10-28 三个 readers（2.2）。

- `planning_config.pb.txt`（proto = `PlanningConfig`）在 `ComponentBase::GetProtoConfig` 处载入：planning_component.cc:53-55；gflags 由 `LoadConfigFiles` 在用户 Init 前载入（component.h:378），所以 `Init()` 里按 `FLAGS_use_navigation_mode` 分支（planning_component.cc:47-51）时 flag 已就绪。两文件路径均为 `/apollo/modules/...`（④ 层软链，见 3.3）。

### 3.2 生效档内容（当前生效 = profiles/current 档，2026-09-08 读）

`planning_config.pb.txt`（21 行）：
- `topic_config` 全部 14 个 topic（生效档 :1-16；proto 字段序 planning_config.proto:5-20，`planning_command_topic`=13、`control_interative_topic`=14 拼写即如此）。值一览（生效档行号）：`chassis_topic` :2 = /apollo/canbus/chassis、`hmi_status_topic` :3、`localization_topic` :4 = /apollo/localization/pose、`planning_pad_topic` :5 = /apollo/planning/pad、`planning_trajectory_topic` :6 = /apollo/planning、`prediction_topic` :7 = /apollo/prediction（:2/:4/:7 与 dag readers 同名）、`relative_map_topic` :8 = /apollo/relative_map、`routing_request_topic` :9 = /apollo/external_command/lane_follow、`routing_response_topic` :10、`planning_command_topic` :11 = /apollo/planning/command、`story_telling_topic` :12 = /apollo/storytelling、`traffic_light_detection_topic` :13 = /apollo/perception/traffic_light、`planning_learning_data_topic` :14 = /apollo/planning/learning_data、`control_interative_topic` :15 = /apollo/control/interactive。
- `learning_mode: NO_LEARNING`（:18）；`reference_line_config.pnc_map_class: "apollo::planning::LaneFollowMap"`（:19-21）。
- 与出厂档 src conf 仅差末尾换行（diff 已核），即**本机未改 topic/学习模式**。

`planning.conf`（62 行，gflags，生效档）：:1 `--flagfile=/apollo/modules/common/data/global_flagfile.txt`；:2 `--traffic_rule_config_filename=`（**绝对路径**指回 ④ 软链）；调参要点：:3 `--planning_upper_speed_limit=10.0`、:4 `--default_cruise_speed=10.0`、:14 平滑器选 discrete_points、:16 speed_bump、:57 关参考线线程、:59-62 平滑/约束开关——**与出厂档（src planning.conf，34 行）差异大**（出厂 :3-4 为 20.0/11.18、:26-30 平滑开关取向不同）：本机是 ARCF_40P profile 调参件，出厂档≠生效档，勿拿出厂件当现状。

### 3.3 ④ conf 目录（软链写穿现状，已逐个 ls -l 核对）

`/apollo/modules/planning/planning_component/conf/` 共 11 个文件，**两个真实目标**：

| 真实目标 | 文件 |
|---|---|
| `/apollo_workspace/profiles/current/...`（current→`/apollo_workspace/profiles/ARCF_40P`） | planning.conf、planning_config.pb.txt、public_road_planner_config.pb.txt、traffic_rule_config.pb.txt、planner_open_space_config.pb.txt、discrete_points_smoother_config.pb.txt |
| `/opt/apollo/neo/share/modules/planning/planning_component/conf/` | navi_planner_config.pb.txt、planning_navi.conf、planning_semantic_map_config.pb.txt、qp_spline_smoother_config.pb.txt、spiral_smoother_config.pb.txt |

dag 目录：planning.dag→profiles（内容=出厂，3.1）、planning_navi.dag→share；launch 目录：planning.launch→share。**改 ④ 文件写穿其真实目标、立即生效**（重启组件后完全生效）：前 6 个改的是 profile 树（下次 `buildtool build` install 不覆盖，可长期驻留），后 5 个改的是 share 树（下次 install 被覆盖）。⚠️ 本机 ④ 现状与 CLAUDE.md「全部→share」的通用描述不同（本车 2026-08-11 16:26 起按 ARCF_40P profile 改链，见 §5）。

### 3.4 相关 gflag 默认值出处（均为代码默认，运行期被 planning.conf 覆盖）

| flag | 默认 | 文件:行号 |
|---|---|---|
| `planning_loop_rate` | 10 | planning_gflags.cc:21 |
| `traffic_rule_config_filename` | `modules/planning/.../traffic_rule_config.pb.txt`（相对路径） | planning_gflags.cc:34-37 |
| `planner_config_path` | `modules/planning/planning_component/conf/public_road_planner_config.pb.txt` | planning_gflags.cc:55-58 |
| `publish_estop` | false | planning_gflags.cc:60 |
| `use_navigation_mode` | false | config_gflags.cc:62-63 |
| `planning_command` / `planning_command_status` | `/apollo/planning/command` / `/apollo/planning/command_status` | adapter_gflags.cc:41-44 |

运行期覆盖优先级：planning.conf > `.cc` 默认值（flag 由 dag flag_file_path 先于 Init 载入，3.1）。

## 4. 修改与扩展点（二次开发）

- **改主循环/组件逻辑**：源码唯一修改点在 `/apollo_workspace/modules/planning/planning_component/`（① 工作区层，先 `buildtool install planning` 拉源码）；改完 `buildtool build -p modules/planning/planning_component`（install 到 `/opt/apollo/neo/lib`，`bazel build` 不会 install，见 CLAUDE.md 二节）。
- **改规划行为参数**（速度限制、平滑、场景开关）：编辑 `/apollo/modules/planning/planning_component/conf/planning.conf`（④ 软链→profile 树，写穿立即生效）；重启组件生效。改 conf 之前先 `ls -l` 该目录认清真实目标（3.3）。
- **改 topic 或学习模式**：编辑 ④ `planning_config.pb.txt` 的 `topic_config`/`learning_mode`，并保证 dag readers 与 `chassis/localization/prediction_topic` 三字段一致（dag 与 conf 是两处，只改一处会错位）。
- **新增 planner/场景/规则插件**：走 `buildtool create --template {planning_scenario,planning_task,planning_traffic_rule,...}` 模板 + plugins.xml（详见 01/04-07、15_二次开发手册 各篇）；`config_.planner()`（PlanningConfig 字段 4，planning_config.proto:40）可换默认 planner。
- **观察主循环**：日志关键字 `Planning start frame sequence id` / `Planning end frame sequence id`（on_lane_planning.cc:318、452）；单模块起法 §6。

## 5. ⚠️ 本环境注意

- **④ 软链已半迁 profile**：CLAUDE.md 三节② 通用描述是「④ conf 全部指向 `/opt/apollo/neo/share/<sp>/conf/`」，但本机 planning 的 6 个 conf + planning.dag 已于 2026-08-11 16:26 改指 `/apollo_workspace/profiles/current`（→ARCF_40P 车 profile），其余 5 个 conf 仍是 share 出厂链（3.3 表）。**看生效配置一律先 `ls -l /apollo/modules/planning/planning_component/conf/` 认目标**；修改 ④ 会写穿到 profile 树或 share 树，前者不会被 install 覆盖、后者会被。
- **生效档 ≠ 出厂档**：本机 planning.conf 是 ARCF_40P 调参件（限速 10 m/s 等，3.2），与 src/出厂差异大；grep/结论引用时要分清读的是哪个文件。
- **搜 `/apollo/...` 必须 `grep -R`**（`-r` 不跟随符号链接会假空）——CLAUDE.md 三节② 已实测的坑，本节 conf/dag 检索同样适用。
- **`buildtool build` 才 install**、插件索引在 `/opt/apollo/neo/share/cyber_plugin_index/`（不扫 bazel-bin）、`plugins.xml` 的 `base_class` 写最顶层基类——三坑见 CLAUDE.md 三节①/四节，改插件后必须 `buildtool build -p` 才会被发现。
- **生效 planning.conf:1 flagfile 指向 `global_flagfile.txt`**：该文件由 dreamview 选图以 append 方式追加 `--map_dir`（取最后一行，见 CLAUDE.md 五节「数据资产」），**任何模块 conf 都不要写 `--map_dir`**；planning 起动依赖 hdmap 加载（`CheckInput` 的 "map not ready"），地图没装/没选对 = planning 只发 not_ready 空轨迹，与代码无关。
- **无 main.cc 设计**：组件注册走 `CYBER_REGISTER_COMPONENT`（planning_component.h:104）+ class_loader（2.1），找「入口」别找 main。
- navi 分支（`NaviPlanning` + `/apollo/relative_map`）本机未启用且未逐行精读（仅确认分支与 reader 注册点，见 §1/§2.3）；`navi_planner_config.pb.txt`/`planning_navi.conf` 是孤儿残留（CLAUDE.md 五节），改了无效。

## 6. 验证命令（本环境已确认的命令形态；用法抄 CLAUDE.md 二节/三节）

```bash
# 单模块前台起 planning（dag 形态，调单模块首选；Ctrl-C 停）
mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag
# launch 形态（同一模块还带 external_command_process.dag）
cyber_launch start /apollo/modules/planning/planning_component/launch/planning.launch
cyber_launch stop  /apollo/modules/planning/planning_component/launch/planning.launch
# 通道观测（cyber_channel -w 在本环境是坏的，勿用；用 -e/-l）
cyber_channel -l | grep planning        # 列出 planning 相关 channel
cyber_channel -e /apollo/planning       # 回显 /apollo/planning（ADCTrajectory）
cyber_node list / cyber_node info planning
# 录一段包再离线数频率/字段（判定 prediction 到率与 planning 实际周期）
# （录包语法与频道清单按 apollo-test skill / cyber_recorder 实测形态，先 -l 确认 channel 存在）
```

起后核对点：日志出现周期性 `Planning start/end frame sequence id`；`cyber_channel -e /apollo/planning` 有 10Hz 量级轨迹（若只有 not_ready 空轨迹，按 §5 查地图/输入）。**断言前先跑**：若上述工具在当前 shell 找不到，先 `source /opt/apollo/neo/setup.sh` 或按 CLAUDE.md 二节环境变量核对。

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。版本基线：Apollo 11.0.0 package 工作区（`.workspace.json` = apollo-universe-11 11.0.0；见 00_readme 第 1 节与工作区 CLAUDE.md）。
- 本文所有 `文件:行号` 均出自本轮 read 逐行核对；read 打开过的源码/配置见 front-matter `sources` 清单（component 三层 cc/h 全读；on_lane_planning.cc 精读 1-730 行——其余为 chart/export 工具函数，不影响主循环结论；planning_gflags/adapter_gflags/config_gflags 只精读了引用片段）。另有三类核对证据未进 sources：① `ls -R/-l` 目录视图（② 全树、④ 软链目标、/opt/apollo/neo/lib 落点、profiles/current→ARCF_40P）；② `diff` 结果（profiles 版 planning.dag=出厂版；profiles 版 planning_config.pb.txt=出厂版仅差换行；profiles 版 planning.conf≠出厂版，差异清单见 3.2）；③ grep 检索线索（/opt/apollo/neo/src/modules/planning/planning_base/proto/planning_config.proto 的 topic 字段序、adapter_gflags 的 topic gflag 默认值、external_command 各 command_processor conf 含 `output_command_name: "/apollo/planning/command"`——该行仅 grep 到未 read 打开，生产端细节待核）。
- 遗留待核项：① `NaviPlanning`(.cc/.h) 未精读（本机非 navi）；② learning 模式的 `message_process.cc/.h` 未读（仅确认组件层调用点 planning_component.cc:57-63、195-223）；③ `frame.cc` 内部实现未读（frame.h 1-150 行已核，Frame::Init 行为在 04-08 篇展开）；④ `reference_line_provider` 生成线程内部未读（on_lane_planning.cc 调用点已核，属 08 篇）；⑤ `ComponentBase::LoadConfigFiles` 定义未读（调用点 component.h:378 已核），flag 文件载入顺序细节以 11_cyber框架 篇为准；⑥ `/apollo/planning/command` 的生产端（external_command command_processor / dreamview sim_control 均 grep 到 writer 线索，未 read 验证）与 `/apollo/planning` 下游 control 消费点未开文件核对；⑦ 本机 prediction/planning 实际频率未做录包实测（§6 补测）。⑧ 00_readme.md:55 标注本文件「pilot 已产出，作模板样板」，但产出前 `12_planning源码/` 目录为空——文案与事实不符，建议校准文件清单表述。
