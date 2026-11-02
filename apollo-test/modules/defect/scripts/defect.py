#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""缺陷记录与闭环：登记 → 追踪 → 用最新批量测试结果验证 → 关闭。

为什么要有这个：看到场景 FAIL 只能说明"没通过"，说不清"是什么问题、修了没有、
上次是不是也这样"。缺陷单把现象、期望、复现路径和证据（record / 评分报告）绑在一起，
再用批量测试结果做回归验证，形成闭环。

存储：一个缺陷一个 JSON 文件，放在 config.yaml 的 paths.defect_root 下。

用法：
  defect.py new --title "窄路场景会压线" --scenario 7 --severity major \
      --expected "全程在车道内" --actual "右前轮压线约 0.3m" \
      --steps "1. 启动 DreamView 2. 选场景7 3. 跑完看轨迹" \
      --bag /apollo_workspace/data/record/apollo_channels/xxx

  defect.py list
  defect.py list --status open --severity blocker
  defect.py show DEF-0001
  defect.py update DEF-0001 --status fixed --note "调整了 nudge 阈值"
  defect.py verify DEF-0001                    # 用最新一轮批量测试结果判断
  defect.py verify DEF-0001 --run <run_dir>    # 指定某轮
  defect.py report --out /tmp/defects.md
"""

from __future__ import print_function

import argparse
import csv
import datetime
import io
import json
import os
import sys

try:
    import yaml
except ImportError:
    yaml = None


DEFAULT_CONFIG = {
    "paths": {
        "defect_root": "/apollo_workspace/data/defects",
        "run_root": "/apollo_workspace/data/test_runs",
    },
    "defaults": {"severity": "major", "status": "open"},
    "report": {"dir": ""},
}

STATUSES = ["open", "investigating", "fixed", "verifying", "closed", "wontfix"]
SEVERITIES = ["blocker", "major", "minor", "trivial"]
STATUS_ICON = {
    "open": "🔴", "investigating": "🟠", "fixed": "🟡",
    "verifying": "🔵", "closed": "🟢", "wontfix": "⚪",
}


def ensure_utf8_stdio():
    """locale 为 C/ASCII 时 print 中文会崩；这里自己切 UTF-8。"""
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        if stream is None or not hasattr(stream, "buffer"):
            continue
        encoding = (getattr(stream, "encoding", "") or "").lower().replace("-", "")
        if encoding in ("utf8", "utf8mb4"):
            continue
        setattr(sys, name, io.TextIOWrapper(
            stream.buffer, encoding="utf-8", errors="replace", line_buffering=True))


def fix_argv():
    """locale 为 C/ASCII 时，Python 用 surrogateescape 解码 argv，
    中文参数会变成孤立代理字符，写 UTF-8 时直接报错。
    这里把 argv 还原成原始字节再按 UTF-8 解码。"""
    fixed = []
    for item in sys.argv:
        try:
            fixed.append(item.encode("utf-8", "surrogateescape").decode("utf-8", "replace"))
        except (UnicodeEncodeError, UnicodeDecodeError, AttributeError):
            fixed.append(item)
    return fixed

def deep_merge(base, override):
    out = dict(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(path):
    cfg = DEFAULT_CONFIG
    if path and os.path.isfile(path):
        if yaml is None:
            raise RuntimeError("需要 PyYAML 才能读取 %s" % path)
        with io.open(path, "r", encoding="utf-8") as handle:
            cfg = deep_merge(cfg, yaml.safe_load(handle) or {})
    return cfg


def default_config_path():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "config.yaml")


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def defect_files(root):
    if not os.path.isdir(root):
        return []
    names = [n for n in os.listdir(root) if n.startswith("DEF-") and n.endswith(".json")]
    return sorted(os.path.join(root, n) for n in names)


def load_defect(path):
    with io.open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def save_defect(root, record):
    record["updated_at"] = now()
    path = os.path.join(root, "%s.json" % record["id"])
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, indent=2, sort_keys=True))
        handle.write("\n")
    os.replace(tmp, path)
    return path


def next_id(root):
    existing = 0
    for path in defect_files(root):
        try:
            existing = max(existing, int(os.path.basename(path)[4:8]))
        except ValueError:
            continue
    return "DEF-%04d" % (existing + 1)


def find_defect(root, defect_id):
    path = os.path.join(root, "%s.json" % defect_id)
    if not os.path.isfile(path):
        raise RuntimeError("找不到缺陷 %s（目录 %s）" % (defect_id, root))
    return load_defect(path)


def latest_run(run_root):
    if not os.path.isdir(run_root):
        raise RuntimeError("找不到测试结果目录 %s，请先跑 apollo-test-batch" % run_root)
    candidates = [os.path.join(run_root, name) for name in os.listdir(run_root)]
    candidates = [c for c in candidates
                  if os.path.isdir(c) and os.path.isfile(os.path.join(c, "summary.csv"))]
    if not candidates:
        raise RuntimeError("%s 下没有可用的 summary.csv" % run_root)
    return max(candidates, key=os.path.getmtime)


def read_run_row(run_dir, scenario):
    summary = os.path.join(run_dir, "summary.csv")
    if not os.path.isfile(summary):
        raise RuntimeError("找不到 %s" % summary)
    with io.open(summary, "r", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if str(row.get("scenario", "")).strip() == str(scenario).strip():
                return row
    return None


# ── 命令 ────────────────────────────────────────────────────────────────────


def cmd_new(cfg, args):
    root = cfg["paths"]["defect_root"]
    if not os.path.isdir(root):
        os.makedirs(root)

    defect_id = next_id(root)
    record = {
        "id": defect_id,
        "title": args.title,
        "severity": args.severity or cfg["defaults"]["severity"],
        "status": args.status or cfg["defaults"]["status"],
        "scenario": args.scenario or "",
        "environment": args.env or "",
        "expected": args.expected or "",
        "actual": args.actual or "",
        "steps": args.steps or "",
        "evidence": {
            "bag": args.bag or "",
            "run": args.run or "",
            "grading_log": args.grading_log or "",
        },
        "verification": [],
        "history": [{"at": now(), "status": args.status or cfg["defaults"]["status"],
                     "note": args.note or "创建"}],
        "created_at": now(),
        "updated_at": now(),
    }
    if record["severity"] not in SEVERITIES:
        raise RuntimeError("severity 只能是 %s" % "/".join(SEVERITIES))
    path = save_defect(root, record)
    print("已创建 %s  %s" % (defect_id, record["title"]))
    print("  severity: %s   status: %s   scenario: %s" % (
        record["severity"], record["status"], record["scenario"] or "-"))
    print("  文件: %s" % path)
    return 0


def cmd_list(cfg, args):
    root = cfg["paths"]["defect_root"]
    paths = defect_files(root)
    if not paths:
        print("还没有缺陷记录（%s）" % root)
        return 0

    records = []
    for path in paths:
        record = load_defect(path)
        if args.status and record.get("status") != args.status:
            continue
        if args.severity and record.get("severity") != args.severity:
            continue
        if args.scenario and str(record.get("scenario", "")) != str(args.scenario):
            continue
        records.append(record)

    if args.json:
        print(json.dumps(records, ensure_ascii=False, indent=2))
        return 0

    if not records:
        print("没有符合条件的缺陷")
        return 0

    print("%-9s %-6s %-13s %-5s %s" % ("ID", "严重度", "状态", "场景", "标题"))
    print("%-9s %-6s %-13s %-5s %s" % ("-" * 9, "-" * 6, "-" * 13, "-" * 5, "-" * 30))
    for record in records:
        print("%-9s %-6s %s %-11s %-5s %s" % (
            record["id"], record["severity"],
            STATUS_ICON.get(record.get("status"), " "), record.get("status", ""),
            record.get("scenario") or "-", record.get("title", "")[:40]))
    print("\n共 %d 条" % len(records))
    return 0


def cmd_show(cfg, args):
    record = find_defect(cfg["paths"]["defect_root"], args.defect_id)
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


def cmd_update(cfg, args):
    root = cfg["paths"]["defect_root"]
    record = find_defect(root, args.defect_id)

    if args.status:
        if args.status not in STATUSES:
            raise RuntimeError("status 只能是 %s" % "/".join(STATUSES))
        record["status"] = args.status
        record.setdefault("history", []).append(
            {"at": now(), "status": args.status, "note": args.note or ""})
    elif args.note:
        record.setdefault("history", []).append(
            {"at": now(), "status": record.get("status"), "note": args.note})

    if args.severity:
        if args.severity not in SEVERITIES:
            raise RuntimeError("severity 只能是 %s" % "/".join(SEVERITIES))
        record["severity"] = args.severity

    if args.scenario is not None:
        record["scenario"] = args.scenario
    if args.title:
        record["title"] = args.title
    if args.expected is not None:
        record["expected"] = args.expected
    if args.actual is not None:
        record["actual"] = args.actual
    if args.steps is not None:
        record["steps"] = args.steps

    if args.add_bag:
        record.setdefault("evidence", {})["bag"] = args.add_bag
    if args.add_run:
        record.setdefault("evidence", {})["run"] = args.add_run

    save_defect(root, record)
    print("已更新 %s → status=%s severity=%s scenario=%s" % (
        record["id"], record.get("status"), record.get("severity"),
        record.get("scenario") or "-"))
    return 0


def cmd_verify(cfg, args):
    """用一轮批量测试的结果，检查这个缺陷对应的场景现在过没过。"""
    root = cfg["paths"]["defect_root"]
    record = find_defect(root, args.defect_id)

    scenario = record.get("scenario") or ""
    if not scenario:
        raise RuntimeError(
            "缺陷 %s 没有关联场景号，无法自动验证。先 update 补上 --scenario 再验证。"
            % record["id"])

    run_dir = args.run or latest_run(cfg["paths"]["run_root"])
    row = read_run_row(run_dir, scenario)
    if row is None:
        raise RuntimeError("在 %s 里没有场景 %s 的结果" % (run_dir, scenario))

    passed = (row.get("scenario_pass") or "").strip() == "PASS"
    entry = {
        "at": now(),
        "run": run_dir,
        "scenario": scenario,
        "scenario_pass": row.get("scenario_pass") or row.get("status") or "",
        "total_score": row.get("total_score") or "",
        "metric_fail": row.get("metric_fail") or "",
        "note": args.note or "",
    }
    record.setdefault("verification", []).append(entry)

    if passed:
        record["status"] = "verifying"
        verdict = "✅ 该场景已通过 —— 可人工复核后关闭"
    else:
        record["status"] = "open"
        verdict = "❌ 该场景仍未通过 —— 缺陷保持打开"

    record.setdefault("history", []).append(
        {"at": now(), "status": record["status"], "note": "verify: %s" % verdict})
    save_defect(root, record)

    print("%s  场景 %s  %s  总分 %s  未通过指标 %s" % (
        record["id"], scenario, entry["scenario_pass"] or "-",
        entry["total_score"] or "-", entry["metric_fail"] or "-"))
    print("  %s" % verdict)
    print("  status → %s" % record["status"])
    print("  结果来自: %s" % run_dir)
    return 0 if passed else 1


def cmd_report(cfg, args):
    root = cfg["paths"]["defect_root"]
    records = [load_defect(p) for p in defect_files(root)]
    out_dir = args.out_dir or cfg.get("report", {}).get("dir") or root
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    out_path = args.out or os.path.join(
        out_dir, "defects_%s.md" % datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))

    counts = {}
    for record in records:
        counts[record.get("status", "unknown")] = counts.get(record.get("status", "unknown"), 0) + 1

    lines = ["# 缺陷清单", "", "- 生成时间：%s" % now(), "- 总数：%d" % len(records), ""]
    if counts:
        lines.append("| 状态 | 数量 |")
        lines.append("|---|---|")
        for status in STATUSES:
            if counts.get(status):
                lines.append("| %s %s | %d |" % (STATUS_ICON.get(status, ""), status, counts[status]))
        lines.append("")

    for status in STATUSES:
        group = [r for r in records if r.get("status") == status]
        if not group:
            continue
        lines.append("## %s %s（%d）" % (STATUS_ICON.get(status, ""), status, len(group)))
        lines.append("")
        for record in group:
            lines.append("### %s  %s" % (record["id"], record.get("title", "")))
            lines.append("")
            lines.append("- 严重度：%s" % record.get("severity", "-"))
            lines.append("- 场景：%s" % (record.get("scenario") or "-"))
            if record.get("expected"):
                lines.append("- 期望：%s" % record["expected"])
            if record.get("actual"):
                lines.append("- 实际：%s" % record["actual"])
            evidence = record.get("evidence") or {}
            if evidence.get("bag"):
                lines.append("- 证据包：`%s`" % evidence["bag"])
            if evidence.get("run"):
                lines.append("- 测试轮次：`%s`" % evidence["run"])
            verifications = record.get("verification") or []
            if verifications:
                last = verifications[-1]
                lines.append("- 最近验证：%s（%s，总分 %s）" % (
                    last.get("scenario_pass", "-"), last.get("at", ""),
                    last.get("total_score", "-")))
            lines.append("")

    text = "\n".join(lines) + "\n"
    with io.open(out_path, "w", encoding="utf-8") as handle:
        handle.write(text)
    print(text)
    print("已写入: %s" % out_path)
    return 0


def main(argv=None):
    ensure_utf8_stdio()
    sys.argv = fix_argv()

    parser = argparse.ArgumentParser(description="Apollo 缺陷记录与闭环")
    parser.add_argument("--config", default=default_config_path())
    sub = parser.add_subparsers(dest="command")

    p_new = sub.add_parser("new", help="登记一个缺陷")
    p_new.add_argument("--title", required=True)
    p_new.add_argument("--severity", choices=SEVERITIES)
    p_new.add_argument("--status", choices=STATUSES)
    p_new.add_argument("--scenario")
    p_new.add_argument("--env")
    p_new.add_argument("--expected")
    p_new.add_argument("--actual")
    p_new.add_argument("--steps")
    p_new.add_argument("--bag")
    p_new.add_argument("--run")
    p_new.add_argument("--grading-log", dest="grading_log")
    p_new.add_argument("--note")

    p_list = sub.add_parser("list", help="列出缺陷")
    p_list.add_argument("--status", choices=STATUSES)
    p_list.add_argument("--severity", choices=SEVERITIES)
    p_list.add_argument("--scenario")
    p_list.add_argument("--json", action="store_true")

    p_show = sub.add_parser("show", help="查看一个缺陷")
    p_show.add_argument("defect_id")

    p_update = sub.add_parser("update", help="更新状态/严重度/证据")
    p_update.add_argument("defect_id")
    p_update.add_argument("--status", choices=STATUSES)
    p_update.add_argument("--severity", choices=SEVERITIES)
    p_update.add_argument("--note")
    p_update.add_argument("--add-bag", dest="add_bag")
    p_update.add_argument("--scenario", help="补上/修改关联场景号")
    p_update.add_argument("--title")
    p_update.add_argument("--expected")
    p_update.add_argument("--actual")
    p_update.add_argument("--steps")
    p_update.add_argument("--add-run", dest="add_run")

    p_verify = sub.add_parser("verify", help="用批量测试结果验证缺陷是否已修复")
    p_verify.add_argument("defect_id")
    p_verify.add_argument("--run", help="指定测试轮次目录；默认取最新一轮")
    p_verify.add_argument("--note")

    p_report = sub.add_parser("report", help="生成缺陷清单报告")
    p_report.add_argument("--out")
    p_report.add_argument("--out-dir", dest="out_dir")

    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 2

    try:
        cfg = load_config(args.config)
        handler = {
            "new": cmd_new, "list": cmd_list, "show": cmd_show,
            "update": cmd_update, "verify": cmd_verify, "report": cmd_report,
        }[args.command]
        return handler(cfg, args)
    except (RuntimeError, IOError, OSError, ValueError) as exc:
        print("错误: %s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
