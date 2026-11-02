#!/usr/bin/env python3
"""检查 Apollo 相机驱动配置和硬件设备。"""
import os
import re
import sys
import io
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
elif hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = BASE_DIR / "config" / "camera_templates.yaml"

try:
    import yaml
except ImportError:
    print("缺少 PyYAML")
    sys.exit(2)

GREEN = "\033[0;32m"; YELLOW = "\033[1;33m"; RED = "\033[0;31m"; CYAN = "\033[0;36m"; NC = "\033[0m"


def load_template():
    with open(TEMPLATE, encoding="utf-8") as f:
        return yaml.safe_load(f)


def dag_enabled_cameras(dag_text):
    enabled = []
    for m in re.finditer(r'(?P<c1>#)?\s*components \{(?P<body>.*?)\n\s*#?\s*\}', dag_text, re.DOTALL):
        if m.group("c1"):
            continue
        nm = re.search(r'(?m)^\s*name\s*:\s*"([^"]*)"', m.group("body"))
        if nm:
            enabled.append(nm.group(1))
    return enabled


def check(tpl):
    dag_path = Path(tpl["dag"])
    if not dag_path.is_file():
        print(RED + "camera.dag 不存在: " + tpl["dag"] + NC, file=sys.stderr)
        return 2

    dag_text = dag_path.read_text(encoding="utf-8", errors="replace")
    enabled = dag_enabled_cameras(dag_text)
    cameras = tpl["cameras"]

    print(CYAN + "【相机检查】" + NC)
    print("dag 启用相机：" + (", ".join(enabled) if enabled else "（无）"))
    print("\n相机清单：")
    print("  %-22s %-7s %-18s %s" % ("名称", "状态", "camera_dev", "frame_id"))
    for c in cameras:
        status = "✅" if c["name"] in enabled else "—"
        exists = os.path.exists(c["camera_dev"]) if c["camera_dev"] else False
        dev_mark = GREEN + "存在" + NC if exists else (YELLOW + "缺失" + NC if c["camera_dev"] else "")
        print("  %-22s %-7s %-18s %s  [%s]" % (c["name"], status, c["camera_dev"], c["frame_id"], dev_mark))

    # 设备检查摘要
    missing = [c for c in cameras if c["camera_dev"] and not os.path.exists(c["camera_dev"])]
    print("\n" + CYAN + "[硬件设备检查]" + NC)
    if missing:
        print(YELLOW + "  ⚠️ 以下 camera_dev 设备不存在（未接相机或驱动未加载）：" + NC)
        for c in missing:
            print("    " + c["name"] + " → " + c["camera_dev"])
    else:
        print(GREEN + "  ✅ 所有 camera_dev 设备都存在" + NC)

    print("\n提示：改相机启动/硬件地址请用 configure，改完重启相机驱动。")
    return 0


def main():
    tpl = load_template()
    return check(tpl)


if __name__ == "__main__":
    sys.exit(main())
