# Apollo 全局导航

> **⚠️ 本环境（包工作区）适配**：本环境是独立包管理工作区 `/apollo_workspace`，根下**没有** `modules/`、`cyber/`、`apollo.sh`。
> 本文所有 `modules/...` 路径这样用：**只读代码** → 拼 `/opt/apollo/neo/src/` 前缀（Apollo 11.0.0 全量源码，只读）；
> **要改代码** → 先 `buildtool install <pkg>`，源码落到 `/apollo_workspace/modules/...`，**完整保留仓库相对路径、不用换算**。
> 编译用 `buildtool build -p <相对工作区的包路径>` —— 不是 `./apollo.sh build`，也**不能只 `bazel build`**（后者不做 install，运行时看不见）。
> 运行期的 conf/dag/launch 入口是 `/apollo/<src_path>/`（`APOLLO_ROOT_DIR=/apollo`，里面文件是指向
> `/opt/apollo/neo/share/...` 的符号链接，改了立即生效）。完整对照见仓库根 `CLAUDE.md`；插件路径差异见 `modules/plugin-dev/` 开头适配段。

仓库根 = 你的 apollo 源码根目录（容器内通常是 `/apollo`）。本文所有路径均相对仓库根。
长知识（23 份 digest 索引、完整模块依赖、channel 速查、gflags 生效链路、高危坑 TOP30 指针）见 `reference.md`。

> **⚠️ 本环境第二条路径事实**：`/opt/apollo/neo/src/` **不全** —— 二进制包只装头文件到
> `/opt/apollo/neo/include/`。`ls src/modules | wc -l` = 34，`ls include/modules | wc -l` = 39，
> 且**同一个包内部也可能只装了部分子目录**。所以「`src/` 里 grep 不到」**不等于**这个类/模块被删了，
> 必须两棵树都搜：`grep -rn "<符号>" /opt/apollo/neo/src/modules/ /opt/apollo/neo/include/modules/`。
> 详见 `apollo-plugin-dev/SKILL.md` §7。

**通用三步法**（任何模块都适用，最快建立认知）：
1. 找 `dag/*.dag` → 知道 Component 类名、订阅哪些 channel、用哪个 conf 与 flag。
2. 读 `*_component.cc` 的 `Init()` → 所有 reader/writer 都在这里创建，输入输出一眼看全。
3. 读 `Proc()` / `OnMessage` 回调 → 主处理流程入口。然后再下钻算法目录。

## 一、我想改 X → 先看这几个文件

| 想做什么 | 先看这几个文件（相对仓库根） | 相关 skill |
|---|---|---|
| 改感知 lidar 检测/分割/跟踪算法 | `modules/perception/launch/perception_lidar.launch` 定位涉及哪些 component → `modules/perception/{pointcloud_preprocess,pointcloud_map_based_roi,pointcloud_ground_detection,lidar_detection,lidar_detection_filter,lidar_tracking,lidar_output}/<x>_component.cc` → 各 `conf/*.pb.txt` 的 `output_channel_name` | apollo-perception-dev、apollo-plugin-dev |
| 改感知 camera 流水线 | `modules/perception/launch/perception_camera_multi_stage.launch` → `camera_detection_multi_stage` → `camera_location_estimation` → `camera_location_refinement` → `camera_tracking`（四段**必须同进程**） | apollo-perception-dev |
| 接 BEV / OCC 模型 | `modules/perception/camera_detection_bev/`、`modules/perception/camera_detection_occupancy/`（**孤儿 dag，无 launch，按现状跑不起来**，见 reference.md 坑 29/30） | apollo-perception-dev |
| 改多传感器融合 / 加一路传感器进融合 | `modules/perception/multi_sensor_fusion/multi_sensor_fusion_component.cc` → `conf/multi_sensor_fusion_config.pb.txt` → `data/probabilistic_fusion.pb.txt`；主传感器定义在 `modules/perception/data/conf/sensor_meta.pb.txt` | apollo-perception-dev |
| 改红绿灯 | `modules/perception/traffic_light_{region_proposal,detection,recognition,tracking}/`（四段串联，inner channel 拼写是 `/perception/inner/Retection`，**不能纠正**） | apollo-perception-dev |
| 加/改规划 task 或 scenario | `modules/planning/planning_component/conf/planning_config.pb.txt` → `modules/planning/planners/public_road/conf/planner_config.pb.txt`（场景注册与优先级）→ `modules/planning/scenarios/<x>/`、`modules/planning/tasks/<x>/` | apollo-planning-dev、apollo-plugin-dev |
| 改规划数值参数 | `modules/planning/planning_component/conf/planning.conf`（gflags，200+ 项）；task 级参数在 `modules/planning/tasks/<x>/conf/default_conf.pb.txt` 与 scenario 下 stage 目录的实例级 pb.txt | apollo-planning-dev |
| 改泊车 / openspace | `modules/planning/planning_open_space/`（Hybrid A* / DistanceApproach / IterativeAnchoring）+ `modules/planning/planning_component/conf/planner_open_space_config.pb.txt` | apollo-planning-dev |
| 改 traffic rule | `modules/planning/traffic_rules/<x>/`（10 条）+ `modules/planning/planning_component/conf/traffic_rule_config.pb.txt` | apollo-planning-dev、apollo-plugin-dev |
| 调控制参数 / 加 controller | `modules/control/control_component/control_component.cc` → `conf/pipeline.pb.txt`（控制器链）→ `modules/control/controllers/<x>/conf/controller_conf.pb.txt`；全局 flag `modules/control/control_component/conf/control.conf`；标定表 `conf/calibration_table.pb.txt` | apollo-control-dev、apollo-plugin-dev |
| 适配新车型 CAN 协议 | `modules/canbus_vehicle/<brand>/{<brand>_controller.cc,<brand>_message_manager.cc,protocol/}`（抄 `lincoln` 或 `devkit`）→ `modules/canbus/conf/canbus.conf` 的 `--load_vehicle_class_name`；DBC 生成器 `modules/tools/gen_vehicle_protocol/` | apollo-vehicle-sensor |
| 接新雷达 / 相机 / lidar / GNSS | 抄同类驱动：`modules/drivers/lidar/seyond/`、`modules/drivers/radar/oculii_radar/`、`modules/drivers/camera/`、`modules/drivers/gnss/`（GNSS 单独见 apollo-gnss-driver）。必配套 `dag/`+`launch/`+`conf/`+`cyberfile.xml`，channel 名加到 `modules/common/adapters/adapter_gflags.cc` | apollo-vehicle-sensor |
| 加传感器外参 / 改坐标变换 | `modules/transform/conf/static_transform_conf.pb.txt`（加 `extrinsic_file` 块）→ 对应 yaml（部分在 `modules/calibration/data/<vehicle>/`）；查询侧 `modules/transform/buffer.cc` | — |
| 改预测（evaluator / predictor） | `modules/prediction/prediction_component.cc` → `modules/prediction/{container,scenario,evaluator,predictor}/`；参数 `modules/prediction/conf/prediction.conf`；模型插件抄 `modules/prediction_plugin/semantic_lstm_vehicle_tensorrt/` | apollo-plugin-dev |
| 改定位 | 三选一：`modules/localization/rtk/rtk_localization_component.cc`（最简，先读这个）/ `msf/msf_localization_component.cc` / `ndt/ndt_localization_component.cc`；参数 `modules/localization/conf/localization.conf`（注意 `conf/msf_localization.pb.txt` 是死文件）| apollo-localization-dev |
| 改地图 / 地图查询 | `modules/map/hdmap/`（是**库不是进程**，每进程各持一份）、`modules/map/pnc_map/`、地图数据 `modules/map/data/<region>/`；改地图文件必须重启相关进程 | — |
| 改 routing 路径搜索 | `modules/routing/{core,graph,strategy}/`（`routing_component.cc` 只是壳）；**代价烧进 `routing_map.bin`，改完必须重跑 `modules/routing/topo_creator/`，并重启 `external_command`（内联调用）而非 routing 进程** | — |
| 改外部指令接口 / 加命令类型 | `modules/external_command/command_processor/command_processor_base/motion_command_processor_base.h` → 抄一个 `modules/external_command/command_processor/<x>_command_processor/` → **必须**注册到 `modules/external_command/process_component/conf/config.pb.txt`（当前只注册 3 个，6 个有实现未注册） | apollo-debug |
| 改 HMI / 加模块开关 / 加车型 | `modules/dreamview_plus/conf/hmi_modes/{default,pnc,perception,vehicle_test}.pb.txt` → `modules/dreamview_plus/backend/hmi/hmi_worker.cc` → 前端 `modules/dreamview_plus/frontend/`；旧版 20 个 mode 在 `modules/dreamview/conf/hmi_modes/` | apollo-hmi-dev |
| 改仿真行为（SimControl） | `modules/dreamview/backend/common/sim_control_manager/dynamic_model/perfect_control/sim_perfect_control.cc`（伪造 pose/chassis）；带动力学的在 `core/sim_control_with_model_base.cc`。**注意只有 dreamview 一份，dv_plus 复用它** | apollo-hmi-dev |
| 加一个全新 cyber 模块 | TimerComponent 范本 `modules/storytelling/`（17 个文件，最小完整）：component `.h/.cc` + `proto/` + `conf/` + `dag/` + `launch/` + `cyberfile.xml` + `BUILD`；消息触发型（`Component<T>`）抄 `modules/drivers/tools/image_decompress/`。**本环境无 `modules/guardian`、`modules/task_manager`**（src/ 与 include/ 都核对过） | apollo-new-component、apollo-build-test |
| 加/改插件（任何一类） | `cyber/plugin_manager/`；写 `plugins.xml` 四件套；实例 `modules/prediction_plugin/*/plugins.xml`、`modules/perception/perception_plugin/` | apollo-plugin-dev |
| 改消息定义 / 找 proto | `modules/common_msgs/<domain>_msgs/*.proto`（22 个域）—— **跨模块契约，改动影响面最大** | — |
| 改 channel 名 / 加新 channel | `modules/common/adapters/adapter_gflags.cc`（定义，约 130 个 `*_topic`）→ 模块 `*_component.cc` 的 `Init()`（使用）→ 该模块 `dag/*.dag` 的 `readers`（订阅）。**三处都要改** | apollo-debug |
| 加监控项 / 故障检测 | `modules/monitor/monitor.cc` → `modules/monitor/software/<x>_monitor.cc`（抄 `channel_monitor.cc`）/ `modules/monitor/hardware/`；**新加 monitored_component 要显式写 `required_for_safety: false`，否则等于加了个刹停开关** | apollo-debug |
| 改安全兜底 / 功能安全 | **`modules/guardian/` 已不存在**，取而代之的是 `modules/safety_manager/checker/`（包名 `safety-checkers`，10 个 checker 各自一个 Component，9 个挂在同一个 `checker/dag/checkers.dag` 里）+ 消息契约 `modules/safety_manager_msgs/safety_manager.proto`（`SafetyStatus` 8 档状态 / `SafetyDecision` / `RuleMatcherList` 规则匹配器）。详见第七节 | apollo-debug |
| 改 record 录制规则 / 加性能统计 | `modules/data/tools/smart_recorder/`；`modules/statistics/{resource,process,latency}/`；`cyber/tools/cyber_performance/` | apollo-debug |
| 改 cyber 运行时本身 | `cyber/component/component_base.h`（conf/flag 怎么进来）→ `cyber/component/component.h`（模板机制）→ `cyber/node/` → `cyber/scheduler/` → `cyber/transport/`（零拷贝）；dag 加载在 `cyber/mainboard/module_controller.cc` | apollo-debug、apollo-build-test |
| 编不过 / 链接找不到符号 / 单测怎么跑 | **本环境**：`buildtool build -p <包路径>`（无 `apollo.sh`）、`tools/apollo_package.bzl`（宏定义 738 行）；整仓形态才有 `apollo.sh` + `scripts/apollo_base.sh` | apollo-build-test |
| 起不来 / 收不到消息 / 改了 conf 没生效 | 先跑验证链（见第四节末），再查 dag 的 `flag_file_path` 与 `config_file_path` | apollo-debug |

## 二、模块职责（本环境现场核对：`ls /opt/apollo/neo/src/modules/` = **34** 个，另有 5 个只装了头文件，并集 **39**；代码量与入口文件见 `reference.md` 第二节）

主链路：`perception`（最大，**31** 子目录）· `planning`（10 子目录）· `prediction` · `control`（**7** 个 controller 插件）· `canbus` ·
`canbus_vehicle`（11 车型：ch/demo/devkit/ge3/gem/lexus/lincoln/neolix_edu/transit/wey/zhongyun）·
`drivers`（camera/lidar/radar/gnss/canbus/microphone/video/smartereye/lidar_fusion_and_compensator/tools）·
`localization`（`rtk/` `msf/` `ndt/`）· `map`（`hdmap/` 查询库 + `pnc_map/` + `relative_map/` + `data/`）·
`routing`（9.0 后主要作为库被 external_command 内联调用）。

编排旁路：`external_command`（**9.0 后唯一外部指令正门**，10 processor）· `transform` ·
`storytelling`（**最小完整 TimerComponent 范本**，17 文件）· `monitor` · `safety_manager`（功能安全兜底，10 checker，**取代已删除的 guardian**）·
`dreamview`（旧 HMI 8899，**SimControl 在这里**）· `dreamview_plus`（新 HMI 8888，主推）· `dreamview_plus_plugins` · `statistics` ·
`data`（smart_recorder）· `safety_manager_msgs`（`safety_manager.proto`，不再是空壳）。

库与数据：`common`（`adapters/` 是 channel gflags 权威）· `common_msgs`（22 域纯 proto 契约）· `tools`（modules/tools 工具箱）·
`private_tools` · `calibration`（纯数据）· `conf_gen` · `prediction_plugin`（4 个 TensorRT 插件）· `statistics_msgs` ·
`sensor_calibration` · `loam_velodyne` / `loam_velodyne_indoor` / `slam_local` / `localization_intergrate`（建图与定位集成，拼写原样）。

只装了头文件、`src/` 下看不到的 5 个：`dreamview_plus_plugin_panels`、`dreamview_plus_toolbox_installer`、
`private_common`、`sim_obstacle`、`studio_connector`。

**本环境已不存在的模块**（`src/` 与 `include/` 两棵树都核对过，老文档常引用，别去 `cd`）：
`guardian`、`task_manager`、`audio`、`v2x`、`bridge`、`third_party_perception`、`contrib`。
其中 guardian 只剩两处残迹：消息 `modules/common_msgs/guardian_msgs/guardian.proto`，以及
**canbus 里完整保留的 guardian 消费侧代码**（`canbus_component.cc:76-78` 建 `FLAGS_guardian_topic` 的 reader，
conf 里 `--noreceive_guardian` / `--use_guardian_cmd_check=false` 都还在）—— 即通道还在、发布者没了。

三处易记错：`modules/planning/` 根下没有 dag/launch/conf（在 `planning_component/`）；
`modules/perception/launch/` 集中放 9 个 launch 而各子模块自带 `dag/`+`conf/`；
根 `tools/` 是 bazel 扩展规则，**与 `modules/tools` 完全无关**。

## 三、主链路数据流（channel 名以 `modules/common/adapters/adapter_gflags.cc` 为权威）

```
drivers  gnss  → /apollo/sensor/gnss/{odometry,corrected_imu,imu,best_pose,ins_stat,heading}
         lidar → /apollo/sensor/lidar<N>/PointCloud2 → compensator → .../compensator/PointCloud2
         camera→ /apollo/sensor/camera/<pos>/image(+/compressed)
         radar → /apollo/sensor/radar/{front,rear}
localization  → /apollo/localization/pose (LocalizationEstimate) + /apollo/localization/msf_status
transform     → /tf, /tf_static
perception    → /apollo/perception/obstacles、/apollo/perception/traffic_light、/perception/lanes
prediction    ← obstacles(唯一 trigger) + pose + /apollo/planning + /apollo/storytelling
              → /apollo/prediction
planning      ← /apollo/prediction(触发1) + /apollo/canbus/chassis(触发2) + /apollo/localization/pose(触发3)
              ← /apollo/planning/command + perception/traffic_light + planning/pad + storytelling
              → /apollo/planning (ADCTrajectory) + /apollo/planning/command_status
control       ← /apollo/planning + chassis + pose + control/pad → /apollo/control (+ debug/localview)
safety_manager← 各 checker 分别订阅 statistics / pose / chassis / control → SafetyStatus，决策发 /apollo/safety/decision
canbus        ← /apollo/control（默认；conf 里 `--noreceive_guardian`）；`/apollo/guardian` 的 reader 代码仍在但**本环境无发布者** → /apollo/canbus/chassis
```

感知内部（inner channel，**不在 adapter_gflags 里**，只在各模块 conf 的 `output_channel_name`）：
lidar 七段串联 preprocess → map_roi → ground → detection → filter → tracking → output，汇入
`/perception/inner/PrefusedObjects`；camera 四段同链也汇入该 channel；融合以它为 trigger，
**只有 main sensor（默认 velodyne64，定义在 `modules/perception/data/conf/sensor_meta.pb.txt`）的帧才真正 Write**。
红绿灯段间是 `/perception/inner/Retection`（拼写已固化）。

**指令下发链路（9.0 新入口，最易踩坑）**：外部 HTTP / dreamview_plus / demo（**本环境无 task_manager**）
→ **cyber Service** `/apollo/external_command/<type>`（不是 Topic，`cyber_channel pub` 发不出去）
→ `ExternalCommandProcessComponent` → `MotionCommandProcessorBase` **内联调用 routing 库** → `/apollo/planning/command`。

**4 处运行时环**（channel 异步解耦，各带一帧延迟）：planning↔storytelling、planning↔external_command
（`planning.launch` 同进程以减小延迟）、planning↔control（`/apollo/control/interactive`）、prediction↔planning。

## 四、启动顺序与 dag / launch 位置约定

依赖驱动 7 层（cyber 是 pub/sub，晚起基本不崩）：
```
第 0 层  transform(/tf_static) / monitor(SystemStatus) / dreamview_plus(HMI)
第 1 层  数据源三选一：drivers(gnss→lidar→camera→radar) | cyber_recorder play | SimControl
第 2 层  localization ← gnss(+lidar)；canbus ← 车辆 CAN
第 3 层  perception ← camera/lidar/radar + pose + /tf；storytelling ← map
第 4 层  prediction ← perception/obstacles + pose
第 5 层  external_command + planning（planning.launch 二者同进程）
第 6 层  control ← planning + chassis + pose
第 7 层  canbus ← /apollo/control；safety_manager 的 checker 可任意时刻起（纯旁路监测）
```
只有 2 处顺序真会出问题：transform 晚起刷 `Can not find transform`；而 `planning_command`/`routing_response` 用
`DURABILITY_TRANSIENT_LOCAL`，晚起订阅方**能**收到最后一条（设计如此，也是「我没发命令但车动了」的原因）。
（老文档里「canbus 早于 guardian 会收不到指令」这条**在本环境不成立**：guardian 模块已不存在，
canbus 默认 `--noreceive_guardian` 直接吃 `/apollo/control`。）

**dag / launch 位置约定**（现场核对）：
- 常规模块：`modules/<m>/dag/*.dag` + `modules/<m>/launch/*.launch` + `modules/<m>/conf/`
  （canbus / prediction / localization / transform / monitor / storytelling）。
- **safety_manager**：dag 单独成包，`modules/safety_manager/checker/dag/checkers.dag` 一个 dag 起 9 个 checker，
  各 checker 的 conf 在自己目录 `modules/safety_manager/checker/<x>/conf/`。
- **planning**：`modules/planning/planning_component/{dag,launch,conf}/`（`planning.dag`、`planning.launch`）。
- **control**：`modules/control/control_component/{dag,launch,conf}/`（`control.dag` + 两个 submodule dag）。
- **perception**：launch 集中在 `modules/perception/launch/`（9 个：`perception_all` / `_lidar` / `_camera_multi_stage` /
  `_camera_single_stage` / `_radar` / `_radar4d` / `_trafficlight` / `_lane`），dag 分散在各子模块 `dag/`，
  共享 flag 是 `modules/perception/data/flag/perception_common.flag`。
- **external_command**：`modules/external_command/process_component/{dag,launch,conf}/`。
- **cyber 自带**：`cyber/examples/*/`（2 dag / 2 launch）+ `cyber/tools/cyber_performance/cyber_performance.launch`。
- 数量口径（勿混用）：只看 `modules/` 是 **107 dag / 90 launch**；全仓含 `cyber/` 是 **109 / 93**。
  其中 17 个孤儿 dag 无任何 launch 或 HMI mode 引用，只能 `mainboard -d` 手动跑（含 BEV/OCC）。
- **实际最常用的启动方式是 HMI 驱动**：`modules/dreamview_plus/conf/hmi_modes/`（4 个）与
  `modules/dreamview/conf/hmi_modes/`（20 个）是事实上的启动编排清单。`scripts/bootstrap.sh` 只起 monitor + dreamview。

**起来之后的验证顺序**（第一个断掉处就是问题）：
`/apollo/localization/pose` → `/apollo/perception/obstacles` → `/apollo/prediction` →
`/apollo/planning` → `/apollo/control`，每段用 `cyber_channel hz <ch>` / `echo <ch>` / `cyber_monitor` 确认。

## 五、全仓 10 条铁律

1. **输入 channel 只在 dag 的 `readers`，输出 channel 只在 conf**（perception 用 `output_channel_name`，
   planning/control 用 `adapter_gflags` 的 `*_topic`）。只改一边 = **链路静默断开、零报错**。
2. **失败大多是静默的**（注册失败 / conf 名写错 / AllLatest 冷启动 / override 错签名多数只 AWARN 或直接返回成功）。
   **不要用 Status/返回值判断健康度**，要用 `cyber_channel hz/echo` 逐段验证。
3. **三套注册机制并存**（cyber class_loader / cyber PluginManager / perception 自研 registerer，canbus 另有车型工厂）。
   选错等于白写，见 apollo-plugin-dev。
4. **`alwayslink=True` 缺失 = 注册对象被链接器裁掉 = 插件消失，无编译期提示**。一律用 `apollo_cc_library` /
   `apollo_component` / `apollo_plugin`，原生 `cc_library` 被 `scripts/apollo_rule_check.sh` 全仓禁用。
5. **类名即路径与配置的键**：conf 路径由类名 RTTI demangle 反推（planning 的 Task/Scenario/TrafficRule/Planner、
   control 的 ControlTask）。**改类名是跨 4~12 个文件的动作。**
6. **配置双轨制**：gflags 走 dag 的 `flag_file_path`（**进程级**，后写覆盖前写，同进程多 component 互相覆盖，
   链条根 `modules/common/data/global_flagfile.txt`，dreamview 切地图/车型会追加改写它）；proto config 走
   `config_file_path`（**MergeFrom 语义，repeated 字段是追加不是替换**）。
7. **conf 未写的字段取 proto default 而非 0**，且「proto 默认值 ≠ pb.txt 值 ≠ C++ 成员初值」刻意不同处极多。
8. **单位与坐标系不统一**：长度米、角度**弧度**；`Header.timestamp_sec` 是秒且为发布时刻，传感器 `*_timestamp`
   是纳秒，时间对齐**必须用 `measurement_time`**；`Pose.position` 是后轴中心，`linear_velocity` 是 ENU 而
   `_vrf` 后缀才是车体系；`Pose.euler_angles` 是 z-x-y 而 `Ins.euler_angles` 是 z-y-x；`heading` 朝东为 0、`yaw` 朝北为 0。
9. **拼写错误已固化，不能「纠正」**：`/perception/inner/Retection`、`foreground_mathcer_method`、
   `raw_rrouting_response_history`、`online_visualizer_compenont.so`、`control_interative_topic`、`FLAGS_logtassderr`。
10. **双份/三份代码是高频 bug 来源**（`simulation_world_service.cc` 两份、障碍物转 `Object` 三份、
    `hmi_worker.cc` 两份、`IsClearToChangeLane` 三份）。**改 bug 前先 `grep -rn "<函数名>"`。**

另两条环境事实：HD 地图是**链入各进程的库，每进程各持一份**，改地图必须重启相关进程；routing 代价
**烧进 `routing_map.bin`**，改代价后必须重跑 `topo_creator` 并重启 `external_command`。


## 六、专项模块索引（`modules/`）

| skill | 何时用 | 状态 |
|---|---|---|
| `modules/architecture/` | 本 skill。全局导航：功能在哪个模块、改 X 先看哪几个文件、数据流与启动顺序 | 已有 |
| `modules/build-test/` | 编译单模块、跑 bazel 单测、lint/格式化、进 dev 容器、定位编译与链接错误 | 已有 |
| `modules/plugin-dev/` | 加/改插件（planning task/scenario/stage/traffic_rule/planner、perception 检测器与滤波器、control controller）、写 plugins.xml、注册不生效、conf 找不到 | 已有 |
| `modules/planning-dev/` | 加/改 planning task/scenario/stage/traffic_rule、调规划参数、规划不出轨迹、场景不切换、openspace 泊车 | 已有 |
| `modules/debug/` | 模块起不来/不发消息/频率不对/崩溃/退不出、改 conf 没生效；cyber_monitor / cyber_channel / cyber_recorder / mainboard 等工具实操 | 已有 |
| `modules/new-component/` | 新增一个 cyber Component 的全套文件（dag/launch/conf/BUILD/cyberfile.xml），范本取自 `modules/storytelling/`（TimerComponent）与 `modules/drivers/tools/image_decompress/`（`Component<T>`） | 已有 |
| `modules/perception-dev/` | 新增检测器/滤波器/跟踪器、接入新模型、用 msg_adapter 单模块调试 | 已有 |
| `modules/control-dev/` | 新增 controller、横纵向调参、标定表生成、prediction evaluator/predictor | 已有 |
| `modules/vehicle-sensor/` | 适配新车型 CAN 协议、接入新雷达/相机/radar、外参标定 | 已有 |
| `modules/hmi-dev/` | 加 HMI 面板/后端接口/HMI 模式/车型、SimControl | 已有 |
| `modules/localization-dev/` | 改 RTK/NDT/MSF 定位、调噪声权重、新增一路观测或一种定位方案、制作 MSF 定位地图、改 IMU 安装角与 GNSS 杆臂、定位不收敛/精度差/跳变 | 已有 |
| `modules/gnss-driver/` | 改 GNSS/INS 驱动：新增协议 parser、新增串口/TCP/UDP/NTRIP/CAN 连接、加报文 ID 或输出 channel、GNSS 无数据/时间戳为 0/CRC 失败 | 已有 |

尚无专属 skill 的模块：`map`（制图与 HD 地图元素）、`routing`（拓扑与代价函数）、
`external_command`（指令下发入口）、`common_msgs`（改 proto 消息）。
分别暂查 `（原始精读材料，未随包分发）`、`41-tools-and-misc.md`、
`03-common-and-msgs.md`。

**详细知识库在 `（原始精读材料，未随包分发）`**：23 份 digest（约 33000 行，按模块逐文件精读的结果）+
`README.md`（933 行总报告：digest 索引 / 一页速览 / 跨模块共性规律 / 高危坑 TOP30 / 已确认缺陷清单 /
已知盲区）+ `RESUME.md`。digest 索引表与「什么问题查哪一份」见 `reference.md` 第一节。

> 口径提醒：digest 与 README 里的 `file:line` 是精读时记录、**未逐条二次回源复核**，而且是在
> **整仓形态 + 更早版本**下写的 —— 本环境（包工作区 / Apollo 11.0）已核对出多处失效，
> 尤其是 guardian / task_manager / audio / v2x / bridge / third_party_perception / contrib /
> mpc_controller / demo_control_task / planners 下的 lattice·navi·rtk **都已不存在**。
> 改代码前请按 file:line 打开确认，并记得 `src/` 搜不到时补搜 `include/`。

## 七、safety_manager：本环境的功能安全兜底（取代 guardian）

包 `safety-checkers`，`<src_path>//modules/safety_manager/checker/dag`。`src/` 下只有
`checker/dag` 与 `checker/collision_checker/proto` 两处源码，10 个 checker 的 `.so` 都是二进制包
（`ls /opt/apollo/neo/lib/modules/safety_manager/checker/`）。运行期入口
`/apollo/modules/safety_manager/checker/dag/checkers.dag` —— **一个 dag 里 9 个 Component**：

| checker | class_name | dag 段 | 触发方式 |
|---|---|---|---|
| `channel_freq_checker` | `ChannelFreqCheckerComponent` | `components{}` | node 名 `safety_channel_freq_checker` |
| `collision_checker` | `CollisionCheckerComponent` | `timer_components{}` | interval 1000 |
| `control_checker` | `ControlCheckerComponent` | `timer_components{}` | interval 100 |
| `latency_checker` | `LatencyCheckerComponent` | `components{}` | reader `/apollo/statistics/latency`（depth 1）|
| `localization_checker` | `LocalizationCheckerComponent` | `timer_components{}` | interval 200，**只有 flag_file_path 没有 config_file_path** |
| `localization_shake_checker` | `LocalizationShakeCheckerComponent` | `components{}` | readers `/apollo/localization/pose` + `/apollo/canbus/chassis` |
| `process_checker` | `ProcessCheckerComponent` | `timer_components{}` | interval 205 |
| `resource_checker` | `ResourceCheckerComponent` | `components{}` | reader `/apollo/statistics/resources`（depth 1）|
| `swing_checker` | `SwingCheckerComponent` | `timer_components{}` | interval 1000 |

> `file_exist_checker` 的包**装了但没挂进 dag**（lib 下有 10 个目录，dag 里只有 9 个），要用得自己加一段。

消息契约 `modules/safety_manager_msgs/safety_manager.proto`（**不再是空壳**）：
- `SafetyStatus.Status` **8 档**：`OK / WARN_PENDING / ERROR_PENDING / FATAL_PENDING / WARN / ERROR / FATAL / WAIT_REMOVED`。
  语义写在注释里：`WARN` 只报警，`ERROR` 触发舒适刹停，`FATAL` 触发紧急刹停。
- `SafetyRule{timeout, duration, filter, fault_removed_secs=5}` + `Filter{required_cycles, total_cycles}`
  —— `*_PENDING` 就是「规则条件还没满足到 required_cycles/total_cycles」的中间态。
- `Matcher` 支持 `name`（全等）/`contains`/`prefix`/`regex`/`tags_contains_one`/`tags_contains_many` 六种匹配，
  `RuleMatcherList` 是配置文件里的规则表形态。
- `SafetyDecision{safety_mode_trigger_time, require_emergency_stop}` → channel **`/apollo/safety/decision`**。
  消费者已现场核对：`modules/control/controllers/replan_control_task/`（`conf/controller_conf.pb.txt:1` 的
  `guardian_decision_topic: "/apollo/safety/decision"`，字段名仍叫 guardian，是历史残留）。
- 还有一对 Service 消息 `SafetyFaultRemoveRequest/Response`（按 name 列表清故障）。

**注意**：`adapter_gflags.cc` 里**没有任何 safety 相关 gflag**（`grep -n safety` 无命中），
所以 `/apollo/safety/decision` 这个名字是写死在各自的 proto default / conf 里的，改名要逐处搜。
