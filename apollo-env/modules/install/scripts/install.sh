#!/usr/bin/env bash
# 打印 EDU PnC 安装引导步骤
set -euo pipefail
cat <<'EOF'
安装引导（在宿主机执行）：
1. 安装 Docker
2. 安装 aem
3. 克隆 EDU 工程（application-pnc 或对应工程）
4. bash setup.sh
5. aem start && aem enter
6. buildtool build -p core（建议两次）
7. aem bootstrap start --plus
详见 SKILL.md 流程 A。
EOF
