#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""两轮批量测试的回归对比。

对比 run_batch.py 产出的 summary.csv，按场景逐行给出：
分数变化、是否通过、以及「变好 / 变差 / 持平 / 新增 / 缺失」的判定。

用法：

  python3 compare_runs.py runs/baseline_20261029_101500 runs/v2_20261029_140000
  python3 compare_runs.py A/summary.csv B/summary.csv --out /tmp/cmp
"""

from __future__ import print_function

import argparse
import csv
import io
import os
import sys


def ensure_utf8_stdio():
    """某些目标机 locale 是 C/ASCII，直接 print 中文会 UnicodeEncodeError。
    这里把 stdout/stderr 换成 UTF-8，避免依赖外部设置 PYTHONIOENCODING。"""
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

def load_summary(path):
    if os.path.isdir(path):
        path = os.path.join(path, "summary.csv")
    if not os.path.isfile(path):
        raise RuntimeError("找不到 summary.csv: %s" % path)
    rows = {}
    with io.open(path, "r", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            rows[row["scenario"]] = row
    return rows, path


def as_score(row):
    if not row:
        return None
    value = (row.get("total_score") or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def verdict(old_row, new_row, delta):
    if old_row is None:
        return "新增"
    if new_row is None:
        return "缺失"

    old_pass = old_row.get("scenario_pass") == "PASS"
    new_pass = new_row.get("scenario_pass") == "PASS"
    old_ok = old_row.get("status") == "ok"
    new_ok = new_row.get("status") == "ok"

    if not new_ok and old_ok:
        return "执行失败 ❌"
    if not old_ok and new_ok:
        return "恢复执行 ✅"
    if old_pass and not new_pass:
        return "由通过变未通过 ❌"
    if not old_pass and new_pass:
        return "由未通过变通过 ✅"
    if delta is None:
        return "持平"
    if delta > 0.05:
        return "分数改善 ✅"
    if delta < -0.05:
        return "分数下降 ❌"
    return "持平"


def main(argv=None):
    ensure_utf8_stdio()
    sys.argv = fix_argv()
    parser = argparse.ArgumentParser(description="对比两轮批量测试结果")
    parser.add_argument("baseline", help="基线 run 目录或 summary.csv")
    parser.add_argument("candidate", help="待比较 run 目录或 summary.csv")
    parser.add_argument("--out", default="", help="输出目录（默认放在 candidate 旁边）")
    args = parser.parse_args(argv)

    try:
        old_rows, old_path = load_summary(args.baseline)
        new_rows, new_path = load_summary(args.candidate)
    except RuntimeError as exc:
        print("错误: %s" % exc, file=sys.stderr)
        return 2

    scenarios = sorted(set(old_rows) | set(new_rows), key=lambda s: (len(s), s))

    out_dir = args.out or os.path.dirname(os.path.abspath(new_path))
    if not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    out_csv = os.path.join(out_dir, "compare.csv")
    out_md = os.path.join(out_dir, "compare.md")

    records = []
    worse = 0
    better = 0
    for scenario in scenarios:
        old_row = old_rows.get(scenario)
        new_row = new_rows.get(scenario)
        old_score = as_score(old_row)
        new_score = as_score(new_row)
        delta = None
        if old_score is not None and new_score is not None:
            delta = round(new_score - old_score, 1)
        tag = verdict(old_row, new_row, delta)
        if "❌" in tag:
            worse += 1
        elif "✅" in tag:
            better += 1
        records.append({
            "scenario": scenario,
            "baseline_pass": (old_row or {}).get("scenario_pass", "-") or "-",
            "candidate_pass": (new_row or {}).get("scenario_pass", "-") or "-",
            "baseline_score": "" if old_score is None else old_score,
            "candidate_score": "" if new_score is None else new_score,
            "delta": "" if delta is None else delta,
            "verdict": tag,
        })

    fields = ["scenario", "baseline_pass", "candidate_pass",
              "baseline_score", "candidate_score", "delta", "verdict"]
    with io.open(out_csv, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for record in records:
            writer.writerow(record)

    old_avg = [r for r in (as_score(row) for row in old_rows.values()) if r is not None]
    new_avg = [r for r in (as_score(row) for row in new_rows.values()) if r is not None]
    avg_old = round(sum(old_avg) / len(old_avg), 1) if old_avg else None
    avg_new = round(sum(new_avg) / len(new_avg), 1) if new_avg else None

    lines = []
    lines.append("# 回归对比")
    lines.append("")
    lines.append("- 基线：`%s`" % old_path)
    lines.append("- 对比：`%s`" % new_path)
    if avg_old is not None and avg_new is not None:
        lines.append("- 平均分：%s → %s（%+0.1f）" % (avg_old, avg_new, avg_new - avg_old))
    lines.append("- 改善 %d 项，变差 %d 项，共 %d 个场景" % (better, worse, len(records)))
    lines.append("")
    lines.append("| 场景 | 基线 | 对比 | 分数变化 | 判定 |")
    lines.append("|---|---|---|---|---|")
    for record in records:
        delta_text = "" if record["delta"] == "" else "%+0.1f" % record["delta"]
        lines.append("| %s | %s (%s) | %s (%s) | %s | %s |" % (
            record["scenario"], record["baseline_pass"], record["baseline_score"],
            record["candidate_pass"], record["candidate_score"],
            delta_text, record["verdict"]))

    report = "\n".join(lines) + "\n"
    with io.open(out_md, "w", encoding="utf-8") as handle:
        handle.write(report)

    print(report)
    print("已写入:")
    print("  %s" % out_csv)
    print("  %s" % out_md)
    return 0 if worse == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
