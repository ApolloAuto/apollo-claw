#!/usr/bin/env bash
# 从 restore_baseline.sh 生成的备份目录回滚参数和代码。
# 用法: rollback_baseline.sh --backup <备份目录>
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok() { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
die() { echo -e "${RED}❌ $1${NC}" >&2; exit "${2:-1}"; }
section() { echo -e "\n${CYAN}【$1】${NC}"; }

WS="/apollo_workspace"
BACKUP=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --backup) BACKUP="${2:-}"; shift 2 ;;
        *) die "未知参数: $1" ;;
    esac
done

[[ -n "$BACKUP" ]] || die "必须指定 --backup <备份目录>"
[[ -d "$BACKUP" ]] || die "备份目录不存在: $BACKUP"
[[ -d "$BACKUP/parameters" ]] || die "备份缺少 parameters/ 目录，无法回滚"
[[ -d "$BACKUP/modules" ]] || die "备份缺少 modules/ 目录，无法回滚"

# 从 current.link 确定原目标车型
TARGET=""
if [[ -f "$BACKUP/current.link" ]]; then
    TARGET="$(basename "$(cat "$BACKUP/current.link")")"
fi
[[ -n "$TARGET" ]] || die "备份缺少 current.link，无法确定目标车型"
[[ "$TARGET" =~ ^[A-Za-z0-9_-]+$ ]] || die "从备份解析出的目标车型不合法: $TARGET"

TARGET_PROFILE="$WS/profiles/$TARGET"
CURRENT_LINK="$WS/profiles/current"
[[ -d "$WS" ]] || die "工作区不存在: $WS"

section "回滚确认"
echo "目标车型：$TARGET"
echo "备份来源：$BACKUP"
echo "将还原：$TARGET_PROFILE 和 $WS/modules"
read -r -p "确认执行回滚？[y/N]: " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "已取消，未修改参数和代码。"
    exit 0
fi

section "回滚前快照"
SNAPSHOT="$WS/.apollo-env/backups/$(date +%Y%m%d-%H%M%S)-pre-rollback-$TARGET"
mkdir -p "$SNAPSHOT"
cp -a "$TARGET_PROFILE" "$SNAPSHOT/parameters"
cp -a "$WS/modules" "$SNAPSHOT/modules"
[[ -L "$CURRENT_LINK" ]] && readlink "$CURRENT_LINK" > "$SNAPSHOT/current.link" || true
ok "当前状态已快照到 $SNAPSHOT"

section "切换临时参数"
(cd /apollo_workspace && aem profile use sample) >/dev/null 2>&1 || true
SAMPLE_PROFILE="$(readlink -f "$WS/profiles/sample" 2>/dev/null || true)"
AFTER="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
[[ -n "$SAMPLE_PROFILE" && "$AFTER" == "$SAMPLE_PROFILE" ]] || die "已执行 aem profile use sample，但 current 核验失败：${AFTER:-不存在}"
ok "已核验 current -> sample"

section "还原参数"
rm -rf "$TARGET_PROFILE"
cp -a "$BACKUP/parameters" "$TARGET_PROFILE"
ok "参数已还原到 $TARGET_PROFILE"

section "还原车型代码"
rm -rf "$WS/modules"
cp -a "$BACKUP/modules" "$WS/modules"
ok "车型代码已还原到 $WS/modules"

section "切回目标参数"
(cd /apollo_workspace && aem profile use "$TARGET") >/dev/null 2>&1 || true
[[ "$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)" == "$(readlink -f "$TARGET_PROFILE")" ]] || die "已执行 aem profile use $TARGET，但 current 核验失败"
ok "已核验 current -> $TARGET"

section "回滚完成"
ok "参数和代码已从备份还原"
echo "如需重新构建：cd $WS && buildtool build -p <代码目录>"
echo "本次回滚前快照：$SNAPSHOT"
