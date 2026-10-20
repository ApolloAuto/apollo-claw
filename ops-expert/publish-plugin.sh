#!/usr/bin/env bash
# 发布 plugin/ 到公网 npm。先登录 npm，再执行：./publish-plugin.sh
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
PKG="$HERE/plugin"
REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org/}"
[ -f "$PKG/package.json" ] || { echo "缺少 plugin/package.json" >&2; exit 1; }
command -v npm >/dev/null || { echo "找不到 npm" >&2; exit 1; }
echo "npm 包信息:"
NAME=$(node -p 'require(process.argv[1]).name' "$PKG/package.json")
VERSION=$(node -p 'require(process.argv[1]).version' "$PKG/package.json")
echo "$NAME@$VERSION"
case "$NAME" in
  @deepseek-ai/*)
    echo "错误：$NAME 使用的是官方 scope；请改成你自己的 npm scope 后再发布。" >&2
    exit 2
    ;;
  @*/*) : ;;
  *) echo "错误：建议使用你自己的 scoped 包名，例如 @alice/dsh-client-ui-apollo-ops" >&2; exit 2;;
esac
echo "发布预览:"
(cd "$PKG" && npm pack --dry-run)
if [ "${PUBLISH_CONFIRM:-}" != "YES" ]; then
  echo "这是公网发布操作。确认发布请使用: PUBLISH_CONFIRM=YES ./publish-plugin.sh" >&2
  exit 2
fi
(cd "$PKG" && npm publish --access public --registry "$REGISTRY")
