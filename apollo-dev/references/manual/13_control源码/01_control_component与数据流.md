# 01 control_component 与数据流

<!--
file: references/manual/13_control源码/01_control_component与数据流.md
scope: 11.0（默认）
tags: control_component, ControlComponent, TimerComponent, ControlCommand, LocalView, pipeline, ControlTaskAgent, safety/decision, replan_control_task, estop, 10ms
sources:
- /opt/apollo/neo/src/modules/control/control_component/control_component.cc（43–139、324–520 行精读）
- /opt/apollo/neo/src/modules/control/control_component/control_component.h
- /apollo/modules/control/control_component/dag/control.dag（全文，经 readlink 判定落点）
- /apollo_workspace/.manual_work/inventory/control_inventory.md（本工程 P1 盘点表，含 replan/safety/pipeline 事实）
-->

## 0. 一句话作用

control 的**进程级入口与主循环**：`ControlComponent` 是一个 **10 ms 定时触发**（TimerComponent，非消息触发）的 cyber 组件，每周期主动 `Observe()` 拉取底盘/规划轨迹/定位/Pad 四路最新消息组装 `LocalView`，交给 `ControlTaskAgent`（按 pipeline 串起来的 ControlTask 插件链）算出一条 `ControlCommand`，写到 `/apollo/control` 供 canbus 执行。位置：`/apollo/planning`（见 `../12_planning源码/14_输出消息链路.md`）+ 底盘反馈 → **本组件** → `/apollo/control` → canbus。

## 1. 关键符号与文件

| 符号/类/概念 | 文件（绝对路径，注明层） | 行号(已核) | 说明 |
|---|---|---|---|
| `ControlComponent` | /opt/apollo/neo/src/modules/control/control_component/control_component.h（② src 全） | 53 | `final class ... : public apollo::cyber::TimerComponent` —— **定时组件**，无消息模板参数 |
| 注册宏 | 同上 | 150 | `CYBER_REGISTER_COMPONENT(ControlComponent)`（非限定名，与 dag 的 `class_name` 对应） |
| `Init()` | control_component.cc（② src 全，704 行） | 43–139 | 载 pipeline → 初始化 ControlTaskAgent → 建 5 个 reader、2~3 个 writer |
| `Proc()` | 同上 | 324–520+ | 每 10 ms 一次的主循环（拉取→组装 LocalView→产命令→写出） |
| `ControlTaskAgent` | 同上（成员 `control_task_agent_`） | Init 调用点 60 | `Init(injector_, control_pipeline_)`：按 pipeline 依次实例化 ControlTask 插件（框架见 `03_control_task框架与controllers清单.md`） |
| `control_pipeline_` 载入 | 同上 | 49–54 | `GetProtoFromFile(FLAGS_pipeline_file, &control_pipeline_)`，失败即 ACHECK 崩（起不来先查 pipeline 路径） |
| `ProduceControlCommand` | 同上 | 调用点 438 | 只有 `driving_mode == COMPLETE_AUTO_DRIVE` 才走它；否则 `ResetAndProduceZeroControlCommand` |
| dag | /apollo/modules/control/control_component/dag/control.dag（④，**软链→profiles/current**） | 全文 12 行 | `timer_components{class_name:"ControlComponent", name:"control", flag_file_path:/apollo/.../conf/control.conf, interval:10}`，**无 readers 段** |

## 2. 机制与数据流

### 2.1 拉起链路

`mainboard -d control.dag` → 加载 `modules/control/control_component/libcontrol_component.so` → class_loader 按 `class_name: "ControlComponent"` 实例化 → 先按 dag `flag_file_path` 载入 `control.conf`（gflags）→ `Init()` → cyber timer 每 `interval: 10` ms 调一次 `Proc()`（组件机制见 `../11_cyber框架/01_component与channel机制.md`）。

### 2.2 输入输出 channel 总表

| channel | 消息类型 | 方向 | 来源 flag（默认值定义在 /opt/apollo/neo/src/modules/common/adapters/adapter_gflags.cc） | 代码位置 |
|---|---|---|---|---|
| /apollo/canbus/chassis | canbus::Chassis | in | FLAGS_chassis_topic | cc:69–75 |
| /apollo/planning | planning::ADCTrajectory | in | FLAGS_planning_trajectory_topic | cc:77–83 |
| /apollo/planning/command_status | external_command::CommandStatus | in | FLAGS_planning_command_status | cc:85–93 |
| /apollo/localization/pose | localization::LocalizationEstimate | in | FLAGS_localization_topic | cc:95–102 |
| /apollo/control/pad | PadMessage | in | FLAGS_pad_topic | cc:104–110 |
| **/apollo/control** | control::ControlCommand | **out** | FLAGS_control_command_topic | writer cc:113–115，写 cc:508 |
| /apollo/control/localview | control::LocalView | out（仅 `FLAGS_use_control_submodules=true`） | FLAGS_control_local_view_topic | writer cc:117–119，写 cc:406 |
| /apollo/control/interactive | ControlInteractiveMsg | out | FLAGS_control_interative_topic | writer cc:121–123 |
| /apollo/safety/decision | SafetyDecision | in（**不在本组件**，在 replan_control_task 插件内） | replan_task_conf.proto 的 `guardian_decision_topic` | 见 §2.4 |

⚠️ **dag 不声明输入**：control.dag 只有 timer 段，5 个 reader 全在代码里按 gflags 建——想改订阅 channel 不是改 dag，而是改 conf 里的 flag 或代码。

### 2.3 Proc 每周期做什么（cc:324–520）

1. `chassis_reader_->Observe()` + `GetLatestObserved()`；**chassis 为空直接 return false**（cc:330–336）——底盘没数据 = control 不出命令。
2. planning 轨迹：为空只告警不退出（cc:339–349）；靠 `header().sequence_num()` 变化判定新帧才 `OnPlanning` 拷贝。
3. planning command status、localization（**localization 为空也 return false**，cc:361–367）、pad（可空）。
4. 加锁把 chassis/trajectory/localization/pad 拷进 `local_view_`（cc:376–385）——一帧输入快照。
5. submodule 模式（`FLAGS_use_control_submodules=true`）：填 header + LatencyRecorder，把 LocalView 写到 `/apollo/control/localview` 后 return（cc:388–408）；**本机 conf 为 false，走普通模式**。
6. 普通模式：`driving_mode == COMPLETE_AUTO_DRIVE` → `ProduceControlCommand`；否则产零命令（cc:434–445）。estop 状态会把原因写进 header status（cc:455–458）。
7. 填 lidar/camera/radar 时间戳（从轨迹 header 继承，cc:460–466）、算周期耗时并标 `total_time_exceeded`（阈值 `FLAGS_control_period`）、`FillHeader(node_->Name(), ...)`、`control_cmd_writer_->Write(control_command)`（cc:508），最后 `PublishControlInteractiveMsg()`。

### 2.4 safety 决策 → 重规划的消费链

`safety_manager` 的 checker 链（10 个 checker 包，`checkers.dag` 挂 9 个，`file_exist_checker` 未挂）产出 `SafetyDecision` 发到 **/apollo/safety/decision**；消费方是 **replan_control_task 插件**（不是 control_component）：其 `Init` 内建 reader，`ComputeControlCommand` 中 `if (decision_.has_safety_mode_trigger_time())`（replan_control_task.cc **约 :85**，盘点表核对）→ 置 `replan_request=true`、reason code `REPLAN_REQ_ALL_REPLAN`（**判字段存在性，不判值** → 无条件全量重规划）。`SafetyStatus.Status` 8 档：OK1 / WARN_PENDING2 / ERROR_PENDING3 / FATAL_PENDING4 / WARN5（只告警）/ ERROR6（舒适刹停）/ FATAL7（紧急刹停）/ WAIT_REMOVED8（proto：/opt/apollo/neo/src/modules/safety_manager_msgs/safety_manager.proto）。

⚠️ 但**当前生效 pipeline 未启用 replan_control_task**（见 §5），该链路在本机当前配置下可能未实例化。

## 3. 注册与配置

- **pipeline 决定装哪些 ControlTask**：`FLAGS_pipeline_file`（control.conf 里）→ `conf/pipeline.pb.txt`。生效档（profile 层）5 项：`LAT_PLUS_CONTROLLER→LatPlusController`、`LON_PLUS_CONTROLLER→LonPlusController`、`DEMO_CONTROL_TASK→DemoControlTask`、`ANTISLIP_TASK→AntiSlipControlTask`、`DEBUG_INFO_TASK→DebugInfoControlTask`；出厂档（share 层）只有 `LAT_CONTROLLER`+`LON_CONTROLLER` 2 项。⚠️ **修订 2026-09-08**：control 的实例 conf **不按 pipeline 别名建子目录**（那是 planning task 的规则）——`GetPluginConfPath`（`plugin_manager.h:191-208`）= 插件描述文件所在目录 + 固定文件名 `conf/controller_conf.pb.txt`（`control_task.h:128-129`），即 conf 就在**插件包目录**下；`class_name` 只用于反查插件，改类名/namespace 要同步 plugins.xml 的 `type` 与注册宏。
- **控制器都是插件**：8 个 controller 的 plugins.xml 均为 `type=apollo::control::Xxx`、`base_class=apollo::control::ControlTask`、`path=modules/control/controllers/<pkg>/lib*.so`；索引在 `/opt/apollo/neo/share/cyber_plugin_index/`（全库 118 条，control 占 8 条）。
- **conf 文件与生效路径**：`/apollo/modules/control/control_component/conf/{control.conf, pipeline.pb.txt, calibration_table.pb.txt}` 与 `dag/control.dag` 均软链到 `/apollo_workspace/profiles/current/...`（current→ARCF_40P）；`dag/{lateral_longitudinal_module,mpc_module}.dag`、`launch/*` 仍指 share。controllers 的 conf **混指** profile 与 share（改前先 `readlink`）。
- control.conf 关键 flag：`use_control_submodules=false`、`control_period=0.01`、`soft_estop_brake=15.0`、`enable_persistent_estop`（出厂 false / profile true）、`action=1`、`pipeline_file`、`calibration_table_file`。

## 4. 修改与扩展点（二次开发）

| 想改什么 | 改哪里 | 之后做什么 |
|---|---|---|
| 换/增减控制器 | 生效 `pipeline.pb.txt`（profile 层）加删 `controller{ name/type }` 项，type=插件类名 | 重启组件即可（不用重编） |
| 调某控制器参数 | 该控制器 `conf/controller_conf.pb.txt`（先 readlink 确认落点） | 重启组件；详见 `04_conf标定与调参.md` |
| 改控制周期 | dag 的 `interval`（ms）+ conf 的 `control_period`（s）**两处要一致** | 重启 |
| 改主循环逻辑/输入 | `buildtool install control` 拉源码到 `/apollo_workspace/modules/control/...`，改 `control_component.cc` | `buildtool build -p modules/control/control_component` 完成 install（`bazel build` 不算） |
| 新写 ControlTask 插件 | `buildtool create --template plugin` + plugins.xml（`base_class` 必须 `apollo::control::ControlTask`） | `buildtool build -p <包路径>`，再进 pipeline；见 `../15_二次开发手册/04_新增ControlTask.md` |
| 启用 safety→重规划链 | 生效 pipeline 加 `REPLAN_TASK→ReplanControlTask`，确认 `guardian_decision_topic` 与发布侧一致 | 重启，观察 `/apollo/safety/decision` 是否真有数据 |

## 5. ⚠️ 本环境注意

- **conf/dag 已迁 profile 层**：control 的 conf 与 dag 指向 `/apollo_workspace/profiles/current/`（ARCF_40P），CLAUDE.md「④ 层一律指向 share」对 control **不成立**；改出厂 share 件不会生效。
- **生效 pipeline 无 replan_control_task**：safety 决策消费链当前未在链上（包/注册/conf 齐全但没进 pipeline），排查「safety 触发了却没重规划」先看 pipeline。
- **陈旧残迹别用**：`dag/lateral_longitudinal_module.dag`、`dag/mpc_module.dag` 里的 `module_library: "modules/control/libcontrol_component.so"` 与 `flag_file_path: /apollo/modules/control/conf/control.conf` **路径都不存在**；mpc_controller 控制器包在本机不存在（仅 submodule 源文件残留）。运行时唯一有效入口是 `control.launch → control.dag`。
- **controllers 是 8 个不是 7 个**：demo_control_task 在本机全层存在且已注册、已进生效 pipeline（CLAUDE.md「只剩 7 个」已过期，2026-09-08 实测）。
- **底盘/定位缺一即不出命令**（cc:330–336、361–367）：`/apollo/control` 没数据先查这两路，再查 driving_mode 是否 `COMPLETE_AUTO_DRIVE`（非自动驾驶模式只发零命令）。
- `control.conf` 里出现 `---calibration_table_file=...` **三连字符**写法：**已结案（2026-09-08 gflags 实测）** —— flagfile 里三连字符行既不报错也不赋值，flag 保持 `DEFINE` 默认值；本机默认值恰好等于该行想写的路径，故笔误无害，但**想靠改这行换标定表必然失败**（详见 `04_conf标定与调参.md`）。另注：本机生效的 `LonPlusController` 根本不读这个 flag（走 `ControlTaskExtend::LoadCalibrationTable` 的硬编码前缀）。
- safety_manager 源码在本机几乎不落地（analyzer/exporter/guardian 与 9 个 checker 只有头文件+lib+share），发布侧代码不可读（strings 证据指向 guardian 组件 lib）。
- 搜 `/apollo/...` 用 `grep -R`（`-r` 不跟随符号链接会假空）。

## 6. 验证命令

```bash
# 单模块前台起 control（dag 形态）
mainboard -d /apollo/modules/control/control_component/dag/control.dag
# launch 形态
cyber_launch start /apollo/modules/control/control_component/launch/control.launch
cyber_launch stop  /apollo/modules/control/control_component/launch/control.launch

# 判定 conf/dag 真实落点（profile 还是 share）
readlink /apollo/modules/control/control_component/dag/control.dag
readlink /apollo/modules/control/control_component/conf/pipeline.pb.txt

# 看生效 pipeline 装了哪些 ControlTask
cat /apollo/modules/control/control_component/conf/pipeline.pb.txt

# 通道观测（cyber_channel -w 在本环境是坏的，勿用）
cyber_channel -l | grep -E 'control|chassis'
cyber_channel -e /apollo/control
```

## 7. 溯源

- 蒸馏日期：2026-09-08。基线：Apollo 11.0.0 package 工作区。
- 本文 `control_component.cc/h` 的行号均由本轮 read 打开核对（cc 43–139、324–520；h:53、150）；dag 全文 cat 核对；`readlink` 实测 conf/dag 落点。
- 引用自 P1 盘点表（`.manual_work/inventory/control_inventory.md`，其自身逐条标注了来源路径）而未在本文重复核对的：replan_control_task.cc `:85` 判定、pipeline 两版内容、8 条 plugins.xml 原文、safety Status 8 档、checkers.dag 挂载情况、118 条插件索引。
- 遗留待核：① `OnMonitor` 回调是否绑定 reader（Init 内未见 monitor reader）；② ~~三连字符 flag~~（已结案，见 §5）；③ SafetyDecision 发布侧源码（无源码可读）；④ 运行期 replan task 是否实例化；⑤ `ProduceControlCommand` 内部（controller 链调用细节）留给 `03_control_task框架与controllers清单.md`。
