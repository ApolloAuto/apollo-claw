# buildtool build -p core 报错指南

> 作者: 宇新 | 发布时间: 2024-05-07 17:42 | 链接: https://apollo.baidu.com/community/article/1265

# 问题

| 问题 | 截图 | 修复方式 |
| --- | --- | --- |
| 下载超时；终端出现 connect timed out | ![](../images/02_安装部署/f845d56f8b1a27d038a2ba2c6e154216.png) | `cd /apollo_workspace/`<br>`wget https://apollo-system.cdn.bcebos.com/bazel_deps/cache.tar.gz`<br>`sudo rm -rf .cache`<br>`tar -xzvf cache.tar.gz`<br>【注意】需要在容器中执行<br>执行完成后，再执行指令 `buildtool build -p core` |
| 当前工作目录下存在一个或者多个工作目录 | ![](../images/02_安装部署/e9aea608569d022d765f40ba8127b358.png) | 例： ![](../images/02_安装部署/2b3ab12045d06f84e77662ce2931aa0d.png) 我们需要将多的工作目录删除： 输入指令： sudo rm -rf application-pnc |
| 文件夹没权限 | ![](../images/02_安装部署/f53413f7e9e3263e5379be3d5ef90efd.jpg)<br>复制在 permission denied 前的路径<br>`sudo chown 用户名:用户名 -R 路径`<br>例：`sudo chown 用户名:用户名 -R /apollo_workspace/.cache/`<br>执行完成后，再执行指令 `buildtool build -p core` |  |
| 文件夹没权限 | ![](../images/02_安装部署/18612d2e511ebe5eb4a66a0e9a2d2bce.png) | 工作空间下tools/bazel.rc权限存在问题，删除即可 `sudo rm -rf /apollo_workspace/.apollo.bazelrc` |
| 文件夹没权限 | ![](../images/02_安装部署/2ef509284db70ecb173ab0a882a8823b.png) | 工作空间下.bazelrc权限存在问题，删除即可 `sudo rm -f .bazelrc` |
| 文件夹没权限 | ![](../images/02_安装部署/d9d81c8560338e3916edae37acec1475.png) | .cache的权限错了，说明之前用过非root用户编译过代码，但后来用root用户进入的容器，建议不要切权限 |
| 网络不稳定导致 | ![](../images/02_安装部署/7ac476c79fad207ac8815fd4a50ac3da.jpg) | 再执行指令 buildtool build -p core |
| 工程目录挂载错误 | ![](../images/02_安装部署/e745a05ea70efb991ca11305f24a334d.jpg)|在容器中输入：<br>#退出容器<br>`exit`<br>#清理容器<br>`aem remove`<br>#找到工程目录后，再使用<br>`aem start_cpu`<br>`aem enter` |  |
