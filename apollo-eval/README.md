# apollo-eval

> 版本：2.0.0 | 定位：Apollo EDU PnC 仿真评估与评分分析

帮助理解评分标准、分析仿真结果、生成评估报告，指导下一步优化方向。

**知识库路径**：`{BASE_DIR}/references/knowledge/`
**配置文件**：`{BASE_DIR}/config.yaml`
> `{BASE_DIR}` 为本 skill 加载时顶部显示的 "Base directory for this skill" 路径。

---

## 一、功能定位

**apollo-eval Skill** 是 Apollo EDU PnC 赛道的仿真评估与评分分析入口。它负责帮助用户运行本地评估脚本、解释评分结果，并根据扣分项给出排查方向。

它不是录包工具、测试工具、官方评分系统，也不是全自动仿真托管工具。录制 cyber record、采集数据包、回放验证和测试闭环由 `apollo-test` 负责。

**核心能力**：
- **实时体感监控**：在仿真运行中订阅 Apollo channel，观察纵向加速度、Jerk、横向加速度等指标。
- **已有 record 体感报告**：对已经录好的 record 用 `extract_metrics.py` 生成体感指标统计。
- **赛事标准 bag 离线评分**：对包含 `metric.json`、`scenario.json` 或 `scenrio.json`、`*.output.bag` 的数据包运行 `grading_system_py/main.py`。
- **评分标准解读**：说明 ReachEnd、TimeLimit、Collision、OnRoad、SpeedLimit、AccelerationLimit、CentripetalAccelerationLimit 等指标含义。
- **结果排查和优化建议**：根据 FAIL 或扣分项，定位可能的 planning、限速、终点、停车决策或体感参数问题。

**边界说明**：
- 完整赛事评分依赖赛事数据包中的 `metric.json` 和 scenario 文件；只有普通 record 时只能做体感指标分析。
- 如果还没有 record 或需要录制仿真数据包，先使用 `apollo-test` 的 `/apollo-test bag`。
- 离线赛事评分需要 Apollo Python 环境，通常要设置 `PYTHONPATH=/opt/apollo/neo/python:$SKILL_SCRIPTS`。
- 本 Skill 的评分结果用于本地自查，最终成绩以官方评测为准。

## 二、典型流程

### 流程 A：实时监控（仿真运行中）

在 Apollo 容器内执行：

```bash
aem enter
SKILL_SCRIPTS=${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts
python3 "$SKILL_SCRIPTS/realtime_monitor.py"
```

输入 `/apollo-eval monitor` 可获取带自定义阈值的启动命令。

### 流程 B：需要录制数据包

录制 cyber record、采集仿真数据包和回放调试闭环属于 `apollo-test`：

```bash
/apollo-test bag
```

录制完成后，再回到 `apollo-eval` 做体感报告或完整赛事评分。

### 流程 C：体感报告（已有 bag/record）

```bash
SKILL_SCRIPTS=${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts
python3 "$SKILL_SCRIPTS/extract_metrics.py" /path/to/your.record
```

输入 `/apollo-eval report` 可获取已有 record 的体感分析引导。

### 流程 E：完整赛事评分（赛事标准 bag）

本地目录形式，例如 `/apollo_workspace/peixun/`：

```bash
DATA_DIR=/apollo_workspace/peixun
SKILL_SCRIPTS=${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts
SCENARIO_FILE="$DATA_DIR/scenario.json"
if [ ! -f "$SCENARIO_FILE" ]; then
  SCENARIO_FILE="$DATA_DIR/scenrio.json"
fi

PYTHONPATH=/opt/apollo/neo/python:$SKILL_SCRIPTS \
python3 "$SKILL_SCRIPTS/grading_system_py/main.py" \
  --config "$DATA_DIR/metric.json" \
  --scenario "$SCENARIO_FILE" \
  --mode bag \
  --bag_file "$DATA_DIR/1.output.bag"
```

赛事输出目录形式：

```bash
SKILL_SCRIPTS=${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts
PYTHONPATH=/opt/apollo/neo/python:$SKILL_SCRIPTS \
python3 "$SKILL_SCRIPTS/grading_system_py/main.py" \
  --config /apollo_workspace/metric/<场景号>.json \
  --scenario /apollo-simulator/input_data/<场景号>.json \
  --mode bag \
  --bag_file /apollo-simulator/output_data/<场景号>/<场景号>.output.bag
```

---

## 快速命令入口

| 命令 | 功能 |
|------|------|
| `/apollo-eval` | 问诊：评估当前进展，引导到合适的分析流程 |
| `/apollo-eval monitor` | 给出实时体感监控启动命令和阈值参数 |
| `/apollo-eval auto` | 提醒录包职责在 `apollo-test`，并引导录完后回到 eval 评分 |
| `/apollo-eval score` | 解读赛事评分标准，逐维度说明 |
| `/apollo-eval report` | 引导生成单场景或多场景评估报告 |
| `/apollo-eval optimize` | 基于报告弱项，链接到 apollo-dev 对应参数配置指南 |

---

## 知识库目录

```
references/knowledge/
├── 01_赛事评分标准/
│   ├── 00_评分维度总览.md
│   ├── 01_性能指标说明.md
│   └── 02_体感指标说明与计算方法.md
├── 02_数据分析/
│   ├── 00_如何提取Planning日志.md
│   ├── 01_轨迹指标提取脚本.md
│   └── 02_指标可视化方法.md
├── 03_评估报告模板/
│   ├── 00_单场景评估模板.md
│   └── 01_多场景汇总报告模板.md
└── 04_优化指引/
    ├── 00_体感优化参数映射.md
    └── 01_性能不通过排查指南.md
```
