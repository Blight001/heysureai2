"""Skill Card tables — reusable, shareable operation skills.

See ``doc/沉淀技能卡片-设计方案.md`` for the full design. A skill card固化一段
已验证成功的动作序列，可被其它 AI 跨环境复用。四张表：

- ``SkillCard``          卡片当前（head）版本：分类、能力契约、参数、步骤、断言
- ``SkillCardVersion``   版本历史快照：支持回滚与 copy-on-heal/fork 审计
- ``SkillCardRunStat``   按环境维度的执行统计：信任分按 (card, env) 计，不全局共享
- ``SkillCardRecording`` 进行中的录制会话：跨进程抄录裸事件流，stop 时加工成 draft 卡片

结构化字段（domain / capability / params / preconditions / steps /
postconditions）以 JSON 字符串落库，与 ``AITaskJob.task_payload`` 同一约定
（``json.dumps(..., ensure_ascii=False)``）。
"""

import time
from typing import Optional

from sqlmodel import Field, SQLModel


class SkillCard(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    card_id: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    owner_ai_config_id: Optional[int] = Field(default=None, index=True)  # 创建者 AI

    name: str
    description: Optional[str] = None

    # 四个正交分类维度（见设计方案 §2）。
    surface: str = Field(default="windows", index=True)   # windows/browser/shell/composite，硬绑定执行端
    scope: str = Field(default="private", index=True)     # private/team/public，共享范围
    status: str = Field(default="draft", index=True)      # draft/supervised/trusted/deprecated
    domain: Optional[str] = None                          # JSON list[str]，业务域，软检索

    version: int = Field(default=1, index=True)           # 当前 head 版本号

    # 能力契约（JSON list[str]）：卡片会调用哪些工具。执行时与调用方权限取交集（§6.2）。
    capability: Optional[str] = None
    # 作用域锁定（JSON）：识别只在此窗口内进行，进程层硬隔离（§2.2）。
    app_scope: Optional[str] = None
    # 结构化主体（均为 JSON 字符串）。
    params: Optional[str] = None
    preconditions: Optional[str] = None
    steps: Optional[str] = None
    postconditions: Optional[str] = None

    environment_signature: Optional[str] = Field(default=None, index=True)  # 录制环境，信任分归属
    forked_from_card_id: Optional[str] = Field(default=None, index=True)    # copy-on-heal 来源（§6.4）

    created_at: float = Field(default_factory=time.time, index=True)
    updated_at: float = Field(default_factory=time.time)


class SkillCardVersion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    card_id: str = Field(index=True)
    version: int = Field(index=True)
    author_ai_config_id: Optional[int] = Field(default=None, index=True)
    change_summary: Optional[str] = None
    snapshot: Optional[str] = None  # JSON：该版本完整卡片，支持回滚
    created_at: float = Field(default_factory=time.time, index=True)


class SkillCardRunStat(SQLModel, table=True):
    """按 (card_id, environment_signature) 维度的执行统计。

    信任分不是全局的：A 机器 99% 成功率不代表 B 机器能跑（§6.3），所以统计与
    晋升判断都按环境分别累计。
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    card_id: str = Field(index=True)
    environment_signature: str = Field(default="", index=True)
    version: int = Field(default=1)
    runs: int = Field(default=0)
    success: int = Field(default=0)
    fail: int = Field(default=0)
    consecutive_success: int = Field(default=0)
    consecutive_fail: int = Field(default=0)
    trust_score: float = Field(default=0.0)
    last_failed_step: Optional[int] = None
    last_run_at: Optional[float] = Field(default=None, index=True)


class SkillCardRecording(SQLModel, table=True):
    """An in-progress recording session (S4，见设计方案 §4.0/§4.1）。

    录制状态必须跨进程共享：``recorder.start/stop`` 跑在 mcp-runtime，而 dispatch
    咽喉点的抄录发生在 ai-runtime 的 ``core.py``——两边是不同进程，只能靠数据库这
    一共享面对接，不能用模块级变量或 contextvar。

    每个 ``(user_id, ai_config_id)`` 同一时刻最多一条 ``recording`` 行。流经咽喉点
    的操作类工具调用以原始事件形式追加进 ``events``（JSON list）；``recorder.stop``
    时把裸事件流加工成卡片 steps（锚点提取 / 脱敏 / 断言 / 噪声过滤），存成 draft
    卡片并把本行置 ``stopped``，记下 ``card_id``。
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    recording_id: str = Field(index=True, unique=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    ai_config_id: Optional[int] = Field(default=None, index=True)
    session_id: Optional[str] = Field(default=None, index=True)

    name: str
    description: Optional[str] = None
    surface: str = Field(default="windows")
    scope: str = Field(default="private")
    mode: str = Field(default="auto")              # auto(自动抄录) | teach(逐步教学)，见 §4.0
    domain: Optional[str] = None                   # JSON list[str]
    app_scope: Optional[str] = None                # JSON：作用域锁定（§2.2）
    environment_signature: Optional[str] = None

    status: str = Field(default="recording", index=True)  # recording | stopped | cancelled
    events: Optional[str] = None                   # JSON list：抄录的裸事件流
    annotations: Optional[str] = None              # JSON：teach 模式人工标注（断言/消歧/脱敏）
    card_id: Optional[str] = Field(default=None, index=True)  # stop 后生成的 draft 卡片

    created_at: float = Field(default_factory=time.time, index=True)
    updated_at: float = Field(default_factory=time.time)
