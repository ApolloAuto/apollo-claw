# 使用方法

## 快速开始

### 1. Demo 模式（无需任何外部依赖）

```bash
PYTHONIOENCODING=utf-8 python3 ${SKILL_SCRIPTS}/grading_system_py/main.py \
  --config /apollo_workspace/metric/1.json \
  --mode demo
```

### 2. 读取 Bag 文件（离线评分）

```bash
python3 ${SKILL_SCRIPTS}/grading_system_py/main.py \
  --config /apollo_workspace/metric/1.json \
  --scenario /apollo-simulator/input_data/1.json \
  --mode bag \
  --bag_file /apollo-simulator/output_data/1/1.output.bag
```

### 3. 订阅 Cyber 通道（实时评分）

```bash
python3 ${SKILL_SCRIPTS}/grading_system_py/main.py \
  --config /apollo_workspace/metric/1.json \
  --scenario /apollo-simulator/input_data/1.json \
  --mode channel
```

## 命令行参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `--config` | 是 | - | 评分配置文件路径 (.json 或 .conf) |
| `--mode` | 否 | `demo` | 数据源模式: `bag` / `channel` / `demo` |
| `--bag_file` | bag模式必填 | - | bag/record 文件路径 |
| `--scenario` | 否 | - | 场景 JSON 文件（提供 ReachEnd 终点坐标） |
| `--interval` | 否 | `0.1` | 评分帧间隔（秒） |

## 输出说明

### 实时输出

运行过程中，每帧违规都会实时打印:

```
[FAIL] t=12.70s CentripetalAccelerationLimit: CentripetalAcceleration is 6.877.
[FAIL] t=3.50s SpeedLimit: Max speed is 16.67, ego speed is 18.0.
```

### 汇总输出

运行结束后输出评分汇总表:

```
============================================================
  GRADING SUMMARY
============================================================

  Scenario: FAIL

  Metric                    Result   Score    Fail/Total
  ------------------------- -------- -------- ------------
  CentripetalAccelerationLimit FAIL     88       4/313
  AccelerationLimit         PASS     100      0/313
  TimeLimit                 PASS     100      0/313
  ReachEnd                  FAIL     0        313/313
  Collision                 PASS     100      0/313
  OnRoad                    PASS     100      0/313
  SpeedLimit                PASS     100      0/313
```

- **Result**: PASS/FAIL
- **Score**: 当前得分（满分100，扣分制从100开始扣，得分制从0开始加）
- **Fail/Total**: 失败帧数 / 总帧数

## 使用场景示例

### 批量评分多个场景

```bash
for i in 1 2 3 4 5; do
  echo "=== Scenario $i ==="
  python3 ${SKILL_SCRIPTS}/grading_system_py/main.py \
    --config /apollo_workspace/metric/$i.json \
    --scenario /apollo-simulator/input_data/$i.json \
    --mode bag \
    --bag_file /apollo-simulator/output_data/$i/$i.output.bag
done
```

### 在 Python 脚本中调用

```python
import sys
sys.path.insert(0, '/apollo_workspace')

from collections import deque
from grading_system_py.condition.speed_handler import SpeedConditionHandler
from grading_system_py.condition.ttc_handler import TtcConditionHandler
from grading_system_py.main import (
    GradingWorld, Object, DetailedResult, GradingEngine,
    parse_config_file, _fill_endpoint_from_scenario
)

# 方式1: 使用完整引擎
config = parse_config_file('/apollo_workspace/metric/1.json')
engine = GradingEngine(config)

# 喂入每帧数据
world = GradingWorld()
world.timestamp_sec = 1.0
world.auto_driving_car.speed = 15.0
world.auto_driving_car.position_x = 100.0
world.auto_driving_car.position_y = 0.0
# ...

results = engine.feed_frame(world)
summary = engine.get_summary()

# 方式2: 单独使用某个 handler
handler = TtcConditionHandler()
# ... (参见 example_usage.py)
```

### 调整评分帧率

```bash
# 默认 0.1s 一帧 (10 Hz)
python3 main.py --config ... --mode bag --bag_file ... --interval 0.1

# 更高精度: 50ms 一帧 (20 Hz)
python3 main.py --config ... --mode bag --bag_file ... --interval 0.05

# 更快处理: 1s 一帧 (1 Hz)
python3 main.py --config ... --mode bag --bag_file ... --interval 1.0
```

## 环境要求

| 模式 | Python | 依赖 |
|------|--------|------|
| demo | >= 3.6 | 无 |
| bag | >= 3.6 | Apollo Cyber Python (`/opt/apollo/neo/python/`) |
| channel | >= 3.6 | Apollo Cyber Python + Cyber 运行时 |

如果 import 报错，确保:

```bash
# Apollo 环境下通常已自动配置
export PYTHONPATH=/opt/apollo/neo/python:$PYTHONPATH
```
