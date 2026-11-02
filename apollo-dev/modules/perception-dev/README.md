# Apollo perception 开发

> **⚠️ 本环境（包工作区）适配**：本环境是独立包管理工作区 `/apollo_workspace`，根下没有 `modules/`、`apollo.sh`。
> 本文 `modules/perception/...` 路径：**只读** → 拼 `/opt/apollo/neo/src/`；**要改** → 先
> `buildtool install <pkg>`，落到 `/apollo_workspace/modules/perception/...`（保留完整仓库相对路径，不用换算）。
> 编译用 `buildtool build -p <相对工作区的包路径>`，**不能只 `bazel build`**（不做 install，运行时看不见）。
> **改 pipeline conf / plugin_param 试效果**：走 `/apollo/<src_path>/conf/*`（符号链接，立即生效）；
> 改工作区源码副本的 conf 要重编才生效。检测器/滤波器/跟踪器都是插件，索引与 .so 加载路径差异见
> `modules/plugin-dev/` 开头适配段 —— 本环境**不扫 `bazel-bin`**，插件必须 install 才被发现。
> **⚠️ 模型权重是独立包，本环境大部分没装（现场核对，这是"感知起来了但不出障碍物"的头号原因）**：
> 模型根目录 = `APOLLO_MODEL_PATH` = `/apollo/modules/perception/data/models/`
> （→ `/opt/apollo/neo/share/modules/perception/data/models/`），下面 16 个子目录，
> **只有 5 个真有权重文件**：`smoke_torch`、`tl_detection_caffe`、`horizontal_caffe`、
> `vertical_caffe`、`quadrate_caffe`（即 smoke 单目 + 红绿灯那条线）。
> 其余 11 个目录**只有 `BUILD` + `README` 两个符号链接、没有任何权重**：
> `center_point_paddle`、`cpdet`、`cnnseg{16,64,128}_caffe`、`point_pillars_torch`、
> `mask_pillars_torch`、`pointwise_unet`、`yolox3d_onnx`、`tl_detection_yolox`、`efficient_net`
> —— **激光雷达检测与 yolox3d 相机检测在本环境跑不起来**。
> 权重来自独立 apt 包 `apollo-neo-perception-model-<名字>`（`apt-cache search perception-model` 可列全，
> 如 `apollo-neo-perception-model-yolox3d`、`-cnnseg64-caffe`、`-centerpoint-paddle`、`-radar4d`），
> 装模型用 `buildtool install perception-model-<名字>` 或直接 apt 装该包，**不是重新编译代码能解决的**。
> 判断方法：`ls /apollo/modules/perception/data/models/<目录>`，只看到 BUILD 与 README 就是没装。
> 完整对照见仓库根 `CLAUDE.md`。

`modules/perception/` 下 34 个子目录。**动手前先确认目标属于哪条链路的哪一段、用哪套插件机制。** 长知识（基类全清单、lidar 11 模块与 camera 4 条路线速查、后端细节、高危坑清单）见 `reference.md`。

## 1. 目录地图

**lidar 主链路（执行顺序）**：`pointcloud_preprocess` → `pointcloud_map_based_roi` → `pointcloud_ground_detection` → `lidar_detection`（或 `lidar_cpdet_detection`，二选一）→ `lidar_detection_filter` → `lidar_tracking` → `lidar_output`。旁支：`pointcloud_semantics` → `pointcloud_motion`（逐点语义/运动）、`lidar_segmentation`（二级分割补背景物体）。

**camera**：4 条并列检测路线 `camera_detection_multi_stage`（默认生产）/ `camera_detection_single_stage` / `camera_detection_bev` / `camera_detection_occupancy`（后三条默认关闭）；multi_stage 后接 `camera_location_estimation` → `camera_location_refinement` → `camera_tracking`。红绿灯四段 `traffic_light_region_proposal` → `_detection` → `_recognition` → `_tracking`。另有 `lane_detection`、`barrier_recognition`（输入其实是激光雷达）、`motion_service`（给 camera/lane 做运动补偿）。

**radar**：`radar_detection`（Continental ARS，目标级，无网络）、`radar4d_detection`（Oculii 点云级，PointPillars）。**fusion**：`multi_sensor_fusion`（ProbabilisticFusion，发布 `/apollo/perception/obstacles`）。**公共/外围**：`common`（base 数据结构 / algorithm / inference / registerer / util）、`data`（conf、flag、models、params）、`launch`（9 个 launch）、`perception_plugin`（外挂 cyber 插件示例集）、`msg_adapter`（内部 channel → protobuf）、`tools`（离线可视化、msg_exporter）。

## 2. 阶段 → 目录 → 插件基类（A=registerer，B=cyber PluginManager）

| 阶段 | 目录 | 基类（file:line） | 机制 |
|---|---|---|---|
| 点云预处理 | `pointcloud_preprocess` | `BasePointCloudPreprocessor` `interface/base_pointcloud_preprocessor.h:93` | A |
| 地图 ROI | `pointcloud_map_based_roi` | `BaseROIFilter` `roi_filter/hdmap_roi_filter/hdmap_roi_filter.h:106` | **B** |
| 地面分割 | `pointcloud_ground_detection` | `BaseGroundDetector` `interface/base_ground_detector.h:72` | A |
| 逐点语义/运动 | `pointcloud_semantics` / `pointcloud_motion` | `BasePointCloudParser:82` / `BaseMotionParser:82` | A |
| 主检测 | `lidar_detection` | `BaseLidarDetector` `interface/base_lidar_detector.h:84` | A |
| 降采样子槽 | `lidar_detection/down_sample_bank` | `BaseDownSample` `common/interface/base_down_sample.h` | **B** |
| 二级分割 | `lidar_segmentation` | 复用 `BaseLidarDetector` | A |
| 物体过滤 | `lidar_detection_filter/object_filter_bank` | `BaseObjectFilter` `interface/base_object_filter.h:59-78` | **B**，可并列多个 |
| 跟踪 | `lidar_tracking` | `BaseMultiTargetTracker:74`；子槽 `MlfBaseFilter` `tracker/multi_lidar_fusion/mlf_base_filter.h:82`、`BaseBipartiteGraphMatcher:83` | A |
| 相机检测 | `camera_detection_multi_stage/detector/{yolo,yolox3d}` | `BaseObstacleDetector` `common/interface/base_obstacle_detector.h:87` | A |
| 测距→精修→跟踪 | `camera_location_estimation` / `_refinement` / `camera_tracking` | `BaseTransformer:59` / `BasePostprocessor:72` / `BaseObstacleTracker:85` | A |
| 融合 | `multi_sensor_fusion` | `BaseFusionSystem:71`/`BaseDataAssociation:85`/`BaseGatekeeper:66` 是真插件；`BaseTracker`/`BaseTypeFusion`/`BaseExistenceFusion`/`BaseMotionFusion`/`BaseShapeFusion` 是**伪插件**（if-else 字符串，加实现必须改 C++）| A |

## 3. 两套插件机制

**A. perception 自研 registerer** — 编译期 `__attribute__((constructor))`，按**短名字符串**查找。基础设施 `common/lib/registerer/registerer.h:92`（`PERCEPTION_REGISTER_REGISTERER`）、`:143`（`PERCEPTION_REGISTER_CLASS`）、`GetInstanceByName` 在 `:98-111`（失败打印全部已注册名后返回 nullptr）。实现 `.cc` **末尾**写 `PERCEPTION_REGISTER_XXX(MyClass);`（范例 `lidar_detection/detector/center_point_detection/center_point_detection.cc:1260`、`camera_detection_multi_stage/detector/yolo/yolo_obstacle_detector.cc:263`）。**没有 plugins.xml**，`.cc` 必须进模块 BUILD 的 `apollo_cc_library` srcs。

**B. cyber PluginManager** — 运行期从 `plugins.xml` dlopen `.so`，按**全限定类名**查找。头文件末尾 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::perception::lidar::MyFilter, BaseObjectFilter)`（范例 `lidar_detection_filter/object_filter_bank/roi_boundary_filter/roi_boundary_filter.h:111`）。conf 里仍写短名，`ConfigUtil::GetFullClassName`（`common/lidar/common/config_util.cc:23-30`）在字符串不含 `::` 时自动前缀 `apollo::perception::lidar::`。BUILD 用 `apollo_plugin`（规则 `tools/apollo_package.bzl:647-678`）。

**与 planning 的差异**：planning 全部走 B；perception **默认是 A**，只有 ROIFilter / ObjectFilter / DownSample / 推理插件走 B。B 失败时 `CreateInstance` 返回 nullptr 且多处不判空 → 段错误；`ObjectFilterBank` 更糟，找不到只 AINFO + continue，**静默不生效**。

## 4. 三段式配置与路径解析

统一写法（`lidar_detection/conf/lidar_detection_config.pb.txt:5-9`）：
```
plugin_param {
  name: "CenterPointDetection"                    # 注册名（A 短名 / B 类名）
  config_path: "perception/lidar_detection/data"  # 去掉开头 modules/ 的目录
  config_file: "center_point_param.pb.txt"
}
```
解析全在 `common/util.cc`：`GetConfigFile(path,file):80` → `GetConfigPath(p):64`（前缀 `modules/`，走 `$APOLLO_CONF_PATH`）；`GetCommonConfigFile(f):28`（前缀 `modules/perception/data/conf/`）；`GetModelPath(name):44`（走 `$APOLLO_MODEL_PATH`，**无对应 gflag**）、`GetModelFile:55`。

四层链：`launch` → `dag`（`module_library` / `class_name` / `config_file_path` 绝对路径 / `flag_file_path` 统一指 `data/flag/perception_common.flag` / **`readers.channel` 是唯一输入 channel 定义处**）→ `conf/*.pb.txt`（**`output_channel_name` 是唯一输出 channel 定义处** + `plugin_param`）→ `data/*.pb.txt`（模型与算法参数）。改 channel 必须 dag + conf 两边同时改。

## 5. 新增一个插件

### 5a. 走 registerer（检测器 / 地面检测器 / 跟踪器 / MLF 滤波器 / 相机检测器）

以 lidar 检测器 `MyDetector` 为例：
1. `lidar_detection/detector/my_detector/my_detector.{h,cc}` 继承 `BaseLidarDetector`，实现三个纯虚 `Init(const LidarDetectorInitOptions&)` / `Detect(const LidarDetectorOptions&, LidarFrame*)` / `Name()`（`interface/base_lidar_detector.h:59-78`）；`.cc` 末尾 `PERCEPTION_REGISTER_LIDARDETECTOR(MyDetector);`
2. `Detect` 必须做（照抄 CenterPoint）：清 `frame->segmented_objects`、`ObjectPool::Instance().BatchGet` 取对象、填 `center/size/theta/direction/confidence/type/sub_type/type_probs` 与 `lidar_supplement`（`on_use`、`is_background`、`is_clustered`、`cloud`、`cloud_world`、`point_ids`、`raw_probs`、`raw_classification_methods`）、用 `CloudMask` 产出 `frame->secondary_indices`（否则 lidar_segmentation 无输入）。
3. `detector/my_detector/proto/model_param.proto`：复用 `common.ModelInfo` + `common.PointCloudPreProcess` + `common.PointCloudPostProcess`（`common/proto/model_process.proto`）再加私有字段。
4. `data/my_detector_param.pb.txt`（结构照 `data/center_point_param.pb.txt`）。
5. `lidar_detection/BUILD`：`.cc` 进 `apollo_perception_lidar_detection` 的 `srcs`、`.h` 进 `hdrs`（`BUILD:121-163`），新 proto target 进 `deps`。**不需要 plugins.xml。**
6. 改 `conf/lidar_detection_config.pb.txt` 的 `plugin_param` 三段式。
7. **改 `lidar_tracking/data/tracking/type_classifiers.property`**：首行计数 +1，追加一块以 `MyDetector`（= `Name()` 返回值）为名的 4×4 混淆矩阵。漏这步类型融合会静默忽略你的检测器。
8. `bazel build //modules/perception/lidar_detection/...`。

相机检测器同理：基类 `camera::BaseObstacleDetector`，纯虚 `Init(const ObstacleDetectorInitOptions&)` / `Detect(onboard::CameraFrame*)` / `Name()`（`common/interface/base_obstacle_detector.h:53-68`），宏 `REGISTER_OBSTACLE_DETECTOR(X)`，conf 改 `camera_detection_multi_stage/conf/camera_detection_multi_stage_front_config.pb.txt:3-7`。

### 5b. 走 PluginManager（物体过滤器 / ROI 过滤器 / 降采样 / 推理插件）

物体过滤器是**唯一支持并列多个的扩展点**，模板照抄 `lidar_detection_filter/object_filter_bank/roi_boundary_filter/`：
1. `object_filter_bank/my_obj_filter/my_obj_filter.{h,cc}` 继承 `BaseObjectFilter`，实现 `Init(const ObjectFilterInitOptions&)` / `Filter(const ObjectFilterOptions&, LidarFrame*)` / `Name()`；`.h` 末尾 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::perception::lidar::MyObjFilter, BaseObjectFilter)`。`Filter` 里就地压缩 `frame->segmented_objects` 再 `resize`（`strategy_filter.cc:221-231`）。
2. `my_obj_filter/plugins.xml`（照 `roi_boundary_filter/plugins.xml:1-3`）：`<library path="modules/perception/.../libmy_obj_filter.so"><class type="apollo::perception::lidar::MyObjFilter" base_class="apollo::perception::lidar::BaseObjectFilter"></class></library>`
3. `my_obj_filter/BUILD`（照 `roi_boundary_filter/BUILD:9-31`）：`apollo_plugin(name="libmy_obj_filter.so", description=":plugins.xml", deps=[":lib_mof"])` + `apollo_cc_library(name="lib_mof", srcs, hdrs, copts=PERCEPTION_COPTS+if_profiler()+["-DENABLE_PROFILER=1"], deps=[...])` + `apollo_package()` + `cpplint()`。
4. `object_filter_bank/proto/my_obj_filter_config.proto` + `data/my_obj_filter.pb.txt`。
5. **在 `lidar_detection_filter/data/filter_bank.pb.txt` 追加一段 `plugins{name,config_path,config_file}` —— 列表顺序即执行顺序**（现为 ROIBoundaryFilter → StrategyFilter）。不改 dag/conf/component 代码。
6. `bazel build //modules/perception/lidar_detection_filter/...`；启动后确认日志有 `Filter bank add filter: MyObjFilter`，**没有这行就是没加载上**。

ROI filter 只能**替换** `HdmapROIFilter`（component 只持有一个）。降采样插件继承 `BaseDownSample`，实现 `Process(options, base::PointFCloudPtr&)`（引用，可整体换指针），挂在检测器 `data/*_param.pb.txt` 的 `plugins` 段（`center_point_param.pb.txt:75-79`）。不进主仓可放 `perception_plugin/`（已有 5 个示例）。

## 6. 接入新模型

**放哪**：`modules/perception/data/models/<目录名>/`（现有 20 个，如 `center_point_paddle`、`point_pillars_torch`、`cnnseg64_caffe`、`yolox3d_onnx`、`smoke_torch`、`3d-r4-half_caffe`、`apollo_bevnet_onnx`）。运行期实际从 **`$APOLLO_MODEL_PATH`** 下按 `info.name` 找目录。权重不在 git。

**conf 怎么指**（`data/center_point_param.pb.txt:3-21`）：`info{ name（=模型目录名）, framework, proto_file{file}, weight_file{file}, inputs{name}, outputs{name}… }`；可选 `anchors_file`/`types_file`/`expand_file`/`calibration_file`（`common/proto/model_info.proto:40-49`；YOLO 六个全用，见 `camera_detection_multi_stage/data/yolo.pb.txt:9-26`）。

**后端**（`common/inference/inference_factory.cc`）：`Framework` 枚举 8 个值（`model_info.proto:20-27`），工厂**只实现 5 条**（`:68-85`）：`TensorRT`（`:69-73`，**model_root 非空→RTNetInt8，为空→RTNet FP32**）、`PyTorch`→TorchNet、`PaddlePaddle`→PaddleNet、`Obstacle`→ObstacleDetector、`Onnx`→SingleBatchInference。`TensorFlow`/`Caffe` 配到必返 nullptr。字符串版重载 `:45-58` 接受 `"RTNet"/"RTNetInt8"/"TorchNet"/"Obstacle"/"Onnx"/"PaddleNet"`。填了 `info.infer_plugin` 则**绕过工厂**，用 PluginManager 加载 `apollo::perception::inference::<plugin>`（`common/interface/base_obstacle_detector.cc:30-73`；现有 `MultiBatchInference`，实现在 `perception_plugin/inference/onnx_multi_batch/`）。

**blob 约定**：`Inference` 基类（`common/inference/inference.h:41-70`）输入输出全是 `base::BlobPtr<float>`，由 net 拥有，`get_blob(name)` 取，`Init(shapes)` 的 shape 是 NCHW。blob 名全来自 conf 的 `inputs`/`outputs`，**代码按下标取**（CenterPoint `center_point_detection.cc:306-309`：out[0]=box, [1]=score, [2]=label）。**改名字只改 conf，改顺序直接串线。** 用 `inference::GetBlobNames`+`AddShape`（`common/inference/model_util.h`）。GPU 写完必须 `set_head_gpu()`（`base/blob.h:288`）。

只换权重：文件放进 `$APOLLO_MODEL_PATH/<新目录>/`，改 `data/*_param.pb.txt` 的 `info.name`+`proto_file`+`weight_file`，**不用重编**。换已有检测器：只改 conf `plugin_param`。换类别数/顺序、换 BEV 网格范围必须改代码，详见 `reference.md`。

## 7. 单模块离线调试（msg_adapter）

perception 内部 `inner` channel 传 C++ 结构体指针（零拷贝，`cyber_monitor` 看不到）；msg_adapter 把它们转成 `PerceptionObstacles`。Component 无模板参数（无 trigger channel），dag 里因此**没有 `readers` 段**（`msg_adapter/dag/msg_adapter.dag:1-11`）。三条通路（`msg_adapter_component.cc:27-49`）：`--cameraframe_to_obstacles_{in,out}`（`onboard::CameraFrame`）、`--sensorframe_message_to_obstacles_{in,out}`（`onboard::SensorFrameMessage`）、`--lidarframe_to_obstacles_{in,out}`（`onboard::LidarFrameMessage`）。默认值（`msg_adapter/common/msg_adapter_gflags.cc:19-35`）：三个 `*_in` 都是 `/fake_topic`（= 关闭该通路的哨兵），三个 `*_out` 都是 `/apollo/perception/obstacles`。**实际开关在 `data/flag/perception_common.flag:154-157`**，当前只开 `--sensorframe_message_to_obstacles_in=/perception/inner/PrefusedObjects`，另两行注释掉。三路输出 channel 相同，**同时开多路互相干扰**（`msg_adapter/README.md:45-46`）。

步骤：改 flag 只留一路 → `cyber_launch start modules/perception/launch/perception_lidar.launch`（该 launch `:6` 已带 msg_adapter.dag，camera/radar 的 4 个调试 launch 同样带；**`perception_all.launch` 不带**）→ `cyber_monitor` 看 `/apollo/perception/obstacles`。注意 `lidarframe` 路取的是**未跟踪**的 `segmented_objects`，自行做世界系变换并用递增序号临时充当 `track_id`。

**不起 cyber 的离线工具**：`bash modules/perception/lidar_detection/tools/offline_lidar_detection.sh`（`:19-29` 改 `pcd_path`/`output_path`/`--detector_name`/`--config_file`；它只建 detector + ObjectBuilder，**不跑 ROI/ground**，`roi_indices`/`non_ground_indices` 为空，依赖它们的分支行为与在线不同）。同类：`lidar_cpdet_detection/tools/`、`pointcloud_ground_detection/tools/`、`tools/offline_camera_detection/offline_camera_detection.sh`。落盘对比：`lidar_output/conf/lidar_output_config.pb.txt` 的 `save_lidar_frame_message`（检测后跟踪前）与 `save_benchmark_frame`（跟踪后）可把"检测问题"与"跟踪问题"分开。

## 8. 坐标系与时间戳

三层：sensor 系（lidar x 前 y 左 z 上；相机 z 为光轴；radar 极坐标 range/angle 同为 x 前 y 左）→ `novatel`（perception 的车体系事实标准，`--obs_sensor2novatel_tf2_frame_id`，`data/flag/perception_common.flag:59`）→ `world`（UTM/ENU，`--obs_novatel2world_tf2_frame_id`，`:64`）。`sensor2world = novatel2world * sensor2novatel`（`common/onboard/transform_wrapper/`），前者静态只查一次并缓存，后者每帧查 TF2。

`Object::center`/`anchor_point`/`polygon` 是**世界系 double**（UTM ~1e6）；`LidarFrame::cloud` 是**lidar 系 float**，`world_cloud` 是世界系 double，两者顺序一致；`roi_indices`/`non_ground_indices`/`secondary_indices` **都是对 `cloud` 的下标**；`CameraObjectSupplement::local_center` 在相机系、`box` 在像素系。`PointCloud::TransformPointCloud()` 就地变换后把 pose 置 identity，**重复调用静默出错**。链路里同时存在 3 个 "local" 系（lidar 系 / world 系 / world 朝向+自车原点系），"ROI 或地面转了"多半在这。

时间戳全局统一 **double 秒**（Unix epoch），`tracking_time` 是**时长**不是绝对时间；例外是 `common/lidar/common/lidar_timer.h:24-39` 的 `Timer::toc()` 返回**毫秒**、`common/camera/common/timer.h` 返回微秒级 —— 混用差 1000 倍。单位：米、**弧度**、m/s、m/s²。`direction` 与 `theta` 必须同步改（`base/object.h:47,52`）；新增 `ObjectSubType` 必须同时改 `kSubType2TypeMap`（`base/object_types.h:230-247`），否则粗类退化成 UNKNOWN。

## 9. 排错表

| 现象 | 检查顺序 |
|---|---|
| 插件没加载 | ① 名字与 `PERCEPTION_REGISTER_XXX(X)` / `plugins.xml` 的 `type` 是否逐字一致 ② A 类看日志有无 `Get instance X failed.` + 全部已注册名（`registerer.h:98-111`）③ B 类不报错，靠 `add filter: X` / `MlfTrackObjectMatcher, fg: X` 日志确认 ④ `.cc` 是否进了 BUILD srcs、是否 alwayslink（`apollo_plugin` 自带）⑤ `plugins.xml` 的 `.so` 路径与 `apollo_plugin` 的 `name` 是否一致 |
| 不出障碍物 | ① `cyber_channel hz` 逐级打（preprocess→map_based_roi→ground_detection→detection→detection_filter→PrefusedObjects→obstacles），第一个不出数的即问题模块 ② dag `readers.channel` 与上游 conf `output_channel_name` 是否对齐 ③ 融合无输出先查 main sensor：默认只有 `velodyne64`（`data/conf/sensor_meta.pb.txt`），日志只平静打 `Skip because it is not the main sensor` ④ 相机：`sensor_meta.pb.txt` 里有无该 `camera_name`（缺了 multi_stage 是空指针解引用）⑤ 看 `Object filter bank, filtered objects size: from N to M` 是否被过滤掉 |
| 模型加载失败 | ① `$APOLLO_MODEL_PATH`/`$APOLLO_CONF_PATH` 是否设置（未设时 `GetModelPath` 只打 error 返回空串）② `data/models/<info.name>/` 目录与文件名是否匹配 ③ `framework` 是否在工厂实现的 5 种内 ④ TensorRT 且 model_root 非空会走 INT8，目录里须有合法 `CalibrationTable` ⑤ `inputs`/`outputs` blob 名与数量是否与模型一致 |
| GPU 相关 | ① `gpu_id`（`center_point_param.pb.txt:24`、camera conf 的 `gpu_id`）② 结果全零先查 `mutable_gpu_data()` 后有无 `set_head_gpu()`（`base/blob.h:288`）③ AMD：`inference_factory.cc:23-33` 与 `camera/common/image_data_operations.cc:20-32` 的 `GPU_PLATFORM` 分支**两边都要补**，且 INT8 静默退化为 FP32 ④ `.cu` 要用 `gpu_library` + `if_cuda`/`if_rocm` 双分支（`lidar_detection/BUILD:104-119`）|
| 帧率低 | ① `bazel --define profiler=true`，看各 Component `PERF_BLOCK` 块名（`lidar_detector`、`filter_bank`、`multi_target_tracker`…）② 检测器耗时日志 `CenterPoint: down sample / fuse / inference / postprocess / nms`（`center_point_detection.cc:372-380`）③ `FRAME_STATISTICS:LidarTracking:End:...cur_latency` 看端到端延迟 ④ 降采样开关（`enable_downsample_pointcloud`、`PclDownSample`→`GpuDownSample`）⑤ cyber `pending_queue_size=1` 会丢帧 |

**改动后固定动作**：`bazel build` 对应模块 → 启动后先看 `... Component Configs: <DebugString>`（`lidar_detection_component.cc:32`）确认**实际生效值**（proto 默认值 ≠ pb.txt 值 ≠ C++ 成员初值，删掉 pb.txt 一行会退回 proto 默认）→ 逐级 `cyber_channel hz`。

已知高危坑（fail-open、索引语义不兼容、伪插件、写死的 conf 文件名、camera K 恒为单位矩阵等）全在 `reference.md`。**动跟踪、地面检测、camera 3D 高度、融合存在性之前必读。**
