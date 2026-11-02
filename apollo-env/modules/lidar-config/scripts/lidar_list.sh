#!/usr/bin/env bash
# 列出激光雷达模板支持的型号
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -c "import yaml; d=yaml.safe_load(open('$BASE_DIR/config/lidar_templates.yaml', encoding='utf-8')); [print('  %-16s vendor=%-12s' % (l['model'], l['vendor'])) for l in d['lidars']]"
