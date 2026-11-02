# Apollo 源码手册（manual/）总入口

> 本手册是 **Apollo 11.0 源码级蒸馏层**，与 `references/knowledge/`（PNC/EDU 层）分开。
> 使用规则见 `_template.md`；检索顺序：本文 → 目标目录 → 具体手册 → 回源文件。

> ⚠️ **取证底稿已清理（2026-09-08）**：蒸馏时的四份盘点底稿（`.manual_work/inventory/*.md`）已按用户要求删除。正文各篇溯源与来源列表中对 `.manual_work/inventory/...` 的引用均为**历史取证记录**，该路径已不存在；如需回源，直接用各篇 `sources` front-matter 里列出的源码绝对路径。

## 0. 分层与版本模型（分版本蒸馏的核心）

| 层 | 路径 | 口径 | 来源 | 可信度 |
|---|---|---|---|---|
| EDU 知识层 | `references/knowledge/`（51 篇，实测 find 计数） | PNC/EDU（application-pnc） | 上游 apollo-claw 导入，**未按本机校对** | 中，当知识库用，不当本机操作手册 |
| **11.0 源码层（本手册）** | `references/manual/` | **Apollo 11.0.0 package 工作区** | 本机 `/opt/apollo/neo/{src,include}` 源码蒸馏，行号当场核对 | 高，可回源验证 |
| 版本差异层 | `manual/00_versions/` | 11.0 vs PNC 的差异总表/词汇对照/核对清单 | 源码裁决 + knowledge 标注 | 高（裁决过的条目） |
| PNC 标注层 | `manual/pnc_赛事版/` | 51 篇逐篇归属标注 + EDU 版口径速查 | knowledge 元数据 | — |
| **官方应用实践层** | `references/practice/`（61 篇 + 索引/说明） | **Apollo 官方「应用实践」文档（9.0/latest 混标）** | 用户从 Apollo 文档站下载（2026-09-08），入口见 `practice/00_索引.md` | 中，[官方·上游]，未本机回源，动手前到 00_versions/02 核对 |

**版本标签**：`[11.0·实测]`（本手册默认语境，可省略）｜`[EDU·上游]`（knowledge/上游口径）｜`[官方·上游]`（practice/官方文档口径）｜`[通用]`（两版一致）。

## 1. 版本基线（本手册全部结论绑定的环境）

Apollo **11.0.0**（`.workspace.json` = apollo-universe-11 11.0.0 / apollo-tools 9.2.0 / apollo-core 9.2.0），buildtool 9.0.0-rc1-r19，x86_64，**package 工作区形态**（无 `apollo.sh`、无 `application-pnc`）。到别的机器先读 `00_versions/02_在本工作区动手前置核对清单.md` 再信本手册。基线事实（路径四层、构建运行、插件/conf 三大陷阱）见工作区根 `CLAUDE.md`，冲突时以源码核对为准。

> ⚠️ **2026-09-08 修订**：本机实测存在 profile 覆盖层 `/apollo_workspace/profiles/{current→ARCF_40P, ARCF_40P_NDT, sample}`；④ 层 dag 与多数 conf 的软链指向 `profiles/current/<sp>/`（非 share）——CLAUDE.md 的四层表述已部分过期，写结论前先 `readlink` 判定落点；其余漂移见 `00_versions/00_版本基线对照.md` §5。

## 2. 按意图找文档

| 意图 | 先去 |
|---|---|
| cyber 组件/channel/dag/conf/工具 | `11_cyber框架/`（`00_readme.md` 无，直接看 01-04） |
| planning 源码结构/框架类/场景 | `12_planning源码/` |
| control 控制器/数据流 | `13_control源码/` |
| PnC 链路 channel 与消息字段 | `14_数据与消息/` |
| 在 11.0 上做插件/组件二次开发 | `15_二次开发手册/` |
| 感知模块源码/插件/链路 | `16_感知源码/` |
| 11.0 与 PNC 版差异 | `00_versions/` |
| EDU 版（application-pnc）知识原文 | `../knowledge/`（由 `pnc_赛事版/00_知识归属与差异标注表.md` 导航） |

## 3. 文件清单（写文件前先查本表，禁止自创文件名）

### 完成状态（2026-09-08 实测 `find manual -name '*.md' | wc -l`）

| 卷 | 计划 | 已产出 | 未产出清单 |
|---|---|---|---|
| 00_versions | 3 | **3 ✅** | — |
| 11_cyber框架 | 4 | **4 ✅** | — |
| 12_planning源码 | 15 | **15 ✅** | — |
| 13_control源码 | 4 | **4 ✅** | — |
| 14_数据与消息 | 5 | **5 ✅** | — |
| 15_二次开发手册 | 5 | **5 ✅** | — |
| 16_感知源码 | 10 | **10 ✅** | — |
| **17_canbus底盘开发** | 3 | **3 ✅**（01 canbus 模块结构 / 02 车型插件架构 / 03 新车型接入全流程） | — |
| pnc_EDU 版 | 2 | **2 ✅** | — |
| 工程文件 | 3 | **3 ✅**（00_readme、_template、00_P5走查与抽查记录） | — |
| **合计** | **51+3** | **54 ✅ 全部完成** | 0 |

> 另有一层**官方应用实践文档**（`references/practice/`，61 篇，不计数入 manual/）：见 `00_readme.md` §0 分层表与 `../practice/00_索引.md`。

盘点底稿（不计入 48）：`/apollo_workspace/.manual_work/inventory/{planning,control,perception,cyber_messages}_inventory.md` 四份齐全，是未产出篇目的现成素材。

### 00_versions（3 份，P3 产出）
| 文件 | 内容 |
|---|---|
| `00_versions/00_版本基线对照.md` | 两版形态/模块/工具/行为差异总表（每条带两版证据出处）+ §4 知识库内部不一致 10 条 + **§5 CLAUDE.md 漂移修正 25 条** |
| `00_versions/01_命令与词汇对照.md` | 同一意图两版命令/路径/词汇对照 |
| `00_versions/02_在本工作区动手前置核对清单.md` | 版本判别 4 条 + env 实测表 + 运行前提 6 条 |

### 11_cyber框架（4 份）
| 文件 | 内容 |
|---|---|
| `11_cyber框架/01_component与channel机制.md` | Component 基类/注册宏/消息与定时触发、Reader/Writer 模式 |
| `11_cyber框架/02_dag_launch与conf查找.md` | dag 语法与只声明输入、launch 组织、conf 查找顺序（GetFilePathWithEnv）、gflags |
| `11_cyber框架/03_工具链实测.md` | cyber_monitor/channel/node/recorder/service/launch、mainboard 实测行为与坑 |
| `11_cyber框架/04_时间戳与消息基建.md` | Header/time 机制、writer-reader 模式、channel 命名习惯 |

### 12_planning源码（15 份）
| 文件 | 内容 |
|---|---|
| `12_planning源码/01_包结构与插件注册全景.md` | 10 顶层目录、三类插件全清单（注册/未注册，盘点表为底稿） |
| `12_planning源码/02_planning_component主循环.md` | 输入、Frame、规划触发、输出链路（pilot 样板，已产出） |
| `12_planning源码/03_planners_public_road.md` | public_road planner（含已删 planner 孤儿残留） |
| `12_planning源码/04_scenario框架.md` | scenario 基类/注册/实例化/优先级 first-match |
| `12_planning源码/05_stage框架.md` | stage 基类、stage 切换 |
| `12_planning源码/06_task框架与task大族.md` | task 基类、decider/path_generation 分类、pipeline |
| `12_planning源码/07_traffic_rule框架.md` | TrafficRule 基类/注册/执行顺序 |
| `12_planning源码/08_pnc_map与参考线.md` | PncMap 类、参考线生成 |
| `12_planning源码/09_conf与gflags体系.md` | 实例级 conf 小写命名、查找与优先级、config_util |
| `12_planning源码/10_planning_open_space.md` | open_space 框架（泊车二次开发入口） |
| `12_planning源码/11_场景族_basic与lanefollow.md` | 盘点后定档：基础场景族结构+注册+典型 task 链 |
| `12_planning源码/12_场景族_借道与路口.md` | 盘点后定档：借道/路口/交汇场景族 |
| `12_planning源码/13_场景族_泊车.md` | 盘点后定档：泊车场景族应用结构与 conf |
| `12_planning源码/14_输出消息链路.md` | planning trajectory/command 消息构造位置与下游消费 |
| `12_planning源码/15_本环境运行现状.md` | 生效配置/插件清单（13 scenario、11 rule 全注册）、失效无效项 6 条、7 个孤儿 conf、运行前提 9 条、「没轨迹」五分支排障树 |

### 13_control源码（4 份）
| 文件 | 内容 |
|---|---|
| `13_control源码/01_control_component与数据流.md` | 输入输出、ControlCommand、replan_control_task 消费 safety 决策 |
| `13_control源码/02_横纵向控制器.md` | lat LQR/_plus、lon PID/_plus 位置与参数 |
| `13_control源码/03_control_task框架与controllers清单.md` | ControlTask 基类/注册/7 个 controller 清单 |
| `13_control源码/04_conf标定与调参.md` | calibration_table、conf 层次、调参手法 |

### 14_数据与消息（5 份）
| 文件 | 内容 |
|---|---|
| `14_数据与消息/01_PnC链路channel全景.md` | 上游→planning→control→canbus 全景（频率/消息类型） |
| `14_数据与消息/02_chassis与车辆参数.md` | 底盘消息与车辆参数（PnC 必需字段） |
| `14_数据与消息/03_localization与坐标系TF.md` | 定位消息、坐标系、TF |
| `14_数据与消息/04_routing与external_command.md` | 路由请求/响应、外部指令 |
| `14_数据与消息/05_PnC解题常用消息字段速查.md` | 场景开发要读/写的字段速查 |

### 15_二次开发手册（5 份，11.0 实测全流程）
| 文件 | 内容 |
|---|---|
| `15_二次开发手册/01_新增TrafficRule.md` | 模板命令 + 六件套核对点 + 注册/编译/验证 |
| `15_二次开发手册/02_新增Scenario与Stage.md` | 同上（scenario+stage） |
| `15_二次开发手册/03_新增Task.md` | 同上（task） |
| `15_二次开发手册/04_新增ControlTask.md` | 同上（control 侧） |
| `15_二次开发手册/05_编译调试与配置生效.md` | 单模块 mainboard、日志、record、conf 软链生效 |

### 16_感知源码（10 份）
| 文件 | 内容 |
|---|---|
| `16_感知源码/01_总览与四大链路.md` | 30 子包拓扑、lidar/camera/TL/radar 链路、channel 全景 |
| `16_感知源码/02_组件插件架构与子包骨架.md` | perception_plugin、dag/launch 分布、plugins.xml 三段式 conf、子包同构骨架 |
| `16_感知源码/03_点云预处理族.md` | pointcloud_*+ground/roi/motion |
| `16_感知源码/04_lidar检测跟踪族.md` | detection/cpdet/segmentation/filter/tracking/output |
| `16_感知源码/05_camera族.md` | bev/multi/single stage、location 系 |
| `16_感知源码/06_交通灯族.md` | region_proposal/detection/recognition/tracking |
| `16_感知源码/07_radar_lane_motion.md` | radar/lane_detection/motion_service |
| `16_感知源码/08_fusion.md` | multi_sensor_fusion |
| `16_感知源码/09_msg_adapter与离线调试.md` | 单模块离线调试 |
| `16_感知源码/10_本环境感知运行现状.md` | 模型权重缺失清单、能否起、GPU/后端 |

### pnc_EDU 版（2 份，P3 产出）
| 文件 | 内容 |
|---|---|
| `pnc_赛事版/00_知识归属与差异标注表.md` | 51 篇逐篇：面向版本/涉及命令路径/与 11.0 差异/可信度 |
| `pnc_赛事版/01_赛事版开发口径速查.md` | application-pnc 插件/场景/工作流做法浓缩 + 回指原文 |

### 工程文件（已完成）
`00_readme.md`（本文件）、`_template.md`（写作规范）、`00_P5走查与抽查记录.md`（验收记录：检索走查 8 题、回源抽查 9 条、手册自身错误修正 4 处、取证天花板与缺口）。
