# apollo-defect 知识索引

本 skill 只做缺陷记录与闭环，不判分、不跑仿真。

## 缺陷怎么写才算「可复现」
- 现象要能落到场景号（`--scenario`），否则无法自动回归验证
- 期望 vs 实际要可观测（"压线 0.3m / 持续 2s" 而不是"效果不好"）
- 复现步骤要能照着走一遍
- 证据要绑包：`--bag` 指 record 目录，`--run` 指测试轮次

## 上下游
- 跑批量测试拿结果 → `apollo-test-batch`
- 解释为什么没过、扣在哪 → `apollo-eval`
- 排查模块/channel/日志 → `apollo-debug`

## 状态语义
`open` 未处理 → `investigating` 排查中 → `fixed` 已改 → `verifying` 待验证/已验证通过
→ `closed` 已关闭；验证失败自动打回 `open`；`wontfix` 明确不修。
