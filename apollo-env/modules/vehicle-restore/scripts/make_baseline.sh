#!/usr/bin/env bash
# Apollo 车型基线制作脚本 (apollo-env skill)
# 从当前已确认健康的工作区，为指定车型生成参数 + 代码基线归档和清单。
#
# Usage:
#   bash make_baseline.sh --target <ID> [--version vN] [--workspace /apollo_workspace] [--dry-run]
#
# Exit codes: 0=成功, 1=参数/前置检查失败, 2=目标基线已存在

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
die()  { echo -e "${RED}❌ $1${NC}" >&2; exit "${2:-1}"; }
sect() { echo -e "\n${CYAN}【$1】${NC}"; }

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=""; BVER="v1"; WS="/apollo_workspace"; DRY=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)    TARGET="${2:-}"; shift 2 ;;
        --version)   BVER="${2:-}";   shift 2 ;;
        --workspace) WS="${2:-}";     shift 2 ;;
        --dry-run)   DRY=1; shift ;;
        *) die "未知参数: $1" ;;
    esac
done

[[ -n "$TARGET" ]] || die "必须指定 --target <车型ID>，例如 --target HQEV"
[[ "$TARGET" =~ ^[A-Za-z0-9_-]+$ ]] || die "车型ID 只允许字母、数字、下划线和连字符: $TARGET"
[[ "$BVER"   =~ ^v[0-9]+$ ]]        || die "基线版本格式应为 vN，例如 v1: $BVER"

PROFILE_DIR="$WS/profiles/$TARGET"
MODULES_DIR="$WS/modules"
OUT_DIR="$BASE_DIR/baselines/$TARGET/$BVER"

# ---------------- Step 1: 前置检查 ----------------
sect "前置检查"
[[ -d "$WS" ]]           || die "工作区不存在: $WS"
[[ -d "$PROFILE_DIR" ]]  || die "参数目录不存在: $PROFILE_DIR（请先把该车型参数放到 profiles/$TARGET/）"
[[ -d "$MODULES_DIR" ]]  || die "代码目录不存在: $MODULES_DIR（请先把车型代码放到 modules/）"
ok "参数目录 $PROFILE_DIR"
ok "代码目录 $MODULES_DIR"

if [[ -e "$OUT_DIR" && $DRY -eq 0 ]]; then
    die "基线版本目录已存在: $OUT_DIR。不覆盖已有版本，请改用 --version vN。" 2
fi

# 版本信息
WS_JSON="$WS/.workspace.json"
[[ -f "$WS_JSON" ]] || die "缺少 $WS_JSON"
WS_SHA="$(sha256sum "$WS_JSON" | awk '{print $1}')"
APOLLO_VER="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$WS_JSON" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
ok "Apollo 版本 ${APOLLO_VER:-unknown}（.workspace.json sha256 ${WS_SHA:0:12}…）"

ENV_NAME=""; ENV_REPO=""; ENV_TAG=""; ENV_WORKLOCAL="false"
if [[ -f "$WS/.env" ]]; then
    # shellcheck disable=SC1091
    ENV_NAME=$(grep -E '^APOLLO_ENV_NAME=' "$WS/.env" | cut -d= -f2- | tr -d "'\"" || true)
    ENV_REPO=$(grep -E '^APOLLO_ENV_CONTAINER_REPO=' "$WS/.env" | cut -d= -f2- | tr -d "'\"" || true)
    ENV_TAG=$(grep  -E '^APOLLO_ENV_CONTAINER_TAG='  "$WS/.env" | cut -d= -f2- | tr -d "'\"" || true)
    [[ "$(grep -E '^APOLLO_ENV_WORKLOCAL=' "$WS/.env" | cut -d= -f2- | tr -d "'\"" || true)" == "1" ]] && ENV_WORKLOCAL="true"
    ok "环境标识 ${ENV_NAME:-unknown}（仅记录，不作身份判据）"
fi

# current 软链身份校验
CUR_LINK="$WS/profiles/current"
if [[ -L "$CUR_LINK" ]]; then
    CUR_TGT="$(readlink "$CUR_LINK")"
    if [[ "$(basename "$CUR_TGT")" == "$TARGET" ]]; then
        ok "profiles/current -> $CUR_TGT （与目标一致）"
    else
        warn "profiles/current -> $CUR_TGT ，与目标 $TARGET 不一致；基线只记录 profiles/$TARGET 的内容"
    fi
else
    warn "profiles/current 不存在或不是软链；建议先执行 (cd $WS && aem profile use $TARGET) 确认参数可生效"
fi

if [[ $DRY -eq 1 ]]; then
    echo -e "\n${CYAN}[dry-run] 将生成：${NC}"
    echo "  $OUT_DIR/apollo_profiles.tar.gz   (archive_root: profiles/$TARGET)"
    echo "  $OUT_DIR/apollo_code.tar.gz       (archive_root: modules)"
    echo "  $OUT_DIR/parameters.yaml  $OUT_DIR/code.yaml  $OUT_DIR/README.md"
    echo "  参数目录条目数: $(find "$PROFILE_DIR" -type f | wc -l) 文件 / $(find "$PROFILE_DIR" -type d | wc -l) 目录"
    echo "  代码目录条目数: $(find "$MODULES_DIR" -type f | wc -l) 文件 / $(find "$MODULES_DIR" -type d | wc -l) 目录"
    exit 0
fi

mkdir -p "$OUT_DIR"
BASELINE_DATE="$(date +%F)"

# ---------------- Step 1.5: 写入车型指纹 ----------------
# 指纹落在参数目录内，随归档一起打包和恢复，使身份判定不依赖 profiles/current
# 软链，也不依赖不固定的 APOLLO_ENV_NAME。必须在打包之前写入。
sect "写入车型指纹"
STAMP_SH="$BASE_DIR/scripts/vehicle_stamp.sh"
[[ -f "$STAMP_SH" ]] || die "缺少 $STAMP_SH"
bash "$STAMP_SH" stamp --target "$TARGET" --workspace "$WS" \
    --baseline-id "${TARGET}_parameters_${BVER}" \
    | sed 's/^/  /'
STAMP_NAME=".apollo_vehicle_stamp.yaml"
CONTENT_HASH="$(bash "$STAMP_SH" hash --target "$TARGET" --workspace "$WS")"

# ---------------- Step 2: 打包参数 ----------------
sect "打包参数"
P_FILES=$(find "$PROFILE_DIR" -type f | wc -l)
P_DIRS=$(find "$PROFILE_DIR" -type d | wc -l)
tar -czf "$OUT_DIR/apollo_profiles.tar.gz" -C "$WS" "profiles/$TARGET"
P_SHA="$(sha256sum "$OUT_DIR/apollo_profiles.tar.gz" | awk '{print $1}')"
ok "apollo_profiles.tar.gz  $P_FILES 文件 / $P_DIRS 目录  sha256 ${P_SHA:0:12}…"

# ---------------- Step 3: 打包代码 ----------------
sect "打包代码"
C_FILES=$(find "$MODULES_DIR" -type f | wc -l)
C_DIRS=$(find "$MODULES_DIR" -type d | wc -l)
tar -czf "$OUT_DIR/apollo_code.tar.gz" -C "$WS" "modules"
C_SHA="$(sha256sum "$OUT_DIR/apollo_code.tar.gz" | awk '{print $1}')"
ok "apollo_code.tar.gz      $C_FILES 文件 / $C_DIRS 目录  sha256 ${C_SHA:0:12}…"

# ---------------- Step 4: 写清单 ----------------
sect "生成清单"

cat > "$OUT_DIR/parameters.yaml" <<EOF
schema_version: 1
target_id: $TARGET
baseline_id: ${TARGET}_parameters_${BVER}
status: verified_by_user
platform: apollo
apollo_version: "${APOLLO_VER:-unknown}"
workspace: $WS
profile_package: $TARGET
profile_current: $WS/profiles/current
expected_current_target: $PROFILE_DIR
temporary_profile: sample
runtime:
  # environment_name 由镜像和启动方式决定，同一车型可能不同，仅供参考，不作为身份判据
  environment_name: ${ENV_NAME:-unknown}
  environment_name_authoritative: false
  worklocal: $ENV_WORKLOCAL
  container_repository: ${ENV_REPO:-unknown}
  container_tag: "${ENV_TAG:-unknown}"
identity:
  # 恢复前的身份判定只依据下列信号，不依据 runtime.environment_name
  authoritative:
    profile_package: $TARGET
    profile_current_target: $PROFILE_DIR
    apollo_version: "${APOLLO_VER:-unknown}"
  non_authoritative:
    - runtime.environment_name
    - runtime.container_tag
  stamp:
    # 指纹文件在参数目录内，随归档打包和恢复，profile 切换不影响它
    path: $PROFILE_DIR/$STAMP_NAME
    relative_path: $STAMP_NAME
    content_hash: $CONTENT_HASH
    verify_command: bash scripts/vehicle_stamp.sh verify --target $TARGET --workspace $WS
    exit_codes:
      0: 身份与内容均一致
      3: 身份不匹配，必须停止
      4: 身份一致但参数内容漂移，报告不阻断
workspace_manifest:
  path: $WS_JSON
  sha256: $WS_SHA
artifact:
  path: baselines/$TARGET/apollo_profiles.tar.gz
  sha256: $P_SHA
  archive_root: profiles/$TARGET
  file_count: $P_FILES
  directory_count: $P_DIRS
  recorded_at: "$BASELINE_DATE"
source:
  path: $PROFILE_DIR
  note: User-provided healthy $TARGET parameter directory; do not overwrite during baseline creation.
restore:
  workspace_required: $WS
  switch_to_temporary_profile: true
  temporary_profile_command: aem profile use sample
  temporary_switch_nonzero_is_tolerated: true
  temporary_switch_postcheck_required: true
  restore_into_profile_directory: true
  restore_via_current_link: false
  switch_back_command: aem profile use $TARGET
  final_current_check_required: true
protected_paths:
  - $WS/profiles/current
  - $WS/profiles/sample
EOF
ok "parameters.yaml"

cat > "$OUT_DIR/code.yaml" <<EOF
schema_version: 1
target_id: $TARGET
baseline_id: ${TARGET}_code_${BVER}
status: verified_by_user
platform: apollo
apollo_version: "${APOLLO_VER:-unknown}"
workspace: $WS
source_root: $MODULES_DIR
runtime:
  # environment_name 由镜像和启动方式决定，同一车型可能不同，仅供参考，不作为身份判据
  environment_name: ${ENV_NAME:-unknown}
  environment_name_authoritative: false
  worklocal: $ENV_WORKLOCAL
  container_repository: ${ENV_REPO:-unknown}
  container_tag: "${ENV_TAG:-unknown}"
identity:
  # 恢复前的身份判定只依据下列信号，不依据 runtime.environment_name
  authoritative:
    profile_package: $TARGET
    profile_current_target: $PROFILE_DIR
    apollo_version: "${APOLLO_VER:-unknown}"
  non_authoritative:
    - runtime.environment_name
    - runtime.container_tag
  stamp:
    # 代码恢复前的身份判定复用参数目录内的指纹
    path: $PROFILE_DIR/$STAMP_NAME
    content_hash: $CONTENT_HASH
    verify_command: bash scripts/vehicle_stamp.sh verify --target $TARGET --workspace $WS
workspace_manifest:
  path: $WS_JSON
  sha256: $WS_SHA
artifact:
  path: baselines/$TARGET/apollo_code.tar.gz
  sha256: $C_SHA
  archive_root: modules
  file_count: $C_FILES
  directory_count: $C_DIRS
  recorded_at: "$BASELINE_DATE"
source:
  path: $MODULES_DIR
  note: User-provided healthy $TARGET vehicle code; later updates must create a new baseline version.
restore:
  workspace_required: $WS
  restore_root: $MODULES_DIR
  build_workspace: $WS
  build_command: buildtool build -p <code_directory>
  build_directories:
    - modules
  extra_current_files: preserve_and_report
  missing_baseline_files: restore
  changed_baseline_files: backup_then_restore
  baseline_only_deletions: require_confirmation
protected_paths:
  - $WS/.cache
  - $WS/profiles
  - $WS/data
EOF
ok "code.yaml"

cat > "$OUT_DIR/README.md" <<EOF
# $TARGET $BVER baseline

This baseline records the user-confirmed healthy Apollo ${APOLLO_VER:-unknown} $TARGET environment.

## Recorded components

- Parameters: \`parameters.yaml\`
- Vehicle code: \`code.yaml\`
- Parameter artifact: \`baselines/$TARGET/apollo_profiles.tar.gz\`
- Code artifact: \`baselines/$TARGET/apollo_code.tar.gz\`
- Active profile link: \`$WS/profiles/current -> $PROFILE_DIR\`
- Temporary profile for safe replacement: \`sample\`
- Build workspace: \`$WS\`
- Build command: \`buildtool build -p <code_directory>\`
- Recorded at: $BASELINE_DATE

## Restore order

1. Verify identity via the in-profile stamp, not via \`profiles/current\` or \`APOLLO_ENV_NAME\`:
   \`bash scripts/vehicle_stamp.sh verify --target $TARGET --workspace $WS\`
   Exit 3 = identity mismatch, stop. Exit 4 = same vehicle, parameters drifted, report and continue.
2. Back up parameters, code, the \`current\` link, version data, and Git state.
3. Run \`aem profile use sample\` from \`$WS\`.
4. Confirm \`current\` no longer points to \`$TARGET\`; a non-zero command result is only tolerated when this post-check passes.
5. Restore the $TARGET parameter directory, never through \`profiles/current\`.
6. Run \`aem profile use $TARGET\` from \`$WS\`.
7. Confirm \`current\` points back to \`profiles/$TARGET\`.
8. Check and restore \`$MODULES_DIR\` against the code baseline.
9. Run \`buildtool build -p <code_directory>\` from \`$WS\`.
10. Verify hashes, installed outputs, profile link, and final version report.

The archive checksums and counts in the YAML files are the integrity record.
Do not mark a later update as $BVER; create the next version after the updated parameters and code are confirmed healthy.
EOF
ok "README.md"

# ---------------- Step 5: 自校验 ----------------
sect "归档自校验"
for f in apollo_profiles.tar.gz apollo_code.tar.gz; do
    tar -tzf "$OUT_DIR/$f" > /dev/null || die "$f 归档损坏"
done
ok "两个归档均可正常解读"

echo
echo -e "${GREEN}基线生成完毕：${NC}$OUT_DIR"
ln -sfn "$BVER" "$BASE_DIR/baselines/$TARGET/latest"
ok "latest 已指向 $BVER"
echo "下一步：把 registry/targets.yaml 中 $TARGET 的 status 改为 verified_by_user，并补上 parameter_baseline / code_baseline 字段。"
