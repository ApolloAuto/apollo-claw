# apollo-claw

`apollo-claw` 是一组面向 Apollo EDU 与 Apollo 11.0 工作区的 Skills 和本地知识库。环境运维、源码开发、测试和评估能力各自独立，便于在兼容 Skills 目录结构的编码 Agent 中按需使用。

## 模块总览

| Skill | 能力范围 | DSH 入口 |
|------|----------|----------|
| [`apollo-env`](./apollo-env/) | 环境体检（OS、CPU、内存、磁盘、Docker、aem、buildtool、网络）；Apollo 安装与故障诊断；车型基线恢复/回滚；GNSS、激光雷达、相机配置及车辆使用。2.0 包含 7 个专项模块。 | `/apollo-env`、`/apollo-env check`、`/apollo-env install`、`/apollo-env diagnose` |
| [`apollo-dev`](./apollo-dev/) | EDU 日常工作流和 Apollo 11.0 源码/实践资料；支持架构导航、Planning/Control/Perception/Localization 开发，组件与插件开发、构建调试、GNSS 驱动、HMI 和传感器适配。2.0 包含 12 个专项模块。 | `/apollo-dev` |
| [`apollo-test`](./apollo-test/) | Cyber record 录制（`pnc`/`vehicle`/`full`）、通道及消息清单、CSV/PNG/Markdown 信号报告和回放；2.0 还包括批量回归、缺陷跟踪、运行时/构建测试和环境检查，共 5 个专项模块。 | `/apollo-test record`、`/apollo-test channels`、`/apollo-test report`、`/apollo-test replay` |
| [`apollo-eval`](./apollo-eval/) | 实时轨迹体感监控、已有 record 的加速度/Jerk 等指标分析、基于 `metric.json`、scenario 文件和 bag 的离线评分、结果解释与优化建议。录包和回放由 `apollo-test` 负责。 | `/apollo-eval monitor`、`/apollo-eval score`、`/apollo-eval report`、`/apollo-eval optimize` |

2.0 Skills 包中的专项模块：

- `apollo-env`：`env-check`、`install`、`vehicle-restore`、`vehicle-usage`、`gnss-config`、`lidar-config`、`camera-config`。
- `apollo-dev`：`architecture`、`build-test`、`control-dev`、`debug`、`gnss-driver`、`hmi-dev`、`localization-dev`、`new-component`、`perception-dev`、`planning-dev`、`plugin-dev`、`vehicle-sensor`。
- `apollo-test`：`batch`、`build-test`、`debug`、`defect`、`env-check`。
- `apollo-eval`：`realtime_monitor.py` 实时指标监控、`extract_metrics.py` record 指标分析、`grading_system_py` 数据包评分。

这些 Skill 目录包含 `SKILL.md`、脚本和参考资料；兼容此目录结构的编码 Agent 可复用其定义和知识。DSH 的斜杠命令、agent presets 和 Web 插件属于 DSH 集成功能。

### DSH 预设与插件

| DSH 集成 | 对应 Skills / 功能 |
|---|---|
| Apollo 运维工程师预设 | `apollo-env`：环境、安装、车型恢复及传感器配置。 |
| Apollo 开发工程师预设 | `apollo-dev`：源码开发、PnC 插件、模块调试和构建。 |
| Apollo 测试工程师预设 | `apollo-test` + `apollo-eval`：数据录制/回放与离线评估。 |
| Apollo Ops Web 客户端插件 | DSH Web 侧栏和插件页；查看工作区、profile、车型与 Apollo 版本，浏览/编辑工作区文件并使用受控终端。 |
| LAN 插件（可选） | 允许局域网直连 DSH Web；会关闭 token 认证并监听 `0.0.0.0`，仅适用于可信网络。 |

客户端插件、预设和可选 LAN 插件通过 npm 分发。

新环境一键安装客户端插件、四个 Skills 和 presets：

```bash
curl -fsSL https://raw.githubusercontent.com/ApolloAuto/apollo-claw/EDU/ops-expert/install.sh | bash
```

需要 LAN 访问时添加 `--with-lan`：

```bash
curl -fsSL https://raw.githubusercontent.com/ApolloAuto/apollo-claw/EDU/ops-expert/install.sh | bash -s -- --with-lan
```

安装脚本从本仓库分支直接取 `apollo-env`、`apollo-dev`、`apollo-test`、`apollo-eval` 四个目录，复制到 `$DSH_HOME/skills`。如果目标机已有同名 Skill，会先改名为 `<skill>.bak.<时间戳>` 再安装，不直接覆盖。

`apollo-env` 自带车型基线数据，仓库体积主要来自这里；安装时会一并复制到本地 Skill 目录。

## 适用场景

本仓库适用于 Apollo EDU 日常运维和 Apollo 11.0 二次开发：

- 检查环境、安装依赖、诊断 aem/buildtool/profile 问题。
- 开发或调试 Planning、Control、Perception、Localization、CyberRT 组件及插件。
- 录制和回放实车或仿真数据，盘点 channel 并生成模块信号报告。
- 对已有 record、bag 或仿真输出进行离线评分与指标分析。

本仓库提供 Skills、辅助脚本和本地知识库，不包含 Apollo 完整源码。

## 目录结构

```text
apollo-claw/
├── apollo-env/    # 环境和车型配置
├── apollo-dev/    # Apollo 源码开发
├── apollo-test/   # 数据录制、报告和回放
├── apollo-eval/   # 离线评分与指标分析
├── ops-expert/    # DSH presets、Web 插件和安装说明
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
/apollo-dev Apollo 11.0 中如何新增一个 Planning Task？
/apollo-dev 定位模块配置没有生效，怎么排查？
/apollo-dev 如何构建和提交代码？
```

`apollo-dev` 覆盖源码导航、参数配置、模块开发、插件开发、构建和常见问题排查。

### 3. 数据包录制与报告

```text
/apollo-test record
/apollo-test channels
/apollo-test report
/apollo-test replay
```

`apollo-test` 负责数据采集、通道盘点、可视化报告和回放核验。已有数据的评分和指标分析由 `apollo-eval` 处理。

### 4. 评分与优化分析

```text
/apollo-eval score
/apollo-eval report
/apollo-eval optimize
```

`apollo-eval` 负责已有 record、bag 和仿真输出的离线评分、体感指标报告，以及基于结果的优化建议。

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
