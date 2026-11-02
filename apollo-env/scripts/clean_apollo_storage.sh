#!/usr/bin/env bash
#
# clean_apollo_storage.sh
#
# 作用：
#   1) 先检测当前是否为 Apollo 环境；不是则直接退出（不删除任何东西）。
#   2) 是 Apollo 环境时，清理以下存储：
#        - 清空 /apollo_workspace/data/record   下所有内容（保留目录本身）
#        - 清空 /apollo_workspace/data/records  下所有内容（保留目录本身）
#        - 清空 /apollo_workspace/data/core     下所有内容（保留目录本身）
#        - 删除 /apollo_workspace/data/log 中「文件名不是以 .INFO 结尾」的所有日志
#          （严格字面规则：只保留 basename 以 .INFO 结尾的条目）
#
# 安全设计：
#   - 所有目标路径都是写死的常量，绝不接受外部参数拼接路径。
#   - 删除前对每个变量做非空与前缀校验，拒绝越界到 data 目录之外。
#   - 默认先打印将要删除的内容并要求确认；可用 --dry-run 只预览，-y/--yes 跳过确认。
#   - record/records/core 只删除「目录内的内容」(mindepth 1)，绝不删除目录本身。
#   - log 只处理顶层的文件与符号链接，不递归删除子目录。
#
set -euo pipefail

# ---- 固定常量（不要改成变量拼接）--------------------------------------------
readonly WORKROOT="/apollo_workspace"
readonly DATA_DIR="${WORKROOT}/data"
readonly DIR_RECORD="${DATA_DIR}/record"
readonly DIR_RECORDS="${DATA_DIR}/records"
readonly DIR_CORE="${DATA_DIR}/core"
readonly DIR_LOG="${DATA_DIR}/log"

# ---- 运行选项 ---------------------------------------------------------------
DRY_RUN=0
ASSUME_YES=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    -y|--yes)     ASSUME_YES=1 ;;
    --json)       JSON=1 ;;
    -h|--help)
      cat <<'USAGE'
用法: clean_apollo_storage.sh [选项]
  -n, --dry-run   只预览将要删除的内容，不真正删除
  -y, --yes       跳过交互确认，直接执行
  --json          机器可读输出（供插件按钮调用：预览/结果各输出一行 JSON）
  -h, --help      显示本帮助
USAGE
      exit 0 ;;
    *)
      echo "未知参数: $arg (用 --help 查看用法)" >&2
      exit 64 ;;
  esac
done

# JSON 模式（插件按钮用）：人类日志走 stderr，stdout 只留一行 JSON；
# 且禁止交互——预览必须 --dry-run、执行必须 -y，避免卡在 read。
if [[ "$JSON" -eq 1 && "$DRY_RUN" -ne 1 && "$ASSUME_YES" -ne 1 ]]; then
  echo '{"error":"--json 需配合 --dry-run(预览) 或 -y(执行)"}'; exit 64
fi

# JSON 模式下，普通 log 改到 stderr，保持 stdout 干净
_log_fd=1
[[ "$JSON" -eq 1 ]] && _log_fd=2

log()  { printf '%s\n' "$*" >&"$_log_fd"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { if [[ "$JSON" -eq 1 ]]; then printf '{"error":%s}\n' "$(json_str "$*")"; fi; printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# 极简 JSON 字符串转义（够用于路径/错误消息）
json_str() { local s="${1//\\/\\\\}"; s="${s//\"/\\\"}"; printf '"%s"' "$s"; }
# 某目录可读占用字节（du -sb），拿不到则 0
dir_bytes() { local d="$1"; [[ -d "$d" ]] || { printf '0'; return; }; du -sb "$d" 2>/dev/null | cut -f1 || printf '0'; }

# ---- 1) 检测 Apollo 环境 -----------------------------------------------------
# 采用多信号判定，命中足够多的强特征才认为是 Apollo 环境，避免误判。
is_apollo_env() {
  local score=0
  local reasons=()

  if [[ "${APOLLO_IN_DOCKER:-}" == "true" ]]; then
    score=$((score+1)); reasons+=("APOLLO_IN_DOCKER=true")
  fi
  if [[ -n "${APOLLO_ENV_WORKROOT:-}" ]]; then
    score=$((score+1)); reasons+=("APOLLO_ENV_WORKROOT=${APOLLO_ENV_WORKROOT}")
  fi
  if [[ -n "${APOLLO_DISTRIBUTION_HOME:-}" && -d "${APOLLO_DISTRIBUTION_HOME:-/nonexistent}" ]]; then
    score=$((score+1)); reasons+=("APOLLO_DISTRIBUTION_HOME=${APOLLO_DISTRIBUTION_HOME}")
  fi
  if [[ -d "/opt/apollo/neo" ]]; then
    score=$((score+1)); reasons+=("/opt/apollo/neo 存在")
  fi
  if [[ -f "${WORKROOT}/WORKSPACE" && -e "${WORKROOT}/.apollo.bazelrc" ]]; then
    score=$((score+1)); reasons+=("${WORKROOT}/WORKSPACE + .apollo.bazelrc 存在")
  fi

  log "Apollo 环境检测信号 (命中 ${score}/5):"
  local r
  for r in "${reasons[@]:-}"; do [[ -n "$r" ]] && log "  - $r"; done

  # 至少命中 3 个强特征，且 data 目录确实存在，才判定为 Apollo 环境
  [[ "$score" -ge 3 && -d "${DATA_DIR}" ]]
}

if ! is_apollo_env; then
  die "当前不是 Apollo 环境（或 ${DATA_DIR} 不存在），已退出，未做任何删除。"
fi
log "判定：当前是 Apollo 环境。"
log ""

# ---- 安全校验：目标路径必须位于 ${DATA_DIR} 之内 -----------------------------
assert_inside_data() {
  local path="$1"
  [[ -n "$path" ]] || die "内部错误：空路径。"
  case "$path" in
    "${DATA_DIR}"/*) : ;;  # OK，必须是 data/ 下的子路径
    *) die "拒绝操作越界路径：$path" ;;
  esac
}
assert_inside_data "$DIR_RECORD"
assert_inside_data "$DIR_RECORDS"
assert_inside_data "$DIR_CORE"
assert_inside_data "$DIR_LOG"

# ---- 收集待删除条目 ----------------------------------------------------------
# 对 record/records/core：目录内所有顶层条目（mindepth 1 maxdepth 1）。
# 使用 NUL 分隔，安全处理含空格/特殊字符的文件名。
collect_dir_contents() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 -print0
}

# 对 log：顶层「文件 + 符号链接」中 basename 不以 .INFO 结尾的条目。
# 严格字面规则：只保留名字以 .INFO 结尾的；其余删除。不递归、不动子目录。
collect_log_non_info() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 \( -type f -o -type l \) \
       ! -name '*.INFO' -print0
}

# 统计某个 NUL 列表的条目数
count_nul() {
  local n=0
  while IFS= read -r -d '' _; do n=$((n+1)); done
  printf '%s' "$n"
}

# ---- 预览 -------------------------------------------------------------------
log "将要清理的内容："
log "  [1] 清空目录内容: ${DIR_RECORD}"
log "  [2] 清空目录内容: ${DIR_RECORDS}"
log "  [3] 清空目录内容: ${DIR_CORE}"
log "  [4] 删除 ${DIR_LOG} 下文件名不以 .INFO 结尾的日志（保留以 .INFO 结尾的）"
log ""

preview_dir() {
  local label="$1" dir="$2" collector="$3"
  if [[ ! -d "$dir" ]]; then
    log "  ${label}: 目录不存在，跳过 -> ${dir}"
    return 0
  fi
  local cnt
  cnt="$($collector "$dir" | count_nul)"
  local size
  size="$(du -sh "$dir" 2>/dev/null | cut -f1 || echo '?')"
  log "  ${label}: ${dir}  (当前占用 ${size}，待删除 ${cnt} 个条目)"
}

preview_dir "[1] record "  "$DIR_RECORD"  collect_dir_contents
preview_dir "[2] records"  "$DIR_RECORDS" collect_dir_contents
preview_dir "[3] core   "  "$DIR_CORE"    collect_dir_contents
# log 单独统计（保留/删除两类）
if [[ -d "$DIR_LOG" ]]; then
  keep_cnt="$(find "$DIR_LOG" -mindepth 1 -maxdepth 1 \( -type f -o -type l \) -name '*.INFO' -print0 | count_nul)"
  del_cnt="$(collect_log_non_info "$DIR_LOG" | count_nul)"
  log "  [4] log    : ${DIR_LOG}  (保留 .INFO 结尾 ${keep_cnt} 个，待删除 ${del_cnt} 个)"
else
  log "  [4] log    : 目录不存在，跳过 -> ${DIR_LOG}"
fi
log ""

# ---- JSON 预览输出（供插件按钮）---------------------------------------------
emit_preview_json() {
  local rc rr cc lk ld
  rc="$(collect_dir_contents "$DIR_RECORD"  | count_nul)"
  rr="$(collect_dir_contents "$DIR_RECORDS" | count_nul)"
  cc="$(collect_dir_contents "$DIR_CORE"    | count_nul)"
  if [[ -d "$DIR_LOG" ]]; then
    lk="$(find "$DIR_LOG" -mindepth 1 -maxdepth 1 \( -type f -o -type l \) -name '*.INFO' -print0 | count_nul)"
    ld="$(collect_log_non_info "$DIR_LOG" | count_nul)"
  else lk=0; ld=0; fi
  local total=$((rc+rr+cc+ld))
  printf '{"mode":"preview","total_del":%s,"dirs":{"record":{"count":%s,"bytes":%s},"records":{"count":%s,"bytes":%s},"core":{"count":%s,"bytes":%s}},"log":{"keep":%s,"del":%s,"bytes":%s}}\n' \
    "$total" \
    "$rc" "$(dir_bytes "$DIR_RECORD")" \
    "$rr" "$(dir_bytes "$DIR_RECORDS")" \
    "$cc" "$(dir_bytes "$DIR_CORE")" \
    "$lk" "$ld" "$(dir_bytes "$DIR_LOG")"
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  [[ "$JSON" -eq 1 ]] && emit_preview_json
  log "[dry-run] 仅预览，未删除任何内容。"
  exit 0
fi

# ---- 确认 -------------------------------------------------------------------
if [[ "$ASSUME_YES" -ne 1 ]]; then
  printf '确认执行以上删除操作？输入大写 YES 继续: '
  read -r reply
  if [[ "$reply" != "YES" ]]; then
    die "未确认（需输入 YES），已取消，未做任何删除。"
  fi
fi

# ---- 执行删除 ---------------------------------------------------------------
removed_total=0

wipe_dir_contents() {
  local label="$1" dir="$2"
  assert_inside_data "$dir"
  if [[ ! -d "$dir" ]]; then
    log "${label}: 目录不存在，跳过。"
    return 0
  fi
  local n=0
  while IFS= read -r -d '' entry; do
    assert_inside_data "$entry"
    rm -rf -- "$entry"
    n=$((n+1))
  done < <(collect_dir_contents "$dir")
  removed_total=$((removed_total+n))
  log "${label}: 已清空 ${n} 个条目 -> ${dir}"
}

wipe_log_non_info() {
  local dir="$DIR_LOG"
  assert_inside_data "$dir"
  if [[ ! -d "$dir" ]]; then
    log "log: 目录不存在，跳过。"
    return 0
  fi
  local n=0
  while IFS= read -r -d '' entry; do
    assert_inside_data "$entry"
    rm -f -- "$entry"
    n=$((n+1))
  done < <(collect_log_non_info "$dir")
  removed_total=$((removed_total+n))
  log "log: 已删除 ${n} 个非 .INFO 结尾日志 -> ${dir}"
}

wipe_dir_contents "record " "$DIR_RECORD"
wipe_dir_contents "records" "$DIR_RECORDS"
wipe_dir_contents "core   " "$DIR_CORE"
wipe_log_non_info

log ""
log "完成。共删除 ${removed_total} 个条目。"
[[ "$JSON" -eq 1 ]] && printf '{"mode":"done","removed":%s}\n' "$removed_total"
exit 0
