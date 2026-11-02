# EDU 编译缓存

> 作者: 宇新 | 发布时间: 2023-06-02 17:04 | 链接: https://apollo.baidu.com/community/article/1075

## 前言：

针对电脑性能一般的情况，可能会出现编译时间过长、编译失败或因网络等问题无法正常编译的情况。为解决这个问题，Apollo EDU 提供以下解决方法：使用预先编译好的编译缓存，以加快编译过程。

这项措施可以帮助性能较弱的电脑更高效地完成编译任务，减少编译时间过长或失败的情况。即使遇到网络问题，也可以使用缓存完成编译。

遇到编译困难时，可以使用该缓存加速 Apollo EDU 环境构建。

## 使用前提：

> **INFO**
> 已经正确安装了Apollo 8.0（软件包方式）或者Apollo 8.0 pnc-competition版本；

## 获取方法：

EDU 编译缓存：

提前编译好的planning模块缓存可以显著减少编译时间。

```bash
aem enter  # 该命令在宿主机执行，如果已在容器内，可以忽略这一步
cd /apollo_workspace/
wget https://apollo-pkg-beta.bj.bcebos.com/archive/planning_cache.tar.gz
sudo rm -rf .cache
tar -xzvf planning_cache.tar.gz
```
## 编译代码：

```bash
buildtool build -p modules/planning/
```
