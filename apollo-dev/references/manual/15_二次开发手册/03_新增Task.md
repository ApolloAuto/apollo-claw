# 03 新增 Task（11.0 本机可执行流程）

<!--
file: references/manual/15_二次开发手册/03_新增Task.md
scope: 11.0（默认）
tags: 新增task, buildtool create, template planning_task, planning_task模板, Task, Decider, PathGeneration, SpeedOptimizer, TrajectoryOptimizer, TrajectoryFallbackTask, plugins.xml, base_class, apollo_plugin, default_conf.pb.txt, 实例conf, pipeline.pb.txt, cyber_plugin_index, TransformToPathName, 孤儿conf
sources（本轮 read 工具打开）: manual/_template.md（全 56）、manual/12_planning源码/06_task框架与task大族.md（全 290）、
manual/12_planning源码/05_stage框架.md（1–70）、manual/00_versions/01_命令与词汇对照.md（全 31）、
/opt/apollo/neo/include/modules/planning/planning_interface_base/task_base/task.h（全 73）、
/opt/apollo/neo/packages/buildtool/9.0.0-rc1-r19/core/action/create.py（225–274）、
/apollo_workspace/tools/proto/proto.bzl（116–145）。其余文件用 cat/sed/grep/ls/readlink 核对原文
但未经 read 工具 → 不引自有行号，见 §6。
-->

## 0. 一句话作用

本篇是**在本机（Apollo 11.0.0 包工作区）从零加一个 planning task 插件并让它真的被执行**的操作流程：
`buildtool create` 生成骨架 → 选基类实现 → 注册 → conf → `buildtool build -p` install → 挂进某 stage 的
pipeline → 验证。框架事实（Task 契约、五个中间基类、两级 conf）见
[12_planning源码/06_task框架与task大族](../12_planning源码/06_task框架与task大族.md)，本篇只给可执行步骤与失败排查。

## 1. 关键符号与文件

| 对象 | 路径（层） | 说明 |
|---|---|---|
| 顶层基类 `Task` | ②′ `/opt/apollo/neo/include/modules/planning/planning_interface_base/task_base/task.h`:37 | 无纯虚函数；`Init`(45-46)、双 `Execute`(48-49 / 51)、protected `LoadConfig<T>`(54-55，实现 66-70 转调 `ConfigUtil::LoadMergedConfig`)；成员 `frame_`/`reference_line_info_`/`injector_`/`config_path_`/`default_config_path_`/`name_`(57-63) |
| 五个中间基类 | ②′ `…/task_base/common/{decider,path_generation,speed_optimizer,trajectory_optimizer}.h`、`…/task_base/trajectory_fallback_task.h` | 见 §2.2；**`.cc` 未发布**（`planning-interface-base` 是纯 binary 包） |
| 样板 A（直继 Task） | ② `/opt/apollo/neo/src/modules/planning/tasks/path_decider/` | 本篇核对表的原型，7 个文件 |
| 样板 B（中间基类 + so 名≠包名） | ② `/opt/apollo/neo/src/modules/planning/tasks/piecewise_jerk_speed/` | 类 `PiecewiseJerkSpeedOptimizer : public SpeedOptimizer` |
| 生成器 | `/opt/apollo/neo/packages/buildtool/9.0.0-rc1-r19/core/action/create.py`；模板 `…/data/templates/template_planning_task/` | 模板文件 7 个：`task.h.in` `task.cc.in` `proto/{task.proto.in,BUILD.in}` `BUILD.in` `plugins.xml.in` `conf/default_conf.pb.txt.in`(**空文件**) |
| 可改源码副本 | ① `/apollo_workspace/modules/planning/tasks/`（本机**已 install**，35 个子包在位） | 新包也放这里 |
| 插件索引 | `/opt/apollo/neo/share/cyber_plugin_index/`（现 35 条 `planning__tasks` 条目） | `buildtool build` install 后才出现 |
| 生效 pipeline | ④ `/apollo/modules/planning/scenarios/<sc>/conf/pipeline.pb.txt` → `readlink -f` = `/apollo_workspace/profiles/ARCF_40P/…` | `profiles/current -> ARCF_40P`（**本机有 profiles 覆盖层**） |

## 2. 步骤序列（八步，命令均本机可跑）

### 2.1 第一步：生成包骨架（`--task` 是必填，不是 `--class_name`）

`buildtool create --help` 原文可选项（本机实跑）：`--template {component,timer_component,plugin,planning_scenario,planning_task,planning_traffic_rule}`、`--name`、`--class_name`、`--type`、`--author`、`--email`、`--description`、`--config_message_name`、`--channel_message_type`、`--channel_name`、`--namespaces`、`--includes`、`--dependencies`、`--build_dependencies`、`--base_class_name`、`--config_file_name`、`--scenario`、`--stage`、`--task`、`--rule` + 位置参数 `package_path`。
**`planning_task` 分支只读 `--task`**（create.py:234-236：`args.task_name is None` → 报 `task is required`；
该分支 234-259 全段**不引用 `class_name`/`base_class_name`**，传了也不生效）。

```bash
cd /apollo_workspace
buildtool create --template planning_task \
    --task MyCoolDecider \
    --author "$(git config user.name || echo apollo)" --email apollo-support@baidu.com \
    --description "my cool decider" \
    modules/planning/tasks/my_cool_decider
```

命名推导（create.py:238-249，read 已核）：

| 变量 | 规则 | `--task MyCoolDecider` 的结果 |
|---|---|---|
| `task_name` | `append_suffix(args.task_name,'Task')` —— 第 241 行**直接用你传的原串**，把 238-240 那次 Pascal 转换覆盖掉 | `MyCoolDeciderTask` |
| `task_name_snake` | `pascal_to_snake_case(task_name)` | `my_cool_decider_task` |
| `target_name` | `pascal_to_snake_case(remove_suffix(task_name,'Task'))` | `my_cool_decider` |
| `package_name` | `'planning-task-' + kebab(target_name)` | `planning-task-my-cool-decider` |
| `namespaces` | 缺省补 `['planning']`（create.py:290-291） | `apollo::planning` |

- **必须自己传 PascalCase**：241 行覆盖了 238 行的 kebab/snake→Pascal 转换，传 `--task my_cool` 会得到类名
  `my_coolTask`、文件 `my_cool_task.h`。类名末尾强制补 `Task`（已带则不重复）——不要这个后缀只能生成后手工
  改名（`.h/.cc/proto/BUILD/plugins` 五处一起改）。

生成物（`create.py` 的 `render_planning_task_*` 系列，已存在的文件跳过不覆盖）：

```
modules/planning/tasks/my_cool_decider/
├── my_cool_decider_task.h / .cc
├── proto/{my_cool_decider_task.proto, BUILD}
├── conf/default_conf.pb.txt          # 模板是空文件
├── BUILD                             # apollo_plugin(name="libmy_cool_decider_task.so", …)
├── plugin_my_cool_decider_description.xml   # ⚠️ 不叫 plugins.xml
└── cyberfile.xml                     # <name>planning-task-my-cool-decider</name>
```

### 2.2 第二步：选中间基类（五个 `.h` 的 class 行与虚函数签名本轮已核）

| 基类 | 头文件（②′ `…/task_base/`） | 你必须实现 | 用在哪 |
|---|---|---|---|
| `Task`（直继） | `task.h`:37 | 自己 override `Execute(Frame*, ReferenceLineInfo*)`，第一行先调 `Task::Execute(...)` 存黑板指针，再调自己的私有 `Process`（签名自定） | 需要完全自定流程；出厂 6 个这么写（`PathDecider` `SpeedDecider` `RssDecider` 等） |
| `Decider` | `common/decider.h`:32 | `Process(Frame*, ReferenceLineInfo*)` 或 `Process(Frame*)`，**两个都是非纯虚（默认 return OK）** | 只做决策、不产轨迹；出厂 9 个 |
| `PathGeneration` | `common/path_generation.h`:31 | 同 `Decider`（非纯虚），另可用 `GetStartPointSLState()`、`RecordDebugInfo(PathBound…)` | 产 `PathData`；出厂 10 个 |
| `SpeedOptimizer` | `common/speed_optimizer.h`:31 | **纯虚** `Process(const PathData&, const common::TrajectoryPoint& init_point, SpeedData*)` | 速度优化；出厂 3 个 |
| `TrajectoryOptimizer` | `common/trajectory_optimizer.h`:34 | **纯虚** `Process()`（无参，只 override 了 `Execute(Frame*)`） | **open space 专用**，不吃参考线；出厂 5 个 |
| `TrajectoryFallbackTask` | `trajectory_fallback_task.h`:31（不在 `common/` 下） | **纯虚** `GenerateFallbackSpeed(const EgoInfo*, double stop_distance = 0.0)`，可 override `GenerateFallbackPath` | stage 的 `fallback_task_`；出厂 2 个 |

**`Execute` 双重载与 open space 变体**（task.h:48-51；上表行号引 06 分册 read 已核值，本轮复核原文一致）：
`Execute(Frame*, ReferenceLineInfo*)` 走车道内路径（`Stage::ExecuteTaskOnReferenceLine`），
`Execute(Frame*)` 走开放空间（`Stage::ExecuteTaskOnOpenSpace`）。`SpeedOptimizer`/`TrajectoryFallbackTask`
只 override 前者，`TrajectoryOptimizer` 只 override 后者 → **选错基类 = task 挂进 pipeline 也不会被调**。

### 2.3 第三步：proto 定义 TaskConfig message

`proto/my_cool_decider_task.proto`（模板生成的是空 message，往里加字段）：

```protobuf
syntax = "proto2";
package apollo.planning;
message MyCoolDeciderTaskConfig {
  optional double static_obstacle_buffer = 1 [default = 0.3];
  optional bool skip_overlap_stop_check = 2 [default = false];
}
```

- **message 名必须是 `<类名>Config`**：模板 `.h` 里成员写死为 `{{task_name}}Config config_;`。
- `proto_library` 的 `name` **必须以 `proto` 结尾**（`tools/proto/proto.bzl`:120-121，否则 `fail`）；
  `proto.bzl`:133-134 另生成向后兼容别名 `<stem>_cc_proto`（出厂 `path_decider/BUILD` 依赖用的就是它，
  模板 BUILD 用 `:…_proto`）。编译若报找不到 `.pb.h`，换成 `_cc_proto`（**未实编，待核**）。

### 2.4 第四步：实现 Init + Process

模板 `task.cc.in` 已给正确的 `Init` 骨架，照它写（与出厂 `path_decider.cc` 的 `Init` 逐句同构）：

```cpp
bool MyCoolDeciderTask::Init(const std::string& config_dir,
                            const std::string& name,
                            const std::shared_ptr<DependencyInjector>& injector) {
  if (!Decider::Init(config_dir, name, injector)) return false;   // 先调「你继承的那个」基类 Init
  return Decider::LoadConfig<MyCoolDeciderTaskConfig>(&config_);   // 再 LoadConfig
}

apollo::common::Status MyCoolDeciderTask::Process(
    Frame* frame, ReferenceLineInfo* reference_line_info) {
  // 业务逻辑；黑板指针也可用基类成员 frame_ / reference_line_info_ / injector_
  return apollo::common::Status::OK();
}
```

- 直继 `Task` 时把 `Decider::` 换成 `Task::`，并且**要自己写 `Execute`**：先 `Task::Execute(frame, reference_line_info);`
  再转调 `Process(...)`（出厂 `path_decider.cc` 的 `Execute` 只有这两句）。
- 漏 `LoadConfig` → `config_` 全是 proto default，conf 写什么都没用（**不报错**）；漏 `Task::Init(...)` →
  `config_path_`/`default_config_path_`/`name_` 不被设置。

### 2.5 第五步：注册宏（在 `.h` 末尾，第二参短名 `Task`）

```cpp
CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::MyCoolDeciderTask, Task)
```

模板生成的是全限定第二参 `apollo::planning::Task`（`task.h.in` 原文），出厂 35 个 task 一律短名 `Task`
——两种写法本机并存，**关键是不能写中间基类**。

### 2.6 第六步：plugins.xml

```xml
<library path="modules/planning/tasks/my_cool_decider/libmy_cool_decider_task.so">
  <class type="apollo::planning::MyCoolDeciderTask" base_class="apollo::planning::Task"></class>
</library>
```

- `base_class` **永远 `apollo::planning::Task`**，`Decider`/`PathGeneration`/`SpeedOptimizer`/
  `TrajectoryOptimizer`/`TrajectoryFallbackTask` 对 PluginManager 不可见，出厂 35 条无一例外（06 分册 §1.1）。
- 属性名只有 `type` / `base_class` / `path`，**没有 `class_type`**；`path` 必须与 BUILD 里
  `apollo_plugin(name=…)` 的 so 名逐字一致。
- 文件名可用 `plugins.xml`（出厂风格）或模板的 `plugin_<target_name>_description.xml`，
  **必须与 BUILD 的 `description = ":<该文件名>"` 对上**。

### 2.7 第七步：conf 与 BUILD

`conf/default_conf.pb.txt`（包级默认，模板给的是空文件）—— 写 `MyCoolDeciderTaskConfig` 的文本形式即可
（出厂 `path_decider/conf/default_conf.pb.txt` 只有两行 `static_obstacle_buffer: 0.3` / `skip_overlap_stop_check: true`）。

BUILD 三要素（出厂 `path_decider/BUILD` 与模板 `BUILD.in` 一致）：

```python
filegroup(name = "runtime_files", srcs = glob(["conf/**"]))   # ← 少了 conf 不会被 install
apollo_plugin(
    name = "libmy_cool_decider_task.so",                      # 必须 lib*.so，不得手传 alwayslink
    srcs = ["my_cool_decider_task.cc"],
    hdrs = ["my_cool_decider_task.h"],
    description = ":plugin_my_cool_decider_description.xml",
    copts = ["-DMODULE_NAME=\\\"planning\\\""],
    deps = [
        "//modules/planning/planning_base:apollo_planning_planning_base",
        "//modules/planning/planning_interface_base:apollo_planning_planning_interface_base",
        "//modules/planning/tasks/my_cool_decider/proto:my_cool_decider_task_proto",
    ],
)
apollo_package()
cpplint()
```

**不要手写 `cc_library` 代替 `apollo_plugin`**（后者自带 `alwayslink=True`；漏了 → so 编出来但注册对象被裁）。
出厂 BUILD 里 `install` / `install_plugin` / `install_src_files` 段**全部是注释**，新包不用写；
`cyberfile.xml` 的 `<src_path>` 必须 = `//modules/planning/tasks/my_cool_decider`（模板已按 `package_path` 填好）。

### 2.8 第八步：编译 install → 进 pipeline → 实例 conf → 重启

```bash
buildtool build -p modules/planning/tasks/my_cool_decider     # -p 后是路径，不是包名
```

**只 `bazel build` 运行时看不见**：`APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`，索引只扫
`/opt/apollo/neo/share/cyber_plugin_index/`，必须 `buildtool build` 完成 install。

挂进 pipeline（**装了不等于会被调用**，task 列表顺序 = 执行顺序）：编辑 ④ 生效档
`/apollo/modules/planning/scenarios/<sc>/conf/pipeline.pb.txt`（软链 → `profiles/ARCF_40P/…`，改软链即写穿、立即生效），
在目标 stage 的 `task {}` 序列里插入：

```protobuf
stage: {
  name: "PULL_OVER_APPROACH"          # ← stage 别名
  type: "PullOverStageApproach"
  enabled: true
  task { name: "PATH_DECIDER" type: "PathDecider" }
  task { name: "MY_COOL_DECIDER" type: "MyCoolDeciderTask" }   # name=别名(随意) type=类名(必须准)
  ...
}
```

实例级 conf（可选，`MergeFrom` 覆盖 default）路径：
`scenarios/<sc>/conf/<stage 别名小写>/<task 别名小写>.pb.txt`
→ 本例 `pull_over/conf/pull_over_approach/my_cool_decider.pb.txt`。

重启 planning：`cyber_launch start /apollo/modules/planning/planning_component/launch/planning.launch`
（或 `mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag` 前台打屏）。

## 3. 文件 → 必须写什么（对照出厂 `tasks/path_decider/`，7 个文件全部 cat 核对）

| 文件 | 必须写什么 | 写错的后果 |
|---|---|---|
| `<snake>.h` | `#include` 自己的 `proto/<snake>.pb.h` + `cyber/plugin_manager/plugin_manager.h` + 基类头；`class X : public <基类>`；`Init` override；`Execute` 或 `Process` override；成员 `XConfig config_;`；末尾注册宏 | 漏注册宏 → so 里没工厂对象 |
| `<snake>.cc` | `Init` = 基类 `Init` + `LoadConfig<XConfig>`；`Execute`/`Process` 主体 | 漏 `LoadConfig` → conf 全程无效且不报错 |
| `plugins.xml`（或 `plugin_<t>_description.xml`） | `<library path="modules/planning/tasks/<pkg>/lib<snake>.so">` + `<class type="全限定类名" base_class="apollo::planning::Task">` | path/type 拼错 → `CreateInstance` 返回 nullptr，静默 |
| `BUILD` | `filegroup(runtime_files, glob conf/**)` + `apollo_plugin(name="lib*.so", description=":<xml>", copts=-DMODULE_NAME, deps=[planning_base, planning_interface_base, 自己的 proto])` + `apollo_package()` + `cpplint()` | 用 `cc_library` → 注册被裁；漏 filegroup → conf 不 install |
| `cyberfile.xml` | `<name>planning-task-<kebab></name>`、`<type>module</type>`、`<src_path>//modules/planning/tasks/<pkg></src_path>`、`<builder>bazel</builder>`、`<depend>bazel-extend-tools</depend>` + `type="binary"` 的 `planning-base` / `planning-interface-base`（出厂 path_decider 只依赖后者） | `src_path` 与目录不一致 → install 落错位置、bazel label 对不上 |
| `proto/<snake>.proto` | `package apollo.planning;` + `message <类名>Config {…}` | message 名不是 `<类名>Config` → 模板 `.h` 编不过 |
| `proto/BUILD` | `proto_library(name="<snake>_proto", srcs=["<snake>.proto"])` + `apollo_package()` | name 不以 `proto` 结尾 → `proto.bzl` 直接 `fail` |
| `conf/default_conf.pb.txt` | 该 Config 的文本值；无参数也建议留空文件 | 缺失 → `LoadMergedConfig` 打 `Failed to load default config file:`（AERROR，仍继续） |

## 4. ⚠️ 常见失败（本机可复现 / 有现成错例）

| 症状 | 根因 | 判据 / 修法 |
|---|---|---|
| 实例 conf 改了没效果 | 文件名按 **pipeline 别名的小写**，不按类名（`TransformToPathName` 只做 `::tolower`，不做驼峰转下划线；config_util.cc:26-30） | 别名 `PIECEWISE_JERK_SPEED` → `piecewise_jerk_speed.pb.txt`，即使类名是 `PiecewiseJerkSpeedOptimizer` |
| 同上，且日志只有一条 AWARN | `LoadMergedConfig` 读不到实例 conf 时 `AWARN "can not load user defined config file[…], use default config instead"` 然后 `return true`（config_util.h:86-89） | **本机已有 3 个孤儿 conf 实例**（永远不被读，可拿来对照）：`large_curvature/conf/large_curvature/open_space_rt_optimizer.pb.txt`（无此别名）、`large_curvature/conf/large_curvature/open_space_trajectory_optimizer.pb.txt` 与 `valet_parking_park/conf/{valet_parking_parking_park,valet_parking_retry_park}/open_space_trajectory_optimizer.pb.txt`（正确名应为 `open_space_trajectory_optimizer_park.pb.txt`） |
| 按包名猜 so 名，plugins.xml 的 `path` 写错 | 出厂有 4 个 so 名≠包名的特例：`path_time_heuristic`→`libpath_time_heuristic_optimizer.so`、`piecewise_jerk_speed`→`libpiecewise_jerk_speed_optimizer.so`、`piecewise_jerk_speed_nonlinear`→`libpiecewise_jerk_speed_nonlinear_optimizer.so`、`st_bounds_decider`→`libst_bounds_decider.so`（类名 `STBoundsDecider`） | 以 `ls /opt/apollo/neo/lib/modules/planning/tasks/<pkg>/` 的实际 so 名为准 |
| 插件装了但从不执行 | **忘记进 pipeline**（索引里有条目、`.so` 在位，但没有任何 stage 声明它） | `grep -R '<类名>' /apollo/modules/planning/scenarios/*/conf/pipeline.pb.txt`（**必须 `-R`**，`-r` 不跟随软链会假空） |
| `CreateInstance` 返回 nullptr | `base_class` 写了中间基类（`Decider` 等）；或注册宏第二参写了中间基类 | 一律写顶层 `Task` |
| 挂上了却不被调 | 基类选错分支：`TrajectoryOptimizer` 系只 override `Execute(Frame*)`（open space），车道内 stage 不会调它；反之亦然 | 按 §2.2 表选基类 |
| `Class factory objs counts is 0` | 用了裸 `cc_library`（无 `alwayslink`），注册对象被链接器裁掉 | 改回 `apollo_plugin` |
| 编完还是旧行为 | **只 `bazel build`**：`bazel-bin` 不被运行时读取，索引也不扫它（`APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`） | 必须 `buildtool build -p <路径>` |
| 改了 `/apollo_workspace/<pkg>/conf/` 没反应 | 那是源码副本（①），要重编才 install | 临时调参改 ④ 软链；要提交改 ① 再 `buildtool build -p` |

> 与 [00_versions/01_命令与词汇对照](../00_versions/01_命令与词汇对照.md) 的冲突：该表「编译后恢复配置」一行写
> 「本机无 profiles」，**与实测不符** —— `/apollo_workspace/profiles/` 下有 `ARCF_40P`、`ARCF_40P_NDT`、`sample`，
> `current -> ARCF_40P`，④ 视口 pipeline/conf 软链落点就在 `profiles/ARCF_40P/`。以本篇实测为准（2026-09-08）；
> `buildtool build` 是否重置这些软链**待核**。

## 5. 验证命令（本机实跑过的形态）

```bash
# 1) 插件是否 install 并进索引（新包应多出一条）
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep my_cool_decider
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep -c planning__tasks     # 基线 35
ls /opt/apollo/neo/lib/modules/planning/tasks/my_cool_decider/             # lib*.so 在不在

# 2) base_class 是否都是顶层 Task（新包别成为唯一例外）
grep -R -o 'base_class="[^"]*"' /opt/apollo/neo/share/modules/planning/tasks/ | sort | uniq -c

# 3) pipeline 是否真声明了它 + 生效档在哪（-R 不是 -r；readlink 结果落在 profiles/ARCF_40P 才是生效档）
grep -R -n 'MyCoolDeciderTask' /apollo/modules/planning/scenarios/*/conf/pipeline.pb.txt
readlink -f /apollo/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt
readlink -f /apollo/modules/planning/tasks/my_cool_decider/conf/default_conf.pb.txt

# 4) 实例 conf 名是否踩了 tolower 规则；5) 跑起来看日志
ls /opt/apollo/neo/src/modules/planning/scenarios/<sc>/conf/<stage别名小写>/
mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag   # 前台打屏
```

日志关键字（前 3 个已在源码原文中核对，出现位置待实跑确认）：

- `Failed to load default config file:` —— 包级 `default_conf.pb.txt` 没 install（AERROR，不中断）；
  `can not load user defined config file[` + `use default config instead` —— 实例 conf 名/目录名拼错（AWARN）。
- `Class factory objs counts is 0` —— 注册对象被裁（`apollo_plugin`/alwayslink 问题）。
- 单 task 耗时：`Stage::RecordDebugInfo(reference_line_info, name, time_diff_ms)`（stage.h:84-85）把耗时写进
  `ReferenceLineInfo::latency_stats_`（reference_line_info.h:129-130、363）→ 走 planning debug 消息、
  **不是 stdout 明文**；用 DreamView PnC Monitor 或 `cyber_channel echo /apollo/planning` 看（字段格式**待核**）。

## 6. 溯源

- 蒸馏日期：2026-09-08，本机 Apollo 11.0.0 包工作区。除 `buildtool create --help` 外全为只读操作；**未实际执行
  `buildtool create` / `buildtool build`**，故「命名推导」「生成物清单」由 `create.py` 与模板原文推得，
  编译期结论（proto dep 用 `_proto` 还是 `_cc_proto`）标为待核。
- **read 工具打开核对**：`_template.md`(全 56)、`12_planning源码/06_task框架与task大族.md`(全 290)、
  `12_planning源码/05_stage框架.md`(1-70)、`00_versions/01_命令与词汇对照.md`(全 31)、
  `include/…/task_base/task.h`(全 73)、`buildtool/…/core/action/create.py`(225-274)、
  `/apollo_workspace/tools/proto/proto.bzl`(116-145)。
- **cat/sed/grep/ls/readlink 核对原文但未经 read 工具**（故不引自有行号；中间基类与 `path_decider`/
  `config_util` 的行号沿用 06 分册 read 已核值，本轮复核原文一致）：`tasks/path_decider/` 全 7 个文件、
  `tasks/piecewise_jerk_speed/{BUILD,plugins.xml,*_optimizer.h,*_optimizer.cc(1-70)}`、
  五个中间基类 `.h`(各 25-60)、`config_util.{h(60-110),cc(1-60)}`、`stage.h`(grep)、
  `template_planning_task/` 全 7 个模板、`create.py` 的 `render_planning_task_*` 与命名 helper、
  `pull_over/conf/pipeline.pb.txt`(1-40)、`{large_curvature,valet_parking_park}/conf/*/`(ls)、
  `cyber_plugin_index`(ls)、`profiles/`(ls+readlink)。
- **遗留待核**：① 模板 BUILD 的 `:<snake>_proto` 依赖能否直接编过（未实编）；② `buildtool build` 是否重置
  `profiles/` 软链；③ task 耗时日志的实际字段格式（未实跑 planning）；④ 中间基类 `Execute` 函数体
  （`planning-interface-base` 纯 binary 包，`.cc` 本机不存在，见 06 分册 §5）。
