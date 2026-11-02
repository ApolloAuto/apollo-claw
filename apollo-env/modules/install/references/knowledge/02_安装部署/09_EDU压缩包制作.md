# EDU 压缩包制作

> 作者: 宇新 | 发布时间: 2024-04-18 20:36 | 链接: https://apollo.baidu.com/community/article/1045

注意：提交前请确认 EDU 平台要求的目录结构和文件范围。

# EDU 代码打包指南

在提交代码时，务必提交planning已修改文件夹的源码。此外，请提供配置参数profile。测评系统仅会读取default目录下的配置参数。

## 2.1使用终端操作：

快捷指令

快捷指令

ctrl + alt + t
进入工程目录

【注意】:请根据自己的实际情况进入工程目录

```bash
cd application-pnc
aem enter
```
## 2.2压缩指令
### 只修改了配置参数

```bash
tar -zcvf 自己定义名字.tar.gz  profiles/default
```
![](../images/01_赛事竞赛/835f9a48f0d4bfca8a6d12cf1ff5b9a1.png)

输入ls查看当前文件夹下的压缩包

![](../images/01_赛事竞赛/09eab2c133693886323d14a1572cb153.png)

### 修改了配置文件和源码

输入指令压缩想要提交的代码，以planning为例：

```bash
tar -zcvf 自己定义名字.tar.gz modules/planning/ profiles/default
```
例子：

![](../images/01_赛事竞赛/3170979edb9689c4e72df5fd09005eaf.png)

输入ls查看当前文件夹下的压缩包

![](../images/01_赛事竞赛/09eab2c133693886323d14a1572cb153.png)

## 2.3代码提交

![](../images/01_赛事竞赛/e6c2af61475ec5f9a6e85b52b4d4eaf7.png)

## 2.3.1拖动方式：

![](../images/01_赛事竞赛/200c9fa3cfd317e3f4cc6cec2bae5c96.png)

### 2.3.2点击方式

![](../images/01_赛事竞赛/324531dba353c4a7b1e3bb793d62436c.png)

![](../images/01_赛事竞赛/11481bc2905928c3dd2fc916f76e526e.png)

### 2.4提交中

![](../images/01_赛事竞赛/e438ef71f9b754fe2f4833e4101a4572.png)

```bash
##
```
