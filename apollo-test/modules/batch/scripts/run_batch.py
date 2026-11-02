#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量测试执行器：批量跑场景 → 自动录包 → 调用评分引擎 → 汇总成表。

设计约束（重要，别在这里加评分/录包逻辑）：

  1. 不实现评分。一律 subprocess 调用 apollo-eval 的
     scripts/grading_system_py/main.py，保证评分口径只有一处。
  2. 不实现录包。一律调用 apollo-test 的
     scripts/record_apollo_channels.sh（它内部用 cyber_recorder）。
  3. 不写死机器路径。全部来自 config.yaml，可被命令行覆盖。

仿真启动支持三种模式（config: sim.mode）：

  command  用 sim.command 模板起仿真（{scenario} 等占位符会被替换），等它退出
  manual   由人在 DreamView 里点 SimControl；本脚本轮询 output bag 出现/更新后继续
  none     不起仿真，假设 bag 已经存在（只做评分与汇总）

用法示例：

  python3 run_batch.py --tag baseline --scenarios 1,2,3
  python3 run_batch.py --tag v2 --scenarios 1-5 --sim-mode command
  python3 run_batch.py --tag dry --scenarios 1,2 --dry-run
"""

from __future__ import print_function

import argparse
import csv
import datetime
import io
import os
import re
import signal
import subprocess
import sys
import time

try:
    import yaml
except ImportError:
    yaml = None


DEFAULT_CONFIG = {
    "paths": {
        "workspace": "/apollo_workspace",
        "metric_dir": "/apollo_workspace/metric",
        "scenario_input_dir": "/apollo-simulator/input_data",
        "scenario_output_dir": "/apollo-simulator/output_data",
        "run_root": "/apollo_workspace/data/test_runs",
        "record_root": "/apollo_workspace/data/record/apollo_channels",
    },
    "sim": {
        "mode": "manual",
        "command": "",
        "timeout_s": 900,
        "bag_settle_s": 5,
    },
    "record": {
        "enabled": True,
        "profile": "pnc",
        "stop_grace_s": 5,
    },
    "eval": {
        "interval": 0.1,
    },
    "skills": {
        "test_scripts": "",
        "eval_scripts": "",
    },
}

GRADING_ROW = re.compile(r"^\s{2}(\S+)\s+(PASS|FAIL)\s+(\d+)\s+(\d+)\s*/\s*(\d+)\s*$")
SCENARIO_LINE = re.compile(r"Scenario:\s*(PASS|FAIL)", re.IGNORECASE)


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
            raise RuntimeError("需要 PyYAML 才能读取 %s（pip install pyyaml）" % path)
        with io.open(path, "r", encoding="utf-8") as handle:
            cfg = deep_merge(cfg, yaml.safe_load(handle) or {})
    return cfg


def find_skills_root(start):
    """从当前文件往上找到「skills 根目录」（即同时含 apollo-test / apollo-eval 的那层）。

    重构后本脚本位于 <skills>/apollo-test/modules/batch/scripts/，
    不再是 <skills>/apollo-test-batch/scripts/，所以不能再按固定层级推断。
    """
    cur = os.path.abspath(start)
    for _ in range(8):
        if (os.path.isdir(os.path.join(cur, "apollo-test"))
                or os.path.isdir(os.path.join(cur, "apollo-eval"))):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return None


def skill_script_dir(cfg, which, skill_name):
    """定位某个 skill 的 scripts 目录。配置优先，其次从自身位置向上找 skills 根。"""
    configured = (cfg.get("skills") or {}).get("%s_scripts" % which) or ""
    if configured:
        if not os.path.isdir(configured):
            raise RuntimeError("config 指定的 %s_scripts 不存在: %s" % (which, configured))
        return configured

    here = os.path.dirname(os.path.abspath(__file__))
    candidates = []

    root = find_skills_root(here)
    if root:
        candidates.append(os.path.join(root, skill_name, "scripts"))

    dsh_home = os.environ.get("DSH_HOME", os.path.expanduser("~/.dsh"))
    candidates.extend([
        os.path.join(dsh_home, "skills", skill_name, "scripts"),
        os.path.join(os.path.expanduser("~/.dsh"), "skills", skill_name, "scripts"),
        os.path.join("/apollo_workspace/.dsh/skills", skill_name, "scripts"),
    ])

    for candidate in candidates:
        resolved = os.path.realpath(candidate)
        if os.path.isdir(resolved):
            return resolved
    raise RuntimeError(
        "找不到 %s 的 scripts 目录。请在 config.yaml 里显式设置 skills.%s_scripts" % (skill_name, which)
    )


def parse_ids(spec):
    """支持 '1,2,3'、'1-5'、'1-3,7' 三种写法。"""
    ids = []
    for chunk in (spec or "").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            start, end = chunk.split("-", 1)
            ids.extend([str(i) for i in range(int(start), int(end) + 1)])
        else:
            ids.append(chunk)
    if not ids:
        raise RuntimeError("没有解析到场景编号，检查 --scenarios")
    return ids


def parse_grading(stdout):
    """从评分引擎的文本输出里取出结构化结果。"""
    result = {"scenario_pass": None, "metrics": {}, "total_score": None}
    for line in stdout.splitlines():
        match = SCENARIO_LINE.search(line)
        if match:
            result["scenario_pass"] = match.group(1).upper() == "PASS"
            continue
        match = GRADING_ROW.match(line)
        if match:
            name, status, score, fail, total = match.groups()
            result["metrics"][name] = {
                "status": status,
                "score": int(score),
                "fail": int(fail),
                "total": int(total),
            }
    if result["metrics"]:
        scores = [info["score"] for info in result["metrics"].values()]
        result["total_score"] = round(sum(scores) / float(len(scores)), 1)
    return result


def sh(cmd, cwd=None, timeout=None, env=None):
    proc = subprocess.Popen(
        cmd, cwd=cwd, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        universal_newlines=True,
    )
    try:
        out, _ = proc.communicate(timeout=timeout) if timeout else proc.communicate()
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate()
        return 124, out or "", True
    return proc.returncode, out or "", False


def newest_record(root):
    if not os.path.isdir(root):
        return None
    best = None
    for name in os.listdir(root):
        path = os.path.join(root, name)
        if os.path.isdir(path) and (best is None or os.path.getmtime(path) > best[1]):
            best = (path, os.path.getmtime(path))
    return best[0] if best else None


def start_record(cfg, tag, desc, log_path):
    test_scripts = skill_script_dir(cfg, "test", "apollo-test")
    script = os.path.join(test_scripts, "record_apollo_channels.sh")
    if not os.path.isfile(script):
        raise RuntimeError("找不到录包脚本: %s" % script)

    profile = (cfg.get("record") or {}).get("profile", "pnc")
    record_root = (cfg.get("paths") or {}).get("record_root", "")
    env = dict(os.environ)
    if record_root:
        env["APOLLO_RECORD_DIR"] = record_root

    log = io.open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(
        ["bash", script, tag, desc, profile],
        stdout=log, stderr=subprocess.STDOUT,
        env=env, start_new_session=True, universal_newlines=True,
    )
    time.sleep(2.0)  # 让 cyber_recorder 把目录建起来
    return proc, log


def stop_record(cfg, proc, log):
    grace = float((cfg.get("record") or {}).get("stop_grace_s", 5))
    if proc.poll() is not None:
        log.close()
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGINT)
    except OSError:
        pass
    deadline = time.time() + grace
    while time.time() < deadline and proc.poll() is None:
        time.sleep(0.2)
    if proc.poll() is None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except OSError:
            pass
    proc.wait()
    log.close()


def wait_for_bag(bag_path, timeout_s, settle_s):
    """manual 模式：等 bag 文件出现并停止增长。"""
    deadline = time.time() + float(timeout_s)
    while time.time() < deadline:
        if os.path.isfile(bag_path):
            first = os.path.getsize(bag_path)
            time.sleep(float(settle_s))
            if os.path.getsize(bag_path) == first and first > 0:
                return True
        time.sleep(2.0)
    return False


def run_sim(cfg, scenario_id, scenario_json, bag_path, out_dir):
    sim = cfg.get("sim") or {}
    mode = (sim.get("mode") or "manual").lower()
    timeout_s = float(sim.get("timeout_s", 900))

    if mode == "none":
        return 0, "sim 跳过（mode=none）"

    if mode == "command":
        template = sim.get("command") or ""
        if not template:
            raise RuntimeError("sim.mode=command 但没有配置 sim.command")
        command = (template
                   .replace("{scenario}", scenario_id)
                   .replace("{scenario_json}", scenario_json or "")
                   .replace("{output_dir}", out_dir or "")
                   .replace("{bag}", bag_path or ""))
        code, out, timeout = sh(["bash", "-lc", command], timeout=timeout_s)
        tail = "\n".join(out.strip().splitlines()[-5:])
        if timeout:
            return 124, "sim 超时 %ss\n%s" % (timeout_s, tail)
        return code, tail

    # manual：等人跑完，靠 bag 落盘判断
    print("    ⏸  manual 模式：请在 DreamView 里跑场景 %s（等待 bag 落盘，最多 %ds）"
          % (scenario_id, int(timeout_s)))
    if wait_for_bag(bag_path, timeout_s, sim.get("bag_settle_s", 5)):
        return 0, "manual: bag 已就绪"
    return 1, "manual: 等 bag 超时"


def score_scenario(cfg, scenario_id, metric_json, scenario_json, bag_path):
    eval_scripts = skill_script_dir(cfg, "eval", "apollo-eval")
    entry = os.path.join(eval_scripts, "grading_system_py", "main.py")
    if not os.path.isfile(entry):
        raise RuntimeError("找不到评分入口: %s" % entry)

    env = dict(os.environ)
    extra = [eval_scripts, "/opt/apollo/neo/python"]
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = ":".join([p for p in extra + [existing] if p])
    env["PYTHONIOENCODING"] = "utf-8"

    cmd = [
        sys.executable, entry,
        "--config", metric_json,
        "--scenario", scenario_json,
        "--mode", "bag",
        "--bag_file", bag_path,
    ]
    interval = (cfg.get("eval") or {}).get("interval")
    if interval:
        cmd.extend(["--interval", str(interval)])

    code, out, timeout = sh(cmd, env=env)
    return code, out, timeout


def main(argv=None):
    ensure_utf8_stdio()
    sys.argv = fix_argv()
    parser = argparse.ArgumentParser(description="批量跑场景 + 录包 + 评分 + 汇总")
    parser.add_argument("--config", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.yaml"))
    parser.add_argument("--scenarios", required=True, help="场景编号，如 1,2,3 或 1-5")
    parser.add_argument("--tag", required=True, help="本次测试标签，如 baseline / v2")
    parser.add_argument("--sim-mode", choices=["command", "manual", "none"], default=None)
    parser.add_argument("--no-record", action="store_true", help="不录包，只用已有 bag")
    parser.add_argument("--dry-run", action="store_true", help="只检查前置条件，不执行")
    parser.add_argument("--keep-going", action="store_true", help="单个场景失败也继续后面的")
    parser.add_argument("--desc", default="", help="写进录包 manifest 的描述")
    args = parser.parse_args(argv)

    cfg = load_config(args.config)
    if args.sim_mode:
        cfg.setdefault("sim", {})["mode"] = args.sim_mode
    if args.no_record:
        cfg.setdefault("record", {})["enabled"] = False

    paths = cfg.get("paths") or {}
    metric_dir = paths.get("metric_dir", "")
    input_dir = paths.get("scenario_input_dir", "")
    output_dir = paths.get("scenario_output_dir", "")
    run_root = paths.get("run_root", "")
    record_root = paths.get("record_root", "")

    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = os.path.join(run_root, "%s_%s" % (args.tag, stamp))

    print("=" * 68)
    print("批量测试: tag=%s  场景=%s" % (args.tag, args.scenarios))
    print("  metric   : %s" % metric_dir)
    print("  scenario : %s" % input_dir)
    print("  bag      : %s" % output_dir)
    print("  sim.mode : %s" % (cfg.get("sim") or {}).get("mode"))
    print("  record   : %s" % ("on (profile=%s)" % (cfg.get("record") or {}).get("profile")
                               if (cfg.get("record") or {}).get("enabled") else "off"))
    print("  run_dir  : %s" % run_dir)
    print("=" * 68)

    scenario_ids = parse_ids(args.scenarios)

    # 前置检查
    problems = []
    for scenario in scenario_ids:
        metric_json = os.path.join(metric_dir, "%s.json" % scenario)
        scenario_json = os.path.join(input_dir, "%s.json" % scenario)
        bag_path = os.path.join(output_dir, scenario, "%s.output.bag" % scenario)
        if not os.path.isfile(metric_json):
            problems.append("缺 metric: %s" % metric_json)
        if not os.path.isfile(scenario_json):
            problems.append("缺 scenario: %s" % scenario_json)
        if (cfg.get("sim") or {}).get("mode") == "none" and not os.path.isfile(bag_path):
            problems.append("缺 bag: %s" % bag_path)

    if problems:
        print("\n前置检查发现问题：")
        for item in problems:
            print("  - %s" % item)
        if args.dry_run:
            print("\n（dry-run 结束，未执行）")
            return 1
        print("\n提示：路径可用 config.yaml 的 paths.* 覆盖，或先补齐数据。")

    if args.dry_run:
        print("\n前置检查通过，未执行（dry-run）。")
        return 0

    os.makedirs(run_dir)
    logs_dir = os.path.join(run_dir, "logs")
    os.makedirs(logs_dir)

    rows = []
    for scenario in scenario_ids:
        metric_json = os.path.join(metric_dir, "%s.json" % scenario)
        scenario_json = os.path.join(input_dir, "%s.json" % scenario)
        out_dir = os.path.join(output_dir, scenario)
        bag_path = os.path.join(out_dir, "%s.output.bag" % scenario)

        info = {
            "scenario": scenario,
            "status": "",
            "scenario_pass": "",
            "total_score": "",
            "metric_fail": "",
            "metric_total": "",
            "bag": bag_path,
            "note": "",
        }

        print("\n--- 场景 %s ---" % scenario)
        record_proc = None
        record_log = None
        try:
            if (cfg.get("record") or {}).get("enabled"):
                log_path = os.path.join(logs_dir, "%s.record.log" % scenario)
                record_proc, record_log = start_record(
                    cfg, "%s_s%s" % (args.tag, scenario),
                    args.desc or ("批量测试 %s 场景 %s" % (args.tag, scenario)),
                    log_path)
                print("    录包已启动 (pid=%s)" % record_proc.pid)

            code, note = run_sim(cfg, scenario, scenario_json, bag_path, out_dir)
            info["note"] = note
            if code != 0 and not os.path.isfile(bag_path):
                raise RuntimeError("仿真未完成且没有产出 bag（%s）" % note)

        except Exception as exc:  # noqa: BLE001 - 单场景失败要记录下来继续
            info["status"] = "sim_failed"
            info["note"] = str(exc)
            print("    ✗ 仿真阶段失败: %s" % exc)
        finally:
            if record_proc is not None:
                stop_record(cfg, record_proc, record_log)
                print("    录包已停止")

        if info["status"] != "sim_failed":
            if not os.path.isfile(bag_path):
                info["status"] = "no_bag"
                info["note"] = "没有找到 %s" % bag_path
                print("    ✗ 没有找到 bag: %s" % bag_path)
            else:
                print("    评分中…")
                code, out, timeout = score_scenario(
                    cfg, scenario, metric_json, scenario_json, bag_path)
                grading_log = os.path.join(logs_dir, "%s.grading.log" % scenario)
                with io.open(grading_log, "w", encoding="utf-8") as handle:
                    handle.write(out)
                if timeout:
                    info["status"] = "grading_timeout"
                    info["note"] = "评分超时"
                    print("    ✗ 评分超时")
                else:
                    parsed = parse_grading(out)
                    if not parsed["metrics"]:
                        info["status"] = "grading_failed"
                        info["note"] = "评分输出无法解析（exit=%s），见 %s" % (code, grading_log)
                        print("    ✗ 评分输出无法解析，exit=%s" % code)
                    else:
                        info["status"] = "ok"
                        info["scenario_pass"] = "PASS" if parsed["scenario_pass"] else "FAIL"
                        info["total_score"] = parsed["total_score"]
                        failed = [n for n, m in parsed["metrics"].items() if m["status"] == "FAIL"]
                        info["metric_fail"] = len(failed)
                        info["metric_total"] = len(parsed["metrics"])
                        print("    %s  总分 %s  未通过指标 %s/%s  %s" % (
                            info["scenario_pass"], info["total_score"],
                            len(failed), len(parsed["metrics"]),
                            (",".join(failed[:4]) + ("…" if len(failed) > 4 else "")) if failed else ""))

        rows.append(info)
        if info["status"] != "ok" and not args.keep_going:
            print("\n单场景失败且未指定 --keep-going，终止后续场景。")
            break

    # 汇总
    summary_csv = os.path.join(run_dir, "summary.csv")
    fields = ["scenario", "status", "scenario_pass", "total_score",
              "metric_fail", "metric_total", "bag", "note"]
    with io.open(summary_csv, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fields})

    ok_rows = [r for r in rows if r["status"] == "ok"]
    passed = [r for r in ok_rows if r["scenario_pass"] == "PASS"]
    scores = [float(r["total_score"]) for r in ok_rows if r["total_score"] != ""]
    avg = round(sum(scores) / len(scores), 1) if scores else None

    summary_md = os.path.join(run_dir, "summary.md")
    with io.open(summary_md, "w", encoding="utf-8") as handle:
        handle.write("# 批量测试报告：%s\n\n" % args.tag)
        handle.write("- 时间：%s\n" % stamp)
        handle.write("- 场景数：%d（成功评分 %d，通过 %d）\n" % (len(rows), len(ok_rows), len(passed)))
        if avg is not None:
            handle.write("- 平均分：%s\n" % avg)
        handle.write("\n| 场景 | 结论 | 总分 | 未通过指标 | 备注 |\n")
        handle.write("|---|---|---|---|---|\n")
        for row in rows:
            handle.write("| %s | %s | %s | %s/%s | %s |\n" % (
                row["scenario"], row["scenario_pass"] or row["status"],
                row["total_score"], row["metric_fail"], row["metric_total"],
                (row["note"] or "").replace("|", "/")[:60]))

    print("\n" + "=" * 68)
    print("完成：成功评分 %d/%d，通过 %d" % (len(ok_rows), len(rows), len(passed)))
    if avg is not None:
        print("平均分: %s" % avg)
    print("  summary.csv : %s" % summary_csv)
    print("  summary.md  : %s" % summary_md)
    print("  logs/       : %s" % logs_dir)
    print("=" * 68)
    return 0 if len(ok_rows) == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
