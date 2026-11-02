# 车型恢复功能与格式

> 本文档描述 apollo-env skill 的「车型恢复」能力：恢复（restore）、回滚（rollback）、基线（baseline）的完整功能与数据格式。

## 一、恢复命令

```bash
# 预览差异（不修改任何文件）
apollo-env.sh restore --target ARCF_40P --dry-run

# 正式恢复（先对比，有差异才备份并恢复）
apollo-env.sh restore --target ARCF_40P

# 回滚（从某次恢复前生成的备份还原）
apollo-env.sh rollback --backup /apollo_workspace/.apollo-env/backups/20260910-154119-ARCF_40P
```

### ARCF_40P 完整恢复流程（含模型外置）

```text
第 1 步  查看状态    apollo-env.sh report --target ARCF_40P --diff
第 2 步  预览差异    apollo-env.sh restore --target ARCF_40P --dry-run
第 3 步  正式恢复    apollo-env.sh restore --target ARCF_40P
第 4 步  下载模型    bash scripts/download_perception_models.sh --target ARCF_40P
第 5 步  应用参数    aem profile use ARCF_40P
```

```bash
# 完整命令序列
cd /apollo_workspace

apollo-env.sh report --target ARCF_40P --diff
apollo-env.sh restore --target ARCF_40P --dry-run
apollo-env.sh restore --target ARCF_40P

# 感知模型外置：基线不含模型权重，恢复后单独下载
bash apollo-env/modules/vehicle-restore/scripts/download_perception_models.sh --target ARCF_40P

# 重新应用参数，使模型软链生效
aem profile use ARCF_40P
```

> 感知模型（yolox3d_onnx / center_point_paddle / cpdet / pointwise_unet / efficient_net / tl_detection_yolox / yolox_garbage_onnx 共 7 个，约 744M）不打包进基线，恢复后由 `download_perception_models.sh --target ARCF_40P` 下载到 `profiles/ARCF_40P/modules/perception/data/models/`（恢复的目标参数目录）。

## 二、基线格式（恢复的数据来源）

```text
baselines/
└── ARCF_40P/
    ├── latest -> v2          # 软链，指向当前生效版本
    ├── v1/                   # 旧版本（含模型，约 1.4G）
    │   ├── parameters.yaml
    │   ├── code.yaml
    │   ├── apollo_profiles.tar.gz   # 含模型权重
    │   ├── apollo_code.tar.gz
    │   └── README.md
    └── v2/                   # 当前版本（模型外置，约 30M）
        ├── parameters.yaml   # 参数清单（含 SHA-256、指纹）
        ├── code.yaml         # 代码清单（含 SHA-256）
        ├── apollo_profiles.tar.gz   # 参数归档（不含模型，约 102K）
        ├── apollo_code.tar.gz       # 代码归档（约 30M）
        └── README.md         # 恢复顺序说明
```

### parameters.yaml 关键字段

```yaml
target_id: ARCF_40P
baseline_id: ARCF_40P_parameters_v1
status: verified_by_user
platform: apollo
apollo_version: "11.0.0"
workspace: /apollo_workspace
profile_package: ARCF_40P
profile_current: /apollo_workspace/profiles/current
expected_current_target: /apollo_workspace/profiles/ARCF_40P
temporary_profile: sample

identity:
  stamp:
    path: /apollo_workspace/profiles/ARCF_40P/.apollo_vehicle_stamp.yaml
    content_hash: 92ceb4196c17a6c7...   # 车型内容指纹
    verify_command: bash scripts/vehicle_stamp.sh verify --target ARCF_40P

artifact:
  path: apollo_profiles.tar.gz   # 归档与 manifest 同目录
  sha256: 36019e77475a9e7b...
  archive_root: profiles/ARCF_40P   # 解压顶层目录
  file_count: 508
  directory_count: 369

restore:
  workspace_required: /apollo_workspace
  temporary_profile_command: aem profile use sample
  restore_into_profile_directory: true
  restore_via_current_link: false
  switch_back_command: aem profile use ARCF_40P
  final_current_check_required: true

protected_paths:
  - /apollo_workspace/profiles/current
  - /apollo_workspace/profiles/sample
```

### code.yaml 关键字段

```yaml
target_id: ARCF_40P
baseline_id: ARCF_40P_code_v1
source_root: /apollo_workspace/modules

artifact:
  path: apollo_code.tar.gz
  sha256: b052f88ed30c316a...
  archive_root: modules   # 解压顶层目录

restore:
  workspace_required: /apollo_workspace
  restore_root: /apollo_workspace/modules
  build_workspace: /apollo_workspace
  build_command: buildtool build -p <code_directory>
  build_directories:
    - modules
  extra_current_files: preserve_and_report      # 基线外文件保留并报告
  missing_baseline_files: restore               # 缺失文件恢复
  changed_baseline_files: backup_then_restore   # 不一致文件备份后恢复
  baseline_only_deletions: require_confirmation # 基线删除需确认
```

## 三、恢复流程（restore_baseline.sh）

```text
1. 校验车型指纹 + Apollo 版本
     exit 3 = 身份不匹配 → 立即停止
     exit 4 = 内容漂移 → 报告后继续
2. 校验参数/代码归档 SHA-256
3. 对比参数目录 profiles/<目标> 与 /apollo_workspace/modules
4. 都无差异 → 提示「当前环境正常」，零修改退出
5. 有差异 → 展示差异摘要 → 二次确认（默认 y/N）
6. 确认 → 备份 → aem profile use sample
7. 确认 current 已脱离目标参数 → 恢复参数（解压到 /apollo_workspace）
8. aem profile use <目标> → 确认 current 指回
9. 恢复代码（仅代码有差异时）+ buildtool build
10. 最终校验参数、代码、软链、版本
```

## 四、备份格式（回滚的数据来源）

```text
.apollo-env/backups/
└── 20260910-154119-ARCF_40P/   # 命名：时间戳-目标
    ├── parameters/             # 恢复前 profiles/ARCF_40P 完整拷贝
    ├── modules/                # 恢复前 /apollo_workspace/modules 完整拷贝
    ├── current.link            # 恢复前 current 软链目标
    ├── workspace.json          # .workspace.json
    ├── env                     # .env
    └── git-status.txt          # git 状态
```

## 五、恢复规则

| 规则 | 说明 |
|---|---|
| 旧 restore 无 `--scope` | `restore --target` 保持参数 + 代码整体处理的兼容行为 |
| 新 plan 有作用域 | `plan --scope full|sensor|module` 非交互生成 JSON；`execute` 默认仍 dry-run |
| 对比优先 | 无差异提示正常，不切 sample、不覆盖、不构建 |
| 二次确认 | 有差异时默认 `y/N`，未确认零修改 |
| sample 切换 | 恢复参数前切走 current，恢复后再切回 |
| recover conf failed | 容忍（只要 current 正确指向目标） |
| 基线外文件 | 默认保留并报告，不自动删除 |
| 代码无差异 | 跳过代码恢复和构建 |
| 归档校验 | SHA-256 不匹配则停止 |

## 六、关键路径

| 项 | 路径 |
|---|---|
| 基线 | `/apollo_workspace/apollo-env/modules/vehicle-restore/baselines/<目标>/<版本>/` |
| 备份 | `/apollo_workspace/.apollo-env/backups/<时间>-<目标>/` |
| 参数归档解压到 | `/apollo_workspace`（形成 `profiles/<目标>/`） |
| 代码归档解压到 | `/apollo_workspace`（形成 `modules/`） |
| 参数目录 | `/apollo_workspace/profiles/<目标>/` |
| 代码目录 | `/apollo_workspace/modules/` |
| 车型指纹 | `/apollo_workspace/profiles/<目标>/.apollo_vehicle_stamp.yaml` |

> 归档顶层目录是 `profiles/<目标>` 和 `modules`，恢复时统一解压到 `/apollo_workspace`，不会产生 `modules/modules` 或 `profiles/profiles` 嵌套错误。

## 七、相关命令

```bash
# 目标与报告
apollo-env.sh targets
apollo-env.sh report --target ARCF_40P --diff

# 基线
apollo-env.sh baseline create --target ARCF_40P --version v2
apollo-env.sh baseline list

# 指纹
apollo-env.sh stamp scan
apollo-env.sh stamp verify --target ARCF_40P
```
