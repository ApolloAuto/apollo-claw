# GNSS 基站配置与检查

配置和检查 GNSS `rtk_from.ntrip` 基站。

## 命令

```bash
# 检查（连接/认证/RTCM3 数据）
python3 {BASE_DIR}/scripts/check_ntrip_base.py [--conf <file>]

# 交互式配置（5 项：IP/端口/挂载点/账号/密码，超时固定 5 秒）
python3 {BASE_DIR}/scripts/configure_ntrip_base.py [--conf <file>]

# 非交互配置
python3 {BASE_DIR}/scripts/configure_ntrip_base.py \
  --address <IP> --port <端口> --mount-point <挂载点> \
  --user <账号> --password <密码> --yes
```

## 检查结果

| 退出码 | 含义 |
|---|---|
| 0 | 连接 + 认证 + RTCM3 全通过 |
| 2 | 网络/认证/挂载点失败 |
| 3 | 认证通过但无 RTCM3 帧 |
| 4 | 未启用 rtk_from.ntrip |

## 关键行为

- 密码脱敏（不回显、不落日志）
- 写软链最终目标（不替换软链）
- 写入前备份 `.bak.<时间>`
- 只改 `rtk_from`，不动其他配置块
- 配置后提示重启 GNSS 驱动

## 格式文档

`references/gnss_format.md`
