<!--
来源: 官方应用实践文档（Apollo 文档站「应用实践」栏目，2026-09-08 抓取）
版本标签: [官方·上游]
口径: 正文多为 9.0/latest，不代表本机 11.0；动手前到 references/manual/00_versions/02 核对环境
-->

# Cyber RT 实践之 Hello Apollo

> 来源：[https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_bc765c3a4bdd473dc221495b45d61137.html](https://apollo.baidu.com/docs/apollo/latest/md_docs_2_xE5_xBA_x94_xE7_x94_xA8_xE5_xAE_x9E_xE8_xB7_xB5_2_xE5_xBC_x80_xE5_x8F_x91_xE8_xB0_x83_bc765c3a4bdd473dc221495b45d61137.html)
> 抓取时间：2026-09-08


##  实践内容

对全局配置参数的理解以及修改。

本实验将使用 Dreamview+ 进行 Scenario_Sim，仿真交通灯场景。将通过修改软件参数，实现主车在检测到前方红灯时的停车避让距离，待绿灯后通过。

- 目标：通过调整 Traffic Rules 配置参数，使得主车在监测到前方为红灯时，能够准确停车在距离停止线 2 米至 2.5 米的位置，不得超过停止线。当交通灯变为绿色后，主车能够顺利通过红绿灯路口。
- 方法：在 planning2.0 中找到 Traffic Rules 配置的相关文件，并调整配置参数，以满足红绿灯场景的要求。
- 结果：在 Apollo 的 Dreamview+ 仿真环境中，观察主车在红绿灯场景下的行驶情况，验证是否能够在红灯时停车在合适位置，并在绿灯后通过红绿灯路口。

##  体验地址

<https://apollo.baidu.com/community/course/19>

##  实验目的

- 熟悉 Planing 模块中决策功能的运行流程，掌握交规决策的调试方法；
- 通过运行 Planning 模块，详细观察并分析主车在监测到前方为红灯时的停车避让策略及其效果。

##  前置条件

本实验需要请您在 Apollo Studio 工作台仿真中创建场景集，场景集需包含以下系统场景：

- 场景名称：xh-contest-交通灯路口

##  实验流程

1.  在终端中，执行 DreamView+ 启动指令，执行成功后，点击菜单栏 dreamview+ 按钮，进入 dreamview+ 界面。

    <div>

    <div>

    aem bootstrap start --plus

    </div>

    </div>

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_1563a05.png)

    当出现如下，即表示 dreamview+ 启动成功了。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_023df8d.png)

2.  点击左下角 **个人中心** \> **设置** \> **通用设置** ，可以选择界面语言类型。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_0987230.png)

3.  左侧导航栏打开 **Mode Settings** 面板， **Mode** 选择 **PnC** ， **Operations** 选择 **Scenario_Sim** ，进入场景仿真。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_cdbd0fe.png)

1.  左侧导航栏打开 **Resource Manager** 面板，下载相应场景集。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_8f326a6.png)

> ‍注意：本次实验以demo场景集为例。

1.  回到 **Mode Settings** 面板， **Enviroment Resources** 中选择 demo 中的 **Brake on the sidewalk to avoid collision** 作为仿真场景， **ADS Resources** 中选择车辆参数为 **Mkz Example** 车辆。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_3cd8dd4.png)

1.  在 **Modules** 菜单栏中点击 planning 和 prediction 按钮，启动相应模块，并点击左下角开始运行仿真按钮。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_9fa69ab.png)

1.  观察仿真效果红线是 routing 模块在地图中搜索出的路径，浅蓝色的轨迹是 planning 模块实时规划的局部路径。在默认情况下停止墙距离交通灯停止距离为 1.0 米。

![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_f706c5b.png)

根据实验要求我们需要停止在停止线 2-2.5米 内停车，待绿灯后通过。因此，在默认情况下我们不能满足实验要求，接下来我们通过在线编辑器修改代码，实现该功能。

##  参数调整实践

###  Traffic_light配置参数同步

**局部配置参数同步**

1.  打开新的终端窗口，输入配置参数同步指令，系统将自动将 planning 模块的 Traffic_light 配置参数复制到 profile 的 default 目录中：

    <div>

    <div>

    buildtool profile config init --package planning-traffic-rules-traffic-light --profile=default

    </div>

    </div>

    使用 default 目录这份配置：

    <div>

    <div>

    \# 使用名字叫default的这份配置

    </div>

    <div>

    aem profile use default

    </div>

    </div>

    查看 profile 插件目录结构：

    <div>

    <div>

    tree profiles/default/modules/planning/traffic_rules/

    </div>

    </div>

    目录结构：

    <div>

    <div>

    profiles/default/modules/planning/traffic_rules/

    </div>

    <div>

    \`-- traffic_light

    </div>

    <div>

    \`-- conf

    </div>

    <div>

    \`-- default_conf.pb.txt

    </div>

    </div>

###  调整交通灯场景停止距离

1.  打开在线编辑器：

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_90fdbbb.png)

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_e889136.png)

2.  在 apollo_workspace 工作目录找到`profiles/default/modules/planning/traffic_rules/traffic_light/conf/default_conf.pb.txt`配置文件，调整红绿灯场景停止配置参数，达到我们期望停车效果。

<div>

<div>

\#原始


<div>

stop_distance: 1.0


<div>

\#修改后


<div>

stop_distance: 2.2



1.  保存修改后，回到 dreamview+，在 Modules 中重启 Planning 模块（让系统重新加载 Planing 参数)，重新选择红绿灯场景场景，观察主车遇到红灯场景时调整前后停车距离的变化。

    ![image.png](https://bce.bdstatic.com/doc/Apollo-Homepage-Document/Apollo_Beta_Doc/image_a0b0d74.png)

##  文档意见反馈

如果您在使用文档的过程中，遇到任何问题，请到我们在【开发者社区】建立的 [反馈意见收集问答页面](https://studio.apollo.auto/community/article/163)，反馈相关的问题。我们会根据反馈意见对文档进行迭代优化。

