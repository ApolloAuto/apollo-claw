# Apollo 批量测试编排

把「跑一批场景 → 录包 → 评分 → 汇总 → 和上一轮对比 → 归档」串成一条命令。

## 边界（先读，避免抢活）

| 要做的事 | 用哪个 |
|---|---|
| 跑一批场景、汇总、回归对比、归档 | **本 skill** |
| 单次录包、通道盘点、出图表报告、回放 | `apollo-test` |
| 评分规则、指标含义、扣分解释、调参建议 | `apollo-eval` |

**本 skill 不含任何评分逻辑**。它调用 `apollo-eval/scripts/grading_system_py/main.py`，
评分口径永远只有一处；要改评分标准，改 `apollo-eval`，不要改这里。
同理，录包一律调用 `apollo-test/scripts/record_apollo_channels.sh`。

## 命令分流

| 用户说法 | 动作 |
|---|---|
| `/apollo-test-batch` | 先问：跑哪些场景、标签叫什么、仿真怎么起 |
| 跑一批 / 批量跑场景 / 跑全部场景 | 流程 A：批量执行 |
| 回归对比 / 改前改后 / 哪些变差 | 流程 B：两轮对比 |
| 测试汇总 / 出报告 | 流程 C：汇总与归档 |
| 只看不跑（检查数据齐不齐） | `--dry-run` |

## 前置确认（每次开跑前必做）

1. **场景清单**：默认按 `metric/<N>.json` + `input_data/<N>.json` + `output_data/<N>/<N>.output.bag` 配对
2. **仿真怎么起**：问清是 DreamView 手动点 SimControl，还是有脚本命令
3. **环境**：cyber 在跑吗、目标 channel 有数据吗、磁盘够吗（可先用 `apollo-env/modules/env-check/`）
4. **标签**：这轮叫什么（`baseline` / `v2` / `调buffer后`），回归对比靠它区分

## 流程 A：批量执行

```bash
# 默认走 config.yaml 里的 sim.mode
python3 {BASE_DIR}/scripts/run_batch.py --tag baseline --scenarios 1,2,3

# 指定仿真由命令拉起
python3 {BASE_DIR}/scripts/run_batch.py --tag v2 --scenarios 1-5 --sim-mode command

# 已在 DreamView 手动跑，只等 bag 落盘
python3 {BASE_DIR}/scripts/run_batch.py --tag v2 --scenarios 1,2 --sim-mode manual

# bag 已经存在，只做评分与汇总
python3 {BASE_DIR}/scripts/run_batch.py --tag v2 --scenarios 1,2 --sim-mode none --no-record

# 只检查前置条件，不执行
python3 {BASE_DIR}/scripts/run_batch.py --tag dry --scenarios 1-5 --dry-run
```

每个场景依次做：

1. 按需启动录包（`apollo-test` 的脚本，profile 由 `config.yaml` 指定）
2. 按 `sim.mode` 起仿真或等 bag
3. 停止录包（SIGINT，让 cyber_recorder 正常收尾）
4. 调评分引擎，解析 `Scenario: PASS/FAIL` 与每个指标的分数
5. 写一行进 `summary.csv`

单个场景失败默认**终止**后续场景；加 `--keep-going` 可继续跑完。

## 流程 B：回归对比

```bash
python3 {BASE_DIR}/scripts/compare_runs.py \
  /apollo_workspace/data/test_runs/baseline_20261029_101500 \
  /apollo_workspace/data/test_runs/v2_20261029_140000
```

输出（同时写 `compare.csv` / `compare.md`）：

```text
| 场景 | 基线 | 对比 | 分数变化 | 判定 |
| 1 | PASS (100) | PASS (100) | +0.0 | 持平 |
| 2 | PASS (95)  | FAIL (60)  | -35.0 | 由通过变未通过 ❌ |
| 3 | FAIL (40)  | PASS (88)  | +48.0 | 由未通过变通过 ✅ |
```

判定只有六种：`持平`、`分数改善 ✅`、`分数下降 ❌`、`由未通过变通过 ✅`、
`由通过变未通过 ❌`、`新增` / `缺失` / `执行失败 ❌`。有 ❌ 时脚本退出码为 1。

## 流程 C：汇总与归档

每轮跑完会生成：

```text
<run_root>/<tag>_<时间戳>/
├── summary.csv          # 每场景一行：结论、总分、未通过指标数、bag 路径
├── summary.md           # 给人看的报告（含平均分）
└── logs/
    ├── <场景号>.record.log    # 录包过程
    └── <场景号>.grading.log   # 评分引擎原始输出
```

归档就是保留这个目录。要长期留档，建议目录名带上版本：
`--tag v2.3.1_调buffer`。

## 配置

所有路径在 `config.yaml`，改这里不要改脚本：

```yaml
paths:
  metric_dir: /apollo_workspace/metric
  scenario_input_dir: /apollo-simulator/input_data
  scenario_output_dir: /apollo-simulator/output_data
  run_root: /apollo_workspace/data/test_runs
sim:
  mode: manual          # command | manual | none
  command: ""           # command 模式的模板，支持 {scenario} {scenario_json} {output_dir} {bag}
```

如果 skill 装在非常规位置，再加上：

```yaml
skills:
  test_scripts: /path/to/apollo-test/scripts
  eval_scripts: /path/to/apollo-eval/scripts
```

## 常见问题

**找不到 bag**
`--sim-mode none` 时脚本只评分不跑仿真，bag 必须已存在。检查
`output_data/<N>/<N>.output.bag` 是否存在，或改用 `manual` / `command`。

**评分输出解析不了**
看 `logs/<N>.grading.log`。常见原因是 `PYTHONPATH` 缺 `/opt/apollo/neo/python`，
或 bag 里没有评分需要的 channel。

**录包没停下来**
`cyber_recorder` 收到 SIGINT 后有 `record.stop_grace_s` 秒收尾；超时会 SIGKILL，
此时该包的 `.record` 可能不完整。

**completion status 未知**
本 skill 不解释「场景为什么没过」——那是 `apollo-eval` 的职责。看到 FAIL 就去问
`apollo-eval`：`这个场景为什么没过、扣在哪几个指标上`。
