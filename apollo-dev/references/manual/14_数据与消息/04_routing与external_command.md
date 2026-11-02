# 04 routing 与 external_command

<!--
file: references/manual/14_数据与消息/04_routing与external_command.md
scope: 11.0（默认）
tags: external_command, routing, RoutingRequest, RoutingResponse, PlanningCommand, LaneFollowCommand, ValetParkingCommand, ActionCommand, CommandStatus, command_id, command_processor, old_routing_adapter, cyber service
sources:
- /opt/apollo/neo/src/modules/common_msgs/external_command_msgs/{lane_follow_command,valet_parking_command,action_command,command_status}.proto（各全文）
- /opt/apollo/neo/src/modules/common_msgs/planning_msgs/planning_command.proto（全文）、routing_msgs/routing.proto（全文）
- /opt/apollo/neo/include/modules/external_command/command_processor/command_processor_base/motion_command_processor_base.h（120–299 精读）
- /opt/apollo/neo/src/modules/external_command/process_component/external_command_process_component.cc（全文）
- /opt/apollo/neo/src/modules/tools/planning_command/planning_command.py（全文）
- /opt/apollo/neo/src/modules/external_command/external_command_demo/external_command_demo.cc（120–169 精读）
- /apollo_workspace/profiles/current/modules/external_command/process_component/conf/config.pb.txt（全文）+ 出厂对照 /opt/apollo/neo/src/... 同名文件
- 交叉引用（已核）：manual/14_数据与消息/01_PnC链路channel全景.md、manual/12_planning源码/08_pnc_map与参考线.md
-->

## 0. 一句话作用

11.0 里「给车下一个任务」的唯一正门是 **external_command**：外部客户端用 **cyber Service**（不是 topic）把
`LaneFollowCommand` / `ValetParkingCommand` / `ActionCommand` … 发给 `external_command_process` 组件；组件
**把命令转成 `RoutingRequest`、当场调 routing 库算路**，把 `RoutingResponse` 塞进
`PlanningCommand.lane_follow_command` 后发到 **`/apollo/planning/command`** 给 planning 消费。老的
「发 `/apollo/routing_request` → routing 组件发 `/apollo/routing_response` → planning 订阅」链路已**不是主链路**。

## 1. 关键符号与文件

| 符号/概念 | 文件（层，标完整度） | 行号（已 read 核过） | 说明 |
|---|---|---|---|
| `ExternalCommandProcessComponent` | /opt/apollo/neo/src/modules/external_command/process_component/external_command_process_component.cc（② src 完整） | 34–70 | `Init()` 按 conf 里的 `processor` 列表用 PluginManager 创建 processor；并起 command_status 查询 Service |
| `CommandProcessorBase` | /opt/apollo/neo/include/modules/external_command/command_processor/command_processor_base/（②′；src 只有部分子包） | — | 所有 processor 的**插件顶层基类**（plugins.xml 的 `base_class`） |
| `MotionCommandProcessorBase<T>` | 同上目录 `motion_command_processor_base.h`（②′ 头文件树） | 142–184（Init）、207–271（OnCommand）、274–296（SetStartPose） | 模板基类：建 Service、写 PlanningCommand、内嵌 routing 算路 |
| `PlanningCommand` | /opt/apollo/neo/src/modules/common_msgs/planning_msgs/planning_command.proto | 19–35 | external_command → planning 的**唯一契约** |
| `RoutingRequest/Response` | /opt/apollo/neo/src/modules/common_msgs/routing_msgs/routing.proto | 10–21 / 23–32 | 11.0 里主要作为 **`PlanningCommand` 的内嵌载荷**存在 |
| `routing::Routing`（库） | /opt/apollo/neo/include/modules/routing/routing.h（②′；src 下 routing 只剩 `BUILD/README/common/conf`，**核心代码只在 include 树**） | — | 被 processor 以 `std::make_shared` 直接持有（§2.2） |
| `OldRoutingAdapter` / `ExternalCommandDemo` | /opt/apollo/neo/src/modules/external_command/{old_routing_adapter,external_command_demo}/ | demo 120–169（命令词表）；35–60、371–389（grep 定位） | 前者=订阅老 `/apollo/routing_request` 转成 Service 请求的兼容层；后者=**本机自带的发指令客户端**，交互式键盘输入 |

## 2. 机制与数据流

### 2.1 链路图

```
[客户端: dreamview / external_command_demo / 自写 cyber client]
      │  cyber Service 请求（不是 topic！）
      ▼
/apollo/external_command/{lane_follow,valet_parking,action,chassis,free_space,path_follow,speed,...}
      ▼
[ external_command_process 组件 ]  ← conf 里列了哪些 processor 就只认哪些命令
      │  MotionCommandProcessorBase::OnCommand
      │    ① Convert(command) → RoutingRequest  ② routing_->Process(req,resp)（进程内算路）
      │    ③ PlanningCommand.lane_follow_command = resp
      ├──────────────────→ /apollo/routing_response（仅供 HMI 画线）
      ▼
/apollo/planning/command (PlanningCommand)  ── QoS: KEEP_LAST + RELIABLE + TRANSIENT_LOCAL
      ▼
[ planning ] ── /apollo/planning/command_status (CommandStatus) ──→ processor 读回作为状态源
[ 客户端查状态 ] --Service--> /apollo/external_command/command_status（按 command_id 配对）
```

### 2.2 五个「反直觉但源码为真」的点

1. **入口是 Service，不是 topic。** `motion_command_processor_base.h:154–159`
   `node->CreateService<T, CommandStatus>(config.input_command_name(), ...)` ⇒
   `cyber_channel echo /apollo/external_command/lane_follow` **看不到东西**，要用 `cyber_service`。
2. **routing 是被 link 进 external_command 的库，不是必须起的组件。** `:135` 构造
   `routing_(std::make_shared<apollo::routing::Routing>())`、`:151 routing_->Init()`、`:244 routing_->Process(...)`
   ⇒ **不起 routing.dag 也能算路**。`/apollo/modules/routing/dag/routing.dag` 的 `RoutingComponent` 订阅
   **`/apollo/raw_routing_request`**（不是 `/apollo/routing_request`），向 `routing_response_topic` /
   `_history_topic` 发响应（`routing_component.cc:39/46/50/60`，grep 定位）——独立旁路，PnC 主链路不依赖。
3. **`/apollo/routing_response` 主链路下由 processor 发**：`:175–177` 注册 writer、`:254` Write，注释明写
   “Publish routing response to display on HMI”。
4. **起点位姿**：`is_start_pose_set` 为 false（默认）时走 `SetStartPose`（`:274–296`），用 `LaneWayTool`
   取**当前车辆位姿**投影到 lane ⇒ 正常下发只填 `end_pose`；**定位没起来算路直接失败**。
5. **2 秒超时静默丢弃**：`:211–220` 若 `header.timestamp_sec` 早于当前时间 2.0 s 以上，直接 `return`
   （连 status 都不改）。自写脚本忘填 header 时间戳或时钟不同步 → 命令消失。

## 3. 消息字段表（全部 read 核过）

### 3.1 `LaneFollowCommand`（lane_follow_command.proto）

| 行 | 字段 | 类型 | 必选 | 说明 |
|---|---|---|---|---|
| 10 | `header` | apollo.common.Header | optional | **必填**：超时判据靠它 |
| 12 | `command_id` | int64（default -1） | optional | 查状态的唯一键 |
| 14 | `is_start_pose_set` | bool（default false） | optional | true=起点取 way_point[0]；false=取当前车位姿 |
| 16 | `way_point` | repeated Pose | — | 途经点（起终点之间） |
| 18 | `end_pose` | Pose | **required** | 终点，必须给 |
| 20 | `blacklisted_lane` | repeated LaneSegment | — | 禁行 lane |
| 22 | `blacklisted_road` | repeated string | — | 禁行 road id |
| 26 | `target_speed` | double | optional | 超过车辆上限则取上限；不给用系统默认 |

`Pose` = `{required double x, required double y, optional double heading}`；`LaneSegment` = `{id, start_s, end_s}`
（`external_command_msgs/geometry.proto`、`lane_segment.proto`，`cat` 全文核对、**未标行号**）。

### 3.2 `ValetParkingCommand`（valet_parking_command.proto）

字段 1–6 与 LaneFollow 同名同序（`header`:10 / `command_id`:12 / `is_start_pose_set`:14 / `way_point`:16 /
`blacklisted_lane`:18 / `blacklisted_road`:20），差别只有两个：`:22 parking_spot_id`（**required string**，
地图上的车位 id）、`:26 target_speed`。**没有 `end_pose`** —— 终点由车位 id 决定。

### 3.3 `ActionCommand`（action_command.proto）

`:35 header` / `:37 command_id` / `:39 command`（**required** `ActionCommandType`）。枚举 `:7–32`：
`FOLLOW=1, CHANGE_LEFT=2, CHANGE_RIGHT=3, PULL_OVER=4, STOP=5, START=6, CLEAR_PLANNING=7,
SWITCH_TO_MANUAL=50, SWITCH_TO_AUTO=51, VIN_REQ=52, ENTER_MISSION=53, EXIT_MISSION=54`。
action processor **不产出 PlanningCommand**，输出到 `/apollo/planning/pad` 与 `/apollo/control/pad`（§4.2）；
`PULL_OVER`/`STOP` 的场景名在它的 `conf/special_config.pb.txt`：`pull_over_scenario_name: "EMERGENCY_PULL_OVER"`、
`stop_scenario_name: "EMERGENCY_STOP"`、`minimun_non_zero_speed: 0.1`。

### 3.4 `CommandStatus` / `CommandStatusRequest`（command_status.proto）

`:7–16 enum CommandStatusType { RUNNING=1, FINISHED=2, ERROR=3, UNKNOWN=4 }`；
`:18–22 CommandStatusRequest{header=1, command_id=2(default -1)}`（查询请求）；
`:24–32 CommandStatus{header=1, command_id=2, required status=3, message=4}`（应答）。

### 3.5 `PlanningCommand`（planning_command.proto）

| 行 | 字段 | 说明 |
|---|---|---|
| 20 | `header` | planning 用 header 判「是不是新命令」（`planning_component.cc:149–153`，grep 定位） |
| 22 | `command_id` | 由 processor 从原始命令拷过来（`:261`） |
| 24 | `lane_follow_command` | **类型是 `apollo.routing.RoutingResponse`** ——名字叫 command，实体是算好的路 |
| 26 | `target_speed` | `:263–265` 从原始命令透传 |
| 28 | `is_motion_command` | processor 一律置 true（`:266`） |
| 31 | `parking_command` | oneof：`ParkingCommand{header, required parking_spot_id, target_speed}`（:9–17） |
| 33 | `custom_command` | oneof：`google.protobuf.Any`，自定义指令的扩展口 |

planning 侧消费：`planning_component.cc:67–69` 建 reader（topic 取自 `planning_config.pb.txt` 的
`topic_config.planning_command_topic`），`:199–201` 取 `lane_follow_command` 交给 pnc_map（详见
`../12_planning源码/08_pnc_map与参考线.md`），`:128` 建 `FLAGS_planning_command_status` writer、`:242–243`
回填 `command_id`。（这批行号 grep 定位，未逐行 read。）

### 3.6 `RoutingRequest` / `RoutingResponse`（routing.proto）

`RoutingRequest`：`:11 header`、`:14 waypoint`（repeated `LaneWaypoint`，**至少两个**：首=起点、末=终点）、
`:15–16 blacklisted_lane/blacklisted_road`（与 external_command 同名字段一一对应）、`:17 broadcast`(default true)、
`:18 parking_info`（**`[deprecated = true]`**）、`:20 is_start_pose_set`(default false)。`RoutingResponse`：
`:24–27 header / repeated road(RoadSegment) / measurement / routing_request`（回带原请求）、`:30–31 map_version / status`。

## 4. 模块现状：装了 9 个 processor，生效 conf 注册 7 个

### 4.1 安装清单（`ls /opt/apollo/neo/lib/modules/external_command/command_processor/`）

10 个目录 = `command_processor_base`（基类，非插件） + **9 个 processor**：`action`、`chassis`、`free_space`、
`lane_follow`、`path_follow`、`precise_parking`、`speed`、`valet_parking`、`zone_cover`。
**⚠️ `src` 树只落了 5 个**（action / command_processor_base / lane_follow / precise_parking / valet_parking），
`include` 与 `lib` 树是全的 10 个——「binary 安装只发头文件」，别据 `src` 判断没装。
`share/.../<processor>/plugins.xml` 9 份齐全，`base_class` 一律 `apollo::external_command::CommandProcessorBase`。

### 4.2 各 processor 的输入/输出 channel（`cat` 各 `conf/config.pb.txt`，未标行号）

| processor | 输入 Service | 输出 | 状态来源 | 生效 conf 注册？ |
|---|---|---|---|---|
| LaneFollow | /apollo/external_command/lane_follow | /apollo/planning/command | /apollo/planning/command_status | ✅ |
| ValetParking | /apollo/external_command/valet_parking | /apollo/planning/command | /apollo/planning/command_status | ✅ |
| Action | /apollo/external_command/action | **/apollo/planning/pad + /apollo/control/pad** | /apollo/canbus/chassis, /apollo/planning, /apollo/planning/command_status | ✅ |
| Chassis | /apollo/external_command/chassis | **/apollo/canbus/chassis_control** | /apollo/canbus/chassis | ✅（仅 profile） |
| FreeSpace | /apollo/external_command/free_space | /apollo/planning/command | /apollo/planning/command_status | ✅ |
| PathFollow | /apollo/external_command/path_follow | /apollo/planning/command | /apollo/planning/command_status | ✅（仅 profile） |
| Speed | /apollo/external_command/speed | /apollo/planning/command | **/apollo/planning** | ✅（仅 profile） |
| ZoneCover | /apollo/external_command/zone_cover | /apollo/planning/command | /apollo/planning/command_status | ❌ 生效 conf 未注册 |
| PreciseParking | /apollo/external_command/precise_parking | /apollo/planning/command | /apollo/planning/command_status | ❌ 两份 conf 都未注册 |

`CommandProcessorConfig`（`command_processor_base/proto/command_processor_config.proto`）4 字段：
`required input_command_name` / `repeated output_command_name` / `repeated input_command_status_name` /
`optional planning_command_history_name`（默认 `/apollo/planning_command_history`）。

### 4.3 ⚠️ 注册清单：出厂 conf 与本机生效 conf **不一样**

`/apollo/modules/external_command/process_component/conf/config.pb.txt` 是软链，`readlink` 落在
**profile 覆盖层** `/apollo_workspace/profiles/current/modules/.../conf/config.pb.txt`（dag 则落在 share）。
两份实测有 diff：出厂件（6 行）注册 **5** 个 = LaneFollow, ValetParking, Action, **ZoneCover**, FreeSpace；
**本机生效**（profile，8 行）注册 **7** 个 = LaneFollow, ValetParking, Action, **Chassis**, FreeSpace,
**PathFollow**, **Speed**。两份第 1 行相同：`output_command_status_name: "/apollo/external_command/command_status"`。

> **CLAUDE.md 的「装 9 注册 5，未注册 Chassis/PathFollow/PreciseParking/Speed」只对出厂 conf 成立**；本机
> 生效的 profile 覆盖层把 Chassis/PathFollow/Speed 注册进去了，反而 ZoneCover 被摘掉 ⇒ 本机未注册的是
> **ZoneCover 与 PreciseParking**。以本条实测为准（2026-09-08）。

## 5. 怎么发一次指令（本机实操）

### 5.1 起组件

```bash
cyber_launch start /apollo/modules/external_command/process_component/launch/external_command_process.launch
# 兼容老 /apollo/routing_request 用 ..._with_old_routing.launch；单模块前台调试用 mainboard -d <上面 dag>
```

`external_command_process.dag` 是 `components{}` 但**没有 readers**（入口是 Service），
`flag_file_path` 用全局 `/apollo/modules/common/data/global_flagfile.txt`。

### 5.2 lane_follow 的三条可用路径（本机都在）

| 路径 | 命令 | 备注 |
|---|---|---|
| **① 自带 C++ demo（最直接）** | `mainboard -d /opt/apollo/neo/share/modules/external_command/external_command_demo/dag/external_command_demo.dag` 后在终端输入 `lane` | `external_command_demo.cc:140–153`：读键盘 `lane` → 造 way_point(0,0,0)+end_pose(10,0,0) → `SendLaneFollowCommand`；坐标是占位值，**必须按自己地图改 conf/源码**。同一 demo 还支持 `set_speed X`/`increase_speed`/`decrease_speed`/`restore_speed`（:120–139）、`path_loc`/`path_path`（:154–159）、`valet_parking`（:160–162）、`command_status=<id>`（:163–169） |
| **② dreamview 路由编辑** | 在 DV/DV+ 里点起终点发路由 | `dreamview/backend/hmi/hmi_worker.cc:201` `CreateClient<LaneFollowCommand, CommandStatus>`；`dreamview_plus/.../simulation_world_updater.cc:126–130` `ConstructLaneFollowCommand` → `PublishLaneFollowCommand`（行号 grep 定位）。**发的也是 LaneFollowCommand Service** |
| **③ python 工具** | `/opt/apollo/neo/bin/planning_command`（py3 wrapper，源码 `modules/tools/planning_command/planning_command.py`） | 交互菜单 0–7，但 **0 号是 ActionCommand.FOLLOW，不是 LaneFollowCommand**；脚本里**没有 lane_follow client**（`:85–94` 只建了 free_space/action/valet_parking/precise_parking/zone_cover）。要 lane_follow 走 ①/②，或照 `:89–90` 的写法自己加一个 client |

自写最小 python 客户端（照 `planning_command.py:81–94` 的形状）：

```python
from cyber.python.cyber_py3 import cyber, cyber_time
import modules.common_msgs.external_command_msgs.lane_follow_command_pb2 as lf
import modules.common_msgs.external_command_msgs.command_status_pb2 as cs
cyber.init(); node = cyber.Node("my_cmd")
cli = node.create_client("/apollo/external_command/lane_follow", lf.LaneFollowCommand, cs.CommandStatus)
c = lf.LaneFollowCommand()
c.header.timestamp_sec = cyber_time.Time.now().to_sec()   # 不填=可能被 2s 超时丢弃
c.header.module_name = "my_cmd"; c.command_id = 1
c.end_pose.x, c.end_pose.y, c.end_pose.heading = 0.0, 0.0, 0.0   # 换成自己地图上的点
print(cli.send_request(c))
```

### 5.3 查状态

`ExternalCommandProcessComponent::Init`（`:49–67`）起 Service `/apollo/external_command/command_status`，
入参 `CommandStatusRequest{command_id}`；它**遍历所有 processor**，谁的 `last_received_command_.command_id`
等于查询 id 就由谁应答（`motion_command_processor_base.h:187–204`：把该 processor 读到的
`/apollo/planning/command_status` 原样 CopyFrom 返回）；无人认领 → `UNKNOWN` + “Cannot get the status of command.”
⇒ **只保留最后一条命令的状态**，查历史 id 一律 UNKNOWN。

## 6. channel / service 总表

| 名字 | 类型 | 形态 | 方向 | 代码位置 |
|---|---|---|---|---|
| /apollo/external_command/lane_follow 等 9 个 | 各 `*Command` | **Service** | 客户端 → external_command | `motion_command_processor_base.h:154`；名字在各 processor `conf/config.pb.txt` |
| /apollo/external_command/command_status | CommandStatusRequest→CommandStatus | **Service** | 客户端 → external_command | `external_command_process_component.cc:49–51`；名字在 process_component `conf/config.pb.txt:1` |
| /apollo/planning/command | planning::PlanningCommand | topic | external_command → planning | writer `motion_command_processor_base.h:163–174, 268`；flag `planning_command` @ adapter_gflags.cc:41（grep）；planning 侧 `planning_config.pb.txt:11 planning_command_topic`（grep） |
| /apollo/planning/command_status | external_command::CommandStatus | topic | planning → external_command / control | flag `planning_command_status` @ adapter_gflags.cc:43（grep）；reader `motion_command_processor_base.h:180–182` |
| /apollo/planning_command_history | planning::PlanningCommand | topic | external_command → 记录 | `command_processor_config.proto` 字段 4 默认值 |
| /apollo/routing_response | routing::RoutingResponse | topic | external_command（主链路）/ routing 组件（旁路）→ HMI | `motion_command_processor_base.h:175–177, 254`；flag :129（grep）；history 版 flag :131–132 由 routing 组件发（`routing_component.cc:50–60`，grep） |
| /apollo/routing_request | routing::RoutingRequest | topic | 老客户端 → old_routing_adapter | `old_routing_adapter/conf/config.pb.txt`；⚠️ **routing 组件不订阅它** |
| /apollo/raw_routing_request | routing::RoutingRequest | topic | → routing 组件 | `/apollo/modules/routing/dag/routing.dag` reader（depth 10） |
| /apollo/planning/pad、/apollo/control/pad | PadMessage | topic | action processor → planning/control | action processor `conf/config.pb.txt` |
| /apollo/canbus/chassis_control | ChassisCommand | topic | chassis processor → canbus | chassis processor `conf/config.pb.txt` |

## 7. ⚠️ 本环境注意

1. **老 `/apollo/routing_response` 与新体系**：planning **不订阅** routing_response，只吃
   `/apollo/planning/command` 内嵌的 `RoutingResponse`；`/apollo/routing_response` 退化为
   **external_command 发给 HMI 画线**的旁路（`:253` 注释为证）。要复用老客户端 → 起
   `external_command_with_old_routing.launch`（带 `old_routing_adapter`，把 `/apollo/routing_request`
   转成 lane_follow / valet_parking Service 请求）。
2. **routing 组件订阅 `/apollo/raw_routing_request`**，不是 `/apollo/routing_request` —— 往后者发消息
   而只起了 routing.dag → 永远没反应。
3. **`src` 树缺 5 个 processor 源码**（只有 `include`+`lib` 全）。要改它们先 `buildtool install external_command`，
   改完 `buildtool build -p <路径>` 完成 install 才会被插件索引
   （`/opt/apollo/neo/share/cyber_plugin_index/`，**不扫 bazel-bin**）发现。
4. **注册列表以 profile 覆盖层为准**（§4.3）：生效 7 个，`ZoneCover`/`PreciseParking` 未注册。启用只需在
   软链 `/apollo/modules/external_command/process_component/conf/config.pb.txt` 加一行
   `processor: "apollo::external_command::ZoneCoverCommandProcessor"`（写穿到 profile，**不用重编**）后重启；
   未注册 → 对应 Service 不存在，客户端 `send_request` 超时/失败。
5. **`planning_command.py:84` 的 topic 是 `/apollo/planning_command`**，与
   `FLAGS_planning_command = /apollo/planning/command` 不一致 —— 该 writer 是死代码（所有分支都走 Service）。
   照抄这行自己发 PlanningCommand 会发到没人订阅的 channel。
6. **`command_id` 只记最后一条**：processor 只存 `last_received_command_`，老 id 一律 UNKNOWN；
   `command_id` 默认 -1，多客户端都不设 id 会互相顶掉。
7. **Service 不出现在 `cyber_channel`**：用 `cyber_service list`（`cyber_channel -w` 在本环境是坏的）。
   搜 `/apollo/...` 下的 conf/dag 用 `grep -R`（`-r` 不跟随符号链接会假空）。

## 8. 验证命令

```bash
# 装了几个 processor（lib 全 10 个）/ src 缺哪几个（只 5 个）
ls /opt/apollo/neo/lib/modules/external_command/command_processor/
ls /opt/apollo/neo/src/modules/external_command/command_processor/
# 生效注册列表：先 readlink 判落点，再与出厂件 diff
readlink /apollo/modules/external_command/process_component/conf/config.pb.txt
diff /apollo/modules/external_command/process_component/conf/config.pb.txt \
     /opt/apollo/neo/share/modules/external_command/process_component/conf/config.pb.txt
# 各 processor 的 channel
for d in /opt/apollo/neo/share/modules/external_command/command_processor/*/conf/config.pb.txt; do
  echo "### $d"; cat "$d"; echo; done
# 起组件 + 发指令（demo 终端里输入 lane）+ 看结果
mainboard -d /apollo/modules/external_command/process_component/dag/external_command_process.dag
mainboard -d /opt/apollo/neo/share/modules/external_command/external_command_demo/dag/external_command_demo.dag
cyber_service list; cyber_channel -e /apollo/planning/command
```

## 9. 溯源

- 蒸馏日期：2026-09-08。基线：Apollo 11.0.0 package 工作区（profile current = ARCF_40P）。
- **read 打开逐行核过**：`lane_follow_command.proto`、`valet_parking_command.proto`、`action_command.proto`、
  `command_status.proto`、`planning_command.proto`、`routing.proto`（均全文）；`motion_command_processor_base.h`
  120–299；`external_command_process_component.cc` 全文；`planning_command.py` 全文；
  `external_command_demo.cc` 120–169；profile 与出厂两份 `process_component/conf/config.pb.txt` 全文；
  `manual/_template.md`、`manual/14/01`。
- **`cat` 全文核对但未标行号**：9 份 processor `conf/config.pb.txt`、action 的 `special_config.pb.txt`、
  `command_processor_config.proto`、`external_command_msgs/{geometry,lane_segment}.proto`、
  `old_routing_adapter/{conf,proto,dag}`、`external_command_demo/conf/demo_config.pb.txt`、
  `process_component/{dag,launch}`、`routing/dag/routing.dag`。
- **仅 grep 定位、未逐行 read 的行号**（引用前自行打开确认）：`adapter_gflags.cc` :41/:43/:129/:131–132；
  `planning_component.cc` :67–69/:128/:149–153/:199–201/:242–243；`routing_component.cc` :39/:46/:50/:60；
  `hmi_worker.cc` :201；`simulation_world_updater.cc` :126–130/:1028–1069；
  `external_command_demo.cc` :35–60/:371–389；`planning_config.pb.txt` :9/:11。
- 遗留待核：① `free_space/path_follow/speed/chassis/precise_parking/zone_cover_command.proto` 六个 proto 字段表
  与 `routing_msgs/{geometry,poi}.proto`（`LaneWaypoint`/`RoadSegment`）均未 read；② 各 processor 的 `Convert()`
  实现（尤其 ValetParking 如何由 `parking_spot_id` 生成 RoutingRequest）未读；③ 未起进程实发指令，Service 名与
  2s 超时为源码结论、非运行时实测；④ `planning_config.pb.txt:9 routing_request_topic` 指向 lane_follow 的用途未追。
