# 使用Sim_Control仿真器调试PnC代码

> 作者: 宇新 | 发布时间: 2023-10-07 16:22 | 链接: https://apollo.baidu.com/community/article/1048

## 1 实验引入

自动驾驶汽车在实现落地应用前，需要经历大量的道路测试来验证算法的可行性和系统的稳定性，但道路测试存在成本高昂、极端交通场景复现等各种各样的问题。仿真系统通过模拟各种交通场景生有效的实现了车辆在仿真系统下日行百万公里的测试，为自动驾驶系统开发提供了大量的数据支撑。Sim_Control是Apollo软件交互系统Dreamview提供的仿真组件。Sim_control通过模拟Chassis、Localization、PerceptionOBstacle等信息输入，实现对routing、planning等算法模块的仿真调试，同时Apollo提供了PnC Monitor、Cyber Monitor等系统调试工具，可以实时的监控各模块运行数据，有效提升开发者对自动驾驶软件算法的学习与调试。

## 2 实验简介

Apollo Map地图下设置了多个典型交通场景，如人行道避让、红绿灯停止线、静态障碍物、减速带、龟速车绕行、施工限速绕行、左转待转、路口避障、自主泊车等场景。本实验将以【静态障碍物绕行】场景为例，介绍通过修改软件参数，实现车辆对静态障碍物绕行横向距离与绕行限速的动态调整。以此希望开发者掌握如何使用Sim_Control组件进行Apollo软件代码的调试的方法。

## 3 实验目的

u熟悉Apollo软件系统的启动方法，掌握Dreamview交互系统使用

u熟悉Apollo软件系统工作流程，掌握系统调试工具的Cyber_monitor使用

u掌握通过Sim_Control模块对Apollo软件代码的仿真调试方法

## 4 总体设计

[](../images/04_规划PnC/ad0713fb51410635f0b0cc3d1e09696e.png)

1> 进入Docker环境，打开DreamView可视化交互系统

2> 进入Sim_Control仿真模式，选择要调试的代码模块

3> 启动场景生成组件Sim_Obstacle，设置车辆行驶路径

4> 静态障碍物绕行场景调试方法演示

5> Add DefaultRouting 使用方法介绍

## 5 实践流程

### 5.1 打开DreamView交互系统

（1）在Ubuntu系统中打开命令行工具，进入/cd pnc-competition 目录，执行启动 docker 环境指令。

```bash
cd pnc-competition
aem start
```
启动成功后，会提示【OK】Enjoy！操作示意如图1所示：

[](../images/04_规划PnC/24a75ccb07bdf29639dd70743598bb87.png)

图1 启动docker环境

（2）启动docker环境成功后，执行进入docker 环境指令。

```bash
aem enter
```
进入成功后，用户名会变为in-dev-docker，操作示意如图2所示：

[](../images/04_规划PnC/a475b0f7efa7c592f01e32f42b822c7a.png)

图2 进入docker环境

（3）在docker环境中执行启动dreamview指令。 

```bash
aem bootstrap
```
如图3所示，启动成功后，终端串口会显示『Dreamview is running at [http://localhost:8888](http://localhost:8888)』

若出现『Moduledreamview is already running - skipping.』提示，则表示上一次运行Dreamview 没有正常关闭，Dreamview 仍在运行中，此时可执行关闭Dreamview 指令，待关闭完成之后，重新执行启动Dreamview 指令即可。关闭Dreamview 指令如下：

```bash
aem bootstrap stop
```
（4）启动成功后，在终端右键然后选择OpenLink或在浏览器中输入([http://localhost:8888](http://localhost:8888))回车打开。操作示意如图4所示，打开成功后，DreamView运行界面如图5所示：

[](../images/04_规划PnC/8e2f29fe590fffdd89919aaee28b0687.png)

图4 打开DreamView

[](../images/04_规划PnC/c546074fa508b7008f6cb742be7e40dd.png)

图5DreamView运行成功示意图

[](../images/04_规划PnC/32e81e141ef8cbd3d148b49fb179ce43.png)

### 5.2 进入Sim_Control仿真模式

（1）在上方菜单栏选择mkz standard debug> 车辆型号选择 MkzExample> 地图选择Apollo Virutal Map > 点击 Tasks > 选择 SimControl，即可进入仿真模拟控制，如图6所示：

[](../images/04_规划PnC/4aa3aab4055886ea1ef63f3430366c39.png)

图6DreamView运行成功示意图

（2）点击左侧Module Control栏，启动需要调试的模块进程，如图7所示，我们选择Planing、Prediction、Routing模块：

[](../images/04_规划PnC/a1e400cd8e7241dff7f4a6cbc3e227fd.png)

图7待调试模块启动示意图

（3）使用 Cyber _monitor或Module Delay组件查看待调试的模块是否有数据输出。如图8、图9所示：

[](../images/04_规划PnC/d22d0d72efbf6af0678e3a0f333cc24c.png)

图8Cyber _monitor数据输出示意图

[](../images/04_规划PnC/65ebc742f8e112ee4f9a39b39b7c974a.png)

图9Module Delay数据输出示意图

### 5.3 下载场景集

（1）下载EDU 场景集

需要完成此链接步骤后再执行以下步骤：[https://apollo.baidu.com/community/article/1044](https://apollo.baidu.com/community/article/1044)

[](../images/04_规划PnC/e3570cc7f981bfebc830b7ca4d577fb9.png)

图10 下载EDU 场景集

如果出现以下情况，可以重启电脑或者重启dreamview 

指令 ： aem bootstrap restart

[](../images/04_规划PnC/5198ee0b33e81df382df7250ae9c3ea9.png)

### （2）打开场景

[](../images/04_规划PnC/f022de1a5fbc324b6eabf099a5b85d6a.png)

图11 选择EDU 场景集

[](../images/04_规划PnC/ba7bbc958c469b72ede783d69943401d.png)

图12 选择EDU 场景

### 5.3 设置车辆仿真行驶路径

（1）点击左侧Module Control栏，启动模块，如图13所示：

[](../images/04_规划PnC/a1e400cd8e7241dff7f4a6cbc3e227fd.png)

图13启动模块示意图

（2）模块启动完成后，点击左侧RoutingEditing，拖动、点击鼠标可以在地图中设置车辆行驶路径（起点-终点或起点-途径点-终点）。如图14所示：

[](../images/04_规划PnC/1f36e35be7330114e36527862a62b0be.png)

图14车辆仿真行驶轨迹设置示意图

（3）当点位设置完成后，点击Send Routing Request。等待出现如图15所示，红线是routing模块在地图中搜索出的路径，浅蓝色的轨迹是planning模块实时规划的局部路径。

[](../images/04_规划PnC/3f8642bbeff4993d4f14024a2acad746.png)

图15车辆仿真行驶示意图

（3）点击左任务栏Tasks，打开PNC monitor组件，如图16所示，界面右侧就会输出Planing和Control相关的数据曲线，通过数据曲线的分析为开发者代码调试提供支撑。

[](../images/04_规划PnC/70a34efc86192b0bba434f62a519db87.png)

图16PNC_monitor组件展示示意图

### 5.4 人行道通行场景调试方法演示

本小节将以【人行道通行】场景为例，介绍通过修改软件参数，实现车辆对避让行人行为调整。以此希望开发者掌握如何使用Sim_Control组件进行Apollo软件代码的调试的方法。

（1）打开Sim_Control，进入Route Editint模式，如图17所示，选择xh-contest-人行道通行场景，在障碍物前后设置车辆行驶线路（起点-终点）。

[](../images/04_规划PnC/557057ce8cb51d5e80ef5266f1ae04b5.png)

图17障碍物位置示意图

[](../images/04_规划PnC/c691f93d9b53a3d8916e942de44e1c65.png)

图18障碍物位置处车辆行驶路径设置示意图

（2）当点位设置完成后，点击Send Routing Request。等待出现如图19所示，红线是routing模块在地图中搜索出的路径，浅蓝色的轨迹是planning模块实时规划的局部路径。

[](../images/04_规划PnC/72f795ec1824db37015acbcef2af6303.png)

图19车辆仿真行驶示意图示意图

[](../images/04_规划PnC/f5fadac33ace2adf91023794e40c1135.png)

## 6编译指令

Planning

```bash
buildtool build -p modules/planning/
```
其他模块

```bash
buildtool build -p modules/模块名
```
## 7实验总结

至此我们通过该示例演示了如何在Sim_Control模式下，修改Planing代码中的参数实现对车辆运行状态的动态仿真，希望开发者熟悉仿真调试过程，掌握使用Sim_Control组件进行Apollo软件代码的调试的方法。

PS：为了确保各位同学顺利安装apollo竞赛系统，我们录制了安装视频，如果各位同学在安装过程中碰到问题可以加入：

[https://apollo.baidu.com?eventType=public&amp;code=fd3352c1-b68c-4775-9684-ae7a62cc5c01&amp;courseId=174](https://apollo.baidu.com?eventType=public&amp;code=fd3352c1-b68c-4775-9684-ae7a62cc5c01&amp;courseId=174)  (学号请填写手机号)

通过该课程的学习将有效的帮助您学会如何下载Apollo系统、掌握Apollo的仿真及调试工具使用以及赛题的解题思路，快来参与学习吧。
