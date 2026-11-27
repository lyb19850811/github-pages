---
report: 81
title: LangChain Agent Middleware 深度研究：机制、19 个内置中间件与版本谱系
date: 2026-11-27
tags: [langchain, middleware, agent, langgraph, llm, ai-engineering]
summary: 以 langchain-ai/langchain 与 langchain-ai/deepagents 两仓库源码（langchain 1.5.2）、官方 changelog 与 reference 为一手源，拆解 langchain.agents.middleware：六 hook 机制（节点式 before_agent/before_model/after_model/after_agent + 包裹式 wrap_model_call/wrap_tool_call，各含同步/异步两种形式）、19 个内置中间件逐个给功能与场景、3 个来自 Deep Agents 的中间件与各 provider 集成、以及从 1.0.0 到 1.5.0 的版本谱系（决策驱动中间件 ModelRouter/AutoMode 为 beta），并给出源码定位路径与未来演进方向。
math: false
---

# LangChain Agent Middleware 深度研究：机制、19 个内置中间件与版本谱系

## 一、结论先行

1. **定位**：`langchain.agents.middleware` 是 LangChain **1.0** 引入的**可组合中间件插件层**。`create_agent(..., middleware=[...])` 编译出的 LangGraph 图在每个执行节点上挂载 hook，用来拦截/改写模型调用与工具调用。中间件不是独立运行时，只是跑在 `create_agent` 返回的图里，整个 agent（含全部 hook）可以作为一个节点/子图嵌入更大的 `StateGraph`。
2. **一个基类、六个 hook**：基类 `AgentMiddleware`（`types.py`）暴露 **6 个 hook，每个都有同步/异步两种形式**（共 12 个方法）。4 个**节点式**（`before_agent`/`before_model`/`after_model`/`after_agent`，返回 dict 直接合并进 state），2 个**包裹式**（`wrap_model_call`/`wrap_tool_call`，自己决定是否调用、调用几次 handler，用于重试/缓存/短路）。
3. **19 个内置中间件**（`langchain` 1.5.2 的 `__init__.py` 导出）：从重试/降级/限额，到摘要/PII/HITL，到工具选择/模型路由/风险拦截，再到 shell/文件搜索/上下文清理/测试模拟——覆盖「可靠性、成本、安全、上下文工程、能力扩展」五类场景。
4. **另 3 个来自 Deep Agents**：官方 built-in 文档表列了 22 行，其中 `FilesystemMiddleware`、`SubAgentMiddleware`、`RubricMiddleware` 三个不在 `langchain.agents.middleware`，而在独立包 `deepagents`，通过 `create_deep_agent(middleware=...)` 接入。
5. **版本谱系**：机制本身是 **1.0.0（2025-10-20）** 的招牌能力；`ModelRetryMiddleware` 在 1.1.0 加入；`ToolErrorMiddleware` 需 ≥1.3.14；`HumanInTheLoopMiddleware` 的 `per_call` 模式在 1.4.6 加入；`ModelRouterMiddleware`/`AutoModeMiddleware`（beta，决策驱动）在 1.5.0 随 Decisions API 引入。
6. **源码**：核心在 monorepo `libs/langchain_v1/langchain/agents/middleware/`（目录名 `langchain_v1` 即 PyPI 的 `langchain` 包）。

---

## 二、机制：六个 hook 与执行流

`create_agent` 的核心 agent 循环是「调模型 → 模型选工具 → 执行工具 → 再调模型，直到不再调工具」。中间件在这条循环的每一步前后插入 hook：

| Hook | 类型 | 时机 | 典型用途 |
| - | - | - | - |
| `before_agent` | 节点式 | 每次调用开始前（一次） | 加载记忆、校验输入 |
| `before_model` | 节点式 | 每次模型调用前 | 改 prompt、裁剪消息、动态工具 |
| `wrap_model_call` | 包裹式 | 包裹每次模型调用 | 重试、缓存、换模型、短路 |
| `wrap_tool_call` | 包裹式 | 包裹每次工具调用 | 重试、权限拦截、改工具结果 |
| `after_model` | 节点式 | 每次模型响应后 | 校验输出、护栏、计数 |
| `after_agent` | 节点式 | 每次调用结束后（一次） | 保存结果、清理 |

执行流（同步形式 `X` 与异步形式 `aX` 一一对应）：

```
before_agent
 └─ before_model
     └─ wrap_model_call ── handler(model)
         └─ 若返回工具调用：
              wrap_tool_call ── handler(tool)
              └─ 回到 before_model（循环）
         └─ 若无工具调用：
              after_model
 └─ after_agent
```

两种 hook 更新 state 的机制不同：

- **节点式**直接返回 dict，经 LangGraph 的 reducer 合并进 state；
- **包裹式**对模型调用返回 `ExtendedModelResponse`（内嵌 `Command`），对工具调用返回 `Command`——这样能把「摘要触发点、usage 统计」等中间逻辑算出的值写回 state。

多中间件组合时，`Command` 各自成为一次 state 更新：messages 走 additive reducer（累加），非 reducer 字段**内层先写、外层覆盖**；若外层中间件重试导致 `handler()` 多次调用，早先调用的 command 会被丢弃（retry-safe）。

---

## 三、19 个内置中间件全表

每个中间件一个文件，下表给出类名、功能与典型场景（源码确认于 `langchain` 1.5.2）：

| 类 | 文件 | 功能 | 典型场景 |
| - | - | - | - |
| `ToolRetryMiddleware` | `tool_retry.py` | 工具调用失败按指数退避重试（`max_retries`/`backoff_factor`/`initial_delay`/`max_delay`/`jitter`/`retry_on`/`on_failure`） | 外部 API 瞬时故障、网络抖动 |
| `ToolErrorMiddleware` | `tool_error.py` | 捕获工具异常转成 `ToolMessage(status="error")` 回给模型，让模型自行纠错（**不重试**，`on_error`/`aon_error` 返回 `None` 即放行异常） | 把受控/脱敏错误暴露给模型恢复，防异常崩掉 run |
| `ModelRetryMiddleware` | `model_retry.py` | 模型调用失败指数退避重试 | 模型侧限流/瞬时错误 |
| `ModelFallbackMiddleware` | `model_fallback.py` | 主模型失败后按序切备用模型（会剥离不兼容的 Anthropic/Fireworks 缓存设置） | 高可用、多供应商兜底 |
| `ModelRefusalMiddleware` | `model_refusal.py` | 模型显式拒绝（标准 `refusal` content block）时抛 `ModelRefusalError`，而非当最终答案 | 把「拒绝」当失败处理、触发降级 |
| `ModelCallLimitMiddleware` | `model_call_limit.py` | 限制模型调用次数（线程级 `thread_limit`/单次运行级 `run_limit`，超限 `end`/`error`） | 成本上限、防失控 |
| `ToolCallLimitMiddleware` | `tool_call_limit.py` | 限制工具调用次数（按工具名或全局 `__all__`，线程级/运行级，`continue`/`error`/`end`） | 工具配额、防死循环 |
| `SummarizationMiddleware` | `summarization.py` | 接近 token 上限时自动摘要历史（`trigger` 支持 token/消息数阈值，`keep` 保留近期消息，维持 AI/Tool 消息成对；`summarizer=` 可换自定义摘要器） | 长对话上下文压缩 |
| `PIIMiddleware` | `pii.py` | 检测 email/信用卡(Luhn)/IP/MAC/URL，策略 `block`/`redact`/`mask`/`hash`，作用于输入与输出（流式跨 delta 检测） | 合规、日志脱敏 |
| `HumanInTheLoopMiddleware` | `human_in_the_loop.py` | 工具调用前 `interrupt()` 暂停，等人类 approve/edit/reject/respond；支持批量与 `per_call` 两种模式，按工具名匹配 | 敏感操作（发邮件/删数据）人工审批 |
| `TodoListMiddleware` | `todo.py` | 注入 `write_todos` 工具 + 系统提示，让 agent 规划/跟踪子任务（每轮至多调用一次） | 多步复杂任务、进度可见 |
| `LLMToolSelectorMiddleware` | `tool_selection.py` | 主模型调用前用（小）模型筛出相关工具（`max_tools`/`always_include`），减少 token | 工具数量大、降本 |
| `ModelRouterMiddleware` | `model_router.py` | 用决策模型为每次 run 选模型（`ModelChoice`，**beta**，需 `classifier=`） | 按任务难度/成本路由模型 |
| `AutoModeMiddleware` | `auto_mode.py` | 用决策模型判工具调用风险，概率 ≥0.5 直接拦下返回错误 `ToolMessage`（**beta**，需 `classifier=`） | 危险工具（删除/发布）自动风控 |
| `ProviderToolSearchMiddleware` | `provider_tool_search.py` | 把选定工具标 `defer_loading`，交给 provider 服务端工具搜索按需拉 schema（目前支持 Anthropic/OpenAI） | 工具极多时压缩请求体 |
| `ShellToolMiddleware` | `shell_tool.py` | 注册一个持久 shell 会话工具，执行策略 `HostExecutionPolicy`/`CodexSandboxExecutionPolicy`/`DockerExecutionPolicy` + `RedactionRule` | 给 agent 代码执行/命令能力 |
| `FilesystemFileSearchMiddleware` | `file_search.py` | 注入 Glob + Grep 两个工具搜索本地文件（`root_path` 限根，防越界） | 代码库搜索、文件检索 |
| `ContextEditingMiddleware` | `context_editing.py` | 输入 token 超阈值时清理旧工具结果（`ClearToolUsesEdit`，对齐 Anthropic `clear_tool_uses_20250919`） | 控制上下文增长 |
| `LLMToolEmulator` | `tool_emulator.py` | 用 LLM 模拟工具执行（默认全模拟，可按名/实例指定），不真实调用 | 测试/离线开发 |

> 除 19 个中间件外，包内还导出**非中间件类辅助设施**：`AgentState`/`InputAgentState`/`OutputAgentState`、`ModelRequest`/`ModelResponse`/`ExtendedModelResponse`/`ToolCallRequest`/`ModelCallResult`、装饰器 `before_model`/`after_model`/`before_agent`/`after_agent`/`wrap_model_call`/`wrap_tool_call`/`dynamic_prompt`/`hook_config`/`omit_payload`，以及 `configure_trace_policy`。

---

## 四、另 3 个来自 Deep Agents + provider 集成

### 4.1 Deep Agents 的三个中间件

官方 built-in 文档表列 22 行，其中 3 个不在 `langchain.agents.middleware`，来自独立包 `deepagents`（`langchain-ai/deepagents`）：

| 类 | 功能 |
| - | - |
| `FilesystemMiddleware` | 虚拟文件系统：读写/搜索/删除文件，作为 agent 长期记忆与上下文（支持后端 State/Store/ContextHub 等） |
| `SubAgentMiddleware` | 生成子 agent 委派任务（含 `AsyncSubAgentMiddleware` 支持后台异步子 agent） |
| `RubricMiddleware` | LLM-as-judge 评分，agent 自我评估并迭代直到满足 rubric |

此外 deepagents 还有 `MemoryMiddleware`、`SkillsMiddleware`、`SummarizationMiddleware`（自有实现）、`SummarizationToolMiddleware`、`UnsupportedContentMiddleware` 等，均通过 `create_deep_agent(middleware=...)` 接入。

### 4.2 Provider 集成中间件（`libs/partners/*`）

| Provider | 中间件能力 | 源 |
| - | - | - |
| OpenAI | 内容审核、模型路由、工具风险拦截 | `libs/partners/openai` |
| Anthropic | prompt 缓存、bash 工具、text editor、memory、file search | `libs/partners/anthropic` |
| AWS | prompt 缓存、AgentCore Payments | `langchain-ai/langchain-aws` |
| Azure Foundry | 文本审核、图像审核、prompt shield、受保护材料、groundedness | `langchain-ai/langchain-azure` |
| NVIDIA | 模型路由、Nemotron 3 Ultra harness 优化 | `langchain-ai/langchain-nvidia` |

---

## 五、版本谱系

机制本身是 **1.0.0** 的招牌能力（2025-10-20 GA；官方 2025-09-08 博客《Agent Middleware》先导预告）。具体中间件跨 1.0→1.5 陆续加入，changelog 可确认的关键节点：

| 时间 / 版本 | 变更 |
| - | - |
| 2025-10-20 · **1.0.0** | `create_agent` + `AgentMiddleware` 六 hook + 首批内置中间件（PII、Summarization、HumanInTheLoop 等在 GA 文档明确列出） |
| 2025-11-25 · **1.1.0** | 新增 `ModelRetryMiddleware`；`SummarizationMiddleware` 支持基于 model profile 的灵活触发点 |
| ≥ **1.3.14** | 新增 `ToolErrorMiddleware`（官方文档注明需 `langchain>=1.3.14`） |
| ≥ **1.3.16** | `ModelRetry`/`ToolRetry` 的 `default_retry_on` 语义变更（按 retryable model error 判定） |
| 2026-09-01 · **1.4.0** | MCP 支持收进 `langchain.mcp` 命名空间（`MCPAdapter`，含基于 `destructive_hint` 的 HITL 拦截元数据） |
| 2026-10-14 · **1.4.6** | `HumanInTheLoopMiddleware` 新增 `interrupt_mode="per_call"`（每次调用独立中断，官方计划下个大版本设为默认） |
| 2026-11-11 · **1.5.0** | 新增 `Decisions API`（`langchain_core.decisions`）+ 决策驱动中间件 `ModelRouterMiddleware`、`AutoModeMiddleware`（均 beta，此前在 `langchain-typesafe`）；`SummarizationMiddleware` 支持 `summarizer=` |

> 其余中间件（ToolRetry、ModelFallback、ModelRefusal、ModelCallLimit、ToolCallLimit、TodoList、LLMToolSelector、ProviderToolSearch、ShellTool、FilesystemFileSearch、ContextEditing、LLMToolEmulator）在 1.0.x–1.5.x 间增量加入，changelog 未逐类标注版本，本文不臆造精确 patch 号。

---

## 六、未来可能添加

从 changelog 与生态动态可观察到的方向：

1. **决策模型路线**：1.5.0 刚把 `ModelRouter`/`AutoMode` 引入核心，下一步大概率围绕 `BaseDecisionModel`（`Noul`/`Choice`/`Score`/`Box`）扩展更多 decision 驱动中间件——更多分类器、风险打分、选择器。
2. **HITL `per_call` 成为默认**：官方 changelog 已明言下一大版本把 `per_call` 设为默认。
3. **Provider 原生中间件下沉**：OpenAI/Anthropic/AWS/Azure/NVIDIA 的能力持续新增，可能逐步抽成 provider-agnostic 核心中间件。
4. **MCP 相关**：1.4.0 把 MCP 收进核心，`MCPAdapter` 已能基于 `destructive_hint` 配合 HITL 拦截，后续可能出 MCP 专属中间件。
5. **Deep Agents 侧**：`CodeInterpreterMiddleware`（QuickJS 沙箱）、memory/skills/compaction 等持续演进，部分可能回流入核心。
6. **社区生态**：官方集成目录已收录 80+ 第三方中间件（授权/护栏/成本上限/安全审计/PII 等），是明显的主攻扩展点。

---

## 七、源码定位

**核心中间件（`langchain` PyPI 包）**，在 monorepo 中目录名是 `langchain_v1`：

```
https://github.com/langchain-ai/langchain/tree/main/libs/langchain_v1/langchain/agents/middleware/
```

文件 → 内容映射：

- `types.py` — `AgentMiddleware` 基类 + 6 个 hook + `ModelRequest`/`ModelResponse`/`ExtendedModelResponse`/`AgentState` 等（**先读这个**）
- `__init__.py` — 全部公开导出（`__all__`）
- 每个中间件一个文件：`auto_mode.py` `context_editing.py` `file_search.py` `human_in_the_loop.py` `model_call_limit.py` `model_fallback.py` `model_refusal.py` `model_retry.py` `model_router.py` `pii.py` `provider_tool_search.py` `shell_tool.py` `summarization.py` `todo.py` `tool_call_limit.py` `tool_emulator.py` `tool_error.py` `tool_retry.py` `tool_selection.py`
- 内部辅助：`_execution.py`（shell 执行策略 Host/CodexSandbox/Docker）、`_redaction.py`（PII 规则）、`_retry.py`（重试/退避）、`_trace_policy.py`

**本地已安装时**：

```python
import langchain, os
print(os.path.dirname(langchain.__file__))
# → site-packages/langchain/agents/middleware/
```

**Deep Agents 中间件**：

```
https://github.com/langchain-ai/deepagents/tree/main/libs/deepagents/deepagents/middleware/
```

**Provider 集成中间件**：

```
https://github.com/langchain-ai/langchain/tree/main/libs/partners/<provider>/langchain_<provider>/middleware/
```

**参考**：官方指南 `https://docs.langchain.com/oss/python/langchain/middleware/`（overview / built-in / custom 三篇）；API reference `https://reference.langchain.com/python/langchain/agents/middleware`。

---

## 附录：最小使用示例

```python
from langchain.agents import create_agent
from langchain.agents.middleware import (
    SummarizationMiddleware,
    HumanInTheLoopMiddleware,
    ToolRetryMiddleware,
)

agent = create_agent(
    model="claude-sonnet-4-6",
    tools=[read_email, send_email],
    middleware=[
        ToolRetryMiddleware(max_retries=3, tools=["send_email"]),
        SummarizationMiddleware(model="claude-sonnet-4-6", trigger={"tokens": 500}),
        HumanInTheLoopMiddleware(
            interrupt_on={"send_email": {"allowed_decisions": ["approve", "edit", "reject"]}}
        ),
    ],
)
```
