#!/usr/bin/env bash
# apollo-env 统一命令入口
# 用法: apollo-env.sh <subcommand> [args]
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"  # skills 根目录

RED='\033[0;31m'; NC='\033[0m'
die() { echo -e "${RED}❌ $1${NC}" >&2; exit "${2:-1}"; }

usage() {
    cat <<'EOF'
apollo-env 统一命令入口

用法: apollo-env.sh <subcommand> [args]

子命令:
  targets                             列出已注册的车辆/工程目标
  current [--json]                    自动检测当前目标（current 指纹 + 版本）
  plan [--target auto] --scope <full|sensor|module> [--module NAME] [--json]
                                      非交互生成恢复计划；可用 --output 保存
  execute --plan <plan.json>          重新校验计划，默认仍为 dry-run
                                      实施需 --apply --confirm-plan <PLAN_ID>
  report --target <ID>                轻量报告：版本、软链、指纹、归档 SHA
  restore --target <ID> [--dry-run]   兼容入口：对比并恢复参数+代码
  rollback --backup <目录>             从备份目录回滚参数和代码
  check                               环境检测
  gnss check [--conf <file>]          检查 NTRIP 基站连接、认证和 RTCM
  gnss configure [--conf <file>]      交互配置 NTRIP 基站
  lidar list                          列出支持的激光雷达型号
  lidar check [--model <型号>]        检查雷达配置、网段、channel/frame_id 关联
  lidar configure [--model <型号>]    交互配置雷达（IP/端口/frame_id/channel）
  baseline create --target <ID> [--dry-run]  新建车型基线
  baseline list                       列出已有基线
  stamp <scan|verify|stamp|hash> ...  车型指纹操作
  install                             打印安装引导步骤
  diagnose                            环境检测并提示 FAQ 检索位置
  clean [--dry-run|--yes]             清理存储：录包/core/非 .INFO 日志（先 --dry-run 预览，再 --yes 执行）
  help                                显示本帮助
EOF
}

# ---- 插件路由（读 plugins.yaml 动态分发）----
PLUGINS="$BASE_DIR/plugins.yaml"

resolve_route() {
    local cmd="$1" sub="${2:-}"
    python3 - "$PLUGINS" "$cmd" "$sub" <<'PY'
import sys, yaml
pl = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
cmd = sys.argv[2]
sub = sys.argv[3] if len(sys.argv) > 3 else ""
routes = pl.get("routes", {})
r = routes.get(cmd)
if r is None:
    print("NOTFOUND"); sys.exit(0)
if "sub" in r:
    s = r["sub"].get(sub, {})
    if not s:
        print("NOTFOUND"); sys.exit(0)
    print("run:" + r["skill"] + ":" + s.get("run", "")); sys.exit(0)
print("run:" + r["skill"] + ":" + r.get("run", ""))
PY
}

run_route() {
    local route="$1"; shift || true
    local rest="${route#run:}"
    local skill="${rest%%:*}"
    local handler="${rest#*:}"
    # handler 可能是 "scripts/xxx.py detect"（带内置子命令）
    local script="${handler%% *}"
    local builtin_args="${handler#* }"
    [[ "$builtin_args" == "$handler" ]] && builtin_args=""
      # 4-skill 布局：子能力在 <parent>/modules/<mod>/ 下，不再是顶层 skill。
      # 先按旧布局找（兼容），找不到再按模块布局找。
      local path="$SKILLS_DIR/$skill/$script"
      if [[ ! -e "$path" ]]; then
          local parent="" mod=""
          case "$skill" in
              apollo-env-check)       parent=apollo-env; mod=env-check ;;
              apollo-install)         parent=apollo-env; mod=install ;;
              apollo-vehicle-restore) parent=apollo-env; mod=vehicle-restore ;;
              apollo-vehicle-usage)   parent=apollo-env; mod=vehicle-usage ;;
              apollo-gnss-config)     parent=apollo-env; mod=gnss-config ;;
              apollo-lidar-config)    parent=apollo-env; mod=lidar-config ;;
              apollo-camera-config)   parent=apollo-env; mod=camera-config ;;
          esac
          if [[ -n "$parent" ]]; then
              local cand="$SKILLS_DIR/$parent/modules/$mod/$script"
              [[ -e "$cand" ]] && path="$cand"
          fi
      fi
    [[ -e "$path" ]] || die "插件脚本不存在: $path"
    if [[ "$path" == *.py ]]; then
        python3 "$path" $builtin_args "$@"
    else
        bash "$path" $builtin_args "$@"
    fi
}

# ---- 主分发 ----
cmd="${1:-help}"; shift || true
case "$cmd" in
    help|-h|--help) usage ;;
    *)
        sub=""
        if [[ "$cmd" == "gnss" || "$cmd" == "lidar" || "$cmd" == "camera" || "$cmd" == "baseline" ]]; then
            sub="${1:-}"; [[ -n "$sub" ]] && shift || true
        fi
        route="$(resolve_route "$cmd" "$sub")"
        if [[ "$route" == "NOTFOUND" ]]; then
            usage; exit 2
        fi
        run_route "$route" "$@"
        ;;
esac
