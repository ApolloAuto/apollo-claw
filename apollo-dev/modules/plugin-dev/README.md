# Apollo 插件开发操作手册

> ## ⚠️ 本环境（包工作区）适配
>
> 本环境是独立包管理工作区 `/apollo_workspace`。**插件的写法（plugins.xml 属性名、`base_class` 顶层基类、
> `apollo_plugin` + alwayslink、注册宏、conf 命名）与形态完全无关，本 skill 正文全部适用。**
> 只有「编完怎么让它被发现」和「加载不到怎么查」这两处路径不同：
>
> **① 插件索引不在 `bazel-bin`。** 整仓形态 `APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=1`，会先扫
> `${APOLLO_ROOT_DIR}/bazel-bin` 下的 `cyber_plugin_index`；本环境该值实测为 **0**，**这一步完全不发生**。
> 所以正文 §6 排错表里「查 `bazel-bin/cyber_plugin_index/` 有无条目」在本环境永远查不到东西。真实索引在：
>
> ```bash
> ls /opt/apollo/neo/share/cyber_plugin_index/          # 实测 113 个条目
> # 文件名 = library path 把 / 换成 __，例如：
> #   modules__control__controllers__debug_info_control_task__libdebug_info_control_task.so
> # 文件内容 = plugins.xml 的相对路径，例如：
> #   share/modules/control/controllers/debug_info_control_task/plugins.xml
> ```
>
> **② 只 `bazel build` 等于没编。** 索引条目和 .so 都要 install 才存在，必须
> `buildtool build -p <包的相对路径>`（它会把产物 install 到 `/opt/apollo/neo/{lib,share}`）。
>
> 本环境实测环境变量（整仓值 → 本环境值）：
>
> | 变量 | 整仓 | 本环境 |
> |---|---|---|
> | `APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT` | `1` | **`0`** |
> | `APOLLO_PLUGIN_INDEX_PATH` | `/apollo/share/cyber_plugin_index` | `/opt/apollo/neo/share/cyber_plugin_index` |
> | `APOLLO_PLUGIN_LIB_PATH` | `/apollo/bazel-bin:/apollo/lib` | `/opt/apollo/neo/lib` |
> | `APOLLO_PLUGIN_DESCRIPTION_PATH` | `/apollo` | `/apollo_workspace:/opt/apollo/neo` |
> | `APOLLO_LIB_PATH` | `/apollo/bazel-bin` | `/opt/apollo/neo/lib` |
>
> ⚠️ 注意最后一行组合出的错配陷阱：`plugins.xml` **优先**从 `/apollo_workspace` 找（工作区在前），
> 而 `.so` **只**从 `/opt/apollo/neo/lib` 找。改了工作区里的 xml 但没重编，会出现
> 「描述文件是新版、库还是旧版」的静默错配 —— 症状像注册名对不上，实际是版本不一致。
>
> **③ 新建插件可以用模板**：`buildtool create --template plugin <package_path>`
> （可带 `--class_name` / `--base_class_name` / `--name`），生成 `BUILD`（已含 `apollo_plugin` +
> description）、`plugins.xml`、`.h/.cc`、`cyberfile.xml` 骨架，比手写少踩一半坑。已存在的文件跳过不覆盖。
>
> **④ 改 conf 试参数**：走 `/apollo/<src_path>/conf/*`（那里每个文件都是指向
> `/opt/apollo/neo/share/...` 的符号链接，改了立即生效并写穿）；改 `/apollo_workspace/` 下的源码副本
> **不生效**，要重编。这条直接影响正文 §6 排错表最后几行的「conf 改了没效果」。

三套注册机制并存，选错等于白写。长知识（实现原理、基类纯虚清单、已知缺陷）见 `reference.md`。

## 1. 决策树：该用哪套机制

从「谁来创建我的对象」倒推：

- **进程入口，由 mainboard 读 `.dag` 加载** → **cyber Component**。宏 `CYBER_REGISTER_COMPONENT(X)`（`cyber/component/component.h:657-658`），BUILD 用 `apollo_component`，**没有 plugins.xml**。详见 §5。
- **被某个 Component 内部按配置里的字符串创建出来** → **cyber PluginManager 插件**。判据：`grep -rn 'CreateInstance<你的基类>' modules/` 有命中。planning 五类插件、control 的 ControlTask、perception 的 BaseROIFilter/down_sample/部分 filter、prediction 的 ModelBase 都是这套。详见 §2。
- **基类头文件里有 `PERCEPTION_REGISTER_REGISTERER(BaseXxx)`** → **perception 自研 registerer**。判据：`grep -rn 'PERCEPTION_REGISTER_REGISTERER' modules/perception`（约 30 处）。详见 §4。
- **基类头文件两个宏都没有，调用方是 if-else / switch 比字符串** → **不是插件，必须改 C++**。已知：prediction 的 evaluator / predictor，multi_sensor_fusion 的 BaseTracker / BaseTypeFusion / BaseExistenceFusion / BaseMotionFusion / BaseShapeFusion。

同一个 perception 模块里两套并存是常态（`modules/perception/pointcloud_map_based_roi/interface/base_roi_filter.h:37` 的 `BaseROIFilter` 走 PluginManager，而 `modules/perception/radar_detection/interface/base_roi_filter.h:76` 的 `BaseRoiFilter` 走 registerer，名字只差大小写）。**照抄同目录邻居，不要跨目录抄。**

## 2. PluginManager 插件四件套 checklist

四件缺一不可，且四者名字有硬约束。以下用**已现场核对**的 `Crosswalk`（TrafficRule）做对照。

### ① 注册宏 — 写在类定义之后、`namespace` 之内

`modules/planning/traffic_rules/crosswalk/crosswalk.h:60`：

```cpp
CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::Crosswalk, TrafficRule)
```

- 位置：**头文件末尾，`}  // namespace planning` 之前**（perception/control 同惯例：`hdmap_roi_filter.h:106`、`lat_controller.h:273`）。
- 第一参**必须全限定名**，它被 `#Derived` 字符串化（`cyber/class_loader/class_loader_register_macro.h:22-31`），要与 plugins.xml 的 `type=` **逐字符一致**。
- 第二参**只是标签，写错不报错**：工厂表的键是 `typeid(Base).name()`（`cyber/class_loader/utility/class_loader_utility.h:89`），`#Base` 从不参与查找。惯例写非限定名 `TrafficRule` / `Task` / `Stage`，但**全仓两种写法并存且都能跑**：`perception_plugin/lidar_detection_filter/semantic_filter/semantic_filter.h:87`、`object_split_filter.h:109`、`bigmot_refine_filter.h:86` 写全限定 `apollo::perception::lidar::BaseObjectFilter`，而 `lidar_detection_filter/object_filter_bank/roi_boundary_filter/roi_boundary_filter.h:111`、`strategy_filter.h:93`、`background_filter.h:92`、`mark_area_filter.h:96` 写裸名 `BaseObjectFilter` —— 同一个基类、同一套索引，两边都正常加载。**以 plugins.xml 为准。**

### ② plugins.xml — 属性名是 `type`，不是 `class_type`

`modules/planning/traffic_rules/crosswalk/plugins.xml`（全文 3 行，无末尾换行）：

```xml
<library path="modules/planning/traffic_rules/crosswalk/libcrosswalk.so">
    <class type="apollo::planning::Crosswalk" base_class="apollo::planning::TrafficRule"></class>
</library>
```

解析在 `cyber/plugin_manager/plugin_description.cc:85,99-115`。本环境 106 个 plugins.xml 已全量核对（`find /opt/apollo/neo/src -name plugins.xml | wc -l`），`class_type` **零出现**：

- `<library>` 只读 `path`（`:85`）：**必须等于 BUILD 里 `apollo_plugin(name=...)`，且在自己目录下**。
- `<class>` 只读 `type`（`:99`，类名）与 `base_class`（`:100`）。写成 `class_type` 会从 nullptr 构造 `std::string`（UB）或走 `:109-113` 整条丢弃。同一 xml 内 `type` 重复被跳过（`:102-105`）。一个 xml 可有多条 `<class>`（`scenarios/lane_follow/plugins.xml` 里 scenario 与 stage 各一条）。
- **`base_class` 必须是最顶层基类的 demangle 全名**。全环境 106 个 xml 里只出现 14 种取值（`grep -rho 'base_class="[^"]*"' --include=plugins.xml /opt/apollo/neo/src | sort | uniq -c`，已现场统计）：`apollo::planning::{Stage×43, Task×35, Scenario×19, TrafficRule×10, PncMapBase×1, Planner×1}`、`apollo::prediction::ModelBase×12`、`apollo::control::ControlTask×9`（7 个真控制器 + `control_component/testdata/conf/plugins/` 下 2 份测试副本）、`apollo::perception::lidar::{BaseObjectFilter×8, BaseDownSample×3, BaseROIFilter×2, BaseBarrierRecognizer×1}`、`apollo::external_command::CommandProcessorBase×4`、`apollo::perception::inference::Inference×1`。**你的新插件必须落在这 14 个之一，否则就是选错了机制。**
  原因：`CheckAndLoadPluginLibrary` 用 `{class_name, abi::__cxa_demangle(typeid(Base).name())}` 这个 pair 查 `plugin_class_plugin_name_map_`（`plugin_manager.h:236-246`，查不到就是 `:241-242` 那句 AWARN）。中间基类（`Decider`、`PathGeneration`、`SpeedOptimizer`、`TrajectoryOptimizer`、`TrajectoryFallbackTask`、`PlannerWithReferenceLine`、`BaseStageCreep`）都真实存在且被大量继承，但**从不出现在任何 plugins.xml 里**。
  > 这些中间基类的头文件在本环境**只在 `/opt/apollo/neo/include/` 下**（`planning_interface_base/task_base/common/{decider,path_generation,speed_optimizer,trajectory_optimizer}.h`、`task_base/trajectory_fallback_task.h`、`planner_base/planner.h:98` 的 `PlannerWithReferenceLine`、`scenario_base/base_stage_creep.h:41`），`/opt/apollo/neo/src/modules/planning/planning_interface_base/` 里只有 `scenario_base` 与 `traffic_rules_base` 两个子目录。**在 `src/` 下 grep 不到 ≠ 这个类不存在**，见下方 §7。

### ③ BUILD 的 apollo_plugin — alwayslink 是注册能生效的前提

`modules/planning/traffic_rules/crosswalk/BUILD:15-29`：

```python
apollo_plugin(
    name = "libcrosswalk.so",          # 必须 lib 开头 .so 结尾，否则 fail
    srcs = ["crosswalk.cc"], hdrs = ["crosswalk.h"],
    description = ":plugins.xml",      # 缺这一项直接 fail
    copts = PLANNING_COPTS,            # BUILD:6 = -DMODULE_NAME=\"planning\"
    deps = [...],
)
```

配套 `filegroup(name="runtime_files", srcs=glob(["conf/**"]))`（`BUILD:8-13`）把 conf 装进运行时，末尾 `apollo_package()` + `cpplint()`。

`apollo_plugin` 展开三个 target（`tools/apollo_package.bzl:641-672`）：`cyber_plugin_description`（`:650-654`，装 xml 进索引）→ `cc_library(name="crosswalk_lib", alwayslink=True)`（`:658-665`）→ `cc_binary(linkshared, linkstatic)`（`:667-672`）。两处 fail 校验在最前：`description` 缺失 → `:642-643` `missing attribution of 'description'`；`name` 不是 `lib*.so` → `:646-647`。

**`alwayslink=True`（`:664`）为何必需**：注册宏展开成匿名 namespace 里的静态对象 `g_register_class_N`，没有任何符号引用它，链接器默认会把整个目标文件裁掉 → so 编出来了但里面没有注册对象 → 运行期 `Class factory objs counts is 0`。**不要手写 `cc_library` 代替 `apollo_plugin`**（`scripts/apollo_rule_check.sh:51-64` 用 buildozer 全仓扫原生 cc 规则，命中即 `:60` 报 `bazel native cc rule detected in <pkg>/BUILD` 并返回 -1）。

### ④ conf 文件 + 按名引用

- conf 放在**插件自己目录下的 `conf/`**，文件名由基类固定（见 §3）：TrafficRule/Task 是 `conf/default_conf.pb.txt`（核对：`modules/planning/traffic_rules/crosswalk/conf/default_conf.pb.txt`），ControlTask 是 `conf/controller_conf.pb.txt`（核对：`modules/control/controllers/lat_based_lqr_controller/conf/controller_conf.pb.txt`），Planner 是 `conf/planner_config.pb.txt`，Scenario 是 `conf/scenario_conf.pb.txt` + `conf/pipeline.pb.txt`。
- 挂到 pipeline：`modules/planning/planning_component/conf/traffic_rule_config.pb.txt:5-8` 加 `rule { name: "CROSSWALK" type: "Crosswalk" }`。`type` 经 `ConfigUtil::GetFullPlanningClassName`（`planning_base/common/util/config_util.cc:32-40`）补 `apollo::planning::` 前缀（已含 `::` 则原样）；`name` 是别名，只做决策 tag 与配置路径推导。
- **`cyberfile.xml`**：新插件目录必须建一份（`crosswalk/cyberfile.xml`：包名 `planning-traffic-rules-crosswalk`、`<type>module</type>`、`<builder>bazel</builder>`、`<depend type="binary" repo_name="planning-interface-base">`），并在 `modules/planning/planning_component/cyberfile.xml:59-67` 加一条依赖，否则包不被安装、运行期找不到 so。

## 3. conf 路径反推规则（改类名必须同步改 xml 与 conf 目录）

所有 PluginManager 插件的 conf 路径都是**由运行时类名反推**出来的，完整链条：

```
typeid(*this).name()
  → abi::__cxa_demangle  得到 "apollo::planning::Crosswalk"
  → PluginManager::GetPluginClassHomePath<Base>(class_name)   plugin_manager.h:161-189
      按 typeid(Base) 找到该类所在 so 的实际路径
      再反查 plugin_description_map_ 得到该 so 对应的 plugins.xml 所在目录
      去掉 "share/" 前缀（:177-183）      → "modules/planning/traffic_rules/crosswalk"
  → GetPluginConfPath<Base>(class_name, conf_name)            plugin_manager.h:192-208
      拼 "<插件目录>/" + conf_name，再经 APOLLO_CONF_PATH 解析
```

各基类固定的 `conf_name`（已核对源码）：

| 基类 | 代码位置 | 得到的路径 |
|---|---|---|
| `Task` | `task_base/task.cc:52-54` | `<插件目录>/conf/default_conf.pb.txt`（default） |
| `TrafficRule` | `traffic_rules_base/traffic_rule.cc:42-44` | `<插件目录>/conf/default_conf.pb.txt`，**无实例级覆盖** |
| `Scenario` | `scenario_base/scenario.cc:60-72` | `config_dir_=<插件目录>/conf`；`conf/scenario_conf.pb.txt`；`conf/pipeline.pb.txt` |
| `Planner` | `planner_base/planner.h:86-94` | 仅当传入 `config_path` 为空串才用 `<插件目录>/conf/planner_config.pb.txt` |
| `ControlTask` | `controller_task_base/control_task.h:121-129` | `<插件目录>/conf/controller_conf.pb.txt` |

**Task 多一条实例级路径**（`task.cc:44-45`）：`config_path_ = <config_dir>/tolower(task别名).pb.txt`，其中 `config_dir` 由 Stage 传入 `= <scenario 的 config_dir_>/tolower(stage别名)`（`stage.cc:55-56,68`）。完整形状（现场核对 `valet_parking`）：

```
modules/planning/scenarios/valet_parking/conf/valet_parking_parking/open_space_roi_decider.pb.txt
                                    ↑ scenario 目录  ↑ stage 别名小写      ↑ task 别名小写
pipeline 里：stage name "VALET_PARKING_PARKING"，task name "OPEN_SPACE_ROI_DECIDER"
```

`ConfigUtil::TransformToPathName`（`config_util.cc:26-30`）**只做 tolower，不做驼峰转下划线**。所以 pipeline 里 `name` 必须写全大写下划线；写驼峰会去找 `openspaceroidecider.pb.txt`，找不到只 AWARN 后静默用 default（`config_util.h:76-93` 的 `LoadMergedConfig` 返回 true）。

**结论 —— 改类名的连带动作**（跨 4 个以上文件）：
1. 改类名 → plugins.xml 的 `type=` 必须同步改。
2. 改类名 → conf 目录跟着 plugins.xml 所在目录走，所以插件**目录名改了要同步改 plugins.xml 的 `path=` 与 BUILD 的 `name=`**。
3. 改 pipeline 里的 `name`（别名）→ 必须同步重命名 `conf/<stage小写>/<task小写>.pb.txt` 与 stage 目录名，否则实例级参数**全部静默失效**。
4. 改 pipeline 里的 `type` → 必须等于类名（去 namespace 或全限定都可），写错 `Stage::Init` 返回 false 整个 stage 起不来（`stage.cc:64-67`）。

## 4. perception 自研 registerer

宏在 `modules/perception/common/lib/registerer/registerer.h`：基类头文件末尾 `PERCEPTION_REGISTER_REGISTERER(BaseXxx)`（`:92`，生成 `BaseXxxRegisterer`）+ 实现的 **`.cc` 文件作用域**写 `PERCEPTION_REGISTER_XXX(MyClass)`（= `PERCEPTION_REGISTER_CLASS(BaseXxx, MyClass)`，`:143`）。真实例：`radar_detection/lib/roi_filter/hdmap_radar_roi_filter/hdmap_radar_roi_filter.cc:31`。

与 PluginManager 的差异：

| | perception registerer | cyber PluginManager |
|---|---|---|
| 注册时机 | `__attribute__((constructor))`（`:152`） | 匿名 namespace 静态对象构造 |
| 查找键 | **短名字符串**（`GetInstanceByName`，`:98-108`） | 全限定类名 + demangle 基类名 pair |
| plugins.xml | **不需要** | 必需 |
| BUILD | 普通 `apollo_cc_library`（已强制 alwayslink，`apollo_package.bzl:637-639`） | `apollo_plugin` |
| 失败表现 | nullptr + **AERROR 打印全部已注册名**（`:103-106`），调用方多为 `CHECK_NOTNULL` → abort | nullptr，多处不判空 → 段错误 |
| conf 路径 | 不反推，走三段式 | 由类名反推 |

三段式 `plugin_param{name, config_path, config_file}` 由 `modules/perception/common/util.cc:80` 的 `GetConfigFile` 拼接（内部 `GetConfigPath:64` 加 `modules/` 前缀走 `APOLLO_CONF_PATH`）。核对 `radar_detection/conf/front_radar_detection_config.pb.txt`：`preprocessor_param { name: "ContiArsPreprocessor" config_path: "perception/radar_detection/data" config_file: "preprocessor.pb.txt" }`。

**注意**：走 PluginManager 的 perception 插件**也**用三段式传 conf（不用类名反推）。核对 `pointcloud_map_based_roi/conf/pointcloud_map_based_roi_config.pb.txt` 的 `plugin_param { name: "HdmapROIFilter" ... }` —— component 在 `pointcloud_map_based_roi_component.cc:57-67` 先 `CreateInstance<BaseROIFilter>(ConfigUtil::GetFullClassName(plugin.name()))`（短名补 `apollo::perception::lidar::`，`common/lidar/common/config_util.cc:23-30`）再把 path/file 塞进 InitOptions。

## 5. cyber Component 与 dag（简要）

Component **不是 plugins.xml 插件**：`CYBER_REGISTER_COMPONENT(X)` = `CLASS_LOADER_REGISTER_CLASS(X, apollo::cyber::ComponentBase)`（`cyber/component/component.h:657-658`）。三处字符串必须一致（核对 control）：`class ControlComponent` / `CYBER_REGISTER_COMPONENT(ControlComponent)`（`control_component.h:150`）/ `.dag` 的 `class_name : "ControlComponent"`（`control_component/dag/control.dag:5`），另加 dag 的 `module_library` 经 `APOLLO_LIB_PATH` 解析后 dlopen（`cyber/mainboard/module_controller.cc:79-102`）。

宏参数是**非限定名**（不带 namespace），与 PluginManager 插件要写全限定名**正好相反**。BUILD 用 `apollo_component`（`name` 必须 `lib*.so`（`apollo_package.bzl:578-579`），且**不得手传 `alwayslink`** —— 传了直接 fail，报 `'apollo_component' macro has not 'alwayslink' attrbute`（`:580-581`，`attrbute` 是源码里的拼写错误，按这个字符串搜日志）。完整流程用 `modules/new-component/` skill。

## 6. 排错表

先抓日志里这三句固定文案，它们精确指向不同阶段：

| 症状 / 日志 | 阶段 | 检查顺序 |
|---|---|---|
| `plugin of class X not found, please check if it's registered`（`plugin_manager.h:241-242`） | 索引/xml 层，so 没被找到 | 1) `bazel-bin/cyber_plugin_index/` 下有无对应条目（**本环境改查 `/opt/apollo/neo/share/cyber_plugin_index/`，且必须先 `buildtool build -p` install，见开头适配段**）2) xml 的 `type=` 与注册宏第一参逐字符比对（含 namespace）3) `base_class=` 是否顶层基类 demangle 全名 4) `APOLLO_PLUGIN_INDEX_PATH` / `APOLLO_PLUGIN_LIB_PATH` 是否含 `bazel-bin`（`apollo.bashrc:43,46`；**本环境不含也正常，见适配段的变量对照表**）5) xml 的 `path=` 是否等于 BUILD 的 `name=` 且在自己目录下 |
| `Class factory objs counts is 0, maybe registerclass failed.`（`class_loader_utility.cc:239-240`） | so 加载了但里面没注册对象 | 1) BUILD 是否用 `apollo_plugin`（不是手写 `cc_library`）2) 手写的话补 `alwayslink=True` 3) 注册宏是否在被编进 `srcs`/`hdrs` 的文件里且在 namespace 内 |
| `CreateClassObj failed, ensure class has been registered.`（`class_loader.h:84-86`） | 注册名与请求名不一致 | 配置里 `type` 经 `GetFullPlanningClassName` / `GetFullClassName` 补前缀后是否等于注册名；namespace 层级是否漏写 |
| **conf 改了没效果，无任何报错** | 路径反推链断了 | 1) conf 是否在**插件自己目录**的 `conf/` 下、文件名与基类要求一致（§3 表）2) Task 实例级路径 `conf/<stage别名小写>/<task别名小写>.pb.txt`，别名必须全大写下划线 3) 抓日志 `can not load user defined config file`（`config_util.h:87-91` 只 AWARN 并 return true）4) 确认改的不是 `planning_component/conf/` 下的同名副本（planner 生效的是那一份）|
| **`base_class` 写成中间基类** | pair 查表失败 | 表现同第一行 not found。改成顶层基类；注册宏第二参写错**不会**有任何提示（那只是标签）|
| **段错误而非报错** | 调用方不判空 | 已判空：`stage.cc:62-67`、`traffic_decider.cc:47-55`；**未判空：`scenario_manager.cc:40-43`、`reference_line_provider.cc:93-101`、`control_task_agent.cc:42-44`** |
| **编译过、注册齐备、代码不执行** | 没挂到 pipeline | traffic_rule → `planning_component/conf/traffic_rule_config.pb.txt`；task → `scenarios/<x>/conf/pipeline.pb.txt`；scenario → `planning_component/conf/public_road_planner_config.pb.txt`（**顺序即优先级**）；controller → `control_component/conf/pipeline.pb.txt`；pnc_map → `planning_config.pb.txt:20` 的 `pnc_map_class`（写**全限定名**）|
| **本地能跑，装包后找不到 so** | 包没被安装 | 插件目录缺 `cyberfile.xml`，或 `planning_component/cyberfile.xml` 没加依赖。现成反例见 `reference.md` §4.7 的 `speed_setting` |

自检：`grep -rn '<你的类名>' modules/` —— 命中应恰好覆盖「注册宏所在 .h + plugins.xml + 引用它的 pb.txt」三处，少一处就是漏了一件。
（**本环境**：工作区根下只有已 `buildtool install` 的包，全量搜索请用 `grep -rn '<你的类名>' /opt/apollo/neo/src/modules/`，并按下方 §7 补搜 `include/`。）

现成反例（**本环境实测的活体孤儿**）：`modules/perception/lidar_detection_filter/object_filter_bank/outside_roi_filter/` 整个目录里**只有一个 `plugins.xml`**（260 字节，声明 `apollo::perception::lidar::OutsideRoiFilter` / `base_class="apollo::perception::lidar::BaseObjectFilter"`），没有 `.h/.cc`、没有 `BUILD`、没有任何 BUILD 引用它，也不在 `object_filter_bank/data/filter_bank.pb.txt`（那里只有 `ROIBoundaryFilter` 与 `StrategyFilter`）里。所以它是 `base_class` 分布统计里 `BaseObjectFilter` 数到 8 而注册宏只有 7 个的那一份差额 —— **plugins.xml 存在不代表插件存在**，四件套只齐了一件同样什么都不会发生（连 AWARN 都没有，因为没人去 CreateInstance 它）。

## 7. ⚠️ 本环境特有：`src/` 不全，头文件要去 `include/` 找

`/opt/apollo/neo/src/` 只有**源码形式安装**的包，二进制包只装了头文件到 `/opt/apollo/neo/include/`。两棵树顶层目录数就不一样（`ls src/modules | wc -l` = 34，`ls include/modules | wc -l` = 39），而且**同一个包内部也可能只装了一部分子目录**：

```bash
ls /opt/apollo/neo/src/modules/planning/planning_interface_base/       # scenario_base  traffic_rules_base
ls /opt/apollo/neo/include/modules/planning/planning_interface_base/   # planner_base  scenario_base  task_base  traffic_rules_base
```

所以判断「某个类/基类是否还存在」时，**`src/` 里 grep 不到必须再 grep `include/`**，两处都没有才是真的没了：

```bash
grep -rn "class YourBase" /opt/apollo/neo/src/modules/ /opt/apollo/neo/include/modules/
```

反过来，`include/` 里只有 `.h`，看实现、看 BUILD、看 conf 仍必须去 `src/`（或 `buildtool install <pkg>` 把源码拉进工作区）。

