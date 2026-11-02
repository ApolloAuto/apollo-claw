# EDU 场景插件下载指南

> 作者: 宇新 | 发布时间: 2025-04-07 12:09 | 链接: https://apollo.baidu.com/community/article/1283

## 前言：

带有交通流信息的场景对于PnC仿真调试是非常重要的，Dreamview中没有制作交通流场景的功能，但ApolloStudio提供了场景编辑的功能，开发者可以通过场景编辑功能创建带有障碍物信息的交通流场景，然后通过Profile插件将该场景同步到的Dreamview上，这样就可以实现在Dreamview进行交通流场景仿真了，本文将主要介绍Profile插件的安装方法。

## 使用前提：

> **INFO**
> 已经正确安装了Apollo （软件包方式）

## 安装方法：

> **INFO**
> 安装profile插件，主要包含了以下五个步骤：
> 启动Apollo系统
> 生成profile密钥
> 安装Profile插件
> 验证Profile插件

### 步骤一：启动Apollo系统

打开终端，启动并进入Apollo系统，如有显示in-dev-docker则表明已经启动可忽略
```bash
cd application-pnc
aem enter
```
![](../images/01_赛事竞赛/452fd91cf3743fe015820ec063acbd13.png)

【可忽略至步骤二】运行以下指令，打开Dreamview交互系统。
```bash
aem bootstrap start --plus
```
运行成功后如图所示：

![](../images/01_赛事竞赛/1c434050754fad504095c39bffa0c4db.png)

打开Drwamview，点击左下角资源中心。
![](../images/01_赛事竞赛/7e6537f810818e775d0977945898f11e.png)

![](../images/01_赛事竞赛/e8d8a5058b32f688f757b137c73b204f.png)

如上图所示，Apollo Studio看到显示为暂无数据，这是因为我们还没有安装Profile插件，因此也无法获取到云端Apollostudio的场景集。接下来我们进行第二步。


### 步骤二、生成profile密钥

1、登录[Apollo Studio](apollo.baidu.com)，点击菜单栏【产品>仿真工具】或者点击【工作台】，进入工作台后，点击右上角个人账号，查看个人信息；

![](../images/01_赛事竞赛/0d4d5528627ad7e8f69aa5aa44199bb3.png)

2、在个人信息下【服务权益】中选择【仿真】，点击【生成】按钮。

![](../images/01_赛事竞赛/e63a050bc9bc82cf506009ae881efba5.png)

3、点击【一键复制】复制刚刚生成的profile插件密钥。

![](../images/01_赛事竞赛/853683894e5556332a791b7a6300a489.png)

> **INFO**
> PS:插件时效为1min，超过1min会导致插件时效，无法安装，如果超过时效，请重新生成插件。

### 步骤三、安装profile插件

1、回到Apollo 的docker环境，在apollo_workspace目录下执行刚才复制的插件安装密钥，如下图所示：

![](../images/01_赛事竞赛/5b0e5376280544e820b66acad394feea.png)

安装成功后如图所示：

![](../images/01_赛事竞赛/980e0f7859af70085209ac5a1999b8b0.png)

通过上图可以看到，profile插件被安装到了/home/apollo/.apollo/dreamview/plugins目录之下，因此我们也可以通过检查该目录下是否存在，以此来判断profile插件是否安装成功，可以执行如下操作：

```bash
ls ~/.apollo/dreamview/
```
如果出现如下图所示，则表示安装成功。

![](../images/01_赛事竞赛/882d377841509a74b88f90254df836ae.png)

至此profile插件安装完成，接下来我们来验证profile插件功能是否正常。

### 步骤四、验证Profile插件

1，重新启动Dreamview，点击左侧菜单栏profile,可以看到Apollostudio侧已经有数据了,首次打开需要等待几秒才出现)。

> **INFO**
> 因为profile插件是在dreamview启动的时候被加载的，因此如果你在安装插件已经打开了dreamview，就无法加载profile插件，因此需要重新启动dreamier，可以分别执行以下指令来重启dreamview。

```bash
aem bootstrap stop
aem bootstrap start --plus
```
![](../images/01_赛事竞赛/3e84289650e4a927519910b986490ffb.png)

2、重新启动Dreamview后，也可以通过如下命令查看profile是否启动成功。

```bash
cyber_node list
```
如果有有studio_connector node节点，则说明插件启动成功，此时等待dreamview加载即可。

![](../images/01_赛事竞赛/6de752aa2cd47bf5a3e312bc397ad9fa.png)

至此,插件的安装和验证完成，如果在安装过程中遇到问题可以查看[【Profile插件安装FAQ 】](https://apollo.baidu.com/community/article/1051) 。
