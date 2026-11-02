# apollo-dev 知识库目录索引

> ⚠️ 本知识库为 **PNC/EDU（application-pnc）口径**（[EDU·上游]），未按本机环境校对。
> **Apollo 11.0 源码级手册（[11.0·实测]）在 `manual/00_readme.md`**；两版差异见 `manual/00_versions/`；本文档每篇的版本归属见 `manual/pnc_赛事版/00_知识归属与差异标注表.md`。

知识库根目录：`{BASE_DIR}/references/knowledge/`

## 目录结构

| 目录 | 内容 | 关键文件 |
|------|------|---------|
| `01_赛事竞赛/` | EDU 报名、规则 | `2026百度Apollo自动驾驶大赛报名指南.md` |
| `02_日常工作流/` | 电脑重启、打包提交、profile、Git | `08_电脑重启后怎么进入Apollo.md`、`09_赛事压缩包制作.md`、`10_Git代码与配置管理.md` |
| `03_规划PnC/` | PnC 开发、场景实现（19 篇） | `00_技术参考索引.md`（入口）、`01_PnC开发模式说明.md` |
| `04_赛事集锦/` | EDU 场景解题代码（11 篇） | `00_场景索引.md`（入口）|
| `05_工程框架与工具/` | Dreamview、包管理 2.0（4 篇） | `Dreamview功能介绍.md`、`工程框架升级之包管理2.0整体解读.md` |
| `06_技术培训/` | 课程学习路径 | `备赛课程学习.md` |
| `07_FAQ故障排查/` | 开发相关报错（7 篇） | `planning模块打不开恢复指南.md`、`安装及编译问题FAQ——编译相关.md` |
| `08_硬件传感器/` | 传感器适配、CAN 协议 | `Apollo自动驾驶传感器适配.md` |
| `09_地图资源/` | 地图和场景获取 | `2026星火自动驾驶大赛场景集和地图获取.md` |

## 关键词→文件映射

| 关键词 / 问题类型 | 优先检索 |
|-----------------|---------|
| 电脑重启后进入 Apollo | `02_日常工作流/08_电脑重启后怎么进入Apollo.md` |
| 打包提交、压缩包制作 | `02_日常工作流/09_赛事压缩包制作.md` |
| git、代码托管、分支、回退 | `02_日常工作流/10_Git代码与配置管理.md` |
| profile、包管理、aem profile | `02_日常工作流/06_aem_profile配置管理.md`、`05_工程框架与工具/` |
| **下载 Planning 代码**、buildtool install、获取配置参数 | `03_规划PnC/00_代码与配置下载指南.md` |
| PnC、Planning、规划开发 | `03_规划PnC/`（入口：`00_技术参考索引.md`）|
| TrafficRule 插件 | `03_规划PnC/05_新增TrafficRule插件流程.md`、`06_插件机制—新增TrafficRule插件.md` |
| Scenario 插件 | `03_规划PnC/07_插件机制—新增Scenario插件.md` |
| 场景（借道/交汇/人行道/泊车…）| `03_规划PnC/09_`~`17_` + `04_赛事集锦/` |
| Dreamview、SimControl 仿真 | `05_工程框架与工具/Dreamview功能介绍.md`、`03_规划PnC/04_使用SimControl仿真调试.md` |
| **Planning 打不开、Planning 崩溃** | `07_FAQ故障排查/planning模块打不开恢复指南.md` |
| buildtool 编译报错（开发中） | `07_FAQ故障排查/安装及编译问题FAQ——编译相关.md`、`buildtool相关问题FAQ.md` |
| Dreamview 地图不加载 | `07_FAQ故障排查/dreamview地图不加载或场景不跳转.md` |
| 日志查看、日志输出 | `07_FAQ故障排查/Apollo查看日志以及输出日志.md` |
| 地图获取失败 | `07_FAQ故障排查/buildtool map get 地图获取失败.md` |
| 传感器、CAN 协议 | `08_硬件传感器/` |
| 地图、场景下载 | `09_地图资源/` |
| EDU 报名 | `01_赛事竞赛/` |
