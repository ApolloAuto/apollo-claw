# 03 localization 与坐标系 / TF

<!--
file: references/manual/14_数据与消息/03_localization与坐标系TF.md
scope: 11.0（默认）
tags: LocalizationEstimate, Pose, VRP, 后轴中心, heading, euler_angles, ENU, TF, TransformStampeds, /tf, MeasureState, MSF
sources:
- /opt/apollo/neo/src/modules/common_msgs/localization_msgs/pose.proto（全 65 行）
- /opt/apollo/neo/src/modules/common_msgs/localization_msgs/localization.proto（44–73 精读；其余段落 grep 定位）
- /opt/apollo/neo/src/modules/common_msgs/transform_msgs/transform.proto（全 22 行）
- 交叉引用（已核）：manual/14_数据与消息/01_PnC链路channel全景.md、manual/12_planning源码/08_pnc_map与参考线.md
-->

## 0. 一句话作用

`/apollo/localization/pose`（`apollo::localization::LocalizationEstimate`）是 PnC 的**自车位姿唯一来源**：planning 的 M2、control 的第四路输入。本篇讲清它的字段、**VRP=后轴中心**、heading/euler 的角度约定，以及 TF（`/tf`、`/tf_static`）的消息形态。

## 1. 关键符号与文件

| 概念 | 文件（② src；include 树有对应 .pb.h） | 行号(已核) | 说明 |
|---|---|---|---|
| `LocalizationEstimate` | localization_msgs/localization.proto（81 行） | message 48 | PnC 订阅的主消息 |
| `Pose` | localization_msgs/pose.proto（65 行） | message 23 | 位姿本体，被 `LocalizationEstimate.pose` 引用（:50） |
| `Uncertainty` | localization.proto | 27–46 | 位置/朝向/速度/加速度/角速度的标准差（`Point3D`） |
| `MeasureState` 枚举 | localization.proto | 65–71 | `OK=0 / WARNNING=1（原文拼写）/ ERROR=2 / CRITICAL_ERROR=3 / FATAL_ERROR=4` |
| `LocalizationStatus` | localization.proto | message 73 | `fusion_status` 有效；`gnss_status`/`lidar_status` 已 deprecated（:76–77） |
| `Transform` / `TransformStamped` / `TransformStampeds` | transform_msgs/transform.proto（全 22 行） | 8 / 13 / 19 | TF 消息三层：`translation+rotation` → 加 `header`+`child_frame_id` → 数组 |

## 2. Pose 字段与坐标约定（pose.proto 全文已核）

| 字段 | 编号（行号） | 坐标系与语义 |
|---|---|---|
| `position` | 1（:26） | `PointENU`，**VRP 在地图坐标系**下的位置；注释原文：**"The VRP is the center of rear axle"（车辆参考点 = 后轴中心）** |
| `orientation` | 2（:31） | 四元数，表示 **IMU 系（Right/Forward/Up）→ 世界系（East/North/Up）** 的旋转 |
| `linear_velocity` | 3（:35） | 地图系 ENU 线速度，m/s |
| `linear_acceleration` | 4（:39） | 地图系 ENU 线加速度，m/s² |
| `angular_velocity` | 5（:43） | 地图系绕 E/N/U 轴角速度，rad/s |
| `heading` | 6（:48） | **朝东为 0，朝北为正**（注释原文）——与数学习惯一致，但与"以北为 0 的方位角"相反，转换时注意 |
| `linear_acceleration_vrf` | 7（:52） | **车体系**（Right/Forward/Up）线加速度 |
| `angular_velocity_vrf` | 8（:56） | 车体系角速度 |
| `euler_angles` | 9（:64） | roll/pitch/yaw，内旋序 **z-x-y**，世界系 ENU；roll∈(−π/2,π/2) 绕 y 轴、pitch∈[−π,π) 绕 x 轴、yaw∈[−π,π) 绕 z 轴，右手定则 |

`LocalizationEstimate` 其余字段：`header`（1，:49）、`uncertainty`（3，:51）、`measurement_time`（4，:54，**UNIX 秒**，注意与 header.timestamp_sec 是两个时间）、`trajectory_point`（5，:57，repeated，注释是"司机实际开出的未来轨迹"，PnC 一般不用）、`msf_status`（6，:60）、`sensor_status`（7，:62）。

⚠️ **两套加速度/角速度并存**：不带 `_vrf` 的是地图系（ENU），带 `_vrf` 的是车体系（RFU）。控制里用错系是常见事故；`pose.proto` 注释是唯一权威。

## 3. TF：`/tf` 与 `/tf_static`

- 消息类型 `apollo.transform.TransformStampeds`（transform.proto:19），内含数组，每项 `TransformStamped{header, child_frame_id, transform{translation, rotation}}`（:13–17）；**父坐标系写在 `header.frame_id`，子坐标系写 `child_frame_id`**。
- channel 名是**命名破例**：`/tf`、`/tf_static`（无 `/apollo` 前缀，定义在 `adapter_gflags.cc` 的 `tf_topic`/`tf_static_topic` 附近，见 `01_PnC链路channel全景.md` §5）。
- 常见坐标系名：`world`/`map`、`novatel`（IMU）、`localization`、各传感器 frame（lidar/camera）。**本机具体有哪些 frame 未实测（待核）**：要看运行期 `cyber_channel -e /tf` 或 profile 下 transform conf（`/apollo_workspace/profiles/current/modules/transform/conf/`，本机存在该目录）。

## 4. 修改与扩展点

| 想做什么 | 怎么做 |
|---|---|
| 在 PnC 里取自车位姿 | planning 从 `LocalView.localization`（M2）取；control 从 `local_view_.localization()` 取（见 13_control/01）；两者都是这条消息的整体拷贝 |
| 取"车头"位置而非后轴 | 自己按 `heading` + 车辆参数（后轴到前保距离）外推——**position 是后轴中心**，直接当车头会前移半个车身 |
| 换定位方案（RTK/NDT/MSF） | 定位模块侧的事，PnC 只认这条 channel；本机 profile 有 `modules/localization/{conf,dag,params,msf}` 覆盖层（`profiles/current/`），改前 `readlink` 判定落点 |
| 定位精度评估 | `uncertainty`（std_dev）+ `LocalizationStatus.fusion_status`（MeasureState） |
| 标定外参/杆臂 | 属定位与传感器标定范畴（`profiles/current/modules/localization/params/`），本手册未展开（待核） |

## 5. ⚠️ 本环境注意

- **VRP=后轴中心、heading 朝东为 0**：这两条是 PnC 坐标换算的最高频出错点（proto 注释原文，:24–26、:45–48）。
- **`measurement_time` ≠ `header.timestamp_sec`**：前者是位姿测量时刻（UNIX 秒），后者是消息发出时刻（`FillHeader` 填，见 `../11_cyber框架/04`）。做时延分析要区分。
- **`MeasureState.WARNNING` 是源码拼写**（少一个 I），写代码引枚举名照抄。
- **planning 缺定位不出轨迹、control 缺定位直接 return false**（`control_component.cc:361–367`）——"没轨迹/没命令"先看这条 channel 有没有数据。
- 本机定位相关 conf/dag/params **在 profile 覆盖层**（`profiles/current/modules/localization/`），share 出厂档不是生效档。
- 地图与定位坐标系必须匹配：生效 `--map_dir` 末行是 `/apollo/modules/map/data/apollo_virutal_map`（存在），换图会改变 ENU 原点参照（见 `../12_planning源码/08_pnc_map与参考线.md`）。

## 6. 验证命令

```bash
# 字段与注释原文（坐标约定的唯一权威）
sed -n '23,65p' /opt/apollo/neo/src/modules/common_msgs/localization_msgs/pose.proto

# TF 消息结构
cat /opt/apollo/neo/src/modules/common_msgs/transform_msgs/transform.proto

# 本机 transform 配置落点
ls /apollo_workspace/profiles/current/modules/transform/conf/ 2>/dev/null

# 运行期观察（-w 参数在本环境是坏的）
cyber_channel -e /apollo/localization/pose
cyber_channel -e /tf
```

## 7. 溯源

- 蒸馏日期：2026-09-08。基线：Apollo 11.0.0 package 工作区。
- 本轮 read 打开核对：`pose.proto` 20–65（全部字段行号逐行核过）、`localization.proto` 44–73、`transform.proto` 全文。`localization.proto` 的 `Uncertainty`（27–46）与 `MsfStatus`/`MsfSensorMsgStatus` 定义位置由 grep 定位，**未逐行 read**。
- 遗留待核：① 本机实际 TF frame 名清单（需运行期或读 transform conf）；② `MsfStatus`/`MsfSensorMsgStatus` 字段明细；③ localization 模块内部发布点与融合流程（属定位模块，本手册聚焦 PnC 接口）；④ 定位外参/杆臂标定文件清单。
