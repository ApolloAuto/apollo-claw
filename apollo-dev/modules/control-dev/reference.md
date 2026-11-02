# Apollo control / prediction 参考资料

配套 `SKILL.md`。所有 `file:line` 相对仓库根，`modules/control/` 与 `modules/prediction/` 前缀在小节标题里省略时按上下文补齐。

## 1. ControlTask 基类接口契约

`modules/control/control_component/controller_task_base/control_task.h`：

| 成员 | 行 | 说明 |
|---|---|---|
| `virtual ~ControlTask()` | `:62` | default |
| `Init(std::shared_ptr<DependencyInjector>)` | `:69` | 纯虚。约定在此调 `LoadConfig<T>` 与（纵向）`LoadCalibrationTable` |
| `ComputeControlCommand(localization, chassis, trajectory, cmd)` | `:80` | 纯虚。`cmd` 是**共享**的，pipeline 里后面的 task 会看到并可改写前面的输出 |
| `Reset()` | `:89` | 纯虚。非自动驾驶模式与 estop 解除时被 agent 遍历调用 |
| `Name()` | `:95` | 纯虚。仅用于日志 |
| `Stop()` | `:100` | 纯虚，但 **`ControlTaskAgent` 从不调用**，属死接口 |
| `LoadConfig<T>(T*)` | `:104` 声明 / `:120-138` 定义 | `abi::__cxa_demangle(typeid(*this).name())` 取运行时类名 → `PluginManager::GetPluginConfPath<ControlTask>(class_name, "conf/controller_conf.pb.txt")`（`:128`）。**配置文件名硬编码，路径由类名反推** |
| `LoadCalibrationTable(calibration_table*)` | `:106-117` | 读 `FLAGS_calibration_table_file`（`:107`），`GetProtoFromFile` 失败返回 false |

`ControlTaskExtend : public ControlTask`（`control_task_base_extend/control_task_extend.h:51`）额外提供：`LoadParamsPipelineConfig<T>`（固定读 `conf/params_pipeline.pb.txt`，`:113`）、`IsForwardModel()` `:84`、`CheckInPit(pit_replan_check_time, pit_replan_check_count, vehicle_speed, replan)` `:86`、`LoadCalibrationTable(path, conf)`（`control_task_extend.cc:50-61`，**硬编码前缀 `/apollo/modules/control/control_component/conf/`**）。

`ControlTaskAgent`（`controller_task_base/control_task_agent.cc`）：
- `Init` `:33-54` —— pipeline 为空返回 `CONTROL_INIT_ERROR`（`:35-38`）；`PluginManager::CreateInstance<ControlTask>("apollo::control::" + type)`（`:42-43`）；**`:44` 直接用返回值不判 nullptr**。
- `ComputeControlCommand` `:56-75` —— 串行；每个 task 耗时 push 进 `cmd->mutable_latency_stats()->add_controller_time_ms`（`:69`）；非 OK 立即 return（`:70-72`）。
- `Reset` `:77-` —— 遍历调 `Reset()`，忽略返回值。

`DependencyInjector`（`controller_task_base/common/dependency_injector.h`）是跨 task 黑板：`vehicle_state()` `:35`、`Set_pervious_control_command()`（拼写就是 pervious，**只抽取 `simple_lon_debug`**，`:39-43`）、`Get_previous_lon_debug_info()` `:45`、`set/get_planning_command_status()` `:49-58`、`previous_control_command_mutable()` `:60-66`、`mutable_control_debug_info()` / `control_debug_info_clear()` `:76-84`、`set/control_process()` `:86-91`、`mutable_control_interactive_info()` `:93-99`。

## 2. 各控制器算法原理与关键公式实现位置

### 2.1 LatController（LQR，`controllers/lat_based_lqr_controller/lat_controller.cc`）

自行车模型 4 状态：`[lateral_error, lateral_error_rate, heading_error, heading_error_rate]`（+ preview 扩维）。

| 环节 | 位置 | 要点 |
|---|---|---|
| `LoadControlConf` | `:87` | 车辆参数：`wheelbase_`/`steer_ratio_`/`steer_single_direction_max_degree_ = max_steer_angle/π*180`/`mass_ = 四轮质量和`/`lf_`/`lr_`/`iz_ = lf²·m_f + lr²·m_r`（`:107-124`） |
| `Init` | `:177`，`:185` 调 LoadControlConf | 状态维 `matrix_size = 4 + preview_window_`（`:191`） |
| A 矩阵常数项 | `:204-213` | `a(0,1)=1`、`a(1,2)=(cf+cr)/m`、`a(2,3)=1`、`a(3,2)=(lf·cf - lr·cr)/iz` |
| A 矩阵速度项 | `matrix_a_coeff_` 构建于 Init，每周期 `UpdateMatrix` `:711` 除以 v 填回（`:715-718`） | 低速保护 `v = max(v, minimum_speed_protection_)`（`:711-713`，来自 `FLAGS_minimum_speed_protection`=0.1，`control_gflags.cc:124`） |
| B 矩阵 | `:218-223` | `b(1,0)=cf/m`、`b(3,0)=lf·cf/iz`；控制量维度 = 1（仅转角） |
| 离散化 | `:729-731`（`UpdateMatrix` 内） | Tustin：`Ad = (I - ts/2·A)^-1 (I + ts/2·A)` |
| 倒档模型重建 | `:397-435`，配合 `:705-709` | `cf_/cr_` 取负、`a(0,1)=0`、`a(0,2)=v` → 换成运动学 `ė_y = v·e_ψ`。受 `reverse_use_dynamic_model`（conf `:41`）控制 |
| preview 扩维 | `UpdateMatrixCompound` `:734` | `adc(4+i, 5+i)=1` 移位链 |
| LQR 求解 | `:475`（增益调度分支）/ `:479` | `common::math::SolveLQRProblem(Adc, Bdc, Q, R, lqr_eps_, lqr_max_iteration_, &matrix_k_, ...)`，实现在 `modules/common/math/linear_quadratic_regulator.cc`（Riccati 迭代）。**未收敛只 ADEBUG 告警，仍用当前 K**（对比 MPC 失效归零） |
| 反馈项 | `:491-493` | `steer_angle_feedback = -(K·state)(0,0) · 180/π · steer_ratio / max_deg · 100` |
| 前馈项 | `ComputeFeedForward` `:747-770`，调用点 `:495` | `kv = lr·m/(2·cf·L) - lf·m/(2·cr·L)`；前进档 `ff = (L·κ + kv·v²·κ - K(0,2)·(lr·κ - lf·m·v²·κ/(2·cr·L)))·180/π·steer_ratio/max_deg·100`；倒档 `ff = reverse_feedforward_ratio · L · κ · ...` |
| leadlag 增广 | `:498-516` | `enable_leadlag_` 来自 `enable_reverse_leadlag_compensation`（conf `:22`），**代码不区分挡位**；`enable_feedback_augment_on_high_speed` 决定是否全速域生效 |
| 合成 | `:517` 附近 | `steer_angle = feedback + feedforward + feedback_augment` |
| 误差计算 | `ComputeLateralErrors` `:773`，lookahead 分段 `:824-839`，heading feedback `:843-855`，lateral feedback `:859-867` | 前进档 `lateral_error_feedback = lateral_error + lookahead_station·sin(heading_error)`；倒档 `- lookback_station·sin(...)` |
| 状态更新 | `UpdateState` `:655`，`:659` / `:667` 两个 `ComputeLateralErrors` 调用点（COM 变换与否） | `enable_look_ahead_back_control` 时状态用 feedback 版（`:677-681`） |
| 注册宏 | `lat_controller.h:273-274` | — |

单位链条：**弧度 → 度 → ×steer_ratio → ÷max_steer_angle(度) → ×100 = 方向盘百分比**。

### 2.2 LonController（双环 PID，`controllers/lon_based_pid_controller/lon_controller.cc`）

| 环节 | 位置 | 要点 |
|---|---|---|
| `Init` | `:102` | `:110-114` 调 `ControlTask::LoadCalibrationTable`，失败 `CONTROL_INIT_ERROR`；`:156-166` 用 `(speed, acceleration, command)` 三元组建 `Interpolation2D` |
| `ComputeControlCommand` | `:169` | `control_interpolation_` 为空直接报错（`:178-182`）；`trajectory_analyzer_` 按 `sequence_num` 懒重建 |
| 误差计算 | `ComputeLongitudinalErrors` `:621-707`，调用点 `:206` | `station_error = ref.s - s_matched`（`:682`）、`speed_error = ref.v - s_dot_matched`（**投影速度**，`:685`）、`acceleration_error`（`:688-689`）、preview 版（`:700-701`） |
| PID 参数按工况切换 | `:221-263` | 倒档 → `reverse_*`（在坑内 → `pit_*`）；`v <= switch_speed` → `station_pid + low_speed_pid`；`v > switch_speed` → `station_pid + high_speed_pid`。**station 环两支共用同一份 conf** |
| 双环串联 | `:265-295` | 外环 station PID 输出 `speed_offset` → 与 speed_error 合成 → clamp 到 `speed_controller_input_limit` → 内环 speed PID 出 `acceleration_cmd_closeloop` |
| 停车判定 | `GetPathRemain` 调用点 `:357`；full_stop 逻辑 `:379-384`（滞回）、`:424-453`（钳位与软停） | 用 `FLAGS_max_path_remain_when_stopped`（`control_gflags.cc:105`）与 `full_stop_path_remain_gain` |
| 标定表查表 | `:461-500` | 四个 `Interpolate` 分支（`:482` / `:486` / `:491` / `:495`），按 `use_preview_speed_for_table` 与挡位分流；**查表前取绝对值**（与 MPC 不同） |
| 油门刹车合成 | `:502-513` | `calibration_value >= 0` → `throttle = max(v, throttle_lowerbound)`；否则 `brake = max(-v, brake_lowerbound)` |
| debug 输出 | `:553`、`:568` | `set_calibration_value` 等 |
| 注册宏 | `lon_controller.h:185-186` | — |

### 2.3 MPCController（**本环境不存在，仅作算法参考**）

> **⚠️ `modules/control/controllers/mpc_controller/` 在本环境里没有** —— `/opt/apollo/neo/src/modules/control/controllers/`
> 与 `/opt/apollo/neo/include/modules/control/controllers/` 下都只有 SKILL.md 表里那 7 个目录（已两棵树都 `ls` 核对）。
> 本节保留是因为它记录的是**算法与已确认缺陷**，如果你要自己实现一个 MPC 控制器，这是最完整的参照；
> 但**不要按下面的 file:line 去打开文件，也不要在 `pipeline.pb.txt` 里填 `type: "MPCController"`**
> （`control_task_agent.cc:44` 不判 nullptr → 段错误）。下面所有 `mpc_controller.cc:NNN` 都是历史行号。

6 状态 `[lat_err, lat_err_rate, heading_err, heading_err_rate, station_err, speed_err]`，2 控制量 `(前轮转角, 加速度)`。

| 环节 | 位置 | 要点 |
|---|---|---|
| `LoadControlConf` | `:77` | 车辆参数同 LatController（`:102-115`） |
| `Init` | `:209` 调 LoadControlConf | `matrix_r_` `:248`、`matrix_q_` `:250` |
| **`matrix_r` 不校验 size** | `:252-255` | conf 给超过 2 个元素会**越界写**；对比 `matrix_q` 有严格校验并在 size≠6 时报错（`:257-267`） |
| 增益调度 | `:406-420` | q(0,0)/q(2,2)/r(0,0) 按速度插值 |
| A 矩阵扩展 | `:223-224` | `a(4,5)=1`（`ṡ_err = v_err`）、`a(5,5)=0` |
| B 矩阵扩展 | `:239-240` | `b(5,1) = -1`；A 用 Tustin（`:758-760`）而 B 用前向欧拉，**不一致** |
| C 矩阵（曲率扰动） | `:242-243`、`:762-764` | 算了但**从未传入 MpcOsqp**（`:473-477` 参数列表无 C） |
| QP 求解 | `:474-484` | `MpcOsqp(...).Solve(&control_cmd)`；**失败时只 AERROR，`control[0]` 保持零** → 转角与加速度归零，只剩前馈 |
| 前馈补偿链 | `:488-491`（`unconstrained_control`）、`:492-516`（`steer_angle_ff_compensation`） | `control_gain` / `addition_gain`（`:436-440`）与 `matrix_k_`（`:246`）初始化为零后**从未赋值** → 整条前馈补偿恒 0 |
| OSQP workspace | `mpc_osqp.cc:307-337` | **每周期全量重建**，配 `max_iteration: 3000` 在 10ms 周期内有超时风险 |
| 注册宏 | `mpc_controller.h` 末尾 | class type = `MPCController` |

### 2.4 其余 4 个 task

- **`slope_anti_slip_control_task/anti_slip_control_task.cc`**（继承 `ControlTaskExtend`）：排在纵向控制器之后，读 `cmd->throttle()/brake()` 与 `simple_lon_debug` **改写油门刹车**。参数集按轨迹类型选（`:109-113`，`EDGE_FOLLOW` → `edge_follow_param.pb.txt`，其余 → `public_road_param.pb.txt`，`OPEN_SPACE` 早退 `:133-136`）。坡度门限 `CheckSlope` `:607-614`。逻辑 A 坡道加速度增益 `:198-510`；逻辑 B 坡道起步 `:386-497`（触发检测 `DetectHillStartCondition` `:632-660`，参数计算 `:710-729`，刹车三段释放 `:437-445`，退出条件 `:662-679`）；逻辑 C 越障 `:800-869`（油门每周期 +0.5 上限 99，`:517-528`）；逻辑 D 安全检查开关 `:540-557`。
- **`replan_control_task/replan_control_task.cc`**（130 行）：不产生控制量。订阅 `/apollo/safety/decision`；两个触发条件 `:85`（`has_safety_mode_trigger_time`）与 `:95`（`Chassis::CMD_NOT_IN_PERIOD`），写 `REPLAN_REQ_ALL_REPLAN` 到 injector（`:102-113`）。
- **`debug_info_control_task/debug_info_control_task.cc`**（76 行）：唯一无 conf 无 proto 的 task，`:45-61` 聚合发 `/apollo/control/debug`，双开关 `injector_->control_process()` && `FLAGS_publish_control_debug_info`。**必须放 pipeline 最末**。**只要最裸的插件形状（不带 conf/proto）就抄它。**
- ~~`demo_control_task`~~ **本环境不存在**（`controllers/` 下只有 7 个目录，`src/` 与 `include/` 都核对过）。原文把它当「新增插件的最小骨架」，现在请改抄 **`replan_control_task/`**（六件套 `.h/.cc/BUILD/plugins.xml/cyberfile.xml/conf/+proto/` 全齐，共 311 行）或 `debug_info_control_task/`（最裸）。历史提示：它的 `ComputeControlCommand` 在 `a==0` 时算 `a/abs(a)` 会产 NaN 并写进 `cmd->set_acceleration()`，且用 `abs()` 而非 `std::fabs()` —— 抄任何骨架时都别把这类除零/整数取绝对值的写法带过来。

### 2.5 共用工具库（`controller_task_base/common/`）

`pid_controller`、`pid_BC_controller`、`pid_IC_controller`、`leadlag_controller`、`mrac_controller`、`interpolation_1d`、`interpolation_2d`、`hysteresis_filter`、`trajectory_analyzer`、`dependency_injector`，各带 `_test.cc`。
`control_task_base_extend/common/` 另有 `pid_plus_controller`（按车速插值出 kp/ki/kd 倍率，把两档硬切升级为连续增益调度）、`interpolation_plus_1d`、`leadlag_plus_controller`、`exponential_smoothing`、`control_checker`、`math_utils`、`trajectory_analyzer_extend`。

## 3. 控制参数字段速查表

### 3.1 横向（`controllers/lat_based_lqr_controller/conf/controller_conf.pb.txt`，104 行）

| 字段 | conf 行 | 值 | 调大 | 调小 |
|---|---|---|---|---|
| `ts` | `:1` | 0.01 | 必须等于实际控制周期，否则离散化与滤波器全部失真 | — |
| `preview_window` | `:2` | 0 | 状态扩维，**`matrix_q` 长度必须同步为 4+preview_window** 否则 Init 失败 | 0 = 不扩维 |
| `cf` / `cr` | `:3-4` | 155494.663 | 模型认为车更"硬"，控制量偏小、响应变钝 | 控制量偏大、可能过冲。**必须台架/实车辨识** |
| `mass_fl/fr/rl/rr` | `:5-8` | 520 各 | 影响 `mass_`/`lf_`/`lr_`/`iz_`/`kv` 前馈系数；配错整个动力学模型偏移 | 同上 |
| `eps` | `:9` | 0.01 | Riccati 收敛更快但 K 粗糙、控制量可能跳变 | K 更精确但迭代久 |
| `matrix_q[0]` 横向误差 | `:10` | 0.05 | 贴线紧；过大 → 方向盘振荡、切内道 | 允许横向漂移、弯道外扩 |
| `matrix_q[1]` 横向误差率 | `:11` | 0.0 | 增加阻尼抑制超调；过大 → 对定位噪声敏感 | 无阻尼（当前状态） |
| `matrix_q[2]` 航向误差 | `:12` | 1.0 | 抑制蟹行；与 q[0] 目标耦合，同时调大会冲突振荡 | 直线段可能斜着走 |
| `matrix_q[3]` 航向误差率 | `:13` | 0.0 | 抑制横摆振荡 | 无阻尼 |
| `reverse_matrix_q[0..3]` | `:14-17` | 同正常 | 倒档专用；倒车是运动学模型，**通常需比前进档更小的 q[0]** | — |
| `cutoff_freq` | `:18` | 10 Hz | 响应快；过大 → 噪声透传、方向盘抖 | 平滑但相位滞后，可能因负相位裕度振荡 |
| `mean_filter_window_size` | `:19` | 10 | 误差更平滑。**仅 `enable_navigation_mode_error_filter=true` 时生效**（当前 false） | 响应快噪声大 |
| `max_iteration` | `:20` | 150 | 更可能收敛但最坏耗时长 | 可能不收敛（只告警仍用旧 K） |
| `max_lateral_acceleration` | `:21` | 5.0 | `steer_limit = atan(max_lat_acc·L/v²)` 分子；调大允许高速急转。**仅 `FLAGS_set_steer_limit=true` 时生效**（`control.conf:9` 覆盖为 true） | 高速转角被严格限制 |
| `enable_reverse_leadlag_compensation` | `:22` | true | leadlag 总开关，**命名带 reverse 但代码不区分挡位** | — |
| `enable_steer_mrac_control` | `:23` | false | MRAC 自适应；开启前须确认 `steer_mrac_conf` 尺寸约束 | — |
| `enable_look_ahead_back_control` | `:24` | true | 状态用 feedback 版误差；也是 `trajectory_transform_to_com` 生效前提 | — |
| `lookahead_station` | `:25` | 1.4224 | 提前响应弯道、更平顺，但削弱当前误差纠正（贴线变差） | 贴线紧但弯道滞后、易画龙 |
| `lookback_station` | `:26` | 2.8448 | 倒档后视距离，调大倒车更平顺但精度下降 | — |
| `lookahead_station_high_speed` | `:27` | 1.4224 | 高速版（`|v| >= switch_speed`）。**通常应大于低速版**，当前相同说明未做速度分段 | — |
| `lookback_station_high_speed` | `:28` | 2.8448 | 同上 | — |
| `switch_speed` | `:29` | 2.0 | 低速参数作用到更高车速 | 更早切高速组 |
| `switch_speed_window` | `:30` | **0.0** | 建议 0.5~1.0 做软过渡 | 0 = **硬切**，边界处 lookahead 跳变引起方向盘阶跃 |
| `query_relative_time` | `:31` | 0.8 | 匹配点更超前（仅 `query_time_nearest_point_only` 或导航模式下用） | — |
| `enable_navigation_mode_position_update` | `:32` | true | 导航模式下按定位变化平移旋转轨迹 | — |
| `trajectory_transform_to_com_reverse/_drive` | `:33-34` | true | 轨迹从后轴中心平移到质心；**须 `enable_look_ahead_back_control=true`** | — |
| `enable_feedback_augment_on_high_speed` | `:35` | false | true → leadlag 全速域生效；false → 只在 `|v| < switch_speed` | — |
| `enable_maximum_steer_rate_limit` | `:36` | false | 按 `vehicle_param.max_steer_angle_rate()·ts` 限单周期转角变化。**建议实车打开** | 指令阶跃可能打坏转向电机 |
| `lock_steer_speed` | `:37` | **-0.081** | **负值使 `\|v\| < lock_steer_speed` 恒假**，低速锁转向实际只靠 `path_remain <= 0` 触发；要启用应改正值（如 0.081） | — |
| `query_time_nearest_point_only` | `:38` | false | true = 按时间查匹配点（贴规划时序）；false = 按位置查最近点（贴实际几何） | — |
| `enable_navigation_mode_error_filter` | `:39` | false | 是否用 MeanFilter 滤误差 | — |
| `reverse_feedforward_ratio` | `:40` | 1.4 | 倒档过弯更利索；过大 → 倒车画龙 | 倒车前馈不足 |
| `reverse_use_dynamic_model` | `:41` | false | true → 倒档也用动力学模型（低速 1/v 项数值条件差，建议保持 false） | — |
| `lat_err_gain_scheduler` | `:42` 起 | 4→1.0, 8→0.6, 12→0.2, 20→0.1, 25→0.05 | q[0] 的速度倍率表。**改这张表比改 q[0] 安全**（能分速度段独立调） | — |
| `heading_err_gain_scheduler` | 紧随其后 | 4→1.0, 8→0.6, 12→0.4, 20→0.2, 25→0.1 | q[2] 的速度倍率表；衰减比 lat 慢 → 高速相对更重视姿态 | — |
| `steer_mrac_conf` | 末尾块 | 见 `proto/mrac_conf.proto` | `mrac_model_order`(1)、`reference_time_constant`(0.09)、`adaption_*_gain`(1e-4，几乎不自适应)、`adaption_matrix_p` **尺寸必须匹配 model_order**。`lat_controller.cc:548-555` 在 `\|v\| <= FLAGS_minimum_speed_resolution` 时把自适应率置 0（低速冻结） | — |
| `reverse_leadlag_conf` | 末尾块 | α=1.0 / β=1.0 / τ=0.0 / sat=3000 | α>β 超前（抑制低频振荡，补偿传动间隙），α<β 滞后。**当前 α=β、τ=0 相当于单位增益无补偿**，sat 3000 等于不限幅 | — |

### 3.2 纵向（`controllers/lon_based_pid_controller/conf/controller_conf.pb.txt`，92 行）

| 字段 | conf 行 | 值 | 说明 |
|---|---|---|---|
| `ts` | `:1` | 0.01 | 必须等于实际控制周期，否则 I/D 项与 jerk 全部失真 |
| `brake_minimum_action` | `:2` | 0.0 | ↑ 刹车响应更确定但轻减速也给大刹车 → 顿挫；↓ 轻刹可能完全无效 |
| `throttle_minimum_action` | `:3` | 0.0 | ↑ 起步利索、不易"给油不走"；但滑行时持续拖最小油门 → 低速蠕行停不住 |
| `speed_controller_input_limit` | `:4` | 1.5 | **限制最大追速强度的关键闸门**。↑ 加速度指令激进、急加急刹；↓ 温和但大速差时收敛慢 |
| `station_error_limit` | `:5` | 2.0 | ↑ 追赶激进可能超调；↓ 外环被削弱，太小等于关掉外环 |
| `preview_window` | `:6` | 20.0 | `preview_time = 20×0.01 = 0.2s`。↑ 前馈超前、响应快；过大 → 提前动作、超调、终点提前减速 |
| `standstill_acceleration` | `:7` | -0.3 | full_stop 硬钳位（`lon_controller.cc:424-433`）。绝对值↑ 驻车力强不溜车但停稳点头明显 |
| `enable_reverse_leadlag_compensation` | `:8` | false | station/speed 环各串一级超前滞后；**命名带 reverse 但不区分挡位** |
| `use_preview_reference_check` | `:9` | false | 开启多一条"preview 加速度与速度近 0 即判停"通道，停车更早更稳但可能误判 |
| `steer_cmd_interval` | `:10` | 20.0 % | ↑ 更容忍方向盘偏差、起步顺；↓ 更严格，正常转弯可能断续给油 |
| `enable_speed_station_preview` | `:11` | false | true → station 误差用 preview 版 |
| `enable_slope_offset` | `:12` | **false** | 0/1 乘子。开启 → `acceleration_cmd += 9.8·sin(pitch)`。**Apollo 默认关闭并把坡度补偿交给 `slope_anti_slip_control_task`** |
| `use_acceleration_lookup_limit` | `:13` | false | 开启 → 查表加速度先被 `vehicle_param.max_acceleration()+坡度补偿` 截断且下发截断值。**按加速度接口控制的车辆很关键** |
| `use_steering_check` | `:14` | true | 方向盘未到位时加速度归零并清积分；倒车入库更安全但造成起步延迟。触发还需 `trajectory_type()==UNKNOWN` |
| `pedestrian_stop_time` | `:15` | 15 s | ↑ 短暂行人干扰不触发驻车；↓ 更快驻车但 EPB 反复动作 |
| `standstill_narmal_acceleration` | `:16` | -0.5 | 软停（拼写就是 narmal）。绝对值↑ 软停减速更明显、更早停住；↓ 拖沓易越过停止点 |
| `full_stop_long_time` | `:17` | 3.0 s | EPB 介入延迟。↑ 更晚介入靠液压保持；↓ 动作频繁 |
| `epb_change_count` | `:18` | 40 | `SetParkingBrake` 两阶段各持续周期数（0.4s）。过大 → EPB 响应迟缓 |
| `stop_gain_acceleration` | `:19` | -1.0 | 非 NORMAL 轨迹已越线时追加制动。绝对值↑ 快速止停；↓ 越线后回收慢 |
| `full_stop_path_remain_gain` | `:20` | 0.3 | 滞回加偏。↑ 滞回带更宽（抗抖强但起步迟）；↓ 停/走边界抖动 |
| `use_opposite_slope_compensation` | `:21` | 1 | int32 符号位。实车 pitch 定义与代码假设相反时配 -1 |
| `speed_itfc_*` | `:22-27` | full_stop_speed 0.09 / path_remain_min 0.10 / dcc_emergency -1.5 / speed_cmd 0.10 / path_remain_max 0.6 / acc_thres 0.0 | 仅 `use_speed_itfc=true`（速度指令接口）时生效，接近终点压到爬行值 |
| `station_pid_conf` | `:28-34` | kp 0.2 / ki 0 / kd 0 / sat 0.3，**`integrator_enable: false`** | 外环，前进档低速+高速共用。**关积分是刻意的** —— 外环加积分极易让位置误差累积成持续速度偏置导致低频摆振 |
| `low_speed_pid_conf` | `:35-41` | kp 2.0 / ki 0.3 / kd 0 / sat 0.3, integ on | 内环，`v <= switch_speed` 且非坑；也是 Init 默认 |
| `high_speed_pid_conf` | `:42-48` | kp 1.0 / ki 0.3 / kd 0 / sat 0.3, integ on | 内环，`v > switch_speed`。低速 2.0 / 高速 1.0 体现"低速需大增益克服死区、高速需降增益防振" |
| `switch_speed` | `:49` | 3.0 | ↑ 低速大增益延伸到更高车速（中速响应快易振）；↓ 更早切温和增益（起步慢） |
| `switch_speed_window` | `:50` | 0.0 | **`lon_controller.cc` 全文未引用**，LonController 的增益切换是硬切。该字段只在 MPC 与 lat LQR 生效 |
| `reverse_station_pid_conf` | `:51-57` | kp 0.4 / ki 0.1 / kd 0 / sat 0.5 | 外环倒档非坑 |
| `reverse_speed_pid_conf` | `:58-` | kp 0.8 / ki 0.3 / kd 0 / sat 0.5 | 内环倒档非坑 |
| `pit_station_pid_conf` / `pit_speed_pid_conf` | 后段 | 0.5/0.3/0/**1.5**；1.0/0.2/0/**1.0** | 坑内。sat 明显大于正常 0.3，因为这些工况阻力大需更强稳态补偿 |
| `pitch_angle_filter_conf.cutoff_freq` | 后段块 | 5 Hz | ↑（20）坡度跟踪快但补偿量抖；↓（2）平滑但衔接处补偿不足 |
| `pit_replan_check_time` / `pit_replan_check_count` | 后段 | 14.0 / 3 | 坑洼判定窗口与次数。↓ 更易判卡住（可能误判正常重规划）；↑ 更保守但脱困慢 |

**kd 全为 0 是刻意的**：kd 对 `s_dot_matched` 与定位噪声极敏感，实车会放大成高频抖动。

**`throttle_lowerbound` / `brake_lowerbound` 是兜底下限不是死区抑制**：`lon_controller.cc:502-506` 显示 `acceleration_lookup >= 0` 但 `calibration_value < 0`（查表认为该刹车）时仍输出 `throttle_lowerbound`，调大会在加减速切换点强行给油。

### 3.3 共用 gflags（`control_component/common/control_gflags.cc`，152 行；conf 覆盖见 `conf/control.conf`，40 行）

| flag | 定义行 | 默认 | conf 行/值 | 说明 |
|---|---|---|---|---|
| `pipeline_file` | `:19` | `/apollo/modules/control/control_component/conf/pipeline.pb.txt` | `:1` | Init 唯一必读的 proto |
| `calibration_table_file` | `:41` | 同目录 `calibration_table.pb.txt` | **`:2` 写成 `---calibration_table_file=`（三个短横线）→ 该行完全失效，走默认值** | 各 ControlTask 自行加载 |
| `use_preview_speed_for_table` | `:62` | false | `:6` | 查标定表横轴用 preview 速度还是当前速度 |
| `steer_angle_rate` | `:65` | 100.0 | **`:7` 写成 `--steer_angle_rate = 100`（等号两侧有空格）→ 值被解析成 `" 100"`** | 下发给底盘的方向盘转速指令 |
| `enable_gain_scheduler` | `:67` | false | `:8` = **true** | 高速增益调度总开关 |
| `set_steer_limit` | `:69` | false | `:9` = **true** | 是否按 `max_lateral_acceleration` 限转角 |
| `use_vehicle_epb` | — | false | `:10` | EPB 总开关（proto 里同名字段未被使用，是迁移残留） |
| `*_pending_queue_size` | — | — | `:12-15` = 10 | 4 个 Reader 队列深度 |
| `reverse_heading_control` | — | false | `:17` | 倒档时是否翻转 `lateral_error_rate` 与 `lateral_acceleration` 符号 |
| `state_transform_to_com_drive/_reverse` | — | — | `:19-20` = true | 车辆状态平移到质心 |
| `query_forward_time_point_only` / `query_forward_station_point_only` | — | — | `:21-22` = false | TrajectoryAnalyzerExtend 的匹配点查法 |
| `enable_gear_drive_negative_speed_protection` | — | false | `:23` | **打开前必须先给 `control_component.cc:245` 补空判**（已判定空轨迹后仍访问 `trajectory_point(0)`） |
| `use_control_submodules` | — | false | `:24` | true 时 Proc 在 `:388-408` 直接 return，只发 localview |
| `enable_input_timestamp_check` | `:93` | false | `:25` = false | **默认整个超时检查是关的**，上游静默挂死时 control 会一直用旧数据算控制量 |
| `max_localization_miss_num` | — | — | `:26` = 20 | `control_component.cc:634-635` **误用它作 trajectory 上报门限**，应为 `max_planning_miss_num`（=5），导致 trajectory 要连丢 20 次才上报 |
| `max_chassis_miss_num` | — | — | `:27` = 20 | — |
| `max_planning_miss_num` | — | — | `:28` = 5 | — |
| `max_acceleration_when_stopped` | — | 0.01 | `:29` | 判停阈值；也用于 `control_component.cc:546` 的零化 |
| `enable_persistent_estop` | — | — | `:30` = **false** | **导致 `control_component.cc:225-228` 用 planning 的 estop 状态覆盖掉输入检查失败/超时产生的 estop**。改安全逻辑前必须先确认这条语义 |
| `control_period` | `:110` | 0.01 | `:31` | **不驱动周期**（周期由 dag 的 `interval: 10` 决定），只用于超时告警（`control_component.cc:486`）。改频率必须改 dag 并同步此值；下游 canbus 用 `max_control_miss_num × control_period` 判超时（`modules/canbus/canbus_component.cc:247-255`） |
| `soft_estop_brake` | — | — | `:32` = 15.0 | — |
| `trajectory_period` / `chassis_period` / `localization_period` | — | — | `:33-35` = 0.1 / 0.01 / 0.01 | 超时判定基准 |
| `minimum_speed_resolution` | — | 0.2 | `:36` | 低速零化门限（`control_component.cc:545`） |
| `minimum_speed_protection` | `:124` | 0.1 | `:37` | A 矩阵 1/v 项除零保护下限。↑ 低速模型更保守；↓ 低速增益暴涨有数值风险 |
| `action` | — | 1 | `:38` | 默认 pad action = START（`control_component.cc:134-136`） |
| `max_path_remain_when_stopped` | `:105` | 0.3 | `:39` = **0.2** | ↑ 更早判停、停得更保守；↓ 更贴停止线但可能越线 |
| `use_calibration_dimension_equal_check` | — | false | `:40` | 为真时 `Interpolation2D::CheckMap` 要求每个 speed 下 acc 采样数相同 |
| `pitch_offset_deg` | — | 0.0 | 未在 conf | IMU 安装倾角标零。**配错会导致平路上恒定的错误坡度补偿**（约 0.17 m/s² 每度） |
| `publish_control_debug_info` | — | — | 未在 conf | `debug_info_control_task` 的发布开关 |

### 3.4 车辆参数依赖（`modules/common_msgs/config_msgs/vehicle_config.proto`，经 `VehicleConfigHelper`）

| 参数 | 用途 | 使用点 |
|---|---|---|
| `wheel_base` | A/B 矩阵的 lf/lr、前馈、steer_limit、向心加速度 | `lat_controller.cc:107, :523, :749, :878` |
| `steer_ratio` | 前轮角 ↔ 方向盘转角换算 | `lat_controller.cc:108, :492` |
| `max_steer_angle` | `steer_single_direction_max_degree_`，所有百分比换算的分母 | `lat_controller.cc:109-110` |
| `max_steer_angle_rate` | 转角速率限幅 | `lat_controller.cc:532` |
| `throttle_deadzone` / `brake_deadzone` | 油门/刹车下限兜底 | `lon_controller.cc:455-460` |
| `max_acceleration` / `max_deceleration` | MPC 控制量约束、LonController 的 lookup 上限 | `mpc_controller.cc:102-103, :445-449`、`lon_controller.cc:467` |
| `max_abs_speed_when_stopped` | full_stop 判据、档位输出保护、CheckInPit | `lon_controller.cc:369, :414, :581` |

**`cf` / `cr` / `mass_*` 是 controller_conf.pb.txt 里的字段而不是 vehicle_param** —— 换车型时两处都要改，且 `cf`/`cr` 需台架或实车辨识。

## 4. control 的输入输出 channel

channel 名全部来自 `modules/common/adapters/adapter_gflags.cc`，不是 control 自己定义。

输入（5 个 Reader，callback 全为 nullptr，靠 Proc 内 `Observe()` 轮询）：`chassis_topic` = `/apollo/canbus/chassis`（`control_component.cc:70`）、`planning_trajectory_topic` = `/apollo/planning`（`:78`）、`planning_command_status` = `/apollo/planning/command_status`（`:87`）、`localization_topic` = `/apollo/localization/pose`（`:96`）、`pad_topic` = `/apollo/control/pad`（`:105`）。

输出：`control_command_topic` = `/apollo/control`（`:113`，`!use_control_submodules`）、`control_local_view_topic` = `/apollo/control/localview`（`:117`，submodule 模式）、`control_interative_topic` = `/apollo/control/interactive`（`:121`，始终建；**上游拼写就是 `interative` 少一个 c**）。

旁路：`/apollo/control/debug`（`debug_info_control_task`）、`/apollo/control/calibration_debug`（硬编码在 `tools/calibration_table_debug.cc`）、`/apollo/monitor`。

`LocalView`（`proto/local_view.proto:11-17`）5 字段：header / chassis / trajectory / localization / pad_msg。

`README_cn.md:112-124` 的 IO 表已过时（漏了 `planning_command_status` 与 `control_interactive`）。

## 5. prediction 的 evaluator / predictor 清单

`EvaluatorType`（`modules/prediction/proto/prediction_conf.proto:17-32`，共 14 个枚举）：

| 值 | 名 | 备注 |
|---|---|---|
| 0 | `MLP_EVALUATOR` | 已注册（`evaluator_manager.cc:101`） |
| 1 | `RNN_EVALUATOR` | **deprecated + 死代码** |
| 2 | `COST_EVALUATOR` | navi 模式唯一支持的 evaluator |
| 3 | `CRUISE_MLP_EVALUATOR` | 默认 conf 中用于 on_lane 车辆 |
| 4 | `JUNCTION_MLP_EVALUATOR` | 路口车辆 |
| 5 | `CYCLIST_KEEP_LANE_EVALUATOR` | — |
| 6 | `LANE_SCANNING_EVALUATOR` | — |
| 7 | `PEDESTRIAN_INTERACTION_EVALUATOR` | **死代码**，未注册 |
| 8 | `JUNCTION_MAP_EVALUATOR` | — |
| 9 | `LANE_AGGREGATING_EVALUATOR` | — |
| 10 | `SEMANTIC_LSTM_EVALUATOR` | 条件注册（`:109-111`），caution 通道主力 |
| 11 | `JOINTLY_PREDICTION_PLANNING_EVALUATOR` | 条件注册（`:113`） |
| 12 | `VECTORNET_EVALUATOR` | 条件注册（`:114`），默认 conf 中 on_lane/in_junction 车辆用 |
| 13 | `MULTI_AGENT_EVALUATOR` | 条件注册（`:118`），当前最大值 |

注册在 `RegisterEvaluators()` `evaluator_manager.cc:100-119`，工厂 `CreateEvaluator()` `:477`，实现文件在 `evaluator/vehicle/`（13 个 `.h/.cc` 对）、`evaluator/cyclist/`、`evaluator/pedestrian/`、`evaluator/warm_up/`。

`PredictorType`（`prediction_conf.proto:34-44`，共 9 个枚举）：

| 值 | 名 | 目录 | 备注 |
|---|---|---|---|
| 0 | `LANE_SEQUENCE_PREDICTOR` | `predictor/lane_sequence/` | 消费 `lane_sequence.probability` |
| 1 | `FREE_MOVE_PREDICTOR` | `predictor/free_move/` | 默认兜底 |
| 2 | `REGIONAL_PREDICTOR` | — | **deprecated + 死代码，不要复用此值** |
| 3 | `MOVE_SEQUENCE_PREDICTOR` | `predictor/move_sequence/` | 消费 `lane_sequence.probability` |
| 4 | `EMPTY_PREDICTOR` | `predictor/empty/` | — |
| 5 | `SINGLE_LANE_PREDICTOR` | `predictor/single_lane/` | 已注册但默认 conf 不选中 |
| 6 | `JUNCTION_PREDICTOR` | `predictor/junction/` | 已注册但默认 conf 不选中；输出 probability 保持默认 **0** |
| 7 | `EXTRAPOLATION_PREDICTOR` | `predictor/extrapolation/` | 消费 evaluator 写入的 `predicted_trajectory` |
| 8 | `INTERACTION_PREDICTOR` | `predictor/interaction/` | 已注册但默认 conf 不选中；probability 默认 0 |

注册在 `RegisterPredictors()` `predictor_manager.cc:62-71`，工厂 `CreatePredictor()` `:300`。`predictor/sequence/` 是 `SequencePredictor` 基类（提供 `FilterLaneSequences`、多项式工具、`DrawConstantAccelerationTrajectory`）。

主流程入口：`PredictionComponent::Init` `prediction_component.cc:70`（`:74-75` 建两个 manager），`Proc` `:117`，`MessageProcess::ContainerProcess` 调用点 `:157`（容器更新 → 场景 → 优先级 → evaluator → predictor）。

配置：`conf/prediction_conf.pb.txt`（`topic_conf` + `obstacle_conf` + `evaluator_model_conf`）、`conf/prediction.conf`（gflags flagfile）、`conf/adapter.conf`（**ContainerManager 靠它决定注册哪些 container**，`container/container_manager.cc:35-43` 只注册 RECEIVE_ONLY/DUPLEX）、`conf/prediction_navi*.conf`、`conf/offline_prediction.conf`。

模型后端插件：`evaluator/model_manager/model/` 下按 `(evaluator_type, obstacle_type, backend)` 三元组选（backend = CPU/GPU/TensorRT）；TensorRT 版在 `modules/prediction_plugin/`，现有 4 个：`multi_agent_pedestrian_tensorrt`、`multi_agent_vehicle_tensorrt`、`semantic_lstm_pedestrian_tensorrt`、`semantic_lstm_vehicle_tensorrt`。

## 6. 坐标系、单位与时间戳约定

- 长度米、**角度弧度**（theta/alpha/pitch 全是 rad）、速度 m/s、加速度 m/s²、时间戳 double 秒（Unix epoch）。转角百分比链条：弧度 → 度 → ×steer_ratio → ÷max_steer_angle(度) → ×100。
- `Pose.position` 是**后轴中心 VRP**（`modules/localization/proto/pose.proto:24-26`）。`linear_velocity` / `linear_acceleration` / `angular_velocity` 是 **ENU 世界系**，`*_vrf` 才是车体系 RFU（`pose.proto:33-56`）—— **control 用 vrf**。
- `Pose.euler_angles`（`pose.proto:58-64`）**roll 绕 y、pitch 绕 x，与通用约定相反**，序列 z-x-y 内旋。
- `LocalizationEstimate.measurement_time` ≠ `header.timestamp_sec`（`modules/localization/proto/localization.proto:53-54`）；做传感器时间对齐**必须用前者**。
- `Uncertainty` 同一条消息内 position/velocity 用 ENU，acceleration/angular_velocity 用 RFU（`localization.proto:37-43`）。
- 轨迹匹配点：`TrajectoryAnalyzer`（`controller_task_base/common/trajectory_analyzer.cc`）提供按位置查最近点、按相对时间查、按绝对时间查三套。LatController 默认按位置查（`query_time_nearest_point_only: false`），LonController 的参考点/预瞄点按**绝对时间**查（`lon_controller.cc:644-652`）。混用两者会得到语义不同的匹配点。
- `TrajectoryTransformToCOM`（`lat_controller.cc:381-388`）把轨迹从后轴中心平移到质心，**必须同时 `enable_look_ahead_back_control=true` 才生效**。

## 7. control 已知高危坑与已确认缺陷

> **⚠️ 关于本章里带 `mpc_controller.cc:` 与 `demo_control_task` 的条目（7.1 的 6、7.3 的 20/23/24/25/26/27/34，
> 以及 7.2 的 16 提到的"只在 MPC 生效"）**：这两个目录在本环境**都不存在**（见 §2.3、§2.4 的说明）。
> 保留它们只为两个用途：① 自己实现 MPC 时知道哪些坑要避开；② 读到旧版仓库或旧文档时能对上。
> **这些 file:line 不要拿去打开文件**，其余条目（LatController / LonController / control_component /
> control.conf / anti_slip / prediction）全部在本环境可现场核对。

### 7.1 安全语义（最高优先级）

1. **`conf/control.conf:30` 把 `enable_persistent_estop` 设为 false**，使 `control_component.cc:225-228` 用 planning 的 estop 状态**覆盖**掉输入检查失败/超时产生的 estop。
2. **超时检查默认整体关闭**：`FLAGS_enable_input_timestamp_check` 默认 false（`control_gflags.cc:93`，conf `:25` 同为 false）。上游静默挂死时 control 一直用旧数据算控制量。
3. **`control_component.cc:634-635` 误用 `FLAGS_max_localization_miss_num` 作 trajectory 上报门限**，应为 `max_planning_miss_num`。conf 下 planning=5 / localization=20 → trajectory 要连丢 20 次才上报。
4. **`control_component.cc:245` 在已判定空轨迹后仍访问 `trajectory_point(0)`** —— 打开 `enable_gear_drive_negative_speed_protection` 前必须补空判。
5. **`control_task_agent.cc:42-44` 对 `CreateInstance` 返回值不判 nullptr** —— pipeline 里 `type` 拼错就是段错误。已现场核对源码确认。
6. **MPC 失效时控制量归零**（`mpc_controller.cc:478-484`）：OSQP 失败只 AERROR，`control[0]` 保持零 → 转角与加速度都变 0 只剩前馈；而 LQR 未收敛只告警仍用当前 K。**两者失效行为差异巨大**。
7. **submodule 模式下低速零化失效**：`submodules/preprocessor_submodule.cc:221` 用 `for (auto p : ...trajectory_point())` 值拷贝，写不回去，`minimum_speed_resolution` 无效。
8. **submodule dag 与 conf 冲突**：dag 里含 ControlComponent 但 conf `use_control_submodules=false`，直接起 submodule dag 会导致 ControlComponent 与 Postprocessor 同时发 `/apollo/control`、Preprocessor 收不到 localview。用 submodule 必须先改这个 flag。
9. **submodule dag/launch 路径只在 neo 安装环境有效**（`modules/control/...` 而非 `control_component/...`），靠 `control.json:29-38` 的 postinst 软链。
10. **`submodules/BUILD:6` 四个 submodule 共用 `MODULE_NAME="preprocessor_submodule"`** → MPC/LatLon/Postprocessor 的日志模块名全打成 preprocessor。
11. **Init 里硬编码 `sleep_for(1000ms)`**（`control_component.cc:129`），任何启动时序优化都要面对它。

### 7.2 配置写法错误（已核对文件）

12. **`conf/control.conf:2` 是 `---calibration_table_file=`（三个短横线）** → gflags 解析不出这个名字，该行完全失效，依赖默认值。
13. **`conf/control.conf:7` 是 `--steer_angle_rate = 100`（等号两侧有空格）** → gflags 把值解析成 `" 100"`。
14. **lat conf `:37` 的 `lock_steer_speed: -0.081` 是负值**，使 `|v| < lock_steer_speed` 恒假，低速锁转向实际只靠 `path_remain <= 0` 触发。
15. **`switch_speed_window: 0.0`**（lat conf `:30`、lon conf `:50`）意味着低/高速切换是**硬切**，边界处 lookahead / PID 增益跳变。建议设 0.5~1.0。
16. **`switch_speed_window` 在 LonController 中完全未被引用**（proto 定义、conf 配了 0.0），只在 MPC 与 lat LQR 生效。
17. **`lon_plus` 的 `pit_forward_param.pb.txt` / `pit_backward_param.pb.txt` 文件存在但未在 `params_pipeline.pb.txt` 中声明**，而 `ChooseCurrentParam`（`lon_plus_controller.cc:232-236`）在 CheckInPit 命中时会请求它们 → `SetCurrentParam` 找不到 → `CONTROL_COMPUTE_ERROR`（`:336-339`）**纵向控制失效**。目前 `use_check_pit` 默认 false 未暴露。
18. **`lon_plus` 标定表切换检测不可靠**：`lon_plus_controller.cc:346-350` 用 `calibration_size()` 变化判断表是否切换，而三张表同源同 size → **永不触发重建**。
19. **`slope_offset_threhold` 在 anti_slip 主 conf 中为 0.0**（`conf/controller_conf.pb.txt:3`，**拼写也是错的**），意味着任何 pitch 都会进防溜坡流程（实际生效的是 `params_pipeline` 里的 0.5）。
20. **MPC 的 `matrix_r` 不校验 size**（`mpc_controller.cc:252-255`），conf 给超过 2 个元素会越界写（对比 `:257-267` 的 q 有严格校验）。
21. **lat 的 `matrix_q` 长度必须等于 `4 + preview_window`** —— 改 `preview_window` 忘改 q 长度会 Init 失败。MPC 的 `matrix_q` 长度必须严格为 6。
22. **多参数集加载要显式传类名字符串**：如 `lon_plus_controller.cc:146-147` 硬编码 `"apollo::control::LonPlusController"`，重构类名时编译器不报错、只会运行时加载失败。

### 7.3 实现缺陷

23. **MPC 前馈补偿链恒为 0**：`control_gain` / `addition_gain`（`mpc_controller.cc:436-440`）与 `matrix_k_`（`:246`）初始化为零后从未赋值 → `unconstrained_control`（`:488-491`）与 `steer_angle_ff_compensation`（`:492-516`）恒 0。
24. **MPC 的 `matrix_cd_` 未进 QP**：`:762-764` 算了曲率扰动但 `:473-477` 的 MpcOsqp 构造参数没有它。
25. **MPC 单位混用**：`:610` 用加速度阈值 `FLAGS_max_acceleration_when_stopped`（0.01 m/s²）判断 `|path_remain|`（米）。
26. **MPC 重复滤波**：`:555` 与 `:559` 对 `steer_angle` 连续两次 `digital_filter_.Filter()`。
27. **MPC 查表未取绝对值**（`:650, :653`，与 `LonController:482, :492` 不同），倒车时速度为负会被插值器端点截断；且倒档标定表查询无符号翻转（`:660`）。
28. **`MpcOsqp` 每周期全量重建 workspace**（`mpc_osqp.cc:307-337`），配 `max_iteration: 3000` 在 10ms 周期内有超时风险。
29. **`CheckPit` 函数级 static 状态共享**（`check_pit.cc:26`），被前进/倒档两个调用点及所有实例共享；首参 `debug` 未使用；`:49` 用 `abs()` 而非 `std::fabs()`。
30. **anti_slip pitch 滤波器配而不用**：Init 配了 `digital_filter_pitch_angle_`（`:58, :584-588`）但 `:187` 直接取原始 `vehicle_state()->pitch()`。
31. **anti_slip 时间步硬编码 0.02**（`:692, :695`），与 `ts: 0.01` 不符。
32. **anti_slip 大量死代码**：`slope_pitch_acc_gain_scheduler`（conf 配了 11 档）对应的 `slope_pitch_acc_interpolation_`（`.h:152`）从未初始化；`ResetHillUpStop`（`.h:129`）只声明无定义；`uphill_fullstop_*` / `kill_downhill_brake_rate` / `min_hill_start_station_remain` / `release_end_brake_speed` / `min_throttle_time_window` / `downhill_brake_change` 均无引用。
33. **replan safety flag 可能永久置位**：`replan_control_task.cc:59` 用 `CopyFrom` 累积到成员，`has_safety_mode_trigger_time()` 一旦为真不自动清除。
34. **demo_control_task 除零产 NaN**：`:62-67` 在 `a==0` 时 `a/abs(a)` = NaN 并写入 `cmd->set_acceleration()`；同处用 `abs()` 而非 `std::fabs()`。**作为模板不要照抄这段逻辑。**
35. **PIDBC 的 ki 位置不一致**：`pid_BC_controller.cc:45` 假想输出含 `error·dt·ki_`，但 `:56` 积分累加是 `error·dt`（无 ki），而 `:60-62` 注释写 "Ki already applied"。
36. **死代码清单**：`control_component.h:86` 的 `CheckPad()` 无定义；`OnMonitor`（`:177-185`）生产路径无调用者；`ControlTask::Stop()` 从不被调；`preprocessor.proto` 的 `estop`/`estop_reason` 字段从不被写（实际靠 `header.status.error_code` 传）；4 个 `*_conf_file` flag 零引用；`ControlComponentDebug` 的 `vehicle_pitch`/`process_control_time_diff`/`process_control_exceeded` 三字段无人填充；`HysteresisFilter` 与 `PIDBC`/`PIDIC` 无生产调用。
37. **`tools/control_tester.cc` 每帧发同一份静态数据、header 时间戳不更新** —— 配合 `enable_input_timestamp_check=true` 会立刻判超时。
38. **`modules/tools/vehicle_calibration/result2pb.py:23-24` import 路径过时**（`from modules.control.proto import calibration_table_pb2` / `control_conf_pb2`），已现场核对，现在直接跑会 ImportError。
39. **拼写已固化不能"纠正"**：`control_interative_topic`（少一个 c）、`Set_pervious_control_command`、`slope_offset_threhold`、`standstill_narmal_acceleration`、`message calibration_table`（消息名小写，外部依赖改不了）。

## 8. prediction 已知高危坑

40. **evaluator / predictor 都不是插件**，是编译期 switch 工厂。新增必须改 `evaluator_manager.cc: CreateEvaluator` / `predictor_manager.cc: CreatePredictor`，**漏了会静默返回 nullptr**。
41. **`ModelManager::SelectModel` 找不到 key 时 `ACHECK(false)` 直接中止**（`model_manager.cc:110`），不是返回 nullptr —— conf 的 `evaluator_model_conf` 必须与 evaluator 请求的 (type, obstacle_type, backend) 三元组严格对齐。
42. **`ModelManager` 的 `priority()==0` 语义是"仅 aarch64 可用"**（`:46-51`），而排序是 priority 升序取首（`:62/:112`），所以 priority 0 在 arm 上会**优先于**所有 priority≥1 的实现。
43. **`evaluator_manager.cc:173-180` 的 PEDESTRIAN case 存在 switch fallthrough**：非 CAUTION 且非 offline 的行人配置会穿透去改写 `default_on_lane_evaluator_`；`:342-359` 的 `EvaluateObstacle` 同样会 fallthrough。
44. **`vehicle_default_caution_evaluator_`（`evaluator_manager.h:125`）无 conf 路径可覆盖**，永远是 SEMANTIC_LSTM；而 `FLAGS_enable_multi_agent_pedestrian_evaluator=true`（默认）时 SEMANTIC_LSTM 根本没注册（`:109-111`），走到 `:290` 会拿 nullptr 并在 `:292` 的 `CHECK_NOTNULL` 崩溃。默认配置下因 `:278-281` 提前 break 而不触发。
45. **`AssignIgnoreLevel` 无条件重写所有 priority**（`obstacles_prioritizer.cc:161-167`），必须在 `AssignCautionLevel` 之前；`BuildLaneGraph` 也必须在 caution 判定之前。**调整 `ContainerProcess` 顺序会静默破坏优先级逻辑。**
46. **`caution_obs_max_nums`=6 是重模型算力的硬闸门**，改预测性能优先看它，其次 `road_graph_max_search_horizon`(20) 与 `max_num_current_lane`/`max_num_nearby_lane`。
47. **`max_num_lane_point`(20) 与模型输入维度耦合** —— 改它必须同步改模型。
48. **evaluator 与 predictor 必须语义配对**：输出 `predicted_trajectory` 的搭 EXTRAPOLATION，输出 `lane_sequence.probability` 的搭 LANE_SEQUENCE / MOVE_SEQUENCE。配错会让 predictor 空跑或降级。
49. **多条轨迹的 probability 之和不保证为 1**（evaluator 直传路径不归一化）；JunctionPredictor 与 InteractionPredictor 输出的 probability 保持默认 **0**。
50. **`InteractionPredictor` 的 `smallest_cost` 未在 lane_sequence 循环内重置**（`interaction_predictor.cc:70`），使 likelihood 退化成常数、后验等于归一化后的 prior —— 调那 5 个代价权重当前对最终概率影响有限。
51. **`Obstacle::GeneratePredictionObstacle()` 是空壳**（`obstacle.cc:1494-1498`，仅 TODO）。
52. **`conf/offline_prediction.conf` 已腐化**：`:7` 写 `--noprediction_offline_mode`、`:14` 又写 `=true`，而该 flag 是 int32。跑离线模式请显式写数字。
53. **`testdata/prediction_conf.pb.txt` 已腐化**：行人配 `REGIONAL_PREDICTOR`（`:12-15`），工厂无对应 case → nullptr → 测试里行人无预测轨迹。
54. **`PredictorSubmodule::Name()` 错误返回 `FLAGS_evaluator_submodule_name`**（`predictor_submodule.cc:34`）。
55. **死代码**：`RegionalPredictor` / `RNN_EVALUATOR` / `PEDESTRIAN_INTERACTION_EVALUATOR` / `network/rnn_model`；`JUNCTION_PREDICTOR` / `SINGLE_LANE_PREDICTOR` / `INTERACTION_PREDICTOR` 已注册但默认 conf 不选中。
56. **VectorNet 的 `attr`/`bound` 是序数编码而非 one-hot**（`vector_net.cc:97`），模型对地图元素类型的语义假设是有序的（`vector_net.h:72` 的 TODO 已标注）。
57. **硬编码不可配置**：`RightOfWay::Analyze` 搜索距离 50.0m（`right_of_way.cc:143`）、`JunctionAnalyzer::GetJunctionExits` BFS 层数 6（`junction_analyzer.cc:86`）、`BuildLaneGraphFromLeftToRight` 搜索距离 50.0*0.95（`obstacle.cc:999`）。
58. **`FLAGS_defualt_junction_range` 源码拼写错误**（`prediction_gflags.cc:287`），grep 时注意。
59. **`slow_obstacle_speed_threshold` 默认 2.0 但 conf 覆盖为 3.1**（`prediction.conf:22`），`IsSlow()` 直接决定 caution 通道是否生效 —— 调它会大范围改变重模型的调用对象。

## 9. 插件机制对比（避免张冠李戴）

| 机制 | 注册方式 | 查找键 | 失败表现 | control/prediction 中的使用方 |
|---|---|---|---|---|
| cyber PluginManager | 运行期从 `plugins.xml` 索引 dlopen `.so` + `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN` | **全限定类名** | `CreateInstance` 返回 nullptr（control 不判空 → 段错误） | control 的 9 个 ControlTask、prediction 的模型后端 `ModelBase` |
| 编译期 switch 工厂 | 改 manager 源码的 switch | 枚举值 | **静默返回 nullptr** | prediction 的全部 evaluator / predictor |

`apollo_plugin` 规则在 `tools/apollo_package.bzl:647-678`：缺 `description` 或 name 不是 `lib*.so` 会直接 fail（`:648-652`）；会自动生成 `cyber_plugin_description` + `alwayslink` 库 + `linkshared` so，并生成 `:<name>_lib` 供单测链接。**BUILD 缺 `alwayslink` 会让注册符号被链接器丢弃** —— 用 `apollo_plugin` 就不用手动加。





