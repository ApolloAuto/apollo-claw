# 安装及编译问题FAQ--aem 工具、Apollo下载&amp;Apollo启动相关

> 作者: 宇新 | 发布时间: 2025-05-08 18:20 | 链接: https://apollo.baidu.com/community/article/1157

### 安装aem工具失败

![](../images/02_安装部署/626fa1d31e69db30d97a4010a99ac264.jpg)

解决方式：

上网搜ubuntu换源

## aem工具

开发者在安装Apollo的时候可能会出现 以下错误

## 问题一：使用aem指令出现

```bash
aem not found
```
**问题原因：**

没有安装aem工具或者更新了aem工具导致

**解决方式：**

```bash
sudo apt install apollo-neo-env-manager-dev
```
## 问题二：无法定位aem

**问题原因：**

未添加添加apollo软件源

**解决方式：**

#### 4.2.1 基础环境准备

```bash
# 添加访问认证
wget -O - https://apollo-pkg-beta.cdn.bcebos.com/neo/beta/key/deb.gpg.key | sudo apt-key add -
# Apollo -alpha 版源地址
sudo bash -c "echo 'deb https://apollo-pkg-beta.cdn.bcebos.com/apollo/core bionic main' >> /etc/apt/sources.list.d/apolloauto.list"
# 更新源
sudo apt update
```
> **DANGER**
> 注意：如果之前已经安装过8.0版本的apollo的话，在您的宿主机/etc/apt/sources.list文件中会有形如deb https://apollo-pkg-beta.cdn.bcebos.com/neo/beta bionic main的配置，请直接删除。

## 问题三：安装aem 后出现无法创建符号链接的错误

**问题原因：**

有些ubuntu系统安装完毕后可能不会存在 /usr/local/bin 这个路径，无法创建软连接，导致无法找到 aem 命令

解决方法：

手动创建即可

```bash
sudo ln -sf /opt/apollo/neo/packages/env-manager-dev/latest/entry/apollo-env-manager.sh /bin/aem
```
# aem start

## 问题一：输入aem start后马上提示如下错误：

Got permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.24/containers/json": dial unix /var/run/docker.sock: connect: permission denied
**问题原因：**

docker启动镜像时，需要访问 /var/run/docker.sock 文件，如果未使用 apollo 提供的脚本安装脚本，就会遇见没有该文件权限的错误

**解决方法：**

给文件赋予权限即可：

```bash
sudo chmod 777 /var/run/docker.sock
```

## 问题二：aem start 后提示:

```
[info] successfully restart, please run the following command:
[info] aem enter
```

然后输入aem enter后却提示：

```
unable find user xxx: no matching entries in passwd file
```
**问题原因：**

aem start 命令会做一个判断，判断主机有没有启动过apollo容器，如果有启动过，并且容器处于运行或者停止状态，aem会重启这个旧容器，假如主机不存在apollo容器，则会新建一个，假如用户曾经参与过apollo 8.0内测或公测，曾经启动apollo容器，aem会重启该旧容器，而旧容器的镜像版本与目前的不一致，导致有些功能无法正常使用，甚至无法进入容器
**解决方法：**

强制让aem创建新的容器即可，即使用命令：

```bash
aem remove
```

## 问题三：aem start 后镜像下载过程中提示：

```
no space left on device
```

**问题原因：**

空间不足，假如使用的是虚拟机，请分配30G或以上的硬盘空间备用

**解决方法：**

删除无用文件释放空间或重新创建30G或以上空间的虚拟机

## 问题四：aem start 后镜像下载过程中提示

```
local error: tls: bad record MAC
```

**问题原因：**

网络问题导致拉取镜像失败

**解决方法：**

重试或切换网络重试

## **问题五：aem start启动提示_1**

```
Error response from daemon: Get "https://registry.baidubce.com/v2/": dial tcp:lookup registry.baidubce.com: no such host
[ERROR] Failed to pull docker image: registry.baidubce.com/apollo/apollo-env-cpu: latest
```
![](../images/02_安装部署/5bfb001b8b881844a43a29131397d073.png)

原因：网络问题导致启动失败

解决方法：

切换网络
假如之前曾经下载过镜像，只是由于网络波动原因暂时无法连接镜像服务器，可以尝试以下命令
```bash
aem start -l
```
## 问题六：**aem start启动提示_2**

```bash
aem start 时提示：
```
Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?
或者

Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Permission Denied
![](../images/02_安装部署/289d35c05d0c328c615a4afb8eba3376.png)

**问题原因：**

针对第一个提示，原因是 docker 未能启动；对于第二个提示，docker 已经启动了，但是未配置用户组，导致权限缺失

重新启动docker并且赋权即可：

```bash
sudo systemctl restart docker &&
sudo chmod 777 /var/run/docker.sock
```


## 问题五：安装
