# 07 radar_detection / lane_detection / motion_service 三子包

<!--
file: references/manual/16_感知源码/07_radar_lane_motion.md
scope: 11.0（默认）
tags: radar_detection, lane_detection, motion_service, radar, 车道线, 运动服务, PrefusedObjects, /perception/lanes, /apollo/perception/motion_service, dag无readers, 模型缺失, perception_all
sources:
- /opt/apollo/neo/src/modules/perception/radar_detection/radar_detection_component.cc（全文 229 行）
- /opt/apollo/neo/src/modules/perception/radar_detection/radar_detection_component.h（全文 90 行）
- /opt/apollo/neo/src/modules/perception/radar_detection/conf/{front,rear}_radar_detection_config.pb.txt（各全文 15 行）
- /opt/apollo/neo/src/modules/perception/radar_detection/dag/{radar_detection.dag,radar_detection_front.dag}（全文）
- /opt/apollo/neo/src/modules/perception/lane_detection/lane_detection_component.cc（全文 829 行，重点 186-577）
- /opt/apollo/neo/src/modules/perception/lane_detection/lane_detection_component.h（全文 187 行）
- /opt/apollo/neo/src/modules/perception/lane_detection/conf/lane_detection_config.pb.txt（全文 23 行）
- /opt/apollo/neo/src/modules/perception/lane_detection/data/{lane.pb.txt,config_darkSCNN.pb.txt,config_denseline.pb.txt}（全文）
- /opt/apollo/neo/src/modules/perception/lane_detection/dag/lane_detection.dag（全文 11 行）
- /opt/apollo/neo/src/modules/perception/motion_service/motion_service_component.{cc,h}（全文 234/86 行）
- /opt/apollo/neo/src/modules/perception/motion_service/conf/motion_service_config.pb.txt（全文 4 行）
- /opt/apollo/neo/src/modules/perception/motion_service/dag/motion_service.dag（全文 11 行）
- /apollo_workspace/profiles/ARCF_40P/modules/perception/launch/perception_all.launch（全文 46 行）
- <skills>/apollo-dev/references/manual/16_感知源码/01_总览与四大链路.md（引 §2.5/§3 边界）
- <skills>/apollo-dev/references/manual/16_感知源码/10_本环境感知运行现状.md（引 §2.2 模型缺失清单）
-->

## 0. 一句话作用

本文件讲感知三条**结构级旁链**（不在 PnC 主链上）：`radar_detection`（毫米波目标 → 障碍物）、
`lane_detection`（相机 → 车道线）、`motion_service`（定位 → 车辆运动服务）。三条链的共同点：
**dag 不声明 readers 或只声明一半输入，真正的输入/输出 channel 由 conf 或组件内部 `CreateReader` 决定**，
因此「看 dag 判断输入输出」会误判。三者在 `perception_all.launch` 里**只有 radar 挂载**，lane/motion 都不挂。

## 1. 三子包总表

| 目录 | 组件名 | 输入 channel | 输出 channel | 一句话职责 | 关键 conf | 取实例通道 |
|---|---|---|---|---|---|---|
| radar_detection | `RadarDetectionComponent` | `/apollo/sensor/radar/front`（front dag:10）/ `rear`（radar_detection.dag:22）；另读 `/apollo/localization/pose`（conf:14） | `/perception/inner/PrefusedObjects`（conf:15，`SensorFrameMessage`） | 毫米波 ContiRadar 目标 → 补偿/ROI/检测 → PrefusedObjects | front/rear_radar_detection_config.pb.txt | **Registerer**（`BasePreprocessorRegisterer`/`BaseRadarObstaclePerceptionRegisterer`） |
| lane_detection | `LaneDetectionComponent` | `/apollo/sensor/camera/front_6mm/image,/apollo/sensor/camera/front_12mm/image`（conf:2）；另读 `/apollo/perception/motion_service`（.cc:548） | `/perception/lanes`（conf:13，`PerceptionLanes`） | 双相机车道线检测+在线标定，发 `/perception/lanes` | lane_detection_config.pb.txt + data/lane.pb.txt | Registerer（`LaneCameraPerception`，conf:5） |
| motion_service | `MotionServiceComponent` | `/apollo/sensor/camera/front_6mm/image`（conf:2）+ `/apollo/localization/pose`（conf:3） | `/apollo/perception/motion_service`（conf:4，`MotionService`） | 由定位速度/角速度累积两帧间运动，供 lane 标定用 | motion_service_config.pb.txt | 无插件（直接 `new PlaneMotion`，.cc:35） |

> 三包均无 `cyber_plugin_index` 条目（radar/lane/motion 分支「零插件」，走 Registerer 或裸 new，
> 与 02 篇 §3.5 结论一致）。三者的 `CYBER_REGISTER_COMPONENT` 均在各自 `*_component.h` 末尾
> （radar:86 / lane:183 / motion:82）。

## 2. radar_detection：毫米波目标 → PrefusedObjects

**组件主干**（`radar_detection_component.cc`）：
- 外壳 `cyber::Component<ContiRadar>`（.h:42），收到 `apollo::drivers::ContiRadar` 即触发 `Proc`（.cc:63）。
- `Init`：`GetProtoConfig` 读 dag 的 conf → 取 `tf_child_frame_id`/`radar_forward_distance`/`odometry_channel_name`
  → `SensorManager::GetSensorInfo(radar_name)`（.cc:41）→ `CreateWriter<SensorFrameMessage>(output_channel_name)`（.cc:48）
  → `InitAlgorithmPlugin`（.cc:52）。
- `InitAlgorithmPlugin`（.cc:76-106）：`preprocessor_param.name`→`BasePreprocessorRegisterer::GetInstanceByName`
  （:88）、`perception_param.name`→`BaseRadarObstaclePerceptionRegisterer::GetInstanceByName`（:99-100），
  **失败走 `CHECK_NOTNULL` 直接崩**（Registerer 通道，与 02 篇 §3.1 表一致）。
- `InternalProc`（.cc:108-190）：preprocess 去噪 → `GetSensor2worldTrans`/`GetTrans` 取 TF（:138-149，失败置
  `PERCEPTION_ERROR_TF`）→ `GetCarLocalizationSpeed`（:155，从定位 buffer 取车速）→ 可选 HDMap ROI（:168-171）
  → `radar_perception_->Perceive`（:175）→ 打包 `SensorFrameMessage`（`process_stage_=LONG_RANGE_RADAR_DETECTION`，:129-130）。

**conf**（`front_radar_detection_config.pb.txt` 全文 15 行）：
```protobuf
radar_name: "radar_front"          # rear 版 = "radar_rear"，forward_distance 120
tf_child_frame_id: "radar_front"
radar_forward_distance: 200.0
preprocessor_param { name: "ContiArsPreprocessor"   config_path: "perception/radar_detection/data" config_file: "preprocessor.pb.txt" }
perception_param   { name: "RadarObstaclePerception" config_path: "perception/radar_detection/data" config_file: "radar_obstacle_perception.pb.txt" }
odometry_channel_name: "/apollo/localization/pose"
output_channel_name: "/perception/inner/PrefusedObjects"
```

**dag readers 原文**：`radar_detection_front.dag` 单组件 `FrontRadarDetection`，`readers { channel: "/apollo/sensor/radar/front" }`（:10）；
`radar_detection.dag` 同库挂两个 component：`FrontRadarDetection`（readers `/apollo/sensor/radar/front`，:10）+
`RearRadarDetection`（readers `/apollo/sensor/radar/rear`，:22）。`module_library: "modules/perception/radar_detection/libradar_detection.so"`。
定位不是 dag reader，而是组件内部 `MsgBuffer<LocalizationEstimate>`（.h:82）按时间戳 `LookupNearest` 取（.cc:207）。

## 3. lane_detection：双相机车道线 + 在线标定

**组件主干**（`lane_detection_component.cc`）：外壳 **`cyber::Component<>`（无模板参数，.h:54）**，不靠 dag readers 收图，
而是在 `InitCameraListeners`（.cc:563-577）对每个相机 `node_->CreateReader(channel_name, ...)` 手动订阅。
- `Init`（.cc:186-231）：`InitConfig` → `CreateWriter<PerceptionLanes>(output_lanes_channel_name_)`（:192）→ 依次跑
  `init_func_arry_[]`（.cc:50-55，`InitSensorInfo`/`InitCameraFrames`/`InitProjectMatrix`/`InitMotionService`/`InitCameraListeners`）。
- `InitConfig`（.cc:327-398）：读 conf，`camera_names` 与 `input_camera_channel_names` 逗号拆分后**个数必须相等且=2**（:338-352），
  `detection_param` 三段式喂给 `LaneCameraPerception`。
- `InitMotionService`（.cc:547-561）：**硬编码**订阅 `/apollo/perception/motion_service`（:548）→ `OnMotionService` 存进 `mot_buffer_`。
- `OnReceiveImage`（.cc:274）→ `InternalProc`（.cc:585）：取相机 TF → `camera_lane_pipeline_->Perception`（:642）→ `MakeProtobufMsg`
  → `writer_->Write(lanes_msg)`（:698）。

**conf**（`lane_detection_config.pb.txt` 全文 23 行，关键字段）：
```protobuf
camera_names: "front_6mm,front_12mm"
input_camera_channel_names: "/apollo/sensor/camera/front_6mm/image,/apollo/sensor/camera/front_12mm/image"
detection_param { name: "LaneCameraPerception" config_path: "perception/lane_detection/data/" config_file: "lane.pb.txt" }
output_lanes_channel_name: "/perception/lanes"
```
即 **lane 的输入相机是 conf 的 `input_camera_channel_names`，不是 dag**（dag 无 readers）。输出 `/perception/lanes`，
类型 `apollo::perception::PerceptionLanes`（.h:172）。

### 3.1 ⚠️ 模型依赖风险：两个候选模型目录都不存在

`data/lane.pb.txt` 实际选中 **`DarkSCNNLaneDetector`**（front_6mm 与 front_12mm 两段，:5/:21）→ 读
`config_darkSCNN.pb.txt`，其 `model_param.model_name: "darkSCNN_caffe"`（:2）。另一候选 `config_denseline.pb.txt`
`model_name: "denseline_caffe"`（:2）当前**未被 lane.pb.txt 选中**。

现场核对：`/apollo/modules/perception/data/models/{darkSCNN_caffe,denseline_caffe}` **均 No such file or directory**。
这两个是 10 篇 §2.2「conf 引用但目录根本不存在的 5 个模型名」之一（其余 3 个：`3d-r4-half_caffe`、`caddn_paddle`、`feature_caffe`）。
**结论：`lane_detection.dag` 预期 Init 阶段失败**（选中的 darkSCNN 权重目录不存在），与 10 篇 §3 表「lane 预期失败」一致。
补法：`apt-cache search perception-model` → `buildtool install perception-model-<名>`，或改 `lane.pb.txt` 的 `plugin_param` 换回有权重档（暂无）。

## 4. motion_service：定位 → 车辆运动服务

**组件主干**（`motion_service_component.cc`）：外壳 **`cyber::Component<>`（.h:44）**，`Init`（.cc:33-81）手动建三路：
- `CreateReader(输入相机)`（:65，取 `input_camera_channel_names_[0]`）→ `OnReceiveImage` 只记 `camera_timestamp_`（:90）。
- `CreateReader(input_localization_channel_name)`（:73）→ `OnLocalization`（.cc:95-161）算 `VehicleStatus`（速度/三轴角速度）+
  两帧 `timestamp_diff`，按 camera 时间戳与 `PlaneMotion::ACCUM/ACCUM_PUSH/RESET` 累积运动（:143-156）。
- `CreateWriter<MotionService>(output_topic_channel_name)`（:77）。
- `PublishEvent`（.cc:165-183）：把 `PlaneMotion` buffer 反转成 `MotionService` 消息写出。
- 无插件、无 conf `plugin_param`：`vehicle_planemotion_ = new PlaneMotion(motion_buffer_size_)`（:35）。

**conf**（`motion_service_config.pb.txt` 全文 4 行）：
```protobuf
camera_names: "front_6mm"
input_camera_channel_names: "/apollo/sensor/camera/front_6mm/image"
input_localization_channel_name: "/apollo/localization/pose"
output_topic_channel_name: "/apollo/perception/motion_service"
```
输出 `/apollo/perception/motion_service`（类型 `apollo::perception::MotionService`）。**PnC 不订阅**这条 channel：
01 篇 §2.5 标「对外但 PnC 不订」、§3 边界铁律只认 `/apollo/perception/obstacles` 与 `/apollo/perception/traffic_light`。
它唯一已知消费方是 lane_detection 的 `InitMotionService`（本文件 §3）。

## 5. ⚠️ 三条链在 perception_all.launch 的挂载情况

现场 read 全文 46 行（`/apollo_workspace/profiles/ARCF_40P/modules/perception/launch/perception_all.launch`）：

| 链 | perception_all 是否挂 | 位置 |
|---|---|---|
| radar_detection | ✅ 挂 | `:27` `<dag_conf>.../radar_detection/dag/radar_detection_front.dag</dag_conf>`（只 front，不含 rear 那条） |
| lane_detection | ❌ 不挂 | 全文无 `lane_detection` 引用 |
| motion_service | ❌ 不挂 | 全文无 `motion_service` 引用 |
| camera_detection_bev | ❌ 不挂 | 全文无引用（且整包未发布，见 10 篇 §6①） |

即：**lane 与 motion 是「存在但默认不参与」的旁链**——`perception_all` 拉起 19 个感知 dag 时既不起 lane 也不起 motion，
因此 `motion_service` 无发布者、lane 无输入也无人起（起 lane 前必须先单独起 motion_service 供其标定）。
`perception_radar.launch`（profile 聚合）只含 `radar_detection_front` + msg_adapter。

**输入来源待核项**（引 01 篇 §7 遗留待核）：
- `lane_detection` 输入相机来源**已由本文件澄清** = conf `input_camera_channel_names`（front_6mm/front_12mm），dag 无 readers 属正常形态。
- `camera_detection_bev` 输入来源**仍待核**（其 dag 无 readers，本文件未读其 conf/组件）。

## 6. 修改与扩展点（4 个）

**① radar：换输入 radar channel / 换检测实现**
- 换雷达源：改 `/apollo/modules/perception/radar_detection/dag/radar_detection_front.dag` 的 `readers.channel`
  （软链，立即生效）。front/rear 各一份 conf，换参数改 `front|rear_radar_detection_config.pb.txt` 的
  `radar_name`/`radar_forward_distance`/`output_channel_name`。
- 换算法：改 conf 的 `preprocessor_param.name`/`perception_param.name`（Registerer 通道，短名即可，
  `ConfigUtil::GetFullClassName` 补 `apollo::perception::radar::`）。

**② lane：装模型 / 换输入相机**
- 让 lane 能起：先补 `darkSCNN_caffe`（`buildtool install perception-model-darkSCNN-caffe`，名称以
  `apt-cache search perception-model` 为准）；或改 `lane.pb.txt` 换 `DenselineLaneDetector` 并补 `denseline_caffe`。
- 换相机：改 `lane_detection_config.pb.txt` 的 `camera_names` 与 `input_camera_channel_names`（**必须同为 2 路且对齐**）。
- 改输出：`output_lanes_channel_name`。

**③ motion：改输入/输出 channel**
- 全在 `motion_service_config.pb.txt`（4 行）：`input_camera_channel_names` / `input_localization_channel_name` /
  `output_topic_channel_name`。注意 `camera_names` 与 `input_camera_channel_names` 个数一致（.cc:53-57 校验）。

**④ 把 lane/motion 挂进聚合启动**
- 编辑 `/apollo_workspace/profiles/ARCF_40P/modules/perception/launch/perception_all.launch`（或新建聚合），
  在 `<dag_conf>` 区追加 `lane_detection/dag/lane_detection.dag` 与 `motion_service/dag/motion_service.dag`
  （motion 需排在 lane 之前，否则 lane 标定拿不到运动）。改完 `cyber_launch start <该 launch 绝对路径>`。
- 单起：`mainboard -d /apollo/modules/perception/<pkg>/dag/<x>.dag`。

## 7. 验证命令（只读）

```bash
# 三包 conf/dag 落点（本环境实测：radar conf→profile、radar dag→share；lane/motion conf+dag→share）
for f in radar_detection/conf/front_radar_detection_config.pb.txt radar_detection/dag/radar_detection_front.dag \
         lane_detection/conf/lane_detection_config.pb.txt lane_detection/dag/lane_detection.dag \
         motion_service/conf/motion_service_config.pb.txt motion_service/dag/motion_service.dag; do
  readlink -f /apollo/modules/perception/$f; done

# dag 声明的输入（radar 有 readers，lane/motion 无）
grep -n 'channel' /apollo/modules/perception/radar_detection/dag/radar_detection_front.dag
grep -c 'readers' /apollo/modules/perception/{lane_detection,motion_service}/dag/*.dag   # 0 0

# conf 里的真实输入/输出（lane/motion 的输入在 conf，不在 dag）
grep -nE 'channel|_name' /apollo/modules/perception/lane_detection/conf/lane_detection_config.pb.txt
grep -nE 'channel' /apollo/modules/perception/motion_service/conf/motion_service_config.pb.txt

# lane 模型目录是否存在（应 No such file or directory）
ls -la /apollo/modules/perception/data/models/darkSCNN_caffe /apollo/modules/perception/data/models/denseline_caffe

# 三条链在 perception_all 的挂载
grep -nE 'radar|lane_detection|motion_service|bev' /apollo/modules/perception/launch/perception_all.launch
```

## 8. 溯源

- 蒸馏日期：2026-09-08；基线 Apollo 11.0.0 package 工作区，profile = `ARCF_40P`。全程只读，未启动任何模块。
- **read 打开核对过的文件（行号可引）**：本文件 front-matter `sources` 17 项——radar 的 component.{cc,h}、
  front/rear conf、两个 dag；lane 的 component.{cc,h}、conf、lane.pb.txt、config_darkSCNN/config_denseline.pb.txt、dag；
  motion 的 component.{cc,h}、conf、dag；`perception_all.launch`（全文 46 行）；01 篇、10 篇（引边界/模型清单）。
- **bash 实测（非行号引用）**：三包 conf/dag `readlink -f` 落点（radar conf 在 profile 覆盖层，其余在 share）；
  `darkSCNN_caffe`/`denseline_caffe` 目录 `ls` 确认不存在；`grep` perception_all 确认 lane/motion/bev 无引用、
  radar 只在 `:27`。
- **遗留待核**：① `camera_detection_bev` 的输入来源（dag 无 readers，未读其 conf/组件）；
  ② `perception_radar.launch` 之外是否有其它聚合 launch 挂 rear radar（未逐一核）；
  ③ lane/motion 运行期频率与「预期 Init 失败」未实跑验证。
