# 08 pnc_map 与参考线

<!--
file: references/manual/12_planning源码/08_pnc_map与参考线.md
scope: 11.0（默认）
tags: pnc_map, PncMapBase, LaneFollowMap, ReferenceLineProvider, ReferenceLine, ReferenceLineInfo, RouteSegments, PlanningCommand, reference_line_config, pnc_map_class, 参考线
sources:
  /opt/apollo/neo/include/modules/map/pnc_map/pnc_map_base.h（1–114 全文）
  /opt/apollo/neo/src/modules/map/pnc_map/pnc_map_base.cc（1–72 全文）
  /opt/apollo/neo/src/modules/planning/pnc_map/lane_follow_map/lane_follow_map.h（30–99、226–236 精读）
  /opt/apollo/neo/src/modules/planning/pnc_map/lane_follow_map/lane_follow_map.cc（40–79 精读）
  /opt/apollo/neo/src/modules/planning/planning_base/reference_line/reference_line_provider.h（40–216 精读）
  /opt/apollo/neo/src/modules/planning/planning_base/reference_line/reference_line_provider.cc（55–369 精读）
  /opt/apollo/neo/src/modules/planning/planning_base/common/reference_line_info.h（50–80 精读）
  /opt/apollo/neo/src/modules/planning/planning_base/common/frame.cc（147–181 精读）
  /opt/apollo/neo/src/modules/planning/planning_component/on_lane_planning.cc（125–214 精读）
  /opt/apollo/neo/src/modules/planning/planning_base/gflags/planning_gflags.cc（60–99、435–450 精读）
-->

## 0. 一句话作用

**pnc_map 把 routing 结果（`PlanningCommand`）翻译成一串可行驶的 `RouteSegments`（车道段序列），`ReferenceLineProvider` 再把 RouteSegments 平滑成 `ReferenceLine`（几何参考线）；`Frame` 用「ReferenceLine + RouteSegments」组装出每帧的 `ReferenceLineInfo`（承载障碍物/决策/限速的规划工作面）。** 位置：`/apollo/planning/command` → `ReferenceLineProvider` → pnc_map 插件 → `Frame::reference_line_info_` → task/scenario 全都在 `ReferenceLineInfo` 上工作。主循环侧见 [02_planning_component主循环](02_planning_component主循环.md)。

## 1. 关键符号与文件

| 符号/类/概念 | 文件（层） | 行号 | 说明 |
|---|---|---|---|
| `apollo::planning::PncMapBase` | `/opt/apollo/neo/include/modules/map/pnc_map/pnc_map_base.h`（②′ include；**src 侧只有 .cc**，头文件在 map 包不在 planning 树） | 47–111 | 抽象基类，纯虚 6 个 + 虚 1 个 |
| `PncMapBase::UpdatePlanningCommand`（非纯虚，有默认实现） | `/opt/apollo/neo/src/modules/map/pnc_map/pnc_map_base.cc`（②） | 39–47 | `IsValid(command)` 通过后存 `last_command_` |
| `PncMapBase::LookForwardDistance` | 同上 | 49–55 | `v*look_forward_time_sec > 180` ? 250 : 180 |
| `PncMapBase::IsNewPlanningCommand` | 同上 | 57–69 | 非 motion_command 直接 false；否则 proto 逐字段比较 |
| `FLAGS_look_backward_distance / look_forward_short/long_distance` | 同上 | 28–37 | 50 / 180 / 250（**定义在 map 包，不在 planning_gflags.cc**） |
| `apollo::planning::LaneFollowMap` | `/opt/apollo/neo/src/modules/planning/pnc_map/lane_follow_map/lane_follow_map.h`（②，完整） | 41–230 | 本环境**唯一**的 PncMapBase 实现 |
| 注册宏 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN` | 同上 | 232–233 | `(apollo::planning::LaneFollowMap, PncMapBase)` |
| `LaneFollowMap::CanProcess` | `.../lane_follow_map.cc`（②） | 55–57 | 只认 `command.has_lane_follow_command()` |
| `ReferenceLineProvider` | `/opt/apollo/neo/src/modules/planning/planning_base/reference_line/reference_line_provider.h`（②） | 61–213 | 持有 pnc_map 插件列表 + 平滑器 + 生成线程 |
| `ReferenceLine` | `/opt/apollo/neo/src/modules/planning/planning_base/reference_line/reference_line.h`（②） | 40 起 | 纯几何：`ReferencePoint` 序列 + `hdmap::Path map_path_`；支持 stitch/Segment/XYToSL |
| `ReferenceLineInfo` | `/opt/apollo/neo/src/modules/planning/planning_base/common/reference_line_info.h`（②） | 52–56 | 头注释原文：“holds **all data for one reference line**”（车辆状态、起点、PathDecision、限速、st_graph、轨迹…） |
| `Frame::CreateReferenceLineInfo` | `/opt/apollo/neo/src/modules/planning/planning_base/common/frame.cc`（②） | 147–167 | 按 `reference_lines`/`segments` 逐对 emplace，`set_index` |

## 2. 机制与数据流

```
/apollo/planning/command (PlanningCommand)
   │ OnLanePlanning::RunOnce → on_lane_planning.cc:288-301
   ├─ IsDifferentRouting(last_command_, cmd) → Reset() (:293)
   └─ reference_line_provider_->UpdatePlanningCommand(cmd) (:296-297)
         │ reference_line_provider.cc:109-142
         ├─ 遍历 pnc_map_list_ 找第一个 CanProcess==true → current_pnc_map_ (:113-119)
         └─ IsNewPlanningCommand → current_pnc_map_->UpdatePlanningCommand (:131-138)
                 │ LaneFollowMap: 校验 lane_follow_command 有效性 + 展开 route → RouteSegments 索引
生成侧（二选一）
   ├─ 线程模式 FLAGS_enable_reference_line_provider_thread=true：Start() 起 cyber::Async(GenerateThread) (:178-191)
   │     GenerateThread 每 50ms 一轮 → CreateReferenceLine → UpdateReferenceLine (:267-288)
   └─ 同步模式（本机生效档就是这个，见 §5）：GetReferenceLines 内直接 CreateReferenceLine (:326-334)
消费侧
   OnLanePlanning::InitFrame → GetReferenceLines(&reference_lines,&segments) (on_lane_planning.cc:172-175)
   → LookForwardDistance(v) (:177-178) → ref_line.Segment / seg.Shrink 按车位置裁剪 (:180-197)
   → frame_->Init(...) (:199-201) → Frame::CreateReferenceLineInfo (frame.cc:147-167，346 调用)
```

**ReferenceLine vs ReferenceLineInfo 分工**（按头文件归纳，未脑补）：
`ReferenceLine` 是**无状态几何体**——参考点序列 + hdmap Path，提供拼接（stitch，reference_line.h:50 起注释给了两个成功拼接示例）、`Segment`、`XYToSL`、限速查询；一条 ReferenceLine 可跨帧复用（provider 内部 `reference_lines_` + `reference_line_history_`）。
`ReferenceLineInfo` 是**每帧、每条参考线一份的规划工作面**——构造入参 `(vehicle_state, adc_planning_point, reference_line, route_segments)`（reference_line_info.h:61–64），内部再挂 `PathDecision`、障碍物、st_graph、决策与轨迹结果；task/traffic_rule 全在它上面读写。

**线程模型要点**：生成线程只在 `Start()` 且 flag 打开时创建（`task_future_ = cyber::Async(...)`，:188），周期固定 `kSleepTime = 50ms`（:269），`has_planning_command_` 为假直接空转（:272-274）；`GetReferenceLines` 只做拷贝（:319-325），拿不到就退回 `reference_line_history_.back()` 并打 `AWARN "Use reference line from history!"`（:337-347）。`Stop()` 用 `task_future_.get()` 汇合（:193-198）。

## 3. 注册与配置

| 项 | 值/路径 | 证据 |
|---|---|---|
| plugins.xml 原文 | `<library path="modules/planning/pnc_map/lane_follow_map/liblane_follow_map.so">` + `<class type="apollo::planning::LaneFollowMap" base_class="apollo::planning::PncMapBase">` | cat `/opt/apollo/neo/src/modules/planning/pnc_map/lane_follow_map/plugins.xml` |
| BUILD 规则 | `apollo_plugin(name="liblane_follow_map.so", description=":plugins.xml", …)` | 同目录 BUILD |
| 已安装 .so | `/opt/apollo/neo/lib/modules/planning/pnc_map/lane_follow_map/liblane_follow_map.so` | ls |
| 插件索引条目 | `/opt/apollo/neo/share/cyber_plugin_index/modules__planning__pnc_map__lane_follow_map__liblane_follow_map.so`，内容 `share/modules/planning/pnc_map/lane_follow_map/plugins.xml` | ls + cat |
| 选择字段（proto） | `planning_config.proto:23-25` `message ReferenceLineConfig { repeated string pnc_map_class = 2; }`；`PlanningConfig.reference_line_config = 3`（:39） | grep（proto 未 read → 行号标**待核**） |
| 生效 conf | `/apollo/modules/planning/planning_component/conf/planning_config.pb.txt` → readlink 落点 `/apollo_workspace/profiles/ARCF_40P/...`，内含 `reference_line_config { pnc_map_class: "apollo::planning::LaneFollowMap" }` | cat + readlink |
| 缺省行为 | conf 不写或 `pnc_map_class` 为空 → 代码兜底 `CreateInstance<PncMapBase>("apollo::planning::LaneFollowMap")` | reference_line_provider.cc:88-95 |
| 多插件顺序 | `pnc_map_class` 是 `repeated`，按**书写顺序**建实例，运行时 first-match：第一个 `CanProcess(command)==true` 的胜出 | :96-104、:113-119 |

## 4. 修改与扩展点（二次开发）

1. **换/加自定义 pnc_map 插件**
   - 生成骨架：`buildtool create --template plugin modules/planning/pnc_map/my_map --class_name MyMap --base_class_name PncMapBase`（模板见 CLAUDE.md 三节③），或复制 `lane_follow_map` 目录改名。
   - 必实现（`pnc_map_base.h:51-110`）：`CanProcess`、`GetRouteSegments`、`ExtendSegments`、`FutureRouteWaypoints`、`GetEndLaneWayPoint`、`GetLaneById`、`GetNearestPointFromRouting`、`GetDistanceToDestination`、`GetAdcWaypoint`、私有 `IsValid`；`UpdatePlanningCommand` 覆写时**先调基类**（LaneFollowMap 就是这么做的，lane_follow_map.cc:238）。
   - `plugins.xml`：`base_class` 必须写 `apollo::planning::PncMapBase`（顶层基类，注意命名空间是 **planning** 而头文件在 map 包），`type` 写全限定类名；BUILD 用 `apollo_plugin`（自带 alwayslink）。
   - 装载：`buildtool build -p modules/planning/pnc_map/my_map` 完成 install（只 `bazel build` 运行时看不见）。
   - 启用：改 `/apollo/modules/planning/planning_component/conf/planning_config.pb.txt`（软链→profile 覆盖层，立即生效）
     ```
     reference_line_config { pnc_map_class: "apollo::planning::MyMap"
                             pnc_map_class: "apollo::planning::LaneFollowMap" }
     ```
     顺序即优先级；把 LaneFollowMap 放后面当兜底。
2. **改参考线取值范围**：`look_backward_distance`(50) / `look_forward_short_distance`(180) / `look_forward_long_distance`(250) 在 `pnc_map_base.cc:28-37`，运行期用 `planning.conf` 覆盖即可，不用重编。
3. **改平滑器**：`--smoother_config_filename` 指到 `discrete_points/qp_spline/spiral_smoother_config.pb.txt` 三者之一（本机生效档 planning.conf:14 = discrete_points），构造函数按 `has_qp_spline/has_spiral/has_discrete_points` 分派（reference_line_provider.cc:76-85）。
4. **常用 reference_line 相关 gflags**（planning_gflags.cc，已 read）

| flag | 默认 | 行 | 作用 |
|---|---|---|---|
| `enable_reference_line_stitching` | true | 63 | 参考线拼接（省算力/更稳）；**本机生效档改为 false** |
| `reference_line_stitch_overlap_distance` | 20 | 68 | 拼接重叠长度(m) |
| `enable_smooth_reference_line` | true | 72 | 是否平滑地图参考线 |
| `enable_reference_line_provider_thread` | true | 82 | 独立生成线程；**本机生效档改为 false** |
| `default_reference_line_width` | 4.0 | 85 | 缺省车道宽 |
| `smoothed_reference_line_max_diff` | 5.0 | 88 | 平滑前后最大位置偏差（校验用） |
| `reference_line_endpoint_extend_length` | 10.0 | 92 | 末端延伸长度 |
| `reference_line_max_forward_heading_diff` | 2.5 | 441 | 前向参考线与车头最大夹角 |
| `reference_line_max_backward_heading_diff` | 3.1415926536 | 445 | 后向参考线与车头最大夹角 |
| `look_forward_extend_distance` | 50 | 66 | 延伸参考线的步长 |

## 5. ⚠️ 本环境注意

1. **`PncMapBase` 声明不在 planning 树**：`/opt/apollo/neo/include/modules/map/pnc_map/pnc_map_base.h`（src 侧只有 `pnc_map_base.cc`）。在 `src/modules/planning` 里 grep `class PncMapBase` 永远为空 —— 两棵树都要搜（CLAUDE.md 一节）。命名空间却是 `apollo::planning`，别写成 `apollo::hdmap::PncMapBase`。
2. **本机生效档关掉了参考线生成线程**：`/apollo/modules/planning/planning_component/conf/planning.conf:57` `--enable_reference_line_provider_thread=false`（落点 `/apollo_workspace/profiles/ARCF_40P/...`，非出厂件）。后果：参考线在 `GetReferenceLines` 里**同步**算（reference_line_provider.cc:326-334），一帧规划耗时含平滑耗时；调试「planning 周期变长」先看这条。同档 :15 还关了 stitching。
3. **`planners` 只剩 public_road**，但 pnc_map 与 planner 无关：换 planner 不影响参考线；`navi_planner_config.pb.txt` / `planning_navi.conf` 是孤儿残留，`FLAGS_use_navigation_mode` 分支（provider :66-70、:308-317、:363 起 relative_map）在本机不走。
4. **地图没装/选错图 → 参考线出不来，和代码无关**：`planning.conf:1` flagfile 指 `/apollo/modules/common/data/global_flagfile.txt`，dreamview 选图以 append 追加 `--map_dir`，**gflags 取最后一行**（02 篇 §已核）。现场核对：末行 = `--map_dir=/apollo/modules/map/data/apollo_virutal_map`，该目录**存在**（同目录还有 borregas_ave / demo / sunnyvale）。任何模块 conf 都别再写 `--map_dir`。地图加载失败时 `OnLanePlanning::Init` 直接 `ACHECK(hdmap_) << "Failed to load map"`（on_lane_planning.cc:125-126）；`LaneFollowMap::ToLaneWaypoint/ToLaneSegment` 里 lane id 查不到也是 `ACHECK` 崩（lane_follow_map.cc:59-71）—— 换了图但 routing 结果还是旧图的 lane id 会直接挂。
5. **`CanProcess` 只认 lane_follow_command**（lane_follow_map.cc:55-57）：泊车/其它 external_command 生成的 PlanningCommand 若没有 `lane_follow_command` 字段，`UpdatePlanningCommand` 会打 `AWARN "Find no pnc map for the input command and the old one will be used!"`（provider :125-128）**继续用旧图旧路由**，不报错、表现为「换了指令参考线不变」。
6. **插件改完必须 `buildtool build -p …` install**：索引在 `/opt/apollo/neo/share/cyber_plugin_index/`，本机 `APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`，不扫 bazel-bin。
7. 搜 `/apollo/...` 视口目录用 `grep -R`（`-r` 不跟随符号链接会假空）。

## 6. 验证命令

```bash
# 插件是否真的装了（三件套都要在）
ls /opt/apollo/neo/lib/modules/planning/pnc_map/lane_follow_map/
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep pnc_map
cat /opt/apollo/neo/src/modules/planning/pnc_map/lane_follow_map/plugins.xml

# 当前选了哪个 pnc_map、落点在哪
readlink -f /apollo/modules/planning/planning_component/conf/planning_config.pb.txt
grep -A3 reference_line_config /apollo/modules/planning/planning_component/conf/planning_config.pb.txt

# 生效地图（取最后一行）
grep -n 'map_dir' /apollo/modules/common/data/global_flagfile.txt | tail -1

# 参考线线程/拼接开关现状
grep -n 'reference_line' /apollo/modules/planning/planning_component/conf/planning.conf

# 运行期观察：planning 起来后看 command 与轨迹
cyber_launch start /apollo/modules/planning/planning_component/launch/planning.launch
cyber_channel echo /apollo/planning/command
cyber_channel hz /apollo/planning
```

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线：Apollo 11.0.0 package 工作区。
- **read 打开核对过**：`include/modules/map/pnc_map/pnc_map_base.h`(全文)、`src/modules/map/pnc_map/pnc_map_base.cc`(全文)、`lane_follow_map.h`(30–99、226–236)、`lane_follow_map.cc`(40–79)、`reference_line_provider.h`(40–216)、`reference_line_provider.cc`(55–369)、`reference_line_info.h`(50–63)、`frame.cc`(147–181)、`on_lane_planning.cc`(125–214)、`planning_gflags.cc`(60–99、435–450)、`_template.md`。
- ls/cat/grep 证据（非 read）：pnc_map 目录清单（只有 `lane_follow_map`）、plugins.xml 与 BUILD 原文、`/opt/apollo/neo/lib/...` 与 `cyber_plugin_index` 条目、`planning_config.pb.txt` 与 `planning.conf` 内容 + readlink 落点、`global_flagfile.txt` 末行 map_dir 与 `/apollo/modules/map/data/` 列表。
- **遗留待核**：① `planning_config.proto:23-25/39` 只 grep 未 read → 字段名可信、行号待核；② `reference_line.h` 仅读 25–60 行注释，`Segment/XYToSL/GetSpeedLimit` 实现未读；③ `LaneFollowMap::UpdatePlanningCommand/GetRouteSegments/ExtendSegments` 主体（lane_follow_map.cc:232 起、421 起）未逐行读，RouteSegments 展开与换道段生成细节待核；④ `CreateReferenceLine`(provider :630 起)、`SmoothReferenceLine`/`ExtendReferenceLine`/`Shrink`/`IsValidReferenceLine` 实现未读（平滑与换道优先级 `PrioritizeChangeLane` 只读到 :350-361）；⑤ `route_segments.h`/`hdmap::Path` 未读；⑥ 参考线实际耗时（`LastTimeDelay`，dreamview「ReferenceLineProvider」耗时条）未在本机实测；⑦ `/apollo/planning/command` 生产端（external_command）未核（同 02 篇待核项）。
