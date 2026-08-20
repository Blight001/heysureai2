# HeySure 独立宿主恢复面

## 目标与边界

`host_rescue.py` 由宿主 systemd 管理，默认监听 `58152`，不运行在 HeySure
Compose 项目中，也不依赖 API Gateway、PostgreSQL 或任何应用 Runtime。即使
Gateway 因配置、镜像或启动异常完全不可用，未登录首页仍可直接连接该端口。

恢复面只提供以下固定动作：

- 查看四个 Runtime 的 Compose 状态；
- 强制重建 API Gateway；
- 按 Gateway → MCP → Connector → AI 顺序强制重建全部 Runtime。

它不接受任意命令，不提供文件、日志、数据库或 Git 操作，也不会执行迁移、重建
镜像、删除数据或重启 PostgreSQL。数据库故障和错误镜像仍需走标准发布/回滚流程。

## 认证与网络

必须在唯一 Compose 工作目录的 `.env` 中配置独立强随机
`HEYSURE_RESCUE_TOKEN`。服务在密钥缺失时拒绝启动，不回退到内部 Token，也不在
浏览器持久化密钥。该值必须与 `JWT_SECRET`、`HEYSURE_INTERNAL_TOKEN`、
`HEYSURE_BOT_ENCRYPTION_SECRET` 和更新器 Token 不同。

Web 容器默认把同源 `/host-rescue/*` 反代到宿主 `58152`，因此 Gateway 故障时仍可
访问，且 HTTPS 控制台不会产生混合内容。直接跨端口访问时，同一主机名 Origin 自动
允许；跨域名部署需设置 `HEYSURE_RESCUE_ALLOWED_ORIGINS`，也可在 Web 构建时设置
`VITE_HEYSURE_RESCUE_URL` 指向单独的 HTTPS 恢复域名。

公开 `/health` 只额外返回 `all_runtimes_unavailable` 布尔值：首页连续两次确认四个
Runtime 均不可用后才显示管理员恢复入口。该接口不返回容器名称、状态详情、配置或
凭据；Compose 状态无法确认时按 `false` 处理，避免正常首页误显示恢复入口。

宿主防火墙应只允许 Docker 网桥或管理来源访问 `58152`。即使端口不直接对公网开放，
也必须保留 Bearer 密钥认证。

## 常驻与自动恢复

systemd 单元位于：

`deploy/server/other/systemd/heysure-host-rescue.service`

单元使用 `Restart=always`，因此恢复服务自身异常退出后由 systemd 自动拉起。内置
watchdog 默认每 15 秒检查 Gateway 容器是否处于 running；连续 6 次确认容器停止后
发起一次恢复，随后至少冷却 300 秒。watchdog 只处理“容器未运行”，不会因 readiness
暂时失败干扰滚动发布。

生产安装时应将该单元安装到 systemd、执行 daemon-reload 并 enable/start。此操作会
修改宿主服务状态，必须在发布前完成只读门禁并取得当次明确运维授权。

## 验收

1. 停止或破坏 Gateway 前，先确认 `58152/health` 可达且 systemd 为 active；
2. 从未登录首页打开“管理员入口”，输入独立恢复密钥；
3. 确认四个 Runtime 状态不包含环境变量、标签或其他敏感配置；
4. 重建 Gateway 后等待其 readiness 恢复，再验证登录；
5. 复核 Compose 工作目录标签和持久化 Mount Source 没有改变；
6. 确认 PostgreSQL revision 与代码 head 一致、陈旧任务为零。
