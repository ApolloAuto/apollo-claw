# reference：cyber Component 机制与配置字段全表

所有 file:line 均现场核对（Apollo 11.0 / master）。

> **⚠️ 示例模块已更换**：原文用的 `modules/guardian/` 与 `modules/task_manager/` 在 Apollo 11.0 里
> **都已被删除**（前者只剩 `modules/common_msgs/guardian_msgs/guardian.proto` 和 `scripts/guardian.sh`，
> 后者整个不存在）。现用示例：TimerComponent 全套 → **`modules/storytelling/`**（17 文件）；
> `Component<T>` 单路输入 → **`modules/drivers/tools/image_decompress/`**。
> 下文残留的 guardian / task_manager 字样只当"某某文件长什么样"的历史描述读，**不要 `cd` 过去**。

## 1. `Component<M0,M1,M2,M3>` 源码机制

`cyber/component/component.h`：

| 位置 | 内容 |
|---|---|
| `:58-92` | 主模板，4 个模板参数默认 `NullType`（`cyber/common/types.h` 的空哨兵类）；`Initialize(const ComponentConfig&)`、`Process(4 个 shared_ptr)`、纯虚 `Proc(4 个 shared_ptr)` |
| `:94-100` | 0 路全特化 `Component<NullType,NullType,NullType,NullType>`，只有 `Initialize`，**没有 `Proc`** |
| `:102-112` | 1 路偏特化；`:114-126` 2 路；`:128-141` 3 路。`Proc` 形参个数由特化决定 |
| `:144-150` | 1 路 `Process`：`is_shutdown_` 为真直接返 true，否则 `return Proc(msg)` —— **返回值不被框架消费** |
| `:152-161` | 0 路 `Initialize`：建 Node → `LoadConfigFiles` → `Init()`，`Init()` 假则 AERROR + false |
| `:163-238` | 1 路 `Initialize`，见下表逐步 |
| `:240-362` | 2 路；`:364-502` 3 路；`:504-655` 4 路 |
| `:657-658` | `#define CYBER_REGISTER_COMPONENT(name) CLASS_LOADER_REGISTER_CLASS(name, apollo::cyber::ComponentBase)` |

1 路 `Initialize` 的生命周期（其余路数同构）：

| 步 | 行 | 说明 |
|---|---|---|
| 1 | `:166` | `node_.reset(new Node(config.name()))` —— Node 构造即加入拓扑 |
| 2 | `:167` | `LoadConfigFiles(config)`：解析 `config_file_path`（`APOLLO_CONF_PATH`）与 `flag_file_path`（`APOLLO_FLAG_PATH` + `SetCommandLineOption("flagfile")`） |
| 3 | `:169-172` | `readers_size() >= 1` 校验（2/3/4 路分别 `:255`/`:380`/`:520` 要求 ≥2/≥3/≥4），不足即 AERROR + false |
| 4 | `:174-177` | **调用用户 `Init()`**，false 即整体失败 |
| 5 | `:179` | `is_reality_mode = GlobalData::IsRealityMode()` |
| 6 | `:181-188` | 组 `ReaderConfig`（channel / qos_profile / pending_queue_size 全取 `readers(0)`）与 statistics 的 `role_attr` |
| 7 | `:190-211` | `weak_ptr<Component<M0>> self` 捕获自己（避免引用环），lambda 内 `self.lock()->Process(msg)` 并采样 proc/cyber latency |
| 8 | `:215-219` | reality 模式 `CreateReader<M0>(reader_cfg)`（无回调，走调度器）；否则带回调（blocker 直通） |
| 9 | `:225` | `readers_.emplace_back(...)` |
| 10 | `:227-229` | **非 reality 到此结束，不进调度器** |
| 11 | `:231-237` | `DataVisitor<M0>` → `CreateRoutineFactory<M0>` → `sched->CreateTask(factory, node_->Name())`；**协程名 = `config.name()`** |

2/3/4 路在 sim 模式下由 reader0 的回调捕获 blocker1..3（`:289-290`、`:421-424`、`:567-572`），用
`IsPublishedEmpty()` + `GetLatestPublishedPtr()` 手工做 AllLatest —— 与 reality 路径实现独立。

## 2. `TimerComponent` 源码机制

`cyber/component/timer_component.h:35-62`：继承 `ComponentBase`，公开 `Initialize(const TimerComponentConfig&)`、
`Clear()`、`Process()`、`GetInterval()`，私有纯虚 **无参** `Proc()`，成员 `interval_`、`std::unique_ptr<Timer> timer_`。

`cyber/component/timer_component.cc`：

| 行 | 内容 |
|---|---|
| `:29-34` | `Process()`：`is_shutdown_` 为真返 true，否则 `return Proc()` |
| `:37-40` | **`config` 必须同时有 `name` 与 `interval`**，缺任一 → AERROR "Missing required field in config file." + false |
| `:41-42` | 建 Node + `LoadConfigFiles` |
| `:43-45` | 调 `Init()`，false 即失败（**注意这里没有 AERROR，只静默返 false**） |
| `:46` | `interval_ = config.interval()` |
| `:48-51` | statistics channel 固定 `statistics::TIMER_COMPONENT_CHAN_NAME` |
| `:53-62` | **用 `shared_ptr` 捕获自己**（不是 weak_ptr）→ `component → timer_ → TimerTask::callback → component` 引用环，不调 `Shutdown()` 就泄漏 |
| `:63-64` | `timer_.reset(new Timer(config.interval(), func, false))` + `timer_->Start()` |
| `:68` | `Clear()` = `timer_.reset()` |

与 `Component<T>` 的差异：驱动源是 `Timer` → TimingWheel → `cyber::Async` 协程池（不是 DataVisitor）；
无 readers、不 `CreateTask`（故 `ComponentBase::Shutdown` 里的 `RemoveTask(node_->Name())` 对它是空操作）；
仿真模式完全不触发。

`interval` 约束在 `cyber/timer/timer.cc:51-60`（`InitTimerTask`）：`period == 0` → AERROR "Max interval must
great than 0" + false；`period >= TIMER_MAX_INTERVAL_MS`（65536）→ AERROR + false。时间轮分辨率 2ms、ceil 落桶，
所以 interval 取 2 的倍数最准。

## 3. `ComponentBase`（两种 Component 的公共基类）

`cyber/component/component_base.h`：

| 行 | 成员 | 说明 |
|---|---|---|
| `:41` | `class ComponentBase : public std::enable_shared_from_this<ComponentBase>` | 所以能 `shared_from_this()` |
| `:43-44` | `template <typename M> using Reader = cyber::Reader<M>;` | 子类里可直接写 `Reader<T>` |
| `:48-49` | `virtual bool Initialize(const ComponentConfig&) { return false; }` 与 `Initialize(const TimerComponentConfig&) { return false; }` | **dag 段放错时命中的就是这两个默认实现** |
| `:50-60` | `Shutdown()`：`is_shutdown_.exchange(true)` 幂等 → `Clear()` → 每个 `reader->Shutdown()` → `RemoveTask(node_->Name())` |
| `:62-65` | `GetProtoConfig<T>(T*)` = `common::GetProtoFromFile(config_file_path_, config)` |
| `:68` | 纯虚 `Init()`，protected |
| `:69` | `virtual void Clear() { return; }` |
| `:70` | `ConfigFilePath()` |
| `:72-93` | `LoadConfigFiles(ComponentConfig)`：conf 走 `GetFilePathWithEnv(..., "APOLLO_CONF_PATH", ...)`，失败 AERROR `conf file [...] not found!` 但仍原样赋值；flag 走 `APOLLO_FLAG_PATH` 后 `google::SetCommandLineOption("flagfile", ...)` —— **进程级** |
| `:95-116` | `LoadConfigFiles(TimerComponentConfig)`，逻辑同上 |
| `:118-121` | `is_shutdown_` / `node_` / `config_file_path_` / `readers_` |

## 4. 注册与加载链路

`CYBER_REGISTER_COMPONENT(X)` → `CLASS_LOADER_REGISTER_CLASS(X, apollo::cyber::ComponentBase)`
（`cyber/class_loader/class_loader_register_macro.h`）→ 匿名 namespace 里定义静态注册对象。注册表键是
**`#Derived` 字面 token**（宏字符串化），查找键是 `typeid(Base).name()`，所以 dag 的 `class_name` 必须与宏参数
逐字符一致；基类写法不参与查找。

启动链（`cyber/mainboard/module_controller.cc`）：`-d` 的 dag 路径经 `APOLLO_DAG_PATH` 解析，找不到 →
`no dag conf [...] found!`（`:55`），成功打 `mainboard: use dag conf`（`:58`）；`Start initialize dag`（`:67`）；
整体失败 → `Failed to load module: <path>`（`:69`）；`module_library` 经 `APOLLO_LIB_PATH` 解析，找不到 →
`no module library [...]`（`:81`），成功打 `mainboard: use module library`（`:85`）；dag 解析失败 →
`Get proto failed, file: ...`（`:115`）。

注册失败的日志（都是 AWARN，不是 error）：`"Class factory objs counts is 0, maybe registerclass failed."`
（`cyber/class_loader/utility/class_loader_utility.cc:240`，`.so` 加载了但没注册对象）→
`"CreateClassObj failed, ensure class has been registered. "`（`cyber/class_loader/class_loader.h:84`，
注册名与请求名不一致）。**都不会让进程退出**，只表现为组件没上线。

`mainboard` 参数（`cyber/mainboard/module_argument.cc`）：`-d/--dag_conf`（可重复，`:95`、`:128-131`）、
`-p/--process_group`（`:138`，缺省 `mainboard_default`，`:64-65`，随后 `GlobalData::SetProcessGroup`，`:80`）、
`-s/--sched_name`（目前无效）、`--plugin=<xml>`（`:144`）、`--disable_plugin_autoload`（`:147`）、
`-c/-h` cpu/mem profile（默认文件名 `${process_group}_cpu.prof` / `_mem.prof`，`:73`、`:77`）。
dag 列表为空即报错退出（`:181`）。

## 5. Reader / Writer / Service 完整用法

`cyber/node/node.h` 的工厂方法（返回 `shared_ptr`）：

| 行 | 签名 |
|---|---|
| `:58` | `const std::string& Name() const` —— 即 dag 的 `config.name()`，也是协程名 |
| `:69` | `CreateWriter<MessageT>(const proto::RoleAttributes& role_attr)` |
| `:80` | `CreateWriter<MessageT>(const std::string& channel_name)` |
| `:94` | `CreateReader<MessageT>(const std::string& channel_name, const CallbackFunc<MessageT>&)` |
| `:108` | `CreateReader<MessageT>(const ReaderConfig& config, const CallbackFunc<MessageT>&)` —— 能设 qos 与 pending_queue_size |
| `:122` | `CreateReader<MessageT>(const proto::RoleAttributes&, const CallbackFunc<MessageT>&)` |
| `:136` | `CreateService<Request, Response>(const std::string& service_name, const ServiceCallback&)` |
| `:150` | `CreateClient<Request, Response>(const std::string& service_name)` |

裸用法（不做 Component 时）：`auto node = apollo::cyber::CreateNode("my_node");` 然后
`node->CreateWriter<Foo>("/apollo/foo")` / `node->CreateReader<Foo>("/apollo/foo", cb)`。

契约与坑：
- **同一 Node 同一 channel 只能建一个 Reader**（`node.h:208/226/244` 重复返 nullptr + AWARN）。
- **同一进程同一 channel 只有一个 Receiver**（`reader_base.h`），多个 Node 订阅同 channel 时共享。
- **同一进程同一 channel 必须用同一消息类型**，否则 AERROR "same channel ... same message type"，且因监听表只增不删，一旦踩到进程内永久生效。
- 裸 Reader 的协程名是 `node_name + "_" + channel_name`（`reader.h:295`），配 sched conf 时用这个；Component 用 `config.name()`。
- `pending_queue_size` 默认 1（`reader.h:50`），慢处理即丢帧并打 `read buffer overflow, drop_message[N]`。
- Service 会额外注册 `<name>__SRV__REQUEST/RESPONSE` 两个 channel，但不 Join ChannelManager（monitor/recorder 看不到）；业务 channel 名避开 `__SRV__`。
- 同名 node 会让后注册方给自己发 SIGINT（`node_manager.cc:99-105`），用 `node_name + pid` 唯一化。

## 6. dag 字段全表

dag 是 text proto，顶层 `DagConfig`（`cyber/proto/dag_conf.proto:23-25`），`module_config` 可重复：

| 字段 | 行 | 语义 |
|---|---|---|
| `module_config[].module_library` | `dag_conf.proto:18` | 要 dlopen 的 `.so`，相对 `APOLLO_LIB_PATH`（写 `modules/foo/libfoo_component.so`，不带 `bazel-bin/`） |
| `module_config[].components[]` | `:19` | `ComponentInfo{class_name, config: ComponentConfig}`（`:7-10`），消息触发组件 |
| `module_config[].timer_components[]` | `:20` | `TimerComponentInfo{class_name, config: TimerComponentConfig}`（`:12-15`），定时组件 |

`cyber/proto/component_conf.proto`：

| 字段 | 行 | 语义 |
|---|---|---|
| `ComponentConfig.name` | `:16` | Node 名 = 协程名 = classic/choreography sched conf 的 `tasks[].name` |
| `ComponentConfig.config_file_path` | `:17` | 业务 proto conf，经 `APOLLO_CONF_PATH` 解析，供 `GetProtoConfig<T>()` |
| `ComponentConfig.flag_file_path` | `:18` | gflags 文件，经 `APOLLO_FLAG_PATH` 解析后 `SetCommandLineOption("flagfile")`，**进程级** |
| `ComponentConfig.readers[]` | `:19` | `ReaderOption` 列表；`readers(0)` 是驱动 channel，顺序 = `Proc` 参数顺序 |
| `ReaderOption.channel` | `:8` | 订阅的 channel 名 |
| `ReaderOption.qos_profile` | `:9-10` | `QosProfile`，`depth` = 已处理消息容量，同时决定 Reader blocker 容量与 RTPS history |
| `ReaderOption.pending_queue_size` | `:11-12` | **`[default = 1]`**（另见 `cyber/node/reader.h:50` 的 `DEFAULT_PENDING_QUEUE_SIZE = 1`），未处理消息队列容量，高频通道必须显式调大 |
| `TimerComponentConfig` | `:22-27` | `name` / `config_file_path` / `flag_file_path` 同上，**外加 `interval`（毫秒，`:26`），没有 `readers`** |

**两个 config 消息里都没有任何 writer 字段** —— 这是"输出 channel 只能来自 gflags 或业务 conf"的根本原因。

## 7. launch 字段全表

`cyber_launch start <file>` 解析 `cyber/tools/cyber_launch/cyber_launch.py`。顶层 `<cyber>`，其下：

| 元素 | 行 | 语义 |
|---|---|---|
| `<environment><VAR>值</VAR></environment>` | `:445-447` | 逐个 `os.environ[tag] = text`，起进程前生效 |
| `<module>` | `:449` | 每个 `<module>` 起一个进程，可多个 |
| `<module><name>` | `:450` | 仅日志用的模块名 |
| `<module><process_name>` | `:451-452` | → `mainboard -p X`；缺省 `mainboard_default_<pid>`。**决定读 `cyber/conf/X.conf` 调度配置** |
| `<module><sched_name>` | `:453` | → `-s`，缺省 `CYBER_DEFAULT`；当前实现不生效 |
| `<module><type>` | `:454` | `library`（默认，走 mainboard 加载 dag）或 `binary`（直接起可执行文件） |
| `<module><cpuprofile>` / `<memprofile>` | `:455-456` | gperftools profile 输出文件 |
| `<module><exception_handler>` | `:457` | 进程异常时的处理动作 |
| `<module><respawn_limit>` | `:458-462` | 自动重启次数上限，非数字则用默认 |
| `<module><nice>` | `:463` | 进程 nice 值 |
| `<module><dag_conf>` | `:476` | `get_param_list` 读取，**可重复**，每个 → 一个 `-d`；同进程多 dag 共享 scheduler |
| `<module><plugin>` | `:481` | 可重复，→ `mainboard --plugin <xml>`；普通 Component 不需要 |

`get_param_value(module, key, default)` 在 `:392`，`get_param_list` 在 `:405` —— **未列出的标签会被静默忽略**。

## 8. cyberfile.xml 字段语义

全仓 290 个，与 `BUILD` 里的 `apollo_package()` 一一对应（每个"可独立发布的 bazel 包"根目录一份）。以
`modules/storytelling/cyberfile.xml:1-29` 为准：

| 字段 | 语义 |
|---|---|
| `<package format="2">` | 根元素，格式版本固定 2 |
| `<name>` | 包名，buildtool 的安装/依赖键。命名约定：第三方 `3rd-*`、聚合包 `module-*`、模块直接用业务名 |
| `<version>` | `local` 表示本地源码包 |
| `<description>` / `<maintainer email=...>` / `<license>` / `<url type=...>` | 元信息，不影响构建 |
| `<type>` | `module`（业务模块）等；决定 buildtool 的处理方式 |
| `<src_path url=...>` | 该包在仓库中的 bazel 路径，如 `//modules/storytelling` |
| `<depend type="binary" repo_name="X" lib_names="X">X</depend>` | 二进制依赖包；`repo_name` 是远端仓库名，`lib_names` 是安装出的库名 |
| `<depend>X</depend>` | 源码/工具依赖，如 `bazel-extend-tools`（= `tools/` 目录的包名） |
| `<depend expose="False">3rd-*</depend>` | 传递性第三方依赖，不对下游暴露 |

行为影响：`apollo_package()` 固定生成 `_install_cyberfile` 把本目录 `cyberfile.xml` 装到 `<package_name>`；
文件缺失 → glob 到空、`find_all_package.py` 找不到该包、`build_pkg` 漏编。`<depend>` 只对包管理模式
（buildtool）生效，源码模式 `bazel build` 完全依赖 `BUILD` 的 `deps`。

## 9. Bazel 宏完整签名（`tools/apollo_package.bzl`）

| 宏 | 定义行 | 关键约束与展开 |
|---|---|---|
| `apollo_component(name, srcs, hdrs, deps, copts, ...)` | `:583-600` | `name` 必须 `lib*.so`（`:584-585` 否则 fail）；**不允许传 `alwayslink`**（`:586-587` fail）；内部先 `apollo_cc_library(name="DO_NOT_IMPORT_<中间名>", ...)`（`:592-593`），再 `cc_binary(name, linkshared=True, linkstatic=True, deps=[":DO_NOT_IMPORT_..."])`（`:595-600`）。单测要链实现须 deps `DO_NOT_IMPORT_<name>` |
| `apollo_cc_library` | `:602-645` | 展开成 `cc_binary(lib<name>.so, linkshared, linkstatic)` + `cc_library(<name>, srcs=[":lib<name>.so"], alwayslink=True)`；强制动态库、public visibility、`alwayslink`（`:643-645`）。deps 引用写 `":<name>"`（无 lib 前缀、无 .so 后缀） |
| `apollo_cc_binary` / `apollo_cc_test` | `:579-581` / `:575-577` | `dynamic_fill_deps` 的薄封装 |
| `apollo_plugin(name, srcs, hdrs, deps, copts, description)` | `:647-678` | `name` 必须 `lib*.so`（`:652-653`）；**`description=":plugins.xml"` 必填**（`:648-649` fail）；展开 `cyber_plugin_description`（`:656-660`）+ 原生 `cc_library(..., alwayslink=True)`（`:664-671`）+ `cc_binary(linkshared, linkstatic)`（`:673-678`）。**普通 Component 不要用它** |
| `apollo_package(enable_source=True)` | `:234-337` | **必须写在 BUILD 最末**（靠 `native.existing_rules()` 反射，`:236-237`）；按 rule kind 生成安装规则（`*.so` → `lib/<pkg>`、其他 cc_binary → `bin`、filegroup → `share/<pkg>`、cc_proto_library → `include/<pkg>`）；跳过 `testonly=True`；固定生成 `_install_cyberfile`、`install_module_src`、`install_header_src`，以及递归聚合的 `install` / `install_src` |
| `proto_library(name, srcs, deps)` | `tools/proto/proto.bzl:116` 起 | 覆盖原生同名规则，自动派生 `<name 去掉 _proto>_cc_proto` 等目标，所以 dep 写 `:foo_conf_cc_proto` |
| `cpplint()` | `tools/cpplint.bzl` | 生成 lint test，习惯放 `apollo_package()` 之后 |

`scripts/apollo_rule_check.sh:53-66` 会全仓扫描原生 cc 规则并直接 `error`，所以业务 BUILD 里不能出现裸
`cc_library` / `cc_binary`。判定当前构建模式：`grep STATUS tools/package/dynamic_deps.bzl`（0=源码，2=包管理）。

## 10. 调度与协程要点（影响 Proc 的行为）

- 协程名：Component 是 `config.name()`（`component.h:237` 的 `CreateTask(factory, node_->Name())`）；裸 Reader 是 `node_name + "_" + channel_name`。sched conf 里的 `tasks[].name` 填这个，不是 `class_name`。
- `process_group` 决定读哪个 `cyber/conf/<X>.conf`，只有 `scheduler_conf` 段被读取（`scheduler_factory.cc:56-58`）；不传 `-p` 时 group 名带 pid，命中不到文件 → 静默 classic + `default_proc_num`（16）。
- `scheduler::Instance()` 在 `cyber::Init()` 内就被调用 → **调度策略此刻冻结**，同进程无法切换。
- 协程栈 2MB 且无 guard page（`routine_context.h`）：`Proc()` 里放大数组/深递归/大 Eigen 局部量会踩坏相邻协程栈，产生随机跨模块崩溃；大缓冲放堆或成员变量。
- `Proc()` 不 Yield 会让 `Scheduler::Shutdown()` 永久挂住（`processor.cc:74-76` 会 join），表现为进程无法退出。
- `cpuset` 语法只支持 `"3"` / `"0-7"` / `"0-7,16-23"`，写错则进程启动即静默 `exit(0)`（`pin_thread.cc:45-48`，日志还是 ADEBUG）。
- 有效优先级 0..19；classic 会钳到 19 并 AWARN，choreography 不钳。改完 sched conf 靠启动日志 `create croutine: <name>`（`scheduler.cc:55`）核对。

