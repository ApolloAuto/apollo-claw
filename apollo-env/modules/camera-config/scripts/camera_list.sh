#!/usr/bin/env bash
# 列出相机模板（名称 / camera_dev / frame_id）
set -euo pipefail
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -c "import yaml; d=yaml.safe_load(open('$BASE_DIR/config/camera_templates.yaml', encoding='utf-8')); [print('  %-22s dev=%-20s frame_id=%s' % (c['name'], c['camera_dev'], c['frame_id'])) for c in d['cameras']]"
