---
name: apollo-env
description: Apollo 环境能力导航入口。根据用户需求路由到对应模块：环境检测（apollo-env-check）、安装与诊断（apollo-install）、车型配置切换/恢复（apollo-vehicle-restore）、车辆使用说明（apollo-vehicle-usage）。动作意图优先于车型关键词：整成/换成 HQEV 配置走 restore；HQEV 怎么解锁/充电才走 usage。其他能力：GNSS 基站（apollo-gnss-config）、激光雷达（apollo-lidar-config）、相机（apollo-camera-config）。触发关键词：恢复、回滚、基线、车型、基站、NTRIP、雷达、lidar、相机、camera、环境检测、安装、诊断、HQEV、车辆使用。命令入口：/apollo-env 及各子 skill 命令。
---

# Apollo 环境能力导航

本 skill 是导航入口，按用户需求路由到对应的功能子 skill，不直接承载具体功能。

## 路由防误判规则（读模块文档前必须执行）

1. **先识别动作与对象，再匹配关键词。** HQEV、ARCF_40P 等车型名只是目标参数，不能单凭车型名路由到车辆使用说明。
2. **区分配置变更与车辆操作。** 「切换车型」「换成 X」「整成 X 的配置」「配置成 X」「恢复 X」「回滚车型」属于车型配置变更，路由到 `modules/vehicle-restore/`；只有明确询问车辆解锁、上电、驾驶操作、充电或使用说明时才路由到 `modules/vehicle-usage/`。「启动」需结合对象判断：启动车辆操作与启动软件模块不是同一需求。
3. **具体对象优先。** 「给 HQEV 配基站 / 雷达 / 相机」分别路由到 GNSS / lidar / camera 子 skill，不因包含车型名而切换整车配置。安装、编译或 profile 故障诊断走 `modules/install/`，明确要求切换车型配置则走 `modules/vehicle-restore/`。
4. **调用前做反向核对。** 用一句话在内部确认「用户要执行的动作 → 子 skill 的职责」。若选中 usage，但用户要求的是修改 / 切换配置，必须纠正为对应配置技能，不得先调用 usage 试探。
5. **只对真正歧义提问。** 仅说「HQEV」「帮我弄一下车」时，先询问要切换配置还是查看使用方法；「整成 HQEV 的配置」意图已明确，不重复询问。复合请求分别处理，不用一个关键词覆盖所有动作。
6. **技能不可用不改变用户意图。** 路由表不是当前可用技能清单。对目录中未注册的子 skill，不盲目调用；可检查本地注册表和对应 `SKILL.md` 获取执行说明。调用返回 unknown / unavailable 后，不得改调职责不符的技能，也不得凭导航表猜测执行命令；找不到说明则明确报告缺失。切换车型前仍须按对应执行说明核对环境、目标配置和备份，不得直接写入未经核实的参数。

### 路由回归用例

修改本入口的路由规则时，必须逐条核对以下用例。它们是人工核对用例，不是已实现的自动化测试。

| 用户表达 | 期望路由 / 行为 | 禁止误判 |
|---|---|---|
| `/apollo-env 你给我整成HQEV的配置行吗` | `modules/vehicle-restore/` | 不调用 usage，不要求重复确认意图 |
| `切换成 HQEV` / `换成 ARCF_40P 的配置` | `modules/vehicle-restore/` | 不按车型名路由到 usage |
| `恢复 HQEV 基线` / `回滚车型配置` | `modules/vehicle-restore/` | 不当成车辆使用说明 |
| `HQEV 怎么解锁 / 充电` | `modules/vehicle-usage/` | 不修改车型配置 |
| `给 HQEV 配基站` | `modules/gnss-config/` | 不切换整车配置 |
| `给 HQEV 配雷达 / 相机` | `modules/lidar-config/` / `modules/camera-config/` | 不按车型名路由到 usage |
| `profile 切换报错，帮我诊断` | `modules/install/` | 不擅自恢复车型 |
| `HQEV` / `帮我弄一下车` | 先澄清具体动作 | 不猜测配置变更或车辆操作 |
| 车型切换子技能不可用 | 检查本地说明；缺失则报告阻塞 | 不回退到 usage，不猜命令 |

## 路由表

本 skill 是**唯一入口**。下表命中的能力都在本 skill 的 `modules/` 下，是文档+脚本，不是独立 skill ——
**先用文件读取打开对应 `README.md`，再按里面的步骤执行**。

| 需求 | 模块（相对本 skill 根目录） | 脚本入口 |
|---|---|---|
| 环境检测（OS/CPU/内存/磁盘/Docker/网络） | `modules/env-check/README.md` | `modules/env-check/scripts/env_check.sh` |
| 安装 Apollo / 编译诊断 / profile 故障 | `modules/install/README.md` | `modules/install/scripts/diagnose.sh` |
| 切换车型配置 / 恢复车型 / 回滚 / 建立基线 / 车型指纹 | `modules/vehicle-restore/README.md` | `modules/vehicle-restore/scripts/restore_plan.py` |
| 车辆解锁 / 启动 / 充电 / 常见问题 | `modules/vehicle-usage/README.md` | —（纯说明） |
| GNSS 基站配置 / 检查 | `modules/gnss-config/README.md` | `modules/gnss-config/scripts/configure_ntrip_base.py` |
| 激光雷达配置 / 检查 | `modules/lidar-config/README.md` | `modules/lidar-config/scripts/configure_lidar.py` |
| 相机配置 / 检查 / 新增 | `modules/camera-config/README.md` | `modules/camera-config/scripts/` |

## 清理存储（磁盘，不是内存）

用户说「清理录包 / 磁盘满了 / 清理 core / 清日志 / 清理存储」时，用本 skill 自带的清理脚本，**不要**手敲 rm。

- 脚本：`apollo-env/scripts/clean_apollo_storage.sh`；分发器命令：`clean`。
- 清理范围：`/apollo_workspace/data/` 下 `record`、`records`、`core` 目录内容 + `log` 里非 `.INFO` 结尾的日志（保留 `.INFO`）。只动 data/，有越界校验。
- **安全流程（务必照做）**：先 `apollo_ops_expert` 跑 `clean --dry-run` 预览将删条目数/占用，向用户复述并确认后，再跑 `clean --yes` 执行。不得跳过预览直接 `--yes`。
- 这是清**磁盘存储**，不是内存；如果用户把它叫「清理内存」，提醒一下实际清的是录包/日志/core。

## 使用方式

- 用户说「恢复 ARCF_40P」→ 路由到 apollo-vehicle-restore
- 用户说「配置基站」→ 路由到 apollo-gnss-config
- 用户说「配置雷达」→ 路由到 apollo-lidar-config
- 用户说「配置相机」→ 路由到 apollo-camera-config
- 用户说「HQEV 怎么解锁」→ 路由到 apollo-vehicle-usage
- 用户说「检查环境」→ 路由到 apollo-env-check
- 用户说「安装 Apollo」→ 路由到 apollo-install

## 保留的通用资源

| 文件 | 作用 |
|---|---|
| `plugins.yaml` | **插件注册表**：子 skill 清单 + 命令路由，`apollo-env.sh` 读它动态分发 |
| `scripts/apollo-env.sh` | 统一命令转发器（读 plugins.yaml 动态路由，不硬编码子 skill 路径） |
| `references/knowledge_index.md` | 知识库总索引 |
| `references/usage_examples.md` | 命令使用示例 |

## 插件机制（加新子 skill 只改注册表）

1. 新建子 skill 目录（SKILL.md + 脚本），放在 ``modules/` 目录 下；
2. 在 `plugins.yaml` 的 `skills` 加一行、`routes` 加命令映射（`run: scripts/xxx.sh` 或 `builtin: 函数名`）；
3. `apollo-env.sh` 自动按注册表分发，**主程序零改动**。
