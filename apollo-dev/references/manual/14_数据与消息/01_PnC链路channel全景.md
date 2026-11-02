# 01 PnC 链路 channel 全景

<!--
file: references/manual/14_数据与消息/01_PnC链路channel全景.md
scope: 11.0（默认）
tags: channel, topic, adapter_gflags, PnC链路, 数据流, dag readers, prediction, planning, control, canbus, 频率
sources:
- /opt/apollo/neo/src/modules/common/adapters/adapter_gflags.cc（22–66 行精读；其余 topic 由 grep 定位行号后按行区间引用）
- /apollo/modules/planning/planning_component/dag/planning.dag（全文）
- /apollo/modules/prediction/dag/prediction.dag（全文）
- /apollo/modules/canbus/dag/canbus.dag（全文）
- /apollo/modules/control/control_component/dag/control.dag（全文，见 13_control源码/01）
- 交叉引用（已核，不重复核对）：manual/12_planning源码/02_planning_component主循环.md、manual/13_control源码/01_control_component与数据流.md、manual/11_cyber框架/04_时间戳与消息基建.md
-->

## 0. 一句话作用

一张图讲清 **PnC 主链路的 channel 走向**：谁发、谁收、消息类型是什么、在代码哪一行定义，以及"某一环没数据"时该往上游看哪个 channel。所有 topic 的**默认值**集中在一个文件：`/opt/apollo/neo/src/modules/common/adapters/adapter_gflags.cc`。

## 1. 关键符号与文件

| 概念 | 文件（层） | 说明 |
|---|---|---|
| topic 默认值总表 | /opt/apollo/neo/src/modules/common/adapters/adapter_gflags.cc（② src；声明在 include/.../adapter_gflags.h） | 全仓 channel 名的**单一事实来源**（280 行，全是 `DEFINE_string(xxx_topic, ...)`） |
| 消息类型定义 | /opt/apollo/neo/src/modules/common_msgs/`<包>`/`*.proto`（② src，112 个）；生成头 /opt/apollo/neo/include/modules/common_msgs/`<包>`/`*.pb.h`（一一对应） | **两种形态本机都可得**；注意没有 `control.proto`，控制消息在 `control_cmd.proto` |
| dag readers | /apollo/`<sp>`/dag/*.dag（④ 视口，`readlink` 判 profile/share） | 只有 `components{}` 型组件才在 dag 里声明输入；`timer_components{}` 的订阅全在代码 |
| Header/时间戳 | /opt/apollo/neo/src/modules/common_msgs/basic_msgs/header.proto | 9 字段；`FillHeader` 只填 3 个（见 `../11_cyber框架/04_时间戳与消息基建.md`） |

## 2. PnC 主链路全景

### 2.1 链路图（→ 表示 channel 流向）

```
GNSS/IMU ─┐
          ├→ /apollo/localization/pose ──────────┐
LiDAR/相机 ─→ perception ─→ /apollo/perception/obstacles ─→ prediction ─→ /apollo/prediction ─┐
                          /apollo/perception/traffic_light ─────────────────────────────┐    │(节拍)
外部指令 ─→ /apollo/planning/command ──────────────────────────────────────────────┐    │    │
                                                                                   ▼    ▼    ▼
                                                                              [ planning ]（消息触发，M0=prediction）
                                                                                     │
                                                          /apollo/planning (ADCTrajectory) ─┐
                                                          /apollo/planning/command_status ──┤
                                                                                            ▼
canbus ─→ /apollo/canbus/chassis ──────────────────────────────────────────────→ [ control ]（timer 10ms）
                                                                                     │
                                                                    /apollo/control (ControlCommand)
                                                                                     ▼
                                                                                 [ canbus ] → CAN 总线
safety checkers ─→ /apollo/safety/decision ─→ replan_control_task（本机未进 pipeline，见 13_control/01）
```

### 2.2 PnC 核心 channel 表（topic 名与行号出自 adapter_gflags.cc）

| channel | 消息类型 | 发布者 | 订阅者 | flag（定义行） |
|---|---|---|---|---|
| /apollo/canbus/chassis | canbus::Chassis | canbus | planning(M1)、control、多个 safety checker | `chassis_topic` :27 |
| /apollo/localization/pose | localization::LocalizationEstimate | localization | planning(M2)、control、safety | `localization_topic` :35–36 |
| /apollo/perception/obstacles | perception::PerceptionObstacles | perception（本机也可由 msg_adapter 转出） | prediction（**dag 唯一 reader，depth 1**） | `perception_obstacle_topic` :120 |
| /apollo/perception/traffic_light | perception::TrafficLightDetection | perception TL 链 | planning（traffic_rule/scenario 用） | `traffic_light_detection_topic` :124 |
| /apollo/prediction | prediction::PredictionObstacles | prediction | **planning 的 M0＝节拍源** | `prediction_topic` :117 |
| /apollo/planning/command | external_command 派生 | external_command / dreamview | planning | `planning_command` :41–42 |
| /apollo/planning | planning::ADCTrajectory | planning | control、dreamview | `planning_trajectory_topic` :39–40 |
| /apollo/planning/command_status | external_command::CommandStatus | planning | control | `planning_command_status` :43–44 |
| /apollo/control | control::ControlCommand | control | canbus | `control_command_topic` :48–49 |
| /apollo/control/pad | control::PadMessage | dreamview / 工具 | control | `pad_topic` :46–47 |
| /apollo/control/interactive | ControlInteractiveMsg | control | 其他模块 | `control_interative_topic` :52–53 |
| /apollo/control/localview | control::LocalView | control（仅 submodule 模式） | control submodules | `control_local_view_topic` :56–57 |
| /apollo/monitor | monitor 消息 | monitor | 各模块 | `monitor_topic` :45 |
| /apollo/routing_response | routing::RoutingResponse | routing | （11.0 主链路已走 planning/command） | `routing_response_topic` :129 |
| /apollo/safety/decision | SafetyDecision | safety guardian 组件 | replan_control_task | 在 `replan_task_conf.proto`（非 adapter_gflags） |

### 2.3 各模块的触发方式（决定"谁停了谁就停"）

| 模块 | dag 形态 | 触发 | 节拍/周期 | 证据 |
|---|---|---|---|---|
| prediction | `components{}` + 1 reader | 消息触发 | 随 `/apollo/perception/obstacles` | prediction.dag 全文（depth 1） |
| planning | `components{}` + 3 readers | 消息触发，**M0=/apollo/prediction** | 随 prediction 到率 | planning.dag；融合语义见 `../11_cyber框架/01` |
| control | `timer_components{}` 无 readers | **定时** | `interval: 10`（ms） | control.dag；5 个 reader 在代码 |
| canbus | `timer_components{}` 无 readers | **定时** | `interval: 10`（ms） | canbus.dag 全文 |

⇒ 两条排障推论：① **prediction 不发 → planning 一帧都不出**（planning 是消息触发且只挂 M0）；② control/canbus 是定时器，即使上游全停它们也在跑，但 control 会因 chassis/localization 为空而 `return false` 不发命令（见 `../13_control源码/01`）。

## 3. 注册与配置

- **改 channel 名**：优先在模块自己的 conf/gflags 里覆盖（如 planning 的 `planning_config.pb.txt` 有 `topic_config`；control 走 flag）；`adapter_gflags.cc` 只是**默认值**。生效优先级：dag/conf 显式值 > 模块自己的 gflags > adapter_gflags 默认值。
- **dag readers 与代码的对应**：`components{}` 型组件的 dag readers **下标严格对应模板参数 M0..M3**；readers 少于模板参数个数 → `Initialize` 返回 false（模块起不来）。channel 名拼错 = 静默收不到；消息类型不匹配只打一条 AERROR 不阻断（`../11_cyber框架/04`）。
- **qos/队列**：dag reader 的 `qos_profile{depth}` 与 `pending_queue_size`（proto 默认 1）决定积压丢帧行为——planning.dag 用 depth 15 / pending 50，prediction.dag 用 depth 1。

## 4. 修改与扩展点

| 想做什么 | 怎么做 |
|---|---|
| 查某 channel 的官方名 | `grep -n '<关键词>_topic' /opt/apollo/neo/src/modules/common/adapters/adapter_gflags.cc` |
| 查某消息的字段 | 读 `/opt/apollo/neo/src/modules/common_msgs/<包>/<名>.proto`（源码级，最省事）；对应字段速查见 `05_PnC解题常用消息字段速查.md` |
| 新增一路输入到 planning/control | dag 加 reader（消息触发型）或代码里 `CreateReader`（timer 型）+ 新 flag；同一 Node 同一 channel **不能重复 CreateReader**（返回 nullptr） |
| 只想离线灌数据调 PnC | 用 record 回放；或用 `msg_adapter`（本机完整安装，可 `mainboard -d` 直跑，默认输出 `/apollo/perception/obstacles`，见 `../16_感知源码/09_msg_adapter与离线调试.md`） |
| 确认某 channel 现在有没有数据 | `cyber_channel -l` 列表、`cyber_channel -e <channel>` 回显（**`-w` 参数在本环境是坏的**） |

## 5. ⚠️ 本环境注意

- **僵尸 topic 还在表里**：`/apollo/guardian`（:257 附近）、`/apollo/task_manager`（:274 附近）、`/apollo/v2x/*`（:239–251 区间）等 flag 仍定义，但**本机无对应模块/发布者**（guardian 模块源码已无，仅组件 lib 残留）——看到 flag 不等于有数据。
- **命名破例**：`/tf`、`/tf_static`（无 `/apollo` 前缀）、`camera/image_raw`（连前导斜杠都没有，源码里带 TODO）。
- **11.0 主链路用 `/apollo/planning/command`**（external_command 体系）而非老的 `/apollo/routing_response` 直连；`routing_response_topic` 仍在但语义已变。
- **频率一律"待核"**：本手册未起进程录包，表中不写实测 Hz；要数就 `cyber_channel` 或录包离线统计（`../11_cyber框架/03_工具链实测.md`）。
- dag 落点先 `readlink`：④ 层 374 条软链指向 `profiles/current`、339 条指向 share（planning.dag/control.dag 是 profile 版，prediction.dag/canbus.dag 是 share 版）。
- 搜 `/apollo/...` 用 `grep -R`（`-r` 不跟随符号链接会假空）。

## 6. 验证命令

```bash
# 某 channel 的默认名与定义行
grep -n 'planning_trajectory_topic\|control_command_topic\|prediction_topic' \
  /opt/apollo/neo/src/modules/common/adapters/adapter_gflags.cc

# 某模块 dag 声明了哪些输入（timer 型则无 readers，去代码看）
cat /apollo/modules/planning/planning_component/dag/planning.dag
readlink /apollo/modules/planning/planning_component/dag/planning.dag

# 运行期：列 channel / 看某 channel 内容（-w 坏，勿用）
cyber_channel -l
cyber_channel -e /apollo/planning
cyber_node list
```

## 7. 溯源

- 蒸馏日期：2026-09-08。基线：Apollo 11.0.0 package 工作区。
- 本轮 read 打开核对：`adapter_gflags.cc` 22–66（表中 :22–:60 段行号全部逐行核过）、`prediction.dag` 全文、`canbus.dag` 全文；`planning.dag`/`control.dag` 内容与行号引自本工程已核手册（02 篇、13_control/01 篇）。
- 行号仅 grep 定位未 read 的（表中标注为"区间"）：`perception_obstacle_topic` :120、`traffic_light_detection_topic` :124、`prediction_topic` :117、`routing_response_topic` :129、僵尸 topic :239–274 区间——按 grep 输出记录，**未逐行 read 核对**，引用时请自行确认。
- 遗留待核：① 各 channel 实测频率（需录包）；② `/apollo/safety/decision` 发布侧（guardian 无源码）；③ perception 内部 `/perception/inner/*` 链路（见 `../16_感知源码/01_总览与四大链路.md`）；④ localization/canbus 模块内部发布点未逐一 read（本篇只到接口层）。
