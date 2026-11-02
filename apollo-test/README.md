# apollo-test

> 版本：2.0.0 | 定位：测试角色入口（数据录制、通道盘点、报告、回放 + 测试模块路由）

`apollo-test` 是 Apollo 测试角色的主入口，分两层：

- 本 skill 直接做：Cyber record 录制、通道盘点、CSV/PNG/Markdown 报告、回放核验。
- `modules/` 与 `apollo-eval`：批量回归、缺陷闭环、运行时排障、构建测试、环境检查、评分。

评分和赛事得分解释属于 `apollo-eval`，不要在这里做。

## 命令入口

| 入口 | 用途 |
|---|---|
| `/apollo-test record` | 录制实车或仿真 cyber record |
| `/apollo-test channels` | 盘点已有数据包的 channel 清单 |
| `/apollo-test report` | 导出 CSV、PNG、Markdown 报告 |
| `/apollo-test replay` | 回放核验 |
| `/apollo-test bag` | 兼容旧入口，优先走 report |

## 功能模块

| 需求 | 模块 | 脚本 |
|---|---|---|
| 批量跑场景、汇总、两轮回归对比 | `modules/batch/` | `scripts/run_batch.py`、`scripts/compare_runs.py` |
| 登记缺陷、追踪状态、回归验证 | `modules/defect/` | `scripts/defect.py` |
| 模块起不来、无数据、频率异常、看日志 | `modules/debug/` | 命令手册 |
| 跑单测、bazel test、lint、编译单模块 | `modules/build-test/` | 命令手册 |
| 磁盘、cyber、Docker、工程状态检查 | `modules/env-check/` | `scripts/env_check.sh` |
| 评分、指标解读、扣分原因 | `apollo-eval` skill | `scripts/grading_system_py/main.py` |

这些模块是文档 + 脚本，不是独立 skill；命中需求后先读对应 `modules/<name>/README.md`。

## 脚本

```text
scripts/
├── record_apollo_channels.sh   # 按 pnc/vehicle/full profile 录制 channel
├── record_channel_report.py    # 输出 channel_summary.csv、csv/*.csv、plots/*.png、record_report.md
├── analyze_pnc_record.py       # 旧 PnC 调试分析脚本，兼容保留
└── record_pnc_sim.sh           # 旧 PnC 录包脚本，兼容保留
```

`{BASE_DIR}` 指本 skill 被加载的目录；不同机器安装位置不同，按实际路径解析。

## 示例

录制实车闭环常用通道：

```bash
bash {BASE_DIR}/scripts/record_apollo_channels.sh \
  wanzheng_bihuan "完整闭环实车包" vehicle
```

对已有包生成报告：

```bash
MPLCONFIGDIR=/tmp/matplotlib PYTHONPATH=/opt/apollo/neo/python \
python3 {BASE_DIR}/scripts/record_channel_report.py \
  /apollo_workspace/data/4闭环/wanzheng_bihuan \
  -o /apollo_workspace/data/4闭环/wanzheng_bihuan_report
```

只做通道清单：

```bash
MPLCONFIGDIR=/tmp/matplotlib PYTHONPATH=/opt/apollo/neo/python \
python3 {BASE_DIR}/scripts/record_channel_report.py \
  /apollo_workspace/data/4闭环/wanzheng_bihuan \
  -o /apollo_workspace/data/4闭环/wanzheng_bihuan_inventory \
  --inventory-only
```
