# 激光雷达配置与检查

> 本文档描述 apollo-env skill 的激光雷达驱动能力：检查（check）、配置（configure）的完整功能、字段映射与关联分析。

## 一、雷达清单（7 厂家 12 型号）

模板：`config/lidar_templates.yaml`

| 厂家 | 型号 | 字段结构 |
|---|---|---|
| 禾赛 hesai | HESAI40P、HESAI64 | 顶层字段 |
| 禾赛2 hslidar | AT128（lidar_type 可换 Pandar 系列） | config_base 嵌套 |
| 威力登 velodyne | VLP16、HDL64E_S3D、VLS128 | 顶层字段 |
| 览沃 livox | Livox | config_base 嵌套 |
| 镭神 lslidar | CH16、CH32、CH128 | config_base 嵌套 |
| 速腾 rslidar | RS16（model 可换 RS32/RS80/RS128） | config_base 嵌套 |
| 万集 vanjee | vanjee_720_16（可换 720_32） | config_base 嵌套 |

## 二、配置文件格式（各厂家字段映射）

核心概念 → 实际字段名映射（模板里用 `concept + field + location` 记录）：

| 概念 | hesai | hslidar | velodyne | livox | lslidar | rslidar | vanjee |
|---|---|---|---|---|---|---|---|
| 设备 IP | `ip` | `device_ip` | — | `lidar_ip` | `device_ip` | `ip` | `lidar_address` |
| 本机 IP | — | `host_ip` | — | — | `group_ip` | — | `host_address` |
| 数据端口 | `lidar_recv_port` | `udp_port` | `firing_data_port` | — | `msop_port` | `msop_port` | `host_msop_port` |
| 辅助端口 | `gps_recv_port` | `ptc_port` | `positioning_data_port` | — | `difop_port` | `difop_port` | `lidar_msop_port` |
| 型号 | `model` | `lidar_type` | `model` | — | `model` | `model` | `model` |
| frame_id | `frame_id`(顶) | `config_base` | `frame_id`(顶) | `config_base` | `config_base` | `config_base` | `config_base` |
| 点云 channel | `pointcloud_channel` | `config_base` | `convert_channel_name` | `config_base` | `config_base` | `config_base` | `config_base` |
| 扫描 channel | `scan_channel` | `config_base` | `scan_channel` | `config_base` | `config_base` | `config_base` | `config_base` |

示例（hesai40p.pb.txt，顶层结构）：

```text
ip: "192.168.20.13"
lidar_recv_port: 2368
gps_recv_port: 8308
frame_id: "lidar16_back"
pointcloud_channel: "/apollo/sensor/hesai40/PointCloud2"
scan_channel: "/apollo/sensor/hesai40/Scan"
model: HESAI40P
```

示例（lslidar，config_base 嵌套结构）：

```text
config_base {
    scan_channel: "/apollo/sensor/lslidarCH16/Scan"
    point_cloud_channel: "/apollo/sensor/lslidarCH16/PointCloud2"
    frame_id: "lslidarCH16"
    source_type: ONLINE_LIDAR
}
model: LSLIDAR_CH16
device_ip: "192.168.1.200"
msop_port: 2368
difop_port: 2369
```

## 三、检查命令

```bash
apollo-env.sh lidar list                    # 列出支持的型号
apollo-env.sh lidar check --model HESAI40P   # 检查配置
```

check 输出：

| 检查项 | 说明 |
|---|---|
| 配置解析 | 读驱动 conf，展示字段值（支持顶层/config_base） |
| 网段匹配 | 雷达 IP vs 本机网卡网段 |
| channel 链路 | 驱动点云 → 补偿器输出 |
| channel 关联完整性 | 遍历关联文件，检查订阅值是否一致 |
| frame_id 关联完整性 | 同上 |
| UDP 探测 | 端口是否收到数据（可 `--no-udp` 跳过） |

## 四、配置命令

```bash
apollo-env.sh lidar configure --model HESAI40P
```

命令行传参：

```bash
apollo-env.sh lidar configure --model RS16 \
  --model-value RS32 \          # 改型号（带可选值）
  --device-ip 192.168.1.100 \   # 设备 IP
  --host-ip 192.168.1.1 \       # 本机 IP（部分厂家有）
  --data-port 6699 \            # 数据端口
  --aux-port 7788 \             # 辅助端口
  --frame-id rslidar_front \    # frame_id
  --pointcloud /apollo/sensor/rslidar/front/PointCloud2 \
  --scan /apollo/sensor/rslidar/front/Scan
```

### 配置项（8 项，都支持修改）

| 项 | 说明 |
|---|---|
| 型号 | 从可选型号选，选了自动带出校准/校正文件 |
| 设备 IP | 各厂家字段名不同 |
| 本机 IP | 部分厂家有 |
| 数据端口 | 各厂家字段名不同 |
| 辅助端口 | 部分厂家有 |
| frame_id | TF 帧 ID |
| pointcloud_channel | 点云 channel |
| scan_channel | 扫描 channel |

## 五、型号自动关联配置（model_configs）

选型号时，自动同步该型号的校准/校正文件：

| 厂家 | 型号字段 | 自动同步 |
|---|---|---|
| velodyne | model | calibration_file（VLP16/32/HDL64E/VLS128） |
| lslidar | model | calibration_file（CH16/32/64/120/128） |
| hslidar | lidar_type | correction_file_path + firetimes_path（Pandar 系列） |
| vanjee | model | angle_path（720_16/720_32） |

示例（VLP16 → HDL64E）：

```text
雷达型号：VLP16 → HDL64E
型号关联 calibration_file：VLP16_calibration.yaml → 64E_S3_calibration_example.yaml
```

## 六、channel / frame_id 关联文件（common_linked_files）

改了 channel 或 frame_id，自动列出需要同步的关联文件（只列不自动改）：

**pointcloud_channel 关联（7 处）：**

```text
[低风险] perception/pointcloud_preprocess/dag → 感知预处理订阅
[低风险] loam_velodyne/conf → 激光里程计订阅
[低风险] slam_local/conf → SLAM 定位订阅
[低风险] localization/conf/msf_localization → MSF 定位订阅
[低风险] drivers/lidar/dag/lidar.dag → 补偿器订阅
[高危] dreamview_plus_plugins/calibration_tool → 标定工具
[低风险] private_tools/tile_map_images_creator → 地图图像工具
```

**frame_id 关联（7 处）：**

```text
[高危] transform/conf/static_transform_conf → TF 静态外参
[高危] perception/data/params/lidar16_back_extrinsics → 雷达外参
[高危] perception/data/conf/sensor_meta → 感知传感器元数据
[高危] perception/multi_sensor_fusion → 感知融合
[高危] perception/pointcloud_preprocess/conf → 感知预处理
[低风险] loam_velodyne/conf → 激光里程计 frame
[高危] dreamview_plus_plugins/calibration_tool → 标定工具 frame
```

## 七、配置流程

```text
1. lidar list 选型号
2. 选型号 → 自动带出校准/校正文件
3. 收集 IP / 端口 / frame_id / channel
4. 展示待写入 + 型号关联配置
5. 始终展示 channel / frame_id 关联文件清单
6. 确认 → 备份 → 写入驱动 conf → 提示重启
```

## 八、扩展（加新雷达）

在 `lidar_templates.yaml` 的 `lidars:` 下复制一个条目块，改 4 样东西：

```yaml
- model: 新型号              # 1. 型号
  vendor: 厂家                # 2. 厂家
  driver_conf: /apollo/...    # 3. conf 路径
  fields:                     # 4. 字段映射（concept → field + location + default）
    - { concept: device_ip, field: ip, location: top, default: "..." }
    - { concept: frame_id, field: frame_id, location: config_base, default: "..." }
```

脚本只认概念（device_ip/data_port/frame_id/pointcloud/scan/model），不认具体字段名，脚本零改动。

## 九、相关脚本

| 脚本 | 作用 |
|---|---|
| `check_lidar.py` | 解析 + 网段 + 链路 + 关联完整性 + UDP |
| `configure_lidar.py` | 配置向导（型号关联 + 关联文件提示） |
