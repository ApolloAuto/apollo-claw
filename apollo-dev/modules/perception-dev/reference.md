# Apollo perception 参考手册

配套 `SKILL.md`。本文件只放速查表与高危坑，操作步骤看 SKILL.md。

## 1. lidar 链路 11 个模块速查

| # | Component 类名 | 输入 channel（dag `readers`） | 输出 channel（conf） | 插件槽位（默认值 / 备选） | 机制 |
|---|---|---|---|---|---|
| 1 | `PointCloudPreprocessComponent` | `/apollo/sensor/velodyne64/compensator/PointCloud2` | `/perception/lidar/pointcloud_preprocess` | `BasePointCloudPreprocessor`：`PointCloudPreprocessor`（仅此一个） | A |
| 2 | `PointCloudMapROIComponent` | 上一级输出 | `/perception/lidar/pointcloud_map_based_roi` | `BaseROIFilter`：`HdmapROIFilter` / `ROIServiceFilter` | **B** |
| 3 | `PointCloudGroundDetectComponent` | 上一级输出 | `/perception/lidar/pointcloud_ground_detection` | `BaseGroundDetector`：`SpatioTemporalGroundDetector` / `GroundServiceDetector`（**索引语义不兼容**）| A |
| 3a | `PointCloudSemanticComponent` | `/perception/lidar/pointcloud_map_based_roi` | `/perception/lidar/pointcloud_semantic` | `BasePointCloudParser`：`PointWiseUnet` | A |
| 3b | `PointCloudMotionComponent` | `/perception/lidar/pointcloud_semantic` | `/perception/lidar/pointcloud_motion` | `BaseMotionParser`：`MotionUnet` | A |
| 4 | `LidarDetectionComponent` | `/perception/lidar/pointcloud_ground_detection` | `/perception/lidar/detection` | `BaseLidarDetector`：`CenterPointDetection` / `PointPillarsDetection` / `MaskPillarsDetection` / `CNNSegmentation`（后三个在 conf 里被注释） | A |
| 4' | `LidarCPDetectionComponent` | 同上（与 4 二选一） | `/perception/lidar/detection` | `BaseCPDetector`：`CPDetection` | A |
| 4a | `LidarSegmentationComponent` | `/perception/lidar/detection` | `/perception/lidar/segmentation` | 复用 `BaseLidarDetector`：`GraphSegmentation` / `NCutSegmentation` | A |
| 5 | `LidarDetectionFilterComponent` | `/perception/lidar/detection` | `/perception/lidar/detection_filter` | `BaseObjectFilter` 列表：`ROIBoundaryFilter`, `StrategyFilter`（`BackgroundFilter` 未启用） | **B** |
| 6 | `LidarTrackingComponent` | `/perception/lidar/detection_filter` | `/perception/inner/PrefusedObjects` | `BaseMultiTargetTracker`：`MlfEngine` | A |
| 7 | `LidarOutputComponent` | `/perception/inner/PrefusedObjects` | `/apollo/perception/obstacles` | — | — |

检测器子槽 `BaseDownSample`（**B**）：默认 `PclDownSample`（`lidar_detection/down_sample_bank/pcl_down_sample/`），备选 `GpuDownSample`（`perception_plugin/lidar_detection/gpu_down_sample/`）、`PclPCDownSample`（cpdet 用）。

跟踪子槽（全 A）：`BaseBipartiteGraphMatcher`（`GnnBipartiteGraphMatcher` ×2 / `MultiHmBipartiteGraphMatcher`，配在 `data/tracking/mlf_track_object_matcher.conf`）、`MlfBaseFilter` 有序链（`data/tracking/mlf_tracker.conf:1-4`：`MlfTypeFilter` → `MlfDirectionFilter` → `MlfShapeFilter` → `MlfMotionFilter`）、`BaseSingleShot/MultiShotTypeFusion`（`CCRFSingleShotTypeFusion` / `CCRFMultiShotTypeFusion`，配在 `mlf_type_filter.conf`）。`fusion_classifier_param`（`FusedClassifier`）在 `lidar_tracking/conf/lidar_tracking_config.pb.txt:7-11` 被注释掉。

**`data/tracking/` 下所有 `.conf` 文件名写死在代码里，不能改名**：`mlf_tracker.conf`（`mlf_tracker.cc:27`）、`mlf_track_object_matcher.conf`（`:30`）、`mlf_track_object_distance.conf`（`:40`）、`mlf_motion_filter.conf`（`:33`）、`mlf_type_filter.conf`（`:34`）、`mlf_shape_filter.conf`、`mlf_direction_filter.conf`、`mlf_motion_refiner.conf`。`ccrf_type_fusion.conf` 里两个 `*.property` 路径是相对 `config_path` 的文件名。

## 2. camera 4 条路线 + 红绿灯 + lane + barrier

| 路线 | 入口 Component | 输入 | 输出 | 检测器插件 | 后端 | 默认启用 |
|---|---|---|---|---|---|---|
| multi_stage（2D + 后续测距） | `CameraDetectionMultiStageComponent` | `/apollo/sensor/camera/camera_front/image` | `/perception/inner/Detection` | `YoloObstacleDetector` / `Yolox3DObstacleDetector` | TensorRT(RTNetInt8) / Onnx | **是**（front + rear） |
| single_stage（直出 3D） | `CameraDetectionSingleStageComponent` | `/apollo/sensor/camera/front_6mm/image` | `/perception/inner/Detection` | `SmokeObstacleDetector` / `CaddnObstacleDetector` | libtorch / Paddle | 否 |
| bev（PETR，6 目环视） | `CameraDetectionBevComponent` | 6 路 `CAM_*` | `/apollo/perception/obstacles` | `BEVObstacleDetector` | PaddlePaddle | 否（无 launch 引用） |
| occupancy（BEVFormer + 占据栅格） | `CameraDetectionOccComponent` | 6 路 `CAM_*` | `/apollo/perception/obstacles`（占据栅格只落盘） | `BEVFORMERObstacleDetector` | Onnx→TensorRT | 否 |

multi_stage 生产链路四段（front；rear 支路每个 channel 加后缀 `2`）：检测 `/perception/inner/Detection` → 测距 `camera_location_estimation`（`MultiCueTransformer`）`/perception/inner/location_estimation` → 精修 `camera_location_refinement`（`LocationRefinerPostprocessor`）`/perception/inner/location_refinement` → 跟踪 `camera_tracking`（`OMTObstacleTracker`）`/perception/inner/PrefusedObjects`。
**四段必须同进程**（`CameraFrame.data_provider` 是共享裸指针）。rear 支路靠把 dag 里 component `name` 改成 `...ComponentRear` 绕开 cyber 同进程重名限制（`camera_detection_multi_stage_rear.dag:7`）——**新增一路相机必须照抄这个改名套路**。

红绿灯四段（`perception_trafficlight.launch:6-9`，默认不在 `perception_all` 内）：`traffic_light_region_proposal`（读 front_6mm + front_12mm，写 `/perception/inner/Detection`）→ `traffic_light_detection`（写 `/perception/inner/Retection`，**上游拼写错误已固化**）→ `traffic_light_recognition`（写 `/perception/inner/Tracking`）→ `traffic_light_tracking`（写 `/apollo/perception/traffic_light`）。
⚠️ `/perception/inner/Detection` 被障碍物链路与红绿灯链路**共用**，两条栈不能放同进程。

`lane_detection`：`LaneDetectionComponent`，读 `input_camera_channel_names`（front_6mm + front_12mm），写 `/perception/lanes`，独立 launch（还需 `motion_service`）。
`barrier_recognition`：`Component<LidarFrameMessage>`，**输入是激光雷达** `/perception/lidar/detection`，写 `/apollo/perception/barrier`，独立 launch，仓库内无下游订阅者；插件基类 `BaseBarrierRecognizer`（B 机制，`detector/straight_pole_recognizer/`）。

## 3. radar 两个模块

| 维度 | `radar_detection`（3D） | `radar4d_detection`（4D） |
|---|---|---|
| namespace | `apollo::perception::radar` | `apollo::perception::radar4d` |
| 输入 | `drivers::ContiRadar`（**目标级**）`/apollo/sensor/radar/{front,rear}` | `drivers::OculiiPointCloud`（**点云级**）`/apollo/sensor/oculii/PointCloud2` |
| 检测 | `ContiArsDetector`（纯坐标/速度换算，无网络） | `Radar4dDetection`（PointPillars / LibTorch，需 GPU） |
| 预处理 | `ContiArsPreprocessor` | `RadarPreprocessor` |
| ROI | `HdmapRadarRoiFilter` | `HdmapRadarRoiFilter`（同名不同实现） |
| 跟踪 | `ContiArsTracker` + `HMMatcher` + `AdaptiveKalmanFilter` | `MrfEngine` + `MrfTracker` + `MrfBaseFilter` 链 |
| 模型 | 无 | `data/models/point_pillars_radar4d_torch/`（`radar_libtorch_all.zip`） |
| 输出 | `/perception/inner/PrefusedObjects` | 同左 |

radar 全部基类走 A 机制：`BaseDetector`、`BasePreprocessor`、`BaseRoiFilter`、`BaseMatcher`、`BaseTracker`、`BaseRadarObstaclePerception`（`radar_detection/interface/`）；radar4d 另有 `BaseBipartiteGraphMatcher`、`BaseClassifier`、`BaseMultiTargetTracker`、`MrfBaseFilter`、`BaseOneShot/SequenceTypeFusion`。

## 4. 感知全部插件基类清单（含纯虚函数）

**A 机制（registerer）**，`PERCEPTION_REGISTER_REGISTERER` 所在位置：

| 基类 | 头文件:行 | 纯虚函数 |
|---|---|---|
| `BasePointCloudPreprocessor` | `pointcloud_preprocess/interface/base_pointcloud_preprocessor.h:93` | `Init` / `Preprocess` / `Name` |
| `BaseGroundDetector` | `pointcloud_ground_detection/interface/base_ground_detector.h:72` | `Init` / `Detect` / `Name` |
| `BasePointCloudParser` / `BaseMotionParser` | `pointcloud_semantics/interface/base_pointcloud_parser.h:82` / `pointcloud_motion/interface/base_motion_parser.h:82` | `Init` / `Parse` / `Name` |
| `BaseLidarDetector` | `lidar_detection/interface/base_lidar_detector.h:84` | `Init(LidarDetectorInitOptions)` `:59` / `Detect(LidarDetectorOptions, LidarFrame*)` `:70` / `Name()` `:78` |
| `BaseCPDetector` | `lidar_cpdet_detection/interface/base_cpdetector.h:84` | 同上；⚠️ **宏名与 `base_lidar_detector.h:85` 相同（都叫 `PERCEPTION_REGISTER_LIDARDETECTOR`），同时 include 会宏重定义** |
| `BaseMultiTargetTracker` | `lidar_tracking/interface/base_multi_target_tracker.h:74` | `Init` / `Track` / `Name` |
| `BaseBipartiteGraphMatcher` | `lidar_tracking/interface/base_bipartite_graph_matcher.h:83` | `Match` / `Name` |
| `MlfBaseFilter` | `lidar_tracking/tracker/multi_lidar_fusion/mlf_base_filter.h:82` | `Init` / `UpdateWithObject` / `UpdateWithoutObject` / `Name` |
| `BaseSingleShot/MultiShotTypeFusion` | `lidar_tracking/tracker/type_fusion/type_fusion_interface.h:51,69` | `Init` / `TypeFusion` / `Name` |
| `BaseOneShot/SequenceTypeFusion` | `lidar_tracking/classifier/fused_classifier/type_fusion_interface.h:65,100` | 同上 |
| `BaseClassifier` | `lidar_tracking/interface/base_classifier.h:73` | `Init` / `Classify` / `Name` |
| `BaseObstacleDetector`（camera） | `common/interface/base_obstacle_detector.h:87` | `Init(ObstacleDetectorInitOptions&)` `:53` / `Detect(onboard::CameraFrame*)` `:62` / `Name()` `:68`；非纯虚 `InitNetwork(ModelInfo, model_root)` `:77` |
| `BaseTransformer` | `camera_location_estimation/interface/base_transformer.h:59` | `Init` / `Transform` / `Name` |
| `BasePostprocessor` | `camera_location_refinement/interface/base_postprocessor.h:72` | `Init` / `Process` / `Name` |
| `BaseObstacleTracker` / `BaseFeatureExtractor` / `BasePredictor` | `camera_tracking/interface/base_obstacle_tracker.h:85` / `base_feature_extractor.h:98` / `base_predictor.h:37` | 各自 `Init` + 主函数 + `Name` |
| `BaseTLPreprocessor` | `traffic_light_region_proposal/interface/base_tl_preprocessor.h:139` | — |
| `BaseTrafficLightDetector` / `Recognitor` / `Tracker` | `traffic_light_detection/interface/base_traffic_light_detector.h:67` / `traffic_light_recognition/interface/base_traffic_light_recognitor.h:68` / `traffic_light_tracking/interface/base_traffic_light_tracker.h:66` | `Init` / `Detect`\|`Recognit`\|`Track` / `Name` |
| `BaseLaneDetector` / `BaseLanePostprocessor` / `BaseCameraPerception` | `lane_detection/interface/base_lane_detector.h:60` / `base_lane_postprocessor.h:64` / `base_camera_perception.h:51` | — |
| `BaseObstacleDetector`（bev / occupancy 各自一份） | `camera_detection_bev/interface/base_obstacle_detector.h:87`、`camera_detection_occupancy/interface/base_obstacle_detector.h:87`（+ `base_matcher.h:143`、`base_tracker.h:77`） | — |
| `BaseFusionSystem` / `BaseDataAssociation` / `BaseGatekeeper` | `multi_sensor_fusion/interface/base_fusion_system.h:71` / `base_data_association.h:85` / `base_gatekeeper.h:66` | 真插件；宏 `FUSION_REGISTER_FUSIONSYSTEM` / `PERCEPTION_REGISTER_ASSOCIATION` / `PERCEPTION_REGISTER_GATEKEEPER` |
| `BaseCipv` / `BaseCalibrationService` / `BaseCalibrator` | `common/lib/interface/base_cipv.h:73` / `base_calibration_service.h:111` / `base_calibrator.h:68` | — |
| `SceneService` / `SceneServiceContent` | `common/lidar/scene_manager/scene_service.h:96,55` | — |
| radar / radar4d 全部基类 | 见第 3 节 | — |

**B 机制（cyber PluginManager）**，全仓 perception 只有 14 处 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN`：
`HdmapROIFilter`（`:106`）、`ROIServiceFilter`（`:74`）、`PclDownSample`（`:74`）、`PclPCDownSample`（`:74`）、`GpuDownSample`（`:87`）、`StraightPoleRecognizer`（`:149`）、`ObjectSplitFilter`（`:109`）、`MarkAreaFilter`（`:96`）、`BigmotRefineFilter`（`:86`）、`SemanticFilter`（`:87`）、`OnnxMultiBatchInfer`（`:92`）、`BackgroundFilter`（`:92`）、`ROIBoundaryFilter`（`:111`）、`StrategyFilter`（`:93`）。对应 14 个 `plugins.xml`。

**伪插件（配置里写名字，实例化是 if-else，加实现必须改 C++）**：`multi_sensor_fusion` 的 `BaseTracker`（`interface/base_tracker.h:16`）、`BaseTypeFusion`（`:13`）、`BaseExistenceFusion`（`:13`）、`BaseMotionFusion`（`:11`）、`BaseShapeFusion`（`:11`），实例化在 `pbf_tracker.cc:75-105` 与 `probabilistic_fusion.cc:251-256`。`multi_sensor_fusion` **没有 plugins.xml**，加子算法只需把源文件加进 `BUILD` 的 `apollo_perception_multi_sensor_fusion`。

## 5. 公共数据结构关键成员

**`base::Object`**（`common/base/object.h:34-125`，`ObjectPtr = shared_ptr<Object>` `:127`）
- `id:40` 是**帧内** id，`track_id:86` 才是跨帧稳定 id。
- `polygon:43`（世界系 2D 凸包，由 `ObjectBuilder::ComputePolygon2D` 填）、`direction:47`（默认 `(1,0,0)`）与 `theta:52` **必须同步**（`theta=0 ⇔ direction=(1,0,0)`，只有 yaw）。
- `center:56`（bbox 中心，`Vector3d` 世界系）、`anchor_point:66`（跟踪锚点，lidar 下 = center）、`size:62` = `[length,width,height]`，length 沿 `direction`。
- `type` + `type_probs`、`sub_type` + `sub_type_probs`（`:69-76`）；映射表 `kSubType2TypeMap`（`base/object_types.h:230-247`），**新增细类必须同时改这张表**。`ObjectType` 7 项、`ObjectSubType` 含 CAR/VAN/TRUCK/BUS/CYCLIST/…/SMALLMOT/BIGMOT/NONMOT（`object_types.h:77-96`）。
- `velocity` / `acceleration` / `velocity_converged` / `tracking_time`（**时长**）/ `latest_tracked_time`（绝对时间戳）/ `motion_state`（`:86-106`）。
- 5 个 supplement（`:115-119`），"谁产生谁填，其他人只读"。
- `EIGEN_MAKE_ALIGNED_OPERATOR_NEW`（`:124`）：不要裸 `malloc`，用 `vector<ObjectPtr>` 或 `EigenVector`。

**`LidarObjectSupplement`**（`base/object_supplement.h:35-88`）：`point_ids`（原始 cloud 下标）、`cloud`（传感器系）、`cloud_world`（世界系）——**同一份点被拷 3 处，是内存热点**；`is_orientation_ready` / `is_background` / `is_clustered` / `is_fp`+`fp_prob` / `is_in_roi`+`num_points_in_roi`。**前后景划分依据是 `is_clustered`，不是 `is_background`**（`MlfEngine:176-180`）。

**`lidar::LidarFrame`**（`common/lidar/common/lidar_frame.h:33-100`）：`cloud:35`（lidar 系 float）/ `world_cloud:37`（世界系 double）/ `timestamp:39` / `original_ground_z:43` / `lidar2world_pose:45` / `novatel2world_pose:47` / `lidar2novatel_extrinsics:49` / `hdmap_struct:51` / `segmented_objects:53` / `tracked_objects:55` / `roi_indices:57` / `non_ground_indices:59` / `secondary_indices:61`（**三套下标都是对 `cloud` 的**）；`Reset():67-90` 保留 `sensor_info`。

**`camera::CameraFrame`**（`common/camera/common/camera_frame.h:36-76`）：`data_provider`（裸指针，借用）、三阶段对象 `proposed_objects` → `detected_objects` → `tracked_objects`、`track_feature_blob`、`camera_k_matrix` / `camera_extrinsic` / `camera2world_pose`。⚠️ `onboard/inner_component_messages/camera_inner_component_messages.h` 里还有一个**同名但字段更少**的 `onboard::CameraFrame`，写代码看清 namespace。

**`base::Frame`**（`base/frame.h:32-58`）：融合层统一帧，`sensor_info` / `timestamp` / `objects` / `sensor2world_pose` + 4 个 `*FrameSupplement`。

**`PointCloud<PointT>` / `AttributePointCloud<PointT>`**（`base/point_cloud.h:36-258`、`:263-507`）：后者并行维护 5 个属性数组（`points_timestamp_` / `points_height_`（默认 `max()`）/ `points_beam_id_`（默认 -1）/ `points_label_` / `points_semantic_label_`），所有容器操作都被 override 以保持同步，**直接改 `mutable_points()` 会破坏一致性**（用 `CheckConsistency()` 校验）。点语义标签是一个 `uint8_t` 位打包（`lidar/common/lidar_point_label.h:22-81`，低 4 位 `PointSemanticLabel`、高 4 位 `PointMotionLabel`），**必须用 Set/Get 存取，不要整字节赋值**。
⚠️ `CopyPointCloudExclude`（`:151-166`）参数顺序颠倒等价于空 mask，**不要用**。

**`Blob<Dtype>`**（`base/blob.h`）：CPU-GPU 统一内存，`mutable_gpu_data()` 写完必须 `set_head_gpu()`（`:288`），否则读到全零。

## 6. 推理后端接入细节

`Inference` 基类 `common/inference/inference.h:41-70`：`Init(map<string, vector<int>> shapes)` `:47`（shape 是 NCHW）/ `Infer()` `:49` / `get_blob(name)` `:51` / 可选 `SetStream(cudaStream_t)` `:52`；设置器 `set_max_batch_size` / `set_gpu_id` / `set_model_info(proto_file, input_names, output_names)`。BlobMap = `map<string, BlobPtr<float>>` `:39`，**blob 由 net 拥有并复用**。

各后端要的磁盘文件：
- `RTNet(net_file=.prototxt, model_file=.caffemodel, outputs, inputs[, calibrator|model_root])`（`inference/tensorrt/rt_net.h`）：解析 Caffe NetParameter → 逐层建 TensorRT network → 注册自定义插件 → 建 `ICudaEngine`；给了 `model_root` 会在其下缓存 engine。INT8 需 `nvinfer1::Int8EntropyCalibrator`（`tensorrt/entropy_calibrator.h`）+ `BatchStream`。
- `PaddleNet(model_file=.pdmodel, params_file=.pdiparams, outputs, inputs)`。
- `TorchNet(model_file=.pt/.zip, outputs, inputs)`：`torch::jit::load`，动态 shape。
- `ObstacleDetector(proto_file, weight_file, outputs, inputs)`：`inference/onnx/libtorch_obstacle_detector.h`。
- `SingleBatchInference(model_file=.onnx[, score_threshold], outputs, inputs)`：`OnnxToTRTModel()` 转 TensorRT，有 `LoadCache`；**batch 固定 1**。
- `MINet(net_file, model_file, outputs, inputs[, model_root])`：AMD/MIGraphX，与 RTNet 同结构。

平台开关 `inference_factory.cc:23-33`：`GPU_PLATFORM == NVIDIA` 时 `RTNET/RTNET8` → TensorRT `RTNet`；`== AMD` 时 → MIGraphX `MINet`，且 **INT8 静默退化为 FP32**。新增 GPU 操作或后端必须同时补 `inference_factory.cc:23-33` 与 `camera/common/image_data_operations.cc:20-32` 两处 `GPU_PLATFORM` 分支。

标准前处理别自己写 kernel：`inference/utils/resize.h` 的 `ResizeGPU(...)` 一步完成缩放+减均值+归一化+HWC→CHW；`inference/model_util.h` 的 `GetBlobNames` + `AddShape` 是「proto 配置 → Init shape map」的标准两行。

**新增一个后端**：`common/inference/` 加子目录 → `inference_factory.cc` **两个重载都加分支** → `model_info.proto` 的 `Framework` 加枚举。更轻的做法是走 `infer_plugin`（cyber 插件，照抄 `perception_plugin/inference/onnx_multi_batch/`），不用改工厂。

**模型目录 ↔ `info.name` 对照**（`data/models/` 下 20 个）：`center_point_paddle`（`centerpoint.pdmodel`+`.pdiparams`）、`point_pillars_torch`（`pointpillars.zip`）、`mask_pillars_torch`（`maskpillars.zip`）、`cnnseg{16,64,128}_caffe`（`deploy.prototxt`+`deploy.caffemodel`）、`cpdet`（`cpdet_pfe.onnx`+`cpdet_backbone.onnx`）、`pointwise_unet`（**语义与运动共用同一目录、文件名不同**）、`3d-r4-half_caffe`（YOLO 默认，6 个文件）、`yolox3d_onnx`、`smoke_torch`、`apollo_bevnet_onnx`（需手动下载）、`tl_detection_caffe` / `tl_detection_yolox`、`vertical_caffe` / `quadrate_caffe` / `horizontal_caffe` / `efficient_net`、`point_pillars_radar4d_torch`、`yolox_garbage_onnx`。
⚠️ CADDN 的 `caddn_paddle`、PETR 的 `petrv1` **目录不存在**；`3d-r4-half_caffe` 没被任何 cyberfile 声明（即默认路线的默认模型没有模型依赖声明）。

**blob 顺序绑定**（改顺序会静默串线）：CenterPoint `input[0]=data`，`output[0]=box,[1]=score,[2]=label`（`center_point_detection.cc:306-309`）；CNNSeg `output[0..5]=instance_pt, category_score, confidence_score, height_pt, heading_pt, class_score`（`cnn_segmentation.cc:91-108`）；PointPillars `input[0..2]=pillar 特征, 每 pillar 点数, pillar 坐标`，`output[0..2]=cls_score, bbox_pred, dir_cls_preds`（`point_pillars.cc:452-470,641-663`）；CPDet pfn `input[0]=voxels`/`output[0]=pillar_feature`，backbone `input[0]=canvas_feature`/`output[0..2]=bbox_preds/scores/dir_scores`（`cpdet.cc:300-330`）；视觉侧 `yolox3d:437-438`、`smoke:206,221`、`caddn:171-173`。

**换类别数 / 类别顺序**必须改代码：`GetObjectSubType`（`center_point_detection.cc:733-746` / `point_pillars_detection.cc:388-398`）、`GetObjectScoreThreshold`（`center_point_detection.cc:748-762`）、CNNSeg 的 `MetaType→ObjectType`（`cnn_segmentation.cc:338-363`）、CPDet 的 `post_process.task/sub_task`（纯配置）、`PointPillars::params.h` 的 `kNumClass` 与 anchor 三组尺寸。
**换 BEV 网格 / 检测范围**：CPDet 在 conf 的 `pre_process` 里（纯配置）；CenterPoint 范围由 paddle 模型自身决定；PointPillars/MaskPillars **只能改 `detector/point_pillars_detection/params.h` 并重编**（`kPillar*Size`、`kMin/Max*Range`、`kGridSize`、`kNumAnchor`，且 `kNumThreads` 与 `.cu` 里 `NUM_THREADS_MACRO` 必须同步）；CNNSeg 改 conf 的 `feature_param.width/height/point_cloud_range` **同时改 `info.inputs.shape`**，且 `width == height`（`feature_generator.cc:38-39` 有 CHECK）。

## 7. BUILD 约定

- `filegroup(name="<module>_files", srcs=glob(["conf/**","dag/**","data/**","launch/**"]))` —— 新增 conf/data 会自动打包，**新增顶层目录需手动加进 glob**。
- `apollo_cc_library(name="apollo_perception_<module>")`：算法实现，`hdrs` 里必须列出基类头。
- `apollo_component(name="lib<module>_component.so", srcs=[...component.cc], linkopts=["-lleveldb"])`。
- `apollo_plugin(name="lib<xxx>.so", description=":plugins.xml", deps=[":lib_xxx"])` —— **只有走 PluginManager 的插件用这个**；它负责生成 `cyber_plugin_description` + `alwayslink` 库 + `linkshared` so（`tools/apollo_package.bzl:647-678`）。注册失败最常见原因就是链接器丢弃静态库里的 `__attribute__((constructor))`，**BUILD 目标必须 alwayslink**。
- `gpu_library(...)` 用于 `.cu`（`lidar_detection/BUILD:104-119`），需 `if_cuda`/`if_rocm` 双分支。
- `PERCEPTION_COPTS = ['-DMODULE_NAME=\\"perception\\"']` + `if_profiler()` + `-DENABLE_PROFILER=1`。
- CenterPoint 依赖 `@centerpoint_infer_op-{x86_64,aarch64}` 与 `@paddleinference-*` 的 `select()`（`lidar_detection/BUILD:194-200`）；PointPillars 依赖 `@libtorch_gpu`（`:193`）。
- `pointcloud_ground_detection/BUILD:30-36` 有 SIMD `select`：x86_64 `-msse4.1`、aarch64 `-march=armv8-a+fp+simd+crc`，其他平台报 `no_match_error`。
- `cyberfile.xml` 声明包依赖：`pointcloud_map_based_roi` 需要 `map` 与 `3rd-boost`，preprocess/ground 不需要 map。

## 8. 高危坑与已确认缺陷

### 8.1 配置与接线
1. **输入 channel 只在 dag、输出 channel 只在 conf**，改一边不改另一边 → 链路静默断开（无报错，只是没数据）。
2. 所有 dag 的 `config_file_path`/`flag_file_path` 是**绝对 `/apollo/...`**，非标准容器布局必须逐个改。
3. **两套机制混用**：模块 1/3/4/6 用注册器（名字错 → `CHECK_NOTNULL` abort 并打印全部已注册名），模块 2/5 与 downsample 用 PluginManager（名字错 → nullptr）。`ObjectFilterBank` 最糟：**找不到插件只 AINFO + continue，过滤器静默不生效**。
4. **proto 默认值 ≠ pb.txt 值 ≠ C++ 成员初值**。删掉 pb.txt 一行退回 **proto 默认**。最危险三处：`filter_nearby_box_points`（proto false / pb.txt true）、`z_threshold`（proto 5.0 / pb.txt 2.0）、`set_roi_service`（proto false / pb.txt true）。融合侧：`output_obstacles_channel_name` proto 默认 `/perception/vehicle/obstacles` vs conf `/apollo/perception/obstacles`（`proto/fusion_component_config.proto:8-9`）；`Sensor::kMaxCachedFrameNum` 代码默认 10（`base/sensor.cc:24`）vs conf 50。
5. `SceneManager::Instance().Init()` **只在 `pointcloud_map_based_roi_component.cc:39` 调用**，单独跑 ground_detection 或用 `GroundServiceDetector` 拿不到 service。
6. `SpatioTemporalGroundDetector` 的 `ground_service_content_.Init(80,80,32,32)` 与 `data/conf/ground_service.conf`（120,120,16）不一致；`data/hdmap_roi_filter.pb.txt`（range 120 / cell 0.25）必须与 `data/conf/roi_service.conf` 一致，否则消费端解码错位。
7. `lidar_output/dag/*.dag` 里 preprocess 读 lidar16 channel，但复用的 conf 里 `sensor_name: "velodyne64"` —— tf child_frame_id 会查错。
8. `mlf_engine.pb.txt` 的 `set_static_outside_hdmap` 被 `Init` 忽略，而 `Track` 末尾静止策略**无条件执行** —— 这个开关实际失效。
9. `mlf_type_filter.conf` 的 `temporal_window: 0.55` 与 `fused_classifier.pb.txt` 的 `20.0` 差 36 倍；`type_classifiers.property`（4 块，含 `CenterPointDetection`）与 `classifiers.property`（3 块）内容不同，**别混用**。
10. `type_classifiers.property` 里的分类器名**必须等于检测器 `Name()` 返回值**。

### 8.2 坐标系
11. 预处理的 box filter / 高 z filter **实际在 lidar 系判定**（`pointcloud_preprocessor.cc:82-84` 外参乘法被注释，变量还叫 `vec3d_novatel`）；边界 1.5/-1.3/0.6/-0.7 与 `z_threshold: 2.0` 只在 lidar 装在车辆参考原点时正确。
12. 链路里同时存在 3 个 "local" 系：lidar 系（`frame->cloud`）、world 系（`world_cloud`）、**world 朝向 + 自车原点系**（`HdmapROIFilter::TransformFrame`、`SpatioTemporalGroundDetector` 在 `single_ground_detect==false` 时、`MlfEngine::global_to_local_offset_`）。
13. `MapManager` 查地图用 `lidar2world_pose.translation()`（**lidar 位置，不是车辆参考点**）。
14. `HdmapROIFilter` 是**纯 2D**，z 完全丢弃 —— 高架桥、隧道、多层路面都算进 ROI。`hole_polygons` 声明了但从未填充。

### 8.3 索引语义（静默错误温床）
15. **`non_ground_indices` 存的是"在 `roi_indices` 里的下标"，不是点下标**（`SpatioTemporalGroundDetector`），消费必须用 `CloudMask::AddIndicesOfIndices(roi_indices, non_ground_indices, 1)`。
16. **`GroundServiceDetector` 却存绝对点下标** —— 两个 detector 语义不兼容，在 conf 里换名字会静默破坏所有下游。
17. `SpatioTemporalGroundDetector::Detect:135-137` 把 `use_roi_` 写成**成员**：某帧 ROI 为空后整个进程都不再用 ROI；且 `:297-298` 仍无条件 `roi_indices.indices[i]`，此时越界读。
18. `BackgroundFilter:108-112` 用压缩后的下标索引压缩前的 `is_in_roi_flag_`，下标错位。
19. `MlfTrackObjectDistance::Init:55,63` 对 `vector<float> weights(7)` 写 `weights[7]` —— 一旦有人在 conf 里配 `foreground_weights` 就 UB。

### 8.4 fail-open（失败时"放行全部"，比崩溃更难查）
20. `Bitmap2dFilter` 自车原点格未点亮 → 返回 false → component 把**全部点标为 ROI**（但不打 `LidarPointLabel::ROI`，`roi_indices` 与 `points_label` 不一致）。
21. `MapManager::Update` 地图查询失败后**清空 polygon 却返回 true**。
22. `PlaneFitGroundDetector::Detect` 失败 → **所有点进 `non_ground_indices`**（整帧变障碍候选）。
23. `PointCloudGroundDetectComponent::Proc:63` **`InternalProc` 失败也 return true**（"Proc 正常但 channel 无数据"的典型来源）。
24. `HdmapROIFilter` 过滤失败时**给 ROIService 发全 1 bitmap**。
25. `ROIBoundaryFilter` / `BackgroundFilter` 在 hdmap 为空时把所有物体标 `is_in_roi = true`。
26. `ObjectFilterBank::Filter` 单个 filter 返回 false 只打日志、继续执行后面的。

### 8.5 潜在 bug / 死代码
27. `PointCloudPreprocessor::Preprocess(options, frame)`（离线重载）`SwapPoint(i, size--)` 首点非法即**死循环**。
28. `PolygonScanCvter::UpdateAet`（`polygon_scan_cvter.h:450-459`）在 `CHECK_EQ` 失败信息里无条件解引用 `aet_.second[0..3]`，AET 少于 4 条边时越界读（`no_edge_table: true` 可绕开）。
29. `Bitmap2D::SetRangeBits` 自带注释 `// note: it not work when head = 64`（`bitmap2d.cc:63`）。
30. `frame->original_ground_z = ground_z_value / ground_z_value_count` **无零除保护**（`spatio_temporal_ground_detector.cc:381-382`），NaN 会污染 5 帧滑窗，`StrategyFilter::FilterBelowGroundObjects` 依赖它，NaN 时该过滤静默失效。
31. `spatio_temporal_ground_detector.cc:317-341` 的 `count == -1` 分支是**死代码**（`count` 是 `size_t`）；"修"成 int 会激活一大段未测试代码。
32. `GraphSegmentation::NodeDistance:218` 在运动标签不同时乘的是 `diff_semantic_coefficient()` 而非 `diff_motion_coefficient()` —— 后者配置项从未生效。
33. `MlfEngine::CollectTrackedResult:335-338` 在 `num_predict > num_objects` 时直接 return，`tracked_objects` **尾部是未填充的空对象**。
34. `CenterPointDetection::GetObjects:634-637` 的 `dx`/`dy` 取的是 index 4 / index 3（w、l 互换），改模型输出顺序时极易埋雷。
35. `mask_pillars_detection` 与 `point_pillars_detection` 是逐行复制（共用 `PointPillars` 类），**改 bug 必须同时改两份**。
36. `lidar_detection_component.cc:58` 的 `FLAGS_logtassderr = 0`（原文 `logtostderr`）会改变**全局**日志行为。
37. `PointPillars::OnnxToTRTModel` parse 失败直接 `exit(EXIT_FAILURE)`；AMD 平台 `InitTRT`/`OnnxToTRTModel` 是 `assert(0)`。
38. **lidar 侧几乎全部单测没接进 BUILD**（preprocessor / map_manager / hdmap_roi_filter / roi_service_filter / 两个 ground detector test 的 `apollo_cc_test` 被注释或未写）；唯一活着的是 `lidar_detection/BUILD:224-233` 的 `cnn_segmentation_test`。
39. `MlfTypeFilter` 把所有背景物体钉成 `UNKNOWN_UNMOVABLE`；`MlfShapeFilter` 维护的形状与 detection 的形状**是两份**（filter 里改完会恢复 `obj` 原值）。
40. CNNSeg 的 heading 减了 π/4、`MapPointToGrid` 用 45° 旋转投影，**重训模型后要还原**（代码注释明示）。
41. `mlf_track_object_distance.conf` 的 `euclidean_distance_threshold: 2.0` 是**实际生效的硬关联门限**，比 `max_match_distance: 3.0` 更强。`middle_range_dist == near_range_dist == 10.0` 且三个 ground 阈值都是 0.25 —— **分带逻辑当前是死的**。

### 8.6 camera 侧架构级坑
42. **四段必须同进程**（`CameraFrame.data_provider` 是共享裸指针）；`/perception/inner/Detection` 被障碍物与红绿灯两条栈共用。
43. **模型权重不在 git**；`APOLLO_MODEL_PATH`/`APOLLO_CONF_PATH` 未设时 `GetModelPath` 只打 error 返回空串，随后 TensorRT 会意外走 INT8 路径，报错极难定位。
44. **`camera_location_refinement` 目前是直通**（`SetCameraHeightAndPitch` 与 `calibration_service_->Update` 都被注释）；日志里 `diff on camera z: 0` 是现状不是 bug 表象。
45. **`camera_tracking` 的 `camera_k_matrix` 与 `calibration_service` 从不填充**（`camera_tracking_component.cc:89-98`），**K 恒为单位矩阵** —— `ObstacleReference` 的深度数学失效，地面/标定高度投票全部失效。**排查 3D 高度异常时优先级最高的一条。**
46. **`camera_tracking` 的 ROI 坐标系不匹配**：`FeatureExtract` 设 `normalized = true`（`omt_obstacle_tracker.cc:126`）导致跳过 `encode_bbox`，直接把像素框乘 `feat_width_/feat_height_`，`roipooling_layer.cu:121-124` 全部夹到边界 ⇒ **外观特征近乎退化**，实际起作用的只有 motion（权重 1.0）。
47. **视觉障碍物只有一个出口给融合**：`/perception/inner/PrefusedObjects`（lidar_tracking / radar 也写它）。`perception_all.launch` 不加载 msg_adapter，生产拓扑下 `/apollo/perception/obstacles` 完全由融合发布。
48. 新增一路相机必须同时改：`data/conf/sensor_meta.pb.txt`（不加则 multi_stage 空指针解引用、single_stage `ACHECK` 崩）、`data/params/<name>_intrinsics.yaml`（文件名必须精确匹配）、`data/params/<name>_extrinsics.yaml` + 车辆 `static_transform_conf.pb.txt`（相机挂在 lidar 系下）、四段 conf + 四段 dag（component `name` 必须唯一）、`perception_all.launch` 的同一个 `<module>`。

### 8.7 融合与 radar 坑
49. **main sensor 是隐形总开关**：默认只有 `velodyne64`（`data/conf/sensor_meta.pb.txt:6-11`）。无 lidar 车型不改这里融合**永不输出**，日志只平静打 `Skip because it is not the main sensor`（`multi_sensor_fusion_component.cc:79-80`）。
50. **ROI 检查目前是空操作**（`multi_sensor_fusion_component.cc:163-165` 把 `ObjectInRoiSlackCheck` 注释掉），`object_in_roi_check: true` 与 `radius_for_roi_object_check: 120` 白算。
51. `trackers_` 与 `foreground_tracks_` 靠下标隐式对应（`probabilistic_fusion.cc:251-256` 建、`:318-328` 同步压缩），单独操作其中一个 vector 会错位崩溃。
52. **`match_distance` 恒为 0**（`probabilistic_fusion.cc:198,217` 写死），于是 `DstExistenceFusion` 的 `association_prob` 恒为 1（`dst_existence_fusion.cc:85`），**存在性融合退化**。
53. **相机分支的距离语义反了**：`ComputeDistance`（`hm_tracks_objects_match.cc:261-279`）对相机填的是「相似度越大越好」，其他分支填「距离越小越好」，下游 `DstTypeFusion::UpdateWithoutMeasurement`（`dst_type_fusion.cc:184`）当 dist_score 用（源码自带 TODO）。
54. `AddTrackedTimes()` 的副作用在 gatekeeper 里（`pbf_gatekeeper.cc:86`），绕过 gatekeeper 直接收集目标会让 `pub_track_time_thresh` 判据失效。
55. **本地时间判据**：`DstTypeFusion::GetReliabilityForUnKnown` 用 `tm_hour >= 17`（`dst_type_fusion.cc:274`）、`PbfGatekeeper::AbleToPublish` 用 `tm_hour >= 23`（`pbf_gatekeeper.cc:80`），都用 `localtime_r` —— **同一份 record 在不同机器/时区结果可能不同**。
56. **center 被写两次**：`PbfShapeFusion::UpdateCenter:82-88` 先写，`KalmanMotionFusion::UpdateMotionState:341` 后写；调用顺序 existence→motion→shape→type，所以**shape 的 center 才是最终值**，速度/加速度来自 motion。
57. 不确定度不来自卡尔曼 P（`UpdateMotionState:352-354` 沿用最后一次测量），下游看到的协方差**不代表滤波器真实置信度**。
58. `Sensor::QueryLatestFrame` 会推进 `latest_query_timestamp_`（`base/sensor.cc:43-53`）：时间戳乱序时**落后的帧被永久跳过且不报错**。
59. `Track::UpdateUnfusedState` 对 radar **什么都不更新**（`base/track.cc:242-243`）。
60. **关联所有阈值硬编码在 `.cc`**，`data_association_param` 没有 config 文件 —— **调关联必须重编译**。
61. `radar_detection` 的 `use_filter` 默认 `false`（`data/conti_ars_tracker.pb.txt`），`AdaptiveKalmanFilter` 默认不生效；`ContiArsPreprocessor::current_idx_`/`local2global_` 是 **static**，前后雷达两个 Component 实例共享。

## 9. 关键日志锚点（都是 AINFO，默认可见）

| 日志前缀 | 位置 | 用途 |
|---|---|---|
| `Lidar Detection Component Configs: ...` | `lidar_detection_component.cc:32` | 确认实际生效 conf（全量 `DebugString()`） |
| `Fail to call roi filter, use origin cloud.` | `pointcloud_map_based_roi_component.cc:105-111` | ROI 兜底触发 |
| `Polygon Empty.` / `Car is not in roi!!.` | `hdmap_roi_filter.cc:82,217` | ROI 失败原因 |
| `Failed to find ground service and cannot update.` | `spatio_temporal_ground_detector.cc` | SceneManager 未初始化 |
| `CenterPoint: down sample / fuse / inference / postprocess / nms` | `center_point_detection.cc:372-380` | 检测各阶段耗时 |
| `[CenterPointDetection BeforeNMS]` / `AfterNMS` | `:337, :383`（ADEBUG） | NMS 前后逐物体 dump |
| `CNNSEG: mapping / feature / infer / fg-seg / collect` | `cnn_segmentation.cc:243-247` | CNNSeg 耗时 |
| `Object filter bank, filtered objects size: from N to M` | `object_filter_bank.cc:68-69` | 过滤前后物体数 |
| `Roi boundary filter, N to M` | `roi_boundary_filter.cc:93-94` | ROI 边界过滤效果 |
| `[FilterBelowGroundObjects] from N to M` | `strategy_filter.cc:230` | 地下物体过滤 |
| `MlfEngine: <sensor> foreground: N background: M` | `mlf_engine.cc:183-185` | 前后景划分是否正确 |
| `MlfEngine: foreground assignments N unassigned_tracks M unassigned_objects K` | `mlf_engine.cc:197-199` | **关联质量第一手指标** |
| `MlfEngine, num_predict / num delay_output / num front_critical / num_objects` | `mlf_engine.cc:330-334` | 为什么物体没输出 |
| `MlfEngine publish objects: N sensor_name: ... at timestamp:` | `mlf_engine.cc:148-150` | 最终输出数 |
| `MlfTracker add filter: <name>` | `mlf_tracker.cc:43` | 确认滤波器链顺序 |
| `MlfTrackObjectMatcher, fg: / bg:` | `mlf_track_object_matcher.cc:41,45` | 确认匹配算法已加载 |
| `TypeTransitionMatrix(Log)` | `tracker/type_fusion/ccrf_type_fusion.cc:162` | 确认 property 文件被加载 |
| `FRAME_STATISTICS:LidarTracking:End:msg_time[..]:cur_latency[..]` | `lidar_tracking_component.cc:135-138` | 端到端延迟 |
| `Skip because it is not the main sensor` | `multi_sensor_fusion_component.cc:79-80` | 融合无输出的头号原因 |

更详细日志开关：`mlf_engine.pb.txt` 的 `print_debug_log: true`（前景/背景物体列表 + 每条轨迹状态）、`mlf_type_filter.conf` 的 `print_type_filter_log: true`（类型融合明细）、`spatio_temporal_ground_detector.pb.txt` 的 `debug_output: true`（dump `semantic/<ts>.txt`，**先手动 `mkdir semantic`**，目录不存在时静默失败）。

## 10. 改动后的验证清单

- 改 conf/dag：`cyber_launch start modules/perception/launch/perception_lidar.launch`，先看 `... Component Configs:` 确认生效值，再逐级 `cyber_channel hz`。
- 改插件名：确认日志里有 `MlfTracker add filter: X` / `MlfTrackObjectMatcher, fg: X` / `Filter bank add filter: X`；**没有这行就是没加载上**（PluginManager 路径不会报错）。
- 改检测器/模型：先用 offline 工具跑一批 pcd 比对 `[BeforeNMS]/[AfterNMS]` dump，再上在线链路；同时检查 `type_classifiers.property` 是否已加对应矩阵。
- 改跟踪参数：看 `assignments / unassigned_tracks / unassigned_objects` 三个数的比例变化与 `num_predict / num_delay_output` 的变化，而不是只看最终物体数。
- 编译与测试：`bazel build //modules/perception/lidar_detection/... //modules/perception/lidar_tracking/...`；`bazel test //modules/perception/lidar_detection:cnn_segmentation_test`（lidar 范围内唯一接进 BUILD 的测试）。
- 性能剖析需 `bazel --define profiler=true`（BUILD 里 `if_profiler()` + `-DENABLE_PROFILER=1`）；`PERF_BLOCK` 块名：`cloud_preprocessor`、`map_manager`、`roi_filter`、`ground_detector`、`lidar_detector`、`object_builder`、`filter_bank`、`strategy_filter_merge`、`lidar_segmentation`、`semantic_builder`、`pointcloud_parser`、`multi_target_tracker`、`class_nms`。
