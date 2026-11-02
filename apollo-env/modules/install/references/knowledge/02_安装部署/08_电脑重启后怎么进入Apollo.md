# 电脑重启后怎么进入Apollo？

> 作者: 宇新 | 发布时间: 2025-04-08 11:35 | 链接: https://apollo.baidu.com/community/article/1286

### 1. 进入 Apollo 环境

重启后进入当前使用的 Apollo 工程目录，不要固定使用某个工程名称。

打开终端方法：ctrl + alt + t

![](../images/02_安装部署/e178b273718acc363a178e1e91ffec65.png)

```bash
cd <工程目录>
aem enter
```

将 `<工程目录>` 替换为当前 Apollo 工程的实际路径，例如 `application-pnc` 或对应车型工程目录。

![](../images/02_安装部署/d253e2d33ba86f1591a847345668e18e.png)

### 2. 启动dreamview可视化界面&amp;模式

```bash
aem bootstrap start --plus
```

如若没有http://localhost:8888/的显示，请认真查看下图的书写方式。
![](../images/02_安装部署/a69df7a6f1600d9086454676d7c517e0.png)

**进入可视化界面**

**方法一：**

将鼠标移动至（[http://localhost:8888/](http://localhost:8888/)），按住ctrl + 鼠标左键打开网页

![](../images/02_安装部署/f3f6abf21d8b0012e12acdb28a065503.png)

**方法二：**

打开浏览器输入（[http://localhost:8888/](http://localhost:8888/)）进入dremview中。
