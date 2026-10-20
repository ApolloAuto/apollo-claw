#!/usr/bin/env bash
# 把 github-assets/ 打成一个可放任意云端存储的 tar.gz。
# 用法:
#   ./pack-assets.sh                 # 含 skills 包（约 63MB，单文件分发）
#   ./pack-assets.sh --no-skills     # 不含 skills（几 KB，skills 走 release.env 里的完整 URL）
set -euo pipefail
BASE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
SRC="$BASE/github-assets"
VER=$(sed -n 's/^SKILLS_ARCHIVE=apollo-skills-envdev-\(.*\)\.tar\.gz/\1/p' "$SRC/release.env" 2>/dev/null | head -1)
VER=${VER:-0.0.0}
NO_SKILLS=0
case "${1:-}" in
  --no-skills) NO_SKILLS=1 ;;
  -h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

OUT="$BASE/dist"
mkdir -p "$OUT"
NAME="apollo-ops-assets-$VER.tar.gz"
TARGET="$OUT/$NAME"

EXCLUDES=(--exclude='.DS_Store')
if [ "$NO_SKILLS" -eq 1 ]; then
  EXCLUDES+=(--exclude='*.tar.gz')
fi

tar -czf "$TARGET" "${EXCLUDES[@]}" -C "$SRC" .
printf '已生成: %s\n' "$TARGET"
printf '大小  : %s\n' "$(du -h "$TARGET" | cut -f1)"
printf '\n上传到任意可公网读取的地址后，安装命令:\n'
printf '  ./install.sh --npm-package @apollo-ops/dsh-client-ui-apollo-ops \\\n'
printf '    --assets-tarball <这个文件的 URL>\n'
