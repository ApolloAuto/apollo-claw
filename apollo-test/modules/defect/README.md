# Apollo 缺陷记录与闭环

把「跑出来没过」变成「有据可查、能验证、能关闭」的缺陷单。

## 边界

| 要做的事 | 用哪个 |
|---|---|
| 登记缺陷、追踪状态、回归验证、导出清单 | **本 skill** |
| 跑场景拿结果 | `modules/batch/` |
| 解释「为什么没过、扣在哪」 | `apollo-eval` |
| 排查「模块有没有起来、channel 有没有数据」 | `apollo-dev/modules/debug/` |

本 skill **不判分、不跑仿真**。它只负责记录与闭环，验证时读取 `modules/batch/`
产出的 `summary.csv`。

## 命令分流

| 用户说法 | 动作 |
|---|---|
| 把场景 7 没过记一下 / 提个 bug | `new`，必须带 `--title`，尽量带 `--scenario` |
| 现在有哪些没解决的 | `list --status open` |
| 这个 bug 修好了吗 | `verify <ID>`（用最新一轮测试结果判断） |
| 改完了，帮我验证 | 先 `update <ID> --status fixed`，再 `verify <ID>` |
| 导出缺陷清单 | `report` |
| 看某条细节 | `show <ID>` |

## 流程 A：登记缺陷

```bash
python3 {BASE_DIR}/scripts/defect.py new \
  --title "窄路会车时右前轮压线" \
  --severity major \
  --scenario 7 \
  --expected "全程保持在车道内，不压线" \
  --actual "右前轮压线约 0.3m，持续 2s" \
  --steps "1. 启动 DreamView 2. 选场景 7 3. 跑完看轨迹回放" \
  --bag /apollo_workspace/data/record/apollo_channels/20261029_101500_scene7
```

`--scenario` 很关键：**没有场景号就无法自动回归验证**，只能人工确认。

严重度：`blocker`（堵路/安全）、`major`（不通过）、`minor`（体感差但不影响通过）、`trivial`（文案/日志）。

## 流程 B：追踪与修改

```bash
python3 {BASE_DIR}/scripts/defect.py list                  # 全部
python3 {BASE_DIR}/scripts/defect.py list --status open    # 未解决
python3 {BASE_DIR}/scripts/defect.py show DEF-0001
python3 {BASE_DIR}/scripts/defect.py update DEF-0001 \
  --status fixed --note "把 nudge 的 buffer 从 0.2 调到 0.35"
```

状态流转：

```text
open → investigating → fixed → verifying → closed
                                    ↓
                                  open（验证没过，打回）
```

## 流程 C：回归验证（闭环的关键）

改完代码跑一轮批量测试，然后：

```bash
# 用最新一轮结果验证
python3 {BASE_DIR}/scripts/defect.py verify DEF-0001

# 指定某一轮
python3 {BASE_DIR}/scripts/defect.py verify DEF-0001 \
  --run /apollo_workspace/data/test_runs/v2_20261029_140000
```

输出：

```text
DEF-0001  场景 7  PASS  总分 92.0  未通过指标 0
  ✅ 该场景已通过 —— 可人工复核后关闭
  status → verifying
```

没过则打回：

```text
  ❌ 该场景仍未通过 —— 缺陷保持打开
  status → open
```

退出码：通过 0，未通过 1，便于脚本串起来。

## 流程 D：导出清单

```bash
python3 {BASE_DIR}/scripts/defect.py report
```

按状态分组生成 Markdown（`defects_<时间戳>.md`），带期望/实际/证据包/最近验证结果。

## 存储

一个缺陷一个 JSON，默认在 `/apollo_workspace/data/defects/`：

```text
DEF-0001.json
```

好处：能 diff、能随工作区一起备份、能进 git。改目录见 `config.yaml` 的 `paths.defect_root`。

## 配置

```yaml
paths:
  defect_root: /apollo_workspace/data/defects
  run_root: /apollo_workspace/data/test_runs   # verify 默认从这里取最新一轮
defaults:
  severity: major
  status: open
```

## 常见问题

**verify 说「没有关联场景号」**
登记时漏了 `--scenario`，补上即可：

```bash
python3 {BASE_DIR}/scripts/defect.py update DEF-0001 --scenario 7 --expected "..." --actual "..."
```

`update` 除了状态，还能改 `--scenario / --title / --expected / --actual / --steps`。

**verify 说「没有场景 N 的结果」**
那轮测试没跑这个场景。检查 `--scenarios` 范围。

**缺陷和测试结果对不上**
`verify` 按场景号匹配。如果场景语义变了（比如 7 号场景改了考核点），
应该关掉旧缺陷、另开新的，并在 `--note` 里写清。

**想记「体感差但场景通过」**
照样登记，`--severity minor`。这类缺陷不影响 PASS，但影响体验。
