---
name: apollo-dev
description: Apollo 分版本开发助手：同时覆盖 Apollo 11.0 源码手册与二次开发、官方应用实践文档、以及 Apollo EDU PnC（application-pnc）操作，并内置环境体检与版本判别。当用户遇到以下场景时使用此 Skill：(1) 11.0 源码结构与二次开发（TrafficRule/Scenario/Task/ControlTask 插件、线控底盘与新车型接入、模块结构/channel/proto/排障，依据 references/manual/ 54 篇源码蒸馏手册）(2) 官方应用实践参考（感知模型、Cyber、规划、CANBUS、定位等 61 篇，references/practice/）(3) EDU 版日常操作（电脑重启进入、aem/profile、场景解题、打包提交、Git）(4) 环境体检与版本判别（版本形态判断、profile 覆盖层/current 参数目录检测、conf 生效判定、换环境前置核对）(5) PnC 场景开发与硬件适配 (6) 11.0 代码级开发的 skill 导航：env 式路由到 12 个顶层专项 skill（architecture/build-test/debug/new-component/plugin-dev/planning-dev/control-dev/perception-dev/localization-dev/gnss-driver/hmi-dev/vehicle-sensor，注册表 plugins.yaml），改源码/加插件/加组件/调运行时时按意图 `skill` 加载对应 skill，并用 references/manual/ 作佐证。触发关键词：PnC、Planning、规划、场景、插件、TrafficRule、Scenario、Task、ControlTask、线控底盘、canbus、车型、新车型、11.0、源码、二次开发、感知、Cyber、channel、proto、profile、current、Dreamview、SimControl、buildtool install、mainboard、泊车、借道、人行道、动态避障、版本判别、conf 不生效、chassis、CANBUS、应用实践、Apollo EDU、每日开发、打包提交、Git。命令入口：/apollo-dev。
---

# Apollo EDU PnC 开发助手

集成日常工作流引导、PnC 场景开发、模块调试和知识库检索，覆盖 Apollo EDU（PnC 赛道）装好环境后的全部开发活动。

**文档分三层（先判版本再检索，见「版本判别与手册路由」）**：`references/knowledge/`（EDU 版）、`references/manual/`（11.0 源码）、`references/practice/`（官方应用实践）。
- EDU 版知识库（PNC/EDU 口径，[EDU·上游]）：`{BASE_DIR}/references/knowledge/`
- **11.0 源码级手册**（[11.0·实测]，源码蒸馏、行号可回源）：`{BASE_DIR}/references/manual/00_readme.md`（总入口）

**配置文件**：`{BASE_DIR}/config.yaml`
> `{BASE_DIR}` 为本 skill 加载时顶部显示的 "Base directory for this skill" 路径。

---

## 问题分流

| 问题类型 | 执行流程 |
|---------|---------|
| **11.0 代码级开发**（改/加某模块源码、插件、组件、调试运行时） | → 先做「11.0 开发 skill 路由」挑专项 skill，再回本 skill 查 `manual/` 佐证 |
| **任何问题先判版本**：11.0 源码结构/类位置/二次开发/两版差异 vs EDU 版操作 | → 先做「版本判别与手册路由」再检索 |
| 电脑重启/每日启动 | → 高频快答「电脑重启后怎么进入 Apollo」 |
| 打包提交、压缩包 | → 高频快答 + `02_日常工作流/09_赛事压缩包制作.md` |
| buildtool install / 下载代码 | → 高频快答「怎么下载 Planning 代码」 |
| profile 初始化 / 配置参数获取 | → 高频快答 + `02_日常工作流/06_aem_profile配置管理.md` |
| 编译后配置丢失 | → 高频快答「编译后配置参数丢失/被覆盖」 |
| Git 代码保存 / 回退 | → 高频快答 + `02_日常工作流/10_Git代码与配置管理.md` |
| Planning 模块打不开 | → 速查卡片「Planning 模块恢复」+ 检索 `07_FAQ故障排查/planning模块打不开恢复指南.md` |
| 模块在 DreamView 中打不开 | → 速查卡片「mainboard 单模块启动」 |
| **场景开发**（借道/交汇/人行道/泊车…）| → 先 Glob 文件名，再流程 B 检索 `03_规划PnC/` + `04_赛事集锦/` |
| 插件开发（TrafficRule/Scenario/Task）| → 流程 B 检索 `03_规划PnC/05_`~`07_` |
| Dreamview 使用、SimControl | → 流程 B 检索 `05_工程框架与工具/Dreamview功能介绍.md` |
| buildtool 编译错误（开发中） | → 检索 `07_FAQ故障排查/安装及编译问题FAQ——编译相关.md` |
| EDU 报名、EDU 规则 | → 流程 B 检索 `01_赛事竞赛/` |
| 硬件传感器、CAN 协议 | → 流程 B 检索 `08_硬件传感器/` |
| 地图、场景下载 | → 流程 B 检索 `09_地图资源/` |

---

## 11.0 开发模块路由（代码级开发先读这些专项模块）

本工作区为 **Apollo 11.0 package 工作区**（有 `setup.sh`，无 `apollo.sh`）。涉及**改源码、加插件/组件、调运行时**的 11.0 开发任务，**先读下表命中的专项模块 README 再动手**；它们已按 11.0 包形态逐条校对。

> **结构**：这 12 个专项能力内嵌在本 skill 的 `modules/<name>/` 下（每个是 `README.md` + 可选资料），**不是独立 skill、不会被自动触发**；注册表见 `{BASE_DIR}/plugins.yaml`。命中下表后，先读对应 `modules/<name>/README.md` 再动手。本 skill 的 `references/manual/`（源码级手册）是它们的佐证资料：**先用专项模块定方法，再回 `manual/` 查类位置 / 行号 / proto 字段**。

| 用户意图 / 关键词 | 模块（相对本 skill 根目录） | 对应 manual/ 佐证目录 |
|---|---|---|
| 不确定功能属哪个模块、从哪个文件入手、模块间 channel 走向、启动顺序、挑 skill —— **入口导航** | `modules/architecture/README.md` | `11_cyber框架/`、`14_数据与消息/` |
| 编译单模块、bazel 单测、lint、进 docker、定位编译/链接错误（alwayslink、apollo_package 漏调、proto 依赖、cyberfile.xml 漏写） | `modules/build-test/README.md` | `00_versions/02_...`、`15_二次开发手册/` |
| 运行时调试：模块起不来/不发消息、下游收不到、频率不对、崩溃、conf 没生效；cyber_monitor/channel/recorder、mainboard、record 回放、日志级别 | `modules/debug/README.md` | `11_cyber框架/`、`14_数据与消息/` |
| 新建 cyber 模块/Component、dag/launch/conf/cyberfile.xml、.so 不加载、Init 没调、Proc 收不到、Timer/消息触发组件 | `modules/new-component/README.md` | `15_二次开发手册/`、`11_cyber框架/` |
| 加/改插件（planning task/scenario/stage/traffic_rule/planner/pnc_map、perception 检测器/滤波器、control controller）、plugins.xml、注册不生效、CreateInstance 返回 nullptr、conf 找不到 | `modules/plugin-dev/README.md` | `15_二次开发手册/`、`12_planning源码/` |
| planning 加/改 task/scenario/stage/traffic_rule、调规划参数、规划不出轨迹/场景不切换/task 没调用/conf 没生效、openspace 泊车 | `modules/planning-dev/README.md` | `12_planning源码/` |
| 控制器（LQR/MPC/PID/ControlTask 插件）、横纵向控制参数、标定表 calibration_table、画龙/抖动/顿挫/过冲、ControlCommand 没发、prediction evaluator/predictor | `modules/control-dev/README.md` | `13_control源码/` |
| perception 加/改检测/分割/跟踪/滤波（lidar/camera/radar/fusion）、接模型/推理后端、pipeline conf、msg_adapter 离线调试、感知不出障碍物/模型加载失败/GPU 报错 | `modules/perception-dev/README.md` | `16_感知源码/` |
| 定位（RTK/NDT/MSF）融合代码与参数、新增观测、MSF 定位地图、IMU 安装角/GNSS 杆臂标定、定位不收敛/跳变/地图加载失败 | `modules/localization-dev/README.md` | `14_数据与消息/` |
| GNSS/INS 驱动：新增协议 parser（novatel/asensing/huace/rtcm）、串口/TCP/UDP/NTRIP/CAN 连接、报文 ID/输出 channel、GNSS 无数据/时间戳为 0/串口打不开/CRC 失败 | `modules/gnss-driver/README.md` | `14_数据与消息/` |
| DreamView/DreamView Plus 加面板或后端 WebSocket、HMI 模式、车型配置（calibration/data）、状态灯不亮/点云轨迹不显示/切车型无效、SimControl 与动力学模型 | `modules/hmi-dev/README.md` | `05_工程框架与工具/`（knowledge） |
| 适配新车型、CAN 报文协议、切 CAN 卡、接雷达/相机/毫米波/GNSS 驱动、传感器外参标定、底盘无反馈/不响应控制、点云图像不出数据 | `modules/vehicle-sensor/README.md` | `17_canbus底盘开发/` |

> 用法：**先读命中的那个 `modules/<name>/README.md`（必要时再读 `modules/plugin-dev/README.md`），按它的步骤改代码；需要确认「某类在哪个文件 / proto 字段 / 行号」时，再读本 skill 的 `manual/` 对应目录。** 两者冲突时以 `manual/00_versions/` 的实测结论为准（它比各专项 skill 更贴合本机）。

---

## 版本判别与手册路由（回答任何问题前先做这一步）

**文档分三层**：`references/knowledge/` = PNC/EDU操作口径；`references/manual/` = **Apollo 11.0 源码级手册**（本机 `/opt/apollo/neo/{src,include}` 实测蒸馏，覆盖 cyber/planning/control/感知/消息/二次开发）；`references/practice/` = **官方应用实践文档**（[官方·上游]，61 篇，9.0/latest 混标，动手前到 `manual/00_versions/02` 核对）。

先判环境（1 条命令）+ **认准 current 参数目录（每个环境必查）**：

```bash
# ① 判环境：有 setup.sh（package 工作区）→ 11.0 环境 → 用 manual/
#        有 application-pnc / aem profile use default 流程 → PNC/EDU → 用 knowledge/
ls apollo.sh setup.sh .workspace.json 2>/dev/null

# ② 每个环境必查 profile 覆盖层（配置参数目录）：
ls /apollo_workspace/profiles/ 2>/dev/null               # 有哪些配置集
readlink /apollo_workspace/profiles/current 2>/dev/null   # current 指向哪套（当前生效）
readlink /apollo/modules/planning/planning_component/conf/planning.conf 2>/dev/null  # 抽查一个落点
```

**`profiles/current` = 当前环境的参数目录（软链接，可改）**：
- current 指到的配置集（如 `ARCF_40P`）就是**现在生效的参数树**；`readlink profiles/current` 看指向。
- current 本身是**软链接、可更改**：`ln -sfn <新配置集> /apollo_workspace/profiles/current` 即切换当前配置集（**改前先 `readlink` 记住原指向以便回退**）。
- ④ 层（`/apollo/<sp>/conf`、`dag`）的文件**多数软链指向 current** → 改 `/apollo/<sp>/conf/*` = 写穿到 current 配置树，**立即生效、不被 install 覆盖**。
- 落点是 `/opt/apollo/neo/share/...` 的是**出厂件**，改了会被下次 install 覆盖；落点是工作区源码副本的，要 `buildtool build -p` 重编才生效。CLAUDE.md 旧口径「④ 层一律指向 share」已过期（本机 2026-09-08 实测 374 条→profile / 339 条→share）。

**修改参数类任务，优先改 current 指向的那套配置**（写穿即生效），不是 share 出厂件、不是工作区源码副本；完整检测命令见 `manual/00_versions/02_在本工作区动手前置核对清单.md` 第 2.5 步。

| 用户问什么 | 用哪层 / 去哪 |
|---|---|
| EDU 版操作：进入环境、打包提交、场景解题、SimControl、EDU FAQ、下载源码 | knowledge/ + 高频快答 + 速查卡片（[EDU·上游]） |
| **11.0 源码事实**：某类在哪个文件、模块结构、channel/proto 字段、模块为何没输出 | `manual/00_readme.md` 的「按意图找文档」表（[11.0·实测]，先看版本核对清单 `manual/00_versions/02_...`） |
| 在 11.0 上加 TrafficRule/Scenario/Task/控制器插件 | `manual/15_二次开发手册/` |
| 感知模块结构（11.0） | `manual/16_感知源码/` |
| 两版命令/词汇/模块差异 | `manual/00_versions/`（00 基线对照 / 01 命令对照 / 02 核对清单） |
| EDU 版知识原文定位与版本归属 | `manual/pnc_赛事版/00_知识归属与差异标注表.md` |
| **官方应用实践**（线控底盘/CANBUS、感知模型、Cyber/规划实践教程，9.0/latest 口径） | `references/practice/00_索引.md`（关键词→文件 + 与 manual/ 互链表） |
| 分不清归属 | 三层都检索，回答时标注来源层与版本标签 |

> ⚠️ knowledge/ 里的命令（`aem profile`、`profiles/default`、`aem bootstrap start --plus`）是**EDU 版口径**，在 11.0 环境照抄会失败——先对照 `manual/00_versions/01_命令与词汇对照.md`。

---

## 高频快答

以下问题无需检索知识库，直接回答：

| 问题 | 快速回答 |
|------|---------|
| 电脑重启后怎么进入 Apollo | `cd application-pnc && aem start && aem enter`，然后 `buildtool build -p core`（有代码改动时） |
| 怎么打包提交 | 只改了配置：`tar -zcvf 提交包.tar.gz profiles/default`；改了源码：`tar -zcvf 提交包.tar.gz modules/planning/ profiles/default` |
| 怎么下载 Planning 代码 | 先 `aem enter` 进入容器，再执行 `buildtool install planning*`（全量）或 `buildtool install planning-traffic-rules-crosswalk`（指定模块） |
| 怎么下载（获取）配置参数 | 方式 A（官方包）：`buildtool profile config init --package planning --profile=default`；方式 B（含自定义插件）：`mkdir -p profiles/default/modules && cp -r .aem/envroot/opt/apollo/neo/share/modules/planning profiles/default/modules/`，完成后执行 `aem profile use default` |
| profile 怎么初始化 | `buildtool profile config init --package planning --profile=default` |
| 日志太多/磁盘满了怎么清理 | 日志在 `data/log/` 下，历史日志可安全删除：`find data/log/ -name "*.log.*20[0-9][0-9]*" -type f -delete`；清理前先看大小：`du -sh data/log/` |
| 编译后配置参数丢失/被覆盖 | `buildtool build` 会覆盖 `profiles/` 下的软链配置。**编译后务必执行 `aem profile use default`** 恢复 profile 配置 |
| 怎么用 Git 保存代码和配置 | 宿主机执行：`git add profiles/default/ modules/planning/ && git commit -m "描述改动"`；不同场景用不同 branch：`git checkout -b scene/crosswalk`；切分支后记得重新执行 `aem profile use default` |
| 改坏了怎么用 Git 回退 | `git checkout HEAD -- profiles/default/`（回退配置）或 `git checkout HEAD -- modules/planning/`（回退代码） |

---

## 速查卡片

### mainboard 单模块启动

当某个模块在 DreamView 中打不开或行为异常时，在容器内用 `mainboard -d <dag路径>` 单独启动：

```
Planning:    mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag
路由:        mainboard -d /apollo/modules/external_command/process_component/dag/external_command_process.dag
Prediction:  mainboard -d /apollo/modules/prediction/dag/prediction.dag
Control:     mainboard -d /apollo/modules/control/control_component/dag/control.dag
```

> 排查时通常先启 Planning 看是否有 Segfault 或配置缺失。

### Planning 模块无法打开 / 代码恢复

> 所有命令在**容器内**（`aem enter` 后）的 `/apollo_workspace` 目录下执行。

```bash
# 1. 备份当前代码和配置
tar -zcvf planning_backup.tar.gz modules/planning/
tar -zcvf profiles_default_backup.tar.gz profiles/default/

# 2. 切到临时 profile，释放 default 软链
mkdir -p profiles/tmp
aem profile use tmp

# 3. 删除损坏的代码和配置
rm -rf profiles/default
rm -rf modules/planning

# 4. 重装所有 planning 包（恢复到官方初始状态）
buildtool reinstall planning*

# 5.（可选）重新拉取源码
buildtool install planning*

# 6.（可选）编译
buildtool build -p modules/planning/

# 7. 恢复 profile 配置
buildtool profile config init --package planning --profile=default
aem profile use default
```

---

## 典型工作流

### 工作流 1：改参数调优（最常见）

```
编辑 profiles/default 下的配置文件
  → aem bootstrap start --plus（启动仿真）
  → DreamView 中选择场景运行
  → 观察效果，调整参数
  → 满意后打包：tar -zcvf 提交包.tar.gz profiles/default
```

### 工作流 2：改源码开发

```
buildtool install planning*（拉取源码）
  → 修改 modules/planning/ 下的代码
  → buildtool build -p modules/planning/（编译）
  → aem profile use default（⚠️ 关键：恢复 profile 软链配置）
  → aem bootstrap start --plus（启动仿真验证）
  → 满意后打包：tar -zcvf 提交包.tar.gz modules/planning/ profiles/default
```

### 工作流 3：每日开发（电脑重启后）

```
cd application-pnc
  → aem start（启动容器）
  → aem enter（进入容器）
  → buildtool build -p core（如有代码改动则编译）
  → aem bootstrap start --plus（启动 DreamView）
```

---

## 流程 B：知识库检索

### Step 1：识别问题类型，确定搜索目录

**优先按场景名匹配文件名**：先 `Glob("*借道*")` 在 knowledge 目录下匹配，命中则直接读取，跳过 Grep。

文件名未命中时，参考下表缩小范围：

| 问题类型 | 优先目录 |
|---------|---------|
| PnC、Planning、规划 | `03_规划PnC/`（入口：`00_技术参考索引.md`）|
| **下载 Planning 代码**、buildtool install、下载配置参数 | `03_规划PnC/00_代码与配置下载指南.md` |
| TrafficRule / Scenario / Task 插件开发 | `03_规划PnC/05_`~`07_` |
| 具体EDU 场景（借道/交汇/人行道/泊车…）| `03_规划PnC/09_`~`17_` + `04_赛事集锦/` |
| Dreamview、仿真 SimControl | `05_工程框架与工具/Dreamview功能介绍.md`、`03_规划PnC/04_使用SimControl仿真调试.md` |
| **Planning 打不开、Planning 崩溃** | `07_FAQ故障排查/planning模块打不开恢复指南.md` |
| buildtool 编译报错（开发中） | `07_FAQ故障排查/安装及编译问题FAQ——编译相关.md`、`buildtool相关问题FAQ.md` |
| Dreamview 地图不加载 | `07_FAQ故障排查/dreamview地图不加载或场景不跳转.md` |
| 日志查看 | `07_FAQ故障排查/Apollo查看日志以及输出日志.md` |
| profile、包管理 | `02_日常工作流/06_aem_profile配置管理.md`、`05_工程框架与工具/` |
| **git、分支、回退、commit** | `02_日常工作流/10_Git代码与配置管理.md` |
| 电脑重启后进入 Apollo | `02_日常工作流/08_电脑重启后怎么进入Apollo.md` |
| 打包提交 | `02_日常工作流/09_赛事压缩包制作.md` |
| 传感器、CAN | `08_硬件传感器/` |
| 地图、场景下载 | `09_地图资源/` |
| EDU 报名、规则 | `01_赛事竞赛/` |

### Step 2：用 Grep 工具检索（禁止使用 Bash grep）

使用内置 **Grep 工具**在 `{BASE_DIR}/references/knowledge/` 中检索：

- 先搜文件列表，找到最相关的 1-3 个文件
- 用 `-C 3` 精准定位段落
- 多关键词重试：「安装」→「部署」→「初始化」

### Step 3：读取文件并回答

文件超 200 行先用 Grep 定位章节，再分段读取。

**回答格式**：
1. FAQ / 报错类 → 「症状 → 原因 → 命令」三段式
2. 场景开发类 → 核心代码逻辑 + 配置片段
3. 流程类 → 按步骤编号列出命令
4. 末尾注明来源：`（来源：文件名.md）`

### Step 4：未找到时

换同义词再试一次；仍无结果则基于 Apollo EDU 领域知识作答，并说明「本地知识库未找到直接记录」。

---

## 重要约束

- **编译后恢复 profile**：提醒用户在 `buildtool build` 后执行 `aem profile use default`，防止配置被覆盖
- **PnC 赛道专注**：EDU 版开发不涉及感知（Perception）、定位（Localization）等上游模块，不需要 GPU；11.0 源码手册 `manual/16_感知源码/` 仅作结构参考（本机 2026-09-08 实测 17 个模型目录中 12 个已有权重，`cnnseg*`/`point_pillars*`/`mask_pillars*` 仍缺，是否能运行还取决于 GPU/推理后端）
- **版本分层**：knowledge/ 与 manual/ 结论勿混用；跨版本表述必须带标签（[11.0·实测] / [EDU·上游] / [通用]）
- **sudo 操作必须确认**：涉及 `sudo` 的命令需用户确认后才执行
- **macOS 提示**：检测到 macOS 时不执行任何安装命令，仅提示在 Ubuntu 上操作

## 知识库目录结构（快速参考）

见 `{BASE_DIR}/references/knowledge_index.md`

## 文件结构

```
apollo-dev/
├── _meta.json
├── config.yaml
├── SKILL.md
├── README.md
└── references/
    ├── knowledge_index.md    # EDU 版知识库索引
    ├── knowledge/            # EDU 版知识库（[EDU·上游]，51 篇）
    │   ├── 01_赛事竞赛/
    │   ├── 02_日常工作流/    # 4 个文件（profile、重启、打包、Git）
    │   ├── 03_规划PnC/       # 19 个文件
    │   ├── 04_赛事集锦/      # 11 个文件
    │   ├── 05_工程框架与工具/
    │   ├── 06_技术培训/
    │   ├── 07_FAQ故障排查/   # 7 个文件（开发相关）
    │   ├── 08_硬件传感器/
    │   └── 09_地图资源/
    └── manual/               # 11.0 源码级手册（[11.0·实测]，入口 00_readme.md）
        ├── 00_versions/      # 版本差异层（3 份）
        ├── 11_cyber框架/     # 4 份
        ├── 12_planning源码/  # 15 份
        ├── 13_control源码/   # 4 份
        ├── 14_数据与消息/    # 5 份
        ├── 15_二次开发手册/  # 5 份
        ├── 16_感知源码/      # 10 份
        ├── 17_canbus底盘开发/
        └── pnc_赛事版/       # EDU 版标注层（2 份）
```

> **11.0 代码级开发路由到 12 个顶层专项 skill（env 式，照常自动触发）**：
> `modules/architecture/` / `modules/build-test/` / `modules/debug/` / `modules/new-component/` / `modules/plugin-dev/` /
> `modules/planning-dev/` / `modules/control-dev/` / `modules/perception-dev/` / `modules/localization-dev/` /
> `modules/gnss-driver/` / `modules/hmi-dev/` / `modules/vehicle-sensor/`。注册表 `plugins.yaml`，本 skill 的 `manual/` 为其佐证。
