# 09 msg_adapter 与离线调试

<!--
file: references/manual/16_感知源码/09_msg_adapter与离线调试.md
scope: 11.0（默认）
tags: msg_adapter, 消息转换, PerceptionObstacles, 离线调试, mainboard, cyber_channel, cyber_recorder, record, 回放, exporter, offline_camera_detection, ground_truth, visualizer, transform_server
sources:
- /opt/apollo/neo/src/modules/perception/msg_adapter/msg_adapter_component.h（全文 read）
- /opt/apollo/neo/src/modules/perception/msg_adapter/msg_adapter_component.cc（全文 read）
- /opt/apollo/neo/src/modules/perception/msg_adapter/msg_converter.h（全文 read）
- /opt/apollo/neo/src/modules/perception/msg_adapter/convert/convert.h（全文 read）
- /opt/apollo/neo/src/modules/perception/msg_adapter/convert/common.h（全文 read）
- /opt/apollo/neo/src/modules/perception/msg_adapter/common/msg_adapter_gflags.cc（全文 read）
- /opt/apollo/neo/src/modules/perception/msg_adapter/dag/msg_adapter.dag（全文 read）
- /opt/apollo/neo/src/modules/perception/msg_adapter/launch/msg_adapter.launch（全文 read）
- /opt/apollo/neo/src/cyber/component/component_base.h（70–124 read）
- /apollo_workspace/.manual_work/inventory/perception_inventory.md（全文，§6/§7）
- <skills>/apollo-dev/references/manual/16_感知源码/01_总览与四大链路.md、10_本环境感知运行现状.md
- <skills>/apollo-dev/references/manual/11_cyber框架/03_工具链实测.md
-->

## 0. 一句话作用

`msg_adapter` 是 perception 里的**消息格式转换器**：把感知模块内部「线程内传指针、不序列化」的
`CameraFrame / SensorFrameMessage / LidarFrameMessage` 转成标准 `PerceptionObstacles`
（`/apollo/perception/obstacles`，与 fusion 正常输出同类型同 channel），从而把内部结果变得**可见、可录、
可灌给 PnC**。它自身是 C++ Component 走 dag，**不是裸命令**。本文同时盘点 `tools/` 离线调试工具族，并给
「离线灌包 → 单模块跑 → 看 channel → 回放」的完整调试流程。

## 1. 关键符号与文件

| 符号/类/概念 | 文件（② src 层，read 核过） | 行号 | 说明 |
|---|---|---|---|
| `MsgAdapterComponent` | msg_adapter/msg_adapter_component.h | :27 | 继承 `apollo::cyber::Component<>`（**无模板参数 = dag 无 readers，收发全在代码里**） |
| `CYBER_REGISTER_COMPONENT(MsgAdapterComponent)` | msg_adapter/msg_adapter_component.h | :38 | 非限定名注册（与 plugins.xml 全限定名相反） |
| `MsgConverter::Add<From,To>()` | msg_adapter/msg_converter.h | :52–70 | 建 writer+reader，收到即 `convert`，成功才 `Write` |
| `ConvertCameraFrame2Obstacles` | msg_adapter/convert/convert.h | :33 | camera 分支转换（module_name=`perception_camera`） |
| `ConvertSensorFrameMessage2Obstacles` | msg_adapter/convert/convert.h | :57 | fusion/tracking 分支（module_name=`perception_obstacle`） |
| `ConvertLidarFrameMessage2Obstacles` | msg_adapter/convert/convert.h | :81 | lidar 分支（module_name=`perception_lidar`，先转 world 系再赋 track_id） |
| `ConvertObjectToPb` | msg_adapter/convert/common.h | :28 | 单障碍物字段全映射（中心/速度/尺寸/polygon/点云/type/light_status/fusion measurements） |
| 6 个 topic gflag | msg_adapter/common/msg_adapter_gflags.cc | :19–35 | in 默认 `/fake_topic`，out 默认 `/apollo/perception/obstacles` |
| dag / launch | msg_adapter/dag/msg_adapter.dag、launch/msg_adapter.launch | dag:2,5,8；launch:8 | 单组件单库，flag_file_path 指向共享 `perception_common.flag` |
| flag 加载机制 | cyber/component/component_base.h | :83–91 | Component 基类读 dag `flag_file_path`→`--flagfile=` 加载 |

`msg_adapter` 包**无 conf/、无 proto/**（topic 全由 gflag 定义），3 个 .so
（`libmsg_adapter_component.so`、`libapollo_perception_msg_adapter.so`、`libDO_NOT_IMPORT_msg_adapter_component.so`）
均已 install 到 `/opt/apollo/neo/lib/` → 可直接 `mainboard -d` 跑（盘点 §6）。

## 2. 机制与数据流（Convert 流程）

**拉起方式**：`mainboard -d <dag>` 载入 `libmsg_adapter_component.so` → `Init()` 里 `new MsgConverter(node_)`，
依次 `Add()` 注册三组（in → out → 转换函数），见 msg_adapter_component.cc:24–52。

**Add 的收发机制**（msg_converter.h:52–70）：对每组建一个 `CreateWriter<To>(out)` + 一个
`CreateReader<From>(in, 回调)`；每收到一条 `From` 就 new 一个 `To` 调 `convert(from, to)`，返回 true 才
`writer->Write(to)`。reader/writer 存进 vector 保活，进程不退订阅不失效。

**三组通道映射**（in 的「真实值」来自 msg_adapter/README.md，本机 bash 核对；gflag 默认值都是占位 `/fake_topic`）：

| 方向 | channel（真实/推荐） | 内部消息类型 | 转换函数 | 输出 |
|---|---|---|---|---|
| in(camera) | `/perception/inner/location_refinement` | `onboard::CameraFrame` | ConvertCameraFrame2Obstacles | 遍历 `frame->detected_objects` |
| in(lidar) | `/perception/lidar/detection` | `onboard::LidarFrameMessage` | ConvertLidarFrameMessage2Obstacles | 遍历 `segmented_objects`，先 `lidar2world_pose` 变换再转 |
| in(fusion) | `/perception/inner/PrefusedObjects` | `onboard::SensorFrameMessage` | ConvertSensorFrameMessage2Obstacles | 遍历 `msg->frame_->objects` |
| out | `/apollo/perception/obstacles` | `apollo::perception::PerceptionObstacles` | — | 与 fusion 正常输出同 channel 同类型 |

⚠️ **内部消息为什么需要 adapter**：`/perception/inner/*`、`/perception/lidar/*` 都是线程内传指针、**不序列化**，
`cyber_monitor` / `cyber_channel -e` 看不到内容（README 明说）。msg_adapter 把它们重编码成 protobuf 的
`PerceptionObstacles`，才可被工具查看、被 `cyber_recorder` 录、被 prediction/planning 消费。

**建议一次只开一组**（README）：三组 out 默认都是同一个 `/apollo/perception/obstacles`，同时开会三写同一 channel。

## 3. 注册与配置

### 3.1 gflag（6 个 topic flag，msg_adapter_gflags.cc:19–35）

| flag | 默认值 | 语义 |
|---|---|---|
| `cameraframe_to_obstacles_in` | `/fake_topic` | CameraFrame 输入 |
| `cameraframe_to_obstacles_out` | `/apollo/perception/obstacles` | 输出 |
| `sensorframe_message_to_obstacles_in` | `/fake_topic` | SensorFrameMessage 输入 |
| `sensorframe_message_to_obstacles_out` | `/apollo/perception/obstacles` | 输出 |
| `lidarframe_to_obstacles_in` | `/fake_topic` | LidarFrameMessage 输入 |
| `lidarframe_to_obstacles_out` | `/apollo/perception/obstacles` | 输出 |

**覆盖方式**（README 官方做法）：dag 的 `flag_file_path` = `/apollo/modules/perception/data/flag/perception_common.flag`
（msg_adapter.dag:8），Component 基类在 `LoadConfigFiles` 里 `google::SetCommandLineOption("flagfile", …)` 加载它
（component_base.h:83–91）。在这个共享 flag 文件里加一行即可（该文件是所有感知 dag 共享的 flagfile，msg_adapter
专属 flag 名不影响其他组件）：

```
--lidarframe_to_obstacles_in=/perception/lidar/detection
```

### 3.2 dag / launch

- dag（msg_adapter.dag）：`module_library="modules/perception/msg_adapter/libmsg_adapter_component.so"`(:2)、
  单组件 `class_name:"MsgAdapterComponent"`(:5)、`flag_file_path`(:8)；**无 readers 段**（Component<> 无订阅模板参数）。
- launch（msg_adapter.launch）：单 `<module>`，`dag_conf=/apollo/modules/perception/msg_adapter/dag/msg_adapter.dag`(:8)，
  `process_name=msg_adapter`。用 `cyber_launch start` 亦可，但单模块调试首选 `mainboard -d`。

## 4. 用法场景与离线调试流程

### 4.1 场景 A：离线把 record/rosbag 灌进感知单模块，再转出可见消息

```bash
# 1) 回放录包（传感器原始通道灌进去）
cyber_recorder play -f my.record -l

# 2) 单跑 lidar 检测 dag（前台打屏看日志）
mainboard -d /apollo/modules/perception/lidar_cpdet_detection/dag/lidar_detection.dag

# 3) msg_adapter 把内部 /perception/lidar/detection 转成可看的 obstacles
#    （先在 perception_common.flag 加 --lidarframe_to_obstacles_in=/perception/lidar/detection）
mainboard -d /apollo/modules/perception/msg_adapter/dag/msg_adapter.dag

# 4) 看结果
cyber_channel -e /apollo/perception/obstacles
```

### 4.2 场景 B：把感知输出转发进 PnC 链（不跑 fusion，用 adapter 顶替）

msg_adapter 的 out 就是 `/apollo/perception/obstacles`，而 prediction 的 dag **唯一 reader 就是它**
（见 `01_总览与四大链路.md` §3）。所以把 in 指到 `/perception/inner/PrefusedObjects`
（lidar/camera/radar tracking 汇合点），msg_adapter 即成为「伪 fusion」：

```bash
# perception_common.flag 加：
#   --sensorframe_message_to_obstacles_in=/perception/inner/PrefusedObjects
mainboard -d /apollo/modules/perception/msg_adapter/dag/msg_adapter.dag   # 出 /apollo/perception/obstacles
# 下游 prediction 正常起，即可看到 planning 有轨迹 → 验证 PnC 链离线可闭环
```

### 4.3 完整离线调试单模块流程（四步）

| 步骤 | 命令 | 说明 |
|---|---|---|
| ① 转消息 | `mainboard -d …/msg_adapter/dag/msg_adapter.dag`（先改 flag 指向真实内部 channel） | 让内部结果可见/可录 |
| ② 单 dag | `mainboard -d /apollo/modules/perception/<pkg>/dag/<x>.dag` | 前台打屏，首选（勿用 `apollo.sh`/`buildtool bootstrap`） |
| ③ 看 channel | `cyber_channel -l`、`cyber_channel -e <ch>`、`cyber_channel hz <ch>`（**勿加 `-w`**）、`cyber_channel info <ch>`、`cyber_monitor` | 参数与坑见 `../11_cyber框架/03_工具链实测.md` §2/§5 |
| ④ 或 record 回放 | `cyber_recorder record -a -k <点云大户> -o my.record`；`cyber_recorder play -f my.record -l -k <自己要产出的channel>` | 录/回放闭环 |

回放闭环要点（引 03 篇）：play 用 `-k` 黑名单掉「自己要产出的 channel」避免自干扰；`-c` 白名单可重复；
大包先 `split -b/-e` 抠段。`cyber_channel -w/--window` 在本机**必坏**（Py2 `string.atoi`，03 篇 §5-①）。

### 4.4 perception tools 工具族（每项一句话用途）

| 位置（② src 层） | 一句话用途 |
|---|---|
| tools/common/ground_truth.{h,cc} | `LoadKittiLabel` 读 KITTI 标签填进 `CameraFrame.detected_objects`（离线真值） |
| tools/common/visualizer.{h,cc} | `CameraVisualization/TfVisualization/LaneVisualization` 把检测/车道线结果画成 jpg |
| tools/common/util.{h,cc} | `FillImage` 从文件读图填 `CameraFrame.data_provider`（离线构造相机帧） |
| tools/exporter/（msg_exporter.cc + export_msg.config） | 订阅 lidar16/velodyne64/front_6mm/front_12mm 传感器通道，带外参把点云/图像**导出成文件**（离线标定用） |
| tools/offline/transform_server.{h,cc} | `TransformServer` 按时间戳查 TF 位姿，供离线重投影 |
| tools/offline/visualizer.{h,cc} | `Visualizer` 离线 2D/3D 可视化相机检测/车道/motion 结果 |
| tools/offline_camera_detection/ | `offline_camera_detection` 跑 SMOKE 单阶段检测，吃 `images/` 图、出 `/apollo/data/test.jpg|txt` |

## 5. ⚠️ 本环境注意（11.0 包工作区实测）

1. **msg_adapter 是 C++ Component 走 dag，不是裸命令**（CLAUDE.md §5、盘点 §6 一致）：没有
   `msg_adapter` 可执行文件，只能 `mainboard -d …/dag/msg_adapter.dag` 或
   `cyber_launch start …/launch/msg_adapter.launch`。别像整仓文档里某些工具那样直接敲命令名。
2. **默认 `in=/fake_topic` 必须改 gflag 才能出数据**：三个 in flag 默认都是 `/fake_topic`（无发布者），
   adapter 会起但永远收不到消息。改法 = 在共享 `perception_common.flag` 加 `--<flag>=<真实channel>`
   （§3.1），或改源码 `msg_adapter_gflags.cc` 后重编 install。
3. **out 与 fusion 撞 channel**：`/apollo/perception/obstacles` 也是 `multi_sensor_fusion` /
   `lidar_output` 的输出（01 篇 §2.5）。同时跑 msg_adapter + fusion 会双写同一 channel，离线调试时二选一。
4. **`/perception/inner/*` 永远看不了是正常现象**：传指针不序列化，`cyber_monitor` / `cyber_channel -e`
   都看不到内容（03 篇 §5-⑥），**这正是 msg_adapter 存在的原因**，不是故障。
5. **`offline_camera_detection.sh` 是整仓口径，本机路径错**：脚本硬编码
   `/apollo/bazel-bin/modules/perception/tools/offline_camera_detection/offline_camera_detection`
   （本机运行时**不读 bazel-bin**，见 CLAUDE.md §2）。要用需先 `buildtool build -p modules/perception/tools`
   完成 install，再直接跑 install 出的二进制；README 里 `./apollo.sh build perception` 同样不适用。
6. **搜 `/apollo/...` 用 `grep -R`**（`-r` 不跟随符号链接会假空，01/10 篇同款坑）。

## 6. 验证命令（只读）

```bash
# msg_adapter 结构与产物
ls -R /opt/apollo/neo/src/modules/perception/msg_adapter/          # 顶层 + common/convert/dag/launch
grep -n 'module_library\|class_name\|flag_file_path' /apollo/modules/perception/msg_adapter/dag/msg_adapter.dag
grep -n 'DEFINE_string' /opt/apollo/neo/src/modules/perception/msg_adapter/common/msg_adapter_gflags.cc  # 6 条
ls /opt/apollo/neo/lib/modules/perception/msg_adapter/             # 3 个 .so（可直接 mainboard -d）

# 内部消息可见性验证（前两个空、第三个有内容时即 adapter 生效）
cyber_channel -e /perception/inner/PrefusedObjects      # 空（传指针，不序列化）
cyber_channel -e /apollo/perception/obstacles           # adapter/fusion 输出后才有

# tools 工具族清单
ls /opt/apollo/neo/src/modules/perception/tools/{common,exporter,offline,offline_camera_detection}/
cat /opt/apollo/neo/src/modules/perception/tools/exporter/export_msg.config

# flag 加载机制（grep 定位，详见 component_base.h:83-91）
grep -rn 'flag_file_path' /opt/apollo/neo/src/cyber/component/component_base.h
```

## 7. 溯源

- 蒸馏日期：2026-09-08；基线 Apollo 11.0.0 package 工作区，profile = `ARCF_40P`。全程只读，未启动任何模块。
- **read 打开核对**：`msg_adapter_component.h`(:27,:38)、`msg_adapter_component.cc`(:24–52)、`msg_converter.h`(:52–70)、
  `convert/convert.h`(:33,:57,:81)、`convert/common.h`(:28)、`msg_adapter_gflags.cc`(:19–35)、`msg_adapter.dag`(:2,:5,:8)、
  `msg_adapter.launch`(:8)、`cyber/component/component_base.h`(:70–124)、`perception_inventory.md`(全)、
  `16_感知源码/01_总览与四大链路.md`(全)、`16_感知源码/10_本环境感知运行现状.md`(全)、`11_cyber框架/03_工具链实测.md`(全)、`_template.md`(全)。
- **bash 核对但未走 read（不引行号）**：msg_adapter 的 `README.md`/`BUILD`/`cyberfile.xml`；
  tools/common、exporter、offline、offline_camera_detection 各文件头注释与 `.sh`/`.config`。
- **grep 定位未逐行 read**：`flag_file_path` 在 `cyber/component/component_base.h` 的两处消费点（:83–91/:106–114 后已 read 前一处）。
- 遗留待核：① `mainboard` 是否接受命令行直接传 gflag（ParseArgument 未 read，本轮以 flagfile 为准）；
  ② msg_adapter 各转换分支实际频率与输出内容未实跑；③ tools/exporter、offline 工具在本机的实际可执行产物名与运行方式（未 buildtool 验证）。
