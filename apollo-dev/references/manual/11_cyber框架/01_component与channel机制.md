# 01 Component 与 channel 机制

<!--
file: references/manual/11_cyber框架/01_component与channel机制.md
scope: 11.0（默认）
tags: cyber, Component, ComponentBase, TimerComponent, CYBER_REGISTER_COMPONENT, Node, Reader, Writer, CreateReader, CreateWriter, AllLatest, DataVisitor, dag, 消息触发, 定时触发, class_loader, plugins.xml
sources:
- /opt/apollo/neo/src/cyber/component/component_base.h（全文 127 行）
- /opt/apollo/neo/src/cyber/component/component.h（36-285、594-663 行精读）
- /opt/apollo/neo/src/cyber/component/timer_component.h（全文 67 行）
- /opt/apollo/neo/src/cyber/component/timer_component.cc（全文 73 行）
- /opt/apollo/neo/src/cyber/proto/component_conf.proto（全文 27 行）
- /opt/apollo/neo/src/cyber/node/node.h（44-123、190-255 行精读）
- /opt/apollo/neo/src/cyber/node/writer.h（35-99、160-184 行精读）
- /opt/apollo/neo/src/cyber/node/reader.h（53-192 行精读）
- /opt/apollo/neo/src/cyber/data/data_visitor.h（60-119 行精读）
- /opt/apollo/neo/src/cyber/data/fusion/all_latest.h（70-129 行精读）
- /opt/apollo/neo/src/cyber/mainboard/module_controller.cc（55-134 行精读）
- /opt/apollo/neo/src/cyber/plugin_manager/plugin_description.cc（95-124 行精读）
- /opt/apollo/neo/src/cyber/examples/timer_component_example/timer_component_example.cc（全文）
- /opt/apollo/neo/src/cyber/examples/timer_component_example/timer.dag（全文）
- /opt/apollo/neo/src/cyber/examples/common_component_example/common_component_example.h（17-31 行）
- /opt/apollo/neo/src/cyber/examples/common_component_example/common.dag（全文）
- /opt/apollo/neo/src/modules/planning/planning_component/planning_component.h（95-107 行）
- /apollo_workspace/.manual_work/inventory/cyber_messages_inventory.md（已有盘点结论，引用其 §2/§5）
-->

## 0. 一句话作用

CyberRT 里**所有业务模块的唯一载体**：`Component<M0..M3>`（消息触发）与 `TimerComponent`（定时触发）都继承 `ComponentBase`，被 `mainboard` 按 dag 用 class_loader 实例化，进程内不写 `main()`；channel 的**输入**由框架按 dag readers 自动建 `Reader` 并驱动 `Proc`，**输出**由用户在 `Init()` 里 `node_->CreateWriter<M>()` 自建、在 `Proc` 里 `Write()` 发出。PnC 链路里 planning 是 3 消息触发型（见 `../12_planning源码/02_planning_component主循环.md`），control/canbus 是定时触发型。

## 1. 关键符号与文件

| 符号/类/概念 | 文件（绝对路径；src 与 include 两树均有，除 .cc 只在 src） | 行号(已核) | 说明 |
|---|---|---|---|
| `apollo::cyber::ComponentBase` | /opt/apollo/neo/src/cyber/component/component_base.h | 41 | 所有组件的虚基类，`enable_shared_from_this`；成员 `node_`/`config_file_path_`/`readers_`/`is_shutdown_`（118-121） |
| `ComponentBase::Init()` | 同上 | 68 | **纯虚**，protected：用户组件必须实现；框架在 Initialize 内调用 |
| `ComponentBase::Initialize(...)` | 同上 | 48-49 | 两个虚重载（`ComponentConfig` / `TimerComponentConfig`），基类实现直接 `return false`，由派生类覆盖 |
| `ComponentBase::GetProtoConfig<T>` | 同上 | 62-65 | 读 dag 的 `config_file_path` 成 proto（走 `common::GetProtoFromFile`） |
| `ComponentBase::LoadConfigFiles` | 同上 | 72-93（Component 版）/95-116（Timer 版） | conf 用 `APOLLO_CONF_PATH`、flag 用 `APOLLO_FLAG_PATH` 经 `GetFilePathWithEnv` 解析；flag 以 `google::SetCommandLineOption("flagfile", ...)` 生效（91/114） |
| `ComponentBase::Shutdown` | 同上 | 50-60 | 幂等（`is_shutdown_.exchange`）：`Clear()` → 逐个 `reader->Shutdown()` → `scheduler::RemoveTask(node_->Name())` |
| `Component<M0,M1,M2,M3>` | /opt/apollo/neo/src/cyber/component/component.h | 60（注释 42-57） | 主模板，**最多 4 路 channel**；`Process` public 包装（73-75）、`Proc` private 纯虚（88-91） |
| 0/1/2/3 消息特化 | 同上 | 95 / 103 / 115 / 129 | `Component<>`（无 reader，只写）、`<M0>`、`<M0,M1>`、`<M0,M1,M2>` |
| `Component<M0>::Initialize` | 同上 | 163-238 | 建 node → LoadConfigFiles → 校验 readers_size → `Init()` → 建 reader → DataVisitor+croutine 调度 |
| 4 消息版 Initialize 收尾 | 同上 | 605-655 | 四 reader 入 `readers_`（610-613）→ `DataVisitor<M0..M3>`（651）→ `CreateRoutineFactory`（652-653）→ `sched->CreateTask`（654） |
| `CYBER_REGISTER_COMPONENT(name)` | 同上 | 657-658 | 即 `CLASS_LOADER_REGISTER_CLASS(name, apollo::cyber::ComponentBase)`；**参数写非限定类名** |
| `apollo::cyber::TimerComponent` | /opt/apollo/neo/src/cyber/component/timer_component.h | 35 | `Initialize(TimerComponentConfig)` 47、`Process()` 49、`GetInterval()` 50、`virtual bool Proc()=0` 58、`interval_`/`timer_` 60-61 |
| TimerComponent 实现 | /opt/apollo/neo/src/cyber/component/timer_component.cc | Initialize 36-66；Process 29-34；Clear 68 | 必须有 `name`+`interval`（37-40）；`Init()` 后建 `Timer(interval, func, false)` 并 `Start()`（63-64） |
| `ComponentConfig` / `TimerComponentConfig` / `ReaderOption` | /opt/apollo/neo/src/cyber/proto/component_conf.proto | 15-20 / 22-27 / 7-13 | dag 里 `config{}` 的 schema：readers 只有 `channel`/`qos_profile`/`pending_queue_size`（默认 **1**）；timer 的 `interval` 单位**毫秒**（:26） |
| `apollo::cyber::Node` | /opt/apollo/neo/src/cyber/node/node.h | 44；`friend class Component/TimerComponent` 46-48 | 组件的 `node_` 即此；`Name()` 58 |
| `Node::CreateWriter<M>` | 同上 | 69-70（RoleAttributes 版）/80-81（channel 名版） | 返回 `shared_ptr<Writer<M>>`；实现转发 192-200 |
| `Node::CreateReader<M>` | 同上 | 94-96（channel+回调）/108-110（`ReaderConfig`+回调）/122-123（`RoleAttributes`+回调） | 回调默认 `nullptr`；实现 204-249 |
| `Writer<MessageT>` | /opt/apollo/neo/src/cyber/node/writer.h | 42（注释 35-40）；`Write` 76 / 85；`HasReader` 94 | 唯一职责是往 role_attr 指定 channel 发消息；`Write` 有值与 shared_ptr 两版（实现 166/173，均先判 `IsInit()`） |
| `Reader<MessageT>` | /opt/apollo/neo/src/cyber/node/reader.h | 69（注释 53-66）；`Observe` 108、`Empty` 129、`GetLatestObserved` 171、`GetOldestObserved` 178、`Begin` 185、`SetHistoryDepth` 157 | 两种用法：给回调，或自己 `Observe()` 把 PublishQueue 拉到 ObserveQueue 再取最新/最旧 |
| `data::DataVisitor<M0..M3>` | /opt/apollo/neo/src/cyber/data/data_visitor.h | 4 消息版 AddNotifier 63、`AllLatest` 64-65；3 消息版 AddNotifier **105**、`AllLatest` 106-107 | **只给 M0 的 channel 注册 notifier** → 只有 M0 能唤醒协程 |
| `fusion::AllLatest` | /opt/apollo/neo/src/cyber/data/fusion/all_latest.h | 3 消息版 ctor/回调 **98-119**（判空 return 111-113、Fill 115-117）；`Fusion` 121-129 | 融合策略：M0 到达时取其余 buffer 的 `Latest()`，缺一路则直接 return（不触发） |

## 2. 机制与数据流

### 2.1 生命周期：dag → mainboard → class_loader → LoadConfigFiles → Init → Proc

1. **进程起点**：`mainboard -d <dag>`（或 `cyber_launch start <launch>` 间接调 mainboard）。`ModuleController` 先把每个 dag 解析成 `DagConfig`、统计组件数（module_controller.cc:121-133，含 timer 组件时额外加 `TaskPoolSize()`，:62-64），再逐个 `LoadModule`（:66-72）。
2. **加载 .so**：`module_library` 经 `GetFilePathWithEnv(..., "APOLLO_LIB_PATH")` 解析（:79-80，本机 `APOLLO_LIB_PATH=/opt/apollo/neo/lib`，env 实测）→ `class_loader_manager_.LoadLibrary(load_path)`（:87）。**dag 里写的是相对路径**（如 `modules/planning/planning_component/libplanning_component.so`）。
3. **按 class_name 造对象**：`components{}` 与 `timer_components{}` 分别遍历，`CreateClassObj<ComponentBase>(class_name)`（:91-92 / :101-102）→ 立即 `base->Initialize(component.config())`（:93 / :103），**任一返回 false 则整个 mainboard 启动失败**。class_name 必须与 `CYBER_REGISTER_COMPONENT` 注册的名字逐字符相同。
4. **Initialize 内部固定顺序**（消息型 component.h:152-161/163-177/249-263、定时型 timer_component.cc:41-46）：
   `node_.reset(new Node(config.name()))` → `LoadConfigFiles(config)` → （消息型）校验 `readers_size()` 够不够模板参数个数 → **用户 `Init()`** → （消息型）建 reader + 建 DataVisitor + `scheduler::CreateTask`；（定时型）`interval_` 赋值 + `Timer::Start()`。
   ⇒ **conf 与 gflags 在 `Init()` 之前就绪**：`Init()` 里可以直接读 `GetProtoConfig(&config_)` 与 `FLAGS_*`。
   ⇒ **`Init()` 返回 false 会阻断 reader/timer 的创建**，组件表现为「加载了但完全没有 channel 活动」。
5. **回调**：消息型由 croutine 调度 `Process(msg...)`（内部判 `is_shutdown_` 后转 `Proc`，如 :144-150、:241-247）；定时型由 `Timer` 周期调 `Process()`→`Proc()`（timer_component.cc:55-63）。两者都顺带采样 proc/cyber latency 统计（component.h:200-210、627-641；timer_component.cc:56-61），这是 `cyber_performance` 数据来源。
6. **停止**：`ComponentBase::Shutdown`（component_base.h:50-60）。

### 2.2 消息触发 vs 定时触发：怎么选

| 维度 | 消息触发 `Component<M0..M3>` | 定时触发 `TimerComponent` |
|---|---|---|
| dag 段 | `components { class_name, config{ name, config_file_path, flag_file_path, readers[...] } }`（component_conf.proto:15-20） | `timer_components { class_name, config{ name, interval, config_file_path, flag_file_path } }`（:22-27，interval 毫秒） |
| 输入 channel 来源 | **dag 的 readers**（框架建 Reader） | **dag 里没有 readers 段**；输入自己在 `Init()` 里 `node_->CreateReader` 建（典型用 gflags topic 名） |
| Proc 签名 | `Proc(const std::shared_ptr<M0>&, ...)`（1-4 个） | `Proc()` 无参 |
| 节拍 | 上游 M0 的到达率 | 固定 `interval` |
| 断流行为 | 上游停 → 本组件停（不再被调） | 照常按周期跑，需自己判输入超时 |
| 本机实例 | planning（3 输入，prediction 为节拍）、prediction（1 输入） | control（interval 10ms）、canbus（interval 10ms）（盘点 §5.2/5.3） |
| 选择建议 | 输出严格跟随某一路输入、要求「一进一出」的数据流处理 | 需要恒定频率输出（控制/底盘/驱动），或输入多路且都不宜作节拍 |
| 样例 | `Component<Driver, Driver>` + `CYBER_REGISTER_COMPONENT`：common_component_example.h:25-31；dag：common.dag:4-15 | `TimerComponent`：timer_component_example.cc:23-36；dag：timer.dag:3-9 |

### 2.3 多消息融合语义：M0 是节拍，其余只是「最新值快照」

以 3 消息版为例（4 消息版结构完全同构，只多一路 buffer）：

1. 框架给每路 reader 建 `ChannelBuffer`，容量 = 该 reader 的 `pending_queue_size`（data_visitor.h:96-101，配置默认 1，component_conf.proto:11-12）。
2. `data_notifier_->AddNotifier(buffer_m0_.channel_id(), notifier_)`（data_visitor.h:105）—— **只有 M0 的 channel 能唤醒协程**，M1/M2 到达只更新自己的 buffer。
3. `AllLatest` 在 M0 的 buffer 上挂 fusion 回调（all_latest.h:107-118）：M0 到一条 → `buffer_m1_.Latest(m1)`、`buffer_m2_.Latest(m2)`，**任一为空直接 return**（:111-113），都有才把三元组 Fill 进 fusion buffer（:115-117）；协程侧 `TryFetch`→`Fusion` 取出（data_visitor.h:117-119、all_latest.h:121-129）。

直接推论（排障常用）：

- **M0 停 → 组件完全不跑**；M1/M2 停 → 融合永不产出，M0 白到（无 Proc、也无日志）。
- `Proc` 拿到的 M1/M2 是「M0 那一刻为止的最新值」，与 M0 无时间对齐保证（对齐要自己比 header timestamp）。
- **模板参数顺序 = dag readers 顺序 = 节拍选择**，写反了语义就变了。多消息版 Initialize 是「先建非节拍 reader（无回调）、最后建 M0 reader（带回调）」，如 2 消息版 component.h:267-285。
- 单消息版没有融合：reader 回调直接进 `Process`（component.h:192-219），仍经 DataVisitor+croutine 调度（:231-237）。
- 非 reality 模式（仿真/回放注入）走另一条分支：reader 带 func 直接回调，不建调度任务（component.h:217-219、227-229）。

### 2.4 Reader/Writer 两种模式

- **Reader（读）**：① 回调模式 —— `CreateReader<M>(channel, func)`，消息到达即调 func（组件的 dag readers 走的就是这条，回调由框架合成）；② 观察模式 —— 只 `CreateReader<M>(channel)` 不给回调，用时 `Observe()` 把 PublishQueue 搬到 ObserveQueue，再 `GetLatestObserved()` / `GetOldestObserved()` / `Begin()` 遍历（reader.h:54-66、108、171、178、185）。⚠️ `pending_queue_size` 默认 1，处理慢于上游发送时**旧消息直接丢**（reader.h:62-66 原文警告）。
- **Writer（写）**：`Init()` 里 `node_->CreateWriter<M>("<channel>")`（node.h:80-81）存成员，`Proc` 里 `writer->Write(msg_ptr)`（writer.h:85）。可选 `HasReader()`（writer.h:94）判有无订阅者再发。最小样板（cyber 自带、已核）：
  ```cpp
  // timer_component_example.cc:23-26, 28-35
  bool TimerComponentSample::Init() {
    driver_writer_ = node_->CreateWriter<Driver>("/carstatus/channel");
    return true;
  }
  bool TimerComponentSample::Proc() {
    auto out_msg = std::make_shared<Driver>();
    driver_writer_->Write(out_msg);
    return true;
  }
  ```
- **dag 只声明输入**：输出 channel 在代码/conf/gflags 里，dag 里永远找不到（component_conf.proto 的 `ComponentConfig` 没有 writer 字段，:15-20）。

### 2.5 输入输出 channel 总表（本手册各模块篇的统一格式）

每篇模块手册的 channel 总表按此列写，方便 grep 与跨篇拼链路：

| channel | 消息类型 | 方向 in/out | 频率（实测/待核） | 代码位置（文件:行） | 配置来源（dag readers / conf 字段 / gflag） |
|---|---|---|---|---|---|

填表规则：in 行的「代码位置」写模板参数或 `CreateReader` 调用点，out 行写 `CreateWriter` 创建点与 `Write` 写点；频率没实测就写「待核」，不要抄 interval 当实测值（interval 只是**期望**周期）。已填好的实例见 `../12_planning源码/02_planning_component主循环.md` §2.3/§2.5。

## 3. 注册与配置

### 3.1 三处名字必须对齐

| 处 | 写什么 | 例（已核） |
|---|---|---|
| C++ 源码尾部 | `CYBER_REGISTER_COMPONENT(<非限定类名>)`，即 `CLASS_LOADER_REGISTER_CLASS(name, apollo::cyber::ComponentBase)`（component.h:657-658） | `CYBER_REGISTER_COMPONENT(PlanningComponent)`（planning_component.h:104，类在 `apollo::planning` 命名空间内，宏参数**不带命名空间**）；`CYBER_REGISTER_COMPONENT(TimerComponentSample)`（timer_component_example 系列） |
| dag | `class_name` = 与宏参数逐字符相同的字符串 | `class_name : "TimerComponentSample"`（timer.dag:4）、`class_name : "CommonComponentSample"`（common.dag:5） |
| dag | `module_library` = 相对 `APOLLO_LIB_PATH` 的 `lib*.so` 路径 | timer.dag:2、common.dag:3；本机解析根 = `/opt/apollo/neo/lib`（module_controller.cc:79-80 + env 实测） |

### 3.2 Component 注册 ≠ plugins.xml 插件注册（最容易混）

| | Component（本篇） | 插件（Task/Scenario/Controller 等，详见 `../15_二次开发手册/` 与 CLAUDE.md 四节） |
|---|---|---|
| 注册方式 | 宏 `CYBER_REGISTER_COMPONENT`，**非限定名** | `plugins.xml` 的 `<class type=... base_class=... />`，**全限定名** |
| 属性名 | 无（宏参数只有一个） | 属性只认 `type` / `base_class`（plugin_description.cc:99-100；任一为空则该条被 AWARN 丢弃，:109-114），**没有 `class_type`** |
| 基类 | 固定 `apollo::cyber::ComponentBase`（宏内写死） | 必须写**最顶层基类**全名（`apollo::planning::Task/Scenario/...`），中间基类对 PluginManager 不可见 |
| 发现机制 | mainboard 读 dag → class_loader 按 class_name 造（module_controller.cc:89-107） | 索引目录 `/opt/apollo/neo/share/cyber_plugin_index/`（本机 **118** 条，ls 实测）；库路径经 `GetFilePathWithEnv(..., "APOLLO_PLUGIN_LIB_PATH")` 解析（plugin_description.cc:118-124，本机 = `/opt/apollo/neo/lib`） |
| BUILD 宏 | `apollo_component(name="lib<x>.so")`，**不要手传 alwayslink** | `apollo_plugin`（自带 alwayslink） |

### 3.3 conf/flag 路径解析（组件装配侧）

`LoadConfigFiles`（component_base.h:72-116）对 dag 的两个字段各调一次 `GetFilePathWithEnv`：`config_file_path` 用 **`APOLLO_CONF_PATH`**、`flag_file_path` 用 **`APOLLO_FLAG_PATH`**，本机两者实测均 = `/apollo`（env 实测）。所以 dag 里可写绝对路径（planning 即如此），也可写 `modules/...` 相对路径（会拼到 `/apollo/` 下命中 ④ 层软链）。查找优先级细节（绝对路径 > env 前缀首个命中 > CWD；`./` 开头跳过 env）见 `./02_dag_launch与conf查找.md` 与盘点 §6.3（file.cc:422-472）。
conf 解析失败只 AERROR 并沿用原字符串（:76-77），flag 解析失败只 AERROR **不阻断启动**（:87）——表现为「conf 没生效但组件照跑」。

## 4. 修改与扩展点（二次开发）

新写一个组件（本环境推荐路径，**不要手写六件套**）：

```bash
cd /apollo_workspace
# 消息触发型
buildtool create --template component        modules/demo/my_comp \
  --name my-comp --class_name MyComponent \
  --channel_name /apollo/perception/obstacles \
  --channel_message_type apollo::perception::PerceptionObstacles
# 定时触发型
buildtool create --template timer_component  modules/demo/my_timer --class_name MyTimer
buildtool build -p modules/demo/my_comp      # 必须这一步才 install 到 /opt/apollo/neo/{lib,share,include}
mainboard -d /apollo/modules/demo/my_comp/dag/<生成的>.dag
```

`--template` 可选值（`buildtool create --help` 实测）：`component, timer_component, plugin, planning_scenario, planning_task, planning_traffic_rule`；常用附加参数：`--name/--class_name/--base_class_name/--channel_name/--channel_message_type/--dependencies/--config_message_name/--namespaces`。模板生成六件套（BUILD / cyberfile.xml / .h+.cc / proto / conf / dag+launch），**已存在的文件跳过不覆盖**。

生成后按需填的位置：

| 想改 | 改哪里 |
|---|---|
| 加/减输入 channel | dag 的 `readers`（顺序 = 模板参数顺序，M0 是节拍）+ 类声明的 `Component<M0,...>` 模板参数 + `Proc` 签名，三处同改 |
| 加输出 channel | `Init()` 里 `node_->CreateWriter<M>(...)` 存成员，`Proc()` 里 `Write()`（样板 2.4）；channel 名建议放 conf proto 或 gflag，别硬编码 |
| 换定时周期 | dag 的 `timer_components.config.interval`（毫秒） |
| 组件自己的 proto conf | dag `config_file_path` + `Init()` 里 `GetProtoConfig(&config_)`（component_base.h:62-65） |
| 加 gflag | dag `flag_file_path` 指的 `.conf`；flag 的 `DEFINE_*` 与声明 `.cc/.h` 必须同改 |
| 改已有组件源码 | 先 `buildtool install <包名>` 把源码拉到 ① `/apollo_workspace/<src_path>/`，改完 `buildtool build -p <相对路径>` |
| 调已装组件的参数 | 改 ④ `/apollo/<sp>/conf/*`（软链写穿，立即生效），改前先 `ls -l` 认落点（见 §5） |

## 5. ⚠️ 本环境注意

- **插件索引不扫 bazel-bin**：`APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`（env 实测），真实索引 = `/opt/apollo/neo/share/cyber_plugin_index/`，本机 **118** 条（ls 实测；CLAUDE.md 记 113，属状态漂移，以实测为准，2026-09-08）。「查 bazel-bin/cyber_plugin_index 有没有条目」这条整仓排查步骤在本机永远查不到东西。
- **只 `bazel build` 编出的 .so 运行时看不见**：必须 `buildtool build -p <路径>` 完成 install（落到 `/opt/apollo/neo/lib`）才会被 `module_controller.cc:79-87` 找到。组件加载失败第一件事是 `ls /opt/apollo/neo/lib/<sp>/lib*.so`。
- **④ 层软链可能指向 profile 覆盖层，不一定是 share**：实测 `/apollo/modules/planning/planning_component/dag/planning.dag → /apollo_workspace/profiles/current/...`（current→ARCF_40P），同目录 `planning_navi.dag → /opt/apollo/neo/share/...`。**改 dag/conf 前先 `ls -l` 或 `readlink -f`**：写穿 profile 树的改动 install 不覆盖，写穿 share 树的会被覆盖。CLAUDE.md「④ 层全部指向 share」已过期（盘点 §7 第 4 项）。
- **搜 `/apollo/...` 必须 `grep -R`**（`-r` 不跟随符号链接会返回空，容易误判「这个 channel/类名没人引用」）。搜 `/opt/apollo/neo/src` 无此问题。
- **判断符号是否存在要搜两棵树**：`/opt/apollo/neo/src/`（部分包只发头文件）与 `/opt/apollo/neo/include/`。本篇 cyber 目录在两树都完整（盘点 §1.1）。
- **`Init()` 返回 false = 静默半死**：reader/timer 都不会建，组件既不报 channel 错也不发消息；日志里只有 `Component Init() failed.`（component.h:157/175/261）。定时组件还多一个前置条件：dag 缺 `name` 或 `interval` 直接 AERROR 退出（timer_component.cc:37-40）。
- **`pending_queue_size` 默认 1**：多消息组件里非节拍路（chassis/localization 之类）通常在 dag 里显式抬到 15/50（planning.dag 即如此，盘点 §5.1），否则处理慢时旧值被丢。
- **`buildtool info <pkg>` 在本环境崩溃**（CLAUDE.md 二节），查包依赖直接读 `/opt/apollo/neo/share/packages/<pkg>/cyberfile.xml`。
- 组件名/节点名重复会破坏 topo（node.h:56-57 警告 duplicate node name not allowed）；dag `config.name` 就是节点名，复制 dag 起两份必须改名。
- **同一 Node 内同一 channel 只能有一个 Reader**：`Node::CreateReader` 三个重载都先查 `readers_` map，重名直接 `AWARN "reader with the same channel already exists."` 并**返回 nullptr**（node.h:208-212 / 226-230 / 244-248）。所以「dag readers 已声明的 channel，别在 `Init()` 里再 `CreateReader` 一遍」——第二次拿到 nullptr，后续解引用即崩。

## 6. 验证命令（静态安全，只读；不改系统状态）

```bash
# 组件 .so 是否 install 到运行时可见位置（dag module_library 相对 APOLLO_LIB_PATH 解析）
ls -l /opt/apollo/neo/lib/modules/planning/planning_component/
# dag 里的 class_name / readers / interval 原文
grep -Rn 'class_name\|channel:\|interval' /apollo/modules/planning/planning_component/dag/planning.dag
# ④ 层软链真实落点（改 conf/dag 前必做）
ls -l /apollo/modules/planning/planning_component/{dag,conf}/ ; readlink -f /apollo/modules/planning/planning_component/dag/planning.dag
# 注册宏是否与 dag class_name 一致（源码侧）
grep -Rn 'CYBER_REGISTER_COMPONENT' /opt/apollo/neo/src/modules/planning/ | head
# .so 里注册符号是否真的在（alwayslink 被裁时这里为空）
nm -DC /opt/apollo/neo/lib/modules/planning/planning_component/libplanning_component.so | grep -i 'ClassLoader\|CreateClassObj' | head
# 插件索引现状（118 条）
ls /opt/apollo/neo/share/cyber_plugin_index | wc -l
# 组件装配相关 env
env | grep -E 'APOLLO_(CONF_PATH|FLAG_PATH|LIB_PATH|PLUGIN)'
```

运行态观测（`cyber_channel -e/-l`、`cyber_node info`、`mainboard -d`、`cyber_launch start`）见 `./03_工具链实测.md`；`cyber_channel -w` 在本环境是坏的（Py2 遗留），勿用。

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。版本基线：Apollo 11.0.0 package 工作区（`.workspace.json` = apollo-universe-11 11.0.0）。
- **本轮 read 打开核对过的文件**（行号全部出自这些文件）：`src/cyber/component/component_base.h`（全 127 行）、`component.h`（36-285、594-663）、`timer_component.h`（全）、`timer_component.cc`（全）、`src/cyber/proto/component_conf.proto`（全）、`src/cyber/node/node.h`（44-123）、`node/writer.h`（35-99）、`node/reader.h`（53-102）、`src/cyber/data/data_visitor.h`（60-119）、`src/cyber/data/fusion/all_latest.h`（70-129）、`src/cyber/mainboard/module_controller.cc`（55-134）、`src/cyber/plugin_manager/plugin_description.cc`（95-124）、`src/cyber/examples/timer_component_example/{timer_component_example.cc,timer.dag}`（全）、`src/cyber/examples/common_component_example/{common_component_example.h(17-31),common.dag}`、`src/modules/planning/planning_component/planning_component.h`（95-107）、`.manual_work/inventory/cyber_messages_inventory.md`（全）、`_template.md`、`12_planning源码/02_planning_component主循环.md`。
- 非 read 证据：`env | grep APOLLO_*`（CONF/FLAG/LIB/PLUGIN 各值，§3.3/§5）、`ls /opt/apollo/neo/share/cyber_plugin_index | wc -l` = 118、`ls -l /apollo/modules/planning/planning_component/dag/`（两条软链落点不同）、`buildtool create --help`（模板清单与参数，§4）。
- **待核项**：① `writer.h`/`reader.h` 的 `Write`/`Observe` 实现已核 `Write`(166-176)，`Observe`/`GetLatestObserved` 实体（374-420 区间）与 Blocker/Transmitter 内部未读；② `node_channel_impl.h`（CreateReader/CreateWriter 的真正实现，Node 层只到转发）未读；③ `scheduler::CreateTask` 与 croutine 调度策略（classic/choreography conf）未读，本篇只到「建 task」为止；④ `class_loader_manager_.CreateClassObj` 内部（`src/cyber/class_loader/`）未读，`CLASS_LOADER_REGISTER_CLASS` 宏定义未开文件；⑤ `AllLatest` 的 2 消息与 4 消息特化只核了 4 消息版 `Fusion`(71-82) 与 3 消息版全套，2 消息版行号未核；⑥ 各模块 dag 软链到 profiles 的普遍性只抽查了 planning（planning.dag→profile、planning_navi.dag→share），全量分布待核；⑦ 本机组件实际频率（planning/control）未做录包实测；⑧ `apollo_component` / `apollo_plugin` BUILD 宏定义（`/apollo_workspace/tools/`）本轮未开文件，§3.2 该行结论沿用 CLAUDE.md 四节口径。
