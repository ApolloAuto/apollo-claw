# 激光雷达配置与检查

七厂家模板驱动，配置/检查雷达。

## 命令

```bash
# 列出支持的型号
python3 {BASE_DIR}/scripts/check_lidar.py --list  # 或查看 config/lidar_templates.yaml

# 检查（解析/网段/channel/frame_id 关联/UDP）
python3 {BASE_DIR}/scripts/check_lidar.py --model HESAI40P [--no-udp]

# 交互式配置
python3 {BASE_DIR}/scripts/configure_lidar.py --model HESAI40P

# 非交互配置
python3 {BASE_DIR}/scripts/configure_lidar.py --model RS16 \
  --model-value RS32 --device-ip 192.168.1.100 --frame-id rslidar_front --yes
```

## 支持型号

| 厂家 | 型号 |
|---|---|
| hesai | HESAI40P、HESAI64 |
| hslidar | AT128 |
| velodyne | VLP16、HDL64E_S3D、VLS128 |
| livox | Livox |
| lslidar | CH16、CH32、CH128 |
| rslidar | RS16 |
| vanjee | vanjee_720_16 |

## 配置项

型号、设备 IP、本机 IP、数据端口、辅助端口、frame_id、pointcloud_channel、scan_channel。

## 关键机制

- **型号自动关联**：选型号自动带出校准/校正文件
- **channel/frame_id 关联**：改了提示感知/定位/TF/标定关联文件（只列不自动改）
- **可扩展**：加新雷达 = 复制 `config/lidar_templates.yaml` 条目块

## 格式文档

`references/lidar_format.md`
