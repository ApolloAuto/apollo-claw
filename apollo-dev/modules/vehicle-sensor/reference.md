# reference.md —— canbus_vehicle 与 drivers 长知识

## 1. 11 个车型能力矩阵

注册类名 = `load_vehicle_class_name` 的取值，.so 名 = `lib<车型>_vehicle_factory_lib.so`。

| 车型目录 | 车/厂商 | protocol .cc | 注册类名 |
| --- | --- | --- | --- |
| `lincoln` | Lincoln MKZ（Dataspeed DBW） | 23 | `LincolnVehicleFactory` |
| `lexus` | Lexus RX（Dataspeed/AStuff） | 56 | `LexusVehicleFactory` |
| `gem` | Polaris GEM | 30 | `GemVehicleFactory` |
| `neolix_edu` | 新石器 Neolix EDU 配送车 | 21 | `Neolix_eduVehicleFactory` |
| `devkit` | Apollo 开发者套件小车 | 22 | `DevkitVehicleFactory` |
| `ch` | Coolhigh（酷黑）线控底盘 | 20 | `ChVehicleFactory` |
| `ge3` | 威马 GE3 / EX5 | 16 | `Ge3VehicleFactory` |
| `wey` | 长城 WEY VV6 | 14 | `WeyVehicleFactory` |
| `demo` | **官方新车型模板骨架** | 22 | `DemoVehicleFactory` |
| `transit` | Ford Transit Connect（AStuff） | 12 | `TransitVehicleFactory` |
| `zhongyun` | 中云智车低速电动车 | 9 | `ZhongyunVehicleFactory` |

差异点矩阵：

| 车型 | STEER_ONLY / SPEED_ONLY | 转向单位 | Acceleration 直发 | Brake/Throttle | EPB | 校验/心跳 |
| --- | --- | --- | --- | --- | --- | --- |
| `lincoln` | 均支持（带 CheckResponse） | % → deg | 空实现 | 踏板 % | 无 | watchdog 字段存在但不自增 |
| `lexus` | 均完整支持 | % → deg | stub | 踏板 % | 有 (`parking_brake_cmd_124`) | — |
| `gem` | 声明有但 **stub**（`gem_controller.cc:336` 直接 return OK），CheckResponse 恒 true | % → deg | 空 | 踏板 % | 仅状态回读 | — |
| `neolix_edu` | 声明有但**不做 CheckResponse** | % → deg | 空 | brake=踏板 / **throttle=扭矩(pedal/2)** | — | 诊断报文 0x628 |
| `devkit` | **不支持，`AFATAL`**（`devkit_controller.cc:524`/`:535`） | % → deg，±500，角速度固定 250deg/s | 空 | 踏板 % | 有 (`park_command_104`) | **XOR checksum + heartbeat**（0x102） |
| `ch` | **不支持，`AFATAL`**（`ch_controller.cc:396`/`:401`） | **% → rad**（`ch_controller.cc:477` 无度换算） | 空 | 踏板 **int**（1% 精度） | 无 | — |
| `ge3` | 均支持（带 CheckResponse） | % → deg | 空 | 踏板 %（`pc_bcs_202`/`pc_vcu_205`） | 有 (`pc_epb_203`) | — |
| `wey` | 均支持（带 CheckResponse） | % → deg，固定 ±500 | **有**（`wey_controller.cc:604-617`） | **都是空实现** | — | — |
| `transit` | STEER_ONLY 不查应答，SPEED_ONLY 查 | % → deg | 空 | 踏板，但**依赖物理按钮** `button_pressed_`（`transit_controller.cc:276`） | — | limits 报文 0x012 |
| `zhongyun` | 均支持（`zhongyun_controller.cc:353` log 文案写错） | % → deg | 空 | **扭矩**（`torque_control_a3`/`brake_control_a4`） | 有 (`parking_control_a5`) | — |
| `demo` | 骨架，直接 return OK | % → deg（同 devkit） | 空 | 踏板 % | 骨架 | 有（同 devkit） |

**抄谁**：要标准且完整 → `devkit`；要最简骨架 → `demo`；要复杂 chassis 填充范例 → `lincoln`；要全量灯光/雨刷 → `lexus`。
**别抄**：`gem`（CheckResponse 与半自动模式都是 stub）、`wey`（Brake/Throttle 空实现）、`transit`（依赖物理按钮）、`ch`（转向单位弧度，与其它车型差 57 倍）。

`demo` 是官方骨架的证据：`cyberfile.xml:4` 描述 `Dynamic loading for canbus demo vehicle module`；`demo_controller.cc` 里散布 `/* ADD YOUR OWN CAR CHASSIS OPERATION */` 占位块（`:278`、`:342`、`:379`、`:478`、`:491`、`:553`、`:582`、`:598`、`:608`、`:624`）；`CheckVin()` 直接 return false（`:581`）、`CheckChassisError()` 直接 return false（`:618`）；报文与 CAN ID 与 devkit 完全一致（22 个，0x100-0x105 发送 / 0x500-0x516 接收）。

## 2. 各车型报文清单（速查）

| 车型 | 发送报文 | 接收报文 |
| --- | --- | --- |
| `lincoln` | brake_60, throttle_62, steering_64, gear_66, turnsignal_68 | brake_61, throttle_63, steering_65, gear_67, misc_69, wheelspeed_6a, accel_6b, gyro_6c, gps_6d/6e/6f, tirepressure_71, fuellevel_72, surround_73, brakeinfo_74, throttleinfo_75, license_7e, version_7f |
| `devkit`/`demo` | throttle_command_100, brake_command_101, steering_command_102, gear_command_103, park_command_104, vehicle_mode_command_105 | throttle_report_500, brake_report_501, steering_report_502, gear_report_503, park_report_504, vcu_report_505, wheelspeed_report_506, ultr_sensor_1..5_507-511, bms_report_512, vin_resp1/2/3_514-516 |
| `ch` | throttle_command_110, brake_command_111, steer_command_112, turnsignal_command_113, gear_command_114, control_command_115(废弃), vehicle_mode_command_116 | throttle_status__510, brake_status__511, steer_status__512, turnsignal_status__513, gear_status_514, ecu_status_1..4_515-518, vin_resp1/2/3_51b-51d, wheelspeed_report_51e |
| `lexus` | accel_cmd_100, brake_cmd_104, cruise_control_buttons_cmd_108, dash_controls_left_cmd_10c, hazard_lights_cmd_114, headlight_cmd_118, horn_cmd_11c, media_controls_cmd_120, parking_brake_cmd_124, shift_cmd_128, steering_cmd_12c, turn_cmd_130, wiper_cmd_134 | 43 个 rpt：global_rpt_10, component_rpt_20, accel_rpt_200, brake_rpt_204, steering_rpt_22c, shift_rpt_228, turn_rpt_230, wiper_rpt_234, *_aux_rpt_3xx, brake/steering_motor_rpt_1..3_401-406, wheel_speed_rpt_407, yaw_rate_rpt_40d, lat_lon_heading_rpt_40e, date_time_rpt_40f, detected_object_rpt_411, veh_dynamics_rpt_413, vin_rpt_414, door_rpt_417, vehicle_speed_rpt_400 等 |
| `gem` | turn_cmd_63, shift_cmd_65, accel_cmd_67, global_cmd_69, brake_cmd_6b, steering_cmd_6d, headlight_cmd_76, horn_cmd_78, wiper_cmd_90 | turn_rpt_64, shift_rpt_66, accel_rpt_68, global_rpt_6a, brake_rpt_6c, steering_rpt_1_6e, vehicle_speed_rpt_6f, brake_motor_rpt_1..3_70-72, steering_motor_rpt_1..3_73-75, headlight_rpt_77, horn_rpt_79, wheel_speed_rpt_7a, parking_brake_status_rpt_80, yaw_rate_rpt_81, lat_lon_heading_rpt_82, date_time_rpt_83, wiper_rpt_91 |
| `neolix_edu` | ads_brake_command_46, ads_drive_command_50, ads_eps_command_56, ads_light_horn_command_310, ads_diagnosis_628 | aeb_systemstate_11, vcu_brake_report_47, vcu_drive_report_52, vcu_eps_report_57, vcu_vehicle_status_report_101, vcu_vehicle_fault_response_201, vcu_powerstatus_214, pas_1st/2nd_data_311/312, aeb_frontwheelspeed_353, aeb_rearwheelspeed_354, aeb_wheelimpulse_355, vcu_nm_401, vcu_vehicle_info_response_502, aeb_diagnosis1_626, aeb_diagresp_718 |
| `ge3` | pc_bcm_201, pc_bcs_202, pc_epb_203, pc_eps_204, pc_vcu_205 | scu_1_301, scu_2_302, scu_3_303, scu_bcm_304, scu_bcs_1..3_306-308, scu_epb_310, scu_eps_311, scu_vcu_1_312, scu_vcu_2_313 |
| `wey` | ads1_111, ads_eps_113, ads_shifter_115, ads3_38e, ads_req_vin_390 | fbs4_235, fbs3_237, fbs2_240, fail_241, fbs1_243, status_310, vin_resp1/2/3_391-393 |
| `transit` | adc_motioncontrol1_10, adc_motioncontrollimits1_12, adc_auxiliarycontrol_110 | llc_motionfeedback1_20, llc_motionfeedback2_21, llc_motioncommandfeedback1_22, llc_vehiclelimits_24, llc_vehiclestatus_25, llc_auxiliaryfeedback_120, llc_diag_fault_620, llc_diag_brakecontrol_721, llc_diag_steeringcontrol_722 |
| `zhongyun` | gear_control_a1, steering_control_a2, torque_control_a3, brake_control_a4, parking_control_a5 | vehicle_state_feedback_c1, enable_state_feedback_c3, vehicle_state_feedback_2_c4, error_state_e1 |

## 3. 报文类基类接口与位域解析写法

**`ProtocolData<SensorType>`**（`modules/drivers/canbus/can_comm/protocol_data.h:43-108`）

- `GetPeriod()` `:68`，默认 100ms（`:133`），返回**微秒**
- `GetLength()` 默认 `CANBUS_MESSAGE_LENGTH`=8（`canbus_consts.h:37`）
- `Parse(bytes, len, SensorType*)` `:82`（接收报文重写）
- `UpdateData(uint8_t*)` `:88` / `UpdateData_Heartbeat(uint8_t*)` `:93`（发送报文重写）
- `Reset()` `:98`
- 静态工具 `CalculateCheckSum(input, len)` = `sum ^ 0xFF`（`:127-130`）；`BoundedValue(lower, upper, val)` `:104`/`:112` —— **`lower > upper` 时原样返回，不报错，限幅静默失效**。

**`Byte`**（`modules/drivers/canbus/common/byte.h:39-175`）—— 协议类里做位操作的唯一工具，构造接收 `uint8_t*` 且**持有指针原地改**：`set_bit_1(pos)` `:86`、`set_bit_0(pos)` `:92`、`is_bit_1(pos)` `:99`、`set_value(value)` `:105`、`set_value_high_4_bits` `:113`、`set_value_low_4_bits` `:121`、`set_value(value, start_pos, length)` `:131`、`get_byte()` `:138`、`get_byte_high_4_bits` `:144`、`get_byte_low_4_bits` `:150`、`get_byte(start_pos, length)` `:159`。

**缩放 + 小端拆字节写入**（`lincoln/protocol/brake_60.cc:82-98` 的 `set_pedal_p`）：

```cpp
pedal /= 100.;                                  // % → [0,1]
pedal = ProtocolData::BoundedValue(0.0, 1.0, pedal);
int32_t x = static_cast<int32_t>(pedal / 1.52590218966964e-05);  // 除 precision
Byte frame_low(data + 0);  frame_low.set_value(x & 0xFF, 0, 8);  // 低字节在 byte0 = intel/小端
x >>= 8;
Byte frame_high(data + 1); frame_high.set_value(x & 0xFF, 0, 8);
```

**带 offset 的有符号量用无符号编码 + 大端**（`devkit/protocol/steering_command_102.cc:95-110`）：物理范围 [-500,500]，offset=-500：`int x = (target - -500.0)` 平移到 [0,1000]，`data+3` 放高字节、`data+4` 放低字节 = motorola/大端。

**有符号量解码**（`lincoln/protocol/steering_65.cc:81-92`）：

```cpp
int32_t value = (high << 8) | low;
if (value > 0x8000) { value = value - 0x10000; }   // 手工二补数还原，严格应为 >=
return value * 0.100000;                            // 乘 precision
```

一条报文可喂多个 proto 子结构：`steering_65.cc:46-49` 同时写 `mutable_eps()` 与 `mutable_vehicle_spd()`（注释说 speed from steering 精度更高），`:68-69` 还写 `mutable_check_response()->set_is_eps_online(...)` —— **`check_response` 是 CheckResponse 机制的数据源**。

发送报文也可实现 `Parse`（`steering_command_102.cc:38-48` 写回 `mutable_steering_command_102()`），这是 `PublishChassisDetailSender()` 能回显发送侧内容的原理（走 `MessageManager::ParseSender`）。

## 4. VehicleController 基类完整接口

`modules/canbus/vehicle/vehicle_controller.h:59-227`，模板参数 `SensorType` 即车型 proto（如 `apollo::canbus::Lincoln`）。

public 虚函数：

| 成员 | 行 | 说明 |
| --- | --- | --- |
| `Init(params, can_sender, message_manager)` | `:70` | 纯虚 |
| `Start()` / `Stop()` | `:78` / `:83` | 纯虚 |
| `chassis()` | `:89` | 纯虚，填 `Chassis` |
| `Update(const ControlCommand&)` | `:96` | **基类已实现**（`:406-492`）：pad_msg 模式切换含 `VIN_REQ`（`:426` 调 `VerifyID`）、按模式分发 Gear/Throttle/Acceleration/Speed/Brake/SetEpbBreak/SetLimits（`:462-471`）、Steer（`:473-481`，`steering_rate > 1.0` 才用双参版本）、灯光（`:483-489`） |
| `Update(const ChassisCommand&)` | `:97` | **基类已实现**（`:495-518`）：basic_signal 灯光 + `HandleCustomOperation`（`:511`） |
| `SetDrivingMode(mode)` | `:105` | **基类已实现**（`:349-403`）：EMERGENCY_MODE 不可主动进入，进入后只响应 COMPLETE_MANUAL（`:351-363`） |
| `CheckChassisCommunicationError()` | `:108` | **基类已实现**（`:234-295`）：`sensor_check_recv_data_` 连续 >100 次（`:280`，≈1s）ByteSizeLong<2 判失联，触发 `ClearSensorCheckRecvData()` + `ResetSendMessages()`（`:286-287`） |
| `AddSendMessage()` | `:110` | |
| `GetNewRecvChassisDetail()` / `GetNewSenderChassisDetail()` | `:112` / `:114` | 取快照 |
| `driving_mode()` | `:116` | `mode_mutex_` 保护 |

private 纯虚（车型必须实现的动作原语）：`Emergency` `:123`、`EnableAutoMode` `:125`、`DisableAutoMode` `:126`、`EnableSteeringOnlyMode` `:127`、`EnableSpeedOnlyMode` `:128`、`Gear(GearPosition)` `:133`、`Brake(double)` `:139`、`Throttle(double)` `:144`、`Acceleration(double)` `:150`、`Steer(angle)` `:161`、`Steer(angle, angle_spd)` `:167`、`SetEpbBreak(cmd)` `:172`、`HandleCustomOperation(cmd)` `:178`、`SetBeam` `:190`、`SetHorn` `:191`、`SetTurningSignal` `:192`、`VerifyID` `:205`。

private 虚但有默认实现：`Speed(double)` `:155`（空）、`SetLimits()` `:173`（空）、`HandleVehicleSignal(signal)` `:184-188`（按 has_ 字段分发到 SetBeam/SetHorn/SetTurningSignal）、`ProcessCommandChange(signal, last)` `:198`（实现 `:521-558`，灯光信号**边沿触发**去重）、`set_driving_mode(mode)` `:208`。

**`AbstractVehicleFactory`**（`modules/canbus/vehicle/abstract_vehicle_factory.h:47-133`）纯虚：`Init` `:63`、`Start` `:69`、`Stop` `:74`、`UpdateCommand(ControlCommand*)` `:79`、`UpdateCommand(ChassisCommand*)` `:84`、`publish_chassis` `:89`、`PublishChassisDetail` `:94`。有默认实现（可选覆写，默认体见 `abstract_vehicle_factory.cc:22-36`）：`PublishChassisDetailSender` `:99`、`UpdateHeartbeat` `:104`、`CheckChassisCommunicationFault` `:109`（默认 return false）、`AddSendProtocol` `:114`、`ClearSendProtocol` `:119`、`IsSendProtocolClear` `:124`、`Driving_Mode` `:129`（默认 return `COMPLETE_MANUAL`）。注册宏 `:135-136`。

**`CanSender<T>`**（`modules/drivers/canbus/can_comm/can_sender.h`）：`AddMessage(id, protocol_data, init_with_one)` `:169`/`:388`；`ClearMessage()` `:172` / `IsMessageClear()` `:174`（`CanbusComponent::ProcessTimeoutByClearCanSender`，`canbus_component.cc:349` 靠它做"指令超时即停发"）；`Update()` `:185` / `Update_Heartbeat()` `:190` 强制刷帧；发送线程设 `SCHED_FIFO` 优先级 99（`:309`）。

**`MessageManager<T>`**（`modules/drivers/canbus/can_comm/message_manager.h:68-435`）：五份快照 `sensor_data_`（全量）、`sensor_recv_data_`、`sensor_check_recv_data_`、`sensor_sender_data_`、`sensor_check_sender_data_`（带 `check_` 的两份专供超时检测，被读走即清零，`ClearSensorCheckRecvData()` `:100`）；`GetMutableProtocolDataById(id)` `:111`/`:227`（**返回 nullptr 需判空**）；`ResetSendMessages()` `:153`；`AddRecvProtocolData<P, need_check>()` `:157`/`:191`、`AddSendProtocolData<P, need_check>()` `:160`/`:209`。

**CAN 帧长度上限**（`modules/drivers/canbus/common/canbus_consts.h`）：`MAX_CAN_SEND_FRAME_LEN = 1` `:34`、`MAX_CAN_RECV_FRAME_LEN = 10` `:35`、`CANBUS_MESSAGE_LENGTH = 8` `:37`。

**canbus 关键 gflags**（`modules/canbus/common/canbus_gflags.cc`）：`chassis_freq=100` `:29`、`min_cmd_interval=5`(ms) `:32`、`pad_msg_delay_interval=3`(s) `:33-34`、`max_control_miss_num=5` `:35`、`control_period=0.01` `:36`、`max_guardian_miss_num=5` `:37`、`use_control_cmd_check=false` `:39`、`use_guardian_cmd_check=false` `:40`、`estop_brake=30.0` `:41`、`enable_chassis_detail_pub=true` `:44`、`enable_aeb=false` `:71`、`chassis_debug_mode=false` `:74`、`load_vehicle_library` `:73-77`、`load_vehicle_class_name` `:77-78`。

## 5. drivers 全驱动清单

### 5.1 lidar（8 厂商 + 3 后处理）

| 驱动 | 支持型号 | Component 类 | 输出 channel（示例） | 关键 conf |
| --- | --- | --- | --- | --- |
| `velodyne/driver` | VLP16 / HDL32E / VLP32C / HDL64E_S2/S3S/S3D / VLS128（`lidar/proto/velodyne.proto:7-16`） | `VelodyneDriverComponent`（`velodyne/driver/velodyne_driver_component.h:37`） | `/apollo/sensor/velodyne64/VelodyneScan` | `velodyne/conf/velodyne{64,128,32,_vlp32c}_conf.pb.txt`、`velodyne16_{front_up,front_center,rear_left,rear_right,up_center}_conf.pb.txt` |
| `velodyne/parser` | 同上 | `VelodyneConvertComponent`（`velodyne/parser/velodyne_convert_component.h:42`） | `/apollo/sensor/velodyne64/PointCloud2` | 同上；线序/发火表在 `velodyne/params/` |
| `velodyne/compensator` | — | `CompensatorComponent` | `/apollo/sensor/velodyne64/compensator/PointCloud2` | `velodyne64_compensator.pb.txt` |
| `velodyne/fusion` | — | `PriSecFusionComponent`（`velodyne/fusion/pri_sec_fusion_component.h:46`） | 融合点云 | `velodyne_fusion_conf.pb.txt` |
| `hslidar` | 禾赛 AT128/AT128E2X/E3X、Pandar40/64/90/128、PandarXT/XT16/XT32/XT32M2X、PandarQT/QT128C2X、OT128、ET25、FT120 | `HesaiComponent2`（`hslidar/driver/hesai_component.h:33`） | `/apollo/sensor/hesaiAT128/Scan`、`.../PointCloud2` | `hslidar/conf/hslidar.pb.txt`：`lidar_type:33`、`correction_file_path:14`、`firetimes_path:15` |
| `rslidar` | 速腾 RS16/RS32/RS80/RS128/RSBP/RSHELIOS/RSHELIOS_16P/RSM1 | `RslidarComponent`（`rslidar/driver/rslidar_component.h:42`） | `/apollo/sensor/rslidar/up/Scan`、`.../PointCloud2` | `rslidar/conf/rslidar.pb.txt`：`model:11`、`ip:12`、`msop_port:13`、`difop_port:14`、`use_lidar_clock:23`、`ts_first_point:25` |
| `livox` | 大疆 Mid-360（SDK 支持全系） | `LivoxLidarComponent`（`livox/component/livox_component.h:37`） | `/apollo/sensor/livox/up/Scan`、`.../PointCloud2` | `livox/conf/livox.pb.txt` + `mid360_config.json`（`lidar_config_file_path:10`、`use_lidar_clock:12`、`lidar_ip:14`） |
| `lslidar` | 镭神 LS16P/32P、CH16/CH32/CH64/CH64w/CH120/CH128/CH128X1、C1/C8/C16/C32_V4、LS128S2（`lslidar/proto/lslidar.proto:9-26`） | `LslidarComponent`（`lslidar/component/lslidar_component.h:33`） | `/apollo/sensor/lslidar16/Scan`、`.../PointCloud2` | `lslidar/conf/lslidar{16,32,CH16,CH32,CH64,CH120,CH128,LS128S2,1v4}_conf.pb.txt` |
| `seyond` | 览沃（原 Innovusion）Falcon / Robin | `SeyondComponent`（`seyond/src/seyond_component.h:32`） | `/apollo/sensor/seyond/Scan`、`.../PointCloud2` | `seyond/conf/seyond.pb.txt` |
| `vanjeelidar` | 万集 vanjee_720_16 / vanjee_720_32 | `VanjeelidarComponent`（`vanjeelidar/src/vanjeelidar_component.h:42`） | `/apollo/sensor/vanjeelidar/Scan`、`.../PointCloud2` | `vanjeelidar/conf/vanjeelidar.pb.txt` |
| `lidar/compensator` | — | `CompensatorComponent` | `/apollo/sensor/lidar/compensator/PointCloud2` | `compensator/conf/compensator.pb.txt`（`world_frame_id:1`、`transform_query_timeout:2`=0.02、`output_channel:3`） |
| `lidar/fusion` | — | `PriSecFusionComponent` | `/apollo/sensor/lidar/fusion/PointCloud2` | `fusion/conf/fusion_conf.pb.txt` |
| `lidar_fusion_and_compensator` | — | `FusionAndCompensatorComponent` | `/apollo/sensor/lidar16/compensator/PointCloud2` | `conf/config.pb.txt`：`max_interval_ms:1`、`input_channel[]:3-6`、`wait_time_s:8`、`transform_query_timeout:10`、`rotation_compensation:12`、可选 `filter_config{frame_id, max/min_x/y}` |
| `lidar_driver_component.cc`（旧） | 只注册 VELODYNE | `LidarDriverComponent` | — | **已废弃，新驱动别加** |

### 5.2 camera / video / 双目 / 麦克风 / 图像工具

| 驱动 | 硬件 | Component 类 | 输出 channel | 关键 conf |
| --- | --- | --- | --- | --- |
| `camera` | USB/V4L2 | `CameraComponent`（`camera/camera_component.h:34`） | `/apollo/sensor/camera/front_6mm/image` + `.../raw/image` | `camera/conf/camera_front_{6mm,12mm,fisheye}.pb.txt`、`camera_{left,right}_{front,rear,fisheye}.pb.txt`、`camera_rear_6mm.pb.txt` |
| `camera` 压缩 | — | `CompressComponent`（`camera/compress_component.h:38`） | `.../image/compressed` | conf 的 `compress_conf` 段；dag 分 `compress.dag`(x86 订 `/image`) / `compress_arm.dag`(arm 订 `/raw/image`) |
| `video` | 网络相机硬件 H.265，UDP 推流 | `CompCameraH265Compressed`（`video/video_driver_component.h:38`） | `.../image/compressed`，`format="h265"` | `video/conf/video_{front_6mm,front_12mm,front_fisheye,left/right_fisheye,left/right_front,left/right_rear,rear_6mm}.pb.txt` |
| `smartereye` | SmarterEye 双目，**IP 硬编码 192.168.1.251**（`smartereye/smartereye_device.cc:35`） | `SmartereyeComponent` + `CompressComponent` | `/apollo/sensor/smartereye/image`、`FLAGS_smartereye_obstacles_topic`、`FLAGS_smartereye_lanemark_topic` | `smartereye/conf/smartereye.pb.txt` |
| `microphone` | ReSpeaker 阵列（PortAudio），**靠设备名匹配 "ReSpeaker"**（`microphone/respeaker.cc:110-124`） | `MicrophoneComponent` | `/apollo/sensor/microphone` | `microphone/conf/respeaker.pb.txt` |
| `tools/image_decompress` | — | `ImageDecompressComponent` | conf 的 `channel_name` | `tools/image_decompress/conf/*.pb.txt`（15 份，与 camera 对应） |

### 5.3 radar（5 款）

| 驱动 | 硬件 | 连接 | 输出 channel | 关键 conf |
| --- | --- | --- | --- | --- |
| `conti_radar` | Continental ARS408-21 / ARS304 | CAN（HERMES/ESD） | `/apollo/sensor/radar/front`、`/apollo/sensor/radar/rear`（conf `radar_channel`） | `conf/radar_front_conf.pb.txt`：`can_conf{can_card_parameter{brand,type,channel_id}}:1-11`、`radar_conf{...}:13-38`、`radar_channel:40`。一个 dag 同起前后两实例 |
| `nano_radar` | Continental NanoRadar 24GHz 近距 | CAN（SOCKET_CAN_RAW） | `/apollo/sensor/nanoradar/front` | `conf/nano_radar_front_conf.pb.txt` |
| `racobit_radar` | 瑞可比（协议兼容 ARS408） | CAN（ESD） | `FLAGS_racobit_radar_topic`（**gflags，改 conf 无效**，`racobit_radar_canbus_component.cc:48`） | `conf/racobit_radar_conf.pb.txt` + `racobit_radar.conf` |
| `oculii_radar` | Oculii Eagle 4D 点云雷达 | **UDP 以太网** | `/apollo/sensor/oculii/PointCloud2` | `conf/oculii_radar_conf.pb.txt` 仅 5 行：`frame_rate:1`、`ip:2`(192.168.2.11)、`port:3`(9911)、`frame_id:4`、`channel_name:5` |
| `ultrasonic_radar` | 12 路超声波阵列 | CAN（ESD，CHANNEL_ID_THREE） | `FLAGS_ultrasonic_radar_topic`（**gflags**，`ultrasonic_radar_canbus_component.cc:25`） | `conf/ultrasonic_radar_conf.pb.txt` + `.conf` |

### 5.4 gnss

一个 Component `GnssDriverComponent`（`gnss/gnss_component.h:36`，注册宏 `:46`），dag `gnss/dag/gnss.dag`，conf `gnss/conf/gnss_conf.pb.txt`（`data{format}:1-3`、`rtk_to:39`、`proj4_text:57`、`use_gnss_time:103`）。

已实现的 Parser 只有 5 种（`gnss/parser/parser.h:87-101` 的 `CreateParser` switch）：`NOVATEL_BINARY`、`HUACE_TEXT`、`ASENSING_BINARY`、`ASENSING_CAN`、`BROADGNSS_TEXT`；其余 format 全部 `return nullptr`。

13 个输出 channel（写出点均在 `modules/drivers/gnss/`）：

| channel | 消息类型 | 写出位置 |
| --- | --- | --- |
| `/apollo/sensor/gnss/raw_data` | `RawData` | `stream/raw_stream.cc:509` |
| `/apollo/sensor/gnss/rtcm_data` | `RawData` | `stream/raw_stream.cc:563` |
| `/apollo/sensor/gnss/stream_status` | `StreamStatus` | `stream/raw_stream.cc:195`、`:500` |
| `/apollo/sensor/gnss/best_pose` | `GnssBestPose` | `parser/data_parser.cc:237` |
| `/apollo/sensor/gnss/gnss_status` | `GnssStatus` | `parser/data_parser.cc:161` |
| `/apollo/sensor/gnss/ins_status` | `InsStatus` | `parser/data_parser.cc:146` |
| `/apollo/sensor/gnss/ins_stat` | `InsStat` | `parser/data_parser.cc:225` |
| `/apollo/sensor/gnss/imu` | `Imu` | `parser/data_parser.cc:260` |
| `/apollo/sensor/gnss/corrected_imu` | `CorrectedImu` | `parser/data_parser.cc:333` |
| `/apollo/sensor/gnss/odometry` | `localization::Gps` | `parser/data_parser.cc:302` |
| `/apollo/sensor/gnss/heading` | `Heading` | `parser/data_parser.cc:355` |
| `/apollo/sensor/gnss/rtk_eph` | `GnssEphemeris` | `parser/data_parser.cc:338`、`parser/rtcm_parser.cc:89` |
| `/apollo/sensor/gnss/rtk_obs` | `EpochObservation` | `parser/data_parser.cc:344`、`parser/rtcm_parser.cc:95` |

`tf.enable=true` 时另发 TF（`parser/data_parser.cc:303-307`）。

## 6. 时间戳来源速查

| 驱动 | 采样时间来源 | 关键位置 |
| --- | --- | --- |
| CAN 帧 | `CanFrame::timestamp`（`modules/drivers/canbus/can_client/can_client.h:48-79`）。**只有 HermesCanClient 真填**（`hermes_can_client.cc:177-178`），socket/esd/fake 留 0 | 接收报文的 `Parse(bytes, len, const timeval&, ...)` 重载，如 `lincoln/protocol/steering_65.cc:72-79` |
| velodyne | 优先 GPS/PPS 硬件时间，`GetGpsStamp` 结合 NMEA 定位包（端口 8308）；不可用退化系统时间 | `velodyne/parser/velodyne_parser.cc` |
| 二代 lidar（rslidar/livox/vanjee/seyond） | conf `use_lidar_clock`：true 用雷达内部时钟（需雷达自身 PTP/GPS），false 用主机时间 | 各 conf `use_lidar_clock` |
| rslidar 额外 | `ts_first_point`：帧时间取首点还是末点 | `rslidar/conf/rslidar.pb.txt:25` |
| camera USB | `hardware_trigger=true` 直接用 V4L2 `buf.timestamp`(CLOCK_MONOTONIC)；false 用 MONOTONIC↔REALTIME 差值换算 | `camera/usb_cam.cc:918-936` |
| camera aarch64 | `time_compensator_conf.enable_compensator=true` 读 `compensator_fnode` 拿 rtcpu↔kernel 偏移 | `camera/usb_cam.cc:340-348`、conf `:37-40` |
| video H.265 | 帧头 `ts_sec`/`ts_usec` → `camera_timestamp`；header 用 `Time::Now()` | `video/socket_input.cc:161-167`、`video/video_driver_component.cc:90` |
| smartereye | SDK `RawImageFrame.time` → `measurement_time` | `smartereye/smartereye_component.cc:180-181` |
| radar（CAN 类） | **全部系统时间**，报文无时间字段 | 如 `radar/conti_radar/protocol/object_general_info_60b.cc` Parse 尾部 |
| gnss | `use_gnss_time=true`（默认）GPS 周内秒经 `gps2unix` 转 UNIX；false 用系统时间 | `gnss/util/time_conversion.h:128` |
| image_decompress | 直传上游：优先 `measurement_time`，否则 `header.timestamp_sec` | `tools/image_decompress/image_decompress.cc:42-45` |

三个时间概念：`header.timestamp_sec`（发布时刻）、`header.camera_timestamp` / `measurement_time`（采样时刻，**时间对齐的依据**）、点云逐点 timestamp（compensator 插值依据）。

**精确对齐的实践结论**：相机走硬件触发（`trigger_internal=0` + `adv_trigger_enable`）、雷达开 PTP/GPS（`use_lidar_clock=true`）、GNSS 板卡做时间源；CAN 卡非 HERMES 时拿不到帧时间，只能靠 10ms canbus 周期近似。

## 7. canbus 侧高危坑（22 条）

1. **`load_vehicle_class_name` 错一个字符就整体加载失败**，日志只有 `Failed to create the vehicle factory`（`canbus_component.cc:62`）。注意 `Neolix_eduVehicleFactory` 不规则大小写。`.so` 是**安装后路径** `/opt/apollo/neo/lib/...`，不是源码树。
2. **`canbus.conf` 与 gflags 默认值双份配置**：`canbus_gflags.cc:73-78` 默认也是 lincoln。dag 的 `flag_file_path` 没生效会静默用默认车型。
3. **`BoundedValue(lower, upper, val)` 在 `lower > upper` 时原样返回**（`protocol_data.h:112-115`），传错参不报错，限幅静默失效。
4. **有符号量解码 `> 0x8000` 边界**：全仓库大量使用（`lincoln/protocol/steering_65.cc:86`），严格应为 `>=`，0x8000 最负值会被当成 +32768。
5. **校验和算法各车型不同**：基类 `CalculateCheckSum` 是 `sum ^ 0xFF`（`protocol_data.h:127-130`），devkit `steering_command_102` 用逐字节 XOR（`:50-57`）。必须核对 DBC，不能想当然复用基类。
6. **校验和必须在 UpdateData 最后算**，字段写入顺序颠倒会算出错误校验。
7. **`Brake60::UpdateData` 漏写 `ignore_driver_override_`**（`lincoln/protocol/brake_60.cc:34-40` 只写 5 个字段，`Reset()` `:42-49` 却清 6 个成员）——既有瑕疵，抄的时候容易连带漏字段。
8. **`MAX_CAN_SEND_FRAME_LEN = 1`**（`canbus_consts.h:34`）：CanSender 一次只发一帧，报文多且周期短时发不完，`PowerSendThreadFunc` 打 "sleep_interval < 0" 类 WARN。
9. **CanSender 线程 `SCHED_FIFO` 优先级 99**（`can_sender.h:309`）：容器内无 `CAP_SYS_NICE` 时设置静默失败，发送周期抖动变大。
10. **只有 HERMES_CAN 填 CAN 帧时间戳**：换 SocketCAN 后所有依赖 `Parse(..., const timeval&, ...)` 的字段（如 `timestamp_65`）变 0，进而影响 `steering_timestamp`。
11. **`ESD_CAN` 是条件编译**（`can_client_factory.cc:41-45` 的 `#if USE_ESD_CAN`）：不带 `USE_ESD_CAN` 编译时配 `ESD_CAN` 会让 `CreateCANClient` 返回 nullptr，表现为 Init 失败而非编译错误。
12. **半自动模式不是所有车型都真支持**：devkit/ch 直接 `AFATAL`（进程挂），gem 是空 stub（假成功），neolix_edu 不做应答检查。上层允许切半自动前必须先确认车型。
13. **gem 的 `CheckResponse` 直接 return true**：使能失败也显示成功。
14. **wey 的 `Brake`/`Throttle` 是空实现**（`wey_controller.cc:604-617` 附近），只走 `Acceleration`。control 输出踏板量时车不会动。
15. **transit 需先按物理按钮**（`transit_controller.cc:276` 的 `button_pressed_`），软件层看起来正常但车没反应。
16. **ch 的转向单位是弧度**（`ch_controller.cc:477` 少了 `/M_PI*180`），其它车型都是度，抄过去差 57 倍。
17. **ch 的 Factory 缺 5 个方法**（无 `UpdateHeartbeat`/`AddSendProtocol`/`ClearSendProtocol`/`IsSendProtocolClear`/`Driving_Mode`，`ch_vehicle_factory.h:107` 附近），走基类空实现，`Driving_Mode()` 恒返回 `COMPLETE_MANUAL` —— `CanbusComponent` 的指令超时保护（`canbus_component.cc:260-263` 判驾驶模式）在 ch 上**不会触发**。
18. **`CheckVin` 判据不一致**：devkit 要求恰好 17 字符（`devkit_controller.cc:722`），ch 只要求 `>= 7`（`ch_controller.cc:552`）。VIN 由多条报文拼接，devkit 是逆序排列。
19. **指令超时检查默认关闭**：`use_control_cmd_check` / `use_guardian_cmd_check` 默认 false（`canbus_gflags.cc:39-40`），生产环境需显式打开才有 estop 保护。
20. **`FLAGS_receive_guardian` 与 control 订阅互斥**（`canbus_component.cc:92-118`）：打开 guardian 后 canbus 不再直接订阅 control_command，guardian 没起来则完全没有指令来源。
21. **底盘失联判定是 1 秒**（连续 >100 次 × 10ms，`vehicle_controller.h:280`），判定后 `ResetSendMessages()` 清掉所有发送状态 —— 恢复后需重新使能。
22. **`chassis_detail` proto 是车型私有类型**：换车型后 record 里的 `/apollo/canbus/chassis_detail` 无法用另一车型的代码解析。

## 8. drivers 侧高危坑（24 条）

23. **lidar 的 `LidarDriverComponent` / `LidarDriverFactory` 已废弃**（`lidar/common/driver_factory/lidar_driver_factory.cc:43` 只注册 VELODYNE，其余被注释）。新驱动别往里加。
24. **lidar 型号是字符串匹配**（hslidar `lidar_type`、rslidar `model`）：拼错不报错，表现为解析出乱点或无点。
25. **hslidar 换型号必须同时换校正文件**（`hslidar/correction/angle_correction/` + `firetime_correction/`），否则点云角度错乱。
26. **`source_type` 决定连硬件还是回放**（`lidar_config_base.proto:14`）：回放 record 时忘改成 `RAW_PACKET`，驱动会一直尝试连不存在的雷达。
27. **compensator 两次 TF 查询任一失败就丢整帧**（`compensator.cc:99-100`），`transform_query_timeout` 默认只有 0.02s。定位/TF 延迟大时点云大量丢失且日志不显眼。
28. **compensator 依赖逐点 timestamp**：驱动没给每点填时间戳（`timestamp_min == timestamp_max`，取值见 `compensator.cc:79-82`）时 `compensator.cc:164` 的 `double f = 1.0 / (timestamp_max - timestamp_min)` 除零。
29. **camera x86 AVX2 路径硬编码 1920×1080**（`camera/util.cc:128`）：换分辨率会读越界或输出错乱。
30. **`compress.dag` 与 `compress_arm.dag` 订阅的 channel 不同**（x86 订 `/image`，arm 订 `/raw/image`），跨平台搬 dag 会静默无输出。
31. **多相机 USB 带宽**：同一 USB 控制器上多路 1920×1080 未压缩 YUYV 会超带宽，表现为 `VIDIOC_DQBUF` 超时。解法是走 MJPEG 或分散到不同 USB 控制器。
32. **MJPEG 解码走 FFmpeg 软解**（`camera/usb_cam.cc:132-278`），CPU 开销大；`CompressComponent` 的 JPEG 编码（quality=95）同样吃 CPU。多路相机优先用 arm 的 NvJPEG 硬编或网络相机 H.265。
33. **radar CAN 配置握手可能死循环**：conti/nano 若 conf 期望配置与雷达实际能力不符，`is_configured_` 永远为 false，持续重发 0x200 且不发布数据（`conti_radar_message_manager.cc:112-130`）。
34. **racobit 与 ultrasonic 的 topic 来自 gflags 而非 conf**：改 conf 里的 channel 名无效。
35. **radar 时间戳全是系统时间**：CAN 报文里无时间字段，做前融合要考虑 CAN 传输延迟。
36. **conti_radar 需要定位数据**：`FLAGS_localization_topic` 没数据时无法下发 0x300/0x301，雷达内部运动补偿失效，静止/动态目标分类会错。nano/racobit 根本没这能力。
37. **oculii 有固定旋转四元数** `(-0.5, 0.5, -0.5, 0.5)` 硬编码在 `oculii_radar_udp_parser.cc:327-347`，换安装姿态要改代码而不是改 conf。
38. **gnss format 枚举有实现空洞**：`NMEA`/`RTCM_V2`/`NOVATEL_TEXT`/`HUACE_CAN`/`ASENSING_TEXT`/`UBLOX_*`/`BROADGNSS_BINARY` 都没有 Parser，`CreateParser` 返回 nullptr（`gnss/parser/parser.h:87-101`），表现为静默无数据。
39. **gnss 跳秒表停在 2017**（`gnss/util/time_conversion.h:93-105`，注释写 "expires December 2017"）：未来发生跳秒需手工加行，否则所有 GNSS 时间戳偏 1 秒。
40. **`CanStream::write` 未实现**（`gnss/stream/can_stream.cc`，TODO 返回 0）：走 CAN 的 GNSS 板卡无法下发 login_commands。
41. **`rtk_to` 未配置时会回灌到 `data` 同一串口**（`gnss/stream/raw_stream.h:72-79`）：板卡的 RTCM 输入若是另一个口，RTK 收敛不了。
42. **`proj4_text` 带号配错**：odometry 输出的 UTM 坐标偏几百公里，但 `best_pose` 正常，容易误判成定位模块问题。
43. **`auto_fill_gps_msg`**：导远/博广这类只输出 INS 融合结果的板卡必须设 true，否则 `best_pose` 永远为空，下游一直等。
44. **`microphone` 靠设备名匹配 "ReSpeaker"**（`microphone/respeaker.cc:110-124`）：换别的麦克风阵列找不到设备。
45. **`smartereye` 相机 IP 硬编码 192.168.1.251**（`smartereye/smartereye_device.cc:35`）。
46. **`video` 驱动落盘目录靠环境变量 `H265_SAVE_FOLDER`**：`record=1` 时变量未设会写到意外位置。

## 9. 已确认的代码缺陷（改动前先确认是否已被修复）

| 缺陷 | 位置 | 影响 |
| --- | --- | --- |
| 有符号解码边界少一个等号（`> 0x8000` 应为 `>=`） | `lincoln/protocol/steering_65.cc:86` 等全仓库大量 | 最负值 -32768 被解成 +32768 |
| `BoundedValue` 在 `lower > upper` 时原样返回而不报错 | `modules/drivers/canbus/can_comm/protocol_data.h:112-115` | 限幅静默失效 |
| `Brake60::UpdateData` 少写一个成员字段 | `lincoln/protocol/brake_60.cc:34-40`（成员有 6 个，只写 5 个） | `ignore_driver_override_` 永不下发 |
| `ch` 的 Factory 缺 5 个可选方法，`Driving_Mode()` 恒 `COMPLETE_MANUAL` | `ch_vehicle_factory.h:107` 附近 | canbus 的指令超时保护在 ch 上不触发 |
| `gem::CheckResponse` 直接 return true | `gem_controller.cc` | 使能失败被当成成功，实车调试看不出 |
| `gem` 的半自动模式是空 stub 直接 return OK | `gem_controller.cc:336` | 假成功 |
| `wey` 的 `Brake`/`Throttle` 空实现 | `wey_controller.cc:604-617` 附近 | 只走 Acceleration，踏板量指令无效 |
| `zhongyun::CheckResponse` 日志文案写错 | `zhongyun_controller.cc:353` | 误导排查 |
| `CanStream::write` 未实现（TODO 返回 0） | `gnss/stream/can_stream.cc` | CAN 型 GNSS 板卡无法下发配置 |
| GNSS 跳秒表过期（注释 "expires December 2017"） | `gnss/util/time_conversion.h:93-105` | 未来跳秒后时间偏 1 秒（当前 TAI-UTC 未变，暂无影响） |
| oculii 安装姿态四元数硬编码 | `oculii_radar_udp_parser.cc:327-347` | 换安装姿态必须改代码 |
| camera x86 AVX2 路径硬编码 1920×1080 | `camera/util.cc:128` | 换分辨率越界读 |
| compensator 逐点 timestamp 相等时除零 | `modules/drivers/lidar/compensator/compensator.cc:164` `double f = 1.0 / (timestamp_max - timestamp_min)` | 产生 inf，补偿结果错乱 |

## 10. 数据来源与覆盖口径

- `modules/canbus/`（35 文件）与 `modules/drivers/canbus/`（41 文件）：逐文件全覆盖。
- `modules/drivers/`（除 canbus 子目录，591 文件）：全覆盖，每个驱动的 Component 入口、proto、conf、dag、launch、BUILD、cyberfile.xml 均已读。
- `modules/canbus_vehicle/`（783 文件）：逐文件精读 `lincoln`(84) / `devkit`(76) / `ch`(68) / `demo`(54) 共 282 文件（36%）；其余 7 车型（501 文件）接口级覆盖（VehicleFactory / Controller 头文件与关键实现片段 / MessageManager / conf / BUILD / cyberfile.xml），并逐文件名提取了 protocol 报文清单与 CAN ID。未逐行精读的是这 7 车型 protocol/ 下约 200 个报文类 .cc 实现体与全仓约 190 个 `*_test.cc`。
- 抽样依据：11 个车型的 VehicleFactory 除 `ch` 缺 5 个可选方法外结构完全一致；protocol 报文类 100% 遵循同一模板（ID 常量 + GetPeriod/UpdateData/Reset/set_p_xxx 或 Parse + Byte 位操作），只有字段数量、字节序、校验算法、单位换算四处变化，已在第 1 节能力矩阵与第 7 节坑点中逐车型列明。
- 报文类总数 245（不含 test）：lexus 56、gem 30、lincoln 23、devkit/demo 各 22、neolix_edu 21、ch 20、ge3 16、wey 14、transit 12、zhongyun 9。

