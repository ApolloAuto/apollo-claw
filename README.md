# apollo-claw

`apollo-claw` 是一组面向百度 Apollo / 星火自动驾驶大赛 PnC 赛道的 Skill 与本地知识库集合。它把环境安装、PnC 开发、数据包录制、仿真评估这几类高频工作拆成独立技能，方便在编码助手中按场景调用。

## 模块总览

| 模块 | 定位 | 典型入口 |
|------|------|----------|
| [`apollo-env`](./apollo-env/) | Apollo EDU 环境安装、环境检测、安装故障诊断 | `/apollo-env`、`/apollo-env check`、`/apollo-env diagnose` |
| [`apollo-dev`](./apollo-dev/) | PnC/Planning 日常开发、插件开发、赛事场景调试、Git 与打包流程 | `/apollo-dev` |
| [`apollo-test`](./apollo-test/) | cyber record 录制、channel 盘点、CSV/PNG/Markdown 报告、回放核验 | `/apollo-test record`、`/apollo-test report`、`/apollo-test replay` |
| [`apollo-eval`](./apollo-eval/) | 评分标准解读、已有 bag/record 体感分析、赛事标准包离线评分、优化建议 | `/apollo-eval score`、`/apollo-eval report`、`/apollo-eval optimize` |

## 适用场景

本仓库主要服务 Apollo EDU PnC 赛道开发流程：

- 从全新 Ubuntu 安装 Docker、aem、`application-pnc`，并完成 `buildtool build -p core`。
- 进行 Planning / PnC 开发，包括 TrafficRule、Scenario、Task 插件和赛事场景调试。
- 录制实车或仿真数据包，盘点 channel，导出核心模块信号图表。
- 对已有赛事输出或 record 做评分分析、体感指标分析和调参建议。

不适合把它当作完整 Apollo 源码仓库使用；这里存放的是技能定义、脚本和知识库文档。

## 目录结构

```text
apollo-claw/
├── apollo-env/    # 环境安装与检测
├── apollo-dev/    # PnC 开发与赛事场景知识库
├── apollo-test/   # 录包、报告、回放
├── apollo-eval/   # 评分、评估、优化
└── README.md
```

每个模块通常包含：

```text
<skill>/
├── SKILL.md                 # Skill 行为定义与触发规则
├── README.md                # 模块使用说明
├── config.yaml              # 配置、阈值、URL 或命令参数
├── scripts/                 # 可执行辅助脚本，部分模块提供
└── references/knowledge/    # 本地知识库文档
```

## 快速使用

### 1. 环境安装或检测

```text
/apollo-env check
/apollo-env
```

`apollo-env` 会覆盖 OS、CPU、内存、磁盘、Docker、aem、buildtool、网络等环境检查，并引导 Docker、aem、工程克隆和构建。

### 2. PnC 日常开发

```text
/apollo-dev 借道绕行场景怎么实现？
/apollo-dev Planning 模块在 DreamView 中打不开
/apollo-dev 怎么打包提交？
```

`apollo-dev` 负责装好环境之后的开发活动，包括参数配置、源码编译、profile 恢复、插件开发、场景解题和常见报错排查。

### 3. 数据包录制与报告

```text
/apollo-test record
/apollo-test channels
/apollo-test report
/apollo-test replay
```

`apollo-test` 只负责数据采集、通道盘点、可视化报告和回放核验。赛事评分、metric 判分和得分解释应转到 `apollo-eval`。

### 4. 评分与优化分析

```text
/apollo-eval score
/apollo-eval report
/apollo-eval optimize
```

`apollo-eval` 负责评分标准解释、已有 record 的体感指标报告、赛事标准 bag 的完整离线评分，以及基于扣分项的优化建议。

## 职责边界

| 需求 | 使用模块 |
|------|----------|
| 安装 Apollo、修 Docker/aem/buildtool 安装问题 | `apollo-env` |
| 写 PnC 代码、改 planning 参数、调赛事场景 | `apollo-dev` |
| 录制 cyber record、导出 channel 清单和图表 | `apollo-test` |
| 看 ReachEnd、Collision、SpeedLimit、AccelerationLimit 等评分结果 | `apollo-eval` |
| 没有 record，想先采集数据再分析 | 先 `apollo-test`，再 `apollo-eval` |

## 关键脚本

| 脚本 | 说明 |
|------|------|
| `apollo-env/scripts/env_check.sh` | 环境检测脚本，支持普通输出和 `--json` |
| `apollo-test/scripts/record_apollo_channels.sh` | 按 `pnc` / `vehicle` / `full` profile 录制 channel |
| `apollo-test/scripts/record_channel_report.py` | 对 record 生成 channel 清单、CSV、PNG 和 Markdown 报告 |
| `apollo-eval/scripts/realtime_monitor.py` | 仿真运行中实时观察速度、加速度、Jerk、横向加速度 |
| `apollo-eval/scripts/extract_metrics.py` | 对已有 record 生成体感指标统计 |
| `apollo-eval/scripts/grading_system_py/main.py` | 对赛事标准数据包执行离线评分 |

## 环境要求

基础要求来自各模块 `config.yaml`：

| 项目 | 要求 |
|------|------|
| 操作系统 | Ubuntu 18.04 / 20.04 / 22.04 |
| Docker | 19.03 或更高 |
| CPU | 4 核或更多 |
| 内存 | 16 GB 或更多 |
| 磁盘 | 55 GB 或更多 |
| GPU | PnC 赛道无强制要求 |

## 文档入口

- 环境安装：[`apollo-env/README.md`](./apollo-env/README.md)
- 开发流程：[`apollo-dev/README.md`](./apollo-dev/README.md)
- 测试录包：[`apollo-test/README.md`](./apollo-test/README.md)
- 评分评估：[`apollo-eval/README.md`](./apollo-eval/README.md)

更细的知识库索引见各模块的 `references/knowledge_index.md`。
