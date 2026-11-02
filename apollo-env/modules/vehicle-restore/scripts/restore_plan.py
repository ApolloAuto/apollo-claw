#!/usr/bin/env python3
"""Read-only target detection and scoped, dry-run-first restore planning."""
from __future__ import print_function
import argparse, datetime, hashlib, io, json, os, posixpath, subprocess, sys, tarfile
try:
    import yaml
except ImportError:
    yaml = None

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WS_DEFAULT = "/apollo_workspace"
REG_DEFAULT = os.path.join(BASE, "registry", "targets.yaml")
BASELINES_DEFAULT = os.path.join(BASE, "baselines")
SENSORS = ["drivers", "perception", "transform"]

class Error(Exception): pass

def yload(path):
    if yaml is None: raise Error("PyYAML is required")
    with io.open(path, encoding="utf-8") as f: return yaml.safe_load(f) or {}

def jload(path):
    with io.open(path, encoding="utf-8") as f: return json.load(f)

def file_sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(1024 * 1024)
            if not b: break
            h.update(b)
    return h.hexdigest()

def version(ws):
    try: data = jload(os.path.join(ws, ".workspace.json"))
    except (IOError, ValueError): return None
    if data.get("version"): return str(data["version"])
    for repo in data.get("repositories", []):
        if isinstance(repo, dict) and str(repo.get("name", "")).startswith("apollo-universe") and repo.get("version"):
            return str(repo["version"])
    for value in data.values():
        if isinstance(value, dict) and value.get("version"): return str(value["version"])
    return None

def stamp(path):
    out = {}
    try:
        with io.open(path, encoding="utf-8") as f:
            for line in f:
                if ":" not in line or line.lstrip().startswith("#"): continue
                key, value = line.split(":", 1)
                if key in ("target_id", "apollo_version", "profile_package"):
                    out[key] = value.strip().strip("\"'")
    except IOError: pass
    return out

def targets(registry):
    return {x["id"]: x for x in yload(registry).get("targets", []) if x.get("id")}

def detect(ws, registry):
    current = os.path.join(ws, "profiles", "current")
    resolved = os.path.realpath(current) if os.path.lexists(current) else None
    result = {"status":"unknown", "target_id":None, "workspace":ws,
              "current_link":current, "current_resolved":resolved,
              "workspace_version":version(ws), "evidence":[], "warnings":[]}
    if not os.path.islink(current):
        result["warnings"].append("profiles/current is not a symbolic link"); return result
    identity = stamp(os.path.join(resolved, ".apollo_vehicle_stamp.yaml"))
    target = identity.get("target_id")
    if not target:
        result["warnings"].append("current profile has no authoritative target stamp"); return result
    registered = targets(registry)
    if target not in registered:
        result["warnings"].append("stamped target is not registered"); return result
    package = registered[target].get("profile_package", target)
    if resolved != os.path.realpath(os.path.join(ws, "profiles", package)):
        result["warnings"].append("current does not resolve to registered profile package"); return result
    current_version, stamp_version = result["workspace_version"], identity.get("apollo_version")
    registered_version = str(registered[target].get("version", ""))
    if current_version and stamp_version and current_version != stamp_version:
        result["warnings"].append("stamp/workspace Apollo versions differ"); return result
    if current_version and registered_version not in ("", "from_workspace", current_version):
        result["warnings"].append("registry/workspace Apollo versions differ"); return result
    result.update(status="detected", target_id=target)
    result["evidence"] = ["current profile stamp target_id={}".format(target),
                          "current resolves to registered profile package"]
    if current_version: result["evidence"].append("Apollo version {} matches identity".format(current_version))
    return result

def artifact(manifest_path):
    manifest = yload(manifest_path); info = manifest.get("artifact") or {}
    if not info.get("path") or not info.get("sha256") or not info.get("archive_root"):
        raise Error("incomplete artifact manifest: {}".format(manifest_path))
    path = os.path.join(os.path.dirname(manifest_path), os.path.basename(info["path"]))
    if not os.path.isfile(path): raise Error("archive is missing: {}".format(path))
    actual = file_sha(path)
    if actual != str(info["sha256"]): raise Error("archive SHA-256 mismatch: {}".format(path))
    return {"manifest":manifest_path, "path":path, "sha256":actual, "archive_root":info["archive_root"]}

def safe(name):
    normalized = posixpath.normpath(name)
    return name and not name.startswith("/") and normalized != ".." and not normalized.startswith("../")

def selected(name, root, scope, modules):
    name, root = posixpath.normpath(name).rstrip("/"), root.rstrip("/")
    if name == root: return scope == "full"
    if not name.startswith(root + "/"): return False
    relative = name[len(root)+1:]
    if scope == "full": return True
    # Parameter archives are rooted at profiles/<target> and contain modules/X;
    # code archives are rooted at modules and contain X directly.
    prefix = "modules/" if root.startswith("profiles/") else ""
    return any(relative == prefix+m or relative.startswith(prefix+m+"/") for m in modules)

def compare(artifact_info, ws, scope, modules):
    count, changes, packages = 0, [], []
    with tarfile.open(artifact_info["path"], "r:gz") as bundle:
        for member in bundle:
            if not safe(member.name): raise Error("unsafe archive member: {}".format(member.name))
            if (member.issym() or member.islnk()) and (os.path.isabs(member.linkname) or posixpath.normpath(member.linkname).startswith("../")):
                raise Error("unsafe archive link: {}".format(member.name))
            if not selected(member.name, artifact_info["archive_root"], scope, modules): continue
            if member.isfile() and member.name.endswith("/cyberfile.xml"):
                package = posixpath.dirname(member.name)
                if package not in packages: packages.append(package)
            if not member.isfile(): continue
            count += 1
            dest = os.path.join(ws, *posixpath.normpath(member.name).split("/"))
            state, current_sha = "missing", None
            h = hashlib.sha256(); stream = bundle.extractfile(member)
            while True:
                chunk = stream.read(1024*1024)
                if not chunk: break
                h.update(chunk)
            baseline_sha = h.hexdigest()
            if os.path.isfile(dest):
                current_sha = file_sha(dest)
                state = "same" if current_sha == baseline_sha else "changed"
            if state != "same": changes.append({"path":member.name, "state":state, "current_sha256":current_sha, "baseline_sha256":baseline_sha})
    # 按模块归组：告诉用户「哪些模块的代码和基线不一样」，只做统计，不动任何文件。
    modules_changed = []
    _agg = {}
    for ch in changes:
        parts = ch["path"].split("/")
        if len(parts) >= 3 and parts[0] == "modules":
            name = parts[1] if parts[1] != "drivers" or len(parts) < 4 else "drivers/" + parts[2]
        elif len(parts) >= 2 and parts[0] == "modules":
            name = parts[1]
        else:
            name = parts[0]
        _agg[name] = _agg.get(name, 0) + 1
    for name in sorted(_agg):
        modules_changed.append({"module":name, "file_count":_agg[name]})
    return {"modules_changed":modules_changed, "selected_file_count":count, "change_count":len(changes), "changes":changes,
            "build_packages":sorted(packages) if changes else []}

def modules_for(scope, values):
    if scope == "full":
        if values: raise Error("--module cannot be used with full scope")
        return []
    if scope == "sensor":
        if not values: return list(SENSORS)
        out = []
        for value in values:
            if not value or value in (".", "..") or value.startswith("/") or value.endswith("/"):
                raise Error("invalid sensor group: {}".format(value))
            if value not in out: out.append(value)
        return out
    out = []
    for value in values:
        if not value or value in (".", "..") or value.startswith("/") or value.endswith("/"):
            raise Error("invalid module: {}".format(value))
        if value not in out: out.append(value)
    if not out: raise Error("module scope requires --module NAME")
    return out

def content_id(plan):
    clean = dict(plan); clean.pop("plan_id", None); clean.pop("generated_at", None)
    return hashlib.sha256(json.dumps(clean, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:24]

def extra_code_modules(workspace, code_artifact):
    """modules/ 里存在、但基线代码包里没有的顶层模块（只读，不改文件）。"""
    root = os.path.join(workspace, "modules")
    if not os.path.isdir(root): return []
    try:
        with tarfile.open(code_artifact["path"], "r:gz") as bundle:
            baseline = set()
            for member in bundle:
                parts = member.name.split("/")
                if len(parts) >= 3 and parts[0] == "modules": baseline.add(parts[1])
    except (IOError, OSError, tarfile.TarError): return []
    extra = []
    for name in sorted(os.listdir(root)):
        if name == "BUILD" or name.startswith("."): continue
        if not os.path.isdir(os.path.join(root, name)): continue
        if name not in baseline: extra.append(name)
    return extra

def make_plan(args):
    mods, identity = modules_for(args.scope, args.modules), detect(args.workspace, args.registry)
    target, blockers, switched = args.target, [], False
    if os.path.realpath(args.workspace) != "/apollo_workspace":
        blockers.append("vehicle restore/build must run in /apollo_workspace")
    if target in (None, "auto"):
        target = identity.get("target_id")
        if not target: blockers.append("automatic target detection failed")
    elif identity.get("status") != "detected":
        if getattr(args, "allow_target_switch", False):
            switched = True   # 当前是 sample/无指纹；允许直接恢复到用户指定的车型
        else:
            blockers.append("current target cannot be authoritatively detected")
    elif target != identity.get("target_id"):
        # 用户显式选了别的车型：允许，但把「切换车型」写进计划，执行时用 aem profile use 切过去。
        # 不给开关则保持原有保守行为（防止误操作）。
        if not getattr(args, "allow_target_switch", False):
            blockers.append("requested target differs from detected target")
        else:
            switched = True
    if target and target not in targets(args.registry): blockers.append("target is not registered")

    extra_code = []
    empty = {"modules_changed":[], "selected_file_count":0, "change_count":0, "changes":[], "build_packages":[]}
    param, code, archives = dict(empty), dict(empty), {}
    if not blockers:
        try:
            root = os.path.join(args.baseline_root, target, "latest")
            archives["parameters"] = artifact(os.path.join(root, "parameters.yaml"))
            archives["code"] = artifact(os.path.join(root, "code.yaml"))
            extra_code = extra_code_modules(args.workspace, archives["code"]) if getattr(args, "prune", False) else []
            param = compare(archives["parameters"], args.workspace, args.scope, mods)
            code = compare(archives["code"], args.workspace, args.scope, mods)
            if args.scope != "full" and not param["selected_file_count"] and not code["selected_file_count"]:
                blockers.append("scope selects no baseline files")
            if code["change_count"] and not code["build_packages"]:
                blockers.append("changed code has no cyberfile.xml build package")
        except (IOError, OSError, Error, tarfile.TarError) as exc: blockers.append(str(exc))
    actions = []
    if param["change_count"]: actions += ["backup_selected_paths", "switch_to_sample", "restore_parameters", "switch_to_target"]
    if switched and "switch_to_target" not in actions: actions.append("switch_to_target")
    if code["change_count"]:
        if "backup_selected_paths" not in actions: actions.append("backup_selected_paths")
        actions += ["restore_code", "build_affected_packages"]
    if getattr(args, "prune", False) and extra_code and "prune_extra_code" not in actions:
        actions.append("prune_extra_code")
    if not actions:
        actions = ["switch_to_target"] if switched else ["no_changes"]
    plan = {"schema_version":1, "kind":"apollo-env-scoped-restore-plan",
            "generated_at":datetime.datetime.utcnow().replace(microsecond=0).isoformat()+"Z",
            "dry_run_completed":not blockers, "workspace":args.workspace,
            "target_detection":identity, "target_id":target, "target_switch":switched,
              "detected_target_id":identity.get("target_id"), "scope":args.scope, "modules":mods,
            "archives":archives, "parameters":param, "code":code,
            "build_packages":code["build_packages"], "actions":actions, "blockers":blockers,
            "warnings":identity.get("warnings", []),
            "changed_modules":code.get("modules_changed", []), "prune":bool(getattr(args,"prune",False)), "extra_code":extra_code, "ready_to_apply":not blockers and bool(param["change_count"] or code["change_count"] or "switch_to_target" in actions or extra_code)}
    plan["plan_id"] = content_id(plan); return plan

def show(plan):
    print("Apollo restore plan {}".format(plan["plan_id"]))
    print("  target: {} ({})".format(plan.get("target_id") or "unknown", plan["target_detection"]["status"]))
    print("  scope: {}{}".format(plan["scope"], " ["+", ".join(plan["modules"])+"]" if plan["modules"] else ""))
    print("  parameter changes: {}/{}".format(plan["parameters"]["change_count"], plan["parameters"]["selected_file_count"]))
    print("  code changes: {}/{}".format(plan["code"]["change_count"], plan["code"]["selected_file_count"]))
    print("  build packages: {}".format(", ".join(plan["build_packages"]) or "none"))
    if plan["blockers"]: print("  blockers: {}".format("; ".join(plan["blockers"])))
    print("  result: {}".format("READY (apply gated)" if plan["ready_to_apply"] else ("BLOCKED" if plan["blockers"] else "NO CHANGES")))

def validate_plan(plan, args):
    if plan.get("kind") != "apollo-env-scoped-restore-plan" or plan.get("schema_version") != 1: raise Error("unsupported plan schema")
    if plan.get("plan_id") != content_id(plan): raise Error("plan_id does not match plan content")
    if not plan.get("dry_run_completed") or plan.get("blockers"): raise Error("plan did not complete a clean dry run")
    if os.path.realpath(plan.get("workspace", "")) != os.path.realpath(args.workspace): raise Error("plan workspace mismatch")
    now = detect(args.workspace, args.registry)
    # 计划里 target_switch=True 表示用户显式要求跨车型恢复（含当前停在 sample 的情况）。
    # 这时不该要求「当前车型 == 计划车型」——执行流程本身会 aem profile use 切过去。
    if not plan.get("target_switch"):
        if now.get("status") != "detected" or now.get("target_id") != plan.get("target_id"):
            raise Error("current target no longer matches plan")
    elif now.get("status") == "detected" and now.get("target_id") == plan.get("target_id"):
        plan["target_switch"] = False  # 已经切到位了，按普通恢复走
    for section in ("parameters", "code"):
        for entry in plan.get(section, {}).get("changes", []):
            path = os.path.join(args.workspace, *entry["path"].split("/"))
            current = file_sha(path) if os.path.isfile(path) else None
            if current != entry.get("current_sha256"):
                raise Error("workspace changed after planning: {}".format(entry["path"]))
    for item in plan.get("archives", {}).values():
        if file_sha(item["path"]) != item["sha256"]: raise Error("baseline changed after planning")

def changed_paths(plan, section):
    return [entry["path"] for entry in plan[section]["changes"]]

def backup_changes(plan):
    root = os.path.join(plan["workspace"], ".apollo-env", "backups")
    name = "{}-{}-{}-{}".format(datetime.datetime.now().strftime("%Y%m%d-%H%M%S"), plan["target_id"], plan["scope"], plan["plan_id"][:8])
    backup = os.path.join(root, name); os.makedirs(backup)
    with tarfile.open(os.path.join(backup, "changed-paths.tar.gz"), "w:gz") as bundle:
        for relative in changed_paths(plan, "parameters") + changed_paths(plan, "code"):
            path = os.path.join(plan["workspace"], *relative.split("/"))
            if os.path.lexists(path): bundle.add(path, arcname=relative, recursive=False)
    with io.open(os.path.join(backup, "plan.json"), "w", encoding="utf-8") as out:
        json.dump(plan, out, indent=2, sort_keys=True); out.write("\n")
    current = os.path.join(plan["workspace"], "profiles", "current")
    with io.open(os.path.join(backup, "current.link"), "w", encoding="utf-8") as out:
        out.write((os.readlink(current) if os.path.islink(current) else "") + "\n")
    return backup

def extract_changes(plan, section):
    wanted = set(changed_paths(plan, section)); artifact_info = plan["archives"][section]
    with tarfile.open(artifact_info["path"], "r:gz") as bundle:
        members = []
        for member in bundle:
            if member.name in wanted:
                if not safe(member.name) or not member.isfile(): raise Error("unsafe selected archive member")
                members.append(member)
        found = set(member.name for member in members)
        if found != wanted: raise Error("planned archive members changed or disappeared")
        bundle.extractall(plan["workspace"], members=members)

def run(command, cwd):
    status = subprocess.call(command, cwd=cwd)
    if status: raise Error("command failed ({}): {}".format(status, " ".join(command)))

def execute(plan, args):
    validate_plan(plan, args)
    if os.path.realpath(plan.get("workspace", "")) != "/apollo_workspace":
        raise Error("vehicle restore/build must run in /apollo_workspace")
    if not args.apply:
        show(plan); print("dry-run execution check passed; no files changed")
        print("apply requires: --apply --confirm-plan {}".format(plan["plan_id"])); return 0
    if args.confirm_plan != plan["plan_id"]: raise Error("--confirm-plan must exactly match {}".format(plan["plan_id"]))
    if not plan.get("ready_to_apply") and not plan.get("extra_code"):
        print("plan has no changes; nothing to apply"); return 0
    if plan["scope"] == "full":
        command = ["bash", os.path.join(BASE, "scripts", "restore_baseline.sh"), "--target", plan["target_id"], "--yes", "--workspace", plan["workspace"]]
        # 跨车型（含当前停在 sample）时，让 restore_baseline.sh 先切 profile 再恢复
        if plan.get("target_switch"): command.append("--allow-target-switch")
        if plan.get("prune"): command.append("--prune")
        return subprocess.call(command, cwd=plan["workspace"])
    backup = backup_changes(plan); ws = plan["workspace"]
    current = os.path.join(ws, "profiles", "current"); target_profile = os.path.realpath(os.path.join(ws, "profiles", plan["target_id"]))
    try:
        if plan["parameters"]["change_count"]:
            # 不判断 aem 的退出码；执行后核验 current 是否真的切到了指定 profile。
            sample_profile = os.path.realpath(os.path.join(ws, "profiles", "sample"))
            subprocess.call(["aem", "profile", "use", "sample"], cwd="/apollo_workspace", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.path.realpath(current) != sample_profile: raise Error("aem profile use sample ran but current verification failed")
            extract_changes(plan, "parameters")
            subprocess.call(["aem", "profile", "use", plan["target_id"]], cwd="/apollo_workspace", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.path.realpath(current) != target_profile: raise Error("aem profile use target ran but current verification failed")
        if plan["code"]["change_count"]:
            extract_changes(plan, "code")
            for package in plan["build_packages"]: run(["buildtool", "build", "-p", package], "/apollo_workspace")
        print("scoped restore applied; backup: {}".format(backup)); return 0
    except Exception:
        print("restore stopped; rollback material: {}".format(backup), file=sys.stderr); raise

def parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--workspace", default=WS_DEFAULT); common.add_argument("--registry", default=REG_DEFAULT)
    root = argparse.ArgumentParser(description=__doc__); commands = root.add_subparsers(dest="command")
    d = commands.add_parser("detect", parents=[common]); d.add_argument("--json", action="store_true")
    p = commands.add_parser("plan", parents=[common]); p.add_argument("--target", default="auto")
    p.add_argument("--prune", action="store_true", help="报告并移出 modules/ 里基线外的代码（移到备份，可回滚）")
    p.add_argument("--allow-target-switch", action="store_true", help="允许恢复到与当前检测不同的车型（会先 aem profile use 切过去）")
    p.add_argument("--scope", choices=("full","sensor","module"), default="full")
    p.add_argument("--module", dest="modules", action="append", default=[]); p.add_argument("--baseline-root", default=BASELINES_DEFAULT)
    p.add_argument("--json", action="store_true"); p.add_argument("--output")
    e = commands.add_parser("execute", parents=[common]); e.add_argument("--plan", required=True)
    e.add_argument("--apply", action="store_true"); e.add_argument("--confirm-plan")
    return root

def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "detect":
            result = detect(args.workspace, args.registry)
            print(json.dumps(result, indent=2, sort_keys=True) if args.json else "{}: {}".format(result["status"], result.get("target_id") or "unknown"))
            return 0 if result["status"] == "detected" else 3
        if args.command == "plan":
            result = make_plan(args)
            if args.output:
                with io.open(args.output, "w", encoding="utf-8") as f: json.dump(result, f, indent=2, sort_keys=True); f.write("\n")
            print(json.dumps(result, indent=2, sort_keys=True) if args.json else "") if args.json else show(result)
            if args.output and not args.json: print("  saved: {}".format(args.output))
            return 0 if not result["blockers"] else 3
        if args.command == "execute": return execute(jload(args.plan), args)
        parser().print_help(); return 2
    except (IOError, OSError, ValueError, Error, tarfile.TarError) as exc:
        print("error: {}".format(exc), file=sys.stderr); return 2
if __name__ == "__main__": sys.exit(main())
