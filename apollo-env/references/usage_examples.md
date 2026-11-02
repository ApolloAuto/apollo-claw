# apollo-env 使用示例

> `apollo-env` 是导航入口，功能拆到 7 个子 skill。统一转发器 `apollo-env.sh` 仍可用，等价于
> `bash ${DSH_HOME:-$HOME/.dsh}/skills/apollo-env/scripts/apollo-env.sh`。

## 一、路由到子 skill

| 需求 | 子 skill | 命令入口 |
|---|---|---|
| 环境检测 | apollo-env-check | /apollo-env-check |
| 安装/诊断 | apollo-install | /apollo-install |
| 车型恢复 | apollo-vehicle-restore | /apollo-vehicle-restore |
| 车辆使用 | apollo-vehicle-usage | /apollo-vehicle-usage |
| GNSS 基站 | apollo-gnss-config | /apollo-gnss-config |
| 激光雷达 | apollo-lidar-config | /apollo-lidar-config |
| 相机 | apollo-camera-config | /apollo-camera-config |

## 二、车型恢复（apollo-vehicle-restore）

```bash
apollo-env.sh targets                              # 列出目标
apollo-env.sh report --target ARCF_40P --diff      # 轻量报告 + 差异
apollo-env.sh restore --target ARCF_40P --dry-run  # 预览
apollo-env.sh restore --target ARCF_40P --yes      # 恢复（免确认）
apollo-env.sh rollback --backup <备份目录>          # 回滚
apollo-env.sh baseline create --target ARCF_40P --version v2  # 建基线
apollo-env.sh stamp verify --target ARCF_40P       # 指纹校验
```

恢复后下载感知模型（外置）：

```bash
bash apollo-vehicle-restore/scripts/download_perception_models.sh --target ARCF_40P
aem profile use ARCF_40P
```

## 三、GNSS 基站（apollo-gnss-config）

```bash
apollo-env.sh gnss check    # 检查
apollo-env.sh gnss configure # 交互配置（IP/端口/挂载点/账号/密码）
```

## 四、激光雷达（apollo-lidar-config）

```bash
apollo-env.sh lidar list                     # 列型号
apollo-env.sh lidar check --model HESAI40P   # 检查
apollo-env.sh lidar configure --model RS16 --device-ip 192.168.1.100 --yes  # 配置
```

## 五、相机（apollo-camera-config）

```bash
apollo-env.sh camera list
apollo-env.sh camera check
apollo-env.sh camera configure --enable "backward" --yes
apollo-env.sh camera add --name xxx --dev /dev/videoN --frame-id xxx --ref camera_front_6mm
```

## 六、环境检测（apollo-env-check）

```bash
apollo-env.sh check              # 环境检测
apollo-env.sh check --json 2>/dev/null || bash apollo-env-check/scripts/env_check.sh --json
```

## 七、非交互自动化

脚本默认交互确认，加 `--yes` 或命令行传参可跳过确认：

```bash
apollo-env.sh restore --target ARCF_40P --yes
apollo-env.sh lidar configure --model RS16 --device-ip 192.168.1.100 --yes
apollo-env.sh camera configure --enable "backward" --yes
```
