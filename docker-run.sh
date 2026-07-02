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

echo "=============================================="
echo "  HeySure AI 2.0 - Docker 重建 & 启动脚本"
echo "=============================================="
echo ""

if [ -f ".env" ] && [ -z "${HEYSURE_INTERNAL_TOKEN:-}" ]; then
    HEYSURE_INTERNAL_TOKEN="$(grep -E '^HEYSURE_INTERNAL_TOKEN=' .env | tail -n 1 | cut -d= -f2- || true)"
    export HEYSURE_INTERNAL_TOKEN
fi
if [ -f ".env" ] && [ -z "${HEYSURE_REPO_UPDATER_TOKEN:-}" ]; then
    HEYSURE_REPO_UPDATER_TOKEN="$(grep -E '^HEYSURE_REPO_UPDATER_TOKEN=' .env | tail -n 1 | cut -d= -f2- || true)"
    export HEYSURE_REPO_UPDATER_TOKEN
fi

export HEYSURE_REPO_UPDATER_PORT="${HEYSURE_REPO_UPDATER_PORT:-58151}"
export HEYSURE_REPO_UPDATER_URL="${HEYSURE_REPO_UPDATER_URL:-http://host.docker.internal:${HEYSURE_REPO_UPDATER_PORT}}"
export HEYSURE_REPO_UPDATER_TOKEN="${HEYSURE_REPO_UPDATER_TOKEN:-${HEYSURE_INTERNAL_TOKEN:-heysure-dev-internal-token-change-me}}"

echo "==> [1/5] 启动宿主版本更新服务（容器通过 HTTP 通信触发更新）..."
mkdir -p server/logs
if command -v ss >/dev/null 2>&1 \
    && ss -lntp 2>/dev/null | grep -q "127\.0\.0\.1:${HEYSURE_REPO_UPDATER_PORT}" \
    && ! ss -lntp 2>/dev/null | grep -q "0\.0\.0\.0:${HEYSURE_REPO_UPDATER_PORT}"; then
    echo "    检测到更新服务仅监听 127.0.0.1，容器无法访问，正在重启为 0.0.0.0..."
    pkill -f "server/other/scripts/repo-updater.py" 2>/dev/null || true
    sleep 1
fi
if curl -fsS "http://127.0.0.1:${HEYSURE_REPO_UPDATER_PORT}/health" >/dev/null 2>&1; then
    if curl -fsS -H "Authorization: Bearer ${HEYSURE_REPO_UPDATER_TOKEN}" "http://127.0.0.1:${HEYSURE_REPO_UPDATER_PORT}/version" >/dev/null 2>&1; then
        echo "    更新服务已在 127.0.0.1:${HEYSURE_REPO_UPDATER_PORT} 运行，鉴权正常"
    else
        echo "    检测到更新服务 token 不匹配，正在重启更新服务..."
        pkill -f "server/other/scripts/repo-updater.py" 2>/dev/null || true
        sleep 1
    fi
fi

if ! curl -fsS "http://127.0.0.1:${HEYSURE_REPO_UPDATER_PORT}/health" >/dev/null 2>&1; then
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
        echo "    更新服务已启动：127.0.0.1:${HEYSURE_REPO_UPDATER_PORT}"
    else
        echo "    警告：更新服务启动失败或 token 不匹配，请查看 server/logs/repo-updater.log"
    fi
else
    :
fi

echo ""
echo "==> [2/5] 更新 Git 子模块（web / server / device）..."
if git submodule update --init --recursive; then
    echo "    子模块更新完成"
else
    echo "    警告：子模块更新失败或当前不是 git 仓库，继续执行..."
fi

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

echo ""
echo "==> [3/5] 构建 Docker 镜像（实时显示构建进度）..."
docker compose build --progress plain

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
