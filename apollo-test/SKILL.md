---
name: apollo-test
description: Apollo 测试角色主入口。本 skill 直接负责数据包录制（record/bag，按 pnc/vehicle/full profile 选 channel）、通道盘点、模块信号 CSV/PNG/Markdown 报告、回放核验；其余测试能力按意图路由到子 skill：批量跑场景与回归对比（apollo-test-batch）、评分与指标解读（apollo-eval）、缺陷登记与闭环（apollo-defect）、运行时排障（apollo-debug）、跑单测/lint/编译（apollo-build-test）、开跑前环境检查（apollo-env-check）。触发关键词：录包、录制、record、bag、数据包、channel 清单、模块图表、CSV、PNG、report、回放、cyber_recorder、批量测试、跑批、回归对比、评分、赛事分数、记缺陷、提 bug、跑单测、环境检测、/apollo-test。
---

# Apollo Test（测试能力主入口）

本 skill 是 Apollo **测试角色**的主入口，职责分两层：

| 层 | 内容 |
|---|---|
| 本 skill 直接做 | 录包（pnc/vehicle/full）、通道盘点、CSV/PNG/Markdown 报告、回放核验 |
| 路由到模块 / 兄弟 skill | 批量执行与回归、缺陷闭环、运行时排障、跑单测、环境检查（本 skill 的 `modules/`）；评分（`apollo-eval` skill） |

## 路由防误判规则（读模块文档 / 调用兄弟 skill 前必须执行）

1. **先看「几个场景」再选 skill。** 录单个包 → 本 skill；跑一批场景并要汇总/对比 → `modules/batch/README.md`。
2. **区分数数与评分。** 只想知道包里有什么、通道全不全、曲线长什么样 → 本 skill；要「过没过、扣几分、为什么」→ `apollo-eval`。
3. **区分数数据与判责。** 「包拿到了但模块没数据、频率不对、进程退不出」是运行时问题 → `modules/debug/README.md`，不是重新录包。
4. **失败要落成缺陷。** 确认是产品问题的失败，登记进 `modules/defect/README.md`，不要只在对话里口头记录。
5. **改完要验证代码。** 「编译过没、单测过没、lint 有没问题」→ `modules/build-test/README.md`，不要只靠跑仿真判断。
6. **开跑前先看环境。** 磁盘不够、cyber 没起、Docker 没起时录包必失败 → 先 `modules/env-check/README.md`。
7. **子 skill 不可用不改变意图。** 目标子 skill 未注册时，明确报告缺失并给出可替代的手工步骤，不得改用职责不符的 skill 硬做。

## 路由回归用例

修改本入口的路由规则时必须逐条核对（人工核对用例，非自动化测试）。

| 用户表达 | 期望路由 | 禁止误判 |
|---|---|---|
| `录个 S 弯的包` / `录 pnc 通道` | 本 skill（流程 A） | 不调 batch |
| `这个包有哪些 channel` | 本 skill（流程 B） | 不调 eval |
| `导出模块曲线和报告` | 本 skill（流程 C） | 不调 eval 的评分 |
| `回放看看轨迹对不对` | 本 skill（流程 D） | 不调 batch |
| `跑一批场景 1-5，出个汇总` | `modules/batch/` | 不逐个手工录包 |
| `改前改后哪些场景变差了` | `modules/batch/README.md`（compare） | 不自己写 diff |
| `场景 7 为什么没过` / `扣在哪` | `apollo-eval` | 不用本 skill 猜 |
| `把场景 7 的问题记下来` | `modules/defect/` | 不只口头记录 |
| `这个缺陷修好没` | `modules/defect/README.md`（verify） | 不重新录包判断 |
| `模块起了没 / 没有数据 / 频率不对` | `modules/debug/README.md` | 不重录包掩盖问题 |
| `跑一下单测 / 编译过没` | `modules/build-test/README.md` | 不用仿真代替单测 |
| `磁盘够不够 / cyber 起来没` | `modules/env-check/README.md` | 不直接开录 |
| `录包 + 顺便打分` | 本 skill 录包 → 再 `apollo-eval` | 不在本 skill 内算分 |

## 路由表

前 5 项在本 skill 的 `modules/` 下（文档+脚本，**不是 skill，用文件读取打开**）；
评分在 `apollo-eval`（同预设的兄弟 skill，用 `skill` 工具加载）。

| 需求 | 去哪 | 脚本入口 |
|---|---|---|
| 批量跑场景、汇总表、两轮回归对比 | `modules/batch/README.md` | `modules/batch/scripts/run_batch.py`、`compare_runs.py` |
| 登记缺陷、追踪状态、回归验证、导出清单 | `modules/defect/README.md` | `modules/defect/scripts/defect.py` |
| 模块起不来、无数据、频率异常、看日志 | `modules/debug/README.md` | —（命令手册） |
| 跑单测、bazel test、lint、编译单模块 | `modules/build-test/README.md` | —（命令手册） |
| 磁盘/cyber/Docker/工程状态检查 | `modules/env-check/README.md` | `modules/env-check/scripts/env_check.sh` |
| 评分、指标解读、扣分原因、调参建议 | **`apollo-eval`（skill 工具加载）** | `apollo-eval/scripts/grading_system_py/main.py` |

> 模块路径都相对本 skill 根目录：`${DSH_HOME:-$HOME/.dsh}/skills/apollo-test/`。
> 跑批和记缺陷**必须先读完对应 README 再执行**，不要凭印象拼命令。

## 本 skill 直接负责的能力

`apollo-test` 直接承载 **数据包采集与可视化落盘**：

- 录制实车或仿真 cyber record，并按 profile 管理 channel 范围。
- 对已有 record 目录做 channel inventory，输出 `channel_summary.csv`。
- 解析核心模块信号，输出 `csv/*.csv`、`plots/*.png`、`record_report.md`。
- 辅助回放验证数据包是否可复现。

边界：`apollo-test` 不做赛事评分、不解释 metric 分数、不判断是否通过终点；评分和 metric 问题转给 `apollo-eval`。

技能目录记为 `{BASE_DIR}` = **本 skill 被加载的那个目录**（即本 SKILL.md 所在目录）。
不要照抄文档里出现的任何绝对路径——不同机器安装位置不同，脚本位置请按当前加载位置解析。

## 命令分流

| 用户意图 | 处理方式 |
|-|-|
| `/apollo-test` | 询问是要录制、盘点、出报告还是回放 |
| `/apollo-test record` / 录包 | 走“流程 A：录制数据包” |
| `/apollo-test channels` / 通道清单 | 走“流程 B：盘点已有数据包” |
| `/apollo-test report` / 图表落盘 | 走“流程 C：生成报告” |
| `/apollo-test replay` / 回放 | 走“流程 D：回放核验” |
| `/apollo-test bag` | 兼容旧入口，优先生成 report，再按报告辅助调试 |
| GTest / buildtool test | 作为次级测试能力，可读取 `references/knowledge/` |

## 快速命令

录制 PnC 核心通道：

```bash
bash {BASE_DIR}/scripts/record_apollo_channels.sh s_curve "S弯道闭环基线" pnc
```

录制实车闭环常用通道：

```bash
bash {BASE_DIR}/scripts/record_apollo_channels.sh wanzheng_bihuan "完整闭环实车包" vehicle
```

仅盘点已有数据包：

```bash
MPLCONFIGDIR=/tmp/matplotlib PYTHONPATH=/opt/apollo/neo/python \
python3 {BASE_DIR}/scripts/record_channel_report.py \
  /apollo_workspace/data/4闭环/wanzheng_bihuan \
  -o /apollo_workspace/data/4闭环/wanzheng_bihuan_report \
  --inventory-only
```

生成 CSV、图表、Markdown 报告：

```bash
MPLCONFIGDIR=/tmp/matplotlib PYTHONPATH=/opt/apollo/neo/python \
python3 {BASE_DIR}/scripts/record_channel_report.py \
  /apollo_workspace/data/4闭环/wanzheng_bihuan \
  -o /apollo_workspace/data/4闭环/wanzheng_bihuan_report
```

指定额外 channel：

```bash
MPLCONFIGDIR=/tmp/matplotlib PYTHONPATH=/opt/apollo/neo/python \
python3 {BASE_DIR}/scripts/record_channel_report.py \
  /path/to/record_dir \
  -o /path/to/report_dir \
  --channel /apollo/planning \
  --channel /apollo/control \
  --channel /apollo/localization/pose
```

回放：

```bash
cyber_recorder play -f /path/to/xxx.record
```

## 流程 A：录制数据包

先确认用户要录哪类数据：

- `pnc`：默认推荐，planning/control/canbus/localization/perception/prediction/guardian/safety/tf。
- `vehicle`：实车闭环推荐，在 `pnc` 基础上加 GNSS/IMU/lidar 关键 channel。
- `full`：录当前所有发布 channel，文件最大，仅在明确需要原始传感器全量包时使用。

执行：

```bash
bash {BASE_DIR}/scripts/record_apollo_channels.sh <tag> "<描述>" <pnc|vehicle|full>
```

默认输出到：

```text
/apollo_workspace/data/record/apollo_channels/<timestamp>_<tag>/
/apollo_workspace/data/record/apollo_channels/manifest.csv
```

录制结束后，立刻建议用户运行 `record_channel_report.py` 对新包出报告，确认核心 channel 是否齐全。

## 流程 B：盘点已有数据包

用于快速判断一个 record 目录里有什么 channel、每个 channel 有多少消息、message type 是什么。

```bash
MPLCONFIGDIR=/tmp/matplotlib PYTHONPATH=/opt/apollo/neo/python \
python3 {BASE_DIR}/scripts/record_channel_report.py <record文件或目录> \
  -o <输出目录> \
  --inventory-only
```

重点看：

- `channel_summary.csv`：全量 channel、message type、message count、是否有内置 parser。
- `module_summary.csv`：按 planning/control/canbus/localization 等模块聚合的消息量。

注意：`--inventory-only` 不生成信号图表，只做轻量盘点。

## 流程 C：生成可视化报告

默认解析这些核心 channel：

- `/apollo/canbus/chassis`
- `/apollo/control`
- `/apollo/control/interactive`
- `/apollo/guardian`
- `/apollo/localization/pose`
- `/apollo/perception/obstacles`
- `/apollo/planning`
- `/apollo/prediction`
- `/apollo/sensor/gnss/best_pose`
- `/apollo/sensor/gnss/corrected_imu`
- `/apollo/sensor/gnss/imu`
- `/apollo/sensor/gnss/ins_stat`

执行：

```bash
MPLCONFIGDIR=/tmp/matplotlib PYTHONPATH=/opt/apollo/neo/python \
python3 {BASE_DIR}/scripts/record_channel_report.py <record文件或目录> \
  -o <输出目录>
```

产物：

```text
<输出目录>/
├── record_report.md
├── channel_summary.csv
├── module_summary.csv
├── csv/
└── plots/
```

默认不会解析点云、raw_data、`/tf` 全量内容；这些只进入 channel 清单。需要更完整时间统计时加 `--full-scan`，但大包会更慢。

## 流程 D：回放核验

回放单个 record：

```bash
cyber_recorder play -f /path/to/xxx.record
```

循环回放：

```bash
cyber_recorder play -f /path/to/xxx.record --loop
```

只回放关键 topic：

```bash
cyber_recorder play -f /path/to/xxx.record \
  -w /apollo/planning \
  -w /apollo/control \
  -w /apollo/localization/pose \
  -w /apollo/canbus/chassis \
  -w /apollo/perception/obstacles
```

回放核验关注：

- Planning、Control、Localization、Canbus 是否同时存在。
- 核心 channel 频率是否异常断档。
- DreamView 现象是否能复现。
- 报告中的速度、转角、制动、轨迹点数是否和观察一致。

## 代码测试：见 modules/build-test

GTest、BUILD、`buildtool test`、lint、编译单模块这些**执行类**需求，加载 `modules/build-test/README.md` 来做，
本 skill 不重复给命令。

本 skill 只保留**写测试所需的知识**（`references/knowledge/`，都是文档）：

- `01_单元测试/00_GTest基础与Apollo适配.md`
- `01_单元测试/01_TrafficRule插件单测模板.md`
- `01_单元测试/02_Scenario插件单测模板.md`
- `01_单元测试/03_Mock常见Apollo依赖.md`
- `02_集成测试/00_buildtool_test使用指南.md`
- `02_集成测试/01_SimControl自动化测试.md`
- `02_集成测试/02_提交前测试Checklist.md`

写用例时看这些文档；要真正跑起来，交给 `modules/build-test/README.md`。

旧脚本 `analyze_pnc_record.py`、`record_pnc_sim.sh` 仍可用于兼容旧 PnC 调试流程，但新的录制和报告流程优先使用：

- `{BASE_DIR}/scripts/record_apollo_channels.sh`
- `{BASE_DIR}/scripts/record_channel_report.py`
