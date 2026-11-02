---
name: apollo-eval
description: Apollo EDU PnC 赛道仿真评估与评分分析工具。用于解释评分标准、对已有赛事数据包执行离线完整评分、分析仿真评分结果、解读 ReachEnd、TimeLimit、Collision、OnRoad、SpeedLimit、AccelerationLimit、CentripetalAccelerationLimit 等通过/扣分情况，并给出排查和调参建议。适用场景包括：/apollo_workspace/peixun/ 这类包含 metric.json、scenario.json 或 scenrio.json、*.output.bag 的本地赛事数据包评分；/apollo-simulator/output_data/ 的赛事输出评分；已有 record/bag 的体感指标分析；仿真运行中的实时体感指标观察。录制 cyber record、采集数据包、回放调试闭环属于 apollo-test skill，不属于 apollo-eval 主职责。不要把本 Skill 描述为录包工具、测试工具、全自动仿真托管、自动提交或官方评分替代。触发关键词：apollo-eval、仿真评估、赛事评分、评分标准、metric.json、scenario.json、scenrio.json、output.bag、ReachEnd、SpeedLimit、AccelerationLimit、CentripetalAccelerationLimit、加速度、jerk、急刹车、场景未通过、如何提分、优化建议。
---

# Apollo EDU PnC 赛道评估分析助手

帮助赛手量化仿真结果、理解评分规则、生成评估报告并给出针对性调参建议。

**脚本目录**：优先使用当前 Skill 自带脚本目录
`${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts/`（本 skill 加载目录下的 scripts/）。
不要使用任何机器专属的旧绝对路径。

后文用 `$SKILL_SCRIPTS` 表示实际存在的脚本目录。

执行脚本前先初始化路径：

```bash
SKILL_SCRIPTS=${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts
if [ ! -d "$SKILL_SCRIPTS" ]; then
  SKILL_SCRIPTS=${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts
fi
```

---

## 工具速览

| 工具 | 用途 | 何时用 |
|------|------|--------|
| `scripts/realtime_monitor.py` | 实时订阅 `/apollo/planning/trajectory`，逐帧打印体感指标 | 仿真正在运行时，边跑边看 |
| `scripts/extract_metrics.py` | 离线读取已有 cyber record，输出体感指标报告 | 已经有 record，需要评分/分析；录制 record 请转 `apollo-test` |
| `scripts/grading_system_py/main.py` | 完整评分系统（含 ReachEnd/Collision/SpeedLimit 等） | 赛事标准 bag，需 `metric.json` + `scenario.json/scenrio.json` |

> **区分关键**：`extract_metrics.py` 只评体感；`grading_system_py` 才能评场景通过/未通过。

---

## 问题分流

| 用户意图 | 执行流程 |
|---------|---------|
| `/apollo-eval`（无参数）| → 问诊流程 |
| `/apollo-eval monitor` | → 流程 A：实时监控 |
| `/apollo-eval auto` | → 转 `apollo-test` 录包；录完后回到流程 C/E 评估 |
| `/apollo-eval score` | → 直接输出评分维度速查表 |
| `/apollo-eval report` | → 流程 C：已有 bag/record 的体感报告 |
| `/apollo-eval optimize` | → 流程 D：优化建议 |
| 仿真跑完有 bag，想看全部评分 | → 流程 E：完整赛事评分 |
| 体感超限/急刹车/Jerk 大 | → 流程 D：优化建议 |
| 场景停车不动/到不了终点 | → 流程 D：性能排查 |

---

## 问诊流程（`/apollo-eval` 无参数）

收到 `/apollo-eval` 时，先问以下两个问题引导用户，再进入对应流程：

**Q1：你现在的状态是哪种？**
- A）仿真正在运行，想边跑边看数据 → 推荐流程 A（`/apollo-eval monitor`）
- B）仿真跑完了，有 `.record`/`.bag` 或赛事输出目录 → 追问 Q2
- C）不清楚评分规则，想先了解 → 输出评分速查表
- D）有超限问题，想要调参建议 → 推荐流程 D（`/apollo-eval optimize`）

**Q2（仅 B 时问）：你的 bag 文件来源？**
- A）已有普通 record（通常由 `apollo-test` 录制）→ 流程 C（`extract_metrics.py`，只评体感）
- B）赛事模拟器产出的，或一个目录内含 `metric.json` + `scenario.json/scenrio.json` + `*.output.bag/*.record` → 流程 E（`grading_system_py`，完整评分）

---

## 评分速查（`/apollo-eval score`）

### 评分维度总览

| 维度 | 类型 | 评分方式 | 说明 |
|------|------|---------|------|
| ReachEnd（到达终点） | 性能 | 得分制，到达=100，未到达=0 | **最高优先级** |
| TimeLimit（超时） | 性能 | 得分制，未超时=100，超时=0 | |
| Collision（碰撞） | 性能 | 扣分制，碰撞扣 100 分 | |
| OnRoad（在路） | 性能 | 扣分制，出路面扣分 | |
| ObstacleBypass（绕行） | 性能 | 扣分制，横距/速度不达标扣分 | |
| TTC（碰撞时间） | 性能 | 扣分制，TTC 过小扣分 | |
| SpeedLimit（速度合规） | 体感 | 扣分制，超速每 1 m/s 扣 2 分 | |
| AccelerationLimit（纵向加速度）| 体感 | 扣分制，超限每 1 m/s² 扣 5 分 | |
| HardBrake（急刹车） | 体感 | 扣分制，每次扣 10 分 | |
| CentripetalAccelerationLimit（横向加速度）| 体感 | 扣分制，超限每 0.5 m/s² 扣 3 分 | |

### 体感阈值速查

```
┌─────────────────────────────────────────────────────────────┐
│  指标              阈值          超限表现                     │
├─────────────────────────────────────────────────────────────┤
│  纵向加速度 aₓ    ≤ 3.0 m/s²   急加速 / 急制动              │
│  纵向 Jerk jₓ    ≤ 4.0 m/s³   速度突变，乘客被甩感          │
│  横向加速度 aᵧ   ≤ 2.0 m/s²   高速急转弯                    │
│  急刹车           0 次          减速度 > 4.0 m/s²            │
│  角速度 spin      ≤ 45 °/s     急打方向盘                    │
└─────────────────────────────────────────────────────────────┘
```

**优化优先级：先保场景通过（性能分），再优化体感（舒适分）。**

---

## 流程 A：实时监控体感指标

适用：仿真正在运行，想实时看每帧的加速度/Jerk 是否超限。

### 启动

在 Apollo 容器内执行（需先 `aem enter`）：

```bash
python3 "$SKILL_SCRIPTS/realtime_monitor.py"
```

自定义阈值：

```bash
python3 "$SKILL_SCRIPTS/realtime_monitor.py" \
  --lon-accel-max 2.5 \
  --jerk-max 3.0 \
  --lat-accel-max 1.8
```

### 输出示例

```
===== Apollo 体感指标实时监控 =====
已连接 /apollo/planning/trajectory
阈值：aₓ≤3.0 m/s²  jₓ≤4.0 m/s³  aᵧ≤2.0 m/s²  急刹车>4.0 m/s²

[ 12.3s] v= 4.20m/s  a= +1.80m/s²  j= +0.50m/s³  ay= 0.10m/s²  ✅
[ 12.5s] v= 4.00m/s  a= +3.20m/s²  j= +7.00m/s³  ay= 0.12m/s²  纵向加速度超限(3.20>3.0)  Jerk超限(+7.00>4.0)
[ 12.7s] v= 3.80m/s  a= -4.50m/s²  j= -37.50m/s³ ay= 0.11m/s²  急刹车！(-4.50<-4.0)
```

按 `Ctrl+C` 停止，输出完整统计报告。

---

## 流程 B：需要录制数据包时转交 apollo-test

`apollo-eval` 不负责录制 cyber record。用户要录包、采集仿真数据、回放调试或执行完整数据包调试闭环时，切换到 `apollo-test`：

```bash
/apollo-test bag
```

`apollo-test` 负责使用 `record_pnc_sim.sh` 录制 PnC 仿真 record，并做数据包分析/回放验证。录制完成后，如果用户要做评分或体感指标评估，再回到：

- 流程 C：已有普通 record 的体感指标报告
- 流程 E：已有赛事标准数据包的完整评分

---

## 流程 C：体感指标报告（用户自己的 bag）

适用：已有 `.record` 文件，只需评估体感指标（加速度/Jerk/急刹车）。如果还没有 record，先用 `apollo-test` 录制。

```bash
python3 "$SKILL_SCRIPTS/extract_metrics.py" \
  /path/to/your.record
```

输出示例：

```
==============================================================
   Apollo EDU PnC 体感指标评估报告
==============================================================
  录包  : /apollo_workspace/data/bag/test.record
  帧数  : 1250  时长: 62.3 s
  速度  : 最大 8.33 m/s (30.0 km/h)  均值 4.21 m/s

┌────────────────────────────────────────────────────────────┐
│  指标              实测最大值    阈值       结论            │
├────────────────────────────────────────────────────────────┤
│  纵向加速度 aₓ       1.85 m/s²  ≤3.0    ✅ 通过           │
│  纵向 Jerk jₓ        3.20 m/s³  ≤4.0    ✅ 通过           │
│  横向加速度 aᵧ       1.12 m/s²  ≤2.0    ✅ 通过           │
│  急刹车次数             0 次    =0      ✅ 通过            │
│  角速度 (最大)        18.5 °/s   ≤45     ✅ 通过           │
└────────────────────────────────────────────────────────────┘

  ✅ 体感指标全部通过，无扣分。
```

---

## 流程 D：优化建议

### 体感超限调参映射

收到超限描述后，给出以下对应建议：

| 超限类型 | 调参方向 | 排查命令 |
|---------|---------|---------|
| 纵向加速度超限（aₓ > 3.0） | 降低 `max_acceleration` / `max_deceleration` | 搜索 planning conf 中 `max_acceleration` |
| Jerk 超限（jₓ > 4.0） | 增大 `jerk_limit` 约束；检查速度规划平滑度 | 搜索 `longitudinal_jerk` 相关参数 |
| 横向加速度超限（aᵧ > 2.0） | 降低过弯速度限制；增大转向平滑约束 | 搜索 `centripetal_acceleration` 参数 |
| 急刹车次数 > 0 | 排查 TrafficRule 是否产生了不合理的停止决策 | `grep "stop_reason" /apollo_workspace/data/log/planning.INFO \| tail -30` |
| SpeedLimit 扣分 | 检查地图限速设置；降低 planning 的 `max_speed` | 搜索场景 JSON 中 `speed_limit` 字段 |

**修改参数后必须执行：**

```bash
aem profile use default
```

### 性能指标未通过排查

| 场景 | 排查步骤 |
|------|---------|
| ReachEnd=FAIL（未到达终点） | 检查路由是否正确设置；查 planning 日志确认是否有持续停止决策 |
| 停车不动 | `grep "stop_reason" /apollo_workspace/data/log/planning.INFO \| tail -20` |
| TimeLimit=FAIL（超时） | 优先提升平均速度；排查路途中的不必要减速点 |
| Collision=FAIL（碰撞） | 查看障碍物检测是否正常；检查 TTC 阈值设置 |
| OnRoad=FAIL（出路） | 检查借道/换道逻辑；确认地图边界是否正确加载 |

---

## 流程 E：完整赛事评分（grading_system_py）

适用：有赛事标准 bag，需要完整评分。常见输入有两类：

- 赛事输出目录：`/apollo-simulator/output_data/<场景号>/<场景号>.output.bag`
- 本地数据包目录：同一目录下有 `metric.json`、`scenario.json` 或错拼的 `scenrio.json`、以及 `*.output.bag`/`*.record`

### 执行规则

1. 先确认输入目录文件：

```bash
find /path/to/data_dir -maxdepth 1 -type f -printf '%f\n' | sort
```

2. 如果看到 `metric.json` 和 `scenrio.json`，不要报错；`scenrio.json` 是常见错拼，但脚本 `--scenario` 可以直接读取。
3. `grading_system_py/main.py` 需要 Apollo Cyber Python 包。执行时必须设置：

```bash
PYTHONPATH=/opt/apollo/neo/python:$SKILL_SCRIPTS
```

4. 推荐从 `$SKILL_SCRIPTS` 目录执行，或把 `$SKILL_SCRIPTS` 加到 `PYTHONPATH`，否则可能出现 `No module named grading_system_py`。
5. 如果出现 `No module named cyber`、`No module named cyber.python.cyber_py3`，不要改脚本，先补 `PYTHONPATH=/opt/apollo/neo/python:$SKILL_SCRIPTS`。
6. 输出很长时可以先用 `--interval 1.0` 做快速诊断；正式复核用默认 `--interval 0.1`。

### 本地数据包目录评分（优先用）

用户给出类似 `/apollo_workspace/peixun/` 的目录时，优先按这个模板执行：

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

如果目录下不是 `1.output.bag`，先列文件，选择实际的 `*.output.bag` 或 `.record` 作为 `--bag_file`。

### 单场景评分

```bash
SKILL_SCRIPTS=${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts
PYTHONPATH=/opt/apollo/neo/python:$SKILL_SCRIPTS \
python3 "$SKILL_SCRIPTS/grading_system_py/main.py" \
  --config /apollo_workspace/metric/<场景号>.json \
  --scenario /apollo-simulator/input_data/<场景号>.json \
  --mode bag \
  --bag_file /apollo-simulator/output_data/<场景号>/<场景号>.output.bag
```

### 批量评分

```bash
for i in 1 2 3 4 5; do
  echo "=== 场景 $i ==="
  SKILL_SCRIPTS=${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts
  PYTHONPATH=/opt/apollo/neo/python:$SKILL_SCRIPTS \
  python3 "$SKILL_SCRIPTS/grading_system_py/main.py" \
    --config /apollo_workspace/metric/$i.json \
    --scenario /apollo-simulator/input_data/$i.json \
    --mode bag \
    --bag_file /apollo-simulator/output_data/$i/$i.output.bag
done
```

### 输出示例

```
============================================================
  GRADING SUMMARY
============================================================
  Scenario: FAIL

  Metric                    Result   Score    Fail/Total
  ------------------------- -------- -------- ------------
  ReachEnd                  FAIL     0        313/313   ← 未到达终点
  CentripetalAccelerationLimit FAIL  88       4/313
  AccelerationLimit         PASS     100      0/313
  TimeLimit                 PASS     100      0/313
  Collision                 PASS     100      0/313
  OnRoad                    PASS     100      0/313
  SpeedLimit                PASS     100      0/313
```

### Demo 模式（无需 Apollo 环境，验证脚本可用）

```bash
SKILL_SCRIPTS=${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts
PYTHONPATH=$SKILL_SCRIPTS \
python3 "$SKILL_SCRIPTS/grading_system_py/main.py" \
  --config /apollo_workspace/metric/1.json \
  --mode demo
```

---

## 重要约束

- **不替代官方评分**：本 Skill 提供自评估，实际得分以官方评测系统为准
- **PnC 专注**：不涉及感知（Perception）、定位（Localization）等上游模块
- **修改参数后必须提醒**：每次给出调参建议时，必须附上 `aem profile use default`
- **职责边界**：录制 cyber record、采集数据包、回放验证和测试闭环属于 `apollo-test`；`apollo-eval` 只分析已有数据和仿真评分结果
- **环境要求**：实时订阅需要在 `aem enter` 后的 Apollo 容器内运行；离线 bag 评分可在具备 `/opt/apollo/neo/python` 的环境运行，但必须设置 `PYTHONPATH=/opt/apollo/neo/python:$SKILL_SCRIPTS`
- **路径解析**：脚本目录就在本 skill 的 `scripts/` 下，用 `${DSH_HOME:-$HOME/.dsh}/skills/apollo-eval/scripts`；不要照抄本文档里的任何机器专属绝对路径。

---

## 文件结构（实际存在）

```
apollo-eval/
├── SKILL.md
└── scripts/
    ├── realtime_monitor.py          # 实时监控（订阅 planning/trajectory）
    ├── extract_metrics.py           # 离线体感评估（读取 localization/pose）
    └── grading_system_py/
        ├── main.py                  # 完整评分入口
        ├── README.md                # 各评分模块详细说明
        ├── USAGE.md                 # 命令行用法示例
        ├── common/                  # 几何库、地图接口
        ├── condition/               # 10 个评分 handler
        └── tests/                   # 单元测试
```
