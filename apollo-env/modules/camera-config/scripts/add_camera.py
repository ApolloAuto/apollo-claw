#!/usr/bin/env python3
"""新增 Apollo 相机：创建 conf、加入模板、加入 dag、重挂 profile。"""
import argparse
import datetime
import re
import shutil
import subprocess
import sys
import io
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
elif hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = BASE_DIR / "config" / "camera_templates.yaml"
WS = "/apollo_workspace"

try:
    import yaml
except ImportError:
    print("缺少 PyYAML")
    sys.exit(2)

GREEN = "\033[0;32m"; YELLOW = "\033[1;33m"; RED = "\033[0;31m"; CYAN = "\033[0;36m"; NC = "\033[0m"

DAGS = {
    "camera": "/apollo/modules/drivers/camera/dag/camera.dag",
    "camera_no_compress": "/apollo/modules/drivers/camera/dag/camera_no_compress.dag",
}


def load_template():
    with open(TEMPLATE, encoding="utf-8") as f:
        return yaml.safe_load(f)


def prompt(label, current=""):
    hint = " [当前: " + current + "]" if current else ""
    return input(label + hint + ": ").strip()


def read_conf_field(path, key):
    m = re.search(r'^' + re.escape(key) + r'\s*:\s*"([^"]*)"', path.read_text(encoding="utf-8", errors="replace"), re.MULTILINE)
    return m.group(1) if m else ""


def add_camera(tpl, name, dev, frame_id, ref, dag_name):
    cameras = tpl["cameras"]
    name_map = {c["name"]: c for c in cameras}
    if name in name_map:
        print(RED + "相机已存在: " + name + NC, file=sys.stderr)
        return 2

    # 参考模板
    ref_cam = name_map.get(ref)
    if ref_cam is None:
        print(RED + "参考相机不存在: " + ref + NC, file=sys.stderr)
        return 2
    ref_conf = Path(ref_cam["conf"])
    if not ref_conf.is_file():
        print(RED + "参考 conf 不存在: " + str(ref_conf) + NC, file=sys.stderr)
        return 2

    ref_dev = ref_cam["camera_dev"]
    ref_fid = ref_cam["frame_id"]

    # 生成新 conf：替换 camera_dev / frame_id / channel 里的参考标识
    text = ref_conf.read_text(encoding="utf-8", errors="replace")
    text = re.sub(r'camera_dev\s*:\s*"[^"]*"', 'camera_dev: "%s"' % dev, text, count=1)
    text = re.sub(r'frame_id\s*:\s*"[^"]*"', 'frame_id: "%s"' % frame_id, text, count=1)
    # channel 里的参考标识替换：参考 name / 参考 name 去 camera_ 前缀 / 参考 frame_id
    for old in sorted({ref, ref_fid, ref.replace("camera_", "")}, key=len, reverse=True):
        if old and old != ref:
            text = text.replace(old, name if old == ref else frame_id if old == ref_fid else name.replace("camera_", ""))

    # 写 conf 到 profile
    profile_dir = Path(WS) / "profiles" / "ARCF_40P" / "modules" / "drivers" / "camera" / "conf"
    profile_dir.mkdir(parents=True, exist_ok=True)
    new_conf = profile_dir / (name + ".pb.txt")
    new_conf.write_text(text, encoding="utf-8")

    # 更新模板
    cameras.append({
        "name": name,
        "conf": "/apollo/modules/drivers/camera/conf/" + name + ".pb.txt",
        "camera_dev": dev,
        "frame_id": frame_id,
    })
    with open(TEMPLATE, "w", encoding="utf-8") as f:
        yaml.safe_dump(tpl, f, allow_unicode=True, sort_keys=False, default_flow_style=False, width=200)

    # 加入 dag（注释块）
    dag_path = Path(DAGS.get(dag_name, DAGS["camera"]))
    if not dag_path.is_file():
        print(YELLOW + "⚠️ dag 不存在: " + str(dag_path) + "，跳过 dag 修改" + NC)
    else:
        real = Path(subprocess.check_output(["readlink", "-f", str(dag_path)]).decode().strip())
        dag_text = real.read_text(encoding="utf-8", errors="replace")
        block = ('    # components {\n'
                 '    #     class_name : "CameraComponent"\n'
                 '    #     config {\n'
                 '    #         name : "%s"\n'
                 '    #         config_file_path : "/apollo/modules/drivers/camera/conf/%s.pb.txt"\n'
                 '    #     }\n'
                 '    # }\n') % (name, name)
        dag_text = dag_text.rstrip()
        assert dag_text.endswith('}'), "dag 末尾不是 }"
        dag_text = dag_text[:-1].rstrip() + "\n\n" + block + "}\n"
        shutil.copy2(str(real), str(real) + ".bak." + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
        real.write_text(dag_text, encoding="utf-8")

    # 重新 profile use 建立软链
    print("\n重新执行 aem profile use ARCF_40P 建立软链……")
    subprocess.run(["aem", "profile", "use", "ARCF_40P"], cwd=WS, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print(GREEN + "新增相机完成：" + name + NC)
    print("  conf：" + str(new_conf))
    print("  camera_dev：" + dev)
    print("  frame_id：" + frame_id)
    print("  模板已更新（共 %d 个相机）" % len(cameras))
    print("  dag 已加入注释块：" + dag_name)
    print("提示：启用请用 apollo-env.sh camera configure --enable " + name)
    return 0


def main():
    parser = argparse.ArgumentParser(description="新增 Apollo 相机")
    parser.add_argument("--name", help="相机名")
    parser.add_argument("--dev", help="camera_dev 硬件地址")
    parser.add_argument("--frame-id", dest="frame_id", help="frame_id")
    parser.add_argument("--ref", help="参考相机名（复制其参数）")
    parser.add_argument("--dag", choices=list(DAGS.keys()), default="camera", help="目标 dag")
    args = parser.parse_args()

    tpl = load_template()
    names = [c["name"] for c in tpl["cameras"]]

    interactive = sys.stdin.isatty()
    name = args.name or (prompt("相机名") if interactive else None)
    dev = args.dev or (prompt("camera_dev") if interactive else None)
    frame_id = args.frame_id or (prompt("frame_id") if interactive else None)
    ref = args.ref or (prompt("参考相机（如 camera_front_6mm）", "camera_front_6mm") if interactive else "camera_front_6mm")

    if not name or not dev or not frame_id:
        print(RED + "缺少必填项：--name / --dev / --frame-id" + NC, file=sys.stderr)
        return 2

    return add_camera(tpl, name, dev, frame_id, ref, args.dag)


if __name__ == "__main__":
    sys.exit(main())
