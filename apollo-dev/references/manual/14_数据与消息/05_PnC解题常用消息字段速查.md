# 05 PnC 解题常用消息字段速查

<!--
file: references/manual/14_数据与消息/05_PnC解题常用消息字段速查.md
scope: 11.0（默认）
tags: PerceptionObstacle, TrafficLight, PredictionObstacle, TrajectoryPoint, PathPoint, ControlCommand, MainDecision, ObjectDecisionType, 字段速查, 场景开发, proto2, has_xxx
sources:
- /opt/apollo/neo/src/modules/common_msgs/perception_msgs/perception_obstacle.proto（全 272 行）
- /opt/apollo/neo/src/modules/common_msgs/perception_msgs/traffic_light_detection.proto（全 72 行）
- /opt/apollo/neo/src/modules/common_msgs/prediction_msgs/prediction_obstacle.proto（全 80 行）
- /opt/apollo/neo/src/modules/common_msgs/prediction_msgs/feature.proto（55–84）
- /opt/apollo/neo/src/modules/common_msgs/basic_msgs/pnc_point.proto（全 107 行）
- /opt/apollo/neo/src/modules/common_msgs/control_msgs/control_cmd.proto（1–281，Debug 子消息只核到字段名）
- /opt/apollo/neo/src/modules/common_msgs/planning_msgs/decision.proto（全 223 行）
- /opt/apollo/neo/src/modules/common_msgs/planning_msgs/planning.proto（69–148，ADCTrajectory）
- 交叉引用（已核，不重复）：14_数据与消息/01_PnC链路channel全景.md、02_chassis与车辆参数.md、03_localization与坐标系TF.md
-->

## 0. 一句话作用

做 PnC 场景开发时**最常读/写的消息字段**一页速查。按"我要做什么"组织：先给六张字段表（感知 / 交通灯 / 预测 / 轨迹点 / 控制命令 / 决策），最后 §7 一张「诉求 → 读哪个字段 / 写哪个字段」对照表。channel 名与走向见 `01_PnC链路channel全景.md`，底盘字段见 `02`，位姿与坐标系见 `03`。

## 1. 感知障碍物 `apollo::perception::PerceptionObstacle`

文件（② src）：`/opt/apollo/neo/src/modules/common_msgs/perception_msgs/perception_obstacle.proto`，message 起 :64。channel `/apollo/perception/obstacles` 的顶层是 `PerceptionObstacles`（:246）。

| 字段 | 编号（行号） | 语义与单位 |
|---|---|---|
| `id` | 1（:65） | 障碍物 ID（int32），**跨帧稳定的跟踪 ID** |
| `position` | 2（:68） | `apollo.common.Point3D`，**世界坐标系**；注释明确 position 是**包围盒的地面中心**（:112） |
| `theta` | 3（:70） | 世界系 heading，rad |
| `velocity` | 4（:71） | `Point3D` 速度，m/s（世界系分量，不是标量） |
| `length` / `width` / `height` | 5/6/7（:74/:75/:76） | 包围盒尺寸，m |
| `polygon_point` | 8（:78） | repeated `Point3D`，**障碍物角点多边形**（做精确碰撞/绕行横向距离用这个，不用矩形） |
| `tracking_time` | 9（:81） | 自被检出以来的**持续时间，s**（滤瞬时误检的首选门限） |
| `type` | 10（:91） | `Type` 枚举，见下 |
| `timestamp` | 11（:92） | GPS 时间，s |
| `point_cloud` | 12（:96） | 仅离线调试填，**车上不填**（:94 注释） |
| `confidence` | 13（:98） | 置信度 |
| `acceleration` | 16（:109） | `Point3D` 加速度（Apollo 4.0 新增） |
| `anchor_point` | 17（:113） | 世界系**稳定锚点**（比 position 抖动小） |
| `bbox2d` | 18（:114） | `BBox2D{xmin,ymin,xmax,ymax}`（:11–16，像素） |
| `sub_type` | 19（:133） | `SubType` 枚举，见下（比 `type` 细） |
| `measurements` | 20（:135） | repeated `SensorMeasurement`（:36，单传感器量测溯源） |
| `height_above_ground` | 21（:138） | 最低点到地面距离，**默认 `nan`** |
| `position_covariance` / `velocity_covariance` / `acceleration_covariance` | 22/23/24（:141/:143/:145） | 行主序 3×3 |
| `light_status` | 25（:148） | `LightStatus`（:18，刹车灯/转向灯可见性与开关，double 非 bool） |
| `source` | 27（:158） | `Source{HOST_VEHICLE=0, V2X=1}`（:153–156），默认 `HOST_VEHICLE` |
| `semantic_type` | 29（:173） | `SemanticType{SM_UNKNOWN,SM_IGNORE,SM_GROUND,SM_OBJECT,SM_CURB,SM_VEGETATION,SM_FENCE,SM_NOISE,SM_WALL,SM_MAX_OBJECT_SEMANTIC_LABEL}`（:161–172） |
| `motion_type` | 30（:181） | `MotionType{MT_UNKNOWN=0, MT_MOVING=1, MT_STATIONARY=2, MT_MAX_OBJECT_MOTION_LABEL=3}`（:175–180） |

- `Type`（:83–90）：`UNKNOWN=0 / UNKNOWN_MOVABLE=1 / UNKNOWN_UNMOVABLE=2 / PEDESTRIAN=3 / BICYCLE=4（注释含摩托）/ VEHICLE=5`。**只有 6 档**，没有 `TRAFFICCONE` 这类——细分类看 `sub_type`。
- `SubType`（:116–132）：`ST_UNKNOWN=0 / ST_UNKNOWN_MOVABLE=1 / ST_UNKNOWN_UNMOVABLE=2 / ST_CAR=3 / ST_VAN=4 / ST_TRUCK=5 / ST_BUS=6 / ST_CYCLIST=7 / ST_MOTORCYCLIST=8 / ST_TRICYCLIST=9 / ST_PEDESTRIAN=10 / ST_TRAFFICCONE=11 / ST_SMALLMOT=12 / ST_BIGMOT=13 / ST_NONMOT=14`。
- 已 deprecated：`confidence_type`（14，:104）、`drops`（15，:106）——别用。
- `PerceptionObstacles`（:246–253）：`perception_obstacle`(1) / `header`(2) / `error_code`(3，默认 `OK`) / `lane_marker`(4，`LaneMarkers`:199) / `cipv_info`(5，`CIPVInfo{cipv_id,potential_cipv_id}`:206) / `perception_waste`(6)。**`cipv_info.cipv_id` 是感知给出的"最近本车道前车"ID**，判前车可先看它。

## 2. 交通灯 `apollo::perception::TrafficLight`

文件：`.../perception_msgs/traffic_light_detection.proto`，channel `/apollo/perception/traffic_light`。

| 字段 | 编号（行号） | 语义 |
|---|---|---|
| `color` | 1（:41） | `Color{UNKNOWN=0, RED=1, YELLOW=2, GREEN=3, BLACK=4}`（:34–40）。**`BLACK` = 灯灭/黑屏，不等于红灯**；`UNKNOWN` = 未识别 |
| `id` | 2（:44） | **地图里的信号灯 string-ID**（与 hdmap signal id 对齐，用于把灯关联到停止线） |
| `confidence` | 3（:47） | 0–1，**默认 1.0** |
| `tracking_time` | 4（:50） | 自检出以来时长，s（抗闪烁/抗跳变门限） |
| `blink` | 5（:53） | 是否闪烁 |
| `remaining_time` | 6（:56） | V2X 给的剩余时间，s（无 V2X 时不填） |

`TrafficLightDetection`（:59–72）：`traffic_light`(1，repeated) / `header`(2，**编号顺序被写反，字段号 2 在前**) / `traffic_light_debug`(3) / `contain_lights`(4) / `camera_id`(5，`CameraID{CAMERA_FRONT_LONG=0,CAMERA_FRONT_NARROW=1,CAMERA_FRONT_SHORT=2,CAMERA_FRONT_WIDE=3}`:64–69) / `camera_name`(6)。
`contain_lights=false` 表示**这一帧视野里没有灯**（不是"识别失败"）；调试距离看 `traffic_light_debug.distance_to_stop_line`（:25）。

## 3. 预测 `apollo::prediction::PredictionObstacle`

文件：`.../prediction_msgs/prediction_obstacle.proto`，channel `/apollo/prediction`（**planning 的节拍源 M0**）。

| 字段 | 编号（行号） | 语义 |
|---|---|---|
| `perception_obstacle` | 1（:39） | **整份感知障碍物内嵌**（§1 全部字段在这里取，planning 不用另订 perception） |
| `timestamp` | 2（:40） | GPS 时间，s |
| `predicted_period` | 3（:42） | 本次预测时长，s（注释举例 10s） |
| `trajectory` | 4（:44） | repeated `Trajectory`（**多模态**，每条带概率） |
| `intent` | 5（:47） | `ObstacleIntent.Type{UNKNOWN=0,STOP=1,STATIONARY=2,MOVING=3,CHANGE_LANE=4,LOW_ACCELERATION=5,HIGH_ACCELERATION=6,LOW_DECELERATION=7,HIGH_DECELERATION=8}`（:12–25） |
| `priority` | 6（:49） | `ObstaclePriority.Priority{CAUTION=1, NORMAL=2（默认）, IGNORE=3}`（`feature.proto:60–67`） |
| `is_static` | 7（:53） | 默认 false |
| `feature` | 8（:56） | repeated `Feature`，**最新→最旧**历史序列（:55 注释） |
| `interactive_tag` | 9（:51） | `ObstacleInteractiveTag.InteractiveTag{INTERACTION=1, NONINTERACTION=2（默认）}`（`feature.proto:69–75`） |

- `Trajectory`（**定义在 `feature.proto:76–79`**，不是 prediction_obstacle.proto 里那个同名的）：`probability`(1) + `trajectory_point`(2，repeated `apollo.common.TrajectoryPoint`)。⚠️ 全仓有**三个** `Trajectory`：`apollo.prediction.Trajectory`、`apollo.perception.Trajectory`（`perception_obstacle.proto:54`）、`apollo.common.Trajectory`（`pnc_point.proto:80`）——写代码看命名空间。
- `PredictionObstacles`（:59–80）：`header`(1) / `prediction_obstacle`(2) / `perception_error_code`(3) / `start_timestamp`(4) / `end_timestamp`(5) / `intent`(6，**自车** `Intent.Type{UNKNOWN,STOP,CRUISE,CHANGE_LANE}`:28–36) / `scenario`(7)。

## 4. 轨迹点 `apollo::common::{PathPoint, TrajectoryPoint}`

文件：`.../basic_msgs/pnc_point.proto`（**PnC 的公共几何词汇表**，planning 输出、control 输入、prediction 轨迹都用它）。

| 消息 | 字段（行号） | 单位/语义 |
|---|---|---|
| `PathPoint`（:31） | `x`(1,:33) `y`(2,:34) `z`(3,:35) | m，**世界/地图 ENU 系**；参照点 = 后轴中心 VRP（见 `03`） |
| | `theta`(4,:38) | rad，x-y 平面朝向 |
| | `kappa`(5,:40) | 1/m，曲率 |
| | `s`(6,:42) | m，**沿路径的累积弧长**（起点为 0） |
| | `dkappa`(7,:45) / `ddkappa`(8,:47) | dκ/ds、d²κ/ds² |
| | `lane_id`(9,:49) | string，该点所在车道 |
| | `x_derivative`(10,:52) / `y_derivative`(11,:53) | CosTheta 参考线用的对参数 t 的导数 |
| `TrajectoryPoint`（:61） | `path_point`(1,:63) | 内嵌 `PathPoint`（**几何在里面一层**，`tp.path_point().x()`） |
| | `v`(2,:65) | **m/s**（注释原文 `in [m/s]`） |
| | `a`(3,:67) | m/s²，线加速度 |
| | `relative_time`(4,:69) | s，**相对轨迹起点**（不是绝对时间；绝对时间 = `header.timestamp_sec + relative_time`） |
| | `da`(5,:71) | m/s³，纵向 jerk（注意名字是 `da` 不是 `jerk`） |
| | `steer`(6,:73) | 前轮与车辆纵轴夹角，rad |
| | `gaussian_info`(7,:76) | `GaussianInfo`（:97，预测不确定性用） |

其余同文件常用小类型：`SLPoint{s,l}`（:8）、`FrenetFramePoint{s,l,dl,ddl}`（:13）、`SpeedPoint{s,t,v,a,da}`（:20，`da` = jerk m/s³，:28）、`Path{name,path_point}`（:56）、`Trajectory{name,trajectory_point}`（:80）、`VehicleMotionPoint`（:85）。

**planning 输出 `ADCTrajectory`**（`planning_msgs/planning.proto:69–148`）常用字段：`trajectory_point`(12,:87，带速度) / `path_point`(13,:90，无速度) / `total_path_length`(2,:72，m) / `total_path_time`(3,:74,s) / `gear`(10,:84，`Chassis.GearPosition`，**倒车/泊车靠它**) / `decision`(14,:92，`DecisionResult`，见 §6) / `is_replan`(9,:81) + `replan_reason`(22,:131) / `estop`(6,:76) / `trajectory_type`(21,:129，`{UNKNOWN,NORMAL,PATH_FALLBACK,SPEED_FALLBACK,PATH_REUSED,OPEN_SPACE,EDGE_FOLLOW,RELATIVE_CONTROL}`:119–128) / `right_of_way_status`(17,:102，`{UNPROTECTED=0,PROTECTED=1}`) / `lane_id`(18,:105) 与 `target_lane_id`(23,:134) / `car_in_dead_end`(24,:137) / `critical_region`(20,:117)。

## 5. 控制命令 `apollo::control::ControlCommand`

文件：`.../control_msgs/control_cmd.proto`（**没有 `control.proto`**），channel `/apollo/control`。message 起 :26，注释 `next id : 27`。

| 字段 | 编号（行号） | 单位与范围（注释原文） |
|---|---|---|
| `header` | 1（:27） | `apollo.common.Header` |
| `throttle` | 3（:29） | 目标油门 **百分比 [0,100]** |
| `brake` | 4（:32） | 目标刹车 **百分比 [0,100]** |
| `steering_rate` | 6（:36） | 目标转向速率，**满量程百分比/秒 [0,100]**，无方向 |
| `steering_target` | 7（:39） | 目标转角，**满量程百分比 [-100,100]**（不是 rad！与 `Chassis.steering_percentage` 同量纲，见 `02`） |
| `parking_brake` | 8（:42） | true = 拉 EPB |
| `speed` | 9（:45） | 目标车速，**m/s** |
| `acceleration` | 10（:48） | 目标加速度，m/s² |
| `engine_on_off` | 17（:53） | true = 发动机开 |
| `trajectory_fraction` | 18（:55） | 上一周期轨迹的完成度 |
| `gear_location` | 20（:58） | `apollo.canbus.Chassis.GearPosition`（**下发档位，倒车必填**） |
| `debug` | 22（:60） | `Debug`（:276）= `simple_lon_debug`/`simple_lat_debug`/`input_debug`/`simple_mpc_debug`，调控制第一眼看这里 |
| `signal` | 23（:61） | `apollo.common.VehicleSignal`（转向灯/喇叭/灯光） |
| `latency_stats` | 24（:62） | `LatencyStats{total_time_ms, controller_time_ms[], total_time_exceeded}`（:19–23，逐控制器耗时） |
| `pad_msg` | 25（:63） | `PadMessage`（回显收到的 pad 指令） |
| `engage_advice` | 26（:64） | 能否接管建议 |
| `is_in_safe_mode` | 27（:65） | **默认 false**；安全模式标志 |

已 deprecated（别写）：`reset_model`(16,:51)、`driving_mode`(19,:56)、`left_turn`/`right_turn`/`high_beam`/`low_beam`/`horn`(13/14/11/12/15,:68–72)、`turnsignal`(21,:73，顶层 `enum TurnSignal{TURN_NONE,TURN_LEFT,TURN_RIGHT}`:13–17)。灯光一律走 `signal`。
纵向调试高频字段（`SimpleLongitudinalDebug`:76–119）：`station_error`/`speed_error`/`acceleration_cmd`/`calibration_value`/`is_full_stop`(18)/`path_remain`(21)/`slope_offset_compensation`(19)/`is_stop_reason_by_destination`(40)/`is_stop_reason_by_prdestrian`(41，**原文拼写错**)。横向（`SimpleLateralDebug`:121–177）：`lateral_error`(1)/`heading_error`(4)/`curvature`(7)/`steer_angle`(8)/`lateral_error_feedback`(28)/`lateral_centripetal_acceleration`(34)。

## 6. 决策 `apollo::planning::{MainDecision, ObjectDecision}`

文件：`.../planning_msgs/decision.proto`。顶层 `DecisionResult`（:219）= `main_decision` + `object_decision` + `vehicle_signal`，被 `ADCTrajectory.decision`（planning.proto:92）携带 —— **不是独立 channel**。

| 层 | oneof 分支（行号） | 说明 |
|---|---|---|
| `MainDecision`（:206，全局一个） | `cruise`(1) / `stop`(2) / `estop`(3) / `change_lane`(4, **deprecated**) / `mission_complete`(6) / `not_ready`(7) / `parking`(8) | :207–215；`target_lane`(5) 也已 deprecated |
| `ObjectDecisionType`（:113，逐障碍物） | `ignore`(1) / `stop`(2) / `follow`(3) / `yield`(4) / `overtake`(5) / `nudge`(6) / `avoid`(7) / `side_pass`(8) | :114–123；`ObjectDecision{id, perception_id, object_decision[]}`（:126） |

- `StopReasonCode`（**顶层枚举**，:19–38）：`STOP_REASON_HEAD_VEHICLE=1 / DESTINATION=2 / PEDESTRIAN=3 / OBSTACLE=4 / PREPARKING=5 / SIGNAL=100（注释「only for red signal」）/ STOP_SIGN=101 / YIELD_SIGN=102 / CLEAR_ZONE=103 / CROSSWALK=104 / CREEPER=105 / REFERENCE_END=106 / YELLOW_SIGNAL=107 / PULL_OVER=108 / SIDEPASS_SAFETY=109 / PRE_OPEN_SPACE_STOP=200 / LANE_CHANGE_URGENCY=201 / EMERGENCY=202`。
- `ObjectStop`（:40）：`reason_code` / `distance_s`(m) / `stop_point`(**停车时车辆前端中心应在此点**，:43 注释) / `stop_heading` / `wait_for_obstacle`(repeated string)。
- `ObjectNudge`（:51）：`Type{LEFT_NUDGE=1, RIGHT_NUDGE=2, DYNAMIC_LEFT_NUDGE=3, DYNAMIC_RIGHT_NUDGE=4}` + `distance_l`（**最小横向距离 m，LEFT_NUDGE 为正、RIGHT_NUDGE 为负**，:59–61）。
- `ObjectFollow`（:72）/`ObjectYield`（:64）/`ObjectOvertake`（:78）：都有 `distance_s`+`fence_point`+`fence_heading`；yield/overtake 另有 `time_buffer`（yield = 障碍物到交点**之后**的时间余量，overtake = **之前**）。
- `ObjectSidePass`（:86）：`Type{LEFT=1,RIGHT=2}`；`ObjectIgnore`(:17)/`ObjectAvoid`(:95)/`ObjectStatic`(:102)/`ObjectDynamic`(:104) 是**空消息**（靠 oneof 的存在性表达语义，必须用 `has_xxx()`）。
- `MainEmergencyStop`（:150）：`ReasonCode{ESTOP_REASON_INTERNAL_ERR=1, COLLISION=2, ST_FIND_PATH=3, ST_MAKE_DECISION=4, SENSOR_ERROR=5}` + oneof `hard_brake`/`cruise_to_stop`。
- `MainParking`（:198）：`ParkingStatus{IN_PARKING=1}`（源码带 TODO，只有一档）。`TargetLane`（:9）：`id`/`start_s`/`end_s`/`speed_limit`(**m/s**，:14)。

## 7. 场景开发常见诉求 → 读哪个字段 / 写哪个字段

| 诉求 | 读（输入） | 写（输出） |
|---|---|---|
| 判断前车距离 | `PerceptionObstacles.cipv_info.cipv_id`(:251) 锁定前车 → 该障碍物 `position`(:68)/`velocity`(:71)，或投到 Frenet 比 `s`（`SLPoint`:8） | `ObjectDecisionType.follow`(:117) 的 `ObjectFollow.distance_s`(:73) |
| 判断行人（含人行道场景） | `type == PEDESTRIAN`(:87) 或 `sub_type == ST_PEDESTRIAN`(:127)；`tracking_time`(:81) 滤误检 | `stop` + `StopReasonCode::STOP_REASON_CROSSWALK`(:29) 或 `STOP_REASON_PEDESTRIAN`(:22) |
| 行人/障碍物是否在动 | `motion_type`(:181)、`PredictionObstacle.is_static`(:53)、`velocity` 模长 | `ObjectNudge.type` 选静态(`LEFT/RIGHT_NUDGE`)还是动态(`DYNAMIC_*`)（:53–56） |
| 判断红灯 | `TrafficLight.color == RED`(:36)；用 `id`(:44) 与地图 signal 关联；`confidence`(:47)+`tracking_time`(:50) 做门限；先看 `contain_lights`(:63) | `stop` + `STOP_REASON_SIGNAL=100`(:25)；黄灯用 `STOP_REASON_YELLOW_SIGNAL=107`(:32) |
| 黄灯闯/停 | `color == YELLOW`(:37) + `blink`(:53) + `remaining_time`(:56，仅 V2X) | 同上 |
| 限速 | `TargetLane.speed_limit`(:14，m/s)；地图 lane 限速在 `map_msgs/map_lane.proto`（**本轮未 read，待核**）；全局上限走 planning gflags | 写 `SpeedLimit` 是 task 内部对象；对外体现为 `TrajectoryPoint.v`(:65) |
| 借道 / 绕行决策 | 障碍物 `polygon_point`(:78)（精确边界）+ `length/width`(:74/:75) | `nudge`(:120) 或 `side_pass`(:122)；横向余量写 `ObjectNudge.distance_l`(:61) |
| 绕行横向距离 | 自车位姿（`03` 篇 `Pose.position` = 后轴中心）+ 障碍物 `polygon_point` | `ObjectNudge.distance_l`(:61)：**左正右负** |
| 停止线停车 | 交通灯 `id` → 地图停止线；调试距离 `TrafficLightDebug.distance_to_stop_line`(:25) | `ObjectStop.stop_point`(:44) —— 注意是**车辆前端中心**位置，不是后轴 |
| 到点停车 / 任务结束 | `ADCTrajectory.total_path_length`(:72) 剩余、`SimpleLongitudinalDebug.path_remain`(21) | `MainDecision.mission_complete`(:212) 或 `stop`+`STOP_REASON_DESTINATION=2`(:21) |
| 交汇路口减速让行 | 预测多模态 `Trajectory.probability`+`trajectory_point`（`feature.proto:76–79`）判是否冲突；`PredictionObstacle.priority == CAUTION`(`feature.proto:62`) | `yield`(:118)：`ObjectYield.distance_s/fence_point/time_buffer`(:65–69) |
| 超车 | 障碍物 `velocity`(:71) 与自车速差；`intent`(:47) | `overtake`(:119)：`ObjectOvertake.time_buffer`(:82) |
| 泊车位 / 泊车 | 泊车指令在 `planning_msgs/planning_command.proto`（**本轮未 read，待核**）；`PerceptionAccurateDockInfo`(`perception_obstacle.proto:266`) 给相对库位位姿 | `MainDecision.parking`(:214)；轨迹侧 `ADCTrajectory.trajectory_type = OPEN_SPACE`(:125) |
| 倒车 | `Chassis.gear_location`（`02` 篇，:107）确认实际档位 | `ADCTrajectory.gear`(:84) + `ControlCommand.gear_location`(:58) 都要写 `GEAR_REVERSE` |
| 判断是否可通行 / 该不该急停 | `MainDecision.not_ready`(:213)、`ADCTrajectory.estop`(:76)、`right_of_way_status`(:102)、`car_in_dead_end`(:137) | `estop`(:210) + `MainEmergencyStop.ReasonCode`(:152–158) |
| 忽略某障碍物 | `PredictionObstacle.priority == IGNORE`(`feature.proto:64`) | `ObjectDecisionType.ignore`(:115)（空消息，靠 `has_ignore()`） |
| 打转向灯 | — | `DecisionResult.vehicle_signal`(:222) / `ControlCommand.signal`(:61)（**不要用 deprecated 的 `left_turn`**） |
| 控制为什么不动 | `Chassis.driving_mode`/`error_code`（`02` 篇 :105/:106） | `ControlCommand.throttle/brake/steering_target`(:29/:32/:39) |

## 8. ⚠️ 本环境注意

- **proto2 全是 `optional`：读之前必须 `has_xxx()`**。`Chassis` 多个浮点字段默认值是 `nan`（见 `02_chassis与车辆参数.md` §2 末），不判存在直接算会把 NaN 污染到下游；`height_above_ground` 同样 `[default = nan]`（perception_obstacle.proto:138）。
- **空消息 + oneof 只能靠存在性判断**：`ObjectIgnore`/`ObjectAvoid`/`ObjectStatic`/`ObjectDynamic` 没有任何字段，语义完全由 `has_ignore()` / `object_tag` case 表达。
- **枚举名照抄源码，含拼写错误**：`is_stop_reason_by_prdestrian`（control_cmd.proto:117）、`MeasureState.WARNNING`（`03` 篇）。IDE 自动纠正会编不过。
- **量纲陷阱**：`steering_target` 是**满量程百分比 [-100,100]**（control_cmd.proto:38–39），`TrajectoryPoint.steer` 是**前轮角 rad**（pnc_point.proto:72–73），两者不能互赋；`relative_time` 是相对量，绝对时刻要加 `header.timestamp_sec`。
- **同名不同包**：`Trajectory` 三份（prediction/perception/common）、`Debug` 在 control 与 planning_internal 各一份；`PerceptionObstacle.position` 是**包围盒地面中心**而 `Pose.position` 是**后轴中心**，混用会有半车身量级误差。
- **改 `common_msgs` 的 proto 影响面极大**：这些包被几乎所有模块依赖，改了要 `buildtool build` 全量重装才能让运行时看到新定义（`bazel build` 出的 .so 运行时不读，见 CLAUDE.md §2）；能用 `custom_status`(Any) / `debug` 字段扩展就不要动公共 proto。
- proto 源码只在 ② `/opt/apollo/neo/src/modules/common_msgs/`；生成头 `.pb.h` 在 ②′ `/opt/apollo/neo/include/modules/common_msgs/` 同名路径下。**本机无 `control.proto`**，控制消息就是 `control_cmd.proto`。

## 9. 验证命令

```bash
# 字段与枚举原文（唯一权威）
sed -n '64,182p' /opt/apollo/neo/src/modules/common_msgs/perception_msgs/perception_obstacle.proto
sed -n '33,72p'  /opt/apollo/neo/src/modules/common_msgs/perception_msgs/traffic_light_detection.proto
sed -n '31,78p'  /opt/apollo/neo/src/modules/common_msgs/basic_msgs/pnc_point.proto
sed -n '26,74p'  /opt/apollo/neo/src/modules/common_msgs/control_msgs/control_cmd.proto
sed -n '19,38p;113,124p;206,223p' /opt/apollo/neo/src/modules/common_msgs/planning_msgs/decision.proto

# 某字段属于哪个消息（两棵树都搜）
grep -rn "polygon_point" /opt/apollo/neo/src/modules/common_msgs/

# 运行期看实际内容（cyber_channel 的 -w 参数在本环境是坏的）
cyber_channel -e /apollo/perception/obstacles
cyber_channel -e /apollo/prediction
cyber_channel -e /apollo/control
```

## 10. 溯源

- 蒸馏日期：2026-09-08。基线：Apollo 11.0.0 package 工作区。
- 本轮 read 打开逐行核对：`perception_obstacle.proto` 全 272 行、`traffic_light_detection.proto` 全 72 行、`prediction_obstacle.proto` 全 80 行、`feature.proto` 55–84（`ObstaclePriority`/`ObstacleInteractiveTag`/`Trajectory` 三处）、`pnc_point.proto` 全 107 行、`control_cmd.proto` 全 281 行、`decision.proto` 全 223 行、`planning.proto` 69–148（`ADCTrajectory`）。表中所有行号均在上述范围内。
- 未 read（待核）：① `map_msgs/map_lane.proto` 的 lane `speed_limit` 字段号；② `planning_msgs/planning_command.proto`（泊车/巡航等外部指令字段）；③ `feature.proto` 的 `Feature` 字段明细（只看到 :82–84 起始）；④ `control_msgs/input_debug.proto`、`pad_msg.proto` 字段；⑤ `basic_msgs/vehicle_signal.proto` 字段清单；⑥ planning 侧**产生**这些决策的具体 C++ 位置（属 `../12_planning源码/`，本篇只到消息契约层）。
