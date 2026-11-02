#!/usr/bin/env bash
# Apollo EDU 环境检测脚本
# 基于 apollo-env 的 env_check.sh 改造，适配 Apollo EDU 环境
# Exit codes: 0=all pass, 1=warnings exist, 2=failures exist
# Usage: bash env_check.sh [--json]

set -euo pipefail

# ---- Output mode ----
OUTPUT_JSON=0
if [[ "${1:-}" == "--json" ]]; then
    OUTPUT_JSON=1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

has_warning=0
has_failure=0

# JSON result accumulator
declare -a JSON_RESULTS=()

pass() {
    if [[ $OUTPUT_JSON -eq 1 ]]; then
        JSON_RESULTS+=("{\"item\":\"$2\",\"status\":\"pass\",\"message\":\"$1\"}")
    else
        echo -e "${GREEN}✅ $1${NC}"
    fi
}
warn() {
    has_warning=1
    if [[ $OUTPUT_JSON -eq 1 ]]; then
        JSON_RESULTS+=("{\"item\":\"$2\",\"status\":\"warn\",\"message\":\"$1\"}")
    else
        echo -e "${YELLOW}⚠️  $1${NC}"
    fi
}
fail() {
    has_failure=1
    if [[ $OUTPUT_JSON -eq 1 ]]; then
        JSON_RESULTS+=("{\"item\":\"$2\",\"status\":\"fail\",\"message\":\"$1\"}")
    else
        echo -e "${RED}❌ $1${NC}"
    fi
}
info() {
    if [[ $OUTPUT_JSON -eq 0 ]]; then
        echo -e "   $1"
    fi
}
section() {
    if [[ $OUTPUT_JSON -eq 0 ]]; then
        echo -e "\n${CYAN}【$1】${NC}"
    fi
}

# ---- Locate config file ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE=""
for path in "${SCRIPT_DIR}/../config.yaml"; do
    if [ -f "$path" ]; then
        CONFIG_FILE="$path"
        break
    fi
done

# Read a config value from config.yaml
# Usage: get_config "key" [default_value]
get_config() {
    local key="$1"
    local default="${2:-}"
    if [ -f "$CONFIG_FILE" ]; then
        local line
        line=$(grep "^${key}:" "$CONFIG_FILE" 2>/dev/null || true)
        if [ -n "$line" ]; then
            echo "$line" | sed "s/^${key}:[[:space:]]*//" | sed "s/^[\"']//;s/[\"']$//"
            return
        fi
    fi
    echo "$default"
}

if [[ $OUTPUT_JSON -eq 0 ]]; then
    echo "========================================"
    echo "  Apollo $(get_config "version" "EDU") 环境检测报告"
    echo "========================================"
fi

# ---- OS ----
section "操作系统"
os_name="$(uname -s)"
if [ "$os_name" = "Linux" ]; then
    if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        distro=$(. /etc/os-release && echo "$NAME")
        version=$(. /etc/os-release && echo "$VERSION_ID")
        arch="$(uname -m)"
        os_supported="$(get_config "os_supported" "Ubuntu 18.04, Ubuntu 20.04, Ubuntu 22.04")"
        case "$distro" in
            *Ubuntu*)
                case "$version" in
                    18.04|20.04|22.04)
                        pass "Ubuntu $version $arch" "os"
                        ;;
                    24.04)
                        warn "Ubuntu $version $arch（Apollo EDU 暂不推荐 Ubuntu 24.04，建议使用 ${os_supported}）" "os"
                        ;;
                    *)
                        warn "Ubuntu $version $arch（推荐 ${os_supported}）" "os"
                        ;;
                esac
                ;;
            *)
                warn "$distro $version $arch（推荐使用 Ubuntu）" "os"
                ;;
        esac
    else
        warn "Linux（无法识别发行版）" "os"
    fi
elif [ "$os_name" = "Darwin" ]; then
    fail "macOS 不支持直接安装 Apollo，请在 Ubuntu 系统上操作" "os"
    info "可选方案: 使用 Ubuntu 虚拟机，或 SSH 到远程 Ubuntu 服务器"
else
    fail "不支持的操作系统: $os_name" "os"
fi

# ---- CPU ----
section "CPU"
cpu_min_cores="$(get_config "cpu_min_cores" "4")"
if [ "$os_name" = "Linux" ]; then
    cpu_cores="$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 0)"
    if [ "$cpu_cores" -gt 0 ]; then
        cpu_model="$(grep "model name" /proc/cpuinfo 2>/dev/null | head -1 | sed 's/.*: //' || echo '未知')"
        if [ "$cpu_cores" -ge "$cpu_min_cores" ]; then
            pass "CPU ${cpu_cores} 核（≥ ${cpu_min_cores} 核要求已满足）— ${cpu_model}" "cpu"
        else
            warn "CPU ${cpu_cores} 核（建议 ≥ ${cpu_min_cores} 核，编译可能较慢）" "cpu"
        fi
    else
        warn "无法检测 CPU 核心数" "cpu"
    fi
else
    warn "非 Linux 系统，跳过 CPU 检测" "cpu"
fi

# ---- Docker ----
section "Docker Engine"
docker_min="$(get_config "docker_min" "19.03")"
docker_install_url="$(get_config "docker_install_url" "http://apollo-pkg-beta.bj.bcebos.com/docker_install.sh")"
if command -v docker &>/dev/null; then
    docker_version="$(docker --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    if [ -n "$docker_version" ]; then
        docker_major="$(echo "$docker_version" | cut -d. -f1)"
        docker_minor="$(echo "$docker_version" | cut -d. -f2)"
        min_major="$(echo "$docker_min" | cut -d. -f1)"
        min_minor="$(echo "$docker_min" | cut -d. -f2)"
        if [ "$docker_major" -gt "$min_major" ] || { [ "$docker_major" -eq "$min_major" ] && [ "$docker_minor" -ge "$min_minor" ]; }; then
            pass "Docker $docker_version（≥ $docker_min 要求已满足）" "docker_version"
        else
            fail "Docker $docker_version（需要 ≥ $docker_min）" "docker_version"
        fi
    else
        pass "Docker 已安装（版本信息无法解析）" "docker_version"
    fi
    # Check if Docker daemon is running
    if docker info &>/dev/null; then
        pass "Docker 守护进程运行中" "docker_daemon"
    else
        fail "Docker 守护进程未运行，请执行: sudo systemctl start docker" "docker_daemon"
    fi
    # Check user permissions
    if groups 2>/dev/null | grep -q docker; then
        pass "当前用户在 docker 组中（免 sudo 执行 Docker）" "docker_group"
    else
        warn "当前用户不在 docker 组，需 sudo 执行 Docker 命令" "docker_group"
        info "修复: sudo usermod -aG docker \$USER && newgrp docker"
    fi
else
    fail "Docker 未安装" "docker_version"
    info "安装: wget ${docker_install_url} && bash docker_install.sh"
fi

# ---- Memory ----
section "内存"
memory_min_gb="$(get_config "memory_min_gb" "16")"
if [ "$os_name" = "Linux" ] && [ -f /proc/meminfo ]; then
    mem_total_kb="$(grep MemTotal /proc/meminfo | awk '{print $2}')"
    mem_total_gb=$((mem_total_kb / 1024 / 1024))
    if [ "$mem_total_gb" -ge "$memory_min_gb" ]; then
        pass "总内存 ${mem_total_gb}GB（≥ ${memory_min_gb}GB 要求已满足）" "memory"
    else
        warn "总内存 ${mem_total_gb}GB（建议 ≥ ${memory_min_gb}GB，编译可能较慢）" "memory"
    fi
else
    warn "无法检测内存大小" "memory"
fi

# ---- Disk Space ----
section "磁盘空间"
disk_min_gb="$(get_config "disk_min_gb" "55")"
if [ "$os_name" = "Linux" ]; then
    available_gb="$(df -BG / 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G')"
    if [ -n "$available_gb" ]; then
        if [ "$available_gb" -ge "$disk_min_gb" ]; then
            pass "根分区可用空间 ${available_gb}GB（≥ ${disk_min_gb}GB 要求已满足）" "disk_root"
        else
            fail "根分区可用空间 ${available_gb}GB（需要 ≥ ${disk_min_gb}GB）" "disk_root"
        fi
    else
        warn "无法检测根分区磁盘空间" "disk_root"
    fi

    if command -v docker &>/dev/null && docker info &>/dev/null; then
        docker_root_dir="$(docker info 2>/dev/null | grep "Docker Root Dir" | awk '{print $NF}')"
        if [ -n "$docker_root_dir" ] && [ -d "$docker_root_dir" ]; then
            docker_available_gb="$(df -BG "$docker_root_dir" 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G')"
            if [ -n "$docker_available_gb" ]; then
                if [ "$docker_available_gb" -ge "$disk_min_gb" ]; then
                    pass "Docker 数据目录 (${docker_root_dir}) 可用空间 ${docker_available_gb}GB（≥ ${disk_min_gb}GB）" "disk_docker"
                else
                    fail "Docker 数据目录 (${docker_root_dir}) 可用空间 ${docker_available_gb}GB（需要 ≥ ${disk_min_gb}GB）" "disk_docker"
                fi
            fi
        fi
    fi
else
    warn "非 Linux 系统，跳过磁盘检测" "disk_root"
fi

# ---- Network Connectivity ----
section "网络连通性"
network_check_url="$(get_config "network_check_url" "https://apollo-pkg-beta.cdn.bcebos.com")"
network_check_github="$(get_config "network_check_github" "https://github.com")"
network_timeout="$(get_config "network_check_timeout" "5")"

# Check Apollo CDN
if curl -sSf --connect-timeout "$network_timeout" --max-time "$((network_timeout * 2))" "$network_check_url" -o /dev/null 2>/dev/null; then
    pass "Apollo CDN 可达（${network_check_url}）" "network_apollo"
else
    warn "Apollo CDN 不可达（${network_check_url}），apt 安装可能受影响" "network_apollo"
    info "如在内网环境，可忽略此项；安装时可使用离线缓存包"
fi

# Check GitHub
if curl -sSf --connect-timeout "$network_timeout" --max-time "$((network_timeout * 2))" "$network_check_github" -o /dev/null 2>/dev/null; then
    pass "GitHub 可达" "network_github"
else
    warn "GitHub 不可达，git clone 时请使用 Gitee 镜像" "network_github"
    info "替代: git clone https://gitee.com/ApolloAuto/application-pnc"
fi

# ---- aem (Apollo Environment Manager) ----
section "aem 环境管理工具"
if command -v aem &>/dev/null; then
    aem_version="$(aem --version 2>/dev/null || echo '未知')"
    pass "aem 已安装（版本: $aem_version）" "aem"

    # Check if an Apollo container is running
    if aem list 2>/dev/null | grep -q "running"; then
        pass "存在运行中的 Apollo 容器" "aem_container"
    else
        info "当前无运行中的 Apollo 容器（使用 aem start 启动）"
    fi
else
    fail "aem 未安装" "aem"
    info "安装: sudo apt install apollo-neo-env-manager-dev --reinstall"
fi

# ---- buildtool ----
section "buildtool 构建工具"
if command -v buildtool &>/dev/null; then
    bt_version="$(buildtool -v 2>/dev/null || echo '未知')"
    pass "buildtool 已安装（版本: $bt_version）" "buildtool"
else
    if command -v aem &>/dev/null; then
        pass "buildtool 未在宿主机检测到（需在 Apollo 容器内使用，aem enter 后可用）" "buildtool"
    else
        info "buildtool 需在 Apollo 容器内使用，请先安装 aem 并启动容器"
    fi
fi

# ---- Apollo PnC Project ----
section "Apollo EDU PnC 工程"
if [ -d "application-pnc" ]; then
    pass "application-pnc 已克隆（路径: $(pwd)/application-pnc）" "project"
elif [ -f "WORKSPACE" ] && grep -q "application-pnc" "WORKSPACE" 2>/dev/null; then
    pass "当前目录即为 application-pnc 工程" "project"
elif [ -f "../WORKSPACE" ] && grep -q "application-pnc" "../WORKSPACE" 2>/dev/null; then
    pass "上级目录为 application-pnc 工程" "project"
else
    fail "application-pnc 未克隆" "project"
    info "克隆: git clone https://github.com/ApolloAuto/application-pnc.git"
fi

# ---- Output ----
if [[ $OUTPUT_JSON -eq 1 ]]; then
    # JSON output mode
    echo "{"
    echo "  \"version\": \"$(get_config "version" "EDU")\","
    echo "  \"timestamp\": \"$(date -Iseconds)\","
    echo "  \"has_failure\": $( [ "$has_failure" -gt 0 ] && echo "true" || echo "false" ),"
    echo "  \"has_warning\": $( [ "$has_warning" -gt 0 ] && echo "true" || echo "false" ),"
    echo "  \"results\": ["
    local_first=1
    for r in "${JSON_RESULTS[@]}"; do
        if [ "$local_first" -eq 1 ]; then
            local_first=0
        else
            echo ","
        fi
        echo -n "    $r"
    done
    echo ""
    echo "  ]"
    echo "}"
else
    echo ""
    echo "========================================"
    echo "  检测完成"
    echo "========================================"
fi

if [ "$has_failure" -gt 0 ]; then
    exit 2
elif [ "$has_warning" -gt 0 ]; then
    exit 1
else
    exit 0
fi
