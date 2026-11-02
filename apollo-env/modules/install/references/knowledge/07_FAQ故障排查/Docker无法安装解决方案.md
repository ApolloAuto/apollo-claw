# Docker无法安装解决方案

> 作者: 宇新 | 发布时间: 2023-05-09 22:41 | 链接: https://apollo.baidu.com/community/article/1058

问: 在使用脚本安装Docker时遇到了无法安装的问题，出现这种情况的原因是什么？

![](../images/02_安装部署/6b458daad73cebc9abbd16465eeaf3c2.png)

原因: 出现这种问题的原因通常是网络问题，可能是由于下载所需的依赖文件时出现了错误或下载速度缓慢导致的。

解决方式： 可以尝试通过以下命令来解决这个问题：

```bash
sudo apt install docker.io
```
这个命令可以通过APT包管理器安装Docker，即使您在使用脚本时出现了问题，也可以使用这个命令手动安装Docker。
