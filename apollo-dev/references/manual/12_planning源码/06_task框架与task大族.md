# 06 task 框架与 task 大族

<!--
file: references/manual/12_planning源码/06_task框架与task大族.md
scope: 11.0（默认）
tags: Task, task_base, Decider, PathGeneration, SpeedOptimizer, TrajectoryOptimizer, TrajectoryFallbackTask, LoadConfig, LoadMergedConfig, ExecuteTaskOnReferenceLine, pipeline.pb.txt, default_conf.pb.txt, TransformToPathName, ConfigUtil, plugins.xml, apollo_plugin, 35个task
sources:
- /opt/apollo/neo/include/modules/planning/planning_interface_base/task_base/task.h（全 73 行）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/task_base/common/decider.h（25–53 行精读）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/task_base/common/path_generation.h（25–64 行精读）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/task_base/common/speed_optimizer.h（25–48 行精读）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/task_base/common/trajectory_optimizer.h（25–45 行精读）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/task_base/trajectory_fallback_task.h（25–59 行精读）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/scenario_base/stage.h（40–99 行精读）
- /opt/apollo/neo/include/modules/planning/planning_base/common/util/config_util.h（全 114 行）
- /opt/apollo/neo/src/modules/planning/planning_base/common/util/config_util.cc（20–43 行精读）
- /opt/apollo/neo/src/modules/planning/tasks/path_decider/path_decider.h（20–63 行精读）
- /opt/apollo/neo/src/modules/planning/tasks/piecewise_jerk_speed/piecewise_jerk_speed_optimizer.h（20–55 行精读）
- /opt/apollo/neo/src/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt（cat 全文）
- /opt/apollo/neo/src/modules/planning/scenarios/large_curvature/conf/pipeline.pb.txt（全 29 行）
- /apollo_workspace/.manual_work/inventory/planning_inventory.md（盘点，§3.2 so 名清单）
- 以下用 ls/cat/grep/readlink 核对但未 read 打开（故不引行号）：tasks/*/plugins.xml、tasks/path_decider/{BUILD,path_decider.cc}、35 个 task 的 class 声明行（grep）、scenarios/*/conf/*/ 目录清单、/apollo/modules/planning/{tasks,scenarios}/ 软链落点
-->

## 0. 一句话作用

task 是 planning 里**最小可插拔计算单元**：Stage 每帧按 `pipeline.pb.txt` 里声明的顺序，逐个调 task 的
`Execute()`，把 `Frame` / `ReferenceLineInfo` 当黑板一路改写（路径 → 路径决策 → 速度边界 → 速度 → 轨迹）。
链路位置：Planner（[03](03_planners_public_road.md)）→ Scenario（04）→ **Stage（05）→ Task（本篇）**。
本机装了 **35 个 task 插件**，`base_class` 全部是 `apollo::planning::Task`。

## 1. 关键符号与文件

`task_base/` **整个目录只在 ②′ include 树**（`planning_interface_base` 是纯 binary 包，src 侧只落 proto，
见 planning_inventory §2）→ **所有 `.cc` 实现读不到**，本篇凡涉及实现体的都标「待核」。

| 符号/类 | 文件（②′ = /opt/apollo/neo/include/…，② = /opt/apollo/neo/src/…） | 行号(已核) | 说明 |
|---|---|---|---|
| `Task`（唯一顶层基类） | ②′ `modules/planning/planning_interface_base/task_base/task.h` | 37 | 无纯虚函数；见 §2.1 |
| `Task::Name()` | 同上 | 43 | `const std::string&`，返回 `name_`（= pipeline 里的**别名**，非类名） |
| `Task::Init()` | 同上 | 45-46 | `virtual bool Init(config_dir, name, injector)`；实现在未发布的 task.cc → **`config_path_`/`default_config_path_` 的拼法待核** |
| `Task::Execute()` ×2 | 同上 | 48-49 / 51 | 双重载：`(Frame*, ReferenceLineInfo*)` 与 `(Frame*)`（open space 用后者）；**virtual 非纯虚** |
| `Task::LoadConfig<T>()` | 同上 | 54-55（实现 66-70） | protected 模板，转调 `ConfigUtil::LoadMergedConfig(default_config_path_, config_path_, config)` |
| 成员 | 同上 | 57-63 | `frame_`、`reference_line_info_`、`injector_`、`config_path_`、`default_config_path_`、`name_` |
| `ConfigUtil::LoadMergedConfig` | ②′ `modules/planning/planning_base/common/util/config_util.h` | 76-93 | 先读 default（失败 AERROR:82），再读实例 conf；**实例 conf 读不到 → AWARN + `return true`，静默用默认值**（87-89）；成功则 `MergeFrom`(91) |
| `ConfigUtil::LoadOverridedConfig` | 同上 | 96-111 | 另一套语义（实例存在就整体覆盖），task 走的是 Merged |
| `ConfigUtil::TransformToPathName` | ② `modules/planning/planning_base/common/util/config_util.cc` | 26-30 | **只做 `::tolower`**，不做驼峰转下划线 |
| `Stage::task_list_` / `fallback_task_` | ②′ `…/scenario_base/stage.h` | 87 / 88 | `std::vector<std::shared_ptr<Task>>` + 单独一个 fallback task |
| `Stage::ExecuteTaskOnReferenceLine` | 同上 | 74-75 | protected；另有 `…ForOnlineLearning`(77-78)、`ExecuteTaskOnOpenSpace(Frame*)`(80) |

### 1.1 中间基类（4+1 个，全部在 ②′ `task_base/`）

| 中间基类 | 文件 | 行号(已核) | 它替子类做了什么 | 子类要实现的 |
|---|---|---|---|---|
| `Decider : public Task` | `task_base/common/decider.h` | 32 | override 两个 `Execute`(36-39)，转调 `Process` | `Process(Frame*, ReferenceLineInfo*)`(42-45) 或 `Process(Frame*)`(47-49)，**均有 OK 默认实现（非纯虚）** |
| `PathGeneration : public Task` | `task_base/common/path_generation.h` | 31 | override 两个 `Execute`(35-38)；另给 `GetStartPointSLState()`(55)、`RecordDebugInfo(PathBound…)`(60-62) | `Process` 同上(41-48)，也非纯虚 |
| `SpeedOptimizer : public Task` | `task_base/common/speed_optimizer.h` | 31 | 只 override `Execute(Frame*, ReferenceLineInfo*)`(34-35)；给两个 `RecordDebugInfo`(42-44) | **纯虚** `Process(const PathData&, const TrajectoryPoint&, SpeedData*)`(38-40) |
| `TrajectoryOptimizer : public Task` | `task_base/common/trajectory_optimizer.h` | 34 | 只 override `Execute(Frame*)`(38) → **open space 专用，不吃 reference line** | **纯虚** `Process()`(41)，无参 |
| `TrajectoryFallbackTask : public Task` | `task_base/trajectory_fallback_task.h`（不在 common/ 下） | 31 | override `Execute(Frame*, ReferenceLineInfo*)`(33-34)；提供 `GenerateFallbackPath`(37-38)、`GenerateFallbackPathProfile`(43-44)、`RetrieveLastFramePathProfile`(46-48)、`AmendSpeedDataForControl`(55) | **纯虚** `GenerateFallbackSpeed(const EgoInfo*, double stop_distance=0.0)`(40-41) |

> ⚠️ **中间基类对 PluginManager 不可见**：35 个 task 的 plugins.xml 里 `base_class` 一律写
> `apollo::planning::Task`（`CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN` 第二参一律短名 `Task`），
> `Decider` / `PathGeneration` / `SpeedOptimizer` / `TrajectoryOptimizer` / `TrajectoryFallbackTask`
> **从不出现在任何 plugins.xml 中**（planning_inventory §3 现场统计：`base_class="apollo::planning::Task"` 共 35 条，
> 未见任何中间基类）。写成中间基类 → `CreateInstance<Task>` 找不到 → 静默失败。

`task_base/` 下另有非基类的工具/算法目录（仅 ②′）：`common/lane_change_util/`、`common/path_util/`
（`path_assessment_decider_util.h` `path_bounds_decider_util.h` `path_optimizer_util.h`）、
`optimizers/road_graph/`（`dp_road_graph.h` `trajectory_cost.h` `comparable_cost.h` `waypoint_sampler.h`）、
`utils/st_gap_estimator.h`。

## 2. 机制与数据流

### 2.1 Task 的执行契约

`Task` 没有纯虚函数，`Execute` 有默认实现。实测两种写法都存在：

- **直接继承 `Task`**：自己 override `Execute`，第一行先调 `Task::Execute(frame, reference_line_info)`
  存黑板指针，再调自己的私有 `Process`（`path_decider.cc:50-55`，grep 见到全文 8 行，**行号已核**）。
- **继承中间基类**：只写 `Process`，`Execute` 由中间基类实现（读不到 .cc → 转调细节待核，但从
  `decider.h:36-39` 的 override 声明可确认这条链存在）。

### 2.2 task 何时被执行：pipeline 顺序即执行顺序

调用链（`Stage` 侧实现体在未发布的 stage.cc，**具体循环体待核，见 [05_stage框架](05_stage框架.md)**）：

```
Scenario::Process → Stage::Process（纯虚，stage.h:61-62，各 stage 子类实现）
    → Stage::ExecuteTaskOnReferenceLine(planning_start_point, frame)   // stage.h:74-75，车道内
    → Stage::ExecuteTaskOnOpenSpace(frame)                            // stage.h:80，开放空间
        → 遍历 task_list_（stage.h:87）逐个 task->Execute(...)
        → 失败/无轨迹时用 fallback_task_（stage.h:88）
```

- `task_list_` 的**构造顺序 = `pipeline.pb.txt` 里 `task {}` 的书写顺序**（`Stage::Init(const StagePipeline&…)`，
  stage.h:50-52 收的就是 pipeline 配置；构造代码待核）。实测 pipeline 形态（pull_over §3.1）：
  路径生成 → `PathDecider` → 规则停车 → 速度边界 → 速度启发式 → `SpeedDecider` → 速度边界(第二次) → 速度优化 → RSS。
- **同一个 task 类可以在一个 stage 里出现两次**，靠别名区分：pull_over 的
  `SPEED_BOUNDS_PRIORI_DECIDER` 与 `SPEED_BOUNDS_FINAL_DECIDER` 都是 `SpeedBoundsDecider`（cat 全文已核）。
- 走 `ExecuteTaskOnReferenceLine` 还是 `ExecuteTaskOnOpenSpace` 由 stage 子类自己决定；
  `TrajectoryOptimizer` 系（只 override `Execute(Frame*)`）只能用在 open space 分支。

### 2.3 35 个 task 全清单与归类

来源：`ls /opt/apollo/neo/src/modules/planning/tasks/`（35 个，src/include 两棵树一致）+
`grep -n '^class .* : public .* {' tasks/**/*.h`（36 命中，去掉 `PiecewiseJerkSpeedNonlinearIpoptInterface : Ipopt::TNLP` 后正好 35）。
**归类依据 = 中间基类 + 目录名，不含算法细节。**

| 归类 | 子包（① 改这里 / ② 读这里） | 类名 | 中间基类 |
|---|---|---|---|
| 路径生成（10） | `lane_follow_path` | `LaneFollowPath` | `PathGeneration` |
| | `lane_borrow_path` | `LaneBorrowPath` | `PathGeneration` |
| | `lane_borrow_path_generic` | `LaneBorrowPathGeneric` | `PathGeneration` |
| | `lane_change_path` | `LaneChangePath` | `PathGeneration` |
| | `lane_change_path_generic` | `LaneChangePathGeneric` | `PathGeneration` |
| | `pull_over_path` | `PullOverPath` | `PathGeneration` |
| | `reverse_path` | `ReversePath` | `PathGeneration` |
| | `square_path` | `SquarePath` | `PathGeneration` |
| | `reuse_path` | `ReusePath` | `PathGeneration` |
| | `fallback_path` | `FallbackPath` | `PathGeneration`（兜底路径） |
| 路径决策（4） | `path_decider` | `PathDecider` | **直继 `Task`** |
| | `path_reference_decider` | `PathReferenceDecider` | **直继 `Task`** |
| | `obstacle_nudge_decider` | `ObstacleNudgeDecider` | **直继 `Task`** |
| | `rss_decider` | `RssDecider` | **直继 `Task`** |
| 速度决策 / 边界（4） | `speed_decider` | `SpeedDecider` | **直继 `Task`** |
| | `speed_bounds_decider` | `SpeedBoundsDecider` | `Decider` |
| | `st_bounds_decider` | `STBoundsDecider` | `Decider` |
| | `rule_based_stop_decider` | `RuleBasedStopDecider` | `Decider` |
| 速度优化器（4） | `path_time_heuristic` | `PathTimeHeuristicOptimizer` | `SpeedOptimizer` |
| | `piecewise_jerk_speed` | `PiecewiseJerkSpeedOptimizer` | `SpeedOptimizer` |
| | `piecewise_jerk_speed_nonlinear` | `PiecewiseJerkSpeedNonlinearOptimizer` | `SpeedOptimizer` |
| | `reverse_speed` | `ReverseSpeed` | **直继 `Task`** |
| 开放空间 decider（6） | `open_space_roi_decider` | `OpenSpaceRoiDecider` | `Decider` |
| | `open_space_roi_decider_park` | `OpenSpaceRoiDeciderPark` | `Decider` |
| | `open_space_pre_stop_decider` | `OpenSpacePreStopDecider` | `Decider` |
| | `open_space_replan_decider` | `OpenSpaceReplanDecider` | `Decider` |
| | `open_space_fallback_decider` | `OpenSpaceFallbackDecider` | `Decider` |
| | `open_space_fallback_decider_park` | `OpenSpaceFallbackDeciderPark` | `Decider` |
| 开放空间轨迹（5） | `open_space_trajectory_provider` | `OpenSpaceTrajectoryProvider` | `TrajectoryOptimizer` |
| | `open_space_path_planning` | `OpenSpacePathPlanning` | `TrajectoryOptimizer` |
| | `open_space_trajectory_optimizer_park` | `OpenSpaceTrajectoryOptimizerPark` | `TrajectoryOptimizer` |
| | `open_space_trajectory_partition` | `OpenSpaceTrajectoryPartition` | `TrajectoryOptimizer` |
| | `open_space_trajectory_post_process` | `OpenSpaceTrajectoryPostProcess` | `TrajectoryOptimizer` |
| 轨迹回退（2） | `fast_stop_trajectory_fallback` | `FastStopTrajectoryFallback` | `TrajectoryFallbackTask` |
| | `smooth_stop_trajectory_fallback` | `SmoothStopTrajectoryFallback` | `TrajectoryFallbackTask` |

按中间基类统计：`PathGeneration` 10、`Decider` 9、`TrajectoryOptimizer` 5、`SpeedOptimizer` 3、
`TrajectoryFallbackTask` 2、直继 `Task` 6 = **35**。

### 2.4 抽样两个真实 task（原文行已核）

**A. `tasks/path_decider/`（直继 Task 的样板）** —— ② `…/tasks/path_decider/path_decider.h`

| 行 | 原文要点 |
|---|---|
| 33 | `class PathDecider : public Task {` |
| 35-36 | `bool Init(const std::string &config_dir, const std::string &name, const std::shared_ptr<DependencyInjector> &injector) override;` |
| 38-39 | `apollo::common::Status Execute(Frame *frame, ReferenceLineInfo *reference_line_info) override;` |
| 42-44 | 私有 `Process(const ReferenceLineInfo*, const PathData&, PathDecision*)`（**自定签名，不是基类的 Process**） |
| 57 | `PathDeciderConfig config_;` |
| 60 | `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::PathDecider, Task)` |

`path_decider.cc:41-48`（grep -A14 已核）：`Init` = `Task::Init(...)` → `Task::LoadConfig<PathDeciderConfig>(&config_)`；
`:50-55` `Execute` = `Task::Execute(frame, reference_line_info)` → `Process(...)`。

**B. `tasks/piecewise_jerk_speed/`（中间基类 + so 名不一致的样板）** —— `piecewise_jerk_speed_optimizer.h`

| 行 | 原文要点 |
|---|---|
| 34 | `class PiecewiseJerkSpeedOptimizer : public SpeedOptimizer {`（**目录名 `piecewise_jerk_speed`，类名带 `Optimizer`**） |
| 36-37 | `bool Init(config_dir, name, injector) override;` |
| 42-44 | `common::Status Process(const PathData&, const common::TrajectoryPoint&, SpeedData*) override;`（实现基类纯虚） |
| 48 | `PiecewiseJerkSpeedOptimizerConfig config_;` |
| 51-52 | `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::PiecewiseJerkSpeedOptimizer, Task)` ← **第二参仍是 `Task`，不是 `SpeedOptimizer`** |

## 3. 注册与配置

### 3.1 plugins.xml + BUILD（cat 核对，不引行号）

```xml
<!-- /opt/apollo/neo/src/modules/planning/tasks/path_decider/plugins.xml -->
<library path="modules/planning/tasks/path_decider/libpath_decider.so">
    <class type="apollo::planning::PathDecider" base_class="apollo::planning::Task"></class>
</library>
```

BUILD 用 `apollo_plugin(name="libpath_decider.so", …, description=":plugins.xml")` + `filegroup(name="runtime_files")`
（**不能用裸 `cc_library`**：`apollo_plugin` 自带 `alwayslink=True`，否则注册宏静态对象被裁 → `Class factory objs counts is 0`）。
索引条目在 `/opt/apollo/neo/share/cyber_plugin_index/modules__planning__tasks__<pkg>__lib<x>.so`。

### 3.2 两级 conf：包级 default + 实例级别名 conf

| 级别 | 路径（② 源码 / ④ 视口） | 谁读它 |
|---|---|---|
| 包级默认 | `tasks/<pkg>/conf/default_conf.pb.txt`（实测 33/35 个 task 有；④ 视口 `/apollo/modules/planning/tasks/<pkg>/conf/default_conf.pb.txt`，`readlink -f` → `/apollo_workspace/profiles/ARCF_40P/…`，**profile 覆盖层**） | `LoadMergedConfig` 的 `default_config_path_` |
| 实例级 | `scenarios/<sc>/conf/<stage.name 小写>/<task.name 小写>.pb.txt` | `config_path_`，`MergeFrom` 覆盖默认值 |

命名规则**只 tolower**（`config_util.cc:26-30`），文件名来自 **pipeline 里的 `name` 别名，不是类名**。现场三条证据：

1. `pull_over/conf/pipeline.pb.txt` 别名 `PULL_OVER_PATH` → 实例 conf `pull_over/conf/pull_over_approach/pull_over_path.pb.txt`（stage 别名 `PULL_OVER_APPROACH` → 目录 `pull_over_approach`）。
2. 别名 `PIECEWISE_JERK_SPEED`（类名是 `PiecewiseJerkSpeedOptimizer`）→ 实例 conf 实测叫
   `square/conf/extricate_stage/piecewise_jerk_speed.pb.txt` —— **按别名，不按类名**。
3. 同类两实例 `SPEED_BOUNDS_PRIORI_DECIDER` / `SPEED_BOUNDS_FINAL_DECIDER` 可各带一份 conf（本机未放，故这两个走默认值）。

## 4. 修改与扩展点（二次开发）

**新增一个 task（4 步，命令均本环境可用）**

```bash
cd /apollo_workspace
buildtool create --template planning_task \
    --class_name MyCoolDecider \
    modules/planning/tasks/my_cool_decider          # 生成 BUILD/cyberfile.xml/.h/.cc/proto/conf/plugins.xml
```

1. **写类**：`class MyCoolDecider : public Decider`（或直继 `Task` / `PathGeneration` / `SpeedOptimizer` /
   `TrajectoryOptimizer`），实现 `Init`（先 `Task::Init` 再 `Task::LoadConfig<MyCoolDeciderConfig>(&config_)`）+ `Process`。
2. **注册**：`.h` 末尾 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::MyCoolDecider, Task)`；
   `plugins.xml` 写 `base_class="apollo::planning::Task"`（**永远顶层基类**）、`path` = `modules/planning/tasks/my_cool_decider/libmy_cool_decider.so`。
3. **进 pipeline**：编辑 ④ 生效档 `/apollo/modules/planning/scenarios/<sc>/conf/pipeline.pb.txt`
   （软链 → `/apollo_workspace/profiles/ARCF_40P/…`，改软链即写穿、立即生效），在目标 stage 里加
   `task { name: "MY_COOL_DECIDER" type: "MyCoolDecider" }`，**位置就是执行顺序**。
4. **放 conf**：包级默认 `tasks/my_cool_decider/conf/default_conf.pb.txt`；要按实例调参再放
   `scenarios/<sc>/conf/<stage 小写>/my_cool_decider.pb.txt`（文件名 = 上一步别名的小写）。
5. **编译安装**：`buildtool build -p modules/planning/tasks/my_cool_decider`（**只 `bazel build` 运行时看不见**，
   必须 install 到 `/opt/apollo/neo/{lib,share}` 才进插件索引）。

**只调参不改代码**：直接改 ④ 视口下的 conf（软链写穿到 profile 覆盖层），重启 planning 即可，不用编译。
**改包级默认值要提交进版本管理**：改 ① `/apollo_workspace/modules/planning/tasks/<pkg>/conf/`，然后 `buildtool build -p`。

## 5. ⚠️ 本环境注意

1. **so 名与包名不一致的 4 个特例**（引 planning_inventory §3.2，写 plugins.xml / 排查加载失败时按 so 名找）：
   | 子包 | 类名 | so |
   |---|---|---|
   | `path_time_heuristic` | `PathTimeHeuristicOptimizer` | `libpath_time_heuristic_optimizer.so` |
   | `piecewise_jerk_speed` | `PiecewiseJerkSpeedOptimizer` | `libpiecewise_jerk_speed_optimizer.so` |
   | `piecewise_jerk_speed_nonlinear` | `PiecewiseJerkSpeedNonlinearOptimizer` | `libpiecewise_jerk_speed_nonlinear_optimizer.so` |
   | `st_bounds_decider` | `STBoundsDecider`（**类名大写 ST**） | `libst_bounds_decider.so` |
2. **无 conf/proto 的 2 个 task**：`fast_stop_trajectory_fallback`、`smooth_stop_trajectory_fallback`
   （只有 `plugins.xml`，无 `proto/`、无 `conf/default_conf.pb.txt`，planning_inventory §1.3 已核）——
   它们不调 `LoadConfig`，**给它们放实例 conf 无意义**。
3. **conf 名写错只 AWARN 静默用默认值**（`config_util.h:86-89` 原文
   `AWARN << "can not load user defined config file[…], use default config instead"` 然后 `return true`）——
   参数「改了没效果」的第一嫌疑就是文件名/目录名拼错。本机就有 **3 个现成的错例（孤儿 conf，永远不被读）**：
   - `large_curvature/conf/large_curvature/open_space_rt_optimizer.pb.txt` —— pipeline 里没有 `OPEN_SPACE_RT_OPTIMIZER` 这个别名（该 stage 6 个别名已 read 核对，pipeline.pb.txt:1-29）。
   - `large_curvature/conf/large_curvature/open_space_trajectory_optimizer.pb.txt` 与
     `valet_parking_park/conf/{valet_parking_parking_park,valet_parking_retry_park}/open_space_trajectory_optimizer.pb.txt`
     —— 别名实际是 `OPEN_SPACE_TRAJECTORY_OPTIMIZER_PARK`，正确文件名应为 `open_space_trajectory_optimizer_park.pb.txt`。
4. **中间基类不能写进 plugins.xml**（§1.1 ⚠️），`CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN` 第二参也一律 `Task`。
5. **task_base 只在 include 树**：`grep` `/opt/apollo/neo/src/` 找 `class Task` 会假空；改不了这些基类
   （要改得先 `buildtool install planning-interface-base`，本机工作区 ① **未 install** 该包，planning_inventory §1）。
   所有 `*_base` 的 `.cc` 实现体都没发布 → `Task::Init`、`Decider::Execute`、`Stage::ExecuteTaskOnReferenceLine`
   的**函数体一律待核**。
6. **搜 ④ `/apollo/...` 要用 `grep -R`**（`-r` 不跟随符号链接会假空）。
7. `piecewise_jerk_speed_nonlinear` 依赖 Ipopt（`PiecewiseJerkSpeedNonlinearIpoptInterface : public Ipopt::TNLP`），
   是 tasks 树里唯一继承第三方基类的类，别把它当成 task 插件。

## 6. 验证命令

```bash
ls /opt/apollo/neo/src/modules/planning/tasks/ | wc -l                       # 35
ls /opt/apollo/neo/include/modules/planning/planning_interface_base/task_base/  # task.h + trajectory_fallback_task.h + common/ optimizers/ utils/
grep -R -o 'base_class="[^"]*"' /opt/apollo/neo/share/modules/planning/tasks/ | sort | uniq -c   # 全是 apollo::planning::Task
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep 'planning__tasks'         # 35 条索引
readlink -f /apollo/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt # → profiles/ARCF_40P/…（生效档）
for d in /opt/apollo/neo/src/modules/planning/scenarios/*/conf/*/; do echo "$d: $(ls $d)"; done  # 实例级 conf 全景
grep -rn 'use default config instead' /opt/apollo/neo/include/modules/planning/planning_base/common/util/config_util.h
```

运行期确认某 task 是否真被调用：`cyber_launch start /apollo/modules/planning/planning_component/launch/planning.launch`
后看 planning 日志里 `RecordDebugInfo` 输出的 task 名与耗时（`stage.h:84-85`；日志字段格式待核）。

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 Apollo 11.0.0 包工作区，只读操作）。
- **read 打开核对过**：`task_base/task.h`(全 73)、`common/{decider.h,path_generation.h,speed_optimizer.h,trajectory_optimizer.h}`、
  `trajectory_fallback_task.h`、`scenario_base/stage.h`(40-99)、`planning_base/common/util/config_util.h`(全 114)、
  `config_util.cc`(20-43)、`tasks/path_decider/path_decider.h`(20-63)、
  `tasks/piecewise_jerk_speed/piecewise_jerk_speed_optimizer.h`(20-55)、
  `scenarios/large_curvature/conf/pipeline.pb.txt`(全 29)、`_template.md`、`03_planners_public_road.md`(1-120)、
  `.manual_work/inventory/planning_inventory.md`(全 338)。
- **ls/cat/grep/readlink 核对但未 read**（故不引行号）：35 个 task 的 class 声明（grep 36 命中）、
  `tasks/path_decider/{plugins.xml,BUILD,path_decider.cc}`、`scenarios/pull_over/conf/pipeline.pb.txt`(cat 全文)、
  `scenarios/*/conf/*/` 目录清单、`/apollo/modules/planning/{tasks,scenarios}/` 软链落点。
- **遗留待核**：① `Task::Init` 如何拼 `config_path_` / `default_config_path_`（task.cc 未发布，只能从
  实测 conf 布局反推）；② `Decider/PathGeneration/SpeedOptimizer/TrajectoryOptimizer/TrajectoryFallbackTask::Execute`
  的函数体；③ `Stage::Init` 建 `task_list_` 与 `ExecuteTaskOnReferenceLine` 的循环体、错误处理、fallback 触发条件
  → 见 [05_stage框架](05_stage框架.md)；④ `piecewise_jerk_speed_nonlinear`、`reverse_speed` 等未抽样 task 的行号；
  ⑤ 运行期日志字段格式（未实跑 planning）。
