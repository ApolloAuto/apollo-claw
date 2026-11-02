# 安装及编译问题FAQ——编译相关

> 作者: 宇新 | 发布时间: 2025-04-17 15:41 | 链接: https://apollo.baidu.com/community/article/1160

## 编译

开发者在编译时，可能会遇见下列错误：

# 问题一：buildtool运行后报错：

Cannot find WORKSPACE
Different packages in workspace have a same name
Package xxx is not in xxx
Can't find any package in workspace xxx
[](../images/02_安装部署/cbe393bfb57e863a783266401cbc0688.png)

```bash
exit
aem remove
```
> **DANGER**
> 这个操作的原理是将您的文件夹挂载到容器中，这样我们的环境就可以访问和操作当前文件夹。在绑定之后，由于之前的环境已被清理，所以需要重新安装模块。进入 Docker 后，请按照以下链接中的步骤1.3.2以及之后的步骤进行操作：
> [https://apollo.baidu.com/community/article/1239](https://apollo.baidu.com/community/article/1239)
> 

确保容器内的/apollo_workspace是有效的，并且 

```bash
buildtool 需要在 /apollo_workspace 下执行！
```
```bash
buildtool 需要在 /apollo_workspace 下执行！
```
```bash
buildtool 需要在 /apollo_workspace 下执行！
```
重要的事情说三遍

# 问题二：buildtool调用bazel编译后，bazel报错：

[](../images/02_安装部署/5fe4e299f0f6cb162990fcad4606bacb.png)

原因：bazel提示Error downloading，说明bazel由于网络原因无法下载自身的依赖

解决方法：

这个可能是网络问题导致的，由于各地网络的复杂性，可以尝试切换手机热点来下载这些依赖
如果仍无法下载依赖，可以使用Apollo预下载好的外部依赖缓存：
```bash
aem enter  # 该命令在宿主机执行，如果已在容器内，可以忽略这一步
cd /apollo_workspace
wget https://apollo-system.cdn.bcebos.com/bazel_deps/cache.tar.gz
rm -rf .cache
tar -xzvf cache.tar.gz
```
然后正常编译即可

如出现以下问题，该问题原因为编译缓存依赖过期了，删除即可

```bash
rm -rf /apollo_workspace/.cache/bazel/install/cbf972266931ad9fad1857441b832915
buildtool build
```
[](../images/02_安装部署/a18b79893a4d10e0871e1a1b72b39155.png)

# 问题三：编译过程中，bazel 提示 -luuid 的错误：

[](../images/02_安装部署/410d76f97068a3d936093aeee41e4494.png)

原因：这个错误是由于旧版本的镜像缺少uuid的依赖，导致连接器无法连接uuid的动态库，最终编译失败

解决方法：新版本的镜像已经修复了这个问题，可以在宿主机使用以下命令：

```bash
# 删除工作空间里保存的源码
rm -rf modules
# 退出当前容器
exit
# 启动最新版本镜像的容器
aem start -f
```
来启动最新版本镜像的容器，然后重新下载需要的模块即可。

或者直接在该容器中安装缺失的uuid：

```bash
sudo apt install uuid-dev &&
sudo ldconfig
```
# 问题四：EDU 编译缓存：

提前编译好的planning模块缓存可以显著减少编译时间。

```bash
aem enter  # 该命令在宿主机执行，如果已在容器内，可以忽略这一步
cd /apollo_workspace/
wget https://apollo-system.cdn.bcebos.com/bazel_deps/cache.tar.gz
sudo rm -rf .cache
tar -xzvf cache.tar.gz
buildtool build
```
如出现以下问题，该问题原因为编译缓存依赖过期了，删除即可

```bash
rm -rf /apollo_workspace/.cache/bazel/install/cbf972266931ad9fad1857441b832915
buildtool build
```
[](../images/02_安装部署/6576afa89fa1c97ab2adc62721a5bb64.png)
