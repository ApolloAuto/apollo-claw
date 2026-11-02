#!/usr/bin/env bash
# Apollo 车型指纹 (apollo-env skill)
#
# 在参数目录内写入车型指纹文件，使身份判定不依赖 profiles/current 软链，
# 也不依赖不固定的 APOLLO_ENV_NAME。指纹随参数目录一起被打包和恢复。
#
# 身份锚 (target_id) 稳定，调参不会改变；内容哈希 (content_hash) 会随调参漂移，
# 二者分开记录：身份不匹配 = 停止；内容漂移 = 报告，不阻断。
#
# Usage:
#   bash vehicle_stamp.sh stamp  --target <ID> [--workspace /apollo_workspace] [--baseline-id <ID>]
#   bash vehicle_stamp.sh verify --target <ID> [--workspace /apollo_workspace] [--expect-hash <sha>]
#   bash vehicle_stamp.sh scan            [--workspace /apollo_workspace]
#   bash vehicle_stamp.sh hash   --target <ID> [--workspace /apollo_workspace]
#
# Exit codes: 0=通过, 1=用法/前置错误, 3=身份不匹配, 4=身份一致但内容漂移

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
die()  { echo -e "${RED}❌ $1${NC}" >&2; exit "${2:-1}"; }
sect() { echo -e "\n${CYAN}【$1】${NC}"; }

STAMP_NAME=".apollo_vehicle_stamp.yaml"
# 指纹计算排除项：指纹文件自身，以及与车型无关的系统垃圾文件
declare -a HASH_EXCLUDES=("$STAMP_NAME" ".DS_Store" "._*" "Thumbs.db")

CMD="${1:-}"; shift || true
TARGET=""; WS="/apollo_workspace"; BASELINE_ID=""; EXPECT_HASH=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)      TARGET="${2:-}";      shift 2 ;;
        --workspace)   WS="${2:-}";          shift 2 ;;
        --baseline-id) BASELINE_ID="${2:-}"; shift 2 ;;
        --expect-hash) EXPECT_HASH="${2:-}"; shift 2 ;;
        *) die "未知参数: $1" ;;
    esac
done

# 组装 find 的排除表达式
build_find_excludes() {
    local -a expr=()
    for pat in "${HASH_EXCLUDES[@]}"; do
        expr+=( ! -name "$pat" )
    done
    printf '%s\n' "${expr[@]}"
}

# 内容哈希：对 "文件哈希 + 相对路径" 的有序清单再取哈希
# 能同时检出内容修改、增删文件和改名
content_hash() {
    local dir="$1"
    local -a ex=()
    mapfile -t ex < <(build_find_excludes)
    ( cd "$dir" \
      && find . -type f "${ex[@]}" -printf '%P\n' \
       | LC_ALL=C sort \
       | while IFS= read -r f; do
             printf '%s  %s\n' "$(sha256sum -- "$f" | awk '{print $1}')" "$f"
         done \
       | sha256sum | awk '{print $1}' )
}

content_file_count() {
    local dir="$1"
    local -a ex=()
    mapfile -t ex < <(build_find_excludes)
    ( cd "$dir" && find . -type f "${ex[@]}" | wc -l )
}

read_stamp_field() {
    # $1=stamp file, $2=key（仅顶层标量）
    grep -E "^${2}:" "$1" 2>/dev/null | head -1 | sed "s/^${2}:[[:space:]]*//" | tr -d '"' || true
}

apollo_version_of() {
    local wsj="$1/.workspace.json"
    [[ -f "$wsj" ]] || { echo "unknown"; return; }
    grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$wsj" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
}

case "$CMD" in

# ---------------- stamp：写入指纹 ----------------
stamp)
    [[ -n "$TARGET" ]] || die "stamp 需要 --target <车型ID>"
    PDIR="$WS/profiles/$TARGET"
    [[ -d "$PDIR" ]] || die "参数目录不存在: $PDIR"
    STAMP="$PDIR/$STAMP_NAME"

    sect "写入车型指纹"
    CH="$(content_hash "$PDIR")"
    FC="$(content_file_count "$PDIR")"
    AV="$(apollo_version_of "$WS")"
    [[ -n "$BASELINE_ID" ]] || BASELINE_ID="${TARGET}_parameters_v1"

    if [[ -f "$STAMP" ]]; then
        OLD_T="$(read_stamp_field "$STAMP" target_id)"
        [[ "$OLD_T" == "$TARGET" ]] || die "已有指纹属于车型 $OLD_T，拒绝改写成 $TARGET" 3
        warn "覆盖已有指纹（车型一致: $TARGET）"
    fi

    cat > "$STAMP" <<EOF
# Apollo 车型指纹 — 由 apollo-env skill 生成，请勿手工修改 content_hash
# 作用：让身份判定不依赖 profiles/current 软链，也不依赖不固定的 APOLLO_ENV_NAME
schema_version: 1

# —— 身份锚：稳定不变，调参不影响 ——
target_id: $TARGET
profile_package: $TARGET
apollo_version: "$AV"

# —— 内容指纹：调参后会变化，属正常漂移，不代表身份改变 ——
baseline_id: $BASELINE_ID
content_hash: $CH
content_file_count: $FC
content_hash_algorithm: sha256-over-sorted-list-of("sha256  relpath")
content_hash_excludes: ${HASH_EXCLUDES[*]}
stamped_at: "$(date +%F)"
EOF
    ok "指纹文件 $STAMP"
    ok "身份锚 target_id=$TARGET  apollo_version=$AV"
    ok "内容哈希 ${CH:0:16}…（$FC 个文件参与计算）"
    ;;

# ---------------- verify：校验身份与内容 ----------------
verify)
    [[ -n "$TARGET" ]] || die "verify 需要 --target <车型ID>"
    PDIR="$WS/profiles/$TARGET"
    STAMP="$PDIR/$STAMP_NAME"

    sect "校验车型身份"
    [[ -d "$PDIR" ]]   || die "参数目录不存在: $PDIR" 3
    [[ -f "$STAMP" ]]  || die "缺少指纹文件 $STAMP，无法确认身份；先执行 stamp 或从基线恢复" 3

    S_TARGET="$(read_stamp_field "$STAMP" target_id)"
    S_VER="$(read_stamp_field   "$STAMP" apollo_version)"
    S_HASH="$(read_stamp_field  "$STAMP" content_hash)"
    S_BID="$(read_stamp_field   "$STAMP" baseline_id)"

    [[ "$S_TARGET" == "$TARGET" ]] || die "身份不匹配：指纹为 $S_TARGET，请求为 $TARGET。停止，不覆盖参数和代码。" 3
    ok "身份匹配 target_id=$S_TARGET （基线 $S_BID）"

    AV="$(apollo_version_of "$WS")"
    if [[ "$S_VER" == "$AV" ]]; then
        ok "Apollo 版本一致 $AV"
    else
        die "版本不匹配：指纹记录 $S_VER，当前工作区 $AV。停止。" 3
    fi

    # current 软链只作参考，不作判据
    CUR="$WS/profiles/current"
    if [[ -L "$CUR" ]]; then
        if [[ "$(basename "$(readlink "$CUR")")" == "$TARGET" ]]; then
            ok "profiles/current -> $TARGET（参考项）"
        else
            warn "profiles/current -> $(readlink "$CUR")，未指向 $TARGET（参考项，不影响身份判定）"
        fi
    else
        warn "profiles/current 不存在（参考项，不影响身份判定）"
    fi

    sect "校验参数内容"
    CH="$(content_hash "$PDIR")"
    CMP="${EXPECT_HASH:-$S_HASH}"
    SRC="指纹记录"; [[ -n "$EXPECT_HASH" ]] && SRC="--expect-hash"
    if [[ "$CH" == "$CMP" ]]; then
        ok "内容哈希一致 ${CH:0:16}…（对比来源：$SRC）"
        exit 0
    else
        warn "内容已漂移：当前 ${CH:0:16}…  $SRC ${CMP:0:16}…"
        warn "身份仍然是 $TARGET。若漂移是有意调参，请重新 stamp 或建立新 baseline 版本。"
        exit 4
    fi
    ;;

# ---------------- scan：扫描工作区内所有已打指纹的车型 ----------------
scan)
    sect "扫描 $WS/profiles/"
    [[ -d "$WS/profiles" ]] || die "profiles 目录不存在: $WS/profiles"
    FOUND=0
    for d in "$WS"/profiles/*/; do
        [[ -d "$d" ]] || continue
        name="$(basename "$d")"
        [[ "$name" == "current" ]] && continue
        if [[ -f "$d/$STAMP_NAME" ]]; then
            FOUND=1
            printf '  %-14s target_id=%-14s version=%-8s baseline=%s\n' \
                "$name" \
                "$(read_stamp_field "$d/$STAMP_NAME" target_id)" \
                "$(read_stamp_field "$d/$STAMP_NAME" apollo_version)" \
                "$(read_stamp_field "$d/$STAMP_NAME" baseline_id)"
        else
            printf '  %-14s (无指纹)\n' "$name"
        fi
    done
    CUR="$WS/profiles/current"
    if [[ -L "$CUR" ]]; then
        echo -e "\n  current -> $(readlink "$CUR")"
    else
        echo -e "\n  current 不存在"
    fi
    [[ $FOUND -eq 1 ]] || warn "没有任何参数目录带指纹"
    ;;

# ---------------- hash：只输出内容哈希 ----------------
hash)
    [[ -n "$TARGET" ]] || die "hash 需要 --target <车型ID>"
    PDIR="$WS/profiles/$TARGET"
    [[ -d "$PDIR" ]] || die "参数目录不存在: $PDIR"
    content_hash "$PDIR"
    ;;

*)
    die "用法: vehicle_stamp.sh {stamp|verify|scan|hash} --target <ID> [--workspace DIR]"
    ;;
esac
