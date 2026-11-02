# Apollo DreamView / HMI 开发

> **⚠️ 本环境（包工作区）适配**：本环境是独立包管理工作区 `/apollo_workspace`，根下没有 `modules/`、`apollo.sh`。
> 本文 `modules/dreamview*/`、`modules/calibration/data/` 路径：**只读** → 拼 `/opt/apollo/neo/src/`；
> **要改** → 先 `buildtool install <pkg>`（dreamview 与 dreamview_plus 是不同包），落到
> `/apollo_workspace/modules/...`（保留完整仓库相对路径，不用换算）。编译用
> `buildtool build -p <相对工作区的包路径>`，**不能只 `bazel build`**（不做 install，运行时看不见）。
> **加 HMI 模式、加车型**：`hmi_modes/*.pb.txt` 与 `modules/calibration/data/<vehicle>/` 走
> `/apollo/<src_path>/...`（符号链接，立即生效，DreamView 重启即可看到）；改工作区源码副本要重编才生效。
> **前端（现场核对）**：`node v22.23.2`（nvm）+ `/usr/bin/yarn` 都在，`frontend/` 源码在
> `/opt/apollo/neo/src/modules/dreamview_plus/frontend/`（`package.json:16` 有 `web:build`，lerna monorepo），
> 但**没有 `node_modules/`**，首次改前端要先 `yarn install`（需外网）。
> 运行时只用产物：`/apollo/modules/dreamview_plus/frontend/` 下**只有 `dist/`**
> （→ `/opt/apollo/neo/share/modules/dreamview_plus/frontend/dist`），
> 即 `--static_file_dir` 指的就是它 —— **只改 TS 不 build，线上没有任何变化**。
> 完整对照见仓库根 `CLAUDE.md`。

**动手前先确定改的是 `dreamview` 还是 `dreamview_plus`**：两者是两套独立后端 + 两套前端，且有大量重复代码。长知识（全路由表、全 updater 清单、hmi_modes 全清单、配置字段语义、高危坑）见 `reference.md`。

## 1. dreamview 与 dreamview_plus 的关系

`dreamview_plus` 是当前主力，`dreamview` 是旧版，两者都在仓库里且都能编出二进制。

| | `modules/dreamview` | `modules/dreamview_plus` |
|---|---|---|
| 入口 | `modules/dreamview/main.cc:21-35` | `modules/dreamview_plus/main.cc:25-71`（多 gperftools profiling） |
| conf | `modules/dreamview/conf/dreamview.conf`（只 1 行 flagfile，**不设 static_file_dir**，也**不设 `--server_ports` → 取 gflag 默认 8899**） | `modules/dreamview_plus/conf/dreamview.conf:1-11`（`:8` `--server_ports=8888`、`--default_hmi_mode=Default`） |
| hmi_modes | `modules/dreamview/conf/hmi_modes/` 20 个 | `modules/dreamview_plus/conf/hmi_modes/` 4 个 |
| ws 路由 | 5 个 + `/image` (`backend/dreamview.cc:110-115`) | 10 个 + `/image` `/proto` (`backend/dreamview.cc:121-132`) |
| 推流 | 后端主动定时推 | Updater + SocketManager **订阅制** |
| 启动 | `scripts/bootstrap.sh` → `scripts/dreamview.sh` | `scripts/bootstrap.sh start_plus` → `scripts/dreamview_plus.sh`（`scripts/bootstrap.sh:58-64`） |

**唯一真正共享的库**是 `//modules/dreamview/backend/common:dreamview_common`（被 dv_plus 反向依赖，`modules/dreamview_plus/backend/BUILD:113`），含：全部 ~70 个 gflag（`modules/dreamview/backend/common/dreamview_gflags.cc`）、`handlers/`（WebSocketHandler / ImageHandler / ProtoHandler）、`map_service/`、`util/hmi_util.{h,cc}`、`sim_control_manager/`、`vehicle_manager/`、`fuel_monitor/`、`plugins/`、`teleop/`。

**改任何聚合/HMI 逻辑前先 `grep -rn "<函数名>" modules/dreamview modules/dreamview_plus`**：`simulation_world_service.cc`、`hmi_worker.cc`、`teleop.cc` 各有两份，`hmi_worker.cc` 已分叉。

## 2. 后端结构（以 dv_plus 为准）

进程入口 `main.cc` → `Dreamview::Init()`（`modules/dreamview_plus/backend/dreamview.cc:57-141`）：
`VehicleConfigHelper::Init()` → 构造 `CivetServer`（`:75-90`，`document_root=FLAGS_static_file_dir`、`listening_ports=FLAGS_server_ports`）→ new 9 个 `WebSocketHandler`（`:92-101`）→ new 各 Updater / Service（`:102-117`）→ `RegisterUpdaters()`（`:118`）→ `DvPluginManager`（`:119-120`）→ `addWebSocketHandler` 挂路由（`:121-130`）+ `addHandler("/image"|"/proto")`（`:131-132`）→ `SocketManager`（`:134-135`）。
`Start()`（`:143-164`）只启 `hmi_` / `plugin_manager_` / `dv_plugin_manager_`；**sim_world 与 camera 推流已被注释（`:155-159`）**，改由前端订阅触发。

WebSocket 路由（`dreamview.cc:121-132`）：`/websocket`（主 JSON API）、`/map`、`/pointcloud`、`/camera`、`/plugin`、`/simworld`、`/hmi`、`/socketmanager`（**残留，`socket_manager_ws_` 从未 reset**）、`/obstacle`、`/channelsinfo`；HTTP：`/image`（MJPEG）、`/proto`（把 .proto 发前端做动态解码）。完整表见 `reference.md`。

**订阅制三件套**：
1. `UpdaterBase`（`modules/dreamview_plus/backend/updater/updater_base.h:38-63`）：纯虚 `StartStream(time_interval_ms, channel_name, subscribe_param)` / `StopStream` / `PublishMessage`；`time_interval_ms == 0` = 单次。多 channel 用 `UpdaterWithChannelsBase`（`updater/updater_with_channels_base.h`）。
2. `UpdaterManager`（`updater/updater_manager.h:50-68`）：`path_name -> UpdaterBase*`；`Dreamview::RegisterUpdaters()`（`dreamview.cc:266-275`）注册 7 个 data name —— `simworld / hmistatus / camera / pointcloud / map / obstacle / channelsinfo`（`HMI` 本身就是 `UpdaterBase` 子类，`hmi/hmi.h:35`）。
3. `SocketManager`（`socket_manager/socket_manager.cc:89-112`）：把 `subscribe` / `unsubscribe` 注册在 **`/websocket`** 上，连接建立即广播 metadata（`BrocastDataHandlerConf`，`:274`）。订阅报文字段：`data.info.websocketName`（必填，**就是 `updater_manager_->Start()` 的 key**）/ `dataFrequencyMs` / `channelName` / `param`（`socket_manager.cc:146-161`）。元数据来源 `FLAGS_data_handler_config_path` = `modules/dreamview_plus/conf/data_handler.conf`。

JSON 派发：`WebSocketHandler::handleJsonData` 按 `type` 字段查表（`modules/dreamview/backend/common/handlers/websocket_handler.cc:228-251`，**缺 `type` 或未注册直接丢弃**）。流式二进制统一包成 `apollo.dreamview.StreamData`（`modules/dreamview_plus/proto/data_handler.proto:35-41`）。

## 3. 新增一个 HMI 模式

1. **建配置文件** `modules/dreamview_plus/conf/hmi_modes/<my_mode>.pb.txt`（旧版放 `modules/dreamview/conf/hmi_modes/`）。文件名 → 显示名走 TitleCase：`my_mode.pb.txt` → `My Mode`（`modules/dreamview/backend/common/util/hmi_util.cc:36-46`；约定见 `modules/dreamview_plus/conf/hmi_modes/README.md:6-15`）。
2. **文件内容**是 `HMIMode`（`modules/common_msgs/dreamview_msgs/hmi_mode.proto:121-130`），四种声明模块的方式：
   - `cyber_modules { key: "Planning" value { dag_files: "/apollo/modules/planning/planning_component/dag/planning.dag" } }` —— 只给 dag，`TranslateCyberModules`（`hmi_util.cc:118-149`）自动合成 `nohup mainboard [-p <group>] -d <dag>... &` / `stop_command = pkill -f "<第一个 dag>"` / `command_keywords = {"mainboard", "<第一个 dag>"}`。**dag_files 为空会 ACHECK 崩**（`:124-125`）。参照 `modules/dreamview_plus/conf/hmi_modes/pnc.pb.txt:1-19`。
   - `modules { key: "Perception" value { start_command / stop_command / process_monitor_config.command_keywords } }` —— 手写 `cyber_launch` 命令，直接 `std::system()` 执行。参照 `modules/dreamview_plus/conf/hmi_modes/vehicle_test.pb.txt:1-10`。
   - `monitored_components { ... }` —— **只有状态灯没有开关按钮**，参照 `vehicle_test.pb.txt:152-231`。
   - `operations:` + `default_operation:`（枚举 `modules/common_msgs/dreamview_msgs/hmi_status.proto:39-56`）。
   `global_components` 不用写：`LoadMode` 会自动合并 `modules/dreamview/conf/global_components_config.pb.txt` 的 4 个（DataRecorder / Terminal / RTKRecorder / RTKPlayer，`hmi_util.cc:107-113`）。`layout` 字段后端不读。
3. **无需注册即可见**：`HMIUtil::LoadConfig` glob 整个目录（`hmi_util.cc:75-90`），`modules/dreamview_plus/BUILD:31-39` 的 filegroup 已 glob `conf/hmi_modes/*.txt`。dv_plus 读 `FLAGS_dv_plus_hmi_modes_config_path`（`dreamview_gflags.cc:202-204`），dv 读 `FLAGS_dv_hmi_modes_config_path`（`:199-201`）—— 这是两者模式列表不同的唯一原因。
4. **前端必须同步**，否则白屏：`modules/dreamview_plus/frontend/packages/dreamview-core/src/store/HmiStore/actionTypes.ts:115-127` 的 `CURRENT_MODE` 加枚举 + `store/PanelLayoutStore/reducer.ts:47-141` 加默认布局，然后 `yarn web:build`（`modules/dreamview_plus/frontend/package.json:16`）。
5. **验证**：重启 dreamview_plus → HMI 模式下拉列表出现 → 切过去后模块开关列表 = 你写的 `modules` + `cyber_modules` 之和；灯要亮还需 monitor 在跑。

## 4. 新增一个后端 WebSocket 接口

**请求-响应型（推荐，只改 1 个文件）**：在 `HMI::RegisterMessageHandlers()`（`modules/dreamview_plus/backend/hmi/hmi.cc:224`）或 `SimulationWorldUpdater::RegisterMessageHandlers()`（`modules/dreamview_plus/backend/simulation_world/simulation_world_updater.cc:431`）里加
`websocket_->RegisterMessageHandler("MyAction", [this](const Json &json, WebSocketHandler::Connection *conn) {...});`
必须自己用 `JsonUtil::GetStringByPath(json, "data.requestId", &id)` 取 requestId（缺则回 `code=-1, message="Miss requestId"`，照抄 `hmi.cc:233-249`），回包形如 `{"action":"response","data":{"requestId":..,"info":{"code":0,"message":"Success","data":{...}}}}`。逻辑落到 HMIWorker 就在 `hmi/hmi_worker.{h,cc}` 加方法；要新增 HMIAction 则改 `modules/common_msgs/dreamview_msgs/hmi_config.proto:5-38` 并在 `Trigger` 的**两个 switch**（`hmi_worker.cc:319-355` 无参、`:357-418` 带值）里加 case（**注意 `:402-403` 现有 case 缺 break**）。

**定频推流型（新 ws 路径，7 处都要改）**：
1. 新建 `modules/dreamview_plus/backend/<name>/<name>_updater.{h,cc}` 继承 `UpdaterBase`（或 `UpdaterWithChannelsBase`）。
2. 新 proto 放 `modules/dreamview_plus/proto/` + 改该目录 `BUILD`。
3. `modules/dreamview_plus/backend/BUILD:31-68` 加 srcs / hdrs / deps。
4. `backend/dreamview.h:73-97` 加 `unique_ptr<WebSocketHandler>` + `unique_ptr<XxxUpdater>` 成员。
5. `backend/dreamview.cc`：`Init()` 里 new ws（`:92-101`）+ new updater（`:102-117`）+ `addWebSocketHandler("/xxx", ...)`（`:121-130`）；`RegisterUpdaters()`（`:266-275`）加 `RegisterUpdater("xxx", ...)`；`Stop()`（`:166-176`）加清理。
6. **`modules/dreamview_plus/conf/data_handler.conf` 加一段**，否则前端拿不到 metadata、订阅静默失败。`key` 必须是 proto 全限定名，`data_name` 必须**等于** `RegisterUpdater` 的 key **且等于** `websocket_name`（`socket_manager.cc:147,164`）；多 channel 加 `different_for_channels: true` 并在 `socket_manager.cc:34-37` 的 `filter_info` 加过滤规则。
7. 前端 `frontend/packages/dreamview-core/src/services/api/types.ts:75-85` 的 `StreamDataNames` 加枚举，再 `yarn web:build`。

**零侵入替代方案**：实现 `DvPluginBase`（`modules/dreamview_plus/backend/dv_plugin/dv_plugin_base.h:38`）的 `GetWebSocketHandlers()` `GetUpdaterHandlers()` `GetDataHandlerConf()`（`:65,80,87`），编成 cyber plugin，主仓不改一行。

**前端调用边界**（不深入）：请求走 `{"type":"MyAction","action":"request","data":{"requestId":...,"info":{...}}}`；流式数据走 `subscribe` 报文后从 `/xxx` 收 `StreamData` 二进制，前端按 `/proto` 拉到的 .proto 动态解码。前端 `dist/` 是**提交进仓库的产物**（`modules/dreamview_plus/BUILD:9-12` 只当 filegroup，不参与 C++ 编译），改 TS 不 build 则线上无变化。

## 5. 新增 / 修改车型配置

车型目录 = `FLAGS_vehicles_config_path`，默认 `/apollo/modules/calibration/data`（`dreamview_gflags.cc:171-172`）。仓库现有 5 个：`kitti_140`、`mkz_121`、`mkz_example`、`mkz_lgsvl_321`、`nuscenes_165`。目录名 TitleCase 即 HMI 显示名（`hmi_util.cc:64-73`）。

1. **建目录** `modules/calibration/data/<my_vehicle>/`，按 `modules/dreamview_plus/conf/vehicle_data.pb.txt` 的 **59 条 `data_files` 映射**准备文件（`source_path` 相对车型目录，`dest_path` 是绝对目标路径）。参照最全的 `modules/calibration/data/mkz_example/`：
   - `vehicle_param.pb.txt`（车辆参数 proto，映射到 `/apollo/modules/common/data/vehicle_param.pb.txt`）
   - `vehicle_info.pb.txt`（品牌/型号/VIN）、`sensor_meta.pb.txt`（传感器清单与主传感器）
   - 外参 / 标定：`vehicle_params/`（IMU 外参 yaml）、`velodyne_params/`、`radar_params/`、`camera_params/`、`gnss_params/`（`ant_imu_leverarm.yaml`、`gnss_conf.pb.txt`）
   - 驱动 conf：`camera_conf/`、`velodyne_conf/`、`radar_conf/`、`video_conf/`、`gnss_conf/`
   （不同车型子集不同，`mkz_121` 只有 `camera_params/ gnss_params/ lidar_params/ radar_params/ transform_conf/ vehicle_params/` + `sensor_meta.pb.txt` + `vehicle_param.pb.txt` + `novatel_localization_extrinsics.yaml`。**缺的文件只是拷不过去，不会崩**。）
2. 可选：`<vehicle_dir>/vehicle_type`（纯整数文件，`hmi_worker.cc:602-613` 读出来 `stoi`）、`<vehicle_dir>/dreamview_conf/hmi_modes/<同名>.pb.txt`（覆盖同名 HMI 模式，`hmi_worker.cc:141-157`；`MergeToCurrentMode`（`:645-652`）**只 swap `modules` 与 `monitored_components`**）、`v2x_conf/`。
3. **不需要改任何 C++ 代码**，也不需要注册：`LoadConfig` 用 `ListDirAsDict` 枚举目录（`hmi_util.cc:95`）。
4. **切换机制** `HMIWorker::ChangeVehicle`（`hmi_worker.cc:588-643`）：查目录 → 读 `vehicle_type` → `ResetMode()` 停全部模块 → 重载 mode（有车型自定义则 merge）→ `ACHECK(VehicleManager::Instance()->UseVehicle(*vehicle_dir))`。`UseVehicle`（`modules/dreamview/backend/common/vehicle_manager/vehicle_manager.cc:43-49`）两种模式：
   - **copy 模式（默认，`FLAGS_vehicle_changed_use_copy_mode=true`）**：按映射把文件**覆盖拷贝**到 `/apollo/modules/*/conf/` 等工作副本（`:51-73`）——手改过的 conf 会被静默覆盖。
   - symlink 模式：`std::system("aem profile use <vehicle_type>")`（`:75-95`），需在 conf 里打开 `--vehicle_changed_use_copy_mode=false` 并设 `--vehicles_config_path=/apollo_workspace/profiles`（`modules/dreamview_plus/conf/dreamview.conf:9-11` 有注释模板）。

## 6. 模块状态灯与数据显示原理

**灯不由 dreamview 判定**。链路：monitor 读 `HMIStatus` 拿到 `current_mode` → 自己 `HMIUtil::LoadMode` 同一个 mode 文件 → 按 `modules` / `monitored_components` 建表（`modules/monitor/common/monitor_manager.cc:60-75`）→ `ProcessMonitor::RunOnce` 遍历 `/proc/*/cmdline`，用 `process_monitor_config.command_keywords` 做子串匹配（`modules/monitor/software/process_monitor.cc:40-75`）→ 写 `SystemStatus` 到 `FLAGS_system_status_topic` → HMIWorker 在 reader 回调里 `status_.modules[name] = (hmi_modules[name].status == OK)`（`modules/dreamview_plus/backend/hmi/hmi_worker.cc:225-289`，判定在 `:240-248`；`monitored_components` 在 `:255-260`）。

灯不亮排查顺序：① monitor 进程在跑吗（`scripts/monitor.sh start` / `modules/monitor/dag/monitor.dag`）；② `SystemStatus` 时效 —— 超过 `FLAGS_system_status_lifetime_seconds` 视为过期（`hmi_worker.cc:232-238`）；③ mode 文件里 `command_keywords` 与实际命令行是否子串匹配（`cyber_modules` 自动生成的是 `{"mainboard", "<第一个 dag>"}`）；④ 模块名 key 是否与 mode 文件一致（monitor 与 dreamview 读同一个文件，key 不一致就查不到）。另有兜底：`OnTimer` 每 3s 用 `isProcessRunning`（`pgrep -f <整条 start_command>`，`hmi_worker.cc:1869-1888`、`:2090-2108`）解开卡住的 `modules_lock`。

**数据不显示**：dv_plus 的点云 / 相机 / 障碍物 / 地图 / simworld 全是**前端订阅后才推**（`Dreamview::Start()` 的推流已注释，`dreamview.cc:155-159`）。所以先看 ① 前端有没有发 `subscribe`；② `data_handler.conf` 里 `data_name` / `websocket_name` / proto 全限定名三者是否一致；③ `filter_info`（`socket_manager.cc:34-37`）是否放行你的 channel（pointcloud 要求 channel 名含 `sensor`）；④ 对应 cyber channel 有没有真数据。

## 7. SimControl 仿真控制

真实路径 `modules/dreamview/backend/common/sim_control_manager/`（属共享库，dv 与 dv_plus 共用）：`sim_control_manager.{h,cc}`、`core/`（`sim_control_base`、`sim_control_with_model_base`、`dynamic_model_factory`）、`dynamic_model/perfect_control/`、`common/`、`proto/`。接口见 `sim_control_manager.h:40-78`：`Init/Start/Stop/Restart/Reset/RunOnce` + `LoadDynamicModels/AddDynamicModel/ChangeDynamicModel/DeleteDynamicModel`。作用：不启 canbus/control 也能让主车按 planning 轨迹动起来（发定位与底盘），用于纯 PNC 调试。

**怎么开**：不是独立开关，而是由 **operation** 驱动。`ChangeOperation`（`hmi_worker.cc:1280-1311`）→ `ClearInvalidResourceUnderChangeOperation`（`:1245-1278`）：operation ∈ `OperationBasedOnSimControl`（`{Scenario_Sim, Sim_Control}`，`hmi_worker.cc:76-79`）就 `Start()`，否则 `Stop()` 并清空动力学模型状态。所以要在某个 mode 里用 SimControl，就在该 mode 文件加 `operations: Sim_Control`（`default.pb.txt:96-98` 与 `pnc.pb.txt:20-22` 都有；`perception.pb.txt` 只有 `Record`，因此该模式下开不了）。切地图后会额外 `SimControlManager::Instance()->Restart()`（`hmi_worker.cc:367-369`）。动力学模型目录由 `FLAGS_dynamic_model_*` 指向 `/.apollo/resources/dynamic_models/`（`dreamview_gflags.cc:129-141`）。

## 8. 排错表

| 现象 | 检查顺序 |
|---|---|
| DV 起不来 | ① 端口：dv_plus 明确 `--server_ports=8888`，dv 未设、取 gflag **默认 8899**（`dreamview_gflags.cc:33`，`:36-37` 注释原文 "Dreamview always use 8899 and Dreamview Plus always use 8888"）——**本环境现场核对：两者端口不同，可以同时起**；② `hmi_modes` 目录为空 → `ACHECK(!config.modes().empty())` 崩（`hmi_util.cc:91-92`）；③ 某个 mode 写了空 `cyber_modules{}` → 崩（`hmi_util.cc:124-125`）；④ `FLAGS_vehicle_data_config_filename` 读不到 → 崩（`vehicle_manager.cc:34-36`）；⑤ 看 `/apollo/nohup.out` 与 `data/core` |
| 页面白屏 / 前端不是新的 | ① `--static_file_dir` 默认指向 **dv_plus** 的 dist（`dreamview_gflags.cc:28`），用 `dreamview` 二进制忘传 flag 会加载错前端；② 新 mode 没加 `CURRENT_MODE` 枚举或默认布局 → `state.layout[mode]` undefined；③ 改了 TS 没 `yarn web:build` |
| 模块灯不亮 | 见 §6 四步（monitor 是否在跑 → SystemStatus 是否新鲜 → `command_keywords` → 模块名 key） |
| 点云 / 轨迹 / 障碍物不显示 | 见 §6「数据不显示」四步；另注意 `HMIStatus.current_point_cloud_channel` / `current_camera_sensor_channel` 实际恒为空（回调无人调用，`dreamview.cc:254-264`） |
| 切车型无效 | ① 车型目录名 → TitleCase 显示名是否对得上；② `vehicle_data.pb.txt` 里 `source_path` 对应文件在车型目录下存不存在（缺就静默不拷）；③ copy 模式会覆盖 `/apollo/modules/*/conf/`，确认没被你手改的文件误导；④ 目录不存在会 `ACHECK` **直接 crash dreamview**（`hmi_worker.cc:633`）；⑤ symlink 模式需 `aem profile use` 可用 |
| 启动模块失败 | ① `start_command` 手工在终端跑一遍（`modules{}` 走 `std::system`，`hmi_worker.cc:717-741`）；② `cyber_modules{}` 的 dag 路径必须是 `/apollo/...` 绝对路径；③ `ChangeMode` / `ChangeVehicle` / `ChangeMap` 都会先 `ResetMode()` 停全部模块（`hmi_worker.cc:667`、`:617`、`:560`）；④ monitor 超时 >2.5s（`FLAGS_monitor_timeout_threshold`）会自动 `DISENGAGE`（`hmi_worker.cc:819-843`） |
| 切地图后 flagfile 变大 | 已知缺陷：`SetGlobalFlag` 是**追加写** `/apollo/modules/common/data/global_flagfile.txt`（`hmi_worker.cc:2085-2097`），当前该文件已有 3 行 `--map_dir`（`modules/common/data/global_flagfile.txt:14,20,22`），gflags 取最后一次，功能可用但文件无限膨胀 |


