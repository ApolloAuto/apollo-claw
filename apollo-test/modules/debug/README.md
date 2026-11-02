# Apollo 运行时调试手册

> ## ⚠️ 本环境（包工作区）适配
>
> 本环境是独立包管理工作区 `/apollo_workspace`。`cyber_monitor` / `cyber_channel` / `cyber_node` /
> `cyber_recorder` / `cyber_launch` / `mainboard` 这些**工具本身与用法完全不变**，正文全部适用。
> 三处路径与生效机制不同：
>
> **① 「改了 conf 没生效」的正确改法（本 skill 最高频的问题，路径错了会白折腾）。**
> `/apollo/<src_path>/conf/` 目录是真目录，但**里面每个文件都是指向 `/opt/apollo/neo/share/<src_path>/conf/`
> 的符号链接**（`dag` / `launch` 同理）：
>
> | 改哪个路径 | 效果 |
> |---|---|
> | `/apollo/<src_path>/conf/*` | **立即生效**，且写穿到 `/opt/apollo/neo/share/...`。调参试参数走这里 |
> | `/opt/apollo/neo/share/<src_path>/conf/*` | 立即生效，但下次 install 被覆盖 |
> | `/apollo_workspace/<src_path>/conf/*`（源码副本） | **不生效**，直到 `buildtool build -p <path>` 重编 install |
>
> 例：`/apollo/modules/planning/planning_component/conf/planning.conf` 是符号链接，改它立即生效；
> 改 `/apollo_workspace/modules/planning/planning_component/conf/planning.conf` 不重编则毫无效果。
> 查找顺序依据 `GetFilePathWithEnv`（`cyber/common/file.cc:422-472`）：绝对路径直接用 → 逐个试环境变量里
> 冒号分隔的前缀、第一个存在的立即返回 → CWD 相对路径兜底。即 **env 路径胜过当前目录**。
> 代码里 CWD 检查其实写在前面（`:433-438`）只是作为兜底值，被后面命中的 env 前缀覆盖（`:452-470`）；
> **额外的坑：路径以 `.` 开头（`./foo`）会在 `:439-442` 直接返回，整段环境变量搜索被跳过。**
>
> **② 「模块起不来 / .so 加载不到 / 插件找不到」不要查 `bazel-bin`。**
> 本环境 `APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT` 实测为 **0**（整仓是 1），扫 `bazel-bin` 这一步
> **完全不发生**；`APOLLO_LIB_PATH` = `/opt/apollo/neo/lib`（整仓是 `/apollo/bazel-bin`），
> `APOLLO_PLUGIN_INDEX_PATH` = `/opt/apollo/neo/share/cyber_plugin_index`（113 个条目）。
> 推论：**只 `bazel build` 编出的 .so 运行时看不见**，必须 `buildtool build -p <path>` 完成 install。
> 「改完代码没效果」在本环境的头号原因就是漏了 install，而不是代码问题。
>
> **③ 启停模块与进容器的命令。**
>
> | 整仓形态 | 本环境 |
> |---|---|
> | `bash docker/scripts/dev_into.sh` | `aem enter`（`aem` 只管容器与环境：`create|start` / `enter` / `exec` / `remove` / `list`） |
> | `bash scripts/bootstrap.sh start` | 不用 `buildtool bootstrap`；launch 用 `cyber_launch start <launch>`，dag 用 `mainboard -d <dag>` |
> | 直接 `cyber_launch` / `mainboard` | 不变，但 launch/dag 路径用 `/apollo/<src_path>/...` |
>
> **`buildtool bootstrap start <x>` 的真实行为**（`/opt/apollo/neo/packages/buildtool/9.0.0-rc1-r19/core/boot.py:31-61`）：
> 拼 `/apollo/modules/<x>/launch/<x>.launch` → 不存在就报
> `Could not find <x>. Is it already built?` → 存在则
> `cyber_launch start <该 launch> > /apollo/data/log/<x>.log 2>&1 &`。
> **它只认「模块名和 launch 文件名同名、且 launch 直接挂在 `modules/<模块名>/launch/` 下」这一种布局**，
> 本环境满足的只有 **12 个**（现场枚举）：`canbus` `dreamview` `dreamview_plus` `localization`
> `monitor` `prediction` `routing` `storytelling` `loam_velodyne` `loam_velodyne_indoor`
> `localization_intergrate` `slam_local`。
> **`planning` / `control` / `perception` 用模块名起不来**（它们的 launch 在
> `<模块>/<模块>_component/launch/` 下）。`boot.py:43-46` 虽允许传 `.launch` 路径，但只是内部转成
> `cyber_launch start <同一路径>`、多了日志重定向，且 `bootstrap stop` 不支持传路径 —— 所以别用它，直接用：
> ```bash
> cyber_launch start /apollo/modules/planning/planning_component/launch/planning.launch
> ```
> 等价：`mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag`（dag 前台直跑）。
> `buildtool bootstrap stop <x>` **不支持传 launch 路径**（`boot.py:106-107` 只拼模块名路径），
> 所以用路径起的进程要用 `cyber_launch stop <同一路径>` 停。
>
> **`/apollo/scripts/` 在本环境确实存在（105 个 `.sh`），但一半是坏的**。`run_module` 拼的是
> `${APOLLO_ROOT_DIR}/modules/<m>/launch/<m>.launch`（`apollo_base.sh:224`），和上面同一个约束。
> 现场逐个试的结果：**能用** `canbus.sh` `dreamview.sh` `dreamview_plus.sh` `localization.sh`
> `monitor.sh` `prediction.sh` `routing.sh` `storytelling.sh`；**必挂** `planning.sh` `control.sh`
> `guardian.sh`（guardian 模块本身也没了）。`perception.sh` 也挂 —— 它写死
> `modules/perception/production/launch/perception_all.launch`，本环境**没有 `production/` 目录**，
> perception 的 launch 是按子模块散开的（`lidar_detection/launch/lidar_detection.launch` 这种，
> 全仓 73 个 `.launch`）。
> `bash scripts/bootstrap.sh [start_plus]` 内部调 `monitor.sh` + `dreamview[_plus].sh`，这两个都在
> 可用名单里，所以**它是能用的**。
>
> 结论：**别记脚本名，别用 `buildtool bootstrap`**。launch 用 `cyber_launch start <绝对路径>`，dag 用
> `mainboard -d <绝对路径>`，在本环境永远对。
>
> 工具 PATH 由 `/opt/apollo/neo/setup.sh` 注入（不是正文说的 `cyber/setup.bash` 从 `bazel-bin` 注入），
> 完整变量表见 `reference.md` 第一节。

工具完整参数与源码位置、monitor/safety_manager/external_command 触发链路、主链路 channel 速查、
运行期高危坑清单见 `reference.md`。

**前提**：命令都在 dev 容器内 `/apollo` 执行。**本环境**工具 PATH 由 `/opt/apollo/neo/setup.sh` 注入，
Python 工具已装成 `/opt/apollo/neo/bin` 下的裸命令（482 个），**直接敲命令名即可，不要写
`python3 modules/tools/<x>/<y>.py`**（工作区里没有 `modules/tools/`）。整仓形态才是
`cyber/setup.bash:8-28` 从 `bazel-bin` 注入 + 从仓库根跑 `.py`。

## 1. 症状 → 排查路径（主表）

| 症状 | 先跑 | 看什么 | 下一步 |
|---|---|---|---|
| 模块起不来/秒退 | `mainboard -d <dag>`（前台打屏，本环境首选；`scripts/<mod>.sh start_fe` 一半模块是坏的，见上 ③） | `Failed to load module`（`cyber/mainboard/module_controller.cc:69`）、`Component Init() failed`（`cyber/component/component.h:175`） | 无任何输出 → dag 的 `module_library` 路径错 |
| 起来了但和地图有关的都不对（planning/routing/localization 尤其） | `grep -n map_dir /apollo/modules/common/data/global_flagfile.txt` | **本环境该文件有 3 行 `--map_dir`，生效的是最后一行 `/apollo/modules/map/data/sunnyvale_big_loop` —— 而这个目录不存在** | `/apollo/modules/map/data/` 下只有 `borregas_ave`（bin 全套）与 `demo`（txt）。先把 `--map_dir` 改成 `borregas_ave`，或 `apt-cache search apollo-neo-map` 装地图包。`/apollo/data/map_data/` 是同一批符号链接的另一个入口 |
| Proc 不被调用 | grep `registerclass:`（`cyber/class_loader/utility/class_loader_utility.h:79`） | 没有 → `.so` 未 dlopen 或 dag `class_name` 与 `CYBER_REGISTER_COMPONENT(X)` 不逐字一致 | 有 → grep `create croutine:`（`cyber/scheduler/scheduler.cc:55`），打印协程真名 |
| 协程建了还是不跑 | 对**每个** reader channel 单独 `cyber_channel hz` | 副路频率为 0 | AllLatest 冷启动期任一副路空 → 整帧静默丢弃、无日志（`cyber/data/fusion/all_latest.h:60-63`），这是头号误判来源 |
| 下游收不到 | `cyber_channel info <channel>` | writer 与 reader 必须**同时**出现 | 只有 writer → 查 `CYBER_DOMAIN_ID`（默认 80，`cyber/setup.bash:34`）/`CYBER_IP`/跨机 `host_ip`；`ipcs -m` 看残留段 |
| 丢帧 | grep `read buffer overflow, drop_message` | `cyber/data/channel_buffer.h:70-72`，方括号内是跳过帧数 | dag 调大 `pending_queue_size`（**默认 1**，`cyber/node/reader.h:50`） |
| 频率不对 | `cyber_channel hz <channel>` | 与 dag/conf 配置值比 | TimerComponent 看 dag `interval`(ms)；疑似饿死 → `export sysmo_start=1` 重启看 `CheckSchedStatus`（`cyber/scheduler/scheduler.cc:102-123`） |
| 崩溃 | `ls /apollo/data/core/`，日志尾部 `F` 行 | FATAL / ACHECK 消息 | 本环境 `/proc/sys/kernel/core_pattern` = `/apollo/data/core/core_%e.%p`（现场核对），目录已建好。随机跨模块崩溃多为踩栈：协程栈仅 2MB 且无 guard page（`cyber/croutine/detail/routine_context.h:34` 的 `STACK_SIZE`，`:43` 是结构体内联数组，纯堆分配，全环境 `grep mprotect` 零命中），`Proc()` 里大数组/深递归要挪堆 |
| 进程退不出 | `gdb -p <pid>` + `thread apply all bt` | grep `waiting for task <name> completion`（`cyber/scheduler/policy/classic_context.cc:111`） | 该协程 `Proc()` 没 Yield → `Scheduler::Shutdown()` 永久 join |
| 性能差/延迟大 | `cyber_performance` 后浏览器开 `:5000` | 各 component 的 proc/cyber latency | bvar dump 落 `$APOLLO_ENV_WORKROOT/dumps/<dag_info>`（`cyber/init.cc:134-144`）。**`aperf` 本环境未装成命令**（源码在，见第七节） |
| 带宽异常 | `cyber_channel bw <ch>`；离线 `channel_size_stats.py` | 找体积大户 | shm 档位最大 32MB（`cyber/transport/shm/shm_conf.cc:63` 的 `MESSAGE_SIZE_MORE`，`:77-79` 把一切 >16MB 都归到这一档，**没有更大档位**）。超过时**不截断也不报错**：`segment.cc:53-57` → `Recreate` → `shm_conf.cc:30-37` 又算回 32MB，之后无二次校验，`shm_transmitter.h:292-303` 直接 `SerializeToArray` 越界写坏共享内存，**零日志** |
| conf 改了没生效 | grep `use config file:` / `use flag file:`（`cyber/component/component_base.h:78,88`） | 打印的是否是你改的那份 | 同进程多 component 的 `flag_file_path` **互相覆盖**（gflags 进程级） |
| 调度 conf 没生效 | grep `Failed to parse file` / `not found, use default`（`cyber/scheduler/scheduler_factory.cc:60-65`） | 字段名写错 → 整份静默失效、回落 classic | 反例：`cyber/conf/control_sched_choreography.conf` |
| 命令发了车不动 | `cyber_service list` | `/apollo/external_command/xxx` 在不在 | 不在 → processor 未注册，加到 `/apollo/modules/external_command/process_component/conf/config.pb.txt`（**本环境已注册 5 个**：LaneFollow / ValetParking / Action / ZoneCover / FreeSpace；另有 Chassis / PathFollow / PreciseParking / Speed 四个**已装未注册**，加类名重启即可，不用重编） |
| DV 模块灯红/灰 | `cyber_channel echo /apollo/monitor/system_status` | "Status not reported by Monitor." = 模式 conf 没配该组件，不是模块挂了 | monitor 收不到 HMIStatus 会整帧不检查 → dreamview 没起 = monitor 瘫痪 |
| 车突然自己刹停 | grep `triggers safe mode`（`modules/monitor/software/functional_safety_monitor.cc:37-38`） | 后面跟着罪魁组件名 | **本环境 guardian 已不存在**，链路改成：monitor 置 `SystemStatus.safety_mode_trigger_time`，超 `FLAGS_safety_mode_seconds_before_estop`（默认 **10s**，`functional_safety_monitor.cc:27-29`）才置 `require_emergency_stop`；另一路是 `safety_manager` 的 checker 发 `/apollo/safety/decision`。别随手 kill monitor / statistics |
| 车莫名反复重规划 | `cyber_channel echo /apollo/safety/decision` | `SafetyDecision.safety_mode_trigger_time` 是否存在 | `replan_control_task.cc:85` 判的是**字段存在性而非值**，一存在就无条件请求全量重规划（reason `REPLAN_REQ_ALL_REPLAN`）；另一触发是 `chassis->error_code() == CMD_NOT_IN_PERIOD`（`:94`） |

**起来后的固定验证顺序**（第一个断掉处即问题所在），逐个 `cyber_channel hz`：
`/apollo/localization/pose` → `/apollo/perception/obstacles` → `/apollo/prediction` →
`/apollo/planning` → `/apollo/control`。

## 2. 六件套工具

现场 `ls cyber/tools/`：`cyber_channel` `cyber_launch` `cyber_monitor` `cyber_node`
`cyber_performance` `cyber_recorder` `cyber_service`；`mainboard` 在 `cyber/mainboard/`。

```bash
# cyber_monitor：ncurses TUI，只有两个参数（cyber/tools/cyber_monitor/main.cc:57-64）
cyber_monitor                        # 全部 channel + 频率；-c <ch> 只看一个；-h 含交互键表
# 交互键（screen.cc:44-70）：f 帧率 / t 类型 / → 进入看内容 / ← 返回 / Space 启停 / q 退出

# cyber_channel（cyber/tools/cyber_channel/cyber_channel.py，optparse；无 pub 子命令）
cyber_channel list                            # 全部 channel（:319）
cyber_channel info /apollo/planning           # writer/reader 的 RoleAttributes（:288）
cyber_channel echo /apollo/canbus/chassis     # 内容，靠 proto_desc 动态解析（:362）
cyber_channel hz /apollo/control               # 频率（:216）。⚠️ **不要加 `-w`**，见下
cyber_channel bw /apollo/sensor/lidar128/compensator/PointCloud2   # 带宽（:109）
cyber_channel type /apollo/prediction         # 消息类型（:31）

# cyber_node / cyber_service（service 走另一套发现层，channel 视角看不到）
cyber_node list                               # 全部 node（cyber_node.py:88）；info <node> 看读写 channel（:54）
cyber_service list                            # 全部 service（cyber_service.py:74）；info <svc>（:41）

# cyber_launch（cyber_launch.py:540-571）；restart 已被注释掉（:557-558）
cyber_launch start /apollo/modules/planning/planning_component/launch/planning.launch
cyber_launch stop  <同一 launch>               # 不给文件 = 停所有 launcher

# cyber_performance：bvar 可视化，Flask 默认 0.0.0.0:5000（cyber_performance.py:788）
cyber_performance                             # ⚠️ 本环境没装 cyber_performance.launch，只能这样裸跑
```
`cyber_monitor` 看不到 `/perception/inner/*` 是正常的（传 C++ 结构体指针不序列化）。
`cyber_performance` 只读 `dumps/` 下的 bvar 文件，**不解析 `cyber_perf_*.data`**。

> **⚠️ `-w` 参数是坏的（现场实测）**：`cyber_channel.py:240` 用 `string.atoi()`，
> Python 3 里 `string` 模块**没有** `atoi` → 任何 `-w N` 都落到 `except` 分支，直接
> `error: window size must be an integer` 退出。`bw` 的 `:133` 同一个 bug。
> 不加 `-w` 反而正常：默认 `-1` → 走 `window_size <= 0` 分支，`hz` 取 **50000**、`bw` 取 **100**。
> 需要短窗口只能改源码或自己数。
>
> 另：这些 Python 工具启动时 bvar 会往 **CWD 下的 `dumps/`** 写，在只读目录（如 `/apollo`）里跑会刷
> `Fail to create directory='dumps'` 三行红字 —— **是噪声，不影响功能**，嫌烦就 cd 到可写目录再跑。

## 3. mainboard 与 cyber_launch 的关系

`cyber_launch` 是 Python 包装器：解析 `.launch` XML，为每个 `<module>` fork 一个 mainboard 进程
（`<type>binary</type>` 时把 `<process_name>` 当命令直接执行，`cyber_launch.py:451,467-473`）。
一个 `<module>` 内多个 `<dag_conf>` = 单进程加载多 dag（共享 scheduler、进程内零拷贝）；
多个 `<module>` = 多个独立进程。`<exception_handler>respawn</exception_handler>` 崩溃自动重启
（默认 3 次，`:37,333-338`），强杀超时 3s（`:40`）。调单模块用 mainboard 更可控。

```bash
mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag   # 本环境用绝对路径最稳
mainboard -d a.dag -d b.dag -p my_group        # -p 决定调度配置；-s/--sched_name 实际无效
mainboard --plugin <plugin_xml> -d <dag>       # 或 --disable_plugin_autoload
mainboard -d <dag> -c -o my_cpu.prof           # gperftools CPU profile（需 build_prof）
mainboard -h                                   # 全表：cyber/mainboard/module_argument.cc:32-58
```
dag 里路径是 `/apollo/...` 绝对路径，换根目录靠 `APOLLO_CONF_PATH` / `APOLLO_FLAG_PATH`
（`cyber/component/component_base.h:74,85`）；**本环境这两个都是 `/apollo`**
（`/opt/apollo/neo/setup.sh:80-81`），所以 dag 里的绝对路径开箱即用。
模块脚本 `bash scripts/planning.sh start|start_fe|start_gdb|start_prof|stop` 底层就是
`nohup cyber_launch start ... &`（`scripts/apollo_base.sh:216-238`），存活判定靠
`pgrep -f ".../<name>.launch"`（`:205-214`）——**手动 `mainboard -d` 起的进程它停不掉**。
`start_fe` 前台打屏，排查启动失败首选。`bash scripts/bootstrap.sh [start_plus]` 只起 monitor + dreamview。

## 4. 日志

- 位置：`$GLOG_log_dir`。**本环境是 `/opt/apollo/neo/setup.sh:33` 设的 `/apollo/data/log`**
  （整仓形态是 `cyber/setup.bash:37`；另见 `/apollo/modules/common/data/global_flagfile.txt:10`
  的 `--log_dir=/apollo/data/log`，两处一致，现场已核对该目录存在且可写）。
  整仓形态里目录由 `scripts/apollo_base.sh:96-100` `mkdir -p` 创建 —— **目录不存在时日志静默丢失**；
  本环境目录已随镜像建好，但**换了 `GLOG_log_dir` 到不存在的路径同样静默丢日志**。
- 文件名 `<module>.log.INFO.<YYYYMMDD>-<HHMMSS>.<pid>` + symlink `<module>.INFO`
  （`cyber/logger/log_file_object.cc:169-185`、`async_logger.cc:110-116`）。`<module>` 取自日志消息
  第一对 `[]`（即 `-DMODULE_NAME`），无则回落进程组名 → **一个 mainboard 跑多 component 会产生多个日志文件**。
- 调级别（GLOG 环境变量；**本环境默认值在 `/opt/apollo/neo/setup.sh:34-37`**），改完必须重启进程：
```bash
export GLOG_minloglevel=0      # 本环境默认已是 0（INFO）。1=WARNING 2=ERROR 3=FATAL
export GLOG_alsologtostderr=1  # 同时打屏（本环境默认 0），崩溃现场首选
export GLOG_v=4                # 打开 ADEBUG（走 VLOG(4)）。本环境 setup.sh 里根本没这一行，必须自己 export
export GLOG_log_dir=/tmp/mylog # 记得先 mkdir -p，否则静默丢日志
# 本环境还预设了 GLOG_colorlogtostderr=1（:35）与 GLOG_max_log_size=500（MB，:37）
```
- `cyber::Init` 不解析 gflags → 命令行 `--minloglevel` 对 mainboard 无效，只能用环境变量。
- `_exit()`/`abort()`/`SIGKILL` 不触发 atexit，**异步日志缓冲全丢**。
- `Failed to parse file ... as text proto` 常是正常噪声（读 binary proto 先试 ASCII）。

## 5. record 包

参数出自 `cyber/tools/cyber_recorder/main.cc:49-53`（option 串）与 `:96-170`（说明表）。
```bash
cyber_recorder info xxx.record                 # channel 列表、消息数、时间范围、is_complete
cyber_recorder record -a -o my.record          # 全部；不给 -o 则名为 <YYYYmmddHHMMSS>.record（:442-445）
cyber_recorder record -c /apollo/planning -c /apollo/canbus/chassis   # 白名单，可重复
cyber_recorder record -a -k /apollo/sensor/camera/front_6mm/image     # 黑名单排大户
cyber_recorder record -a -i 60                 # 每 60s 切段；-m 2048 = 每 2048MB 切段
cyber_recorder play -f my.record -l            # --loop 循环，联调最常用；-r 0.5 半速
cyber_recorder play -f my.record -c <ch> -c <ch>   # 只放这几条；-k <ch> 排除
cyber_recorder play -f my.record -s 30 -d 3 -p 5   # 从 30s 起 / 延迟 3s / 预载 5s
cyber_recorder play -f f -b 2018-07-01-00:00:00 -e 2018-07-01-00:01:00
cyber_recorder split -f in -o out -c <ch>      # 抠 channel，也可 -b/-e 抠时间
cyber_recorder recover -f broken.record        # 不给 -o 时输出 <in>.recover
```
`play` 拒绝 `is_complete=false` 的包，被 kill 留下的文件先 `recover`。回放额外发 `/apollo/cyber/record_info`。

## 6. 单模块离线调试

套路：回放时用 `-k` 排掉被调模块自己的输出 channel，否则包里旧消息与新输出打架。
```bash
cyber_recorder play -f pnc.record -l -k /apollo/planning -k /apollo/control
mainboard -d modules/planning/planning_component/dag/planning.dag
cyber_channel hz /apollo/planning              # 另开终端确认自己的输出
```
PlanningCommand writer 是 `TRANSIENT_LOCAL` QoS —— 晚启动的 planning 会收历史命令，
出现「我没发命令但车动了」。缺上游时打桩（**本环境都是裸命令**，已核对都在 `/opt/apollo/neo/bin`）：
```bash
empty_prediction   -c /apollo/prediction -r 10
replay_perception  obs.json -c /apollo/perception/obstacles -p 0.1
planning_command                                  # 交互式发 external_command
# manual_traffic_light 本环境是 C++ Component 不是裸命令（bin 下没有，但 .so 装了）：
cyber_launch start /apollo/modules/tools/manual_traffic_light/manual_traffic_light.launch
#   或 mainboard -d /apollo/modules/tools/manual_traffic_light/manual_traffic_light.dag
#   TimerComponent interval 200ms，class_name `ManualTrafficLight`，
#   conf 在同目录 manual_traffic_light.conf（三个文件都是指向 share/ 的符号链接）
```
**perception 单模块调试必须配 msg_adapter**：内部 `/perception/inner/*` 传结构体指针，
`cyber_monitor`/DV 都看不到；msg_adapter 把它们转成 `PerceptionObstacles` 发到
`/apollo/perception/obstacles`。三对 in/out 由 gflags 定义
（`modules/perception/msg_adapter/common/msg_adapter_gflags.cc:19-35`，三个 `*_in` **默认
`/fake_topic` 即禁用**），实际启用值在 `modules/perception/data/flag/perception_common.flag:155-157`
—— 现状只开了 `--sensorframe_message_to_obstacles_in=/perception/inner/PrefusedObjects`，另两条被注释。
**单跑 lidar 或 camera 而不跑 fusion 时必须改这个 flag，否则 obstacles 上没数据**；三路 `*_out`
相同，同时开多路会互相干扰。

msg_adapter **本环境已完整安装、可直接跑**（现场核对：`.so` 在
`/opt/apollo/neo/lib/modules/perception/msg_adapter/libmsg_adapter_component.so`，
dag/launch 在 `/apollo/modules/perception/msg_adapter/{dag,launch}/`）：

```bash
mainboard -d /apollo/modules/perception/msg_adapter/dag/msg_adapter.dag
# 或 cyber_launch start /apollo/modules/perception/msg_adapter/launch/msg_adapter.launch
```
注意它的 dag 里只有 `flag_file_path: /apollo/modules/perception/data/flag/perception_common.flag`
（`components{}` 段、`class_name: MsgAdapterComponent`）—— **改上面那个 flag 文件就是改它的行为**，
且那份 flag 被整个 perception 共用。

## 7. modules/tools 最有用的几个

**本环境**这些 Python 工具都已装成 `/opt/apollo/neo/bin` 下的**裸命令**（共 482 个可执行），
直接敲名字，不需要 `python3 modules/tools/...`，也不需要在仓库根：

| 命令 | 用途 | 命令 |
|---|---|---|
| `dump_record` | record 全量导文本，最通用 | `dump_record <record> <out_dir>` |
| `record_analyzer` | record 体检：控制/规划指标、错误码、端到端延迟 | `record_analyzer -f <record> -path -acc`（加 `-a` 才含人驾段） |
| `dump_message` | 导出某 topic 某时刻那一条 | `dump_message -f <record> -m <topic> -t <ts>` |
| `channel_size_stats` | 每 channel 平均消息大小 | `channel_size_stats <record>` |
| `sample_pnc_topics` | 生成只含 PNC topic 的瘦身包 | `sample_pnc_topics '/path/*.record'` |
| `realtime_plot` | 在线画 planning + control | `realtime_plot` |
| `rtk_player`（配 `rtk_recorder`） | 不启 planning 也能跑车（循迹） | `rtk_player --speedmulti 1.0` |
| `aperf` | 耗时分布与时间线 | **未装成命令**，但源码在（见下）。可 `pip3 install -e /opt/apollo/neo/src/modules/tools/aperf` 后得到 `aperf cost` / `aperf timeline`；不想装就用 `cyber_performance` + 浏览器 `:5000` |

`aperf` 是个 `setuptools` 包（`src/modules/tools/aperf/setup.py`，`entry_points` 定义
`aperf = aperf.main:main`，只依赖 `matplotlib`），子命令 `cost` / `timeline`
（`aperf/main.py:35-38`），吃的是 `perf.INFO` 那类日志 —— 与 `cyber_performance` 读 `dumps/`
下 bvar 文件**是两套数据源**，别混。

`rosbag/` 是历史遗留目录名，里面绝大多数处理 **cyber record 不是 ROS bag**；
`planning_command` 的坐标/车位 id 是某张特定地图的硬编码值，换地图必须改。
源码要看时在 `/opt/apollo/neo/src/modules/tools/<子目录>/`。

> **⚠️ `/apollo/modules/tools/` 存在，但和源码树不是一回事**：它下面 17 个子目录只放
> conf/dag/launch 的符号链接（如 `manual_traffic_light/`、`record_analyzer/`、
> `sensor_calibration/`、`vehicle_calibration/`、`gen_vehicle_protocol/`、`visualizer/` 等），
> **没有 `.py` 源码**。Python 源码一律在 `/opt/apollo/neo/src/modules/tools/`，
> 可执行入口一律在 `/opt/apollo/neo/bin/`。`/apollo_workspace/` 下则完全没有 `modules/tools/`。

## 8. 反查技巧

**本环境**没有整仓根目录：源码搜 `/opt/apollo/neo/src/modules`（要头文件再补 `/opt/apollo/neo/include/modules`），
运行期的 dag/conf 搜 `/apollo/modules`。

> **⚠️ 搜 `/apollo/modules` 必须用 `grep -R` 不是 `grep -r`**：`/apollo/modules/**/{conf,dag,launch}/`
> 里**每个文件都是指向 `share/` 的符号链接**，而 `-r` 不跟随递归过程中遇到的符号链接
> → 所有内容检索都返回空，会误判成「这个 channel/类名根本没人用」。`-R` 才跟随。

```bash
S=/opt/apollo/neo/src/modules; I=/opt/apollo/neo/include/modules
grep -rn "CreateWriter" --include="*.cc" $S | grep -i <关键字>       # channel 谁写的
grep -rn "<channel>" --include="*.dag" $S; grep -Rn "<channel>" --include="*.dag" /apollo/modules   # channel 谁读的（/apollo 用 -R）
grep -rn "<channel>" --include="*_gflags.cc" --include="*.pb.txt" $S # channel 名定义在哪
grep -rln "<ClassName>" --include="*.dag" $S; grep -Rln "<ClassName>" --include="*.dag" /apollo/modules  # Component 属于哪个 dag
grep -rn "class <YourClass>" $S $I                                   # 类还在不在（两棵树都要搜）
ipcs -m ; ls -la /dev/shm/ ; ipcrm -m <shmid>   # shm 残留（key/文件名 = channel_id），仓库无清理脚本
```
