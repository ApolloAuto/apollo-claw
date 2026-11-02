# GNSS 基站（NTRIP）配置与检查

> 本文档描述 apollo-env skill 的 GNSS 基站配置能力：检查（check）、配置（configure）、配置文件格式与结果含义。

## 一、配置文件格式

配置文件：`/apollo/modules/drivers/gnss/conf/gnss_conf.pb.txt`

关键块为 `rtk_from.ntrip`：

```text
rtk_from {
    format: RTCM_V3
    ntrip {
        address: "60.205.8.49"
        port: 8002
        mount_point: "AUTO"
        user: "111111"
        password: "22222"
        timeout_s: 5
    }
    push_location: true
}
```

| 字段 | 含义 |
|---|---|
| `address` | 基站 IP 或域名 |
| `port` | NTRIP caster 端口 |
| `mount_point` | 挂载点 |
| `user` | 用户名 |
| `password` | 密码 |
| `timeout_s` | 超时秒数（固定 5 秒，不询问） |

## 二、检查命令

```bash
# 检查当前 rtk_from.ntrip 连接、账号认证和 RTCM3 数据
apollo-env.sh gnss check

# 指定配置文件
apollo-env.sh gnss check --conf /apollo/modules/drivers/gnss/conf/gnss_conf.pb.txt
```

检查内容：

| 检查项 | 说明 |
|---|---|
| 配置解析 | 读取未注释的 `rtk_from.ntrip` 块 |
| 网络连接 | 连接 address:port |
| 账号认证 | 发送 Basic Auth，看是否返回 200（非 401） |
| 挂载点 | mount_point 是否存在（非 404） |
| RTCM3 数据 | 响应后是否收到 RTCM3 帧 |

结果（退出码）：

| 退出码 | 含义 |
|---|---|
| `0` | 连接、账号认证和有效 RTCM3 帧均通过 |
| `2` | 配置、网络连接、认证、挂载点或响应失败 |
| `3` | 连接和认证成功，但检查窗口内没有识别到完整 RTCM3 帧 |
| `4` | 没有启用 `rtk_from.ntrip`，当前配置没有可检查的基站账号 |

## 三、配置命令

```bash
# 交互式配置（逐项询问 5 项）
apollo-env.sh gnss configure

# 指定配置文件
apollo-env.sh gnss configure --conf /apollo/modules/drivers/gnss/conf/gnss_conf.pb.txt
```

### 配置项（固定 5 项，超时不问）

| 项 | 说明 | 默认 |
|---|---|---|
| 基站 IP 或域名 | address | 当前值 |
| 端口 | port | 当前值 |
| 挂载点 | mount_point | 当前值 |
| 用户名 | user | 当前值 |
| 密码 | password（隐藏输入，不回显） | 回车保留当前 |

超时 `timeout_s` 固定为 5 秒，不弹窗询问。

## 四、配置流程

```text
1. 读取当前 gnss_conf.pb.txt
   - 有 rtk_from.ntrip → 展示当前值，回车保留
   - 无 → 将新增配置块
2. 逐项询问 5 项（IP/端口/挂载点/账号/密码）
3. 展示待写入内容（密码脱敏显示「已填写」）
4. 用户确认（y/N）
5. 备份原配置 → 写入 rtk_from.ntrip
6. 自动验证连接、认证、RTCM3 数据
7. 提示重启 GNSS 驱动
```

## 五、关键行为

| 行为 | 说明 |
|---|---|
| 密码脱敏 | 输出中不显示密码，只用 `getpass` 隐藏输入 |
| 软链写入 | 配置路径是软链时，写入软链最终目标（realpath），不替换软链 |
| 备份 | 写入前生成 `gnss_conf.pb.txt.bak.<时间>` |
| 只改 rtk_from | 不动 `rtk_to`、`command`、`data` 等其他配置块 |
| 不重启驱动 | 配置后只提示，不自动启动/重启 GNSS 驱动 |
| 未启用时 | 配置可新增 rtk_from.ntrip 块 |

## 六、重启 GNSS 驱动（配置生效）

配置文件更新后，正在运行的 GNSS 驱动仍用旧配置，需重启：

```bash
cyber_launch stop  /apollo/modules/drivers/gnss/launch/gnss.launch
cyber_launch start /apollo/modules/drivers/gnss/launch/gnss.launch
```

## 七、相关脚本

| 脚本 | 作用 |
|---|---|
| `check_ntrip_base.py` | 只读检查，解析配置 + 连接 + 认证 + RTCM 验证 |
| `configure_ntrip_base.py` | 交互配置，备份后写入并自动检查 |
