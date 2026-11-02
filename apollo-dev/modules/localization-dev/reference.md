# Apollo 定位参考手册

配套 `SKILL.md`。所有路径相对仓库根。原始精读见 `（原始精读材料，未随包分发）`、`35-msf-integ.md`、`36-msf-localmap.md`、`31-localization-map-routing.md`。

## 1. 输出消息契约

### `apollo::localization::Pose`（`modules/common_msgs/localization_msgs/pose.proto:23-65`，9 字段，被所有消息复用）

| 字段号 | 名 | 语义 | 坐标系 / 单位 |
|---|---|---|---|
| 1 | `position` | VRP（**后轴中心**）位置 | UTM 绝对坐标，米（6-7 位数） |
| 2 | `orientation` | IMU(RFU) → 世界(ENU) 的旋转 | 四元数，无量纲 |
| 3 | `linear_velocity` | VRP 线速度 | **ENU**，m/s |
| 4 | `linear_acceleration` | VRP 线加速度 | **ENU**，m/s² |
| 5 | `angular_velocity` | 角速度 | 绕 **ENU** 三轴，rad/s |
| 6 | `heading` | **东=0，朝北为正** | 弧度 [−π,π) |
| 7 | `linear_acceleration_vrf` | 线加速度 | **车体 RFU**，m/s² |
| 8 | `angular_velocity_vrf` | 角速度 | 绕**车体 RFU**，rad/s |
| 9 | `euler_angles` | z-x-y 内旋。**x=pitch [−π,π)，y=roll (−π/2,π/2)，z=yaw [−π,π)** | 弧度，ENU |

⚠️ `heading` = `NormalizeAngle(yaw + π/2)`（`modules/common/math/quaternion.h:56-62`），与 `euler_angles.z()` **差 90°**。

### `LocalizationEstimate`（`localization.proto:48-63`）

`header`(1) / `pose`(2) / `uncertainty`(3) / `measurement_time`(4，秒，UNIX) / `msf_status`(6) / `sensor_status`(7)。字段号 5 已用；新字段从 8 起。
`Uncertainty`（`:27-46`）5 个 `Point3D`：`position_std_dev`(1) / `orientation_std_dev`(2) / `linear_velocity_std_dev`(3) / `linear_acceleration_std_dev`(4) / `angular_velocity_std_dev`(5)。**RTK/NDT 都不填 `uncertainty`/`msf_status`/`sensor_status`**，下游无法做概率决策。

### `LocalizationStatus`（`localization.proto:73-80`）

`header`(1) / `fusion_status`(2) / `gnss_status`(3, deprecated) / `lidar_status`(4, deprecated) / `measurement_time`(5) / `state_message`(6)。
⚠️ `measurement_time` 填的是 **`InsStat` 的时间**不是位姿时间（`rtk_localization.cc:204`、`ndt_localization.cc:376`）。
⚠️ `fusion_status` 为 ERROR/FATAL **会触发 monitor 安全模式让车停下**（`modules/monitor/software/localization_monitor.cc:68-69`）。monitor 每 5 s 采一次，`nullptr` → ERROR。

### `InsStat`（`modules/common_msgs/sensor_msgs/ins.proto:8-12`）与状态码

字段仅 3 个：`header`(1) / `ins_status`(2) / `pos_type`(3)。**`ins_status` 从未被任何定位代码读取**（"INS 还在收敛"这个信息被完全忽略）。

`pos_type` → `SolutionType`（`gnss_best_pose.proto:29-64`）：

| 值 | 名 | 精度 | RTK 判定 | NDT 判定 |
|---|---|---|---|---|
| 0 | `NONE` | 无解 | ERROR | ERROR |
| 16 | `SINGLE` | 米级 | ERROR | ERROR |
| 17 | `PSRDIFF` | 亚米 | ERROR | ERROR |
| 34 | `NARROW_FLOAT` | 分米 | WARNNING | ERROR |
| 50 | `NARROW_INT` | 厘米 | **OK** | **ERROR（不在白名单！）** |
| 53 | `INS_PSRSP` | 米级 | ERROR | ERROR |
| 55 | `INS_RTKFLOAT` | 分米 | WARNNING | WARNNING/ERROR |
| 56 | `INS_RTKFIXED` | 厘米 | **OK** | **OK**（仅当 ndt_score < 1.0） |

⚠️ 白名单不一致（`ndt_localization.cc:386-393` vs `rtk_localization.cc:214-231`）：组合导航若报 `NARROW_INT(50)`，**NDT 会一直 ERROR** → monitor 触发安全模式。

### channel 与频率

| channel | 类型 | 频率 | 谁发 |
|---|---|---|---|
| `/apollo/localization/pose` | `LocalizationEstimate` | 100 Hz | 三套方案 |
| `/apollo/localization/msf_status` | `LocalizationStatus` | 100 Hz | **三套方案都往这里写**（名字带 msf 但通用），channel 名来自 `FLAGS_localization_msf_status`（`adapter_gflags.cc:232`），改名要三处一起改 |
| `/tf`（world→localization） | `TransformStampeds` | 100 Hz | 三套。时间戳 = `measurement_time` |
| `/apollo/localization/ndt_lidar` | `LocalizationEstimate` | 10 Hz | 仅 NDT，调试用 |
| `/apollo/localization/msf_lidar`、`msf_gnss` | `LocalizationEstimate` | 5/1 Hz | 仅 MSF，调试用（排查精度的主力） |

**没有任何降频机制**。换低频输入（如纯视觉 10 Hz）必须自己加推算/插值，否则 control 会因位姿更新太慢而不稳定（control 100 Hz，低于 ~50 Hz 就抖）。

## 2. `localization.conf` 全 flag 表

`common/localization_gflags.cc` 共定义 **93 个 flag**，`localization.conf` 实配 47 条有效行。分组：通用 → features → map offset → msf → integ → gnss → common → imu 车体外参 → 可视化 → Status → ndt。它是 `apollo_cc_library`（`common/BUILD:20-27`），被 `ndt/BUILD`、`ndt_locator/BUILD`、`msf/BUILD` 引用；**`rtk/BUILD` 不依赖它**。

### conf 里实配的（行号对应 `conf/localization.conf`）

| 行 | flag | 值 | 说明 |
|---|---|---|---|
| 1 | `--flagfile` | global_flagfile.txt | 从这里继承 `--map_dir`、`--local_utm_zone_id` 等 common flag |
| 2 | `--noenable_gps_imu_interprolate` | — | **死 flag**，RTK 插值永远开着 |
| 10 | `--local_map_name` | local_map | 磁盘目录名 |
| 15 | `--enable_gps_imu_compensate` | false | 只 MSF 接了 `LocalizationGnssCompensator` |
| 20 | `--enable_lidar_localization` | true | 关掉后 MSF 只剩 GNSS+IMU |
| 25 | `--lidar_localization_mode` | 2 | 0 强度/1 高度/2 融合。NDT 无效 |
| 30 | `--lidar_yaw_align_mode` | 2 | 0 关/1 融合/2 多线程融合。NDT 无效 |
| 35 | `--lidar_filter_size` | 17（默认 11） | 匹配搜索窗，直接影响每帧耗时。NDT 无效 |
| 40 | `--point_cloud_step` | 2 | 点云抽点。NDT 无效 |
| 45 | `--lidar_height_default` | 1.80 | `velodyne64_height.yaml` 读失败的回退值 |
| 50 | `--lidar_imu_lidar_max_delay_time` | 0.4 | **flag 名拼错**（真名 `lidar_imu_max_delay_time`），永不生效 |
| 55 | `--lidar_map_coverage_theshold` | 0.8 | 低于此报 `OUT_OF_MAP`（拼写少 r） |
| 60 | `--lidar_debug_log_flag` | false | 开后每帧打点云 height/width/point_cnt |
| 65 | `--integ_ins_can_self_align` | false | |
| 70 | `--integ_sins_align_with_vel` | true | 要求车辆运动才能对齐 |
| 75 | `--integ_sins_state_check` | true | 坏状态时 SINS 重启 |
| 80 | `--integ_sins_state_span_time` | 30.0 | → `SetResetSinsMeasSpanTime`。**唯一能调滤波自复位的两个之一** |
| 85 | `--integ_sins_state_pos_std` | 1.0 | → `SetResetSinsPoseStd`。同上 |
| 90 | `--vel_threshold_get_yaw` | 5.0 | **要 5 m/s（18 km/h）才能用速度定 yaw** |
| 95 | `--enable_ins_aid_rtk` | false | 自研 RTK 用 |
| 100 | `--eph_buffer_path` | `""` | **带引号**，实际值是两个引号字符 |
| 105 | `--gnss_debug_log_flag` | false | |
| 110 | `--imu_rate` | 1.0 | |
| 115 | `--if_utm_zone_id_from_folder` | true | 从地图目录名推 zone，**目录名必须纯数字** |
| 120 | `--local_utm_zone_id` | 10 | 前者 false 时用这个 |
| 125 | `--trans_gpstime_to_utctime` | false | |
| 130 | `--gnss_mode` | 0 | 0 bestgnsspose / 1 自研 gnss |
| 135 | `--lidar_topic` | hesai40 | ⚠️ 与 :140 的 velodyne64 外参矛盾 |
| 140 | `--lidar_extrinsics_file` | velodyne64_..._example.yaml | **读失败 Init 失败** |
| 145 | `--imu_coord_rfu` | true | 轴序 RFU/FLU |
| 150 | `--gnss_only_init` | false | true 时初始化后不再用 bestgnsspose 做量测 |
| 155 | `--if_imuant_from_file` | true | false 时用 :160-185 的 `--imu_to_ant_offset_*` |
| 160-185 | `--imu_to_ant_offset_{x,y,z,ux,uy,uz}` | 0/0.788/1.077/0.05/0.05/0.08 | uncertainty 三个**从未被使用** |
| 190 | `--if_vehicle_imu_from_file` | true | false 时用 :195-210 的 `--imu_vehicle_q*` |
| 195-210 | `--imu_vehicle_q{x,y,z,w}` | 0/0/0/1 | |
| 213 | `--map_visual_dir` | data/map_visual | 可视化临时目录 |
| 218 | `--if_use_avx` | true | **无 AVX 的 CPU 上非法指令崩溃** |

### conf 未配但生效的（要调就往 conf 末尾加）

- NDT 12 个（`localization_gflags.cc:177-193`）：`ndt_map_dir`=ndt_map、`ndt_debug_log_flag`=false、`ndt_max_iterations`=10、`ndt_target_resolution`=1.0、`ndt_line_search_step_size`=0.1、`ndt_transformation_epsilon`=0.01、`ndt_filter_size_x`=48、`ndt_filter_size_y`=48、`ndt_bad_score_count_threshold`=10、`ndt_warnning_ndt_score`=1.0、`ndt_error_ndt_score`=2.0、`online_resolution`。
- 标定文件路径：`lidar_height_file`（`:65`）、`ant_imu_leverarm_file`（`:101`）、`vehicle_imu_file`（`:131`，默认 `<map_dir 同级>/vehicle_params/vehicle_imu_extrinsics.yaml`）。
- MSF 状态阈值：`localization_std_x/y_threshold_1/2`、`imu_delay_time_threshold_1/2/3`、`imu_missing_time_threshold_*`、`imu_frame_time_threshold_*`。
- TF：`broadcast_tf_frame_id`（world）、`broadcast_tf_child_frame_id`（localization）。

### 11 个从未被任何代码读取的 flag（改了零效果，已逐个 grep 验证）

`localization_module_name`、`localization_publish_freq`、`localization_config_file`、`enable_gps_imu_interprolate`、`enable_watchdog`、`gps_time_delay_tolerance`、`gps_imu_timestamp_sec_diff_tolerance`、`timestamp_sec_tolerance`、`map_offset_x/y/z`、`report_threshold_err_num`、`report_gps_imu_time_diff_threshold`、`enable_gps_timestamp`。
RTK 的对应值全是硬编码成员（`rtk_localization.h:87-104`：`localization_publish_freq_=100` 等）。

### `conf/rtk_localization.pb.txt` 13 字段（RTK 唯一真实配置）

`localization_topic` / `localization_status_topic` / `imu_topic` / **`gps_topic`（死字段，改 GPS 输入必须改 dag `readers`）** / `gps_status_topic` / `broadcast_tf_frame_id` / `broadcast_tf_child_frame_id` / `imu_frame_id` / `imu_list_max_size`(20) / `gps_imu_time_diff_threshold`(0.02) / `map_offset_x/y/z`(0)。

## 3. `local_integ` 各类职责与调用顺序

数据流（`msf/local_integ/`，21 个文件）：

```
IMU (100Hz, dag readers 触发 Proc)
  → MSFLocalizationComponent::Proc  →  MSFLocalization::OnRawImu
  → LocalizationInteg::RawImuProcessRfu/Flu（按 --imu_coord_rfu）
  → LocalizationIntegImpl::RawImuProcessImpl
  → LocalizationIntegProcess::RawImuProcess → 闭源 sins_->Update  ★唯一位姿输出源★
  → GetResult → CompensateImuVehicleExtrinsic → 发布 pose + TF
点云 (10Hz) → OnPointCloud → PcdProcess → LidarMsgTransfer → LocalizationLidarProcess::PcdProcess
  → GetPredictPose(闭源 PoseForcast) → LocalizationLidar::Update(闭源 LidarLocator + PyramidMap)
  → MeasureRepublishProcess::LidarLocalProcess → MeasureData → integ_process_->MeasureDataProcess
GnssBestPose (1Hz) → GnssBestPoseProcess → MeasureRepublishProcess::GnssLocalProcess → MeasureData
Heading (2Hz 限频) → GnssHeadingProcess → MeasureData(GNSS_DOUBLE_ANT_YAW)
所有 MeasureData → 队列（深度 150，不按时间排序）→ MeasureDataThreadLoop 单线程出队
  → CheckIntegMeasureData（恒 true，加野值剔除就改这里）→ 闭源 sins_->AddMeasurement
```

| 类 | 文件 | 职责 | 改代码时 |
|---|---|---|---|
| `LocalizationInteg` | `localization_integ.{h,cc}` | 门面（PIMPL），proto→内部结构转换、`TransferImuFlu/Rfu` | 新增一路观测要在这里加 API |
| `LocalizationIntegImpl` | `localization_integ_impl.{h,cc}` | 编排层：谁调谁、LiDAR 高程接管 | **改融合链路的第一现场** |
| `LocalizationIntegProcess` | `localization_integ_process.{h,cc}` | SINS/EKF 包装 + 量测队列 + 状态机 | **换滤波器的唯一边界（8 个方法）** |
| `MeasureRepublishProcess` | `measure_republish_process.{h,cc}`（726 行） | 量测构造 + 门限 + 双天线定向 | **调权重的主战场** |
| `LocalizationLidarProcess` | `localization_lidar_process.{h,cc}` | LiDAR 流程与状态机、外参/高度加载、质量分级 | LiDAR 权重与门限 |
| `LocalizationLidar` | `localization_lidar.{h,cc}` | 地图拼接 + 闭源 locator 包装 + `RefineAltitudeFromMap` | 地图查询接口 |
| `LocalizationGnssProcess` | `localization_gnss_process.{h,cc}` | 自研 RTK，**当前接不到数据**（`--gnss_mode=0`） | 一般不用动 |
| `LidarMsgTransfer` / `GnssMagTransfer` | `lidar_msg_transfer.*` / `gnss_msg_transfer.*` | proto→内存点云 / 磁力计 | 点云高度截断在 `lidar_msg_transfer.h:42` `max_height_=100.0` |
| `OnlineLocalizationExpert` | `online_localization_expert.{h,cc}` | 状态码汇总，**不影响位姿** | 改 `msf_status` 判定 |
| `localization_params.h` | — | 参数结构体（无 gflags 入口的默认值都在这里） | `unstable_reset_threshold`(:91)、`vehicle_to_imu_quatern`(:96) |

**闭源库（`@localization_msf`）提供**：`Sins`、`LidarLocator`、`GnssSolver`、`PoseForcast`，以及结构体 `InsPva` / `ImuData` / `MeasureData` / `InertialParameter` / 枚举 `MeasureType` / `FrameType`（`localization_msf/sins_struct.h`）。

### 闭源结构体字段（从用法完整反推）

- `InsPva`：`time`、`pos.{longitude,latitude,height}`（**弧度+米**）、`vel.{ve,vn,vu}`（m/s ENU）、`att.{pitch,roll,yaw}`（**弧度**）、`qbn[4]`（`[0]=w`）、`init_and_alignment`（bool，全系统的"对齐完成"信号）。
- `ImuData`：`measurement_time`、`fb[3]`（比力/加速度，体轴）、`wibb[3]`（角速度，体轴）。
- `MeasureData`：`time`、`gnss_pos.{longitude,latitude,height}`、`gnss_vel.{ve,vn,vu}`、`gnss_att.{pitch,roll,yaw}`、`measure_type`、`frame_type`、`is_have_variance`、`variance[9][9]`。
- `MeasureType`（闭源）：`GNSS_POS_ONLY`、`GNSS_POS_VEL`、`GNSS_POS_XY`、`ENU_VEL_ONLY`、`POINT_CLOUD_POS`、`GNSS_DOUBLE_ANT_YAW`、`ODOMETER_VEL_ONLY`。
  `proto/measure.proto:11-26` 那套**不一致**：有 `GNSS_VEL_ONLY`、`VEHICLE_CONSTRAINT`，缺 `ENU_VEL_ONLY`、`GNSS_DOUBLE_ANT_YAW`。且 `measure.proto` / `sins_pva.proto` 在 `local_integ` 里**完全没被使用**（ROS 时代遗留，现在数据靠内存结构传递）。
- `FrameType`：`ENU`（经纬度弧度）、`ECEF`、`UTM`。

### `variance[9][9]` 的 9 维状态量定义

| 索引 | 含义 | 证据 |
|---|---|---|
| 0,1,2 | 位置（纬/经/高 或 x/y/z，取决于 `frame_type`） | `localization_integ_process.cc:233-235` 填 `position_std_dev`；`measure_republish_process.cc:417-422` 填 GNSS 位置方差 |
| 3,4,5 | 速度 ve/vn/vu（ENU） | `localization_integ_process.cc:239-241`；`measure_republish_process.cc:214-216` |
| 6,7,8 | 姿态 pitch/roll/yaw | `localization_integ_process.cc:245-247`；`:161` 单独用 `[8][8]` 判 yaw 收敛；`measure_republish_process.cc:380,624` 只写 `[8][8]` |

即 P(3)+V(3)+A(3)=9。这只是**对外暴露的 9 维**；闭源库内部很可能是 15/21 维含 IMU 零偏（因为 `sins_->GetRemoveBiasImu` 明确返回去零偏的 IMU）。

### 量测门限全表（都在量测构造阶段，滤波阶段没有任何检验）

- GNSS bestpose：`sol_status != 0` 或 `sol_type ∈ {0,1,2}` 丢（`measure_republish_process.cc:709-719`）；**未对齐时** std > 5 m 丢（`:692-698`，对齐后不查）。
- 自研 RTK：合成 std > 10 m 丢（`localization_gnss_process.cc:329-333`）。
- LiDAR：`lidar_status_ != OK(2)` 不 republish（`localization_integ_impl.cc:112`）；帧延迟 > 0.4 s 丢（`localization_lidar_process.cc:281-287`）。
- Heading：`solution_status != 0` 或 `position_type ∈ {0,1}` 丢（`measure_republish_process.cc:545-556`）；距 LiDAR 高程 <1 s 丢（`:571-575`）；对齐后 0.5 s 限频（`:583-588`）。
- `BESTPOSE_GOOD_COUNT = 10`（`measure_republish_process.h:126`）：至少连续 10 帧好解，1 Hz → 10 秒。
- 发散检测只有两处，都是"降级输出"不是"重置滤波"：`GetValidFromOK`（协方差超阈值就不给 VALID 但仍给 OK 继续发）、expert 的 `position_std > 0.3 m` → `FATAL_ERROR`（**只写状态话题，位姿照发**）。真正的 SINS 状态检查与重启在闭源库内，由 `--integ_sins_state_pos_std` / `--integ_sins_state_span_time` 控制。

## 4. 定位地图（`local_pyramid_map`）

### 磁盘目录格式

```
<map_folder>/                    # 例 /apollo/modules/map/data/xxx/local_map
├── config.xml                   # 唯一元数据（版本、分辨率、node 尺寸、range、地面高度偏移）
├── map/000/north/50/00034635/00003435    # %03u resolution_id / north|south / %02d abs(zone) /
│                                         # %08d m_(northing，目录) / %08d n_(easting，文件名，无扩展名)
├── image/000/north/50/00034635/00003435.png       # 1024×1024 强度预览
└── image_alt/000/north/50/.../00003435.png        # 高度预览
```

**四份路径拼接代码几乎完全相同**（`local_pyramid_map/base_map/base_map_node.cc`：Save `:90-116` / Load `:136-156` / image `:436-462` / image_alt `:484-510`）—— 改路径格式必须同时改这 4 处，是本模块最容易改漏的地方。

索引公式（`base_map_node_index.cc:67-93`，前提 `map_range_` min 为 0）：`span = map_node_size * resolution`（1024 × 0.125 = 128 m），`m = int(northing/span)`、`n = int(easting/span)`。

### node 二进制布局

Header（`base_map_node_config.cc`：写 `:88-133` / 读 `:42-86` / size `:135-158`）：

- **lossy_map / lossless_map / NDT**（`has_map_version_=false, has_body_md5_=false`）：**20 B 无空洞**，全小端 —— `0x00 u32 resolution_id | 0x04 i32 zone_id | 0x08 u32 m_ | 0x0C u32 n_ | 0x10 u32 body_size`（**压缩后** body 字节数）。与 legacy 字节级兼容。
- **pyramid_lossy / pyramid_lossless**（声明 38 B，实写 22 B）：`0x00 u16 map_version`（**枚举声明顺序就是磁盘格式的一部分**）、`0x02 u8[16] body_md5`（先写后被覆盖）、`0x02 u32 resolution_id`（**与 md5 重叠**，因为 `:111` 的 `ui_p` 从 buf+2 而非 buf+18 起算）、`0x06 i32 zone_id`、`0x0A u32 m_`、`0x0E u32 n_`、`0x12 u32 body_size`、`0x16–0x25` **16 B 未初始化堆内容直接落盘**。`LoadHeaderBinary` 从不校验 md5 → 该字段完全是死的；Load 侧犯同一个错所以能自洽 round-trip（这是它一直没被发现的原因）。同一份地图两次保存产生不同文件 → md5 校验不可复现。**修它会破坏磁盘兼容性，必须配合新 MapVersion。**

Body：4 个 handler（`pyramid_map_matrix_handler.cc`）编码 7 个平面（intensity / intensity_var / altitude / altitude_var / ground_altitude / ground_count / count）。`map_is_compression_` 配置项**完全无效**（`pyramid_map_node.cc:55,95` 无条件 `new ZlibStrategy()`）；更糟的是 `uncompressed_file_body_size_` 只在压缩分支里赋值 → **真走无压缩路径 Load 会 100% 返回 false**。

### 两级 LRU 缓存与内存约束

`MapNodeCache` 在 `msf/common/util/base_map_cache.h:32-88`（不在 base_map 目录），底层是 `modules/common/util/lru_cache.h:42`。
- **L1 = "本帧必须驻留"集合**，淘汰永远允许（只清 node 的 `is_reserved_`），**L1 不拥有 node，淘汰不还给 pool**。
- **L2 = 真正的持有者**，`CacheL2Destroy` 返回 `!is_reserved_` → **node 还在 L1 里，L2 就不能淘汰它**。L2 淘汰出的 node 由调用方 `FreeMapNode()` 还给池。
- `IsExist`（`base_map_cache.h:176-178`）= `Prioritize`，**有副作用：把 key 提到 LRU 头部**。
- 容量：MSF lidar `InitMapNodeCaches(12, 24)` + pool 25（`local_integ/localization_lidar.cc:65-67`）；建图工具同。形参名拼错成 `cahceL2_size`。
- **内存**：一个 node = 1024×1024 cell × 7 平面 × 4 B ≈ **28 MB**，pool 25 个 → **约 700 MB 常驻**。改 node 尺寸到 2048 会变成 2.8 GB。`LoadMapArea` 最多 9 个 + `PreloadMapArea` 最多 16 个 = 25，正好顶到 pool 上限，**边界很薄**（活锁的触发条件）。

### `local_tool` 工具清单（binary target 全在 `msf/BUILD`，不在 `local_tool/`）

| 工具 | BUILD 行 | 源码 | 用途 |
|---|---|---|---|
| `cyber_record_parser` | `:443` | `local_tool/data_extraction/cyber_record_parser.cc` | 从 record 抽点云与 4 条轨迹。**`--bag_files` 复数** |
| `compare_poses` | `:455` | `local_tool/data_extraction/compare_poses.cc` | **对比两条轨迹算误差，精度评估主力** |
| `poses_interpolator` | `:426` | `local_tool/map_creation/poses_interpolator.cc` | 位姿插值到 pcd 时间戳 + 转 lidar 位姿（12→9 字段） |
| `lossless_map_creator` | `:406` | `local_tool/map_creation/lossless_map_creator.cc`（394 行） | **核心建图工具** |
| `lossless_map_to_lossy_map` | `:417` | `local_tool/map_creation/lossless_map_to_lossy_map.cc` | 唯一的格式转换工具 |
| `offline_local_visualizer` | `:434` | `local_tool/local_visualization/offline_visual/` | 离线渲染轨迹+地图 |
| `OnlineVisualizerComponent` | `local_tool/local_visualization/online_visual/BUILD` | 同目录 `.cc` | 在线可视化，`.so` 名拼错成 `compenont` |

**没有任何工具能检查已建好的地图质量** —— 只能靠可视化目视 + `compare_poses` 量化。
其余源文件：`data_extraction/{cyber_record_reader, location_exporter, pcd_exporter}.{h,cc}`、`local_visualization/engine/{visualization_engine, visualization_manager}.{h,cc}`、`map_creation/poses_interpolation/poses_interpolation.{h,cc}`。

`scripts/msf_*.sh` 六个（`msf_local_evaluation.sh`、`msf_local_map_creator.sh`、`msf_offline_local_visualizer.sh`、`msf_poses_interpolation.sh`、`msf_record_parser.sh`、`msf_simple_map_creator.sh`）**全部有路径 bug**：binary 路径写死为 `local_tool/` 子目录（真实产物在 `bazel-bin/modules/localization/msf/<name>`），且 `--bag_file` vs `--bag_files`。

## 5. `msf/params/` 标定文件逐个

| 文件 | 内容 | 读取点 / 控制 flag |
|---|---|---|
| `gnss_params/ant_imu_leverarm.yaml`（21 行） | GNSS 天线相对 IMU **杆臂**：`leverarm.primary.offset`=(0, 1.10866, 1.14165)+`uncertainty`(0.05,0.05,0.08)；有 `secondary` 段 → `ant_num=2` → 启用双天线定向 | `FLAGS_ant_imu_leverarm_file`（`localization_gflags.cc:101`），受 `--if_imuant_from_file` 控制。**被三个独立解析函数读三次**：`msf_localization.cc:360-383`（`ACHECK` 包裹，失败 abort）、`localization_integ_process.cc:365-383`（**死代码，无调用者**）、`measure_republish_process.cc:635-687`（双天线，文件缺失只 AINFO 不报错 → `ant_num` 未初始化）。`uncertainty` 三值**从未被使用** |
| `velodyne_params/velodyne64_novatel_extrinsics_example.yaml`（17 行） | **lidar→IMU 外参** `T_imu_lidar`：`transform.translation`(-0.0581,1.4593,1.2497)+`transform.rotation` 四元数 | `FLAGS_lidar_extrinsics_file`（`:61`，conf:140）→ `LocalizationLidarProcess::LoadLidarExtrinsic`（`:411-436`，**必须同时有 translation 和 rotation，否则 Init 失败、组件起不来**）。另一同格式解析器在 `common/io/velodyne_utility.cc:160-180`。`child_frame_id`/`header` 字段代码不读 |
| `velodyne_params/velodyne64_height.yaml`（4 行） | **lidar 中心到地面高度** `vehicle.parameters.height: 1.91`、`height_var: 0.0047` | `FLAGS_lidar_height_file`（`:65`，conf 未配）→ `LoadLidarHeight`（`localization_lidar_process.cc:438-456`，失败只 WARN 退回 `lidar_height_default`）→ `SetVehicleHeight` → `RefineAltitudeFromMap` 的 `z = ground_alt + height`。**`height_var` 读进结构体但从未使用**。**改这个值直接平移输出高程** |
| `vehicle_params/vehicle_imu_extrinsics.yaml`（10 行） | **车体→IMU 外参**：全零平移 + 单位四元数 | `FLAGS_vehicle_imu_file`（`:131`，默认 `<map_dir 同级>/vehicle_params/...`），受 `--if_vehicle_imu_from_file` 控制 → `msf_localization.cc:385-413`。真车配置在 `modules/calibration/data/mkz_121/vehicle_params/` 与 `mkz_lgsvl_321/` |
| `velodyne_params/64E_S3_calibration_example.yaml`（246 行） | Velodyne HDL-64E S3 逐线内参（64 个 laser_id） | 驱动侧解包用，**定位不读**，历史遗留 |
| `imu_localization_extrinsics.yaml` / `novatel_localization_extrinsics.yaml`（各 17 行） | 全零平移 + 单位四元数 | **全仓 grep 无任何引用**，TF 广播历史遗留 |

**换车/换传感器必改这三个**：`velodyne64_novatel_extrinsics_example.yaml`、`velodyne64_height.yaml`、`ant_imu_leverarm.yaml`。
`params/BUILD` 的 install 规则被注释掉（`:6-12`），只剩 filegroup `runtime_data`（`:14-22`）。`dreamview_gflags.cc:87` 也引用了 `msf/params/velodyne_params/` 路径。

## 6. 高确信度缺陷全表

确信度：**高** = 代码可直读确认；**中** = 机制真实但触发条件苛刻或未验证调用链。

### 缓存 / 并发 / 内存（优先级最高）

| # | file:line | 问题 | 影响 | 确信度 |
|---|---|---|---|---|
| F2 | `modules/common/util/lru_cache.h:176-183` | `Remove` Detach 后漏 `map_.erase(key)`（对比 `GetObsolete:286-295` 就有） | **头号缺陷**：陈旧 key 指向已被回收复用的 node → 定位读到错误地图数据或崩溃；`Prioritize` 二次 Detach 让 `size_t size_` 下溢成巨大值 → `Full()` 恒真 → 缓存彻底失控。两套 map 实现共用此文件 | 高 |
| F6 | `base_map/base_map.cc:66-94` | `GetMapNodeSafe` 三段锁 TOCTOU，`:92` 的 `Get` 返回值未检查 → 可能 return nullptr | 所有调用方不判空并立即解引用（`pyramid_map.cc:35/44/53/62/71/80/90` 共 7 处、`localization_lidar.cc:233-234,297-303`、`lossless_map_to_lossy_map.cc:167-170`）→ **段错误** | 高 |
| F4 | `base_map.cc:231-241` | `while (map_node == nullptr)` 在 pool 满 + L2 全 reserved 时循环体不做有效工作 | **100% CPU 忙等，永不退出也不打日志**。触发条件：L1 容量 ≥ pool，或并发加载数超 `pool - L1` | 高 |
| F5 | `base_map.cc:57-61` | `GetMapNode` 无锁访问 L1，而 `Get` 会改 LRU 链表和 `size_` | pyramid 系列统一走 Safe 版，但基类这个接口是暴露给外部的地雷 | 高 |
| F16 | `base_map/base_map_node_index.cc:83-91` | 越界只 `std::cerr`（assert 被注释），`m_/n_` 保持 0；负坐标经 `static_cast<int>` → `unsigned int` 绕成巨大值同样走越界分支 | **车在地图边界外时静静读到 (0,0) 节点数据，不报错** | 高 |
| F17 | `base_map_node_index.cc:71,78,82,100,108`；`base_map_node.h:134`、`.cc:361,365,383,387` | `resolution_id` 无边界检查（assert 被注释），而 `map_resolutions_` 可能为空 | 空 vector 的 `[0]` OOB 读 | 高 |
| F18 | `base_map.cc:124-127` | `map_ids->size() > L1 容量` 时只打 `std::cerr` 就 return，而 `LoadMapArea` 仍返回 true（`:487`） | 调用方（`localization_lidar.cc:124,136`）完全不知道地图没加载上 | 高 |
| F15 | `base_map_pool.cc:97-99`；`base_map_node.cc:367-374`；`pyramid_map_matrix_handler.cc:420,606,1003,1281` | `throw "字面量"`（`const char*`，无人 catch），且发生在 `cyber::Async` 任务线程 | **进程终止**。`ComputeLeftTopCorner` 越界会让整个定位进程 abort；同一越界在 `GetLeftTopCorner:389-390` 只是 release 下静默的 `DCHECK_LT`，两套行为不一致 | 高 |
| F14 | `base_map_node.cc:80-81,469-474` | 丢弃两个 `Save*Image()` 返回值；`SaveIntensityImage` 不检查 `image.empty()`（altitude 版检查了） | 空 Mat 让 `cv::imwrite` 抛异常，从 `Save()` 一路抛到在任务线程里调用的 `Finalize()` → 未捕获 → `std::terminate` | 中 |
| F10 | `base_map_node.cc:190,258` | `body_size` 完全信任文件头里的 uint32，无上限校验 | 损坏/截断文件可请求 4 GB 分配（OOM）；为 0 时 `&buf[0]` 是 UB。**地图文件通常不可信**（外部拷入、传输截断） | 高 |
| F9 | `base_map_node.cc:209-218` | 先对 `&body_buffer[0]` 算 md5，才检查 `processed_size == 0` | 空 vector `operator[](0)` UB。把检查提到 md5 之前即可 | 高 |
| F19 | `base_map.h:67` | `BaseMap::Release()` 只有声明没有定义 | **谁调它谁链接失败** | 高 |
| F20 | `base_map.cc:38`；`local_integ/localization_lidar.h:135-136` | `~BaseMap()` 是空的；且 `PyramidMap map_;` 声明在 `PyramidMapNodePool map_node_pool_;` **之前** → 析构逆序 → pool 先析构 delete 掉所有 node | 当前恰好没崩（因为 `~BaseMap()` 什么都不做）；**一旦有人实现 F19 立刻 use-after-free** | 中 |
| F12 | `base_map_pool.cc:28-30,86-89` | `PyramidMapNodePool(25, 8)` 的 `thread_size=8` 被静默丢弃，实际用单个 future 覆盖赋值 | 前一个任务未完成时行为取决于 `cyber::Async` 实现 | 高 |
| F8 | `base_map.cc:214`；`base_map_pool.cc:87-88` | 局部 `preload_futures` 析构；`cyber::Async` 在**非 reality mode 下退化为 `std::async`，future 析构会阻塞到任务完成** | "不等待的预加载"在仿真/单测里变成完全同步，每帧多 100 ms+ | 中 |

### 地图逻辑 / 序列化 / 量化

| # | file:line | 问题 | 确信度 |
|---|---|---|---|
| A1 | `pyramid_map_matrix.cc:97,111` | `Init` 的可整除性校验用成员 `resolution_num_`，而赋值在 `:111` 之后且 `:79 Clear()` 刚置 1 → 循环一次都不进。rows/cols 不能被 ratio 整除时静默截断。**改金字塔层数前必修** | 高 |
| A2 | `pyramid_map_matrix.cc:374,407` | `BottomUpSafe`/`BottomUpBase` 用 `rows_mr_[i]` 当 col（应为 `cols_mr_[i]`）。`rows > cols` 时在任何检查之前越界读。**改非正方形 node 或启用金字塔前必修** | 高 |
| A3 | `pyramid_map_matrix.cc:1252-1255,1292-1296` | `MergeCellSafe` 两边 count 都为 0 时 `new_count=0` → 除零 NaN；而 `Reduce`（`:1502-1517`）对每个 cell **无条件**调它 → 空 cell 把 intensity/var/altitude 全污染成 NaN | 高 |
| A4 | `pyramid_map_matrix.cc:316-347` | `GetAltitudeImg` 只检查 `has_altitude_` 不检查 `has_count_`，却读 `count_matrixes_`。而 `SaveAltitudeImage`（`base_map_node.cc:519`）**无条件**调它 | 高 |
| A5 | `pyramid_map_matrix_handler.cc:157` | `LossyMapFullAltMatrixHandler::LoadBinary` 用非 Safe 的 `GetRows()/GetCols()`（刚 Clear 过 → `rows_mr_` 为空 → 越界读）。同类函数 `:455` 用的是 Safe 版，**明显笔误** | 高 |
| A6 | `pyramid_map_matrix.cc:213-248` | `ResetCells` 未校验 `start_id <= end_id`。反了时 `MakeEmpty` 算出的 int 负值转 size_t → **巨大 memset → 段错误** | 高 |
| A7 | `aligned_matrix.h:188-227`；`pyramid_map_matrix.cc:432-457` | `operator=` 无自赋值保护。前者先 `free` 再 `memcpy` 自己 → 读已释放内存；后者 `Clear()` 后从自己拷 → **数据全丢** | 高 |
| A8 | `pyramid_map_matrix_handler.cc:473-506` | `LosslessMapMatrixHandler::LoadBinary` 对 `size > 2` 的 layer 什么都不做且指针不前进 → 后续解析全部错位。当前 `CreateBinary` 只写 1-2 层，只在读外部/旧数据时炸 | 高 |
| B2 | `pyramid_map_node.cc:55,95`；`base_map_node.cc:196,274-283` | `map_is_compression_` 配置项完全无效（无条件 zlib）；且 `uncompressed_file_body_size_` 只在压缩分支赋值 → **真走无压缩路径 Load 100% 返回 false** | 很高 |
| B3 | `pyramid_map_node.cc:69-100` | 三参版 `Init` 不初始化 `resolutions_mr_`（单参版 `:59-64` 有）→ 之后 `GetCoordinate` 读空 vector。生产路径走单参版，主要影响测试/直调 | 高 |
| B4 | `base_map_node.cc:203,233` | `buffer` 按未压缩 body 大小分配，memcpy 的是压缩后 body。zlib 对不可压缩数据会膨胀 → **无声堆破坏**。`:222` 的 `header_buf` 是死代码 | 中 |
| B5 | `base_map.cc:493-495,512-513` | `GetMapIndexFromMapPath` 格式串少了开头的 `/map` 段 → sscanf 立即失败返回 0，且未初始化 `buf` 被 `std::string zone = buf` 读取（**UB**）→ `all_map_node_indices_` 全是垃圾。`%05s` 也应写 `%5s` | 高 |
| B6 | `base_map_config.cc:68,108`；`pyramid_map_config.h:41` | XML tag 写出 `coordnate_type`（缺 i）读 `coordinate_type` → 基类的值存了读不回来；派生类又声明同名成员**遮蔽基类**，两者永不同步，config.xml 里会出现两个近似 tag | 很高 |
| B7 | `ndt_map_config.cc:54-58` | `CreateXml` 循环上界用 `map_resolutions_.size()` 却索引 `map_resolutions_z_[i]` → 越界。legacy 与 pyramid 都犯 | 高 |
| C1 | `pyramid_map_matrix_handler.h:55` | `count_range_ = 2`（注释还留着 `// 31;`）→ **所有 lossy 格式的 count 只能表达 {0,1,2}，已退化成占用标记**。而 count 是 `MergeCell*` 的权重和有效性判据。**这是"lossy 地图统计量不可信"的根因** | 很高 |
| C2/C3 | `pyramid_map_matrix_handler.cc:72-92` | `EncodeIntensityVar` 对负输入 `sqrt(负)` → NaN → `static_cast<unsigned int>(NaN)` 是 UB 且两个 clamp 对 NaN 均为 false；`DecodeIntensityVar` 未防 `data == 0` → inf | 高 |
| C4 | `pyramid_map_matrix_handler.cc:277,850` | 全 cell `count==0` 时 `alt_avg_min_` 保持初值 `1e8` **并写入文件头** → 解码后所有 altitude 变成 `1e8 + d*0.04` | 高 |
| C5 | `pyramid_map_matrix_handler.cc:94-107` | lossy round-trip 对空 cell 不是恒等：解码得到 `alt_avg_min_` 而非 0。**读取方必须先判 count 再用 altitude**（`RefineAltitudeFromMap` 就是这么做的，`localization_lidar.cc:250`） | 高 |
| C7 | `pyramid_map_matrix_handler.cc:762-766,964,1030-1032` | `PyramidLossy` 的 `altitude_var` 平面写全 0、读时跳过、`GetBinarySize` 照样算 → 白占 `2N` 字节/层 | 很高 |
| C8 | `local_map/lossless_map/lossless_map_matrix.cc:55` | legacy lossless 的 `intensity_var` 递推少了外层除 count → 不是方差，随样本数爆炸。`Reset:31-36` 与 `operator=:38-45` 都漏了 `altitude_var`。**（legacy 死代码，但别抄它的公式）** | 高 |
| A9 | `lossless_map_creator.cc:150-162` | resolution 校验混用 `> 1e-8` 和 `< 1e-8`，合取式几乎恒假 → 警告基本不触发（装饰性缺陷） | 高 |
| D15 | `pyramid_map_matrix.cc:1106-1120`；`lossless_map_creator.cc:291,325-327` | `SetIntensitySafe` 是**覆盖写不是累加**，不碰 count/intensity_var/altitude。建图的"叠加"实为 last-writer-wins → **建出的地图统计量全是初值**。要真做均值必须用 `AddSampleSafe`（`:1386`）或 `MergeCellSafe`（`:1238-1294`），**建图工具两个都没调** | 高 |
| D1 | `pyramid_map_matrix.cc:381+388,414+419`；`pyramid_map_matrix_handler.cc:644-647 vs 695-696` | 变量遮蔽（外层 `const unsigned int& count`，内层立刻 `unsigned int* count`）。功能恰好正确但改这段极易出错 | 很高 |
| D2 | `pyramid_map_matrix.cc:57-59`；`pyramid_map_node.cc:169-173` | `dynamic_cast` 结果未检查 → 传入非 `PyramidMapConfig` 时 nullptr 解引用 | 很高 |
| D3 | `pyramid_map_matrix_handler.cc:47` vs `pyramid_map_node.cc:52-54,92-94` | handler selector 返回 nullptr 未被处理（只打 `AINFO "Unknown map version!"`）→ 在 `base_map_node.cc:296/316` 崩 | 高 |
| D4 | `aligned_matrix.h:19-20` | 只 include `<cstddef>` 和 `<iostream>`，却用 `memcpy`/`memset`/`malloc`/`free`/`uint64_t` → 靠传递性包含侥幸编译 | 很高 |

### MSF 融合

| # | file:line | 问题 | 确信度 |
|---|---|---|---|
| M1 | `localization_integ.cc:101,116`；`measure_republish_process.cc:194,409,559` | 三路时间戳走三套不同转换（`TimeUtil::Gps2Unix` 782 / `msf::GpsToUnixSeconds` 800+闰秒表 / 直接用消息时间）。闰秒表只维护到 2017，未来会分叉 | 高 |
| M2 | `localization_params.h:96`；`measure_republish_process.cc:82-114` | `vehicle_to_imu_quatern` **永无赋值点** → DCM 恒为单位阵，杆臂旋转成恒等变换 → 双天线基线方位角算错 | 高 |
| M3 | `localization_integ_impl.cc:159-162`（附近 `:118`） | LiDAR 高程接管后**永不释放**（可用标志无超时复位） | 高 |
| M4 | `localization_lidar_process.cc:318` | `GetPredictPose` 的 `\|\|` 应为 `&&` → `"LocalizationLidar Fatal Error: invalid pose!"` 误杀 | 高 |
| M5 | `localization.conf:50` vs `localization_gflags.cc:79` | flag 名写错（`lidar_imu_lidar_max_delay_time` vs 真名 `lidar_imu_max_delay_time`）→ 实际用默认值 0.4 | 高 |
| M6 | `measure_republish_process.h:48-55`、`.cc:78-80` | `VehicleGnssAntExtrinsic` 无默认构造；yaml 缺失时只 `AINFO` 不报错 → `ant_num` 未初始化 → 双天线判断随机 | 高 |
| M7 | `localization_integ_impl.cc` | `integ_pva_list_.back()` 无空判断 | 高 |
| M8 | `measure_republish_process.cc` | `if (!pre_yaw_from_vel)` 用浮点做布尔 | 高 |
| M9 | `measure_republish_process.cc` | 双天线 yaw 归化只处理上溢（正朝北时会丢帧） | 高 |
| M10 | 多处 | `position_std_dev` 有时是标准差有时是方差，各路填法不一致 | 高 |
| M11 | `localization_lidar.cc:239,268` | `RefineAltitudeFromMap` 的 `pre_vehicle_ground_height_` 只初始化一次 | 高 |
| M12 | `localization_lidar.cc` | `ComposeMapNode` / `RefineAltitudeFromMap` 未判 nullptr | 中 |
| M13 | `msf_localization.cc:385-413`（`:398-401` vs `:405-410`） | `LoadImuVehicleExtrinsic` 部分失败：`translation` 缺失时 return false，但 **rotation 已被写入出参**且 `:107-115` 会用它 → 留下半套参数 | 高 |
| M14 | `msf/common/util/frame_transform.cc:52-72` | `UtmXYToLatlon` 完全忽略 `southhemi` 参数 → 南半球算错。且 `LatlonToUtmXY`（`:27-51`）**zone 由 lon 自动算、忽略配置的 zone_id**，并每次调用都 `pj_init_plus`+`pj_free`（每帧 IMU 两次 proj 初始化） | 高 |
| M15 | `msf/common/util/math_util.h:35-36` | `EulerToQuaternion` 的 `qbn[3]`（qz）整体差一个负号（与 `measure_republish_process.cc:626` 给 yaw 取负配套）—— 这套代码用"航向角顺时针为正"的导航约定 | 高 |
| M16 | `msf_localization.cc:327-358` vs `:236-244` | `CompensateImuVehicleExtrinsic` **不改 `pose.orientation`**，只改 heading/euler_angles/position → 输出的四元数与 heading 来自不同坐标系。且不作用于 TF 前的结果与 msf_lidar/msf_gnss 话题 | 高 |
| M17 | `online_visualizer_component.cc:126-131` | ndt 的 Reader 覆盖了 `lidar_local_listener_` 成员（应用 `ndt_local_listener_`）→ msf_lidar 那一路被顶掉 | 高 |
| M18 | `msf_localization.cc:236-244` | 发布只看 `result.state()`，不看 `result.integ_status().integ_state` → **expert 打到 FATAL_ERROR 时位姿照发** | 高 |

### RTK / NDT

| # | file:line | 问题 | 优先级 |
|---|---|---|---|
| L6 | `ndt/ndt_localization.cc:157-167` + `ndt_localization_component.cc:98-108` | `lidar_locator_` 未初始化时输出 Identity (0,0,0) 且 `is_service_started_=true` → **车认为自己在 UTM 原点**，TF 也是 (0,0,0) | **P0** |
| U1 | `ndt_localization.cc:411` | `odometry_buffer_.back()` 空 buffer UB（点云先于 odometry 到达就崩） | **P0** |
| S1-S4 | `localization_pose_buffer.h:55-65`（无 mutex）；`ndt_localization.cc:160 vs 194`、`:193,196-201 vs :166`、`:162-166 vs :238-251`、`:188-192 vs :158` | **NDT 系统性缺锁**：`pose_buffer_`、`lidar_pose_`/`ndt_score_`/`bad_score_count_`、三个结果消息、`lidar_locator_`（含整个地图缓存）都在 LidarCallback 与 Proc 两线程并发读写。4×4 double 的 `Affine3d` 非原子，可能读到半更新值 | **P0** |
| X7/X8 | `ndt_localization.cc:291-311` vs `rtk_localization.cc:273-323`；`vehicle_state_provider.cc:113-142` | NDT 直接 `CopyFrom(Gps)` 而驱动不填加速度/角速度 → **NDT 输出这些字段全空 → `VehicleStateProvider` 必定返回 false → planning/control 拿不到车辆状态** | **P1** |
| L5 | `ndt_localization.h:55`、`.cc:56-61`；`ndt_localization_component.cc:57` | `Init()` 返回 void，外参加载失败只 `return`，组件照常起来、外参=Identity → 静默的系统性错位 | **P1** |
| U6 | `ndt_locator/lidar_locator_ndt.cc:281,284,448` | `assert(map_.IsMapNodeExist(...))` 在 Release(NDEBUG) 下是空语句，随后 `GetCoordinate()` 空指针解引用 | **P1** |
| X3/X4 | `rtk_localization.cc:444-448`+`454-469`；`ndt_localization.cc:449-453` | 欧拉角/yaw 线性插值**没有 ±π 绕回**（同文件的 `localization_pose_buffer.cc:107-115` 却做了）→ 车头朝西时翻转 → NDT 初值姿态翻转导致配准失败 | **P2** |
| L1 | `rtk_localization.cc:181` | `FindMatchingIMU` 返回值被忽略 → 失败时用空 IMU、位姿照发，下游表现为"localization not ready"而非"IMU 丢了" | **P2** |
| L4 | `ndt_localization.cc:192` | `LidarLocatorNdt::Update` 返回值（0/−1 表示地图是否就绪）被忽略 → 地图缺块时结果照样进 pose_buffer | 高 |
| L7 | `ndt_solver.hpp:279-309`；`lidar_locator_ndt.cc:221,226` | `HasConverged()` 几乎恒为 true（超迭代上限、Newton 方向为 0 都算收敛，只有 NaN 才 false），且 NDT 完全不看它。**不是可靠的失败信号** | 高 |
| L8 | — | NDT **没有任何降级/拒绝输出机制**，质量差只体现在 `LocalizationStatus`，位姿照发 | 高 |
| L9 | `ndt_localization.cc:386-393` vs `rtk_localization.cc:214-231` | 状态白名单不一致：报 `NARROW_INT(50)` 的设备在 NDT 下**永远 ERROR** | 高 |
| U3 | `lidar_locator_ndt.h:140`、`.cc:255-257` | `location_covariance_` **从未赋值**，但 `GetLocationCovariance()` 对外返回它 | 高 |
| U7 | `lidar_locator_ndt.cc:146 vs :241` | `bool map_is_ready` 声明在 `#ifdef USE_PRELOAD_MAP_NODE` 内、使用在块外 → 去掉这个 define **直接编译不过** | 高 |
| X11/X12 | `ndt_localization.cc:482,505`；`ndt_localization.h:120` | `LidarMsgTransfer` 只检查 `isnan(x)`（y/z 的 NaN 会进点云）；`max_height_=100.0` 是雷达系绝对高度，基本等于不过滤 | 高 |
| T5 | `localization_pose_buffer.cc:41,67` | 收了 `timestamp` 参数**完全不用**，20 帧偏差一律等权 → 10 Hz 下相当于 2 秒无衰减平滑 | 高 |
| T6/T7 | `gnss_compensator.cc:38`；只有 `msf_localization_component.cc:152-155` 用了它 | `uint64_t` 减法在系统时钟回退时**下溢** → 必然大于 tolerance 从而错误触发补偿；且 RTK/NDT 都没接它，GNSS 时间卡住时 TF 会有重复时间戳（tf2 可能拒收） | 高 |
| T8 | `modules/transform/buffer.cc:168-180` | `lookupTransform` 的 `timeout_second` 形参**完全没用** | 高 |
| T9 | `ndt_localization.cc:345-354` vs `ndt_localization_component.cc:132-154` | `QueryPoseFromTF` 查的 `/tf` 是 NDT 自己发的（三方案互斥，永远拿不到别人的）→ 隐式反馈环 | 中 |
| L12/L13 | `ndt_solver.hpp:107`；`rtk_localization.cc:334,476`、`ndt_localization.cc:603` | `GetFitnessScore` 每次调用都重建 KdTree；三个 Find* 函数每次**整表深拷贝 std::list**（100 Hz × N 个 protobuf） | 高（性能） |
| L14 | `lidar_locator_ndt.cc:470`（硬编码 6）vs `ndt_voxel_grid_covariance.h:125`（有 setter） | `min_points_per_voxel` 两处且不一致 | 高 |
| L15 | `ndt_locator/BUILD:32-34`；`lidar_locator_ndt_test.cc:37,39` | `filegroup(test_data)` 的 glob 路径写错（应为 `../test_data/**`）→ filegroup 是空的；配合测试里硬编码的 `/apollo/...` 绝对路径 → 两个 NDT 测试只在容器里能跑 | 高 |
| L18 | `transform_broadcaster.cc:38-43` vs `static_transform_component.cc:104` | 动态版 `SendTransform` 不填 `TransformStampeds` 自己的 header（静态版调了 `FillHeader`） | 高 |
| X5/X6 | `rtk_localization_component.cc:123-155,191-199` | `CompensateImuLocalizationExtrinsic` 不更新 `pose.orientation`；TF 用"补偿后 translation + 未补偿 rotation" | 高 |
| L16 | 各处 | 拼写错误（grep 时注意）：`proj_reslution_`（少 o）、`SetOulierRatio`（少 t）、`lidar_map_coverage_theshold`（少 r）、`WARNNING`（多 N）、`online_visualizer_compenont.so`（compenont）、`cahceL2_size`、`coordnate_type` | 高 |

**RTK 的并发处理是正确的**（`rtk_localization.cc:58,70,97,108`：跨线程的 `imu_list_`/`gps_status_list_` 有锁，其余都在 Proc 线程）。NDT 上车前必须先补锁。

## 7. 死代码与死配置清单（"改了为什么没效果"）

**死配置文件**：`conf/msf_localization.pb.txt`（10 字段全死，且 `bestgnsspos_topic`/`lidar_localization_topic`/`gnss_localization_topic` 在任何 proto 里都没定义 → 文件根本 parse 不出来）、`conf/localization_config.pb.txt`、`conf/navi_localization_config.pb.txt`（`grep LocalizationConfig` 0 命中，改 `localization_type` 不切方案）。

**死 flag**：上文 §2 的 11 个从未被读取的 flag；`localization.conf:2` 的 `--noenable_gps_imu_interprolate`；`:50` 的 `--lidar_imu_lidar_max_delay_time`（名字拼错）；`:100` 的 `--eph_buffer_path=""`（带引号）；`rtk_localization.pb.txt:4` 的 `gps_topic`。

**死代码目录**：`msf/local_map/`（运行时死代码，活的是 `local_pyramid_map/`；编译期定死，无 flag 可切）。

**死函数 / 死变量**：
- `LocalizationIntegProcess::LoadGnssAntennaExtrinsic`（`localization_integ_process.cc:365-383`）**无任何调用者**。
- `LocalizationIntegImpl::Init` 里的 `gnss_antenna_extrinsic_`（`:76-89`）**只打日志，无用副本**。
- `localization_params.h:96` 的 `vehicle_to_imu_quatern` 永无赋值。
- `ant_imu_leverarm.yaml` 的 `uncertainty` 三值读进结构体后从未使用。
- `LidarHeight::height_var`（`localization_lidar_process.h:59-63`）读了不用。
- `LidarLocatorNdt::location_covariance_` 从未赋值但对外返回。
- `LidarLocatorNdt` 的 `lidar_height_` / `pre_imu_height_` 被设置和更新但从不参与计算（`lidar_locator_ndt.cc:43,57,114,239`）。
- `LocalizationLidar::GetLocalizationDistribution`（`localization_lidar.cc:206-223`）已实现但**无调用者**（想加匹配分布可视化直接用它）。
- `base_map_node.cc:222` 的 `header_buf` 分配后完全没用到。
- `proto/measure.proto` 与 `proto/sins_pva.proto` 在 `local_integ` 里完全没被使用（ROS 时代遗留；`sins_pva.proto:22` 的 `pva_covar` 无人使用）。
- `params/imu_localization_extrinsics.yaml` / `novatel_localization_extrinsics.yaml` 全仓无引用。
- `base_map_config` 的 `map_is_compression_`（B2）、pyramid 的 `altitude_var` 平面（C7）、`body_md5_`（B1）、`base_map_pool` 的 `thread_size`（F12）。
- `lossless_map_creator.cc:150-162` 的 resolution 校验（A9）；`base_map.cc:149` 的 `AERROR "Preload map node failed!"`（无条件打印的复制粘贴残留，忽略它）。
- `README.md:57-62` 把两个死配置列为有效配置；`:79-95` 的 `LocalizationBase` 扩展指南**整段过期**（`README_cn.md:69-80` 同）。

## 8. 日志锚点速查

**⚠️ 关键诊断信息用 `std::cerr` 不进 glog** —— 排查时必须同时看 stderr，只看 `/apollo/data/log/localization.INFO` 会漏掉最重要的 cache miss 与 index 越界。

| 日志 | 位置 | 含义 |
|---|---|---|
| `"map: <path>"` | `msf_localization.cc:76` | 地图目录，**第一个要看的** |
| `"utm zone id: N"` | `msf_localization.cc:89` | zone_id 最终取值 |
| `"lidar_extrin: "` / `"lidar_height: "` | `msf_localization.cc:77,78` | 外参与高度文件路径 |
| `"Ant imu lever arm file: "` | `msf_localization.cc:142` | 下一行的 `ACHECK` 失败会 abort |
| `LOG(FATAL) "Reflectance map folder is invalid!"` | `localization_lidar.cc:62` | config.xml 不存在 |
| `"Reflectance locator map first loading is done."` | `localization_lidar.cc:126` | 首帧地图加载完成 |
| `AINFO "Created map node: "` | `base_map.cc:245` | **磁盘无此 node，创建了空的** ← 地图缺块信号 |
| `AINFO "Loaded map node: "` | `base_map.cc:247` | node 加载成功 |
| `std::cerr` L1+L2 双 miss | `base_map.cc:86-87` | **不进 glog** |
| `std::cerr` 整批放弃 | `base_map.cc:124-127` | **不进 glog** |
| `std::cerr` index 越界 | `base_map_node_index.cc:88-89` | **静默返回 (0,0)** ← 地图范围配错 |
| `AINFO "Unknown map version!"` | `pyramid_map_matrix_handler.cc:47` | 版本字符串非法，即将崩 |
| `AERROR "Preload map node failed!"` | `base_map.cc:149` | **无条件打印，忽略它** |
| `"SINS is aligning!"` | `localization_integ_process.cc:144` | NOT_INIT，每 0.5 s 一条 |
| `"SINS has completed alignment!"` | `localization_integ_process.cc:138` | NOT_STABLE，正在等 3000 帧≈30 s |
| `"Started measure data process thread"` | `localization_integ_process.cc:294` | 无此条 = 量测线程没起来 |
| `"<N> measure are waiting to process."` | `localization_integ_process.cc:320` | 量测积压（N > 37） |
| `"the imu time is error"` | `localization_integ_process.cc:88` | 时间戳 <3000，转换错了 |
| `"gnss and imu lever arm: x y z"` | `localization_integ_process.cc:67-70` + `localization_integ_impl.cc:86-89` | 会打两次（后者无用） |
| `"gnss and imu lever arm in vehicle/imu frame"` | `measure_republish_process.cc:70-77,116-123` | 两条数值应相同（因 DCM=I） |
| `"the gnss solution_status and position_type: S T"` | `measure_republish_process.cc:706-707` | 每帧都打，T ∈{0,1,2} 会被丢 |
| `"the position std is large: x y"` | `measure_republish_process.cc:694-696` | std >5 m 被丢（只在未对齐时查） |
| `"Waiting calculate velocity successfully..."` | `measure_republish_process.cc:164` | **卡对齐的关键信号** |
| `"novatel bestgnsspos delta yaw is large!"` | `measure_republish_process.cc:521-524` | yaw 抖动 >5° 被丢（静止时常见） |
| `"IntegratedLocalization Debug Log: integ_pose msg"` | `localization_integ_process.cc:181-192` | ADEBUG，角度已转度 |
| `"IntegratedLocalization Debug Log: measure data"` | `localization_integ_process.cc:348-360` | ADEBUG，含 measure type。**与上一条对齐看是最有效的一招** |
| `"MeasureDataRepublish Debug Log: bestgnsspos msg"` | `measure_republish_process.cc:170-179` | ADEBUG，x/y 已转度可直接与真值比 |
| `"Lidar msg too old!"` | `localization_lidar_process.cc:282-285` | 延迟 >0.4 s |
| `"Receive a lidar msg, but can't query predict pose"` | `localization_lidar_process.cc:311-312` | `PoseForcast` 拒绝 |
| `"LocalizationLidar Fatal Error: invalid pose!"` | `localization_lidar_process.cc:318` | 坑 M4 的 `\|\|` 误杀 |
| `"Reinit lidar localization due to big covariance"` | `localization_lidar_process.cc:382` | 连续 2 帧 BAD |
| `"The delta translation input lidar localization"` | `localization_lidar_process.cc:332-335` | 每帧预测增量，**判断 IMU 递推是否合理** |
| `"the localization processing time enlonged more than 2 times"` | `msf_localization_component.cc:180-184` | 相邻输出 >20 ms |

打开 ADEBUG：在 `localization.conf` 所在的 flagfile 链里加 `--v=4 --minloglevel=0`，或用 `--alsologtostderr`。
