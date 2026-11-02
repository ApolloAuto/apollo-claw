# 04 conf 分层、标定表与调参

<!--
file: references/manual/13_control源码/04_conf标定与调参.md
scope: 11.0（默认）
tags: control.conf, gflags, profile, ARCF_40P, calibration_table, 标定表, Interpolation2D, params_pipeline, 调参, matrix_q, standstill, anti_slip, control_period, vehicle_calibration
sources:
- /apollo_workspace/profiles/current/modules/control/control_component/conf/control.conf（全 53 行）
- /opt/apollo/neo/share/modules/control/control_component/conf/control.conf（全 40 行，cat -n）
- /opt/apollo/neo/src/modules/control/control_component/common/control_gflags.cc（30–50、62–65、110–112、135–151 段）
- /opt/apollo/neo/src/modules/control/control_component/controller_task_base/control_task.h（96–140 精读）
- /opt/apollo/neo/src/modules/control/control_task_base_extend/control_task_extend.{h:78, cc:50–61}
- /opt/apollo/neo/src/modules/control/controllers/lon_based_pid_plus_controller/lon_plus_controller.cc（156–189 段）
- /opt/apollo/neo/src/modules/control/control_component/controller_task_base/common/interpolation_2d.cc（42–75 段）
- /opt/apollo/neo/src/modules/control/control_component/proto/calibration_table.proto、vehicle_calibration/proto/calibration_table.proto（全文）
- profile 层 conf：lat_based_lqr_plus_controller/conf/controller_conf.pb.txt（1–45）、lon_based_pid_plus_controller/conf/controller_conf.pb.txt（1–60）与其 params_pipeline.pb.txt、slope_anti_slip_control_task/conf/controller_conf.pb.txt（全文）
- 两版 calibration_table.pb.txt（profile 960 行 / share 6486 行，各读前 30 行 + 统计）
- apollo-dev/modules/control-dev/README.md（全 159 行；口径见 §4 注）
- /apollo_workspace/.manual_work/inventory/control_inventory.md（§6 存在性清单）
-->

## 0. 一句话作用

control 的**所有可调项**分三档：全局 gflags（`control.conf`）、控制器实例 conf（各插件包 `conf/*.pb.txt`）、车辆油门刹车标定表（`calibration_table.pb.txt`）。本机三档的**生效档全部在 profile 覆盖层**（`/apollo_workspace/profiles/current` → `ARCF_40P`），share 出厂档只是兜底；改 conf 不需重编，改工作区源码副本的 conf 必须 `buildtool build -p`。

## 1. 关键符号与文件

| 符号/概念 | 文件（层） | 行号(本轮已核) | 说明 |
|---|---|---|---|
| `FLAGS_calibration_table_file` | /opt/apollo/neo/src/.../control_component/common/control_gflags.cc（② src） | 40–43 | 默认值 = `/apollo/modules/control/control_component/conf/calibration_table.pb.txt`（与 conf 里想写的路径一致） |
| `ControlTask::LoadCalibrationTable(tbl*)` | .../controller_task_base/control_task.h | 106–117 | 单表加载，路径取 `FLAGS_calibration_table_file`；**非 plus 控制器**（LonController）走这条 |
| `ControlTaskExtend::LoadCalibrationTable(path, tbl*)` | control_task_base_extend/control_task_extend.h / .cc | h:78；cc:50–61 | **多表加载，路径前缀硬编码** `absl::StrCat("/apollo/modules/control/control_component/conf/", config_path)`（cc:54）→ 完全不看 `FLAGS_calibration_table_file` |
| `LonPlusController::Init` 读表 | controllers/lon_based_pid_plus_controller/lon_plus_controller.cc | 156–169 | 遍历 `params_pipeline.calibration_table_declare()`，逐个 `LoadCalibrationTable(config_path)` 后 `InitControlCalibrationTable` |
| `InitControlCalibrationTable` | 同上 | 182–189 | 把 (speed, acceleration, command) 灌进 `Interpolation2D`，`ACHECK(Init(xyz))` —— **表非法 = 进程崩** |
| `Interpolation2D::CheckMap` | .../controller_task_base/common/interpolation_2d.cc | 50–75 | 每个 speed 分组内**必须同时有正、负 acceleration**（`nag_count==0` 报 "calibration has all pos map" 并 false）；维度一致性检查由 `FLAGS_use_calibration_dimension_equal_check` 控制（默认 false，control_gflags.cc:149–150） |
| 表结构 proto | control_component/proto/calibration_table.proto | 全 12 行 | `message calibration_table { repeated ControlCalibrationInfo calibration = 1; }`；`ControlCalibrationInfo{ speed, acceleration, command }` |
| 标定采集参数 proto | control/vehicle_calibration/proto/calibration_table.proto | 全文 | 离线工具链用：`speed_min/max_condition`、`throttle_max`、`brake_max`、`*_segment`、`train_percentage`、`brake/throttle_train_layer1..3`、`vehicle_type` 等（与运行时表**不是同一个 message**） |
| `FLAGS_control_period` 用途 | control_component.cc | 486 | 只做 `time_diff_ms > FLAGS_control_period*1e3` 超时标记，**不驱动周期**（周期由 dag `interval: 10` 定） |

## 2. conf 分层表（逐项 readlink 实测，2026-09-08）

`/apollo/modules/control/**` 目录是真目录，**每个文件是符号链接**；下表「落点」即 readlink 结果（`profile` = `/apollo_workspace/profiles/current/...`，current→`profiles/ARCF_40P`；`share` = `/opt/apollo/neo/share/...`）。

### 2.1 control_component

| 文件（`/apollo/modules/control/control_component/`） | 落点 | 作用 | 改它要不要重启/重编 |
|---|---|---|---|
| `conf/control.conf` | **profile** | 全局 gflags（dag 的 `flag_file_path` 指它） | 重启组件；不用重编 |
| `conf/pipeline.pb.txt` | **profile** | 装哪些 ControlTask、顺序 | 重启；不用重编 |
| `conf/calibration_table.pb.txt` | **profile** | 生效标定表（两条加载链最终都落这里，见 §3.3） | 重启；不用重编 |
| `dag/control.dag` | profile（引自盘点表 §6.1，本轮只 cat 内容未复核 readlink） | `interval: 10` + `flag_file_path` | 重启 |
| `dag/lateral_longitudinal_module.dag`、`dag/mpc_module.dag`、`launch/*` | share（同上，盘点表） | 陈旧残迹，路径已不存在（见 01 篇 §5） | 不要用 |

### 2.2 controllers（8 包；`debug_info_control_task` 无 conf 目录）

| 包 `conf/` 下文件 | 落点 |
|---|---|
| `demo_control_task/controller_conf.pb.txt` | profile |
| `lat_based_lqr_controller/controller_conf.pb.txt` | profile |
| `lat_based_lqr_plus_controller/`：`controller_conf`、`params_pipeline`、`edge_follow_public_road_forward_param`、`edge_follow_public_road_forward_s_turn_param`、`open_space_{forward,backward}_param`、`public_road_forward_param`、`public_road_forward_s_turn_param` | profile |
| `lat_based_lqr_plus_controller/`：`edge_follow_public_road_forward_{sl,sr}_turn_param`、`public_road_backward_param`、`zone_cover_{forward,backward}_param` | **share** |
| `lon_based_pid_controller/controller_conf.pb.txt` | profile |
| `lon_based_pid_plus_controller/`：`controller_conf`、`params_pipeline`、`open_space_{forward,backward}_param`、`public_road_forward_param` | profile |
| `lon_based_pid_plus_controller/`：`pit_{forward,backward}_param`、`precise_{forward,backward}_param`、`zone_cover_{forward,backward}_param` | **share** |
| `replan_control_task/controller_conf.pb.txt` | **share**（整包只有 share 档） |
| `slope_anti_slip_control_task/controller_conf.pb.txt` | profile |
| `slope_anti_slip_control_task/`：`params_pipeline`、`edge_follow_param`、`public_road_param` | **share** |

⇒ 规律：**profile 只覆盖了「常用/已调过」的那部分文件，其余仍直连 share**。改任何 conf 前先 `readlink`：落点 share 的文件改了会污染出厂件，且下次 `buildtool` 安装同名包会被覆盖。全部 conf 改动**都只需重启 control**，不需重编（conf 是 `filegroup(name="runtime")` 装出来的数据文件）。

## 3. 生效 `control.conf` 逐条（profile 层，全 53 行）

### 3.1 实际生效的 flag

| 行 | flag=值 | 说明 |
|---|---|---|
| 1 | `--pipeline_file=/apollo/.../conf/pipeline.pb.txt` | `ACHECK` 加载，路径错即崩 |
| 7–8 | `control_test_duration=-1`、`enable_csv_debug=false` | 测试/调试开关 |
| 9–12 | 4 个 `*_submodule_name` | 仅 submodule 模式用（本机 false） |
| 13–14 | `is_control_test_mode=false`、`use_preview_speed_for_table=false` | 后者=查标定表用不用预览速度（默认 false，gflags:62–63） |
| 15–18 | `steer_angle_rate=100`、`enable_gain_scheduler=true`、`set_steer_limit=true`、`use_vehicle_epb=true` | **profile 修正了 share 的空格写法**（share :7 是 `--steer_angle_rate = 100`）；epb share=false→profile=true |
| 20–23 | 4 个 `*_pending_queue_size=10` | reader 队列 |
| 25–31 | `reverse_heading_*`、`state_transform_to_com_{drive,reverse}=true`、`query_forward_*`、`enable_gear_drive_negative_speed_protection=false` | 倒车/质心变换/查询策略 |
| 32 | `use_control_submodules=false` | true 会让 Proc 只发 localview 不发 `/apollo/control` |
| 33–36 | `enable_input_timestamp_check=true`（share=false）、`max_{localization,chassis}_miss_num=20`、`max_planning_miss_num=5` | **本机开了输入时间戳检查**（SKILL.md 说"整体关闭"是 share 口径） |
| 37–40 | `max_acceleration_when_stopped=0.01`、`enable_persistent_estop=true`（share=false）、`control_period=0.01`、`soft_estop_brake=15.0`（DEFINE 默认 50.0，gflags:112） | estop 与超时判据 |
| 41–46 | `trajectory_period=0.1`、`chassis_period=0.01`、`localization_period=0.01`、`minimum_speed_resolution=0.2`、`minimum_speed_protection=0.1`、`action=1` | 输入周期期望值 |
| 47–48 | `max_path_remain_when_stopped=0.1`（share 0.2）、`pitch_offset_deg=0.9` | 停车判据/俯仰零偏 |
| 49–53 | `publish_control_debug_info=true`（默认 false，gflags:135）、`use_throttle_filter=true`+`throttle_smoothing_factor=0.08`、`use_speed_filter=true`+`speed_smoothing_factor=0.1`（默认 0.05） | **本机开了油门/速度平滑与 debug 发布**（share 无这 5 行） |

share 有而 profile **没写**的一项：`use_calibration_dimension_equal_check=false` —— profile 缺省取 DEFINE 默认（同为 false，gflags:149–150），效果一致。

### 3.2 遗留死行与笔误行

| 行 | 原文 | 判定 |
|---|---|---|
| 2–5 | `--control_conf_file=`、`--mpc_controller_conf_file=`、`--lateral_controller_conf_file=`、`--longitudinal_controller_conf_file=` 全指 `/apollo/modules/control/conf/` | **死行**：该目录不存在；`FLAGS_control_conf_file` 在 `/opt/apollo/neo/src/modules/control/` 全树 grep **零命中**（本轮 grep 证实），后三者只有 `DEFINE_string` 定义、无消费方。mpc 控制器包本机不存在 |
| 6 | `---calibration_table_file=...`（**三个连字符**） | **该行完全失效，但无害**。本轮实测：用同版本 gflags 编最小程序读 flagfile，三连字符行**既不报错也不赋值**（exit 0，flag 保持默认），两连字符行正常赋值；而 `DEFINE_string(calibration_table_file, ...)` 的默认值（gflags:40–43）**恰好就是这行想写的路径**，所以生效表仍是 profile 那张。⚠️ 但若有人只改这一行的路径想换表，**改了等于没改** |

### 3.3 `control.conf` 不含 `--flagfile`

全 53 行**没有任何 `--flagfile=` 行**（share 40 行同样没有）⇒ control 进程**不加载** `/apollo/modules/common/data/global_flagfile.txt`。含义：dreamview 选图写进 global_flagfile 的 `--map_dir` 等全局 flag 不进 control；control 想用某个全局 flag 必须在 `control.conf` 里自己写一行。

## 4. 标定表（calibration_table）

### 4.1 两版规模差异（本轮 wc/grep 统计）

| 档 | 路径 | 行数 | `calibration {` 条数 | speed 范围 | command 范围 |
|---|---|---|---|---|---|
| **生效** | `/apollo_workspace/profiles/current/modules/control/control_component/conf/calibration_table.pb.txt` | 960 | **192** | 0.0305555556 → 5.0 | −52.66 → 100.0 |
| 出厂 | `/opt/apollo/neo/share/.../control_component/conf/calibration_table.pb.txt` | 6486 | **1297** | 起自 0.0 | −35.0 → 80.0 |

⇒ 生效表是 ARCF_40P 车型自己标的，**比出厂表稀疏近 7 倍**、command 打到 ±100 满量程；两张表不可混用。

### 4.2 表结构

```
calibration { speed: 0.0305555556  acceleration: -0.8280742168  command: -52.655263 }
```

- 三元组含义：`speed` = 车速 m/s（自变量 1）、`acceleration` = 期望加速度 m/s²（自变量 2）、`command` = 该工况下要下发的踏板百分比（**正=油门%，负=刹车%**，此符号约定引自 `apollo-control-dev/SKILL.md:126`，本轮未读 lon_controller 查表实现复核）。
- 排布：**按 speed 分组，组内按 acceleration 升序**（profile 前 30 行为 speed=0.0306 的 6 条，acceleration −0.828→+0.963 递增，command 同向递增；share 同一 speed 组内 acceleration 也升序，但 command 非单调）。
- 用法：`Interpolation2D` 做 (speed, acceleration) → command 的二维插值；**表外不外推，两级 clamp**（SKILL.md:130 口径；`CheckMap` 硬约束已本轮核实：每个 speed 组必须正负加速度齐全）。

### 4.3 谁在读它（两条链，本机生效的是第二条）

| 链 | 触发者 | 路径来源 |
|---|---|---|
| ① `ControlTask::LoadCalibrationTable(tbl*)`（control_task.h:106–117） | `LonController`（非 plus，**本机生效 pipeline 未启用**） | `FLAGS_calibration_table_file`（control_gflags.cc:40–43） |
| ② `ControlTaskExtend::LoadCalibrationTable(path, tbl*)`（control_task_extend.cc:50–61） | **`LonPlusController`（本机生效）**：`lon_plus_controller.cc:156–169` 遍历 `params_pipeline.pb.txt` 的 `calibration_table_declare{config_name, config_path}` | **前缀硬编码** `/apollo/modules/control/control_component/conf/` + `config_path`（cc:54） |

本机 `lon_based_pid_plus_controller/conf/params_pipeline.pb.txt`（profile 层）声明 **3 张表**：`default_calibration_table` / `high_battery_calibration_table` / `normal_battery_calibration_table`，`config_path` **全是同一个 `calibration_table.pb.txt`** ⇒ 三张表当前内容完全相同，且都解析到 `/apollo/modules/control/control_component/conf/calibration_table.pb.txt`（→ profile 那张 960 行表）。注意插件包目录下**并没有** `calibration_table.pb.txt`（`ls` 已确认 profile/share 两侧都没有）——因为前缀是硬编码的 control_component conf 目录，不是插件包目录。

⇒ 换电池档标定表怎么做：在 control_component conf 目录放不同文件名的表，再改 `params_pipeline.pb.txt` 的 `config_path`（哪个 `config_name` 何时被选中的运行期逻辑**待核**，未读 `lon_plus_controller.cc` 查表段）。

### 4.4 离线标定工具链（`/opt/apollo/neo/src/modules/control/vehicle_calibration/`，本轮 find）

| 目录 | 内容 |
|---|---|
| `features/` | `calibration_table_utils.py`、`calibration_table_train_utils.py`、**`neural_network_tf.py`**、`filters.py`、`BUILD` |
| `common/` | `h5_utils.py`、`file_utils.py`、`proto_utils.py`、`multi_vehicle_utils.py`、`multi_job_utils.py`、`logging.py`、`BUILD` |
| `proto/` | `calibration_table.proto`（采集/训练参数：speed/throttle/brake 分段、`train_percentage`、三层网络宽度 `*_train_layer1..3`、`vehicle_type`） |
| 样本（include 树，8 个 hdf5） | `/opt/apollo/neo/include/modules/control/vehicle_calibration/testdata/vehicle_calib_20240424204200/collection_data/{throttle,brake}/{train,test}/2024020{1}-00{10,11}.hdf5` |

流程入口：**实车采集 → hdf5（`collection_data/{throttle,brake}/{train,test}/`）→ `features/` 里的 `calibration_table_train_utils.py` + `neural_network_tf.py` 训练 → 导出 `calibration_table.pb.txt`**。⚠️ 本包**只有 .py 与 proto，没有 `data_collector.py` / `result2pb.py` / `plot_calibration_table.py`**（SKILL.md:128 提到的 `modules/tools/vehicle_calibration/` 那套脚本名在本机此目录下**不存在**）；具体命令行入口（哪个脚本是 main、怎么传参）**待核**，本轮未读 py 源码。

## 5. 调参手法表（症状 → 参数 → 文件）

只列能从字段名与已核代码推断的方向；**无经验公式**，具体数值需实车标定。行号处已注明取自哪份 conf 的第几行（本轮 read 计数）。参照 `apollo-dev/modules/control-dev/README.md`（**该文按 7 个控制器、非 plus conf 写的，行号对本机 plus 版 conf 不适用**，故下表行号一律以本轮读到的 profile plus conf 为准）。

| 症状 | 相关参数 | 改哪个文件（先 readlink） |
|---|---|---|
| 横向跟踪误差大 / 弯道外扩 | `matrix_q`（:10–13，本机 5.5/1.0/1.5/0.0）、`lookahead_station`(:22)/`lookback_station`(:23) 与高速版(:24–25)、`max_lateral_acceleration`(:17) | `controllers/lat_based_lqr_plus_controller/conf/controller_conf.pb.txt`（profile） |
| 方向盘抖动 / 画龙 | 调小 q[0]（:10）、`cutoff_freq`(:14)、`mean_filter_window_size`(:15)；`switch_speed_window: 0.0`(:27) 是**硬切换**，可给窗宽消除跳变；`ts`(:1) 必须等于实际控制周期 0.01 | 同上 |
| 分工况（倒车/泊车/贴边）表现不同 | 对应 `*_param.pb.txt`（`public_road_*` / `open_space_*` / `zone_cover_*` / `edge_follow_*`），由同目录 `params_pipeline.pb.txt` 的 `params_declare` 声明 | lat/lon plus 包 `conf/`（**部分落点是 share**，见 §2.2） |
| 起步顿挫 / 给油不走 | `throttle_minimum_action`(:3)、`brake_minimum_action`(:2)、`station/speed_pid_conf` 的 kp/ki 与 `speed_input`+`*_speed_gain_output` 增益表；再看标定表低速段（speed≈0.03 组）command 是否够大 | `controllers/lon_based_pid_plus_controller/conf/controller_conf.pb.txt`（profile）+ `control_component/conf/calibration_table.pb.txt` |
| 停车点头 / 刹车过冲 / 停不住 | `standstill_acceleration`(:7, −2.0)、`standstill_narmal_acceleration`(:8, −0.5)、`stop_gain_acceleration`(:9)、`speed_itfc_full_stop_speed`(:11)/`speed_itfc_stop_speed`(:17)/`speed_itfc_path_remain_min`(:12)/`_max`(:15)；全局 `--max_path_remain_when_stopped`(control.conf:47)、`--max_acceleration_when_stopped`(:37) | 同上 + `control.conf` |
| 位置超调 / 前后点头 | `station_error_limit`(:5)、`speed_controller_input_limit`(:4)、`preview_window`(:6)、`station_pid_conf.kp` | lon plus `controller_conf.pb.txt` |
| 坡道溜车 / 坡起失败 | `enable_hill_start`、`hill_start_pitch_threshold`、`hill_start_preview_window`、`gravity_hill_start_gain`、`epb_brake_cmd`(60)、`downhill_brake_rate`、`slope_pitch_acc_gain_scheduler`（pitch→ratio 表，本机除 pitch:0.0 外 ratio 全 1.0）、`brake_minimum_action`；全局 `--pitch_offset_deg`(control.conf:48)、`--use_vehicle_epb`(:18) | `controllers/slope_anti_slip_control_task/conf/controller_conf.pb.txt`（profile；`edge_follow_param`/`public_road_param`/`params_pipeline` 在 **share**）+ `control.conf` |
| 越障/被挡后起步不了 | 同包 `obstacle_*` 系列（`obstacle_throttle_cmd_threshold`、`obs_throttle_add_default: 45.0`、`in_obstacle_preview_speed`、`quit_opbstacle_window`——原文拼写如此） | 同上 |
| 周期超时告警（`total_time_exceeded`） | dag 的 `interval: 10`(ms) 与 `--control_period=0.01`(s) **两处必须一致**；`control_period` 只做超时判据（control_component.cc:486），不驱动周期 | `dag/control.dag` + `conf/control.conf`（均 profile） |
| 输出量抖 / 想看内部误差 | `--use_throttle_filter`+`--throttle_smoothing_factor`(:50–51)、`--use_speed_filter`+`--speed_smoothing_factor`(:52–53)、`--publish_control_debug_info=true`(:49) 后看 `/apollo/control/debug` | `control.conf` |
| 上游卡死仍在跑 | `--enable_input_timestamp_check`（本机 :33 = true）、`max_*_miss_num`(:34–36) | `control.conf` |
| estop 行为 | `--soft_estop_brake=15.0`(:40)、`--enable_persistent_estop=true`(:38，true = 本地判定不被 planning estop 覆盖) | `control.conf` |

## 6. ⚠️ 本环境注意

- **改 share 出厂档不生效**：control 的三份主 conf + control.dag 都软链到 `/apollo_workspace/profiles/current`（ARCF_40P）。想让改动生效，改 `/apollo/...` 那个软链（写穿到 profile）或直接改 profile 文件；只改 `/opt/apollo/neo/share/...` 的同名文件对本机 control **没有任何作用**（除了 §2.2 中落点确为 share 的那些）。
- **改工作区源码副本的 conf 必须重编**：`/apollo_workspace/modules/control/**/conf/*` 是源码档，`buildtool build -p modules/control/<包>` 完成 install 才进 share；且**profile 覆盖层会继续盖住它**——调试期请改 profile，提交期改源码副本。
- **`dag interval` 与 `control_period` 两处要一致**：本机 `interval: 10` ↔ `control_period=0.01`。只改一处 = 周期变了但超时判据没变（或反之），表现为满屏 `total_time_exceeded` 或该报不报。
- **标定表换车必换**：表是车辆动力学/制动系统的指纹（本机 192 条 vs 出厂 1297 条，command 量程也不同）。换车沿用旧表 → 油门刹车全程偏；且 `Interpolation2D::CheckMap` 要求每个 speed 组正负加速度齐全，自制表缺一侧会**在 `ACHECK` 处直接崩**（lon_plus_controller.cc:189）。
- **三连字符 flag**：`control.conf:6` 的 `---calibration_table_file=` 完全失效（本轮 gflags 实测：不报错、不赋值）。本机因 DEFINE 默认值恰好等于目标路径而无实际影响，但**任何人想通过改这行换表都会失败**；顺手把它改成两个连字符更安全。另注：本机生效的 `LonPlusController` 根本不读这个 flag（走 `ControlTaskExtend` 硬编码前缀）。
- **`control.conf:2–5` 是死行**：`/apollo/modules/control/conf/` 目录不存在，`FLAGS_control_conf_file` 在 control 源码树零命中，mpc 控制器包本机不存在。别照它们去找配置。
- **控制器 conf 目录名由类名 demangle 决定**：`ControlTask::LoadConfig`（control_task.h:121–138）用 `abi::__cxa_demangle(typeid(*this).name())` 取类全名交给 `GetPluginConfPath<ControlTask>(class_name, "conf/controller_conf.pb.txt")`——**改类名/namespace 就改了 conf 查找路径**，文件名 `controller_conf.pb.txt` 是硬约束；`ControlTaskExtend` 子类另需固定名 `conf/params_pipeline.pb.txt`。
- **搜 `/apollo/...` 用 `grep -R`**（`-r` 不跟随符号链接会假空）。
- **SKILL.md 口径已部分过期**：它按 7 个控制器、`control.conf` 40 行（=share 档）、非 plus 版 conf 行号写的；本机 8 个控制器、生效 conf 是 profile 档 53 行、pipeline 跑 plus 版。用它的调参思路可以，**行号与"当前默认启用"结论要按本机重核**。

## 7. 验证命令

```bash
# 判定每个 conf 的真实落点（profile 还是 share）
readlink /apollo/modules/control/control_component/conf/control.conf
for f in /apollo/modules/control/controllers/*/conf/*; do echo "$f -> $(readlink "$f")"; done

# 生效 flag 全文（注意 :2-5 死行、:6 三连字符）
cat /apollo/modules/control/control_component/conf/control.conf

# 标定表规模与合法性自查（每个 speed 组要有正负加速度）
grep -c 'calibration {' /apollo/modules/control/control_component/conf/calibration_table.pb.txt
grep -o 'speed: [-0-9.]*' /apollo/modules/control/control_component/conf/calibration_table.pb.txt | sort -u | wc -l

# 改完重启并确认加载日志
mainboard -d /apollo/modules/control/control_component/dag/control.dag
#   期望日志：Load the [apollo::control::LonPlusController] config file successfully...
#             Load the calibraiton table file successfully, file path: /apollo/modules/control/control_component/conf/calibration_table.pb.txt
#             Controller <Name> init done!

# 改工作区源码副本的 conf 后（提交路线）
buildtool build -p modules/control/controllers/lon_based_pid_plus_controller
```

## 8. 溯源

- 蒸馏日期：2026-09-08。基线 Apollo 11.0.0 package 工作区，profile `current → ARCF_40P`。
- 本轮 read 打开核对的文件：`_template.md`、本目录 01/03 篇、`control_inventory.md`（130–229）、profile `control.conf`（全 53 行）、share `control.conf`（cat -n 全 40 行）、`control_task.h`（96–140）、profile 层 `lat_based_lqr_plus_controller/conf/controller_conf.pb.txt`（1–45）、`lon_based_pid_plus_controller/conf/{controller_conf.pb.txt(1–60), params_pipeline.pb.txt}`、`slope_anti_slip_control_task/conf/{controller_conf.pb.txt, params_pipeline.pb.txt(share)}`、两版 `calibration_table.pb.txt`（各前 30 行 + wc/grep 统计）、`control_component/proto/calibration_table.proto`、`vehicle_calibration/proto/calibration_table.proto`、`apollo-dev/modules/control-dev/README.md`（全 159 行）。
- 其他证据（sed/grep/ls/find/编译实测，非 read）：`control_gflags.cc` 30–50/62–65/110–112/135–151 段；`control_task_extend.h:78` 与 `control_task_extend.cc:50–61`；`lon_plus_controller.cc:156–189`；`interpolation_2d.cc:42–75`；`control.dag` 全文；`vehicle_calibration/` find 树与 8 个 hdf5 路径；`FLAGS_control_conf_file` 在 control 源码树 grep 零命中；**gflags 三连字符行为用同环境 `g++ -lgflags` 最小程序实测**（两连字符赋值成功 / 三连字符静默失效、exit 0）。
- 遗留待核：① `command` 正=油门/负=刹车的符号约定与查表 clamp 行为（引自 SKILL.md，未读 `lon_controller.cc`/`lon_plus_controller.cc` 查表段）；② 三张 `calibration_table_declare`（default/high_battery/normal_battery）运行期如何选表；③ `vehicle_calibration` python 工具的命令行入口与调用顺序（本包无 `data_collector.py`/`result2pb.py`）；④ share `control.conf:7` 等号带空格（`--steer_angle_rate = 100`）的实际解析结果（profile 已修正，未单独实测）；⑤ `dag/control.dag` 与 `launch/*` 的 readlink 落点本轮未复核（引自盘点表 §6.1）；⑥ lat/lon plus 各 `*_param.pb.txt` 的字段语义（留给 `02_横纵向控制器.md`）。
