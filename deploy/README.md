# HeySure 服务端部署目录

本目录只包含服务器部署需要的两个独立子模块：

- `server/`：Python 后端（Gateway、AI、MCP、Connector 四个进程）
- `web/`：Vue Web 控制台

`device/` 位于工作区根目录，是可选的端侧开发仓库，部署 Web 与后端时无需下载。

## 只拉取部署代码

```bash
git clone <workspace-url> HeySure_AI_2.0
cd HeySure_AI_2.0
git submodule update --init --recursive -- deploy/server deploy/web
```

不要在服务器上使用 `git clone --recurse-submodules`，否则 Git 会同时拉取可选的 `device/` 子模块。

## 启动

部署编排文件仍位于工作区根目录。先复制环境变量示例，再启动：

```bash
cp .env.example .env
./docker-run.sh
```

也可以直接执行：

```bash
docker compose up -d --build
```

Compose 的所有构建上下文均指向 `deploy/server` 或 `deploy/web`，不会依赖 `device/`。
