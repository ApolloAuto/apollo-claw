#!/usr/bin/env python3
"""配置 Apollo 相机驱动：选择 dag 启用的相机，并修改 camera_dev。"""
import argparse
import datetime
import os
import re
import shutil
import sys
import tempfile
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
    """返回 dag 里当前启用的相机名列表（component 未被注释的）。"""
    enabled = []
    blocks = re.findall(r'(#)?\s*components \{.*?\n\s*#?\s*\}', dag_text, re.DOTALL)
    for m in re.finditer(r'(?P<c1>#)?\s*components \{(?P<body>.*?)\n\s*#?\s*\}', dag_text, re.DOTALL):
        if m.group("c1"):
            continue  # 注释掉的 component
        body = m.group("body")
        nm = re.search(r'(?m)^\s*name\s*:\s*"([^"]*)"', body)
        if nm:
            enabled.append(nm.group(1))
    return enabled


def set_camera_in_dag(dag_text, name, conf, enabled):
    """在 dag 里启用/禁用指定相机（替换它的 component 块）。"""
    # 构造启用块和禁用块
    body_lines = [
        'components {',
        '    class_name : "CameraComponent"',
        '    config {',
        '        name : "%s"' % name,
        '        config_file_path : "%s"' % conf,
        '    }',
        '}',
    ]
    enable_block = "\n    ".join(body_lines)
    disable_lines = ["    # " + l.strip() for l in body_lines]
    disable_block = "\n".join(disable_lines)

    # 定位现有块（通过 name 行），找到块边界
    pattern = re.compile(r'(?P<lead>(?:    )?)#?\s*components \{(?:(?!\n\s*#?\s*components \{).)*?name\s*:\s*"%s".*?\n(?:    )?#?\s*\}' % re.escape(name), re.DOTALL)
    m = pattern.search(dag_text)
    if not m:
        # 没有该相机块，追加启用块
        return dag_text.rstrip() + "\n\n    " + enable_block + "\n"
    target = enable_block if enabled else disable_block
    return dag_text[:m.start()] + "    " + target + dag_text[m.end():]


def get_camera_dev(conf_text):
    m = re.search(r'camera_dev\s*:\s*"([^"]*)"', conf_text)
    return m.group(1) if m else None


def configure(tpl, enable_list, dev_map, assume_yes=False):
    dag_path = Path(tpl["dag"])
    if not dag_path.is_file():
        print(RED + "camera.dag 不存在: " + tpl["dag"] + NC, file=sys.stderr)
        return 2

    dag_text = dag_path.read_text(encoding="utf-8", errors="replace")
    cur_enabled = dag_enabled_cameras(dag_text)
    cameras = tpl["cameras"]

    print(CYAN + "【相机配置】" + NC)
    print("当前 dag 启用的相机：" + (", ".join(cur_enabled) if cur_enabled else "（无）"))
    print("\n相机清单（共 %d 个）：" % len(cameras))
    for c in cameras:
        mark = "✅启用" if c["name"] in cur_enabled else "  ——"
        print("  %-22s %s  dev=%s  frame_id=%s" % (c["name"], mark, c["camera_dev"], c["frame_id"]))

    # 确定启用列表：命令行 --enable 优先；否则交互选择
    interactive = sys.stdin.isatty()
    if enable_list is not None:
        final_enabled = [x.strip() for x in enable_list.split(",") if x.strip()]
    elif interactive:
        raw = input("\n要启用的相机（逗号分隔，留空=全部禁用，回车保持当前）: ").strip()
        final_enabled = [x.strip() for x in raw.split(",") if x.strip()] if raw else cur_enabled
    else:
        final_enabled = cur_enabled

    name_map = {c["name"]: c for c in cameras}
    # 校验启用的相机名
    for n in final_enabled:
        if n not in name_map:
            print(RED + "未知相机名: " + n + NC, file=sys.stderr)
            return 2

    # 收集 camera_dev 修改
    dev_changes = {}
    for n in final_enabled:
        c = name_map[n]
        cur = c["camera_dev"]
        if dev_map and n in dev_map:
            new_dev = dev_map[n]
        elif interactive:
            new_dev = input(n + " camera_dev [当前: " + cur + "]: ").strip() or cur
        else:
            new_dev = cur
        if new_dev != cur:
            dev_changes[n] = new_dev

    # 展示
    print("\n" + CYAN + "即将修改：" + NC)
    print("  dag 启用相机：" + (", ".join(final_enabled) if final_enabled else "（全部禁用）"))
    for n, d in dev_changes.items():
        print("  " + n + " camera_dev：" + name_map[n]["camera_dev"] + " → " + d)

    if not (set(final_enabled) != set(cur_enabled) or dev_changes):
        print("\n无修改，退出。")
        return 0

    if not assume_yes and input("\n确认写入？[y/N]: ").strip().lower() not in ("y", "yes"):
        print("已取消。")
        return 1

    # 修改 dag
    new_dag = dag_text
    for c in cameras:
        enabled = c["name"] in final_enabled
        new_dag = set_camera_in_dag(new_dag, c["name"], c["conf"], enabled)

    # 备份并写 dag
    write_dag = Path(os.path.realpath(str(dag_path)))
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(str(write_dag), str(write_dag) + ".bak." + stamp)
    write_dag.write_text(new_dag, encoding="utf-8")

    # 修改各相机的 camera_dev
    for n, d in dev_changes.items():
        c = name_map[n]
        conf_path = Path(c["conf"])
        if conf_path.is_file():
            real = Path(os.path.realpath(str(conf_path)))
            txt = real.read_text(encoding="utf-8", errors="replace")
            new_txt = re.sub(r'camera_dev\s*:\s*"[^"]*"', 'camera_dev: "%s"' % d, txt, count=1)
            shutil.copy2(str(real), str(real) + ".bak." + stamp)
            real.write_text(new_txt, encoding="utf-8")

    print(GREEN + "配置完成。" + NC)
    print("dag 备份：", str(write_dag) + ".bak." + stamp)
    if dev_changes:
        print("已修改 camera_dev 的相机：" + ", ".join(dev_changes.keys()))
    print("提示：重启相机驱动后生效。")
    return 0


def main():
    parser = argparse.ArgumentParser(description="配置 Apollo 相机驱动")
    parser.add_argument("--enable", help="要启用的相机名，逗号分隔")
    parser.add_argument("--devs", help="camera_dev 映射，如 camera1:/dev/video0,camera2:/dev/video1")
    parser.add_argument("--yes", action="store_true", help="非交互：跳过确认并写入")
    args = parser.parse_args()

    dev_map = {}
    if args.devs:
        for item in args.devs.split(","):
            if ":" in item:
                k, v = item.split(":", 1)
                dev_map[k.strip()] = v.strip()

    tpl = load_template()
    return configure(tpl, args.enable, dev_map, assume_yes=args.yes)


if __name__ == "__main__":
    sys.exit(main())
