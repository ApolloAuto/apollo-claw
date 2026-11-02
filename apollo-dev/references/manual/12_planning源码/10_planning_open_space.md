# 10 planning_open_space（泊车 / 开放空间）

<!--
file: references/manual/12_planning源码/10_planning_open_space.md
scope: 11.0（默认，本机 profile = ARCF_40P）
tags: open_space, 泊车, valet_parking, hybrid_a_star, 混合A星, reeds_shepp, dual_variable_warm_start, distance_approach, ipopt, osqp, iterative_anchoring, ROI, parking_spot, _PARK后缀, 孤儿conf, free_space, precise_parking, large_curvature
sources（本轮 read 打开）:
- /opt/apollo/neo/src/modules/planning/planning_open_space/coarse_trajectory_generator/hybrid_a_star.h（40–119、135–166 精读）
- /opt/apollo/neo/src/modules/planning/planning_open_space/trajectory_smoother/distance_approach_problem.h（43–82 精读）
- /opt/apollo/neo/src/modules/planning/scenarios/valet_parking_park/valet_parking_scenario.cc（30–119 精读）
- /opt/apollo/neo/src/modules/planning/scenarios/valet_parking_park/stage_parking_park.cc（26–85 精读）
- /opt/apollo/neo/src/modules/planning/planning_base/gflags/planning_gflags.cc（314–327 精读）
- /apollo/modules/planning/scenarios/valet_parking_park/conf/pipeline.pb.txt（全 123 行）
- /apollo/modules/planning/planning_component/conf/planner_open_space_config.pb.txt（全 137 行）
- manual/12_planning源码/15_本环境运行现状.md（全 285 行）、manual/_template.md（全 56 行）
- 其余为本轮只读命令证据（ls / readlink / grep / cat / ldd），清单见 §7
-->

## 0. 一句话作用

`planning_open_space` 是**算法库包**（不含任何插件、不注册任何 Task）：提供混合 A\* 粗轨迹、
Reeds-Shepp 解析扩展、对偶变量热启动、距离逼近（IPOPT）精细优化、迭代锚定平滑这五件算法。
真正被 planning 调度的是 `tasks/open_space_*` 这 **11 个 Task 插件**，它们在
`scenarios/{valet_parking_park, free_space, precise_parking, large_curvature, park_and_go, pull_over}`
的 pipeline 里被串成两条**不同世代**的泊车/开放空间链。**本机生效的泊车场景只有 `VALET_PARKING_PARK`（新 `_PARK` 链）
与 `FREE_SPACE`（旧链）**，`precise_parking`、`large_curvature`、`valet_parking`（旧）均装了未注册（引 15 篇 §3.1）。

## 1. 关键符号与文件

包路径：`/opt/apollo/neo/src/modules/planning/planning_open_space/`（② 只读参考，本包 src **完整**）。
产物：`/opt/apollo/neo/lib/modules/planning/planning_open_space/libapollo_planning_open_space.so`
+ 3 个 python wrapper `.so`（`hybrid_a_star_wrapper_lib.so`、`distance_approach_problem_wrapper_lib.so`、
`open_space_roi_wrapper_lib.so`）。包名（cyberfile `<name>`）= **`planning-open-space`**，`<src_path>` = `//modules/planning/planning_open_space`。

| 子目录 | 文件（节选） | 职责 |
|---|---|---|
| `coarse_trajectory_generator/` | `hybrid_a_star.{h,cc}`、`node3d`、`reeds_shepp_path`、`grid_search` | **粗轨迹**：混合 A\*（前后向+挡位切换代价）+ RS 曲线解析扩展 + 2D A\* 距离启发（`grid_search`） |
| `trajectory_smoother/` | `dual_variable_warm_start_problem`、`dual_variable_warm_start_{ipopt,ipopt_qp,osqp,slack_osqp}_interface` | **对偶变量热启动**：为障碍物对偶变量 λ/μ 求初值，`qp_format` 选 OSQP / IPOPT / IPOPT_QP |
| 同上 | `distance_approach_problem`、`distance_approach_ipopt{,_cuda,_fixed_dual,_fixed_ts,_relax_end,_relax_end_slack}_interface` | **精细优化**：距离逼近 OBCA，6 个 IPOPT 变体 +1 个 CUDA 变体（`distance_approach_mode` 选） |
| 同上 | `iterative_anchoring_smoother.{h,cc}`、`planning_block.{cu,h}` | **迭代锚定平滑**（不用对偶变量的另一条平滑路线，内含 FEM 位置偏差平滑 + S 曲线速度规划）；`.cu` 为 CUDA kernel |
| `utils/` | `open_space_roi_util`、`open_space_trajectory_optimizer_util`、`open_space_fallback_util` | ROI 顶点/边计算、优化前后数据搬运、fallback 碰撞检查工具函数 |
| `proto/` | `planner_open_space_config.proto` | `PlannerOpenSpaceConfig` 及其 5 个子 message（被各 task 的 proto `import` 复用） |
| `tools/` | `hybrid_a_star_wrapper.cc`、`distance_approach_problem_wrapper.cc`、`open_space_roi_wrapper.cc` | 给 `/opt/apollo/neo/src/modules/tools/open_space_visualization/*.py` 用的 C 接口（**离线调参/可视化，不在运行链上**） |

核心类接口（行号本轮 read 核过）：

| 符号 | 位置 | 关键签名/说明 |
|---|---|---|
| `HybridAStartResult` | `hybrid_a_star.h:49-57` | 7 个 `vector<double>`：`x,y,phi,v,a,steer,accumulated_s` |
| `HybridAStar` 老构造 | `hybrid_a_star.h:61` | `HybridAStar(const PlannerOpenSpaceConfig&)` |
| `HybridAStar` 新构造 | `hybrid_a_star.h:140`（`// park generic` 段 `:138`） | `HybridAStar(const WarmStartConfig&)` —— **`_PARK` 链走这个** |
| `HybridAStar::Plan` | `hybrid_a_star.h:142-153` | `(sx,sy,sphi,ex,ey,ephi, XYbounds, obstacles_vertices_vec, HybridAStartResult*, soft_boundary_vertices_vec={}, reeds_sheep_last_straight=false)` |
| `HybridAStar::TrajectoryPartition` | `hybrid_a_star.h:63` | 按挡位切换点把粗轨迹切段 |
| `DistanceApproachProblem::Solve` | `distance_approach_problem.h:49-70` | 入：`x0,xF,last_time_u,horizon,ts,ego,xWS,uWS,l_warm_up,n_warm_up,s_warm_up,XYbounds,obstacles_{num,edges_num,A,b}`；出：`state/control/time/dual_l/dual_n` 五个 `MatrixXd*` |
| `DistanceApproachProblem` 双构造 | `.h:45`（`PlannerOpenSpaceConfig`）/ `.h:77`（`DistanceApproachConfig`，`// park generic`） | 同样是新老两套 |
| `IterativeAnchoringSmoother` | `iterative_anchoring_smoother.h:43`，`Smooth` `:49`、`SmoothSpeed` `:71`、`SmoothPath` `:118`（grep 定位，签名未逐行 read） | 路径平滑 + 速度平滑两段 |

> 新老双构造是本包的结构特征：**老接口吃整份 `PlannerOpenSpaceConfig`，`_PARK` 新接口只吃自己那一个子 message**。
> 这直接决定了 §3 的配置分裂。

## 2. 机制与数据流

### 2.1 两条并存的 task 链（本轮读 ④ 视口 pipeline 原文）

| 链 | 使用者场景 | task 顺序（pipeline 里的 `name` 别名） |
|---|---|---|
| **新 `_PARK` 链** | `valet_parking_park`（已注册）、`precise_parking`、`large_curvature`（均未注册） | `OPEN_SPACE_REPLAN_DECIDER` → `OPEN_SPACE_ROI_DECIDER_PARK` → `OPEN_SPACE_PATH_PLANNING` → `OPEN_SPACE_TRAJECTORY_OPTIMIZER_PARK` → `OPEN_SPACE_TRAJECTORY_POST_PROCESS` → `OPEN_SPACE_FALLBACK_DECIDER_PARK` |
| **旧 provider 链** | `free_space`（已注册）、`park_and_go`、`pull_over` | （`OPEN_SPACE_ROI_DECIDER` →）`OPEN_SPACE_TRAJECTORY_PROVIDER` → `OPEN_SPACE_TRAJECTORY_PARTITION` → `OPEN_SPACE_FALLBACK_DECIDER` |

差别在于**粗轨迹+优化是拆开成两个 task 还是包在一个 task 里**：新链把混合 A\* 放进
`OpenSpacePathPlanning`、把热启动+距离逼近+平滑放进 `OpenSpaceTrajectoryOptimizerPark`；
旧链两步都藏在 `OpenSpaceTrajectoryProvider` 内部的 `OpenSpaceTrajectoryOptimizer` 里。
`pull_over` 只借用 `OPEN_SPACE_PRE_STOP_DECIDER` 与 `OPEN_SPACE_ROI_DECIDER`，不做完整开放空间优化。

11 个 task 插件（`base_class` 全为 `apollo::planning::Task`，本轮逐个 `cat plugins.xml` 核过）：
`open_space_pre_stop_decider`、`open_space_replan_decider`、`open_space_roi_decider`、`open_space_roi_decider_park`、
`open_space_path_planning`、`open_space_trajectory_optimizer_park`、`open_space_trajectory_provider`、
`open_space_trajectory_partition`、`open_space_trajectory_post_process`、`open_space_fallback_decider`、
`open_space_fallback_decider_park`。

算法库的调用点（本轮 grep 命中，行号未 read 核对，故只列文件）：
- `tasks/open_space_path_planning/open_space_path_planning.cc` —— `Task::LoadConfig<OpenSpacePathPlanningConfig>` 后
  `path_finder_.reset(new HybridAStar(config_.warm_start_config()))`，且 `enable_path_planning_thread`（默认 true）另起线程。
- `tasks/open_space_trajectory_optimizer_park/optimizer.{h,cc}` —— 持有 `DualVariableWarmStartProblem` /
  `DistanceApproachProblem` / `IterativeAnchoringSmoother`；由 `open_space_trajectory_optimizer_park.cc` 用
  `OpenSpaceTrajectoryOptimizerParkConfig` 构造，`enable_trajectory_optimize_thread` 默认 true。
- `tasks/open_space_trajectory_provider/open_space_trajectory_optimizer.{h,cc}` —— 旧链同一套算法的老封装。

### 2.2 泊车链路时序（VALET_PARKING_PARK，本轮 read 到的部分）

1. **指令**：`external_command` 侧下发 → `PlanningCommand.parking_command`（含 `parking_spot_id`）进入
   `frame.local_view().planning_command`。
2. **场景切换**：`ValetParkingParkScenario::IsTransferable`（`valet_parking_scenario.cc:58`）依次判
   `has_parking_command()`（`:61`，无则 `AINFO "No parking command from routing"` 返回 false）→
   参考线非空（`:65`）→ 取 `parking_spot_id`（`:70-80`）→
   `SearchTargetParkingSpotOnPath`（`:92`，在参考线 `map_path().parking_space_overlaps()` 里找该 id）→
   `CheckDistanceToParkingSpot`（`:101`，阈值 = `scenario_conf.pb.txt` 的 `parking_spot_range_to_start: 20.0`）→
   命中则写 `context_.target_parking_spot_id`（`:110`）与 `command_sequence_num`（`:111`）。
   `Init` 还会 `LoadConfig<ScenarioValetParkingParkConfig>` 并取 `HDMapUtil::BaseMapPtr()`（`:47-53`，`CHECK_NOTNULL`）。
3. **Stage 1 `VALET_PARKING_APPROACHING_PARKING_SPOT_PARK`**（`StageApproachingParkingSpotPark`）：
   走**常规 on-lane task 链**（pipeline `:5-64`：`OPEN_SPACE_PRE_STOP_DECIDER` + 路径/速度 13 个 task +
   `fallback_task: SMOOTH_STOP_TRAJECTORY_FALLBACK`），停稳后 `next_stage_ = "VALET_PARKING_PARKING_PARK"`
   （`stage_approaching_parking_spot_park.cc:78`，grep 证据）。
4. **Stage 2 `VALET_PARKING_PARKING_PARK`**（`stage_parking_park.cc:28-64`）：
   `frame->mutable_open_space_info()->set_is_on_open_space_trajectory(true)`（`:42`）、写
   `target_parking_spot_id`（`:43-44`）→ **`ExecuteTaskOnOpenSpace(frame)`**（`:45`，跑 §2.1 新链 6 个 task）→
   `open_space_info().destination_reached()`（`:50`）后 `CheckADCParkingCompleted`（`:52`）：
   合格 → `openspace_planning_finish(true)` + `FINISHED`（`:57-60`）；不合格 → `FinishStage`（`:66-78`）
   把 `next_stage_` 置为 `"VALET_PARKING_RETRY_PARK"` 并**清空 4 组 open_space_info 缓存**
   （`optimizer_trajectory_data` / `path_planning_trajectory_result` / `interpolated_trajectory_result` /
   `partitioned_trajectories` / `chosen_partitioned_trajectory`）。
5. **Stage 3 `VALET_PARKING_RETRY_PARK`**（`StageParkingRetryPark`）：task 链与 Stage 2 **完全相同**
   （pipeline `:99-122`），重试一轮。
6. **输出**：轨迹经 `OPEN_SPACE_TRAJECTORY_POST_PROCESS` 落到 `frame->open_space_info()`，
   再由框架汇总发 `/apollo/planning`（含倒车段 gear）。
   ⚠️ **待核**：`Stage::ExecuteTaskOnOpenSpace` 与 `Task::Execute` 的函数体在本机**读不到**
   —— `planning_interface_base` 是纯 binary 包，无 `.cc`（引 15 篇 §4⑤）。因此「open_space_info 如何被写进
   `ADCTrajectory`、失败时如何降级」只能靠头文件签名推断，未在本轮取得代码证据。

## 3. 注册与配置

### 3.1 插件注册

- 场景包 `scenarios/valet_parking_park/plugins.xml`（本轮 `cat`）：一个 library
  `modules/planning/scenarios/valet_parking_park/libvalet_parking_scenario_park.so`，登记 4 个 class ——
  `ValetParkingParkScenario`(base `Scenario`) + `StageApproachingParkingSpotPark` / `StageParkingPark` /
  `StageParkingRetryPark`（base 均为 `apollo::planning::Stage`）。**Scenario 与 Stage 同 so、同一个 plugins.xml**。
- 场景要生效必须出现在 `conf/public_road_planner_config.pb.txt`，且排在 `LANE_FOLLOW` 之前（first-match，引 04 篇）。
  本机第 3 位 = `VALET_PARKING_PARK`。

### 3.2 配置四档（本轮实测的关键结论）

| 档 | 文件 | 谁读 | 生效性 |
|---|---|---|---|
| ① 进程 gflags | `/apollo/modules/planning/planning_component/conf/planning.conf` `:45-55` 共 **11 个 `--open_space_*`**（`delta_t=0.2`、`acc/jerk/kappa/ref_s/ref_v` 权重、`max_forward_v=0.3`、`max_reverse_v=0.3`、`max_forward_acc=1.0`、`max_reverse_acc=0.3`、`max_jerk=2.0`）→ 落点 **profile** | `planning_open_space/coarse_trajectory_generator/hybrid_a_star.cc:84-100` 与 `trajectory_smoother/iterative_anchoring_smoother.cc:595-625`（grep 证据）直接读 `FLAGS_open_space_*` | **全局生效**，两条链、所有泊车场景共享。改这里立即生效（软链写穿 profile） |
| ② task 实例 conf | `/apollo/modules/planning/scenarios/<sc>/conf/<stage 别名小写>/<task 别名小写>.pb.txt` | 各 task `Task::LoadConfig<XxxConfig>` | 生效，**文件名必须等于 pipeline 里 `name` 别名的 tolower**，否则静默走 default（引 15 篇 §4③） |
| ③ task 默认 conf | `/opt/apollo/neo/share/modules/planning/tasks/<task>/conf/default_conf.pb.txt` | 同上（②缺失时） | 生效但会被下次 install 覆盖 |
| ④ `planner_open_space_config.pb.txt` | `/apollo/modules/planning/planning_component/conf/planner_open_space_config.pb.txt`（137 行 → **profile**） | **只有 `planning_open_space/tools/` 三个 wrapper 与各 `*_test.cc`** 通过 `FLAGS_planner_open_space_config_filename` 读（默认值写死在 `planning_gflags.cc:318-321` = 该绝对路径） | ⚠️ **运行期没有任何 task 读它** —— 本轮 `grep -rn planner_open_space_config_filename /opt/apollo/neo/src/modules/` 只命中 tools/tests/gflags 定义三处。**改它只影响 `tools/open_space_visualization/*.py` 离线可视化，不影响实车泊车** |

`planner_open_space_config.pb.txt` 顶层字段（本轮全文 read，行号即该文件）：
`roi_config`(`:1-6`：`roi_longitudinal_range_start/end=15.0`、`parking_start_range=12.0`、`parking_inwards=false`)、
`warm_start_config`(`:7-26`：`xy_grid_resolution=0.3`、`phi_grid_resolution=0.1`、`next_node_num=10`、`step_size=0.5`、
`traj_{forward,back}_penalty=1.0`、`traj_gear_switch_penalty=10.0`、`grid_a_star_xy_resolution=0.5`、`node_radius=0.25`、
内嵌 `s_curve_config`)、`dual_variable_warm_start_config`(`:27-54`：`weight_d`、`ipopt_config`、
**`qp_format: OSQP`**、`min_safety_distance=0.01`、`osqp_config`)、
`distance_approach_config`(`:55-98`：`weight_{steer,a,steer_rate,a_rate,x,y,phi,v,...}`、
`max_speed_forward=2.0`/`reverse=1.0`、`max_acceleration_*`、`min/max_time_sample_scaling`、`ipopt_config`、
**`distance_approach_mode: DISTANCE_APPROACH_IPOPT`**)、
`iterative_anchoring_smoother_config`(`:99-134`：`interpolated_delta_s=0.1`、`reanchoring_trails_num=50`、
`fem_pos_deviation_smoother_config`、`delta_t=0.2`)、`delta_t: 0.5`(`:135`)、
`near_destination_threshold: 0.05`(`:136`)、`enable_linear_interpolation: false`(`:137`)。
**同名子 message 在 task 侧被复用**：`OpenSpacePathPlanningConfig` 只含 `WarmStartConfig`；
`OpenSpaceTrajectoryOptimizerParkConfig` 含 `DualVariableWarmStartConfig`+`DistanceApproachConfig`+`IterativeAnchoringConfig`；
旧链 `OpenSpaceTrajectoryProviderConfig` 里嵌一整份 `planner_open_space_config`（`proto` 注释自称 tmp message）。

### 3.3 本机 valet_parking_park 实例 conf 落点（本轮逐个 readlink）

| 目录 | 文件 | 落点 | 状态 |
|---|---|---|---|
| `valet_parking_approaching_parking_spot_park/` | `open_space_pre_stop_decider.pb.txt` | profile | 生效 |
| `valet_parking_parking_park/` 与 `valet_parking_retry_park/` | `open_space_replan_decider` / `open_space_path_planning` / `open_space_trajectory_post_process` / `open_space_fallback_decider_park` / **`open_space_roi_decider_park`** | profile | 生效（`_park` 那份才是活的） |
| 同上 | `open_space_roi_decider.pb.txt` | **share** | **孤儿**（别名是 `OPEN_SPACE_ROI_DECIDER_PARK`） |
| 同上 | `open_space_trajectory_optimizer.pb.txt` | profile | **孤儿**（别名是 `OPEN_SPACE_TRAJECTORY_OPTIMIZER_PARK`，需文件名 `open_space_trajectory_optimizer_park.pb.txt`——**两个目录都没有这个文件**，故该 task 全靠 `default_conf.pb.txt`） |

即 15 篇 §4③ 那 7 个孤儿 conf 里，**4 个属于泊车链**（两目录 × `roi_decider` + `trajectory_optimizer`），
另 2 个在 `large_curvature/`，1 个在 `square/`。

## 4. 修改与扩展点（二次开发）

**① 调泊车参数（不重编）** —— 先分清要调的是哪一档：
```bash
readlink -f /apollo/modules/planning/scenarios/valet_parking_park/conf/valet_parking_parking_park/open_space_roi_decider_park.pb.txt
```
- ROI 范围 / 感知障碍物开关 / 库位深度缓冲 → 改上面这份（`roi_longitudinal_range_*`、`parking_start_range`、
  `enable_perception_obstacles`、`parking_depth_buffer` 等，字段定义见 `tasks/open_space_roi_decider_park/proto/`）。
- 混合 A\* 栅格/代价 → `.../valet_parking_parking_park/open_space_path_planning.pb.txt` 的 `warm_start_config`。
- 距离逼近权重 / 迭代锚定平滑 → **当前没有生效的实例 conf**（见 §3.3 孤儿），要么新建
  `open_space_trajectory_optimizer_park.pb.txt`（文件名照抄别名小写），要么改
  `/opt/apollo/neo/share/modules/planning/tasks/open_space_trajectory_optimizer_park/conf/default_conf.pb.txt`（会被 install 覆盖）。
- 速度/加速度/jerk 上限与 S 曲线权重 → `planning.conf:45-55` 的 `--open_space_*`（全局）。
- 进场判定距离、位姿误差阈值（超了转 retry）→ `scenarios/valet_parking_park/conf/scenario_conf.pb.txt`
  （本机：`parking_spot_range_to_start: 20.0`、`max_valid_stop_distance: 1.0`、`max_heading_error: 0.08`、
  `max_lat_error: 0.25`、`max_lon_error: 0.15`）。

**② 加一个自定义泊车 task**：
```bash
buildtool create --template planning_task modules/planning/tasks/my_park_task --class_name MyParkTask
buildtool build -p modules/planning/tasks/my_park_task
```
`plugins.xml` 的 `base_class` 必须写 **`apollo::planning::Task`**（最顶层基类，不写 `Decider`）；
然后把 `task { name: "MY_PARK_TASK" type: "MyParkTask" }` 插进
`/apollo/modules/planning/scenarios/valet_parking_park/conf/pipeline.pb.txt` 对应 stage（顺序即执行顺序）；
实例 conf 命名 `my_park_task.pb.txt`（别名 tolower）放进 `conf/valet_parking_parking_park/`。

**③ 加/改一个泊车 stage**：Stage 子类要加进**场景包**（`scenarios/valet_parking_park/`）而不是 task 包 ——
新增 `.h/.cc`（照抄 `stage_parking_park.cc` 的 `Process` + `ExecuteTaskOnOpenSpace` + `next_stage_` 写法，
`Stage` 基类函数体本机不可读，只能照抄现成实现），在同包 `plugins.xml` 追加
`<class type="apollo::planning::MyStage" base_class="apollo::planning::Stage">`，在 `pipeline.pb.txt` 加 `stage{}` 块，
并让上游 stage 的 `next_stage_` 指向它的 `name`（**stage 列表里只有第一条是入口**，引 05 篇）。
改完 `buildtool build -p modules/planning/scenarios/valet_parking_park`。

**④ 改算法本体**（混合 A\*、OBCA、平滑器）：
```bash
buildtool install planning-open-space          # 拉到 /apollo_workspace/modules/planning/planning_open_space（本机已装）
# 改 /apollo_workspace/modules/planning/planning_open_space/...
buildtool build -p modules/planning/planning_open_space
```
本机 ① 层已 install 该包（引 15 篇 §4⑤ 的 8 包清单含 `planning_open_space`）。
**只 `bazel build` 不生效** —— 运行时只读 `/opt/apollo/neo/{lib,share}` 的 install 产物。
纯算法调试可绕开 planning 进程，用 `tools/open_space_visualization/` 的 python 可视化脚本
（它们读的正是 §3.2④ 那份 `planner_open_space_config.pb.txt`）。

## 5. ⚠️ 本环境注意

1. **`_PARK` 后缀别名陷阱（最容易白改）**：profile 把 `valet_parking_park` 的 pipeline 换成了 `_PARK` 版 task，
   share 带来的旧实例 conf（`open_space_roi_decider.pb.txt`、`open_space_trajectory_optimizer.pb.txt`）
   就此**永不被读、无任何报错**（只 AWARN）。改 ROI 参数请改 `open_space_roi_decider_park.pb.txt`；
   距离逼近参数目前**没有任何实例 conf 生效**（§3.3）。
2. **`planner_open_space_config.pb.txt` 对运行期是死配置**：只被 `tools/` wrapper 与单测读
   （`planning_gflags.cc:318-321` 定默认路径）。「调泊车就改这份 conf」是整仓时代的老口径，本机**不成立**。
3. **本机泊车相关注册状态**（引 15 篇 §3.1，本轮 `ls scenarios/` 复核 19 个场景包都在）：
   `VALET_PARKING_PARK` ✅ 已注册（第 3 位）；`FREE_SPACE` ✅ 已注册（profile 新增，走旧 provider 链）；
   `valet_parking`（旧包）❌ 被 `_park` 版替换；`precise_parking` ❌ 未注册；`large_curvature` ❌ 未注册
   （且它自己还带 2 个孤儿 conf）；`park_and_go` ✅ 已注册（第 11 位，只用旧链做起步脱困）。
   要启用 `precise_parking` / `large_curvature`：加进 `public_road_planner_config.pb.txt` 且排在 `LANE_FOLLOW` 之前，
   **不用重编**；但它们的 stage/task 行为未在本机验证。
4. **三方库不用自己装**（本轮 `ldd libapollo_planning_open_space.so` 实证）：
   `libipopt.so.1` → `/opt/apollo/neo/lib/3rd-ipopt/`、`libosqp.so` → `/opt/apollo/neo/lib/3rd-osqp/`
   （对应 `3rd-ipopt`、`3rd-osqp` 两个已装包）；`libadolc.so.2` 来自**系统 apt** `/usr/lib/x86_64-linux-gnu/`
   （cyberfile 写 `libadolc-dev`，`/opt/apollo/neo/packages/` 下无 3rd-adolc）；
   还链了 `3rd-libtorch-gpu` 的 `libtorch_cuda.so`/`libc10_cuda.so` —— **无 GPU 机器上能否加载本轮未验证（待核）**。
5. **地图必须有库位**：`IsTransferable` 靠参考线 `map_path().parking_space_overlaps()` 找 `parking_spot_id`，
   地图无 `parking_space` 则泊车场景**永远进不去**且只有 `AINFO`。本机生效地图
   `/apollo/modules/map/data/apollo_virutal_map/` 的 `base_map.txt` 有 **8 处 `parking_space`**，
   本轮抽到 4 个库位 id（`451089043`–`451089046`）→ 下泊车指令时 `parking_spot_id` 必须是地图里真实存在的 id。
   生效 `--map_dir` 取 `global_flagfile.txt` **最后一行**（引 15 篇 §5），别在 planning conf 里写 `--map_dir`。
6. **改 ④ 层 conf 前一律 `readlink -f`**：planning 子树 127 条指 profile（`current`→`ARCF_40P`）、285 条指 share。
   搜 `/apollo/...` 用 **`grep -R`**（`-r` 不跟随符号链接会假空）。
7. **两个 open_space 线程默认开**：`OpenSpacePathPlanningConfig.enable_path_planning_thread` 与
   `OpenSpaceTrajectoryOptimizerParkConfig.enable_trajectory_optimize_thread` 默认 `true`（本机 conf 也写 true）。
   调试单步/打断点时先在实例 conf 里关掉，否则日志交错、无法复现单帧。

## 6. 验证命令（只读，本轮实跑）

```bash
# 1) 包结构与产物
ls -R /opt/apollo/neo/src/modules/planning/planning_open_space/
ls /opt/apollo/neo/lib/modules/planning/planning_open_space/
ldd /opt/apollo/neo/lib/modules/planning/planning_open_space/libapollo_planning_open_space.so \
  | grep -iE 'ipopt|osqp|adolc|torch'

# 2) 谁在用 open_space（两条链原文）
grep -RIn "OPEN_SPACE\|OpenSpace" /apollo/modules/planning/scenarios/*/conf/pipeline.pb.txt
ls /opt/apollo/neo/src/modules/planning/tasks/ | grep open_space          # 11 个
for d in /opt/apollo/neo/src/modules/planning/tasks/open_space_*; do cat $d/plugins.xml; done

# 3) 泊车实例 conf 落点 + 孤儿判定
cd /apollo/modules/planning/scenarios/valet_parking_park/conf
for f in */*.pb.txt; do printf '%-58s -> %s\n' "$f" "$(readlink -f $f)"; done
grep -n 'name:' pipeline.pb.txt | grep -v '^ *#'          # 别名清单，与文件名 tolower 对齐

# 4) 四档参数现状
grep -n 'open_space' /apollo/modules/planning/planning_component/conf/planning.conf   # :45-55
readlink -f /apollo/modules/planning/planning_component/conf/planner_open_space_config.pb.txt
grep -rn "planner_open_space_config_filename" /opt/apollo/neo/src/modules/ | grep -v _test.cc

# 5) 地图库位（没有库位 = 泊车场景永不进入）
grep -c 'parking_space' /apollo/modules/map/data/apollo_virutal_map/base_map.txt      # 8
grep -A4 'parking_space {' /apollo/modules/map/data/apollo_virutal_map/base_map.txt | grep 'id:'
```

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线 Apollo 11.0.0 package 工作区，profile = `ARCF_40P`。
  全程只读，**未启动任何模块、未编译**。
- **本轮 read 打开**（可引行号）：`hybrid_a_star.h`(40–119、135–166)、`distance_approach_problem.h`(43–82)、
  `valet_parking_scenario.cc`(30–119)、`stage_parking_park.cc`(26–85)、`planning_gflags.cc`(314–327)、
  ④ `valet_parking_park/conf/pipeline.pb.txt`(全 123)、④ `planner_open_space_config.pb.txt`(全 137)、
  本工程 `15_本环境运行现状.md`(全 285)、`_template.md`(全 56)。
- **本轮只读命令证据**（非 read，故文中不带行号）：`ls -R planning_open_space/`；`ls tasks/ | grep open_space`；
  各 open_space task `plugins.xml` + `valet_parking_park/plugins.xml` `cat`；
  `grep -RIn OPEN_SPACE .../scenarios/*/conf/pipeline.pb.txt`；
  `grep -rln HybridAStar|DistanceApproachProblem|IterativeAnchoringSmoother|DualVariableWarmStartProblem`（19 文件）；
  `grep -n` 三个 task 的 `Init/LoadConfig` 行、`FLAGS_open_space_*` 消费点、
  `planner_open_space_config_filename` 全 src 消费点；`cat` 4 个 task proto/default_conf 与
  `scenario_conf.pb.txt`、`free_space/conf/pipeline.pb.txt`；`readlink -f` valet_parking_park 三个 conf 目录共 15 个文件；
  `ls -R free_space/conf`、`ls scenarios/`（19）、`ls park_data_center/`；`cat cyberfile.xml`、`grep -n deps BUILD`；
  `ldd` 产物；`ls /opt/apollo/neo/packages/3rd-{ipopt,osqp}`、`ls /usr/lib/x86_64-linux-gnu/libadolc*`；
  `grep -c parking_space base_map.txt`（8）+ 4 个库位 id。
- **引他篇未重复核对**：15 篇（profile 落点 127/285、13 scenario 注册表、7 个孤儿 conf、`planning_interface_base` 无 `.cc`、
  `--map_dir` 末行规则）、04 篇（first-match 与 `LANE_FOLLOW` 兜底）、05 篇（stage 入口与 `next_stage_`）、
  06 篇（task 别名 tolower 规则）、09 篇（conf 四层与 `ConfigUtil` 静默降级）。
  `.manual_work/inventory/planning_inventory.md` **本轮未打开**，相关数字均经 15 篇转引。
- **遗留待核**：① `Stage::ExecuteTaskOnOpenSpace` / `Task::Execute` 函数体本机不可读（binary 包），
  open_space_info → `ADCTrajectory` 的汇总逻辑无代码证据；② `IterativeAnchoringSmoother` 的
  `Smooth/SmoothPath/SmoothSpeed` 签名只 grep 未 read；③ 各 task `.cc` 的 `Init/Process` 行号未 read 核对；
  ④ 链接 `libtorch_cuda` 的产物在无 GPU 机器上能否加载未验证；⑤ `precise_parking`/`large_curvature`
  启用后的实际行为、以及 `park_data_center` 包在泊车链中的角色未追（该包 src 存在，本轮只 `ls`）；
  ⑥ 全部运行期现象（是否真出泊车轨迹、频率、retry 触发）未验证。
