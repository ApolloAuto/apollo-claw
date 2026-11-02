#!/usr/bin/env bash
# 轻量报告：版本、软链、指纹、归档 SHA（--diff 追加逐文件差异）
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # apollo-vehicle-restore
WS="/apollo_workspace"
REGISTRY="$BASE_DIR/registry/targets.yaml"
BASELINES="$BASE_DIR/baselines"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
die()  { echo -e "${RED}❌ $1${NC}" >&2; exit "${2:-1}"; }

target_field() {
    awk -v id="$1" -v key="$2" '
        /^targets:/ { in_targets=1; next }
        in_targets && /^  - id:/ { current=$3 }
        in_targets && current==id {
            pat="^    " key ":"
            if ($0 ~ pat) { sub(/^    [^:]*:[[:space:]]*/, ""); gsub(/"/, ""); print; found=1; exit }
        }
        END { if (!found) print "" }
    ' "$REGISTRY"
}

manifest_artifact() {
    awk -v key="$2" '/^artifact:/{seen=1; next} seen && $0 ~ "^  " key ":" {sub("^  " key ":[[:space:]]*", ""); gsub(/^"|"$/, ""); print; exit}' "$1"
}

check_sha() {
    local actual
    actual="$(sha256sum "$1" 2>/dev/null | awk '{print $1}')"
    if [[ -z "$actual" ]]; then
        echo -e "${RED}✗ $3 归档不存在：$1${NC}"
        return 1
    elif [[ "$actual" == "$2" ]]; then
        ok "$3 SHA-256 匹配"
        return 0
    else
        echo -e "${RED}✗ $3 SHA-256 不匹配（期望 ${2:0:12}… 实际 ${actual:0:12}…）${NC}"
        return 1
    fi
}

target=""
diff=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target) target="${2:-}"; shift 2 ;;
        --diff) diff=1; shift ;;
        *) shift ;;
    esac
done
[[ -n "$target" ]] || die "report 需要 --target <ID>"

echo -e "${CYAN}【目标报告】$target${NC}"

platform="$(target_field "$target" platform)"
version="$(target_field "$target" version)"
purpose="$(target_field "$target" purpose)"
status="$(target_field "$target" status)"

echo "  平台：${platform:-未知}"
echo "  Apollo 版本：${version:-未知}"
echo "  用途：${purpose:-未知}"
echo "  基线状态：${status:-未知}"

wsj="$WS/.workspace.json"
if [[ -f "$wsj" ]]; then
    wsv="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$wsj" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
    echo "  当前工作区版本：${wsv:-unknown}"
fi

cur="$WS/profiles/current"
expected="$WS/profiles/$target"
if [[ -L "$cur" ]]; then
    actual="$(readlink -f "$cur")"
    if [[ "$actual" == "$expected" ]]; then
        ok "current -> $(readlink "$cur")"
    else
        warn "current -> $actual（期望 $expected）"
    fi
else
    warn "profiles/current 不存在"
fi

if [[ -x "$BASE_DIR/scripts/vehicle_stamp.sh" ]]; then
    s=0
    bash "$BASE_DIR/scripts/vehicle_stamp.sh" verify --target "$target" --workspace "$WS" >/dev/null 2>&1 || s=$?
    case "$s" in
        0) ok "车型指纹：身份与内容一致" ;;
        3) echo -e "${RED}✗ 车型指纹：身份或版本不匹配${NC}" ;;
        4) warn "车型指纹：身份一致，参数内容已漂移" ;;
        *) warn "车型指纹：无法校验（参数目录无指纹）" ;;
    esac
fi

pm="$BASELINES/$target/latest/parameters.yaml"
cm="$BASELINES/$target/latest/code.yaml"
if [[ -f "$pm" ]]; then
    p_path="$(dirname "$pm")/$(basename "$(manifest_artifact "$pm" path)")"
    p_sha="$(manifest_artifact "$pm" sha256)"
    check_sha "$p_path" "$p_sha" "参数归档"
else
    warn "缺少参数 manifest：$pm"
fi
if [[ -f "$cm" ]]; then
    c_path="$(dirname "$cm")/$(basename "$(manifest_artifact "$cm" path)")"
    c_sha="$(manifest_artifact "$cm" sha256)"
    check_sha "$c_path" "$c_sha" "代码归档"
else
    warn "缺少代码 manifest：$cm"
fi

if [[ "$diff" -eq 1 ]]; then
    echo
    echo -e "${CYAN}差异对比${NC}"
    bash "$BASE_DIR/scripts/restore_baseline.sh" --target "$target" --dry-run
else
    echo "  差异对比请用：apollo-env.sh report --target $target --diff"
fi
