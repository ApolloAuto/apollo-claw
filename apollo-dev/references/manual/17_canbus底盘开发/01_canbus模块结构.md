# 01 canbus 模块结构

<!--
file: references/manual/17_canbus底盘开发/01_canbus模块结构.md
scope: 11.0（默认）
tags: canbus, CanbusComponent, TimerComponent, AbstractVehicleFactory, ClassLoader, chassis, chassis_detail, canbus.dag, canbus.conf, 车型插件
sources:
- /opt/apollo/neo/src/modules/canbus/canbus_component.h（1–119 行精读）
- /opt/apollo/neo/src/modules/canbus/canbus_component.cc（1–386 行精读）
- /opt/apollo/neo/src/modules/canbus/vehicle/abstract_vehicle_factory.h（1–139）
- /opt/apollo/neo/src/modules/canbus/vehicle/vehicle_controller.h（1–561）
- /opt/apollo/neo/src/modules/canbus/common/canbus_gflags.h（1–64）
- /opt/apollo/neo/src/modules/common/adapters/adapter_gflags.cc（25–36）
- /opt/apollo/neo/src/modules/canbus/proto/vehicle_parameter.proto（全 13 行）
- 运行时层：/apollo/modules/canbus/{dag,launch,conf}（readlink 判定落点，bash 核对）
- 官方应用实践 42、44（[官方·上游]）
-->

## 0. 一句话作用

`canbus` 是 Apollo 与底盘之间的**唯一 I/O 接口**：下行吃 `/apollo/control` 的 `ControlCommand`（及 guardian / external command），经车型插件（`canbus_vehicle/*`）转成 CAN 报文发给底盘；上行收底盘 CAN 帧，解析后组装成 `Chassis` 发 `/apollo/canbus/chassis`（planning/control/safety 的车辆状态唯一入口，见 ../14_数据与消息/02_chassis与车辆参数.md）。它本身**不识别车型协议**——协议全在运行时动态加载的车型插件里，这就是 11.0 与 9.0 结构上最大的区别。

## 1. 关键符号与文件

| 符号/文件 | 路径（层） | 行号(已核) | 说明 |
|---|---|---|---|
| `CanbusComponent` | /opt/apollo/neo/src/modules/canbus/canbus_component.h（② src） | class 57 | `final : TimerComponent`；`CYBER_REGISTER_COMPONENT` 116 |
| `Init()` | canbus_component.cc | 44–144 | 加载 conf→ClassLoader 建车型工厂→建 reader/writer→`Start()` |
| `Proc()`（10ms 定时） | canbus_component.cc | 162–216 | 观察命令→查底盘失联→发 chassis/detail→心跳 |
| `PublishChassis()` | canbus_component.cc | 151–160 | `vehicle_object_->publish_chassis()` + CMD_NOT_IN_PERIOD 注入 + FillHeader |
| `AbstractVehicleFactory` | /opt/apollo/neo/src/modules/canbus/vehicle/abstract_vehicle_factory.h | class 47；`CYBER_REGISTER_VEHICLEFACTORY` 135–136 | 车型工厂抽象基类 + ClassLoader 注册宏 |
| `VehicleController<SensorType>` | /opt/apollo/neo/src/modules/canbus/vehicle/vehicle_controller.h | class 60 | 控制器接口（Gear/Brake/Throttle/Steer/Enable*Mode…） |
| `canbus_gflags` | /opt/apollo/neo/src/modules/canbus/common/canbus_gflags.h | 全 64 行 | `chassis_freq`/`load_vehicle_library`/`load_vehicle_class_name` 等 |
| `CanbusConf` / `VehicleParameter` | /opt/apollo/neo/src/modules/canbus/proto/canbus_conf.proto / vehicle_parameter.proto（② src） | 后者全 13 行 | `brand` 字段仍在（vehicle_parameter.proto:9）但**选择车型不再靠它** |
| dag / launch / conf | /apollo/modules/canbus/{dag,launch,conf}/（④ 视口，软链） | bash readlink | 见 §3 |

## 2. 机制与数据流

**2.1 组件被拉起（mainboard → TimerComponent）**。`canbus.dag` 声明 `module_library:"modules/canbus/libcanbus_component.so"`、`class_name:"CanbusComponent"`、`timer_components.interval: 10`（10ms 周期，bash 核对 canbus.dag 内容）。`canbus.launch` 只包一层 `dag_conf` 指向 `/apollo/modules/canbus/dag/canbus.dag`。**本环境启动用 `mainboard -d /apollo/modules/canbus/dag/canbus.dag` 或 `cyber_launch start /apollo/modules/canbus/launch/canbus.launch`**（CLAUDE.md 第二节：launch→cyber_launch、dag→mainboard，别用 `scripts/canbus.sh` 也通但路径拼装依赖同名）。

**2.2 Init 时序**（canbus_component.cc:44–144）：
1. `GetProtoConfig(&canbus_conf_)` 加载 `canbus_conf.pb.txt`（:45）；
2. 校验 `FLAGS_load_vehicle_library` 指向的 .so 存在（:52–56）；
3. **`ClassLoader loader(FLAGS_load_vehicle_library)` + `CreateClassObj<AbstractVehicleFactory>(FLAGS_load_vehicle_class_name)`**（:58–65）——车型插件在这里被动态加载并创建，**这是 11.0 插件化的落点**；
4. `vehicle_object_->Init(&canbus_conf_)`（:70）→ 建 CAN 客户端/receiver/sender/controller（见 02 篇 §2）；
5. 建 reader：guardian/control 二选一（`FLAGS_receive_guardian` 为真走 guardian，否则走 control，:92–118）+ `ChassisCommand` reader（:121–126）；
6. `node_->CreateWriter<Chassis>(FLAGS_chassis_topic)`（:129）→ `vehicle_object_->Start()`（:132）。

**2.3 定时 Proc**（10ms，canbus_component.cc:162–216）：Observe 最新 control/guardian 命令并做超时判定（:165–181，`OnControlCommandCheck`）→ `CheckChassisCommunicationFault()` 判底盘失联（:184）→ `PublishChassis()`（:193）→ `FLAGS_enable_chassis_detail_pub` 时 `PublishChassisDetail()`（:196）→ `FLAGS_enable_chassis_detail_sender_pub` 时 `PublishChassisDetailSender()`（:201）→ `UpdateHeartbeat()`（:206）。

**2.4 Chassis 组装发布**：`vehicle_object_->publish_chassis()` 取 controller 的 `chassis()`（拷贝，避开多线程，见 vehicle_controller.h:89 注释）；若 control 命令超时则注入 `error_code=CMD_NOT_IN_PERIOD`（:153–156）；`common::util::FillHeader` 补 header 后 `chassis_writer_->Write`（:157–158）。**频率 = 10ms 定时器 ≈100Hz**，与 44 篇实测 100Hz 一致。

**2.5 命令超时兜底（安全）**：`ProcessGuardianCmdTimeout`（:376–383）把 throttle/steering 归零、steering_rate=25、brake=`FLAGS_estop_brake`（本机 conf 30.0，见 §3）。

**输入输出 channel 总表**（名字来自 adapter_gflags.cc:27–34）：

| channel | 消息类型 | 方向 | 代码位置 |
|---|---|---|---|
| `/apollo/control` | `control::ControlCommand` | in | adapter_gflags.cc:48（`control_command_topic`）|
| `/apollo/guardian` | `guardian::GuardianCommand` | in | :257（`guardian_topic`，`--receive_guardian` 才订阅）|
| `/apollo/chassis_control` | `external_command::ChassisCommand` | in | :33（`chassis_command_topic`）|
| `/apollo/canbus/chassis` | `canbus::Chassis` | out | :27（`chassis_topic`）|
| `/apollo/canbus/chassis_detail` | `<车型>_detail`（如 `Neolix_edu`） | out | :28（`chassis_detail_topic`）|
| `/apollo/canbus/chassis_detail_sender` | 同上 | out | :30–32（`chassis_detail_sender_topic`）|

## 3. 注册与配置

- **dag/launch 是出厂件**：`readlink -f` 落点 = `/opt/apollo/neo/share/modules/canbus/dag|launch/…`（bash 实测），不在 profile 覆盖层。
- **conf 在 profile 覆盖层**：`/apollo/modules/canbus/conf/canbus.conf` 与 `canbus_conf.pb.txt` 的 `readlink` 落点 = `/apollo_workspace/profiles/ARCF_40P/modules/canbus/conf/…`（`current→ARCF_40P`）。**改软链=写穿到 profile 层、立即生效**；源码副本 `/apollo_workspace/modules/canbus/conf/` 不生效直到 `buildtool build -p`（CLAUDE.md 第三节②）。
- 当前 profile `canbus.conf` 实测内容（bash cat）：`--load_vehicle_library=/opt/apollo/neo/lib/modules/canbus_vehicle/beiqi_arcfox/libbeiqi_arcfox_vehicle_factory_lib.so`、`--load_vehicle_class_name=Beiqi_arcfoxVehicleFactory`、`--enable_chassis_detail_pub`、`--enable_chassis_detail_sender_pub`、`--chassis_debug_mode=true`、`--use_control_cmd_check=false`、`--noreceive_guardian`、`--estop_brake=30.0`。
- 当前 `canbus_conf.pb.txt` 实测：`vehicle_parameter{max_enable_fail_attempt:5, driving_mode:COMPLETE_AUTO_DRIVE}`、`can_card_parameter{brand:HERMES_CAN, type:PCI_CARD, channel_id:CHANNEL_ID_THREE, interface:NATIVE}`。**注意 `vehicle_parameter.brand` 未设置**——车型选择不靠它。

## 4. 修改与扩展点（二次开发）

| 想做什么 | 改哪里 + 命令 |
|---|---|
| 换车型插件 | 改 `/apollo/modules/canbus/conf/canbus.conf` 的 `--load_vehicle_library` + `--load_vehicle_class_name`，重启 canbus |
| 打开/关闭 chassis_detail 发布 | 该 conf 的 `--enable_chassis_detail_pub` / `--enable_chassis_detail_sender_pub` |
| 改底盘发布频率 | `canbus_gflags.cc` 的 `FLAGS_chassis_freq`（gflags.h:29），或 conf 传 `--chassis_freq` |
| 关 guardian 走纯 control | conf 里 `--noreceive_guardian`（本机已设） |
| 新增车型（核心扩展点） | 见 03 篇全流程（canbus_vehicle 插件包 + `buildtool build -p` + conf 指向新 .so） |
| 改 CanbusComponent 逻辑 | `buildtool install canbus` 拉源码进 `/apollo_workspace/modules/canbus/` 再改、`buildtool build -p modules/canbus` |

## 5. ⚠️ 本环境注意

- **9.0/11.0 最大结构差异**：9.0 车型在 `modules/canbus/vehicle/<car>/`、由 `vehicle_factory.cc` 按 `VehicleBrand` switch 手动 new 各种工厂，一个 `libcanbus.so` 全包（[官方·上游]43 篇"注册新车辆：在 vehicle_factory.cc 里新建类"）。11.0 车型拆成独立包 `modules/canbus_vehicle/<car>/`（各自 `.so`），由 `ClassLoader` 按 conf 里的库路径+类名动态加载——**没有 `vehicle_factory.cc` 的 switch**（src 树 `canbus/vehicle/` 只有 abstract 基类与 `vehicle_controller.h`，bash 实测）。
- **车型插件注册走 cyber ClassLoader，不是 PluginManager**：`abstract_vehicle_factory.h:135–136` 的 `CYBER_REGISTER_VEHICLEFACTORY = CLASS_LOADER_REGISTER_CLASS`；全仓 canbus_vehicle 下**无任何 `plugins.xml`**，`/opt/apollo/neo/share/cyber_plugin_index/` 也**无 canbus_vehicle 条目**（bash grep 实测）。排查插件加载别去 plugin_index。
- `canbus.dag`/`launch` 与 `conf` 落点不同（share vs profile）——改 conf 是 profile 写穿，别误以为改 share。
- **canbus 必须连真实底盘才有输出**：chassis_detail 为空→`CheckChassisCommunicationError`（vehicle_controller.h:234–295，丢帧 >100 判失联）；没有底盘反馈时 `/apollo/canbus/chassis` 的字段是 NaN/空（见 14 篇 §2），下游会拿到坏数据。
- 44 篇说"默认不发布 chassis_detail，要改 conf 打开"——**11.0 当前 profile 已默认打开**（[11.0·实测] 与 [官方·上游]44 篇差异）。

## 6. 验证命令

```bash
# 启动（二选一）
mainboard -d /apollo/modules/canbus/dag/canbus.dag
cyber_launch start /apollo/modules/canbus/launch/canbus.launch

# 看 chassis 是否存在与频率
cyber_channel -e /apollo/canbus/chassis
cyber_channel -l /apollo/canbus/chassis   # 或 cyber_monitor 交互看字段

# 判定 conf/dag 落点
readlink -f /apollo/modules/canbus/conf/canbus.conf
readlink -f /apollo/modules/canbus/dag/canbus.dag

# 装了哪些车型插件 .so
ls /opt/apollo/neo/lib/modules/canbus_vehicle/
```

## 7. 溯源

- 蒸馏日期：2026-09-08。基线：Apollo 11.0.0 package 工作区（ARCF_40P profile）。
- 本轮 read 打开核对：canbus_component.h（1–119）、canbus_component.cc（1–386）、abstract_vehicle_factory.h（1–139）、vehicle_controller.h（1–561）、canbus_gflags.h（1–64）、adapter_gflags.cc（25–36）、vehicle_parameter.proto（1–13）。
- bash 核对（未用 read 复开，行号未引用）：`ls -R modules/canbus/`、`/apollo/modules/canbus/` 软链 readlink、`canbus.dag`/`launch`/当前 profile `canbus.conf`/`canbus_conf.pb.txt` 内容、`canbus/BUILD`（`libcanbus_component.so`、`DO_NOT_IMPORT_canbus_component`）、`/opt/apollo/neo/lib/modules/canbus_vehicle/` 11 个插件、`cyber_plugin_index` 无 canbus 条目。
- 官方文档对照：42 篇（线控标准，[官方·上游]）、44 篇（开环验证，[官方·上游]）——差异点已在 §2/§5 标注。
- 待核：① `chassis_freq` 实际默认值（gflags.cc 未读，本机经 dag interval=10 反推 100Hz）；② `adapter_gflags.cc` 其余 topic 行号（只核 25–36）；③ 44 篇 teleop 在 11.0 的运行方式（见 03 篇 §5，teleop.sh 是整仓形态残留）。
