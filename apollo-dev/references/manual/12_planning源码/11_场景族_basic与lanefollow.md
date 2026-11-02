# 11 场景族：基础安全类 + LANE_FOLLOW（兜底）

<!--
file: references/manual/12_planning源码/11_场景族_basic与lanefollow.md
scope: 11.0（默认；本机 profile = ARCF_40P）
tags: LANE_FOLLOW, EMERGENCY_STOP, STOP_SIGN_UNPROTECTED, YIELD_SIGN, PULL_OVER, EMERGENCY_PULL_OVER, Scenario, IsTransferable, first-match, 兜底场景, stage链, pipeline.pb.txt, scenario_conf.pb.txt, 孤儿conf, PadMessage
sources:
- /opt/apollo/neo/src/modules/planning/scenarios/lane_follow/lane_follow_scenario.cc（全 44 行）
- /opt/apollo/neo/src/modules/planning/scenarios/stop_sign_unprotected/stop_sign_unprotected_scenario.cc（全 200 行）
- /opt/apollo/neo/src/modules/planning/scenarios/stop_sign_unprotected/stage_creep.cc（全 161 行）
- /opt/apollo/neo/src/modules/planning/scenarios/stop_sign_unprotected/stage_stop.cc（44–253 行精读）
- /opt/apollo/neo/src/modules/planning/scenarios/emergency_stop/emergency_stop_scenario.cc（全 81 行）
- /opt/apollo/neo/src/modules/planning/scenarios/yield_sign/yield_sign_scenario.cc（全 161 行）
- /opt/apollo/neo/src/modules/planning/scenarios/emergency_pull_over/emergency_pull_over_scenario.cc（全 80 行）
- /opt/apollo/neo/src/modules/planning/scenarios/pull_over/pull_over_scenario.cc（55–99 行精读）
- /apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt（生效档，13 条 + SQUARE 注释，cat 全）
- 6 个场景的 conf/pipeline.pb.txt 与 conf/scenario_conf.pb.txt（生效档，cat 全，未逐行 read）
- manual/12_planning源码/{03,04,05,06,09,15} 篇 + 15_二次开发手册/02（read 引用其已核结论）
-->

## 0. 一句话作用

本文件覆盖 `public_road_planner_config.pb.txt` 里**基础安全类场景 + 兜底场景**：EMERGENCY_PULL_OVER、
EMERGENCY_STOP、STOP_SIGN_UNPROTECTED、YIELD_SIGN、PULL_OVER、LANE_FOLLOW。它们构成「正常沿道巡航
（LANE_FOLLOW）→ 遇信号/标志/终点/异常（安全类场景）→ 完成后再回落」的 scenario 层主骨架。
选场景机制（first-match）、stage/task 编排、conf 三层规则见 [03](03_planners_public_road.md) /
[04](04_scenario框架.md) / [05](05_stage框架.md) / [09](09_conf与gflags体系.md)，本篇只做**本族的清单 + 精读 + 进出语义**。

## 1. 本族场景清单表（①）

注册清单现场核对：`/apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt`
（`readlink -f` → `/apollo_workspace/profiles/ARCF_40P/...`，**profile 生效档**），**13 条注册 + `SQUARE` 整段被 `#` 注释**。
本族 6 个场景的 name/type 与任务书分组**完全一致**，无改名；但它们在注册表里**不是连续块**（中间夹着
VALET_PARKING_PARK、BARE_INTERSECTION、三个 TRAFFIC_LIGHT、PARK_AND_GO、FREE_SPACE），下表「位置」是真实序号。

| name | 位置 | 目录 `scenarios/<x>` | class | IsTransferable 触发条件（一句话） | stage 链（pipeline `name` 别名，首条=入口） | 关键 conf |
|---|---|---|---|---|---|---|
| EMERGENCY_PULL_OVER | 1 | emergency_pull_over | EmergencyPullOverScenario | 参考线非空且 `PadMessage == PULL_OVER` | `EMERGENCY_PULL_OVER_SLOW_DOWN` → `EMERGENCY_PULL_OVER_APPROACH` → `EMERGENCY_PULL_OVER_STANDBY` | max_stop_deceleration 4.5 / target_slow_down_speed 2.0 / stop_distance 1.5 |
| EMERGENCY_STOP | 2 | emergency_stop | EmergencyStopScenario | `PadMessage == STOP` | `EMERGENCY_STOP_APPROACH` → `EMERGENCY_STOP_STANDBY` | max_stop_deceleration 6.0 / stop_distance 1.0 |
| STOP_SIGN_UNPROTECTED | 5 | stop_sign_unprotected | StopSignUnprotectedScenario | lane_follow 命令 + 首个 overlap 是 STOP_SIGN 且距离 ∈ (0, 4.0m] | `..._PRE_STOP` → `..._STOP` → `..._CREEP` → `..._INTERSECTION_CRUISE` | start_stop_sign_scenario_distance 4.0 / stop_duration_sec 1.0 / stop_timeout_sec 8.0 / creep_timeout_sec 10.0 |
| YIELD_SIGN | 6 | yield_sign | YieldSignScenario | lane_follow 命令 + 首个 overlap 是 YIELD_SIGN 且距离 ∈ (0, 10.0m] | `YIELD_SIGN_APPROACH` → `YIELD_SIGN_CREEP` | start_yield_sign_scenario_distance 10.0 / max_valid_stop_distance 4.5 / creep_timeout_sec 10.0 |
| PULL_OVER | 10 | pull_over | PullOverScenario | lane_follow 命令 + 开 `FLAGS_enable_pull_over_at_destination` + 终点在道 + 距离 ∈ [5.0, 20.0m] + 最右道 | `PULL_OVER_APPROACH` → `PULL_OVER_RETRY_APPROACH_PARKING`(`enabled:false`) → `PULL_OVER_RETRY_PARKING` | start_pull_over_scenario_distance 20.0 / pull_over_min_distance_buffer 5.0 |
| LANE_FOLLOW | 13（最后） | lane_follow | LaneFollowScenario | lane_follow 命令 + 参考线非空 → **无条件 true**（兜底） | 单 stage `LANE_FOLLOW_STAGE` | 无 scenario_conf（仅 pipeline） |

> stage 链括号里的 `(enabled:false)` 是该 stage 在 pipeline 里被置 `enabled:false`，但上游 stage 仍可能把
> `next_stage_` 指向它（05 篇 §2.5）。各 stage 的 task 链与 fallback 见 §2/§3；除 PULL_OVER_RETRY_PARKING 走
> open_space task 外，本族 stage 的 task 几乎都是「LANE_FOLLOW_PATH → … → PIECEWISE_JERK_SPEED」同一套 10 个。

## 2. LANE_FOLLOW 精读（默认兜底场景，②）

- **目录最小**：`scenarios/lane_follow/` 只有 `lane_follow_scenario.{h,cc}` + `lane_follow_stage.{h,cc}` + `conf/pipeline.pb.txt`；
  **无 `scenario_conf.pb.txt`、无 `context.h`**（`ls -R` 已核）→ 它不 override `Init`、不 `LoadConfig`，直接用基类 `Scenario::Init`。
- **`IsTransferable` 无条件 true**（`lane_follow_scenario.cc:29-41`，全文 44 行只有这一个函数，本轮 read 已核）：
  ```cpp
  31  if (!frame.local_view().planning_command->has_lane_follow_command()) return false;
  34  if (frame.reference_line_info().empty()) return false;
  37  if (other_scenario == nullptr) return true;
  40  return true;                              // 37 与 40 两条分支都 return true
  ```
  即：**只要当前是 lane_follow 类命令且参考线非空，LANE_FOLLOW 恒返回 true**。配合 first-match
  （[03](03_planners_public_road.md) §2.3 `scenario_manager.cc:56-76`）：在 lane_follow 命令下，**排在它之后的场景永远不会被询问**
  （所以它是兜底，必须排最后）。严格限定：泊车等**非** lane_follow_command 时它在 cc:31-33 返回 false，后面的场景仍会被问到。
- **兜底地位的两处证据**：① `ScenarioManager::Init` 把 name 恰为 `"LANE_FOLLOW"` 的那条记成 `default_scenario_type_`
  （scenario_manager.cc:46-48，引 [03]）；② `ScenarioManager::Reset` 回落 `default_scenario_type_`（cc:78-85）——即全 false 时
  回落 LANE_FOLLOW，进程刚起时 `current_scenario_` 也先指它。
- **stage 链**：单 stage `LANE_FOLLOW_STAGE`（type `LaneFollowStage`）。task 顺序（= 执行顺序）：
  OBSTACLE_NUDGE_DECIDER → LANE_CHANGE_PATH_GNERIC → LANE_FOLLOW_PATH → LANE_BORROW_PATH_GENERIC → FALLBACK_PATH →
  PATH_DECIDER → RULE_BASED_STOP_DECIDER → SPEED_BOUNDS_PRIORI_DECIDER → SPEED_HEURISTIC_OPTIMIZER → SPEED_DECIDER →
  SPEED_BOUNDS_FINAL_DECIDER → PIECEWISE_JERK_SPEED；`fallback_task: SMOOTH_STOP_TRAJECTORY_FALLBACK`。
  ⚠️ 第 2 个 task 别名是 `LANE_CHANGE_PATH_GNERIC`（**上游拼写错误**，应为 GENERIC）——它决定实例 conf 文件名，写 conf 时照抄这个错拼。

## 3. 代表性安全场景精读：STOP_SIGN_UNPROTECTED（③）

无保护停车让行 = 「过停止线前先停够 1s → 确认无争抢车 → 蠕行探出 → 通过路口」。四阶段状态机，逐段已核：

### 3.1 scenario 生命周期（`stop_sign_unprotected_scenario.cc`，全 200 行 read）

- **Init**（cc:44-57）：`Scenario::Init` → `LoadConfig<ScenarioStopSignUnprotectedConfig>(&context_.scenario_config)`。
- **IsTransferable**（cc:98-135）：`has_lane_follow_command`（:100）→ `other_scenario==nullptr || refline 空` 早退（:103）→
  遍历 `FirstEncounteredOverlaps()`（已排序）：遇到 `SIGNAL` 或 `YIELD_SIGN` 在 STOP_SIGN 之前 → false（:112-114）；
  第一个 `STOP_SIGN` 记下（:115-118）→ 没有 stop_sign → false（:120）→
  `distance = stop_sign_overlap.start_s − AdcSlBoundary().end_s()`（:123-125）→
  `0 < distance ≤ start_stop_sign_scenario_distance(4.0m)`（:129-132）→ return。
- **Enter**（cc:145-197）：取参考线首个 STOP_SIGN overlap 的 object_id，写入
  `planning_status.stop_sign.current_stop_sign_overlap_id`（:174-177），`watch_vehicles.clear()`（:193），
  再 `GetAssociatedLanes(*stop_sign)`（:195-196，:62-96 把该 stop sign 关联的所有车道的 overlap 收进 `context_.associated_lanes`）。
- **Exit**（cc:137-143）：`planning_status.mutable_stop_sign()->Clear()`。

### 3.2 stage 链与跳转（pipeline 4 条 + 三个 stage 的 next_stage_）

pipeline 顺序：`STOP_SIGN_UNPROTECTED_PRE_STOP` → `STOP_SIGN_UNPROTECTED_STOP` → `STOP_SIGN_UNPROTECTED_CREEP` →
`STOP_SIGN_UNPROTECTED_INTERSECTION_CRUISE`。四个 stage 的 task 完全相同（10 个 + fallback `SMOOTH_STOP_TRAJECTORY_FALLBACK`）。

| stage | 干什么 | 跳转（`next_stage_`） |
|---|---|---|
| PRE_STOP | 收 `watch_vehicles`（关联车道上的障碍，按 `watch_vehicle_max_valid_stop_distance=5.0` 过滤） | → `STOP_SIGN_UNPROTECTED_STOP`（stage_pre_stop.cc:259，grep 核对） |
| STOP | `ExecuteTaskOnReferenceLine` 跑任务 → 停在停止线前等 `stop_duration_sec(1.0s)`；有 watch 车则继续等，`wait_time > stop_timeout_sec(8.0s)` 且 watch 车 ≤1 时超时放行 | → `STOP_SIGN_UNPROTECTED_CREEP`（stage_stop.cc:241，read 已核） |
| CREEP | `ProcessCreep`（基类 BaseStageCreep）蠕行探出 → `ExecuteTaskOnReferenceLine` → `CheckCreepDone(…, creep_timeout_sec=10.0)` | → `STOP_SIGN_UNPROTECTED_INTERSECTION_CRUISE`（stage_creep.cc:156，read 已核） |
| INTERSECTION_CRUISE | 过路口巡航 | `FinishStage()` → `FinishScenario()` 结束整场景（grep 核对） |

### 3.3 精读 stage_creep（stage_creep.cc，全 161 行）与 stage_stop（stage_stop.cc 44–253）

- **stage_creep.cc**：`Init`（:42-53）先 `CHECK_NOTNULL(context)` 再 `Stage::Init(...)`——override Init 的标准写法。
  `Process`（:55-125）：取 `GetContextAs<StopSignUnprotectedContext>()` → `if(!pipeline_config_.enabled()) return FinishStage();`（:65-67，
  **disabled stage 由 stage 自己跳过**的证据）→ 逐参考线 `ProcessCreep`（:76，来自中间基类 `BaseStageCreep`，对 PluginManager 不可见）→
  `ExecuteTaskOnReferenceLine`（:84）→ 取 overlap 重设 `SetJunctionRightOfWay(stop_sign_start_s, false)`（:103）→
  `distance ≤ 0` 时用 `SpeedProfileGenerator::GenerateFixedDistanceCreepProfile(0.0,0)` 顶出蠕行速度（:113-117）→
  `CheckCreepDone(…, wait_time, creep_timeout_sec)` 则 `FinishStage()`（:119-122）→ 否则 `RUNNING`（:124）。
  `FinishStage`（:155-158）设 `next_stage_ = "STOP_SIGN_UNPROTECTED_INTERSECTION_CRUISE"` 并返回 `FINISHED`。
  `GetOverlapStopInfo`（:133-153）从 `planning_status.stop_sign().current_stop_sign_overlap_id()` 取 overlap（**供基类 ProcessCreep 回调**）。
- **stage_stop.cc**：`Process`（:50-147）：`ExecuteTaskOnReferenceLine`（:60）→ `SetJunctionRightOfWay`（:78）→
  越过停止线超 1.0m（`kPassStopLineBuffer`）直接 `FinishStage`（:80-87）→ 未停够 `stop_duration_sec` 则 `RUNNING`（:90-96）→
  无 watch 车 → `FinishStage`（:100-102）→ 有 watch 车把 id 写 `wait_for_obstacle_id`（:130-135）→
  `wait_time > stop_timeout_sec && watch 车 ≤1` 超时放行（:138-141）→ 否则 `RemoveWatchVehicle`（:143-144，:152-225 按 >10m 清掉已离开的车）。
  `FinishStage`（:227-243）：写 `done_stop_sign_overlap_id`、清 `wait_for_obstacle_id`、记 `creep_start_time`（:239）→
  `next_stage_ = "STOP_SIGN_UNPROTECTED_CREEP"`（:241）。

### 3.4 conf（`conf/scenario_conf.pb.txt`，生效档）

`start_stop_sign_scenario_distance: 4.0`、`watch_vehicle_max_valid_stop_distance: 5.0`、`max_valid_stop_distance: 2.0`、
`stop_duration_sec: 1.0`、`stop_timeout_sec: 8.0`、`creep_timeout_sec: 10.0`、`creep_stage_config{min_boundary_t:6.0,
ignore_max_st_min_t:0.1, ignore_min_st_min_s:15.0}`。
**`conf/` 下没有 stage 子目录**（`ls -R` 已核：只有 pipeline + scenario_conf 两个文件）→ 4 个 stage 的 10 个 task 全部跑
task 包自带 `default_conf.pb.txt`，没有实例级覆盖。改这些 task 参数要改 ④ `/apollo/modules/planning/tasks/<pkg>/conf/default_conf.pb.txt`
（或新建 `scenarios/stop_sign_unprotected/conf/<stage 小写>/<task 小写>.pb.txt`）。

## 4. 每个场景一句话（进 / 干 / 出，④）

- **LANE_FOLLOW**：lane_follow 命令下永远可进，是默认/兜底态；沿参考线跑标准路径+速度 pipeline；被更高优先级场景抢走或全程跑满即出。
- **EMERGENCY_STOP**：底盘收到 `PadMessage::STOP`（急停命令）进；APPROACH→STANDBY 两段用 `FAST_STOP_TRAJECTORY_FALLBACK` 快速刹停
  （`max_stop_deceleration=6.0`、`stop_distance=1.0`）；`PadMessage` 取消（IsTransferable 回 false）后由 ScenarioManager 换回。
- **STOP_SIGN_UNPROTECTED**：前方 4m 内首个地图 overlap 是无保护 STOP_SIGN 进；PRE_STOP 观察 → STOP 停够 1s/让行 → CREEP 蠕行 →
  INTERSECTION_CRUISE 过口；整链走完 `FinishScenario()` 交还重选。
- **YIELD_SIGN**：前方 10m 内首个 overlap 是 YIELD_SIGN（且不在信号灯/停车让行之后）进；APPROACH 减速 → CREEP 蠕行让行；同理走完出。
- **PULL_OVER**：lane_follow 命令 + 开了 `--enable_pull_over_at_destination` + 终点投影在道 + 距终点 5~20m + 最右道 进；
  APPROACH 用 `PULL_OVER_PATH` 生成靠边轨迹，失败进 RETRY（open_space）；停到位出。
- **EMERGENCY_PULL_OVER**：底盘 `PadMessage::PULL_OVER` 进；SLOW_DOWN 先减速到 2.0m/s → APPROACH 靠边 → STANDBY 待命；命令解除即出。
  （PULL_OVER 是「到目的地主动靠边」，EMERGENCY_PULL_OVER 是「被命令紧急靠边」，二者触发来源不同、都写 `planning_status.pull_over`。）

## 5. ⚠️ 本环境注意（⑤）

1. **书写顺序 = first-match 优先级**（无 cost/score，[03](03_planners_public_road.md) §2.3 `scenario_manager.cc:56-76`）：
   每帧按 conf 顺序问 `IsTransferable`，**第一个 true 即 return**。本族里 EMERGENCY_PULL_OVER(#1)、EMERGENCY_STOP(#2) 排最前，
   优先于 STOP_SIGN/YIELD/PULL_OVER；把新场景插到中间即改变谁先抢。
2. **LANE_FOLLOW 必须排最后且 name 恰为 `"LANE_FOLLOW"`**（§2 兜底证据）。排在它之后 = 在 lane_follow 命令下**永不生效**。
   改序/改 name 都会破坏兜底识别（`scenario_manager.cc:46-48`）。
3. **已装未注册差集 6 个**（[15](15_本环境运行现状.md) §3.1）：`lane_escape`、`lane_follow_park`、`large_curvature`、
   `precise_parking`、`square`（被注释）、`valet_parking`（被 `valet_parking_park` 替换）。**加进 planner conf 即启用，无需重编**；
   但 `square` 的实例 conf 还是孤儿（见下条），启用前先清。
4. **实例 conf 命名 = pipeline `name` 别名的 tolower**（`config_util.cc:26-30`，只 tolower 不转下划线，[09](09_conf与gflags体系.md) §2.5），
   **文件名写错只 AWARN 静默走 default_conf**（`config_util.h:86-89` `LoadMergedConfig`）。本机现成孤儿 conf（[15](15_本环境运行现状.md) §4③，
   7 个）：`large_curvature/conf/large_curvature/{open_space_rt_optimizer,open_space_trajectory_optimizer}.pb.txt`、
   `valet_parking_park/conf/*/{open_space_trajectory_optimizer,open_space_roi_decider}.pb.txt`、
   `square/conf/square_lane_follow_stage/path_decider.pb.txt` —— 改参数前先拿 pipeline 的 `name` 字段对文件名。
5. **本族特有坑**：LANE_FOLLOW 的 task 别名 `LANE_CHANGE_PATH_GNERIC` 是上游错拼，照抄不修（修了 conf 反而失配）；
   STOP_SIGN/YIELD/EMERGENCY_STOP/EMERGENCY_PULL_OVER 四族 conf **没有 stage 子目录**，task 全走 default_conf；
   `conf` 生效档一律在 **profile 覆盖层**（`readlink -f` 判层，别改 `/opt/apollo/neo/share`）。
6. **scenario 注册写错 = `ACHECK` 崩**（`scenario_manager.cc:43-44`），与「stage/task 实例 conf 写错 = AWARN 静默降级」是两种失败模式，别混（[04](04_scenario框架.md) §5）。

## 6. 修改与扩展点（二次开发，⑥）

完整 11 步见 [../15_二次开发手册/02_新增Scenario与Stage.md](../15_二次开发手册/02_新增Scenario与Stage.md)。本族四个改动点：

1. **新增一个安全类场景**：`buildtool create --template planning_scenario modules/planning/scenarios/my_sc --scenario MySc --stage MyStage`
   （`--scenario` 传 **PascalCase**，`--stage` 会吞位置参数，package_path 放最前）→ 填 `IsTransferable`（早退 false + conf 阈值形态，
   照 stop_sign cc:98-135）→ 填 `pipeline.pb.txt` 与 `scenario_conf.pb.txt` → 编译 `buildtool build -p modules/planning/scenarios/my_sc`
   → **最后**在 ④ `public_road_planner_config.pb.txt` 插入 `scenario{name,type}` 且**必须在 `LANE_FOLLOW` 之前** → 重启 planning。
2. **只调阈值（不重编）**：改 ④ `/apollo/modules/planning/scenarios/<sc>/conf/scenario_conf.pb.txt`（软链写穿 profile 层，重启生效）；
   进版本管理则改 ① `/apollo_workspace/modules/planning/scenarios/<sc>/conf/` 再 `buildtool build -p`。
3. **改 stage/task 编排**：改 ④ `<sc>/conf/pipeline.pb.txt`（stage 列表第一条=入口，其余靠 `next_stage_` 别名跳；task 顺序=执行顺序）。
4. **启用 6 个已装未注册场景**：只改 ④ planner conf 加一条（注意排在 LANE_FOLLOW 之前、type 逐字等于类名，否则 ACHECK 崩），不用重编。

## 7. 验证命令（只读，⑦）

```bash
# 生效注册表（认层 + 顺序即优先级）
readlink -f /apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt
cat     /apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt   # 13 条 + SQUARE 注释
# 某场景 stage 链 + conf
cat /apollo/modules/planning/scenarios/stop_sign_unprotected/conf/pipeline.pb.txt
cat /apollo/modules/planning/scenarios/stop_sign_unprotected/conf/scenario_conf.pb.txt
ls /apollo/modules/planning/scenarios/stop_sign_unprotected/conf/                            # 无 stage 子目录
# 兜底证据
sed -n '29,41p' /opt/apollo/neo/src/modules/planning/scenarios/lane_follow/lane_follow_scenario.cc
sed -n '46,48p;56,76p;78,85p' /opt/apollo/neo/src/modules/planning/planners/public_road/scenario_manager.cc
# 插件装了没（19 个 scenario 目录）
ls /opt/apollo/neo/lib/modules/planning/scenarios/
# 孤儿实例 conf 全量扫描（改参数前必跑，输出应 = 15 篇 §4③ 的 7 条）
cd /apollo/modules/planning/scenarios
for sc in */; do sc=${sc%/}; pl="$sc/conf/pipeline.pb.txt"; [ -f "$pl" ] || continue
  aliases=$(grep 'name:' "$pl" | grep -v '^ *#' | sed 's/.*name: *"\(.*\)".*/\1/' | tr 'A-Z' 'a-z' | sort -u)
  for d in $sc/conf/*/; do [ -d "$d" ] || continue
    for f in "$d"*.pb.txt; do [ -f "$f" ] || continue; b=$(basename "$f" .pb.txt)
      echo "$aliases" | grep -qx "$b" || echo "ORPHAN: $f -> $(readlink $f)"; done; done; done
```

## 8. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线 Apollo 11.0.0 包工作区，`profiles/current → ARCF_40P`。全程只读，未启动任何模块。
- **read 逐行核对**：`lane_follow_scenario.cc`(1-44)、`stop_sign_unprotected_scenario.cc`(1-200)、`stop_sign_unprotected/stage_creep.cc`(1-161)、
  `stop_sign_unprotected/stage_stop.cc`(44-253)、`emergency_stop_scenario.cc`(1-81)、`yield_sign_scenario.cc`(1-161)、
  `emergency_pull_over_scenario.cc`(1-80)、`pull_over_scenario.cc`(55-99)；及手册 [03](03_planners_public_road.md) / [04](04_scenario框架.md) /
  [05](05_stage框架.md) / [06](06_task框架与task大族.md) / [09](09_conf与gflags体系.md) / [15](15_本环境运行现状.md) /
  [../15_二次开发手册/02](../15_二次开发手册/02_新增Scenario与Stage.md)（其行号结论直接引用）。
- **cat/grep/ls/readlink 证据（未 read，不引行号）**：生效 `public_road_planner_config.pb.txt` 全文；6 个场景的 `pipeline.pb.txt` 与
  `scenario_conf.pb.txt` 全文（④ 生效档）；`stop_sign_unprotected/stage_pre_stop.cc`、`stage_intersection_cruise.cc` 的 next_stage_/FinishStage grep；
  `lane_follow/`、`stop_sign_unprotected/conf/` 的 `ls -R`；`readlink -f` planner conf 落点。
- **遗留待核**：① `stage_pre_stop.cc`、`stage_intersection_cruise.cc` 未 read 全文（仅 grep 到跳转行，其内部限速/让行细节待核）；
  ② `BaseStageCreep::ProcessCreep/CheckCreepDone` 实现在未发布的 `planning_interface_base` .so，函数体待核（05 篇同结论）；
  ③ YIELD_SIGN_CREEP 是否也走 BaseStageCreep 未 read；④ 本族各场景运行期切换日志未实跑验证；⑤ PULL_OVER 的 IsTransferable 后半段
  （:98-164 路口/最右道判定）引 04 篇已核结论，本轮只 read 到 :99。
