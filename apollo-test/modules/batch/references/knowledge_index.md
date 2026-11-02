# apollo-test-batch 知识索引

本 skill 只做编排，知识都在上下游两个 skill 里。

## 要「怎么录、录哪些 channel、包怎么看」
→ `apollo-test`
- `references/knowledge/02_集成测试/01_SimControl自动化测试.md`
- `references/knowledge/03_FAQ/仿真不通过排查指南.md`

## 要「指标怎么算、扣分规则、怎么调参」
→ `apollo-eval`
- `references/knowledge/01_赛事评分标准/00_评分维度总览.md`
- `references/knowledge/01_赛事评分标准/02_体感指标说明与计算方法.md`
- `references/knowledge/04_优化指引/00_体感优化参数映射.md`

## 本 skill 自己负责的
- 批量执行顺序与失败处理（`--keep-going`）
- 两轮结果对比的判定口径（`compare_runs.py`）
- 每轮产物目录结构（`summary.csv` / `summary.md` / `logs/`）
