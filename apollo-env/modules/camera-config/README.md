# 相机配置与检查

配置相机 dag 启动和 camera_dev 硬件地址。

## 命令

```bash
# 列出相机
python3 {BASE_DIR}/scripts/check_camera.py

# 配置（选择 dag 启用相机 + 修改 camera_dev）
python3 {BASE_DIR}/scripts/configure_camera.py \
  --enable "backward,fisheye_front" --devs "fisheye_front:/dev/video14" [--yes]

# 新增相机
python3 {BASE_DIR}/scripts/add_camera.py \
  --name camera_front_2 --dev /dev/video11 --frame-id camera_front_2 \
  --ref camera_front_6mm --dag camera_no_compress
```

## 相机清单

27 个相机，分两类 dag：

| dag | 系列 | camera_dev |
|---|---|---|
| camera.dag | Onsemi/Spherical | /dev/videoX |
| camera_no_compress.dag | 通用系列 | /dev/camera/xxx |

## 关键行为

- 只改 `camera_dev`，其他字段（frame_id/channel/分辨率）不动
- dag 启用/禁用 = 取消注释/加注释 component 块
- 新 conf 写 profile 目录 + 重新 profile use 挂软链

## 格式文档

`references/camera_format.md`
