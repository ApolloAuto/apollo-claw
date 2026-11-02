#!/usr/bin/env python3
"""Manage live lidar DAG instances, PB/JSON config, and fusion inputs."""
import argparse
import datetime
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
elif hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent.parent
TEMPLATE = BASE / "config" / "lidar_templates.yaml"
APOLLO_ROOT = Path(os.environ.get("APOLLO_ROOT_DIR", "/apollo"))
WORKSPACE = Path(os.environ.get("APOLLO_WORKSPACE", os.getcwd()))
MAIN_DAG = APOLLO_ROOT / "modules/drivers/lidar/dag/lidar.dag"

try:
    import yaml
except ImportError:
    print(json.dumps({"ok": False, "error": "PyYAML missing"}))
    sys.exit(2)


def fail(msg, code=2):
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(code)


def atomic_write(path, text):
    path = Path(os.path.realpath(str(path)))
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(str(path), str(path) + ".bak." + stamp)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write(text)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, str(path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def block_spans(text, keyword, start=0, end=None):
    """Return brace-balanced (start,end,body_start,body_end) spans."""
    end = len(text) if end is None else end
    out = []
    pattern = re.compile(r"\b" + re.escape(keyword) + r"\s*\{")
    pos = start
    while True:
        m = pattern.search(text, pos, end)
        if not m:
            break
        line = text[text.rfind("\n", 0, m.start()) + 1:m.start()]
        if line.lstrip().startswith("#"):
            pos = m.end()
            continue
        depth = 1
        quote = False
        escaped = False
        i = m.end()
        while i < end and depth:
            ch = text[i]
            if quote:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    quote = False
            else:
                if ch == '"':
                    quote = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
            i += 1
        if depth:
            break
        out.append((m.start(), i, m.end(), i - 1))
        pos = i
    return out


def scalar_entries(text, path, source_type="pb"):
    rows = []
    seen = {}
    for m in re.finditer(r"(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:\"([^\"]*)\"|([^\s#\[\{]+))", text):
        field = m.group(1)
        value = m.group(2) if m.group(2) is not None else m.group(3)
        idx = seen.get(field, 0)
        seen[field] = idx + 1
        rows.append({
            "id": "%s:%s:%d" % (source_type, field, idx),
            "key": field,
            "value": value,
            "sourcePath": str(path),
            "sourceType": source_type,
            "sourceField": field,
        })
    return rows


def json_rows(data, path, prefix=""):
    rows = []
    if isinstance(data, dict):
        for key, value in data.items():
            pointer = prefix + "/" + key.replace("~", "~0").replace("/", "~1")
            rows.extend(json_rows(value, path, pointer))
    elif isinstance(data, list):
        for idx, value in enumerate(data):
            rows.extend(json_rows(value, path, prefix + "/" + str(idx)))
    elif isinstance(data, (str, int, float, bool)) or data is None:
        rows.append({
            "id": "json:" + prefix,
            "key": prefix.rsplit("/", 1)[-1],
            "value": "" if data is None else str(data).lower() if isinstance(data, bool) else str(data),
            "sourcePath": str(path),
            "sourceType": "json",
            "sourceField": prefix,
        })
    return rows


def json_rows_for_instance(data, path, lidar_ip):
    rows = json_rows(data, path)
    if not lidar_ip or not isinstance(data, dict):
        return rows
    selected_indexes = set()
    for root in data.values():
        if not isinstance(root, dict):
            continue
        hosts = root.get("host_net_info", [])
        if not isinstance(hosts, list):
            continue
        for idx, host in enumerate(hosts):
            if isinstance(host, dict) and lidar_ip in host.get("lidar_ip", []):
                selected_indexes.add(idx)
    if not selected_indexes:
        return rows
    filtered = []
    for row in rows:
        pointer = row["sourceField"]
        match = re.search(r'/host_net_info/(\d+)/', pointer)
        if match and int(match.group(1)) not in selected_indexes:
            continue
        filtered.append(row)
    return filtered


def load_templates():
    with open(TEMPLATE, encoding="utf-8") as stream:
        data = yaml.safe_load(stream)
    result = []
    for item in data.get("lidars", []):
        fields = []
        for f in item.get("fields", []):
            if f.get("concept") == "model":
                continue
            fields.append({
                "key": f.get("concept", ""),
                "sourceField": f.get("field", ""),
                "location": f.get("location", "top"),
                "value": str(f.get("default", "")),
                "label": f.get("desc", f.get("concept", "")),
            })
        result.append({
            "model": item.get("model", ""),
            "vendor": item.get("vendor", ""),
            "driverConf": item.get("driver_conf", ""),
            "dag": item.get("dag", ""),
            "fields": fields,
        })
    return result


def components():
    text = MAIN_DAG.read_text(encoding="utf-8", errors="replace")
    result = []
    for ms, me, mbs, mbe in block_spans(text, "module_config"):
        module = text[mbs:mbe]
        library = (re.search(r'module_library\s*:\s*"([^\"]+)"', module) or [None, ""])[1]
        for cs, ce, cbs, cbe in block_spans(text, "components", mbs, mbe):
            body = text[cbs:cbe]
            cls = (re.search(r'class_name\s*:\s*"([^\"]+)"', body) or [None, ""])[1]
            conf = (re.search(r'config_file_path\s*:\s*"([^\"]+)"', body) or [None, ""])[1]
            name_match = re.search(r'(?m)^\s*name\s*:\s*"([^\"]+)"', body)
            name = name_match.group(1) if name_match else ""
            if cls and conf:
                result.append({"moduleStart": ms, "moduleEnd": me, "start": cs, "end": ce,
                               "library": library, "className": cls, "name": name, "conf": conf})
    return text, result


def pointcloud_channel(pb_text):
    m = re.search(r'(?:point_cloud_channel|pointcloud_channel)\s*:\s*"([^\"]+)"', pb_text)
    return m.group(1) if m else ""


def model_for(conf, templates, pb_text):
    for item in templates:
        if item["driverConf"] == conf:
            return item["model"]
    m = re.search(r'\b(?:model|lidar_type)\s*:\s*"([^\"]+)"', pb_text)
    if m:
        return m.group(1)
    if "livox" in conf.lower():
        return "Livox"
    return Path(conf).stem


def referenced_json(pb_text):
    paths = []
    for m in re.finditer(r'\b[A-Za-z0-9_]*config_file_path\s*:\s*"([^\"]+\.json)"', pb_text):
        if m.group(1) not in paths:
            paths.append(m.group(1))
    return paths


def fusion_info(items):
    fusion = next((x for x in items if re.search(r"Fusion|Compensator", x["className"], re.I)), None)
    if not fusion:
        return None
    path = Path(fusion["conf"])
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    inputs_match = re.search(r'input_channel\s*:\s*\[([^\]]*)\]', text, re.S)
    inputs = re.findall(r'"([^\"]+)"', inputs_match.group(1)) if inputs_match else []
    output = (re.search(r'output_channel\s*:\s*"([^\"]+)"', text) or [None, ""])[1]
    target = (re.search(r'target_frame_id\s*:\s*"([^\"]+)"', text) or [None, ""])[1]
    dag_text = MAIN_DAG.read_text(encoding="utf-8", errors="replace")
    comp_body = dag_text[fusion["start"]:fusion["end"]]
    main = (re.search(r'readers\s*\{[^}]*channel\s*:\s*"([^\"]+)"', comp_body, re.S) or [None, ""])[1]
    perception_conf = APOLLO_ROOT / "modules/perception/pointcloud_preprocess/dag/pointcloud_preprocess.dag"
    perception = ""
    try:
        ptext = perception_conf.read_text(encoding="utf-8", errors="replace")
        perception = (re.search(r'channel\s*:\s*"([^\"]+)"', ptext) or [None, ""])[1]
    except OSError:
        pass
    return {"conf": str(path), "mainChannel": main, "inputChannels": inputs,
            "outputChannel": output, "targetFrameId": target, "perceptionChannel": perception}


def inspect():
    templates = load_templates()
    _, items = components()
    radars = []
    for item in items:
        if re.search(r"Fusion|Compensator", item["className"], re.I):
            continue
        conf = Path(item["conf"])
        try:
            pb_text = conf.read_text(encoding="utf-8", errors="replace")
        except OSError:
            pb_text = ""
        fields = scalar_entries(pb_text, conf)
        lidar_ip_match = re.search(r'\b(?:lidar_ip|ip|device_ip)\s*:\s*"([^"]+)"', pb_text)
        lidar_ip = lidar_ip_match.group(1) if lidar_ip_match else ""
        for json_path in referenced_json(pb_text):
            try:
                data = json.loads(Path(json_path).read_text(encoding="utf-8"))
                fields.extend(json_rows_for_instance(data, json_path, lidar_ip))
            except (OSError, ValueError):
                pass
        radars.append({
            "name": item["name"], "className": item["className"], "library": item["library"],
            "conf": item["conf"], "model": model_for(item["conf"], templates, pb_text),
            "pointcloudChannel": pointcloud_channel(pb_text), "fields": fields,
        })
    return {"ok": True, "dag": str(MAIN_DAG), "radars": radars,
            "models": templates, "fusion": fusion_info(items)}


def json_pointer_set(data, pointer, value):
    parts = [x.replace("~1", "/").replace("~0", "~") for x in pointer.split("/")[1:]]
    cur = data
    for part in parts[:-1]:
        cur = cur[int(part)] if isinstance(cur, list) else cur[part]
    key = parts[-1]
    old = cur[int(key)] if isinstance(cur, list) else cur[key]
    if isinstance(old, bool):
        converted = str(value).lower() in ("1", "true", "yes")
    elif isinstance(old, int):
        converted = int(value)
    elif isinstance(old, float):
        converted = float(value)
    elif old is None and str(value).lower() == "null":
        converted = None
    else:
        converted = value
    if isinstance(cur, list):
        cur[int(key)] = converted
    else:
        cur[key] = converted


def replace_scalar(text, field, value, index=0):
    pattern = re.compile(r'(?m)^(\s*' + re.escape(field) + r'\s*:\s*)(?:"([^\"]*)"|([^\s#\[\{]+))')
    seen = [0]
    def repl(match):
        current = seen[0]
        seen[0] += 1
        if current != index:
            return match.group(0)
        return match.group(1) + ('"' + str(value) + '"' if match.group(2) is not None else str(value))
    return pattern.sub(repl, text)


def edit_instance(request):
    conf = request.get("conf", "")
    if not conf:
        fail("conf required")
    values = request.get("values", {})
    path = Path(conf)
    if not path.is_file():
        fail("conf not found: " + conf)
    pb_text = path.read_text(encoding="utf-8", errors="replace")
    pb_changes = {}
    json_changes = {}
    seen = {}
    for field_id, value in values.items():
        if field_id.startswith("pb:"):
            _, field, index = field_id.split(":", 2)
            pb_changes[(field, int(index))] = str(value)
        elif field_id.startswith("json:"):
            pointer = field_id[len("json:"):]
            source_path = request.get("jsonPaths", {}).get(field_id)
            if source_path:
                json_changes.setdefault(source_path, {})[pointer] = value
    pattern = re.compile(r'(?m)^(\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*)(?:"([^\"]*)"|([^\s#\[\{]+))')
    seen = {}
    def repl(m):
        field = m.group(2)
        idx = seen.get(field, 0)
        seen[field] = idx + 1
        key = (field, idx)
        if key not in pb_changes:
            return m.group(0)
        value = pb_changes[key]
        return m.group(1) + ('"' + value + '"' if m.group(3) is not None else value)
    new_pb = pattern.sub(repl, pb_text)
    if new_pb != pb_text:
        atomic_write(path, new_pb)
    for source_path, changes in json_changes.items():
        jpath = Path(source_path)
        data = json.loads(jpath.read_text(encoding="utf-8"))
        for pointer, value in changes.items():
            json_pointer_set(data, pointer, value)
        atomic_write(jpath, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    sync_fusion()
    return {"ok": True, "message": "雷达配置已更新，融合输入已同步"}


def remove_instance(conf):
    text, items = components()
    item = next((x for x in items if x["conf"] == conf and not re.search(r"Fusion|Compensator", x["className"], re.I)), None)
    if not item:
        fail("lidar instance not found: " + conf)
    new_text = text[:item["start"]] + text[item["end"]:]
    # Remove a module_config when it contains no remaining components.
    _, remaining = components_from_text(new_text)
    for ms, me, mbs, mbe in reversed(block_spans(new_text, "module_config")):
        if not block_spans(new_text, "components", mbs, mbe):
            new_text = new_text[:ms] + new_text[me:]
    atomic_write(MAIN_DAG, re.sub(r"\n{3,}", "\n\n", new_text).strip() + "\n")
    sync_fusion()
    return {"ok": True, "message": "雷达实例已删除，融合输入已同步"}


def components_from_text(text):
    result = []
    for ms, me, mbs, mbe in block_spans(text, "module_config"):
        for cs, ce, cbs, cbe in block_spans(text, "components", mbs, mbe):
            body = text[cbs:cbe]
            conf = (re.search(r'config_file_path\s*:\s*"([^\"]+)"', body) or [None, ""])[1]
            result.append({"moduleStart": ms, "moduleEnd": me, "start": cs, "end": ce, "conf": conf})
    return text, result


def sync_fusion():
    text, items = components()
    channels = []
    fusion = None
    for item in items:
        try:
            pb = Path(item["conf"]).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if re.search(r"Fusion|Compensator", item["className"], re.I):
            if "fusion" in item["conf"].lower():
                fusion = item
            continue
        channel = pointcloud_channel(pb)
        if channel and channel not in channels:
            channels.append(channel)
    if not fusion:
        return
    path = Path(fusion["conf"])
    conf_text = path.read_text(encoding="utf-8", errors="replace")
    block = "input_channel: [\n" + "".join('    "%s",\n' % x for x in channels) + "]"
    updated = re.sub(r'input_channel\s*:\s*\[[^\]]*\]', block, conf_text, count=1, flags=re.S)
    if updated != conf_text:
        atomic_write(path, updated)


def workspace_root():
    env = os.environ.get("APOLLO_WORKSPACE")
    if env and Path(env, "profiles").is_dir():
        return Path(env)
    cwd = Path(os.getcwd())
    for candidate in [cwd] + list(cwd.parents):
        if (candidate / "profiles").is_dir():
            return candidate
    return cwd


def active_profile():
    current = workspace_root() / "profiles" / "current"
    if current.exists():
        return Path(os.path.realpath(str(current))).name
    return ""


def unique_instance_name(items, template, requested):
    taken = {x["name"] for x in items} | {Path(x["conf"]).stem for x in items}
    base = re.sub(r'[^A-Za-z0-9_]+', '_', (requested or template["vendor"] or template["model"]).strip()).strip("_").lower()
    if not base:
        base = "lidar"
    if base not in taken:
        return base
    index = 2
    while "%s_%d" % (base, index) in taken:
        index += 1
    return "%s_%d" % (base, index)


def add_instance(request):
    model = request.get("model", "")
    templates = load_templates()
    template = next((x for x in templates if x["model"] == model), None)
    if not template:
        fail("模板中不存在该型号: " + str(model))
    source_conf = Path(template["driverConf"])
    source_dag = Path(template["dag"])
    if not source_conf.is_file():
        fail("该型号缺少驱动 conf 模板: " + str(source_conf))
    if not source_dag.is_file():
        fail("该型号缺少 dag 模板: " + str(source_dag))

    dag_text, items = components()
    template_text = source_dag.read_text(encoding="utf-8", errors="replace")
    driver_module = None
    for ms, me, mbs, mbe in block_spans(template_text, "module_config"):
        block = template_text[ms:me]
        if re.search(r'class_name\s*:\s*"[^\"]*(Fusion|Compensator)[^\"]*"', block, re.I):
            continue
        driver_module = block
        break
    if driver_module is None:
        fail("该型号模板 dag 中没有 driver 块: " + str(model))
    library = (re.search(r'module_library\s*:\s*"([^\"]+)"', driver_module) or [None, ""])[1]
    class_name = (re.search(r'class_name\s*:\s*"([^\"]+)"', driver_module) or [None, ""])[1]
    if not library or not class_name:
        fail("模板 dag 缺少 module_library 或 class_name")

    # Every added lidar becomes its own instance: unique name, conf, frame and channels.
    name = unique_instance_name(items, template, request.get("name", ""))
    values = dict(request.get("values", {}) or {})
    values.setdefault("frameId", name)
    values.setdefault("pointcloud", "/apollo/sensor/%s/PointCloud2" % name)
    values.setdefault("scan", "/apollo/sensor/%s/Scan" % name)

    conf_dir = APOLLO_ROOT / "modules/drivers/lidar/conf"
    target_conf = conf_dir / ("%s_conf.pb.txt" % name)
    if target_conf.exists() or any(x["conf"] == str(target_conf) for x in items):
        fail("实例 conf 已存在: " + str(target_conf))

    conf_text = Path(os.path.realpath(str(source_conf))).read_text(encoding="utf-8", errors="replace")
    field_map = {x["key"]: x["sourceField"] for x in template["fields"] if x.get("sourceField")}
    written = []
    for key, value in values.items():
        if value in (None, ""):
            continue
        field = field_map.get(key) or field_map.get(re.sub(r'([A-Z])', lambda m: "_" + m.group(1).lower(), key))
        if not field:
            continue
        candidate = replace_scalar(conf_text, field, value)
        if candidate != conf_text:
            conf_text = candidate
            written.append("%s=%s" % (field, value))

    profile = active_profile()
    if profile:
        profile_conf = workspace_root() / "profiles" / profile / "modules/drivers/lidar/conf" / target_conf.name
        profile_conf.parent.mkdir(parents=True, exist_ok=True)
        profile_conf.write_text(conf_text, encoding="utf-8")
    else:
        conf_dir.mkdir(parents=True, exist_ok=True)
        target_conf.write_text(conf_text, encoding="utf-8")

    block = (
        '    components {\n'
        '        class_name : "%s"\n' % class_name
        + '        config {\n'
        + '            name : "%s"\n' % name
        + '            config_file_path : "%s"\n' % target_conf
        + '        }\n'
        + '    }\n'
    )
    # Reuse the vendor module_config when present so one library owns all its instances.
    target_module = None
    for ms, me, mbs, mbe in block_spans(dag_text, "module_config"):
        if ('"%s"' % library) in dag_text[ms:me]:
            target_module = (ms, me)
            break
    if target_module is None:
        new_module = 'module_config {\n    module_library : "%s"\n\n%s}\n' % (library, block)
        new_dag = dag_text.rstrip() + "\n\n" + new_module
    else:
        ms, me = target_module
        insert_at = dag_text.rfind("}", ms, me)
        new_dag = dag_text[:insert_at] + "\n" + block + dag_text[insert_at:]
    atomic_write(MAIN_DAG, new_dag)

    relinked = True
    if profile:
        try:
            subprocess.run(["aem", "profile", "use", profile], cwd=str(workspace_root()),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
        except (OSError, subprocess.SubprocessError):
            pass
        relinked = target_conf.exists()

    sync_fusion()
    message = "雷达已添加：%s（%s），conf %s" % (model, name, target_conf)
    if written:
        message += "，已写入 " + ", ".join(written)
    if not relinked:
        message += "；conf 已写入 profile 但软链未建立，请检查 aem profile use"
    return {"ok": True, "message": message}


def apply_request(request):
    action = request.get("action")
    if action == "edit":
        return edit_instance(request)
    if action == "remove":
        return remove_instance(request.get("conf", ""))
    if action == "add":
        return add_instance(request)
    fail("unsupported action: " + str(action))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("inspect")
    apply_p = sub.add_parser("apply")
    apply_p.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        if args.command == "inspect":
            print(json.dumps(inspect(), ensure_ascii=False))
            return 0
        if args.command == "apply":
            with open(args.request, encoding="utf-8") as stream:
                request = json.load(stream)
            print(json.dumps(apply_request(request), ensure_ascii=False))
            return 0
        parser.print_help()
        return 2
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
