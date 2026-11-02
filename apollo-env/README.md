# apollo-env

> 版本：2.0.0 | 形态：导航入口 + 7 个功能模块

## 简介

`apollo-env` 是 Apollo 环境能力的入口 skill。它本身只做意图识别和路由，具体步骤、脚本和参考资料放在 `modules/` 下的对应目录里。

这些模块是**文档 + 脚本**，不是独立注册的 skill，不会单独触发；命中需求后先读对应 `modules/<name>/README.md`，再按其步骤执行。

## 功能模块

| 模块 | 能力 | 主要脚本 |
|---|---|---|
| `modules/env-check/` | 检查 OS、CPU、内存、磁盘、网络、Docker、aem、buildtool | `scripts/env_check.sh` |
| `modules/install/` | 安装引导，编译与 profile 故障诊断 | `scripts/install.sh`、`scripts/diagnose.sh` |
| `modules/vehicle-restore/` | 车型配置切换、基线恢复/回滚、车型指纹、感知模型 | `scripts/restore_baseline.sh`、`scripts/restore_plan.py` |
| `modules/vehicle-usage/` | 车辆解锁、上电、充电和常见问题 | 纯说明 |
| `modules/gnss-config/` | NTRIP 基站配置与检查 | `scripts/check_ntrip_base.py`、`scripts/configure_ntrip_base.py` |
| `modules/lidar-config/` | 激光雷达型号、IP、端口、channel 配置 | `scripts/configure_lidar.py` |
| `modules/camera-config/` | 相机配置、检查与新增 | `scripts/` 下对应脚本 |

## 路由规则

| 用户意图 | 走哪个模块 |
|---|---|
| 切换车型配置、恢复、回滚、建立基线、车型指纹 | `modules/vehicle-restore/` |
| 车辆解锁、启动、充电、使用说明 | `modules/vehicle-usage/` |
| 配置或检查基站（NTRIP、RTCM） | `modules/gnss-config/` |
| 配置或检查雷达 | `modules/lidar-config/` |
| 配置、检查或新增相机 | `modules/camera-config/` |
| 环境检测、环境状态 | `modules/env-check/` |
| 安装 Apollo、编译报错、profile 故障 | `modules/install/` |
| 清理录包、core、非 `.INFO` 日志 | 本 skill 的 `scripts/clean_apollo_storage.sh` |

**防误判**：动作意图优先于车型关键词。「整成 HQEV 的配置」「切换车型」走 `vehicle-restore`；只有「HQEV 怎么解锁/充电」才走 `vehicle-usage`。

## 统一命令入口

`scripts/apollo-env.sh` 读取 `plugins.yaml` 动态分发子命令：

```bash
scripts/apollo-env.sh check                 # 环境检测
scripts/apollo-env.sh diagnose              # 安装/编译诊断
scripts/apollo-env.sh targets               # 列出可恢复车型
scripts/apollo-env.sh restore --target HQEV # 恢复车型基线
scripts/apollo-env.sh stamp                 # 车型指纹
scripts/apollo-env.sh gnss check            # 检查 NTRIP 基站
scripts/apollo-env.sh lidar list            # 列出雷达模板
scripts/apollo-env.sh camera list           # 列出相机模板
scripts/apollo-env.sh clean --dry-run       # 预览可清理的磁盘内容
```

`clean` 只处理 `/apollo_workspace/data/` 下的 `record`、`records`、`core` 内容和非 `.INFO` 日志，并带越界校验。必须先 `--dry-run` 预览、确认后再 `--yes` 执行；它清理的是磁盘存储，不是内存。

## 注册表与扩展

| 文件 | 作用 |
|---|---|
| `plugins.yaml` | 模块清单与命令路由 |
| `scripts/apollo-env.sh` | 按注册表分发子命令 |
| `references/knowledge_index.md` | 知识库总索引 |

新增能力：在 `modules/` 下新建模块目录（README + 脚本），在 `plugins.yaml` 的 `skills` 和 `routes` 登记，再更新本 README 与 `SKILL.md` 的路由表。
