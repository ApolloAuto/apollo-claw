# Apollo 插件机制参考

配套 `SKILL.md`。本文是长知识：实现原理、基类纯虚清单、conf merge 差异、已知缺陷。

## 1. 三套机制的实现原理与源码位置

### 1.1 cyber class_loader（最底层，Component 与 PluginManager 都建立在它之上）

| 环节 | 位置 | 要点 |
|---|---|---|
| 注册宏 | `cyber/class_loader/class_loader_register_macro.h:22-38` | `CLASS_LOADER_REGISTER_CLASS(Derived, Base)` → 匿名 namespace 里 `struct ProxyType##__COUNTER__`，其构造函数调 `RegisterClass<Derived, Base>(#Derived, #Base)`；静态对象 `g_register_class_N` 在 so 被 dlopen 时构造 |
| 注册实现 | `cyber/class_loader/utility/class_loader_utility.h:76-93` | **工厂表索引键是 `typeid(Base).name()`**（`:89`），第二个宏参数 `#Base` 只作为字符串标签存进 `ClassFactory`；`factory_map[class_name] = new_class_factory_obj`（`:91`） |
| 创建实例 | `class_loader_utility.h:96-113` | `CreateClassObj<Base>`：按 `typeid(Base).name()` 取桶 → 按 `class_name` 找 factory → **还要 `factory->IsOwnedBy(loader)`**（`:108`）才创建，否则返回 nullptr |
| 加载库 | `class_loader_utility.cc:206-245` | 全局的 `GetCurActiveClassLoader()` / `GetCurLoadingLibraryName()` 两个普通全局变量 + 函数内 static `loader_mutex` 串行化。**绕过 `utility::LoadLibrary` 直接 dlopen → factory 归属 nullptr → `CreateClassObj` 永远返回 nullptr** |
| 空注册告警 | `class_loader_utility.cc:238-240` | `Class factory objs counts is 0, maybe registerclass failed.`（只 AWARN） |
| 创建失败告警 | `cyber/class_loader/class_loader.h:84-86` | `CreateClassObj failed, ensure class has been registered.`（只 AWARN，返回空 shared_ptr） |
| dlopen 标志 | `cyber/class_loader/shared_library/shared_library.cc:46-51` | 全部 `RTLD_LAZY|RTLD_GLOBAL`：GLOBAL 让同名弱符号先加载者胜出（可能调到另一个插件的实现）；LAZY 让未解析符号在首次调用时才炸；`~SharedLibrary()` 不 dlclose（`:90`） |

### 1.2 cyber PluginManager（plugins.xml 那套）

| 环节 | 位置 | 要点 |
|---|---|---|
| 注册宏 | `cyber/plugin_manager/plugin_manager.h:272-273` | `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(name, base)` 就是 `CLASS_LOADER_REGISTER_CLASS(name, base)`，**没有任何额外逻辑** |
| xml 解析 | `cyber/plugin_manager/plugin_description.cc:85,96-115` | `<library path>` → `library_path_`（`:85`）；遍历 `<class>` 读 `type`（`:99`）与 `base_class`（`:100`）；存 `class_name_base_class_name_map_[class_name] = base_class_name`（`:115`）；随后 `GetFilePathWithEnv(library_path_, "APOLLO_PLUGIN_LIB_PATH", &actual_library_path_)`（`:118-120`） |
| 索引扫描 | `plugin_manager.cc:93-102,148-177` | 找 `cyber_plugin_index` 目录；`APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT` 开启时也扫 `bazel-bin`（`:153`）；否则用 `APOLLO_PLUGIN_INDEX_PATH`（`:169`）或 `<APOLLO_DISTRIBUTION_HOME>/share/cyber_plugin_index`（`:175`） |
| 是否已加载 | `plugin_manager.h:210-232` | 键是 **pair `{class_name, abi::__cxa_demangle(typeid(Base).name())}`**（`:213-214`）查 `plugin_class_plugin_name_map_` —— 这就是 `base_class` 必须写 demangle 全名的原因 |
| 惰性加载 | `plugin_manager.h:230-256` | `CheckAndLoadPluginLibrary<Base>`：pair 查不到 → AWARN `plugin of class X not found, please check if it's registered`（`:241-242`）；描述查不到 → AWARN `plugin description of class X not found`（`:250-251`）；否则 `LoadLibrary(actual_library_path_)` |
| 创建实例 | `plugin_manager.h:149-158` | `CheckAndLoadPluginLibrary` 失败 → AERROR `plugin of class X have not been loaded` + **返回 nullptr，不抛异常** |
| 类名→插件目录 | `plugin_manager.h:160-188` | `GetPluginClassHomePath<Base>`：先拿到 so 实际路径（`GetClassValidLibrary<Base>`），再在 `plugin_description_map_` 里反查哪个 description 的 `actual_library_path_` 等于它，取该 description 的 dirname，去掉 `share/` 前缀（`:177-183`） |
| 插件目录→conf | `plugin_manager.h:190-207` | `GetPluginConfPath<Base>(class_name, conf_name)`：拼 `<home>/<conf_name>`，再 `GetFilePathWithEnv(..., "APOLLO_CONF_PATH", ...)`；解析失败则原样返回相对路径 |
| 环境变量 | `scripts/apollo.bashrc:35-46` | `APOLLO_LIB_PATH=$APOLLO_ROOT_DIR/bazel-bin`、`APOLLO_CONF_PATH=$APOLLO_ROOT_DIR`、`APOLLO_PLUGIN_INDEX_PATH=$APOLLO_DISTRIBUTION_HOME/share/cyber_plugin_index`、`APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=1`、`APOLLO_PLUGIN_DESCRIPTION_PATH=$APOLLO_ROOT_DIR`、`APOLLO_PLUGIN_LIB_PATH=$APOLLO_ROOT_DIR/bazel-bin:$APOLLO_DISTRIBUTION_HOME/lib` |

### 1.3 perception 自研 registerer

全部在 `modules/perception/common/lib/registerer/registerer.h`：

- `PERCEPTION_REGISTER_REGISTERER(base_class)`（`:92-141`）生成 `<base_class>Registerer` 类，含 `GetInstanceByName(name)`（`:98-108`）、`GetAllInstances()`（`:113`）、单实例版 `GetUniqInstance()`（含 `CHECK_EQ(map.size(), 1U)`，`:132`）、`IsValid(name)`（`:136-140`）。桶键是 `GlobalFactoryMap()[#base_class]`（**基类的字面 token，不是 typeid**）。
- `PERCEPTION_REGISTER_CLASS(clazz, name)`（`:143-166`）生成匿名 namespace 里的 `ObjectFactory##name` + **`__attribute__((constructor)) void RegisterFactory##name()`**（`:152`），进程/so 加载时执行，往 `GlobalFactoryMap()[#clazz]` 里插 `map[#name]`。
- 各基类再包一层语义宏，例如 `modules/perception/radar_detection/interface/base_roi_filter.h:76-78`：`PERCEPTION_REGISTER_REGISTERER(BaseRoiFilter)` + `#define PERCEPTION_REGISTER_ROI_FILTER(name) PERCEPTION_REGISTER_CLASS(BaseRoiFilter, name)`。
- 失败时 `GetInstanceByName` 会先 `AERROR << "Instance:" << c.first` 逐条打印全部已注册名，再 `AERROR << "Get instance X failed."`（`:103-106`）—— **排错第一步就是抓这段日志**。
- 约 30 个基类用这套，`grep -rn 'PERCEPTION_REGISTER_REGISTERER' modules/perception` 可得全表（radar_detection / radar4d_detection / camera_tracking / camera_location_* / pointcloud_ground_detection / pointcloud_semantics / pointcloud_motion / traffic_light_region_proposal / multi_sensor_fusion 的三个真插件基类 / `common/interface/base_obstacle_detector.h:87`）。

### 1.4 Component（class_loader 直连）

`CYBER_REGISTER_COMPONENT(name)` = `CLASS_LOADER_REGISTER_CLASS(name, apollo::cyber::ComponentBase)`（`cyber/component/component.h:657-658`）。参数是**非限定名**，与 `.dag` 的 `class_name` 对应。加载链 `cyber/mainboard/module_controller.cc`：`GetFilePathWithEnv(module_library(), "APOLLO_LIB_PATH", &load_path)`（`:79-80`）→ dlopen → `CreateClassObj<ComponentBase>(class_name)`（`:92` 普通 component / `:102` timer component）→ `Initialize`。

**dag 段放错的后果**：普通 component 写进 `timer_components{}`（或反之）会命中 `ComponentBase` 两个默认返回 false 的 `Initialize` 重载（`cyber/component/component_base.h:48-49`），日志只有一句 `Failed to load module`。

### 1.5 全仓 `base_class` 取值全表（现场统计，115 个 plugins.xml / 158 条 `<class>`）

```
 43  apollo::planning::Stage
 35  apollo::planning::Task
 19  apollo::planning::Scenario
 12  apollo::prediction::ModelBase
 11  apollo::control::ControlTask
 10  apollo::planning::TrafficRule
  9  apollo::external_command::CommandProcessorBase
  7  apollo::perception::lidar::BaseObjectFilter
  4  apollo::planning::Planner
  3  apollo::perception::lidar::BaseDownSample
  2  apollo::perception::lidar::BaseROIFilter
  1  apollo::planning::PncMapBase
  1  apollo::perception::lidar::BaseBarrierRecognizer
  1  apollo::perception::inference::Inference
```

**这 14 个就是全部合法取值**（`grep -rho 'base_class="[^"]*"' --include=plugins.xml modules/ | sort | uniq -c` 可复核）。`class_type` / `base_class_type` 零出现。写一个不在此表里的 `base_class` 就说明你在造新插件类型 —— 需要先在基类头文件所在处确认有 `CreateInstance<你的基类>` 的调用方。

## 2. planning 五类插件基类的纯虚函数清单

均在 `modules/planning/planning_interface_base/`（PncMapBase 例外，在 `modules/map/pnc_map/`）。**注册与 plugins.xml 只认这五个顶层基类**。

### 2.1 `Task`（`task_base/task.h`）

严格意义上无纯虚：`Init(config_dir, name, injector)`（`:45-46`）、`Execute(Frame*, ReferenceLineInfo*)`（`:48-49`）、`Execute(Frame*)`（`:51`）都有默认实现。真正要覆写的是**中间基类**的 hook：

| 中间基类 | 要覆写的函数 | 是否纯虚 |
|---|---|---|
| `Decider`（`task_base/common/decider.h:42,47`） | `Process(Frame*, ReferenceLineInfo*)` / `Process(Frame*)` | **否**，有默认实现 |
| `PathGeneration`（`task_base/common/path_generation.h:41,46`） | 同上 | **否** |
| `SpeedOptimizer`（`task_base/common/speed_optimizer.h:38-40`） | `Process(path_data, init_point, speed_data*)` | **是** |
| `TrajectoryOptimizer`（`task_base/common/trajectory_optimizer.h:41`） | `Process()` | **是** |
| `TrajectoryFallbackTask`（`task_base/trajectory_fallback_task.h:37` / `:40-41`） | `GenerateFallbackPath` / `GenerateFallbackSpeed` | **分开看**：`GenerateFallbackPath`（`:37`）virtual 但**非**纯虚；`GenerateFallbackSpeed`（`:40-41`）**是纯虚**（`= 0`，带默认参 `stop_distance = 0.0`）。另有非虚辅助 `GenerateFallbackPathProfile`（`:43`） |

**这是最危险的一点**：`Decider` / `PathGeneration` 的 `Process` 不是纯虚，签名写错（少一个参数、漏 const）编译器零提示，task 会永远空跑并返回 `Status::OK()`。加了 task 却「没效果」时先核对签名。另外，名字带 `Decider` 不代表继承 `Decider` —— `PathDecider`、`PathReferenceDecider`、`ObstacleNudgeDecider`、`RssDecider` 直接继承 `Task` 并定义**非虚**私有 `Process`；`SpeedDecider` 根本没有 `Process`。

### 2.2 `Scenario`（`scenario_base/scenario.h`）

- **纯虚 1 个**：`GetContext()`（`:64`）—— 必须定义自己的 `struct MyContext : public ScenarioContext` 并返回其地址。
- `IsTransferable(other_scenario, frame)`（`:70-73`）**不是纯虚但默认 `return false`**，不覆写 = 永不进入该场景。
- `Init(injector, name)`（`:58-59`）覆写时**必须先调 `Scenario::Init(...)`**，否则 `config_dir_` / pipeline 都不会被设置。
- `Process`（`:75-76`）、`Exit`（`:78`）、`Enter`（`:80`）都有默认实现；Exit/Enter 的返回值被 `scenario_manager.cc:67-72` 忽略。

### 2.3 `Stage`（`scenario_base/stage.h`）

- **纯虚 1 个**：`Process(planning_init_point, frame)`（`:61-62`）。
- `Init(config, injector, config_dir, context)`（`:50-51`）与 `FinishScenario()`（`:82`）有默认实现。
- `Stage::Init` 把 `next_stage_` 初值设成**自己的名字**（`stage.cc:47`），所以「返回 FINISHED 但不改 `next_stage_`」= 留在当前 stage（`scenario.cc:117`），不是结束场景；结束场景要调 `FinishScenario()`。
- plugins.xml 里 stage 的 `base_class` 一律 `apollo::planning::Stage`，**即使它继承 `BaseStageCreep` 之类的中间基类**。

### 2.4 `TrafficRule`（`traffic_rules_base/traffic_rule.h`）

**纯虚 2 个**：`ApplyRule(Frame* const, ReferenceLineInfo* const)`（`:46-47`）、`Reset()`（`:49`）。`Init(name, injector)`（`:43-44`）有默认实现，覆写时先调基类版再 `LoadConfig`。注意 `ApplyRule` 的返回值被 `TrafficDecider::Execute` 完全丢弃（`traffic_decider.cc:116`），返回 error 不会阻断流程。

### 2.5 `Planner`（`planner_base/planner.h`）

**纯虚 3 个**：`Name()`（`:52`）、`Plan(init_point, frame, ptr_computed_trajectory)`（`:67-69`）、`Stop()`（`:71`）。`Reset(frame)`（`:73`）有默认实现。中间基类 `PlannerWithReferenceLine`（`:98`）多一个非纯虚 `PlanOnReferenceLine`（`:112`）。plugins.xml 的 `base_class` 必须写 `apollo::planning::Planner`。

### 2.6 `PncMapBase`（`modules/map/pnc_map/pnc_map_base.h:47`）

**纯虚 9 个**：`CanProcess`（`:51`）、`GetRouteSegments`（`:59-61`）、`ExtendSegments`（`:72-75`）、`FutureRouteWaypoints`（`:77`）、`GetEndLaneWayPoint`（`:82-83`）、`GetLaneById`（`:88`）、`GetNearestPointFromRouting`（`:90-92`）、`GetDistanceToDestination`（`:94`）、`GetAdcWaypoint`（`:95`），外加 private 的 `IsValid`（`:110`）—— 共 10 个。`UpdatePlanningCommand`（`:53`）有默认实现。

### 2.7 `ControlTask`（`modules/control/control_component/controller_task_base/control_task.h`）

**纯虚 5 个**：`Init(injector)`（`:69`）、`ComputeControlCommand(...)`（`:80-83`）、`Reset()`（`:89`）、`Name()`（`:95`）、`Stop()`（`:100`）。conf 名固定 `conf/controller_conf.pb.txt`（`:121-129`）。

## 3. conf merge 差异：Task 双路径 merge vs TrafficRule 单路径

### Task —— 两条路径 + MergeFrom

`Task::LoadConfig<T>`（`task_base/task.h:66-70`）直接调 `ConfigUtil::LoadMergedConfig(default_config_path_, config_path_, config)`：

```
default_config_path_ = <插件目录>/conf/default_conf.pb.txt          （由类名反推，task.cc:52-54）
config_path_         = <scenario目录>/conf/<stage别名小写>/<task别名小写>.pb.txt （由别名拼出，task.cc:44-45）
```

`LoadMergedConfig`（`config_util.h:76-93`）行为：
1. 先 `LoadConfig<T>(default_config_path, config)`；失败只 **AERROR** 后继续（`:82-84`）。
2. 再读实例级 `config_path` 到临时对象；**失败只 AWARN `can not load user defined config file[...], use default config instead` 并 `return true`**（`:87-91`）—— 这就是「改 pb.txt 没效果且无报错」的根因。
3. 成功则 `config->MergeFrom(spcific_config)`（`:92`）。

**MergeFrom 语义要点**：singular 字段被覆盖，**repeated 字段是追加而非替换**。所以实例级文件里写 repeated 字段会得到「default + 覆盖」的并集，pipeline 类配置误用会出现重复项。

同文件里还有一个 `LoadOverridedConfig`（`config_util.h:94-110`）：**先试实例级，成功就直接 return，不 merge**；失败才整份读 default。目前全仓无调用点，别和 `LoadMergedConfig` 弄混。

### TrafficRule —— 只有一条路径，无实例级覆盖

`TrafficRule::Init`（`traffic_rule.cc:32-46`）只设 `config_path_ = GetPluginConfPath<TrafficRule>(class_name, "conf/default_conf.pb.txt")`（`:42-44`），**没有第二条路径、没有 merge**。想给同一条规则两套参数只能改代码或再建一个插件目录。

对比：Task 可以让**同一个 `type` 挂两个不同 `name`**从而吃两份配置（实例已存在：`SPEED_BOUNDS_PRIORI_DECIDER` 与 `SPEED_BOUNDS_FINAL_DECIDER` 共用 `type: "SpeedBoundsDecider"`），TrafficRule 做不到 —— 因为它的配置由类名而非别名决定。

### Scenario / Planner / ControlTask

- Scenario：三个文件，全部由类名反推，无 merge（`scenario.cc:60-79`）。缺 `conf/pipeline.pb.txt` → `Scenario::Init` 返回 false → `scenario_manager.cc:43` 的 `ACHECK` **直接 abort 进程**。
- Planner：`LoadConfig(custom_config_path, config)`（`planner_base/planner.h:82-96`，空串判断在 `:86-94`），**传入路径非空时完全不走反推**。`on_lane_planning.cc:159` 传的是 `FLAGS_planner_config_path`（`planning_base/gflags/planning_gflags.cc:55`），所以 **实际生效的是 `planning_component/conf/public_road_planner_config.pb.txt`**；`planners/public_road/conf/planner_config.pb.txt` 那份只在传空串时兜底，且两份内容**并不相同**（已 `diff` 核对）—— 改错哪一份都表现为"改了没效果"。
  > `planning_component/conf/` 下还留着 `navi_planner_config.pb.txt` 与 `planning_navi.conf` 两个**孤儿配置**：`modules/planning/planners/` 下已经没有 navi planner 了（只剩 `public_road`），`navi_planning.cc` 也仍在仓库里但没有可加载的 planner 插件。不要照它们改参数。
- ControlTask：单路径反推，无 merge（`control_task.h:121-135`），失败 AERROR + 返回 false。

## 4. 已知的注册相关缺陷（现场核对确认）

### 4.1 只有 plugins.xml、没有代码的孤儿声明

> **⚠️ 本节已按 Apollo 11.0 重测重写**。原文举的 `planners/lattice/` 与 `planners/navi/` 的 `path` 错指
> `planners/public_road/` 这个缺陷**在本环境不存在了** —— `modules/planning/planners/` 下只剩 `public_road`
> 一个目录（`rtk` 也没了）。§5 里那段 path/name 一致性扫描脚本现在全环境跑下来**没有任何 MISMATCH**。

现在唯一的同类问题是反过来的：**xml 在，代码不在**。

`modules/perception/lidar_detection_filter/object_filter_bank/outside_roi_filter/` 整个目录里**只有一个
`plugins.xml`**（260 字节，声明 `type="apollo::perception::lidar::OutsideRoiFilter"` /
`base_class="apollo::perception::lidar::BaseObjectFilter"`），没有 `.h/.cc`、没有 `BUILD`、没有任何 BUILD
引用它，`OutsideRoiFilter` 这个符号全环境（`src/` 与 `include/` 都搜过）只在这个 xml 里出现一次，也不在
`object_filter_bank/data/filter_bank.pb.txt`（只有 `ROIBoundaryFilter` 与 `StrategyFilter`）里。

它正是 `base_class` 统计里 `BaseObjectFilter` 数到 8 份、而注册宏只有 7 处的那份差额。后果：因为 `path`
指向的 `.so` 不存在，`GetFilePathWithEnv(library_path_, "APOLLO_PLUGIN_LIB_PATH", ...)`
（`plugin_description.cc:118-120`）解析失败，整条 description 被丢掉 —— 但**没人 CreateInstance 它，所以连
AWARN 都不会打**。这是「四件套只齐一件」的最静默形态。

同类的还有两份 `control_component/testdata/conf/plugins/{lat_based_lqr_controller,lon_based_pid_controller}/plugins.xml`：
它们的 `path` 指向 `modules/control/controllers/...` 下真实的 `.so`（是**故意**的，测试用），但自己目录里没有
BUILD。统计 `base_class="apollo::control::ControlTask"` 时会数出 9 而不是 7，别被这两份误导。

### 4.2 注册宏第二参：全限定名和裸名两种写法并存

宏第二参不参与查找（键是 `typeid(Base).name()`，`class_loader_utility.h:89`），所以怎么写都能跑，全环境
**同一个基类下两种写法各占一半**（已用脚本把所有 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN` 的第二参抽出来统计）：

| 写法 | 实例 |
|---|---|
| 全限定 `apollo::perception::lidar::BaseObjectFilter` | `perception_plugin/lidar_detection_filter/{semantic_filter/semantic_filter.h:87, object_split_filter/object_split_filter.h:109, bigmot_refine_filter/bigmot_refine_filter.h:86}` |
| 裸名 `BaseObjectFilter` | `lidar_detection_filter/object_filter_bank/{roi_boundary_filter/roi_boundary_filter.h:111, strategy_filter/strategy_filter.h:93, background_filter/background_filter.h:92}`、`perception_plugin/.../mark_area_filter/mark_area_filter.h:96` |
| 全限定 `apollo::perception::inference::Inference` | `perception_plugin/inference/onnx_multi_batch/onnx_multi_batch_infer.h:92` |

planning / control / prediction 侧则清一色裸名（`Stage`×43、`Task`×35、`Scenario`×19、`ModelBase`×12、
`TrafficRule`×10、`ControlTask`×7、`Planner`×1、`PncMapBase`×1）。

正确理解：**宏第二参随便写都能编过也能加载，xml 的 `base_class` 才必须是顶层基类全限定名。**
不要因为看到有人写全限定就以为 `base_class` 也能写中间基类。

### 4.3 `CreateInstance` 返回 nullptr 但调用方不判空

| 调用点 | 判空? | 类名写错的后果 |
|---|---|---|
| `stage.cc:62-67` | ✅ AERROR + return false | 整个 stage 起不来 |
| `traffic_decider.cc:47-55` | ✅ AERROR + return false | Init 失败 |
| `scenario_manager.cc:40-43` | ❌ 直接 `scenario->Init(...)`（外层套 ACHECK） | **段错误 / abort** |
| `reference_line_provider.cc:93-101` | ❌ 直接 `emplace_back` 后续解引用 | `planning_config.pb.txt` 的 `pnc_map_class` 写错即崩 |
| `control_task_agent.cc:42-44` | ❌ 直接 `controller->Init(...)` | pipeline 里 controller `type` 写错即段错误 |

`control_task_agent.cc:43` 还把类名**硬拼** `"apollo::control::" + type`，所以 control 的 pipeline 里 `type` 只能写不带 namespace 的类名。

### 4.4 `IsLibraryLoaded` 末尾比较恒真

`class_loader_utility.cc:189-191`：`return (is_lib_loaded_by_anyone && (num_lib_loader_class_factory_objs <= num_lib_class_factory_objs));` —— 后半永真（子集 size 必然 ≤ 全集），函数退化为 `IsLibraryLoadedByAnybody`。

### 4.5 `APOLLO_PLUGIN_INDEX_PATH` 的默认值形同虚设

`plugin_manager.cc:169-176`：env 为空时进入 `if` 分支，但里面用 `const std::string plugin_index_path = ...` **重新声明了一个内层同名局部变量**并立即析构，外层仍是空串。所以只能靠 `scripts/apollo.bashrc:43` 显式导出。

### 4.6 `plugin_description.cc` 三处 `Attribute()` 未判 nullptr

`:85`（`path`）、`:99`（`type`）、`:100`（`base_class`）都直接用返回值构造 `std::string`。**xml 缺属性或属性名拼错（如写 `class_type`）就是从 nullptr 构造 string，UB**。这也是为什么属性名写错的表现可能是崩溃而不是干净的报错。

### 4.7 孤儿插件：编译期齐备但运行期不存在

`modules/planning/traffic_rules/speed_setting/`：注册宏、plugins.xml（`base_class="apollo::planning::TrafficRule"`）、BUILD、cyberfile.xml（`planning-traffic-rules-speed-setting`）全都有，但

- `planning_component/conf/traffic_rule_config.pb.txt` 里**没有它**（10 个目录只有 9 条 rule）；
- `planning_component/cyberfile.xml:59-67` 的 9 条 traffic rule 依赖里**也没有它**。

而且该目录**没有 `conf/` 和 `proto/`**。这是「新增插件忘了最后两步」的现成反例：包不会被安装，运行期表现为找不到 so；即便装上了也不会被加载，因为没挂进 pipeline。

### 4.8 conf 目录/文件名与别名推导不匹配 → 参数静默失效

已确认实例（`LoadMergedConfig` 只 AWARN 后 return true，无任何 ERROR）：

- `scenarios/valet_parking_park/conf/valet_parking_retry_park/open_space_trajectory_optimizer.pb.txt` —— 对应 task 别名是 `OPEN_SPACE_TRAJECTORY_OPTIMIZER_PARK`，推导出的文件名应带 `_park` 后缀。**开放空间优化器的调参全部走 default_conf。**
- `scenarios/large_curvature/` 同病。

排查手法：`ls` 出 scenario 的 conf 目录树，逐个与 `pipeline.pb.txt` 里的 `name` 做 tolower 对照。

### 4.9 同名 context 结构体的 ODR 冲突

`ValetParkingContext` 在 `scenarios/valet_parking/` 与 `scenarios/valet_parking_park/` 下**同名、同 namespace、字段不同**（两处 `valet_parking_scenario.h:36`）。两个 so 同时加载时因 `RTLD_GLOBAL` 产生 ODR 冲突。**新建变体 scenario 必须换 context 结构体名。**

## 5. 快速核查命令

> **本环境**：工作区根下只有已 `buildtool install` 的包，下面的 `modules/` 请换成
> `/opt/apollo/neo/src/modules/`（看实现/BUILD/conf）或 `/opt/apollo/neo/include/modules/`（只看头文件；
> 二进制包的头文件**只在这里**，见 SKILL.md §7）。

```bash
S=/opt/apollo/neo/src; I=/opt/apollo/neo/include

# 某基类是哪套机制
grep -rn 'PERCEPTION_REGISTER_REGISTERER' $S/modules/perception | grep BaseXxx   # registerer
grep -rn 'CreateInstance<BaseXxx>' $S/modules/                                   # PluginManager

# 某个类/基类到底还存不存在（两棵树都要搜，src 里没有不代表被删了）
grep -rn 'class YourBase' $S/modules/ $I/modules/

# 全环境 plugins.xml 的 base_class 取值统计（实测只有 14 种，见 SKILL.md §2②）
grep -rho 'base_class="[^"]*"' --include=plugins.xml $S | sort | uniq -c | sort -rn

# 找 plugins.xml 与 BUILD 不一致的目录（实测现在只报 3 条 NO_BUILD，见 §4.1）
for x in $(find $S/modules -name plugins.xml); do d=$(dirname $x)
  p=$(grep -o 'path="[^"]*"' $x | sed 's/path="//;s/"//')
  n=$(grep -o 'name = "lib[^"]*\.so"' $d/BUILD 2>/dev/null | head -1 | sed 's/name = "//;s/"//')
  [ -z "$n" ] && { echo "NO_BUILD      $d (xml path=$p)"; continue; }
  [ "$(basename $p)" != "$n" ] && echo "NAME_MISMATCH $d xml=$p build=$n"
done

# 索引里到底装了什么（本环境实测 113 条）
ls /opt/apollo/neo/share/cyber_plugin_index/ | wc -l
grep -rl '<你的类名>' /opt/apollo/neo/share/modules/ 2>/dev/null   # 装出去的 xml

# 某类名的全部出现点（应含 .h 宏 / plugins.xml / 引用它的 pb.txt）
grep -rn 'MyClassName' $S/modules/
```

