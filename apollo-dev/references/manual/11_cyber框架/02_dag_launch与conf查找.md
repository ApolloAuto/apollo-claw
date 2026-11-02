# 02 dag / launch 与 conf 查找

<!--
file: references/manual/11_cyber框架/02_dag_launch与conf查找.md
scope: 11.0（默认）
tags: dag, launch, cyber_launch, mainboard, DagConfig, ComponentConfig, TimerComponentConfig, readers, qos_profile, pending_queue_size, interval, GetFilePathWithEnv, APOLLO_DAG_PATH, APOLLO_CONF_PATH, APOLLO_FLAG_PATH, APOLLO_LAUNCH_PATH, gflags, flagfile, global_flagfile, map_dir, profile 覆盖层, profiles/current, 软链落点, readlink
sources:
- /opt/apollo/neo/src/cyber/proto/dag_conf.proto（全 25 行）
- /opt/apollo/neo/src/cyber/proto/component_conf.proto（全 27 行）
- /opt/apollo/neo/src/cyber/mainboard/module_controller.cc（全 137 行）
- /opt/apollo/neo/src/cyber/common/file.cc（415–479 行精读）
- /opt/apollo/neo/src/cyber/component/component_base.h（55–124 行精读）
- /opt/apollo/neo/src/cyber/tools/cyber_launch/cyber_launch.py（390–504 行精读 + grep 定位 33/39/194–220）
- /apollo/modules/planning/planning_component/dag/planning.dag（全 31 行）
- /apollo/modules/planning/planning_component/launch/planning.launch（全 8 行）
- /apollo/modules/prediction/dag/prediction.dag（全 19 行）
- /apollo/modules/control/control_component/dag/control.dag（全 12 行）
- /apollo/modules/canbus/dag/canbus.dag（全 12 行）
- /apollo/modules/dreamview_plus/launch/dreamview_plus.launch、/apollo/modules/localization/launch/localization.launch（全文）
- /apollo/modules/planning/planning_component/conf/planning.conf（1–18 行精读）
- /apollo/modules/control/control_component/conf/control.conf（全 53 行）
- /apollo/modules/common/data/global_flagfile.txt（1–18、74–82 行精读）
- /opt/apollo/neo/src/modules/planning/planning_base/gflags/planning_gflags.cc（1–62 行精读）
- /opt/apollo/neo/src/modules/common/adapters/adapter_gflags.cc（26–70 行精读）
- /opt/apollo/neo/src/modules/control/control_component/control_component.cc（44–123 行精读）
- /apollo_workspace/.manual_work/inventory/cyber_messages_inventory.md（已有盘点，本文引用其 §2/§5/§6）
-->

## 0. 一句话作用

讲**一个 cyber 组件从磁盘文件被拉起并拿到配置的全过程**：dag 描述「哪个 .so / 哪个类 / 订阅哪些 channel / 用哪两个配置文件」，launch 把若干 dag 编成进程，mainboard 解析 dag 并 `class_loader` 实例化，组件配置与 gflags 经 `GetFilePathWithEnv` 的三段查找落到 ④ 层 `/apollo/...` 软链，再由软链穿到 **profile 覆盖层** `/apollo_workspace/profiles/current`（→`ARCF_40P`）或出厂件 `/opt/apollo/neo/share`。位置：PnC 链路里所有模块（planning/control/canbus/prediction…）的共同装配层，组件内部主循环见 `../12_planning源码/02_planning_component主循环.md`。

## 1. 关键符号与文件

| 符号/概念 | 文件（绝对路径） | 行号(已核) | 说明 |
|---|---|---|---|
| `DagConfig` / `ModuleConfig` / `ComponentInfo` / `TimerComponentInfo` | /opt/apollo/neo/src/cyber/proto/dag_conf.proto（② src 全） | 23-25 / 17-21 / 7-10 / 12-15 | dag 文件的 proto schema：`module_config` 可重复，内含 `module_library` + `components[]` + `timer_components[]` |
| `ComponentConfig` | /opt/apollo/neo/src/cyber/proto/component_conf.proto（② src 全） | 15-20 | `name` 1 / `config_file_path` 2 / `flag_file_path` 3 / `readers[]` 4 |
| `ReaderOption` | 同上 | 7-13 | `channel` / `qos_profile`（`depth` = 已处理消息容量）/ `pending_queue_size`（**default = 1**，未处理消息容量） |
| `TimerComponentConfig` | 同上 | 22-27 | `name`/`config_file_path`/`flag_file_path`/`interval`（**毫秒**）；**无 readers 字段** |
| `ModuleController::LoadAll` | /opt/apollo/neo/src/cyber/mainboard/module_controller.cc（② src 全） | 38-74 | 先加载插件（:43-50），再对每个 `-d` dag 调 `GetFilePathWithEnv(dag_conf,"APOLLO_DAG_PATH")`（:53-54），找不到直接 AERROR 返回 false（:55-56） |
| `ModuleController::LoadModule` | 同上 | 76-110 / 112-119 | `.so` 路径经 `GetFilePathWithEnv(module_library,"APOLLO_LIB_PATH")`（:79-80）→ `LoadLibrary`（:87）→ 对 `components()`（:89-97）与 `timer_components()`（:99-107）各 `CreateClassObj<ComponentBase>(class_name)` + `Initialize(config)`；dag 文本解析在 :114 `GetProtoFromFile` |
| `GetComponentNum` | 同上 | 121-133 | 预扫 dag 统计组件数；**只要有 `timer_components` 就置 `has_timer_component`**，`LoadAll:62-64` 据此把调度线程池计入总数 |
| `GetFilePathWithEnv` | /opt/apollo/neo/src/cyber/common/file.cc（② src） | 422-472 | conf/flag/dag/lib 四类路径共用的唯一查找函数（顺序见 §2.4） |
| `ComponentBase::LoadConfigFiles` | /opt/apollo/neo/src/cyber/component/component_base.h（② src / ②′ 同） | 72-93（消息版）/ 95-116（timer 版） | `config_file_path` 走 `APOLLO_CONF_PATH`，`flag_file_path` 走 `APOLLO_FLAG_PATH`，末尾 `google::SetCommandLineOption("flagfile", ...)`（:91、:114）——**gflags 就是在这里装载的** |
| `GetProtoConfig<T>` | 同上 | 62-65 | 组件 `Init()` 里读 `config_file_path_`（已解析后的绝对路径） |
| cyber_launch 解析器 | /opt/apollo/neo/src/cyber/tools/cyber_launch/cyber_launch.py（② src） | start 421-504；元素读取 392-418 | launch = XML；`launch_path = os.getenv('APOLLO_LAUNCH_PATH') or '/apollo'`（:39），二进制名固定 `mainboard`（:33） |

## 2. 机制与数据流

### 2.1 从命令到组件：mainboard 加载链

`mainboard -d <dag>` →（每个 `-d`）`GetFilePathWithEnv(..., "APOLLO_DAG_PATH")`（module_controller.cc:53）→ `GetProtoFromFile` 解析成 `DagConfig`（:114）→ 逐 `module_config`：`GetFilePathWithEnv(module_library, "APOLLO_LIB_PATH")`（:79-80，本机 `APOLLO_LIB_PATH=/opt/apollo/neo/lib`，所以 dag 里写的是**相对 lib 根的路径**，如 `modules/planning/planning_component/libplanning_component.so`）→ `class_loader_manager_.LoadLibrary`（:87）→ 按 `class_name` `CreateClassObj<ComponentBase>` 并 `Initialize(component.config())`（:91-93 / :101-103）。`Initialize` 内部先 `LoadConfigFiles`（component_base.h:72/95）再调用户 `Init()`，最后按 readers 建 reader（`Component` 模板侧，见盘点 §2.4 与 `../12_planning源码/02_planning_component主循环.md` §2.1）。

要点：**dag 里的 `class_name` 必须与 `CYBER_REGISTER_COMPONENT(X)` 注册的非限定名逐字相同**，否则 `CreateClassObj` 返回 nullptr → `Initialize` 未执行 → mainboard 直接 `return false` 退出（:93-95）。

### 2.2 dag 元素结构（proto 权威 + 本机四个实例逐个 read 核对）

```
module_config {                 # 可重复
  module_library: "<相对 APOLLO_LIB_PATH 的 .so 路径>"
  components {                  # 消息触发；可重复
    class_name: "<注册名>"
    config {
      name: "<node 名>"
      config_file_path: "<绝对或相对 APOLLO_CONF_PATH>"   # 可省
      flag_file_path:   "<绝对或相对 APOLLO_FLAG_PATH>"   # 可省
      readers: [ { channel: "..." qos_profile { depth: N } pending_queue_size: M } ]
    }
  }
  timer_components {            # 定时触发；可重复，config 里是 interval(ms)，没有 readers
    class_name: "..." config { name: "..." flag_file_path: "..." interval: 10 }
  }
}
```

本机实例对照（路径均为 ④ 层，落点见 §3.1）：

| dag | 形态 | class_name | readers / interval | config/flag |
|---|---|---|---|---|
| planning.dag（31 行） | `components` | `PlanningComponent`（:5） | `/apollo/prediction`（:12，无 qos → depth 用默认）、`/apollo/canbus/chassis`（:15-19 depth 15、pending 50）、`/apollo/localization/pose`（:22-26 depth 15、pending 50） | conf `planning_config.pb.txt`（:8）+ flag `planning.conf`（:9），**都写绝对 `/apollo/...`** |
| prediction.dag（19 行） | `components` | `PredictionComponent`（:4） | `/apollo/perception/obstacles`（:11-15，depth 1，无 pending → 默认 1） | `prediction_conf.pb.txt`（:7）+ `prediction.conf`（:8） |
| control.dag（12 行） | `timer_components` | `ControlComponent`（:5） | `interval: 10`（:9 → 10ms/100Hz）；**无 readers 段** | 只有 flag `control.conf`（:8），**无 config_file_path** |
| canbus.dag（12 行） | `timer_components` | `CanbusComponent`（:4） | `interval: 10`（:9）；无 readers | `canbus_conf.pb.txt`（:7）+ `canbus.conf`（:8） |

### 2.3 「dag 只声明输入」的确切含义

- dag 能表达的 channel **只有 `components.readers`**（component_conf.proto:7-20 全部字段就这些），**没有任何输出字段**；输出 channel 由组件代码 `node_->CreateWriter(...)` 决定，名字来自 conf proto 或 gflags。
- timer 组件连输入都不在 dag 里：control 的 5 路订阅全在代码，channel 名取 gflags —— control_component.cc:69-110 逐个 `ReaderConfig{channel_name=FLAGS_*, pending_queue_size=FLAGS_*_pending_queue_size}`：`FLAGS_chassis_topic`（:70）、`FLAGS_planning_trajectory_topic`（:78）、`FLAGS_planning_command_status`（:87）、`FLAGS_localization_topic`（:96）、`FLAGS_pad_topic`（:105）；输出 `FLAGS_control_command_topic` 或 `FLAGS_control_local_view_topic`（:113-119）+ `FLAGS_control_interative_topic`（:121-122）。
- 这些 gflag 的默认值集中在 `/opt/apollo/neo/src/modules/common/adapters/adapter_gflags.cc`（已核）：`chassis_topic=/apollo/canbus/chassis`（:27）、`localization_topic=/apollo/localization/pose`（:35-36）、`planning_trajectory_topic=/apollo/planning`（:39-40）、`planning_command=/apollo/planning/command`（:41-42）、`planning_command_status=/apollo/planning/command_status`（:43-44）、`pad_topic=/apollo/control/pad`（:46-47）、`control_command_topic=/apollo/control`（:48-49）、`control_local_view_topic=/apollo/control/localview`（:56-57）、`control_interative_topic=/apollo/control/interactive`（:52-53，拼写即 interative）。
- 因此排查「谁订阅了什么」的正确顺序：**先看 dag readers → 没有就 grep 组件 cc 的 `CreateReader` → 再查 gflag 默认值与 conf 覆盖**。只看 dag 会漏掉 timer 组件的全部输入。
- `pending_queue_size` 默认 1（component_conf.proto:11-12）：dag 里不写 = 未处理消息只缓 1 条，突发会丢；planning 对 chassis/localization 显式给 50。

### 2.4 conf / flag / dag 路径查找：GetFilePathWithEnv（file.cc:422-472，本轮 read 核）

1. `path` 空 → false（:424-426）
2. **绝对路径 → 直接用**，返回值 = `PathExists(path)`（:427-431）。本机 planning/prediction/canbus dag 里的 conf/flag 全是绝对 `/apollo/...`，走这一支，env 完全不参与。
3. 相对路径且**在 CWD 下存在** → 先记为 fallback（:433-438）
4. **`path` 以 `.` 开头（`./x`、`../x`）→ 立即返回，整段 env 搜索被跳过**（:439-442）
5. env_var 未设置 → AWARN + 返回 fallback（:444-448）
6. 否则把 env 值按 `:` 拆前缀，逐个 `前缀 + path` 试 `PathExists`，**第一个命中立即返回**（:452-470）
7. 全不中 → 返回 CWD fallback（:471）

即优先级：**绝对路径 > env 前缀（首个命中）> CWD 相对；`./` 开头等于放弃 env**。

各类路径用的 env（调用点已核）与本机实测值（`env | grep '^APOLLO_'`，2026-09-08）：

| 用途 | env 变量 | 调用点 | 本机值 | 前缀个数 |
|---|---|---|---|---|
| dag 文件 | `APOLLO_DAG_PATH` | module_controller.cc:53-54 | `/apollo` | 1 |
| 组件 `.so` | `APOLLO_LIB_PATH` | module_controller.cc:79-80 | `/opt/apollo/neo/lib` | 1 |
| `config_file_path` | `APOLLO_CONF_PATH` | component_base.h:74-75 / 97-98 | `/apollo` | 1 |
| `flag_file_path` | `APOLLO_FLAG_PATH` | component_base.h:85-86 / 108-109 | `/apollo` | 1 |
| launch 文件（cyber_launch 自己找，非本函数） | `APOLLO_LAUNCH_PATH` | cyber_launch.py:39、:428 | `/apollo` | 1 |
| 插件描述 / 插件库 / 索引 | `APOLLO_PLUGIN_DESCRIPTION_PATH` / `_LIB_PATH` / `_INDEX_PATH` | 插件侧（见 `01_*`/plugin 篇） | `/apollo_workspace:/opt/apollo/neo` / `/opt/apollo/neo/lib` / `/opt/apollo/neo/share/cyber_plugin_index` | 2 / 1 / 1 |

其余实测：`APOLLO_ROOT_DIR=APOLLO_PATH=APOLLO_RUNTIME_PATH=/apollo`、`APOLLO_DISTRIBUTION_HOME=/opt/apollo/neo`、`APOLLO_MODEL_PATH=/apollo/modules/perception/data/models`、`APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`、`APOLLO_ENV_WORKROOT=/apollo_workspace`。**除插件描述路径外每个变量都只有一个前缀**，所以「env 里第一个命中」在本机等价于「`/apollo/` 下存在即用」。

### 2.5 launch 组织（cyber_launch.py:421-504 已核）

launch = XML，根 `<cyber>`；`<environment>` 的**子标签名即环境变量名**、文本即值，会 `os.environ` 注入（:445-447，在起进程前执行）；然后逐个 `<module>` 起一个进程（:449-495）。`<module>` 支持的元素（全部经 `get_param_value`/`get_param_list` 读取）：

| 元素 | 默认 | 作用（行号已核） |
|---|---|---|
| `<name>` | `''` | 仅日志展示（:450、:464） |
| `<dag_conf>` | 无（**library 型必填，可重复**） | 每个转成 `mainboard -d <值>`（:476-480 + :198-199） |
| `<plugin>` | 无，可重复 | 转成 `--plugin <值>`（:481 + :201-202） |
| `<type>` | `library` | `binary` 时把 `<process_name>` 整行当命令行 split 执行（:454、:467-473、:194） |
| `<process_name>` | `mainboard_default_<pid>` | library 型转 `-p <值>`（:204-205，即进程名/日志名）；binary 型是命令本体 |
| `<sched_name>` | `CYBER_DEFAULT` | 转 `-s <值>`（:453、:207-208） |
| `<exception_handler>` | `''` | `respawn` 等；配 `<respawn_limit>`（:457-462） |
| `<nice>` / `<cpuprofile>` / `<memprofile>` | `0` / `''` | 优先级；`-c -o <f>` / `-H -O <f>`（:455-456、:463、:212-218） |
| 属性 `extra_args="..."` | 无 | 追加到 mainboard 命令尾（:483-485、:209-210） |

本机三个形态实例：

| launch | 形态 | 内容要点 |
|---|---|---|
| planning.launch（8 行） | library，**一进程两 dag** | `<name>planning`（:3）、`external_command_process.dag`（:4）+ `planning.dag`（:5）、`<process_name>planning`（:6）→ 展开为 `mainboard -d <ec.dag> -d <planning.dag> -p planning` |
| localization.launch（6 行） | library，单 dag | `dag_streaming_rtk_localization.dag`（:4） |
| dreamview_plus.launch（11 行） | **binary** | `<dag_conf></dag_conf>` 空 + `<type>binary`（:5）+ `<process_name>dreamview_plus --flagfile=/apollo/modules/dreamview_plus/conf/dreamview.conf`（:6-8）+ `<exception_handler>respawn`（:9） |

`cyber_launch start <file>`：非文件时按 `os.path.join(APOLLO_LAUNCH_PATH, file)` 再试（:427-433）；任一进程起失败即 `stop()` 全停（:490-493）。

## 3. 注册与配置

### 3.1 ④ 层软链落点实测（**CLAUDE.md「④ 全部指向 share」已过期**，2026-09-08 readlink）

`/apollo/<sp>/{dag,conf,launch}/` 目录是真目录，文件是软链，**落点分两类**：`/apollo_workspace/profiles/current/...`（**profile 覆盖层**，`current -> /apollo_workspace/profiles/ARCF_40P`，mtime 2026-08-11 16:26）与 `/opt/apollo/neo/share/...`（出厂件）。全量统计（`find /apollo/modules -type l` 限 conf/dag/launch）：**profiles/current 374 个 vs share 339 个**，无第三类。

| ④ 路径 | 落点 |
|---|---|
| planning/planning_component/dag/planning.dag | **profiles/current** |
| planning/planning_component/conf/{planning.conf, planning_config.pb.txt, traffic_rule_config.pb.txt} | **profiles/current** |
| planning/planning_component/conf/planning_semantic_map_config.pb.txt | share |
| planning/planning_component/launch/planning.launch | share |
| control/control_component/dag/control.dag | **profiles/current** |
| control/control_component/conf/{control.conf, pipeline.pb.txt, calibration_table.pb.txt}（该目录**只有这 3 个文件**） | **profiles/current** |
| control/control_component/launch/control.launch | share |
| canbus/dag/canbus.dag、canbus/launch/canbus.launch | share |
| canbus/conf/{canbus.conf, canbus_conf.pb.txt} | **profiles/current** |
| prediction/dag/prediction.dag | share |
| prediction/conf/prediction.conf | **profiles/current** |
| external_command/process_component/dag/external_command_process.dag | share |
| common/data/global_flagfile.txt | **profiles/current** |

规律（本机现状，非源码保证）：**conf 与调过参的 dag 已迁到 profile 层，launch 与未改过的 dag 仍是出厂链**。改 profile 层文件下次 `buildtool build` install **不会**被覆盖；改 share 层会被覆盖。判定方式永远是 `readlink`，别按模块名猜。

### 3.2 gflags 装载链与优先级

装载点：`ComponentBase::LoadConfigFiles` 把 dag 的 `flag_file_path` 解析后 `google::SetCommandLineOption("flagfile", path)`（component_base.h:91 / :114），**发生在用户 `Init()` 之前**，所以 `Init()` 里读 `FLAGS_*` 已是文件值。链条（planning 为例，全部已 read）：

```
planning.dag:9 flag_file_path=/apollo/modules/planning/planning_component/conf/planning.conf
  └─ planning.conf:1  --flagfile=/apollo/modules/common/data/global_flagfile.txt   # 先加载全局
     └─ global_flagfile.txt:8 --vehicle_config_path / :10 --log_dir / :12 --use_navigation_mode=false
        / :14 --use_sim_time=false / :16 --use_cyber_time=true / :18-82 33 组 --map_dir
  └─ planning.conf:2-62 本模块覆盖项（后写覆盖先写，global_flagfile.txt:5-6 头注释即此规则）
     └─ 未出现的 flag = .cc 里的 DEFINE_* 默认值
```

优先级：**同一文件内后行覆盖前行；模块 conf 覆盖 global_flagfile（因为 `--flagfile` 写在第 1 行）；conf 未写的用 `.cc` 默认值**。`.cc` 默认值出处（planning_gflags.cc 已核）：`planning_loop_rate=10`（:21）、`traffic_rule_config_filename`（:34-37，**相对路径** `modules/planning/...`）、`smoother_config_filename`（:39-42，默认 qp_spline）、`planner_config_path`（:55-58，相对路径）、`publish_estop=false`（:60）、`enable_trajectory_stitcher=true`（:61）。本机 planning.conf 把其中三个改成**绝对 `/apollo/...`**：`--traffic_rule_config_filename`（:2）、`--smoother_config_filename=...discrete_points_smoother_config.pb.txt`（:14，:12-13 是被注释掉的 spiral/qp_spline 两行），并调了 `--planning_upper_speed_limit=10.0`（:3）、`--default_cruise_speed=10.0`（:4）、`--enable_reference_line_stitching=false`（:15）等。加新 flag 必须 `.cc` + `.h` 同改（planning_gflags.h 同目录）。

**⚠️ 相对 vs 绝对的区别在这里才显出来**：写相对路径（如 `.cc` 默认的 `modules/planning/.../traffic_rule_config.pb.txt`）时，能否找到取决于**调用方用的是哪个 env 变量**以及**进程 CWD**（§2.4 第 3/6/7 步）；写绝对 `/apollo/...` 则永远命中 ④ 软链、行为可预期。本机 conf 里的路径基本都是绝对的，照抄这个习惯。

`global_flagfile.txt` 现状（read 核）：82 行，18-82 行是 dreamview 选图 append 出来的 33 组 `--map_dir`，**生效值 = 最后一行 :82 `--map_dir=/apollo/modules/map/data/apollo_virutal_map`**（`bdk_0618` 在 :76、`demo` 在 :78、`borregas_ave` 在 :80，都被覆盖）。任何模块 conf 里**都不要再写 `--map_dir`**，写了会盖掉选图结果。

control 的 flag 链**没有** `--flagfile`：control.conf 全 53 行（已核）里没有任何 `--flagfile` 行，即 control 进程不加载 global_flagfile.txt；它靠 `--pipeline_file`（:1）+ `--calibration_table_file`（:6）+ 一堆周期/保护参数自足。

### 3.3 dag/conf 一致性硬约束

| 约束 | 写错的后果 |
|---|---|
| dag `class_name` = `CYBER_REGISTER_COMPONENT` 注册名（非限定） | `CreateClassObj` 返 nullptr，mainboard 退出（module_controller.cc:93） |
| dag `module_library` 相对 `APOLLO_LIB_PATH`（本机 `/opt/apollo/neo/lib`），且必须已 `buildtool build` install | `no module library ... found!`（:81-82）后 return false |
| dag readers 的 channel 与组件 conf 里的 topic 字段（如 planning 的 `chassis_topic`）**是两处，须一致** | 静默订阅错 channel（框架按 dag 建 reader，组件按 conf 命名理解语义） |
| conf/flag 路径建议写绝对 `/apollo/...` | 相对路径依赖 CWD/env，`./` 开头直接跳过 env（file.cc:439-442） |
| timer 组件不要在 dag 里写 readers | proto 里根本没这个字段 → 解析报错或被忽略 |

## 4. 修改与扩展点（二次开发）

- **改订阅 channel / qos / 队列深度**（消息组件）：编辑 ④ dag，如 `/apollo/modules/planning/planning_component/dag/planning.dag` 的 `readers`（写穿到 profile 层），重启组件生效；**不需重编**。timer 组件（control/canbus）改不了 dag，要改代码里的 `FLAGS_*_topic` 或在其 `.conf` 里覆盖同名 flag。
- **改调用周期**：timer 组件改 dag `interval`（毫秒），如 control.dag:9 `interval: 10`。消息组件没有周期字段（节拍 = 上游到率）。
- **改参数**：先 `readlink -f` 认清落点（§3.1），再改 ④ 文件；落到 profile 层的可长期驻留，落到 share 的会被下次 install 覆盖。要进版本管理则改 `/apollo_workspace/<sp>/conf/` 并 `buildtool build -p <包路径>`。
- **加一个 flag**：改 `/apollo_workspace/<pkg>/gflags/*_gflags.cc` + `.h`（planning 的在 `/opt/apollo/neo/src/modules/planning/planning_base/gflags/`，工作区副本需先 `buildtool install planning`），重编；只想运行期改值就在模块 `.conf` 里加一行。
- **一个进程跑多个 dag**：在 launch 里加 `<dag_conf>`（planning.launch:4-5 即样板），或直接 `mainboard -d a.dag -d b.dag -p <name>`。
- **起外部二进制**：launch 用 `<type>binary` + `<process_name>` 整行命令（dreamview_plus.launch:5-8 样板），可配 `<exception_handler>respawn`。
- **新建模块的六件套**：用 `buildtool create --template {component,timer_component,...} <package_path>` 生成 dag/launch/conf/BUILD/cyberfile.xml 骨架（见 CLAUDE.md 三节③ 与 `apollo-new-component`），别手写。

## 5. ⚠️ 本环境注意

- **④ 层软链落点是两套，不是一套**：CLAUDE.md 三节② 写「④ 每个文件都指向 `/opt/apollo/neo/share`」**已过期**；实测 374 个指向 `/apollo_workspace/profiles/current`（→ARCF_40P）、339 个指向 share（2026-09-08）。**以实测为准，改任何 conf/dag 前先 `readlink -f`**。
- **搜 `/apollo/...` 必须 `grep -R`**：`-r` 不跟随符号链接，整棵 ④ 树会返回空，容易误判「没人引用这个 channel」。
- **`bazel build` 不算装好**：dag 里的 `.so` 只从 `APOLLO_LIB_PATH=/opt/apollo/neo/lib` 找（module_controller.cc:79-80），必须 `buildtool build -p` 完成 install；插件索引也只看 `/opt/apollo/neo/share/cyber_plugin_index`（`APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`）。
- **control.conf:2-5 指向的目录不存在**：`--control_conf_file=/apollo/modules/control/conf/control_conf.pb.txt` 等 4 行（含 mpc/lateral/longitudinal）指向 `/apollo/modules/control/conf/`，**该目录实测不存在**（`ls` 报 No such file）；`/apollo/modules/control/` 下只有 `control_component/` 与 `controllers/`。这些 flag 在 control 源码中未被消费（grep `FLAGS_control_conf_file` 在 `/opt/apollo/neo/src/modules/control` 下**零命中**，只有 `FLAGS_pipeline_file` 被用：control_component.cc:49-54 `ACHECK(GetProtoFromFile(FLAGS_pipeline_file, ...))`），所以是**遗留死行，不影响启动**；真正生效的是 `--pipeline_file`（control.conf:1）→ `pipeline.pb.txt`，各控制器参数在 `/apollo/modules/control/controllers/<x>/conf/controller_conf.pb.txt`。
- **control.conf:6 写成 `---calibration_table_file=`（三个减号）**：gflags 是否容忍该前缀**未实测（待核）**；如果标定表看起来没生效，先怀疑这一行。
- **`--map_dir` 只认 global_flagfile.txt 最后一行**（:82 = `apollo_virutal_map`）；模块 conf 里不要写。map 没选对 = planning 只发 not_ready 空轨迹，与代码无关。
- **`/apollo/scripts/<模块>.sh` 与 `buildtool bootstrap start` 大半不适用**（拼死路径），launch 一律 `cyber_launch start <绝对路径>`、dag 一律 `mainboard -d <绝对路径>`（CLAUDE.md 二节）。
- `cyber_launch.py:446` 用的是 `ET.Element.getchildren()`（Py3.9 已移除），本机是否可用未实测；只有写了 `<environment>` 的 launch 才会走到这行——本机三个已读 launch 都没写。
- `/apollo/modules/control/controllers/` 下**实测存在 `demo_control_task/conf/`**，与 CLAUDE.md 五节「demo_control_task 已删」不符（本文只做目录 ls，是否注册/可加载**待核**）。

## 6. 验证命令（本环境形态）

```bash
# 判定 ④ 层落点（profile 覆盖层 or 出厂件）——改 conf 前必做
readlink -f /apollo/modules/planning/planning_component/dag/planning.dag
ls -l /apollo/modules/control/control_component/conf/            # 一次看全目录的箭头
readlink /apollo_workspace/profiles/current                      # → /apollo_workspace/profiles/ARCF_40P
find /apollo/modules -type l -path '*/conf/*' -printf '%l\n' | sort | uniq -c | sort -rn | head

# 起单个 dag（前台打屏，调单模块首选）
mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag
# 起 launch（planning.launch 会同时拉 external_command_process.dag）
cyber_launch start /apollo/modules/planning/planning_component/launch/planning.launch
cyber_launch stop  /apollo/modules/planning/planning_component/launch/planning.launch

# 校验路径解析是否如预期（日志里有现成证据）
#   mainboard 的 "mainboard: use dag conf <path>" / "use module library <path>"（module_controller.cc:58、:85）
#   组件的 "use config file: <path>" / "use flag file: <path>"（component_base.h:79、:89）
grep -R 'use dag conf\|use module library\|use config file\|use flag file' /apollo/data/log/ | tail

# env 前缀现状
env | grep -E '^APOLLO_(DAG|CONF|FLAG|LAUNCH|LIB|PLUGIN)' | sort
# 生效 map_dir（取最后一行）
grep -n 'map_dir' /apollo/modules/common/data/global_flagfile.txt | tail -1
```

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线：Apollo 11.0.0 package 工作区（`.workspace.json` = apollo-universe-11 11.0.0），profile = `ARCF_40P`。
- **本轮 read 打开核对过的文件**（行号均出自这些）：cyber/proto/dag_conf.proto（全）；cyber/proto/component_conf.proto（全）；cyber/mainboard/module_controller.cc（全）；cyber/common/file.cc（415-479）；cyber/component/component_base.h（55-124）；cyber/tools/cyber_launch/cyber_launch.py（390-504）；④ planning.dag / prediction.dag / control.dag / canbus.dag（各全文）；④ planning.launch（全）、dreamview_plus.launch、localization.launch（全文）；④ planning.conf（1-18）、control.conf（全 53）；④ global_flagfile.txt（1-18、74-82）；planning_gflags.cc（1-62）；adapter_gflags.cc（26-70）；control_component.cc（44-123）；_template.md；12_planning源码/02_planning_component主循环.md；.manual_work/inventory/cyber_messages_inventory.md（全）。
- 非 read 证据：`readlink`/`ls -l`（§3.1 表与统计 374/339）、`env | grep '^APOLLO_'`（§2.4 表）、`find` 计数、两次 `grep`（`FLAGS_control_conf_file` 零命中、cyber_launch.py 的元素名与 mainboard 参数拼装 :33/:39/:194-220 —— 后者 grep 定位、区间 :390-504 已 read）。
- **遗留待核**：① `---calibration_table_file`（三减号）gflags 是否容错；② cyber_launch.py:446 `getchildren()` 在本机 Python 版本下能否运行（无 `<environment>` 的 launch 不触发）；③ 374/339 两类落点的完整清单只做了计数与 13 条抽样，未逐包列举；④ `demo_control_task` 是否真被注册可加载（只 ls 到 conf 目录）；⑤ dag 里 `qos_profile` 除 depth 外字段（history/mps/reliability/durability，见 cyber/proto/qos_profile.proto，本轮未打开）；⑥ `Component` 模板按 readers 建 reader 的具体行号以 `../12_planning源码/02_planning_component主循环.md` §2.1-2.2 与盘点 §2 为准，本文未重复核对；⑦ 本机各模块实际运行频率未实测。
