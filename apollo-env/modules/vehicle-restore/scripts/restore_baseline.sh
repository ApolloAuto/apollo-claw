#!/usr/bin/env bash
# Restore one vehicle's local parameter and code baseline.
# Both parameters and modules are always compared and handled together.

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok() { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
die() { echo -e "${RED}❌ $1${NC}" >&2; exit "${2:-1}"; }
section() { echo -e "\n${CYAN}【$1】${NC}"; }

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS="/apollo_workspace"
TARGET=""
DRY_RUN=0
ASSUME_YES=0

usage() {
    cat <<'EOF'
用法:
  restore_baseline.sh --target <目标ID> [--workspace /apollo_workspace] [--dry-run] [--yes] [--allow-target-switch] [--skip-build] [--build-only] [--prune]

restore 同时处理目标参数和车型代码，不支持 --scope。
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target) TARGET="${2:-}"; shift 2 ;;
        --workspace) WS="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --yes) ASSUME_YES=1; shift ;;
      --allow-target-switch) ALLOW_SWITCH=1; shift ;;
      --skip-build) SKIP_BUILD=1; shift ;;
      --build-only) BUILD_ONLY=1; shift ;;
      --prune) PRUNE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "未知参数: $1" ;;
    esac
done

[[ -n "$TARGET" ]] || { usage >&2; die "必须指定 --target"; }
[[ "$TARGET" =~ ^[A-Za-z0-9_-]+$ ]] || die "目标 ID 含有不允许的字符: $TARGET"
[[ "$WS" == "/apollo_workspace" ]] || die "恢复与构建必须在 /apollo_workspace 中执行: $WS"
[[ -d /apollo_workspace ]] || die "工作区不存在: /apollo_workspace"

PARAM_MANIFEST="$BASE_DIR/baselines/$TARGET/latest/parameters.yaml"
CODE_MANIFEST="$BASE_DIR/baselines/$TARGET/latest/code.yaml"
[[ -f "$PARAM_MANIFEST" ]] || die "缺少参数 manifest: $PARAM_MANIFEST"
[[ -f "$CODE_MANIFEST" ]] || die "缺少代码 manifest: $CODE_MANIFEST"

manifest_value() {
    local file="$1"; local key="$2"
    awk -v key="$key" '$0 ~ "^  " key ":" {sub("^  " key ":[[:space:]]*", ""); gsub(/^"|"$/, ""); print; exit}' "$file"
}

artifact_value() {
    local file="$1"; local key="$2"
    awk -v key="$key" '/^artifact:/{seen=1; next} seen && $0 ~ "^  " key ":" {sub("^  " key ":[[:space:]]*", ""); gsub(/^"|"$/, ""); print; exit}' "$file"
}

# 归档与 manifest 同目录，用 manifest 目录 + 归档文件名解析，避免版本迁移后路径失效
PARAM_ARCHIVE="$(dirname "$PARAM_MANIFEST")/$(basename "$(artifact_value "$PARAM_MANIFEST" path)")"
CODE_ARCHIVE="$(dirname "$CODE_MANIFEST")/$(basename "$(artifact_value "$CODE_MANIFEST" path)")"
PARAM_SHA_EXPECTED="$(artifact_value "$PARAM_MANIFEST" sha256)"
CODE_SHA_EXPECTED="$(artifact_value "$CODE_MANIFEST" sha256)"
[[ -f "$PARAM_ARCHIVE" ]] || die "参数归档不存在: $PARAM_ARCHIVE"
[[ -f "$CODE_ARCHIVE" ]] || die "代码归档不存在: $CODE_ARCHIVE"

check_archive() {
    local file="$1" expected="$2"
    local actual
    actual="$(sha256sum "$file" | awk '{print $1}')"
    [[ "$actual" == "$expected" ]] || die "归档校验失败: $file\n期望: $expected\n实际: $actual"
    ok "归档校验通过: $(basename "$file")"
}

file_manifest() {
    local dir="$1" out="$2"
    # 性能：以前对每个文件单独起一次 sha256sum，1600 个文件要 60 秒以上。
    # 改成「一次 find + xargs 批量 sha256sum」，再用 awk 规范化成 "hash  path"。
    (cd "$dir" || return 1
     find . -type f -printf '%P\n' | LC_ALL=C sort > "$out.paths"
     if [[ -s "$out.paths" ]]; then
         # 批量计算：xargs 会把参数切块多次调用，但每块几百个文件，远快于逐个启动
         tr '\n' '\0' < "$out.paths" | xargs -0 sha256sum -- 2>/dev/null | awk '{print $1"  "$2}'
     fi
     rm -f "$out.paths") > "$out"
}

compare_tree() {
    local name="$1" current="$2" archive_root="$3" archive="$4" outdir="$5"
    local expected="$outdir/${name}.baseline.sha" actual="$outdir/${name}.current.sha"
    local diff_file="$outdir/${name}.diff"
    [[ -d "$current" ]] || { echo "missing_tree"; return 0; }
    file_manifest "$archive_root" "$expected"
    file_manifest "$current" "$actual"
    diff -u "$expected" "$actual" > "$diff_file" || true
    if [[ ! -s "$diff_file" ]]; then
        echo "same"
    else
        echo "different"
    fi
}

# 把 modules/ 里「基线没有」的代码移到备份目录，并报告移了什么、移到哪。
# 只处理 $WS/modules（当前环境要编译的源码），不碰任何包目录。
prune_extra_code() {
    [[ "${PRUNE:-0}" -eq 1 ]] || return 0
    [[ -d "$WS/modules" ]] || return 0
    local baseline_mods="$TMP/baseline_modules.txt"
    tar tzf "$CODE_ARCHIVE" 2>/dev/null | awk -F/ 'NF>=3 && $1=="modules" {print $2}' | sort -u > "$baseline_mods"
    local extra=() name
    for d in "$WS/modules"/*/; do
        [[ -d "$d" ]] || continue
        name="$(basename "$d")"
        [[ "$name" == "BUILD" ]] && continue
        grep -qx "$name" "$baseline_mods" || extra+=("$name")
    done
    if [[ "${#extra[@]}" -eq 0 ]]; then
        ok "modules/ 里没有基线外的代码"
        return 0
    fi
    section "基线外代码（本机多出来的）"
    echo "  共 ${#extra[@]} 个模块：${extra[*]}"
    mkdir -p "$BACKUP/pruned-code"
    for name in "${extra[@]}"; do
        if mv "$WS/modules/$name" "$BACKUP/pruned-code/" 2>/dev/null; then
            # 这个格式插件会解析，用来在界面上列出「清理了哪些」
            warn "已移出 $name（不属于 $TARGET 基线）"
        else
            warn "移出失败: $name"
        fi
    done
    ok "已移到: $BACKUP/pruned-code"
    echo "  回滚：把该目录内容搬回 $WS/modules"
    return 0
}

# 所有参数切换都由 aem 完成；退出码不作为切换是否成功的判断依据。
# 命令结束后必须单独核验 profiles/current，绝不手工创建或修正软链。
AEM_TIMEOUT="${AEM_TIMEOUT:-120}"
switch_profile() {
    local target="$1"
    ( cd /apollo_workspace && timeout "$AEM_TIMEOUT" aem profile use "$target" ) >/dev/null 2>&1 || true
}
verify_current_profile() {
    local target="$1" target_profile="$WS/profiles/$1" current_target=""
    current_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
    [[ -n "$current_target" && -d "$target_profile" && "$current_target" == "$(readlink -f "$target_profile")" ]] || \
        die "aem profile use $target 已执行，但 current 核验失败：当前 ${current_target:-不存在}，目标 $target_profile"
    ok "已核验 profiles/current -> $target"
}

BUILD_INCOMPLETE=0
BUILD_STATE_DIR="$WS/.apollo-env/build-state"
BUILD_MARKER="$BUILD_STATE_DIR/$TARGET.state"
code_signature() {
    sha256sum "$CODE_ARCHIVE" 2>/dev/null | awk '{print $1}'
}
build_is_current() {
    [[ -f "$BUILD_MARKER" ]] || return 1
    local want cur
    want="$(code_signature)"
    cur="$(grep '^code_signature=' "$BUILD_MARKER" 2>/dev/null | head -1 | cut -d= -f2-)"
    [[ -n "$want" && "$want" == "$cur" ]] || return 1
    grep -q '^status=ok$' "$BUILD_MARKER" 2>/dev/null || return 1
    return 0
}
mark_build() {
    mkdir -p "$BUILD_STATE_DIR"
    {
        echo "target=$TARGET"
        echo "code_signature=$(code_signature)"
        echo "status=$1"
        echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$BUILD_MARKER"
}
run_build() {
    if [[ "${SKIP_BUILD:-0}" -eq 1 ]]; then
        warn "按 --skip-build 跳过编译（参数与代码已就位）"
        return 0
    fi
    if ! command -v buildtool >/dev/null 2>&1; then
        warn "本机没有 buildtool，跳过编译（参数与代码已就位，但未编译）"
        BUILD_INCOMPLETE=1
        return 0
    fi
    section "编译"
    # 编译可能很长（首次要下几万个包）。失败/被中断都不作废已铺好的参数和代码，
    # 只标记为「编译未完成」，退出码 10，方便重试时用 --build-only。
    if (cd /apollo_workspace && buildtool build -p modules); then
        ok "buildtool build -p modules 通过"
        mark_build ok
    else
        BUILD_INCOMPLETE=1
        mark_build incomplete
        warn "编译未完成（可能被中断或依赖下载失败）"
        warn "参数与车型代码已就位，可稍后重试：restore_baseline.sh --target $TARGET --build-only"
    fi
    return 0
}

section "前置检查"
[[ -x "$BASE_DIR/scripts/vehicle_stamp.sh" ]] || die "缺少可执行 vehicle_stamp.sh"
CURRENT_LINK="$WS/profiles/current"
TARGET_PROFILE="$WS/profiles/$TARGET"

# 先判断是不是「本机什么都没有」的冷恢复场景：缺参数目录或缺代码目录。
# 缺就创建，然后走「先铺参数和代码 → 编译 → 最后切 current」，不能直接 die。
CODE_AVAILABLE=1
COLD_RESTORE=0
if [[ ! -d "$TARGET_PROFILE" ]]; then
    COLD_RESTORE=1
    warn "本机没有目标参数目录: $TARGET_PROFILE（将创建并铺入基线参数）"
    mkdir -p "$TARGET_PROFILE"
fi
if [[ ! -d "$WS/modules" ]]; then
    COLD_RESTORE=1
    warn "本机没有车型代码目录: $WS/modules（将创建并铺入基线代码）"
fi
# current 不存在时标记冷恢复，但不手工建软链；切换只能由 aem profile use 完成。
if [[ ! -L "$CURRENT_LINK" ]]; then
    COLD_RESTORE=1
    warn "profiles/current 不存在或不是软链，后续通过 aem profile use 切换"
    mkdir -p "$WS/profiles"
fi
CURRENT_TARGET="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
if [[ "$CURRENT_TARGET" != "$(readlink -f "$TARGET_PROFILE" 2>/dev/null || true)" ]]; then
    if [[ "${ALLOW_SWITCH:-0}" -eq 1 ]]; then
        warn "当前参数不是目标车型，先执行 aem profile use：${CURRENT_TARGET:-不存在} -> $TARGET"
        SWITCHED_ONLY=1
        switch_profile "$TARGET"
        verify_current_profile "$TARGET"
    else
        die "当前参数不是目标车型：current -> ${CURRENT_TARGET:-不存在}，目标 -> $TARGET_PROFILE（如确需切换，加 --allow-target-switch）"
    fi
fi

# --build-only 放在最前面：只编译，不重铺参数/代码、不重做备份。
# 必须早于「已一致就 exit 0」等提前返回，否则重建编译会被跳过。
if [[ "${BUILD_ONLY:-0}" -eq 1 ]]; then
    section "仅编译（断点续跑）"
    [[ -d "$TARGET_PROFILE" ]] || die "目标参数目录不存在，无法仅编译：$TARGET_PROFILE"
    [[ -d "$WS/modules" ]] || die "车型代码目录不存在，无法仅编译：$WS/modules"
    run_build
    if [[ "$BUILD_INCOMPLETE" -eq 1 ]]; then
        warn "编译仍未完成，可再次执行 --build-only"
        exit 10
    fi
    ok "编译完成"
    exit 0
fi

STAMP_STATUS=0
if [[ "$COLD_RESTORE" -eq 1 ]]; then
    # 冷恢复：参数目录是刚建的，没有指纹可比对；直接从基线里的 stamp 铺进去。
    warn "冷恢复：跳过当前环境身份校验（参数目录刚创建）"
    BASE_STAMP="$BASE_DIR/baselines/$TARGET/latest/parameters.yaml"
    if [[ -f "$BASE_STAMP" ]]; then
        if [[ -f "$TARGET_PROFILE/.apollo_vehicle_stamp.yaml" ]]; then
            ok "已有指纹文件"
        else
            warn "指纹文件将在铺入参数后由基线提供（$TARGET_PROFILE/.apollo_vehicle_stamp.yaml）"
        fi
    fi
else
    bash "$BASE_DIR/scripts/vehicle_stamp.sh" verify --target "$TARGET" --workspace "$WS" || STAMP_STATUS=$?
    [[ "$STAMP_STATUS" -eq 0 || "$STAMP_STATUS" -eq 4 ]] || die "车型身份或 Apollo 版本校验失败，停止恢复" 3
fi
[[ "$STAMP_STATUS" -eq 4 ]] && warn "目标车型身份一致，但参数内容已漂移，将继续比较基线"

section "归档校验"
check_archive "$PARAM_ARCHIVE" "$PARAM_SHA_EXPECTED"
check_archive "$CODE_ARCHIVE" "$CODE_SHA_EXPECTED"

TMP="$(mktemp -d "/tmp/apollo-env-restore-${TARGET}-XXXXXX")"
cleanup() {
    rm -rf "$TMP"
}
trap cleanup EXIT
mkdir -p "$TMP/parameter" "$TMP/code"
tar -xzf "$PARAM_ARCHIVE" -C "$TMP/parameter"
tar -xzf "$CODE_ARCHIVE" -C "$TMP/code"
[[ -d "$TMP/parameter/profiles/$TARGET" ]] || die "参数归档根目录不是 profiles/$TARGET"
[[ -d "$TMP/code/modules" ]] || die "代码归档根目录不是 modules"

section "参数与代码对比"
PARAM_RESULT="$(compare_tree parameters "$TARGET_PROFILE" "$TMP/parameter/profiles/$TARGET" "$PARAM_ARCHIVE" "$TMP")"
# 只清理场景：先把「基线里没有的多余模块」临时移出对比范围，
# 否则它们会被当成「代码差异」，导致只清理也去跑一遍编译（几十秒）。
# 基线外模块（多余代码）应当「清理」，不能被当成「代码差异」触发重铺 + 编译。
# 做法：正常比对后，把差异里属于基线外模块的条目过滤掉，再判断结果。
CODE_RESULT="$(compare_tree code "$WS/modules" "$TMP/code/modules" "$CODE_ARCHIVE" "$TMP")"
if [[ "${PRUNE:-0}" -eq 1 && "$CODE_RESULT" != "same" ]]; then
    tar tzf "$CODE_ARCHIVE" 2>/dev/null | awk -F/ 'NF>=3 && $1=="modules" {print $2}' | sort -u > "$TMP/base_mods_filter.txt"
    EXTRA_LIST="$TMP/extra_mods_filter.txt"
    : > "$EXTRA_LIST"
    for _d in "$WS/modules"/*/; do
        [[ -d "$_d" ]] || continue
        _n="$(basename "$_d")"
        [[ "$_n" == "BUILD" ]] && continue
        grep -qx "$_n" "$TMP/base_mods_filter.txt" || echo "$_n" >> "$EXTRA_LIST"
    done
    if [[ -s "$EXTRA_LIST" ]]; then
        # diff 里形如 "- hash  modules/<mod>/..." 与 "+ hash  modules/<mod>/..." 的行都滤掉
        # manifest 里是相对 modules/ 的路径（如 zz_g/f.txt），所以前缀直接是模块名
        PATTERN="$(sed 's|$|/|' "$EXTRA_LIST" | paste -sd'|' -)"
        grep -vE "  ($PATTERN)" "$TMP/code.diff" > "$TMP/code.diff.filtered" 2>/dev/null || cp "$TMP/code.diff" "$TMP/code.diff.filtered"
        # 只保留真正的 diff 内容行（去掉 @@ 头），过滤后若无实质差异就算一致
        if ! grep -E '^[+-][0-9a-f]' "$TMP/code.diff.filtered" | grep -q .; then
            CODE_RESULT="same"
            ok "基线外代码将另行清理（不计入代码差异）：$(paste -sd'、' "$EXTRA_LIST")"
        else
            cp "$TMP/code.diff.filtered" "$TMP/code.diff"
        fi
    fi
fi
[[ "$PARAM_RESULT" == "same" ]] && ok "参数无差异"
[[ "$PARAM_RESULT" != "same" ]] && warn "参数存在差异"
[[ "$CODE_RESULT" == "same" ]] && ok "车型代码无差异"
[[ "$CODE_RESULT" != "same" ]] && warn "车型代码存在差异"

# 只切车型：前置 aem profile use 已执行；只核验 current，不备份/重铺/编译。
if [[ "$PARAM_RESULT" == "same" && "$CODE_RESULT" == "same" && "${SWITCHED_ONLY:-0}" -eq 1 ]]; then
    echo
    ok "参数与代码均与 $TARGET 基线一致，只切换车型"
    verify_current_profile "$TARGET"
    ok "只切换完成：$TARGET"
    exit 0
fi

if [[ "$PARAM_RESULT" == "same" && "$CODE_RESULT" == "same" ]]; then
    echo
    ok "参数和车型代码均与 $TARGET 基线一致"
    # 一致时也要处理「基线外代码」：用户可能就是想清理多余模块。
    if [[ "${PRUNE:-0}" -eq 1 ]]; then
        BACKUP="$WS/.apollo-env/backups/$(date +%Y%m%d-%H%M%S)-$TARGET"
        mkdir -p "$BACKUP"
        # 只清理时不复制 modules/ 全量（几个 G），但仍记录现场信息，便于追溯与回滚
        readlink "$CURRENT_LINK" > "$BACKUP/current.link" 2>/dev/null || true
        cp -f "$WS/.workspace.json" "$BACKUP/workspace.json" 2>/dev/null || true
        [[ -f "$WS/.env" ]] && cp -f "$WS/.env" "$BACKUP/env" 2>/dev/null || true
        if command -v git >/dev/null 2>&1; then ( cd "$WS" && git status --short ) > "$BACKUP/git-status.txt" 2>/dev/null || true; fi
        prune_extra_code
        ok "只清理完成：$TARGET"
        echo "  备份: $BACKUP"
        exit 0
    fi
        # 关键：文件一致 != 编译完成。代码刚铺好但没编译时，对比结果也是「一致」，
    # 不能因此直接 exit 0，否则用户以为恢复完了，实际没编译。
    if [[ "${SKIP_BUILD:-0}" -eq 1 ]]; then
        warn "按 --skip-build 跳过编译检查"
        exit 0
    fi
    if build_is_current; then
        ok "编译状态正常（$(grep '^built_at=' "$BUILD_MARKER" | cut -d= -f2-)）"
        exit 0
    fi
    warn "参数和代码与基线一致，但没有可用的编译记录（可能上次编译被中断）"
    run_build
    if [[ "$BUILD_INCOMPLETE" -eq 1 ]]; then
        warn "编译未完成，可重试：restore_baseline.sh --target $TARGET --build-only"
        exit 10
    fi
    ok "编译已完成：$TARGET"
    exit 0
fi

show_diff_summary() {
    local file="$1" label="$2"
    local added removed
    added="$(grep -c '^+[^+]' "$file" 2>/dev/null || true)"
    removed="$(grep -c '^-[^-]' "$file" 2>/dev/null || true)"
    echo "  $label：新增/缺失或不一致记录 +$added / -$removed"
}
echo
echo "差异摘要："
[[ "$PARAM_RESULT" != "same" ]] && show_diff_summary "$TMP/parameters.diff" "参数"
[[ "$CODE_RESULT" != "same" ]] && show_diff_summary "$TMP/code.diff" "代码"
echo "基线外的当前文件默认保留，不自动删除。"

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo
    echo "dry-run：发现差异，但未切换 profile、未覆盖参数、未覆盖代码、未构建。"
    exit 0
fi

# 恢复前二次确认（真实车辆恢复属高危操作，默认不执行）
echo
echo -e "${CYAN}即将恢复目标：$TARGET${NC}"
[[ "$PARAM_RESULT" != "same" ]] && echo "  - 恢复参数：切 sample → 覆盖参数 → 切回 $TARGET"
[[ "$CODE_RESULT" != "same" ]] && echo "  - 恢复车型代码并执行构建"
echo "  - 备份位置：$WS/.apollo-env/backups/"
if [[ "$ASSUME_YES" -ne 1 ]]; then
    read -r -p "确认执行恢复？[y/N]: " CONFIRM
    if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
        echo "已取消，未修改参数和代码。"
        exit 0
    fi
fi

# ── 冷恢复：本机没有参数目录或没有车型代码 ───────────────────────────────
# 这种机器（新装/包安装不完整/工作区被清空）不能走「切 sample → 改参数 → 切回」的老路，
# 因为 aem 在参数和代码都不存在时会 recover conf 失败。
# 正确顺序：先铺参数和代码 → 再编译 → 最后把 current 指到目标。
if [[ "$COLD_RESTORE" -eq 1 ]]; then
    section "冷恢复（本机缺参数或代码）"
    mkdir -p "$WS/profiles" "$WS/.apollo-env/backups"
    BACKUP="$WS/.apollo-env/backups/$(date +%Y%m%d-%H%M%S)-$TARGET-cold"
    mkdir -p "$BACKUP"
    [[ -L "$CURRENT_LINK" ]] && readlink "$CURRENT_LINK" > "$BACKUP/current.link" || true

    section "铺参数"
    mkdir -p "$TARGET_PROFILE"
    tar -xzf "$PARAM_ARCHIVE" -C "$WS"
    [[ -f "$TARGET_PROFILE/.apollo_vehicle_stamp.yaml" ]] || true
    ok "参数已铺到 $TARGET_PROFILE"

    section "铺车型代码"
    if [[ "$CODE_AVAILABLE" -eq 0 ]]; then
        mkdir -p "$WS/modules"
    fi
    tar -xzf "$CODE_ARCHIVE" -C "$WS"
    ok "车型代码已铺到 $WS/modules"
    prune_extra_code

    run_build

    section "应用参数（aem profile use）"
    switch_profile "$TARGET"
    verify_current_profile "$TARGET"
    if [[ "$BUILD_INCOMPLETE" -eq 1 ]]; then
        warn "冷恢复部分完成：$TARGET（参数 + 代码 + current 已就位，编译未完成）"
        echo "  备份: $BACKUP"
        exit 10
    fi
    ok "冷恢复完成：$TARGET（参数 + 代码 + 编译 + current）"
    echo "  备份: $BACKUP"
    exit 0
fi

section "备份"
BACKUP="$WS/.apollo-env/backups/$(date +%Y%m%d-%H%M%S)-$TARGET"
mkdir -p "$BACKUP"
cp -a "$TARGET_PROFILE" "$BACKUP/parameters"
[[ -d "$WS/modules" ]] && cp -a "$WS/modules" "$BACKUP/modules" || true
readlink "$CURRENT_LINK" > "$BACKUP/current.link"
cp -f "$WS/.workspace.json" "$BACKUP/workspace.json"
[[ -f "$WS/.env" ]] && cp -f "$WS/.env" "$BACKUP/env"
if command -v git >/dev/null 2>&1; then
    (cd "$WS" && git status --short) > "$BACKUP/git-status.txt" || true
fi
ok "备份已创建: $BACKUP"

if [[ "$PARAM_RESULT" != "same" ]]; then
    section "切换临时参数"
    switch_profile "sample"
    verify_current_profile "sample"

    section "恢复参数"
    tar -xzf "$PARAM_ARCHIVE" -C "$WS"
    ok "参数已恢复到 $TARGET_PROFILE"

    PARAM_SWITCHED_AWAY=1
else
    ok "参数无差异，跳过参数恢复"
fi

if [[ "$CODE_RESULT" != "same" ]]; then
    section "恢复车型代码"
    tar -xzf "$CODE_ARCHIVE" -C "$WS"
    ok "车型代码已恢复到 $WS/modules"
    prune_extra_code

    section "构建验证"
    run_build
else
    ok "车型代码无差异，跳过代码恢复和构建"
fi

  # 切回目标参数放在最后：先铺代码并编译，再由 aem 应用目标参数，随后核验 current。
  if [[ "${PARAM_SWITCHED_AWAY:-0}" -eq 1 ]]; then
      section "应用参数（aem profile use）"
      switch_profile "$TARGET"
      verify_current_profile "$TARGET"
  fi

section "最终校验"
FINAL_STAMP_STATUS=0
bash "$BASE_DIR/scripts/vehicle_stamp.sh" verify --target "$TARGET" --workspace "$WS" >/dev/null || FINAL_STAMP_STATUS=$?
[[ "$FINAL_STAMP_STATUS" -eq 0 || "$FINAL_STAMP_STATUS" -eq 4 ]] || die "最终车型身份或 Apollo 版本校验失败"
[[ "$FINAL_STAMP_STATUS" -eq 4 ]] && warn "车型和版本正确，但基线外文件仍被保留，参数内容存在可报告漂移"
[[ "$(readlink -f "$CURRENT_LINK")" == "$TARGET_PROFILE" ]] || die "最终 current 软链错误"
ok "参数、车型代码、软链和构建验证完成"
echo "备份位置: $BACKUP"
