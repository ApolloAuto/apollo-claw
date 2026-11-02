# DreamView / HMI 参考

路径均相对 apollo 源码根目录。行号均为核对过的真实 file:line。

## 1. WebSocket / HTTP 路由全表（dreamview_plus）

注册点集中在 `modules/dreamview_plus/backend/dreamview.cc:121-132`，WebSocketHandler 对象在 `:92-101` new 出。

| URI | handler 名 | 声明 / 挂载 | 消息处理者 |
|---|---|---|---|
| `/websocket` | `"websocket"` | `dreamview.h:75` / `.cc:92,121` | `SimulationWorldUpdater`（多数 JSON API）、`HMI`（HMIAction / record / KVDB）、`SocketManager`（subscribe / unsubscribe） |
| `/map` | `"Map"` | `.h:76` / `.cc:93,122` | `RetrieveMapData` / `RetrieveRelativeMapData`（`simulation_world_updater.cc:432,451`）+ `MapUpdater` 推流 |
| `/pointcloud` | `"PointCloud"` | `.h:77` / `.cc:94,123` | `PointCloudUpdater` 单向推流 |
| `/camera` | `"Camera"` | `.h:78` / `.cc:95,124` | `PerceptionCameraUpdater` 单向推流 |
| `/plugin` | `"Plugin"` | `.h:79` / `.cc:96,125` | `PluginRequest`（`simulation_world_updater.cc:940`） |
| `/simworld` | `"SimWorld"` | `.h:80` / `.cc:98,126` | `SimulationWorldUpdater::PublishMessage` |
| `/hmi` | `"HMI"` | `.h:82` / `.cc:97,127` | `HMI::PublishMessage`（hmistatus 二进制） |
| `/socketmanager` | — | `.h:83` / `.cc:128` | **残留路由：`socket_manager_ws_` 全仓无 `reset`，此处解空指针；SocketManager 实际挂在 `websocket_` 上** |
| `/obstacle` | `"Obstacle"` | `.h:81` / `.cc:99,129` | `ObstacleUpdater` |
| `/channelsinfo` | `"ChannelsInfo"` | `.h:84` / `.cc:101,130` | `ChannelsUpdater`，任意 cyber channel 原始消息透传 |
| `/image` (HTTP) | `ImageHandler` | `.cc:103,131` | MJPEG 流，`modules/dreamview/backend/common/handlers/image_handler.cc` |
| `/proto` (HTTP) | `ProtoHandler` | `.cc:104,132` | 把 .proto 文件本体发前端做动态解码 |
| `/teleop` | `"Teleop"` | `.h:100` / 仅 `WITH_TELEOP==1` new（`.cc:136-139`） | **dv_plus 漏了 `addWebSocketHandler`，dv 有（`modules/dreamview/backend/dreamview.cc:119`）** |

旧版 dreamview 仅 5 个 ws（`/websocket` `/map` `/pointcloud` `/camera` `/plugin`）+ `/image`（+ teleop），`modules/dreamview/backend/dreamview.cc:110-120`。

## 2. `/websocket` 上的 JSON handler 全表

`SimulationWorldUpdater::RegisterRoutingMessageHandlers()`（`modules/dreamview_plus/backend/simulation_world/simulation_world_updater.cc:76`）：`SendRoutingRequest`(`:78`)、`SendDefaultCycleRoutingRequest`(`:148`)、`GetDefaultRoutings`(`:278`)、`GetParkAndGoRoutings`(`:332`)、`SaveDefaultRouting`(`:362`)、`DeleteDefaultRouting`(`:398`)。

`SimulationWorldUpdater::RegisterMessageHandlers()`（`:431`）：`RetrieveMapData`(`:433`, on `/map`)、`RetrieveRelativeMapData`(`:452`, on `/map`)、`Binary`(`:463`)、`RetrieveMapElementIdsByRadius`(`:476`)、`CheckRoutingPoint`(`:504`)、`SetStartPoint`(`:530`)、`GetMapElementIds`(`:604`)、`GetMapElementsByIds`(`:668`)、`GetStartPoint`(`:710`)、`RequestRoutePath`(`:744`)、`Reset`(`:818`)、`Dump`(`:839`)、`GetParkingRoutingDistance`(`:859`)、`CheckCycleRouting`(`:916`)、`PluginRequest`(`:941`, on `/plugin`)。

`HMI::RegisterMessageHandlers()`（`modules/dreamview_plus/backend/hmi/hmi.cc:224`）：`HMIAction`(`:233`)、`SubmitAudioEvent`(`:290`)、`SubmitDriveEvent`(`:318`)、`StartPlayRecorder`(`:339`)、`ResetRecordProgress`(`:367`)、`PlayRecorderAction`(`:417`)、`StartDataRecorder`(`:461`)、`StopDataRecorder`(`:494`)、`StartPlayRtkRecorder`(`:527`)、`StopPlayRtkRecorder`(`:554`)、`SaveDataRecorder`(`:586`)、`DeleteDataRecorder`(`:635`)、`GetInitData`(`:667`)、`StartTerminal`(`:691`)。

`HMI::RegisterDBMessageHandlers()`（`hmi.cc:81`）：`AddOrModifyObjectToDB`(`:83`)、`GetObjectFromDB`(`:125`)、`DeleteObjectToDB`(`:154`)、`GetTuplesWithTypeFromDB`(`:187`)。

`SocketManager::RegisterMessageHandlers()`（`socket_manager.cc:89`）：连接就绪广播 metadata(`:90-91`)、`subscribe`(`:93`)、`unsubscribe`(`:103`)。

## 3. 消息格式

**请求**（`WebSocketHandler::handleJsonData`，`modules/dreamview/backend/common/handlers/websocket_handler.cc:228-251`；缺 `type` 或 type 未注册都只打 error 并丢弃）：

```json
{ "type": "<handler 名, 必填>", "action": "request",
  "data": { "requestId": "<需要回包的接口必填>",
            "info": { /* 业务参数 */ } } }
```

**响应**（各 handler 手工拼，形态统一，见 `hmi.cc:239-249`、`socket_manager.cc:96-100`）：

```json
{ "action": "response",
  "data": { "requestId": "<回填>",
            "info": { "code": 0, "message": "Success", "data": { } } } }
```

后端一律用 `apollo::common::util::JsonUtil::GetStringByPath / GetNumberByPath / GetJsonByPath` 取字段，缺 requestId 早退回 `code=-1, message="Miss requestId"`。

**订阅**（`SocketManager::Subscribe`，`socket_manager.cc:146-161`；`UnSubscribe` `:163-172`）：

```json
{ "type": "subscribe",
  "data": { "info": { "websocketName": "simworld", "dataFrequencyMs": 100,
                      "channelName": "<多 channel updater 必填>",
                      "param": { } } } }
```

`websocketName` 直接当作 `updater_manager_->Start(url, ...)` 的 key（`:147`）。

**流式二进制**：统一封 `apollo.dreamview.StreamData`（`modules/dreamview_plus/proto/data_handler.proto:35-41`）：`type` / `action`（固定 `"stream"`）/ `data_name` / `channel_name` / `data`（业务 proto 序列化）。旧 dreamview 无此封装，直接发 sim_world 序列化串。

**元数据广播**：`BrocastDataHandlerConf`（`socket_manager.cc:274`）发 `{"action":"metadata","data":{"info":{...DataHandlerConf...}}}`；channel 增删时发 `action: "join" | "leave"`。`GetDataHandlerInfo`（`:197-272`）为每个 data type 填 `proto_path`（`ProtobufFactory::GetProtoPath`），前端据此去 `/proto` 拉 .proto。

## 4. Updater 全清单与 data_handler.conf 对应

`Dreamview::RegisterUpdaters()`（`modules/dreamview_plus/backend/dreamview.cc:266-275`）7 条：

| data_name | Updater 类 | 源文件 | data_handler.conf key | ws pipe |
|---|---|---|---|---|
| `simworld` | `SimulationWorldUpdater` | `backend/simulation_world/simulation_world_updater.cc` | `apollo.dreamview.SimulationWorld`（`conf/data_handler.conf:2`） | `/simworld` |
| `hmistatus` | `HMI`（本身是 `UpdaterBase` 子类，`hmi/hmi.h:35`） | `backend/hmi/hmi.cc` | `apollo.dreamview.HMIStatus`（`:37`） | `/hmistatus` |
| `camera` | `PerceptionCameraUpdater` | `backend/perception_camera_updater/` | `apollo.dreamview.CameraUpdate`（`:13`，`different_for_channels:true`） | `/camera` |
| `pointcloud` | `PointCloudUpdater` | `backend/point_cloud/` | `apollo.dreamview.PointCloud`（`:25`，`different_for_channels:true`） | `/pointcloud` |
| `map` | `MapUpdater` | `backend/map/map_updater.cc` | `apollo.hdmap.Map`（`:48`） | `/map` |
| `obstacle` | `ObstacleUpdater` | `backend/obstacle_updater/` | `apollo.dreamview.Obstacles`（`:59`） | `/obstacle` |
| `channelsinfo` | `ChannelsUpdater` | `backend/channels_updater/` | `apollo.dreamview.Cyber`（`:71`，注意 `data_name: "cyber"` 而 `websocket_name: "channelsinfo"`） | `/channelsinfo` |

**`channelsinfo` 是唯一 `data_name != websocket_name` 的条目**（`data_name: "cyber"`）；`updater_manager_->Start()` 用的是 `websocketName`，所以注册 key 必须与 `websocket_name` 对齐。

多 channel 过滤规则 `filter_info`（`socket_manager.cc:34-37`）：`apollo.dreamview.Obstacles` → `perception.PerceptionObstacles`；`apollo.dreamview.CameraUpdate` → `drivers.Image`；`apollo.dreamview.PointCloud` → `PointCloud` 且 channel 名含 `sensor`。

基类：`UpdaterBase`（`backend/updater/updater_base.h:38-63`）、`UpdaterWithChannelsBase`（`backend/updater/updater_with_channels_base.h`，`GetChannelMsgWithFilter` 会剔除非当前 record 的 `record_player_factory_*` 节点）、`UpdaterManager`（`backend/updater/updater_manager.h:50-68`）。

前端枚举 `StreamDataNames`（`modules/dreamview_plus/frontend/packages/dreamview-core/src/services/api/types.ts:75-85`）：`simworld / camera / hmistatus / simhmistatus / pointcloud / map / obstacle / cyber`。

## 5. hmi_modes 全清单

**dreamview_plus** `modules/dreamview_plus/conf/hmi_modes/`（4 个，加 `README.md`）：

| 文件 | 行数 | modules（手写命令） | cyber_modules（dag） | monitored_components | operations |
|---|---|---|---|---|---|
| `default.pb.txt` | 98 | Perception、IndoorLocalization、TrafficLight、Lane | Prediction、Planning(+external_command)、Control、TaskManager、Localization、Guardian、Canbus、GPS、Transform | 无 | `Record`、`Sim_Control`；default=`Record`（`:96-98`） |
| `pnc.pb.txt` | 21 | 无 | Planning(2 dag)、Prediction、Control | 无 | `Record`、`Sim_Control`；default=`Record`（`:20-22`） |
| `perception.pb.txt` | 103 | Perception、TrafficLight、Lane、CameraMultiStage、CameraSingleStage、CameraDriver、LidarPerception、LidarDriver、Radar | Prediction、Transform | 无 | 仅 `Record`；default=`Record`（`:103-104`） |
| `vehicle_test.pb.txt` | 235 | 同上 9 个 | Planning(2 dag)、Prediction、Control、TaskManager、Canbus、GPS、Transform、Localization、Guardian、ExternalCmd | Canbus、GNSS、RTK、LidarPerception、GPS、Localization、CameraPerception、CameraDriver、LidarDriver（`:152-231`） | `Record`、`Waypoint_Follow`、`Auto_Drive`；default=`Auto_Drive`（`:232-235`） |

**dreamview（旧版）** `modules/dreamview/conf/hmi_modes/`（20 个）：`camera-Lidar_sensor_calibration`、`car_teleop`、`console_teleop`、`dev_kit_close_loop`、`dev_kit_debug`、`ipc1_mkz_close_loop`、`ipc1_mkz_standard_debug`、`ipc2_mkz_close_loop`、`ipc2_mkz_standard_debug`、`lidar-IMU_sensor_calibration`、`map_collection`、`mkz_64beam`、`mkz_close_loop`、`mkz_lgsvl`、`mkz_standard_debug`、`mkz_standard_debug_hesai`、`mkz_standard_debug_smart_recorder`、`navigation`、`rtk`、`vehicle_calibration`（均 `.pb.txt`）。

**前端 `CURRENT_MODE` 枚举**（`frontend/packages/dreamview-core/src/store/HmiStore/actionTypes.ts:115-127`）有 11 项：`none / Default / Perception / Pnc / Vehicle Test / Map Collect / Map Editor / Camera Calibration / Lidar Calibration / Dynamics Calibration / Canbus Debug` —— **比后端 4 个 mode 多，多出的项没有对应后端 mode 文件**。默认布局在 `store/PanelLayoutStore/reducer.ts:47-141`。

## 6. hmi_mode 配置字段语义

`modules/common_msgs/dreamview_msgs/hmi_mode.proto:121-130`：

```protobuf
message HMIMode {
  map<string, CyberModule>          cyber_modules = 1;         // 只给 dag，LoadMode 时自动转成 modules
  map<string, Module>               modules = 2;               // 手写 start/stop，HMI 上有开关
  map<string, MonitoredComponent>   monitored_components = 3;  // 只有状态灯
  map<string, ProcessMonitorConfig> other_components = 4;      // 只读，仅进程关键字
  repeated HMIModeOperation         operations = 5;
  optional HMIModeOperation         default_operation = 6;
  optional string                   layout = 7;                // 后端不读，前端布局硬编码
  map<string, MonitoredComponent>   global_components = 8;     // LoadMode 从全局文件注入
}
```

| 消息 | 字段 | 含义 | 定义 |
|---|---|---|---|
| `Module` | `start_command` / `stop_command` | 直接 `std::system()` | `hmi_mode.proto:104-106` |
| | `process_monitor_config.command_keywords` | monitor 逐条子串匹配 `/proc/*/cmdline`（AND） | `:11-13` |
| | `required_for_safety`（默认 true） | 挂了是否触发 safe-mode | `:111` |
| `CyberModule` | `dag_files`（≥1，空则 ACHECK 崩） | 合成 `mainboard -d <dag>` | `:116` |
| | `process_group` | 合成 `mainboard -p <group>` | `:118` |
| `MonitoredComponent` | `process` | 进程存活 → `components[i].process_status` | `:82` |
| | `channel`（`name` / `delay_fatal` 默认 3.0s / `mandatory_fields` / `min|max_frequency_allowed`） | channel 延迟与频率 | `:21-32` |
| | `resource`（`disk_spaces` / `cpu_usages` / `memory_usages` / `disk_load_usages`） | 资源检查 | `:35-71` |
| | `module`（`node_name`） | cyber node 存活 | `:16-18` |

`monitored_components` 的 value 写成空 `{}` 表示由专门的 Monitor 类处理（如 `Localization` / `CameraPerception`，`vehicle_test.pb.txt:204-215`）。新增被监控 channel 需同步扩 `modules/monitor/software/channel_monitor.cc`（`conf/hmi_modes/README.md:17-21`）。

`HMIModeOperation` 枚举（`modules/common_msgs/dreamview_msgs/hmi_status.proto:39-56`）：`None / SIM_DEBUG / Sim_Control / Auto_Drive / TRACE / Scenario_Sim / Record / Waypoint_Follow`。

`HMIAction` 枚举 29 项（`modules/common_msgs/dreamview_msgs/hmi_config.proto:5-38`），无参 5 个（`NONE / SETUP_MODE / RESET_MODE / ENTER_AUTO_MODE / DISENGAGE`）+ 带 value 的其余。

`global_components_config.pb.txt`（`modules/dreamview/conf/`）4 个全局组件：`DataRecorder`(`:2`)、`Terminal`(`:25`)、`RTKRecorder`(`:34`)、`RTKPlayer`(`:43`)，由 `HMIUtil::LoadMode`（`hmi_util.cc:107-113`）合并进每个 mode。

## 7. 关键 gflags（全部定义在 `modules/dreamview/backend/common/dreamview_gflags.cc`）

| flag | 默认值 | 行 |
|---|---|---|
| `static_file_dir` | `/apollo/modules/dreamview_plus/frontend/dist` | `:28` |
| `server_ports` | `8899`（**不是 8888**；`:36-37` 注释：dv 用 8899、dv_plus 用 8888，后者靠 conf 覆盖） | `:33` |
| `vehicles_config_path` | `/apollo/modules/calibration/data` | `:171` |
| `vehicle_changed_use_copy_mode` | `true` | `:175` |
| `data_handler_config_path` | `/apollo/modules/dreamview_plus/conf/data_handler.conf` | `:187` |
| `dv_hmi_modes_config_path` | `/apollo/modules/dreamview/conf/hmi_modes` | `:199` |
| `dv_plus_hmi_modes_config_path` | `/apollo/modules/dreamview_plus/conf/hmi_modes` | `:202` |
| `maps_data_path` | `/apollo/modules/map/data` | `:205` |
| `global_components_config_path` | `/apollo/modules/dreamview/conf/global_components_config.pb.txt` | `:206` |
| `vehicle_data_config_filename` | （dv_plus conf 覆盖为 `modules/dreamview_plus/conf/vehicle_data.pb.txt`） | `:221` |
| `status_publish_interval` | `5` s | `:225` |
| `current_mode_db_key` | `/apollo/hmi/status:current_mode` | `:227` |
| `default_hmi_mode` | `Default` | `:230` |
| `monitor_timeout_threshold` | `2.5` s | `:244` |
| `dynamic_model_root_path` | `/.apollo/resources/dynamic_models/` | `:133` |

## 8. 车型配置

目录 `modules/calibration/data/`，现有 5 个车型：`kitti_140`、`mkz_121`、`mkz_example`、`mkz_lgsvl_321`、`nuscenes_165`。

`mkz_example/`（最全，41 个文件）实测结构：
- 根：`vehicle_param.pb.txt`（车辆几何/动力学参数，映射到 `/apollo/modules/common/data/vehicle_param.pb.txt`）、`vehicle_info.pb.txt`（`name` / `brand` / `model` / `vehicle_id.vin`）、`sensor_meta.pb.txt`（`sensor_meta { name / type / orientation / is_main_sensor }` 列表）、`navigation_lincoln.pb.txt`
- 标定与外参：`vehicle_params/vehicle_imu_extrinsics.yaml`、`velodyne_params/`（`velodyne64_height.yaml`、`64E_S3_calibration_example.yaml`、`velodyne64_novatel_extrinsics_example.yaml`）、`radar_params/`（`radar_extrinsics.yaml`、`radar_front_extrinsics.yaml`）、`gnss_params/`（`ant_imu_leverarm.yaml`、`gnss_conf.pb.txt`）、`camera_params/`
- 驱动 conf：`camera_conf/`（12 个）、`velodyne_conf/`（7 个）、`radar_conf/`、`video_conf/`（5 个）、`gnss_conf/`

`mkz_121/` 只有 `camera_params/ gnss_params/ lidar_params/ radar_params/ transform_conf/ vehicle_params/` + `novatel_localization_extrinsics.yaml` + `sensor_meta.pb.txt` + `vehicle_param.pb.txt` —— 说明文件集合是子集即可，缺的只是拷不过去。

**切车型的文件映射** `modules/dreamview_plus/conf/vehicle_data.pb.txt`（dv 版在 `modules/dreamview/conf/vehicle_data.pb.txt`），两份**都是 59 条 `data_files`**，每条 `{ source_path（相对车型目录）, dest_path（绝对目标） }`。示例：`vehicle_param.pb.txt` → `/apollo/modules/common/data/vehicle_param.pb.txt`；`control_conf.pb.txt` → `/apollo/modules/control/conf/control_conf.pb.txt`；`cancard_params` → `/apollo/modules/canbus/conf`（目录级）。

`VehicleManager::UseVehicle`（`modules/dreamview/backend/common/vehicle_manager/vehicle_manager.cc:43-49`）：copy 模式 `UseVehicleUseCopyMode`（`:51-73`，`cyber::common::Copy` 逐条覆盖）；symlink 模式 `UseVehicleUseSymlinkMode`（`:75-95`，`aem profile use <vehicle_type>`）。

车型可选扩展：`<vehicle_dir>/vehicle_type`（整数文本，`hmi_worker.cc:602-613`）、`<vehicle_dir>/dreamview_conf/hmi_modes/<同名>.pb.txt`（`hmi_worker.cc:141-157`，`MergeToCurrentMode` `:645-652` 只 swap `modules` 与 `monitored_components`）、`v2x_conf/`。

## 9. 已知高危坑与已确认缺陷

**双份代码（最高频 bug 来源）**：`simulation_world_service.cc` 两份（dv / dv_plus，diff 约 27 行），改任何聚合逻辑（障碍物、决策、轨迹、延迟统计）必须同时改；`hmi_worker.cc` 两份且已分叉；`teleop.cc` 两份，`modules/dreamview/backend/teleop/` 那份是死代码；障碍物转 `Object` 的逻辑三份（两份 `simulation_world_service.cc` + `obstacle_updater.cc`）。**改前先 `grep -rn "<函数名>" modules/dreamview modules/dreamview_plus`。**

**崩溃点（全是 ACHECK / 无检查解引用）**：
- `ACHECK(VehicleManager::Instance()->UseVehicle(*vehicle_dir))`（`modules/dreamview_plus/backend/hmi/hmi_worker.cc:633`）—— 车型目录不存在**直接 crash 整个 dreamview 进程**，不是返回错误。
- `ACHECK(!cyber_module.dag_files().empty())`（`hmi_util.cc:124-125`）—— mode 里空 `cyber_modules{}` 崩。
- `ACHECK(!config.modes().empty())`（`hmi_util.cc:91-92`）—— hmi_modes 目录空崩。
- `ACHECK(GetProtoFromFile(FLAGS_vehicle_data_config_filename, ...))`（`vehicle_manager.cc:34-36`）。
- `socket_manager_ws_` 从未 `reset`：`dreamview.h:83` 声明、`dreamview.cc:128` 解引用。
- `WebSocketHandler::handleBinaryData`（`websocket_handler.cc:253-258`）**不检查 `"Binary"` handler 是否注册**就调用。
- `PerceptionCameraUpdater::PublishMessage` 直接索引 `channel_updaters_[channel_name]`，未订阅的 channel 会插入空指针再解引用。
- `stream_data.set_data(&(byte_data[0]), ...)` 多处（如 `simulation_world_updater.cc:1157`、`hmi.cc:741`），空串时对空 vector 取 `[0]` 是 UB。

**逻辑缺陷**：
- `Trigger(DELETE_VEHICLE_CONF)` **缺 break**（`hmi_worker.cc:402-403`），穿透执行 `DeleteV2xConfig`。dv 的 `Trigger(CHANGE_VEHICLE)` 后 `case 3` 同样缺 break（`modules/dreamview/backend/dreamview.cc:281-284`）。
- `Dreamview::PointCloudCallback`（`modules/dreamview_plus/backend/dreamview.cc:260-264`）与 `PerceptionCameraCallback`（已注释 `:254-258`）在 dv_plus 无人调用 → `HMIStatus.current_point_cloud_channel` / `current_camera_sensor_channel` **恒为空**。
- `HMI::RegisterConnectionReadyHandler` 整段被注释（`hmi.cc:226-230`），新连接不再主动收到 VehicleParam；前端只能靠 `simworld` 流里的 `vehicle_param`。
- dv_plus 的 sim_world 推流**没有 `FLAGS_enable_update_size_check` / `FLAGS_max_update_size` 保护**（该检查只在 dv 的 `RequestSimulationWorld`），大地图 + PNC monitor 可能撑爆前端。
- `SimulationWorldService::to_clear_` 在 dv_plus 被改成 static，多实例时 `SetToClear()` 互相影响。
- `ChannelsUpdater::StartStream` 里 `timer_initialized_` 从未置 true，每次订阅新 channel 都会 reset 掉旧定时器。
- dv_plus 漏挂 `/teleop` 路由（见 §1）。
- `SetGlobalFlag` 是**追加写** `/apollo/modules/common/data/global_flagfile.txt`（**本环境现场核对：函数在 `dreamview_plus/backend/hmi/hmi_worker.cc:82-93`，`:89` 是 `std::ofstream fout(kGlobalFlagfile, std::ios_base::app)`；唯一调用点 `:559` 的 `SetGlobalFlag("map_dir", ...)`。旧 DV 同实现在 `dreamview/backend/hmi/hmi_worker.cc:69-81`**；注释里那句 "Overwrite global flagfile" 是误导），只有切地图会触发；该文件被几乎所有模块 `--flagfile` 引用，当前已有 3 行 `--map_dir`（`modules/common/data/global_flagfile.txt:14,20,22`），**gflags 按序求值 → 生效的是最后一行 `sunnyvale_big_loop`**。`if (*flag != value)` 保护使重复切同一地图不追加。另注该文件是指向 `/opt/apollo/neo/share/...` 的符号链接，**追加写会写穿到安装产物**。

**配置与部署陷阱**：
- 端口：dv_plus conf 明确 `--server_ports=8888`（`dreamview_plus/conf/dreamview.conf:8`）；dv conf 没写、取 gflag 默认 **8899**（`dreamview_gflags.cc:33`，`:36-37` 注释就写着这个分工）—— **本环境现场核对：两者端口不同，可以同时起**（这条旧版写成"都是 8888、不能同时起"，是错的）。
- `--static_file_dir` 默认指向 dv_plus 的 dist，dv 的 conf 恰好没设这个 flag → 用 `dreamview` 二进制会加载 dv_plus 前端。
- `data_handler.conf` 的 proto 全限定名 / `data_name` / `websocket_name` 三者错一个 → 订阅静默失败。
- `process_monitor_config.command_keywords` 与实际命令不匹配 → 状态灯永不亮。
- 切车型是**覆盖拷贝**（默认模式，`vehicle_changed_use_copy_mode` 默认 true），手改过的 `/apollo/modules/*/conf/` 会被静默覆盖；拷贝失败只 `AINFO_IF`、`UseVehicleUseCopyMode` 恒返回 true（`vehicle_manager.cc:59-66,72`）。**本环境额外一坑：`dreamview/conf/vehicle_data.pb.txt` 的 53 个 dest_path 有 25 个目标目录根本不存在**（`modules/control/conf/` 已迁到 `control/control_component/conf/`，还有 `perception/production/*`、`teleop/*`、`audio/*`、`drivers/video/*`），这些全部静默跳过。
- record 放包用进程内 `cyber::record::Player`，硬编码屏蔽 3 个 channel：`/apollo/hmi/status`、`/apollo/monitor/system_status`、`/apollo/cyber/record_info`（`backend/record_player/record_player_factory.cc:70-72`）。同时 load 超过 15 个 record 会 LRU 自动 unregister（`record_player_factory.h:58` `LOADED_RECORD_NUM`，`:57` 另有 `PRELOAD_RECORD_NUM = 3`；淘汰实现 `.cc:127-129` + `:145-165`，跳过 `current_record_` 从队首淘汰）。
- `HMIUtil::LoadConfig("")` 会把 dv + dv_plus 两个 mode 目录合并（`hmi_util.cc:77-85`），同名时先扫的 dv 版本胜出（`insert` 不覆盖）。当前两个 HMIWorker 都传了明确路径，未走该分支。

## 10. 前后端交接边界

- **后端产出**：`/websocket` 上的 JSON 请求-响应、各专用 ws 上的 `StreamData` 二进制流、`/proto` 提供 .proto 供前端动态解码、`/image` MJPEG。后端不参与任何布局/渲染。
- **前端目录**：dv_plus 用 monorepo `modules/dreamview_plus/frontend/packages/`（`dreamview-core` 主应用、`dreamview-carviz` 3D 渲染）；dv 用 `modules/dreamview/frontend/`（webpack + `proto_bundle/`）。
- **加本地面板**：`dreamview-core/src/components/panels/<MyPanel>/index.tsx` + `components/panels/type/Panel.ts:13` 的 `PanelType` 枚举 + `components/panels/index.tsx:88` 的 `localPanels` 数组；进默认布局改 `store/PanelLayoutStore/reducer.ts:47-141`。现有面板：`CameraView` `Charts` `Console` `DashBoard` `ModuleDelay` `PncMonitor` `PointCloud` `Terminal` `VehicleViz`。
- **加远程面板**：Module Federation，往 `/proto/modules/dreamview_plus_plugin_panels/panel.json` 加项（`components/panels/index.tsx:33`），**不改主仓源码**。
- **加 3D 图层**：`dreamview-carviz/src/render/` 加 layer 并在 `Carviz.class.ts` 实例化；若数据来自 SimulationWorld，**dv 与 dv_plus 两份 `simulation_world_service.cc` 都要改**。
- **构建**：`yarn web:build`（`modules/dreamview_plus/frontend/package.json:16`），产物落 `frontend/dist`，该目录**提交进仓库**、`modules/dreamview_plus/BUILD:9-12` 只当 filegroup，不参与 C++ 编译。build 会产生大量 hash 文件名 diff。
- **强耦合点**：后端 mode 文件名 ↔ 前端 `CURRENT_MODE` 枚举与默认布局；后端 `data_name` ↔ 前端 `StreamDataNames`。改后端配置必须同步前端，否则白屏或订阅失败。



