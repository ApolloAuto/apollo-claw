#!/usr/bin/env python3
"""交互式配置 Apollo 激光雷达驱动（多厂家，模板驱动）。"""
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
TEMPLATE = BASE_DIR / "config" / "lidar_templates.yaml"

try:
    import yaml
except ImportError:
    print("缺少 PyYAML，无法读取模板")
    sys.exit(2)

GREEN = "\033[0;32m"; YELLOW = "\033[1;33m"; RED = "\033[0;31m"; CYAN = "\033[0;36m"; NC = "\033[0m"


def load_template():
    with open(TEMPLATE, encoding="utf-8") as f:
        return yaml.safe_load(f)


def find_lidar(tpl, model):
    for l in tpl["lidars"]:
        if l["model"] == model:
            return l
    return None


def get_block(text, name):
    m = re.search(r"\b" + re.escape(name) + r"\s*\{", text)
    if not m:
        return None
    start = m.end()
    depth = 1
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start:i]
    return None


def get_field(text, field):
    m = re.search(r"\b" + re.escape(field) + r"\s*:\s*(?:\"([^\"]*)\"|([^\s#]+))", text)
    if m:
        return m.group(1) if m.group(1) is not None else m.group(2)
    return None


def fmt_value(v):
    s = str(v)
    # 纯数字不加引号（端口/数值字段）；字符串加引号
    if re.match(r'^-?\d+(\.\d+)?$', s):
        return s
    return '"' + s + '"'


def replace_in_text(text, field, new_val):
    pattern = r'(\b' + re.escape(field) + r'\s*:\s*)(?:"[^"]*"|[^\s#]+)'
    return re.sub(pattern, lambda m: m.group(1) + fmt_value(new_val), text, count=1)


def replace_field(text, field, new_val, location):
    if location == "config_base":
        blk = get_block(text, "config_base")
        if blk is None:
            raise ValueError("配置中缺少 config_base 块，字段 " + field + " 无法定位")
        new_blk = replace_in_text(blk, field, new_val)
        if new_blk == blk:
            raise ValueError("config_base 中未找到字段 " + field)
        return text.replace(blk, new_blk, 1)
    updated = replace_in_text(text, field, new_val)
    if updated == text:
        raise ValueError("未找到字段 " + field)
    return updated


def prompt(label, current, choices=None):
    hint = " [当前: " + str(current) + "]"
    if choices:
        hint += "（可选: " + ", ".join(str(c) for c in choices) + "）"
    val = input(label + hint + ": ").strip()
    return val if val else current


def sync_main_dag(lidar, stamp, mode="replace"):
    """管理主 dag（lidar.dag）里的雷达 driver 块。

    mode=replace：整体替换主 dag（只留该型号）。
    mode=add：把该型号的 module_config 块追加进主 dag（多雷达并存，去重）。
    mode=remove：从主 dag 移除该型号的 module_config 块。
    """
    main_dag = Path("/apollo/modules/drivers/lidar/dag/lidar.dag")
    if not main_dag.is_file():
        return False
    main_real = Path(os.path.realpath(str(main_dag)))
    cur_text = main_real.read_text(encoding="utf-8", errors="replace")

    if mode == "remove":
        target_conf = lidar.get("driver_conf")
        if not target_conf or target_conf not in cur_text:
            print("主 dag 中不存在该型号（" + str(target_conf) + "）。")
            return False
        # 按 component 为单位删除（一个 module_config 可含多个 components，如 livox×4）
        comp_blocks = re.findall(r'components\s*\{.*?\n\s*\}', cur_text, re.DOTALL)
        removed = False
        for cb in comp_blocks:
            if target_conf in cb:
                cur_text = cur_text.replace(cb, '', 1)
                removed = True
                break
        if not removed:
            print("移除失败。")
            return False
        # 清理删除 component 后变空的 module_config 块
        cur_text = re.sub(r'module_config\s*\{\s*(?:#.*\n\s*)*\}', '', cur_text)
        final_text = cur_text
    elif mode == "add":
        dag_template = lidar.get("dag")
        if not dag_template or not Path(dag_template).is_file():
            return False
        new_text = Path(dag_template).read_text(encoding="utf-8", errors="replace")
        blocks = re.findall(r'module_config\s*\{.*?\n\}', new_text, re.DOTALL)
        final_text = cur_text.rstrip()
        added = False
        for block in blocks:
            # 多雷达时只追加 driver 块；compensator/fusion 统一用一个，不随型号重复追加
            if re.search(r'class_name\s*:\s*"[^"]*(Compensator|Fusion)[^"]*"', block):
                continue
            conf_match = re.search(r'config_file_path\s*:\s*"([^"]+)"', block)
            if conf_match and conf_match.group(1) in cur_text:
                continue
            final_text += "\n\n" + block
            added = True
        if not added:
            print("主 dag 已包含该型号，未改动。")
            return False
    else:
        dag_template = lidar.get("dag")
        if not dag_template or not Path(dag_template).is_file():
            return False
        new_text = Path(dag_template).read_text(encoding="utf-8", errors="replace")
        if new_text.strip() == cur_text.strip():
            print("主 dag 已与型号一致，未改动。")
            return False
        final_text = new_text

    bak = main_real.with_name(main_real.name + ".bak." + stamp)
    shutil.copy2(str(main_real), str(bak))
    fd, tmp = tempfile.mkstemp(prefix=main_real.name + ".", dir=str(main_real.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(final_text)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, str(main_real))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    print(GREEN + "主 dag 已更新：" + str(main_dag) + NC)
    print("原 dag 备份：" + str(bak))
    update_fusion_input(final_text)
    return True


def update_fusion_input(dag_text):
    """扫描 dag 里所有 driver 的 PointCloud2 channel，更新 fusion conf 的 input_channel。"""
    channels = []
    for conf_path in re.findall(r'config_file_path\s*:\s*"([^"]+)"', dag_text):
        if 'fusion' in conf_path or 'compensator' in conf_path:
            continue
        try:
            conf_text = Path(conf_path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        ch = re.search(r'point_cloud_channel\s*:\s*"([^"]+)"', conf_text) or \
            re.search(r'pointcloud_channel\s*:\s*"([^"]+)"', conf_text)
        if ch:
            channels.append(ch.group(1))
    # 找 fusion conf
    fusion_conf_match = re.search(r'config_file_path\s*:\s*"([^"]*fusion[^"]*)"', dag_text)
    if not fusion_conf_match:
        return
    fusion_conf_path = fusion_conf_match.group(1)
    if not Path(fusion_conf_path).is_file():
        return
    real = Path(os.path.realpath(str(fusion_conf_path)))
    text = real.read_text(encoding="utf-8", errors="replace")
    block = "input_channel: [\n" + "".join('    "%s",\n' % c for c in channels) + "]"
    new_text = re.sub(r'input_channel:\s*\[[^\]]*\]', block, text, count=1, flags=re.DOTALL)
    if new_text == text:
        return
    shutil.copy2(str(real), str(real) + ".bak." + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    real.write_text(new_text, encoding="utf-8")
    print(GREEN + "fusion input_channel 已更新：" + ", ".join(channels) + NC)


def configure(tpl, model, overrides, assume_yes=False, mode="replace", conf=None):
    if mode == "remove" and conf:
        # remove 直接用 conf 路径匹配 dag 块，不依赖模板型号
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        sync_main_dag({"driver_conf": conf}, stamp, "remove")
        return 0
    if mode == "edit" and conf:
        # edit 直接改该 conf 的字段（IP/端口/frame_id/channel），不依赖模板型号
        conf_path = Path(conf)
        if not conf_path.is_file():
            print(RED + "conf 不存在: " + str(conf_path) + NC, file=sys.stderr)
            return 2
        real = Path(os.path.realpath(str(conf_path)))
        text = real.read_text(encoding="utf-8", errors="replace")
        new_text = text
        changed = False

        def sub_ip(t):
            return re.sub(r'ip\s*:\s*"[^"]*"', 'ip: "%s"' % overrides["device_ip"], t, count=1)

        def sub_port(t, field_names, val):
            pat = '(' + '|'.join(field_names) + r')\s*:\s*\d+'
            return re.sub(pat, lambda m: m.group(1) + ': ' + val, t, count=1)

        if overrides.get("device_ip"):
            new_text, n = re.subn(r'ip\s*:\s*"[^"]*"', 'ip: "%s"' % overrides["device_ip"], new_text, count=1)
            changed = changed or n > 0
        if overrides.get("data_port"):
            new_text, n = re.subn(r'(lidar_recv_port|msop_port|firing_data_port)\s*:\s*\d+', lambda m: m.group(1) + ': ' + overrides["data_port"], new_text, count=1)
            changed = changed or n > 0
        if overrides.get("aux_port"):
            new_text, n = re.subn(r'(gps_recv_port|difop_port|positioning_data_port)\s*:\s*\d+', lambda m: m.group(1) + ': ' + overrides["aux_port"], new_text, count=1)
            changed = changed or n > 0
        if overrides.get("frame_id"):
            new_text, n = re.subn(r'frame_id\s*:\s*"[^"]*"', 'frame_id: "%s"' % overrides["frame_id"], new_text, count=1)
            changed = changed or n > 0
        if overrides.get("pointcloud"):
            new_text, n = re.subn(r'point_cloud_channel\s*:\s*"[^"]*"', 'point_cloud_channel: "%s"' % overrides["pointcloud"], new_text, count=1)
            if n == 0:
                new_text, n = re.subn(r'pointcloud_channel\s*:\s*"[^"]*"', 'pointcloud_channel: "%s"' % overrides["pointcloud"], new_text, count=1)
            changed = changed or n > 0
        if overrides.get("scan"):
            new_text, n = re.subn(r'scan_channel\s*:\s*"[^"]*"', 'scan_channel: "%s"' % overrides["scan"], new_text, count=1)
            changed = changed or n > 0
        if not changed:
            print("无字段修改，未写入。")
            return 0
        bak = real.with_name(real.name + ".bak." + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
        shutil.copy2(str(real), str(bak))
        fd, tmp = tempfile.mkstemp(prefix=real.name + ".", dir=str(real.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                out.write(new_text)
                out.flush()
                os.fsync(out.fileno())
            os.replace(tmp, str(real))
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        print(GREEN + "conf 已更新：" + str(conf_path) + NC)
        print("原配置备份：" + str(bak))
        return 0
    lidar = find_lidar(tpl, model)
    if lidar is None:
        print(RED + "模板中不存在型号: " + model + NC, file=sys.stderr)
        return 2

    conf_path = Path(lidar["driver_conf"])
    if not conf_path.is_file():
        print(RED + "驱动 conf 不存在: " + str(conf_path) + NC, file=sys.stderr)
        return 2

    text = conf_path.read_text(encoding="utf-8", errors="replace")

    print(CYAN + "【激光雷达配置】" + model + "（" + lidar["vendor"] + "）" + NC)
    print("驱动 conf：" + str(conf_path))

    # 收集新值：命令行 override 优先；交互终端才逐项询问；非交互（agent 管道）保持当前值
    interactive = sys.stdin.isatty()
    changes = {}
    values = {}
    for f in lidar["fields"]:
        if not f.get("interactive", True):
            continue
        concept = f["concept"]
        cur = get_field(text, f["field"]) if f["location"] == "top" else \
            get_field(get_block(text, "config_base") or "", f["field"])
        values[concept] = cur
        if concept in overrides and overrides[concept] is not None:
            new_val = overrides[concept]
        elif interactive:
            new_val = prompt(f.get("desc", concept) + "（" + f["field"] + "）", cur, f.get("choices"))
        else:
            new_val = cur
        if new_val is not None and str(new_val) != str(cur):
            changes[f["concept"]] = {"field": f["field"], "location": f["location"],
                                     "old": cur, "new": new_val, "desc": f.get("desc", concept)}

    # 型号变更 → 自动同步型号关联字段（校准/校正文件等）
    if "model" in changes:
        new_model = changes["model"]["new"]
        for f in lidar["fields"]:
            if f.get("concept") == "model":
                mc = f.get("model_configs") or {}
                for linked_field, linked_val in mc.get(str(new_model), {}).items():
                    old_val = get_field(text, linked_field)
                    if old_val is not None and str(old_val) != str(linked_val):
                        changes[linked_field] = {
                            "field": linked_field, "location": "top",
                            "old": old_val, "new": linked_val,
                            "desc": "型号关联 " + linked_field}
                break

    # 展示待写入
    if changes:
        print("\n" + CYAN + "即将写入：" + NC)
        for c, ch in changes.items():
            print("  " + ch["desc"] + "（" + ch["field"] + "）：" + str(ch["old"]) + " → " + str(ch["new"]))
    else:
        print("\n无字段修改（保持当前值）。")

    # 关联文件提示：channel / frame_id 无论是否改变，始终展示关联清单供用户判断
    linked = tpl.get("common_linked_files", {})
    final_pointcloud = changes.get("pointcloud", {}).get("new", values.get("pointcloud"))
    final_frame_id = changes.get("frame_id", {}).get("new", values.get("frame_id"))
    if final_pointcloud:
        print("\n" + YELLOW + "⚠️ 点云 channel「" + str(final_pointcloud) + "」关联文件（以下文件引用该 channel，如需同步请手动改）：" + NC)
        for item in linked.get("pointcloud_channel", []):
            risk = "低风险" if item.get("risk") == "low" else "高危"
            print("  [" + risk + "] " + item["path"] + "  →  " + item["desc"])
    if final_frame_id:
        print("\n" + YELLOW + "⚠️ frame_id「" + str(final_frame_id) + "」关联文件（以下文件引用该值，如需同步请手动改）：" + NC)
        for item in linked.get("frame_id", []):
            risk = "低风险" if item.get("risk") == "low" else "高危"
            print("  [" + risk + "] " + item["path"] + "  →  " + item["desc"])

    if not changes:
        print("\n无字段修改。")
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        sync_main_dag(lidar, stamp, mode)
        return 0

    if not assume_yes and input("\n确认写入驱动 conf？关联文件只列出不自动改 [y/N]: ").strip().lower() not in ("y", "yes"):
        print("已取消。")
        return 1

    # 应用修改
    new_text = text
    for c, ch in changes.items():
        new_text = replace_field(new_text, ch["field"], ch["new"], ch["location"])

    # 写软链最终目标
    write_path = Path(os.path.realpath(str(conf_path)))
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = write_path.with_name(write_path.name + ".bak." + stamp)
    shutil.copy2(str(write_path), str(backup))
    fd, tmp = tempfile.mkstemp(prefix=write_path.name + ".", dir=str(write_path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(new_text)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, str(write_path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

    print(GREEN + "配置已写入：" + str(conf_path) + NC)
    print("原配置备份：" + str(backup))

    # 同步主 dag（lidar.dag）指向该型号的驱动 dag（module_library/class_name/config_file_path）
    sync_main_dag(lidar, stamp, mode)

    print("\n提示：重启 lidar 驱动后生效。")
    print("  关联文件（感知/定位/TF/外参）如需同步，按上面清单手动修改。")
    return 0


def main():
    parser = argparse.ArgumentParser(description="交互式配置 Apollo 激光雷达")
    parser.add_argument("--model", default="HESAI40P", help="雷达型号")
    parser.add_argument("--device-ip", dest="device_ip", help="设备 IP")
    parser.add_argument("--host-ip", dest="host_ip", help="本机 IP")
    parser.add_argument("--data-port", dest="data_port", help="数据端口")
    parser.add_argument("--aux-port", dest="aux_port", help="辅助端口")
    parser.add_argument("--frame-id", dest="frame_id", help="TF 帧 ID")
    parser.add_argument("--pointcloud", dest="pointcloud", help="点云 channel")
    parser.add_argument("--scan", dest="scan", help="扫描 channel")
    parser.add_argument("--model-value", dest="model_value", help="要改成的雷达型号值（如 RS32）")
    parser.add_argument("--mode", dest="mode", choices=("replace", "add", "remove", "edit"), default="replace", help="replace=替换；add=追加雷达；remove=移除雷达；edit=修改 conf 字段")
    parser.add_argument("--conf", dest="conf", help="remove 时直接按 conf 路径匹配 dag 块")
    parser.add_argument("--yes", action="store_true", help="非交互：跳过确认并写入 overrides")
    args = parser.parse_args()

    overrides = {
        "model": args.model_value,
        "device_ip": args.device_ip,
        "host_ip": args.host_ip,
        "data_port": args.data_port,
        "aux_port": args.aux_port,
        "frame_id": args.frame_id,
        "pointcloud": args.pointcloud,
        "scan": args.scan,
    }
    tpl = load_template()
    return configure(tpl, args.model, overrides, assume_yes=args.yes, mode=args.mode, conf=args.conf)


if __name__ == "__main__":
    sys.exit(main())
