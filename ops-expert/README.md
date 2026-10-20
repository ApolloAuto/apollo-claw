# Apollo Ops Expert

Apollo 运维与开发技能包，附带一个 DSH Web 侧边栏插件。

## 包含什么

| 组成 | 说明 |
|---|---|
| 21 个 skill | 8 个运维 + 13 个 Apollo 11.0 开发 |
| 2 个 agent 预设 | 「Apollo 运维工程师」「Apollo 开发工程师」，两者能看到的 skill 互不重叠 |
| 1 个 Web 插件 | 侧边栏 Apollo Ops Expert：Cyber 通道监控、传感器链路、运行控制、清理存储 |

**运维类（8 个）**

`apollo-env`（导航入口）、`apollo-env-check`（环境检测）、`apollo-install`（安装与诊断）、
`apollo-vehicle-restore`（车型配置切换/恢复/回滚）、`apollo-vehicle-usage`（车辆使用问答）、
`apollo-gnss-config`（NTRIP 基站）、`apollo-lidar-config`（激光雷达）、`apollo-camera-config`（相机）

**开发类（13 个）**

`apollo-dev`（总入口）、`apollo-architecture`（代码结构导航）、`apollo-build-test`（编译与测试）、
`apollo-debug`（运行时排障）、`apollo-new-component`（新建模块）、`apollo-plugin-dev`（插件开发）、
`apollo-planning-dev`、`apollo-control-dev`、`apollo-perception-dev`、`apollo-localization-dev`、
`apollo-gnss-driver`、`apollo-hmi-dev`、`apollo-vehicle-sensor`

## 安装

前置：Node.js 22+、pnpm、已安装 `@deepseek-ai/dsh`。

```bash
curl -fsSL https://raw.githubusercontent.com/ApolloAuto/apollo-claw/EDU/ops-expert/install.sh | bash
```

装完重启：

```bash
dsh web
```

安装过程会自动完成：装插件 → 装 21 个 skill → 装两个预设并接线 → 生成 skill 作用域视图。

想指定默认预设：

```bash
curl -fsSL https://raw.githubusercontent.com/ApolloAuto/apollo-claw/EDU/ops-expert/install.sh \
  | bash -s -- --default apollo-env
```

## 使用

### 1. 选预设

Web 界面的预设选择器里会出现：

- **Apollo 运维工程师** —— 只能看到 8 个运维 skill
- **Apollo 开发工程师** —— 只能看到 13 个开发 skill

标准模式不受影响，21 个 skill 全部可用。

### 2. 用 skill

直接用自然语言说需求，agent 会自动加载对应 skill：

| 你说 | 走哪个 |
|---|---|
| 环境检测一下 / Docker 起没起 | `apollo-env-check` |
| 帮我装 Apollo / buildtool 报错 | `apollo-install` |
| 把车配置成 HQEV | `apollo-vehicle-restore` |
| 基站连不上 / NTRIP 检查 | `apollo-gnss-config` |
| 雷达点云没数据 | `apollo-lidar-config` |
| 磁盘满了，清一下录包 | 清理存储（先预览，确认后执行） |
| planning 不出轨迹 | `apollo-planning-dev` |
| 加一个新的 cyber 模块 | `apollo-new-component` |

也可以直接敲命令：`/apollo-env`、`/apollo-env-check`、`/apollo-install`、`/apollo-lidar-config` 等。

### 3. 用插件

侧边栏底部「Apollo Ops Expert」：

- **Cyber 通道**：观看在用 channel 的发布频率
- **传感器链路**：GNSS / 激光雷达 / 相机的 IP 与连通状态
- **运行控制**：启停 DreamView、关闭所有模块、清理存储
- **终端 / 文件**：不用切窗口就能在工程里操作

## 验证

```bash
dsh --profile web --dump-config | grep -E 'id: preset-apollo|ui-apollo-ops'
```

应当能看到 `preset-apollo-env`、`preset-apollo-dev` 和 `ui-apollo-ops`。

## 卸载

```bash
dsh plugin --profile web remove @apollo-ops/dsh-client-ui-apollo-ops
rm -rf ~/.dsh/.agent-presets/apollo-env ~/.dsh/.agent-presets/apollo-dev
```

再从 `~/.dsh/profiles/web/cordis.patch.yml` 里删掉 `preset-apollo-env` / `preset-apollo-dev` 两段，重启 `dsh web`。

## 环境要求

- 运维类 skill 需要在 Apollo 工作区执行（存在 `/apollo_workspace`、`/opt/apollo/neo`）
- 开发类 skill 需要 Apollo 11.0 源码树
- 不满足时 skill 仍可加载，但具体命令会提示先准备环境

## 清理存储说明

侧边栏「清理存储」和自然语言「清理录包」是同一个动作，清理范围仅限 `/apollo_workspace/data/` 下：

- `record/`、`records/`、`core/` 的**内容**（保留目录本身）
- `log/` 里**不以 `.INFO` 结尾**的日志（`.INFO` 保留）

执行前一定会先给出「将删除多少条目、释放多少空间」的预览，确认后才真正删除。这是清磁盘，不是清内存。
