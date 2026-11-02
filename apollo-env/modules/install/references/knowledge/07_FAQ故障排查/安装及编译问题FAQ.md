# 安装及编译问题FAQ

> 作者: 宇新 | 发布时间: 2024-05-08 18:16 | 链接: https://apollo.baidu.com/community/article/1040

# 环境相关

| 问题方向 | 使用相关指令 | 相关问题链接 |
| --- | --- | --- |
| 安装指令 | buildtool build -p core | [https://apollo.baidu.com/community/article/1265](https://apollo.baidu.com/community/article/1265) |
| 地图下载失败 | buildtool map get | [https://apollo.baidu.com/community/article/1268](https://apollo.baidu.com/community/article/1268) |
| dreamview地图不加载或场景不跳转 |  | [https://apollo.baidu.com/community/article/1266](https://apollo.baidu.com/community/article/1266) |
| 启动容器问题 | `aem start_cpu` / `aem enter` / `aem remove` | [https://apollo.baidu.com/community/article/1267](https://apollo.baidu.com/community/article/1267) |
| dreamview相关 | `aem bootstrap start` / `aem bootstrap start --plus` | [https://apollo.baidu.com/community/article/1159](https://apollo.baidu.com/community/article/1159) |
| 安装docker相关 | bash docker_install.sh | [https://apollo.baidu.com/community/article/1156](https://apollo.baidu.com/community/article/1156) |
|  |  |  |
| aem 工具、Apollo下载&amp;Apollo启动相关 | `sudo apt install apollo-neo-env-manager-dev` / `aem start` / `aem -h` | [https://apollo.baidu.com/community/article/1157](https://apollo.baidu.com/community/article/1157) |
|  |  |  |
| 模块无法正常启动 | `mainboard -d /apollo/modules/planning/planning_component/dag/planning.dag` |  |
| dreamview相关 | `aem bootstrap start` / `aem bootstrap start --plus` | [https://apollo.baidu.com/community/article/1159](https://apollo.baidu.com/community/article/1159) |
|  |  |  |
| buildtool相关 | `buildtool build` / `buildtool -h` / `buildtool install` / `buildtool create` | [https://apollo.baidu.com/community/article/1227](https://apollo.baidu.com/community/article/1227) |
|  |  |  |
| 编译相关 | `buildtool build` / `buildtool build -p modules/` / `apollo.sh build` | [https://apollo.baidu.com/community/article/1160](https://apollo.baidu.com/community/article/1160) |
|  |  |  |

# 感知相关

| 文章标题 | 链接 |
| --- | --- |
| 如何安装GPU驱动【ubuntu系统】 | [https://apollo.baidu.com/community/article/1181](https://apollo.baidu.com/community/article/1181) |
| GPU驱动问题FAQ | [https://apollo.baidu.com/community/article/1228](https://apollo.baidu.com/community/article/1228) |
| 40系列显卡新镜像支持 | [https://apollo.baidu.com/community/article/1212](https://apollo.baidu.com/community/article/1212) |
| 40系列显卡使用Apollo指南 | [https://apollo.baidu.com/community/article/1201](https://apollo.baidu.com/community/article/1201) |

由于使用的硬件、安装的ubuntu系统的镜像以及系统配置不一致等原因，开发者在上述流程中可能会遇到各种问题，我们总结了这个过程一些常见的问题以及原因和解决方案，方便各开发者进行排查，顺利跑通上述流程
