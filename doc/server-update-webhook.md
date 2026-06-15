# 网页控制服务器更新

当应用以 Docker 镜像部署、容器内没有 `.git` 时，可在宿主机运行固定脚本 Webhook，网页负责控制立即更新和定时间隔。

## 1. 准备更新脚本

脚本应自行进入项目目录，并完成拉取和重新部署。例如 Linux：

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /opt/heysure
git pull --ff-only
python3 server/scripts/write_deploy_version.py
docker compose up -d --build
```

并确保脚本可执行：

```bash
chmod +x /opt/heysure/update.sh
```

## 2. 启动 Webhook 桥接器

桥接器只会运行 `--script` 指定的固定文件，不接受网页传入命令：

```bash
python3 server/scripts/deploy_webhook.py \
  --host 0.0.0.0 \
  --port 8765 \
  --token '替换为足够长的随机密钥' \
  --script /opt/heysure/update.sh
```

生产环境建议将它注册为 systemd 服务，并用防火墙限制 `8765` 端口只能由本机或 Docker 网段访问。

也可以使用项目内的一键安装脚本，将 Webhook 注册为开机自启的 systemd 服务：

```bash
cd /www/server/panel/data/compose/heysureai2
WEBHOOK_TOKEN='替换为足够长的随机密钥' \
  bash server/scripts/install_deploy_webhook_service.sh
```

安装后可关闭 SSH。查看状态和日志：

```bash
systemctl status heysure-update-webhook
journalctl -u heysure-update-webhook -f
```

新版桥接器会保留最近 300 行更新脚本输出，管理员后台会每 2.5 秒刷新并展示拉取、构建及部署日志。更新桥接器代码后需重启常驻服务：

```bash
systemctl restart heysure-update-webhook
```

如果服务器原来通过 cron 或宝塔计划任务定时执行 `update-heysure.sh`，请停用该任务。保留本服务常驻，并只在网页中配置更新时间。

## 3. 配置应用

在项目 `.env` 中加入：

```dotenv
HEYSURE_REPO_UPDATE_WEBHOOK_URL=http://host.docker.internal:8765/update
HEYSURE_REPO_UPDATE_WEBHOOK_TOKEN=与桥接器相同的随机密钥
```

然后执行一次：

```bash
docker compose up -d --build
```

此后管理员后台的“版本更新”页面会显示“已连接服务器更新器”，可设置更新开关、间隔，或立即触发更新。计划触发时间保存在数据库中，网关重启不会导致连续重复部署。

`update-heysure.sh` 必须在 `docker compose up` 之前执行以下命令，网页才能在容器没有 `.git` 时显示分支和提交版本：

```bash
python3 server/scripts/write_deploy_version.py
```
