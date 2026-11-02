#!/usr/bin/env bash
# 列出已有基线（baselines/ 目录版本）
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}已有基线${NC}"
found=0
for d in "$BASE_DIR/baselines"/*/; do
    [[ -d "$d" ]] || continue
    name="$(basename "$d")"
    latest=""
    [[ -L "$d/latest" ]] && latest="$(basename "$(readlink "$d/latest")")"
    printf '  %-14s latest=%-4s 版本:' "$name" "${latest:-无}"
    versions=""
    for vd in "$d"*/; do
        [[ -d "$vd" ]] || continue
        vb="$(basename "$vd")"
        [[ "$vb" == "latest" ]] && continue
        versions="$versions $vb"
    done
    echo "${versions:- （无）}"
    found=1
done
[[ "$found" -eq 1 ]] || echo "  （无基线）"
