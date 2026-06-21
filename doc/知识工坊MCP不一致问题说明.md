# 知识工坊 MCP 不一致问题说明

## 结论先说

系统自带的 MCP 和知识工坊里展示的“服务器端 MCP 详情”，**设计上应该是一致的**。

但当前代码里，存在一条明显的入口混用：

- 纯“系统自带 MCP”应该读取 `registry.list_tools()` 再结合 `KnowledgeBase/mcp/<namespace>/<tool>.md` 的文件覆盖。
- 但“传承技能 / 知识工坊”里某些入口实际读到的是 `builtin.inheritance_skills` 汇总视图。

因此，用户会看到：

- 同一个 MCP 在不同页面里描述不一致
- 或者“系统自带 MCP”看起来混进了在线设备上报的工具
- 或者知识工坊里展示的服务器端 MCP 详情和系统自带 MCP 详情不完全相同

这不是单纯的前端展示问题，而是**数据源和入口绑定有偏差**。

## 你期望的行为

你描述的目标应该是：

1. 系统自带 MCP 的详情页，只展示系统固定注册的 MCP。
2. 知识工坊面板里的“服务器端 MCP”详情，也展示同一份系统固定注册 MCP。
3. 这两处的名称、描述、参数说明、是否 destructive 等信息应保持一致。

换句话说：

- “系统自带 MCP” = 单一权威来源
- “作坊里的服务器端 MCP 详情” = 同一权威来源的另一种展示

## 当前实际情况

### 1. 系统自带 MCP 的生成逻辑

`_intrinsic_properties_payload()` 会：

- 读取 `registry.list_tools()`
- 结合 `KnowledgeBase/mcp/<namespace>/<tool>.md`
- 让文件里的描述和参数说明覆盖注册表原文

这部分是系统自带 MCP 的主要来源。

相关位置：

- [`server/main/api/services/librarian_service.py`](../server/main/api/services/librarian_service.py)
- [`server/main/api/services/kb_store.py`](../server/main/api/services/kb_store.py)
- [`server/main/mcp_runtime/mcp/tools/introspection.py`](../server/main/mcp_runtime/mcp/tools/introspection.py)

### 2. 知识工坊里的“传承技能”汇总逻辑

`_inheritance_skills_payload()` 会把两类东西合并：

- 服务端内置 MCP
- 当前账号在线设备实时上报的工具

这意味着它天然是一个“总合集”，不是纯系统自带 MCP。

相关位置：

- [`server/main/api/services/librarian_service.py`](../server/main/api/services/librarian_service.py)

### 3. 当前的混用点

`read_intrinsic_skills` 现在实际返回的也是 `builtin.inheritance_skills`。

也就是说，名字上看像“读取系统自带 MCP”，但实现上走了“传承技能总表”。

相关位置：

- [`server/library/handlers.py`](../server/library/handlers.py)
- [`server/main/mcp_runtime/mcp/tools/knowledge.py`](../server/main/mcp_runtime/mcp/tools/knowledge.py)

## 为什么会看起来“不一样”

主要有三个层面的原因：

### 1. 数据源本来就不是同一层

系统自带 MCP 是固定注册表 + 文件覆盖。

传承技能汇总则包含：

- 系统自带 MCP
- 在线端侧 MCP

所以它本来就不应该和纯系统自带 MCP 完全一样。

### 2. 某些入口接错了数据源

`read_intrinsic_skills` 名称暗示的是“系统自带 MCP”；

但当前实现却复用了 `builtin.inheritance_skills`。

这会导致：

- 页面标题是“系统自带”
- 实际内容却是“系统自带 + 在线设备”

用户自然会觉得不对劲。

### 3. 知识库里存在可覆盖文件

`KnowledgeBase/mcp/<namespace>/<tool>.md` 可以覆盖描述和参数说明。

因此如果某个工具文件被改过：

- `mcp.describe_tool` 的结果会变化
- 知识工坊面板里那一栏也会变化

这会进一步放大“两个页面看起来不一致”的感觉。

## 影响范围

这个问题主要影响：

- 知识工坊面板里的“传承技能 MCP”展示
- 系统自带 MCP 的详情查看
- `mcp.describe_tool` 的展示结果
- `knowledge.manage` 里内置类目读取入口的语义一致性

它不一定会影响工具执行本身，但会影响：

- 用户判断哪个工具是系统自带
- 用户判断哪个工具来自在线设备
- 用户对 MCP 说明是否可信的感受

## 推荐的理解方式

当前可以先按下面这个模型理解：

- `mcp.describe_tool`：偏向“单个工具的权威说明”
- `intrinsic_properties`：偏向“系统自带 MCP 的说明库”
- `inheritance_skills`：偏向“工坊总视图”

如果页面里把这三者混在一起，就会出现“明明应该一样，却看起来不一样”的情况。

## 最后一句话

**你期待的是对的：系统自带 MCP 和作坊里的服务器端 MCP 详情应该一致。**

当前不一致，根因不是前端排版，而是**读取路径把“系统自带”与“传承技能总表”混用了**。
