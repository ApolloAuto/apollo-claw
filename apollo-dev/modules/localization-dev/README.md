# Apollo 定位改代码作业指导书

> **⚠️ 本环境（包工作区）适配**：本环境是独立包管理工作区 `/apollo_workspace`，根下没有 `modules/`、`apollo.sh`。
> 本文 `modules/localization/...` 路径：**只读** → 拼 `/opt/apollo/neo/src/`；**要改** → 先
> `buildtool install <pkg>`，落到 `/apollo_workspace/modules/localization/...`（保留完整仓库相对路径，不用换算）。
> 编译用 `buildtool build -p <相对工作区的包路径>`，**不能只 `bazel build`**（不做 install，运行时看不见）。
> **调噪声权重、改 IMU 安装角与杆臂标定**：走 `/apollo/<src_path>/conf/*`（符号链接，立即生效）；
> 改工作区源码副本的 conf 要重编才生效。
> **地图与定位地图路径（现场核对）**：`--map_dir` 在 `/apollo/modules/common/data/global_flagfile.txt`
> 里被写了 **3 行**（`:14` sunnyvale_loop、`:20` sunnyvale、`:22` sunnyvale_big_loop），gflags 按序求值
> **生效的是最后一行 `/apollo/modules/map/data/sunnyvale_big_loop`** —— 而**本环境根本没有这个目录**：
> `/apollo/modules/map/data/` 下只有 `borregas_ave`（`base_map.bin` / `routing_map.bin` / `sim_map.bin`）
> 与 `demo`（txt 版），文件全是指向 `/opt/apollo/neo/share/modules/map/data/` 的符号链接；
> `/apollo/data/map_data/` 是同一批链接的另一个入口（内容一致）。
> **所以起 planning / localization 前必须先把 `--map_dir` 改成 `borregas_ave`，或装别的地图包**
> （地图是独立 apt 包，`apt-cache search apollo-neo-map`）。MSF 定位地图（`local_map/` 那种金字塔目录）
> 本环境**一个都没有**，制图工具产物路径由命令行参数决定，不走上面这些默认值。
> 完整对照见仓库根 `CLAUDE.md`。

路径相对仓库根。长知识（全 flag 表、proto 字段语义、地图磁盘格式、缺陷全表、死代码清单）见 `reference.md`。深挖见 `（原始精读材料，未随包分发）`（RTK/NDT/公共层）、`35-msf-integ.md`（MSF 融合）、`36-msf-localmap.md`（定位地图）。

## 0. 改代码前必须先知道的 5 件事

1. **MSF 滤波器本体是预编译闭源库**：`Sins`/`LidarLocator`/`GnssSolver`/`PoseForcast` 来自 `@localization_msf`（`third_party/localization_msf/workspace.bzl:11-16`）。**F/H/Q/P0 与库内新息检验改不到**。SINS 是唯一位姿输出源，GNSS 与 LiDAR 只是 `MeasureData` 量测。"调融合权重" = 改 `variance[9][9]` 填法 + 改哪些量测被丢弃，仅此两件（§2）。换滤波器边界是 `LocalizationIntegProcess` 一个类 8 个方法（§4.2）。
2. **`conf/msf_localization.pb.txt` 是死文件**：10 个字段无一生效，其中 3 个 topic 字段在任何 proto 里都没定义。MSF 真实入口是 `conf/localization.conf`（gflags）。`localization_config.pb.txt` / `navi_localization_config.pb.txt` 同为死配置，改 `localization_type` 不切方案。
3. **`msf/local_map/` 是运行时死代码**，活的是 `msf/local_pyramid_map/`（`local_integ/localization_lidar.h:25-29` include 后者），编译期定死无 flag 可切。`--local_map_name=local_map` 是**磁盘目录名**，与源码目录无关。
4. **定位地图 ≠ HD 地图**：前者是 UTM 网格栅格（强度/高度统计量），后者是矢量语义。唯一交集是共用 `FLAGS_map_dir`（`msf_localization.cc:64`：`map_path = FLAGS_map_dir + "/" + FLAGS_local_map_name`）。
5. **`modules/common/util/lru_cache.h:176-183` 的 `Remove` 漏 `map_.erase(key)`** → 陈旧 key 指向已被 pool 回收复用的 node（use-after-free、读到错误地图数据）+ `Detach` 二次调用让 `size_` 下溢使 `Full()` 恒真。**修它之前任何地图缓存调试结论都不可信。**

## 1. 三套方案入口对照（互斥，同时只起一个，都写 `/apollo/localization/pose`）

| | RTK | NDT | MSF |
|---|---|---|---|
| Component 类 | `RTKLocalizationComponent` | `NDTLocalizationComponent` | `MSFLocalizationComponent` |
| dag | `dag/dag_streaming_rtk_localization.dag` | `dag/dag_streaming_ndt_localization.dag` | `dag/dag_streaming_msf_localization.dag` |
| dag 配置字段 | **`config_file_path`**=`conf/rtk_localization.pb.txt` | `flag_file_path`=`conf/localization.conf` | `flag_file_path`=`conf/localization.conf` |
| 触发 channel | `/apollo/sensor/gnss/odometry` | `/apollo/sensor/gnss/odometry` | `/apollo/sensor/gnss/imu` |
| launch | `rtk_localization.launch`（`localization.launch` 亦指向它） | `ndt_localization.launch` | `msf_localization.launch`、`msf_localization_with_visualizer.launch` |
| 配置机制 | proto conf（13 字段） | 纯 gflags | 纯 gflags |
| 额外输入 | `corrected_imu`+`ins_stat` | 点云+`ins_stat`+定位地图 | 点云+`best_pose`+`heading`+定位地图 |
| 代码量 | `rtk/` 4 文件 | `ndt/`+`ndt/ndt_locator/` 约 13 文件 | `msf/local_integ/` 21 文件 + `local_pyramid_map/` |
| 何时用 | 有高精组合导航、只需转发：最简最稳 | 有定位地图但无双天线，试验性质 | 生产方案：IMU+GNSS+LiDAR 三路融合 |

⚠️ RTK 的 dag **没有 `flag_file_path`** → RTK 进程不加载任何 flagfile（连 `global_flagfile.txt` 都没有），所有 gflags 都是编译期默认值。给 RTK 加任何 gflags 功能前先补这一行。

## 2. 调 MSF 融合权重 / 噪声

改不了 Q 与 P0（闭源）。能改的只有 R（量测方差）与门限：

| 目标 | 位置 |
|---|---|
| 降 GNSS 位置权重 | `msf/local_integ/measure_republish_process.cc:417-422`，三行 `variance[0..2]=std²`，乘 >1 因子 |
| 按 RTK 解类型分级降权 | 插在 `:422` 后，用 `bestgnsspos_msg.sol_type()` 查表：固定 ×1 / 浮点 ×4 / 单点 ×25 |
| 降 LiDAR 位置权重 | `measure_republish_process.cc:377-380` |
| LiDAR 高程权重 | `measure_republish_process.cc:376` 硬编码 `height_var = 0.03*0.03`；可改读 `LidarHeight::height_var`（已有字段但从未使用） |
| LiDAR yaw 权重 | `localization_lidar_process.cc:252` 常数 `0.15*0.15*DEG_TO_RAD2`；按质量缩放需先把 `location_score`（`:355` 附近局部变量）提升为成员 |
| 双天线 yaw 权重 | `measure_republish_process.cc:624-625`（已跟随 `heading_std_dev`） |
| LiDAR 质量分级门限 | `localization_lidar_process.cc:358-368`，score 门限 0.80/0.85/0.95 |
| LiDAR 复位阈值 | `localization_params.h:91` `unstable_reset_threshold=0.3`，**无 gflags 入口** |
| SINS 自复位灵敏度 | `localization.conf:80,85`。**唯一能调闭源滤波自复位行为的两个参数** |
| VALID 判定阈值 | `localization_integ_process.cc:160-161` 硬编码 `0.3²`×3 + `0.1²` |
| 强制等待 30 秒 | `localization_integ_process.cc:129` 的 `delay_output_counter_ < 3000` |
| 量测队列深度 | `localization_integ_process.h:96` `= 150`（`StartThreadLoop` 里还会再赋一次，两处都改） |

**加量测野值剔除（新息检验）的唯一插入点**：`CheckIntegMeasureData`（声明 `localization_integ_process.h:69`，实现 `.cc:342`，调用 `.cc:333`）。它已在量测线程内、`sins_->AddMeasurement` 之前，能拿 `ins_pva_` 算残差；**目前永远 return true**，返回 false 即丢弃。仓库侧现有门限全在量测构造阶段，不在滤波阶段。

## 3. 新增一路观测（轮速计 / 视觉）

闭源库枚举已有 `MeasureType::ODOMETER_VEL_ONLY`（`localization_integ_process.cc:344` 有专门日志分支），`proto/measure.proto` 还有 `VEHICLE_CONSTRAINT` —— 设计里有、代码没接。**先用已支持类型（如 `GNSS_POS_VEL`）验证链路，再切 ODOMETER**，因为库内有无对应 H 矩阵分支无法从仓库验证。照抄 `GnssHeadingProcess` 那条最短链路改 6 处：

1. `msf/msf_localization_component.h:56-65` 加 Reader + topic 成员；`.cc` 的 `InitIO` 里 `CreateReader` 绑回调，`InitConfig` 取 topic flag。新源要驱动主循环才改 dag `readers`。
2. `msf/msf_localization.{h,cc}` 加回调，转发到 `localization_integ_`。参考 `OnGnssHeading`（`msf_localization.cc:304-312`，5 行）。
3. `local_integ/localization_integ.h:59-72` 加 API；`.cc` 转发 + proto→内部结构转换。
4. `local_integ/localization_integ_impl.{h,cc}`：照抄 `GnssHeadingProcessImpl`（`.cc:307-315`）—— 构造 `MeasureData` → `republish_process_->XxxProcess()` → `integ_process_->MeasureDataProcess()`。
5. `local_integ/measure_republish_process.{h,cc}` 加量测构造：`measure.time`（**与其他路一致地走或不走 `Gps2Unix`**）、`gnss_vel.ve/vn/vu`（轮速需先用当前姿态从体轴转导航系）、`measure_type`、`frame_type`、`is_have_variance=true`、`variance[3][3]~[5][5]`（速度槽位）。对齐前是否发要单独决策，参考 `IsSinsAlign()` 分支。
6. `msf/BUILD:67,134` 是 `glob(["local_integ/*.cc"])` / `glob(["local_integ/*.h"])`，**新文件自动纳入，不改 srcs**；新 proto 依赖要加到该 target 与 `libmsf_localization_component.so`（`BUILD:176`）的 deps。

含 Eigen 固定尺寸成员的类必须加 `EIGEN_MAKE_ALIGNED_OPERATOR_NEW`，否则 release 下 SSE 对齐崩。

## 4. 改状态量维度 / 换滤波器

**4.1 改维度**：仓库侧**改不了内部维度**（在 `.so` 里；`sins_->GetRemoveBiasImu` 说明库内很可能 15/21 维含零偏，只对外暴露 9 维）。9 维排布：`[0..2]` 位置、`[3..5]` 速度 ENU、`[6..8]` 姿态 pitch/roll/yaw（`[8][8]` 单独用于 yaw 收敛判定）。真要换维度，`9` 在仓库出现 14 处必须同步全改：`localization_integ_process.h:62,92`、`.cc:160-161,233-247,250-259`、`localization_integ_impl.cc:214-215`、`localization_gnss_process.h:110`、`.cc:163-193,210-215,228-251`、`measure_republish_process.cc:214-216,317-319,377-380,417-422,624`、`proto/sins_pva.proto:22`；外加替换闭源 `MeasureData`/`InsPva`，连带 `localization_msf/sins_struct.h` 的 5 个 include 点。

**4.2 换滤波器（ESKF → 图优化）**：边界就是 `LocalizationIntegProcess` 一个类（`local_integ/localization_integ_process.{h,cc}`，约 497 行）。对外只有 8 个方法（`localization_integ_process.h:55-67`）：`Init` / `RawImuProcess` / `MeasureDataProcess` / `GetState` / `GetResult(IntegState*, LocalizationEstimate*)` / `GetResult(IntegState*, InsPva*, double[9][9])` / `GetCorrectedImu` / `GetEarthParameter`。**保持这 8 个签名不变，`LocalizationIntegImpl`/`LocalizationInteg`/`MSFLocalization`/Component 全不用改。** 四个实质问题：
- 输出频率：现在每帧 IMU 出一个位姿（`localization_integ_impl.cc:137-144` 同步取结果）。图优化是批量的，需在 `GetResult` 里做"最新窗口 + IMU 预积分外推到当前时刻"，否则接不上 100 Hz。
- 协方差：要在 `GetResult` 里边缘化出当前时刻 9×9，`GetValidFromOK`（`.cc:153-164`）与 expert 阈值都依赖它有合理数值。
- `InsPva::init_and_alignment` 是全系统"对齐完成"信号，被 `IsSinsAlign` / `GnssHeadingProcess` / `IntegSinsPvaProcess` 读取，必须实现等价语义。
- 量测时序：现在无序入队、库内对齐；图优化要按时间戳插入窗口，`MeasureDataThreadLoop` 的"超 150 丢队头"要改成按时间窗淘汰。
不用动：LiDAR 匹配、GNSS 量测构造、`OnlineLocalizationExpert`。`PoseForcast` 也闭源，一起换的话边界是 `LocalizationLidarProcess::GetPredictPose`。

## 5. 新增一种定位方案

**不要照 `modules/localization/README.md:79-95`** —— 那里的 `LocalizationBase` 子类 + `localization_factory_.Register()` 在 Apollo 11 里不存在。正确做法是照抄 `rtk/` 结构，新增独立 cyber Component。以 `visual` 为例：

新建 `modules/localization/visual/{BUILD, visual_localization.{h,cc}, visual_localization_component.{h,cc}, visual_localization_test.cc}`、`proto/visual_config.proto`（走 proto conf 才需要）、`conf/visual_localization.pb.txt`、`dag/dag_streaming_visual_localization.dag`、`launch/visual_localization.launch`。
修改 `proto/BUILD`（加 proto target）、`cyberfile.xml`（仅当引入新第三方依赖）、`modules/dreamview/conf/hmi_modes/*.pb.txt`（`cyber_modules` 的 `Localization` key 指向新 dag）。

- dag 的 `class_name` 必须与 `CYBER_REGISTER_COMPONENT` 完全一致，否则只报 `Failed to create component` 而不告诉你名字对不上。
- `config_file_path` 与 `flag_file_path` **可同时写**；要用 `FLAGS_map_dir` 之类必须写后者。
- launch 里 `<process_name>localization</process_name>` 保持不变 → 天然与三套互斥。
- 必填输出：`header{module_name,timestamp_sec,sequence_num}` + `measurement_time` + `pose{position, orientation, heading, euler_angles, linear_velocity, linear_acceleration, angular_velocity, linear_acceleration_vrf, angular_velocity_vrf}` + `LocalizationStatus{header, fusion_status, measurement_time, state_message}` + TF。**缺 `*_vrf` 两个字段会让 `VehicleStateProvider` 返回 false，planning/control 直接拿不到车辆状态**（NDT 现在就踩在这坑上）。
- 不用动：`proto/localization_config.proto`（死配置）、`modules/localization/BUILD`（`apollo_package()` 自动扫）、`adapter_gflags.cc`（除非改 channel 名）、所有下游模块。
- 验证：`bazel build //modules/localization/visual:libvisual_localization_component.so` → `cyber_launch start modules/localization/launch/visual_localization.launch` → `cyber_channel hz /apollo/localization/pose`（应接近 100）。

## 6. 改 RTK 时间对齐 / 插值

- **IMU 匹配失败改成拒绝输出**（现状：`FindMatchingIMU` 返回值被忽略于 `rtk_localization.cc:181`，失败时用空 IMU 照发位姿）：改 `rtk_localization.cc:175-187` 加 `if (!FindMatchingIMU(...)) return;`，**还要改第 2 处** —— `GpsCallback`（`.cc:82-87`）无条件设 `service_started_=true` 且 `Proc` 会把上一帧结果再发一次，必须回传"本帧是否有效"。
- **时间差超阈值从告警变拒绝**：`rtk_localization.cc:388-394` 目前只打 AERROR，加 `return false;`。阈值 `gps_imu_time_diff_threshold`（`rtk_localization.pb.txt:10`=0.02）已可配。
- **修欧拉角插值 ±π 绕回**（`rtk_localization.cc:444-448` 用 `InterpolateXYZ` 线性插值，车头朝西时翻转）：新增 `InterpolateAngle`（差值归化到 [−π,π] 再 `NormalizeAngle`），include `modules/common/math/math_utils.h`。改完同步 `testdata/1_imu_result.pb.txt`、`2_imu_result.pb.txt`，否则 `rtk_localization_test` 红。
- **加大 IMU 缓冲**：改 `rtk_localization.pb.txt:9` 的 `imu_list_max_size`。但 `FindMatchingIMU`/`FindNearestGpsStatus` 每次**整表深拷贝 std::list**（`.cc:334,476`），更好的做法是改成持锁内直接查找。
- **给 RTK 接 `LocalizationGnssCompensator`**（MSF 有、RTK/NDT 没有）：`rtk/BUILD` deps 加 `//modules/localization/common:gnss_compensator`，照抄 `msf_localization_component.cc:143-158` 插到 `PublishPoseBroadcastTF`，**并给 dag 补 `flag_file_path`**，否则相关 flag 全是编译默认值。

## 7. 改 NDT 参数 / 换配准算法

**纯调参不改代码**：12 个 `ndt_*` flag 定义在 `common/localization_gflags.cc:177-193`，而 `conf/localization.conf` **一条都没配**（全用编译默认值）。要调就往 conf 末尾追加，如 `--ndt_max_iterations=20`（默认 10）、`--ndt_target_resolution=1.0`、`--ndt_line_search_step_size=0.1`、`--ndt_transformation_epsilon=0.01`、`--ndt_filter_size_x/y=48`、`--ndt_bad_score_count_threshold=10`、`--ndt_warnning_ndt_score=1.0`、`--ndt_error_ndt_score=2.0`、`--ndt_debug_log_flag=true`。
⚠️ `lidar_localization_mode` / `lidar_yaw_align_mode` / `lidar_filter_size` / `point_cloud_step` / `lidar_height_*` **对 NDT 无效**（只 MSF 读），最容易误调。

**换配准算法**：改 `ndt/ndt_locator/lidar_locator_ndt.cc` 的 `Update`（`:123-247`）与 `ndt_solver.hpp`。上 NDT 前必须先修 3 个：`ndt_localization.cc:157-167` + `ndt_localization_component.cc:98-108`（`lidar_locator_` 未初始化时输出 Identity (0,0,0) 且报已启动 → **车认为自己在 UTM 原点**）；`ndt_localization.cc:411` `odometry_buffer_.back()` 空 buffer UB；`localization_pose_buffer` 与 `lidar_pose_`/`ndt_score_`/三个结果消息**全部无锁**（LidarCallback 与 Proc 两线程并发）。另外 `Update` 返回值被忽略（`.cc:192`）、`HasConverged()` 几乎恒为 true 不可作失败信号、NDT 没有任何降级/拒绝输出机制。UTM 是 6-7 位数，转 `pcl::PointXYZ`(float) 前**必须先减 `map_left_top_corner_`**（`lidar_locator_ndt.cc:423-425,481`），自己写配准要照抄。

## 8. 给 `LocalizationEstimate` 加字段

1. `modules/common_msgs/localization_msgs/localization.proto:48-63` 加 `optional`，字段号从 8 起（1-7 已占用），**永不复用旧号**；`required` 会让旧 record 回放解析失败。
2. **三个生产者都要填**，否则该方案下字段恒缺失：`rtk/rtk_localization.cc:234-324`（注意 `:237` 有 `localization->Clear()`，必须设在其后）、`ndt/ndt_localization.cc:264-312`（还要考虑 `ComposeLidarResult`）、`msf/msf_localization.cc` 的组装路径。
3. 下游按需：`modules/common/vehicle_state/vehicle_state_provider.cc:32-160`（透传给 planning/control）、`dreamview/backend/.../simulation_world_service.cc:517-535` + `dreamview/proto/simulation_world.proto` + 前端（要显示）。planning/control 走 `local_view_`/`VehicleStateProvider`，通常无需改；monitor 不用改。
4. `localization_msgs/BUILD` 不用改（srcs 是文件级）；新增嵌套 message 才要加 `import` + proto_library deps。

**想填 `uncertainty`**（最常见需求）：字段已存在（`localization.proto:51`）但 RTK/NDT 都不填。RTK 需改 GNSS 驱动透出 `Ins.position_covariance` 或订阅 `best_pose`；NDT 想用 `LidarLocatorNdt::GetLocationCovariance()` —— **它返回的 `location_covariance_` 从未被赋值**，得先在 `Update()` 里从 NDT Hessian 逆算出来（`ndt_solver.hpp` 没暴露 hessian getter，需要加）。

## 9. 改 IMU 安装角 / GNSS 杆臂标定

**杆臂链路**：`msf/params/gnss_params/ant_imu_leverarm.yaml`（`FLAGS_ant_imu_leverarm_file`，`localization_gflags.cc:101`，受 `--if_imuant_from_file`=true 控制，`localization.conf:155`）→ `msf_localization.cc:143` 的 `ACHECK`（**读失败进程直接 abort**）→ `localization_param_.imu_to_ant_offset` → 四路：`LocalizationIntegProcess::Init` → `sins_->SetImuAntennaLeverArm`（**唯一真正给 EKF 的一处**）；`LocalizationIntegImpl::Init` 那份**只打日志，别改**；`LocalizationGnssProcess::Init`（仅自研 RTK，当前接不到数据）；`MeasureRepublishProcess::Init` 二次读文件用于双天线定向。yaml 里的 `uncertainty` 三个值读进结构体后**完全没被使用**。

**IMU 安装角有两条独立链路**（最容易搞混）：
- 链路 A（生效）：`msf/params/vehicle_params/vehicle_imu_extrinsics.yaml`（`FLAGS_vehicle_imu_file`，`localization_gflags.cc:131`，默认 `<map_dir 同级>/vehicle_params/...`）→ `msf_localization.cc:107-119` 填 `imu_vehicle_quat_` → `CompensateImuVehicleExtrinsic`（`.cc:327-358`，调用点 `:240`）→ **只改最终 pose 的 `heading`/`euler_angles`/`position`，不改 `orientation`**。所以外参非单位四元数时四元数与 heading 不自洽 —— 下游用 `orientation` 还是 `heading` 会得到不同朝向。也不作用于 TF 前的 `lastest_integ_localization_`，也不作用于 msf_lidar/msf_gnss 调试话题。
- 链路 B（**断了**）：`localization_params.h:96` 的 `vehicle_to_imu_quatern` **无任何赋值点**，永远 (0,0,0,w=1) → `measure_republish_process.cc:82-114` 的 DCM 恒为单位阵，杆臂旋转成恒等变换。

**正确做法**：改 yaml 的 `transform.rotation` 与 `translation`（米）；确认 `FLAGS_vehicle_imu_file` 路径；**同时补链路 B 的赋值**（`msf_localization.cc:119` 之后写 `localization_param_.vehicle_to_imu_quatern = {imu_vehicle_quat_.x(), .y(), .z(), .w()}`），否则双天线基线方位角算错。
⚠️ `TransferImuFlu`/`TransferImuRfu`（`localization_integ.cc:97-125`，由 `--imu_coord_rfu` 选）处理的是**轴序**不是安装角，不要靠改它们补安装偏斜。

**换车/换传感器必改这三个 yaml**：`velodyne_params/velodyne64_novatel_extrinsics_example.yaml`（lidar→IMU 外参，读失败 **Init 失败、组件起不来**）、`velodyne_params/velodyne64_height.yaml`（lidar 到地面高度 1.91，读失败只 WARN 退回 `--lidar_height_default=1.80`；**配错直接平移输出高程，是"z 一直偏几厘米"的第一嫌疑**）、`gnss_params/ant_imu_leverarm.yaml`。`imu_localization_extrinsics.yaml` / `novatel_localization_extrinsics.yaml` 全仓无引用。

## 10. 制作一张新定位地图（换场地必做）

前置：一段带 `/apollo/sensor/gnss/odometry`（**必须 RTK 固定解级别，地图精度上限就是建图位姿精度**）+ 点云话题的 record；正确的 lidar-IMU 外参 yaml；UTM 带号（中国东部 50，北美西部 10）。

**不要用 `scripts/msf_*.sh`**：`msf_simple_map_creator.sh:34` 等处 binary 路径写死为 `bazel-bin/modules/localization/msf/local_tool/data_extraction/cyber_record_parser`，而真实产物在 `bazel-bin/modules/localization/msf/cyber_record_parser`（target 定义在 `msf/BUILD:406-465`，不在 `local_tool/`）；且脚本传 `--bag_file` 而工具收 `--bag_files`（复数）。三个脚本按现状跑不起来。

```bash
export ZONE=50 WORK=/data/mapping/site_a MAPOUT=/data/map/site_a
export EXT=modules/localization/msf/params/velodyne_params/velodyne64_novatel_extrinsics_example.yaml
bazel build //modules/localization/msf:{cyber_record_parser,poses_interpolator,lossless_map_creator,lossless_map_to_lossy_map,offline_local_visualizer}

# 1) 抽点云与位姿   ★--bag_files 复数，可重复传★
bazel run //modules/localization/msf:cyber_record_parser -- --bag_files /data/records/a.record.00000 \
  --out_folder $WORK --cloud_topic /apollo/sensor/lidar128/compensator/PointCloud2 \
  --odometry_loc_topic /apollo/sensor/gnss/odometry --gnss_loc_topic /apollo/localization/msf_gnss \
  --lidar_loc_topic /apollo/localization/msf_lidar --fusion_loc_topic /apollo/localization/pose
# 检查：$WORK/pcd/*.pcd 数量 == pcd_timestamp.txt 行数；odometry_loc.txt 非空

# 2) 位姿插值到 pcd 时间戳并转 lidar 位姿（12 字段 → 9 字段）
bazel run //modules/localization/msf:poses_interpolator -- --input_poses_path $WORK/pcd/odometry_loc.txt \
  --ref_timestamps_path $WORK/pcd/pcd_timestamp.txt --extrinsic_path $EXT \
  --output_poses_path $WORK/pcd/corrected_poses.txt        # 检查：每行 9 字段，行数 ≈ pcd 数

# 3) lossless 建图   ★★ --use_plane_inliers_only 必须 true，false 时一个 node 都不写 ★★
bazel run //modules/localization/msf:lossless_map_creator -- --use_plane_inliers_only true \
  --pcd_folders $WORK/pcd --pose_files $WORK/pcd/corrected_poses.txt --map_folder $MAPOUT \
  --zone_id $ZONE --coordinate_type UTM --map_resolution_type single --resolution 0.125
# 检查：$MAPOUT/lossless_map/map/000/north/$ZONE/ 下有 8 位数字目录；
#       config.xml 的 map_ground_height_offset 在 1.5~2.0 且与车高相符

# 4) 转 lossy（在线定位用这个）→ 5) 改名 → 6) 可视化验收 → 7) 部署
bazel run //modules/localization/msf:lossless_map_to_lossy_map -- --srcdir $MAPOUT/lossless_map --dstdir $MAPOUT
mv $MAPOUT/lossy_map $MAPOUT/local_map
mkdir -p $WORK/local_map && cp -r $MAPOUT/local_map/* $WORK/local_map/
cp $EXT $WORK/velodyne_novatel_extrinsics.yaml     # ★文件名必须正好是这个★
rm -rf $WORK/local_map/map_visual                  # 换地图必须先删，否则显示旧缓存
bazel run //modules/localization/msf:offline_local_visualizer -- --basedir $WORK
cp -r $MAPOUT/local_map /apollo/modules/map/data/site_a/   # 与 base_map.bin 同级
# conf 确认 --local_map_name=local_map；--map_dir 指向 site_a
```

多趟合并：`--pcd_folders`/`--pose_files` 支持 multitoken+composing，或对每个 record 循环调 creator 到**同一 `--map_folder`**（`SetMapFolderPath` 会 Load 已有 config.xml 继续叠加）。
验收：可视化里轨迹贴合路面纹理（车道线可辨）；node 数 ≈ 覆盖面积/(128 m)²；用 `compare_poses` 对比 `fusion_loc.txt` 与 `odometry_loc.txt`。
⚠️ 建出的地图 `count`/`intensity_var`/`altitude` 基本全是初值：creator 调的是 `SetIntensitySafe`（`pyramid_map_matrix.cc:1106`，**覆盖写不是累加**，last-writer-wins），要真做统计量得改成 `AddSampleSafe`/`MergeCellSafe`。且 lossy 的 `count_range_=2`（`pyramid_map_matrix_handler.h:55`）让 count 只能表达 {0,1,2}，已退化成占用标记。

## 11. 配置速查（`conf/localization.conf`，MSF/NDT 生效，RTK 完全不读）

| flag | 值 | 改了影响什么 |
|---|---|---|
| `--local_map_name` | local_map | 磁盘目录名，拼 `FLAGS_map_dir + "/" + 它` |
| `--enable_lidar_localization` | true | 关掉后 MSF 只剩 GNSS+IMU |
| `--lidar_localization_mode` | 2 | 0 强度/1 高度/2 融合。**NDT 无效** |
| `--lidar_filter_size` | 17 | 匹配搜索窗，直接影响每帧耗时。**NDT 无效** |
| `--lidar_map_coverage_theshold` | 0.8 | 低于此报 `OUT_OF_MAP`（拼写少 r） |
| `--integ_sins_state_span_time`/`_pos_std` | 30.0/1.0 | **唯一能调闭源滤波自复位的两个参数** |
| `--vel_threshold_get_yaw` | 5.0 | **要跑到 18 km/h 才能用速度定 yaw**，低速对不齐先查这个 |
| `--integ_sins_align_with_vel` | true | 要求车辆运动才能对齐 |
| `--if_utm_zone_id_from_folder`/`--local_utm_zone_id` | true/10 | 前者 true 时从地图目录名推 zone，**目录名必须纯数字**否则 `stoi` 抛异常 |
| `--lidar_topic` | hesai40 | ⚠️ 与 `:140` 的 velodyne64 外参**自相矛盾**；`dag_streaming_msf_visualizer.dag:12` 读 lidar128 → visualizer 收不到点云 |
| `--if_use_avx` | true | **无 AVX 的 CPU 上会在 `locator_->Update` 里非法指令崩溃** |
| `--imu_coord_rfu` | true | 轴序 RFU/FLU，选 `RawImuProcessRfu` 还是 `Flu` |

**死配置（改了没效果）**：`conf/msf_localization.pb.txt`（10 字段全死）、`localization_config.pb.txt`、`navi_localization_config.pb.txt`；`localization.conf:2` 的 `--noenable_gps_imu_interprolate`（死 flag，**RTK 插值永远开着**）；`:50` 的 `--lidar_imu_lidar_max_delay_time`（**flag 名拼错**，真名 `lidar_imu_max_delay_time`，值永不生效）；`:100` 的 `--eph_buffer_path=""`（**带引号**，值是两个引号字符）；`rtk_localization.pb.txt:4` 的 `gps_topic`（死字段，改 GPS 输入必须改 dag `readers`）。另有 11 个 gflags 全仓从未被读取 —— 全表见 `reference.md`。

## 12. 坐标系与单位约定（最容易搞错）

- **`heading` 与 `euler_angles.z()`（yaw）差 90°**：`QuaternionToHeading = NormalizeAngle(yaw + π/2)`（`modules/common/math/quaternion.h:56-62`）。混用是经典 bug。
- **`euler_angles` 的 x=pitch、y=roll**（与字段名直觉相反），z=yaw。
- 位置是 **UTM 绝对坐标，6-7 位数**；用 float 存会丢到分米级，转 float 前必须先减局部原点。
- `linear_velocity`/`linear_acceleration`/`angular_velocity` 是 **ENU 世界系**；`*_vrf` 两个是**车体 RFU 系**。
- **度 vs 弧度**：proto 输出全是弧度；`InsPva.pos` 弧度+米、`att` 弧度；`FrameTransform::LatlonToUtmXY` 输入**弧度**、参数顺序 **(lon, lat)**、**zone 由 lon 自动算而忽略配置的 zone_id**；`UtmXYToLatlon` 输出弧度且**完全忽略 `southhemi`**（南半球算错）。`WGS84Corr` 的经度成员名叫 **`log`** 不是 `lon`。
- **MSF 的 `math::EulerToQuaternion`**（`msf/common/util/math_util.h:27-39`）：参数 `(x,y,z)` 语义是 `(pitch, roll, yaw)`；输出 `qbn[0]=w` 在前；Z-X-Y 顺序；**`qbn[3]` 整体差一个负号** —— 这套代码用"航向角顺时针为正"的导航约定（配套 `measure_republish_process.cc:626` 给 yaw 取负），与 Apollo 主线逆时针为正相反。改朝向相关代码前先确认自己在哪套约定里。
- **外参乘法方向**：`lidar_pose = imu_pose * velodyne_extrinsic`，即 yaml 存的是 `T_imu_lidar`，逆变换用 `* extrinsic.inverse()`。
- **时间戳三路走三套转换**：IMU 与 GNSS bestpose 走 `common::util::TimeUtil::Gps2Unix`（`UNIX_GPS_DIFF=315964782`）；heading 走 `msf::GpsToUnixSeconds`（`=315964800` + 闰秒表，表只维护到 2017）；LiDAR 直接用消息时间。2017 年后两者结果相同，未来有新闰秒会分叉。另外 `header.timestamp_sec` 是发布时系统时间、`measurement_time` 是传感器时间（**TF 用后者**），`LocalizationStatus.measurement_time` 填的是 `InsStat` 的时间不是位姿时间。

## 13. 改代码前必读的 12 个坑

| 现象 | 原因 | 位置 |
|---|---|---|
| 地图缓存行为失控 / 读到错误地图数据 | `LRUCache::Remove` 漏 `map_.erase` → 陈旧 key + `size_` 下溢 | `modules/common/util/lru_cache.h:176-183` |
| 车在地图边界外时静静读到 (0,0) 节点 | 越界只 `std::cerr`，assert 被注释，`m_/n_` 保持 0 | `local_pyramid_map/base_map/base_map_node_index.cc:83-91` |
| 地图缺块完全不报错，定位拿全零 cell 后漂移 | `Load()` 失败被当成"新建空 node" | `base_map/base_map.cc:243-247`（看 `AINFO "Created map node"`） |
| 整批地图加载被静默放弃但 `LoadMapArea` 仍返回 true | `map_ids->size() > L1 容量` 时只打 `std::cerr` | `base_map.cc:124-127` |
| 段错误 | `GetMapNodeSafe` 可能返回 nullptr，7+ 处调用方不判空 | `base_map.cc:66-94`；`pyramid_map.cc:35-90`；`localization_lidar.cc:233-234` |
| 进程 100% CPU 但不动 | `LoadMapNodeThreadSafety` 的 `while (map_node == nullptr)` 活锁 | `base_map.cc:231-241` |
| 双天线基线方位角算错 | `vehicle_to_imu_quatern` 永无赋值 → 杆臂旋转 DCM 恒为单位阵 | `localization_params.h:96`；`measure_republish_process.cc:82-114` |
| LiDAR 高程接管后永不释放 | 可用标志无超时复位 | `localization_integ_impl.cc:159-162` |
| 偶发 `"LocalizationLidar Fatal Error: invalid pose!"` 误杀 | `GetPredictPose` 的 `\|\|` 应为 `&&` | `localization_lidar_process.cc:318` |
| `ant_num` 未初始化，双天线判断随机 | `VehicleGnssAntExtrinsic` 无默认构造；yaml 缺失时只 `AINFO` 不报错 | `measure_republish_process.h:48-55`、`.cc:78-80` |
| NDT 输出"车在 UTM 原点 (0,0,0)"且报已启动 | `lidar_locator_` 未初始化时仍发布 Identity | `ndt/ndt_localization.cc:157-167` + `ndt_localization_component.cc:98-108` |
| NDT 下 planning/control 拿不到车辆状态 | NDT 直接 CopyFrom `Gps`，加速度/角速度字段全空 → `VehicleStateProvider` 返回 false | `ndt_localization.cc:291-311` |

## 14. 排错表

**⚠️ 关键诊断（cache miss、index 越界、整批放弃）用 `std::cerr` 不进 glog。只看 `/apollo/data/log/localization.INFO` 会漏掉最重要的信息 —— 必须同时看 stderr。**

**MSF 起不来**（按失败点从早到晚）：① `ant_imu_leverarm.yaml` 缺失/无 `leverarm.primary.offset` → `msf_localization.cc:143` 的 `ACHECK` **进程 abort**；② `vehicle_imu_extrinsics.yaml` 失败只 WARN；③ UTM zone 读不出只 WARN（`"utm zone id: N"`）；④ **LiDAR 外参失败 → Init 失败**（`localization_lidar_process.cc:112-114`）；⑤ lidar 高度文件失败只 WARN；⑥ **地图加载失败 → Init 失败 或 `LOG(FATAL) "Reflectance map folder is invalid!"`**（`localization_lidar.cc:62`，它只检查 `config.xml` 存在性，畸形 XML 会拿到半初始化 config 而非 FATAL）；⑦ 无 `"Started measure data process thread"` 说明量测线程没起。另查 conf 有无拼错的 flag 名让 gflags 拒绝启动；`--if_use_avx=true` 在无 AVX 的 CPU 上崩。

**不发布 / 不收敛**（`IntegState` 四档）：`NOT_INIT` → `"SINS is aligning!"`（`localization_integ_process.cc:144`，每 0.5 s 一条）；`NOT_STABLE` → `"SINS has completed alignment!"`（`.cc:138`，正在等 3000 帧 ≈ 30 秒，**恰好卡 30 秒是正常行为**）；`OK` 有输出但协方差未达标；`VALID` 达标。
卡在 aligning 的排查顺序：① IMU 进来了吗（`"the imu time is error"` = 时间戳 <3000 转换错了；`"the imu message loss more than 10"`；`"received imu message's time is eary than last"`）；② GNSS 被接受了吗（`"the gnss solution_status and position_type"` 每帧都打，`sol_type ∈ {0,1,2}` 被丢；`"the position std is large"` = std >5 m 被丢，**但只在未对齐时检查**）；③ 速度算不出（`"Waiting calculate velocity successfully..."` 是关键信号；`"novatel bestgnsspos delta yaw is large!"` —— 车静止时 GNSS yaw 乱跳，**静止起步很难对齐是已知行为**；至少要连续 10 帧好解，1 Hz → 10 秒）；④ `--vel_threshold_get_yaw=5.0` 要求 18 km/h 以上。卡在 OK 不到 VALID：把 `localization_integ_process.cc:158-159` 注释掉的 `AERROR` 打开直接看 `pva_covariance_` 四个对角元。`"<N> measure are waiting to process."` 说明量测线程处理不过来。

**精度差 / 跳变**：三路各有独立话题，`cyber_monitor -c /apollo/localization/{pose,msf_lidar,msf_gnss,msf_status}` 直接对比先分清哪一路坏。`msf_status.msf_running_status` 命名规则 `MSF_{SOL|SSOL|NOSOL}_{LIDAR|X}_{GNSS|X|XX|XXX}`：第一段是融合精度档（SOL<0.15 m / SSOL<0.3 m / NOSOL≥0.3 m），第二段 LiDAR 是否 NORMAL，第三段 GNSS 解质量。
**最有效的一招**：把 `"IntegratedLocalization Debug Log: integ_pose msg"`（`localization_integ_process.cc:181-192`，角度已转度）与 `"...measure data"`（`.cc:348-360`，含 measure type）两条对齐看 → 立刻分清是"量测进来了但滤波没跟上"还是"量测本身就错"。两条都是 ADEBUG，需在 flagfile 链加 `--v=4 --minloglevel=0` 或 `--alsologtostderr`。
LiDAR 路锚点：`"Lidar msg too old!"`（延迟 >0.4 s）、`"Receive a lidar msg, but can't query predict pose"`（`PoseForcast` 拒绝）、`"Reinit lidar localization due to big covariance"`（连续 2 帧 BAD）、`"The delta translation input lidar localization"`（每帧预测增量，**判断 IMU 递推是否合理**）。
⚠️ expert 把 `integ_state` 打到 `FATAL_ERROR` 时**位姿照发**（`msf_localization.cc:236-244` 只看 `result.state()`）。而 `msf_status.fusion_status` 为 ERROR/FATAL **会触发 monitor 安全模式让车停下**（`modules/monitor/software/localization_monitor.cc:68-69`），改状态判定逻辑要极其小心。

**地图加载失败**：① 路径 —— 锚点 `"map: <path>"`（`msf_localization.cc:76`），确认是 `<map_dir>/local_map` 且下有 `config.xml` 与 `map/`；② zone_id —— 锚点 `"utm zone id: N"`；③ **大量 `AINFO "Created map node"`（`base_map.cc:245`）就是地图缺块**（`"Loaded map node"` 才是成功）；④ 看 stderr 的两条 `std::cerr`（L1+L2 双 miss / 整批放弃）；⑤ 单 node 失败：`LoadBinary` 的 5 个检查点**只 return false 不打日志**，最常见是 header 里的 index 与文件路径推出的 index 不一致（目录被手工挪动或跨版本混用）；⑥ 版本字符串写错 → handler 为 nullptr（只打 `AINFO "Unknown map version!"`）→ 随后崩。忽略 `AERROR "Preload map node failed!"`（`base_map.cc:149` 无条件打印的残留）。
手工验证 node：`xxd -l 20 <map>/map/000/north/50/00034635/00003435` → lossy/lossless header 是 20 B 小端 `u32 resolution_id | i32 zone_id | u32 m | u32 n | u32 body_size`，`body_size` 应 == `file_size - 20`，`m/n` 必须与目录名/文件名对得上。pyramid_* 版本 header 38 B（前 2 B 是版本枚举，md5 字段与 resolution_id 重叠，尾部 16 B 是未初始化堆内容）。
反查地图该有哪个文件：`span = 1024 * resolution`（0.125 → 128 m），`m = int(northing/span)`、`n = int(easting/span)`，路径 `map/000/north/<zone>/<m:08d>/<n:08d>`。也可直接看 `image/000/north/50/<m>/<n>.png`（1024×1024 强度图，视觉上上下翻转）纹理是否清晰。

**z 系统性偏移**：查 `velodyne64_height.yaml` 的 `height` 与实车是否一致，以及地图 `config.xml` 的 `map_ground_height_offset` 是否与之接近。

## 15. 调试与验证

```bash
# record 回放跑定位：只起 static_transform + localization，回放时排除定位自己的输出
cyber_launch start modules/transform/launch/static_transform.launch
cyber_launch start modules/localization/launch/msf_localization.launch
cyber_recorder play -f xxx.record -k /apollo/localization/pose /apollo/localization/msf_status /tf

cyber_channel hz /apollo/localization/pose        # RTK/NDT/MSF 均应接近 100
cyber_channel echo /apollo/localization/msf_status
cyber_channel list                                # 确认 channel 名没打错

# 精度评测（主力工具）：前提是同时录了 odometry（RTK 固定解时可作真值）与 pose
bazel run //modules/localization/msf:compare_poses -- --in_folder $WORK/pcd \
  --loc_file_a fusion_loc.txt --loc_file_b odometry_loc.txt --compare_file cmp.txt \
  --imu_to_ant_offset_file <leverarm.yaml>
python3 modules/tools/localization/evaluate_compare.py cmp.txt
# 输出位置误差 mean/std/max、<30/20/10 cm 帧占比、超阈值最大连续帧数
```

`scripts/msf_local_evaluation.sh` 会一次性导出 4 条轨迹（gnss/lidar/fusion/odometry）再对比，但**脚本有路径 bug，用前必修**（同 §10）。
在线可视化：`launch/msf_visualizer.launch`（单独）或 `msf_localization_with_visualizer.launch`，需要 `--map_visual_dir`（默认 `data/map_visual`）与地图目录的 `config.xml`。⚠️ `online_visualizer_component.cc:126-131` 有 copy-paste bug：ndt 的 Reader 覆盖了 `lidar_local_listener_` 成员，msf_lidar 那一路被顶掉。
DreamView：`dreamview/conf/hmi_modes/*.pb.txt` 的 `cyber_modules` 里 `Localization` key 决定启哪个 dag；车辆位置来自 `simulation_world_service.cc:517-535` 消费的 `/apollo/localization/pose`；monitor 每 5 s 采一次 `msf_status`。
**测试现状**：`local_integ/` 21 个文件**零测试**，`msf_localization_test` 只测一个 flag 透传，`msf/common/` 5 个测试中只有 `frame_transform_test` 与定位数学相关。改 MSF 时不要指望现有测试兜住 —— 靠 record 回放 + `compare_poses` 验证。
