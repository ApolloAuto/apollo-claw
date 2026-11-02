# 04 lidar 检测/跟踪族

<!--
file: references/manual/16_感知源码/04_lidar检测跟踪族.md
scope: 11.0（默认，本机 profile = ARCF_40P）
tags: lidar_detection, lidar_cpdet_detection, lidar_segmentation, lidar_detection_filter, lidar_tracking, lidar_output, barrier_recognition, ObjectFilterBank, filter_bank, CenterPointDetection, CPDetection, MlfEngine, PclDownSample, BaseObjectFilter, PluginManager, Registerer, 模型权重
sources（本轮 read 打开）:
- /opt/apollo/neo/src/modules/perception/lidar_detection/lidar_detection_component.{h,cc}
- /opt/apollo/neo/src/modules/perception/lidar_detection/conf/lidar_detection_config.pb.txt
- /opt/apollo/neo/src/modules/perception/lidar_detection/data/center_point_param.pb.txt
- /opt/apollo/neo/src/modules/perception/lidar_detection_filter/{interface/base_object_filter.h, data/filter_bank.pb.txt, object_filter_bank/object_filter_bank.cc, lidar_detection_filter_component.cc, conf/lidar_detection_filter_config.pb.txt}
- /opt/apollo/neo/src/modules/perception/lidar_tracking/{lidar_tracking_component.cc, conf/lidar_tracking_config.pb.txt}
- /opt/apollo/neo/src/modules/perception/lidar_cpdet_detection/{lidar_cpdetection_component.cc, conf/lidar_detection_config.pb.txt}
- /opt/apollo/neo/src/modules/perception/lidar_segmentation/{lidar_segmentation_component.cc, conf/lidar_segmentation_config.pb.txt}
- /opt/apollo/neo/src/modules/perception/barrier_recognition/{barrier_recognition_component.cc, conf/barrier_recognition_config.pb.txt, data/barrier_bank.pb.txt}
- /opt/apollo/neo/src/modules/perception/lidar_output/dag/{lidar_output.dag, lidar_fusion_output.dag, lidar_results_output.dag}
- /apollo_workspace/profiles/current/modules/perception/lidar_detection_filter/data/filter_bank.pb.txt
- /apollo_workspace/.manual_work/inventory/perception_inventory.md（盘点主素材）
- manual/16_感知源码/{01_总览与四大链路.md, 02_组件插件架构与子包骨架.md, 10_本环境感知运行现状.md}（体例与已核事实）
-->

## 0. 一句话作用

lidar 链的**后半段**：从 `pointcloud_ground_detection` 拿到去地面点云后，经
**检测（lidar_detection / lidar_cpdet_detection 二选一）→ 分割旁路（lidar_segmentation）→
后处理（lidar_detection_filter）→ 跟踪（lidar_tracking）**，产出 `/perception/inner/PrefusedObjects`
交给 fusion；`lidar_output` 是三个**聚合 dag**（整链串行或单级输出 `/apollo/perception/obstacles`），
`barrier_recognition` 是吃同一检测输入的**杆/闸识别旁路**（出 `/apollo/perception/barrier`）。
七个子包复用的是 02 篇那套「Component 外壳 + Base* 接口 + plugin_param 三段式」骨架。

## 1. 七子包总表

`dag readers` 与 `conf output` 本轮 `grep` 全量提取 + read 复核；`取实例通道` 见 §7。

| 子包 | 组件名（class_name） | dag 输入（readers） | conf 输出 | 一句话职责 | 关键 conf | 取实例通道 |
|---|---|---|---|---|---|---|
| lidar_detection | `LidarDetectionComponent` | `/perception/lidar/pointcloud_ground_detection` | `/perception/lidar/detection` | 主检测器（默认 CenterPoint） | `conf/lidar_detection_config.pb.txt`（plugin_param=CenterPointDetection）+ `data/center_point_param.pb.txt` | detector=**Registerer**（BaseLidarDetector）；嵌套 PclDownSample=**PluginManager** |
| lidar_cpdet_detection | `LidarCPDetectionComponent` | 同左（dag 同名） | `/perception/lidar/detection`（**同通道，与上者二选一**） | cpdet 检测器 | `conf/lidar_detection_config.pb.txt`（plugin_param=CPDetection） | detector=**Registerer**（BaseCPDetector）；嵌套 PclPCDownSample=**PluginManager** |
| lidar_segmentation | `LidarSegmentationComponent` | `/perception/lidar/detection` | `/perception/lidar/segmentation` | 分割式提取 + SemanticBuilder（几何分割，无权重） | `conf/lidar_segmentation_config.pb.txt`（GraphSegmentation） | segmentor=**Registerer**（复用 BaseLidarDetector） |
| lidar_detection_filter | `LidarDetectionFilterComponent` | `/perception/lidar/detection` | `/perception/lidar/detection_filter` | filter bank 串行后处理 | `conf/lidar_detection_filter_config.pb.txt`（ObjectFilterBank）+ `data/filter_bank.pb.txt` | ObjectFilterBank=**组件成员直构**；4 个 filter=**PluginManager**（BaseObjectFilter） |
| lidar_tracking | `LidarTrackingComponent` | `/perception/lidar/detection_filter` | `/perception/inner/PrefusedObjects` | MLF 多目标跟踪 | `conf/lidar_tracking_config.pb.txt`（MlfEngine） | tracker=**Registerer**（BaseMultiTargetTracker） |
| lidar_output | `LidarOutputComponent` | 3 个聚合 dag（见 §5） | `/apollo/perception/obstacles` | 整链聚合 / 单级输出 | `conf/lidar_output_config.pb.txt` | 无算法，纯输出封装 |
| barrier_recognition | `BarrierRecognitionComponent` | `/perception/lidar/detection` | `/apollo/perception/barrier` | 杆/闸识别 + 状态跟踪（**依赖 HDMap**） | `conf/barrier_recognition_config.pb.txt`（BarrierRecognizerBank / BarrierStatusTracker）+ `data/barrier_bank.pb.txt` | bank/tracker=**成员直构**；StraightPoleRecognizer=**PluginManager**（BaseBarrierRecognizer） |

## 2. lidar_detection 精读（主干）

**组件外壳** `lidar_detection_component.h`：`class LidarDetectionComponent : public cyber::Component<LidarFrameMessage>`（:35），
成员 `sensor_name_` / `use_object_builder_` / `shared_ptr<BaseLidarDetector> detector_` / `Writer<LidarFrameMessage> writer_`
（:75-81），末尾 `CYBER_REGISTER_COMPONENT(LidarDetectionComponent)` 写**非限定名**（:84）。

**Init**（`lidar_detection_component.cc:26-68`）四步：
1. `GetProtoConfig(&comp_config)` 读 dag 的 `config_file_path`（:27-28）；
2. `output_channel_name_ = comp_config.output_channel_name()` → `node_->CreateWriter`（:36-38）——输出在 conf，不在 dag；
3. `plugin_param.name()` → `BaseLidarDetectorRegisterer::GetInstanceByName(detector_name)`（:44-46，`CHECK_NOTNULL` 崩，
   **Registerer 通道**），把 `config_path/config_file` 塞进 `LidarDetectorInitOptions` 后 `detector_->Init`（:50-54）；
4. `use_object_builder_` 时 `builder_.Init`（:61-64）。

**Proc/InternalProc**（:70-105）：`InternalProc` 先 `detector_->Detect(...)`（:87）再 `builder_.Build(...)`（:97），
成功才 `writer_->Write(message)`（:76）；`PERF_BLOCK("lidar_detector"/"object_builder")` 分段计时（:85,94）。

**conf 三段式换检测器**（`conf/lidar_detection_config.pb.txt`）：`output_channel_name "/perception/lidar/detection"`（:1）、
`sensor_name "velodyne64"`（:2）、`use_object_builder true`（:3）；`plugin_param { name "CenterPointDetection" config_path
"perception/lidar_detection/data" config_file "center_point_param.pb.txt" }`（:5-9）为**生效档**；PointPillars / MaskPillars /
CNNSegmentation 三段全被 `#` 注释（:11-30）——换检测器 = 换注释块。

**实例级 conf 里的嵌套插件**（`data/center_point_param.pb.txt`）：
- `info` 块（:3-21）：`name "center_point_paddle"`、`framework PaddlePaddle`、`proto_file "centerpoint.pdmodel"`、
  `weight_file "centerpoint.pdiparams"`、`inputs "data"` / `outputs _generated_var_11/12/13`；
- `preprocess`（:23-39）/ `postprocess`（:41-53，score_threshold 0.25 等）/ `paddle_settings`（:55-63，`use_trt false`）;
- 末尾 `plugins { name "PclDownSample" config_path "perception/lidar_detection/data/plugins" config_file
  "pcl_down_sample.pb.txt" }`（:75-79）——这是**第二层 PluginManager 插件**（下采样），见 02 篇 §3.3。

## 3. lidar_detection_filter：object_filter_bank 串 filter

`BaseObjectFilter` 接口（`interface/base_object_filter.h`）：**纯 PluginManager 基类**，只 include
`cyber/plugin_manager/plugin_manager.h`（:22），无注册宏；三个纯虚 `Init(ObjectFilterInitOptions&)`（:59-60）/
`Filter(ObjectFilterOptions&, LidarFrame*)`（:70-71）/`Name()`（:78）；`ObjectFilterInitOptions` 只多一个
`sensor_name`（:32-34）。

**组件直构 bank**（`lidar_detection_filter_component.cc:39-45`）：`use_object_filter_bank_` 为真时，把 conf 的
`plugin_param.config_path/config_file` 塞进 `ObjectFilterInitOptions` 直接 `filter_bank_.Init(...)`——
**`ObjectFilterBank` 是组件成员对象，不是插件**（conf 里的 `name "ObjectFilterBank"` 字段根本没被读，只读路径）。

**bank 按 filter_bank.pb.txt 串插件**（`object_filter_bank/object_filter_bank.cc:29-58`）：`Init` 读 config 后
`for i in config.plugins_size()` 逐个 `PluginManager::Instance()->CreateInstance<BaseObjectFilter>(
ConfigUtil::GetFullClassName(name))`（:39-42），**找不到返回 nullptr 只 AINFO `skipped` 后 `continue`**（:43-46，
静默少一个 filter，不报错）；`Filter`（:60-71）按 `filter_bank_` 顺序逐个 `filter->Filter`，打「from N to M」日志。

**启用集两版不同**（filter 顺序即执行顺序，注释=不启用）：
- 包内 `src/.../data/filter_bank.pb.txt`（10 行）：`ROIBoundaryFilter` + `StrategyFilter`（:1-10）；
- profile 运行档 `profiles/current/.../filter_bank.pb.txt`（35 行，真正生效）：`ROIBoundaryFilter`(:1) →
  `StrategyFilter`(:11) → `SemanticFilter`(:16) → `BigmotRefineFilter`(:26)；`BackgroundFilter`/`MarkAreaFilter`/
  `ObjectSplitFilter` 被注释（:6-10 / :21-25 / :31-35）。

四者全部属 14 条 PluginManager 注册里的 `BaseObjectFilter` 家族（ROIBoundary/Strategy 在 `lidar_detection_filter/
object_filter_bank/`，Semantic/BigmotRefine 在 `perception_plugin/lidar_detection_filter/`），.so 与索引全在。

## 4. lidar_tracking 主干

`lidar_tracking_component.cc`：
- **Init**（:28-66）：读 conf → `writer_ = node_->CreateWriter<SensorFrameMessage>(output_channel_name)`（:37-38）；
  `multi_target_tracker_param.name()` → `BaseMultiTargetTrackerRegisterer::GetInstanceByName(...)`（:41-45，
  **Registerer 通道**，`CHECK_NOTNULL`）→ `multi_target_tracker_->Init(...)`（:50）；`fusion_classifier` 段被注释（:52-64）。
- **Proc/InternalProc**（:68-141）：`InternalProc` 造 `SensorFrameMessage`，拷 `timestamp/lidar_timestamp/seq_num/
  process_stage=LIDAR_RECOGNITION/sensor_id`（:90-94）；`multi_target_tracker_->Track(...)`（:106）后把
  `lidar_frame->tracked_objects` 塞进 `frame->objects`（:128），成功才 `writer_->Write(out_message)`（:79）。

**conf**（`conf/lidar_tracking_config.pb.txt`）：`output_channel_name "/perception/inner/PrefusedObjects"`（:1）；
`multi_target_tracker_param { name "MlfEngine" config_path "perception/lidar_tracking/data/tracking" config_file
"mlf_engine.pb.txt" }`（:2-6）；`fusion_classifier_param` 被注释（:7-11）。**无模型权重**（MLF 是几何/关联跟踪）。

## 5. lidar_output：三个聚合 dag（read 全文）

`conf/lidar_output_config.pb.txt:1` 输出 `/apollo/perception/obstacles`；组件 `LidarOutputComponent`
（`lidar_output_component.{h,cc}`）。三个 dag 都是**多 module_config 串行拉起整条 lidar 链**（本表按 read 顺序）：

| dag | module_config 序列 | 首级输入 | 终点 |
|---|---|---|---|
| `lidar_output.dag`（104 行） | preprocess → map_based_roi → ground_detection → **lidar_detection**(CenterPoint) → detection_filter → tracking → **lidar_output** | `/apollo/sensor/lidar16/compensator/PointCloud2`(:10) | `/apollo/perception/obstacles`（纯 lidar 直出，不经 fusion） |
| `lidar_fusion_output.dag`（89 行） | 同上**去掉 lidar_output**（到 tracking 止） | 同左(:10) | `/perception/inner/PrefusedObjects`（交给 multi_sensor_fusion） |
| `lidar_results_output.dag`（14 行） | **仅 lidar_output** 一个组件 | `/perception/inner/PrefusedObjects`(:10) | `/apollo/perception/obstacles`（fusion 之后的独立输出级） |

三个都吃 `lidar16` 补偿点云（非 `velodyne64`，与 §2 conf 的 `sensor_name` 分属「输入源 vs 算法 sensor 名」两回事）；
`lidar_output.dag` 内挂的是 `lidar_detection`（CenterPoint），不是 cpdet。`lidar_output.launch` **未发布到
share/运行时层**（只有 src 有，见 10 篇 §6②），串行跑整链用 `mainboard -d .../lidar_output.dag` 或 profile 聚合 launch。

## 6. 模型依赖（谁要权重、谁能跑）

本族需权重的只有**两个检测器包**，其余（segmentation 几何分割、filter、tracking、output、barrier）**无 NN 权重**。
对照 10 篇 §2.1 权重清单：

| 检测器（plugin_param name） | 模型目录 | 权重现状 | 能否跑 |
|---|---|---|---|
| `CenterPointDetection`（lidar_detection 生效档） | `center_point_paddle`（PaddlePaddle） | ✅ centerpoint.pdmodel+pdiparams | **能跑**（`perception_lidar` 走这条） |
| `CPDetection`（lidar_cpdet_detection 生效档） | `cpdet`（onnx） | ✅ cpdet_backbone.onnx + cpdet_pfe.onnx | **能跑**（`perception_all`/`perception_lidar_cpdet` 走这条） |
| `PointPillarsDetection`（conf 已注释） | `point_pillars_torch` | ❌ 仅 BUILD+README | 缺权重，起不来 |
| `MaskPillarsDetection`（conf 已注释） | `mask_pillars_torch` | ❌ 仅 BUILD+README | 缺权重，起不来 |
| `CNNSegmentation`（conf 已注释） | `cnnseg16/64/128_caffe` | ❌ 仅 BUILD+README | 缺权重，起不来 |

`lidar_segmentation` 走的是 `GraphSegmentation`（几何，**不读 cnnseg 权重**），故可跑；cnnseg 系只在把
`lidar_detection` conf 换回 `CNNSegmentation` 时才会踩空。补权重：`apt-cache search perception-model` →
`buildtool install perception-model-<名>`。

## 7. 取实例通道总表（本族 vs 14 条 PluginManager 注册）

| 包 | 组件级算法 | 通道 | 嵌套/底层插件 | 通道 |
|---|---|---|---|---|
| lidar_detection | CenterPointDetection | Registerer（BaseLidarDetector） | PclDownSample | PluginManager（BaseDownSample，14 条之一） |
| lidar_cpdet_detection | CPDetection | Registerer（BaseCPDetector） | PclPCDownSample | PluginManager（BaseDownSample） |
| lidar_segmentation | GraphSegmentation | Registerer（复用 BaseLidarDetector） | — | — |
| lidar_detection_filter | ObjectFilterBank | 组件成员直构（非插件） | ROIBoundary/Strategy/Semantic/BigmotRefine | PluginManager（BaseObjectFilter，7 条中 4 条启用） |
| lidar_tracking | MlfEngine | Registerer（BaseMultiTargetTracker） | — | — |
| lidar_output | LidarOutputComponent | 无算法 | — | — |
| barrier_recognition | BarrierRecognizerBank / BarrierStatusTracker | 组件成员直构（非插件） | StraightPoleRecognizer | PluginManager（BaseBarrierRecognizer） |

14 条 PluginManager 注册里本族用到 **6 条**（PclDownSample、PclPCDownSample、4 个 BaseObjectFilter、
StraightPoleRecognizer）；未用到 GpuDownSample、HdmapROIFilter/ROIServiceFilter（pointcloud_map_based_roi 包）、
MultiBatchInference、MarkAreaFilter/ObjectSplitFilter/BackgroundFilter（被注释）。Registerer 通道失败 `CHECK_NOTNULL`
直接崩，PluginManager 通道失败 `CreateInstance` 返回 nullptr → 上层 AINFO 静默跳过（见 §3 与 02 篇 §3.1）。

## 8. 修改与扩展点（4 个）

**① 新增 detector（Registerer 型，本族主通道）**：在 `lidar_detection/detector/my_det/` 建包，继承
`interface/base_lidar_detector.h` 的 `BaseLidarDetector`（纯虚 `Init`/`Detect`/`Name`），实现末尾写
`PERCEPTION_REGISTER_LIDARDETECTOR(MyDet)`（宏定义见 base_lidar_detector.h:84-86），加入包 BUILD 的 `srcs`
（与组件同 .so），再把 `conf/lidar_detection_config.pb.txt` 的 `plugin_param.name` 改成 `MyDet`；
`config_path/config_file` 指向新 `data/my_det_param.pb.txt`（`info.name` = 模型目录，需放权重到
`$APOLLO_MODEL_PATH` 即 `/apollo/modules/perception/data/models/<名>/`）。

**② 新增 filter（PluginManager 型）**：在 `lidar_detection_filter/object_filter_bank/my_filter/` 建包，继承
`BaseObjectFilter`，头文件末尾 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::perception::lidar::MyFilter,
BaseObjectFilter)`，`plugins.xml` 写 `base_class="apollo::perception::lidar::BaseObjectFilter"`（**最顶层基类**），
BUILD 用 `apollo_plugin(description=":plugins.xml")`；再在 `filter_bank.pb.txt` 加一段 `plugins { name "MyFilter" ... }`
（短名，`GetFullClassName` 自动补前缀；列表顺序=执行顺序）。

**③ 换检测器/调参（零代码）**：改 `/apollo/modules/perception/<pkg>/conf/*.pb.txt` 或 `data/*_param.pb.txt`
（软链立即生效，写穿到 readlink 落点）；换检测器=改 `plugin_param` 注释块；改 filter 启用集=编辑
`filter_bank.pb.txt`（profile 层 vs 包内层，见 §3）。

**④ 新增整链组件**：`buildtool create --template component modules/perception/my_stage` 生成六件套后补
`interface/` + `conf`（含 `output_channel_name` + `plugin_param`）+ `dag/readers`（只声明输入，`flag_file_path:
/apollo/modules/perception/data/flag/perception_common.flag`），`buildtool build -p modules/perception/my_stage`。

## 9. ⚠️ 本环境注意

1. **conf/dag 落点要 `readlink -f` 判层**：本族 `lidar_detection`、`lidar_detection_filter` 的 conf/data 大量指向
   profile 覆盖层 `/apollo_workspace/profiles/ARCF_40P/...`，而 dag 多指 share 出厂件——同一包内混存是常态（02 篇 §5③）。
2. **filter_bank.pb.txt 两版不同**：包内 src 只启用 2 个 filter，profile 运行档启用 4 个（§3）——判断「实际跑哪些
   filter」必须看 profile 那份，别只看 src。
3. **`lidar_detection` 与 `lidar_cpdet_detection` 输出同 channel**（都 `/perception/lidar/detection`）且 dag 同名
   读同一输入，二选一；`perception_all` 跑 cpdet、`perception_lidar` 跑 CenterPoint（10 篇 §4）。
4. **缺权重只影响检测器**：cnnseg/point_pillars/mask_pillars 空目录（§6），换上去「起得来、不出障碍物或 Init 失败」；
   segmentation/filter/tracking/output/barrier 本族无 NN 依赖。
5. **`lidar_output.launch` 未发布**（只 src 有）、插件索引在 `/opt/apollo/neo/share/cyber_plugin_index/`（不扫
   bazel-bin）——改插件必须 `buildtool build -p` 完成 install 才进索引（10 篇 §6②、02 篇 §5①）。
6. **搜 `/apollo/...` 用 `grep -R`**（`-r` 不跟随符号链接会假空）。
7. `barrier_recognition` 依赖高精地图（`hd_map_->Init()`，barrier_recognition_component.cc:56-64），地图目录不存在则
   起不来/无输出。

## 10. 验证命令（只读）

```bash
# 七子包 channel 一览（dag 输入 + conf 输出）
for p in lidar_detection lidar_cpdet_detection lidar_segmentation lidar_detection_filter lidar_tracking lidar_output barrier_recognition; do
  echo "== $p"; grep -RhoE 'channel *: *"[^"]+"' /apollo/modules/perception/$p/dag/ | sort -u
  grep -RHnE 'output[a-z_]*channel[a-z_]*name' /apollo/modules/perception/$p/conf/; done
# 生效的检测器 / 跟踪器 / filter 启用集
grep -E 'name|config_file' /apollo/modules/perception/lidar_detection/conf/lidar_detection_config.pb.txt
cat /apollo/modules/perception/lidar_detection_filter/data/filter_bank.pb.txt   # profile 档，看启用哪 4 个
readlink -f /apollo/modules/perception/lidar_detection_filter/data/filter_bank.pb.txt  # 判 profile/share
# 模型权重在不在（只有 BUILD+README = 没装）
ls -A /apollo/modules/perception/data/models/center_point_paddle/
ls -A /apollo/modules/perception/data/models/cpdet/
ls -A /apollo/modules/perception/data/models/point_pillars_torch/
# 单组件前台调 / 整链起
mainboard -d /apollo/modules/perception/lidar_detection/dag/lidar_detection.dag
cyber_launch start /apollo/modules/perception/launch/perception_lidar_cpdet.launch
# 插件装没装（本族相关）
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep perception
```

## 11. 溯源

- 蒸馏日期：2026-09-08；基线 Apollo 11.0.0 包工作区，profile = ARCF_40P；**全程只读，未启动任何模块**。
- 本轮 read 打开（行号可引）：front-matter `sources` 全部 27 项（lidar_detection / lidar_cpdet / lidar_segmentation /
  lidar_detection_filter / lidar_tracking / lidar_output / barrier_recognition 七包的组件 .cc、conf、data、dag，
  + base_object_filter.h + object_filter_bank.cc + profile filter_bank.pb.txt + 01/02/10 三篇 + 盘点表 + _template.md）。
- 本轮 bash 证据（非行号引用）：`grep` 提取 7 包 dag readers 与 conf `output_*_channel_name`、7 包顶层/conf/dag 目录清单。
- 遗留待核：① 各链实测频率与「预期可起」未实跑；② `lidar_detection` 里 PointPillars/MaskPillars/CNNSeg 三档
  `data/*_param.pb.txt` 的模型目录名是否与 §6 一致（未逐一 read，仅据 10 篇清单）；③ `barrier_recognition` 的输出
  `/apollo/perception/barrier` PnC 侧是否有消费者（10 篇 §2.5 记为「对外但 PnC 不订」）。
