# 动态 MCP 工具可见性与元数据矛盾汇总

> 本文档记录「工具箱 MCP / 可用MCP工具 目录」与「图书馆 MCP」在**显示/说明**层面的矛盾。
> 现象：模型/用户能看到不该看到的东西，或该有的中文注释缺失。
> 核心矛盾：**“配置里写了 / 历史上存在” ≠ “当前运行时实际可用 + 有完整元数据”**。
> 绑定/权限/重构后的门禁只作用于**执行时**，未同步到 **catalog 渲染 / 提示注入 / 动态说明** 路径。

更新日期：2026-06-21

---

## 矛盾点 1：子动作名（非真实工具）缺少中文注释

### 现象
在「[动态 MCP 说明] 工具箱 MCP」或「可用MCP工具」目录中出现以下展开形式：

```text
admin/
  - admin.get_overview
  - admin.list_agents
conversation/
  - conversation.create
  - conversation.delete
  - conversation.detail
  - ...
prompt/
  - prompt.list_targets
  - prompt.read_ai
  ...
task/
  - task.create
  - task.complete !: ...
workspace/
  - workspace.search
```

很多条目只有名字，没有 `: 中文说明`。

### 期望
每个可调用的 MCP 工具（即使是子动作）在动态目录中都有简洁的中文注释，模型可直接定位。

### 实际
- 只有**真正注册的工具名**才有 description。
- 子动作名（`conversation.create`、`admin.get_overview`、`prompt.list_targets` 等）**从未作为独立 MCPTool 注册**。

### 根源
1. **历史重构**：早期拆成很多细粒度工具，后统一为 `*.manage` + action。
   - 见 `server/main/api/core/migrations.py` 大量 rename：
     ```python
     "conversation.create": "conversation.manage",
     "admin.get_overview": "admin.manage",
     "prompt.list_targets": "prompt.manage",
     ...
     ```
2. **当前注册只有统一门面**（`server/main/mcp_runtime/mcp/registry.py`）：
   - `admin.manage`、`conversation.manage`、`prompt.manage`、`task.manage`、`workspace.manage` 等。
   - 少数平铺工具保留：`mcp.describe_tool`、`message.send_to_*`、`task.complete`、`workspace.run_command` 等。
3. **动态元数据链路只认真实注册名**：
   - `MCPRegistry.list_tools()` → description 来自注册时硬编码的中文。
   - `kb_store.seed_mcp_tools()`（librarian_service.py）只为真实 name 建 `KnowledgeBase/mcp/<ns>/<name>.md`。
   - `intrinsic_tool_description` / `effective_tool_description` 优先读 .md。
   - `_render_mcp_tool_catalog`（chat_prompt_utils.py:359）：
     ```python
     if name in desc_by_name:
         ...
     else:
         continue  # stale 直接丢弃
     line = f"  - {name}{marker}: {short}" if short else f"  - {name}{marker}"
     ```
4. **子动作只存在于文档/提示**：
   - `DEFAULT_MCP_NAMESPACE_HINTS`（models/defaults.py）
   - 各个 `*.manage` 工具的 description 文本
   - 旧 allowlist / 权限记录

**结果**：子动作名在“说明”中被人为展开后，没有独立的中文 description。

---

## 矛盾点 2：未绑定图书馆仍能看到「图书馆 MCP」

### 现象
- AI 未连接/绑定图书馆（`config_bound_to_library` == false），但在「可用MCP工具」目录或动态说明中仍出现：
  ```text
  admin/
    - admin.manage: ...图书馆 MCP
  ```
- 同一块内容重复出现多次（用户贴了 6+ 个几乎相同的 `admin.manage` 块）。
- 描述被截断后带上「图书馆 MCP」后缀（`...已连接端…图书馆 MCP`）。

### 期望
- 未绑定图书馆时，图书馆治理工具（LIBRARY_BOUND_TOOLS）**不应出现在当前可调用的目录**中。
- 工具箱 MCP 与 图书馆 MCP 严格按当前绑定状态区分显示。
- 目录只出现一次，无文本污染。

### 实际
图书馆工具仍然被塞进 effective_tool_allowlist 并渲染进 catalog。

### 根源

#### A. 图书馆工具定义
```python
# permissions.py:92
LIBRARY_BOUND_TOOLS = {
    "prompt.manage", "admin.manage", "device_mcp.manage", "knowledge.manage"
}
```

#### B. 绑定检查只在执行层
```python
# mcp_runtime/mcp/core.py:212
if requires_library_binding(tool_name):
    if not config_bound_to_library(user_id, ai_config_id):
        raise HTTPException(...)
```
同理还有 toolbox 绑定检查。

#### C. Catalog 构建完全绕过绑定检查（最关键）

**路径 1（聊天）**：
```python
# chat_runtime/chat_runtime_helpers.py:107
effective_tool_allowlist = _parse_allowed_tools(cfg.mcp_tools)
effective_tool_allowlist.update(MCP_INTROSPECTION_TOOLS)
effective_tool_allowlist.update(endpoint_...)
# ... 各种追加后
_render_mcp_tool_catalog(effective_tool_allowlist, ...)
```

**路径 2（AI 推理 worker）**：
```python
# ai_runtime/inference/core.py:1330 附近
effective_tool_allowlist = ...
# 同样无 binding 过滤
_render_mcp_tool_catalog(...)
```

- `_parse_allowed_tools` 只做 JSON 解析。
- `clamp_tools_json` **故意保留** LIBRARY_BOUND_TOOLS（注释：作坊 UI 按 AI 勾选）。
- 没有类似 endpoint 那样的 `if not bound: discard` 逻辑。

#### D. UI 分组也泄露
```python
# api/services/mcp_prompt_groups.py:106
library_tool_names = { name for name in ... if name in LIBRARY_BOUND_TOOLS }
...
if library_tools:
    groups.append({ "groupLabel": "图书馆 MCP", ... })
```
` _agents_for_prompt_groups` 有部分绑定判断，但 library_tool_names 收集时不检查当前是否真的 bound。

#### E. 重复与文本污染
- `_append_prompt_section` + `_strip_prompt_section`（chat_prompt_utils.py:52）：
  ```python
  pattern = re.compile(rf"\n*\[{re.escape(section_title)}\]\n[\s\S]*?(?=\n\[[^\n]+\]\n|$)")
  ```
  - 多次调用注入（普通路径 + task override + 上下文重组）时 strip 不干净 → 区块重复。
- `_short_tool_desc` 截断 + 后续提示词或 group label 文本（“图书馆 MCP”）在用户观察/复制时出现拼接。
- 同一 admin.manage 在不同分组逻辑里被多次拉入。

#### F. 其他相关
- `mcp_prompt_groups.py` 中的 “工具箱 MCP” / “图书馆 MCP” 分组用于前端预览和某些提示。
- `librarian_service.py` 的 `_intrinsic_properties_payload` 虽然按 scope 分 toolbox/library，但最终 prompt catalog 走的是 AI config 的 allowlist。
- `workshop/engine.py` 把图书馆当作虚拟 device，但运行时 catalog 没严格对齐。

---

## 共同根因总结

| 层面         | 工具箱（默认可用） | 图书馆（需绑定） | 端侧动态工具     | 说明/元数据来源                  |
|--------------|-------------------|------------------|------------------|----------------------------------|
| 注册         | registry.py      | 同左            | device 推送 + workspace | registry + seed                  |
| 可见性决定   | cfg.mcp_tools    | cfg.mcp_tools   | presence + scope | **无 current binding 过滤**     |
| 执行门禁     | is_toolbox_gated | requires_library| 各自权限         | core.py enforce + workshop       |
| 描述中文     | registry + KB md | 同左            | definitions.json + agent 上报 | 只有真实 name 能拿到             |
| Catalog 渲染 | _render_mcp_tool_catalog（两者共用） | 同左            | 同左             | 直接消费 effective allowlist     |

**核心矛盾**：
- “配置存储的值” 和 “当前会话/实例的实际能力” 被当成一回事。
- 重构（统一 manage） + 绑定机制（workshop device）引入后，**显示层没有跟进过滤**。
- 自省工具（mcp.describe_tool）和 namespace hints 部分有“需绑定”文字，但 flat catalog 仍然全量暴露。

---

## 关键文件路径（快速跳转）

### 渲染 Catalog 的核心
- `server/main/api/chat_runtime/chat_prompt_utils.py`
  - `_render_mcp_tool_catalog`
  - `_short_tool_desc`
  - `_strip_prompt_section` / `_append_prompt_section`
- `server/main/api/chat_runtime/chat_runtime_helpers.py`
  - 组装 effective_tool_allowlist + 注入「可用MCP工具」
- `server/main/ai_runtime/inference/core.py`
  - 同上（AI worker 路径）

### 权限与绑定
- `server/main/mcp_runtime/mcp/permissions.py`
  - `LIBRARY_BOUND_TOOLS`
  - `requires_library_binding`
  - `is_toolbox_gated_tool`
  - `clamp_tools_json`（故意保留图书馆工具）
- `server/main/mcp_runtime/mcp/core.py`
  - `_enforce_workshop_binding`
- `server/main/api/workshop_bindings.py`
  - `config_bound_to_library`
  - `config_bound_to_toolbox`

### 种子与描述优先级
- `server/main/api/services/librarian_service.py`
  - `_intrinsic_properties_payload`
  - `intrinsic_tool_description`
  - `seed_mcp_tools`
- `server/main/api/services/kb_store.py`
  - `effective_tool_description`
  - `seed_mcp_tools`

### UI 分组与图书馆展示
- `server/main/api/services/mcp_prompt_groups.py`
  - `build_prompt_tool_groups`
  - “图书馆 MCP” / “工具箱 MCP” group 构造
- `server/workshop/engine.py`
  - 虚拟 library / toolbox device

### 历史痕迹
- `server/main/api/core/migrations.py`（大量工具名重命名）
- `server/main/api/models/defaults.py`（DEFAULT_MCP_NAMESPACE_HINTS）

### 注册源
- `server/main/mcp_runtime/mcp/registry.py`（所有内置工具的中文 description）

---

## 建议后续修改方向（备忘）

1. **在 catalog 构建处增加绑定过滤**（最直接）：
   - 在 chat_runtime_helpers 和 inference/core 组装 effective_tool_allowlist 后：
     ```python
     if ai_config_id and not config_bound_to_library(...):
         effective_tool_allowlist -= LIBRARY_BOUND_TOOLS
     if ... not bound_to_toolbox:
         effective_tool_allowlist -= toolbox_gated_tools
     ```
   - mcp.describe_tool 保持豁免。

2. **让 _render_mcp_tool_catalog 也接受绑定状态** 或直接在内部过滤（更健壮）。

3. **统一“当前可用工具集”计算函数**：
   - 抽取一个 `get_effective_mcp_tools_for_prompt(user_id, ai_config_id)`，同时处理：
     - mcp_tools
     - library binding
     - toolbox binding
     - endpoint presence/scope
     - introspection 强制项

4. **重复注入问题**：
   - 加强 strip（支持更宽松的匹配、记录已注入标志）。
   - 考虑把 catalog 作为独立可缓存片段，只在必要时重算。

5. **子动作中文问题**（可选）：
   - 或者彻底放弃在 catalog 里展开子动作，只靠 `*.manage` 的 description + describe_tool。
   - 或者为子动作生成虚拟描述条目（较重）。

6. **测试点**：
   - 未绑图书馆的 AI，admin.manage / prompt.manage 应不出现在可用MCP工具目录。
   - 绑了才出现。
   - 多次对话 / task 运行时，目录不会重复。
   - 新建 AI（无 KB mcp/*.md）仍能拿到注册时的中文描述。

---

**定位关键词**（grep 时用）：
`LIBRARY_BOUND_TOOLS`、`config_bound_to_library`、`可用MCP工具`、`mcp_tool_catalog`、`图书馆 MCP`、`工具箱 MCP`、`intrinsic_properties`、`seed_mcp_tools`、`effective_tool_allowlist`

---

此文档可作为后续重构 catalog 可见性逻辑的起点。所有矛盾都指向同一个设计裂缝：**显示与执行的权限/绑定模型不同步**。