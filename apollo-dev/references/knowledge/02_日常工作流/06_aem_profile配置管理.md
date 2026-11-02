# aem profile 配置管理

> 作者: 宇新 | 发布时间: 2024-05-10 | 链接: https://apollo.baidu.com/community/article/1271

`aem profile` 用于管理 Apollo 的配置参数目录，支持多份配置切换，方便调参和快速回滚。

---

## 1. 同步配置参数到 profile 目录

将某个包的配置文件同步到 `profiles/<目录名>/` 下：

```bash
buildtool profile config init --package <包名> --profile=<目录名>
```
示例：将 planning 包的全部配置文件同步到 `profiles/default/`：

```bash
buildtool profile config init --package planning --profile=default
```
> **注意：** 自己新增的 planning 插件无法通过该命令同步，需手动复制配置文件到对应 profile 目录。

如需对 planning 其他插件调参，包名请查阅：[Apollo Planning 文档](https://apollo.baidu.com/docs/apollo/latest/md_collection_2planning_2README__cn.html)

[](../images/02_安装部署/f09cf205d2de436e378862443b474a9c.png)

---

## 2. 使配置参数生效

启用某份配置：

```bash
aem profile use default
```
查看当前 `current` 软链指向：

```bash
ll profiles/current
```
[](../images/02_安装部署/44745f0189f0536cd411988b2bccb7a6.png)

> **重点：** 如果本地下载了源码，可能导致配置参数不生效。出现此问题时，重新执行 `aem profile use default` 即可。

---

## 3. 配置参数不生效排查

**步骤 1：** 检查 profile 软链是否正确：

```bash
ll profiles/current
```
[](../images/02_安装部署/44745f0189f0536cd411988b2bccb7a6.png)

**步骤 2：** 检查 Apollo 内部配置是否指向 `current`（以 `planning_component` 为例）：

```bash
ll /apollo/modules/planning/planning_component/conf/
```
[](../images/02_安装部署/7a9c908c9ccab7ef1ba2ea55ad1c8525.png)

**步骤 3：** 如果指向不对，重新执行：

```bash
aem profile use default
```
查看源码目录：

```bash
ll modules/planning/planning_component/
```
[](../images/02_安装部署/0fbf6a104f72a2507b4d793c34e83097.png)

---

## 4. 多份配置切换

在 `profiles/` 目录下可以维护多份配置，适用于不同场景或对比调参。

目录结构示例：
```
profiles/
├── current -> demo_1   # 软链，指向当前启用的配置
├── default
├── demo_1
└── demo_2
```
`demo_1` 内部结构示例（只需保留需要修改的配置文件，其余由系统自动读取模块默认配置）：
```
demo_1/
└── modules
    └── planning
        └── planning_base
            └── conf
                ├── planning.conf
                ├── planning_config.pb.txt
                └── ……
```
切换配置命令：

```bash
# 查看已有的 profile
aem profile list

# 切换到指定配置
aem profile use default
aem profile use demo_1
```
> **优势：**
> - **场景适配**：不同EDU 场景使用不同配置，快速切换
> - **参数复用**：保留调优后的参数，避免重复工作
> - **快速回滚**：随时切回之前认为最好的配置
