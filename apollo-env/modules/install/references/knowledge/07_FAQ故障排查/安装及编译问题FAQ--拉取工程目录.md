# 安装及编译问题FAQ--拉取工程目录

> 作者: 宇新 | 发布时间: 2023-12-18 17:35 | 链接: https://apollo.baidu.com/community/article/1158

| 序号 |  | 举例 | 修改方式 |
| --- | --- | --- | --- |
| 1 | 方案一： 使用gitee clone | `git clone https://github.com/ApolloAuto/application-pnc.git` | 将github改成gitee<br>`git clone https://gitee.com/ApolloAuto/application-pnc.git`<br>![](../images/02_安装部署/69598e23b05bd4153b8632dcc09be4af.png) |
| 2 | 方案二： 使用镜像网站 | `git clone https://github.com/ApolloAuto/application-pnc.git` | 将**github.com**改成**kkgithub.com**<br>`git clone https://kkgithub.com/ApolloAuto/application-pnc.git`<br>![](../images/02_安装部署/75df4874fe605c06358c19ac21fe3a06.png) |
| 3 | 方案三： 使用镜像网站 | `git clone https://github.com/ApolloAuto/application-pnc.git` | 在github前添加gitclone.com/<br>`git clone https://gitclone.com/github.com/ApolloAuto/application-pnc.git`<br>![](../images/02_安装部署/995ac2a4b7d3a1ad9f5807cd0f043d1d.png) |

## 方案一：

举例：
```bash
git clone https://github.com/ApolloAuto/application-pnc.git
```

## 方案二：

举例：
```bash
git clone https://github.com/ApolloAuto/application-pnc.git
```
如出现无法访问等问题，可以将**github.com**改成**kkgithub.com**

```bash
git clone https://kkgithub.com/ApolloAuto/application-pnc.git
```

