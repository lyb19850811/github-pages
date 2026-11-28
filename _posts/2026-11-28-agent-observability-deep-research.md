---
report: 82
title: 智能体研发中的可观测性：为什么、怎么做，以及 Oh My Pi 的落地
date: 2026-11-28
tags: [observability, opentelemetry, agent, llm, coding-agent, oh-my-pi, ai-engineering]
summary: 以 Oh My Pi（omp）的 harness 文档与 telemetry.dev/Arize/Sentry 三套第三方集成为一手源，拆解智能体可观测性：为什么「监控」不够、为什么 agent 需要以「一次 run 为 trace、LLM call/tool call 为 span」重建观测模型；以及 Oh My Pi 如何把可观测做成 harness 一等公民——append-only JSONL 会话文件作为单一真相层、16 类结构化 entry + model_usage 副账本、SDK/JSON/RPC 三套程序化事件流、omp stats 本地仪表盘、OpenTelemetry 钩子与三方薄扩展、omp stream 实时屏幕直播。
math: false
---

# 智能体研发中的可观测性：为什么、怎么做，以及 Oh My Pi 的落地

## 一、结论先行

1. **为什么**：智能体是「模型循环 + 工具调用 + 重试/压缩」的非确定性、多步、长时、成本敏感软件。传统「日志/指标/追踪」三件套假设执行是一条**确定性的函数调用树**，而 agent 的执行是「一次 run 里反复调模型、模型决定调哪个工具、结果又喂回模型」的循环，还夹杂压缩、重试、降级、后台子智能体。要回答「它为什么这么做、钱花在哪、哪一步慢了/错了/重复了」，就必须把可观测从「已知告警」升级为「能回答任意未预见问题的能力」，并重建观测模型：**trace = 一次 agent run，span = 一次 LLM call / 一次 tool call**，外加 session 分组、token/cost/缓存指标、以及贯穿重试与压缩的「最终结果 vs 中间过程」的边界。

2. **怎么做（通用）**：三条信号 + 四类 agent 专属维度。
   - 信号：结构化 events（生命周期）+ logs + metrics + traces，统一到 OpenTelemetry GenAI 语义约定（`gen_ai.*`）与 OpenInference span kind（`CHAIN`/`LLM`/`TOOL`/`AGENT`）。
   - 维度：模型/供应商、token（输入/输出/cache 读/写）、成本、TTFT/延迟、finish reason/错误、工具（名称/入参/结果/耗时）、重试与压缩次数、子智能体树。
   - 隐私是硬约束：内容捕获（prompt/tool 结果/文件内容）必须与元数据捕获解耦、可逐项关闭。

3. **Oh My Pi 怎么落地**：把可观测做成 harness 的**一等公民**，而非事后接入第三方 SDK。四层：
   - **持久层（单一真相层）**：append-only JSONL 会话文件 + 16 类结构化 entry + `model_usage` 副账本 + 退出诊断 + 会话树（branch/fork/replay）。
   - **程序化事件流**：SDK `subscribe()`、`--mode json`、`--mode rpc`/`rpc-ui`/`acp` 三套结构化流。
   - **指标/仪表盘**：`omp stats` 本地仪表盘（SQLite 小时级 rollup + 11 个页面 + SSE 实时）。
   - **分布式追踪 + 实时**：`telemetry: {}` 的 OpenTelemetry agent-loop spans，第三方（telemetry.dev、Arize、Sentry）只是挂在上面的薄扩展；`omp stream` 提供脱敏的屏幕级实时直播与录制。

4. **成本与适用边界**：可观测的成本大头不在 CPU/磁盘，而在 ① 实现与维护、② 隐私/合规（「内容出机器」是硬约束、不可逆）、③「为观测而观测」的噪声。Oh My Pi 把前两项压到接近零——核心观测（会话文件 + 事件流）是 harness 运行的一部分，出口（`omp stats`/第三方/`omp stream`）按需自选。**是否上观测，判据是「贵、慢、错」三个痛之一是否出现**：长时自治任务、烧真金白银、多步重试、团队/CI/合规/要回放时才需要；一次性问答、正盯着 TUI 看、原型探索期、`--no-session` 临时跑时不需要。

---

## 二、可观测性是什么：从监控到可观测

### 2.1 定义边界

「可观测性（observability）」一词借用控制论：**能通过系统的外部输出，推断其内部状态的能力**。软件工程里，它通常被引为 Honeycomb 的实用定义——**可观测让你能回答「系统正在发生什么、为什么」这类你在动手前没有预料到的问题**。

它和「监控（monitoring）」的区别在于问题的可预见性：

| | 监控 Monitoring | 可观测 Observability |
|---|---|---|
| 回答的问题 | 已知的（服务是否 5xx、CPU 是否打满） | 未知的、未预见的（「为什么这个 agent 在这个会话里重试了 7 次？」） |
| 数据形态 | 预聚合指标 + 预定义告警 | 高基数、可任意下钻的原始事件/追踪 |
| 驱动方式 | 告警先行 | 探索/追问先行 |
| 典型口号 | "is it up?" | "why is it slow / wrong / expensive?" |

### 2.2 三大信号 + events

现代可观测性的共识是三条信号（OpenTelemetry 的三支柱）：

- **Logs**：带时间戳、离散、不可变的事件记录。
- **Metrics**：预聚合的数值（计数器、直方图、仪表），低基数、可查询、可告警。
- **Traces**：一次请求的**有向无环图**，把多个 span 按父子关系串起来，保留因果与耗时。
- **Events（结构化事件）**：高基数、schema 化、可任意组合查询的「日志的进化形态」——Honeycomb 流派把它当作第四信号，是回答「未知-未知」问题的关键。

对 agent 而言，traces 的语义需要**重写**（见 §3），events 则天然对应「会话生命周期事件」（`agent_start`/`turn_start`/`tool_execution_start`/`compaction`…）。

### 2.3 为什么传统三件套在 agent 上失效

传统微服务可观测的前提假设，在 LLM/agent 上逐一被打破：

1. **执行不是一棵静态调用树**。一个 HTTP 请求的 span 树在进入时就能确定「调了 A → B → C」；而 agent 的下一步调用**由模型的输出决定**（模型说调 `bash` 还是 `grep`，跑完再决定下一步）。trace 只有在 run 结束时才知道长什么样。
2. **不确定性与不可复现**。同样的 prompt，两次输出不同；「正确」不再是布尔值，而是「有没有达成用户意图」。观测必须同时记录**输入 prompt、模型输出、工具结果**，否则事后无法回答「它为什么选了这条路」。
3. **长时、多步、有中间态**。一次 run 可能持续数分钟、做几十次工具调用，中间还可能**压缩上下文（compaction）**——观测必须能把「被压缩掉的历史」与「当前活上下文」区分开。
4. **成本是核心维度**。token 用量、cache 命中率、TTFT、API 等价成本不是「运维指标」，而是「这个 agent 值不值得跑」的第一性问题。这些必须**结构化地落在每一次模型调用上**。
5. **工具副作用 + 多智能体**。工具会改文件、跑命令、开浏览器；子智能体可能在独立进程里跑。观测要跨进程、跨会话树地把父子关系串起来。

一句话：agent 可观测的问题不是「多打几条日志」，而是**观测模型本身要从「调用树」升级为「agent run 的轨迹 + 语义」**。

---

## 三、智能体可观测怎么做（通用建模）

### 3.1 核心对象：run / LLM call / tool call

OpenTelemetry GenAI 语义约定与 Arize OpenInference 共同确立了 agent 观测的三个核心 span 粒度：

| 对象 | span kind | 承载什么 |
|---|---|---|
| **一次 agent run** | `CHAIN`（OpenInference）/ `AGENT` | 用户 prompt → 最终回答；输入是 prompt，输出是最终 assistant 文本；含其间一切 retry/compaction |
| **一次模型调用** | `LLM` | provider、model、输入/输出 token、cache 读/写 token、cost、latency、TTFT、finish reason、错误 |
| **一次工具调用** | `TOOL` | tool 名、入参、结果、耗时、错误；挂在触发它的那次 LLM call 之下 |

关键语义属性（`gen_ai.*`）：`gen_ai.system`、`gen_ai.request.model`、`gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`、`gen_ai.usage.input_tokens_details.cached_tokens`、`gen_ai.agent.name` 等。OpenInference 则用 `llm.token_count.prompt/completion`、`input.value` / `output.value` 与 `input.mime_type`（区分文本/图片/JSON）。

### 3.2 agent 专属的四个观测维度

在通用三信号之上，agent 观测多出四类维度，缺一不可：

1. **会话分组（session）**：一次 run 属于哪个会话；跨会话的 `session.id` 把「同一任务的多次 run」归并。
2. **中间态 vs 最终态**：`agent_end` 只应在「真正结束」（无 streaming、无续跑、无后台 job、无子智能体可唤醒它）时触发；「模型循环停了但 run 还在」应发 `agent_pause`。观测必须能区分「这一轮结束了」与「这件事做完了」。
3. **重试 / 压缩 / 降级**：retry、fallback、compaction 是 agent 独有的高频事件，既要进 trace，也要进指标（错误率、cache 命中率、重试次数）。
4. **子智能体树**：主 agent 通过 `task` 工具起子智能体时，子智能体往往在独立进程，观测要能跨进程把它们接回父 trace（或至少以 session 归属可见）。

### 3.3 隐私是硬约束

agent 观测的数据天然高危：prompt 里可能含代码、密钥、企业内部文档；工具结果可能含文件内容、命令输出。因此**内容捕获必须与元数据捕获解耦**：

- 元数据（模型名、token 数、耗时、成本、错误、session id）默认可采。
- 内容（prompt、system prompt、assistant 文本、tool 入参/结果）应**逐类可关**，且支持 `mask` 改写/丢弃单值。

三套第三方集成（见 §9）都遵循这一模式：telemetry.dev 提供 `captureInput`/`captureOutput`/`mask`；Arize 提供 `ARIZE_LOG_PROMPTS`/`ARIZE_LOG_TOOL_DETAILS`/`ARIZE_LOG_TOOL_CONTENT`；Sentry 提供 `dataCollection.genAI.inputs`/`outputs`。

---

## 四、Oh My Pi：为什么这么设计（设计哲学）

在回答「体现在哪里」之前，先看它背后的三条设计决策，因为每一层观测面都是这三条的推论。

### 4.1 文件即真理：单一真相层

Oh My Pi 把会话本身持久化为 **append-only 的 JSONL 文件**：

```text
~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl
```

每行一个 JSON 对象（一个 entry），文件头是一个 256 字节的 title slot，接着是 session header（version 3），之后是逐条 entry。**没有单独的「日志系统」**——会话文件既是对话记录、也是状态账本、也是观测数据的唯一来源。所有下游观测（`omp stats`、HTML 导出、第三方追踪）都是从这份文件（或它流式产生的等价事件）推导出来的，而不是「边跑边往第二处埋点」。

这条决策的直接后果：**可迁移、可审计、可回放**。文件拷走就是完整历史；任何一条 entry 都有 `id`/`parentId`/`timestamp`，能还原出因果链。

### 4.2 观测即会话：树 / 回放 / 审计是副产物

会话不是一条线性日志，而是 **append-only tree + 可变 leaf 指针**：

- 普通 append 造一个新 entry（`parentId = leafId`）并推进 leaf。
- `branch(entryId)` 只移动 leaf；`fork` 复制整棵会话；`/tree`、`/branch` 让用户在树上跳转。
- `buildSessionContext()` 从 leaf 沿 `parentId` 回溯到根，重建「发给模型的那段上下文」。

于是「可观测」所需的**回放、分支、审计、时间线**，全都成了会话模型的自然副产物：想回到某个点重跑，就是树上的一次 leaf 移动；想审计「模型在哪个时刻换过、thinking 在哪个时刻调过」，就是过滤 entry 类型。

### 4.3 本地优先、开放事件面、成本可见

- **本地优先/隐私**：默认本地 SQLite、本地仪表盘；`omp stream` 永不发送会话条目、只发送脱敏后的屏幕行；内容捕获在第三方集成里逐类可关。
- **开放事件面**：`pi.on(...)` 暴露全生命周期事件（`session_*`、`agent_*`、`turn_*`、`tool_call`/`tool_result`、`before_provider_request`/`after_provider_response`…），第三方追踪只是挂在上面的薄扩展，而不是 harness 被第三方 SDK 侵入。
- **成本可见**：token 与 cost 直接落在 `message.usage`（含 `cacheRead`/`cacheWrite` 与分项 cost），`model_usage` 再单独记非对话调用——成本不是事后估算，而是会话数据的一部分。

---

## 五、体现在哪里（一）：持久层——单一真相层

### 5.1 会话文件的 entry 分类（16 类）

会话文件里每条 entry 有显式 `type`。这是可观测的「schema」，也是下钻的钥匙：

| entry type | 观测意义 |
|---|---|
| `message` | 对话轮次。`assistant` 消息的 `content` 里嵌 `toolCall` 块；`usage` 携带 input/output/`cacheRead`/`cacheWrite`/`totalTokens` + 分项 `cost`；`stopReason` 区分 `stop`/`toolUse`/`error`/`aborted` |
| `model_usage` | **副账本**：非对话的模型调用（见 §5.2） |
| `thinking_level_change` / `model_change` / `service_tier_change` | 运行时的「配置变更审计」：thinking 档位、模型切换（含 fallback 标记）、服务 tier 何时变过 |
| `compaction` | 上下文压缩：`tokensBefore`/`tokensAfter`、`firstKeptEntryId`、method、`providerReplayThroughEntryId`——把「被压掉的历史」与「保留的尾」划清 |
| `branch_summary` | 分支切换时对「被放弃路径」的摘要 |
| `reset_boundary` | `/clear` 的边界标记：活上下文从它之后开始，全历史导出仍保留它之前 |
| `custom` | 核心子系统的非 LLM 记录（见 §5.3 退出诊断） |
| `custom_message` | 扩展注入的消息（可 `excludeFromContext`） |
| `label` / `title_change` | 人给树节点打的 checkpoint 标签；标题改名审计 |
| `ttsr_injection` / `credential_pin` / `session_init` / `mode_change` | TTSR 规则注入、凭证 pin、冷复活契约、模式切换 |

**为什么这重要**：传统日志里「模型换过没、thinking 调过没、哪些历史被压缩了」是散落的文本，很难查询；这里它们都是**一等 entry**，`/tree` 的 `all` 过滤器能逐条查看，下游观测能按 `type` 精确下钻。

### 5.2 `model_usage` 副账本

`message` 只覆盖「对话里的模型调用」。但 agent 在对话之外还会调模型做**标题生成、recap、压缩、记忆抽取、结构化判断（judge）**——这些不产生对话轮次，却花 token、占时延。`model_usage` entry 专门记录它们：

- `purpose`：`title`、`recap`、`find`、`compaction:remote`/`compaction:soft`/`compaction:handoff`/`compaction:advisor`、`web-search`、`image-gen`、`image-describe`…
- `duration` / `ttft`：墙钟时间与首 token 时间（ms）。
- `judgment`：native judge 查询的结果——`state`（judgment 缓存的 sha256）、`answers`（每题的 `[label, confidence]` 或分数/框）、`cached`（缓存命中的题数，不重复计费）。
- `completion`：文字侧信道的快照（`prompt`/`reply`），用于标题、commit message、记忆抽取等，超 4000 字符不截断而是省略。

这保证了一件事：**`omp stats` 能算出「API 等价成本」的完整口径**，因为连「生成标题」「压缩上下文」「判断 frustration」这些隐性模型调用都被记账了。

### 5.3 退出诊断：崩溃可恢复、中断可诊断

`custom` entry 里有一组核心拥有的类型，专门服务于「进程死了之后还能知道它死在哪儿」：

- `tool_execution_start`：工具实现开始前立即落盘（`toolCallId`/`toolName`/`startedAt`/args 摘要）。
- `session_exit`：正常/信号/致命/进程退出时记录 `reason`、`kind`、以及 `pendingToolCalls` 清单。
- `tool_approval_requested` / `tool_approval_resolved`：把「卡在等用户批准」的会话与「还在干活」的会话区分开。

于是另一个进程读同一份文件，就能回答「这个会话是卡在等用户，还是正在跑，还是崩溃时有 3 个工具调用没结束」。这是 `--restore`/`/restart` 能「复活被切断的 turn」的观测基础。

### 5.4 会话树与导出/分享

- `/tree`、`/branch`（别名 `/rewind`）、`/fork`：树上跳转/复制，支持 `label` 打 checkpoint、`branch_summary` 留上下文面包屑。
- **HTML 导出**（`/export` 或 `--export <session.jsonl>`）：导出为自包含 HTML，底部带 **Timeline 抽屉 + Trace 视图**（复用 `/trace` 的 span 组装器 `<omp-session-trace>`，与 `omp stats` 共享），按 duration/turn/call 三个轴看时间线，支持搜索、缩放、嵌套 track、entry 详情、工具聚合，并可「跳回 transcript」。
- `/dump`：把 live context 转成纯文本/侧车 JSON（含 system prompt、tool schema、LLM 转换后的消息）。
- `/share`：端到端加密快照（AES-256-GCM，密钥只在 URL fragment），默认脱敏（`share.redactSecrets`）。

---

## 六、体现在哪里（二）：程序化事件流

持久层是「事后审计」，事件流是「实时观测」。Oh My Pi 提供三套结构化事件面，粒度从「嵌入 SDK」到「进程间协议」逐级上升。

### 6.1 SDK：`session.subscribe(listener)`

在 Bun 进程内嵌入 `@oh-my-pi/pi-coding-agent`，可订阅 `AgentSessionEvent`。核心事件（非穷举）：

- 生命周期：`agent_start` / `agent_end`（含 messages 与可选 telemetry 字段，**每次 run 恰好一次**）/ `agent_pause`（`yielded`/`awaiting`——run 还没结束但模型循环停了）。
- 轮次：`turn_start` / `turn_end`；流式：`message_update`（`text_delta`）/ `message_start` / `message_end`。
- 工具：`tool_execution_start` / `tool_execution_end`。
- 重试/降级：`auto_retry_start` / `auto_retry_end`、`retry_fallback_applied` / `retry_fallback_succeeded`。
- 压缩：`auto_compaction_start` / `auto_compaction_end`、`manual_compaction_start` / `manual_compaction_end`。
- 状态变化：`model_changed`、`thinking_level_changed`、`ttsr_triggered`、`todo_reminder` / `todo_auto_clear`、`goal_updated`、`queue_update`、`cache_warming_start` / `cache_warming_end`、`config_warnings_changed`、`advisor_cost_changed` / `advisor_yielded`、`irc_message`、`notice`。

`agent_end` 的语义尤其关键：它只在「run 真正结束」时触发——**没有 streaming、没有已排期的续跑、没有后台 job、没有子智能体或排队消息能再唤醒它**。模型循环停了但 run 还在，发的是 `agent_pause`。这是区分「这一轮答完了」与「这件事做完了」的精确边界（RPC 里对应 `prompt_result` vs `session_settled`，见 §6.3）。

### 6.2 `--mode json`：headless 的 NDJSON 事件流

```bash
omp -p --mode json "List every TODO in src/" > todos.json
```

输出「会话 header + 事件，逐行 JSON」。注意其消息语义：增量 `message_update` **不含完整 partial 快照**，完整消息在 `message_end` 到达；opaque 的 provider replay payload 会被省略。终局失败产生非零退出码；被 `--max-cost` 拦停的 run 退出码为 `3`。

### 6.3 `--mode rpc` / `rpc-ui` / `acp`：进程间 JSONL 协议

`omp --mode rpc` 把 agent 变成一个 **stdin/stdout 的 newline-delimited JSON 协议**（非 JSON-RPC 2.0）。这是面向「把 omp 当后端进程驱动」的观测/控制面：

- **帧类型**：`ready`（协商协议版本、`maxFrameBytes`）、`response`、`AgentSessionEvent`、`extension_ui_request`、host tool/URI 请求、`extension_error`、`available_commands_update`、`prompt_result`、`session_settled`、子智能体帧（`subagent_lifecycle`/`subagent_progress`/`subagent_event`）、`btw_delta`/`btw_record`、`command_output`/`session_info_update`/`config_update`、`rpc_frame_error`、live voice 帧等。
- **v2 分块**：单帧超 1 MiB 时用 `rpc_chunk` 序列无损重组（上限 64 MiB），避免截断观测数据。
- **`prompt_result` vs `session_settled`**：`prompt_result` 报告「agent yield」（这一轮 turn 结束或中止），`session_settled` 报告「会话真正清空」（无 run、无排队、无后台 job、无可唤醒它的子智能体）。宿主用 `prompt_result` 呈现答案，用 `session_settled` 判断能否安全回收沙箱。
- **`get_state` 快照**：一次拿到 `model`/`thinkingLevel`/`isStreaming`/`isCompacting`/`contextUsage`/`todoPhases`/`queuedMessages`/`hasPendingAsyncWork`/`isSettled`/`usageLimit`/`tokensPerSecond` 等完整状态。
- **`set_event_filter`**：宿主可过滤订阅的事件；`set_subagent_subscription`（`off`/`progress`/`events`）控制子智能体观测帧的粒度。

---

## 七、体现在哪里（三）：指标 / 仪表盘——`omp stats`

`omp stats`（包 `@oh-my-pi/omp-stats`）是**本地可观测仪表盘**：直接解析 `~/.omp/agent/sessions/` 下的 JSONL，聚合进 `~/.omp/stats.db`（`bun:sqlite`），按小时做 rollup，任意区间查询毫秒级。

### 7.1 指标

| 指标 | 计算 |
|---|---|
| Tokens/s | `output_tokens / (duration / 1000)` |
| Cache Rate | `cache_read / (input + cache_read) × 100` |
| Cache Savings | `(uncached prompt cost − actual prompt cost) / uncached prompt cost × 100` |
| Error Rate | `count(stopReason = error) / total_calls × 100` |
| API 等价成本 | 用匹配的公开 API 价目表对 token 用量定价求和（订阅型模型无公开价的标 N/A 并排除出美元合计） |
| Avg Latency | `duration` 均值 |
| TTFT | `ttft` 均值（首 token 时间） |

### 7.2 页面与实时性

页面：`Overview` / `Models` / `Providers` / `Costs` / `Requests` / `Errors` / **`Traces`** / `Tools` / **`Frustration`** / `Projects` / `Gain`。`1`–`8` 选时间区间，`g`+字母跳页。

- **实时**：`GET /api/events` 用 SSE 推送 sync 进度、data version、rollup backlog；页面随 data version 变化自动 revalidate，无刷新按钮。
- **增量同步**：watcher 只处理新增/变更的日志条目；崩溃/中断的 batch 重试不会重复计数；解析后丢弃消息正文、只保留统计（隐私 + 体积双赢）。
- **`Frustration` 页会调模型**：它懒加载配置的 `judge` 角色（telemetry purpose `stats_frustration`）做判断——这本身又会被 `model_usage` 记账（闭环）。独立 `omp-stats` 二进制不提供 judge。

### 7.3 与导出 Trace 视图共享组装器

`omp stats` 的 `Traces` 页、HTML 导出的 Timeline/Trace 抽屉、`/trace` 命令，三者共用同一套 span 组装器（`<omp-session-trace>`）。这意味着**本地仪表盘看到的轨迹，和分享出去的 HTML 里的轨迹，是同一份 span 语义**，不是两套实现。

---

## 八、体现在哪里（四）：分布式追踪与实时/协作

### 8.1 原生 OpenTelemetry 钩子

SDK 的 `createAgentSession({ telemetry: {} })` 开启 **agent-loop 的 OpenTelemetry spans**。不注册宿主 OTel SDK 时用 no-op tracer，即「默认零成本、接入了才生效」。第三方集成（下节）正是利用这套事件面 + OTel 语义来导出。

### 8.2 第三方集成：薄扩展，而非侵入式 SDK

三套官方集成都验证了同一模式——**扩展监听 omp 的生命周期事件，转成 OTel/OpenInference span**：

**telemetry.dev（`@telemetry-dev/omp`）** —— 针对 Oh My Pi：

```
invoke_agent
├── chat {model}
│   ├── execute_tool {toolName}
│   └── execute_tool {toolName}
└── chat {model}
```

- `invoke_agent` 覆盖一次 prompt（含 retry、compaction、排队续跑），记录 prompt 与最终 assistant 文本。
- `chat {model}` 记录 provider、model、system prompt、response id、finish reason、token usage、duration、TTFT、错误；时延取自 omp 自己的消息时间戳。
- `execute_tool` 记录 tool call id、入参、结果、错误。
- session 的 start/switch/branch/compaction/retry/shutdown 变成 logs。
- **关键实现选择**：它监听 `tool_execution_start` / `tool_execution_end`，**不用** `tool_call` / `tool_result`——因为后者在 omp 里是**拦截语义**（handler 返回 `{block:true}` 会 block 工具），观测扩展绝不该有这种副作用。

**Arize（Coding Harness Tracing，`omp` harness）** —— 针对 Oh My Pi，导出 OpenInference spans 到 Arize AX 或 Phoenix：

| span | kind | 描述 |
|---|---|---|
| `Turn` | `CHAIN` | agent run 根 span；输入为 `before_agent_start` 的 prompt，输出为最终 assistant 消息 |
| `LLM: <model>` | `LLM` | 每个 `turn_end` 一个，带模型名、token（含 reasoning/cache）、成本 |
| `<tool>` | `TOOL` | 每个 tool result 一个，按 id 与触发它的 tool call 配对，记录入参/输出 |

只转发 `before_agent_start`、`turn_end`、`agent_end`、`session_shutdown` 四个白名单事件；`session.id` 做会话分组。它明说「omp 暴露的是 once-fired、已带最终结构化数据的生命周期事件」。

**Sentry（`@sentry/pi`）** —— 注意：这份 cookbook 针对**上游 pi**（`pi install`、`~/.pi/agent/settings.json`、`/sentry` 命令），不是 Oh My Pi fork，但结构同构：`invoke_agent` 根 span + `chat`/`execute_tool` 子 span，`dataCollection.genAI.inputs`/`outputs` 关内容捕获。

### 8.3 实时/协作：`omp stream` 与录制

`omp stream` 是一种**屏幕级**的可观测（区别于结构化 trace）：把会话广播到 `live.omp.sh/<username>` 的 Twitch 式页面。

- **只发屏幕行，永不发会话条目**：取 TUI 刚画好的行 → 剥掉除 SGR/OSC8 外的转义 → **脱敏** → 与上帧 diff 后发 row patch。prompt、工具参数、文件内容作为**数据**从不离开机器。
- **脱敏不可逆且刻意过匹配**：`*_KEY`/`*_TOKEN`/`*_SECRET`/`*PASSWORD*` 环境变量、`.env` 值、`.omp/secrets.yml`、凭据形状（含「还在逐字输入中的 token」，前缀匹配不设长度门槛）、连接串密码等，命中即 `••••••`；另有 `stream.redactPatterns` 自定义。
- **录制**：`/record` 走同一 pipeline 存成本地 `.ompcast`（asciicast 风格 JSONL）；`omp play` 回放、`omp clip` 上传为 `live.omp.sh/c/<id>`。

这是「实时观测 + 隐私」的一体化答案：观众看到的是**脱敏后的屏幕画面**，而非结构化数据；结构化观测走 §6/§7 的事件流与仪表盘，两者互不越界。

---

## 九、为什么这么设计（取舍）与红线

### 9.1 取舍

| 决策 | 收益 | 代价 |
|---|---|---|
| 单一真相层（JSONL 会话文件） | 可迁移/审计/回放；所有观测同源 | 文件是 append-only，重写/迁移/并发写需 lease 锁与 sibling 漂移 |
| 观测 = 会话（树） | 回放/分支/审计是副产物，不必再造日志 | 会话模型复杂（tree/leaf/compaction/reset_boundary 的重建算法） |
| 本地优先 + 事件面开放 | 隐私可控；第三方是薄扩展 | 云端聚合/团队协作需自建（或靠 `omp stream`/collab/第三方后端） |
| 内容捕获与元数据解耦 | 合规/信任 | 每个集成都要重做一遍 redaction 开关 |
| 观测复用拦截事件面 | 一套事件两用 | 语义易混：`tool_call` 是拦截、`tool_execution_start` 才是观测（见红线） |

### 9.2 红线与坑（从文档提取）

1. **`tool_call`/`tool_result` 是拦截语义，不是观测语义**。handler 返回 `{block:true}` 会真的 block 工具，抛异常会 fail-closed。做观测（只读旁路）必须用 `tool_execution_start`/`tool_execution_end`，否则「观测插件」会意外挡掉工具。telemetry.dev 文档把这条写进了实现选择。
2. **扩展无隔离**。扩展跑在 omp 进程内；裸 `setInterval`/`setTimeout`/detached promise 里抛异常会触发进程级 `uncaughtException`，**带走整个会话**。后台观测必须用 `ctx.setInterval`（隔离、`unref`、`session_shutdown` 自动清理）。
3. **消息完整性的边界**：`--mode json` 的 `message_update` 不含完整快照，完整消息在 `message_end`；RPC 的 `agent_end.messages` 在超大帧时被去重（只留 `messageCount`），宿主必须保留流式收到的 `message_end`，不能把 `agent_end.messages` 当完整转录。
4. **`/dump` 是 live context，不是全历史**。`/clear`/compaction 之后它只反映当前活上下文；要看完整会话图用 HTML 导出。
5. **`omp stats` 的 `Frustration` 会调模型**（judge role），既花钱又被 `model_usage` 记账；无 judge 的独立二进制不提供。
6. **`compaction` 与 `reset_boundary` 让「观测时间线」不等于「原始时间线」**：被压缩/被 clear 的历史仍在文件里，但不再进模型上下文。观测要按 `compaction.firstKeptEntryId` / `reset_boundary` 区分「活上下文」与「已归档历史」。

---

## 十、可观测的成本：四类成本

可观测不是免费的，但「成本大头在哪」取决于用通用栈还是 harness 内生观测。

| 成本类型 | 通用栈（LangSmith / Langfuse / Phoenix / OTel） | Oh My Pi |
|---|---|---|
| 实现/接入 | 埋 SDK、配 schema/redaction、维护后端（SaaS 订阅或自托管）、随版本升级 | 核心「免费」：会话文件 + 事件流是 harness 运行的一部分，不做任何事就有；增量成本只在选出口时产生（`omp stats` 本地免费；第三方 = `omp install` 一个包 + API key；`omp stream` = 一次 `/login`） |
| 运行时/性能 | 取决于 SDK 同步/异步与采样；不当的同步上报会拖慢 agent | 极小：append-only JSONL 无 `fsync`、blob 外置、`model_usage` 记账；`omp stats` 增量同步 + SQLite 小时 rollup + SSE 按需推；第三方异步批量（telemetry.dev 无 key 时 no-op） |
| 存储 | 后端集中存储，成本随 trace 基数增长 | JSONL 会话文件 + blob store + stats.db 会增长，靠 `omp gc` 治理（扫孤儿 blob、归档冷会话、可选压缩/清理陈旧状态） |
| 隐私/合规（最贵、最不可逆） | 内容是否出机器、存多久、谁能看，都需自行约束 | 内建脱敏：`omp stream` 永不发会话条目、只发 redacted 屏幕行；`/share` 默认脱敏 + AES-256-GCM 端到端加密；第三方集成逐类 `captureInput`/`captureOutput`/`mask` 开关 |

三条成本结论：

1. **大头不在 CPU/磁盘，而在 ① 实现与维护、② 隐私/合规、③「为观测而观测」的认知噪声。** 前两项 omp 压到接近零（核心内生、出口按需、脱敏内建）；第三项是流程问题，工具解决不了。
2. **观测自身也有隐性模型成本**：`omp stats` 的 `Frustration` 页会真的调模型（judge role）做判断——观测在花钱，且这笔钱又被 `model_usage` 记账（闭环）。「让成本可见」和「观测本身的成本」是两回事。
3. **内容出机器是硬约束，不因工具消失。** redaction 本身有代价：不可逆、刻意过匹配（前缀匹配不设长度门槛，边输入边遮），用可读性换安全。

## 十一、什么时候需要，什么时候不需要

判据一句话：**可观测是手段，不是目的**。只有当它服务于「省成本、提可靠、能排障」之一时才值得。触发条件通常是最先出现的三个痛之一——**贵、慢、错**。

### 需要（高价值）

| 场景 | 为什么 |
|---|---|
| 长时/自治任务（无人值守、`--mode rpc`/print、goal/loop 模式） | 没人盯着，事后必须能回答「它做了什么、卡在哪」 |
| 烧真金白银（token 成本要追责/优化） | 成本是「值不值得跑」的第一性问题，需落到每次模型调用 |
| 多步、多工具、重试/压缩频繁 | 「它为什么走这条路」只能靠 trace/事件链还原 |
| 团队协作 / CI / benchmark（metaharness、robomp） | 需要横向可比、可复现、可审计 |
| 合规/审计 | 要能回答「上次改了什么、为什么改」 |
| 出问题要复现/回放 | 会话树 branch/fork/replay 是回滚与分支实验的基础 |

### 不需要（低价值，甚至有害）

| 场景 | 为什么 |
|---|---|
| 一次性快速问答、单轮交互 | 无「未知-未知」要追，观测是纯开销 |
| 你正盯着 TUI 实时看 | 你的眼睛就是观测；再多埋点是噪声 |
| 原型/探索期、还没有要验证的假设 | 过早埋点 = 噪声 + 维护负担（先有假设，再观测） |
| `--no-session` 临时跑、低风险本地操作 | 无持久化需求，观测无从谈起 |
| 成本可忽略、无审计要求的个人玩具项目 | 收益为负 |

### 一条实操边界

「观测」和「会话持久化」在 omp 里是**同源的**——会话文件既是记忆、也是观测数据。所以一个更实用的判据是：

- 如果这个 agent 值得**持久化会话**（会 resume/fork/审计），那观测也已经有了，只是选不选出口（stats/第三方/stream）的问题。
- 如果连会话都不值得留（`--no-session`、一次性问答），那观测通常也不值得上。

## 十二、横向对比与总结

### 12.1 定位差

| 维度 | Oh My Pi 原生可观测 | 通用 agent 可观测栈（LangSmith/Langfuse/Phoenix/OTel） |
|---|---|---|
| 观测基座 | harness 内生的 JSONL 会话文件 + 事件流 | 需在你的 agent 代码里埋 SDK / 接 OTel |
| 追踪粒度 | 会话/entry 精确到 `model_usage` 副账本、退出诊断 | 通用 `gen_ai.*`/OpenInference 语义，与框架无关 |
| 本地 vs 云端 | 本地优先（SQLite + 本地仪表盘 + stream） | 多为 SaaS/自托管后端 |
| 隐私 | 内建 redaction（stream/share/内容开关） | 依赖各平台配置 |
| 第三方集成 | 薄扩展挂事件面（telemetry.dev/Arize/Sentry） | 平台即主体 |

两者的关系不是替代，而是**层次不同**：Oh My Pi 把「可观测」做成了 harness 的地基（文件 + 事件 + 本地仪表盘），第三方追踪是地基之上的薄出口；通用栈则是「给你 SDK，你自己在 agent 里埋」。这也是为什么 telemetry.dev 的集成只有几十行扩展、Arize 的集成是「转发四个白名单事件」——因为 omp 已经把结构化观测数据备好了。

### 12.2 一句话总结

- **为什么**：agent 的非确定性 + 多步循环 + 长时 + 成本敏感，使「确定性调用树」的可观测模型失效，必须重建为「run 轨迹 + LLM/tool span + session 分组」。
- **怎么做**：三信号 + events，落到 `gen_ai.*`/OpenInference 语义；把 token/cache/cost/TTFT/错误做成**每次模型调用的一等属性**；内容捕获与元数据解耦、逐类可关。
- **Oh My Pi 体现在哪**：一句话——**「文件即真理」的 append-only 会话 + 会话即树 + 三套程序化事件流 + 本地仪表盘 + OTel 钩子 + 脱敏实时直播**。它不是「给 agent 加了一个可观测层」，而是「agent 本身就是可观测的」，观测与运行共享同一份数据。
- **成本与边界**：可观测是手段不是目的；在 omp 里它和「会话持久化」同源——值得留会话就已有观测，只差选出口；连会话都不值得留，就无需为观测而观测。

---

## 参考文献

1. Oh My Pi harness 文档（一手源）：`omp://session.md`（Session Storage and Entry Model）、`omp://tree.md`、`omp://stream.md`、`omp://sdk.md`、`omp://rpc.md`、`omp://hooks.md`、`omp://extensions.md`、`omp://cli-reference.md`、`omp://user-facing-packages.md`、`omp://session-operations-export-share-fork-resume.md`。
2. Oh My Pi 仓库：<https://github.com/can1357/oh-my-pi>；`packages/stats/README.md`。
3. telemetry.dev：<https://telemetry.dev/docs/integrations/omp>（Oh My Pi Telemetry and OpenTelemetry Tracing）。
4. Arize AX：<https://arize.com/docs/ax/integrations/platforms/oh-my-pi/oh-my-pi-tracing>（Oh My Pi Tracing / OpenInference）。
5. Sentry：<https://sentry.io/cookbook/monitor-pi-with-sentry>（`@sentry/pi`，上游 pi）。
6. OpenTelemetry GenAI 语义约定 / Arize OpenInference（span kind 与 `llm.*`/`gen_ai.*` 属性）。
