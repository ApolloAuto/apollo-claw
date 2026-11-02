# 相机配置、检查与新增

> 本文档描述 apollo-env skill 的相机驱动能力：检查（check）、配置（configure）、新增（add）的完整功能与格式。

## 一、相机清单与分类

相机共 27 个，分两类，对应两个 dag：

| dag | 相机系列 | camera_dev | 示例 |
|---|---|---|---|
| `camera.dag` | Onsemi/Spherical（13 个） | `/dev/videoX` | Narrow、Wide、backward、fisheye_front、traffic |
| `camera_no_compress.dag` | 通用系列（14 个） | `/dev/camera/xxx` | camera_front_6mm、camera_front_12mm、camera_front_fisheye |

模板：`config/camera_templates.yaml`，每个相机记录 `name / conf / camera_dev / frame_id`。

## 二、相机配置文件格式

每个相机一个 conf，路径 `/apollo/modules/drivers/camera/conf/<name>.pb.txt`：

```text
camera_dev: "/dev/video12"              # video 硬件地址（核心，可改）
frame_id: "fisheye_front"               # TF 帧 ID
pixel_format: "yuyv"
io_method: IO_METHOD_MMAP
width: 2880
height: 1860
frame_rate: 10
brightness: -1
contrast: -1
...
channel_name: "/apollo/sensor/camera/camera_fisheye_front/image"
raw_channel_name: "/apollo/sensor/camera/camera_fisheye_front/raw/image"
device_wait_ms: 2000
output_type: RGB

compress_conf {
    output_channel: "/apollo/sensor/camera/camera_fisheye_front/image/compressed"
    image_pool_size: 100
}
```

按需求：**只改 `camera_dev`**，其他字段（frame_id、channel、分辨率、图像参数）保持不动。

## 三、dag 格式（启动控制）

`camera.dag` / `camera_no_compress.dag` 里，每个相机是一个 component：

```text
module_config {
    module_library : "modules/drivers/camera/libcamera_component.so"

    components {                          # 启用（无 #）
        class_name : "CameraComponent"
        config {
            name : "backward"
            config_file_path : "/apollo/modules/drivers/camera/conf/backward.pb.txt"
        }
    }

    # components {                        # 禁用（注释掉）
    #     class_name : "CameraComponent"
    #     config {
    #         name : "Narrow"
    #         config_file_path : "/apollo/modules/drivers/camera/conf/Narrow.pb.txt"
    #     }
    # }
}
```

启用/禁用 = 取消注释/加注释对应 component 块。

## 四、检查命令

```bash
apollo-env.sh camera list      # 列出 27 个相机 + camera_dev + frame_id
apollo-env.sh camera check     # dag 启用状态 + 设备存在性
```

check 输出：
- dag 当前启用的相机
- 全部相机清单（状态 + camera_dev + frame_id + 设备是否存在）
- 缺失设备的相机清单（未接相机时提示）

## 五、配置命令

```bash
# 选择启用的相机 + 修改 camera_dev
apollo-env.sh camera configure \
  --enable "fisheye_front,traffic" \
  --devs "fisheye_front:/dev/video14"
```

参数：

| 参数 | 说明 |
|---|---|
| `--enable` | 要启用的相机名，逗号分隔 |
| `--devs` | camera_dev 映射，`相机名:设备地址` 逗号分隔 |

流程：

```text
1. 列出相机 + 当前 dag 启用状态
2. 选择要启用的相机（dag 启用对应 component）
3. 对每个相机修改 camera_dev
4. 展示待修改
5. 确认 → 备份 → 写入 dag + conf
6. 提示重启相机驱动
```

## 六、新增相机命令

```bash
# 命令行
apollo-env.sh camera add \
  --name camera_front_2 \
  --dev /dev/video11 \
  --frame-id camera_front_2 \
  --ref camera_front_6mm \
  --dag camera_no_compress

# 交互式
apollo-env.sh camera add
```

参数：

| 参数 | 说明 |
|---|---|
| `--name` | 相机名（conf 文件名 + dag name） |
| `--dev` | camera_dev 硬件地址 |
| `--frame-id` | TF 帧 ID |
| `--ref` | 参考相机（复制其分辨率/图像参数） |
| `--dag` | 目标 dag：`camera` 或 `camera_no_compress` |

自动完成 4 步：

```text
1. 基于参考相机 conf 生成新 conf（替换 camera_dev/frame_id/channel）
2. 写入 profile 目录 profiles/ARCF_40P/.../camera/conf/
3. 更新 camera_templates.yaml 加条目
4. 目标 dag 加注释块 + 重新 aem profile use 挂软链
```

## 七、关键行为

| 行为 | 说明 |
|---|---|
| 只改 camera_dev | 其他字段（frame_id/channel/分辨率）保持不变 |
| dag 控制 | 启用/禁用 = 取消注释/加注释 component 块 |
| profile 持久化 | 新 conf 写 profile 目录，重新 profile use 挂软链 |
| 备份 | 写 dag/conf 前生成 `.bak.<时间>` |
| 不重启驱动 | 配置后只提示，不自动重启 |

## 八、关键路径

| 项 | 路径 |
|---|---|
| 相机模板 | `config/camera_templates.yaml` |
| 相机 conf | `/apollo/modules/drivers/camera/conf/<name>.pb.txt` |
| dag | `/apollo/modules/drivers/camera/dag/camera.dag`、`camera_no_compress.dag` |
| 启动 | `cyber_launch start /apollo/modules/drivers/camera/launch/camera.launch` |

## 九、相关脚本

| 脚本 | 作用 |
|---|---|
| `check_camera.py` | 列出相机 + dag 启用状态 + 设备存在性 |
| `configure_camera.py` | 选择 dag 启用相机 + 修改 camera_dev |
| `add_camera.py` | 新增相机（conf + 模板 + dag + profile use） |
