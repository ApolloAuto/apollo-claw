# Apollo 车型适配与传感器驱动接入

> **⚠️ 本环境（包工作区）适配**：本环境是独立包管理工作区 `/apollo_workspace`，根下没有 `modules/`、`apollo.sh`。
> 本文 `modules/canbus*/`、`modules/drivers/...` 路径：**只读** → 拼 `/opt/apollo/neo/src/`；**要改** → 先
> `buildtool install <pkg>`，落到 `/apollo_workspace/modules/...`（保留完整仓库相对路径，不用换算）。
> 编译用 `buildtool build -p <相对工作区的包路径>`，**不能只 `bazel build`**（不做 install，运行时看不见）。
> **改车型 conf、CAN 卡配置、传感器外参试效果**：走 `/apollo/<src_path>/conf/*`（符号链接，立即生效）；
> 改工作区源码副本的 conf 要重编才生效。车型配置 `modules/calibration/data/<vehicle>/` 同理。
> **本环境现场核对**：`/apollo/modules/calibration/data/` 下只有 **5 套**车型标定
> —— `mkz_121`、`mkz_example`、`mkz_lgsvl_321`、`kitti_140`、`nuscenes_165`（后两个是数据集回放用，
> 不是真车）；`/opt/apollo/neo/lib/modules/canbus_vehicle/` 装了 **10 个**车型插件
> （`ch` `devkit` `ge3` `gem` `lexus` `lincoln` `neolix_edu` `transit` `wey` `zhongyun`，
> **正文第 1 节提到的 `demo` 没装**）。`canbus.conf:3-4` 当前指向绝对路径
> `/opt/apollo/neo/lib/modules/canbus_vehicle/lincoln/liblincoln_vehicle_factory_lib.so`
> + `LincolnVehicleFactory` —— **注意本环境这里写的是安装路径而不是 `modules/...` 相对路径**，
> 换车型时照这个格式改。
> 完整对照见仓库根 `CLAUDE.md`。

## 1. canbus 与 canbus_vehicle 的分工

`modules/canbus/` 是车型无关框架（35 文件），`modules/canbus_vehicle/<车型>/` 是运行期 dlopen 的车型插件。

- `CanbusComponent` 是 `TimerComponent`，10ms 周期（`modules/canbus/dag/canbus.dag:9`）。
- 车型选择**不是编译期工厂**，只靠两个 gflags（`modules/canbus/common/canbus_gflags.cc:73-78`），取值来自 `modules/canbus/conf/canbus.conf:3-4`。
- 加载点 `modules/canbus/canbus_component.cc:58` `ClassLoader(FLAGS_load_vehicle_library)` → `:59-60` `CreateClassObj<AbstractVehicleFactory>(FLAGS_load_vehicle_class_name)`。类名必须与 `CYBER_REGISTER_VEHICLEFACTORY(...)`（宏 `modules/canbus/vehicle/abstract_vehicle_factory.h:135`）逐字符一致。**canbus_vehicle 下没有 plugins.xml**，走 class_loader 而非 PluginManager。
- 下行 `OnControlCommand`（`canbus_component.cc:218`）→ 5ms 节流 `:224` → `UpdateCommand`；上行 CanReceiver → `MessageManager::Parse` → `Proc()` 每 10ms `PublishChassis()`（`:151-158`）。

**真实车型（源码里 11 个，已核对 `ls modules/canbus_vehicle/`）**：`ch` `demo` `devkit` `ge3` `gem` `lexus` `lincoln` `neolix_edu` `transit` `wey` `zhongyun`。**本环境只装出 10 个 .so，`demo` 没装。** 注册类名 = 目录名 PascalCase + `VehicleFactory`，唯一例外 `Neolix_eduVehicleFactory`。抄谁/别抄与能力矩阵见 `reference.md`。

## 2. 优先用代码生成器 `modules/tools/gen_vehicle_protocol/`

**有 DBC 就不要手写报文类**（已核对：5 个脚本 + `template/` 下 19 个 .tpl）。

1. `aem enter`，DBC 放 `/apollo_workspace/output/foo.dbc`。
2. 抄 `modules/tools/gen_vehicle_protocol/lincoln_conf.yml`（20 行带中文注释），改 `dbc_file` / `protocol_conf` / `car_type: foo` / `sender`（DBC 里自动驾驶 ECU 的 node 名，lincoln 是 `MAB`）/ `black_list` / `sender_list` / `use_demo_dbc: false` / `output_dir`。
3. 跑 `gen output/foo_conf.yml`（入口 `gen.py`，target 名 `gen`，`BUILD:12-22`）。
4. 产物（`gen.py:65-79`）：`foo/proto/`、`foo/protocol/`、`foo_controller.{h,cc}`、`foo_message_manager.{h,cc}`、`foo_vehicle_factory.{h,cc}`、`BUILD`、`cyberfile.xml`、`canbus_conf/`。
5. **生成器只给骨架**，仍须人工补 `EnableAutoMode`/`CheckResponse`/`CheckChassisError`/`CheckVin`/`Gear` 挡位策略/`chassis()` 字段映射。
6. 无 DBC：`cp -r modules/canbus_vehicle/demo modules/canbus_vehicle/foo`，按第 3 节手写。

教程 `docs/11_Hardware Integration and Calibration/车辆适配/apollo_vehicle_adaption_tutorial_cn.md`。

## 3. 适配新车型 foo

前置：明确每条报文 ID / 周期 / 字节序（intel 小端 vs motorola 大端）/ 每字段 bit 起始位、长度、precision、offset、是否有符号、校验算法。

**3.1 建目录**（结构核对自 `modules/canbus_vehicle/lincoln/` 与 `demo/`）

```
modules/canbus_vehicle/foo/
├── foo_vehicle_factory.h/.cc      # 门面 + CYBER_REGISTER_VEHICLEFACTORY
├── foo_controller.h/.cc           # VehicleController<Foo>
├── foo_message_manager.h/.cc      # 报文注册表
├── proto/foo.proto + proto/BUILD  # 车型私有 chassis_detail 类型
├── protocol/<语义名>_<hexid>.h/.cc
├── BUILD                          # apollo_cc_library + apollo_component
└── cyberfile.xml                  # <name>canbus-vehicle-foo</name>
```

lincoln 另有 `docs/` `testdata/` `*_test.cc`（可选），demo 只有必需项。**命名铁律**：`protocol/<语义名>_<CAN ID 小写十六进制>.{h,cc}`，类名 PascalCase 去下划线（`brake_60.cc`→`Brake60`，`steering_command_102.cc`→`Steeringcommand102`）。

**3.2 protocol 报文类**（位操作只用 `modules/drivers/canbus/common/byte.h:86-159`）

- 发送类（`modules/canbus_vehicle/lincoln/protocol/brake_60.cc`）：`const int32_t Brake60::ID = 0x60;` `:27`（ID 常量在 .cc）；`GetPeriod()` 返回**微秒** `:29-32`；`UpdateData(uint8_t*)` `:34-40` 逐字段调私有 `set_xxx_p`；`Reset()` `:42-49` 全清零（`DisableAutoMode`/`ResetSendMessages` 依赖它）；语义 setter 返回 `Brake60*` 支持链式 `:51-58`。私有 `set_xxx_p` 上方注释块是 DBC 字段元数据，**改协议必须同步改注释**。
- 带校验和（`modules/canbus_vehicle/devkit/protocol/steering_command_102.cc:50-57`）：checksum **必须在 UpdateData 最后算**；devkit 用逐字节 XOR，与基类 `CalculateCheckSum`（`sum ^ 0xFF`，`modules/drivers/canbus/can_comm/protocol_data.h:127`）**不同**，抄前核对 DBC。
- 接收类（`modules/canbus_vehicle/lincoln/protocol/steering_65.cc`）：只实现 `Parse(bytes, len, Foo*)`；要 CAN 帧硬件时间戳再加 `Parse(bytes, len, const timeval&, Foo*)` 重载。有符号量解码模板 `:86-88` `if (value > 0x8000) value -= 0x10000;`（严格应为 `>=`）。单位换算（kph→m/s 除 3.6）在 Parse 里做完。

**3.3 注册报文**（`modules/canbus_vehicle/lincoln/lincoln_message_manager.cc:47-73`）构造函数里 `AddSendProtocolData<Brake60, true>()` `:49-53` / `AddRecvProtocolData<Brake61, true>()` `:55-72`。模板类必须有 `static const int32_t ID`；第二参 `need_check` 决定是否进周期超时统计。

**3.4 Controller 必须覆写**（基类 `modules/canbus/vehicle/vehicle_controller.h`）

- public 纯虚 4 个：`Init` `:70`、`Start` `:78`、`Stop` `:83`、`chassis()` `:89`。
- private 纯虚 17 个（不实现编译不过）：`Emergency` `:123`、`EnableAutoMode` `:125`、`DisableAutoMode` `:126`、`EnableSteeringOnlyMode` `:127`、`EnableSpeedOnlyMode` `:128`、`Gear` `:133`、`Brake` `:139`、`Throttle` `:144`、`Acceleration` `:150`、`Steer(angle)` `:161`、`Steer(angle,spd)` `:167`、`SetEpbBreak` `:172`、`HandleCustomOperation` `:178`、`SetBeam` `:190`、`SetHorn` `:191`、`SetTurningSignal` `:192`、`VerifyID` `:205`。可不写：`Speed` `:155`、`SetLimits` `:173`。
- **不要重写**基类已实现的 `Update`/`SetDrivingMode`/`CheckChassisCommunicationError`（`:280` 判 >100 次即 1s 失联）/`ProcessCommandChange`。
- 车型自加非虚（照 `demo_controller.h:118-126`）：`CheckVin`/`ResetProtocol`/`CheckChassisError`/`SecurityDogThreadFunc`/`CheckResponse(flags, need_wait)`。
- `Init` 套路（`modules/canbus_vehicle/demo/demo_controller.cc:55-125`）：`GetMutableProtocolDataById(Xxx::ID)` + `dynamic_cast`（**必须判 nullptr**）→ `can_sender_->AddMessage(Xxx::ID, ptr, false)` `:46-52`。`chassis()` 见 `:161`。转向百分比换算 `modules/canbus_vehicle/lincoln/lincoln_controller.cc:245-249`，下发换算 `:582`/`:597-602`。挡位不允许 D↔R 直跳时抄 `lincoln_controller.cc:473` 的"先过 N"。`Start()` 起看门狗线程（`demo_controller.cc:142`，实现 `:632`）。

**3.5 proto**：`proto/foo.proto` 顶层 `message Foo`，每条报文一个 sub-message，字段名 = 报文文件名（`optional Brake_command_101 brake_command_101 = 1;`），同步写 `proto/BUILD`。chassis_detail 是**车型私有类型**，换车型后旧 record 的 `/apollo/canbus/chassis_detail` 无法解析。

**3.6 VehicleFactory**（抄 `modules/canbus_vehicle/demo/demo_vehicle_factory.h`，13 方法最全）纯虚 7 个（`abstract_vehicle_factory.h`）：`Init` `:63`、`Start` `:69`、`Stop` `:74`、`UpdateCommand(ControlCommand*)` `:79`、`UpdateCommand(ChassisCommand*)` `:84`、`publish_chassis` `:89`、`PublishChassisDetail` `:94`。建议一并实现（有默认实现，缺了丢功能）：`PublishChassisDetailSender` `:99`、`UpdateHeartbeat` `:104`、`CheckChassisCommunicationFault` `:109`、`AddSendProtocol` `:114`、`ClearSendProtocol` `:119`、`IsSendProtocolClear` `:124`、`Driving_Mode` `:129`（demo 对应 `demo_vehicle_factory.h:65-130`）。末尾 `CYBER_REGISTER_VEHICLEFACTORY(FooVehicleFactory)`（`demo_vehicle_factory.h:161`）。`Init` 顺序：CanClient → MessageManager → CanReceiver::Init → CanSender::Init → Controller::Init → chassis_detail Writer；`Start` 顺序 can_client → **can_receiver → can_sender** → controller（接收必先于发送），`Stop` 反序。

**3.7 BUILD + cyberfile**（抄 `modules/canbus_vehicle/demo/BUILD`）：`apollo_cc_library(name="apollo_canbus_vehicle_foo", srcs=[全部 .cc], hdrs=[全部 .h], copts=["-DMODULE_NAME=\\\"canbus\\\""], deps=[...])` `:8-77` → `apollo_component(name="libfoo_vehicle_factory_lib.so", deps=[":apollo_canbus_vehicle_foo"])` `:79-82` → `apollo_package()` + `cpplint()` `:91-92`。`cyberfile.xml` 依赖 `cyber` `common` `canbus` `common-msgs` `drivers-canbus`（`demo/cyberfile.xml:17-22`）。**新增 .cc 必须同步加进 BUILD**。

**3.8 在哪启用该车型**（三件套均在 `modules/canbus/`）

| 文件 | 改什么 |
| --- | --- |
| `conf/canbus.conf:3-4` | `--load_vehicle_library`（**安装后路径** `/opt/apollo/neo/lib/...`）+ `--load_vehicle_class_name` |
| `conf/canbus_conf.pb.txt:6-12` | `can_card_parameter{brand,type,channel_id,num_ports,interface}`；`vehicle_parameter{...}` `:1-4` |
| `dag/canbus.dag:7-9` | `config_file_path` / `flag_file_path` / `interval:10` |

CAN 卡仅 4 种（`modules/common_msgs/drivers_msgs/can_card_parameter.proto:6-11`）：`FAKE_CAN` `ESD_CAN` `SOCKET_CAN_RAW` `HERMES_CAN`；`ESD_CAN` 是条件编译（`modules/drivers/canbus/can_client/can_client_factory.cc:41-45`）。车辆物理参数 `max_steer_angle`(弧度) / `max_steer_angle_rate` / `wheel_base` 在 `modules/common/data/vehicle_param.pb.txt:17-20`——**配错会让方向盘角度成倍偏差**。

**3.9 编译验证**

```bash
buildtool build --packages canbus-vehicle-foo
bazel build //modules/canbus_vehicle/foo:libfoo_vehicle_factory_lib.so
```

顺序：`FAKE_CAN` 跑通 Init/Start → 真 CAN 只看 `chassis_detail` 解析 → pad_msg START 看能否进自动模式 → `modules/canbus/tools/teleop.cc` 或 `canbus_tester.cc` 小幅度试转向/油门。

## 4. 接入新传感器驱动

**真实驱动清单（已核对 `ls modules/drivers/`）**：`camera` `canbus` `gnss` `lidar` `lidar_fusion_and_compensator` `microphone` `radar` `smartereye` `tools` `video`。lidar 下 8 厂商：`velodyne` `hslidar` `rslidar` `livox` `lslidar` `seyond` `vanjeelidar` + 后处理 `compensator` `fusion`。全清单/channel/关键 conf 见 `reference.md`。

**4.1 目录约定**：每个驱动都是 `conf/ dag/ launch/ proto/ + 源码目录 + BUILD + cyberfile.xml`。源码目录名不统一：`rslidar/driver/`、`livox/component/`、`lslidar/component/`、`seyond/src/`、`vanjeelidar/src/`；`camera`/`gnss` 的 Component 在顶层。

**4.2 新激光雷达（厂商有 SDK）**

1. 第三方库放 `third_party/`；建 `modules/drivers/lidar/newlidar/{src,proto,conf,dag,launch}`。
2. `proto/newlidar_config.proto` **第一个字段必须是 `LidarConfigBase config_base`**（`modules/drivers/lidar/common/proto/lidar_config_base.proto:6-18`，required `scan_channel`/`point_cloud_channel`/`frame_id`/`source_type`），再加型号/IP/端口。另定义 `NewlidarScan` 原始包容器供 record 回放。
3. Component 继承 `LidarComponentBase<NewlidarScan>`（`modules/drivers/lidar/common/lidar_component_base.h:27`）：实现 `Init()` `:33`，基类 `InitBase` `:38-40` 调 `InitPacket`+`InitConverter`，发布走 `WritePointCloud()` `:52`。按 `source_type` 分支：`ONLINE_LIDAR` 连硬件 / `RAW_PACKET` 订阅 scan_channel 回放。SDK 回调与发布线程用 `common/sync_queue.h` 解耦（抄 `rslidar/driver/`）。
4. 时间戳：加 `use_lidar_clock`，统一走 `GetNanosecondTimestampFromSecondTimestamp`（`modules/drivers/lidar/common/util.h:23`）。
5. conf 抄 `rslidar/conf/rslidar.pb.txt`（`config_base{}:1-8` + `model:11` `ip:12` `msop_port:13` `use_lidar_clock:23` `ts_first_point:25`）；dag 抄 `rslidar/dag/rslidar.dag`；launch 抄 `rslidar/launch/rslidar.launch`（`<cyber><module><name>/<dag_conf>/<process_name>`）。
6. **不要**改 `modules/drivers/lidar/lidar_driver_component.cc` 或 `common/driver_factory/`（已废弃）。
7. 下游补偿：把 `point_cloud_channel` 填进 `lidar/compensator/conf/compensator.pb.txt`（3 行：`world_frame_id` `transform_query_timeout:0.02` `output_channel`）或 `modules/drivers/lidar_fusion_and_compensator/conf/config.pb.txt:3-6` 的 `input_channel[]`。

**4.3 新 USB 相机：通常零 C++ 改动**

`v4l2-ctl --device=/dev/videoX --list-formats-ext` 确认格式 → udev 固定成 `/dev/camera/xxx` → `cp modules/drivers/camera/conf/camera_front_6mm.pb.txt` 改 `camera_dev:2` `frame_id:3` `pixel_format:4` `width/height:6-7` `frame_rate:8` `raw_channel_name:24` `channel_name:25` `compress_conf.output_channel:31` `hardware_trigger:35` → `camera/dag/camera.dag:5-19` 加一个 `CameraComponent` 实例。要压缩挂 `compress.dag`(x86，订 `/image`) 或 `compress_arm.dag`(arm，订 `/raw/image`)。网络 H.265 相机改用 `modules/drivers/video/`。

**4.4 radar / GNSS**

CAN 类雷达抄 `radar/conti_radar/`，conf 是 `can_conf{can_card_parameter{...}}` + `radar_conf{...}` + `radar_channel`（`conf/radar_front_conf.pb.txt:1-40`）。**racobit / ultrasonic 的 topic 来自 gflags 而非 conf**（`racobit_radar_canbus_component.cc:48`、`ultrasonic_radar_canbus_component.cc:25`）。以太网类抄 `radar/oculii_radar/`（conf 仅 5 行）。GNSS 只有一个 Component（`gnss/gnss_component.h:36`）：新板卡在 `parser/` 加 Parser 并挂进 `parser/parser.h:87-101` 的 `CreateParser` switch，再改 `gnss/conf/gnss_conf.pb.txt` 的 `data{format}:1-3`、`rtk_to:39`、`proj4_text:57`、`use_gnss_time:103`。

**channel 命名约定** `/apollo/sensor/<设备>/<位置>/<数据名>`：`/apollo/sensor/rslidar/up/PointCloud2`、`/apollo/sensor/camera/front_6mm/image`（压缩加 `/compressed`）、`/apollo/sensor/radar/front`、`/apollo/sensor/gnss/best_pose`；补偿后统一 `.../compensator/PointCloud2`。

## 5. 外参标定

**发布入口**：`modules/transform/static_transform_component.cc` 读 `modules/transform/conf/static_transform_conf.pb.txt`，每段 `extrinsic_file{frame_id, child_frame_id, file_path, enable}`（`:1-6`）。**加了新传感器必须在这里加一段**，否则 TF 查不到。

**yaml 格式**（`modules/calibration/data/mkz_example/velodyne_params/velodyne64_novatel_extrinsics_example.yaml`）：`child_frame_id` + `transform{rotation{x,y,z,w} translation{x,y,z}}` + `header{seq,stamp,frame_id}`，四元数在前、平移单位米。radar 同格式（`radar_params/radar_front_extrinsics.yaml`，其 `frame_id` 是 `velodyne128` 而非 `novatel`）。

**存放三处**：车型整套 `modules/calibration/data/<车型>/`（已核对 5 套：`kitti_140` `mkz_121` `mkz_example` `mkz_lgsvl_321` `nuscenes_165`，子目录 `camera_params/ camera_conf/ velodyne_params/ velodyne_conf/ radar_params/ radar_conf/ gnss_params/ gnss_conf/ video_conf/ vehicle_params/`，顶层 `vehicle_param.pb.txt` `vehicle_info.pb.txt` `sensor_meta.pb.txt`）；驱动示例 `modules/drivers/lidar/velodyne/params/`；感知相机内外参 `modules/perception/data/params/`。

**TF 链** `world →(定位动态) localization →(静态外参) novatel → velodyne64 → 各相机/雷达`。车体系事实标准是 `novatel`；lidar 传感器系 x 前 y 左 z 上；角度单位弧度。新传感器的 `frame_id` 必须与 conf 的 `frame_id`、TF 的 `child_frame_id` 三处一致。禾赛换型号还要同步换 `hslidar/correction/angle_correction/` 与 `firetime_correction/` 的 .dat（conf `correction_file_path:14` `firetimes_path:15` `lidar_type:33`）。工具 `modules/tools/sensor_calibration/`；文档 `docs/11_Hardware Integration and Calibration/传感器标定/`。

## 6. 排错表（按顺序查）

**车不响应控制指令**：① 日志 `Failed to create the vehicle factory`（`canbus_component.cc:62`）= `canbus.conf:4` 类名与注册宏不一致或 .so 不是安装后路径；② 车型意外是 lincoln = dag 的 `flag_file_path` 未生效，静默用 `canbus_gflags.cc:73-78` 默认值；③ 开了 guardian 但 guardian 未起 = canbus 不再订阅 control_command（`canbus_component.cc:92-118` 二者互斥）；④ 车型缺陷：`wey` 的 `Brake`/`Throttle` 空实现只走 Acceleration、`transit` 需先按物理按钮（`transit_controller.cc:276`）、`gem` 的 `CheckResponse` 恒 true；⑤ 半自动模式 `devkit`(`:524`/`:535`)、`ch`(`:396`/`:401`) 直接 `AFATAL` 进程挂；⑥ 两条 control 间隔 <5ms 被丢（`canbus_component.cc:223-227`）。

**底盘反馈缺失 / chassis 全 0**：① `enable_chassis_detail_pub`（`canbus.conf:5`）+ `cyber_monitor` 看 `/apollo/canbus/chassis_detail`；② 漏了 `AddRecvProtocolData<X,true>()`；③ `Parse` 没写对应 `mutable_xxx()` 或 `chassis()` 没做映射；④ 连续 100 次(≈1s) 判失联并 `ResetSendMessages()`（`vehicle_controller.h:280-288`）→ **恢复后必须重新使能**。

**CAN 收不到**：① 配 `ESD_CAN` 但编译无 `USE_ESD_CAN` → `CreateCANClient` 返回 nullptr，表现为 Init 失败（`can_client_factory.cc:41-45`）；② `channel_id`/`num_ports`/`interface` 配错；③ 开 `enable_receiver_log`（`canbus_conf.pb.txt:15`）对比原始帧查 ID 与字节序；④ 发不完：`MAX_CAN_SEND_FRAME_LEN = 1`（`modules/drivers/canbus/common/canbus_consts.h:34`），且 `SCHED_FIFO` 优先级 99（`can_sender.h:309`）在无 `CAP_SYS_NICE` 容器里静默失败、周期抖动变大。

**驱动不出点云 / 图像**：① `source_type` 与场景不符（回放须 `RAW_PACKET`）；② 型号字符串拼错（rslidar `model` / hslidar `lidar_type`）**不报错**，出乱点或无点；③ 禾赛换型号未换 correction/firetime .dat → 角度错乱；④ compensator 两次 TF 查询任一失败丢整帧，`transform_query_timeout` 只 0.02s（`compensator/conf/compensator.pb.txt:2`）；⑤ 相机跨平台搬 dag（x86 订 `/image`、arm 订 `/raw/image`）静默无输出，分辨率非 1920×1080 走 x86 AVX2 会越界（`camera/util.cc:128`），多路 1080p YUYV 同 USB 控制器超带宽；⑥ conti/nano 期望配置与雷达能力不符时 `is_configured_` 永假，持续重发 0x200 且不发数据（`conti_radar_message_manager.cc:112-130`）；⑦ GNSS `format` 落在实现空洞（`NMEA`/`RTCM_V2`/`NOVATEL_TEXT`/`HUACE_CAN`/`ASENSING_TEXT`/`UBLOX_*`/`BROADGNSS_BINARY` 无 Parser，`parser/parser.h:87-101` 返回 nullptr）。

**时间戳异常**：① `steering_timestamp` 变 0 = **只有 HERMES_CAN 填 CAN 帧时间戳**（`hermes_can_client.cc:177-178`）；② 分清 `header.timestamp_sec`（发布时刻）与 `camera_timestamp`/`measurement_time`（采样时刻，**对齐用这个**）与点云逐点 timestamp；③ 逐点 timestamp 缺失（min==max）→ compensator `1.0/(max-min)` 除零；④ CAN 类 radar 全是系统时间；⑤ `use_lidar_clock=true` 需雷达自身 PTP/GPS；⑥ GNSS 跳秒表停在 2017（`gnss/util/time_conversion.h:93-105`）。

**生产环境无 estop 保护**：`use_control_cmd_check` / `use_guardian_cmd_check` 默认 false（`canbus_gflags.cc:39-40`、`canbus.conf:8-9`）。`ch` 的 Factory 缺 `Driving_Mode()` 等 5 个方法，恒返回 `COMPLETE_MANUAL`，指令超时保护在 ch 上**不会触发**。

更多：车型能力矩阵、基类完整接口、驱动全清单、已确认缺陷见 `reference.md`。

