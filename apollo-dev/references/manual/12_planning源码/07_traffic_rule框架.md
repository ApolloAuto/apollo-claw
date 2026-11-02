# 07 TrafficRule 框架

<!--
file: references/manual/12_planning源码/07_traffic_rule框架.md
scope: 11.0（默认）
tags: TrafficRule, TrafficDecider, traffic_rule_config.pb.txt, ApplyRule, LoadConfig, default_conf.pb.txt, plugins.xml, crosswalk, region_speed_limit, speed_setting, AddSpeedLimit, BuildStopDecision, 插件, 执行顺序
sources:
- /opt/apollo/neo/include/modules/planning/planning_interface_base/traffic_rules_base/traffic_rule.h（全文 73 行）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/traffic_rules_base/traffic_decider.h（全文 63 行）
- /opt/apollo/neo/src/modules/planning/planning_interface_base/traffic_rules_base/proto/traffic_rules_pipeline.proto（全文）
- /opt/apollo/neo/src/modules/planning/planning_base/proto/plugin_declare_info.proto（全文）
- /opt/apollo/neo/include/modules/planning/planning_base/common/util/config_util.h（全文 114 行）
- /opt/apollo/neo/include/cyber/plugin_manager/plugin_manager.h（155–209 行精读）
- /opt/apollo/neo/src/modules/planning/planning_component/on_lane_planning.cc（350–379 行精读；其余见 02 篇）
- /apollo_workspace/profiles/current/modules/planning/planning_component/conf/traffic_rule_config.pb.txt（生效档，全文 44 行）
- /apollo_workspace/profiles/current/modules/planning/planning_component/conf/planning.conf（1–5 行）
- /opt/apollo/neo/src/modules/planning/traffic_rules/crosswalk/crosswalk.h（全文 63 行）
- /opt/apollo/neo/src/modules/planning/traffic_rules/crosswalk/crosswalk.cc（30–229 行精读）
- /opt/apollo/neo/src/modules/planning/traffic_rules/region_speed_limit/region_speed_limit.h（全文 56 行）
- /opt/apollo/neo/src/modules/planning/traffic_rules/region_speed_limit/region_speed_limit.cc（全文 112 行）
- /opt/apollo/neo/src/modules/planning/traffic_rules/{crosswalk,region_speed_limit}/proto/*.proto、conf/default_conf.pb.txt、plugins.xml（cat 核对）
- /apollo_workspace/.manual_work/inventory/planning_inventory.md（盘点结论引用）
-->

## 0. 一句话作用

TrafficRule 是 planning 里**「按交规改写参考线」的插件族**：每个规划周期、每条参考线，`TrafficDecider` 按
`traffic_rule_config.pb.txt` 里的清单把 11 个 rule 插件逐个调 `ApplyRule(frame, reference_line_info)`，
规则通过「加虚拟停车墙决策」或「加区间限速」把交规写进 `ReferenceLineInfo`，之后才轮到 task 链求解路径/速度。
调用位置在主循环 `OnLanePlanning::RunOnce` 的 planner 之前（on_lane_planning.cc:362-370，见 `02_planning_component主循环.md` §2.4）。

## 1. 关键符号与文件

| 符号/类/概念 | 文件（绝对路径，注明 src/include 完整度） | 行号(已核) | 说明 |
|---|---|---|---|
| `TrafficRule`（顶层基类） | `/opt/apollo/neo/include/modules/planning/planning_interface_base/traffic_rules_base/traffic_rule.h`（**②′ 仅 include 树；src 侧该目录只有 `proto/`**） | 37 | 三个接口 + 一个模板；`Getname()` 51 返回别名 `name_` |
| `Init(name, injector)` | 同上 | 43-44 | **虚函数、有默认实现**（在未随包发布的 `traffic_rule.cc` 里）；派生类必须先调 `TrafficRule::Init` 再 `LoadConfig` |
| `ApplyRule(frame, ref_line_info)` | 同上 | 46-47 | **纯虚**，每周期每条参考线调一次，返回 `common::Status` |
| `Reset()` | 同上 | 49 | **纯虚**，清本规则的跨周期缓存（如 crosswalk 清 overlap 列表） |
| `LoadConfig<T>(T*)` | 同上 | 54-55；实现 63-71 | 从 `config_path_` 读 proto conf，失败 AERROR 返回 false |
| `config_path_` / `name_` / `injector_` | 同上 | 57-60 | `config_path_` 由基类 `Init` 算出（§3.3）；`injector_` 用于访问 `planning_context()`、`vehicle_state()` |
| `TrafficDecider`（规则执行器） | `/opt/apollo/neo/include/modules/planning/planning_interface_base/traffic_rules_base/traffic_decider.h`（**仅 include**） | 47 | 持 `rule_list_`(58) 与 `rule_pipeline_`(59)；`Init(injector)` 50、`Execute(frame, ref_line_info)` 52-53、私有 `BuildPlanningTarget` 57 |
| `TrafficRulesPipeline`（清单 proto） | `/opt/apollo/neo/src/modules/planning/planning_interface_base/traffic_rules_base/proto/traffic_rules_pipeline.proto` | 7-10 | `repeated PluginDeclareInfo rule = 1`——**repeated 即有序** |
| `PluginDeclareInfo` | `/opt/apollo/neo/src/modules/planning/planning_base/proto/plugin_declare_info.proto` | 6-11 | `name`(别名，required) + `type`(类名，required)；与 scenario/task 清单共用同一 proto |
| 执行入口（调用方） | `/opt/apollo/neo/src/modules/planning/planning_component/on_lane_planning.cc`（src 全） | Init 156；Execute 362-370 | `traffic_decider_.Init(injector_)` / 每条参考线一次 `Execute` |
| 执行器成员位置 | `/opt/apollo/neo/src/modules/planning/planning_component/planning_base.h` | 105（grep 命中，未 read 打开该行上下文） | `TrafficDecider traffic_decider_;`——**归 planning_component 的 PlanningBase 持有** |
| `ConfigUtil` | `/opt/apollo/neo/include/modules/planning/planning_base/common/util/config_util.h` | 36、45；`LoadMergedConfig` 76-93；`LoadOverridedConfig` 96-111 | `TransformToPathName` 只做 tolower；`GetFullPlanningClassName` 给类名拼 `apollo::planning::` |
| conf 路径解析 | `/opt/apollo/neo/include/cyber/plugin_manager/plugin_manager.h` | `GetPluginClassHomePath` 160-189；`GetPluginConfPath` 191-208 | 由 plugins.xml 所在目录（去掉 `share/` 前缀）+ conf 相对名，再过 `APOLLO_CONF_PATH` 解析（§3.3） |

## 2. 机制与数据流

### 2.1 一次规划周期里的位置

1. `OnLanePlanning::Init` 阶段 `traffic_decider_.Init(injector_)`（on_lane_planning.cc:156）——**只初始化一次**：读 rule 清单、逐条 `CreateInstance<TrafficRule>` 建实例、逐条 `Init(name, injector)`（清单来源见 §3.1；该函数体在未发布的 `traffic_decider.cc` 内，见 §7 待核）。
2. 每周期 Frame 建好、参考线备好后（02 篇 §2.4 第 3 步），主循环对 `frame_->mutable_reference_line_info()` **逐条参考线**调用 `traffic_decider_.Execute(frame_.get(), &ref_line_info)`（on_lane_planning.cc:362-364）。
3. 任一 rule 返回非 OK，或该参考线 `IsDrivable()` 为假 → `SetDrivable(false)` + `AWARN "... traffic decider failed"`（:365-369），该参考线被后续 planner 排除（不 return，其余参考线继续）。
4. 之后才 `Plan()` 进 planner→scenario→stage→task 链（:372）。

即：**rule 的作用对象是 `ReferenceLineInfo`（限速表、path_decision 上的虚拟障碍物/停车决策），不是轨迹本身**；rule 不会直接改 `ADCTrajectory`。

### 2.2 rule 改写参考线的两种典型手法（本轮抽样两个真实规则）

| 手法 | 代表规则 | 关键调用（已核行号） | 效果 |
|---|---|---|---|
| 加虚拟停车墙决策 | `Crosswalk` | `util::BuildStopDecision(virtual_obstacle_id, crosswalk_overlap->start_s, config_.stop_distance(), StopReasonCode::STOP_REASON_CROSSWALK, wait_for_obstacle_ids, Getname(), frame, reference_line_info)` — crosswalk.cc:210-213 | 在 overlap start_s 前 `stop_distance` 处造一个虚拟障碍物 `CW_<overlap_id>` 并挂 STOP 决策 |
| 加区间限速 | `RegionSpeedLimit` | `reference_line->AddSpeedLimit(overlap.start_s - forward_buffer, overlap.end_s + backward_buffer, <limit>)` — region_speed_limit.cc:67-69 / 82-84 / 98-100 | 在 `[start_s, end_s]` 区间叠加限速；驶出区间自动恢复地图限速（.h:35-36 注释） |

`Crosswalk::ApplyRule` 的骨架（crosswalk.cc:67-79）：`FindCrosswalks` 无命中 → 清 `planning_context()->planning_status()->crosswalk()` 后直接 `Status::OK()`；有命中 → `MakeDecisions`（:81 起）。`MakeDecisions` 内部：从 `planning_context` 恢复上周期 stop timer（:96-102）→ 跳过已越线（`adc_front_edge_s - end_s > min_pass_s_distance`，:114-127）与 `finished_crosswalk`（:130-136）→ 对 `path_decision->obstacles()` 逐个 `CheckStopForObstacle`（:144-145，输入 `util::GetADCStopDeceleration`，:140-142）→ 静止行人在 `start_watch_timer_distance` 内起看门狗计时（:156-158）→ 收集要停的 crosswalk（:195-198）→ 逐个 `BuildStopDecision`（:203-220）→ 把最近的一处写回 `CrosswalkStatus`（:222-229）。

**跨周期状态放在 `injector_->planning_context()->planning_status()`，不放 rule 成员**（rule 实例常驻，`Reset()` 只清成员级缓存：crosswalk.h:43 清 `crosswalk_overlaps_`，region_speed_limit.h:46 空实现）。

## 3. 注册与配置

### 3.1 清单文件：谁被执行、按什么顺序

- 清单文件名来自 gflag `--traffic_rule_config_filename`，生效值是**绝对路径**：`/apollo/modules/planning/planning_component/conf/traffic_rule_config.pb.txt`（生效档 planning.conf:2，已 read）。代码默认值是相对路径（`modules/planning/.../traffic_rule_config.pb.txt`，出处 `planning_base/gflags/planning_gflags.cc`，行号见 02 篇 §3.4；本轮未 read 该文件）。
- ④ 层该文件是软链 → `/apollo_workspace/profiles/current/modules/planning/planning_component/conf/traffic_rule_config.pb.txt`（`ls -l` 已核，Aug 11 16:26 建链）→ **生效档在 profile 覆盖层**，出厂 share 版只有 10 条（引盘点 `planning_inventory.md` §4.2）。
- proto 是 `TrafficRulesPipeline`，`repeated rule` **书写顺序即执行顺序**（无任何优先级/权重字段）。

生效档 11 条全表（`traffic_rule_config.pb.txt` 全文 44 行，行号已核）：

| 顺序 | name（别名） | type（类名） | 生效档行号 | 该 rule 是否有 proto/conf |
|---|---|---|---|---|
| 1 | `BACKSIDE_VEHICLE` | `BacksideVehicle` | 1-4 | 有 |
| 2 | `CROSSWALK` | `Crosswalk` | 5-8 | 有 |
| 3 | `DESTINATION` | `Destination` | 9-12 | 有 |
| 4 | `KEEP_CLEAR` | `KeepClear` | 13-16 | 有（包名 `keepclear`，文件 `keep_clear.cc`） |
| 5 | `REFERENCE_LINE_END` | `ReferenceLineEnd` | 17-20 | 有 |
| 6 | `REROUTING` | `Rerouting` | 21-24 | 有 |
| 7 | `STOP_SIGN` | `StopSign` | 25-28 | 有 |
| 8 | `TRAFFIC_LIGHT` | `TrafficLight` | 29-32 | 有 |
| 9 | `YIELD_SIGN` | `YieldSign` | 33-36 | 有 |
| 10 | `SPEED_SETTING` | `SpeedSetting` | 37-40 | **无 proto、无 conf**（只有 `.h/.cc/BUILD/plugins.xml`，ls 已核） |
| 11 | `REGION_SPEED_LIMIT` | `RegionSpeedLimit` | 41-44 | 有（**本车新增件**：源码含中文注释，出厂 share 清单里没有这条） |

11 个已装 rule 与 11 条注册**一一对应，没有装了不注册的**（盘点 §1.4/§3.3/§4.2）。

### 3.2 plugins.xml 与注册宏（cat / read 已核）

```xml
<library path="modules/planning/traffic_rules/crosswalk/libcrosswalk.so">
    <class type="apollo::planning::Crosswalk" base_class="apollo::planning::TrafficRule"></class>
</library>
```

- 属性名是 `type` / `base_class` / `path`（**没有 `class_type`**）；`base_class` 一律写最顶层基类 `apollo::planning::TrafficRule`（11 个 rule 全部如此，盘点 §3.3）。
- 注册宏写在 **`.h`** 里、第二参是**非限定基类名**：`CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::Crosswalk, TrafficRule)`（crosswalk.h:60）、`CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::RegionSpeedLimit, TrafficRule)`（region_speed_limit.h:52-53）。`.cc` 里 grep 不到注册宏。
- 清单里的 `type` 是**不带命名空间的类名**，`TrafficDecider` 侧用 `ConfigUtil::GetFullPlanningClassName`（config_util.h:45）补 `apollo::planning::` 后去 PluginManager 取实例。

### 3.3 每个 rule 的实例 conf 路径规则

派生类 `Init` 固定两步（两个抽样一致）：`TrafficRule::Init(name, injector)` → `TrafficRule::LoadConfig<XxxConfig>(&config_)`
（crosswalk.cc:58-65、region_speed_limit.cc:35-43）。`config_path_` 由基类算，机制是 `PluginManager::GetPluginConfPath<TrafficRule>(class_name, "conf/default_conf.pb.txt")`：

1. 由类名找到已加载库，再找到它的 `plugins.xml` 描述文件路径，取其目录、**去掉开头的 `share/`**（plugin_manager.h:173-184）→ 得到相对路径 `modules/planning/traffic_rules/<包名>`。
2. 拼上 `conf/default_conf.pb.txt` 后过 `GetFilePathWithEnv(..., "APOLLO_CONF_PATH", ...)`（plugin_manager.h:201-207）。本机 `APOLLO_CONF_PATH=/apollo`（env 已核）→ 最终读 **`/apollo/modules/planning/traffic_rules/<包名>/conf/default_conf.pb.txt`**（④ 层）。

④ 层实测（`ls -l`）：`crosswalk/conf/default_conf.pb.txt` → **profile 覆盖层**；`region_speed_limit/conf/default_conf.pb.txt` → **share 出厂层**（profile 树只放了 9 个 rule 的 conf，无 region_speed_limit）。所以**同一批规则的 conf 落点不一致，改之前必须逐个 `ls -l`**。

conf 字段抽样（cat 已核）：

| rule | 生效 conf 关键字段 | 与 proto 默认/出厂值差异 |
|---|---|---|
| `Crosswalk`（profile 档） | `stop_distance:1.0` `max_stop_deceleration:4.0` `min_pass_s_distance:1.0` `expand_s_distance:0.0` `stop_strict_l_distance:1.0` `stop_loose_l_distance:1.5` `start_watch_timer_distance:10` `stop_timeout:3.0` | 出厂 src 档为 `expand_s_distance:2.0` `stop_*_l_distance:5.0/5.0` `stop_timeout:10.0` 且无 `start_watch_timer_distance` → **本车把人行道让行调得更激进/更短耐心** |
| `RegionSpeedLimit`（share 档） | `forward_buffer:3.0` `backward_buffer:2.0` `traffic_light_speed_limit:5.0` `crosswalk_speed_limit:6.0` `junction_speed_limit:7.0` `enable_*_limit:true`×3 | 与 proto 默认值（`region_speed_limit.proto:8-24`）逐条一致 |

字段定义：`crosswalk/proto/crosswalk.proto` 的 `CrosswalkConfig`（含各字段注释与 default）、`region_speed_limit/proto/region_speed_limit.proto` 的 `RegionSpeedLimitConfig`。

## 4. 修改与扩展点（二次开发）

**A. 只调参（不重编）**：改 `/apollo/modules/planning/traffic_rules/<包名>/conf/default_conf.pb.txt`（先 `ls -l` 认落点：profile 层可长期驻留；share 层下次 install 被覆盖），重启 planning 生效（`mainboard -d .../planning.dag`）。

**B. 开关/改顺序**：改 `/apollo/modules/planning/planning_component/conf/traffic_rule_config.pb.txt`（→ profile 层）。删掉某个 `rule{}` 块 = 该规则不再执行；调整块的先后 = 调整执行顺序。

**C. 新增一个 rule（完整改动点）**：

1. 生成骨架：`buildtool create --template planning_traffic_rule modules/planning/traffic_rules/<包名>`（可带 `--name/--class_name`），产出 BUILD / cyberfile.xml / `.h/.cc` / proto / conf / plugins.xml；已存在文件不覆盖。骨架落在 `/apollo_workspace/modules/planning/traffic_rules/<包名>/`（① 层，唯一源码修改点；本车 `traffic_rules` 包已 install）。
2. 类实现：`class Xxx : public TrafficRule`，`Init` 里先 `TrafficRule::Init(name, injector)` 再 `TrafficRule::LoadConfig<XxxConfig>(&config_)`；实现 `ApplyRule`（加限速用 `reference_line_info->mutable_reference_line()->AddSpeedLimit(...)`；加停车墙用 `util::BuildStopDecision(...)`，头文件 `planning_base/common/util/common.h`）；实现 `Reset()`（无跨周期缓存就写空体）。
3. 注册宏放 **`.h` 末尾**：`CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::Xxx, TrafficRule)`。
4. `plugins.xml`：`path` 写 `modules/planning/traffic_rules/<包名>/lib<so 名>.so`，`class type` 写全限定名，`base_class="apollo::planning::TrafficRule"`。BUILD 用 `apollo_plugin`（自带 `alwayslink`），**别退化成 `cc_library`**。
5. `conf/default_conf.pb.txt` + `proto/<x>.proto`（消息名与 `LoadConfig<T>` 的 T 一致）；`cyberfile.xml` 的 `<src_path>` 必须等于目录路径。
6. 进清单：往 `/apollo/modules/planning/planning_component/conf/traffic_rule_config.pb.txt` 加 `rule { name: "XXX" type: "Xxx" }`，**位置就是执行顺序**（想在停车墙类规则之后再压限速就放后面）。
7. `buildtool build -p modules/planning/traffic_rules/<包名>` 完成 install（只 `bazel build` 运行时看不见），再重启 planning。
8. 核对：`ls /opt/apollo/neo/lib/modules/planning/traffic_rules/<包名>/` 有 `.so`；`ls /opt/apollo/neo/share/cyber_plugin_index/ | grep <包名>` 有条目；启动日志无 `Class factory objs counts is 0`。

**D. 改已有 rule 的逻辑**：`buildtool install planning`（本车 `traffic_rules` 已在 ① 层）→ 改 `/apollo_workspace/modules/planning/traffic_rules/<包名>/*.cc` → `buildtool build -p modules/planning/traffic_rules/<包名>`。⚠️ 想改 `TrafficRule`/`TrafficDecider` **基类本身**，得先 `buildtool install planning-interface-base`（本车 ① 层没有这个包，且 src 侧只发了 proto，见 §5）。

## 5. ⚠️ 本环境注意

- **顺序语义**：`traffic_rule_config.pb.txt` 的书写顺序 = 执行顺序（proto 是 `repeated`，无优先级字段）。与 scenario 的 first-match 不同，**rule 是全量逐条跑，不 short-circuit**；但某条返回非 OK 会把该参考线判为不可驾驶（on_lane_planning.cc:365-369），后面的 rule 仍会在**其他**参考线上执行。
- **`speed_setting` 无 proto / 无 conf**（`ls` 已核，引盘点 §1.4）：它已在清单第 10 条注册且实现存在（`speed_setting.cc` 95 行），但**不能用 `default_conf.pb.txt` 调参**——要改它的行为只能改代码或它依赖的 gflag/其他来源（本轮未读其 `.cc`，见 §7 待核）。
- **11 条全注册，CLAUDE.md「traffic_rule 装 10 个、注册 9 个、speed_setting 未注册」已过期**（2026-09-08 实测：装 11、profile 生效档注册 11，含 `SPEED_SETTING` 与本车新增的 `REGION_SPEED_LIMIT`）。出厂 `share` 版清单才是 10 条——**别拿出厂档当现状**。
- **生效档在 profile 覆盖层**：清单与 9 个 rule 的 conf 指向 `/apollo_workspace/profiles/current`（→ `ARCF_40P`），`region_speed_limit` 的 conf 仍指向 share。改 ④ 软链会写穿到各自落点：profile 层 install 不覆盖，share 层会被覆盖。
- **基类源码不随包发布**：`traffic_rule.h` / `traffic_decider.h` **只在 include 树**（src 侧 `planning_interface_base/traffic_rules_base/` 只有 `proto/`），`.cc` 完全没发（编进 `/opt/apollo/neo/lib/modules/planning/planning_interface_base/libapollo_planning_planning_interface_base.so`，`nm -DC` 已核到 `TrafficRule::Init`、`TrafficDecider::{Init,Execute}` 为 T 符号）。**「src 里 grep 不到」不等于不存在**。
- **搜 `/apollo/...` 必须 `grep -R`**（`-r` 不跟随符号链接会假空）；插件索引在 `/opt/apollo/neo/share/cyber_plugin_index/`（本轮 `ls | grep -c .` = **118** 条，CLAUDE.md 记 113，已增长），**不扫 `bazel-bin`**；改插件后必须 `buildtool build -p` 完成 install 才会被发现。
- **conf 路径靠 `APOLLO_CONF_PATH=/apollo` 解析**（env 已核）。若这个变量被改/清空，`GetPluginConfPath` 会退回相对路径（plugin_manager.h:207），rule conf 就会按**当前工作目录**去找 → 表现为「conf 改了不生效、日志只 AERROR 一句 Failed to load default config file」。

## 6. 验证命令（本环境形态）

```bash
# 1) 看清单与落点（④ 层必须 ls -l 认软链目标）
ls -l /apollo/modules/planning/planning_component/conf/traffic_rule_config.pb.txt
ls -l /apollo/modules/planning/traffic_rules/*/conf/default_conf.pb.txt
grep -n 'traffic_rule_config_filename' /apollo/modules/planning/planning_component/conf/planning.conf
# 2) 看某个 rule 装没装（.so + 插件索引，缺一不可）
ls /opt/apollo/neo/lib/modules/planning/traffic_rules/region_speed_limit/
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep region_speed_limit
# 3) 起 planning 观察规则日志（RegionSpeedLimit 每帧打 AINFO 统计 overlap 数）
mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag
# 4) 改 rule 源码后重编 install（只 bazel build 运行时看不见）
buildtool build -p modules/planning/traffic_rules/region_speed_limit
```

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线 Apollo 11.0.0 package 工作区。
- 本文所有 `文件:行号` 均出自本轮 read 打开核对（清单见 front-matter `sources`）。非 read 类证据：① `ls -l` 认 ④ 软链落点（`traffic_rule_config.pb.txt` → profile；`crosswalk/conf` → profile；`region_speed_limit/conf` → share）；② `ls -R` 三个 rule 包目录结构、`ls` share/profile 的 conf 覆盖面（share 10 个、profile 9 个）；③ `cat` 三个 plugins.xml 与两份 proto、三份 default_conf；④ `env` 取 `APOLLO_CONF_PATH=/apollo`、`APOLLO_PLUGIN_DESCRIPTION_PATH=/apollo_workspace:/opt/apollo/neo`；⑤ `nm -DC` + `strings` 在 `libapollo_planning_planning_interface_base.so` 里核到 `TrafficRule::Init`、`TrafficDecider::{Init,Execute}` 定义符号，以及字符串 `conf/default_conf.pb.txt`、`FLAGS_traffic_rule_config_filename`、`modules/planning/planning_interface_base/traffic_rules_base/traffic_decider.cc`、`Load pipeline of`。
- **遗留待核（重要）**：
  1. **「按 `traffic_rule_config.pb.txt` 顺序逐条 `ApplyRule`」缺源码行号证据**：`traffic_decider.cc` / `traffic_rule.cc` **不随包发布**（检索范围：`/opt/apollo/neo/src`、`/opt/apollo/neo/include` 两棵树、`/apollo_workspace/modules/planning/`；grep `TrafficDecider|traffic_decider` 在 src 全树仅 11 处命中，全是调用方与 README）。本文对 `Execute` 内部行为的描述由四项间接证据推出：`TrafficRulesPipeline.rule` 是 `repeated`（有序）、`rule_list_` 是 `std::vector<std::shared_ptr<TrafficRule>>`（traffic_decider.h:58）、二进制里存在 `traffic_decider.cc` 与 `FLAGS_traffic_rule_config_filename` 引用、`README_cn.md`（`planning_component/README_cn.md:266`、`destination/README_cn.md:5`、`reference_line_end/README_cn.md:5`）明确「由 traffic_decider 加载并调用各插件的 ApplyRule」。要拿到行号需 `buildtool install planning-interface-base` 后在 ① 层核对。
  2. `TrafficRule::Init` 的具体实现（`config_path_` 赋值语句、是否用 `ConfigUtil::LoadMergedConfig`）同样只有间接证据（§3.3 的机制推理 + `conf/default_conf.pb.txt` 字符串），行号待核。
  3. `BuildPlanningTarget`（traffic_decider.h:57）作用未核。
  4. `util::BuildStopDecision` / `util::GetADCStopDeceleration` 的实现（`planning_base/common/util/common.h|.cc`）本轮未打开，仅核到调用点。
  5. `speed_setting.cc`（95 行）与其余 8 个 rule 的 `.cc` 未读；`Reset()` 由谁在何时调用（怀疑在 `TrafficDecider::Execute` 或 Frame 复位时）未核。
  6. `region_speed_limit` 是本车新增件的判断依据是「源码含中文注释 + 出厂 share 清单无此条」，其引入来源（哪次 profile 变更）未查。
