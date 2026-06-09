# HeySure AI 2.0 企业级实施设计

> 配套文档：[`enterprise-optimization.md`](enterprise-optimization.md)（战略路线 + 数据库整改深挖）。
> **本文是工程实施设计**：按更新后的优先级逐项给出「设计目标 / 改动文件 / 代码骨架 / 验收标准」，可直接据此排期开工。
> 所有代码骨架基于对仓库的实测（pydantic-settings、FastAPI、SQLModel，截至 2026-06-09）。

## 优先级总览

| 优先级 | 主题 | 动作 | 工作量 |
| --- | --- | --- | --- |
| [P0-A](#p0-a安全加固) | **安全** | 移除硬编码 `jwt_secret`（无则启动报错）+ CORS 收白名单 | 半天 |
| [P0-B](#p0-b质量门禁) | **门禁** | 锁 Python 依赖 + GitHub Actions CI + pre-commit + ruff/mypy | 1–2 天 |
| [P1-A](#p1-a测试地基) | **测试** | pytest 覆盖 auth/services/关键 router；vitest 覆盖核心组件 | 持续 |
| [P1-B](#p1-b接口治理) | **接口** | 全局异常处理器 + request-id 中间件 + 导出 OpenAPI | 1 天 |
| [P2-A](#p2-a可观测性) | **可观测** | Prometheus `/metrics` + `/livez` `/readyz`（复用现有结构化日志） | 2–3 天 |
| [P2-B](#p2-b数据库迁移) | **迁移** | 自研 `migrations.py` → Alembic（详见 optimization §4） | 专项 |
| [P3](#p3部署与端侧) | **部署/端侧** | K8s/Helm；agent win/linux 抽公共包 | 专项 |

> 依赖关系：P0-A 与 P0-B 无前置，先做。P1-B 的 request-id 是 P2-A 链路追踪的基础，建议 P1-B 先于 P2-A。P2-B 单独拉分支。

---

## P0-A｜安全加固

### 设计目标
关键密钥**不允许回落到公开默认值**；CORS 不再对全网开放。区分 `dev` / `prod` 两种运行态：开发态保留便利默认值，生产态缺失即**启动失败**（fail-fast，而非运行期才暴露）。

### 改动文件
- `server/api/core/settings.py` — 新增 `app_env`、密钥校验、CORS 白名单字段
- `server/gateway/app.py` — CORS 从 settings 读取
- `server/.env.example` — **新建**，作为运维配置模板

### 代码骨架

**1) settings.py — 引入运行态 + fail-fast 校验**
```python
from pydantic import field_validator, model_validator

class Settings(BaseSettings):
    app_env: Literal["dev", "prod"] = Field(
        default="dev", alias="APP_ENV",
        description="部署运行态。prod 下关键密钥缺失/为默认值将拒绝启动。",
    )

    # jwt_secret 去掉公开默认值；dev 下允许空→运行期生成临时值
    jwt_secret: str = Field(default="", description="HS256 key.")

    # CORS 白名单（逗号分隔），默认空
    cors_allow_origins: str = Field(default="", alias="CORS_ALLOW_ORIGINS")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _enforce_prod_secrets(self) -> "Settings":
        if self.app_env != "prod":
            return self
        problems = []
        if not self.jwt_secret or "change-this" in self.jwt_secret:
            problems.append("JWT_SECRET 未设置或仍为默认值")
        if not self.internal_token:
            problems.append("HEYSURE_INTERNAL_TOKEN 未设置")
        if not self.cors_origin_list:
            problems.append("CORS_ALLOW_ORIGINS 未设置（生产禁止全开）")
        if problems:
            raise RuntimeError("生产配置校验失败：" + "；".join(problems))
        return self
```
> 注意：`get_settings()` 有 `lru_cache`，校验在首次构造时触发即可。dev 态下 `jwt_secret` 为空时，在认证模块用进程级随机值兜底（重启即失效，仅供本地）。

**2) gateway/app.py — CORS 收敛（当前 `app.py:134` 的 `allow_origins=["*"]`）**
```python
from api.core.settings import settings

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["http://127.0.0.1:58150"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```
> `allow_credentials=True` 与 `allow_origins=["*"]` 本就不能共存（浏览器会拒绝），收白名单后此组合才合法。

**3) server/.env.example（节选，按 settings 的 41 项整理）**
```dotenv
APP_ENV=dev
DATABASE_URL=                 # 空=回落 SQLite；生产填 postgresql+psycopg://...
JWT_SECRET=                   # 生产必填，openssl rand -hex 32
HEYSURE_INTERNAL_TOKEN=       # 进程间 /internal/* bearer，生产必填
CORS_ALLOW_ORIGINS=           # 生产必填，逗号分隔
# ... 其余按 settings.py 分组：runtime URLs / chat / 第三方 / 日志
```

### 验收标准
- [ ] `APP_ENV=prod` 且 `JWT_SECRET` 缺失/为默认 → 进程启动直接报错退出。
- [ ] `APP_ENV=dev` 不设密钥可正常本地启动。
- [ ] 生产配置下 CORS 仅放行白名单源；跨站请求被拒。
- [ ] `server/.env.example` 覆盖全部必填项。

---

## P0-B｜质量门禁

### 设计目标
依赖可复现、提交即检查、CI 拦住坏代码。**不改业务逻辑**。

### 改动文件
- `server/pyproject.toml` — **新建**，承载 ruff/mypy 配置（替换未配置的 flake8）
- `server/requirements.in` + `requirements.txt` — pip-tools 锁定
- `.pre-commit-config.yaml` — **新建**
- `.github/workflows/ci.yml` — **新建**
- `web/eslint.config.js` + `.prettierrc` + `package.json` 脚本

### 代码骨架

**1) server/pyproject.toml**
```toml
[tool.ruff]
line-length = 100
target-version = "py311"
[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]   # 渐进开启，先核心规则

[tool.mypy]
python_version = "3.11"
ignore_missing_imports = true          # 起步宽松，按模块逐步收严
warn_unused_ignores = true
```

**2) 依赖锁定（pip-tools）**
```bash
pip install pip-tools
# requirements.in 写"人维护"的直接依赖（含版本范围）
pip-compile --generate-hashes -o server/requirements.txt server/requirements.in
```
> CI 校验：`pip-compile --quiet` 后 `git diff --exit-code` 必须为空（防止锁文件与 .in 漂移）。

**3) .pre-commit-config.yaml**
```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.6.0
    hooks: [{id: ruff, args: [--fix]}, {id: ruff-format}]
  - repo: https://github.com/pre-commit/mirrors-prettier
    rev: v3.1.0
    hooks: [{id: prettier, files: ^web/}]
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks: [{id: end-of-file-fixer}, {id: check-added-large-files}, {id: detect-private-key}]
```

**4) .github/workflows/ci.yml**
```yaml
name: ci
on: { push: {}, pull_request: {} }
jobs:
  server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r server/requirements.txt
      - run: ruff check server && ruff format --check server
      - run: mypy server/api          # 起步只查共享层
      - run: pytest server -q
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm --prefix web ci
      - run: npm --prefix web run lint
      - run: npm --prefix web run build      # vue-tsc 类型检查含在 build
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -f server/Dockerfile server
      - run: docker build -f web/Dockerfile web
```

### 验收标准
- [ ] 本地 `pre-commit run --all-files` 通过。
- [ ] PR 触发 CI，三个 job（server/web/docker）全绿才可合并。
- [ ] `requirements.txt` 由 `.in` 锁定生成，CI 校验无漂移。

---

## P1-A｜测试地基

### 设计目标
锁住"改了就会坏"的核心路径，覆盖率次要。后端用临时库做隔离，互不污染。

### 改动文件
- `server/tests/` — **新建**（`conftest.py` + 分域用例）
- `server/pyproject.toml` — `[tool.pytest.ini_options]`
- `web/vitest.config.ts` + `web/src/**/__tests__/`

### 代码骨架

**1) server/tests/conftest.py — 每个测试用临时 SQLite + 覆盖 settings**
```python
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine, Session

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "dev")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    from api.core.settings import get_settings
    get_settings.cache_clear()                  # settings 是 lru_cache 单例
    from gateway.app import app
    with TestClient(app) as c:
        yield c
```

**2) 优先覆盖清单（按风险）**
| 模块 | 重点用例 |
| --- | --- |
| `api/auth.py` | 密码 hash/verify、token 签发与过期、篡改 token 被拒 |
| `api/services/*` | 核心业务方法的正常/边界/异常分支 |
| `mcp_runtime/mcp/permissions.py` | 4 级角色判定、工具最小角色边界 |
| `gateway/routers/auth.py·chat.py·agents.py` | 鉴权失败 401、关键流程 200、入参校验 422 |

**3) web/vitest** — 优先 `web/src/api/*`（API 封装）与 chat 核心组件渲染/交互。

### 验收标准
- [ ] `pytest server` 在 CI 跑通，核心模块有用例。
- [ ] 覆盖率纳入 CI（先设低门槛如 40%，逐步抬高）。
- [ ] `npm --prefix web run test` 跑通核心组件。

---

## P1-B｜接口治理

### 设计目标
错误响应格式统一、每个请求可被链路追踪、接口契约可导出。request-id 复用现有结构化日志（`logging_config._JsonFormatter`）。

### 改动文件
- `server/api/middleware/request_id.py` — **新建**
- `server/api/core/logging_config.py` — 注入 request-id 到日志
- `server/gateway/app.py` — 注册中间件 + 全局异常处理器
- `server/api/internal_client.py`（进程间调用处）— 透传 `X-Request-ID`

### 代码骨架

**1) request-id 中间件 + contextvar**
```python
# api/middleware/request_id.py
import uuid
from contextvars import ContextVar
from starlette.middleware.base import BaseHTTPMiddleware

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
        request_id_ctx.set(rid)
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response
```

**2) 日志注入**（在 `_JsonFormatter.format` 里附加，已有 JSON 输出，改动小）
```python
from api.middleware.request_id import request_id_ctx
# format() 内：payload["request_id"] = request_id_ctx.get()
```

**3) 全局异常处理器（统一响应体）**
```python
# gateway/app.py
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from api.middleware.request_id import request_id_ctx

def _body(code, message):
    return {"code": code, "message": message, "request_id": request_id_ctx.get()}

@app.exception_handler(StarletteHTTPException)
async def _http_exc(_, exc):
    return JSONResponse(status_code=exc.status_code, content=_body(exc.status_code, exc.detail))

@app.exception_handler(RequestValidationError)
async def _val_exc(_, exc):
    return JSONResponse(status_code=422, content=_body(422, "请求参数校验失败"))

@app.exception_handler(Exception)               # 兜底 5xx，避免泄露堆栈
async def _unhandled(_, exc):
    logger.exception("unhandled error")
    return JSONResponse(status_code=500, content=_body(500, "服务器内部错误"))

app.add_middleware(RequestIDMiddleware)
```

**4) 进程间透传** — 内部 `/internal/*` HTTP 调用时带上 `X-Request-ID: request_id_ctx.get()`，打通 gateway→runtime 链路。

**5) OpenAPI 导出** — FastAPI 自带 `/openapi.json` 与 `/docs`，按 `app_env` 决定生产是否暴露；可加脚本 `python -m gateway.dump_openapi > openapi.json` 供前端生成类型。

### 验收标准
- [ ] 任意 4xx/5xx 返回统一体 `{code, message, request_id}`。
- [ ] 响应头含 `X-Request-ID`；同一请求的日志可用该 id 串起。
- [ ] gateway→runtime 调用链共享同一 request-id。
- [ ] 可导出 `openapi.json`。

---

## P2-A｜可观测性

### 设计目标
在已有结构化日志基础上补齐**指标**与**标准探针**，并为分布式追踪留接口。复用 P1-B 的 request-id。

### 改动文件
- `server/api/observability/metrics.py` — **新建**
- `server/gateway/routers/health.py` — **新建** `/livez` `/readyz` `/metrics`
- `docker-compose.yml` / 部署清单 — 探针接线

### 设计要点
- **指标**：用 `prometheus-fastapi-instrumentator` 自动暴露 HTTP QPS/延迟/错误率；自定义业务指标（聊天队列深度、AI 调用耗时、MCP 工具调用次数）。
- **探针**：
  - `/livez` — 进程存活，纯返回 200，不查依赖。
  - `/readyz` — 查 DB（`SELECT 1`）+ 关键 runtime 可达，决定是否摘流。
- **追踪（留接口）**：OpenTelemetry 自动埋点 FastAPI + SQLAlchemy，trace 关联 request-id；先接 console exporter，生产再接 OTLP collector。

```python
# health.py 概要
@router.get("/livez")
def livez(): return {"status": "ok"}

@router.get("/readyz")
def readyz():
    try:
        with Session(engine) as s: s.exec(text("SELECT 1"))
        return {"status": "ready"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "not-ready"})
```

### 验收标准
- [ ] `/metrics` 暴露标准 + 自定义指标，可被 Prometheus 抓取。
- [ ] `/livez` `/readyz` 行为正确（DB 挂掉时 `/readyz` 返回 503）。
- [ ] docker-compose / K8s 探针指向 `/livez` `/readyz`。

---

## P2-B｜数据库迁移（专项）

> 完整设计见 [`enterprise-optimization.md` §4](enterprise-optimization.md#4-数据库整改重点)。此处只列实施锚点，避免重复。

- **核心目标**：自研 `migrations.py`（1722 行、SQLite/PG 双路径、无版本表）→ Alembic 单一真相。
- **五步**：引入 Alembic 生成基线 → `stamp` 现有库 → 退役 `_migrate_*` DDL 补丁 → 数据整合改 data migration（执行一次）→ 迁移与启动解耦 + 漂移检测（`alembic check`）。
- **与本文衔接**：迁移作为部署步骤（init-container / entrypoint 前置），CI 增加「空库 upgrade→downgrade→upgrade」与 0-diff 漂移检测。
- **验收**：全新 SQLite 与 PG schema 完全一致；应用启动不再执行 DDL；`migrations.py` 行数趋近 0。

---

## P3｜部署与端侧（专项）

### K8s / Helm
- 为 4 个后端进程 + web 各出 Deployment + Service；迁移作为 `helm hook` Job 或 initContainer。
- 探针接 P2-A 的 `/livez` `/readyz`；密钥走 K8s Secret / 外部 vault，不进镜像。
- HPA 按 `/metrics` 的队列深度/CPU 扩缩。

### Agent win/linux 抽公共包
- 现状 `agent/windows` 与 `agent/linux` 高度同源（见 `agent/CLAUDE.md` 的"重复代码"），通用逻辑改一处要同步两处。
- 设计：抽 `agent/core`（共享架构/协议/socket 客户端/工具基类），平台包只保留平台相关工具实现，用 workspace（npm/pnpm）组织。
- 验收：改通用逻辑只需动 `agent/core`，两端 `tsc` 编译通过。

---

## 落地顺序建议

1. **P0-A + P0-B 一起开**（安全 + 门禁）：不碰业务、风险最低，给后续所有改动提供安全网。
2. **P1-B 先于 P2-A**：request-id 是链路追踪基础。
3. **P1-A 持续推进**：与业务迭代并行，先核心后周边。
4. **P2-B（数据库）单独拉分支、单独 review**：按 optimization §4 小步可回滚。
5. **P3 在前述稳定后启动**。

> 每个优先级块都自带验收标准，可作为 PR 的 Definition of Done 直接引用。
