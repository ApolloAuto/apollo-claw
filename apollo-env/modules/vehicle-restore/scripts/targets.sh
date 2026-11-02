#!/usr/bin/env bash
# 列出已注册的车辆/工程目标
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="$BASE_DIR/registry/targets.yaml"
CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}已注册目标${NC}"
printf '  %-14s %-9s %-11s %-14s %s\n' "ID" "平台" "版本" "用途" "状态"
awk '
    /^targets:/ { in_targets=1; next }
    in_targets && /^  - id:/ { flush(); id=$3; platform=""; version=""; purpose=""; status="" }
    in_targets && /^    platform:/ { platform=$2 }
    in_targets && /^    version:/ { version=$2; gsub(/"/, "", version) }
    in_targets && /^    purpose:/ { purpose=$2 }
    in_targets && /^    status:/ { status=$2 }
    END { flush() }
    function flush() {
        if (id != "") printf "  %-14s %-9s %-11s %-14s %s\n", id, platform, version, purpose, status
    }
' "$REGISTRY"
