# 手册写作模板与规则（蒸馏 agent 必读）

> 本文件是 `references/manual/` 的写作规范，分两部分：**A. 铁律**、**B. 正文骨架**。
> 每个蒸馏任务开始前先读 `00_readme.md`（版本基线、标签、文件清单）再读本文件。

## A. 铁律（违反任何一条 = 返工）

1. **版本标签**：`manual/` 默认语境 = 本机 Apollo 11.0（11.0.0 包工作区）。全文断言默认 `[11.0·实测]`，可省略不写；只有出现**跨版本**表述（涉及 PNC/EDU/application-pnc 或 knowledge 文档说法）时强制写内联标签：`[11.0·实测]` / `[EDU·上游]`（knowledge/上游文档口径，未在本机验证）/ `[通用]`（两版机制一致）。禁止两版混写且不带标签。
2. **行号即证据**：写入手册的 `文件:行号` 必须是**本轮自己用 read 工具打开过**的行号。**grep 命中 ≠ 核对**：grep 只当线索，行号必须 read 打开后才能引用，否则只写路径或「待核」。没打开过的文件只写绝对路径、不写行号；检索到但没读到的内容写「待核」。写完自查一遍所有行号。front-matter `sources` 只列 read 打开过的文件（只精读部分行的标注范围，惯例 `（1–730 行精读）`）；§7 溯源另补 ls/diff/grep 证据与待核项。
3. **路径分层**（对应 CLAUDE.md 四层，引用时必须标清是哪层）：
   - 源码：`/opt/apollo/neo/src/...`（② 只读参考，可能不完整）或 `/opt/apollo/neo/include/...`（②′ 头文件树，比 src 全）。**src 与 include 两棵树都要搜**才能判断符号存不存在。
   - 运行/配置：`/apollo/<sp>/conf|dag|launch/`（④ 视口目录，内部文件是**符号链接**——用 `readlink` 判定落点：指向 `/apollo_workspace/profiles/current/<sp>/`（**profile 覆盖层**，实测 current→ARCF_40P，dag/多数 conf 在此）或 `/opt/apollo/neo/share/<sp>/`（出厂件）；改软链=写穿到落点、立即生效。**别假设一律指向 share**（CLAUDE.md 已过期，见 00_versions §5））。
   - 工作区（可改的源码副本）：`/apollo_workspace/<sp>/`（①）。
4. **不脑补**：查不到就写「未找到 / 待核」，禁止猜。判断「某模块/符号被删了」必须是两棵树都搜过之后的结论。
5. **扩展点必须可执行**：每处「怎么改」都要给具体文件 + 本环境存在的命令（`buildtool ...`、`cyber_*`、`mainboard -d`、`aem profile use default` 等），不给整仓形态命令（无 `apollo.sh`、无 `bazel-bin` 运行依赖——运行时只读 `/opt/apollo/neo/{lib,share}` 的 install 产物）。
6. **文件名照抄 `00_readme.md` 清单**，不自创；每份 ≤ 300 行；用 Markdown 表格表达清单类内容；交叉引用用相对链接（`../11_cyber框架/01_xxx.md`）。
7. **本环境坑必须进 ⚠️ 段**：conf 软链接写穿（落点 readlink 判定：profile 覆盖层或 share）、插件索引在 `/opt/apollo/neo/share/cyber_plugin_index/`（不扫 bazel-bin）、`grep -R`（-r 不跟随符号链接会假空）、`buildtool build` 才 install、plugins.xml 的 `base_class` 写最顶层基类等。**本机现状与 CLAUDE.md/通用描述冲突时，按源码与现场实测裁决，在文中写明「CLAUDE.md 已过期 / 以实测为准」并注明日期**。
8. **溯源段必填**：蒸馏日期、实际打开核对过的文件清单、遗留待核项。

## B. 正文骨架（每份手册按此结构）

```markdown
# {编号} {标题}

<!--
file: references/manual/{目录}/{文件}
scope: 11.0（默认）｜跨版本时标注
tags: 主题词1, 主题词2, ...（供 grep 检索）
sources: 主要源文件/文档绝对路径
-->

## 0. 一句话作用
（本文件讲什么、在 Apollo PnC 链路中的位置）

## 1. 关键符号与文件
| 符号/类/概念 | 文件（绝对路径，注明 src/include 完整度） | 行号(可选，须当场核过) | 说明 |
|---|---|---|---|

## 2. 机制与数据流
（组件如何被拉起、消息如何进出、状态如何流转；含输入输出 channel 总表——可选项但推荐，格式：channel 名 | 消息类型 | 方向 in/out | 频率(实测/待核) | 代码位置）

## 3. 注册与配置
（插件注册名/base_class/plugins.xml、conf/dag/launch 文件与生效路径、优先级/顺序规则）

## 4. 修改与扩展点（二次开发）
（想改 X 改哪里：文件 + 命令；含最小改动示例）

## 5. ⚠️ 本环境注意
（11.0 包形态特有坑；跨版本差异处带 [EDU·上游] 标签）

## 6. 验证命令
（只写本环境实测过的命令）

## 7. 溯源
- 蒸馏日期；核对过的文件清单；遗留待核项
```
