# 05 camera 族：六个相机子包

<!--
file: references/manual/16_感知源码/05_camera族.md
scope: 11.0（默认）
tags: perception, camera, camera_detection_multi_stage, camera_detection_single_stage, camera_detection_bev, camera_location_estimation, camera_location_refinement, camera_tracking, BaseObstacleDetector, YoloObstacleDetector, Yolox3DObstacleDetector, OMTObstacleTracker, Registerer, 零插件, 3d-r4-half_caffe, yolox3d_onnx, PrefusedObjects, 相机链路, channel
sources（本轮 read 打开，行号可引）:
- /opt/apollo/neo/src/modules/perception/camera_detection_multi_stage/camera_detection_multi_stage_component.h（全 84 行）
- /opt/apollo/neo/src/modules/perception/camera_detection_multi_stage/camera_detection_multi_stage_component.cc（全 142 行）
- /opt/apollo/neo/src/modules/perception/common/interface/base_obstacle_detector.h（全 93 行）
- /opt/apollo/neo/src/modules/perception/camera_detection_multi_stage/conf/camera_detection_multi_stage_{front,yolox3d,rear}_config.pb.txt（各 12 行）
- /opt/apollo/neo/src/modules/perception/camera_detection_multi_stage/dag/camera_detection_multi_stage_{front,yolox3d}.dag（各 14 行）
- /opt/apollo/neo/src/modules/perception/camera_detection_multi_stage/data/yolo.pb.txt（全 142 行）
- /opt/apollo/neo/src/modules/perception/camera_detection_multi_stage/data/yolox3d.pb.txt（全 119 行）
- /opt/apollo/neo/src/modules/perception/camera_tracking/camera_tracking_component.cc（全 133 行）
- <skills>/apollo-dev/references/manual/11_cyber框架/04_时间戳与消息基建.md（140–174 行精读）
- /apollo_workspace/.manual_work/inventory/perception_inventory.md（全 242 行）、manual/16_感知源码/{01,02,10}.md（全）
- 其余为本轮 grep/cat/sed 证据（路径不引行号，见 §9）
-->

## 0. 一句话作用

camera 族 6 个子包 = **一条相机检测→定位→跟踪链**：`multi_stage`（2D+3D 检测）→ `location_estimation`（估 3D 位置）
→ `location_refinement`（地面约束精修）→ `camera_tracking`（OMT 跟踪，汇入融合）。`single_stage`（smoke）是
检测的备选实现，`bev`（PETR）是**未发布**的 6 相机 BEV 直出分支。六包**全部走 Registerer 通道（零插件）**，
链路内部通道 `/perception/inner/{Detection,location_estimation,location_refinement}` 用 `2` 后缀区分 rear。
机制基线见 [02 篇 §3.5](02_组件插件架构与子包骨架.md)、运行现状见 [10 篇](10_本环境感知运行现状.md)。

## 1. 六子包总表（目录 | 组件 | 输入/输出 channel | 职责 | 关键 conf | 取实例通道）

dag 只声明输入；输出在 conf。rear 版一律在 channel 名后加 `2`。channel 均带前导 `/`（例外见 §7④）。

| 子包 | 组件名（非限定） | 输入 channel（dag readers 或 conf） | 输出 channel（conf） | 一句话职责 | 关键 conf（`plugin_param`） | 取实例通道 |
|---|---|---|---|---|---|---|
| camera_detection_multi_stage | `CameraDetectionMultiStageComponent`（`Component<drivers::Image>`） | dag：`/apollo/sensor/camera/camera_front/image`（front/yolox3d）、`camera_rear/image`（rear） | `/perception/inner/Detection`（front/yolox3d）、`/perception/inner/Detection2`（rear） | 多阶段 2D 框 + 3D 信息检测（主用分支） | front/rear 选 `YoloObstacleDetector`→`yolo.pb.txt`；yolox3d 选 `Yolox3DObstacleDetector`→`yolox3d.pb.txt` | `BaseObstacleDetectorRegisterer`（Registerer） |
| camera_detection_single_stage | `CameraDetectionSingleStageComponent` | dag：`/apollo/sensor/camera/front_6mm/image` | `/perception/inner/Detection` | 单阶段检测（smoke，备选） | `SmokeObstacleDetector`→`smoke_config.pb.txt`（`smoke_torch` 权重）；备选 `CADDNObstacleDetector`→`caddn.pb.txt` | `BaseObstacleDetectorRegisterer`（Registerer，用 `common/interface` 的基类） |
| camera_detection_bev | `CameraDetectionBevComponent`（`Component<>`，无消息模板） | **conf `input_camera_channel_name` ×6**（`CAM_FRONT`/`CAM_FRONT_LEFT`/`CAM_FRONT_RIGHT`/`CAM_BACK`/`CAM_BACK_LEFT`/`CAM_BACK_RIGHT` 的 `/image`），dag 无 readers | **`/apollo/perception/obstacles`（直接对外）** | 6 相机 BEV 检测（PETR），直出融合级障碍物 | `BEVObstacleDetector`→`petr.pb.txt` | `BaseObstacleDetectorRegisterer`（Registerer，**自带 `interface/` 基类**，见 §6 注） |
| camera_location_estimation | `CameraLocationEstimationComponent` | dag：`/perception/inner/Detection`（base/front）、`Detection2`（rear） | `/perception/inner/location_estimation`（front）、`location_estimation2`（rear） | 由 2D 框 + 相机内外参估 3D 位置 | `MultiCueTransformer`→`data/config.pb.txt` | `BaseTransformerRegisterer`（Registerer） |
| camera_location_refinement | `CameraLocationRefinementComponent` | dag：`/perception/inner/location_estimation`（front）、`location_estimation2`（rear） | `/perception/inner/location_refinement`（front）、`location_refinement2`（rear） | 地面约束精修位置 | `LocationRefinerPostprocessor`→`location_refiner.pb.txt` + `OnlineCalibrationService`（在线标定） | `BasePostprocessorRegisterer` + `BaseCalibrationServiceRegisterer`（Registerer） |
| camera_tracking | `CameraTrackingComponent` | dag：`/perception/inner/location_refinement`（base/front）、`location_refinement2`（rear） | **`/perception/inner/PrefusedObjects`** | OMT 多目标跟踪，喂 fusion | `OMTObstacleTracker`→`omt.pb.txt`（内嵌 `TrackingFeatureExtractor`→`tracking_feature.pb.txt`） | `BaseObstacleTrackerRegisterer`（Registerer；内部 `BaseFeatureExtractorRegisterer`） |

六包 **module_library 均带 `_camera` 后缀**（如 `libcamera_detection_multi_stage_component_camera.so`，
dag 里写 `_camera`，不是无后缀名；本包内另有 `libDO_NOT_IMPORT_*.so`，dag 指的不是它）。

## 2. 取实例通道结论（承 02 篇 §3.5）

camera 族**零插件**：六包 conf 的 `plugin_param` 三段式与 lidar 一模一样，但取实例**全部走
`Base*Registerer::GetInstanceByName`**（Registerer 通道，实现与组件编进同一个 .so），因此六包
`interface/base_*.h` 里**没有 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN`、没有 `plugins.xml`、不产生
`cyber_plugin_index` 条目**。`cyber_plugin_index` 里 perception 的 14 条全是 lidar 家族（02 篇 §3.2）。
**一处例外**：`Yolox3DObstacleDetector` 内部 `CreateInstance<inference::Inference>(...)`，
camera 分支自身不注册插件、但**消费** lidar 侧那个 `onnx_multi_batch` 推理插件（yolox3d.pb.txt:8
`infer_plugin: "MultiBatchInference"`，02 篇 §3.5）。

六包 Registerer 基类清单（grep 定位，见 02 篇 §1 注释「camera_tracking/interface/ 3 个」）：
`BaseObstacleDetector`（multi_stage/single_stage 用 `common/interface/` 那份，bev 自带一份）、
`BaseTransformer`（location_estimation）、`BasePostprocessor`/`BaseCalibrationService`（location_refinement）、
`BaseObstacleTracker`/`BaseFeatureExtractor`/`BasePredictor`（camera_tracking）。

## 3. camera_detection_multi_stage 精读（主干 + conf）

**Component 主干**（`camera_detection_multi_stage_component.h/.cc`）：

- 类 `CameraDetectionMultiStageComponent final : public cyber::Component<drivers::Image>`（.h:33），
  单消息触发；成员 `detector_`（`shared_ptr<BaseObstacleDetector>`，.h:71）、`writer_`（`Writer<onboard::CameraFrame>`，.h:74）、
  `trans_wrapper_`（TF 外参，.h:75）。
- `Init()`（.cc:75-91）：`GetProtoConfig` 读 dag 的 `config_file_path` → `InitObstacleDetector` → `InitCameraFrame`
  → `InitTransformWrapper` → `node_->CreateWriter<onboard::CameraFrame>(conf.channel.output_obstacles_channel_name)`（.cc:89）。
- `InitObstacleDetector`（.cc:27-51）：取 conf `plugin_param{name,config_path,config_file}`，用
  `BaseObstacleDetectorRegisterer::GetInstanceByName(plugin_param.name())`（.cc:48）造 detector；
  相机内参从 `SensorManager::GetUndistortCameraModel(camera_name)` 取（.cc:38-45）。
- `Proc`→`InternalProc`（.cc:93-138）：填 `CameraFrame` → 从 TF 取 `camera2world`（失败 return false，.cc:121-126）
  → `detector_->Detect(frame)`（.cc:135）→ `Proc` 成功才 `writer_->Write`（.cc:97-99）。

**conf 三档**（`plugin_param.name` 决定 detector 选择，换算法=换 name，都是 Registerer）：

| dag | conf | plugin_param.name → config_file | 相机 | 输出 |
|---|---|---|---|---|
| `_front.dag` | `..._front_config.pb.txt` | `YoloObstacleDetector`→`yolo.pb.txt` | `camera_front` | `/perception/inner/Detection` |
| `_rear.dag` | `..._rear_config.pb.txt` | `YoloObstacleDetector`→`yolo.pb.txt` | `camera_rear` | `/perception/inner/Detection2` |
| `_yolox3d.dag` | `..._yolox3d_config.pb.txt` | `Yolox3DObstacleDetector`→`yolox3d.pb.txt` | `camera_front` | `/perception/inner/Detection` |

front conf 全文 12 行（.h 同构）：`camera_name:"camera_front"`(:1)、`plugin_param{name:"YoloObstacleDetector"
config_path:"perception/camera_detection_multi_stage/data" config_file:"yolo.pb.txt"}`(:3-7)、
`channel{output_obstacles_channel_name:"/perception/inner/Detection"}`(:9-11)、`gpu_id:0`(:12)。
**两个检测器的模型名是分水岭**：`yolo.pb.txt:2` = `3d-r4-half_caffe`（目录不存在，见 §7①）；
`yolox3d.pb.txt:2` = `yolox3d_onnx`（权重齐，且 :8 `infer_plugin:"MultiBatchInference"`）。

**dag 三兄弟**（front.dag 全文 14 行）：`module_library: "...libcamera_detection_multi_stage_component_camera.so"`(:2)、
`class_name:"CameraDetectionMultiStageComponent"`(:5)、`config_file_path:"/apollo/.../conf/...front_config.pb.txt"`(:8)、
`readers{channel:"/apollo/sensor/camera/camera_front/image"}`(:9-11)。yolox3d.dag 同构只换 conf 文件名；rear.dag 换 `camera_rear`。

## 4. camera_tracking 精读（主干 + conf + 输出）

**Component 主干**（`camera_tracking_component.cc` 全 133 行）：

- `Init()`（.cc:31-66）：读 conf → `output_channel_name_ = conf.output_channel_name()`（.cc:38）→
  `CreateWriter<onboard::SensorFrameMessage>`（.cc:39-40）→ `plugin_param.name()` 取 tracker 名 →
  `BaseObstacleTrackerRegisterer::GetInstanceByName(tracker_name)`（.cc:47，**nullptr 直接 AERROR+return false**，.cc:48-51，
  不像 lidar filter bank 静默降级）→ 填 `ObstacleTrackerInitOptions`（config_path/file、image 宽高、gpu_id）→ `tracker->Init()`。
- `Proc`/`InternalProc`（.cc:68-129）：`onboard::CameraFrame` → 复制 detected_objects/feature_blob → `tracker->Process(frame)`（.cc:102）
  → 取 `SensorInfo` → `frame->objects = tracking_frame->tracked_objects`（.cc:125）→ 输出 `SensorFrameMessage`。

**conf（tracker 选择 + 特征提取）**（`cat` 核对，路径不引行号）：

- `camera_tracking_config.pb.txt`（base/front/rear 三份同构）：`output_channel_name:"/perception/inner/PrefusedObjects"`、
  `plugin_param{name:"OMTObstacleTracker" config_path:"perception/camera_tracking/data" config_file:"omt.pb.txt"}`、
  `image_width:1920 image_height:1080 gpu_id:0`。
- `data/omt.pb.txt`：跟踪参数（`lost_age`/`reserve_age`、同/跨相机关联权重 `weight_same/diff_camera`、
  `target_param{}` 速度/方差/滤波窗）**内嵌一段** `plugin_param{name:"TrackingFeatureExtractor"
  config_file:"tracking_feature.pb.txt"}`（OMT 内部再走 `BaseFeatureExtractorRegisterer` 取外观特征提取器）。
- `data/tracking_feature.pb.txt`：`feat_blob_name:"conv4_3"` + `extractor{feat_type:ROIPooling roi_pooling_param{pooled 3x3}}`
  —— **纯 ROIPooling，无外部权重文件**（区别于孤儿 `project_feature.pb.txt` 的 `feature_caffe`，10 篇 §2.2）。
- 输出 channel `/perception/inner/PrefusedObjects` 由 **fusion 的 dag 消费**（01 篇 §2.2）。

## 5. 帧级数据流（front 链；rear 同名换 `camera_rear` + channel 加 `2` 后缀）

```
/apollo/sensor/camera/camera_front/image            （multi_stage 的 dag readers，:10）
  → camera_detection_multi_stage(_front/_yolox3d)  → /perception/inner/Detection   （conf output）
  → camera_location_estimation(_front)             → /perception/inner/location_estimation
  → camera_location_refinement(_front)             → /perception/inner/location_refinement
  → camera_tracking(_front)                        → /perception/inner/PrefusedObjects
        → multi_sensor_fusion                      → /apollo/perception/obstacles ⇒ prediction
```

每级 channel 名（dag `readers` 上一级输出 / conf `output_*_channel_name` 本级输出）：
`Detection`（multi_stage front/yolox3d 出）→ `location_estimation`（estimation 出）→
`location_refinement`（refinement 出）→ `PrefusedObjects`（tracking 出）。
rear 版：`Detection2` → `location_estimation2` → `location_refinement2` →（tracking 仍出同一个 `PrefusedObjects`，
front/rear 两路 camera_tracking 合并写同一 channel）。`single_stage` 也出 `/perception/inner/Detection`
（与 multi_stage 同 channel，二者二选一，别同起）。`bev` 是**旁路**：6 相机直出 `/apollo/perception/obstacles`，
不经过 estimation/refinement/tracking（见 §1 表）。

## 6. 修改与扩展点（4 个）

**① 新增相机 detector（本族最典型扩展）**：相机 detector 走 Registerer，**不用 plugins.xml**。
1. 在 `camera_detection_multi_stage/detector/<my_det>/` 新建目录（先 `buildtool install perception-camera-detection-multi-stage`
   把包源码拉进 `/apollo_workspace`），写 `.h/.cc`，继承 `common/interface/base_obstacle_detector.h` 的
   `BaseObstacleDetector`（实现 `Init`/`Detect`/`Name` 三纯虚，base_obstacle_detector.h:53/62/68），
   实现末尾写 `REGISTER_OBSTACLE_DETECTOR(MyDet)`（宏在 base_obstacle_detector.h:88-89）。
2. 加进包 `BUILD` 的 `srcs`（与组件同一 .so，`apollo_component` 保证 alwayslink，别手写 `cc_library`）。
3. 建 `data/my_det.pb.txt`（`info{name:"<模型目录>" proto_file/weight_file ...}`，参照 `yolo.pb.txt`/`yolox3d.pb.txt`）。
4. conf 的 `plugin_param.name` 改成 `MyDet`（短名即可）。
5. `buildtool build -p modules/perception/camera_detection_multi_stage`（**必须 install 才生效**）。

**② 新增相机 transformer / postprocessor / tracker**：同 ①，分别继承 `camera_location_estimation/interface/base_transformer.h`、
`camera_location_refinement/interface/base_postprocessor.h`、`camera_tracking/interface/base_obstacle_tracker.h`
（各 `PERCEPTION_REGISTER_REGISTERER(Base*)` + 配套 `PERCEPTION_REGISTER_<X>`），改对应 conf 的 `plugin_param.name`。

**③ 只换检测器/调参（不写代码）**：改 `/apollo/modules/perception/<pkg>/conf/*.pb.txt` 或 `data/*.pb.txt`（软链，立即生效，
先 `readlink -f` 判落点 profile/share）。multi_stage 换 yolox3d = 把 front/rear conf 的 `name` 改成
`Yolox3DObstacleDetector`（或直接改 dag 指向 yolox3d.dag），见 §7①。

**④ 加一路相机输入**：bev 是现成多相机样板——`CameraDetectionBevComponent` 是 `Component<>`（无消息模板），
`InitListeners` 按 conf 的 `input_camera_channel_name`（repeated）逐个 `CreateReader<drivers::Image>` 存进
`std::vector<Reader<drivers::Image>> readers_`；dag 里**不写 readers**。加相机 = conf 里加一行 `input_camera_channel_name`。

## 7. ⚠️ 本环境注意

1. **`perception_all.launch` 的前/后视相机检测预期起不来**（本族最重一条）：`perception_all` 里 camera 链挂的是
   `_front`/`_rear` dag，其 conf 选中 `YoloObstacleDetector`→`yolo.pb.txt:2` = **`3d-r4-half_caffe`**，
   该模型目录在 `/apollo/modules/perception/data/models/` **不存在**（10 篇 §2.2）→ 检测组件 Init 失败/无输出，
   后接 estimation/refinement/tracking 空转。**改用 `perception_camera_multi_stage.launch`**（profile 聚合 launch，
   `cyber_launch start /apollo/modules/perception/launch/perception_camera_multi_stage.launch`）：它走 `_yolox3d` 检测
   （`yolox3d_onnx` 权重齐，10 篇 §4 表），并把 `_front` 那条注释掉。**用哪个 launch 决定用哪个 detector**，别在
   `perception_all` 里硬追 `3d-r4-half_caffe`。
2. **`camera_detection_bev` 整包未发布**：`/opt/apollo/neo/share/modules/perception/camera_detection_bev` 与
   `/apollo/modules/perception/camera_detection_bev` **整个目录都不存在**（src/include/lib 有，share/④ 层无，
   比盘点表「只缺 dag」更严重，10 篇 §6①）→ 无法用 `/apollo/...` 绝对路径启动 BEV；要跑得先
   `buildtool build -p modules/perception/camera_detection_bev` 补 install。
3. **`.so` 真名带 `_camera` 后缀**：dag 的 `module_library` 是 `libcamera_*_component_camera.so`，不是 `libcamera_*_component.so`；
   同目录还有 `libDO_NOT_IMPORT_*.so`（install 布局重复件），`mainboard` 报 `Failed to load library` 时按 dag 原文核对，
   别猜名（10 篇 §7-B）。
4. **相机 channel 无前导斜杠的命名破例**：11 篇 §2.2 命名词表记 `adapter_gflags.cc:166-167` 的相机默认 topic 是
   **`camera/image_raw`（连前导 `/` 都没有）**，源码 :165 自带 `// TODO(Authors): Change the topic name`（11 篇 §2.2:149）。
   这是 **common_msgs 的 gflag 默认值**，不是 perception 实际读的通道——perception 相机 dag 一律用
   `/apollo/sensor/camera/<名>/image`（带前导 `/`），别把两者混为一谈；但也别看到 `camera/image_raw` 就当成笔误去「修正」。
5. **conf 落点先 `readlink -f`**：camera 链 conf/dag 大量落在 profile 覆盖层（`ARCF_40P`），不是一律 share
   （02 篇 §5-3）。改 `/apollo_workspace/modules/perception/...`（① 层）不重编绝不生效。
6. **零插件 ≠ 没得换**：camera 族换 detector/transformer/tracker 是改 conf `plugin_param.name` + 编译，不是加 plugins.xml；
   排查「相机插件加载失败」在 camera 族方向是错的（没有插件可加载）。唯一插件接触点是 yolox3d 消费
   `onnx_multi_batch`（§2），其 .so 与索引都在（02 篇 §3.2）。

## 8. 验证命令（只读）

```bash
# 六包 dag 的输入 channel（-R 跟随符号链接）
grep -Rn 'channel' /apollo/modules/perception/camera_*/dag/*.dag
# 六包 conf 的输出 channel 与 plugin_param 选择
grep -Rn 'output.*channel_name\|plugin_param\|name:' /apollo/modules/perception/camera_*/conf/*.pb.txt
# 某个相机 detector 选的模型目录是否存在（multi_stage 关键判据）
grep -A3 'info' /apollo/modules/perception/camera_detection_multi_stage/data/yolo.pb.txt | head
ls -la /apollo/modules/perception/data/models/3d-r4-half_caffe/     # 不存在 = perception_all 相机链起不来
ls -la /apollo/modules/perception/data/models/yolox3d_onnx/         # 有权重 = yolox3d 链可起
# camera_tracking 的 tracker + 特征提取器选择
cat /apollo/modules/perception/camera_tracking/data/omt.pb.txt
# bev 包发布状态
ls -d /opt/apollo/neo/{src,include,share,lib}/modules/perception/camera_detection_bev
# 相机聚合链启动入口（profile 层，不启动仅确认存在）
ls -l /apollo/modules/perception/launch/perception_camera_multi_stage.launch
readlink -f /apollo/modules/perception/launch/perception_camera_multi_stage.launch
# 相机 .so 真名（注意 _camera 后缀）
grep module_library /apollo/modules/perception/camera_detection_multi_stage/dag/camera_detection_multi_stage_yolox3d.dag
```

## 9. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线 Apollo 11.0.0 包工作区，profile = `ARCF_40P`。**全程只读，未启动任何模块**。
- **read 打开核对（行号可引）**：见 front-matter `sources`。关键行号出处：multi_stage 组件 `Component<drivers::Image>`(.h:33)、
  `GetInstanceByName`(.cc:48)、`CreateWriter`(.cc:89)、`Detect`(.cc:135)；`BaseObstacleDetector` 三纯虚与
  `REGISTER_OBSTACLE_DETECTOR`（common/interface/base_obstacle_detector.h:53/62/68/88-89）；三档 conf 与 yolo/yolox3d.pb.txt；
  tracking `GetInstanceByName`(.cc:47)、`CreateWriter`(.cc:39-40)、`Process`(.cc:102)；11_cyber/04 命名词表(140-174)。
- **grep/cat/sed 证据（路径不引行号）**：六包 dag `readers.channel`/`class_name`/`module_library` 全量；六包 conf
  `plugin_param{name,...}` 与 `output_*_channel_name` 全量；`omt.pb.txt`、`tracking_feature.pb.txt` 全文；六包
  `interface/base_*.h` 的 `PERCEPTION_REGISTER_REGISTERER`；bev 组件 `Component<>` + `vector<Reader> readers_`（sed）；
  single_stage 无 `interface/`、include `common/interface/base_obstacle_detector.h`。
- **与盘点表差异**：`camera_detection_single_stage` 的 `interface/` 判 Y（盘点 §1），实测**无本地 `interface/`**，
  复用 `common/interface/base_obstacle_detector.h`；`camera_detection_bev` 则**自带一份**同名 `interface/base_obstacle_detector.h`
  （namespace 相同、类同名，是平行副本，别改错份）。
- **遗留待核**：① 六包各自实测频率与「预期可起」均未运行验证；② bev 的 `petr.pb.txt` 模型名与权重存在性本轮未读；
  ③ location_estimation/refinement/single_stage/bev 组件 `.cc` 主干的逐行行号未 read（只 grep 到 `GetInstanceByName` 行）；
  ④ `.onnx`（yolox3d）运行期实际走 TensorRT 还是 onnxruntime（10 篇 §5 待核）。
