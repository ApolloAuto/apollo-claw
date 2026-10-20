#!/usr/bin/env bash
# 从原 packaging 生成/刷新这个独立公网+GitHub 分发目录。
# 不修改原 packaging，也不修改原 ops-Expert.tar.gz。
set -euo pipefail

BASE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
SOURCE_ROOT="${SOURCE_ROOT:-/apollo_workspace/packaging}"
SCOPE="${NPM_SCOPE:-@apollo-ops}"
VERSION="${PLUGIN_VERSION:-1.0.3}"
SRC_PLUGIN=$(ls -t "$SOURCE_ROOT"/deepseek-ai-dsh-client-ui-apollo-ops-*.tgz 2>/dev/null | head -1 || true)
SRC_SKILLS=$(ls -t "$SOURCE_ROOT"/apollo-skills-*.tar.gz 2>/dev/null | head -1 || true)
[ -n "$SRC_PLUGIN" ] && [ -f "$SRC_PLUGIN" ] || { echo "找不到插件 tgz" >&2; exit 1; }
[ -n "$SRC_SKILLS" ] && [ -f "$SRC_SKILLS" ] || { echo "找不到 skills tar.gz" >&2; exit 1; }
case "$SCOPE" in
  @*[a-z0-9-]) ;;
  *) echo "NPM_SCOPE 必须类似 @apollo-ops" >&2; exit 2;;
esac
case "$BASE" in /apollo_workspace/apolloopuexpert) ;; *) echo "拒绝：BASE 不是预期目录" >&2; exit 2;; esac

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PLUGIN_NAME="$SCOPE/dsh-client-ui-apollo-ops"

tar -xzf "$SRC_PLUGIN" -C "$TMP"
rm -rf "$BASE/plugin"
mkdir -p "$BASE/plugin"
cp -R "$TMP/package"/* "$BASE/plugin/"
# 让发布包成为用户自己 scope 下的 npm 包；同步所有内置插件身份字符串。
find "$BASE/plugin" -type f \( -name '*.js' -o -name '*.json' -o -name '*.yml' -o -name '*.yaml' \) -print0 |
while IFS= read -r -d '' f; do
  sed -i "s#@deepseek-ai/dsh-client-ui-apollo-ops#$PLUGIN_NAME#g" "$f"
done
node - "$BASE/plugin/package.json" "$PLUGIN_NAME" "$VERSION" <<'NODE'
const fs = require('fs');
const [file, name, version] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
p.name = name;
p.version = version;
fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
NODE

cp "$SRC_SKILLS" "$BASE/github-assets/"
# 预设源与安装器同步；GitHub 资源保持与 packaging 当前版本一致。
rm -rf "$BASE/github-assets/presets-only"
mkdir -p "$BASE/github-assets/presets-only"
cp -R "$SOURCE_ROOT/presets-only/apollo-env" "$BASE/github-assets/presets-only/"
cp -R "$SOURCE_ROOT/presets-only/apollo-dev" "$BASE/github-assets/presets-only/"
cp "$SOURCE_ROOT/presets-only/install-presets.sh" "$BASE/github-assets/presets-only/"
chmod +x "$BASE/github-assets/presets-only/install-presets.sh"
SKILLS_ARCHIVE=$(basename "$SRC_SKILLS")
printf '# Generated from %s\nSKILLS_ARCHIVE=%s\nPRESET_INSTALLER=presets-only/install-presets.sh\n' "$SOURCE_ROOT" "$SKILLS_ARCHIVE" > "$BASE/github-assets/release.env"

printf '同步完成\n  plugin: %s@%s\n  skills: %s\n  source: %s\n' "$PLUGIN_NAME" "$VERSION" "$SKILLS_ARCHIVE" "$SOURCE_ROOT"
