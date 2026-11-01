---
report: 67
title: A2A 协议深度研究：Agent2Agent 的多 Agent 互操作标准
date: 2026-11-01
tags: [a2a, agent2agent, protocol, multi-agent, agents, mcp, linux-foundation]
summary: 从 A2A 规范原文（v1.0.0）、仓库 CHANGELOG、GOVERNANCE 与官方公告一手核验 Agent2Agent 协议：三层架构（数据模型/操作/绑定）、Task 状态机与 11 个操作、Agent Card 发现机制、三种任务更新交付（轮询/流式/推送）、基于 OpenAPI 3.2 的安全模型，以及它与 MCP、原生 function calling、编排框架的选型边界。
math: false
---

Agent2Agent（A2A）是让**相互独立、彼此不透明（opaque）的 AI agent 系统之间安全通信与互操作**的开放标准：不同框架、不同语言、不同厂商构建的 agent，通过 A2A 用同一套语言互相发现、协商、委托任务并交换结果——而**不需要共享各自的内部状态、记忆或工具**。本文基于 A2A 规范原文（`a2a-protocol.org/latest/specification`，当前稳定版 `1.0.0`）、仓库 `a2aproject/A2A` 的 CHANGELOG 与 GOVERNANCE、以及 Google/IBM/Linux Foundation 的官方公告一手核验：三层架构、Task 状态机、Agent Card 发现、三种更新交付、安全模型，以及它与 MCP、原生 function calling、编排框架的选型边界。

## 一、结论先行

- **A2A 是「水平」协议：让 agent 与 agent 协作；MCP 是「垂直」协议：让 agent 接工具/数据。** 这是最本质的定位分水岭。MCP 把一个 agent 变深（每接一个 MCP connection 就多一个工具/资源），A2A 把一个系统变广（跨团队、跨部门、跨组织的 agent 互相发现与委托）。官方原话：*"MCP gives each agent depth, and A2A gives your system reach."*
- **它是 Google 发起、已捐给 Linux Foundation 的开放标准，且正在快速合并同类。** 2025-04-09 Google Cloud Next 发布；2025-06-23 捐给 Linux Foundation；2025-08-29 IBM 的 ACP（Agent Communication Protocol）并入 A2A；2026-08-27 以 Growth Stage 项目加入 Agentic AI Foundation（AAIF），与 MCP、goose、AGENTS.md 同处一个中性治理框架。当前 **150+ 组织**背书、GitHub **26.4k stars**（2026-11）。
- **架构是「三层」：数据模型（Proto）→ 抽象操作 → 协议绑定。** 唯一规范源是 `spec/a2a.proto`（Protocol Buffers），操作与传输解耦；绑定层提供 JSON-RPC 2.0、gRPC、HTTP+JSON/REST 三种等价映射，同 11 个操作、9 个错误码一一对应。**换传输不换语义。**
- **核心原语就四个：Agent Card（发现）、Task（有状态工作单元）、Message（通信轮次）、Part（内容容器）+ Artifact（输出）。** 其中 Agent Card 是「数字名片」，通过 `/.well-known/agent-card.json` 或注册表被客户端发现；Task 是贯穿协议的状态机（9 个状态、4 个终态、2 个中断态）。
- **异步优先是设计底色。** Task 天然支持长耗时任务与人机协同（human-in-the-loop），三种更新交付机制——**轮询（Get Task）、流式（SSE）、推送通知（webhook）**——按「延迟 vs 复杂度」的梯度互补；`return_immediately` 控制阻塞/非阻塞，`INPUT_REQUIRED`/`AUTH_REQUIRED` 两个中断态把「要人输入/要授权」显式化。
- **安全不是协议发明，而是「对齐企业已有实践」。** 身份不在 A2A 载荷里，而在传输层（HTTP header / gRPC metadata）；Agent Card 用 OpenAPI 3.2 的 SecurityScheme 声明认证方式（API key / HTTP / OAuth2 / OIDC / mTLS 五种）；v1.0 还把 OAuth 现代化（砍 implicit/password，加 device code/PKCE）。**Agent Card 还能用 JWS 签名防篡改。**
- **选型边界一句话：** 多个 agent 跨框架/跨组织协作 → A2A；单个 agent 接外部工具/数据 → MCP；单厂商单模型单宿主 → 原生 function calling；同构且你完全控制调用顺序 → 编排框架（LangGraph/ADK/CrewAI）直接调，不需要 A2A 的发现层。

## 二、认识：它是什么

### 血统与治理

| 项 | 事实 | 依据 |
|---|---|---|
| 发布 | 2025-04-09，Google Cloud Next，Rao Surapaneni & Miku Jha 署名 | Google Developers Blog |
| 初始生态 | 发布即 50+ 伙伴（LangChain、CrewAI、Salesforce、SAP、ServiceNow、Atlassian、MongoDB 等） | 发布公告 |
| 捐给 Linux Foundation | 2025-06-23 | Google Developers Blog |
| 并入 ACP | 2025-08-29，IBM Research 的 **Agent Communication Protocol**（为 BeeAI 平台而建，2025-03 发布）并入 A2A，团队转入 A2A TSC | LFAI & Data 博客 |
| 加入 AAIF | 2026-08-27，以 Growth Stage 项目加入 Agentic AI Foundation | A2A 官方博客 |
| 治理 | TSC 9 席：Google、Microsoft、Cisco、AWS、Salesforce、ServiceNow、SAP、IBM、Bloomberg | GOVERNANCE.md |
| 许可 | Apache License 2.0 | LICENSE / README |
| 仓库 | `a2aproject/A2A`：26,369 stars / 2,686 forks / 294 open issues（2026-11） | GitHub API |
| 规范形态 | 单一规范源 `spec/a2a.proto`（Proto），文档由 mkdocs 生成 | 规范 §1.4 |
| SDK | Python、Go、JS、Java、.NET、Rust 六种官方 SDK | README |

三个值得单独点出的细节：

- **「ACP 并入 A2A」需要精确指认。** 并入的是 IBM 的 **Agent Communication Protocol**（`github.com/i-am-bee/acp`，为 BeeAI 开源平台而建）；它**不是** Zed 的「Agent Client Protocol」（`agentclientprotocol.com`，面向 IDE↔agent，仍独立活跃），也不是 OpenAI/Stripe 的「Agentic Commerce Protocol」——三者共用「ACP」三个字母，互不相关。此前本系列《MCP 相邻协议》把「ACP 已并入 A2A」挂在 `agentclientprotocol` 仓库上，是**把两个 ACP 混为一谈**，本篇予以更正。
- **治理是「多厂商中性」而非「Google 独裁」。** TSC 9 席里 Google 只有 1 席，Microsoft/AWS/Cisco/Salesforce/ServiceNow/SAP/IBM/Bloomberg 各 1 席；并入 ACP 后 IBM 的 Kate Blair 加入。这与 MCP 的治理（同样 Linux Foundation 托管）形成「同一中性治理框架下的两个协议」格局。
- **协议版本节奏快且已进入稳定。** 从 2025-04 的 0.1.0 到 2026-03 的 1.0.0，一年内跨过 0.x 全部大版本进入 GA，且 1.0 是一次「减法 + 重构」：砍 implicit/password OAuth、砍冗余字段、把「应用协议」与「传输映射」彻底分层。这说明 A2A 不是「发布即巅峰」的营销协议，而是在持续收紧。

### 版本沿革（从 CHANGELOG 一手梳理）

| 版本 | 日期 | 关键变化 | 性质 |
|---|---|---|---|
| 0.1.0 | 2025-04 | 初始发布：Agent Card、Task/Message/Part、JSON-RPC | 起点 |
| 0.2.x | 2025-05 ~ 07 | 加 gRPC + REST 绑定、Extensions 扩展、多传输声明、`protocolVersion` 必填、多 push 配置、referenceTaskIds | 补全 |
| 0.3.0 | 2025-07-30 | mTLS + OAuth2 metadata url + Skills 级安全；Agent Card well-known URI `agent.json` → `agent-card.json`；`GetExtendedAgentCard`；AgentCard 签名 | 安全加固 |
| 1.0.0 | 2026-03-12 | **大重构**：应用协议与传输映射分层；`tasks/list` 分页过滤；OAuth 现代化（删 implicit/password、加 device code/PKCE）；gRPC 原生多租户；LF 前缀包名；删冗余字段 | 稳定 GA |
| 1.0.1 | 2026-05-26 | HTTP 绑定优先 `application/a2a+json`、TaskStatus 修正等 | 修复 |

### 生态采纳（grounded）

- **云厂商原生支持**：Google Cloud、AWS Bedrock AgentCore Runtime、Microsoft Azure AI Foundry 都在基础设施里内建 A2A 支持（AAIF 博客）。
- **企业 SaaS**：ServiceNow、Salesforce、Atlassian、SAP 用 A2A 连接各自产品的工作流（AAIF 项目提案）。
- **开发者框架**：LangGraph、CrewAI、Pydantic AI、AG2、IBM BeeAI 等框架支持 A2A（AAIF 项目提案 + README）。
- **合作伙伴页**列出 180 家（Adobe、Bloomberg、Cohere、Datadog、Elastic、JetBrains、MongoDB、Neo4j、Palo Alto、Red Hat、UiPath、Workday、Zoom 等）——注意「150+ 组织背书」与「180 家合作伙伴」是两个口径，前者是 AAIF 博客的「backed by」计数，后者是官网 partners 页清单（本篇实测 180 条），分别引用不混用。

## 三、解剖：三层架构

### 为什么分层

规范把协议切成三层（§1.3）：

```
graph TB
    subgraph L1 ["L1 数据模型 (Proto)"]
        direction LR
        A[Task] ~~~ B[Message] ~~~ C[AgentCard] ~~~ D[Part] ~~~ E[Artifact] ~~~ F[Extension]
    end
    subgraph L2 ["L2 抽象操作"]
        direction LR
        G[SendMessage] ~~~ H[SendStreamingMessage] ~~~ I[GetTask] ~~~ J[ListTasks] ~~~ K[CancelTask] ~~~ L[GetAgentCard]
    end
    subgraph L3 ["L3 协议绑定"]
        direction LR
        M[JSON-RPC] ~~~ N[gRPC] ~~~ O[HTTP+REST] ~~~ P[自定义绑定]
    end
    L1 --> L2
    L2 --> L3
```

- **L1 数据模型**：所有实现必须理解的核心数据结构，用 Protocol Buffers 定义，**协议无关**。
- **L2 抽象操作**：agent 必须支持的「能力行为」，不关心如何通过具体协议暴露。
- **L3 协议绑定**：把抽象操作与数据结构映射到具体传输（JSON-RPC / gRPC / HTTP+JSON / 自定义），含方法名、端点模式、协议特定行为。

分层带来的硬约束（§5.1）：同一 agent 若支持多个协议，**所有协议必须功能等价、行为一致、错误映射一致、认证方式一致**。新增绑定不改数据模型——这就是 v1.0 「大重构」的核心动机：把「应用协议定义」从「传输映射」里剥离，让协议演进不再被某个传输绑死。

### 参与者模型

| 角色 | 是什么 | 关键特征 |
|---|---|---|
| **User** | 终端用户（人或自动化服务） | 发起请求、定义目标 |
| **A2A Client（客户端 agent）** | 代表 user 发起通信的应用/服务/另一个 agent | 是「调用方」 |
| **A2A Server（远程 agent）** | 暴露 A2A 端点的 agent 或 agentic 系统 | 对 client 而言是**黑盒（opaque）**：内部记忆、工具、逻辑都不暴露 |

「Opaque Execution（不透明执行）」是 A2A 最核心的设计哲学：agent 之间**只凭声明的能力和交换的信息协作**，不共享内部思维、计划或工具实现。这既保护知识产权，也天然对齐「把远程 agent 当标准 HTTP 企业应用」的安全模型。

### 核心概念（对应数据结构）

- **Agent Card**：JSON 元数据文档，描述 agent 的身份、能力、技能、端点、认证要求——发现与交互设置的入口。
- **Task**：A2A 的基本工作单元，有唯一 ID，**有状态**，走定义好的生命周期。
- **Message**：client 与远程 agent 之间的一次通信轮次，有 `role`（user/agent），含一个或多个 Part。
- **Part**：Message 或 Artifact 里的最小内容单元，可含文本、文件引用（url/raw）、结构化数据（data）之一。
- **Artifact**：agent 因任务产生的**输出**（文档、图片、结构化数据），由 Part 组成。
- **Streaming**：任务增量更新的实时投递（状态变化、artifact 分块）。
- **Push Notification**：服务端主动向 client 提供的 webhook URL POST 异步任务更新。
- **Context（contextId）**：可选标识符，把相关任务与消息逻辑分组。
- **Extension**：agent 提供核心规范之外额外功能/数据的机制。

## 四、解剖：核心数据模型

### Task 状态机：9 个状态

| 状态 | 含义 | 类型 |
|---|---|---|
| `TASK_STATE_UNSPECIFIED` | 未知/未定 | — |
| `TASK_STATE_SUBMITTED` | 已提交、已确认 | 活动 |
| `TASK_STATE_WORKING` | 正在被处理 | 活动 |
| `TASK_STATE_COMPLETED` | 成功完成 | **终态** |
| `TASK_STATE_FAILED` | 出错结束 | **终态** |
| `TASK_STATE_CANCELED` | 完成前被取消 | **终态** |
| `TASK_STATE_REJECTED` | agent 决定不执行（初始或中途） | **终态** |
| `TASK_STATE_INPUT_REQUIRED` | 需要额外用户输入才能继续 | **中断态** |
| `TASK_STATE_AUTH_REQUIRED` | 需要授权才能继续 | **中断态** |

关键语义：

- **4 个终态不可重启。** 任务一旦到终态（completed/canceled/rejected/failed），**不能再发消息给它**；后续任何交互（如「把船改红」）必须在同一 `contextId` 下**新建一个 Task**，用 `referenceTaskIds` 指向旧任务（Task Immutability，§3.4 / life-of-a-task）。
- **2 个中断态是「把控制权交回 client」的显式表达。** `INPUT_REQUIRED` 表示「要人补输入」，`AUTH_REQUIRED` 表示「要人补授权」——后者是 A2A 的 in-task authorization 机制：agent 可以把「继续任务所需的授权」委托给 client 去完成（甚至 client 自身也是 agent 时，可再转成自己的 `AUTH_REQUIRED` 任务，形成授权链）。
- **阻塞语义由 `return_immediately` 控制**（§3.2.2）：`false`（默认）时 `SendMessage` 阻塞直到终态或中断态才返回；`true` 时建完任务立即返回，由 client 轮询/订阅/收推送。

### Message vs Artifact：通信与输出的分离

官方明示（§3.7）：**Message 用于「沟通」，Artifact 用于「交付结果」**，Message SHOULD NOT 用来传任务输出。这是一个容易踩坑的设计点：

- Message 的角色：发起任务、澄清（agent 在发起任务前回问）、状态消息（附在 status update 上通知进度/请求输入/提供信息）、任务交互（client 补输入）。
- Artifact 的角色：任务的**具体产出**，有 `artifactId`（task 内唯一）、`name`、`description`、一个或多个 Part，可流式增量投递（`append`/`lastChunk` 控制分块）。
- 可靠性红线：**流式里的 Message 不保证可靠投递**——client 断线重连可能错过部分状态消息，Message 不应用于传关键信息；重要信息 agent 应写入 Task history 供 client 事后取回。

### Part 的四种内容形态

`Part` 是一个 `oneof`，必须恰好包含一种：

| 字段 | 内容 | JSON 序列化 |
|---|---|---|
| `text` | 纯文本 | 字符串 |
| `raw` | 内联二进制文件数据 | base64 |
| `url` | 外部文件引用 | URI 字符串 |
| `data` | 结构化数据（对象/数组/标量） | 任意 JSON 值 |

每个 Part 还可带 `mediaType`（MIME）、`filename`、`metadata`。这四形态是 A2A 「模态无关（modality agnostic）」原则的落地：文本、图片/音视频（经文件引用）、结构化表单、甚至内嵌 UI（iframe 引用）都能在同一个协议里交换。

### Agent Card：发现与协商的入口

Agent Card 字段（§4.4.1）：

| 字段 | 必填 | 作用 |
|---|---|---|
| `name` / `description` | 是 | 身份与用途 |
| `supportedInterfaces` | 是 | 有序的接口列表（首个为偏好），每项含 `url`/`protocolBinding`/`protocolVersion`/`tenant` |
| `capabilities` | 是 | 可选能力：`streaming`/`pushNotifications`/`extensions`/`extendedAgentCard` |
| `defaultInputModes` / `defaultOutputModes` | 是 | 全技能支持的媒体类型（可被 skill 覆盖） |
| `skills` | 是 | `AgentSkill` 数组：`id`/`name`/`description`/`tags`/`examples`/`inputModes`/`outputModes` |
| `securitySchemes` / `securityRequirements` | 否 | 认证方案（OpenAPI 3.2 格式） |
| `provider` / `version` / `documentationUrl` / `iconUrl` | 否 | 元数据 |
| `signatures` | 否 | Agent Card 的 JWS 签名（防篡改） |

三个关键机制：

1. **发现方式三条**（§8.2）：well-known URI `https://{domain}/.well-known/agent-card.json`（RFC 8615 风格）、注册表/目录（curated registry，**当前规范未定义注册表 API**）、直接配置。well-known 是推荐的主路径。
2. **能力验证（Capability Validation）**（§3.3.4）：client 用未声明的可选能力（如没声明 `streaming` 却调 `SendStreamingMessage`），agent MUST 返回 `UnsupportedOperationError`。所以 client 应**先读 Agent Card 再决定调什么**。
3. **扩展 Agent Card**：`capabilities.extendedAgentCard: true` 时，认证后的 client 可调 `GetExtendedAgentCard` 拿更详细的卡片（额外技能、配额、组织专属配置）——用于把敏感能力藏到认证之后。public card 与 extended card 的「按身份选择性披露」是对 well-known 公开发现的一种补充。

### 协议版本协商

- `A2A-Version` service parameter（HTTP header / gRPC metadata / query param）声明 client 用的协议版本（`Major.Minor`）。
- **空 header 视为 0.3**（向后兼容 0.3 client）；agent 不支持则返回 `VersionNotSupportedError`。
- 同一 agent 可在同一/不同 URL 暴露多版本接口。SDK 被要求提供版本协商工具，且「要新特性的 client 应显式请求版本、避免自动回退到旧版以免静默丢功能」。

## 五、解剖：操作与更新交付

### 11 个操作与方法映射

| 功能 | JSON-RPC Method | gRPC Method | REST Endpoint |
|---|---|---|---|
| 发消息 | `SendMessage` | `SendMessage` | `POST /message:send` |
| 发流式消息 | `SendStreamingMessage` | `SendStreamingMessage` | `POST /message:stream` |
| 取任务 | `GetTask` | `GetTask` | `GET /tasks/{id}` |
| 列任务 | `ListTasks` | `ListTasks` | `GET /tasks` |
| 取消任务 | `CancelTask` | `CancelTask` | `POST /tasks/{id}:cancel` |
| 订阅任务 | `SubscribeToTask` | `SubscribeToTask` | `POST /tasks/{id}:subscribe` |
| 建推送配置 | `CreateTaskPushNotificationConfig` | `CreateTaskPushNotificationConfig` | `POST /tasks/{id}/pushNotificationConfigs` |
| 取推送配置 | `GetTaskPushNotificationConfig` | `GetTaskPushNotificationConfig` | `GET /tasks/{id}/pushNotificationConfigs/{configId}` |
| 列推送配置 | `ListTaskPushNotificationConfigs` | `ListTaskPushNotificationConfigs` | `GET /tasks/{id}/pushNotificationConfigs` |
| 删推送配置 | `DeleteTaskPushNotificationConfig` | `DeleteTaskPushNotificationConfig` | `DELETE /tasks/{id}/pushNotificationConfigs/{configId}` |
| 取扩展卡片 | `GetExtendedAgentCard` | `GetExtendedAgentCard` | `GET /extendedAgentCard` |

要点：

- **`SendMessage` 返回二选一**：`Task`（需长时处理）或 `Message`（立即应答、无任务追踪）。这是「Message-only / Task-generating / Hybrid」三种 agent 形态的协议依据（life-of-a-task）。
- **`ListTasks` 是 v1.0 新增**，带游标分页（`pageToken`/`nextPageToken`，非 offset，规避深分页）、`contextId`/`status`/`statusTimestampAfter` 过滤、`includeArtifacts`（默认 false 减载荷）、`historyLength` 控制历史量。响应按最后更新时间降序。
- **`SubscribeToTask` 首事件必须是 Task 快照**，防止 `GetTask` 与订阅之间丢事件（§3.1.6）。

### 三种更新交付：按延迟-复杂度梯度互补

| 机制 | 操作 | 延迟 | 连接要求 | 适用 |
|---|---|---|---|---|
| **轮询** | `GetTask` | 高、有浪费请求 | 无 | 简单集成、低频更新、受限防火墙 |
| **流式** | `SendStreamingMessage` / `SubscribeToTask` | 低、实时 | 需持久连接（SSE） | 交互应用、实时看板、进度监控 |
| **推送通知** | 4 个 PushNotificationConfig 操作 | 异步、事件驱动 | client 需 HTTP 可达 | 服务间集成、长任务、事件驱动架构 |

关键语义：

- **流式事件顺序强保证**：所有实现 MUST 按生成顺序投递、传输中不得重排（§3.5.2）；同一任务可开多条并发流给多个 client，事件广播到所有活跃流、顺序一致，关一条流不影响其他流。
- **流式模式两种**：message-only stream（返回一个 Message 立即关）或 task lifecycle stream（Task 开头，接 0+ 个 statusUpdate/artifactUpdate，到终态关）。
- **推送 = 「服务端主动 POST 到 client webhook」**，载荷仍是 `StreamResponse`（与流式同构），client 须返回 2xx、幂等处理（可能重复投递）、校验 taskId；agent 至少尝试投递一次、可用指数退避重试。webhook 一律走 HTTP+JSON 载荷，与 agent 自己的绑定无关。
- **SSRF 红线**：agent 作为 webhook caller，应拒绝私网 IP/localhost/link-local，防服务端请求伪造（§13.2）。

### 多轮交互（Multi-Turn）

- `contextId` 逻辑分组相关 Task/Message，跨轮次延续会话；server 生成、client 应视作不透明；client 若自造 `contextId` 而 server 不接受，必须报错拒绝而非另造。
- `taskId` server 生成、client 只能引用；发消息带 `taskId` 时 server 从任务推断 `contextId`，且 **`contextId` 与 `taskId` 不匹配时 MUST 拒绝**。
- 任务细化（refinement）：终端态任务不可重启，细化 = 同 `contextId` 新任务 + `referenceTaskIds` 指旧任务 + 复用一致的 artifact name 供 client 做版本追踪。

## 六、解剖：安全模型

### 身份在传输层，不在载荷

A2A 刻意**不在 JSON-RPC 载荷里放身份**（§7）：身份、认证、授权全部对齐标准 web 实践。生产部署 MUST 用 HTTPS（TLS 1.2+，推荐 1.3），client 须验 server 的 TLS 证书。

### SecurityScheme：OpenAPI 3.2 五种方案

Agent Card 的 `securitySchemes` 用 OpenAPI 3.2 Security Scheme Object 的判别联合（§4.5）：

| 方案 | 字段 | 说明 |
|---|---|---|
| API Key | `apiKeySecurityScheme` | `location`（query/header/cookie）+ `name` |
| HTTP Auth | `httpAuthSecurityScheme` | `scheme`（如 Bearer）+ `bearerFormat`（如 JWT） |
| OAuth2 | `oauth2SecurityScheme` | `flows` + `oauth2MetadataUrl`（RFC 8414） |
| OpenID Connect | `openIdConnectSecurityScheme` | `openIdConnectUrl`（发现 URL） |
| mTLS | `mtlsSecurityScheme` | 双向 TLS |

OAuth flows 在 v1.0 被现代化：`authorizationCode`、`clientCredentials`、`deviceCode` 三选一，`implicit`/`password` 已弃用（标 Deprecated，推荐 Authorization Code + PKCE）。

### In-Task Authorization（任务内授权）

这是 A2A 相对 MCP 更「agentic」的一处：任务执行中 agent 可能需要**额外凭证**（如调另一个 API、或做破坏性操作前要人批准）。A2A 用 `TASK_STATE_AUTH_REQUIRED` 把「满足这个授权」**委托给 client**：

- agent 把 Task 转到 `AUTH_REQUIRED`，用 TaskStatus message 说明所需授权；
- client 可回消息协商/纠正/拒绝、联系人或服务满足授权、或（若 client 自己也是 agent）把授权请求**再转**成自己的 `AUTH_REQUIRED` 任务——形成授权链。
- 安全红线（§7.6.3/7.6.4）：凭证 SHOULD 走带外安全通道（HTTPS）直给 agent；带内传凭证（跨多 agent 链）会把凭证暴露给链上每个 agent，必须把凭证**绑定到发起请求的 agent**、敏感凭证**只对发起 agent 可读**（加密）。且 `AUTH_REQUIRED` 状态转换本身**不等于任何授权**，授权语义由实现/签发方/扩展定义。

### 授权作用域（Authorization Scoping）

协议不规定授权模型，但强制实现行为（§13.1）：`ListTasks` 只返回认证 client 可见的任务；`GetTask`/`Cancel`/`Subscribe`/推送配置必须验证访问权；**授权检查必须先于任何可能泄露「资源是否存在」的数据库查询**；「不存在」与「无权」不应被区分（防信息泄露）。扩展 Agent Card 必须认证后访问、按身份选择性披露、不含敏感信息。

### Agent Card 签名

Agent Card MAY 用 JWS（RFC 7515）签名防篡改（§8.4）：先按 RFC 8785（JCS）规范化（含 Proto 字段存在性语义：optional 未设的省略、显式设默认值的保留），排除 `signatures` 字段，再签名。client 应至少验一个签名才信任卡片。

## 七、为什么这么设计（取舍）

| 取舍 | 换来的 | 牺牲的 | 反面案例 |
|---|---|---|---|
| **Proto 作为单一规范源** | 协议中立、减少 spec 漂移、SDK 可代码生成、确定演进路径 | 运行时依赖 proto 工具链、JSON 是派生而非原生 | 纯 JSON Schema（如 OpenAPI 原生）更直观但多绑定易漂移 |
| **Opaque Execution（不透明执行）** | 保护 IP、安全、client 不必懂 server 内部 | 无法做「白盒」级别的跨 agent 调试/优化 | 共享内存/状态的同构多 agent 框架（CrewAI 团队）更透明 |
| **异步优先 + 中断态** | 原生支持长任务与人机协同 | 简单问答也要走 Task 状态机，有建模成本 | 同步 RPC（MCP 工具调用）更轻 |
| **三层架构（操作与传输分离）** | 换传输不改语义、可加自定义绑定 | 规范复杂度上升（11 操作 × 3 绑定 × 9 错误码映射） | 单一 JSON-RPC 绑定更简单 |
| **三种更新交付并存** | 覆盖「简单/实时/离线」全梯度 | client 要选型、推送要额外 webhook 基建 | 只做轮询最省事但延迟高 |
| **身份在传输层** | 复用企业 TLS/OAuth/API 网关全套 | 跨 agent 链的凭证传递难（带内传有暴露风险） | 载荷内嵌身份（部分私有协议）更直白但破坏标准安全栈 |
| **Tasks 不可重启（Immutable）** | 输入→输出清晰映射、可追踪、实现简单 | 每个细化都要新 Task，task 数量膨胀 | 可变的「会话对象」更省 Task |
| **Message/Artifact 分离** | 沟通与交付语义清晰、Artifact 可流式分块 | 开发者要判断「这是消息还是产物」，边界有时模糊 | 全部塞 Message 更省事但丢结构 |

一句话设计哲学：**复用 HTTP/JSON-RPC/SSE/OpenAPI/Protobuf 这些「已有、被验证」的标准，把 A2A 自己定位成「agent 之间的应用层胶水」，而不是发明新的传输或安全体系。** 这解释了它为什么能被云厂商和企业 SaaS 快速内建——它几乎不要求新基础设施。

## 八、横向对比（MCP / function calling / 编排框架）

### A2A vs MCP：水平 vs 垂直

官方有一整页「A2A and MCP: Detailed Comparison」。核心分水岭：

| 维度 | MCP | A2A |
|---|---|---|
| 方向 | **垂直**：加深单个 agent | **水平**：连接 agent 之间 |
| 连接对象 | 工具、资源、数据源 | 其他 agent |
| 交互特征 | 无状态、预定义函数式调用 | 有状态、多轮、推理/规划/委托 |
| 类比 | agent「用」能力 | agent「合伙」办任务 |
| 典型场景 | agent 调数据库/API/计算器 | 客服 agent 委托账单 agent、旅行 agent 协调机票+酒店+活动 |

组合是常态：agentic 应用用 **A2A 与别的 agent 通信，内部每个 agent 用 MCP 接自己的工具**。官方还指出「把 agent 包装成 MCP 工具」是反模式——agent 不是工具，包装成工具会丢掉它的完整能力（对应 discuss.google.dev 的《Agents Are Not Tools》）。

### A2A vs 原生 function calling

function calling 是**单厂商单模型**里模型直接调宿主定义函数的最简机制，无跨平台、无标准授权。A2A 买的是「**互不了解的 agent 之间的互操作**」；function calling 买的是「单宿主内的最简工具调用」。同一团队内、同构、受控，用函数调用更简单，A2A 的发现/协商层是额外开销。

### A2A vs 编排框架（LangGraph/ADK/CrewAI）

框架（LangGraph/ADK/CrewAI）是「构建 agent 的工具箱」，A2A 是「让不同框架构建的 agent 通信的协议」——两者不是竞争，是**不同层**。框架负责「造 agent」，A2A 负责「连 agent」。当 agent 之间是**紧耦合编排**（你完全控制所有 agent 的代码与调用顺序），直接用框架编排即可，不需要 A2A 的「发现 + 协商」开销；A2A 的价值在**松耦合、跨团队/跨厂商、互不了解**的协作。

### 反向结论（L4 核心）：何时明确不该用 A2A

1. **只有一个 agent** → A2A 的发现/协商/capability 交换是过度设计，MCP 接工具就够。
2. **agent 之间紧耦合编排**（你控制所有代码与调用顺序）→ 用编排框架直接调，不需要 A2A 的发现层。
3. **不需要跨团队/跨供应商互操作** → A2A 的价值在「互不了解的 agent 之间协作」，同团队内函数调用更简单。
4. **需求是「把 agent 当工具用」** → 那是 MCP 的活，不是 A2A 的活。

一句话反论：**A2A 买的是「跨边界、松耦合、不透明」的 agent 互操作；同构、受控、单团队场景它是额外的发现层。**

## 九、实践与红线

**何时用 A2A：**

- 多个 agent 跨框架（LangGraph 的 agent 调 CrewAI 的 agent）、跨组织协作，且要「发现 + 协商 + 长任务追踪」。
- 需要**不透明协作**：不想暴露内部记忆/工具/逻辑给协作方。
- 需要**长任务 + 人机协同**：任务会跑很久、中途要人输入（`INPUT_REQUIRED`）或授权（`AUTH_REQUIRED`）。
- 需要**企业级安全**：TLS + OAuth2/OIDC/mTLS + 授权作用域 + 审计追踪，且身份走标准 web 栈。
- 需要**跨云/跨 SaaS**：把 Google/AWS/Azure 或 ServiceNow/Salesforce/SAP 的 agent 连起来。

**何时别用：**

- 单 agent 接工具/数据 → MCP。
- 同构紧耦合多 agent → 编排框架直接调。
- 单厂商单模型单宿主 → 原生 function calling。
- 需要「白盒」共享内部状态/记忆的团队级多 agent → A2A 的不透明性反而是障碍。

**常见坑（来自规范原文）：**

1. **把任务输出塞进 Message。** 规范明示 Message 用于沟通、Artifact 用于交付；流式里 Message 不保证可靠投递，关键信息要写进 Task history。
2. **对终态任务发消息。** 终态任务不可重启，会得 `UnsupportedOperationError`；细化要同 `contextId` 新任务 + `referenceTaskIds`。
3. **`contextId` 与 `taskId` 不匹配。** 发消息同时带两个不一致的 ID，server MUST 拒绝。
4. **用未声明的能力。** 没读 Agent Card 就调 `SendStreamingMessage`/推送/扩展卡片，会得 `UnsupportedOperationError`/`PushNotificationNotSupportedError`；先读卡片再调。
5. **client 自造 `contextId` 而不懂 server 怎么处理。** 规范建议 client 不要自造 `contextId`，除非清楚 server 语义；server 不接受时必须拒绝而非另造。
6. **带内传凭证跨 agent 链。** `AUTH_REQUIRED` 的凭证应走带外直给 agent；带内传会暴露给链上每个 agent，必须绑定到发起 agent + 加密。
7. **push notification 不幂等。** 推送可能重复投递，client 必须幂等处理、校验 taskId、返回 2xx；agent 侧要防 SSRF（拒私网 URL）。
8. **忽略 `A2A-Version`。** 空 header 会被当 0.3；要用新特性必须显式发版本，否则 agent 升级后可能静默丢功能。

## 十、前瞻与风险

**演进轨迹**：从「Google 发布的 agent 互操作协议」→「Linux Foundation 多厂商治理标准」→「并入 ACP 后成为事实上的 agent 通信收敛点」→「加入 AAIF 与 MCP 同处一个中性 agentic 栈」。官方 Roadmap 里明确的方向：Agent Card 内嵌授权方案与凭证、`QuerySkill()` 动态查技能、任务内动态 UX 协商（中途加音视频）、client 发起方法、流式与推送可靠性改进。

**风险与未定项：**

1. **注册表 API 尚未标准化。** 发现机制里 well-known URI 已定，但 curated registry 的交互 API 规范未定义——「Agent Discovery」是明确标注的 Future Considerations。这给生态留下碎片化空间：各家 registry 会先各自为政。
2. **与 MCP 的边界靠「软分工」而非「硬边界」。** A2A 官方自己承认「A2A agent 可把某些技能暴露成 MCP resource」——两个协议的边界在「定义清晰的无状态技能」处是模糊的。未来若 MCP 扩展出 agent 级原语（或 A2A 扩展出 tool 级原语），两条线会再次交汇。
3. **多协议功能等价的硬约束是双刃剑。** §5.1 要求「支持多绑定则必须完全等价」，这保证互操作，但也抬高实现门槛——一个小 bug 导致某绑定行为漂移即违规。SDK 层必须靠代码生成兜底。
4. **opaque 执行与可观测性的张力。** 企业要求分布式追踪（OpenTelemetry），但 opaque 哲学限制跨 agent 的「白盒」调试；当前靠 HTTP 层 trace context 传播解决，深度受限于「不暴露内部」的边界。
5. **AAIF 治理的成熟度。** 2026-08 刚入 AAIF，TSC 仍是「Startup Phase」（各创始组织各 1 席），18 个月后要转「Steady State」——选举/子项目 lead 制尚未定型，治理稳定性有待观察。
6. **「150+ 组织」是背书不是落地。** 背书的组织数与真正跑在生产里的 agent 数有距离；AAIF 博客自己也只说「runs in production across supply chains, financial services, and mobile platforms」，缺乏量化证据 `[INFERENCE]`。

## 十一、附录

### Task 状态速查

- **终态（不可重启）**：`COMPLETED` / `FAILED` / `CANCELED` / `REJECTED`
- **中断态（要 client 补输入/授权）**：`INPUT_REQUIRED` / `AUTH_REQUIRED`
- **活动态**：`SUBMITTED` / `WORKING`
- **初始**：`UNSPECIFIED`

### A2A 专用错误码速查（§5.4）

| 错误 | JSON-RPC | gRPC | HTTP |
|---|---|---|---|
| TaskNotFound | -32001 | NOT_FOUND | 404 |
| TaskNotCancelable | -32002 | FAILED_PRECONDITION | 400 |
| PushNotificationNotSupported | -32003 | FAILED_PRECONDITION | 400 |
| UnsupportedOperation | -32004 | FAILED_PRECONDITION | 400 |
| ContentTypeNotSupported | -32005 | INVALID_ARGUMENT | 400 |
| InvalidAgentResponse | -32006 | INTERNAL | 500 |
| ExtendedAgentCardNotConfigured | -32007 | FAILED_PRECONDITION | 400 |
| ExtensionSupportRequired | -32008 | FAILED_PRECONDITION | 400 |
| VersionNotSupported | -32009 | FAILED_PRECONDITION | 400 |

（JSON-RPC 标准码 -32700/-32600/-32601/-32602/-32603 仍通用；A2A 错误码落在 -32001~-32099。）

### Service Parameters 速查

- `A2A-Version`：client 用的协议版本（空 = 0.3），不支持返回 `VersionNotSupportedError`。
- `A2A-Extensions`：client 想启用的扩展 URI 逗号分隔列表。
- 传输：HTTP header / gRPC metadata /（HTTP binding 也支持）query param。

### 术语

- **Opaque Execution（不透明执行）**：agent 协作不暴露内部状态/记忆/工具。
- **Agent Card**：agent 的自描述 JSON 文档（身份/能力/技能/端点/认证）。
- **Task**：有状态的工作单元，走 9 态生命周期。
- **contextId / taskId**：分别逻辑分组会话 / 唯一标识任务；task 终态不可重启。
- **LRO**：Long-Running Operation，长耗时操作。
- **HITL**：Human-in-the-loop，人机协同（经 `INPUT_REQUIRED`/`AUTH_REQUIRED` 实现）。

### 已核实 / 更正项（承接《MCP 相邻协议》与验证清单）

- **「ACP 已并入 A2A」已核实并更正**：并入的是 IBM Research 的 **Agent Communication Protocol**（`i-am-bee/acp`，为 BeeAI 平台），2025-08-29 并入；**不是** Zed 的 Agent Client Protocol（仍独立）。此前《MCP 相邻协议》把两者混为一谈，已在本篇更正。
- **「A2A 的发现/协商原语」已核实**：发现原语 = **Agent Card**（`/.well-known/agent-card.json`），协商原语 = `supportedInterfaces` + `capabilities` + `securitySchemes` + `skills`；此前「紧耦合编排用框架不用 A2A」的反向结论，经对照规范 §3.4/§8 得到支撑，予以定稿。

## 参考来源

- A2A 规范原文（v1.0.0）：https://a2a-protocol.org/latest/specification/
- 核心概念 / What is A2A / A2A and MCP / Life of a Task / Enterprise-Ready / Agent Discovery：https://a2a-protocol.org/latest/topics/
- 仓库 `a2aproject/A2A`：README、CHANGELOG.md、GOVERNANCE.md、LICENSE（GitHub）
- 发布公告：Google Developers Blog《Announcing the Agent2Agent Protocol (A2A)》(2025-04-09)、《Google Cloud donates A2A to Linux Foundation》(2025-06-23)
- ACP 并入：LFAI & Data 博客《ACP Joins Forces with A2A》(2025-08-29)
- 加入 AAIF：A2A 官方博客《A New Chapter for A2A: Joining the Agentic AI Foundation》(2026-08-27)
- 合作伙伴清单：https://a2a-protocol.org/latest/partners/
- 本仓库既有产出：`_posts/2026-10-16-mcp-adjacent-protocols.md`（A2A 选型边界初版，本篇已更正其 ACP 口径）
