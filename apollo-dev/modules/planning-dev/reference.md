# Apollo Planning 参考手册

配套 `SKILL.md`。全部内容源自代码精读，file:line 可直接跳转。

> ## ⚠️ 本环境（包工作区）路径口径
>
> 本文所有形如 `modules/planning/xxx.cc:NN` 的引用，在本环境要按用途选树：
>
> | 你要干什么 | 去哪 |
> |---|---|
> | 读 `.cc` 实现 | `/opt/apollo/neo/src/modules/planning/...` |
> | 读 `.h` 声明 | `/opt/apollo/neo/include/modules/planning/...`（**src/ 不完整，二进制包只发头文件**） |
> | 改 conf / dag / launch 且要立即生效 | `/apollo/modules/planning/...`（文件是指向 share/ 的符号链接） |
> | 改代码 | `/apollo_workspace/modules/planning/...`（需 `buildtool install planning` 先拉下来），改完 `buildtool build -p <path>` |
>
> **grep 找不到某个类 ≠ 这个类被删了** —— 先在两棵树里都搜：
> ```bash
> S=/opt/apollo/neo/src/modules/planning; I=/opt/apollo/neo/include/modules/planning
> grep -rn "class YourClass" $S $I
> ```
> 判断某个插件「到底装没装」要看 `/opt/apollo/neo/lib/modules/planning/<类别>/<名字>/`
> 与 `/opt/apollo/neo/share/cyber_plugin_index/`，**不要看 `bazel-bin`**
> （本环境 `APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`，那一步不发生）。

## 1. 35 个 Task 速查（目录省略 `modules/planning/tasks/` 前缀）

### 1.1 路径生成类（10 个，基类 `PathGeneration`）

| 目录 / 类名 | 作用 | 写什么 | 挂在哪 |
|---|---|---|---|
| `lane_follow_path` `LaneFollowPath` | 自车道边界 + 静态障碍收窄 → piecewise-jerk 横向 QP | `path_data`(label `regular/self`)、`CandidatePathData`、`obs_sl_polygons_` | lane_follow、valet_parking、pull_over 等多数 stage |
| `lane_borrow_path` `LaneBorrowPath` | 并入相邻车道边界，左右各生成候选后 `ComparePathData` 择优 | `path_data`(label `regular/{left\|right}{forward\|reverse}`) | lane_follow、valet_parking approach |
| `lane_borrow_path_generic` `LaneBorrowPathGeneric` | 借道 + nudge 融合版，nudge 关键点直接改写 boundary | 同上 + `CandidatePathData`、`is_nudge_bound[]` | park 系 pipeline |
| `lane_change_path` `LaneChangePath` | 变道状态机（freeze time）+ 禁区挖除 | `path_data`(`regular/lane_change`)、`change_lane` status | lane_follow 首个 task |
| `lane_change_path_generic` `LaneChangePathGeneric` | 变道 + nudge 版（不写 candidate） | 同上 | park 系 |
| `pull_over_path` `PullOverPath` | 沿路沿搜容整车的纵向窗口作停车位 | `path_data`(label 默认 `regular`)、`pull_over` status | pull_over、emergency_pull_over |
| `square_path` `SquarePath` | 用 junction 多边形**放宽**自车道边界 | `CandidatePathData`（无条件）、`path_data`（仅 Empty 时） | square（未注册） |
| `reverse_path` `ReversePath` | boundary `delta_s` 取负向后延伸做优化 | `path_data`（**完全无守卫，无条件覆盖**） | 倒车链路 |
| `fallback_path` `FallbackPath` | 只用自车道 + ADC 扩展（**完全不看障碍物**） | `path_data`(`fallback/self`) | 几乎所有 on-lane stage |
| `reuse_path` `ReusePath` | 上帧路径无新碰撞则重对齐 s 复用 | `set_path_reusable()` | **不在任何 pipeline**，故 `path_reusable_` 恒 false |

### 1.2 路径决策类（2 个，基类 `Task`）

| 目录 / 类名 | 作用 | 写什么 |
|---|---|---|
| `path_decider` `PathDecider` | 按"纵向不在 s 范围 / 横向太远 / 横向重叠 / 横向很近"给静态障碍打 ignore/stop/nudge（7 个 tag） | Obstacle 决策、`front_static_obstacle_{id,cycle_counter}`、`MergeWithMainStop`（`cc:216-219`） |
| `path_reference_decider` `PathReferenceDecider` | 校验学习模型轨迹是否落在 regular boundary 内 | `set_path_reference()`。**不在任何 pipeline，且下游无读者** |

### 1.3 速度决策类（4 个）

| 目录 / 类名 | 基类 | 作用 |
|---|---|---|
| `speed_bounds_decider` `SpeedBoundsDecider` | `Decider` | 障碍物在已规划路径上的碰撞区间投影成 ST 多边形 + 叠加限速 → `StGraphData`。**在 lane_follow 中出现两次** |
| `st_bounds_decider` `STBoundsDecider` | `Decider` | 沿 t 轴 0.1s sweep-line 收缩出唯一 ST 走廊，写 `SetSTDrivableBoundary`。conf 只有一行 `total_time: 7.0`，其余硬编码 |
| `speed_decider` `SpeedDecider` | `Task` | DP 曲线 s(t) 与障碍 ST 边界做 ABOVE/BELOW/CROSS 判定 → 6 个纵向决策 tag |
| `reverse_speed` `ReverseSpeed` | `Task`（override 双参 `Execute`） | 倒车链自建 ST 图，几何重叠即 STOP，**不做速度优化** |

### 1.4 速度优化类（3 个，基类 `SpeedOptimizer`）

| 目录 / 类名 | 作用 |
|---|---|
| `path_time_heuristic` `PathTimeHeuristicOptimizer` | (t,s) 栅格逐列 DP，产出 `speed_data`（**只有 s/t/v，a 与 da 恒 0**，`gridded_path_time_graph.cc:563-569`） |
| `piecewise_jerk_speed` `PiecewiseJerkSpeedOptimizer` | Δt=0.1s knots 上以 s 为状态、jerk 为控制的凸 QP（OSQP），精修 DP 结果 |
| `piecewise_jerk_speed_nonlinear` `PiecewiseJerkSpeedNonlinearOptimizer` | QP warm start + IPOPT NLP（含向心加速度）。**pipeline 中全为注释状态** |

### 1.5 开放空间类（11 个）

| 目录 / 类名 | 流水线 | 作用 |
|---|---|---|
| `open_space_pre_stop_decider` | A/B 共用 | 把目标车位/靠边点投到参考线求 s，插虚拟停车墙（id `"OPEN_SPACE_PRE_STOP"`）。conf 是**空文件** |
| `open_space_replan_decider` | B | 上帧无轨迹且车已停 → `set_replan_flag`。proto message 本身为空 |
| `open_space_roi_decider` | A | 路沿关键点折线 + 车位四边缝成闭合边界，归一化后转 `Ax > b` |
| `open_space_roi_decider_park` | B | 同上 + LARGE_CURVATURE 分支与 `soft_boundary_vertices_vec` |
| `open_space_trajectory_provider` | A | Hybrid A* + distance approach / iterative anchoring + 与上帧 stitching（**A 独有**） |
| `open_space_path_planning` | B | 只跑 Hybrid A* 求粗路径，不平滑 |
| `open_space_trajectory_optimizer_park` | B | 粗路径按档位切段，逐段 IPOPT 平滑 |
| `open_space_trajectory_partition` | A | 按档位切段 + IoU 优先队列选跟踪段；**回写 stitching** |
| `open_space_trajectory_post_process` | B | 同 partition 但不回写 stitching，匹配失败清空 5 个字段触发重规划 |
| `open_space_fallback_decider` | A | 预测框 vs ego box 碰撞 → `fallback_flag`/`fallback_trajectory` |
| `open_space_fallback_decider_park` | B | 静态碰撞走重规划、动态走减速；**不写 `fallback_flag`/`stop_flag`** |

### 1.6 其他（5 个）

| 目录 / 类名 | 基类 | 作用 |
|---|---|---|
| `rule_based_stop_decider` | `Decider` | 三类规则插停车墙：`"lane_change_stop"` / `"PATH_END_"+label` / `"Side_Pass_Stop"` |
| `rss_decider` | `Task` | ad_rss 单车道世界模型；`enable_rss_fallback` 且不安全时 **清空 `speed_data`** |
| `obstacle_nudge_decider` | `Task` | 跨帧多边形跟踪，概率 > 0.8 生成绕行关键点，写 **`ParkDataCenter::Instance()`**（不写 RLI） |
| `fast_stop_trajectory_fallback` | `TrajectoryFallbackTask` | `stop_distance` 为 x_ref 解 PiecewiseJerkSpeed，失败降级常减速。**无 conf、无 proto** |
| `smooth_stop_trajectory_fallback` | `TrajectoryFallbackTask` | 解析 S 型速度曲线 + ST 碰撞检查 + jerk 二分。**无 conf、无 proto** |

## 2. 19 个 Scenario 速查

「注册」= 是否在 `planning_component/conf/public_road_planner_config.pb.txt` 里（该文件顺序即优先级）。

| 目录 / 类名 | 注册 | 进入条件（IsTransferable 摘要） | stage 列表（pipeline 顺序） |
|---|---|---|---|
| `emergency_pull_over` `EmergencyPullOverScenario` | Y ① | 有参考线 且 `GetPadMsgDrivingAction()==PULL_OVER` | SLOW_DOWN → APPROACH → STANDBY |
| `emergency_stop` `EmergencyStopScenario` | Y ② | `GetPadMsgDrivingAction()==STOP`（**不查参考线**） | APPROACH → STANDBY |
| `valet_parking` `ValetParkingScenario` | Y ③ | 有 `parking_command` + 车位在参考线 overlap 上 + 沿参考线 s 距离 < `parking_spot_range_to_start` | APPROACHING_PARKING_SPOT → PARKING |
| `bare_intersection_unprotected` | Y ④ | 首个 overlap 有 PNC_JUNCTION 且无 SIGNAL/STOP_SIGN/YIELD_SIGN；有转向；距路口 ≤ 阈值 | APPROACH → INTERSECTION_CRUISE |
| `stop_sign_unprotected` | Y ⑤ | 首个 overlap 是 STOP_SIGN；0 < 距停止线 ≤ 阈值 | PRE_STOP → STOP → CREEP → INTERSECTION_CRUISE |
| `yield_sign` | Y ⑥ | 首个 overlap 是 YIELD_SIGN；距离在阈值内 | APPROACH → CREEP |
| `traffic_light_unprotected_left_turn` | Y ⑦ | 首个 overlap 是 SIGNAL；同组灯非 GREEN/BLACK；`GetPathTurnType==LEFT_TURN` | APPROACH → CREEP → INTERSECTION_CRUISE |
| `traffic_light_unprotected_right_turn` | Y ⑧ | 同上但要求 `RIGHT_TURN` | STOP → CREEP → INTERSECTION_CRUISE |
| `traffic_light_protected` | Y ⑨ | 同上，**不查 turn_type** | APPROACH → INTERSECTION_CRUISE |
| `pull_over` `PullOverScenario` | Y ⑩ | `FLAGS_enable_pull_over_at_destination`；终点在车道上；只有 1 条参考线；距终点在窗口内；终点前后 8m 无路口/灯/停让 | APPROACH → RETRY_APPROACH_PARKING → RETRY_PARKING |
| `park_and_go` `ParkAndGoScenario` | Y ⑪ | 车速 < `max_abs_speed_when_stopped`；距终点 > `min_dist_to_dest`；不在车道上或车道非 CITY_DRIVING | CHECK →(成功) CRUISE /(失败) ADJUST → PRE_CRUISE → CRUISE |
| `lane_follow` `LaneFollowScenario` | Y ⑫ | 有 lane_follow_command 且参考线非空 → **几乎恒真（兜底）** | LANE_FOLLOW_STAGE（唯一，永不 FINISHED） |
| `valet_parking_park` | — | 同 valet_parking，额外记 `command_sequence_num` | APPROACHING_PARKING_SPOT_PARK → PARKING_PARK →(精度不足) RETRY_PARK |
| `free_space` `FreeSpaceScenario` | — | `custom_command` 可 UnpackTo `FreeSpaceCommand`；车已停；有逆时针 `drivable_roi` | STAGE_FREE_SPACE |
| `large_curvature` | — | 前方 3m 参考点 `abs(kappa) > 1/min_turn_radius * curvature_ratio` | LARGE_CURVATURE（`scenario_conf` 是**空文件**） |
| `square` `SquareScenario` | — | 恰好 1 条参考线；自车 SL 边界完全落在 junction 内 | SQUARE_LANE_FOLLOW ↔ EXTRICATE（互相回跳） |
| `lane_escape` | — | `ParkDataCenter::Instance()->is_need_escape()` | **无 pipeline 文件 ⇒ 一旦注册立即崩** |
| `lane_follow_park` | — | 同 lane_follow（恒真） | **无 pipeline 文件** |
| `precise_parking` | — | `custom_command` 可 UnpackTo `PreciseParkingCommand` | **无 pipeline 文件** |

四个可复用 Stage 基类在 `planning_interface_base/scenario_base/`：`BaseStageCreep`、
`BaseStageCruise`、两个 traffic_light 变体。`pipeline` 里 `enabled: false` **框架层不检查**，
只有 stop_sign creep、yield_sign creep、left_turn creep、left_turn approach 四个 stage 手工读它。

## 3. 10 条 TrafficRule 速查

现场核对：`traffic_rule_config.pb.txt` 只列了 9 条，`speed_setting` 未注册。

| 规则 / 类 | 产出 | 触发主判据 | 返回非 OK？ | 启用 |
|---|---|---|---|---|
| `backside_vehicle` `BacksideVehicle` | 对后方来车打 `ignore`（纵+横），**不插桩不限速** | 车道保持参考线 + 障碍物在自车后方 | 否 | 是 |
| `crosswalk` `Crosswalk` | `"CW_"+id` stop 栅栏 | crosswalk overlap + 行人/自行车在膨胀多边形内 | 否 | 是 |
| `destination` `Destination` | `FLAGS_destination_obstacle_id` stop 栅栏 | `frame->is_near_destination()` | 否（**吞掉 int 返回值**） | 是 |
| `keepclear` `KeepClear` | 虚拟**静止障碍物** + ST 标 `KEEP_CLEAR` | clear_area overlap / pnc_junction | 否 | 是 |
| `reference_line_end` `ReferenceLineEnd` | `"REF_END_"+laneId` stop（**唯一手工构造 `ObjectDecisionType`**） | 参考线剩余长度 < 阈值 | 是（2 种，**被吞**） | 是 |
| `rerouting` `Rerouting` | 触发重路由请求 | 换道失败且当前 passage 不能 exit | 是（**被吞**） | 是 |
| `stop_sign` `StopSign` | `"SS_"+id` stop 栅栏（用 `AdcSlBoundary().start_s()`） | stop_sign overlap 未通过且未 done | 否 | 是 |
| `traffic_light` `TrafficLight` | `"TL_"+id` stop 栅栏 | signal overlap + 灯色非 GREEN/**BLACK** | 否 | 是 |
| `yield_sign` `YieldSign` | `"YS_"+id` stop 栅栏（用 `end_s()`，与 StopSign 相反） | yield_sign overlap 未通过且未 done | 否 | 是 |
| `speed_setting` `SpeedSetting` | `SetCruiseSpeed(...)` | 收到 `SpeedCommand` | 是 | **否（孤儿：无 proto、无 conf、未注册）** |

注意：10 个规则都**没给 `ApplyRule` 加 `override`**（隐式虚覆盖），多处 `.cc` 定义还丢了参数
的 `const`。`Reset()` 只有 `Crosswalk`（清 `crosswalk_overlaps_`）与 `Rerouting`（清成员指针）
有实际动作，其余 8 条空实现。目录名不一致：目录 `keepclear/`、文件 `keep_clear.h/.cc`。

## 4. Planner（**本环境只剩 1 个**）

> **⚠️ 本环境现场核对**：`/opt/apollo/neo/lib/modules/planning/planners/`、
> `/opt/apollo/neo/src/modules/planning/planners/`、
> `/opt/apollo/neo/include/modules/planning/planners/`、
> `/apollo/modules/planning/planners/` **四处都只有 `public_road`**，
> `share/cyber_plugin_index/` 里也只有 `...planners__public_road__libpublic_road_planner.so` 一条。
> 下面 `lattice` / `navi` / `rtk` 三行**仅作历史参考**（整仓形态或旧版本才有），
> 在本环境改 `planning_config.pb.txt` 的 `planner:` 指向它们只会加载失败。

| planner | 说明 |
|---|---|
| `public_road` `PublicRoadPlanner` | **本环境唯一可用**，也是唯一走 scenario/stage/task 流水线的。含 `ScenarioManager`（`scenario_manager.cc:33-54` Init、`:56-76` Update）。配置 `PlannerPublicRoadConfig` 只有 `repeated PluginDeclareInfo scenario = 1` |
| ~~`lattice` `LatticePlanner`~~ | **本环境不存在**。历史行为：七步采样-评价法：参考线离散 → 投影起点 → Frenet 初态 → `PathTimeGraph` → `GenerateTrajectoryBundles` → `TrajectoryEvaluator` 排序 → `Combine` + `ConstraintChecker` + 碰撞检查。无 conf、无 proto，全部可调项是 gflags（`cost_non_priority_reference_line`、`speed_lon_decision_horizon`、`trajectory_time_length`、`enable_backup_trajectory`、`backup_trajectory_cost`）—— **这几个 gflag 在本环境仍然存在于 `planning_gflags.cc`，但已无人读** |
| ~~`navi` `NaviPlanner`~~ | **本环境不存在**，但 `planning_component/conf/` 下**留着 `navi_planner_config.pb.txt` 与 `planning_navi.conf` 两个孤儿 conf**（改了没效果，别照抄）。历史行为：task 自成一套 `NaviTask`，不走 PluginManager，本地 `Factory` 只注册 2 个（`NAVI_PATH_DECIDER`、`NAVI_SPEED_DECIDER`）；`NaviObstacleDecider` 是 `NaviPathDecider` 的成员而非独立 task；`AddTrafficDecisionConstraints` 空实现 ⇒ navi 模式交通规则约束未实现 |
| ~~`rtk` `RTKReplayPlanner`~~ | **本环境不存在**（循迹回放改用 `rtk_player` / `rtk_recorder` 裸命令，见 `apollo-debug` 第七节）。历史行为：`Init` 无条件返回 OK（文件打不开也成功，故障延迟到首次 Plan）；CSV 解析用 `ByAnyChar("\t ")` 切逗号数据，靠 `stod` 忽略尾随逗号才能工作；中间空行会静默截断后续数据 |

切换 planner：改 `planning_config.pb.txt` 加 `planner: "XxxPlanner"`（无该字段则默认
PublicRoadPlanner），配置实际生效的是 `planning_component/conf/` 下那份而非插件目录里的。
**本环境这个字段只有一个合法值**，等于没得可切。

## 5. Frame 关键成员（`planning_base/common/frame.h:62`）

生命周期：`OnLanePlanning::InitFrame()` 里 `frame_.reset(new Frame(...))`
（`on_lane_planning.cc:165`），帧末 `injector_->frame_history()->Add(...)`（`:453`，异常路径 `:358`）。

- `sequence_num_`(:208)、`local_view_`(:209)、`planning_start_point_`(:211)
- `std::list<ReferenceLineInfo> reference_line_info_`(:213) —— **是 list 不是 vector**，
  因为 task 持有元素指针，扩容不能失效
- `drive_reference_line_info_`(:220)：`FindDriveReferenceLineInfo()` 缓存（选 cost 最小）
- `ThreadSafeIndexedObstacles obstacles_`(:222)：全帧障碍物总表
- `current_frame_planned_trajectory_`(:228)、`open_space_info_`(:235)

**Init 顺序是硬契约**（`frame.cc:334-356`）：`InitFrameData()` → `CreateReferenceLineInfo()`
→ 存 `future_route_waypoints_`。`InitFrameData()`（`:364-402`）内部：hdmap + CHECK_NOTNULL →
vehicle_state 校验 → 可选 AlignPredictionTime → `CreateObstacles` → **仅当
`planning_start_point_.v() < 1e-3` 才做 `FindCollisionObstacle`**（`:386-395`）→
`ReadTrafficLights()`(:492) → `ReadPadMsgDrivingAction()`(:526)。

虚拟障碍物创建入口（**加停车墙必用**）：`CreateStopObstacle(rli, id, s, width)`
（`frame.h:113` / `frame.cc:214-231`，长 `FLAGS_virtual_stop_wall_length`=0.1m）、
`CreateStopObstacle(id, lane_id, lane_s)`（`frame.cc:237-269`，宽度自动取 lane 宽）。
二者都走 `CreateStaticVirtualObstacle`（`:319`）。

## 6. ReferenceLineInfo 关键成员（`reference_line_info.h:56`）

**这是 task 的主要读写对象**。Frame 为每条 ReferenceLine 造一个（`frame.cc:147`），不跨帧。

字段：`reference_line_`(:328)、`path_decision_`(:338)、`path_data_`/`fallback_path_data_`(:348-349)、
`speed_data_`(:350)、`discretized_trajectory_`(:352)、`st_graph_data_`(:392)、
`candidate_path_boundaries_`/`candidate_path_data_`(:342-343)、`cost_`(:334)、
`obs_sl_polygons_`(:403)、`trajectory_type_`(:379)。

| API | 行 | 谁写 |
|---|---|---|
| `AddObstacle(const Obstacle*)` | `:69` | traffic rule / decider 加虚拟墙后**必须调**，返回本参考线内的副本指针 |
| `mutable_path_data()` / `mutable_speed_data()` | `:135,137` | path / speed 优化 task |
| `SetCandidatePathBoundaries` / `SetCandidatePathData` | `:204,209` | path 生成 task |
| `SetBlockingObstacle(id)` | `:212` | path_decider / path task |
| `SetDrivable(bool)` / `IsDrivable()` | `:173-174` | traffic_decider 判定失败后置 false（`on_lane_planning.cc:365-366`） |
| `SetCost(double)` | `:89` | planner 打分，`FindDriveReferenceLineInfo` 选最小 |
| `set_trajectory_type()` | `:225` | 决定发布的 `ADCTrajectory::trajectory_type` |
| `CombinePathAndSpeedProfile(...)` | `:142` | path + speed → `discretized_trajectory_` |
| `mutable_st_graph_data()` | `:234` | st_boundary 构造类 task |

**两个必须知道的坑**：① `AddObstacle` 返回的是**本参考线内的拷贝**（`path_decision_.AddObstacle`），
与 `Frame::obstacles_` 里的对象**不是同一个** —— 在 A 参考线上加的决策不会出现在 B 上，把
`Frame::Find(id)` 的指针存下来当决策载体是错的。② `ReferenceLineInfo::Init` 里就建好了所有
SL boundary，所以**任何在 `Frame::Init` 之后新增到 Frame 的障碍物都不会自动出现在已有的
ReferenceLineInfo 中**，必须显式 `AddObstacle`（这就是 `util::BuildStopDecision` 两步走的原因）。

## 7. lane_follow 11-task 逐条写读表

基准 `scenarios/lane_follow/conf/pipeline.pb.txt`（现场核对）。

| # | task（pipeline name） | 写 | 读 / 守卫 |
|---|---|---|---|
| 1 | LANE_CHANGE_PATH | `path_data`(仅变道参考线)、`change_lane{status,path_id,timestamp}`、`Obstacle::SetLaneChangeBlocking` | 失败 → PLANNING_ERROR 直接 break 整条 pipeline |
| 2 | LANE_FOLLOW_PATH | `path_data`(`regular/self`)、`CandidatePathData`、`SetBlockingObstacle`、`obs_sl_polygons_`、`lane_follow{block_*}` | 守卫 `path_data().Empty() && !path_reusable()`（`cc:49-55`） |
| 3 | LANE_BORROW_PATH | `path_data`(`regular/{left\|right}{forward\|reverse}`)、`obs_sl_polygons_`、`is_in_path_lane_borrow_scenario` | **无 Empty 守卫，成功即覆盖 ②**（`cc:80`） |
| 4 | FALLBACK_PATH | `path_data`(`fallback/self`)（`cc:167`） | 守卫 `Empty() && !IsChangeLanePath()`（`cc:45-48`） |
| 5 | PATH_DECIDER | Obstacle 的 7 个决策 tag、`front_static_obstacle_{id,cycle_counter}`（`cc:84-100`）、`main_stop_`/`stop_reference_line_s_`（`cc:216-219`） | `path_data().frenet_frame_path()`、`GetBlockingObstacle()`、`AdcSlBoundary` |
| 6 | RULE_BASED_STOP_DECIDER | 三类停车墙 id：`"lane_change_stop"` / `"PATH_END_"+label` / `"Side_Pass_Stop"` | `path_data`、`AdcSlBoundary`、`Cost()`、`IsChangeLanePath()` |
| 7 | SPEED_BOUNDS_PRIORI_DECIDER | `EraseStBoundaries()`(`cc:68`) → `set_path_st_boundary`(`st_boundary_mapper.cc:161/189/469`) → `LoadData` 8 参(`cc:125-127`) | `path_data()`、`GetCruiseSpeed()`、`PlanningStartPoint()` |
| 8 | SPEED_HEURISTIC_OPTIMIZER | `speed_data`（**只有 s/t/v**，`gridded_path_time_graph.cc:563-569`） | `st_graph_data()` 全字段 |
| 9 | SPEED_DECIDER | 6 个纵向决策 tag（`speed_decider.cc:227-347`） | `speed_data` + 各 Obstacle `path_st_boundary()`(`cc:229`) |
| 10 | SPEED_BOUNDS_FINAL_DECIDER | 再 Erase + 按 ⑨ 决策重画带类型边界（stop→`MapStopDecision`；follow/yield→`ExpandByS`；overtake→只设类型；**ignore→什么都不做**） | 同 ⑦ + `HasLongitudinalDecision()` |
| 11 | PIECEWISE_JERK_SPEED | `speed_data`（完整 s/t/v/a/jerk）、`st_graph_debug` | `st_graph_data()`，靠 `boundary_type()` 分支(`cc:104-118`)、入参 speed_data 作 `x_ref` |

`StGraphData::LoadData` 8 参（`st_graph_data.h:42-47`）：boundaries（**指向各 Obstacle 内部
`path_st_boundary_` 的裸指针**）、`min_s_on_st_boundaries`（**全仓无读者，死数据**）、init_point、
speed_limit、cruise_speed、path_data_length、total_time_by_conf、st_graph_debug。
`LoadData` **不触碰 `st_drivable_boundary_`**，所以 STBoundsDecider 的产物不会被覆盖。

部分场景在 ⑦ 之前插 `ST_BOUNDS_DECIDER`（`scenarios/pull_over/conf/pipeline.pb.txt:75-77`、
`park_and_go/conf/pipeline.pb.txt:89-91`）。

**PRIORI→DP→SpeedDecider→FINAL 的闭环接口**：FINAL 轮反读 SpeedDecider 写入的数值 ——
`st_boundary_mapper.cc:449` ← `speed_decider.cc:423`（follow distance_s，负值）、`:455` ← `cc:459`
（yield）、`:460` ← `cc:496`（overtake）、`:96/130` ← `cc:387-390`（stop_point）。

## 8. openspace 流水线与坐标系契约

数据全部在 `Frame::open_space_info_`（`planning_base/common/open_space_info.h`），
**与 ReferenceLineInfo 无关**。两条功能等价但实现独立的流水线：

**A（provider 路线，4 task）**：`OpenSpaceRoiDecider → OpenSpaceTrajectoryProvider →
OpenSpaceTrajectoryPartition → OpenSpaceFallbackDecider`。
用于 `valet_parking`（现场核对 `conf/pipeline.pb.txt` stage 2 `VALET_PARKING_PARKING`）、
`free_space`、`pull_over`(RETRY_PARKING)、`park_and_go`。

**B（park 路线，6 task）**：`OpenSpaceReplanDecider → OpenSpaceRoiDeciderPark →
OpenSpacePathPlanning → OpenSpaceTrajectoryOptimizerPark → OpenSpaceTrajectoryPostProcess →
OpenSpaceFallbackDeciderPark`。用于 `valet_parking_park`（2 个 stage）、`large_curvature`。

A 的 provider 一个 task 干了 B 里 path_planning（Hybrid A*）+ optimizer_park（IPOPT）两件事；
A 的 partition ≈ B 的 post_process，但**只有 A 做 stitching**。

关键字段写读：`obstacles_vertices_vec`/`obstacles_A`/`obstacles_b`（roi_decider 写，provider /
path_planning / optimizer 读）、`open_space_end_pose`、`ROI_xy_boundary`、
`soft_boundary_vertices_vec`（**只有 park 版写**）、`replan_flag`（`open_space_replan_decider.cc:50/52`
唯一写者）、`path_planning_trajectory_result`、`optimizer_trajectory_data`、
`stitched_trajectory_result`、`partitioned_trajectories`、`chosen_partitioned_trajectory`
（**`stage.cc:243-246` 正常分支的发布源**）、`fallback_trajectory`（`stage.cc:233-234` fallback 分支）、
`fallback_flag`/`stop_flag`（`stage.cc:231-232` 读）、`publishable_trajectory_data`
（**唯一写者 `stage.cc:240-241`/`:252-253`**）。

**B 流水线的重要后果**：`OpenSpaceFallbackDeciderPark` **完全不写 `fallback_flag`/`stop_flag`**，
所以 `stage.cc:231` 恒走 else 用 `chosen_partitioned_trajectory`；它写的 `fallback_trajectory`
（`cc:369-370`）**永远不会被发布**。

**坐标系契约（最容易出错）**：Hybrid A* 与 NLP 全部工作在**以停车位左上角为原点、以停车位上沿
方向为 x 轴**的局部系。转换由 `SetOrigin`（`open_space_roi_decider.cc:224-246`，
`origin_heading = (right_top - left_top).Angle()`）定义；正/反变换是
`OpenSpaceTrajectoryOptimizerUtil::PathPointNormalizing` / `PathPointDeNormalizing`
（`planning_open_space/utils/open_space_trajectory_optimizer_util.cc:85-111`）。Optimizer 在入口
Normalizing（`open_space_trajectory_optimizer.cc:103`）、出口 DeNormalizing（`:276-280`）。
`open_space_end_pose`（4 元 [x,y,phi,v]）与 `ROI_xy_boundary` 都**已归一化**。
**新增任何几何量都必须自问它在哪个系里。**

**矩阵形状契约**：`horizon = xWS.cols()-1`；`state_result.cols() == time_result.cols()+1
== control_result.cols()+1`（`optimizer.cc:483-484` 的两个 `CHECK_EQ` 会直接 crash）。
**ego 向量顺序契约**：`ego = [front_edge_to_center, right_edge_to_center, back_edge_to_center,
left_edge_to_center]`（`optimizer.cc:562`）—— **顺序写错不报错，只会让避障约束用错车身尺寸**。

**valet_parking 的关键交接点**（`scenarios/valet_parking/stage_parking.cc:30-34`）：
`set_is_on_open_space_trajectory(true)` + `mutable_target_parking_spot_id()`，后者是 ROI Decider
`Process()` 唯一的输入（`open_space_roi_decider.cc:81`）。Provider 对 valet_parking 有特殊处理
（`provider.cc:171-178`）：`target_parking_spot_id != ""` 时把 end_pose 沿其 heading 外推
`straight_trajectory_length_`，即"先规划到车位外延长点，再直线倒入"。

**openspace 分阶段日志锚点**：
- ROI 失败：`"Fail to get parking boundary from map"`（roi_decider.cc:84/98/105/115）、
  `"ADC initial position is unavailable"`(:130)、`"chosen open space roi secenario type not
  implemented"`(:164，roi_type 配成未实现的 `NARROW_STREET_U_TURN`/`DEAD_END`)。
- Hybrid A*：`"start_node in collision with obstacles"`（hybrid_a_star.cc:765，**自车当前位置就
  与边界相交**）、`"end_node in collision"`(:771，end_pose 算错或车位太小，常调大
  `parking_depth_buffer`)、`"Hybird A* cannot find a valid path"`(:861，看紧随的统计日志 :866-877)。
- Dual warm start：`"Dual variable problem failed to solve"`（optimizer.cc:580）。
- Distance Approach：`"Distance approach problem failed to solve"`（optimizer.cc:597）+
  `"Solver failure case: <名称>"`（distance_approach_problem.cc:247，码表 :224-242）。
- Iterative Anchoring：`"Maximum iteration reached, path smoother early stops"`(:438) 是
  **返回 true 的假成功**，见到要当"可能碰撞"处理。
- 分段/执行：`"Fail to find nearest trajectory point to follow"`（partition.cc:211）、
  车停住不动 → `InsertGearShiftTrajectory` 要求**实车挡位 == 目标挡位**（:679-681），
  底盘挡位反馈异常会永久卡住。

**openspace 调参速查（按症状）**：
| 症状 | 先调什么 |
|---|---|
| Hybrid A* 找不到路 | `xy_grid_resolution` ↓ → `next_node_num` ↑ → `max_explored_num` ↑ → `perception_obstacle_buffer` ↓ → `roi_longitudinal_range_*` ↑ |
| 揉库次数太多 | `traj_gear_switch_penalty` ↑、`traj_short_length_penalty` ↑、`traj_expected_shortest_length` ↑ |
| 单帧耗时超标 | `grid_a_star_xy_resolution` ↑ → `roi_line_segment_length` ↑ → `desired_explored_num` ↓ → `ipopt_max_iter` ↓ |
| IPOPT `Infeasible_Problem_Detected` | `min_safety_distance` ↓ → `weight_x/y/phi` ↑ → 切 `IPOPT_RELAX_END` → `RELAX_END_SLACK` + `qp_format: SLACKQP` |
| 末端停不准 | `parking_depth_buffer` 微调、`weight_end_state` ↑、`near_destination_threshold` ↓ |
| 换段卡住不动 | `linear_velocity_threshold_on_ego` ↑、`vehicle_box_iou_threshold_to_midpoint` ↓ |
| 反复触发 fallback | `distance_search_range` ↑、`heading_search_range` ↑、`speed_replan_distance` ↑ |

## 9. 高危坑清单

### 9.1 静默失败（编译通过、无报错、行为悄悄变了）

1. **override 错 `Process` 签名** → `Decider`/`PathGeneration` 的默认实现返回 OK，task 空跑
   （`decider.h:42-49`、`path_generation.h:41-48`）。
2. **实例级 conf 文件名写错** → `LoadMergedConfig` 只 AWARN 并 `return true`（`config_util.h:87-91`），
   静默用 `default_conf`。仓库现有 3 处这类错误：
   `valet_parking_park/conf/valet_parking_retry_park/open_space_trajectory_optimizer.pb.txt`
   （task name 是 `OPEN_SPACE_TRAJECTORY_OPTIMIZER_PARK`，缺 `_park` 后缀 ⇒ **开放空间优化器的
   调参全部失效**）、`large_curvature/conf/large_curvature/open_space_rt_optimizer.pb.txt`（无对应
   task）、`square/conf/square_lane_follow_stage/path_decider.pb.txt`（该 stage 无 PathDecider）。
3. **proto 字段没写 `[default=]`** → 静默拿 0/false。conf 里不写的字段用 **proto default 不是 0**，
   而多处 conf 与 proto 默认值刻意不同（stop_sign 距离 5.0/4.0、left_turn 5.0/30.0、
   park_and_go 转角 90.0/20.0）—— **读行为要看 conf**。
4. **改 `path_label` 拼写** → 20+ 个 `find(substring)` 消费者静默改行为（转向灯、fallback 选路、
   Dreamview 显示）。注意 `"regular/leftforward"` 同时命中 `"regular"`、`"left"`、`"forward"`。
5. **`traffic_decider.cc:116` 丢弃 `ApplyRule` 返回值** → traffic rule 返回 error 完全无效。
6. **`Destination::ApplyRule` 忽略 `MakeDecisions` 的 int 返回值**（`destination.cc:52`）。
7. **`BuildStopDecision` 的 s 越界静默返回 0**（`common/util/common.cc:40-42`）。
8. **`IndexedList::Add` 重复 id 是覆盖**，只 AWARN（`indexed_list.h:46-51`）—— 同 id 建两个
   虚拟墙，后者吃掉前者。
9. **`ConfigUtil::LoadMergedConfig` 对 repeated 字段是追加** —— pipeline 类配置误用会出现重复 task。
10. **`CheckPlanningConfig` 是空实现**（`on_lane_planning.cc:699-702`），配置写错不会在 Init 被拦。
11. **`crosswalk` 的 conf 让 `stop_strict_l_distance == stop_loose_l_distance == 5.0`** ⇒
    `.cc:371-383` 的"中间区间"分支**实际不可达**。
12. **`ReferenceLineEnd` 从不产生 `STOP_REASON_REFERENCE_END`**（它填 `STOP_REASON_DESTINATION`），
    但 `traffic_decider.cc:81` 对前者有专门处理 ⇒ 死代码。
13. **`pull_over/stage_approach.cc:71` 匹配 `"pullover"`，而仓库里无任何 producer 产出该 label** ⇒ 恒不命中。

### 9.2 启动崩溃或永不生效

14. **缺 `conf/pipeline.pb.txt`** → `ACHECK(scenario->Init(...))` abort（`scenario_manager.cc:43`）。
    `lane_escape` / `lane_follow_park` / `precise_parking` 三个目录当前就缺，一旦注册立即崩。
15. **缺 `conf/scenario_conf.pb.txt` 但代码调了 `LoadConfig`** → 同样 abort。
16. **没在 `public_road_planner_config.pb.txt` 注册 → 场景代码永不执行**（19 个里 7 个是这种状态）。
17. **注册位置排在 `LANE_FOLLOW` 之后 = 等于没注册**。
18. **没有名叫 `LANE_FOLLOW` 的 scenario → 空指针崩溃**（`scenario_manager.cc:46` 硬编码字符串）。
19. **`plugins.xml` 的 `<library path>` 与 BUILD 的 `apollo_plugin(name=)` 不一致 → 插件加载失败**
    （原例 lattice / navi 的 plugins.xml 写错 —— **本环境这两个 planner 已不存在，反例没了**，
    但这条规则本身仍然成立。本环境可核对的等价反例见 `apollo-plugin-dev/reference.md` §4.1
    的 `outside_roi_filter` 孤儿插件）。
20. **pipeline 的 `type` 与 `plugins.xml` 的 `class type=` 不一致** → `AERROR` + `Stage::Init`
    返回 false，整个 stage 起不来（`stage.cc:64-67`）。
21. **`reference_line_provider.cc:114` 不判 `CreateInstance` 空返回** → `pnc_map_class` 类名写错直接崩。

### 9.3 状态机与生命周期

22. **返回 `FINISHED` 但没设 `next_stage_` → 死循环留在原 stage**（`stage.cc:47`、`scenario.cc:117-137`）。
23. **忘记 `result.SetStageStatus(...)` → 整帧 planning 失败**（默认 `READY` → `STATUS_UNKNOWN` →
    `public_road_planner.cc:60-63` 返回 PLANNING_ERROR）。
24. **stage 成员变量在切 stage 后清零**（`scenario.cc:130` 每次切换都 `CreateStage` 重新 new）
    ⇒ **跨 stage 状态必须放 ScenarioContext**。
25. **`Enter` / `Exit` 的返回值被完全忽略**（`scenario_manager.cc:67,72`），`Enter` 失败不阻止切换。
26. **`GetContextAs<T>()` 无类型检查**（`stage.h:66-69` 是 `static_cast<T*>(void*)`），转错是 UB。
    `LaneFollowScenario::GetContext()` 返回 nullptr，在 stage 里调 `GetContextAs` 必崩。
27. **`ExecuteTaskOnReferenceLine` 会跳过所有换道参考线**（`stage.cc:115-119`）—— 需要处理换道的
    stage 必须像 `LaneFollowStage` 那样自己遍历 `task_list_`。
28. **task 对象每个 stage 只 `Init` 一次**，成员变量跨帧保留 —— 有状态成员必须自己在 `Process`
    开头复位。
29. **`Frame` 每帧新建、`frame_history` 只留 1 帧**（`FLAGS_max_frame_history_num=1`）。
    `RunOnce` 的退出路径必须 `frame_history()->Add`（`on_lane_planning.cc:358`/`:453`；`:273`
    那条**故意不 Add**，此时下一帧因无前序轨迹而 replan）。

### 9.4 数据结构与数值

30. **`ReferenceLineInfo::AddObstacle` 返回副本**（见第 6 节），加了虚拟墙只 Create 不 AddObstacle
    等于没加。
31. **`PathData` 必须先 `SetReferenceLine`**，且 `SetDiscretizedPath`/`SetFrenetPath` 的返回值必须
    检查（`path_data.cc:44,59,222`）。
32. **`STBoundary::CreateInstance` 点数不合法时返回空 boundary 而非崩溃**（`st_boundary.cc:75,91`）。
33. **`SpeedData::EvaluateByTime/EvaluateByS` 范围外返回 false 不外推。**
34. **决策合并优先级是硬编码 map**（`obstacle.cc:49-61`）—— 新增 `ObjectDecisionType` 分支必须同步
    这两张表 + `MergeLongitudinal/LateralDecision` 的同级比较分支，否则 `FindOrDie` 直接崩。
35. **两个 Nudge 方向冲突会 `DCHECK` 失败**（`obstacle.cc:615`）；Release 下 DCHECK 关闭，得到随机方向。
36. **`AddSpeedLimit` 区间重叠取 min**（`reference_line.cc:961-976`）—— **想抬高限速做不到，只能降**。
37. **`Stitch` 横向误差 > 0.1m 直接失败**（`reference_line.cc:103,115`），是硬编码常量不是 flag。
38. **参考线可能滞后 ≤50ms**（provider 线程 `kSleepTime=50`，`reference_line_provider.cc:269`）。
39. **`weight_fem_pos_deviation` 默认 1e10**，与其它权重不在同一数量级，按比例调参无效。
40. **`DiscretePointsMath::ComputePathProfile` 用差分算 kappa** —— 锚点间距太小（生产 0.25m）会
    放大噪声，是 FEM 平滑后 kappa 抖动的主因。

### 9.5 openspace 专属高危坑

41. **`DistanceApproachProblem` 老构造自赋值 bug**（`distance_approach_problem.cc:33`：
    `distance_approach_config_ = distance_approach_config_;`）⇒ 生产链路下 `distance_approach_mode`、
    `ipopt_config`、所有 weight 全是 proto 默认值。**"改 pb.txt 没效果"的头号原因。**
42. **`HybridAStar` 老构造不填 `planner_warm_start_config_`**（`hybrid_a_star.cc:38-70`）⇒
    **网格分辨率用默认 0.2/0.05 而非配置值**；`max_kappa_` 也只在新构造赋值 ⇒ 老构造下
    `RSPLengthCheck` 会除零。
43. **`GridSearch::CheckConstraints` 量纲错误**（`grid_search.cc:55` 用网格索引与米制
    `node_radius_` 比较）⇒ 改 `node_radius` 效果不符直觉。
44. **`GridSearch::ExtendNode` 无限深递归**（`:90-118`）—— `esdf_range` 调大或分辨率调小可能栈溢出。
45. **`IterativeAnchoringSmoother::SmoothPath` 迭代超限返回 true**（`:437-440`）—— 50 次仍碰撞
    也当成功，输出仍在碰撞的路径。安全相关。
46. **`IterativeAnchoring` 的速度参数读 gflags 而非 config**（`:595-600`）⇒
    `iterative_anchoring_smoother_config.max_forward_v` 等**无效**。这是 gflags 与 proto conf
    职责划分的唯一明显例外。
47. **`ReAnchoring` 与 `GenerateStopProfileFromPolynomial` 是死代码** ⇒ `reanchoring_*` 三个配置项无效。
48. **`astar_max_search_time` 只在已有解时生效**（`hybrid_a_star.cc:821-822`）⇒ 无解场景超时保护形同虚设。
49. **`ObsHRep` 有三份重复实现**（`utils/open_space_roi_util.cc:200`、
    `tasks/open_space_roi_decider.cc:1552`、`tools/distance_approach_problem_wrapper.cc:68`）——
    改超平面逻辑要同步三处。
50. **动态障碍物完全不进 NLP**（`FilterOutObstacle` 直接 `!IsStatic() → return true`，
    `open_space_roi_util.cc:148-150`）—— 避让动态物完全靠 `OpenSpaceFallbackDecider` 刹停。
51. **`nnz_jac_g` 手算公式与手写 Jacobian 强耦合**（`distance_approach_ipopt_interface.cc:228-236`）
    —— 改约束必须同步，否则 IPOPT 静默用错梯度（不报错，只是不收敛）。
52. **`enable_trajectory_optimize_thread` 的 `thread_init_flag_`/`trajectory_update_` 是裸 `bool`
    不是 atomic**（`open_space_trajectory_optimizer_park.h:62-65`）⇒ 数据竞争。
53. **两套构造混用** —— 新增字段时要问"加到 `PlannerOpenSpaceConfig` 还是子 config"，加错地方在
    另一条链路上静默失效。

### 9.6 测试与 CI 盲区

54. **集成测试用 `qp_spline` 平滑器（`planning_test_base.cc:58`），生产用 `discrete_points`
    （`planning.conf:14`）** —— golden 基线不可跨配置复用；改平滑器不会让集成测试变红。
55. **集成测试强制关掉 `enable_trajectory_check` 与 provider 线程**（`planning_test_base.cc:70,73`）
    ⇒ 这两条路径缺集成覆盖。
56. **scenario 的 37 个测试基本只测 `Init` 后 `Name()`**，没有 `IsTransferable`/`Process` 的行为测试；
    7 个 scenario 目录完全无测试文件。
57. **learning 相关代码全部默认关闭** —— 改它们不影响线上，也不会被 CI 覆盖。

