# Apollo 调试参考

配套 `SKILL.md`。本文只放长知识：工具完整参数表与源码位置、monitor/safety_manager/external_command
的作用与触发链路、主链路 channel 速查、运行期高危坑清单。

## 1. 工具源码位置

> **⚠️ 本环境**：下表所有 `cyber/...` 相对路径的根是 **`/opt/apollo/neo/src/`**，不是 `/apollo`。
> `/apollo/cyber/` 在本环境只有 `conf/` 和 `examples/` 两个子目录，**没有 `tools/`、`mainboard/`**。
> 要头文件另看 `/opt/apollo/neo/include/cyber/`。本文后面所有 `cyber/xxx.cc:NN` 引用同此规则。
> 即：`sed -n '57,64p' /opt/apollo/neo/src/cyber/tools/cyber_monitor/main.cc`。

| 工具 | 语言 | 源码 |
|---|---|---|
| `cyber_monitor` | C++ / ncurses | `cyber/tools/cyber_monitor/main.cc` + `screen.{h,cc}` + 3 层 `RenderableMessage` |
| `cyber_recorder` | C++ | `cyber/tools/cyber_recorder/main.cc` + `recorder/` `player/` `recoverer/` `spliter/` `info/` |
| `cyber_channel` | Python optparse | `cyber/tools/cyber_channel/cyber_channel.py`（单文件） |
| `cyber_node` | Python optparse | `cyber/tools/cyber_node/cyber_node.py` |
| `cyber_service` | Python optparse | `cyber/tools/cyber_service/cyber_service.py` |
| `cyber_launch` | Python argparse | `cyber/tools/cyber_launch/cyber_launch.py` |
| `cyber_performance` | Python Flask | `cyber/tools/cyber_performance/cyber_performance.py` + `.launch` |
| `mainboard` | C++ | `cyber/mainboard/mainboard.cc` + `module_argument.{h,cc}` + `module_controller.{h,cc}` |

> **⚠️ 本环境**：PATH 与环境变量**不是** `cyber/setup.bash` 注入的（工作区里没有 `cyber/` 源码树），
> 而是 `/opt/apollo/neo/setup.sh`。现场核对的值：
>
> | 变量 | 值 | 行 |
> |---|---|---|
> | `APOLLO_PATH` / `APOLLO_ROOT_DIR` | `/apollo` | `:19-20,26-27` |
> | `CYBER_PATH` | `/apollo/cyber` | `:28` |
> | `CYBER_DOMAIN_ID` / `CYBER_IP` | `80` / `127.0.0.1` | `:31-32` |
> | `GLOG_log_dir` | `/apollo/data/log` | `:33` |
> | `GLOG_alsologtostderr` / `colorlogtostderr` / `minloglevel` / `max_log_size` | `0` / `1` / `0` / `500` | `:34-37` |
> | `sysmo_start` | `0` | `:38` |
> | `PYTHONPATH` | 前置 `/opt/apollo/neo/python` | `:75` |
> | `APOLLO_LIB_PATH` | **`/opt/apollo/neo/lib`**（整仓是 `/apollo/bazel-bin`） | `:79` |
> | `APOLLO_{CONF,FLAG,DAG,LAUNCH,RUNTIME}_PATH` | 全是 `/apollo` | `:80-84` |
> | `APOLLO_MODEL_PATH` | `/apollo/modules/perception/data/models` | `:85` |
> | `APOLLO_PLUGIN_INDEX_PATH` | `/opt/apollo/neo/share/cyber_plugin_index` | `:87` |
> | `APOLLO_PLUGIN_LIB_PATH` | = `APOLLO_LIB_PATH` | `:88` |
> | `APOLLO_PLUGIN_DESCRIPTION_PATH` | `/apollo_workspace:/opt/apollo/neo`（**冒号两段，工作区优先**） | `:89` |
>
> 注意 `APOLLO_{CONF,FLAG,DAG}_PATH` 都指向 `/apollo` —— 这就是为什么 dag 里
> `/apollo/modules/.../conf/x.conf` 能找到，以及为什么改 `/apollo/<src_path>/conf/*`
> （符号链接）立即生效。`GLOG_v` 本环境**未设**，要开 ADEBUG 得自己 `export GLOG_v=4`。

整仓形态下 PATH 注入与环境变量在 `cyber/setup.bash`：工具目录 `:8-28`、`CYBER_DOMAIN_ID=80` 与
`CYBER_IP=127.0.0.1` `:34-35`、`GLOG_*` `:37-40`、`sysmo_start=0` `:42`、`GLOG_v=4` 注释在 `:45`。
Tab 补全来自 `cyber/tools/cyber_tools_auto_complete.bash`（`setup.bash:47`）。

## 2. cyber_monitor 完整参数与交互

参数只有两个（`main.cc:57-64` 的 `printHelp` 与 `:75-99` 的 `ParseOption`）：`-h`、`-c <channel>`；
`argc > 4` 直接报 `TOO_MANY_PARAMETER`。交互键全表 `screen.cc:44-70`：

| 键 | 作用 |
|---|---|
| `q` / `Q` / `Esc` | 退出 |
| `h` / `H` | 帮助页 |
| `Backspace` | 返回上一级 |
| `PgDn` / `^d`、`PgUp` / `^u` | 翻页 |
| `↑` `↓` / `w` `s` | 上下移动一行 |
| `→` / `Enter` / `d` | 进入选中的 channel 或 repeated 字段 |
| `←` / `a` | 返回上层 |
| `f` / `F` | 显示所有 channel 的帧率 |
| `t` / `T` | 显示 channel 消息类型 |
| `Space` | 启用/停用该 channel 的消息显示 |

扩展 cyber_monitor 时：新增 `.cc/.h` 必须**显式**加进 `cyber/tools/cyber_monitor/BUILD:9-23` 的
`srcs`（该 target 没用 glob），deps 为 `//cyber` 与 `@ncurses5`。

## 3. cyber_recorder 完整参数

option 串（`main.cc:49-53`）—— 这就是每个子命令**接受哪些参数**的权威来源：

| 子命令 | option 串 |
|---|---|
| `info` | `h` |
| `record` | `o:ac:k:i:m:hCH` |
| `play` | `f:ac:k:lr:b:e:s:d:p:h` |
| `split` | `f:o:c:k:b:e:h` |
| `recover` | `f:o:h` |

参数语义（`main.cc:96-170`）：

| 参数 | 含义 |
|---|---|
| `-f, --file <file>` | 输入 record（record 子命令不接受 `-f`） |
| `-o, --output <file>` | 输出 record |
| `-a, --all` | 全部 channel |
| `-c, --white-channel <name>` | 白名单，可重复 |
| `-k, --black-channel <name>` | 黑名单，可重复 |
| `-l, --loop` | 循环回放 |
| `-r, --rate <1.0>` | 倍速 |
| `-b, --begin 2018-07-01-00:00:00` / `-e, --end` | 绝对时间窗 |
| `-s, --start <seconds>` | 从第 n 秒开始 |
| `-d, --delay <seconds>` | 延迟 n 秒开始 |
| `-p, --preload <seconds>` | 预载 n 秒 |
| `-i, --segment-interval <seconds>` | 按时间切段 |
| `-m, --segment-size <MB>` | 按大小切段 |
| `-H, --heap-profile` / `-C, --cpu-profile` | gperftools |

默认输出名：`record` 不给 `-o` → `<YYYYmmddHHMMSS>.record`（`:442-445`）；
`recover` → `<in>.recover`（`:398-400`）；`split` → `<in>.split`（`:497-499`）。

行为要点：
- `Recorder::Start()`（`recorder.cc:49-106`）会**把 channel 名当正则编译**（`:59-79`）；
  `std::regex_error` 被静默吞掉（`:73-75`）→ 名字不是合法正则时只剩精确匹配且无提示。
  白/黑名单有交集时 AERROR 并 return false（`:50-57`）。
- 录制时会显式 `WriteChannel(name, type, desc)`（`recorder.cc:186-190`），把 proto descriptor
  写进包 —— 这是回放端能反射解析的前提。用 `RecordWriter` 手写 RawMessage 时不显式写
  Channel 段，产出的包无法被 `echo`/DV 解析。
- `play` 跳过 `is_complete()==false` 的文件（`play_task_producer.cc:119-122`），并把包里的
  `proto_desc` 注册进 `ProtobufFactory`（`:144-145`）。总会额外创建
  `/apollo/cyber/record_info` 的 writer（`:273-274`）。
- 文件写入是纯 POSIX 顺序 IO，无 mmap/fallocate；`open` 没有 `O_TRUNC`
  （`record_file_writer.cc:48-49`）→ 覆盖较大旧文件会留残余字节，`ls` 大小可能 > `header.size`。

## 4. cyber_channel / cyber_node / cyber_service 参数

`cyber_channel <cmd> -h` 看单命令用法（分发在 `cyber_channel.py:396-415`）。

| 命令 | 函数 | 额外参数 |
|---|---|---|
| `list` | `_channel_cmd_list`（`:319`） | — |
| `info <ch>` | `_channel_cmd_info`（`:288`） | `-a/--all` |
| `echo <ch>` | `_channel_cmd_echo`（`:362`） | — |
| `hz <ch>` | `_channel_cmd_hz`（`:216`） | `-w/--window`（**default=-1**，`:225`；实际生效窗口 **50000**，`:156-158`）**⚠️ 传 `-w` 必报错，见下** |
| `bw <ch>` | `_channel_cmd_bw`（`:109`） | `-w/--window`（**default=-1**，`:118`；实际生效窗口 **100**，`:55-56`）**⚠️ 同上** |
| `type <ch>` | `_channel_cmd_type`（`:31`） | — |

> **`-w` 是坏的（现场实测 `cyber_channel hz /apollo/planning -w 100` → 直接退出）**：
> `:240`（hz）与 `:133`（bw）用 `string.atoi(options.window_size)`，Python 3 的 `string` 模块
> **没有 `atoi`**（Py2 遗留），抛异常被裸 `except` 吞掉 → `parser.error("window size must be an integer")`。
> 所以**只能不带 `-w` 用默认值**。默认 `-1` 走 `window_size <= 0` 兜底分支：
> `hz` → 50000（`:156-158`）、`bw` → 100（`:55-56`），启动时会把实际窗口 print 出来，可据此确认。
> 想要短窗口只能改源码（`/opt/apollo/neo/src/cyber/tools/cyber_channel/cyber_channel.py`，
> 把 `string.atoi(x)` 换成 `int(x)`）—— 注意那是源码树，改完要 `buildtool build` 才影响
> `/opt/apollo/neo/bin` 里的实际命令。

`cyber_node list`（`cyber_node.py:88`）、`cyber_node info [OPTION...] [NODE...]`（`:54`，`-a/--all`）；
`cyber_service list`（`cyber_service.py:74`）、`cyber_service info <servicename>`（`:41`，`-a/--all`）。

**这三个工具走的是不同的发现层**：channel/node 走 `ChannelManager`/`NodeManager`，
`cyber_service` 走 `ServiceManager` —— **channel 视角看不到任何 service 流量**，
排查 external_command 必须用 `cyber_service`。

## 5. cyber_launch：launch 标签语义

| 标签 | 语义 |
|---|---|
| `<module>` | 一个进程。多个 `<module>` = 多个独立进程 |
| `<dag_conf>` | 可重复；同一 module 内多条 = 单进程加载多 dag（共享 scheduler、进程内 INTRA 零拷贝） |
| `<process_name>` | mainboard 的 `-p`；`<type>binary</type>` 时它被当作命令行直接执行（`:451,467-473`） |
| `<type>` | `library`（默认，走 mainboard）/ `binary` |
| `<sched_name>` | mainboard 的 `-s`（实际无效，见坑表） |
| `<exception_handler>` | `respawn` 崩溃重启 / `exit`（`:333-341`） |
| `<respawn_limit>` | 默认 3（`:37,458-462`） |

没有 `<dag_conf>` 的 module 会报 `library dag conf is null` 并跳过（`:477-479`）——
`modules/calibration/data/mkz_lgsvl_321/` 下 3 个 ROS 遗留 launch 就是这种。
`stop` 的强杀超时 `force_stop_timeout_secs = 3`（`:40,379`）。

## 6. mainboard 参数全表（`module_argument.cc:32-58`）

| 参数 | 说明 |
|---|---|
| `-h, --help` | 帮助 |
| `-d, --dag_conf=FILE` | dag 文件，可重复；**为空直接报错**（`:181`） |
| `-p, --process_group=NAME` | 进程组；缺省 `DEFAULT_process_group_`（`:64-66`）。**决定调度 conf 与日志兜底模块名** |
| `-s, --sched_name=NAME` | 调度策略名，须在 `cyber.pb.conf` 中存在（`:39-40`） |
| `--plugin=FILE` | 插件描述文件 |
| `--disable_plugin_autoload` | 关闭插件自动加载 |
| `-c, --cpuprofile` | gperftools CPU profile |
| `-o, --profile_filename=F` | 默认 `${process_group}_cpu.prof`（`:45-48`） |
| `-H, --heapprofile` | heap profile |
| `-O, --heapprofile_filename=F` | 默认 `${process_group}_mem.prof` |

`cyber.pb.conf`（`cyber/conf/cyber.pb.conf`）现状：`communication_mode` = INTRA/SHM/RTPS，
`run_mode: MODE_REALITY` + `clock_mode: MODE_CYBER`，`scheduler_conf { routine_num: 100
default_proc_num: 16 }`，arena 段只给 `/apollo/msg` 配了 32MB / 32 池。

## 7. monitor / safety_manager / external_command 的作用与触发链路

### 7.1 monitor
`modules/monitor/dag/monitor.dag:3-9`：TimerComponent，`interval: 500`（ms）。
`Monitor::Init()`（`modules/monitor/monitor.cc:40-75`）按固定顺序注册 runner，
`Proc()`（`:77-88`）每周期 `StartFrame` → 依次 `Tick` → `EndFrame`。
`RecurrentRunner::Tick()`（`modules/monitor/common/recurrent_runner.cc:27-37`）是节流器，
各 monitor 有自己的周期；唯一例外是 `ProcessMonitor` 且 `detect_immediately()` 为真时每周期都跑。

监控项：`ProcessMonitor`（1.5s，读 `/proc/*/cmdline` 做**全部 `command_keywords` 子串 AND 匹配**）、
`ModuleMonitor`（按 cyber node 名）、`ChannelMonitor`（5s；延迟 > `delay_fatal` 默认 3.0s → FATAL，
`mandatory_fields` 缺失 → ERROR，频率越界 → WARN）、`LatencyMonitor`（1.5s，发
`FLAGS_latency_reporting_topic` = `/apollo/common/latency_reports`，`adapter_gflags.cc:272`）、
`ResourceMonitor`（5s，磁盘/CPU/内存/IO）、`GpsMonitor`（3s，看 `sol_type`）、
`LocalizationMonitor`（5s）、`CameraMonitor`（5s）、`EsdCanMonitor`/`SocketCanMonitor`（3s）、
`SummaryMonitor`、`FunctionalSafetyMonitor`（每周期）。`RecorderMonitor` **实现了但未注册，死代码**。

上报链路：`SummaryMonitor::RunOnce()`（`modules/monitor/software/summary_monitor.cc:51-99`）用
`EscalateStatus()` 把每个 component 的 5 个细分状态归并成最严重的 `summary`（`:33-45,55-68`），
序列化取 hash 当指纹（**不能改回 `DebugString()`**，map 字段有已知 bug，`:81-82`）；指纹变了或
超过 `FLAGS_system_status_publish_interval`（默认 1s）才发 `/apollo/monitor/system_status`
（`modules/common/adapters/adapter_gflags.cc:142`）。
`ComponentStatus.Status` 数值顺序有意义：`UNKNOWN=0 < OK=1 < WARN=2 < ERROR=3 < FATAL=4`
（`modules/common_msgs/monitor_msgs/system_status.proto:11-17`）。

monitor 与 dreamview 互为读写对端：DV 发 HMIStatus 告知当前模式，monitor 发 SystemStatus 告知模块状态。

### 7.2 故障 → 刹停的完整时序（**guardian 已删除，链路已变**）

> **⚠️ 本环境**：`modules/guardian/` 整个模块**不存在**（src/ 与 include/ 两棵树都核对过）。
> 只剩两处残迹：消息 `modules/common_msgs/guardian_msgs/guardian.proto`，以及 canbus 里完整保留的
> guardian 消费侧代码（`canbus_component.cc:76-78` 建 `FLAGS_guardian_topic` reader，conf 里
> `--noreceive_guardian`、`--use_guardian_cmd_check=false`）—— **通道还在、发布者没了**。
> 取代它的是 `modules/safety_manager/checker/`，见下方 7.2.2。

**7.2.1 monitor 侧（这部分不变，已重新核对）**
`FunctionalSafetyMonitor`（`modules/monitor/software/functional_safety_monitor.cc`）：
不在自动驾驶直接返回 safe（`CheckSafety()` 开头 `IsInAutonomousMode()` 判断）→ 遍历 `modules` 与
`monitored_components`，`required_for_safety`（**默认 true**）的组件 ERROR/FATAL 即不安全
（`IsSafe()` `:34-44`）→ 安全时清掉 `passenger_msg`/`safety_mode_trigger_time`/`require_emergency_stop`
→ 首次不安全时设 `passenger_msg="Error! Please disengage."` + `safety_mode_trigger_time`（`:64-68`）→
超过 `FLAGS_safety_mode_seconds_before_estop`（**默认 10.0**，定义在 `:27-29`）才置
`require_emergency_stop`（`:71-75`）。日志关键字 `triggers safe mode`（`:37-38`）。
即：**故障 → 提示接管 → 10 秒内无人接管 → 置 require_emergency_stop**。
这些字段都在 `SystemStatus`（`modules/common_msgs/monitor_msgs/system_status.proto`）里，
**注意 monitor 自己不发控制指令**，它只改 SystemStatus。

**7.2.2 safety_manager 侧（本环境的新兜底）**
包 `safety-checkers`，运行期 dag `/apollo/modules/safety_manager/checker/dag/checkers.dag`，
**一个 dag 里 9 个 Component**（`lib/modules/safety_manager/checker/` 下装了 10 个，
`file_exist_checker` 没挂进 dag）：`channel_freq` / `collision`(timer 1000) / `control`(timer 100) /
`latency`(reader `/apollo/statistics/latency`) / `localization`(timer 200) / `localization_shake`
(readers pose + chassis) / `process`(timer 205) / `resource`(reader `/apollo/statistics/resources`) /
`swing`(timer 1000)。完整表见 `apollo-architecture/SKILL.md` 第七节。

契约 `modules/safety_manager_msgs/safety_manager.proto`：`SafetyStatus.Status` **8 档**
（`OK / WARN_PENDING / ERROR_PENDING / FATAL_PENDING / WARN / ERROR / FATAL / WAIT_REMOVED`，
proto 注释里写明 `WARN` 只报警、`ERROR` 舒适刹停、`FATAL` 紧急刹停）；`SafetyRule{timeout, duration,
filter, fault_removed_secs=5}` + `Filter{required_cycles, total_cycles}` 决定 `*_PENDING` 什么时候转实；
`Matcher` 六种匹配（name 全等 / contains / prefix / regex / tags_contains_one / tags_contains_many）；
决策 `SafetyDecision{safety_mode_trigger_time, require_emergency_stop}` 发到 **`/apollo/safety/decision`**。

**7.2.3 控制侧怎么消费**（已现场核对 `replan_control_task.cc`）
`ReplanControlTask::Init` 用 `replan_task_conf_.guardian_decision_topic()`（默认值就是
`/apollo/safety/decision`，`proto/replan_task_conf.proto:6`；字段名仍叫 guardian，是历史残留）建
`Reader<SafetyDecision>`（`:47-51`，**回调传 nullptr**，靠 `ComputeControlCommand` 里
`Observe()`+`GetLatestObserved()` 主动拉，`:78-83`）。
判定是 `decision_.has_safety_mode_trigger_time()`（`:85`）—— **判字段存在性而不是值**，
一旦存在就置 `replan_request=true`、reason code `REPLAN_REQ_ALL_REPLAN`。
另一条独立触发是 `chassis->error_code() == Chassis::CMD_NOT_IN_PERIOD`（`:94`）。
结果写进 `injector_->mutable_control_interactive_info()` 的 `replan_request` 发给 planning，
**它本身不改 throttle/brake** —— 也就是说：新链路里 safety 触发的是**重规划请求**，
不再是 guardian 那种直接改写控制量的透传拦截器。

**没有 gflag**：`grep -n safety modules/common/adapters/adapter_gflags.cc` **无命中**，
`/apollo/safety/decision` 这个名字写死在 proto default 与各 conf 里，改名要逐处搜。

### 7.3 external_command
外部用 **cyber Service（同步 RPC）** 发命令 → `ExternalCommandProcessComponent` 加载的
CommandProcessor 插件 → 转成 `PlanningCommand` / `PadMessage` / `ChassisCommand` 内部 topic。
**入口是 Service 不是 Topic**，必须 `create_client(...).send_request(...)`（Python）或
`node->CreateClient<...>`（C++）。9 个命令 proto 在 `modules/common_msgs/external_command_msgs/`：
`LaneFollowCommand`（必填 `end_pose`）、`ValetParkingCommand`（`parking_spot_id`）、`ActionCommand`、
`FreeSpaceCommand`、`PathFollowCommand`、`SpeedCommand`、`ZoneCoverCommand`、
`PreciseParkingCommand`、`ChassisCommand`，加状态回执 `CommandStatus`
（`RUNNING/FINISHED/ERROR/UNKNOWN`）。`RoiPolygon` 点序有含义：逆时针 = 可行驶，顺时针 = 禁行。

`/apollo/modules/external_command/process_component/conf/config.pb.txt`
**本环境现场核对：注册 5 个**（不是旧版的 3 个）——
`LaneFollowCommandProcessor` / `ValetParkingCommandProcessor` / `ActionCommandProcessor` /
`ZoneCoverCommandProcessor` / `FreeSpaceCommandProcessor`，外加第一行
`output_command_status_name: "/apollo/external_command/command_status"`。
**已装但没注册的 4 个**：`ChassisCommandProcessor`、`PathFollowCommandProcessor`、
`PreciseParkingCommandProcessor`、`SpeedCommandProcessor`
（`lib/modules/external_command/command_processor/` 下 9 个 processor + 1 个 base 都在，
`share/cyber_plugin_index/` 里也都有对应条目）—— 想用就把类名加进 `config.pb.txt` 重启，
**不需要重新编译**。
类名到 `.so` 的映射来自各 processor 目录的 `plugins.xml`，
`PluginManager::CreateInstance<CommandProcessorBase>(class_name)` 按类名字符串实例化
（`external_command_process_component.cc:36-48`）。routing 是 external_command **进程内**的库对象
（`motion_command_processor_base.h:121,151`）—— 不要去找 routing 进程。

三种下发方式（**本环境路径已现场核对存在**）：
```bash
cyber_launch start /apollo/modules/external_command/external_command_demo/launch/external_command_demo.launch
#   键盘敲 lane / valet_parking / free1 / pull_over / stop / start / manual / auto / set_speed 1.5 / command_status=123
#   同目录另有 external_command_wrapper_demo.launch
planning_command                       # 本环境是裸命令，不是 python3 modules/tools/...
cyber_launch start /apollo/modules/external_command/process_component/launch/external_command_with_old_routing.launch
#   同目录另有 external_command_process.launch（不带 old routing 的常规入口）
#   老 routing 适配器单独在 /apollo/modules/external_command/old_routing_adapter/launch/
```
Dreamview 的自动驾驶开关也走这条门：`hmi_worker.cc:218` 建 ActionCommand client，
`:506-515` 用 `SWITCH_TO_MANUAL` / `SWITCH_TO_AUTO`。

## 8. 主链路 channel 速查

全部来自 `modules/common/adapters/adapter_gflags.cc`（行号即定义处）。

| channel | gflag | 行 |
|---|---|---|
| `/apollo/canbus/chassis` | `chassis_topic` | 27 |
| `/apollo/localization/pose` | `localization_topic` | 35 |
| `/apollo/planning` | `planning_trajectory_topic` | 39 |
| `/apollo/planning/command` | `planning_command` | 41 |
| `/apollo/planning/command_status` | `planning_command_status` | 43 |
| `/apollo/monitor` | `monitor_topic` | 45 |
| `/apollo/control/pad` | `pad_topic` | 46 |
| `/apollo/control` | `control_command_topic` | 48 |
| `/apollo/control/localview` | `control_local_view_topic` | 55 |
| `/apollo/control/controlcore` | `control_core_command_topic` | 57 |
| `/apollo/sensor/lidar128/compensator/PointCloud2` | `pointcloud_topic` | 60 |
| `/apollo/sensor/lidar16/compensator/PointCloud2` | `pointcloud_16_topic` | 63 |
| `/apollo/prediction` | `prediction_topic` | 117 |
| `/apollo/perception/obstacles` | `perception_obstacle_topic` | 120 |
| `/apollo/drive_event` | `drive_event_topic` | 122 |
| `/apollo/perception/traffic_light` | `traffic_light_detection_topic` | 124 |
| `/apollo/routing_response` | `routing_response_topic` | 129 |
| `/apollo/monitor/system_status` | `system_status_topic` | 142 |
| `/apollo/guardian` | `guardian_topic` | 257 |（gflag 仍在，**本环境无发布者**，`modules/guardian/` 已删除）
| `/apollo/sensor/gnss/odometry` | `gps_topic` | 22 |
| `/apollo/sensor/gnss/corrected_imu` | `imu_topic` | 23 |
| `/tf` / `/tf_static` | `tf_topic` / `tf_static_topic` | 266-267 |
| `/apollo/common/latency_records` / `latency_reports` | `latency_recording_topic` / `latency_reporting_topic` | 270,272 |
| `/apollo/data/recorder/status` | `recorder_status_topic` | 268 |
| `/apollo/task_manager` | `task_topic` | 274 |（gflag 仍在，**本环境无 `modules/task_manager`**）
| `/apollo/safety/decision` | **无 gflag** | 写死在 `safety_manager.proto` default 与 `controller_conf.pb.txt:1` |

另外：`/apollo/cyber/record_info`（回放时由 player 创建）；`/clock`（sim 模式时钟）；
perception 内部 `/perception/inner/*`（结构体指针，**不序列化、工具看不到**），
其中 `/perception/inner/PrefusedObjects` 是 msg_adapter 默认接的那一路。
`/apollo/external_command/*` 是 **Service** 而非 channel。

## 9. 运行期高危坑清单

**通信 / 数据**
1. `pending_queue_size` 默认 1（`cyber/node/reader.h:50`）；恰好覆盖一整圈时判定不成立 → **静默丢一圈无日志**。
2. AllLatest 冷启动期任一副 channel 从未收消息 → 所有主路帧丢弃且**无任何日志**（`all_latest.h:60-63`）。
3. 副 channel 不唤醒协程（`data_visitor.h:63/105/143` 只 AddNotifier m0）。
4. channel 无 buffer 时 Dispatch 静默 false（`data_dispatcher.h:87`）→ Writer 早于 Reader 时前几帧丢失。
5. 跨机判定用 `host_ip` 不是 `host_name`（`hybrid_transmitter.h:315`），手工构造 attr 漏填 → 跨机永久失效。
6. `channel_id` = `std::hash<std::string>`（`cyber/common/util.h:27-29`），**跨编译器/stdlib 不稳定**，
   却直接当 SysV `key_t` 与 posix shm 名用。日志出现 `hash collision` 必须当严重问题查。
7. shm 消息档位最大 **32MB**（`shm_conf.cc:63` `MESSAGE_SIZE_MORE`，`:77-79` 把一切 >16MB 都归到这一档，
   没有更大档位）。超过时**既不截断也不拒绝也不报错**：`segment.cc:53-57` 发现超限 → `Recreate(msg_size)`
   （`:286-293`）→ `shm_conf.cc:30-37` 的 `Update` 又算回 32MB，**之后没有二次校验**，
   `shm_transmitter.h:292-303` 直接 `SerializeToArray` 往 32MB block 里写 → **越界写坏共享内存，零日志**。
8. **共享内存残留**：只在引用计数归零时 `Remove()`（`segment.cc:265-268`）。进程崩溃后段残留在
   `ipcs -m` / `/dev/shm`；崩溃的写者会留下 `lock_num_ == -1` 的永久写锁 block，
   此时 `GetNextWritableBlockIndex` 的 `while(1)`（`segment.cc:297`）挂死。`ConditionNotifier`
   的段**从不移除**（`condition_notifier.cc:48-55` 只 detach）。
9. `shm_type: "posix"` 有明确 bug（`posix_segment.cc:254` 循环变量写错，失败分支 `shm_unlink`
   会让一个失败的读者摧毁发布者的 segment）—— 开启前必须先修。arena 零拷贝同样是未完成状态。
10. 同名 node 会让「后注册」那一方自杀（`node_manager.cc:99-105` 给自己发 SIGINT），
    判据是 `timestamp_ns` → 跨机时钟不同步时不确定。用 `node_name + pid` 唯一化可规避。

**调度 / 生命周期**
11. `-s/--sched_name` **完全无效**，`GlobalData::SchedName()` 无调用点；策略只由 `-p` 决定。
12. 调度 conf 字段名写错 → 整份静默失效、回落 classic（`scheduler_factory.cc:60-65` 只 AWARN）。
    现成反例 `cyber/conf/control_sched_choreography.conf:5` 写 `processor_num` 而非 `choreography_processor_num`。
13. classic group / task 名写错 → 落 `groups(0)` 且 prio=0（`scheduler_classic.cc:139-142`）。
    核对方法：启动日志 `create croutine: <name>`（`scheduler.cc:55`）打印的是真名。
14. `MAX_PRIO = 20`，有效 0..19，≥20 被钳到 19 + AWARN；choreo 分支**不钳**，语义不一致。
15. cpuset 语法错误 = **静默 `exit(0)`**（`pin_thread.cc:45-48`，日志还是 ADEBUG）。合法只有
    `"3"` / `"0-7"` / `"0-7,16-23"`。
16. `SCHED_OTHER` 的 `prio` 是 nice（越小越优先），FIFO/RR 是 1..99（越大越优先），**方向相反**。
17. 协程栈 2MB 无 guard page（**`cyber/croutine/detail/routine_context.h:34` 的 `STACK_SIZE`，`:43` 是
    结构体内联数组** —— 注意是 `detail/` 子目录；context 来自 `CCObjectPool` 或裸 `new`（`croutine.cc:54-61`），
    纯堆分配，全环境 `grep -rn "mprotect\|guard" cyber/croutine/` 零命中）→ 大数组/深递归/大 Eigen 局部量
    踩坏**相邻堆内存**，表现为随机、跨模块、不可复现的崩溃。
18. 协程池耗尽只 AWARN 后裸 `new`（`croutine.cc:58-62`）。看到 "Maximum routine context number
    exceeded" 就调大 `cyber.pb.conf` 的 `routine_num`（当前 100）。**一个 Component 占两个协程**。
19. `Processor::Stop()` 会 join（`processor.cc:74-76`）→ 不 Yield 的 `Proc()` 让进程永久无法退出。
20. `TimerComponent` 用 shared_ptr 自捕获形成引用环（`timer_component.cc:53-55`），不显式
    `Shutdown()` 就永久泄漏，且 `Proc()` 会在逻辑已废弃的对象上继续跑。
21. dag 把普通 component 写进 `timer_components{}` 段（或反之）→ 命中基类默认 `return false`，
    日志只有 "Failed to load module"，不提示放错段。
22. `readers_size()` 只查下限 → 给 2 路 component 配 3 个 reader 不报错，第 3 个被静默忽略。
23. 同进程多个 component 的 `flag_file_path` 互相覆盖（gflags 进程级）。

**日志**
24. 日志目录不存在 → `perror("Could not create log file")` 后**静默丢失全部日志**。
25. `AsyncLogger` 无容量上限（与类注释不符）→ 日志洪峰无界增长内存。
26. `_exit()`/`abort()`/`SIGKILL` 不触发 atexit → 异步缓冲全丢。
27. `Failed to parse file ... as text proto` 常是正常噪声（`GetProtoFromFile` 先试 ASCII 再试 binary）。

**external_command**
28. **4 个 processor 有完整实现却未注册**（本环境现场核对：lib 与插件索引里都有 9 个，
    `process_component/conf/config.pb.txt` 只注册 5 个 —— 未注册的是 `Chassis`、`PathFollow`、
    `PreciseParking`、`Speed`）—— 「命令发出去没反应」头号原因。**加类名重启即可，不用重编。**
29. header 时间戳距今 **> 2.0s 直接丢弃且不回状态**（`motion_command_processor_base.h:215-219`、
    `action_command_processor.cc:168-172`）。必须填 `timestamp_sec`。
30. `ActionCommand` 的 `FOLLOW`/`CHANGE_LEFT`/`CHANGE_RIGHT` 状态查询恒返回 ERROR（标了 todo）；
    `START` 永远不会返回 FINISHED（`:131-136` 先设 FINISHED 又无条件设回 RUNNING）；
    `START` 实际对应 `PadMessage::RESUME_CRUISE`（`:224`）。
31. `SWITCH_TO_AUTO` 会先强切 MANUAL，最坏 3s 同步阻塞。
32. Action processor 的 3 个 `input_command_status_name` **按下标取用**，conf 顺序不能换。
33. processor 的 conf 路径由**类名**推导（`command_processor_base.cc:46-49`），改类名/挪目录后
    报错含糊（"Cannot get config of ..."）。
34. PlanningCommand writer QoS 是 `TRANSIENT_LOCAL` → 晚启动的 planning 收到历史命令。
35. `/apollo/routing_response` 只用于 HMI 显示；planning 用 `PlanningCommand.lane_follow_command`。

**monitor / safety_manager**（原 41-44 条是 guardian 专属，**本环境 `modules/guardian/` 已删除，整组作废**，替换如下）
36. **收不到 HMIStatus 就整帧不检查**（`monitor_manager.cc:53-55`，`hmi_status == nullptr` → AERROR +
    `StartFrame` 返回 false）→ dreamview 没起 = monitor 瘫痪。
    且 monitor 构造时就加载 DV 的 HMI 配置（`:36` 的 `HMIUtil::LoadConfig()`，读
    `/apollo/modules/dreamview{,_plus}/conf/hmi_modes/` 两个目录，本环境 20 + 4 个 `.pb.txt`），
    末尾是 `ACHECK(!config.modes().empty())`（`hmi_util.cc:91`）—— **配置目录空 monitor 直接 crash**。
37. `ChannelMonitor` 只认写死表里的 channel 类型（`channel_monitor.cc:73-105`，14 条），表外
    `:107-113` 查不到即 AERROR + 返回 `{nullptr,nullptr}`，`:180-186` 置 UNKNOWN
    （日志 `... is not registered in ChannelMonitor.`）。
38. `LocalizationMonitor` 把 `MeasureState::ERROR`（`localization_monitor.cc:80`）**降级**成
    `ComponentStatus::WARN`（`:82`）—— 而按 `:68-69` 的注释只有 ERROR/FATAL 才触发 safety mode，
    **这个降级等于屏蔽了安全模式**。对比 `CRITICAL_ERROR`→ERROR（`:85-89`）、`FATAL_ERROR`→FATAL（`:91-95`）。
39. GpsMonitor / LocalizationMonitor / CameraMonitor 必须在模式 `monitored_components` 里有对应 key 才生效。
40. **`required_for_safety` 默认 true**（`hmi_mode.proto` **三处**：`:95` `MonitoredComponent`、
    `:111` `Module`、`:117` `CyberModule`）—— 新加 monitored_component 不显式
    写 false 等于给车加了一个刹停开关。
41. **monitor 只改 SystemStatus，不发控制量**。它置 `safety_mode_trigger_time` 后要等
    `FLAGS_safety_mode_seconds_before_estop`（默认 **10.0**，`functional_safety_monitor.cc:27-29`）
    才置 `require_emergency_stop`。**这 10 秒是唯一缓冲**，调试时别 kill monitor —— 杀了它
    SystemStatus 不再更新，下游按最后一帧状态跑。
42. **`replan_control_task` 判的是字段存在性不是值**（`replan_control_task.cc:85`
    `decision_.has_safety_mode_trigger_time()`）→ `/apollo/safety/decision` 上只要来过一帧带该字段的
    消息，就无条件请求全量重规划（`REPLAN_REQ_ALL_REPLAN`），表现为「车莫名反复重规划」。
    另一条同效触发是 `chassis->error_code() == CMD_NOT_IN_PERIOD`（`:94`）。
43. **safety_manager 的 9 个 checker 挤在一个 dag 里**（`checker/dag/checkers.dag`），
    任一 checker 的 `Matcher`（name/contains/prefix/regex/tags_*）写太宽 → 大面积误报
    → `ERROR`=舒适刹停、`FATAL`=紧急刹停（`safety_manager.proto` 注释）。改 conf 前先看
    `Filter{required_cycles,total_cycles}`，`*_PENDING` 转实靠它。
44. `latency_checker` / `resource_checker` 分别读 `/apollo/statistics/latency` 与
    `/apollo/statistics/resources` —— **statistics 模块没起，这两个 checker 就永远沉默**
    （不是"没问题"，是"没数据"）。同理别随手 kill statistics。
    另注：`lib/` 下装了 **10** 个 checker，`file_exist_checker` **没挂进 dag**，改它无效。

**dag / launch 路径**
45. control 子模块 dag 的库路径与 flag 路径都过时（**本环境现场复核仍然如此**）：
    `/apollo/modules/control/control_component/dag/lateral_longitudinal_module.dag:2` 写
    `modules/control/libcontrol_component.so`，实际在 `modules/control/control_component/`；
    flag 同病。`mpc_module.dag` 一样。**这两个 dag 直接跑会加载失败。**
    `control_lateral_longitudinal_control.launch:4` / `control_mpc_control.launch:4` 指向的
    `/apollo/modules/control/dag/*.dag` 也不存在（现场 `ls` 确认该目录无）。
    唯一能跑的是 `control_component/dag/control.dag`（路径正确）+ `control.launch`。
    另外 `mpc_module.dag` 双重作废：**本环境 `controllers/` 只装了 7 个**
    （`lat_based_lqr[_plus]_controller`、`lon_based_pid[_plus]_controller`、
    `replan_control_task`、`slope_anti_slip_control_task`、`debug_info_control_task`），
    **没有 mpc_controller**。
46. **孤儿 dag（本环境现场重算）**：`/apollo/modules/` 下共 **114 个 `.dag`**，被 launch 的 `<dag_conf>`
    与两个 `hmi_modes/` 目录的 `dag_files` 引用的去重后 **96** 条，**按精确路径算孤儿 35 个**
    （按 basename 宽松匹配 32 个）。只能手动 `mainboard -d` 跑。成片的孤儿是
    **`safety_manager/checker/*`（11 个）与 `statistics/*`（3 个）—— 在整个 `modules/` 下搜不到任何引用**；
    `control_component/dag/{lateral_longitudinal_module,mpc_module}.dag` 是被 launch 用旧路径引用（见第 45 条），
    属路径失配不算真孤儿。
    **反过来还有 17 条悬空引用**：launch / HMI mode 里写的 dag 路径在本环境不存在，包括
    `perception/production/dag/dag_streaming_perception*.dag`（4 条，`production/` 目录已无）、
    `guardian/`、`task_manager/`、`audio/`、`third_party_perception/`、`drivers/{video,microphone,smartereye,velodyne,lidar,lidar/hesai}`、
    `control/dag/{lateral_longitudinal_module,mpc_module}.dag`、`drivers/camera/dag/dev_kit_camera.dag`。
    **这 17 条是「按 launch 起不来」的直接原因，比孤儿 dag 更常踩。**
47. `/apollo/perception/obstacles` 有多个潜在写者（`multi_sensor_fusion`、`lidar_output`、
    `camera_detection_bev`、`camera_detection_occupancy`、`msg_adapter`；**`third_party_perception`
    本环境已删除**，`msg_adapter` 则**已完整装好可直接跑**，见 SKILL.md §6），同时启动会互相覆盖。
    选感知方案时必须确认只有一个生效。
48. dag 里路径全是 `/apollo/...` 绝对路径，换根目录必须靠 `APOLLO_CONF_PATH` / `APOLLO_FLAG_PATH`
    （`cyber/component/component_base.h:74-75,85-86`）。

**dreamview（影响调试观察）**
49. ~~dv 与 dv_plus 都取 8888 端口~~ —— **本环境核对不成立，两者端口不同不会抢**：
    `dreamview_gflags.cc:33` `DEFINE_string(server_ports, "8899", ...)`（`:36-37` 注释原文
    "Dreamview always use 8899 and Dreamview Plus always use 8888"），两个二进制共用这一份 gflags；
    `dreamview_plus/conf/dreamview.conf:8` 写 `--server_ports=8888`，而
    `dreamview/conf/dreamview.conf` **没有** `--server_ports`（只有一行 `--flagfile`），走默认 8899。
    所以 **dv=8899 / dv_plus=8888，可以同时起**。
50. 切车型是**文件覆盖拷贝**，会静默改写 `modules/*/conf/` 下手改过的工作副本
    （`vehicle_manager.cc:59-66`，失败只 `AINFO_IF`、不 AERROR、不 return false，
    `UseVehicleUseCopyMode` 恒返回 true（`:72`））—— 最隐蔽的「配置怎么变回去了」来源。
    **拷贝模式是默认**（`dreamview_gflags.cc:175` `vehicle_changed_use_copy_mode` 默认 true，
    两份 dreamview.conf 里都把它注掉了）；非拷贝分支走 `aem profile use`（`:75-95`）。
    本环境额外一坑：`dreamview/conf/vehicle_data.pb.txt` 里 **53 个 dest_path 有 25 个根本不存在**
    （`modules/control/conf/` 整个目录都没有，11.0 已迁到 `control/control_component/conf/`；
    还有 `perception/production/*`、`teleop/*`、`audio/*`、`drivers/video/*`），这些**全部静默跳过**。
51. `SetGlobalFlag` 是**追加**写 `modules/common/data/global_flagfile.txt`（切地图触发，
    `dreamview_plus/backend/hmi/hmi_worker.cc:81-93`，`:89` 是 `std::ios_base::app`，
    注释写 "Overwrite" 但实际 append；旧 DV 同实现在 `dreamview/backend/hmi/hmi_worker.cc:69-81`），
    该文件被几乎所有模块 `--flagfile` 引用，现仓库已有 **3 行 `--map_dir`**（`:14` sunnyvale_loop、
    `:20` sunnyvale、`:22` sunnyvale_big_loop），**gflags 严格按序求值 → 实际生效的是最后一行**。
    注意该文件本身是指向 `/opt/apollo/neo/share/modules/common/data/global_flagfile.txt` 的符号链接，
    **追加写会直接改到安装产物里**。
52. record 回放面板 LRU 上限 15 个包（`record_player_factory.h:58` `LOADED_RECORD_NUM`，
    `:57` 另有 `PRELOAD_RECORD_NUM = 3`；淘汰逻辑 `.cc:127-129` + `:145-165`，跳过 `current_record_`
    从队首淘汰）且屏蔽 3 个 channel（`.cc:70-72`：`/apollo/hmi/status`、
    `/apollo/monitor/system_status`、`/apollo/cyber/record_info`）。
53. 前端 `dist/` 是提交进仓库的产物，改 TS 不 `yarn web:build` 线上无变化。
