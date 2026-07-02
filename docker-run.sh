#!/usr/bin/env bash
#
# docker-run.sh
# 服务器一键重建并启动 HeySure AI 2.0 的 Docker Compose 服务
#
# 特点：
#   - 构建阶段实时显示进度（--progress plain）
#   - 适合在服务器上通过 SSH / tmux / screen 运行
#   - 启动后自动显示日志，便于观察启动过程
#
# 使用方法：
#   1. 赋予执行权限
#      chmod +x docker-run.sh
#   2. 运行
#      ./docker-run.sh
#
# 常用操作：
#   停止服务：     docker compose down
#   只看日志：     docker compose logs -f
#   重建单个服务： docker compose up -d --build api-gateway
#

set -euo pipefail

# 切换到脚本所在目录（项目根目录）
cd "$(dirname "$0")"

FORCE_BUILD=0
SKIP_UPDATE=0
for arg in "$@"; do
    case "$arg" in
        --build)
            FORCE_BUILD=1
            ;;
        --skip-update)
            SKIP_UPDATE=1
            ;;
        -h|--help)
            echo "用法：./docker-run.sh [--build] [--skip-update]"
            echo "  --build       无论代码是否变化都重新构建镜像"
            echo "  --skip-update 跳过 git pull / 子模块远端更新"
            exit 0
            ;;
        *)
            echo "未知参数：$arg"
            echo "用法：./docker-run.sh [--build] [--skip-update]"
            exit 2
            ;;
    esac
done

echo "=============================================="
echo "  HeySure AI 2.0 - Docker 重建 & 启动脚本"
echo "=============================================="
echo ""

git_head() {
    git rev-parse HEAD 2>/dev/null || true
}

repo_fingerprint() {
    {
        git rev-parse HEAD 2>/dev/null || true
        git submodule status --recursive 2>/dev/null || true
    } | sha256sum | awk '{print $1}'
}

read_env_value() {
    local key="$1"
    [ -f ".env" ] || return 0
    grep -E "^${key}=" .env \
        | tail -n 1 \
        | cut -d= -f2- \
        | tr -d '\r' \
        | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

if [ -f ".env" ] && [ -z "${HEYSURE_INTERNAL_TOKEN:-}" ]; then
    HEYSURE_INTERNAL_TOKEN="$(read_env_value "HEYSURE_INTERNAL_TOKEN" || true)"
    export HEYSURE_INTERNAL_TOKEN
fi
if [ -f ".env" ] && [ -z "${HEYSURE_REPO_UPDATER_TOKEN:-}" ]; then
    HEYSURE_REPO_UPDATER_TOKEN="$(read_env_value "HEYSURE_REPO_UPDATER_TOKEN" || true)"
    export HEYSURE_REPO_UPDATER_TOKEN
fi

export HEYSURE_REPO_UPDATER_PORT="${HEYSURE_REPO_UPDATER_PORT:-58151}"
export HEYSURE_REPO_UPDATER_URL="${HEYSURE_REPO_UPDATER_URL:-http://host.docker.internal:${HEYSURE_REPO_UPDATER_PORT}}"
export HEYSURE_REPO_UPDATER_TOKEN="${HEYSURE_REPO_UPDATER_TOKEN:-${HEYSURE_INTERNAL_TOKEN:-heysure-dev-internal-token-change-me}}"

echo "==> [1/5] 启动宿主版本更新服务（容器通过 HTTP 通信触发更新）..."
mkdir -p server/logs

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    mkdir -p server/data
    JSON_PYTHON_BIN="${PYTHON_BIN:-}"
    if [ -z "$JSON_PYTHON_BIN" ]; then
        if command -v python3 >/dev/null 2>&1; then
            JSON_PYTHON_BIN="python3"
        else
            JSON_PYTHON_BIN="python"
        fi
    fi
    "$JSON_PYTHON_BIN" - <<'PY'
import json
import os
import subprocess

def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True, encoding="utf-8", errors="replace").strip()

branch = git("rev-parse", "--abbrev-ref", "HEAD")
if branch == "HEAD":
    branch = ""
payload = {
    "git_available": False,
    "branch": branch,
    "current": {
        "sha": git("log", "-1", "--format=%H"),
        "short": git("log", "-1", "--format=%h"),
        "author": git("log", "-1", "--format=%an"),
        "committed_at": float(git("log", "-1", "--format=%ct")),
        "subject": git("log", "-1", "--format=%s"),
        "body": git("show", "-s", "--format=%B", "HEAD"),
        "files": [],
    },
}
path = os.path.join("server", "data", "deployed-version.json")
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
os.replace(tmp, path)
PY
fi

echo "    重启宿主更新服务，确保监听地址和 token 与当前 .env 一致..."
pkill -f "server/other/scripts/repo-updater.py" 2>/dev/null || true
sleep 1

PYTHON_BIN="${PYTHON_BIN:-}"
if [ -z "$PYTHON_BIN" ]; then
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_BIN="python3"
    else
        PYTHON_BIN="python"
    fi
fi
nohup env \
    HEYSURE_REPO_ROOT="$PWD" \
    HEYSURE_REPO_UPDATER_HOST="${HEYSURE_REPO_UPDATER_HOST:-0.0.0.0}" \
    HEYSURE_REPO_UPDATER_PORT="$HEYSURE_REPO_UPDATER_PORT" \
    HEYSURE_REPO_UPDATER_TOKEN="$HEYSURE_REPO_UPDATER_TOKEN" \
    "$PYTHON_BIN" server/other/scripts/repo-updater.py \
    > server/logs/repo-updater.log 2>&1 &
sleep 1

if curl -fsS -H "Authorization: Bearer ${HEYSURE_REPO_UPDATER_TOKEN}" "http://127.0.0.1:${HEYSURE_REPO_UPDATER_PORT}/version" >/dev/null 2>&1; then
    echo "    更新服务已启动：0.0.0.0:${HEYSURE_REPO_UPDATER_PORT}"
else
    if curl -fsS "http://127.0.0.1:${HEYSURE_REPO_UPDATER_PORT}/health" >/dev/null 2>&1; then
        echo "    警告：更新服务已启动，但版本校验失败，请查看 server/logs/repo-updater.log"
    else
        echo "    警告：更新服务启动失败，请查看 server/logs/repo-updater.log"
    fi
fi

echo ""
echo "==> [2/5] 更新 Git 仓库与子模块（web / server / device）..."
before_update_fingerprint="$(repo_fingerprint)"
if [ "$SKIP_UPDATE" = "1" ]; then
    echo "    已按参数跳过代码更新"
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [ -n "$current_branch" ] && [ "$current_branch" != "HEAD" ]; then
        echo "    更新主仓库：origin/${current_branch}"
        git fetch origin "$current_branch"
        git pull --ff-only origin "$current_branch"
    else
        echo "    当前主仓库处于 detached HEAD，跳过主仓库 pull"
    fi

    git submodule sync --recursive
    if git submodule update --init --recursive --remote --merge; then
        echo "    子模块已更新到各自远端分支最新版本"
    else
        echo "    警告：子模块远端更新失败，尝试按当前主仓库记录版本同步..."
        git submodule update --init --recursive
    fi
else
    echo "    警告：当前不是 git 仓库，跳过代码更新..."
fi
after_update_fingerprint="$(repo_fingerprint)"

echo ""
echo "==> [3/5] 构建 Docker 镜像（按需执行）..."
if [ "$FORCE_BUILD" = "1" ]; then
    echo "    已指定 --build，开始重新构建镜像..."
    docker compose --progress plain build
elif [ -z "$before_update_fingerprint" ] || [ "$before_update_fingerprint" != "$after_update_fingerprint" ]; then
    echo "    检测到主仓库或子模块版本变化，开始构建镜像..."
    docker compose --progress plain build
else
    echo "    主仓库版本未变化，跳过镜像构建；如需强制构建请运行：./docker-run.sh --build"
fi

echo ""
echo "==> [4/5] 启动所有服务（后台 detached 模式）..."
docker compose up -d

echo ""
echo "==> [5/5] 服务已启动！"
echo ""
echo "服务状态："
docker compose ps
echo ""

echo "正在实时输出日志（按 Ctrl+C 停止查看日志，服务继续后台运行）："
echo "--------------------------------------------------------------"
docker compose logs -f --tail=80
