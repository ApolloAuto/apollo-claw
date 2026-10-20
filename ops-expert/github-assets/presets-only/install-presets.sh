#!/usr/bin/env bash
# 安装 Apollo 运维工程师 / 开发工程师 两个 DSH agent 预设到目标机器。
#
# 用法：
#   ./install-presets.sh                      # 两个都装
#   ./install-presets.sh apollo-env           # 只装运维
#   ./install-presets.sh apollo-dev           # 只装开发
#   ./install-presets.sh --default apollo-env # 装完把该预设设为默认
#
# 环境变量：
#   DSH_HOME   DSH 数据目录，默认 ~/.dsh
#   DSH_PROFILE  目标 profile，默认 web
#
# 原理：预设 = $DSH_HOME/.agent-presets/<id>/ 下的目录（agent.cordis.yml +
# preset.yml[ + 自带 .mjs]）。但当前 DSH（0.2.x）不会自动扫描该目录，所以本脚本
# 装完还会把每个 agent.cordis.yml 作为 @deepseek-ai/dsh-agent-preset 行内联接进
# $DSH_HOME/profiles/$DSH_PROFILE/cordis.patch.yml。重启 dsh / 新开会话后，预设
# 选择器里就能看到；设 default 则默认用它。
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${DSH_PROFILE:-web}"
DEST="$DSH_HOME_DIR/.agent-presets"

DEFAULT_ID=""
SELECTED=()
while [ $# -gt 0 ]; do
  case "$1" in
    --default) DEFAULT_ID="${2:-}"; shift 2 ;;
    apollo-env|apollo-dev) SELECTED+=("$1"); shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done
[ ${#SELECTED[@]} -eq 0 ] && SELECTED=(apollo-env apollo-dev)

# ── 迁移前置校验：避免把“能解析但运行时必失败”的预设装进去 ────────────────
for id in "${SELECTED[@]}"; do
  SRC_PRESET="$SRC/$id"
  [ -f "$SRC_PRESET/agent.cordis.yml" ] || { echo "错误：缺少 $SRC_PRESET/agent.cordis.yml" >&2; exit 1; }
  # DSH 0.2.x 的 dsh-persona schema 要求 prefix，旧字段 text 会导致“加载失败”。
  grep -qE '^    prefix:\s*\|-?' "$SRC_PRESET/agent.cordis.yml" \
    || { echo "错误：$id 的 persona 缺少 config.prefix（当前 DSH 不接受 config.text）" >&2; exit 1; }
  if grep -q "dsh-workflow-worker-thread" "$SRC_PRESET/agent.cordis.yml"; then
    echo "错误：$id 仍引用不存在的 dsh-workflow-worker-thread，请改用 dsh-workflow-ptc" >&2
    exit 1
  fi
done

mkdir -p "$DEST"
for id in "${SELECTED[@]}"; do
  [ -d "$SRC/$id" ] || { echo "错误：源目录缺失 $SRC/$id" >&2; exit 1; }
  if [ -e "$DEST/$id" ]; then
    bak="$DEST/$id.bak.$(date +%Y%m%d%H%M%S)"
    mv "$DEST/$id" "$bak"
    echo "已备份原有 $id -> $bak"
  fi
  cp -R "$SRC/$id" "$DEST/$id"
  echo "已安装预设: $id -> $DEST/$id"
done

# ── 生成每个预设的「skill 作用域视图」(skills-view/) ──────────────────────────
# 全部 21 个 skill 仍在 $DSH_HOME/skills（标准模式读全部、apollo-ops 插件也用它）。
# 这里为每个预设造一个只含本角色 skill 的目录，里面是指向 $DSH_HOME/skills/<name>
# 的符号链接（在目标机现场生成，迁移安全；DSH 的两条发现路径都跟随符号链接目录）。
# 预设的 skill-filesystem 用 includeDefaultRoots=false + 只扫这个视图 → 角色隔离，
# 且完全不动 $DSH_HOME/skills，所以标准模式与插件都不受影响。
OPS_SKILLS="apollo-env apollo-env-check apollo-install apollo-vehicle-restore apollo-vehicle-usage apollo-gnss-config apollo-lidar-config apollo-camera-config"
DEV_SKILLS="apollo-dev apollo-architecture apollo-build-test apollo-debug apollo-new-component apollo-plugin-dev apollo-planning-dev apollo-control-dev apollo-perception-dev apollo-localization-dev apollo-gnss-driver apollo-hmi-dev apollo-vehicle-sensor"
SKILLS_ROOT="$DSH_HOME_DIR/skills"
make_view() {
  local preset_id="$1"; shift
  local view="$DEST/$preset_id/skills-view"
  rm -rf "$view"; mkdir -p "$view"
  local n=0 miss=""
  for s in "$@"; do
    if [ -d "$SKILLS_ROOT/$s" ]; then
      ln -s "$SKILLS_ROOT/$s" "$view/$s"; n=$((n+1))
    else
      miss="$miss $s"
    fi
  done
  echo "已建作用域视图: $preset_id/skills-view（$n 个 skill 符号链接）"
  [ -n "$miss" ] && printf '\033[1;33m⚠️  %s 视图缺少（%s/skills 下没有）:%s\033[0m\n' "$preset_id" "$DSH_HOME_DIR" "$miss"
  return 0
}
for id in "${SELECTED[@]}"; do
  case "$id" in
    apollo-env) make_view apollo-env $OPS_SKILLS ;;
    apollo-dev) make_view apollo-dev $DEV_SKILLS ;;
  esac
done

# ── 把预设接进 profile 的 cordis.patch.yml ────────────────────────────────────
# 关键：当前 DSH（0.2.x）并不会自动扫描 $DSH_HOME/.agent-presets/，预设只能作为
# cordis loader 行（@deepseek-ai/dsh-agent-preset）出现在 profile 组合里才会被加载。
# 内置预设（standard/cordis/ptc/minimal）由 dsh-web-app 的 bundle patch 带入；自定义
# 预设必须在这里把每个 agent.cordis.yml 内联进 profile 的 cordis.patch.yml。
# 只拷贝到 .agent-presets 而不接线 = 预设选择器里永远看不到——这正是之前“没装上”的原因。
PATCH="$DSH_HOME_DIR/profiles/$PROFILE/cordis.patch.yml"
if [ ! -f "$PATCH" ]; then
  printf '\033[1;33m⚠️  未找到 %s：先装插件/skills（会初始化 profile）再装预设。跳过接线。\033[0m\n' "$PATCH"
else
  cp "$PATCH" "$PATCH.bak.$(date +%Y%m%d%H%M%S)"
  PYTHONIOENCODING=utf-8 DSH_HOME="$DSH_HOME_DIR" DSH_PROFILE="$PROFILE" DEST="$DEST" \
  PRESETS="${SELECTED[*]}" python3 - <<'PY'
import os, re, sys

DSH_HOME = os.environ["DSH_HOME"]
PROFILE  = os.environ["DSH_PROFILE"]
DEST     = os.environ["DEST"]
PATCH    = os.path.join(DSH_HOME, "profiles", PROFILE, "cordis.patch.yml")
IDS      = os.environ["PRESETS"].split()

MARK_BEGIN = "# >>> apollo agent presets (auto-wired by install-presets.sh) >>>"
MARK_END   = "# <<< apollo agent presets (auto-wired by install-presets.sh) <<<"

def read(p):
    with open(p, encoding="utf-8") as f: return f.read()

def meta(text):
    name = desc = ""; order = None
    for ln in text.splitlines():
        m = re.match(r"^name:\s*(.*\S)\s*$", ln)
        if m: name = m.group(1); continue
        m = re.match(r"^description:\s*(.*\S)\s*$", ln)
        if m: desc = m.group(1); continue
        m = re.match(r"^order:\s*(\d+)\s*$", ln)
        if m: order = int(m.group(1))
    return name, desc, (10 if order is None else order)

def q(s):  # double-quoted YAML scalar
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'

def entry(pid):
    d = os.path.join(DEST, pid)
    comp = read(os.path.join(d, "agent.cordis.yml"))
    name, desc, order = meta(read(os.path.join(d, "preset.yml")))
    # 预设行现在相对 profile 目录解析；把自带 .mjs 的相对路径改成绝对路径。
    comp = re.sub(r"(name:\s*)\./([A-Za-z0-9_.-]+\.mjs)",
                  lambda m: m.group(1) + q(os.path.join(d, m.group(2))), comp)
    # skill 作用域占位符改写：
    #   __DSH_PRESET_DIR__ -> 本预设在目标机的绝对目录（开发 skill 自带在这里）
    #   __DSH_HOME__       -> 目标机 DSH_HOME（运维 skill 装在 $DSH_HOME/skills）
    comp = comp.replace("__DSH_PRESET_DIR__", d).replace("__DSH_HOME__", DSH_HOME)
    plugins = "\n".join(("          " + ln) if ln.strip() else "" for ln in comp.splitlines())
    return (f"- insert:\n"
            f"    - id: preset-{pid}\n"
            f"      name: '@deepseek-ai/dsh-agent-preset'\n"
            f"      config:\n"
            f"        id: {pid}\n"
            f"        name: {q(name)}\n"
            f"        description: {q(desc)}\n"
            f"        order: {order}\n"
            f"        plugins:\n{plugins}\n")

ids = [p for p in IDS if os.path.isdir(os.path.join(DEST, p))]
if not ids:
    print("接线：没有可接的预设目录", file=sys.stderr); sys.exit(0)

txt = read(PATCH)
# 幂等：先删掉上一次自动接线的块，再重写。
txt = re.sub(re.escape(MARK_BEGIN) + r".*?" + re.escape(MARK_END) + r"\n?", "", txt, flags=re.DOTALL)

# 全新 profile 的 cordis.patch.yml 是空数组 `[]`（可能带说明注释）。直接往后追加会变成
# “两个 YAML 文档”，dsh 启动时报 failed to parse overlay —— 这是只有换新环境才暴露的坑。
# 所以：去掉注释/空行后若只剩 `[]` 或空，就丢掉这个空数组标记（保留注释），从零写新块。
body = [ln for ln in txt.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
if body in ([], ["[]"]):
    kept = [ln for ln in txt.splitlines() if ln.strip() != "[]"]
    txt = "\n".join(kept)
txt = (txt.rstrip("\n") + "\n\n") if txt.strip() else ""

txt = txt + MARK_BEGIN + "\n" + "".join(entry(p) for p in ids) + MARK_END + "\n"
with open(PATCH, "w", encoding="utf-8") as f: f.write(txt)
print("已接线到 profile:", ", ".join(ids), "->", PATCH)
PY
fi

if [ -n "$DEFAULT_ID" ]; then
  SET="$DSH_HOME_DIR/settings.yaml"
  touch "$SET"
  cp "$SET" "$SET.bak.$(date +%Y%m%d%H%M%S)"
  # 删掉旧的 agent-presets 段（如果有），再追加新的
  if grep -q '^agent-presets:' "$SET"; then
    PYTHONIOENCODING=utf-8 python3 - "$SET" "$DEFAULT_ID" <<'PY'
import sys, re
path, dflt = sys.argv[1], sys.argv[2]
txt = open(path, encoding='utf-8').read()
# 替换/追加 agent-presets.default
lines = txt.splitlines()
out, i, done = [], 0, False
while i < len(lines):
    if lines[i].startswith('agent-presets:'):
        out.append('agent-presets:')
        out.append('  default: ' + dflt)
        done = True
        i += 1
        # 跳过原 agent-presets 段的缩进子行
        while i < len(lines) and (lines[i].startswith(' ') or lines[i].strip()==''):
            if lines[i].strip()=='' and (i+1>=len(lines) or not lines[i+1].startswith(' ')):
                break
            i += 1
        continue
    out.append(lines[i]); i += 1
if not done:
    out.append('agent-presets:')
    out.append('  default: ' + dflt)
open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
PY
  else
    printf '\nagent-presets:\n  default: %s\n' "$DEFAULT_ID" >> "$SET"
  fi
  echo "已把默认预设设为: $DEFAULT_ID（原 settings.yaml 已备份）"
fi

cat <<EOF

完成。预设目录: $DEST
已接线到: $DSH_HOME_DIR/profiles/$PROFILE/cordis.patch.yml
下一步：重启 dsh / 新开一个会话（profile 改动不热加载）。
  - 预设选择器里会出现「Apollo 运维工程师」「Apollo 开发工程师」。
  - 想默认用某个：重跑本脚本加 --default apollo-env（或 apollo-dev），
    或手动编辑 $DSH_HOME_DIR/settings.yaml 的 agent-presets.default。
  - 自检：dsh --profile $PROFILE --dump-config | grep 'id: preset-'
前提：目标机器已装 DSH；要让运维/开发命令真正干活，目标机还需是 Apollo 11.0
      包工作区（有 /apollo_workspace 与 /opt/apollo/neo）。
EOF
