#!/usr/bin/env python3
"""检查 Apollo 激光雷达驱动配置（多厂家，模板驱动）。"""
import argparse
import re
import socket
import sys
import io
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
elif hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = BASE_DIR / "config" / "lidar_templates.yaml"
WS = "/apollo_workspace"

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


def conf_text(path):
    p = Path(path)
    if not p.is_absolute():
        p = Path(WS) / path
    if p.is_file():
        return p.read_text(encoding="utf-8", errors="replace")
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


def read_field_value(text, field, location):
    if location == "config_base":
        blk = get_block(text, "config_base")
        if blk is None:
            return None
        return get_field(blk, field)
    return get_field(text, field)


def local_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    try:
        for line in Path("/proc/net/fib_trie").read_text().splitlines():
            m = re.search(r"host LOCAL (\d+\.\d+\.\d+\.\d+)", line)
            if m:
                ips.add(m.group(1))
    except Exception:
        pass
    return ips


def same_subnet(ip, ips):
    parts = ip.split(".")
    if len(parts) != 4:
        return False
    for lip in ips:
        lp = lip.split(".")
        if len(lp) == 4 and lp[0] == parts[0] and lp[1] == parts[1] and lp[2] == parts[2]:
            return True
    return False


def udp_probe(port, timeout=3):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.bind(("0.0.0.0", int(port)))
        s.settimeout(timeout)
        data, _ = s.recvfrom(65535)
        s.close()
        return len(data)
    except socket.timeout:
        return 0
    except OSError:
        return -1


def check_model(tpl, model, no_udp):
    lidar = find_lidar(tpl, model)
    if lidar is None:
        print(RED + "模板中不存在型号: " + model + NC, file=sys.stderr)
        return 2

    print(CYAN + "【激光雷达检查】" + model + "（" + lidar["vendor"] + "）" + NC)
    print("驱动 conf：" + lidar["driver_conf"])

    text = conf_text(lidar["driver_conf"])
    if text is None:
        print(RED + "驱动 conf 不存在" + NC)
        return 2

    # 解析当前字段值
    print("\n" + CYAN + "[配置项]" + NC)
    values = {}
    for f in lidar["fields"]:
        val = read_field_value(text, f["field"], f["location"])
        values[f["concept"]] = val
        if val is not None:
            print("  " + f.get("desc", f["concept"]) + "（" + f["field"] + "）：" + str(val))

    # 网段检查
    print("\n" + CYAN + "[网段检查]" + NC)
    dev_ip = values.get("device_ip")
    if dev_ip:
        ips = local_ips()
        print("  雷达 IP：" + dev_ip)
        print("  本机网卡：" + (", ".join(sorted(ips)) if ips else "无"))
        if same_subnet(dev_ip, ips):
            print(GREEN + "  ✅ 网段匹配" + NC)
        else:
            print(YELLOW + "  ⚠️ 网段不匹配：本机无 " + dev_ip.rsplit('.', 1)[0] + ".x 网段" + NC)
            print("     请确认雷达网线已接、网卡已配同网段 IP")
    else:
        print("  （该型号无 device_ip 字段）")

    # channel 链路：驱动 pointcloud → 补偿器 readers
    print("\n" + CYAN + "[channel 链路]" + NC)
    pc = values.get("pointcloud")
    comp_conf = lidar.get("compensator_conf")
    if comp_conf:
        ct = conf_text(comp_conf)
        if ct:
            oc = get_field(ct, "output_channel")
            print("  驱动点云 → 补偿器输出：" + str(oc))
        else:
            print(YELLOW + "  ⚠️ 补偿器 conf 不存在" + NC)
    else:
        print("  （该型号无补偿器）")

    # channel / frame_id 关联完整性
    linked = tpl.get("common_linked_files", {})
    for concept, key in (("pointcloud_channel", "pointcloud"), ("frame_id", "frame_id")):
        cur = values.get(key)
        if not cur:
            continue
        print("\n" + CYAN + "[" + concept + " 关联完整性]" + NC)
        for item in linked.get(concept, []):
            fp = Path(item["path"])
            if not fp.is_file():
                print(YELLOW + "  ⚠️ " + item["path"] + " 不存在（" + item["desc"] + "）" + NC)
                continue
            content = fp.read_text(encoding="utf-8", errors="replace")
            found = cur in content
            mark = GREEN + "✅" if found else RED + "❌"
            risk = "低风险" if item.get("risk") == "low" else "高危"
            print("  " + mark + " " + item["path"] + " [" + risk + "] " + item["desc"] + NC)
            if not found:
                print("        未找到 channel：" + cur)

    # UDP 探测
    if not no_udp:
        print("\n" + CYAN + "[UDP 数据探测]" + NC)
        data_port = values.get("data_port")
        if data_port:
            try:
                n = udp_probe(int(data_port), 3)
                if n > 0:
                    print(GREEN + "  ✅ 端口 " + str(data_port) + " 收到 " + str(n) + " 字节" + NC)
                elif n == 0:
                    print(YELLOW + "  ⚠️ 端口 " + str(data_port) + " 3 秒内未收到数据（未接雷达或网卡未配）" + NC)
                else:
                    print(YELLOW + "  ⚠️ 端口 " + str(data_port) + " 被占用或无法探测" + NC)
            except Exception as e:
                print(YELLOW + "  ⚠️ UDP 探测失败：" + str(e) + NC)
        else:
            print("  （该型号无 data_port 字段）")

    print("\n" + CYAN + "[提示]" + NC)
    print("  - 改 channel / frame_id 后，请用 configure 向导同步关联文件")
    print("  - 未接雷达时 UDP 无数据属正常")
    return 0


def main():
    parser = argparse.ArgumentParser(description="检查 Apollo 激光雷达配置")
    parser.add_argument("--model", default="HESAI40P", help="雷达型号（见 lidar list）")
    parser.add_argument("--no-udp", action="store_true", help="跳过 UDP 数据探测")
    args = parser.parse_args()
    tpl = load_template()
    return check_model(tpl, args.model, args.no_udp)


if __name__ == "__main__":
    sys.exit(main())
