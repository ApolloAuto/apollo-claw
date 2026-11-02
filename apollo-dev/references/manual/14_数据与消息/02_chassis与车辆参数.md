# 02 chassis 与车辆参数

<!--
file: references/manual/14_数据与消息/02_chassis与车辆参数.md
scope: 11.0（默认）
tags: Chassis, chassis.proto, DrivingMode, ErrorCode, GearPosition, WheelSpeed, ChassisGPS, canbus, vehicle_param, 车辆参数
sources:
- /opt/apollo/neo/src/modules/common_msgs/chassis_msgs/chassis.proto（1–200 行精读，全 260 行）
- /opt/apollo/neo/src/modules/common_msgs/localization_msgs/pose.proto（20–65）
- 交叉引用（已核）：manual/13_control源码/01_control_component与数据流.md、manual/14_数据与消息/01_PnC链路channel全景.md
-->

## 0. 一句话作用

`/apollo/canbus/chassis`（`apollo::canbus::Chassis`）是**车辆状态的唯一入口**：planning 的 M1、control 的第一路输入、多个 safety checker 的判据都来自它。本篇给字段速查与"哪些字段决定 PnC 能不能动"。

## 1. 关键符号与文件

| 概念 | 文件（层） | 行号(已核) | 说明 |
|---|---|---|---|
| `Chassis` 消息 | /opt/apollo/neo/src/modules/common_msgs/chassis_msgs/chassis.proto（② src，260 行） | message 14 | `package apollo.canbus`；proto2；`.pb.h` 在 include 树同名路径 |
| `DrivingMode` 枚举 | 同上 | 15–23 | `COMPLETE_MANUAL=0`（默认）/ `COMPLETE_AUTO_DRIVE=1` / `AUTO_STEER_ONLY=2` / `AUTO_SPEED_ONLY=3` / `EMERGENCY_MODE=4` |
| `ErrorCode` 枚举 | 同上 | 25–46 | `NO_ERROR=0`、`CMD_NOT_IN_PERIOD=1`、`CHASSIS_ERROR=2`、`MANUAL_INTERVENTION=3`、`CHASSIS_CAN_NOT_IN_PERIOD=4`、`UNKNOWN_ERROR=5`、`CHASSIS_ERROR_ON_{STEER,BRAKE,THROTTLE,GEAR}=6..9`、`CHASSIS_CAN_LOST=10` |
| `GearPosition` 枚举 | 同上 | 48–56 | NEUTRAL0 / DRIVE1 / REVERSE2 / PARKING3 / LOW4 / INVALID5 / NONE6 |
| `BumperEvent` | 同上 | 58–62 | INVALID0 / NORMAL1 / PRESSED2 |
| `ChassisGPS` | 同上 | 161–184 | 底盘自带 GPS（注释：**Only available for Lincoln**） |
| `WheelSpeed` | 同上 | 194+ | 四轮轮速 + 有效位 + `WheelSpeedType{FORWARD/BACKWARD/STANDSTILL/INVALID}` |

## 2. 字段速查（PnC 最常用的一组）

| 字段 | 编号/行号 | 单位与语义 | 谁在用 |
|---|---|---|---|
| `speed_mps` | 5（:70） | **m/s**，车速 | control 纵向环、planning 起步/停车判断、标定表查表 |
| `throttle_percentage` | 8（:79） | 0–100 % 实际油门 | control 反馈、标定 |
| `brake_percentage` | 9（:82） | 0–100 % 实际刹车 | 同上 |
| `steering_percentage` | 11（:88） | −100–100 %（= steering_angle / max_steering_angle；**顺时针为负**） | control 横向环 |
| `steering_torque_nm` | 12（:91） | Nm | 手动介入检测 |
| `driving_mode` | 21（:105） | 默认 `COMPLETE_MANUAL` | **control 只在 `COMPLETE_AUTO_DRIVE` 下产真命令，否则发零命令** |
| `error_code` | 22（:106） | 默认 `NO_ERROR` | `CMD_NOT_IN_PERIOD` 会触发 replan 全量重规划（见 13_control/01 §2.4） |
| `gear_location` | 23（:107） | GearPosition | 倒车/泊车逻辑、open space |
| `steering_timestamp` | 24（:110） | 秒，1e-6 精度 | 时延分析 |
| `header` | 25（:113） | `apollo.common.Header` | 时间戳/序号（见 ../11_cyber框架/04） |
| `chassis_error_mask` | 26（:115） | 位掩码，默认 0 | 故障聚合 |
| `signal` | 27（:117） | `apollo.common.VehicleSignal` | 转向灯/喇叭等（**旧的 `left_turn_signal` 等 14–18 已 deprecated**，:97–101） |
| `engage_advice` | 29（:122） | `apollo.common.EngageAdvice` | 能否接管的建议 |
| `wheel_speed` | 30（:124） | WheelSpeed | 低速/停车判定 |
| `battery_soc_percentage` | 34（:137） | %，默认 −1 | 电量 |
| `throttle/brake/steering_percentage_cmd` | 35/36/37（:140/:143/:149） | 下发值回读 | 控制闭环诊断（实际值 vs 下发值） |
| `front_bumper_event` / `back_bumper_event` | 38/39（:151/:153） | BumperEvent | 碰撞/触边 |
| `custom_status` | 41（:158） | `google.protobuf.Any` | **车型自定义扩展位**（适配新车常用） |

⚠️ 多个浮点字段的 proto 默认值是 **`nan`**（`engine_rpm`/`speed_mps`/`odometer_m`/`throttle_percentage`/`brake_percentage`/`steering_percentage`/`steering_torque_nm`/`*_cmd`）——底盘驱动没填的字段读出来是 NaN，不是 0，直接参与运算会污染下游。

## 3. 车辆状态与车辆参数是两回事

| | 车辆**状态**（每帧变） | 车辆**参数**（静态标定） |
|---|---|---|
| 载体 | `Chassis` 消息（本篇）+ `LocalizationEstimate` | `vehicle_param.pb.txt` 一类静态 conf（`modules/common/data/` 与车型 profile 下，本机具体路径见 §6 命令） |
| 内容 | 车速、油门刹车转角实际值、档位、驾驶模式、故障码 | 轴距/轮距、最大转角与转角速率、最大加减速、车长宽高、后轴中心到前保距离等 |
| 谁用 | control 反馈、planning 起停判断 | planning 轨迹可行性/转弯半径、control 前馈、open space 泊车碰撞检查 |

**VRP（车辆参考点）= 后轴中心**（`pose.proto:24–26` 原文注释），planning/control 的位置、速度、加速度都以它为基准；`Pose.heading` 朝东为 0、朝北为正（`pose.proto:45–48`）。详见 `03_localization与坐标系TF.md`。

## 4. 修改与扩展点

| 想做什么 | 怎么做 |
|---|---|
| 适配新车型的底盘协议 | 车型插件在 `/opt/apollo/neo/lib/modules/canbus_vehicle/<车型>/`（本机已装 beiqi_arcfox/ch/devkit/ge3/gem/lexus/lincoln/neolix_edu/transit/wey）；新增车型走 canbus_vehicle 包 + CAN 报文解析，把解析结果填进 `Chassis` 字段 |
| 传自定义底盘状态 | 用 `custom_status`（Any，:158），避免改公共 proto |
| 只想造假底盘数据调 PnC | record 回放，或用仿真 SimControl（dreamview）；也可写小工具往 `/apollo/canbus/chassis` 发消息（channel 名见 `adapter_gflags.cc:27`） |
| 判断"车为什么不动" | 依次看 `driving_mode`（是否 `COMPLETE_AUTO_DRIVE`）→ `error_code` → `gear_location` → `chassis_error_mask` |

## 5. ⚠️ 本环境注意

- **NaN 默认值**：见 §2 末尾。写下游逻辑先判 `has_xxx()`。
- **`driving_mode` 不是 AUTO 时 control 只发零命令**（`control_component.cc:434–445`，见 13_control/01）——"起了 control 但车不动"第一件事看这个字段。
- **`chassis_detail` 是另一个 channel**（`/apollo/canbus/chassis_detail`，`adapter_gflags.cc:28–29`），装的是车型专有报文明细，不要与 `Chassis` 混用。
- deprecated 字段（灯光 5 个、`disengage_status`、`license`）仍在 proto 里，新代码用 `signal` / `vehicle_id`。
- `ChassisGPS` 注释写明只对 Lincoln 有效，别当通用定位源用；定位一律用 `/apollo/localization/pose`。
- 消息定义有两种形态可读：`.proto` 源（本篇引用的）与 include 树 `.pb.h`；**没有 `control.proto`**，控制消息在 `control_cmd.proto`。

## 6. 验证命令

```bash
# 字段与枚举原文
sed -n '14,60p' /opt/apollo/neo/src/modules/common_msgs/chassis_msgs/chassis.proto

# 本机装了哪些车型插件
ls /opt/apollo/neo/lib/modules/canbus_vehicle/

# 找生效的车辆参数文件（车型 profile 可能覆盖）
find /apollo/modules -name 'vehicle_param*.pb.txt' 2>/dev/null | head
readlink -f $(find /apollo/modules -name 'vehicle_param*.pb.txt' 2>/dev/null | head -1)

# 运行期看底盘（-w 参数在本环境是坏的）
cyber_channel -e /apollo/canbus/chassis
```

## 7. 溯源

- 蒸馏日期：2026-09-08。基线：Apollo 11.0.0 package 工作区。
- 本轮 read 打开核对：`chassis.proto` 1–200（表中所有行号均在此范围内逐行核过；200–260 段的 `WheelSpeed`/`Surround`/`CheckResponse` 细节仅看到起始行，标注为"194+"）、`pose.proto` 20–65。
- 未核对/待核：① 车辆参数文件（`vehicle_param.pb.txt`）的确切生效路径与字段清单——本篇只给查找命令，未 read（下一版补）；② canbus 模块内部如何填充这些字段（未读 canbus 源码）；③ `Surround`/`CheckResponse` 字段明细；④ `custom_status` 在本机是否有车型在用。
