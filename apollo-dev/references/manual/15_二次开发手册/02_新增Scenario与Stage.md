# 02 新增 Scenario 与 Stage（11.0 本机可执行全流程）

<!--
file: references/manual/15_二次开发手册/02_新增Scenario与Stage.md
scope: 11.0（默认）；EDU 版口径见 ../pnc_赛事版/01_赛事版开发口径速查.md
tags: buildtool create, planning_scenario, 模板, Scenario, Stage, context.h, ScenarioContext, plugins.xml, plugin_description.xml, pipeline.pb.txt, scenario_conf.pb.txt, next_stage_, LimitCruiseSpeed, ExecuteTaskOnReferenceLine, public_road_planner_config, LANE_FOLLOW, first-match, cyber_plugin_index, buildtool build
sources:
- /opt/apollo/neo/src/modules/planning/scenarios/pull_over/context.h（read，全 33 行）
- <skills>/apollo-dev/references/manual/12_planning源码/04_scenario框架.md（read，全 203 行；框架行号结论直接引用）
- <skills>/apollo-dev/references/manual/12_planning源码/05_stage框架.md（read，全 300 行；同上）
- <skills>/apollo-dev/references/manual/00_versions/01_命令与词汇对照.md（read，全 31 行）
- 本轮实跑/cat 核对但未 read（故不引行号）：`buildtool create --help`；/tmp/sc_ws2/modules/planning/scenarios/my_demo/ 全部 13 个模板产物；pull_over 的 plugins.xml / BUILD / cyberfile.xml / proto/pull_over.proto / conf/scenario_conf.pb.txt / conf 目录树；生效档 profiles/ARCF_40P/.../public_road_planner_config.pb.txt（55 行）；ls /opt/apollo/neo/share/cyber_plugin_index | grep pull_over；ls /apollo_workspace/modules/planning/scenarios（19 个）
-->

## 0. 一句话作用

在本机（Apollo 11.0.0 包工作区）从零加一个 planning scenario 及其 stage，并让 `PublicRoadPlanner` 真的切进去。
框架机制不在本篇重复，见 [04_scenario框架](../12_planning源码/04_scenario框架.md) 与 [05_stage框架](../12_planning源码/05_stage框架.md)；
本篇只讲**动手序列、模板实测产物、核对表、失败模式**。

## 1. 模板实测：`buildtool create --template planning_scenario`

### 1.1 参数（`buildtool create --help` 实跑，buildtool 9.0.0-rc1-r19）

| 参数 | 实测语义 | 踩坑 |
|---|---|---|
| `--template planning_scenario` | 选模板（可选值另有 `component/timer_component/plugin/planning_task/planning_traffic_rule`） | 无 `planning_stage` 模板 |
| `package_path`（位置参数） | 相对工作区根的包路径，如 `modules/planning/scenarios/my_demo` | **必须写在 `--stage` 之前**：`--stage` 是 `nargs='+'`，会吞掉位置参数 → `error: the following arguments are required: package_path`（实跑复现） |
| `--scenario <Name>` | **决定 scenario 类名** = `<Name>Scenario`，文件名 = 其 snake 形式 | 传 `MyDemo` → `MyDemoScenario` / `my_demo_scenario.cc`。**传 UPPER_SNAKE 会被逐字符切开**：实跑 `--scenario DEMO_SCENARIO` → 类名 `DEMOSCENARIOScenario`、文件 `d_e_m_o_s_c_e_n_a_r_i_o_scenario.cc`。**必须传 PascalCase** |
| `--stage A B ...` | 每个值生成一个 stage 类 = `<值>Stage`（自动补 `Stage` 后缀） | 传 `MyApproach` → 类 `MyApproachStage`、文件 `my_approach_stage.{h,cc}`、pipeline 别名 `MY_APPROACH_STAGE` |
| `--class_name` | 对本模板**只影响 proto 消息名** `<class_name>Config`，不改 scenario 类名 | 想改配置消息名用 `--config_message_name` 更直接 |
| 其他 | `--name`（包名，默认 `planning-scenario-<scenario snake 去下划线>`）、`--author/--email/--description`、`--dependencies/--build_dependencies`、`--type` | `--channel_*` 对 scenario 模板无意义 |

`buildtool create` **要求 cwd 在含 `WORKSPACE` 的目录**，否则 `ErrCode.ParamErr / hint: Can not find WORKSPACE`。
本轮为不污染工作区，在 `/tmp/sc_ws2/` 下 `touch WORKSPACE` 后生成样板（工作区未被写入，已 `ls` 确认仍是原 19 个 scenario）。

```bash
mkdir -p /tmp/sc_ws2 && cd /tmp/sc_ws2 && touch WORKSPACE     # 只为看产物；真开发在 /apollo_workspace 下跑
buildtool create modules/planning/scenarios/my_demo \
  --template planning_scenario --scenario MyDemo --stage MyApproach MyCruise
```

### 1.2 模板产物清单（13 个文件，实跑 `find` 全列）

| 产物 | 内容实测 | 是否要改 |
|---|---|---|
| `my_demo_scenario.h` | `struct MyDemoContext : public apollo::planning::ScenarioContext { MyDemoScenarioConfig scenario_config; }` **+** `class MyDemoScenario : public Scenario`（override `Init`/`GetContext`/`IsTransferable`/`Process`，另声明 `Enter`/`Exit` **不带 override**）+ 尾部 `CYBER_PLUGIN_MANAGER_REGISTER_PLUGIN(apollo::planning::MyDemoScenario, apollo::planning::Scenario)` | 填判据、按需拆出 `context.h`（§1.3） |
| `my_demo_scenario.cc` | `Init` 已是三段式（幂等 → `Scenario::Init` → `LoadConfig<MyDemoScenarioConfig>(&context_.scenario_config)`）；`IsTransferable` = `// To be implemented. return false;`；`Process` = `return Scenario::Process(...)`；`Enter/Exit` = `return true` | **必改** `IsTransferable`；`Process` 不需要就删 |
| `<stage>_stage.h` ×N | `class MyApproachStage : public Stage`，override `Process`，私有 `StageResult FinishStage();` + `MyDemoScenarioConfig scenario_config_;` + 注册宏 `(..., apollo::planning::Stage)` | 按需加成员 |
| `<stage>_stage.cc` ×N | `Process` 已含 `CHECK_NOTNULL(frame)` + `scenario_config_.CopyFrom(GetContextAs<MyDemoContext>()->scenario_config)` + `return result.SetStageStatus(StageStatusType::RUNNING);`；`FinishStage` 返回 `StageResult(StageStatusType::FINISHED)` | **必改**：加 `LimitCruiseSpeed` / `ExecuteTaskOnReferenceLine` / `next_stage_` |
| `proto/my_demo_scenario.proto` | `syntax="proto2"; package apollo.planning; message MyDemoScenarioConfig {}` **空消息** | **必改**：加字段 |
| `proto/BUILD` | proto 库目标 | 一般不改 |
| `BUILD` | `filegroup(runtime_files, glob(["conf/**"]))` + `apollo_plugin(name="libmy_demo_scenario.so", srcs=[scenario.cc+各 stage.cc], hdrs=[...], description=":plugin_my_demo_description.xml", deps=[//cyber, planning_base, planning_interface_base, 本包 proto])` + `apollo_package()` + `cpplint()` | 加 stage/util 源文件、加 deps |
| `plugin_my_demo_description.xml` | **注意文件名不是 `plugins.xml`**。内容已是 1 个 `Scenario` class + N 个 `Stage` class，`base_class` 分别 `apollo::planning::Scenario` / `apollo::planning::Stage` | 加 stage 时补 class 行 |
| `cyberfile.xml` | `format="2"`，`<src_path>//modules/planning/scenarios/my_demo</src_path>`，depend：`bazel-extend-tools` + binary `cyber` / `planning-base` / `planning-interface-base` | 改 src_path 必须与目录一致 |
| `conf/scenario_conf.pb.txt` | **0 字节空文件** | 填 proto 字段值 |
| `conf/pipeline.pb.txt` | 每个 stage 一段 `stage{ name:"MY_APPROACH_STAGE" type:"MyApproachStage" enabled:true task{ name:"" type:"" } }`，**task 名是空串** | **必改**：填 task 或删空 task 块 |

**模板不生成**：`context.h`（独立文件）、`util.{h,cc}`、`*_test.cc`、`README_cn.md`、`conf/<stage 别名小写>/` 子目录 —— 对照真实 pull_over 包（22 个文件）少这五类。

### 1.3 与官方样板的三处结构差异（本轮实测，与旧说法冲突处以此为准）

1. **context 结构体模板已生成，只是塞在 `<scenario>.h` 里**，不是独立 `context.h`。旧口径「模板不生成 context 要手加」在 11.0 的 buildtool 9.0.0-rc1-r19 上**不成立**；要与官方包同构（pull_over 用独立 `context.h`，`struct PullOverContext : public ScenarioContext { ScenarioPullOverConfig scenario_config; }`，context.h:28-30，read 已核）则手工拆文件，并把 `context.h` 加进 `BUILD` 的 `hdrs`。**功能上不拆也能编。**
2. **插件描述文件名不同**：模板给 `plugin_<pkg>_description.xml`，官方包一律 `plugins.xml`。**文件名无所谓，`BUILD` 里 `apollo_plugin(description=...)` 指对即可**；但要与官方包保持一致就改名 + 同步改 `description`。
3. **注册宏第二参写法两种都在用**：模板写全限定 `apollo::planning::Scenario`，pull_over 写短名 `Scenario`（04 篇 §3.1 已核 pull_over_scenario.h:58-59）。二者共存于本机，**不要为此改动模板产物**。

## 2. 文件 → 必须写什么（核对表，以 pull_over 为对照样板）

pull_over 包实际文件（`ls -R /opt/apollo/neo/src/modules/planning/scenarios/pull_over/`，② 只读参考层）：
`BUILD` `README_cn.md` `context.h` `cyberfile.xml` `plugins.xml` `pull_over_scenario.{h,cc}` `stage_approach.{h,cc}`
`stage_retry_approach_parking.{h,cc}` `stage_retry_parking.{h,cc}` `util.{h,cc}` 4 个 `*_test.cc` `images/`
`proto/{BUILD,pull_over.proto}` `conf/{pipeline.pb.txt,scenario_conf.pb.txt}` + 3 个 stage 子目录。

| 文件 | 必须写什么（写错的后果） |
|---|---|
| `proto/<name>.proto` | `message Scenario<Name>Config` 各阈值字段（pull_over 是 10 个 `optional double`，全带 `[default=...]`）。**给 default** —— conf 缺项时才有兜底 |
| `conf/scenario_conf.pb.txt` | proto 字段的实际值（pull_over 出厂 8 行，且与 proto default 不完全相同：`max_s_error_to_end_point` proto 0.2 / conf 0.5）。文件名固定，`Scenario::LoadConfig<T>` 只认它（04 篇 §3.2） |
| `context.h`（或 scenario.h 内） | `struct XContext : public ScenarioContext { Scenario<Name>Config scenario_config; }`。stage 侧 `GetContextAs<XContext>()` 是裸 `static_cast`、无类型检查，类型不匹配 = UB（05 篇 stage.h:66-69） |
| `<name>_scenario.h` | `class X : public Scenario`；override `Init` / `GetContext`（**协变返回 `XContext*`**）/ `IsTransferable`；需要每帧前置副作用才 override `Process`；尾部注册宏 |
| `<name>_scenario.cc` | `Init` 三段式；`IsTransferable` 用「一串早退 false + config 阈值」形态（pull_over cc:55-164）；`Enter/Exit` 只用来改 `injector_->planning_context()` 的跨帧状态（pull_over cc:166-178） |
| `stage_<x>.h/.cc` ×N | override `Process`：取 context → `ExecuteTaskOnReferenceLine`（车道内）或 `ExecuteTaskOnOpenSpace`（泊车）→ 需要限速则 `frame->mutable_reference_line_info()->front().LimitCruiseSpeed(v)` **然后重跑一次 `ExecuteTaskOnReferenceLine`**（05 篇 §2.4）→ 返回 `RUNNING` / 设 `next_stage_` 后返回 `FINISHED` / `return FinishScenario()` |
| `plugins.xml`（或 `plugin_*_description.xml`） | 1 个 `<library path="modules/planning/scenarios/<pkg>/lib<pkg>_scenario.so">`，内 **1 条 Scenario class + N 条 Stage class**；属性只有 `type`/`base_class`/`path`（无 `class_type`）。stage **没有自己的 .so、没有自己的索引条目** |
| `BUILD` | 必须 `apollo_plugin`（自带 `alwayslink`）；`srcs` 列全部 `.cc`（漏一个 stage → 该 stage 注册对象不进 .so）；`hdrs` 列全部 `.h`（含 `context.h`）；`description` 指向描述 xml；`filegroup(runtime_files, glob(["conf/**"]))` **决定 conf 是否被 install**，漏了 conf 不落地 |
| `cyberfile.xml` | `<name>` 包名、`<src_path>//modules/planning/scenarios/<pkg>`（必须与目录逐字一致）、`<depend type="binary">planning-interface-base</depend>` |
| `conf/<stage 别名小写>/<task 别名小写>.pb.txt` | 可选。目录名 = **pipeline 里 stage 的 `name` 别名小写**（只 tolower，不做驼峰转下划线，config_util.cc:26-30），文件名 = task 别名小写。失配只 AWARN 静默用 default_conf |

## 3. 从零到生效：11 步

```bash
# 0) 源码副本（本机 19 个 scenario 已在 ① 工作区，无需重装）
ls /apollo_workspace/modules/planning/scenarios/          # 已核：19 个
# 1) 生成骨架（cwd 必须是 /apollo_workspace，含 WORKSPACE）
cd /apollo_workspace && buildtool create modules/planning/scenarios/my_demo \
  --template planning_scenario --scenario MyDemo --stage MyApproach MyCruise
```

2. `proto/my_demo_scenario.proto`：定义 `MyDemoScenarioConfig` 字段（带 `[default=]`）。
3. context：保持模板内联，或拆出 `context.h` 并加进 `BUILD` 的 `hdrs`。
4. `my_demo_scenario.cc`：写 `IsTransferable`（早退 false + 阈值取自 `context_.scenario_config`）；需要跨帧状态就写 `Enter`/`Exit`。
5. 每个 stage 的 `Process`：`GetContextAs<MyDemoContext>()` → 必要时 `LimitCruiseSpeed(v)` → `ExecuteTaskOnReferenceLine(planning_init_point, frame)` → 迁移就 `next_stage_ = "MY_CRUISE_STAGE"`（**pipeline 别名，不是类名**）并返回 `StageResult(StageStatusType::FINISHED)`；结束整个场景 `return FinishScenario()`。
6. `conf/pipeline.pb.txt`：**第一条 stage 就是入口**，其余靠 `next_stage_` 跳（stage 顺序 ≠ 执行顺序）；每个 stage 的 `task{name,type}` 按**执行顺序**书写（task 顺序 = 执行顺序），别名可重复用同一个 `type`。
7. `conf/scenario_conf.pb.txt`：填值（模板是空文件）。
8. 需要 task 实例参数：建 `conf/my_approach_stage/<task 别名小写>.pb.txt`（目录名 = stage 别名小写）。
9. 描述 xml + `BUILD`：class 行、`srcs`/`hdrs`、`description` 三处与实际文件对齐。
10. 编译安装（**只 `bazel build` 运行时看不见**，运行时只读 `/opt/apollo/neo/{lib,share}`）：

```bash
buildtool build -p modules/planning/scenarios/my_demo
ls /opt/apollo/neo/lib/modules/planning/scenarios/my_demo/           # libmy_demo_scenario.so
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep my_demo
```

11. **启用**：编辑 ④ `/apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt`
（本机 `readlink -f` → `/apollo_workspace/profiles/ARCF_40P/modules/planning/planning_component/conf/...`，
**profile 覆盖层，改软链即写穿**），把

```protobuf
scenario {
    name: "MY_DEMO"
    type: "MyDemoScenario"
}
```

**插到 `LANE_FOLLOW` 之前**（生效档 55 行，`LANE_FOLLOW` 是最后一条；`SQUARE` 被 `#` 注释；顺序 = 优先级 first-match）。
然后重启：`mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag`。

## 4. ⚠️ 常见失败（症状 → 原因 → 修法）

| 症状 | 原因 | 修法 |
|---|---|---|
| planning 进程直接 CHECK 崩，起不来 | planner conf 里 `type` 拼错 / 插件没装 / `base_class` 写错 → `CreateInstance` 返回 nullptr，`ScenarioManager::Init` 的 `ACHECK(scenario->Init(...))`（scenario_manager.cc:43-44）崩 | `type` 必须逐字等于 C++ 类名；先 `ls /opt/apollo/neo/share/cyber_plugin_index/ \| grep <pkg>` 确认装了再填 conf |
| stage 卡在第一个不动 | `next_stage_` 填了**类名**（`MyCruiseStage`）而 `stage_pipeline_map_` 是按 pipeline `name` 别名建索引（scenario.h:111） | 改成别名 `"MY_CRUISE_STAGE"` |
| 实例 conf 改了没反应，日志只有 `can not load user defined config file[` | stage 子目录名用了类名或大小写不对：路径规则只 `tolower`（config_util.cc:26-30），别名不带下划线就得不到下划线目录名 | 目录名 = pipeline 里 stage 别名的小写逐字符结果；文件名 = task 别名小写 |
| 场景/stage 死活加载不到（`Class factory objs counts is 0` 或索引无条目） | ① `base_class` 写了中间基类（`BaseStageCreep`/`BaseStageCruise`/`Decider` 等对 PluginManager 不可见）；② `BUILD` 用了手写 `cc_library` 而非 `apollo_plugin`，注册对象被链接器裁掉 | `base_class` 只能是 `apollo::planning::Scenario` / `apollo::planning::Stage`；BUILD 用 `apollo_plugin` 且不手传 `alwayslink` |
| 场景永远不触发，`IsTransferable` 断点/日志都不进 | 在 planner conf 里插到了 `LANE_FOLLOW` 之后。`LaneFollowScenario::IsTransferable` 在 `lane_follow_command` + 参考线非空时**无条件 return true**（lane_follow_scenario.cc:37-40），first-match 立即返回（scenario_manager.cc:66-74） | 上移到 `LANE_FOLLOW` 之前。注意这条只限 lane-follow 类命令；泊车等非 lane_follow_command 时 LANE_FOLLOW 返回 false，后面的场景仍会被问 |
| 改了源码但行为完全不变 | 只 `bazel build`，或只改了 ① `/apollo_workspace/...` 没重装 —— 本环境 `APOLLO_PLUGIN_SEARCH_IN_BAZEL_OUTPUT=0`，索引不扫 `bazel-bin` | `buildtool build -p modules/planning/scenarios/<pkg>` 完成 install 后再起进程 |
| conf 编译后被还原 | `buildtool build` 会重装 conf；本机 conf 生效档在 `profiles/ARCF_40P/`，出厂档在 `/opt/apollo/neo/share/` | 要进版本管理改 ① 源码副本再重编；只调参改 ④ 软链（写穿 profile 层）。`00_versions/01` 表里「本机无 profiles」一行**已过期**，本机确有 `profiles/current → ARCF_40P`（2026-09-08 readlink 实测） |
| `buildtool create` 报 `the following arguments are required: package_path` | `--stage` 吞掉了位置参数 | 把 `package_path` 挪到所有 `--stage` 之前 |
| 生成出 `d_e_m_o_..._scenario.cc` 这种文件名 | `--scenario` 传了 UPPER_SNAKE | 传 PascalCase（`MyDemo`） |

## 5. 验证命令（本轮实跑过的）

```bash
# 模板与参数
buildtool create --help
# 插件是否装进索引与库树（stage 无独立条目，与 scenario 共用一条）
ls /opt/apollo/neo/share/cyber_plugin_index/ | grep -i <pkg>     # 形如 modules__planning__scenarios__pull_over__libpull_over_scenario.so
grep -R 'base_class="apollo::planning::Stage"' /opt/apollo/neo/share/modules/planning/scenarios/<pkg>/*.xml
# 生效档判层（一律 readlink，别假设指向 share）
readlink -f /apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt
readlink -f /apollo/modules/planning/scenarios/<pkg>/conf/pipeline.pb.txt
grep -R -n 'LANE_FOLLOW' /apollo/modules/planning/planning_component/conf/public_road_planner_config.pb.txt
# 跑起来看切换（日志关键字来自 scenario_manager.cc，04 篇已核）
mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag
#   "Load scenario list:"          (cc:50)
#   "switch scenario from X to Y"  (cc:68-69)
#   "Reset to default scenario:"   (cc:82)
#   实例 conf 失配: "can not load user defined config file["
```

搜 ④ `/apollo/...` 一律 `grep -R`（`-r` 不跟随符号链接，会把「没人引用」判成真）。

## 6. 溯源

- 蒸馏日期：2026-09-08（本机 CST）。基线 Apollo 11.0.0 包工作区，buildtool 9.0.0-rc1-r19，`profiles/current → ARCF_40P`。
- **read 工具打开过的文件**：`/opt/apollo/neo/src/modules/planning/scenarios/pull_over/context.h`(1-33)；
  `manual/12_planning源码/04_scenario框架.md`(1-203)、`05_stage框架.md`(1-300)、`manual/00_versions/01_命令与词汇对照.md`(1-31)、`manual/_template.md`(1-56)。
  本篇出现的框架 `文件:行号`（scenario.h / stage.h / scenario_manager.cc / lane_follow_scenario.cc / config_util.cc / pull_over_scenario.cc）
  **均为 04/05 两篇已核结论的引用，本轮未重新打开源码**。
- **本轮实跑 / cat / ls 证据（未 read，故不引行号）**：`buildtool create --help` 全文；两次实跑 `buildtool create --template planning_scenario`
  （`/tmp/sc_ws`、`/tmp/sc_ws2`，含 `--scenario` 大小写差异对照与 argparse 位置参数报错复现）；13 个模板产物全文；
  pull_over 的 `plugins.xml`/`BUILD`/`cyberfile.xml`/`proto/pull_over.proto`/`conf/scenario_conf.pb.txt`/`ls -R` 目录树；
  生效 `public_road_planner_config.pb.txt`（55 行、13 条注册 + `SQUARE` 注释、`LANE_FOLLOW` 末条）；
  `ls /apollo_workspace/modules/planning/scenarios`(19)；`ls /opt/apollo/neo/share/cyber_plugin_index | grep pull_over`。
- **遗留待核项**：① 未实跑 `buildtool build -p` 编译一个新 scenario（未验证模板产物开箱即可编、`plugin_*_description.xml` 命名是否被 install 正常处理）；
  ② 未实跑 planning 进程观察 `switch scenario` 日志（本机地图/planning_command 资产缺失，见 CLAUDE.md 五节）；
  ③ 模板生成的 `Enter`/`Exit` 未写 `override`（是否被基类虚函数正确覆盖需编译核实）；
  ④ `conf/scenario_conf.pb.txt` 为空时 `Scenario::LoadConfig` 是否返回 true 未核（基类实现只在 `.so`）；
  ⑤ 新增 scenario 的 conf 是否需要同步进 `profiles/ARCF_40P/` 才生效未实测（`buildtool build` install 到 share 后，④ 软链是否自动指向新包待核）。
