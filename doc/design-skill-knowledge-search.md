# 设计方案：让传承技能可被 knowledge.search 检索

## 背景与问题

系统目前有两套独立的知识存储：

```
传承知识 (topics)
  → propose() / record_experience
  → KnowledgeEntry 表 + topics/*.md 文件
  → knowledge.search ✅ 可检索

传承技能 (inheritance_thoughts)
  → create_thought / install_clawhub_skill / install_npx_skill
  → inheritance_thoughts/**/SKILL.md + clawhub_state.json
  → knowledge.search ❌ 不可检索
```

用户通过 `create_thought` 写入的技能文档（如 Grok API 使用指南）无法被 `knowledge.search` 找到，原因是搜索只查 `KnowledgeEntry` 表，而传承技能不写入该表。

---

## 候选方案

### 方案 A：写入时同步（推荐）

在每次技能的**写入路径**上，同时 upsert 一条 `KnowledgeEntry`，让现有的搜索、向量索引、词法兜底对技能内容无感知地生效。

```
create_thought / install_skill / update_skill / delete_skill
        ↓
  skill 原有写逻辑（SKILL.md + JSON state）
        ↓
  同步 upsert KnowledgeEntry（memory_id = "skill:{slug}"）
        +
  sync_topic_embedding_for_entry(...)   ← 向量索引
```

搜索路径**零改动**。

### 方案 B：搜索时扫描文件目录

在 `search_knowledge` 里额外读取 `inheritance_thoughts/**/SKILL.md`，实时打分合并到结果里。

**劣势**：
- 搜索热路径变重（每次查询都要遍历文件目录）
- 向量索引需要单独给技能文件建立，逻辑散
- 维护两条搜索路径

---

## 推荐方案 A 详细设计

### 1. KnowledgeEntry 字段映射

| SKILL.md / JSON state | KnowledgeEntry 字段 |
|---|---|
| slug（如 `manual/grok-abc123`） | `memory_id = "skill:{slug}"` |
| name / displayName | `title` |
| description（frontmatter） | `summary` |
| 正文关键词（自动提取） | `triggers`（空则空串） |
| SKILL.md 路径（相对 KnowledgeBase/） | `file_path` |
| 固定 `"global"` | `scope` |
| `"active"` / `"archived"` | `status` |
| `installed_at` | `created_at` / `updated_at` |

`memory_id` 用 `"skill:"` 前缀与 topic 条目（UUID）区分，**不需要改 DB schema**。

### 2. 新增辅助函数（`librarian_service.py`）

```python
def _extract_skill_triggers(skill_md_text: str, name: str) -> str:
    """从 SKILL.md 提取触发词。
    优先读 frontmatter keywords/tags 字段；
    若没有，以 name 的词作为触发词兜底。
    """
    ...

def _sync_skill_to_knowledge_entry(
    user_id: int,
    slug: str,
    name: str,
    summary: str,
    skill_md_path: str,     # 相对 KnowledgeBase/ 的路径
    installed_at: float,
    *,
    ai_config_id: Optional[int] = None,
    status: str = "active",
) -> None:
    """将一个 skill 写入 / 更新 KnowledgeEntry（幂等）。"""
    memory_id = f"skill:{slug}"
    # 读文件提取触发词
    raw = _read_text(_topic_path(user_id, skill_md_path))
    triggers = _extract_skill_triggers(raw or "", name)
    # upsert KnowledgeEntry
    with Session(engine) as session:
        row = session.exec(
            select(KnowledgeEntry).where(
                KnowledgeEntry.user_id == user_id,
                KnowledgeEntry.memory_id == memory_id,
            )
        ).first()
        now = time.time()
        if row is None:
            row = KnowledgeEntry(
                memory_id=memory_id,
                user_id=user_id,
                title=name,
                triggers=triggers,
                summary=summary,
                file_path=skill_md_path,
                scope="global",
                status=status,
                confidence=1.0,
                created_at=installed_at,
                updated_at=now,
            )
        else:
            row.title = name
            row.triggers = triggers
            row.summary = summary
            row.file_path = skill_md_path
            row.status = status
            row.updated_at = now
        session.add(row)
        session.commit()
        session.refresh(row)
    # 触发向量索引（异步失败不影响主流程）
    try:
        sync_topic_embedding_for_entry(
            user_id=user_id, row=row,
            ai_config_id=ai_config_id, force=True,
        )
    except Exception as exc:
        logger.warning("skill embedding sync failed slug=%s: %s", slug, exc)
```

### 3. 挂钩点

在以下 5 个写路径末尾调用 `_sync_skill_to_knowledge_entry`：

| 文件位置 | 动作 | status |
|---|---|---|
| `create_inheritance_thought()` 末尾 | 手动创建技能 | `"active"` |
| `update_clawhub_installed_skill()` 末尾 | 更新技能内容 | `"active"` |
| `install_clawhub_skill()` 成功后 | ClawHub 安装 | `"active"` |
| `install_npx_skill_package()` 成功后 | npx 安装 | `"active"` |
| `delete_clawhub_installed_skill()` 末尾 | 删除技能 | `"archived"` |

### 4. 存量技能 Backfill

在 `kb_store.ensure_user_kb()` 里增加一步（已在 Gateway 启动时和登录时调用），扫描 JSON state 里的已安装技能并补写缺失的 `KnowledgeEntry`：

```python
# kb_store.py
def backfill_skill_knowledge_entries(user_id: int) -> None:
    """把 inheritance_thoughts 里的已安装技能批量写入 KnowledgeEntry（缺失时才写）。"""
    from .librarian_service import (
        _load_clawhub_state, _sync_skill_to_knowledge_entry,
    )
    state = _load_clawhub_state(user_id)
    installed = state.get("installed") or {}
    for slug, meta in installed.items():
        memory_id = f"skill:{slug}"
        with Session(engine) as session:
            existing = session.exec(
                select(KnowledgeEntry).where(
                    KnowledgeEntry.user_id == user_id,
                    KnowledgeEntry.memory_id == memory_id,
                )
            ).first()
        if existing:
            continue
        try:
            _sync_skill_to_knowledge_entry(
                user_id=user_id,
                slug=slug,
                name=str(meta.get("displayName") or meta.get("slug") or slug),
                summary=str(meta.get("summary") or ""),
                skill_md_path=str(meta.get("path") or "") + "/SKILL.md",
                installed_at=float(meta.get("installed_at") or time.time()),
            )
        except Exception as exc:
            logger.warning("backfill skill entry failed slug=%s: %s", slug, exc)
```

---

## 改动文件清单

| 文件 | 改动 |
|---|---|
| `server/main/api/services/librarian_service.py` | 新增 `_extract_skill_triggers`、`_sync_skill_to_knowledge_entry`；在 5 个写路径挂钩 |
| `server/main/api/services/kb_store.py` | 新增 `backfill_skill_knowledge_entries`；在 `ensure_user_kb()` 末尾调用 |
| `server/main/api/services/knowledge_vector.py` | 无需改动 |
| DB schema / Alembic | **无需迁移** |

---

## 权衡与边界

| 问题 | 说明 |
|---|---|
| `knowledge.search` 返回的技能条目是否包含正文？ | 是，`include_body=true` 时读 SKILL.md 文件内容 |
| 技能删除后搜索还能找到吗？ | 不能，`status="archived"` 后被过滤 |
| 技能更新后是否重新索引？ | 是，调用时触发 `sync_topic_embedding_for_entry(force=True)` |
| 技能条目的 scope 都是 global？ | 是，当前所有技能是用户级共享的 |
| 如何区分搜索结果里的 topic 和 skill？ | `memory_id` 前缀不同（`"skill:"` vs UUID），如需 UI 展示可加 `source_type` 字段（可选） |
| 是否影响 `list_thoughts` / `list_topics`？ | `list_thoughts` 不变（读 JSON state）；`list_topics` 会多出 skill 条目（符合预期） |
