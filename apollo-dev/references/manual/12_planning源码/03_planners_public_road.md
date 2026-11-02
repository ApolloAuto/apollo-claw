# 03 planners 与 public_road planner

<!--
file: references/manual/12_planning源码/03_planners_public_road.md
scope: 11.0（默认）
tags: planner, Planner基类, PlannerWithReferenceLine, PublicRoadPlanner, public_road, ScenarioManager, IsTransferable, first-match, public_road_planner_config.pb.txt, plugins.xml, lattice, navi, rtk, 场景优先级
sources:
- /opt/apollo/neo/include/modules/planning/planning_interface_base/planner_base/planner.h（全 121 行，src 树无此目录）
- /opt/apollo/neo/src/modules/planning/planners/public_road/public_road_planner.h（全 84 行）
- /opt/apollo/neo/src/modules/planning/planners/public_road/public_road_planner.cc（全 69 行）
- /opt/apollo/neo/src/modules/planning/planners/public_road/scenario_manager.cc（全 87 行）
- /opt/apollo/neo/src/modules/planning/planners/public_road/scenario_manager.h（30–61 行精读）
- /opt/apollo/neo/src/modules/planning/planning_base/common/util/config_util.cc（25–43 行精读）
- /opt/apollo/neo/src/cyber/plugin_manager/plugin_manager.cc（60–104 行精读）
- /apollo_workspace/profiles/ARCF_40P/modules/planning/planning_component/conf/public_road_planner_config.pb.txt（全 56 行，= ④ 生效档）
- 以下用 cat/diff/ls/grep 核对内容但未用 read 打开（故不引行号）：planners/{public_road,lattice,navi,rtk}/plugins.xml、planners/public_road/{BUILD,proto/planner_config.proto,conf/planner_config.pb.txt}、planning_base/proto/plugin_declare_info.proto
-->

## 0. 一句话作用

planner 是 planning 主循环里「**把一帧 Frame 变成一条轨迹**」的可插拔求解器层：`OnLanePlanning::Plan` 调 `planner_->Plan(...)`（见 [02 主循环](02_planning_component主循环.md) §2.4），默认插件 `PublicRoadPlanner` 本身**不做数值求解**，只做一件事——用 `ScenarioManager` 每帧选出当前 scenario，再把活交给 `scenario_->Process()`（scenario→stage→task 链见 04 篇起）。位置：`PlanningBase`（组件层）→ **Planner 插件**（本篇）→ Scenario/Stage/Task。

## 1. 关键符号与文件

| 符号/类/概念 | 文件（绝对路径，注明 src/include 完整度） | 行号(已核) | 说明 |
|---|---|---|---|
| `Planner`（顶层基类） | /opt/apollo/neo/include/modules/planning/planning_interface_base/planner_base/planner.h（**②′ 仅头文件树有；src 树的 planning_interface_base/ 下只有 scenario_base 与 traffic_rules_base**） | 45 | 纯虚 `Name()`(52)、`Plan()`(67-69)、`Stop()`(71)；虚 `Init()`(54-59)、`Reset()`(73)；模板 `LoadConfig()`(75-76, 实现 82-96)；成员 `injector_`(79) |
| `PlannerWithReferenceLine`（中间基类） | 同上 | 98 | 只加一个虚 `PlanOnReferenceLine()`(112-117)，默认实现仅 `CHECK_NOTNULL(frame)` 返回 OK。**对 PluginManager 不可见**，不出现在任何 plugins.xml 里 |
| `PublicRoadPlanner` | /opt/apollo/neo/src/modules/planning/planners/public_road/public_road_planner.h（src 全） | 48 | 继承 `PlannerWithReferenceLine`；`Name()` 返回 `"PUBLIC_ROAD"`(57)；`Reset()` 转给 scenario_manager(72) |
| 注册宏 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN` | 同上 | 80-81 | 原文：`CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::PublicRoadPlanner, Planner)` —— 第一参**全限定名**，第二参基类**短名** |
| 私有成员 | 同上 | 75-77 | `ScenarioManager scenario_manager_;`（**值成员，非指针**）、`PlannerPublicRoadConfig config_;`、`Scenario* scenario_ = nullptr;` |
| `PublicRoadPlanner::Init/Plan` | /opt/apollo/neo/src/modules/planning/planners/public_road/public_road_planner.cc（src 全 69 行） | Init 28-35 / Plan 37-66 | 全文只有这两个函数，无别的逻辑 |
| `ScenarioManager` | /opt/apollo/neo/src/modules/planning/planners/public_road/scenario_manager.h（src 全） | 39 | `final class`；`Init`(41-42)/`mutable_scenario`(44)/`Update`(48)/`Reset`(50)；成员 `current_scenario_`/`default_scenario_type_`/`scenario_list_`/`init_`(53-57) |
| `ScenarioManager::Init/Update` | /opt/apollo/neo/src/modules/planning/planners/public_road/scenario_manager.cc（src 全 87 行） | Init 33-54 / Update 56-76 / Reset 78-85 | **first-match 证据在 Update 59-75**（§2.3） |
| `PlannerPublicRoadConfig` | /opt/apollo/neo/src/modules/planning/planners/public_road/proto/planner_config.proto | 未 read（cat 核对） | 只有一个字段：`repeated PluginDeclareInfo scenario = 1;` |
| `PluginDeclareInfo` | /opt/apollo/neo/src/modules/planning/planning_base/proto/plugin_declare_info.proto | 未 read（cat 核对） | `required string name = 1;`（别名）+ `required string type = 2;`（类名） |
| `ConfigUtil::GetFullPlanningClassName` | /opt/apollo/neo/src/modules/planning/planning_base/common/util/config_util.cc（src 全；声明在 include/.../config_util.h） | 32-40 | 名字里没有 `::` 就前置 `apollo::planning::`；有则原样返回 |
| 插件库 BUILD | /opt/apollo/neo/src/modules/planning/planners/public_road/BUILD | 未 read（cat 核对） | `apollo_plugin(name="libpublic_road_planner.so", srcs=[public_road_planner.cc, scenario_manager.cc], description=":plugins.xml", ...)` + `filegroup(runtime_files=conf/**)` |

## 2. 机制与数据流

### 2.1 现存 planner：**4 个都在，不是只剩 public_road**

`ls /opt/apollo/neo/src/modules/planning/planners/` 与 `.../include/modules/planning/planners/` **两棵树结果相同**：`lattice`、`navi`、`public_road`、`rtk`。

| planner | 源码目录（② src，均含 .h/.cc/BUILD/plugins.xml/cyberfile.xml） | 安装的 .so（③ `/opt/apollo/neo/lib/modules/planning/planners/`） | 插件索引条目 | 可用性 |
|---|---|---|---|---|
| `PublicRoadPlanner`（`Name()`=`PUBLIC_ROAD`） | public_road/（+conf、docs、proto、scenario_manager.*） | public_road/libpublic_road_planner.so（Aug 20 12:04） | 有 | **可用，默认** |
| `LatticePlanner`（`LATTICE`） | lattice/（+behavior/、trajectory_generation/ 共 24 个文件） | lattice/liblattice_planner.so + liblattice_planner_base.so | 有 | **索引在但 plugins.xml 路径写错 → 加载必失败**（§5） |
| `NaviPlanner`（`NAVI`） | navi/（+conf/planner_config.pb.txt、decider/、proto/） | navi/libnavi_planner.so + libnavi_planner_base.so | 有 | 同上（路径写错） |
| `RTKReplayPlanner`（`RTK`） | rtk/（+testdata/garage.csv） | rtk/librtk_replay_planner.so | 有 | 路径正确，理论可换（未实跑） |

> ⚠️ 工作区 `CLAUDE.md` 五节「planners 只剩 `public_road`，lattice/navi/rtk 已删」**与本机实测冲突，以实测为准**（2026-09-08 核对：src+include+lib+cyber_plugin_index 四处都有 4 个 planner）。三个非 public_road planner 的类声明与注册宏位置用 grep 见到（`lattice_planner.h` `class LatticePlanner : public PlannerWithReferenceLine` / `rtk_replay_planner.h` `RTKReplayPlanner` / `navi_planner.h` `NaviPlanner`，均 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(..., Planner)`），**未 read 打开 → 行号待核**。

### 2.2 planner 怎么被加载与初始化（组件层 → 插件）

1. `PlanningBase::LoadPlanner()`（planning_base.cc:113-123，行号引自 [02](02_planning_component主循环.md) §2.4 已核结论）：默认名 `"apollo::planning::PublicRoadPlanner"`；若 `config_.planner()`（`PlanningConfig` 字段 4，planning_config.proto:40）非空则改用它并过 `ConfigUtil::GetFullPlanningClassName`（config_util.cc:32-40，短名自动补 `apollo::planning::`）→ `PluginManager::CreateInstance<Planner>(planner_name)`。
2. `OnLanePlanning::Init` 调 `planner_->Init(injector_, FLAGS_planner_config_path)`（on_lane_planning.cc:159；flag 默认值 planning_gflags.cc:55-58 = `modules/planning/planning_component/conf/public_road_planner_config.pb.txt`，两处行号引自 02 篇已核结论）。
3. `PublicRoadPlanner::Init`（cc:28-35）三步：`Planner::Init` 存 injector（planner.h:54-59）→ `LoadConfig<PlannerPublicRoadConfig>(config_path, &config_)`（planner.h:82-96：**config_path 为空时**才用 demangle 出的类名去 `PluginManager::GetPluginConfPath<Planner>(class_name, "conf/planner_config.pb.txt")` 找插件自带默认 conf）→ `scenario_manager_.Init(injector, config_)`。
4. `ScenarioManager::Init`（cc:33-54）：`init_` 已 true 直接返回（幂等）；否则**按 conf 里 scenario 的书写顺序**逐个 `PluginManager::CreateInstance<Scenario>(GetFullPlanningClassName(type))`，`ACHECK(scenario->Init(injector_, name))`（**创建或 Init 失败 = 进程 CHECK 崩，不是静默降级**），push 进 `scenario_list_`；名字恰为 `"LANE_FOLLOW"` 的那条被记成 `default_scenario_type_`（cc:46-48）；`current_scenario_ = default_scenario_type_`（cc:51）。

### 2.3 每帧执行：`PublicRoadPlanner::Plan`（cc:37-66）

| 步 | 做的事 | 位置（已核） |
|---|---|---|
| 1 | `scenario_manager_.Update(planning_start_point, frame)` 选场景 | cc:40 |
| 2 | `scenario_ = scenario_manager_.mutable_scenario()`；为空 → 返回 `PLANNING_ERROR "Unknown Scenario"` | cc:41-45 |
| 3 | `auto result = scenario_->Process(planning_start_point, frame)`（**真正的求解全在 scenario/stage/task 里**） | cc:46 |
| 4 | `FLAGS_enable_record_debug` 时把 `scenario_->Name()` / `GetStage()` / `GetMsg()` 写进 `ADCTrajectory.debug.planning_data.scenario` | cc:48-55 |
| 5 | `STATUS_DONE` → **同帧再 Update 一次**（当帧即可切场景，不用等下一帧）；`STATUS_UNKNOWN` → 返回 `PLANNING_ERROR` + task 错误信息 | cc:57-64 |
| 6 | 其余情况返回 `Status(common::OK, result.GetTaskStatus().error_message())` | cc:65 |

**场景选择 = first-match，两条规则（`ScenarioManager::Update`，cc:56-76）**：

1. **占先**：遍历中若遇到「就是当前场景」且其 `GetStatus() == STATUS_PROCESSING`，**立即 return**，本帧不换场景（源码注释原文 cc:63 `// The previous scenario has higher priority`）。
2. **首个 `IsTransferable` 为真者胜**：按 `scenario_list_` 顺序（= conf 书写顺序）调 `scenario->IsTransferable(current_scenario_.get(), *frame)`，第一个返回 true 的就 `current_scenario_->Exit(frame)` → 换 `current_scenario_` → `Reset()` → `Enter(frame)` → **return**（cc:66-74）。**没有任何 cost/score 字段**，后面的场景当帧不再被询问。
3. 一轮都不匹配 → 保持 `current_scenario_`（隐含：`LANE_FOLLOW` 作 default 兜底，cc:46-51、78-85）。

推论：**在 conf 里排在 `LANE_FOLLOW` 之后的 scenario 等于没注册**——`LaneFollowScenario::IsTransferable` 若恒真则永远先命中（`LaneFollowScenario` 自身实现未在本篇核对，标注**待核，见 [04_scenario框架](04_scenario框架.md)**）。

### 2.4 无独立 channel

planner 层不注册任何 reader/writer：输入 = `Frame*` + `planning_init_point`，输出 = `ADCTrajectory*`（仅 debug 字段）+ scenario 侧效应。真正对外发布在组件层（[02](02_planning_component主循环.md) §2.5）。

## 3. 注册与配置

### 3.1 插件注册（plugins.xml，cat 核对全文）

```xml
<!-- /opt/apollo/neo/src/modules/planning/planners/public_road/plugins.xml -->
<library path="modules/planning/planners/public_road/libpublic_road_planner.so">
    <class type="apollo::planning::PublicRoadPlanner" base_class="apollo::planning::Planner"></class>
</library>
```

- 属性名只有 `path` / `type` / `base_class`（无 `class_type`）；`base_class` 必须写**最顶层基类 `apollo::planning::Planner`**，写中间基类 `PlannerWithReferenceLine` 则 PluginManager 找不到。
- 安装后：描述文件落 `/opt/apollo/neo/share/modules/planning/planners/public_road/plugins.xml`，索引条目 `/opt/apollo/neo/share/cyber_plugin_index/modules__planning__planners__public_road__libpublic_road_planner.so`，内容 = `share/modules/planning/planners/public_road/plugins.xml`（4 个 planner 的索引条目与内容均已 cat 核对）。
- 加载链证据：`PluginManager` 解析 description 取 `path` 属性（plugin_manager.cc:51 `*library_path = root->Attribute("path")`）→ `LoadLibrary(description->actual_library_path_)`，失败只 `AWARN "... library[...] invalid"` 后 return false（plugin_manager.cc:75-80、195-197）——**插件路径写错是 AWARN 级静默失败**。

### 3.2 场景注册配置：`public_road_planner_config.pb.txt`

生效档（④ 视口 `/apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt` 是软链，`readlink -f` → `/apollo_workspace/profiles/ARCF_40P/...`，即 **profile 覆盖层，不是出厂版**；出厂版在 `/opt/apollo/neo/share/modules/planning/planning_component/conf/`）。生效档 56 行，**顺序即优先级**：

| # | name（别名，决定 conf 目录名与 debug 显示） | type（类名，经 GetFullPlanningClassName 补 `apollo::planning::`） | 行号 |
|---|---|---|---|
| 1 | EMERGENCY_PULL_OVER | EmergencyPullOverScenario | 1-4 |
| 2 | EMERGENCY_STOP | EmergencyStopScenario | 5-8 |
| 3 | VALET_PARKING_PARK | ValetParkingParkScenario | 9-12 |
| 4 | BARE_INTERSECTION_UNPROTECTED | BareIntersectionUnprotectedScenario | 13-16 |
| 5 | STOP_SIGN_UNPROTECTED | StopSignUnprotectedScenario | 17-20 |
| 6 | YIELD_SIGN | YieldSignScenario | 21-24 |
| 7 | TRAFFIC_LIGHT_UNPROTECTED_LEFT_TURN | TrafficLightUnprotectedLeftTurnScenario | 25-28 |
| 8 | TRAFFIC_LIGHT_UNPROTECTED_RIGHT_TURN | TrafficLightUnprotectedRightTurnScenario | 29-32 |
| 9 | TRAFFIC_LIGHT_PROTECTED | TrafficLightProtectedScenario | 33-36 |
| 10 | PULL_OVER | PullOverScenario | 37-40 |
| 11 | PARK_AND_GO | ParkAndGoScenario | 41-44 |
| 12 | FREE_SPACE | FreeSpaceScenario | 45-48 |
| — | ~~SQUARE / SquareScenario~~ | 被 `#` 注释掉 | 49-52 |
| 13 | LANE_FOLLOW | LaneFollowScenario | 53-56 |

**生效档 vs 出厂档差异（diff 已核）**：出厂档 12 条，本车 profile ① 把 `VALET_PARKING/ValetParkingScenario` 换成 `VALET_PARKING_PARK/ValetParkingParkScenario`；② 在 `PARK_AND_GO` 后插入 `FREE_SPACE/FreeSpaceScenario` 与注释掉的 `SQUARE`；③ 末尾无换行。→ **本车生效 13 个场景，不是 12 个**（`CLAUDE.md` 五节「只注册 12 个」是出厂口径）。

**已安装但未注册的 scenario 插件**（`ls /opt/apollo/neo/lib/modules/planning/scenarios/` = 19 个，减去上表 13 个）：`lane_escape`、`lane_follow_park`、`large_curvature`、`precise_parking`、`square`、`valet_parking` —— 加到生效档里即可启用，无需重编（`free_space`、`valet_parking_park` 的 plugins.xml 已 grep 确认存在，故本车 conf 不会 ACHECK 崩）。

另有**插件自带默认 conf** `/opt/apollo/neo/src/modules/planning/planners/public_road/conf/planner_config.pb.txt`（安装到 `share/modules/planning/planners/public_road/conf/`，内容 = 出厂 12 条）：只有 `Planner::Init` 收到**空 config_path** 时才会走它（planner.h:86-94）；本机走 gflag 传的绝对/相对路径，**这份默认 conf 实际不生效**。

## 4. 修改与扩展点（二次开发）

1. **改场景优先级 / 增删场景**：编辑 ④ `/apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt`（软链写穿 profile 树，`buildtool build` 不覆盖），调整 `scenario{}` 块顺序；重启 planning 生效（`mainboard -d .../planning.dag`）。要提交进版本管理则改 `/apollo_workspace/modules/planning/planners/public_road/conf/planner_config.pb.txt` 后 `buildtool build -p modules/planning/planners/public_road`。
2. **换默认 planner**：在 ④ `planning_config.pb.txt` 加一行 `planner: "RTKReplayPlanner"`（`PlanningConfig` 字段 4；短名会被自动补全命名空间，config_util.cc:32-40）。本车生效档**没有** `planner` 字段（grep 无命中）→ 走默认 `PublicRoadPlanner`。换成 lattice/navi 前先修 §5 的 plugins.xml 路径 bug。
3. **换 planner conf 路径**：改 ④ `planning.conf` 里加 `--planner_config_path=<路径>`（gflag 默认见 §2.2 第 2 步）。
4. **新增一个 planner 插件**：
   - `buildtool install planning`（拉源码进 ① 工作区）→ 新建 `/apollo_workspace/modules/planning/planners/<my>/`，照 public_road 四件套写：`<my>_planner.h/.cc`（继承 `PlannerWithReferenceLine`，实现 `Name()/Init()/Plan()/Stop()`）、`plugins.xml`（`base_class="apollo::planning::Planner"`、`path` 写 `modules/planning/planners/<my>/lib<my>_planner.so`）、`BUILD`（**必须 `apollo_plugin`**，自带 alwayslink；手写 `cc_library` 会让注册对象被裁 → 运行期 `Class factory objs counts is 0`）、`cyberfile.xml`（`<src_path>` 与目录一致）。
   - 头文件末尾加 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::MyPlanner, Planner)`。
   - `buildtool build -p modules/planning/planners/<my>` 完成 install（**只 `bazel build` 运行时看不见**），检查 `/opt/apollo/neo/share/cyber_plugin_index/` 出现对应条目，再按第 2 条把 `planner:` 指向它。
5. **只想改场景切换策略**（如从 first-match 改带优先级/评分）：唯一改点是 `scenario_manager.cc` 的 `Update`（cc:56-76），属 public_road 插件包，改完 `buildtool build -p modules/planning/planners/public_road`。

## 5. ⚠️ 本环境注意

- **`CLAUDE.md` 五节关于 planners 的两条已过期（2026-09-08 实测裁决）**：① lattice/navi/rtk **源码、.so、插件索引都在**，不是「已删除」；② `navi_planner_config.pb.txt`（→share 出厂链）、`planning_navi.conf`（→share）、`planning_navi.dag`（→share，与 `planning.dag`→profile 并存）**三个文件都存在**（`ls -l` 已核）。但它们仍属「装了没启用」：navi 分支要 `FLAGS_use_navigation_mode=true` 才实例化 `NaviPlanning`（默认 false，见 [02](02_planning_component主循环.md) §1/§5），且 NaviPlanner 插件本身有下面这条路径 bug。
- **lattice / navi 的 plugins.xml `path` 写错了（上游 bug，本机原样安装）**：两者都写成 `modules/planning/planners/public_road/liblattice_planner.so` / `.../public_road/libnavi_planner.so`，而实际 .so 装在 `planners/lattice/`、`planners/navi/`（`ls` 已核该 public_road 目录下无这两个文件）。PluginManager 用 xml 的 `path` 解析库（plugin_manager.cc:51、75-80）→ 只 `AWARN ... library[...] invalid`，`CreateInstance<Planner>` 返回 nullptr。**要用 lattice/navi 必须先修 plugins.xml 的 path 再 `buildtool build -p`**。rtk 的 path 正确。
- **场景 conf 生效档在 profile 层，不在 share**：改前先 `ls -l /apollo/modules/planning/planning_component/conf/` 认目标（本机 `public_road_planner_config.pb.txt`→`profiles/current`→`ARCF_40P`；`navi_planner_config.pb.txt`/`planning_navi.conf`→share），share 树的改动下次 install 会被覆盖。
- **场景 conf 写错的失败模式是崩，不是降级**：`ScenarioManager::Init` 用 `ACHECK`（cc:43-44），type 拼错/插件未装 → 进程 CHECK 退出；而 stage/task 的实例 conf 找不到才是 AWARN + 用 default_conf（见 04/05 篇）。
- **`name` 别名不只是显示用**：它同时是 task 实例 conf 的目录名来源（`ConfigUtil::TransformToPathName` 只做 tolower，config_util.cc:26-30），改 `name` 会让 `scenarios/<sc>/conf/<stage 小写>/<task 小写>.pb.txt` 整条路径失配。
- 搜 `/apollo/...` 一律 `grep -R`（`-r` 不跟随软链会假空）；插件索引只在 `/opt/apollo/neo/share/cyber_plugin_index/`（不扫 bazel-bin）。
- `Planner::LoadConfig` 的「空路径 → 找插件自带 conf」分支（planner.h:86-94）在本机不走（gflag 恒有值），排查「conf 没生效」时别按它推理。

## 6. 验证命令

```bash
# 现存 planner 与安装产物（两棵树都看）
ls /opt/apollo/neo/src/modules/planning/planners/ /opt/apollo/neo/include/modules/planning/planners/
ls -l /opt/apollo/neo/lib/modules/planning/planners/*/
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep planner
cat /opt/apollo/neo/share/cyber_plugin_index/modules__planning__planners__public_road__libpublic_road_planner.so

# 生效场景清单 + 出厂/生效差异
ls -l /apollo/modules/planning/planning_component/conf/ | grep planner
readlink -f /apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt
diff /opt/apollo/neo/share/modules/planning/planning_component/conf/public_road_planner_config.pb.txt \
     /apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt

# 已装但未注册的 scenario 插件
ls /opt/apollo/neo/lib/modules/planning/scenarios/

# 起 planning 看场景加载与切换日志（关键字来自源码字符串，已核）
mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag
#   Init:  "Load scenario list:"            (scenario_manager.cc:50)
#   切换:  "switch scenario from X to Y"     (scenario_manager.cc:68-69)
#   兜底:  "Reset to default scenario:"      (scenario_manager.cc:82)
#   插件失败: "plugin library[...] load failed" / "library[...] invalid" (plugin_manager.cc:75-80,197)
```

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线：Apollo 11.0.0 package 工作区。
- **read 工具逐行核对过的文件**（本文所有 `文件:行号` 只来自这些）：`include/.../planner_base/planner.h`（1-121）、`src/.../planners/public_road/public_road_planner.h`（1-84）、`public_road_planner.cc`（1-69）、`scenario_manager.cc`（1-87）、`scenario_manager.h`（30-61）、`src/.../planning_base/common/util/config_util.cc`（25-43）、`src/cyber/plugin_manager/plugin_manager.cc`（60-104）、`profiles/ARCF_40P/.../conf/public_road_planner_config.pb.txt`（1-56）。
- **cat/diff/ls/grep 证据（未 read，故不引行号）**：4 个 planner 的 plugins.xml 全文；public_road 的 BUILD、proto/planner_config.proto、conf/planner_config.pb.txt；plugin_declare_info.proto；`ls -R` planners 两棵树；`ls -l /opt/apollo/neo/lib/modules/planning/planners/*/`；cyber_plugin_index 4 条目及内容；`ls /opt/apollo/neo/lib/modules/planning/scenarios/`（19 个）；出厂↔profile 版 planner conf 的 diff；④ conf/dag 目录 `ls -l` + `readlink -f`；`grep -n planner` 生效 planning_config.pb.txt（无命中）、planning_gflags.cc（planner_config_path）、planning_base.cc LoadPlanner 片段（`sed` 打印）。
- **跨引用**（不重复核对，行号引自 [02_planning_component主循环.md](02_planning_component主循环.md) 已核结论）：`planning_base.cc:113-123` LoadPlanner、`on_lane_planning.cc:159` planner Init、`planning_gflags.cc:55-58`、`planning_config.proto:40`。
- **遗留待核项**：① `LaneFollowScenario::IsTransferable` 是否恒真（→「排在 LANE_FOLLOW 之后=没注册」这条推论未取代码证据），以及 `Scenario::Process/Enter/Exit/GetStatus` 语义 → 04 篇；② `ScenarioStatusType` 枚举定义未开文件；③ lattice/navi/rtk 三个 planner 的 `.h/.cc` 未 read（仅 grep 到类声明与注册宏），其 `PlanOnReferenceLine` 实现与可用性未实跑验证；④ lattice/navi 的 plugins.xml 路径 bug 是**静态推断**（xml path 指向的 .so 不存在 + plugin_manager 取 path 加载），未实际起进程看 AWARN；⑤ `PluginManager::GetPluginConfPath` 实现未读；⑥ `DependencyInjector` 内容未展开；⑦ 本车 profile 为何加 `FREE_SPACE`、注释 `SQUARE` 的来由未查（profile 变更记录未追）。
