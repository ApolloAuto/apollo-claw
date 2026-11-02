# 08 multi_sensor_fusion 融合（感知输出汇聚点）

<!--
file: references/manual/16_感知源码/08_fusion.md
scope: 11.0（默认，本机 profile = ARCF_40P）
tags: perception, multi_sensor_fusion, 融合, ProbabilisticFusion, PrefusedObjects, obstacles, SensorFrameMessage, MainSensor, 主传感器, lidar16_back, Registerer, BaseFusionSystem, PbfTracker, data_association, gatekeeper, lidar_output, 纯lidar模式, fusion conf落点, 插件通道
sources:
- /opt/apollo/neo/src/modules/perception/multi_sensor_fusion/dag/multi_sensor_fusion.dag（全文 14 行）
- /apollo_workspace/profiles/ARCF_40P/modules/perception/multi_sensor_fusion/conf/multi_sensor_fusion_config.pb.txt（全文 9 行）
- /opt/apollo/neo/src/modules/perception/multi_sensor_fusion/multi_sensor_fusion_component.h（全文 66 行）
- /opt/apollo/neo/src/modules/perception/multi_sensor_fusion/multi_sensor_fusion_component.cc（全文 209 行）
- /opt/apollo/neo/src/modules/perception/multi_sensor_fusion/interface/base_fusion_system.h（全文 77 行）
- /opt/apollo/neo/src/modules/perception/multi_sensor_fusion/interface/base_gatekeeper.h（全文 72 行）
- /opt/apollo/neo/src/modules/perception/multi_sensor_fusion/interface/base_data_association.h（全文 91 行）
- /opt/apollo/neo/src/modules/perception/multi_sensor_fusion/data/probabilistic_fusion.pb.txt（全文 23 行）
- /opt/apollo/neo/src/modules/perception/multi_sensor_fusion/fusion/fusion_system/probabilistic_fusion/probabilistic_fusion.cc（全文 447 行）
- /opt/apollo/neo/src/modules/perception/multi_sensor_fusion/fusion/data_fusion/tracker/pbf_tracker/pbf_tracker.cc（1–110 行精读）
- /opt/apollo/neo/src/modules/perception/common/onboard/inner_component_messages/inner_component_messages.h（全文 73 行）
- /apollo/modules/perception/data/conf/sensor_meta.pb.txt（全文 24 行）
- /apollo_workspace/.manual_work/inventory/perception_inventory.md（盘点主素材）
- manual/16_感知源码/01_总览与四大链路.md、02_组件插件架构与子包骨架.md（体例与已核事实）
-->

## 0. 一句话作用

`multi_sensor_fusion` 是四条感知流水线（lidar / camera / radar / traffic_light）中 **lidar+camera+radar 三路的汇聚点**：
三个 tracker/detection 各自把 `SensorFrameMessage` 发到 `/perception/inner/PrefusedObjects`，融合组件按
**主传感器节拍**把多路障碍物融合成一条 track 序列，最终序列化发 **`/apollo/perception/obstacles`**——
这是 PnC 唯一订阅的障碍物通道（prediction 消费）。TL 链不经过它（单独走 `/apollo/perception/traffic_light`，见 01 篇）。

## 1. 关键符号与文件

| 符号/类/概念 | 文件（`/opt/apollo/neo/src` = ② 源码层；`/apollo_workspace/profiles/ARCF_40P` = profile 覆盖层） | 行号(已核) | 说明 |
|---|---|---|---|
| `MultiSensorFusionComponent` | .../multi_sensor_fusion/multi_sensor_fusion_component.h | 36 | `public cyber::Component<onboard::SensorFrameMessage>`，单消息触发 |
| `Init()` / `Proc()` / `InternalProc()` | 同 .cc | 32 / 56 / 107 | 覆写基类；`InitAlgorithmPlugin` 私有（86） |
| 成员：fuser + 两个 writer | 同 .h | 56–59 | `unique_ptr<BaseFusionSystem> fusion_`、`Writer<PerceptionObstacles>`、`Writer<SensorFrameMessage>`（viz） |
| `CYBER_REGISTER_COMPONENT` | 同 .h | 62 | 写**非限定类名** `MultiSensorFusionComponent`（与 dag `class_name` 一致） |
| dag 声明 | .../multi_sensor_fusion/dag/multi_sensor_fusion.dag | 2/4/10 | `module_library "modules/perception/multi_sensor_fusion/libmulti_sensor_fusion.so"`、`class_name "MultiSensorFusionComponent"`、readers `channel: "/perception/inner/PrefusedObjects"` |
| `SensorFrameMessage`（输入消息） | .../perception/common/onboard/inner_component_messages/inner_component_messages.h | 49–69 | 字段：`sensor_id_` / `timestamp_` / `lidar_timestamp_` / `seq_num_` / `error_code_` / `frame_` / `process_stage_` / `hdmap_` |
| `BaseFusionSystem`（fuser 基类） | .../multi_sensor_fusion/interface/base_fusion_system.h | 35 | 纯虚 `Init`(47)/`Fuse`(57)/`Name`(65)；`FusionInitOptions` 继承 `BaseInitOptions`(33) |
| `PERCEPTION_REGISTER_REGISTERER(BaseFusionSystem)` | 同上 | 71 | **Registerer 通道**；宏 `FUSION_REGISTER_FUSIONSYSTEM(name)`（72–73） |
| `BaseDataAssociation` / `BaseGatekeeper` | interface/base_data_association.h / base_gatekeeper.h | 47 / 33 | 数据关联与「能否发布」门控，各带 Registerer（85–87 / 66–68） |
| `ProbabilisticFusion`（生效 fuser） | fusion/fusion_system/probabilistic_fusion/probabilistic_fusion.cc | 41 / 102 / 443 | `Init`/`Fuse`；末尾 `FUSION_REGISTER_FUSIONSYSTEM(ProbabilisticFusion)` |
| `PbfTracker`（track 级融合器） | fusion/data_fusion/tracker/pbf_tracker/pbf_tracker.cc | 41 / 75 | `InitParams` 读 conf；`InitMethods` **硬编码 `new`** 四个子融合（76–102） |
| `SensorManager::IsMainSensor` | common/algorithm/sensor_manager/sensor_manager.cc | 224–230 | 按 `sensor_meta.pb.txt` 的 `is_main_sensor` 字段判定 |
| 主传感器定义 | /apollo/modules/perception/data/conf/sensor_meta.pb.txt | 1–6 | 本车主传感器 = **`lidar16_back`**（`is_main_sensor: true`） |

## 2. 机制与数据流

### 2.1 channel 总表

| channel | 消息类型 | 方向 | 代码位置(已核) |
|---|---|---|---|
| `/perception/inner/PrefusedObjects` | `onboard::SensorFrameMessage` | **in**（dag 唯一 reader） | multi_sensor_fusion.dag:10 |
| `/apollo/perception/obstacles` | `apollo::perception::PerceptionObstacles` | **out**（对外） | conf:8 `output_obstacles_channel_name` |
| `/perception/inner/visualization/FusedObjects` | `onboard::SensorFrameMessage` | out（可视化，`FLAGS_obs_enable_visualization` 才发） | conf:9；component.cc:75–77 |

### 2.2 三路障碍物如何进入融合（PrefusedObjects 的三个发布者）

融合不直接订阅各传感器，只吃一个汇聚通道 `/perception/inner/PrefusedObjects`，它的发布者是三个独立组件
（conf 原文 `output_channel_name`，本轮 `grep -RHn` 实测）：

| 发布组件 | conf 文件 | 消息里的 `sensor_id_` 语义 |
|---|---|---|
| `lidar_tracking` | lidar_tracking/conf/lidar_tracking_config.pb.txt:1 | lidar 主传感器名 |
| `camera_tracking`（front/rear） | camera_tracking/conf/camera_tracking_{front,rear}_config.pb.txt:1 | 相机名 |
| `radar_detection`（front/rear） | radar_detection/conf/{front,rear}_radar_detection_config.pb.txt:15 | 雷达名 |

每个 `SensorFrameMessage` 携带一帧某个传感器的检测结果（`frame_->objects`）与 `sensor_id_`；融合据此区分
「这一帧是谁的障碍物」。**TL 链不发 PrefusedObjects**（它走 `/perception/inner/Tracking` → `/apollo/perception/traffic_light`）。

### 2.3 组件主干（Init / Proc / MainSensor / publish）

**Init（component.cc:32–54）**：`GetProtoConfig` 读 dag 的 `config_file_path` → `FusionComponentConfig`
（proto2，字段见 proto/fusion_component_config.proto：`fusion_param` / `object_in_roi_check` /
`radius_for_roi_object_check` / `output_obstacles_channel_name`(默认 `/perception/vehicle/obstacles`) /
`output_viz_fused_content_channel_name`）。随后：读 roi 两字段（40–41）→ `InitAlgorithmPlugin`（44）→
`CreateWriter<PerceptionObstacles>` + `CreateWriter<SensorFrameMessage>`（47–50）→ `SensorManager::Instance()->Init()`（52）。

**InitAlgorithmPlugin（component.cc:86–105）**：取 conf 的 `fusion_param`，用 **Registerer 通道**
`BaseFusionSystemRegisterer::GetInstanceByName(fusion_param.name())`（92–93，`CHECK_NOTNULL`）拿到 fuser，
再 `fusion_->Init(init_options)`（96）；若 `FLAGS_obs_enable_hdmap_input && object_in_roi_check_` 才 init hdmap（98–101）。

**Proc（component.cc:56–84）**：`PERF_FUNCTION` 计时 → 若 `process_stage_ == SENSOR_FUSION` 直接 return true
（59，防重复融合）→ `InternalProc` → 若 `status && IsMainSensor(message->sensor_id_)` 才 `writer_->Write(out_message)`
（69–73），并按 `FLAGS_obs_enable_visualization` 发 viz（75–77）；**非主传感器帧直接跳过发布**（78–81）。

**InternalProc（component.cc:107–205）**：互斥自增 `seq_num_` → 若 `error_code_ != OK` 用
`MsgSerializer::SerializeMsg` 透传错误码与空对象、return true（120–133，错误帧不阻塞）→
`fusion_->Fuse(frame, &fused_objects)`（137–141）→ **再次 `IsMainSensor` 判断，非主传感器 return true 不产出**
（144–148）→ ROI 过滤段（150–172，见 §5.5）→ 组装 viz 消息（176–187）→ `MsgSerializer::SerializeMsg` 序列化成
`PerceptionObstacles`（189–195）。

### 2.4 MainSensor 策略（谁触发融合、谁触发发布）

- 判定：`SensorManager::IsMainSensor(name)` 查 `sensor_meta.pb.txt` 里该传感器的 `is_main_sensor` 字段
  （sensor_manager.cc:224–230）。本车 `sensor_meta.pb.txt:1–6` 定义 **`lidar16_back`（VELODYNE_16）为唯一主传感器**。
- 双重门控：① 组件 `Proc` 只对主传感器帧 `Write`；② fuser 内部 `IsPublishSensor`（probabilistic_fusion.cc:152–158）
  同样只对主传感器帧执行「融合 + 收集」，非主传感器帧只 `AddSensorMeasurements` 进 `SensorDataManager` 缓存
  （probabilistic_fusion.cc:123–132）就 return。
- 语义：**lidar 是节拍源**——camera/radar 的障碍物只作为「测量」存进缓存，等 lidar 主帧到来时统一做
  多传感器关联并发布一版融合结果。这也是为什么 lidar 断流 = `/apollo/perception/obstacles` 停更（即使 camera/radar 还在）。

### 2.5 ProbabilisticFusion 内部主流程（probabilistic_fusion.cc:102–150）

`Fuse`：按 `use_lidar/use_radar/use_camera` 三开关过滤传感器（113–121）→ 非主传感器只存帧返回（130–132）→
`GetLatestFrames` 取关联帧（137–140）→ 逐帧 `FuseFrame`（143–145）→ `CollectFusedObjects` 收集最终 track（148）。
`FuseFrame`（160–170）：前台 `FuseForegroundTrack`（关联→更新已匹配 track→更新未匹配 track→新建 track）+
后台 `FusebackgroundTrack` + `RemoveLostTrack`。**门控**：`CollectFusedObjects` 里只有
`gate_keeper_->AbleToPublish(track_ptr)` 通过的 track 才进最终输出（344–372）。

## 3. 注册与配置

### 3.1 融合算法选择（conf `plugin_param` 三段式）

运行时 conf（**profile 层**，`/apollo_workspace/profiles/ARCF_40P/.../multi_sensor_fusion_config.pb.txt` 全文 9 行）：

```protobuf
fusion_param {                                    # :1–5 —— 选哪个 fuser
  name: "ProbabilisticFusion"                     # 经 BaseFusionSystemRegisterer 取实例
  config_path: "perception/multi_sensor_fusion/data"
  config_file: "probabilistic_fusion.pb.txt"
}
object_in_roi_check: true                         # :6
radius_for_roi_object_check: 120                  # :7
output_obstacles_channel_name: "/apollo/perception/obstacles"        # :8
output_viz_fused_content_channel_name: "/perception/inner/visualization/FusedObjects"  # :9
```

fuser 实例级 conf `data/probabilistic_fusion.pb.txt`（全文 23 行）再选**子算法**：

| 字段 | 值 | 行号 | 取实例方式 |
|---|---|---|---|
| use_lidar / use_radar / use_camera | true / true / true | 1–3 | — |
| tracker_param.name | `PbfTracker`（config `pbf_tracker.pb.txt`） | 4–8 | **硬编码**（见 3.3） |
| data_association_param.name | `HMTrackersObjectsAssociation` | 9–11 | Registerer `BaseDataAssociation` |
| gatekeeper_param.name | `PbfGatekeeper`（config `pbf_gatekeeper.pb.txt`） | 12–16 | Registerer `BaseGatekeeper` |
| prohibition_sensors | `radar_front` | 17 | radar_front 不新建 track（仅更新已有） |
| max_{lidar,radar,camera}_invisible_period | 0.25 / 0.50 / 0.75（秒） | 19–21 | track 超时淘汰阈值 |
| max_cached_frame_num | 50 | 23 | `Sensor` 缓存帧数上限 |

### 3.2 fuser 取实例 = Registerer 通道（非 PluginManager）

fusion 分支**没有任何插件注册**（`cyber_plugin_index` 0 条，见 02 篇 §3.5），全部走
`PERCEPTION_REGISTER_REGISTERER` 的 Registerer 通道——实现与组件编进同一个 `.so`
（`libmulti_sensor_fusion.so`，2.1 MB，已在 lib 树）。**只有 3 个融合基类带了 Registerer**：

| 基类 | 宏定义（已核） | 已注册实现 |
|---|---|---|
| `BaseFusionSystem` | base_fusion_system.h:71–73 `FUSION_REGISTER_FUSIONSYSTEM` | `ProbabilisticFusion`（probabilistic_fusion.cc:443）、`DummyFusionSystem`（fusion/dummy/dummy_algorithms.cc:76） |
| `BaseDataAssociation` | base_data_association.h:85–87 `PERCEPTION_REGISTER_ASSOCIATION` | `HMTrackersObjectsAssociation`（hm_tracks_objects_match.cc:431） |
| `BaseGatekeeper` | base_gatekeeper.h:66–68 `PERCEPTION_REGISTER_GATEKEEPER` | `PbfGatekeeper`（pbf_gatekeeper.cc:207） |

### 3.3 另 5 个基类是「裸接口」——PbfTracker 内硬编码 new（⚠️ 与 02 篇口径不符）

`interface/` 一共 8 个 `Base*.h`，但**只有上面 3 个带 Registerer**。另外 5 个——
`BaseTracker` / `BaseExistenceFusion` / `BaseMotionFusion` / `BaseShapeFusion` / `BaseTypeFusion`——
**既无 Registerer 也无 PluginManager 宏**（本轮 grep 无命中），其实现由 `PbfTracker` 直接 `new`，
且类名写死为静态字符串（pbf_tracker.cc:34–39）再在 `InitMethods` 里逐一判断（76–102）：

```cpp
s_type_fusion_method_        = "DstTypeFusion";        // pbf_tracker.cc:34
s_existence_fusion_method_   = "DstExistenceFusion";   // :35–36
s_motion_fusion_method_      = "KalmanMotionFusion";   // :37–38
s_shape_fusion_method_       = "PbfShapeFusion";       // :39
// InitMethods 里: if (s_type_fusion_method_=="DstTypeFusion") type_fusion_.reset(new DstTypeFusion(track_));  // :76–77
```

> 这修正了 02 篇 §3.5「`multi_sensor_fusion/interface/` 8 个基类均带 `PERCEPTION_REGISTER_REGISTERER`」——
> 实测只有 3 个带；另 5 个是纯虚接口，换实现必须改 `pbf_tracker.cc` 源码重编，**不是改 conf 就能换**。

### 3.4 dag / conf 落点（`readlink -f` 实测，本轮）

- conf `/apollo/modules/perception/multi_sensor_fusion/conf/multi_sensor_fusion_config.pb.txt`
  → **profile 覆盖层** `/apollo_workspace/profiles/ARCF_40P/...`（改软链立即生效）。
- dag `/apollo/modules/perception/multi_sensor_fusion/dag/multi_sensor_fusion.dag`
  → **出厂层** `/opt/apollo/neo/share/...`。
- `config_file_path` 写死 `/apollo/modules/perception/multi_sensor_fusion/conf/...`（dag:7）；`flag_file_path`
  = 全感知共用 `/apollo/modules/perception/data/flag/perception_common.flag`（dag:8）。

## 4. 修改与扩展点（4 个）

**① 换/新增融合算法（fusion_system 层，Registerer 通道）**
在 `fusion/fusion_system/<新名>/` 新建 `base_fusion_system.h` 的子类，实现 `Init`/`Fuse`/`Name`，文件末尾
`FUSION_REGISTER_FUSIONSYSTEM(新类)`，挂进包 BUILD 的 `srcs`；再把 conf 的 `fusion_param.name` 改成新名。
现有即插可用替代 = `DummyFusionSystem`（不改代码，只改 conf `name`）。命令：
`buildtool build -p modules/perception/multi_sensor_fusion`（必须 install 才生效）。

**② 换/新增数据关联或门控（data_association / gatekeeper 层）**
继承 `BaseDataAssociation`（实现 `Associate`）或 `BaseGatekeeper`（实现 `AbleToPublish`），末尾
`PERCEPTION_REGISTER_ASSOCIATION(新类)` 或 `PERCEPTION_REGISTER_GATEKEEPER(新类)`；在
`data/probabilistic_fusion.pb.txt` 改对应 `*_param.name`。注册宏在同一 .so 内（静态注册），无需 plugins.xml。

**③ 换子融合（existence/type/motion/shape 层）——要改源码，非 conf**
这四个目前**硬编码**在 `pbf_tracker.cc`：先看 `data/pbf_tracker.pb.txt` 的 `type_fusion_param.name` 等字段名，
但新实现必须改 `InitMethods` 的 `new` 分支（pbf_tracker.cc:75–105）并加 include。这是 fusion 分支里唯一
「换算法必须重编」的点（其余走 Registerer 或 conf）。

**④ 只调参 / 改输出 / 关传感器（不写代码）**
- 换 fuser：改 `/apollo/modules/perception/multi_sensor_fusion/conf/*.pb.txt` 的 `fusion_param.name`
  （软链写穿 profile，立即生效）。
- 关某传感器：`data/probabilistic_fusion.pb.txt` 的 `use_radar/use_camera` 置 false。
- 改 track 淘汰：`max_*_invisible_period`；改缓存帧数 `max_cached_frame_num`。
- 改对外输出 channel：conf 的 `output_obstacles_channel_name`。
- 单模块调试（**启动命令，非只读**）：`mainboard -d /apollo/modules/perception/multi_sensor_fusion/dag/multi_sensor_fusion.dag`。

## 5. ⚠️ 本环境注意

1. **fusion conf 落点在 profile 层、dag 在 share 层**（`readlink -f` 实测，见 §3.4）：改 conf 走软链立即生效，
   改 `/apollo_workspace/modules/perception/multi_sensor_fusion/conf/`（① 层源码副本）不重编**不生效**。
   与 01 篇 §5.5 结论一致（同一模块两落点混存是常态）。
2. **fuser 取实例是 Registerer 通道，不是 PluginManager**（component.cc:92–93 → base_fusion_system.h:71）：
   fusion 分支在 `/opt/apollo/neo/share/cyber_plugin_index/` 里**零条目**（perception 的 14 条全属 lidar 家族），
   排查「融合没起」别去找 plugins.xml。两条通道的区别见 02 篇 §3.1。
3. **修正 02 篇 §3.5**：fusion `interface/` 8 个基类里只有 3 个带 Registerer（`BaseFusionSystem` /
   `BaseDataAssociation` / `BaseGatekeeper`）；`BaseTracker` / `Base{Existence,Motion,Shape,Type}Fusion` 是裸接口，
   实现由 `PbfTracker` 硬编码 `new`（§3.3）——换它们必须改源码重编。
4. **主传感器本车是 `lidar16_back`，不是 velodyne64**（sensor_meta.pb.txt:1–6）：融合只在 `lidar16_back` 帧到来时
   Fuse+发布。换车/换 profile 必须重核 `/apollo/modules/perception/data/conf/sensor_meta.pb.txt` 的 `is_main_sensor`。
5. **ROI 过滤段是空转**：conf 里 `object_in_roi_check: true`、`radius_for_roi_object_check: 120`，但
   `component.cc:163–164` 的 `ObjectInRoiSlackCheck` 被 `// TODO(use check)` 注释，实际 `valid_objects` 直接
   `assign(fused_objects)`（165/167/170）——**改了 radius 也不改变输出**。
6. **`prohibition_sensors: "radar_front"`**（probabilistic_fusion.pb.txt:17）：radar_front 的未匹配障碍物
   **不新建 track**（probabilistic_fusion.cc:226–239 直接 return），只参与更新已有 track，别误判「雷达障碍物被吞」。
7. 搜 `/apollo/...` 层用 `grep -R`（`-r` 不跟随符号链接会假空）。

## 6. 验证命令（只读，本轮实测过）

```bash
# conf/dag 落点（profile 还是 share）
readlink -f /apollo/modules/perception/multi_sensor_fusion/conf/multi_sensor_fusion_config.pb.txt
readlink -f /apollo/modules/perception/multi_sensor_fusion/dag/multi_sensor_fusion.dag

# 选中哪个 fuser + 输出 channel + 子算法
grep -nE 'name|config_path|config_file|output' /apollo/modules/perception/multi_sensor_fusion/conf/multi_sensor_fusion_config.pb.txt
cat /apollo/modules/perception/multi_sensor_fusion/data/probabilistic_fusion.pb.txt

# 主传感器是谁（决定节拍源）
cat /apollo/modules/perception/data/conf/sensor_meta.pb.txt | grep -B2 -A1 'is_main_sensor: true'

# PrefusedObjects 的三个发布者
grep -RHn 'PrefusedObjects' /apollo/modules/perception/*/conf/ | grep output

# 融合 .so 是否在 lib 树（dag 指向 libmulti_sensor_fusion.so）
ls -la /opt/apollo/neo/lib/modules/perception/multi_sensor_fusion/*.so

# fusion 分支插件索引条数（应为 0）
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep -c fusion || true
```

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）；基线 Apollo 11.0.0 package 工作区，profile = `ARCF_40P`。**全程只读，未启动模块**。
- **read 工具打开核对过**：front-matter `sources` 12 项（dag、profile conf、component.h/.cc、三个 interface 头、
  probabilistic_fusion.pb.txt/.cc、pbf_tracker.cc 1–110、inner_component_messages.h、sensor_meta.pb.txt），
  以及 `_template.md`、`perception_inventory.md`、`16_感知源码/01、02、10`（体例与已核事实基准）。
- **bash 实测（`ls -R`/`grep -RHn`/`readlink -f`/`cat`，内容已核但未走 read 工具，故正文不引行号）**：
  多传感器融合 src 树目录结构；fusion/ 与 interface/ 全量清单；8 个 interface 头文件的 Registerer 命中情况（3/8）；
  `FUSION_REGISTER_*` / `PERCEPTION_REGISTER_*` 注册宏与 `DummyFusionSystem`/`HMTrackersObjectsAssociation`/
  `PbfGatekeeper` 注册点；`SensorManager::IsMainSensor` 实现（sensor_manager.cc:224–230）；lib 树 3 个 .so；
  proto/ 6 个 .proto；PrefusedObjects 三个发布者 conf；`FLAGS_obs_sensor_meta_file` 无 DEFINE_string 命中（待核）。
- **与 02 篇差异（本文件为准）**：02 §3.5「fusion interface 8 个基类均带 `PERCEPTION_REGISTER_REGISTERER`」实测为 **3 个**，
  其余 5 个是裸接口、由 `PbfTracker` 硬编码 `new`（§3.3）。
- **遗留待核**：① `FLAGS_obs_sensor_meta_file` 的默认值定义位置（本轮在 common_flags.cc 未 grep 到，仅确认运行时
  `sensor_meta.pb.txt` 实际生效）；② `object_in_roi_check` 的 ROI 过滤何时真正启用（目前 TODO 注释空转）；
  ③ fusion 输出频率与各链实测频率（本轮全程未运行）；④ `pbf_tracker.pb.txt` 全文未 read（仅从 pbf_tracker.cc
  反推其字段结构）。
