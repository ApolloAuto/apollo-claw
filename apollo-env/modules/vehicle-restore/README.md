# Apollo 车型配置切换、恢复与回滚

管理车型参数/代码基线，支持恢复、回滚、基线建立、车型指纹和感知模型下载。

## 命令

```bash
# 预览差异
bash {BASE_DIR}/scripts/restore_baseline.sh --target ARCF_40P --dry-run

# 恢复（对比后，有差异才恢复，二次确认；--yes 免确认）
bash {BASE_DIR}/scripts/restore_baseline.sh --target ARCF_40P [--yes]

# 回滚
bash {BASE_DIR}/scripts/rollback_baseline.sh --backup <备份目录>

# 建基线（多版本）
bash {BASE_DIR}/scripts/make_baseline.sh --target ARCF_40P [--version v2]

# 车型指纹
bash {BASE_DIR}/scripts/vehicle_stamp.sh scan/verify/stamp/hash

# 下载感知模型（外置，不随基线）
bash {BASE_DIR}/scripts/download_perception_models.sh --target ARCF_40P
```

## 恢复流程

```text
校验指纹/版本 → 校验归档 SHA → 对比参数+代码
→ 无差异提示正常 → 有差异二次确认 → 备份 → 切 sample
→ 恢复参数 → 切回目标 → 恢复代码 → 构建 → 校验
```

## 关键文件

| 文件 | 作用 |
|---|---|
| `baselines/` | 车型基线（ARCF_40P/HQEV/HQEV_BDN） |
| `registry/targets.yaml` | 目标注册表 |
| `scripts/restore_baseline.sh` | 恢复 |
| `scripts/rollback_baseline.sh` | 回滚 |
| `scripts/make_baseline.sh` | 建基线 |
| `scripts/vehicle_stamp.sh` | 车型指纹 |
| `scripts/download_perception_models.sh` | 下载感知模型 |
| `references/restore_format.md` | 恢复格式说明 |

## 感知模型外置

模型权重（约 744M）不随基线，恢复后需重新下载：

```bash
bash {BASE_DIR}/scripts/restore_baseline.sh --target ARCF_40P --yes
bash {BASE_DIR}/scripts/download_perception_models.sh --target ARCF_40P
aem profile use ARCF_40P
```

## 编译状态与「一致」的判定

参数和代码与基线一致，**不代表编译已经完成**。代码刚铺好但还没编译时，对比结果同样是「一致」。

因此恢复脚本会记录编译状态：

- 编译成功后写 `$WS/.apollo-env/build-state/<车型>.state`，含基线代码包的 `code_signature`。
- 「参数和代码一致」时，先读这个标记：
  - 标记存在且签名匹配、`status=ok` → 直接通过，不重复编译；
  - 标记缺失、`status=incomplete`、或代码包变了 → **自动补编译**，不会停在「一致就退出」。
- 编译失败或中断时退出码为 `10`（部分完成），可单独续跑：

```bash
restore_baseline.sh --target <车型> --build-only
```

## 车型与 Apollo 版本

版本**不在代码里写死**，而是每个基线自己在 `baselines/<车型>/latest/parameters.yaml` 的
`apollo_version` 字段里声明。插件和脚本都读这个字段，所以新增车型不需要改代码。

当前已知（仅作说明，不是逻辑依据）：

| 车型 | Apollo 版本 |
|---|---|
| ARCF_40P | 11.0.0 |
| HQEV | 9.1.1 |
| HQEV_BDN | 9.1.1 |
| 以后新增 | 以该基线 `parameters.yaml` 的 `apollo_version` 为准 |

### 版本不匹配时的行为

- 预览会显示「版本不匹配：基线 X，本机 Y。该车型不可恢复」。
- 该车型的「确认恢复」按钮被禁用，但**车型下拉仍可用**，可以改选本机同版本的车型。
- 判断是逐个车型独立做的：一台 11.0.0 的机器上，ARCF_40P 可恢复，HQEV/HQEV_BDN 被禁用。

### 新增车型步骤

```bash
# 在目标车辆环境上（该环境即是该车型对应的 Apollo 版本）
bash scripts/make_baseline.sh --target <新车型ID>
```

建好后插件会自动发现：出现在车型下拉里，版本取自该基线的 `apollo_version`。
