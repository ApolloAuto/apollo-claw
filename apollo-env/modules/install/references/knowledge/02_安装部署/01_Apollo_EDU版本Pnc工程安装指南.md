Apollo EDU版本Pnc工程安装指南

# Apollo EDU版本Pnc工程安装指南
为了便于初学者学习，本实践项目基于Apollo EDU版发布了PnC示例工程，工程内已经编写好了PnC相关的依赖包（cyberfile.xml），安装更便捷。本版本对电脑最低要求4核 16G以上，GPU无要求。

注意：建议存储空间分配55G及其以上，**ubuntu系统推荐:**18.04、20.04、22.04，不推荐24.04；

## 1.1 安装基础软件
安装 Ubuntu 操作系统，请参见[ubuntu官方安装指南](https://documentation.ubuntu.com/desktop/en/latest/tutorial/install-ubuntu-desktop/)。

> **WARNING**
> 注意：推荐您使用 ubuntu系统推荐:18.04、20.04、22.04（不推荐24.04）的版本作为您主机的操作系统，若采用18.04版本可使用：[https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/](https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/)
> 注意需选取带desktop-amd64.iso的下载
![](../images/02_安装部署/img_01.png)
Ubuntu系统安装完成请更新相关软件：
```
sudo apt-get update
sudo apt-get upgrade
```
> **WARNING**
> 注意：更新过程中请务必保持网络链接畅通。
Apollo 依赖于 Docker 19.03+。安装 Docker 引擎，您可以根据官方文档进行安装：

参见Install Docker Engine on Ubuntu。
您还可以者通过 Apollo 提供的安装脚本直接安装：这个过程可能会运行多次脚本，根据脚本提示执行即可。
```
wget http://apollo-pkg-beta.bj.bcebos.com/docker_install.sh
bash docker_install.sh
```
如遇到下载失败或下载过慢，可使用以下方法使用
```
sudo rm -f /etc/apt/sources.list.d/docker.list
wget http://apollo-pkg-beta.bj.bcebos.com/docker_install.sh
wget http://apollo-pkg-beta.bj.bcebos.com/get_docker.sh
bash get_docker.sh --mirror Aliyun
bash docker_install.sh
```
## 1.2 安装 Apollo 环境管理工具
#### 1.2.1 基础环境准备
```
# 添加 gpg key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://apollo-pkg-beta.cdn.bcebos.com/neo/beta/key/deb.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/apolloauto.gpg
sudo chmod a+r /etc/apt/keyrings/apolloauto.gpg
 
# 设置源并更新
echo \
    "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/apolloauto.gpg] https://apollo-pkg-beta.cdn.bcebos.com/apollo/core"\
    $(. /etc/os-release && echo "$VERSION_CODENAME") "main" | \
    sudo tee /etc/apt/sources.list.d/apolloauto.list
sudo apt-get update
```
> **DANGER**
> ‍注：如果之前已经安装过8.0版本的apollo的话，在宿主机上的/etc/apt/sources.list文件中会有形如 deb [https://apollo-pkg-beta.cdn.bcebos.com/neo/beta](https://apollo-pkg-beta.cdn.bcebos.com/neo/beta) bionic main的配置，可以直接删除，宿主机上的apollo源配置仅用于安 装aem工具
### 1.2.2 安装aem工具
apollo 最新版本的aem兼容Apollo-EDU 版本aem，请使用以下指令进行更新。
```
sudo apt install apollo-neo-env-manager-dev --reinstall
```
安装成功后，可以使用以下指令进行查看aem工具功能。
```
aem -h
```
![](../images/02_安装部署/img_02.png)
## 1.3 下载 PnC工程
### 1.3.1 下载工程代码
```
git clone https://github.com/ApolloAuto/application-pnc.git
```
> **WARNING**
> **提示:** 如果出现⽆法访问等问题，可使⽤以下⽅法。
> `git clone https://gitee.com/ApolloAuto/application-pnc`
> 如果想使用之前的 pnc工程请自行切换对应分支 git checkout -b &lt;分支名&gt;
### 1.3.2 进入工程目录
```
cd application-pnc
bash setup.sh
```
> **WARNING**
> 目录结构说明
> **core**目录，系统依赖包，里面cyberfile.xml描述了使用
> **WORKSPACE**：与bazel相关的一些配置信息，一般不需要用户关注。
检查工作目录
```
cat .workspace.json
```
![](../images/02_安装部署/img_03.png)
## 1.4 调试pnc工程
### 1.4.1 进入Docker环境
#### 拉取并启动docker容器
```
cd application-pnc
# 要保证在工程目录下执行
aem start
```
![](../images/02_安装部署/img_04.png)
#### 检查buildtool版本
```
buildtool -v
```
![](../images/02_安装部署/img_05.png)
#### 检查进入工作空间是否正确
检查工作目录
```
cat .workspace.json
```
![](../images/02_安装部署/img_06.png)
#### 编译工程
```
buildtool build -p core
```
![](../images/02_安装部署/img_07.png)
看到这个页面表示编译成功

![](../images/02_安装部署/img_08.png)
因部分同学出现了网络原因导致无法正常下载依赖，现提供编译缓存

工程内编译缓存下载&amp;解压
```
wget https://apollo-system.bj.bcebos.com/bazel_deps/cache.tar.gz
tar -zxvf cache.tar.gz
```
Apollo依赖下载
```
# 下载安装依赖包： 会拉取安装core目录下的cyberfile.xml里面所有的依赖包
buildtool build -p core
#需要执行两次
buildtool build -p core
```
### 1.4.2 启动Dreamview
```
aem bootstrap start --plus
```
成功启动显示：

![](../images/02_安装部署/img_09.png)
如出现报错：

|截图|问题分析|解决方法|
|-|-|-|
|![](../images/02_安装部署/img_10.png)|部分文件夹没权限 当出现permission denied的时候，就需要给相应的文件夹赋予权限了 如图所示： 在permission denied 前为/opt/apollo/neo/data/log/dreamview_plus.log路径没权限|sudo chown 用户名:用户名 -R 路径 如图所示 sudo chown 用户名:用户名 -R /opt/apollo/neo/data/log/dreamview_plus.log|
|![](../images/02_安装部署/img_11.png)|一般这个情况是，电脑性能问题导致的，如果输入指令后出现这个情况，是因为后台有些服务没有打开，所以会有个报错，一般需要等个几十秒|重复执行几次启动指令： aem bootstrap start --plus|
|![](../images/02_安装部署/img_12.png)|存在部分依赖没完全下载|重新执行遍： buildtool build -p core|

进入浏览器输入：[http://localhost:8888/](http://localhost:8888/)

选择红框内容，启动仿真

![](../images/02_安装部署/img_13.png)
如出现错误

|截图|问题分析|解决方法|
|-|-|-|
|![](../images/02_安装部署/img_14.png)|选择 Scenari_Sim 时出现没有选项的情况 |直接刷新页面即可，由于没有读到当前配置导致|

**下一步安装profile插件：**

详见以下链接：

[https://apollo.baidu.com/community/article/1283](https://apollo.baidu.com/community/article/1283)

# 怎么下载代码？
如需下载其他planning代码包

所有planning代码下载：
```
buildtool install planning*
```
执行后可在/apollo_workspace/modules文件夹下下载所有 planning代码

![](../images/02_安装部署/img_15.png)

可以在该链接中查看

[https://apollo.baidu.com/docs/apollo/latest/md_collection_2planning_2README__cn.html](https://apollo.baidu.com/docs/apollo/latest/md_collection_2planning_2README__cn.html)

![](../images/02_安装部署/img_16.png)
例如下载crosswalk的包

```bash
buildtool install planning-traffic-rules-crosswalk
```
此刻我们在planning/traffic的目录下找到crosswalk的源码

![](../images/02_安装部署/img_17.png)
# 怎么编译代码？
以planning为例
```
buildtool build -p modules/planning
```
其他模块：
```
buildtool build -p modules/其他
```
