# Apollo 环境检测

检测 Apollo 运行环境的各项指标，输出报告。

## 命令

```bash
# 人类可读报告
bash {BASE_DIR}/scripts/env_check.sh

# JSON 输出
bash {BASE_DIR}/scripts/env_check.sh --json
```

退出码：`0`=全部通过，`1`=存在警告，`2`=存在失败项。

## 检测项

| 项 | 说明 |
|---|---|
| OS | Ubuntu 版本、架构 |
| CPU | 核数、型号 |
| 内存 | 总内存 |
| 磁盘 | 根分区、Docker 数据目录空间 |
| Docker | 版本、守护进程、用户组权限 |
| 网络 | Apollo CDN、GitHub 连通性 |
| aem | 是否安装、容器是否运行 |
| buildtool | 是否可用 |
| 工程 | application-pnc 是否克隆 |
