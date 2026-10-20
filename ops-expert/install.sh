#!/usr/bin/env bash
# Apollo Ops Expert 一键安装。直接执行即可：
#   curl -fsSL <本文件地址> | bash
#
# 如需自定义资源位置，可用：
#   --github-raw URL      目录形态资源
#   --assets-tarball URL  单个 tar.gz 资源包
set -euo pipefail

DEFAULT_PLUGIN_PACKAGE="@apollo-ops/dsh-client-ui-apollo-ops"
DEFAULT_GITHUB_RAW="https://raw.githubusercontent.com/ApolloAuto/apollo-claw/EDU/ops-expert/github-assets"

PLUGIN_PACKAGE="${APOLLO_OPS_NPM_PACKAGE:-$DEFAULT_PLUGIN_PACKAGE}"
PLUGIN_VERSION="${APOLLO_OPS_NPM_VERSION:-latest}"
GITHUB_RAW_BASE_URL="${APOLLO_OPS_GITHUB_RAW_BASE_URL:-$DEFAULT_GITHUB_RAW}"
ASSETS_TARBALL="${APOLLO_OPS_ASSETS_TARBALL:-}"
PROFILE="${DSH_PROFILE:-web}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
DEFAULT_PRESET=""

usage() {
  cat <<'EOF'
用法（来源二选一）:
  ./install.sh --npm-package @apollo-ops/dsh-client-ui-apollo-ops \
    --github-raw https://raw.githubusercontent.com/USER/REPO/main/github-assets

  ./install.sh --npm-package @apollo-ops/dsh-client-ui-apollo-ops \
    --assets-tarball https://your-oss.example.com/apollo-ops-assets.tar.gz

选项:
  --npm-package NAME       npm 包名（必填，或 APOLLO_OPS_NPM_PACKAGE）
  --version VERSION        npm 版本，默认 latest
  --github-raw URL         目录形态资源地址（含 release.env 与 presets-only/）
  --assets-tarball URL     单个 tar.gz 资源包（解包后同目录形态）
  --default PRESET         apollo-env 或 apollo-dev
  -h, --help               显示帮助

环境变量:
  DSH_HOME      默认 ~/.dsh
  DSH_PROFILE   默认 web
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --npm-package) PLUGIN_PACKAGE="${2:?缺少 npm 包名}"; shift 2;;
    --version) PLUGIN_VERSION="${2:?缺少版本}"; shift 2;;
    --github-raw) GITHUB_RAW_BASE_URL="${2:?缺少地址}"; shift 2;;
    --assets-tarball) ASSETS_TARBALL="${2:?缺少地址}"; shift 2;;
    --default) DEFAULT_PRESET="${2:?需要 apollo-env 或 apollo-dev}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "未知参数: $1" >&2; exit 2;;
  esac
done

[ -n "$PLUGIN_PACKAGE" ] || { echo "错误：请提供 --npm-package" >&2; exit 2; }
if [ -z "$GITHUB_RAW_BASE_URL" ] && [ -z "$ASSETS_TARBALL" ]; then
  echo "错误：请提供 --github-raw 或 --assets-tarball" >&2; exit 2
fi
command -v dsh  >/dev/null || { echo '错误：找不到 dsh' >&2; exit 1; }
command -v curl >/dev/null || { echo '错误：找不到 curl' >&2; exit 1; }
command -v tar  >/dev/null || { echo '错误：找不到 tar' >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ASSETS="$TMP/assets"
mkdir -p "$ASSETS"

# ── 1) 准备资源目录 ─────────────────────────────────────────────────────────
echo "[1/5] 获取 skills/预设资源"
if [ -n "$ASSETS_TARBALL" ]; then
  echo "      来源: tarball $ASSETS_TARBALL"
  curl -fL --retry 3 "$ASSETS_TARBALL" -o "$TMP/assets.tar.gz"
  tar -xzf "$TMP/assets.tar.gz" -C "$ASSETS"
  # 兼容压缩包内多包一层目录的情况
  if [ ! -f "$ASSETS/release.env" ]; then
    inner=$(find "$ASSETS" -maxdepth 2 -name release.env -printf '%h\n' 2>/dev/null | head -1)
    [ -n "$inner" ] && ASSETS="$inner"
  fi
else
  GITHUB_RAW_BASE_URL="${GITHUB_RAW_BASE_URL%/}"
  echo "      来源: 目录 $GITHUB_RAW_BASE_URL"
  curl -fL --retry 3 "$GITHUB_RAW_BASE_URL/release.env" -o "$ASSETS/release.env"
  for f in presets-only/install-presets.sh \
           presets-only/apollo-env/agent.cordis.yml \
           presets-only/apollo-env/preset.yml \
           presets-only/apollo-env/apollo-ops-expert.mjs \
           presets-only/apollo-dev/agent.cordis.yml \
           presets-only/apollo-dev/preset.yml; do
    mkdir -p "$ASSETS/$(dirname "$f")"
    curl -fL --retry 3 "$GITHUB_RAW_BASE_URL/$f" -o "$ASSETS/$f"
  done
fi
[ -f "$ASSETS/release.env" ] || { echo "错误：资源里没有 release.env" >&2; exit 1; }
[ -f "$ASSETS/presets-only/install-presets.sh" ] || { echo "错误：资源里缺 presets-only/install-presets.sh" >&2; exit 1; }

SKILLS_ARCHIVE=$(sed -n 's/^SKILLS_ARCHIVE=//p' "$ASSETS/release.env" | head -1)
[ -n "$SKILLS_ARCHIVE" ] || { echo "错误：release.env 缺少 SKILLS_ARCHIVE" >&2; exit 1; }

# ── 2) 取 skills 包 ─────────────────────────────────────────────────────────
echo "[2/5] 取 skills 包: $SKILLS_ARCHIVE"
SKILLS_TGZ="$TMP/apollo-skills.tar.gz"
case "$SKILLS_ARCHIVE" in
  https://*|http://*)
    curl -fL --retry 3 "$SKILLS_ARCHIVE" -o "$SKILLS_TGZ" ;;
  *)
    if [ -f "$ASSETS/$SKILLS_ARCHIVE" ]; then
      cp "$ASSETS/$SKILLS_ARCHIVE" "$SKILLS_TGZ"
    elif [ -n "$GITHUB_RAW_BASE_URL" ]; then
      curl -fL --retry 3 "$GITHUB_RAW_BASE_URL/$SKILLS_ARCHIVE" -o "$SKILLS_TGZ"
    else
      echo "错误：资源里找不到 $SKILLS_ARCHIVE，且 SKILLS_ARCHIVE 不是完整 URL" >&2; exit 1
    fi ;;
esac

# ── 3) 装 npm 插件 ──────────────────────────────────────────────────────────
echo "[3/5] 安装 npm 插件: $PLUGIN_PACKAGE@$PLUGIN_VERSION"
dsh plugin --profile "$PROFILE" add "$PLUGIN_PACKAGE@$PLUGIN_VERSION"

# ── 4) 装 skills ────────────────────────────────────────────────────────────
echo "[4/5] 安装 skills 到 $DSH_HOME_DIR/skills"
mkdir -p "$DSH_HOME_DIR/skills"
tar -xzf "$SKILLS_TGZ" -C "$DSH_HOME_DIR/skills"
echo "      skill 数: $(find "$DSH_HOME_DIR/skills" -mindepth 1 -maxdepth 1 -type d | wc -l)"

# ── 5) 装两个预设（含作用域视图）────────────────────────────────────────────
echo "[5/5] 安装 agent 预设"
chmod +x "$ASSETS/presets-only/install-presets.sh"
PRESET_ARGS=()
[ -n "$DEFAULT_PRESET" ] && PRESET_ARGS+=(--default "$DEFAULT_PRESET")
DSH_HOME="$DSH_HOME_DIR" DSH_PROFILE="$PROFILE" \
  bash "$ASSETS/presets-only/install-presets.sh" "${PRESET_ARGS[@]}"

echo
echo "完成。"
echo "  插件 : $DSH_HOME_DIR/profiles/$PROFILE"
echo "  skills: $DSH_HOME_DIR/skills"
echo "  预设 : $DSH_HOME_DIR/.agent-presets/{apollo-env,apollo-dev}"
echo "请重启 dsh web 后生效。"
