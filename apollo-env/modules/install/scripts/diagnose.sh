#!/usr/bin/env bash
# 环境检测 + 常见问题检索提示
set -euo pipefail
# 本脚本在 <skill>/modules/install/scripts/ 下
MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"     # modules/install
SKILL_DIR="$(cd "$MODULE_DIR/../.." && pwd)"                      # <skill> 根目录
CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}环境检测${NC}"
bash "$SKILL_DIR/modules/env-check/scripts/env_check.sh" || true
echo
echo "常见问题检索位置："
echo "  references/knowledge/07_FAQ故障排查/"
echo "  - recover conf failed / 断链"
echo "  - openssl/ssl.h 编译报错"
echo "  - buildtool build -p core 报错"
echo "  - Docker 安装失败"
