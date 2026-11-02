# Apollo Ops Expert for DSH

Apollo Ops Expert bundles four Skills for Apollo EDU and Apollo 11.0 operations, development, testing and evaluation. The Skill definitions, scripts and references are stored separately from DSH integration, so compatible coding agents that support the `SKILL.md` layout can use the Skills without the DSH presets or Web plugin.

## Skills

| Skill | 功能 |
|---|---|
| `apollo-env` | 环境体检、Apollo 安装与诊断、车型基线恢复/回滚、GNSS/雷达/相机配置和车辆使用；7 个专项模块。 |
| `apollo-dev` | EDU 日常工作流及 Apollo 11.0 源码/实践；架构、Planning/Control/Perception/Localization、组件/插件、构建调试、GNSS 驱动、HMI 和传感器适配；12 个专项模块。 |
| `apollo-test` | Cyber record 录制、通道盘点、CSV/PNG/Markdown 报告和回放；批量回归、缺陷跟踪、构建/环境测试与排障；5 个专项模块。 |
| `apollo-eval` | 实时轨迹体感监控、已有 record 指标分析、标准数据包离线评分、扣分解释和优化建议；不负责录包。 |

各 Skill 的专项能力位于对应目录的 `modules/` 中。

## DSH presets

这些 presets 是为 DSH 的 Agent 选择器和 Skill 作用域设计的：

| Preset | Skills |
|---|---|
| Apollo 运维工程师 | `apollo-env` |
| Apollo 开发工程师 | `apollo-dev` |
| Apollo 测试工程师 | `apollo-test`、`apollo-eval` |

presets 通过 npm 包 `@apollo-ops/dsh-agent-presets` 安装。安装器会将预设接入指定 DSH profile，并生成对应的 Skill 作用域视图。

## DSH Web plugins

- `@apollo-ops/dsh-client-ui-apollo-ops`：添加 Apollo Ops 侧栏和插件页，显示工作区、当前 profile、车型与 Apollo 版本；提供工作区文件浏览/编辑及受控终端入口。
- `@apollo-ops/dsh-lan-access`（可选）：允许 LAN 直连 Web 界面。它会关闭 token 认证并绑定 `0.0.0.0`，仅应在可信网络中启用。

## Install

目标环境需先安装 DSH、Node.js/npm、curl 和 tar。安装客户端插件、四个 Skills 与 presets：

```bash
curl -fsSL https://raw.githubusercontent.com/ApolloAuto/apollo-claw/EDU/ops-expert/install.sh | bash
```

LAN 插件默认为关闭。仅在可信网络中需要 LAN 访问时执行：

```bash
curl -fsSL https://raw.githubusercontent.com/ApolloAuto/apollo-claw/EDU/ops-expert/install.sh | bash -s -- --with-lan
```

安装脚本做三件事：

1. 用 `dsh plugin` 安装 `@apollo-ops/dsh-client-ui-apollo-ops`。
2. 从仓库当前分支下载 `apollo-env`、`apollo-dev`、`apollo-test`、`apollo-eval` 四个目录，复制到 `$DSH_HOME/skills`；已有同名目录先备份为 `<skill>.bak.<时间戳>`。
3. 安装 `@apollo-ops/dsh-agent-presets`，把三个预设接入指定 profile。

脚本默认从 `ApolloAuto/apollo-claw` 的 `EDU` 分支读取 `ops-expert/github-assets/release.env` 和四个 Skill 目录；可用 `APOLLO_OPS_REPO`、`APOLLO_OPS_BRANCH` 指向其他仓库或分支。`--with-lan` 额外安装 `@apollo-ops/dsh-lan-access`。完成后重启 DSH Web。

单独安装客户端插件：

```bash
dsh plugin --profile web add @apollo-ops/dsh-client-ui-apollo-ops@2.0.0
```
