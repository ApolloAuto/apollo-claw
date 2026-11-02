# apollo-env 知识库索引（跨子 skill）

> apollo-env 已拆分为「1 导航 + 7 子 skill」，知识库分散在各子 skill 的 `references/` 下。本索引按子 skill 汇总。

## 各子 skill 知识库位置

| 子 skill | 知识库内容 |
|---|---|
| apollo-install | `references/knowledge/02_安装部署/`（11 篇）、`07_FAQ故障排查/`（8 篇） |
| apollo-vehicle-restore | `references/restore_format.md`（车型配置切换/恢复格式） |
| apollo-vehicle-usage | `references/knowledge/08_HQEV车辆使用/`（车辆使用说明） |
| apollo-gnss-config | `references/gnss_format.md`（GNSS 格式） |
| apollo-lidar-config | `references/lidar_format.md`（雷达格式） |
| apollo-camera-config | `references/camera_format.md`（相机格式） |
| apollo-env | `references/usage_examples.md`（命令示例）、本索引 |

## 关键词 → 子 skill 路由

| 关键词 / 问题类型 | 路由到子 skill |
|---|---|
| 切换车型配置、车型恢复、restore/rollback、基线、sample 切换、备份格式 | apollo-vehicle-restore |
| GNSS 基站、NTRIP、rtk_from、挂载点、账号认证、RTCM3 | apollo-gnss-config |
| 激光雷达、lidar、雷达型号、channel/frame_id 关联、校准文件 | apollo-lidar-config |
| 相机、camera、camera_dev、dag 启动、新增相机 | apollo-camera-config |
| HQEV 车辆使用、解锁、启动、断电、充电 | apollo-vehicle-usage |
| 环境检测、系统检查 | apollo-env-check |
| 安装、Docker、aem、buildtool 报错、recover conf failed | apollo-install |

## 常见问题路由

| 问题 | 子 skill + 文档 |
|---|---|
| `recover conf failed` 断链 | apollo-install → `07_FAQ故障排查/aem profile use 报 recover conf failed.md` |
| `openssl/ssl.h` 编译失败 | apollo-install → `07_FAQ故障排查/openssl_ssl.h 找不到 编译报错.md` |
| buildtool 编译报错 | apollo-install → `07_FAQ故障排查/buildtool build -p core 报错指南.md` |
| 车辆无法解锁/启动/充电 | apollo-vehicle-usage → `08_HQEV车辆使用/HQEV车辆使用快问快答.md` |
