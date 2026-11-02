#!/usr/bin/env bash
set -euo pipefail

REPO="${APOLLO_OPS_REPO:-ApolloAuto/apollo-claw}"
BRANCH="${APOLLO_OPS_BRANCH:-EDU}"
PROFILE="${DSH_PROFILE:-web}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
WITH_LAN=0
REQUIRED_SKILLS='apollo-env apollo-dev apollo-test apollo-eval'

while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-lan) WITH_LAN=1; shift ;;
    -h|--help)
      echo 'Usage: install.sh [--with-lan]'
      echo 'Optional: APOLLO_OPS_REPO / APOLLO_OPS_BRANCH override the source (default ApolloAuto/apollo-claw EDU).'
      echo 'Optional: APOLLO_OPS_SKILLS_SOURCE points at a local checkout for offline Skill install.'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$BRANCH" in
  ''|/*|*..*|*[!A-Za-z0-9._/-]*) echo "Invalid APOLLO_OPS_BRANCH: $BRANCH" >&2; exit 2 ;;
esac

for tool in dsh npm curl tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Required command not found: $tool" >&2; exit 1; }
done
if command -v sha256sum >/dev/null 2>&1; then
  sha256_file() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  echo 'Required command not found: sha256sum or shasum.' >&2
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

raw_url() { printf 'https://raw.githubusercontent.com/%s/%s/ops-expert' "$1" "$2"; }
# Branch names may contain slashes; URL-encode them for the archive endpoint.
archive_url() {
  printf 'https://github.com/%s/archive/refs/heads/%s.tar.gz' "$1" "${2//\//%2F}"
}

field() { sed -n "s/^$2=//p" "$1" | head -1; }

validate_meta() {
  local f="$1" v c p l pkg
  [ -f "$f" ] || return 1
  v=$(field "$f" RELEASE_VERSION)
  c=$(field "$f" CLIENT_PACKAGE)
  p=$(field "$f" PRESETS_PACKAGE)
  l=$(field "$f" LAN_PACKAGE)
  [ -n "$v" ] && [ -n "$c" ] && [ -n "$p" ] && [ -n "$l" ] || return 1
  case "$v" in *[!A-Za-z0-9.+-]*) return 1 ;; esac
  for pkg in "$c" "$p" "$l"; do
    case "$pkg" in @*/*@*) ;; *) return 1 ;; esac
  done
}

SKILLS_LOCAL="${APOLLO_OPS_SKILLS_SOURCE:-}"
if [ -n "$SKILLS_LOCAL" ]; then
  META="$SKILLS_LOCAL/ops-expert/github-assets/release.env"
  [ -f "$META" ] || { echo "缺少 $META" >&2; exit 1; }
  echo "使用本地目录: $SKILLS_LOCAL"
  REPO=''
  BRANCH=''
else
  echo "来源: $REPO @ $BRANCH"
  curl -fsSL "$(raw_url "$REPO" "$BRANCH")/github-assets/release.env" -o "$TMP_DIR/release.env" \
    || { echo "无法读取 $REPO@$BRANCH 的 ops-expert/github-assets/release.env" >&2; exit 1; }
  META="$TMP_DIR/release.env"
fi
validate_meta "$META" || { echo "release.env 内容不完整: $META" >&2; exit 1; }

RELEASE_VERSION=$(field "$META" RELEASE_VERSION)
CLIENT_PACKAGE=$(field "$META" CLIENT_PACKAGE)
PRESETS_PACKAGE=$(field "$META" PRESETS_PACKAGE)
LAN_PACKAGE=$(field "$META" LAN_PACKAGE)
case "$RELEASE_VERSION" in ''|*[!A-Za-z0-9.+-]*) echo 'Invalid RELEASE_VERSION in release.env.' >&2; exit 1 ;; esac
for package in "$CLIENT_PACKAGE" "$PRESETS_PACKAGE" "$LAN_PACKAGE"; do
  case "$package" in @*/*@*) ;; *) echo "Invalid npm package spec in release.env: $package" >&2; exit 1 ;; esac
done

printf 'Installing client plugin %s\n' "$CLIENT_PACKAGE"
dsh plugin --profile "$PROFILE" add "$CLIENT_PACKAGE"

SKILLS_LOCAL="${APOLLO_OPS_SKILLS_SOURCE:-}"
if [ -n "$SKILLS_LOCAL" ]; then
  printf 'Using local Skills from %s\n' "$SKILLS_LOCAL"
  EXTRACT="$SKILLS_LOCAL"
else
  printf 'Downloading Skills %s from %s (%s)\n' "$RELEASE_VERSION" "$REPO" "$BRANCH"
  REPO_ARCHIVE="$TMP_DIR/repo.tar.gz"
  if ! curl -fL --retry 3 "$(archive_url "$REPO" "$BRANCH")" -o "$REPO_ARCHIVE"; then
    echo 'Skills download failed.' >&2
    exit 1
  fi
  EXTRACT="$TMP_DIR/repo"
  mkdir -p "$EXTRACT"
  tar -xzf "$REPO_ARCHIVE" -C "$EXTRACT" --strip-components=1
fi

for skill in $REQUIRED_SKILLS; do
  [ -f "$EXTRACT/$skill/SKILL.md" ] || { echo "Skills source is missing $skill/SKILL.md" >&2; exit 1; }
done

mkdir -p "$DSH_HOME_DIR/skills"
STAMP=$(date +%Y%m%d%H%M%S)
for skill in $REQUIRED_SKILLS; do
  if [ -e "$DSH_HOME_DIR/skills/$skill" ]; then
    BACKUP="$DSH_HOME_DIR/skills/$skill.bak.$STAMP"
    mv "$DSH_HOME_DIR/skills/$skill" "$BACKUP"
    printf 'Backed up existing %s -> %s\n' "$skill" "$BACKUP"
  fi
  cp -a "$EXTRACT/$skill" "$DSH_HOME_DIR/skills/$skill"
  [ -f "$DSH_HOME_DIR/skills/$skill/SKILL.md" ] || { echo "Failed to install $skill" >&2; exit 1; }
  printf 'Installed Skill %s\n' "$skill"
done

printf 'Installing agent presets %s\n' "$PRESETS_PACKAGE"
# 取包内脚本直接执行：npx 会通过 node_modules/.bin 软链调用，脚本按自身目录
# 找预设时会被解析成 .bin 目录而失败。下载 tarball 后从真实路径运行可避免。
PRESET_DIR="$TMP_DIR/presets"
mkdir -p "$PRESET_DIR"
if ! npm pack "$PRESETS_PACKAGE" --pack-destination "$PRESET_DIR" >/dev/null 2>&1; then
  echo "Failed to download $PRESETS_PACKAGE" >&2
  exit 1
fi
tar -xzf "$PRESET_DIR"/*.tgz -C "$PRESET_DIR"
PRESET_INSTALLER="$PRESET_DIR/package/install-presets.sh"
[ -f "$PRESET_INSTALLER" ] || { echo 'Presets package is missing install-presets.sh' >&2; exit 1; }
DSH_HOME="$DSH_HOME_DIR" DSH_PROFILE="$PROFILE" bash "$PRESET_INSTALLER"

if [ "$WITH_LAN" -eq 1 ]; then
  printf 'Installing optional LAN plugin %s\n' "$LAN_PACKAGE"
  dsh plugin --profile "$PROFILE" add "$LAN_PACKAGE"
fi

printf '\nInstallation complete. Restart DSH Web to load the changes.\n'
if [ "$WITH_LAN" -eq 1 ]; then
  printf 'LAN access is enabled; use only on a trusted network.\n'
fi
