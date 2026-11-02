# 09 conf 与 gflags 体系

<!--
file: references/manual/12_planning源码/09_conf与gflags体系.md
scope: 11.0（默认）
tags: planning.conf, gflags, planning_gflags, flagfile, global_flagfile, planning_config.pb.txt, traffic_rule_config, public_road_planner_config, pipeline.pb.txt, scenario_conf.pb.txt, default_conf.pb.txt, TransformToPathName, LoadMergedConfig, GetPluginConfPath, GetFilePathWithEnv, APOLLO_CONF_PATH, profile 覆盖层, readlink, 优先级
sources:
- /apollo_workspace/profiles/current/modules/planning/planning_component/conf/planning.conf（全 62 行）
- /opt/apollo/neo/src/modules/planning/planning_base/gflags/planning_gflags.cc（1–70、92–105、173–182、216–221、303–310 精读）
- /opt/apollo/neo/src/modules/planning/planning_base/common/util/config_util.cc（18–43 精读，全文 43 行）
- /opt/apollo/neo/include/modules/planning/planning_base/common/util/config_util.h（全 114 行）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/task_base/task.h（全 73 行）
- /opt/apollo/neo/include/modules/planning/planning_interface_base/planner_base/planner.h（80–101 精读）
- /opt/apollo/neo/src/cyber/plugin_manager/plugin_manager.h（158–224 精读）
- /opt/apollo/neo/src/cyber/common/file.h（258–275 精读）
- /opt/apollo/neo/src/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt（全 119 行）
- /opt/apollo/neo/src/modules/planning/scenarios/large_curvature/conf/pipeline.pb.txt（全 29 行）
- /apollo_workspace/.manual_work/inventory/planning_inventory.md（引其 §1.1/§4）；../11_cyber框架/02_dag_launch与conf查找.md（引其 §2.4/§3.1/§3.2）
-->

## 0. 一句话作用

planning 的参数分四层载体：**① 组件级 conf**（`planning_config.pb.txt`，proto，dag 的 `config_file_path`）、
**② 进程级 gflags**（`planning.conf`，纯文本 flag 列表，dag 的 `flag_file_path`，第 1 行 `--flagfile` 串联全局
`global_flagfile.txt`）、**③ 注册清单 conf**（`public_road_planner_config.pb.txt` / `traffic_rule_config.pb.txt`，
顺序即优先级）、**④ 插件实例级 conf**（scenario 的 `scenario_conf.pb.txt`+`pipeline.pb.txt`、stage 子目录、
task 的 `<别名小写>.pb.txt`，与插件包自带的 `conf/default_conf.pb.txt` 合并）。
全部经 `GetFilePathWithEnv(..., "APOLLO_CONF_PATH"=/apollo)` 落到 ④ 层软链，再穿到 **profile 覆盖层**
`/apollo_workspace/profiles/current`（→`ARCF_40P`）或出厂件 `/opt/apollo/neo/share`。
装载链的框架侧见 `../11_cyber框架/02_dag_launch与conf查找.md`，主循环消费侧见 `02_planning_component主循环.md`。

## 1. 关键符号与文件

| 符号/概念 | 文件（绝对路径，层） | 行号(本轮 read 已核) | 说明 |
|---|---|---|---|
| `ConfigUtil::TransformToPathName` | /opt/apollo/neo/src/.../planning_base/common/util/config_util.cc（② src 全） | 26-30 | **只做 `::tolower`**，不做驼峰转下划线 —— 实例级 conf 文件名规则的唯一来源 |
| `ConfigUtil::GetFullPlanningClassName` | 同上 | 32-40 | 无 `::` 时补 `apollo::planning::` 前缀（pipeline 里 `type` 写非限定名即可） |
| `ConfigUtil::LoadMergedConfig` | /opt/apollo/neo/include/.../config_util.h（②′） | 75-93 | 先读 default（失败只 AERROR，不中断:81-83）→ 再读实例 conf，**读不到只 AWARN 并 return true**（:86-89）→ `MergeFrom`（:91） |
| `ConfigUtil::LoadOverridedConfig` | 同上 | 95-111 | 另一套语义：实例 conf 能读就**整份覆盖**，读不到才回落 default |
| `Task::LoadConfig` / `config_path_` / `default_config_path_` | /opt/apollo/neo/include/.../task_base/task.h（②′，**src 侧无此头**） | 66-70 / 61-63 | task 走 `LoadMergedConfig(default_config_path_, config_path_, ...)`；`Task::Init(config_dir, name, injector)` 声明在 :45-46 |
| `Planner::LoadConfig` | /opt/apollo/neo/include/.../planner_base/planner.h（②′） | 82-96 | 传入 `custom_config_path` 非空则直接用；为空才 `GetPluginConfPath<Planner>(class_name, "conf/planner_config.pb.txt")`（:91-93） |
| `PluginManager::GetPluginClassHomePath` | /opt/apollo/neo/src/cyber/plugin_manager/plugin_manager.h（② src） | 160-189 | plugin home = `dirname(plugins.xml 描述路径)` **去掉前导 `share/`**（:177-183）→ 如 `modules/planning/tasks/pull_over_path` |
| `PluginManager::GetPluginConfPath` | 同上 | 191-208 | `home + "/" + conf_name` 再 `GetFilePathWithEnv(..., "APOLLO_CONF_PATH")`（:203-204）；失败返回未解析的相对路径（:207） |
| `cyber::common::LoadConfig<T>` | /opt/apollo/neo/src/cyber/common/file.h（② src） | 264-275 | **所有 planning conf 的统一入口**：先 `GetFilePathWithEnv(relative_path,"APOLLO_CONF_PATH")`（:269-270），找不到 AERROR 返 false（:271-273） |
| `GetFilePathWithEnv` | /opt/apollo/neo/src/cyber/common/file.cc（② src） | 422-472（**出自 `../11_cyber框架/02_*.md` §2.4，该篇已 read**） | 七步查找，见本文 §2.6 |
| planning gflags 全量 | /opt/apollo/neo/src/.../planning_base/gflags/planning_gflags.cc（② src，558 行） | 见 §2.4 | `DEFINE_*` 206 条（`grep -c '^DEFINE_'`） |
| 同上声明 | 同目录 planning_gflags.h（② src，313 行） | 未 read，**行号待核** | `DECLARE_*` 208 条（`grep -c '^DECLARE_'`，比 .cc 多 2 —— 差因待核） |

## 2. 机制与数据流

### 2.1 四层配置载体总表

| 层 | 载体 | 格式 | 谁读它 | 生效范围 |
|---|---|---|---|---|
| ① 组件级 | `planning_config.pb.txt` | proto text (`PlanningConfig`) | `PlanningComponent::Init` 经 dag `config_file_path` | topic 名、`learning_mode`、`pnc_map_class` |
| ② 进程级 | `planning.conf`（+ `--flagfile` 串的 `global_flagfile.txt`） | gflags 文本 | `ComponentBase::LoadConfigFiles` → `SetCommandLineOption("flagfile",…)`，**在 `Init()` 之前** | 全进程 `FLAGS_*` |
| ③ 注册清单 | `public_road_planner_config.pb.txt`、`traffic_rule_config.pb.txt` | proto text | `ScenarioManager` / `TrafficDecider` | 哪些 scenario/rule 启用 + **顺序=优先级** |
| ④ 实例级 | `scenario_conf.pb.txt`、`pipeline.pb.txt`、`<stage小写>/<task别名小写>.pb.txt`、插件包 `conf/default_conf.pb.txt` | proto text | 各插件 `LoadConfig` | 单个 scenario/stage/task 实例 |

### 2.2 ④ 层 `planning_component/conf/` 全 11 个文件的生效落点（2026-09-08 `ls -la` + `readlink -f`）

`/apollo/modules/planning/planning_component/conf/` 是真目录，**每个文件都是软链**：

| 文件 | 生效落点 | 作用 |
|---|---|---|
| `planning.conf` | **profile**（ARCF_40P） | ② 进程级 gflags 主档，dag `flag_file_path` 指它 |
| `planning_config.pb.txt` | **profile** | ① 组件级 proto，dag `config_file_path` 指它 |
| `public_road_planner_config.pb.txt` | **profile** | ③ scenario 注册清单（13 条，顺序=优先级，见盘点 §4.1） |
| `traffic_rule_config.pb.txt` | **profile** | ③ traffic_rule 注册清单（11 条全注册，顺序=执行序，见盘点 §4.2） |
| `discrete_points_smoother_config.pb.txt` | **profile** | 参考线平滑器参数；`planning.conf:14` 显式指向它 |
| `planner_open_space_config.pb.txt` | **profile** | openspace 规划器参数（泊车） |
| `qp_spline_smoother_config.pb.txt` | share（出厂） | 另两种平滑器；`planning.conf:13` 已注释 |
| `spiral_smoother_config.pb.txt` | share | 同上，`planning.conf:12` 已注释 |
| `planning_semantic_map_config.pb.txt` | share | learning_based 语义地图（`learning_mode: NO_LEARNING` 下不走） |
| `navi_planner_config.pb.txt` | share | **孤儿**：navi planner 插件 lib 路径错配，改了没效果（盘点 §6） |
| `planning_navi.conf` | share | 同上孤儿（配 `planning_navi.dag`，无 launch） |

规律：**调过参的都已迁到 profile 层，没动过的还挂出厂链**。判定方式只有 `readlink`，别按文件名猜。
planning 整棵子树 `find /apollo/modules/planning -type l` = **127 条指向 profile / 285 条指向 share**。

### 2.3 生效 `planning.conf` vs 出厂 share 版（`diff` 实测，profile 62 行 / share 34 行，两者末行均无换行）

profile 版（**这才是生效档**）read 已核的要点：`:1 --flagfile=/apollo/modules/common/data/global_flagfile.txt`
（**唯一的全局串联点**，先加载全局再被本文件后续行覆盖）。

| flag | 出厂 share | 生效 profile | 备注 |
|---|---|---|---|
| `--traffic_rule_config_filename` | `modules/planning/...`（**相对**） | `/apollo/modules/...`（绝对，:2） | 绝对路径行为可预期，照抄这个习惯 |
| `--planning_upper_speed_limit` | 20.00 | **10.0**（:3） | 规划全局上限，m/s |
| `--default_cruise_speed` | 11.18 | **10.0**（:4） | 巡航速度 |
| `--speed_bump_speed_limit` | `# ...=3`（注释掉） | **1.5**（:16） | 减速带限速；出厂被注释=用 .cc 默认 4.4704 |
| `--obstacle_lat_buffer` | 未写 | **0.7**（:25） | .cc 默认 0.4 |
| `--min_stop_distance_obstacle` / `--static_obstacle_nudge_l_buffer` | 未写 | 1.5 / 0.6（:26-27） | 新增项 |
| `--nonstatic_obstacle_nudge_l_buffer` | 0.4 | **0.15**（:33） | 动态障碍绕行横向 buffer |
| `--longitudinal_jerk_{lower,upper}_bound` | 未写 | -10 / 10（:22-23） | 新增项 |
| `--use_s_curve_speed_smooth` | `--nouse_s_curve_speed_smooth` | **开启**（:30） | 布尔取反 |
| openspace 一整段（`--open_space_max_forward_v=0.3` 等 11 项，:45-55）、`--enable_reference_line_provider_thread=false`（:57）、`--enable_smooth_reference_line` 等 4 项（:59-62）、`--replan_time_threshold=7.0`（:39）、`--yield_distance=1.0`（:42） | 全部**没有** | profile 新增 | 本车（低速园区车）调参主战场 |

`--smoother_config_filename`：profile `:12-13` 把 spiral / qp_spline 两行注释掉，`:14` 生效 discrete_points。
**profile 与 share 都不写 `--map_dir`** —— 生效值只认 `global_flagfile.txt` 最后一行（见 `../11_cyber框架/02_*.md` §3.2）。

### 2.4 gflags：定义在 `.cc`、声明在 `.h`，**必须同时改**

`planning_gflags.cc` 本轮 read 到的代表值（未被 conf 覆盖时就是这些）：

| flag | .cc 行 | 默认值 | 生效 profile conf 覆盖为 |
|---|---|---|---|
| `planning_loop_rate` | 21 | 10 | 未覆盖 |
| `traffic_rule_config_filename` | 34-37 | 相对 `modules/planning/planning_component/conf/traffic_rule_config.pb.txt` | 绝对 `/apollo/...`（conf:2） |
| `smoother_config_filename` | 39-42 | 绝对 `.../qp_spline_smoother_config.pb.txt` | discrete_points 版（conf:14） |
| `planner_config_path` | 55-58 | 相对 `.../public_road_planner_config.pb.txt` | 未覆盖 |
| `publish_estop` / `enable_trajectory_stitcher` | 60 / 61 | false / true | 未覆盖 |
| `enable_reference_line_stitching` | 63-65 | **true** | **false**（conf:15） |
| `planning_upper_speed_limit` | 95-96 | **31.3** | 10.0（conf:3） |
| `obstacle_lat_buffer` / `obstacle_lon_start_buffer` / `_lon_end_buffer` | 175-176 / 177-179 / 180-182 | 0.4 / 3.0 / 2.0 | 0.7（conf:25）/ 0.4（conf:40）/ 未覆盖 |
| `default_cruise_speed` | 218 | **5.0**（注意归在 `/// Lattice Planner` 段 :216 下，但被 public_road 链路广泛使用） | 10.0（conf:4） |
| `speed_bump_speed_limit` | 305-307 | **4.4704**（10 mph） | 1.5（conf:16） |
| `default_city_road_speed_limit` | 308-309 | 15.67（35 mph） | 未覆盖 |

**加一个新 flag 必须两处同改**：`planning_gflags.cc` 写 `DEFINE_<type>(name, default, "help");`，
`planning_gflags.h` 写对应 `DECLARE_<type>(name);`。只改 `.cc` → 其他 TU 引用 `FLAGS_xxx` 编译期未声明报错；
只改 `.h` → 链接期 undefined symbol。改完必须 `buildtool build -p`（`planning_base` 需先 `buildtool install planning`
—— 盘点 §1 记录本车 ① 层**没有** `planning_base`）。**运行期只想改值不要动代码**：直接在 `planning.conf` 加一行。

### 2.5 实例级 conf 三层规则（scenario → stage → task）

结构（以 pull_over 为例，`find` + `pipeline.pb.txt` read 核）：

```
modules/planning/scenarios/pull_over/conf/
├── scenario_conf.pb.txt                 # scenario 自身参数（Scenario::LoadConfig 读 config_path_）
├── pipeline.pb.txt                      # 该 scenario 的 stage 列表 + 每个 stage 的 task 列表与顺序
├── pull_over_approach/                  # ← stage 的 name 小写
│   └── pull_over_path.pb.txt            # ← task 的 name(别名) 小写
├── pull_over_retry_approach_parking/
│   └── open_space_pre_stop_decider.pb.txt
└── pull_over_retry_parking/
    ├── open_space_roi_decider.pb.txt
    └── open_space_trajectory_partition.pb.txt
```

对应 `pull_over/conf/pipeline.pb.txt`（read 全 119 行）：`stage.name="PULL_OVER_APPROACH"`（:2）而
`stage.type="PullOverStageApproach"`（:3）→ 目录名是 `pull_over_approach`，**取的是 `name` 不是 `type`**
（`type` 小写会是 `pulloverstageapproach`）。task 同理：`task.name="PULL_OVER_PATH"`（:6）/
`type="PullOverPath"`（:7）→ 文件 `pull_over_path.pb.txt`。
`large_curvature/conf/pipeline.pb.txt`（read 全 29 行）是更硬的证据：`stage.name="LARGE_CURVATURE"`（:2）、
`type="StageLargeCurvature"`（:3）→ 目录实测就叫 `large_curvature/`。

三条命名铁律（依据 `TransformToPathName` 只做 tolower，config_util.cc:26-30）：

1. **stage 子目录 = `stage.name` 全小写**（不转下划线、不用 type）。
2. **task conf 文件 = `task.name` 全小写 + `.pb.txt`**（同一个 task 类在同 pipeline 里出现两次、别名不同时，
   conf 也就是两份不同文件 —— pull_over 里 `SPEED_BOUNDS_PRIORI_DECIDER` 与 `SPEED_BOUNDS_FINAL_DECIDER`
   都是 `SpeedBoundsDecider`（:26-27、:38-39），实例 conf 名各自独立）。
3. **实例 conf 缺失不是错误**：`LoadMergedConfig`（config_util.h:86-89）读不到只 AWARN + `return true`，
   静默用插件包自带 `conf/default_conf.pb.txt`。本车 35 个 task 里 33 个有 `conf/default_conf.pb.txt`
   （盘点 §1.3），而 stage 级实例 conf 全仓只有 **41 个文件**（`find` 计数）—— 绝大多数 task 跑的是 default。

> `Task::Init` / `Stage::Init` 的**实现 .cc 不在 `src` 也不在 `include`**（`planning_interface_base` 是纯 binary
> 包，盘点 §2），所以「`config_path_ = config_dir + "/" + stage小写 + "/" + task别名小写 + ".pb.txt"`」这一句
> 拼装代码本轮**无法 read 到，标为「目录树+pipeline 逐条对应验证过的推断」，行号待核**。

插件包自带 default 的解析链（已 read）：`GetPluginClassHomePath` 取 plugins.xml 所在目录去掉 `share/` 前缀
（plugin_manager.h:177-183）→ `modules/planning/tasks/pull_over_path` → `GetPluginConfPath(...,"conf/default_conf.pb.txt")`
（:201-204）→ `GetFilePathWithEnv(..., APOLLO_CONF_PATH=/apollo)` → 实际读
`/apollo/modules/planning/tasks/pull_over_path/conf/default_conf.pb.txt`（实测该软链指向 **profile 层**）。
planner 特殊：`on_lane_planning.cc:159` 传的是 `FLAGS_planner_config_path`（非空），所以 public_road 读的是
`planning_component/conf/public_road_planner_config.pb.txt`，**插件包里的 `planners/public_road/conf/planner_config.pb.txt` 走不到**
（只有 gflag 置空才会用，planner.h:86-93）。

### 2.6 优先级链（两条独立的链，别混）

**A. flag 值链**（后者覆盖前者）：

```
planning_gflags.cc 的 DEFINE_* 默认值
  └─< global_flagfile.txt（由 planning.conf:1 的 --flagfile 引入）
       └─< planning.conf 的第 2..62 行（同一文件内后行覆盖前行）
            └─< mainboard 命令行 --xxx（最高，本机 launch 未用）
```
dag 的 `flag_file_path` 决定「读哪个 conf」；`ComponentBase::LoadConfigFiles` 在用户 `Init()` **之前**
`SetCommandLineOption("flagfile",…)`（行号见 `../11_cyber框架/02_*.md` §1/§3.2）。

**B. conf 文件路径查找链**（`GetFilePathWithEnv`，`../11_cyber框架/02_*.md` §2.4 已核 file.cc:422-472）：

1. 空 → false ｜ 2. **绝对路径直接用** ｜ 3. CWD 下存在 → 先记 fallback ｜
4. **以 `.` 开头（`./x`、`../x`）立即返回，整段 env 搜索被跳过** ｜ 5. env 未设 → AWARN + fallback ｜
6. env 按 `:` 拆前缀逐个试，**首个命中即返回** ｜ 7. 全不中 → 返回 CWD fallback。

即 **绝对路径 > env 前缀（`APOLLO_CONF_PATH=/apollo`，本机只有 1 个前缀）> CWD**。
planning 所有实例级 conf 都走 6（相对 `modules/planning/...` + `/apollo` 前缀），
`planning.conf` 里的路径全写成绝对 `/apollo/...` 走 2。

**C. 顺序即优先级**（③ 层）：`public_road_planner_config.pb.txt` 的 scenario 书写顺序 = first-match 优先级
（无 cost/score 字段，排在 `LANE_FOLLOW` 之后等于没注册）；`traffic_rule_config.pb.txt` 顺序 = 执行顺序；
`pipeline.pb.txt` 的 `task` 顺序 = 同 stage 内执行顺序，`stage.enabled: false`（如 pull_over:53）= 该 stage 跳过。

## 3. 注册与配置速查

| 想改的东西 | 文件（④ 层入口） | 需要重编？ |
|---|---|---|
| 限速 / 巡航速度 / buffer 等数值 | `/apollo/modules/planning/planning_component/conf/planning.conf` | 否，重启 planning |
| 启用/禁用某 scenario、改优先级 | 同目录 `public_road_planner_config.pb.txt` | 否 |
| 启用/禁用某 traffic_rule、改执行序 | 同目录 `traffic_rule_config.pb.txt` | 否 |
| 某 scenario 的 stage/task 流水线 | `/apollo/modules/planning/scenarios/<sc>/conf/pipeline.pb.txt` | 否 |
| 某 scenario 自身阈值 | 同目录 `scenario_conf.pb.txt` | 否 |
| 某 task 在**特定 stage** 里的参数 | `.../scenarios/<sc>/conf/<stage.name小写>/<task.name小写>.pb.txt`（不存在就新建） | 否 |
| 某 task 的**全局默认**参数 | `/apollo/modules/planning/tasks/<pkg>/conf/default_conf.pb.txt` | 否 |
| topic 名 / `pnc_map_class` / learning_mode | `.../planning_component/conf/planning_config.pb.txt` | 否 |
| 新增一个 flag | `planning_gflags.cc` + `planning_gflags.h`（工作区副本） | **是** |
| 新增 conf 字段 | 对应包 `proto/*.proto` | **是** |

## 4. 修改与扩展点（二次开发）

1. **只调参、当场生效**：改 ④ 层软链文件（如 `/apollo/modules/planning/planning_component/conf/planning.conf`），
   写穿到 `readlink -f` 显示的落点。落 profile 层 → 下次 `buildtool build` install **不会**被覆盖；落 share 层 → 会被覆盖。
   改完 `cyber_launch stop/start .../planning.launch` 或重跑 `mainboard -d .../planning.dag`。
2. **要进版本管理**：改 `/apollo_workspace/modules/planning/<pkg>/conf/...`（① 层，本车已 install 8 个 planning 包）
   然后 `buildtool build -p modules/planning/<pkg>` 完成 install；**不重编绝不生效**。
   另一条正路是 `aem profile` 管理 `/apollo_workspace/profiles/<名字>/`，整包带走调参结果。
3. **加新 flag**：`buildtool install planning`（若要改 `planning_base` 需确认已装，盘点 §7.8 记录本车缺）
   → 改 `modules/planning/planning_base/gflags/planning_gflags.{cc,h}` → `buildtool build -p modules/planning/planning_base`
   → 在 `planning.conf` 里写一行赋值。
4. **给某 task 加一个实例级 conf**：先在 `pipeline.pb.txt` 查该 task 的 `name` 别名 → 在
   `scenarios/<sc>/conf/<stage.name小写>/` 下建 `<别名小写>.pb.txt`，只写要覆盖的字段（其余从
   `default_conf.pb.txt` merge 而来，config_util.h:75-93）。**注意是 `MergeFrom` 语义**：repeated 字段是
   **追加不是替换**，要清空只能改 default。

## 5. ⚠️ 本环境注意

1. **改出厂 share 件不生效**：`planning.conf`、`planning_config.pb.txt`、两个注册清单等 6 个文件的 ④ 软链
   已指向 **profile 层**（`/apollo_workspace/profiles/current` → `ARCF_40P`），去
   `/opt/apollo/neo/share/.../conf/planning.conf` 改数值**不会被读到**。CLAUDE.md 三节②「④ 层每个文件都指向 share」
   **已过期**（2026-09-08 实测：planning 子树 127 profile / 285 share）。改前一律 `readlink -f`。
2. **改工作区源码 conf 不重编不生效**：`/apollo_workspace/modules/planning/.../conf/*` 只是源码副本，
   运行时读的是 `/apollo` → profile/share；必须 `buildtool build -p` 完成 install。`bazel build` 不算。
3. **conf 字段名/文件名写错静默降级**：`LoadMergedConfig` 读不到实例 conf 只 AWARN 就 `return true`
   （config_util.h:86-89），行为看起来「参数没生效」而不是报错。**实测存在孤儿 conf**：
   `scenarios/large_curvature/conf/large_curvature/` 下的 `open_space_trajectory_optimizer.pb.txt` 与
   `open_space_rt_optimizer.pb.txt` 两个文件，在该 scenario 的 pipeline 里**没有任何同名 task 别名**
   （pipeline.pb.txt:18 的别名是 `OPEN_SPACE_TRAJECTORY_OPTIMIZER_PARK`）→ 这两份 conf 永远不会被加载。
   改 task 参数前先用 pipeline 的 `name` 字段对一遍文件名。
4. **`grep -R` 而不是 `-r`**：④ 层全是软链，`-r` 不跟随，搜 `/apollo/modules/planning` 会假空，
   容易误判「这个 flag/字段没人用」。
5. **相对路径 flag 的隐患**：出厂 `--traffic_rule_config_filename` 是相对路径，能否找到取决于
   `APOLLO_CONF_PATH` 与进程 CWD；以 `./` 开头的路径会**整段跳过 env 搜索**（file.cc:439-442，
   引 `../11_cyber框架/02_*.md`）。profile 版已改成绝对 `/apollo/...`，新增 flag 照这个写。
   另：`--map_dir` 不要写进任何 planning conf（会盖掉 dreamview 选图结果）。

## 6. 验证命令（本环境实测）

```bash
# 认清生效档（改任何 conf 前必做）
ls -la /apollo/modules/planning/planning_component/conf/
readlink -f /apollo/modules/planning/planning_component/conf/planning.conf
readlink /apollo_workspace/profiles/current                  # → /apollo_workspace/profiles/ARCF_40P

# 生效档 vs 出厂档差异
diff /opt/apollo/neo/share/modules/planning/planning_component/conf/planning.conf \
     /apollo_workspace/profiles/current/modules/planning/planning_component/conf/planning.conf

# planning 子树软链落点统计
find /apollo/modules/planning -type l -printf '%l\n' \
  | sed 's|.*profiles/current.*|PROFILE|; s|.*neo/share.*|SHARE|' | sort | uniq -c

# 某 flag 的默认值出处（.cc 定义 / .h 声明必须成对）
grep -n 'default_cruise_speed' /opt/apollo/neo/src/modules/planning/planning_base/gflags/planning_gflags.{cc,h}

# 实例级 conf 全景（stage 级 41 个）
find /opt/apollo/neo/share/modules/planning/scenarios -path '*/conf/*/*' -name '*.pb.txt' | sort
# 校验某 scenario 的 stage 目录名/task 文件名是否与 pipeline 别名一致
cat /apollo/modules/planning/scenarios/pull_over/conf/pipeline.pb.txt

# 运行期确认到底读了哪些 conf（LoadConfig 会打 "load conf file: <绝对路径>"，file.h:275）
grep -R 'load conf file\|use flag file\|use config file' /apollo/data/log/ | tail -30
```

## 7. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线 Apollo 11.0.0 package 工作区，profile = `ARCF_40P`。
- **本轮 read 打开核对过的文件**（本文所有行号均出自这些）：profile `planning.conf`（全 62）；
  `planning_gflags.cc`（1-70、92-105、173-182、216-221、303-310）；`config_util.cc`（18-43）；
  include `config_util.h`（全 114）；include `task_base/task.h`（全 73）；include `planner_base/planner.h`（80-101）；
  `cyber/plugin_manager/plugin_manager.h`（158-224）；`cyber/common/file.h`（258-275）；
  `scenarios/pull_over/conf/pipeline.pb.txt`（全 119）；`scenarios/large_curvature/conf/pipeline.pb.txt`（全 29）；
  `_template.md`；`11_cyber框架/02_dag_launch与conf查找.md`（全 253）；`.manual_work/inventory/planning_inventory.md`（全 338）。
- 非 read 证据：`ls -la` + `readlink -f`（§2.2 全 11 个文件落点、stage/task conf 软链）；
  `diff` share↔profile planning.conf（§2.3 全表）；`find -printf '%l'` 计数（127/285）；
  `find` 列出 41 个 stage 级实例 conf 与 pull_over/tasks/planners 的 conf 目录内容；
  `grep -c '^DEFINE_'`=206 / `^DECLARE_`=208；`grep -n` 定位 `planning_gflags.h` 的 DECLARE 行、
  `on_lane_planning.cc:159` / `navi_planning.cc:84` 的 `FLAGS_planner_config_path`、`scenario.h`/`stage.h`/`traffic_rule.h`
  的 `config_path_`/`LoadConfig` 存在性。
- **遗留待核**：① `Task::Init`/`Stage::Init` 拼 `config_path_` 的实现代码本轮找不到（`planning_interface_base`
  为纯 binary 包，src/include 两棵树均无 `.cc`）→ §2.5 的路径拼装规则是「目录树 + pipeline 别名逐条对应」推断；
  ② `planning_gflags.h` 未 read，其行号与「DECLARE 比 DEFINE 多 2 条」的原因待核；
  ③ `scenario.h`/`stage.h`/`traffic_rule.h` 只 grep 未 read，故未引其行号；
  ④ `LoadMergedConfig` 与 `LoadOverridedConfig` 分别被哪些插件采用，只核到 task=Merged、
  scenario/traffic_rule/planner=直接 `LoadConfig`，未逐插件普查；
  ⑤ profile 层 openspace 那 11 个 flag 的实际整车效果未跑车验证；
  ⑥ `large_curvature` 两个孤儿 conf 是否为上游改名残留（而非本车 profile 引入）未比对上游。
