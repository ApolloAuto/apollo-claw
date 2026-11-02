# Apollo 全局导航 · 长知识

配套 `SKILL.md`。知识库原文在 `（原始精读材料，未随包分发）`（**23 份 digest** + `README.md` 总报告 +
`RESUME.md`；`_wip-sec-{a,b,c}.md` 素材在本环境**已不存在**，凡引用它的地方以现场核对为准）。
本文件只做索引与速查，细节回原文。

> **⚠️ 版本口径**：下表的行数、模块清单、代码量都是**整仓形态 + 更早版本**下写的。本环境（包工作区 /
> Apollo 11.0）已核对出以下模块**整体消失**：`guardian`、`task_manager`、`audio`、`v2x`、`bridge`、
> `third_party_perception`、`contrib`，以及 `controllers/mpc_controller`、`controllers/demo_control_task`、
> `planners/{lattice,navi,rtk}`。凡下文提到它们的行都当历史描述读，**不要 `cd` 过去**。
> 另外 `/opt/apollo/neo/src/` 只装了源码包，二进制包的头文件在 `/opt/apollo/neo/include/` ——
> 判断「某类是否还存在」必须两棵树都 grep。

## 一、digest 索引（什么问题查哪一份）

路径均为 `（原始精读材料，未随包分发）`。

| 文件 | 行数 | 覆盖范围 | 什么问题查这份 |
|---|---|---|---|
| `00-cyber-runtime.md` | 1403 | cyber 核心：component / node / transport(85 文件) / message / scheduler / croutine / data / service_discovery / blocker / timer / time | Proc 为什么不被调用、丢帧、协程随机崩溃、进程退不出、SHM 与跨机通信、调度策略/cpuset/优先级、mock clock 与 Timer 节拍 |
| `01-cyber-infra.md` | 1816 | cyber 周边：base / common / class_loader / plugin_manager / logger / mainboard / record / cyber_* 工具 / python / proto | 插件加载失败、dlopen 与符号可见性、日志不输出或丢失、record 读写与恢复、`cyber::Init` 到底做了什么、无锁队列与对象池 |
| `02-build-system.md` | 1109 | bazel + docker + buildtool 三层：`tools/` `third_party/` `docker/` `scripts/` CI 与全仓 cyberfile.xml | 编不过怎么定位、`apollo_cc_library/component/plugin/package` 选哪个、进容器、GPU 与 CPU 模式、`build` 与 `build_pkg` 冲突、lint/format/coverage |
| `03-common-and-msgs.md` | 1298 | `modules/common`（math/util/configs/status/monitor_log/filters/vehicle_model/vehicle_state/kv_db）+ `common_msgs` + `transform` + `conf_gen` | 几何与滤波器工具能不能直接用、channel 名与 proto 定义在哪、坐标系与时间戳与单位约定、TF 查询怎么写、同名 proto 怎么区分 |
| `04-repo-topology.md` | 1070 | 全仓模块清单 + 数据流拓扑 + dag/launch 全清单 + gflags 生效链路 + 依赖图与循环依赖 | 某 channel 谁写谁读、某 Component 属于哪个 dag 与 launch、某 flag 的默认值与实际值、启动顺序、模块之间的环 |
| `10-planning-core.md` | 887 | `planning_component` + `planning_base`：DependencyInjector / Frame / ReferenceLineInfo / Obstacle / PathData / SpeedData / STBoundary / TrajectoryStitcher / ReferenceLineProvider / 求解器 / 206 gflags | planning 核心数据结构与生命周期、参考线怎么来的、轨迹拼接、piecewise_jerk 与 spline 求解器、启动到第一帧的加载顺序 |
| `11-planning-plugins.md` | 1152 | `planning_interface_base` 五类插件基类 + `planners`(4) + `traffic_rules`(10) + `pnc_map` + `park_data_center` | 新增 Task/Scenario/Stage/TrafficRule/Planner 动哪些文件、conf 路径由类名反推的三套规则、场景优先级、35 个 Task 的真实继承分类 |
| `12-planning-scenarios.md` | 897 | `scenarios/` 全 19 个（12 已注册 / 7 未注册） | 加一个场景、stage 怎么切、场景配置寻址与覆盖、为什么我的场景永远不执行 |
| `13-planning-tasks.md` | 1566 | `tasks/` 全 35 个（105 代码文件 / 29512 行 + 33 default_conf） | 加一个 task、task 之间靠什么传数据、跨帧脏状态、调参为什么不生效、哪些 task 是死的 |
| `14-planning-openspace.md` | 1219 | `planning_open_space/`：Hybrid A* / GridSearch / Reeds-Shepp / DualVarWarmStart / DistanceApproach(6 IPOPT 变体) / IterativeAnchoring / 分段换挡 | 泊车轨迹怎么算出来的、IPOPT 权重与 warm start、局部坐标系归一化、为什么改 openspace 的 pb.txt 没效果 |
| `20-perception-common.md` | 657 | `perception/common`：base 数据结构、algorithm、inference(6 后端 + TensorRT 插件)、hdmap 与 ROI/Ground/Scene 服务 | 接新推理后端、Blob 与 GPU 显存语义、GPU_PLATFORM 双平台分支、perception 路径 helper 与 work_root、三层坐标系 |
| `21-perception-lidar.md` | 2063 | 11 个 lidar Component（preprocess→map_roi→ground→detection→filter→tracking→output）+ 检测模型接入 + MLF 跟踪 | 换激光检测模型、改 ROI 与地面分割、调跟踪关联与滤波器链、lidar 链路某段为什么静默断开 |
| `22-perception-camera.md` | 2043 | camera 四条并列路线（multi_stage/single_stage/bev/occupancy）+ location_estimation/refinement + tracking(OMT) + lane_detection + 红绿灯四段 + barrier | 相机 3D 测距误差从哪来、OMT 跟踪特征为什么没用、红绿灯全链路、BEV/OCC 为什么跑不起来 |
| `23-perception-fusion-misc.md` | 1387 | `multi_sensor_fusion`(ProbabilisticFusion 全解) + `radar_detection`(3D) + `radar4d_detection`(4D) + `msg_adapter` + `motion_service` + tools/launch/data 布局 | 加一路传感器进融合、调关联/存在性/门禁、用 msg_adapter 单模块调试、两条 radar 路线怎么选 |
| `30-prediction-control.md` | 1630 | prediction（container→scenario→evaluator(14)→predictor(9) + ModelManager + SemanticMap/VectorNet）+ control（ControlComponent + 9 controller + LQR/双环 PID/MPC + 标定表） | 加 evaluator/predictor、加 controller、横纵向调参、标定表怎么生成、control 的安全检查与失效行为 |
| `31-localization-map-routing.md` | 754 | localization 三方案 + HDMap 数据结构与 API + 地图文件格式与生成链 + map_datachecker + relative_map + pnc_map + routing | 换定位方案、MSF 为什么不收敛、地图三种文件怎么生成、改 routing 代价为什么无效、HDMap 查询 API 选哪个 |
| `32-canbus-drivers.md` | 925 | canbus 五层接口 + 11 车型插件 + 4 种 CAN 卡 + 驾驶模式看门狗；drivers：lidar(8 厂商)/camera/video/radar(5)/gnss | 适配新车型、DBC → 报文类怎么生成、接新雷达/相机/GNSS、CAN 与传感器时间戳怎么对齐 |
| `33-gnss-driver.md` | 3018 | GNSS/INS 驱动全解：stream(串口/TCP/UDP/NTRIP/CAN) + parser(novatel/ublox/broadcast 等) + RTCM + 时间戳与坐标 | 新增协议 parser、加报文 ID 或输出 channel、GNSS 无数据 / 时间戳为 0 / CRC 失败（配 apollo-gnss-driver） |
| `34-localization-core.md` | 2776 | localization 三方案的核心实现：RTK / NDT / MSF 的组件、滤波器、观测融合 | 换定位方案、调噪声权重、新增一路观测、定位不收敛/跳变（配 apollo-localization-dev） |
| `35-msf-integ.md` | 1514 | MSF 集成层：SINS 惯导积分、GNSS/LiDAR 观测接入、安装角与杆臂 | MSF 融合链路怎么走、改 IMU 安装角与 GNSS 杆臂、MSF 状态位含义 |
| `36-msf-localmap.md` | 2034 | MSF 定位地图：地图格式、金字塔、制图流程与工具 | 制作 MSF 定位地图、地图分辨率与节点组织、定位地图为什么加载失败 |
| `40-dreamview.md` | 721 | `dreamview` 与 `dreamview_plus` 后端全解 + Updater/SocketManager 订阅制 + HMI 模式与车型配置 | 加前端面板/后端接口/数据流、加 HMI 模式或车型、模块状态灯为什么不亮、dv 与 dv_plus 的双份代码 |
| `41-tools-and-misc.md` | 1155 | `modules/tools` + monitor + external_command + storytelling 等外围模块（**含已删除的 guardian / task_manager / v2x / audio，那几节只当历史读**） | 有没有现成脚本、怎么发外部命令、怎么打桩仿真、车为什么自己刹停、monitor 判定链、症状 → 用什么工具 |

总报告 `（原始精读材料，未随包分发）`：第一节 digest 索引、第二节全仓一页速览、第三节跨模块共性规律
（本文件第四~五节的来源）、第四节高危坑 TOP30、第五节已确认代码缺陷清单（约 87 条，按模块分表，
可直接当改 bug 候选池）、第六节已知盲区。

## 二、完整模块清单与入口文件

代码量为 digest 口径（`.cc/.h` 总行数含注释与测试），用于估工作量，不是精确 SLOC。

### 2.1 主链路

| 模块 | 代码量 | 入口文件 | 备注 |
|---|---|---|---|
| `modules/drivers` | 43,525 | 各子目录 `*_component.cc` | 8 lidar 厂商 / 5 radar / camera / gnss / video / smartereye / microphone / canbus / lidar_fusion_and_compensator |
| `modules/perception` | 164,684（最大） | 各子目录 `*_component.cc`；公共库 `perception/common/`(64,280) | **本环境现场 `ls -d /opt/apollo/neo/src/modules/perception/*/` = 31 子目录**（digest 记 33/34 是更早版本口径），已按 9.0 package 方案拆成 30+ 独立 component |
| `modules/localization` | 36,662 | `rtk/rtk_localization_component.cc`、`msf/msf_localization_component.cc`、`ndt/ndt_localization_component.cc` | 三套并行可选，RTK 最简 |
| `modules/prediction` | 31,019 | `prediction_component.cc` | 14 evaluator / 9 predictor，编译期 switch 工厂（不是插件） |
| `modules/planning` | 129,744 | `planning_component/planning_component.cc` | 10 子目录；35 task / 19 scenario / 10 traffic_rule（**只 9 条注册**）/ **本环境 planner 只剩 `public_road` 1 个** |
| `modules/control` | 18,771 | `control_component/control_component.cc` | **本环境 7 个 controller 插件**（LQR / LQR-plus / 双环 PID / PID-plus / anti-slip / replan / debug_info；**MPC 与 demo 都已不存在**）|
| `modules/canbus` | 1,989 | `canbus_component.cc` | 协议在 `canbus_vehicle` |
| `modules/canbus_vehicle` | 83,081（726 文件） | `<brand>/<brand>_controller.cc` | 11 车型，自动生成风格 |
| `modules/map` | 20,728 | `hdmap/`（**库**）、`relative_map/relative_map_component.cc` | `pnc_map/` 供 planning；数据在 `data/<region>/` |
| `modules/routing` | 5,517 | `routing_component.cc`（壳）；核心 `core/` `graph/` `strategy/` | 9.0 后降级为库，被 external_command 内联调用 |

### 2.2 编排 / 旁路 / 交互

`external_command` 4,707（`process_component/external_command_process_component.cc`，10 processor）·
`transform` 854（`static_transform_component.cc` + `buffer.cc`）· `storytelling` 695（**新模块范本**，17 文件）·
`monitor` 2,998（`monitor.cc`，TimerComponent 500ms）· `safety_manager`（功能安全兜底，**10 个 checker 包**，
src 下只有 `checker/dag` 与 `checker/collision_checker/proto`，其余是二进制包；见 SKILL.md 第七节）·
`dreamview` 15,285（legacy，8899，SimControl 在此）· `dreamview_plus` 11,298（8888，主推）· `dreamview_plus_plugins` ·
`common` 19,795（`adapters/adapter_gflags.cc`、`configs/config_gflags.cc`）· `common_msgs` 纯 proto（22 域）·
`statistics` 1,544（10.0 新增）· `data` 2,100（smart_recorder）· `tools` 4,480 C++ + 252 py · `private_tools` ·
`calibration` 0（纯数据）· `conf_gen` 27 py · `prediction_plugin` 1,300（4 个 TensorRT 插件）·
`sensor_calibration` · `loam_velodyne` / `loam_velodyne_indoor` / `slam_local` / `localization_intergrate`（建图/定位集成）·
`safety_manager_msgs` / `statistics_msgs` 纯 proto。

**已删除**（老 digest 里还有条目）：`task_manager` 605 · `guardian` 221 · `v2x` 4,612 · `audio` 1,277 ·
`third_party_perception` 2,341 · `bridge` 2,521 · `contrib` 770。

**陷阱**：`safety_manager_msgs` **不再是空壳** —— `safety_manager.proto` 里有完整的 `SafetyStatus`(8 档) /
`SafetyDecision` / `RuleMatcherList` 契约（见 SKILL.md 第七节）；
`modules/calibration/data/mkz_lgsvl_321/*.launch` 是 **ROS 风格 launch**（无 `dag_conf`），不是 cyber launch。

## 三、模块依赖与运行时环

**编译期依赖分层**（下层不可依赖上层）：`cyber/` → `modules/common_msgs`（proto 契约）→
`modules/common` + `modules/map/hdmap` + `modules/transform` → 各业务模块 → `dreamview*`（依赖几乎所有模块的 proto）。
`modules/monitor` **编译期依赖 dreamview**（构造时加载 dreamview 的 HMI 配置），是分层里最反直觉的一条。

**4 处真实运行时环**（全靠 channel 异步解耦，不会编译死锁但有行为耦合，各带一帧延迟）：

| 环 | channel | 后果 |
|---|---|---|
| planning ↔ storytelling | `/apollo/planning` ↔ `/apollo/storytelling` | 一帧延迟 |
| planning ↔ external_command | `/apollo/planning/command` ↔ `/apollo/planning/command_status` | `planning.launch` 让二者**同进程**正是为减小延迟 |
| planning ↔ control | `/apollo/planning` ↔ `/apollo/control/interactive` | 处理不当会控制-规划振荡 |
| prediction ↔ planning | `/apollo/prediction` ↔ `/apollo/planning` | 博弈闭环 |

**其他架构风险点**：`/apollo/perception/obstacles` 有 **5 个潜在写者**（`multi_sensor_fusion`、`lidar_output`、
`camera_detection_bev`、`camera_detection_occupancy`、`msg_adapter`；`third_party_perception` **本环境已删除**）——
选感知方案必须确认只有一个生效；`radar_detection` 与 `radar4d_detection` 写同一 channel 且 `radar_name`
都是 `radar_front`，同时启动会互相覆盖。
（`msg_adapter` 源码在 `perception/msg_adapter/` 但**本环境没装出可执行文件**，`/opt/apollo/neo/bin` 下找不到，
要用得自己 `buildtool build -p modules/perception/msg_adapter`。）

## 四、channel 名速查（权威定义 = `modules/common/adapters/adapter_gflags.cc`，约 130 个 `*_topic`）

| 环节 | channel | flag 名 |
|---|---|---|
| GNSS 里程计 | `/apollo/sensor/gnss/odometry` | `gps_topic` |
| lidar 原始 / 补偿后 | `/apollo/sensor/lidar<N>/PointCloud2` → `/apollo/sensor/lidar<N>/compensator/PointCloud2` | `pointcloud_*_raw_topic` / `pointcloud_*_topic` |
| 相机 | `/apollo/sensor/camera/<pos>/image`(+`/compressed`) | `image_front_topic`、`image_long_topic` 等 |
| 毫米波 | `/apollo/sensor/radar/{front,rear}` | `front_radar_topic` / `rear_radar_topic` |
| 定位 | `/apollo/localization/pose` | `localization_topic` |
| TF | `/tf`、`/tf_static` | `tf_topic` / `tf_static_topic` |
| 感知障碍物 | `/apollo/perception/obstacles` | `perception_obstacle_topic` |
| 红绿灯 | `/apollo/perception/traffic_light` | `traffic_light_detection_topic` |
| 预测 | `/apollo/prediction` | `prediction_topic` |
| 规划轨迹 | `/apollo/planning` | `planning_trajectory_topic` |
| 规划指令 / 回执 | `/apollo/planning/command` / `/apollo/planning/command_status` | `planning_command` / `planning_command_status` |
| 控制 | `/apollo/control` | `control_command_topic` |
| 兜底（**发布者已删除**） | `/apollo/guardian` | `guardian_topic` |
| 功能安全决策 | `/apollo/safety/decision` | **无 gflag**，写死在 proto default / conf 里 |
| 底盘 | `/apollo/canbus/chassis` | `chassis_topic` |
| 语义场景 | `/apollo/storytelling` | `storytelling_topic` |
| 老路由（兼容） | `/apollo/routing_response` | `routing_response_topic` |

**inner channel 不在 adapter_gflags 里**，只出现在各模块 conf 的 `output_channel_name` 与 dag 的 `readers`：
`/perception/inner/PrefusedObjects`（lidar/camera/radar 汇入融合的总线）、`/perception/inner/Retection`
（红绿灯段间，拼写已固化）、`/perception/lanes`。反查命令见本文件第七节。

## 五、gflags 与配置生效链路

### 5.1 五层配置分工

```
launch(XML)  → 进程边界：起几个进程、每进程加载哪些 dag
   <process_name> → mainboard -p X → GlobalData::SetProcessGroup → cyber/conf/X.conf（调度配置）
   <dag_conf>     → mainboard -d Z（可重复；多 dag 同进程共享 scheduler，可零拷贝）
dag(DagConfig)   → 进程内拓扑：module_library(→APOLLO_LIB_PATH→dlopen)、components[]/timer_components[]
component_conf   → name(=Node名/协程名/sched task名)、config_file_path(APOLLO_CONF_PATH)、
                   flag_file_path(APOLLO_FLAG_PATH→gflags 入口)、readers[]（channel/qos/pending_queue_size）、interval
```

| 类型 | 载体 | 加载方式 | 用途 |
|---|---|---|---|
| gflags | `.conf` / `.flag`（`--k=v` 行） | dag 的 `flag_file_path`，或 binary 的 `--flagfile` | 全局开关、路径、channel 名、算法阈值 |
| proto config | `.pb.txt` | `config_file_path` + `GetProtoConfig<T>()` | 结构化配置：channel 映射、pipeline、传感器参数 |
| dag 内联 | `.dag` 的 `readers`/`interval`/`qos_profile` | mainboard 解析 | 订阅关系、触发周期、QoS、`pending_queue_size` |

`TimerComponent` 的 dag **没有 readers 段**（control / canbus / monitor 以及 safety_manager 的 6 个 checker
都是 TimerComponent；control/canbus `interval:10`ms、monitor `500`ms），靠定时轮询缓存数据。

### 5.2 gflags 生效的三条路径

1. **dag 的 `flag_file_path`**（component 模式最常见）：`mainboard -d x.dag` → `ComponentBase::LoadConfigFiles()`
   （`cyber/component/component_base.h:83-92`）→ `GetFilePathWithEnv(path, "APOLLO_FLAG_PATH")` →
   `google::SetCommandLineOption("flagfile", ...)` → **进程级生效**，遇到 `--flagfile=` 递归展开。
2. **binary 的 `--flagfile` 命令行**：如 `dreamview_plus --flagfile=/apollo/modules/dreamview_plus/conf/dreamview.conf`。
3. **dreamview 反向改写 `global_flagfile.txt`**：切地图/车型时 `hmi_worker.cc` 以 append 方式改写
   `/apollo/modules/common/data/global_flagfile.txt`（注释写 "Overwrite" 但**实际是追加**）。
   后果一样：手改的 `--map_dir` 被后写的行盖掉。

**优先级从低到高**：`DEFINE` 默认值 → `global_flagfile.txt`（被模块 conf 第 1 行引入）→
模块 conf 中 global_flagfile 之后的行 → 更下游 conf → 命令行 `--flag`。**严格按读取顺序，后写覆盖前写。**
实例：`global_flagfile.txt` 里 `--map_dir` 出现 3 次，只有最后一行生效；`localization.conf`
刻意再重定义 `map_dir`（定位与规划可用不同地图，是设计）。

**gflags 定义分散在 30 组 `.cc/.h`，24 个 `.conf`/`.flag` 靠首行 `--flagfile=` 链式引用**，链条根是
`modules/common/data/global_flagfile.txt`；`modules/control/control_component/conf/control.conf`
是唯一不引 global_flagfile 的主链路 conf。**同进程内多个 component 的 `flag_file_path` 会互相覆盖**——
所有 perception Component 因此共用 `modules/perception/data/flag/perception_common.flag`。

### 5.3 proto config 的 MergeFrom 语义

`ConfigUtil::LoadMergedConfig` 先读 `conf/default_conf.pb.txt` 再 `MergeFrom` 场景级覆盖；
**对 repeated 字段是追加而非替换**（pipeline 类配置误用会出现重复 task）；找不到覆盖文件只 AWARN 并
返回 true（**调参静默失效的头号原因**）。conf 未写的字段取 proto default 而非 0。

## 六、高危坑 TOP 30 指针（精简版，全文见 `（原始精读材料，未随包分发）` 第四节）

### 安全相关（最高优先级）

1. **control 超时检查默认是关的**：`FLAGS_enable_input_timestamp_check` 默认 false；
   `control.conf` 把 `enable_persistent_estop` 设 false 使 planning 的 estop 覆盖输入检查产生的 estop；
   trajectory 上报门限误用 `max_localization_miss_num`(20) 而非 `max_planning_miss_num`(5)。**上车前显式打开。**
2. ~~**guardian 四连**~~ —— **本环境 `modules/guardian/` 已删除，这条整体作废**。取代它的是
   `modules/safety_manager/checker/`（10 个 checker，9 个挂在 `checker/dag/checkers.dag`，见 SKILL.md 第七节）。
   仍然成立的残迹：canbus 里 `FLAGS_guardian_topic` 的 reader 代码完整保留（`canbus_component.cc:76-78`），
   conf 里 `--noreceive_guardian` / `--use_guardian_cmd_check=false` 都还在 —— 即**通道还在、发布者没了**。
   新的等价风险点：`SafetyDecision.require_emergency_stop` 与 `safety_mode_trigger_time` 决定刹停，
   规则表 `RuleMatcherList` 用 `Matcher` 的 regex/prefix/tags 匹配，**匹配面写宽了会大范围误刹**；
   `SafetyStatus` 的 `ERROR` = 舒适刹停、`FATAL` = 紧急刹停（语义在 proto 注释里）。
   **调试勿随手 kill monitor / statistics** —— `latency_checker` 与 `resource_checker` 直接吃
   `/apollo/statistics/{latency,resources}`。
3. **dreamview 没起 = monitor 瘫痪**（收不到 HMIStatus 就整帧不检查）；`required_for_safety` **默认 true**，
   新加 monitored_component ERROR 即软刹、10s 无人接管硬刹。**新加时显式写 `required_for_safety: false`。**
4. **换车型换不动**：`--load_vehicle_class_name` 必须与注册宏类名逐字符一致（注意 `Neolix_eduVehicleFactory`
   的不规则大小写），`.so` 走安装后路径；flag_file 没生效会静默用默认 lincoln。
   `use_control_cmd_check`/`use_guardian_cmd_check` 默认 false ——**生产环境默认没有 estop 保护**。
   车型差异：gem 的 `CheckResponse` 直接 return true、wey 的 Brake/Throttle 是空实现、**ch 的转向单位是弧度而其他车型是度（差 57 倍）**。
5. **openspace 后台线程直接写当前帧 Frame**（可能写到已析构的 Frame），泊车偶发崩溃不可复现；
   保护 IPOPT 全局状态的锁只在 `FLAGS_multithread_run` 为真时才真加锁，**而它默认 false**。

### 启动 / 注册 / 加载

6. **插件注册静默失效三入口**：手写 `cc_library` 缺 `alwayslink` / `plugins.xml` 的 `type`/`base_class`
   与注册宏不一致 / `library path` 与 BUILD 产物目录不一致。
   （原文举的「lattice 与 navi 的 `plugins.xml` 错写成 public_road 路径」**在本环境已不存在** ——
   `planners/` 下只剩 `public_road`，全环境 path/name 一致性扫描零 MISMATCH。现在的活体反例是反过来的
   「xml 在、代码不在」：`modules/perception/lidar_detection_filter/object_filter_bank/outside_roi_filter/`
   整个目录只有一个 `plugins.xml`，见 `apollo-plugin-dev/reference.md` §4.1。）
7. **dag 段放错只有一句 "Failed to load module"**：普通 component 写进 `timer_components{}`（或反之）。
   同族：`readers_size()` 只校验下限，**多配的 channel 被静默忽略**。
8. **`mainboard -p` 不传 → 调度配置整体静默失效**；调度 conf 的字段名写错也是整体静默失效
   （现成实例 `cyber/conf/control_sched_choreography.conf` 写了不存在的 `processor_num`，**实际一直跑默认 classic**）。
9. **cpuset 语法错误 = 进程启动即静默 `exit(0)`**（合法写法只有 `"3"`/`"0-7"`/`"0-7,16-23"`）；
   日志目录不存在时**日志静默全丢**；ADEBUG 默认完全不输出。
10. **环境变量含空段（`a::b`、`:a`）会让 `GetFilePathWithEnv` 死循环** —— 而它是所有相对路径解析的唯一入口。
11. **6 个 external_command processor 有完整实现却没注册**（`process_component/conf/config.pb.txt` 只注册 3 个）
    —— 「命令发出去没反应」的头号原因，**追加一行 processor 类名并重启即可，不需改代码**。同族：入口是
    cyber Service 不是 Topic；header 时间戳距今 >2.0s 直接丢弃且不回状态；PlanningCommand 的 QoS 是 TRANSIENT_LOCAL。

### 数据流 / 调度 / 传输

12. **「Proc 不被调用」头号误判：AllLatest 冷启动** —— 任一副 channel 从未收到消息则所有主 channel 帧被丢弃，
    **无任何日志**。排查前先确认所有副 channel 都有流量。
13. **`pending_queue_size` 默认 1 → Proc 一慢就丢帧**（`read buffer overflow, drop_message[N]`，
    恰好覆盖一整圈时静默丢一圈）。**高频通道必须在 dag 里显式调大，这是最常见的调优点。**
14. **协程栈仅 2MB 且无 guard page** → 随机、跨模块、不可复现的崩溃。大缓冲放堆或成员变量。
15. **进程无法退出**：不 Yield 的 `Proc()` 让 `Scheduler::Shutdown()` 永久挂住。
16. **SHM 三连**：消息超 32MB **不报错而是越界写**；崩溃写者留下永久写锁需手动 `ipcs`/`/dev/shm` 清理；
    **`shm_type:"posix"` 档位有 bug（`posix_segment.cc:254` 循环变量写错），一个失败的读者会摧毁发布者的 segment**。
17. **跨机通信**：判定用 `host_ip` 而非 `host_name`，`CYBER_IP=127.0.0.1` 会被丢弃；同名 node 会让「后注册」方
    给自己发 SIGINT；**channel 名避开 `__SRV__`**。
18. **Writer 早于 Reader 启动时前几帧静默丢失**（channel 无 buffer 时 Dispatch 直接返回 false）。

### 构建体系

19. **`build` 与 `build_pkg` 互相污染**（`02` digest 标注的最大坑）：`git status` 出现 `WORKSPACE`、
    `tools/proto/proto.bzl`、`tools/package/dynamic_deps.bzl`、`tools/package/rules_cc.patch`、`tools/bazel.rc`
    的意外改动。修法 `git checkout -- WORKSPACE tools/`；判定当前模式
    `grep STATUS tools/package/dynamic_deps.bzl`（0=源码，2=包管理）。`apollo_lint.sh --cpp` 也会改工作区。
20. **「perception 怎么编都没产物」**：找不到 GPU 只 warning，然后自动加 `--config=cpu` 并**排除整个
    `//modules/perception/...`**。查 `USE_GPU_TARGET` / `GPU_PLATFORM` 的打印。
21. **本地「全绿」不代表 CI 全绿**：large 测试默认不跑、`--flaky_test_attempts=3` 掩盖偶发失败、
    `./apollo.sh check` 不含 py/sh lint；`.apollo.bazelrc` 每次跑 `apollo.sh` 都被重写，本地定制必须写 `.custom.bazelrc`。
22. **链接期找不到符号但库确实编出来了**：`apollo_cc_library` 产出 `.so`，deps 必须写 `":<name>"`
    （无 lib 前缀无 .so 后缀）；要链 component 实现写 `"DO_NOT_IMPORT_<name>"`。

### planning 配置寻址与场景装配

23. **场景配置文件名与 name 推导不匹配 → 调参全部静默失效，无任何日志**。`TransformToPathName`
    只做 `tolower` 不做驼峰转下划线，`name` 一律全大写下划线。已确认实例：openspace 优化器的调参目前全部走 default_conf。
24. **场景注册三个致命点**：缺 `pipeline.pb.txt` 或 `scenario_conf.pb.txt` → `ScenarioManager::Init` 的
    ACHECK **直接 abort**（`lane_escape`/`lane_follow_park`/`precise_parking` 三个目录当前就缺）；
    没在 `planners/public_road/conf/planner_config.pb.txt` 注册 = 代码永不执行（19 个里 7 个如此），
    且**注册位置排在 `LANE_FOLLOW` 之后等于没注册**（**场景优先级就是列表顺序，没有评分机制**）；
    没有名叫 `LANE_FOLLOW` 的 scenario → 空指针崩溃。
25. **Stage 状态机两坑**：返回 FINISHED 但没设 `next_stage_` → 死循环留在原 stage（结束场景必须调 `FinishScenario()`）；
    忘记 `SetStageStatus` → **整帧 planning 失败**。
26. **「名字带 Decider 不代表继承 Decider」**：`PathDecider`/`PathReferenceDecider`/`ObstacleNudgeDecider`/
    `RssDecider` 直接继承 `Task` 且各自定义**非虚**私有 `Process`。**错签名的 override 会永远空跑返回成功，编译期零提示。**
27. **task 的非静态成员都是跨帧脏状态**（task 对象每个 stage 只 Init 一次）。典型不复位者：
    `STObstaclesProcessor::adc_low_road_right_segments_` **无界增长**、`fail_search_fallback_` 置位后每帧走 fallback 停车。
28. **速度链两条隐式契约**：`SpeedBoundsDecider` 跑两遍且每遍开头 `EraseStBoundaries()`，
    PRIORI 与 FINAL 之间写 ST 边界的成果被擦掉；`SpeedOptimizer` 的第三个参数就是 `mutable_speed_data()`。

### 感知

29. **感知链路四类静默失效**：改 channel 只改一边（输入在 dag、输出在 conf）；**只有 main sensor 的帧才真正 Write**
    （默认只有 `velodyne64`，日志只平静地打 `Skip because it is not the main sensor`，**无 lidar 车型融合永不输出**）；
    `QueryLatestFrame` 推进时间戳使落后的帧**永久跳过且不报错**；同时启动两条同类路线互相覆盖。
30. **相机 3D 测距的标定链根本没接上**（排查相机高度/距离异常最高优先级）：`camera_tracking` 的
    `camera_k_matrix` 与 `calibration_service` **从不填充**（K 恒为单位矩阵），`camera_location_refinement`
    **目前是直通**。这是现状不是 bug 表象。深度误差随距离平方增长，相机外观特征几乎无效。

**补充（同等重要）**：红绿灯五大坑（地图无灯时短路成最长焦相机、单个边界点 `z<=0` 杀掉整个灯、
相机选择每 0.3s 重算且无滞回、`SyncInformation` 无容差检查、低于阈值给 TL_BLACK 而非 UNKNOWN）；
**BEV/OCC 按现状跑不起来**（`sensor_meta.pb.txt` 无 `CAM_*` 条目使 ACHECK 失败、`petrv1` 目录不存在、
BUILD 没打包 conf/dag filegroup）。

> 其余 108 条坑（dreamview 双份代码、control 子模块 dag 路径过时、切车型静默覆盖工作副本、
> `rosbag/` 脚本必须从仓库根执行等）见各 digest 的「已知坑」章节（`_wip-sec-{a,b,c}.md`
> **本环境不存在**）。**已确认代码缺陷清单（约 87 条高确信度，含 file:line）见
> `（原始精读材料，未随包分发）` 第五节**，按 cyber / common / planning / perception / prediction-control /
> localization-map-routing / canbus-drivers / dreamview 分表，另有第 5.9 节「死代码 / 死配置速查（改参数无效的地方）」。

## 七、快速反查命令

> **本环境**：没有整仓根目录，把下面的 `modules/` 换成 `/opt/apollo/neo/src/modules/`（只读全量源码），
> 头文件类查询再补一遍 `/opt/apollo/neo/include/modules/`；`.dag`/`.launch`/`.conf` 的**运行期**副本在
> `/apollo/modules/...`。`grep STATUS tools/package/dynamic_deps.bzl` 在本环境应为 **2（包管理）**。

```bash
S=/opt/apollo/neo/src/modules; I=/opt/apollo/neo/include/modules

# 某 channel 是谁写的
grep -rn "CreateWriter" --include="*.cc" $S | grep -i <关键字>
# 某 channel 是谁读的（dag 侧）
grep -rn "<channel>" --include="*.dag" $S /apollo/modules
# 某 channel 名定义在哪
grep -rn "<channel>" --include="*_gflags.cc" --include="*.pb.txt" $S
# 某 Component 类属于哪个 dag
grep -rln "<ClassName>" --include="*.dag" $S /apollo/modules
# 某 dag 被哪个 launch / HMI mode 引用（查不到 = 孤儿 dag，只能 mainboard -d 手动跑）
grep -rn "<dag相对路径>" --include="*.launch" --include="*.pb.txt" $S
# 某 flag 的默认值与实际值
grep -rn "DEFINE_.*(<flag名>" $S ; grep -rn "^--<flag名>" $S /apollo/modules
# 某个类/基类到底还存不存在（两棵树都要搜！）
grep -rn "class <YourClass>" $S $I
```

## 八、新人第一天阅读顺序（约 2000 行，建立全局认知）

1. 官方文档 `docs/` —— **本环境未安装 docs**，改看在线文档或 `README.md`。
2. `cyber/component/component_base.h`（128 行）—— conf/flag 怎么进来的（**cyber 头文件在 `/opt/apollo/neo/include/cyber/`**）。
3. `modules/storytelling/` 全部（17 文件）—— 最小完整 TimerComponent，dag + conf + component 一次看完。
4. `modules/planning/planning_component/planning_component.cc` 的 `Init()` —— 复杂模块如何组织 6 reader + 3 writer。
5. `modules/common/adapters/adapter_gflags.cc` —— 通读 channel 清单，之后看任何 `FLAGS_xxx_topic` 都知道是什么。
6. `modules/dreamview_plus/conf/hmi_modes/default.pb.txt` —— 一套系统实际由哪些 dag 组成。
7. `cyber/tools/cyber_launch/cyber_launch.py` 的解析段 —— launch 到进程怎么落地。
8. **本环境额外必读**：仓库根 `CLAUDE.md`（四层路径模型 + buildtool 用法）。

## 九、口径与盲区

- **`file:line` 口径**：23 份 digest 内已逐条核验，但总报告与本 skill **未二次回源复核**，且都是在
  **整仓形态 + 更早版本**下写的。改代码前按 file:line 打开确认；`src/` 里找不到时补搜 `include/`。
- **本环境已现场核对并修正的失效项**：guardian / task_manager / audio / v2x / bridge /
  third_party_perception / contrib 模块整体消失（取代 guardian 的是 `modules/safety_manager/`）；
  `controllers/mpc_controller`、`controllers/demo_control_task`、`planners/{lattice,navi,rtk}` 消失；
  `apollo_package.bzl` 738 行（不是 744）；perception 31 子目录（不是 34）；`_wip-sec-{a,b,c}.md` 不存在。
- **构建结论口径**：digest 的构建/测试类结论来自读脚本与 BUILD，**未实际执行**；本环境的构建入口是
  `buildtool build -p <包路径>`（**不是 `apollo.sh`，也不能只 `bazel build`** —— 后者不做 install，运行时看不见）。
- **弱覆盖区**：`dreamview*/frontend/` 前端只到目录与构建方式级；`modules/data`、`modules/statistics`、
  `modules/safety_manager` 无专门章节；单测整体弱覆盖（**lidar 全部单测、`class_loader_test`、
  `lane_follow_map_test`、`park_data_center_test` 未接进 BUILD 或被注释 ——「有测试」不等于「测试在跑」**）；
  radar4d 的 `.cu` kernel 与 `point_pillars.cc` 只到 grep 级。






