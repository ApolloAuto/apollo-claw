# Apollo control / prediction 开发手册

> **⚠️ 本环境（包工作区）适配**：本环境是独立包管理工作区 `/apollo_workspace`，根下没有 `modules/`、`apollo.sh`。
> 本文 `modules/...` 路径：**只读** → 拼 `/opt/apollo/neo/src/`；**要改** → 先 `buildtool install <pkg>`，
> 落到 `/apollo_workspace/modules/...`（保留完整仓库相对路径，不用换算）。编译用
> `buildtool build -p <相对工作区的包路径>`，**不能只 `bazel build`**（不做 install，运行时看不见）。
> **调控制参数、改标定表**：走 `/apollo/<src_path>/conf/*`（符号链接，立即生效）；改工作区源码副本的 conf 要重编才生效。
> controller 是插件，加载路径差异见 `modules/plugin-dev/` 开头适配段。完整对照见仓库根 `CLAUDE.md`。

仓库根 = `/apollo`（容器内）。长知识见 `reference.md`（算法公式位置、全参数速查、已确认缺陷全表）。

## 1. 目录地图

```
modules/control/
  control_component/            # 主 Component（TimerComponent，100Hz）
    control_component.cc/.h     # Proc 主流程
    controller_task_base/       # ControlTask 基类 + ControlTaskAgent + common/（PID/LQR 工具/插值/TrajectoryAnalyzer）
    conf/                       # pipeline.pb.txt / control.conf / calibration_table.pb.txt
    proto/ dag/ launch/ submodules/ tools/
  controllers/                  # 7 个 ControlTask 插件（见下表）
  control_task_base_extend/     # ControlTaskExtend 基类库（场景化参数集、PIDPlus、CheckInPit）
```

真实控制器清单（`ls /opt/apollo/neo/src/modules/control/controllers/` 现场核对，class type 已逐个核对 `plugins.xml`）——**只有 7 个**：

| 目录 | type（pipeline 里写这个） | 横/纵 | 何时用 |
|---|---|---|---|
| `lat_based_lqr_controller` | `LatController` | 横向 | LQR 转角控制，**当前默认启用** |
| `lat_based_lqr_plus_controller` | `LatPlusController` | 横向 | LQR + 按轨迹类型切换参数集 |
| `lon_based_pid_controller` | `LonController` | 纵向 | 位置/速度双环 PID + 标定表查表，**当前默认启用** |
| `lon_based_pid_plus_controller` | `LonPlusController` | 纵向 | PID + 连续速度增益调度 + 多标定表 |
| `slope_anti_slip_control_task` | `AntiSlipControlTask` | 纵向后处理 | 防溜坡/坡道起步/越障，改写油门刹车 |
| `replan_control_task` | `ReplanControlTask` | 无控制量 | 发重规划请求到 injector；**目录最小又六件套齐全，是抄骨架的首选** |
| `debug_info_control_task` | `DebugInfoControlTask` | 无控制量 | 聚合调试信息发 `/apollo/control/debug`，**必须放 pipeline 最末** |

> **⚠️ 本环境没有 `mpc_controller`，也没有 `demo_control_task`**（`controllers/` 下就是上面 7 个，已 `ls` 核对）。
> 所以：**MPC 无法通过改 pipeline 启用**（`type: "MPCController"` 会走 `control_task_agent.cc:44` 不判 nullptr 的路径 → 段错误），要用得自己写；
> **抄骨架请用 `replan_control_task`**（六件套 `.h/.cc/BUILD/plugins.xml/cyberfile.xml/conf/+proto/` 全齐，共 311 行，且已依赖 `control_task_extend`）；
> 只要最裸的插件形状（无 conf/proto）可看 `debug_info_control_task`。

## 2. 主流程：trajectory → ControlCommand

1. `ControlComponent::Init` `control_component.cc:43` —— 只读 `FLAGS_pipeline_file` 一个 proto（`:49-51`，`ACHECK` 失败即崩），再 `control_task_agent_.Init(injector_, control_pipeline_)`（`:60`）建全部插件；5 个 Reader 无 callback，靠 Proc 轮询；末尾硬 `sleep_for(1000ms)`（`:129`）。
2. `ControlComponent::Proc` `control_component.cc:324` —— chassis 为空 return false（`:330-336`）；trajectory 仅 `sequence_num` 变化才更新；localization 为空 return false（`:361-367`）；四份数据 CopyFrom 进 `local_view_`。
3. `CheckAutoMode` `control_component.cc:433` / `:670` —— 非 `COMPLETE_AUTO_DRIVE` 走 `ResetAndProduceZeroControlCommand`（`:444`，定义 `:648`）。
4. `ProduceControlCommand` `control_component.cc:187` —— `CheckInput`（`:529`，唯一失败条件是非 estop 下轨迹点为空）→ `CheckTimestamp`（`:558`，**默认关闭**）→ estop 汇总（`:225-228`，`enable_persistent_estop=false` 会让 planning 的 estop 覆盖本地判定）→ `control_task_agent_.ComputeControlCommand`（`:279`）。
5. `ControlTaskAgent::ComputeControlCommand` `control_task_agent.cc:56-75` —— 按 pipeline 顺序串行调各 task，**共享同一个 `cmd` 指针**（后面的 task 能改前面的输出）；任一 task 返回非 OK 立即 return，后续不执行（`:70-72`）。
6. 写出：`control_cmd_writer_->Write(control_command)` `control_component.cc:508`。

周期由 dag 决定：`dag/control.dag` 的 `interval: 10` → 100 Hz。`FLAGS_control_period=0.01`（`common/control_gflags.cc:110`）只用于超时告警，不驱动周期。

## 3. 新增一个 controller（六件套，缺一不可）

最快路径：`cp -r modules/control/controllers/replan_control_task modules/control/controllers/foo_controller` 后逐项改名（**本环境无 `demo_control_task`**，`replan_control_task` 是现存最小的完整六件套）。

1. **目录**：`modules/control/controllers/foo_controller/{foo_controller.h,.cc,BUILD,plugins.xml,cyberfile.xml,conf/,proto/}`。
2. **继承 `ControlTask`**（`control_component/controller_task_base/control_task.h`），实现 5 个纯虚：`Init(std::shared_ptr<DependencyInjector>)` `:69`、`ComputeControlCommand(localization, chassis, trajectory, cmd)` `:80`、`Reset()` `:89`、`Name()` `:95`、`Stop()` `:100`。参照 `replan_control_task.h`（120 行）+ `replan_control_task.cc`（129 行）。需要场景化参数集/`CheckInPit()`/`IsForwardModel()` 则继承 `ControlTaskExtend`（`control_task_base_extend/control_task_extend.h:51`）。
3. **注册宏**：`.h` 末尾、namespace 内（`#include "cyber/plugin_manager/plugin_manager.h"`）：
   ```cpp
   CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::control::FooController, ControlTask)
   ```
   参照 `replan_control_task.h` 末尾、`lat_controller.h:273-274`。**第一参数全限定，第二参数是不带 namespace 的基类名。**
4. **`plugins.xml`**（两行，参照 `replan_control_task/plugins.xml`）：`path` 是相对仓库根的 `.so` 路径，`type` 是全限定类名，**`base_class` 一律写 `apollo::control::ControlTask`**（7 个现有插件全部如此，已逐个 grep 核对，即使实际继承 `ControlTaskExtend`）：
   ```xml
   <library path="modules/control/controllers/foo_controller/libfoo_controller.so">
       <class type="apollo::control::FooController" base_class="apollo::control::ControlTask"></class>
   </library>
   ```
5. **`BUILD`**（照抄 `replan_control_task/BUILD`，39 行）：`apollo_plugin(name="libfoo_controller.so", description=":plugins.xml", srcs=, hdrs=, copts=CONTROL_COPTS, deps=[...])` + `filegroup(name="runtime", srcs=glob(["conf/*"]))` + `apollo_package()` + `cpplint()`。`description` 漏写 → `apollo_plugin` 直接 fail（`tools/apollo_package.bzl:642-643`，报 `missing attribution of 'description'`）；`runtime` filegroup 漏写 → conf 不会被安装。
6. **proto + conf**：`proto/foo_controller_conf.proto`（照 `replan_control_task/proto/replan_task_conf.proto`）+ `proto/BUILD`；配置文件**必须叫 `conf/controller_conf.pb.txt`**，文件名是硬约束 —— `ControlTask::LoadConfig<T>`（`control_task.h:121-138`）用 `abi::__cxa_demangle` 取运行时类名，再 `GetPluginConfPath<ControlTask>(class_name, "conf/controller_conf.pb.txt")`（`:128`）反推路径，**改类名会连带改配置查找路径**。用 `ControlTaskExtend` 的还需固定名 `conf/params_pipeline.pb.txt`（`control_task_extend.h:113`）。
7. **`cyberfile.xml`**：继承 `ControlTaskExtend` 时必须加 `<depend type="binary" repo_name="control-task-base-extend">control-task-base-extend</depend>`（参照 `lon_based_pid_plus_controller/cyberfile.xml:14`）。
8. **挂到 pipeline**：`control_component/conf/pipeline.pb.txt`（当前只有 `LAT_CONTROLLER/LatController` + `LON_CONTROLLER/LonController` 两条）追加：
   ```
   controller { name: "FOO_CONTROLLER"  type: "FooController" }
   ```
   `PluginDeclareInfo` 的 `name` 与 `type` 都是 **required**（`proto/plugin_declare_info.proto:8-10`），漏写解析失败。
   **陷阱（已核对源码）**：`control_task_agent.cc:42-43` 把类名硬拼成 `"apollo::control::" + type`，且 `:44` 直接 `controller->Init(...)` **不判 nullptr** —— `type` 拼错不是友好报错而是**段错误**。`type` 必须精确等于类名（不含 namespace），`name` 只是标签（只出现在 `:48` 的错误信息里）。
9. **换控制器**：`pipeline.pb.txt` 里的 `type` 只能填上表 7 个类名之一。**想换 MPC 需要自己实现 `MPCController`**（本环境无 `mpc_controller` 目录），直接填 `type: "MPCController"` 会段错误。
10. **追加后处理 task**：放在纵向控制器之后，读 `cmd->throttle()/brake()/steering_target()` 与 `injector_->control_debug_info()` 再改写 cmd —— `slope_anti_slip_control_task` 是完整范例。
11. **编译验证**（本环境）：
    ```bash
    buildtool build -p modules/control/controllers/foo_controller
    ```
    `bazel build //modules/control/controllers/foo_controller:libfoo_controller.so` 只验证能编过，**不做 install，运行时看不见插件**。
    编完确认 `/opt/apollo/neo/share/cyber_plugin_index/` 下出现你的索引文件，再起 `control.dag` 看日志有 `Controller <foo> init done!`（`control_task_agent.cc:51`）。

## 4. 调参

| 目标 | 文件 |
|---|---|
| 横向 | `modules/control/controllers/lat_based_lqr_controller/conf/controller_conf.pb.txt`（104 行） |
| 纵向 | `modules/control/controllers/lon_based_pid_controller/conf/controller_conf.pb.txt`（92 行） |
| 全局 gflags | `modules/control/control_component/conf/control.conf`（40 行）；定义在 `control_component/common/control_gflags.cc`（152 行） |
| 场景化参数（plus 系列） | 同目录 `params_pipeline.pb.txt` + `*_forward_param.pb.txt` / `*_backward_param.pb.txt` |

横向关键字段（行号已核对 lat conf）：`matrix_q :10-13`（`[0.05, 0, 1.0, 0]`，q[0]=横向误差、q[2]=航向误差）、`reverse_matrix_q :14-17`、`cutoff_freq :18`、`max_iteration :20`、`max_lateral_acceleration :21`、`enable_look_ahead_back_control :24`、`lookahead_station :25` / `lookback_station :26` / 高速版 `:27-28`、`switch_speed :29`、`switch_speed_window :30`（**0.0 = 硬切换**）、`lock_steer_speed :37`（**-0.081 是负值，低速锁转向条件恒假**）、`reverse_feedforward_ratio :40`、`lat_err_gain_scheduler :42` 起。

纵向关键字段（行号已核对 lon conf）：`ts :1`（必须等于实际控制周期）、`speed_controller_input_limit :4`、`station_error_limit :5`、`preview_window :6`、`standstill_acceleration :7`、`enable_slope_offset :12`（默认 false，坡度补偿交给 anti_slip task）、`use_acceleration_lookup_limit :13`、`use_steering_check :14`、`station_pid_conf :28`、`low_speed_pid_conf :35`、`high_speed_pid_conf :42`、`switch_speed :49`、`reverse_station_pid_conf :51` / `reverse_speed_pid_conf :58`。

gflags 常用：`pipeline_file`（`control_gflags.cc:19`）、`calibration_table_file`（`:41`）、`steer_angle_rate`（`:65`）、`enable_gain_scheduler`（`:67`，conf 覆盖 true）、`set_steer_limit`（`:69`，conf 覆盖 true）、`enable_input_timestamp_check`（`:93`，**默认 false**）、`max_path_remain_when_stopped`（`:105`）、`control_period`（`:110`）、`minimum_speed_protection`（`:124`）。
**`control.conf` 两处写法错误必须知道**：`:2` 是 `---calibration_table_file=`（三个短横线，gflags 解析不出，该行完全失效走默认值）；`:7` 是 `--steer_angle_rate = 100`（等号两侧有空格，值被解析成 `" 100"`）。

症状 → 调哪里：

| 症状 | 首选动作 |
|---|---|
| 直道画龙 / 方向盘振荡 | 调小 lat `matrix_q :10` 的 q[0]；优先改 `lat_err_gain_scheduler :42` 高速段 ratio（分速度段更安全）；调小 `cutoff_freq :18`；`switch_speed_window :30` 设 0.5~1.0 消除硬切换跳变 |
| 弯道外扩 / 跟踪滞后 | 调大 `lookahead_station :25` 与 `lookahead_station_high_speed :27`；或调大 q[2]（`:12`） |
| 车身斜着走（蟹行） | 调大 q[2]（`:12`）；确认 `enable_look_ahead_back_control :24` = true |
| 纵向稳态误差（上坡持续落后） | 调大 `low/high_speed_pid_conf` 的 ki 与 `integrator_saturation_level`；或开 `enable_slope_offset :12` |
| 起步顿挫 / 给油不走 | 调大 `throttle_minimum_action :3`；调大低速 speed 环 kp（`:38`）；确认 `use_steering_check :14` 未误触发 |
| 刹车过冲 / 停车点头 | 减小 `standstill_acceleration :7` 与 `standstill_narmal_acceleration :16` 绝对值；调大 `full_stop_path_remain_gain :20` 加宽滞回 |
| 位置超调 / 前后点头 | 调小 `station_pid_conf.kp :31`、`station_error_limit :5`、`speed_controller_input_limit :4` |

验证顺序：改 conf **不需重编译**（`filegroup runtime` 装的是文件），重启 control dag 即可 → 看日志确认 `Load the [...] config file successfully`（`control_task.h:135`）→ `cyber_channel echo /apollo/control` 看 `steering_target/throttle/brake` → 开 `FLAGS_publish_control_debug_info` 并把 `debug_info_control_task` 挂在 pipeline 末尾，从 `/apollo/control/debug` 看 `simple_lat_debug` / `simple_lon_debug` 的误差项。

## 5. 标定表（油门刹车 calibration table）

- **文件**：`modules/control/control_component/conf/calibration_table.pb.txt`（已核对：**6486 行**）。
- **格式**：`modules/control/control_component/proto/calibration_table.proto` —— `message calibration_table { repeated ControlCalibrationInfo calibration = 1; }`（`:5-6`），每条 `speed :10`(m/s) / `acceleration :11`(m/s²) / `command :12`（正=油门%，负=刹车%）。
- **引用方式**（不在 controller_conf 里，走 gflag）：`FLAGS_calibration_table_file`（`control_gflags.cc:41`）→ 基类 `ControlTask::LoadCalibrationTable`（`control_task.h:106-117`）→ `LonController::Init` 调用点 `lon_controller.cc:110-114`，建 `Interpolation2D`（`:158-166`），查表在 `:482-495`。
- **重新生成**（`modules/tools/vehicle_calibration/`，已核对文件存在）：`data_collector.py` 实车采集（固定踏板开度匀加/匀减速直线）→ `preprocess.py` / `process_data.py` 清洗 → `result2pb.py`（按 `(speed, cmd)` 分桶对 acc 取均值，再反转成 `(speed, acc) → cmd`）→ `result2pb.sh` 驱动 → `plot_calibration_table.py` 可视化。样例数据 `calibration_data_sample/`。**`result2pb.py:23-24` 仍 import 旧路径 `modules.control.proto.*`，现在跑会 ImportError，先改 import。**
- **在线校验**：`control_component/tools/calibration_table_debug.cc` 重算并与实际下发值比对，结果发 `/apollo/control/calibration_debug`。
- **硬约束**：`Interpolation2D::CheckMap` 要求**每个 speed 分组同时含正负 acceleration**，否则 Init 失败；表外查询两级都 clamp，**不外推**。

## 6. prediction 侧

```
modules/prediction/
  prediction_component.cc/.h   # Init:70 建 evaluator_manager_/predictor_manager_，Proc:117 → ContainerProcess:157
  container/ scenario/ evaluator/ predictor/ network/ common/ conf/ proto/ submodules/ pipeline/ data/
modules/prediction_plugin/     # TensorRT 版模型插件：4 个（multi_agent_{pedestrian,vehicle}_tensorrt、semantic_lstm_{pedestrian,vehicle}_tensorrt）
```

**核心区别：evaluator / predictor 不是插件，是编译期 switch 工厂**（只有模型后端 `ModelBase` 是 cyber 插件）。

新增 evaluator（如 `FOO_EVALUATOR`）：① `proto/prediction_conf.proto:17` 的 `EvaluatorType` **末尾追加**（当前最大 13 = `MULTI_AGENT_EVALUATOR`，不复用 deprecated 的 1/7）；② 写 `evaluator/vehicle/foo_evaluator.h/.cc` 继承 `Evaluator`，构造里设 `evaluator_type_`；③ `modules/prediction/BUILD` 的 `apollo_cc_library(name="apollo_prediction")`（`:47`）里加 srcs/hdrs —— evaluator 子目录**没有独立 BUILD**；④ `evaluator/evaluator_manager.cc` 改两处：`RegisterEvaluators()`（`:100-119`）加一行、`CreateEvaluator()`（`:477`）switch 加 case，**漏 case 会静默返回 nullptr**；⑤ 模型走插件路线时照抄 `evaluator/model_manager/model/semantic_lstm_vehicle_torch_gpu/` 全套，并在 `conf/prediction_conf.pb.txt` 的 `evaluator_model_conf` 加 `model{...}`；⑥ `obstacle_conf` 里把目标场景的 `evaluator_type` 改过去。

新增 predictor：① `proto/prediction_conf.proto:34` 的 `PredictorType` 追加（当前最大 8 = `INTERACTION_PREDICTOR`，**不要复用 2**，REGIONAL 已 deprecated）；② `predictor/<name>/<name>_predictor.h/.cc` 继承 `Predictor` 或 `SequencePredictor`，`Predict()` 内 `Clear()` + `CHECK_NOTNULL` + `SetPredictorType` + 显式设 probability；③ `predictor/predictor_manager.cc` 改两处：`RegisterPredictors()`（`:62-71`）、`CreatePredictor()`（`:300`）；④ `modules/prediction/BUILD` 的 `apollo_prediction` srcs/hdrs；⑤ `conf/prediction_conf.pb.txt` 的 `obstacle_conf.predictor_type`。

**必须配对**：输出 `predicted_trajectory` 的 evaluator 搭 `EXTRAPOLATION_PREDICTOR`；输出 `lane_sequence.probability` 的搭 `LANE_SEQUENCE_PREDICTOR` / `MOVE_SEQUENCE_PREDICTOR`。配错会让 predictor 空跑。

## 7. 排错表

| 现象 | 检查顺序 |
|---|---|
| 控制器没加载 / 起 control 就崩 | ① `pipeline.pb.txt` 的 `type` 是否**精确等于类名**（`control_task_agent.cc:42-43` 硬拼 `apollo::control::` 前缀且 `:44` 不判 nullptr，拼错=段错误）② `plugins.xml` 的 `base_class` 是否为 `apollo::control::ControlTask` ③ `.so` 路径是否与实际产物名一致 ④ BUILD 是否用 `apollo_plugin` 且带 `description=":plugins.xml"` ⑤ 日志有无 `Controller <...> init done!`（`control_task_agent.cc:51`） |
| 配置加载失败 | 文件名是否为 `conf/controller_conf.pb.txt`（硬约束，`control_task.h:128`）；BUILD 是否有 `filegroup(name="runtime", srcs=glob(["conf/*"]))`；类名是否改过（改类名=改配置查找路径） |
| 车不动 / 一直零指令 | ① chassis 是否 `COMPLETE_AUTO_DRIVE`（否则走 `ResetAndProduceZeroControlCommand`，`control_component.cc:444/648`）② `estop_` 是否置位，看 header 的 `estop_reason`（`:225-228`）③ trajectory 是否有点（空轨迹 → estop，`:236-241`）④ 标定表是否加载成功（`lon_controller.cc:110-114`，失败直接 `CONTROL_INIT_ERROR`）⑤ `use_steering_check :14` 是否因方向盘未到位持续把加速度归零 |
| ControlCommand 没发出 | ① `FLAGS_use_control_submodules`（`control.conf:24`）为 true 时 Proc 在 `:388-408` 直接 return，只发 localview 不发 `/apollo/control` ② chassis / localization 任一为空 Proc 直接 return false（`:330-336`、`:361-367`）③ 前置 task 返回非 OK 导致 agent 提前 return（`control_task_agent.cc:70-72`）④ dag 是否真的加载了 ControlComponent |
| 轨迹跟踪偏差大 | ① 先看 `/apollo/control/debug` 的 `lateral_error` / `station_error` 区分横纵 ② 横向查 `matrix_q`、`lookahead_station`、`enable_gain_scheduler` 与增益表 ③ 纵向查 `station_error_limit` / `speed_controller_input_limit` 是否把误差截掉了 ④ 车辆参数 `cf`/`cr`/`mass_*`（lat conf `:3-8`）是否与实车匹配 —— 换车型必须重新辨识 |
| 抖动 / 高频振荡 | ① 调小 q[0] 或高速段 gain ratio ② `switch_speed_window` 为 0 的硬切换（lat `:30`、lon `:50`）③ `cutoff_freq :18` 过大 ④ kd 是否被设成非 0（Apollo 默认全 0，实车会放大噪声）⑤ 停走边界抖动看 `full_stop_path_remain_gain :20` 滞回带 |
| 上游挂死但控制仍在跑 | `FLAGS_enable_input_timestamp_check` 默认 false（`control_gflags.cc:93`，conf `:25` 同为 false），超时检查整体关闭 |
