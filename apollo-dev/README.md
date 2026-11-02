# apollo-dev Skill 使用文档

> 版本：2.0.0 | 定位：Apollo 分版本开发助手（11.0 源码手册 + 官方应用实践 + PnC）

---

## 一、简介

`apollo-dev` 是 **Apollo 分版本开发助手**：一个 skill 同时覆盖三层文档，并内置环境体检与版本判别，避免"整仓常识"与"本机实测"、"9.0 口径"与"11.0 现状"互相污染。

| 层 | 路径 | 口径 | 数量 |
|------|------|------|------|
| **11.0 源码手册** | `references/manual/` | [11.0·实测]，本机源码蒸馏、行号可回源 | 51 篇 |
| **官方应用实践** | `references/practice/` | [官方·上游]，Apollo 文档站应用实践 | 61 篇 |
| **EDU 版知识库** | `references/knowledge/` | [EDU·上游]，PnC 赛道 application-pnc | 51 篇 |
| **版本差异层** | `manual/00_versions/` | 11.0 vs PNC 差异 + 47 条漂移修正 | 3 篇 |

### 核心价值

- **分版本不混写**：每条结论带版本标签（`[11.0·实测]` / `[官方·上游]` / `[EDU·上游]`），来源可追溯
- **环境体检**：换环境第一步检测 profile 覆盖层/current 参数目录、判版本形态、核对 conf 生效落点
- **源码级答疑**：类在哪个文件、channel/proto 字段、插件怎么注册、模块为何没输出——带可回源行号
- **二次开发全流程**：TrafficRule/Scenario/Task/ControlTask 插件、线控底盘与新车型接入，从零到生效
- **EDU 版操作**：每日启动、aem/profile、10+ 场景解题、打包提交、Git

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      apollo-dev 架构                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  触发 ──→ 版本判别与手册路由（每个问题先做）                  │
│     │            │                                            │
│     │            ├─ 环境体检（profile 覆盖层/current 检测）    │
│     │            │                                            │
│     │            ├─ 11.0 源码问题 → manual/00_readme.md       │
│     │            │    ├─ 结构/排障 → 各分册                    │
│     │            │    ├─ 二次开发 → 15_二次开发手册/           │
│     │            │    └─ 线控底盘 → 17_canbus底盘开发/         │
│     │            ├─ 官方实践 → practice/00_索引.md             │
│     │            │    （感知/Cyber/规划/CANBUS/定位/上车）      │
│     │            └─ EDU 版操作 → knowledge/ + pnc_赛事版/      │
│     │                                                         │
│     ▼                                                         │
│  分层检索（grep/glob）→ 回答时标注来源层与版本标签             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、命令触发

```
/apollo-dev    # 通用入口
```

## 三、自然语言触发

> 11.0、源码、二次开发、插件、TrafficRule、Scenario、Task、ControlTask、线控底盘、canbus、车型、新车型、感知、Cyber、channel、proto、conf 不生效、profile、current、版本判别、环境体检、应用实践、CANBUS、PnC、Planning、规划、场景、泊车、借道、人行道、交汇、动态避障、Dreamview、SimControl、buildtool install、mainboard、打包提交、Git、Apollo EDU

---

## 四、典型使用场景

### 场景 A：环境体检（每个环境第一步）

```
/apollo-dev → 这个环境改 conf 生效在哪？
```

引导：`readlink profiles/current` + 抽查 `planning.conf` 落点 → 判定 profile 覆盖层 / share 出厂件，再决定改哪份。

### 场景 B：11.0 二次开发

```
/apollo-dev → 在 11.0 上加一个限速 TrafficRule
```

依据 `manual/15_二次开发手册/01_新增TrafficRule.md`：buildtool create → 六件套 → 注册 → 编译 install → 进配置 → 验证（含实测的参数坑）。

### 场景 C：线控底盘 / 新车型

```
/apollo-dev → 新车型怎么接入 Apollo？
```

依据 `manual/17_canbus底盘开发/03_新车型接入全流程.md` + `practice/42-44`（官方线控标准/CANBUS 生成/DBC 验证）交叉对照。

### 场景 D：EDU 版操作

```
/apollo-dev → 借道绕行场景怎么实现？
```

检索 `knowledge/03_规划PnC/` + `04_赛事集锦/`（EDU 版口径），与 11.0 差异看 `pnc_赛事版/00_知识归属与差异标注表.md`。

---

## 五、11.0 开发专项模块

代码级开发任务先读对应 `modules/<name>/README.md` 再动手；这些是文档 + 脚本，不是独立 skill。`references/manual/` 用于查类位置、行号和 proto 字段。

| 模块 | 适用场景 |
|---|---|
| `modules/architecture/` | 不确定功能属于哪个模块、从哪个文件入手、channel 走向、启动顺序 |
| `modules/build-test/` | 编译单模块、bazel 单测、lint、进 docker、链接错误 |
| `modules/debug/` | 模块起不来、不发消息、频率异常、崩溃、conf 不生效 |
| `modules/new-component/` | 新建 Cyber 模块或 Component、dag/launch/conf/cyberfile.xml |
| `modules/plugin-dev/` | 加改插件、plugins.xml、注册不生效 |
| `modules/planning-dev/` | Planning 的 task/scenario/stage/traffic_rule、规划参数、泊车 |
| `modules/control-dev/` | 控制器、横纵向参数、标定表、ControlCommand |
| `modules/perception-dev/` | 检测/分割/跟踪/滤波、模型与推理后端、感知 pipeline |
| `modules/localization-dev/` | RTK/NDT/MSF 融合、定位地图、安装角与杆臂标定 |
| `modules/gnss-driver/` | GNSS/INS 协议解析、串口/TCP/UDP/NTRIP 连接 |
| `modules/hmi-dev/` | DreamView 面板与接口、HMI 模式、车型配置、SimControl |
| `modules/vehicle-sensor/` | 新车型适配、CAN 报文、CAN 卡、传感器外参 |

## 六、文档指引

- **入口**：`references/manual/00_readme.md`（分层模型 + 意图检索表 + 文件清单）
- **写作规范**：`references/manual/_template.md`（八节骨架 + 版本标签铁律）
- **验收记录**：`references/manual/00_P5走查与抽查记录.md`
