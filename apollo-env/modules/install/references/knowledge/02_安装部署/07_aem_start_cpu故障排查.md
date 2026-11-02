# aem start_cpu 故障排查

> 作者: 宇新 | 发布时间: 2024-05-08 | 链接: https://apollo.baidu.com/community/article/1267

执行 `aem start --cpu`（或 `aem start_cpu`）启动容器失败时，请对照以下问题排查。

---

## 问题一：docker.sock 权限不足

**报错截图：**

![](../images/02_安装部署/a0485206d11d2ba15a8bb1ab2a7d025f.png)

**原因：** Docker 启动镜像时需要访问 `/var/run/docker.sock`，使用非 Apollo 安装脚本安装 Docker 时可能缺少该文件权限。

**解决方法：**

```bash
sudo chmod 777 /var/run/docker.sock
```
---

## 问题二：Docker 未启动 / 用户组权限缺失

**报错截图：**

![](../images/02_安装部署/5c1bd60c1f4e56beeb109866194153d1.jpg)

**原因：**
- 第一种提示：Docker 服务未能启动
- 第二种提示：Docker 已启动，但未配置用户组，权限缺失

**解决方法：**

```bash
sudo systemctl restart docker
sudo chmod 777 /var/run/docker.sock
```
---

## 问题三：内存不足

**报错截图：**

![](../images/02_安装部署/96ed15ad03d170738178afc1f4fb4777.jpg)

**原因：** 系统可用内存不足，容器无法启动。

**解决方法：** 关闭其他占内存的程序，或增加虚拟内存（swap）后重试。

---

## 问题四：GPU 驱动异常导致无法启动（切换为 CPU 模式）

**报错截图：**

![](../images/02_安装部署/cbbda969941e4f24272046045bd1b6ea.jpg)

**原因：** GPU 驱动异常，无法以 GPU 方式启动容器。

**解决方法：** 移除旧容器，改用 CPU 模式启动：

```bash
aem remove
aem start --cpu
```
启动成功后进入容器：

```bash
aem enter
```
