---
report: 9
title: MCP 协议核心机制：三种状态、MRTR 幂等性与订阅
date: 2026-10-16
tags: [mcp, protocol, agents]
summary: 深入 MCP 2026-07-28 无状态核心——跨请求状态如何拆成 handle / requestState / taskId 三种机制、MRTR 重试为什么协议层不给幂等性、subscriptions/listen 的订阅关联与取消路径，以及弃用政策里 earliest removal 的真实含义。
math: false
---

> 上一篇梳理了《MCP 2026-07-28 协议演进：从有状态到无状态》的改版全貌。本篇是机制深挖：聚焦无状态核心、三种状态机制、MRTR 幂等性、`subscriptions/listen`、弃用政策。

## 0. 结论先行

1. **无状态是硬约束不是口号**：每个请求自描述（`_meta` 携带版本/身份/能力），服务端**不得**从同连接的历史请求推断上下文；一条 stdio 进程**不是**会话，客户端可交错发无关请求。
2. **跨请求状态被拆成三种显式机制**，边界清晰：应用层 **handle**（模型可见、作为工具参数穿线程）、MRTR **`requestState`**（单请求内多轮收集输入、对客户端不透明、带完整性/防重放）、Tasks **`taskId`**（长任务、可轮询、可断点续）。
3. **MRTR 不提供幂等性**：重试是「新 id 的新请求」。规范只给 `requestState` 完整性 + 防重放框架，且明确「这不保证单次消费」；副作用安全是服务端自己的职责。
4. **`subscriptions/listen` 以 JSON-RPC 请求 id 做订阅关联**；stdio 重连后服务端不保留订阅态，客户端必须重发。**背压在规范里未定义**（实现层缺口）。
5. **弃用政策的 `earliest removal` 是「最早可移除」，不是「到期必移除」**：≥12 个月是下限保证，实际移除由 Core Maintainer 在发版时决定，可更晚。

## 1. 无状态核心（地基）

### 1.1 定义与三条硬约束

规范对 stateless 的定义：**「处理一个请求所需的所有信息都包含在请求本身；服务端独立处理每个请求；不得从之前的请求推断状态——即使是同一连接/流上的请求。」** 具体三条：

- **MUST NOT** 依赖同连接的历史请求建立上下文（能力、协议版本、客户端身份）。每个请求在 `_meta` 里自带这些元数据。
- **SHOULD** 准备好处理跨任务/线程/会话的请求混入。
- **跨请求状态 MUST 通过显式标识符引用**，由客户端在每次请求里传递。

关键推论（规范原文的 Note）：**「一条打开的连接（如 stdio 进程）不是会话；客户端可在同一传输上交错发送无关请求，服务端不得把连接/进程身份当作会话连续性的代理。」**

### 1.2 `_meta` 自描述

每个请求的 `params._meta` 携带（`io.modelcontextprotocol/` 前缀命名）：`protocolVersion`（本次声明版本）、`clientInfo`（name + version）、`clientCapabilities`（能力，含 `extensions` 扩展声明）。

### 1.3 `resultType`：多态结果

- `"complete"`：请求完成，结果是最终内容。
- `"input_required"`：请求未完成，需更多信息（MRTR）。
- 扩展 **MAY** 增加新值（如 Tasks 的 `"task"`），但客户端**不认识的值 MUST 视为非法**。
- 向后兼容：旧版服务端不带 `resultType` 时，客户端 **MUST 视为 `"complete"`**。

### 1.4 错误码分区

`-32020` `HeaderMismatch`、`-32021` `MissingRequiredClientCapability`、`-32022` `UnsupportedProtocolVersion`。注意 `-32002`（旧版 resource not found）已废弃、由 `-32602` 取代，但客户端 **SHOULD 仍接受**旧码。

### 1.5 `server/discover`

服务端 **MUST** 实现、客户端**可选**调用。返回 `supportedVersions`、`capabilities`、`serverInfo`（自报、未校验，**不得用于安全决策**）、`instructions`、以及缓存提示（`ttlMs`/`cacheScope`）。两个实际用途：单请求拿到完整能力（省去分别 probe tools/resources/prompts）、stdio 上做 legacy/modern 兼容探测。

## 2. 三种「状态」机制

无状态不等于「应用无状态」。跨请求状态被规范显式化为三种机制，边界如下：

| 机制 | 载体 | 对模型可见? | 生命周期 | 完整性/安全 | 适用场景 |
|---|---|---|---|---|---|
| **应用层 handle** | 工具参数（普通数据） | **是** | 由应用自行定义 | 无协议约束，应用自管 | 短会话多步、状态需模型在工具间穿针引线 |
| **`requestState`**（MRTR） | `InputRequiredResult` 字段 | **否**（客户端 MUST NOT 解析） | 单请求内多轮 | 建议 HMAC/AEAD + 防重放 | 单次请求内中途收集输入 |
| **`taskId`**（Tasks 扩展） | `CreateTaskResult`（`resultType: "task"`） | 是（作为 handle 传入） | 持久、跨连接/重启 | 服务端持久化 + 轮询 | 长任务、人审、外部 job、断点续做 |

**决策树**：

```text
这个状态…
├─ 需要模型看见并作为参数传递？              → 应用层 handle（最简，优先）
├─ 只是「单次请求内多轮收集输入」的中间态？    → MRTR requestState
└─ 是长任务 / 异步 / 人审 / 需跨连接存活？    → Tasks 扩展（taskId + 轮询）
```

**Tasks 关键语义**（AWS 贡献的 extension）：

- 服务端在请求会很长时返回 `CreateTaskResult`（含 `taskId`、初始状态、`ttlMs`、`pollIntervalMs`），**task 必须在发响应前就已持久创建**。
- 客户端轮询 `tasks/get`；中途需输入 → 状态 `input_required` + `inputRequests`，用 `tasks/update` 回填；终态 `completed`（带 `result`）/`failed`（带 `error`）/`cancelled`。
- `tasks/cancel` 是**协作式**取消——服务端确认意图但**不保证**停止。
- 可选：服务端通过 `subscriptions/listen` 推 `notifications/tasks`，免去轮询。

> 三者不是竞争关系而是分工：handle 管「模型要看见的会话态」，requestState 管「单请求内的不透明中间态」，taskId 管「跨连接的长任务态」。混淆三者的典型错误：把长任务塞进 handle（客户端重启即失效），或把模型该看见的状态塞进 requestState（协议禁止客户端解析）。

## 3. MRTR 深挖：幂等性与重试

### 3.1 为什么需要 MRTR

`2026-07-28` 移除了「服务端主动发请求」（`roots/list`、`sampling/createMessage`、`elicitation/create` 的独立服务端→客户端请求）。原因：服务端主动请求要求共享存储或 sticky session，与无状态化矛盾。MRTR 用「返回 `input_required` + 客户端重试」替代，服务端不再主动开口。

### 3.2 流程与重试语义

```text
客户端 tools/call (id:1)
  → 服务端 InputRequiredResult (id:1, inputRequests, requestState)
  → 客户端收集输入
  → 客户端 tools/call (id:2, 原参数 + inputResponses + requestState)   ← 新 id
  → 服务端最终结果 (id:2)
```

硬性约束：

- JSON-RPC `id` **MUST 不同**（初始与重试是两个独立请求）。
- `requestState` 客户端 **MUST 原样回显**，不得解析/修改/假设内容。
- `inputRequests` 的 key 由服务端分配，请求范围内唯一。
- 服务端 **MUST NOT** 发客户端未声明支持能力的 `inputRequests`（如客户端没声明 elicitation 就不能发 elicitation）。
- 服务端 **MUST NOT 假设客户端一定会回填/重试**，可对同一请求多次返回 `InputRequiredResult` 反复追问。

### 3.3 `requestState` 的安全模型（幂等性的核心）

规范明确：**`requestState` 是 attacker-controlled 输入**。若它影响授权/资源访问/业务逻辑，服务端 **MUST** 做完整性保护（HMAC 或 AEAD）并**拒绝**校验失败的 state。只有「篡改最坏也只是一次请求失败」时，才 **MAY** 省略完整性保护。

防重放三件套（**SHOULD**，写入受保护的 payload 并在接收时校验）：

1. 认证主体（principal）——拒绝他人出示的 state（防跨用户复用）。
2. 短 TTL——拒绝过期 state。
3. 来源请求标识（方法名 + 关键参数摘要）——拒绝「不匹配的请求」复用 state。

**关键结论（本篇最重要的一个发现）**：规范原文的 Warning 明确说——以上三件套**只压缩重放窗口、防跨用户/跨请求复用，但不保证单次消费**。「某 `requestState` 最多消费一次」（一次性兑换）这种需求，**MUST 由服务端自行强制**。

> 落到「MRTR 幂等性」的答案：**协议层不提供幂等性。** 重试 = 新 id 的新请求，JSON-RPC 语义上不是「同一个请求重放」。因此，一个有副作用、且中途需要输入的工具，其「副作用 + 输入收集」的组合必须由服务端自己设计成幂等——典型做法：先做输入收集/校验，副作用只在拿到全部 `inputResponses` 后的「最终执行」阶段发生；或在 `requestState` 里编码「已执行」标记并服务端强制单次消费。协议给了「完整性 + 防重放」的框架，但「至多执行一次」的保证永远在服务端。

### 3.4 错误处理与安全边界

- 服务端 **SHOULD** 校验 `InputResponses` 合法性；协议错误返回 JSON-RPC error。
- 客户端少传必要信息 → 服务端 **SHOULD** 再返回 `InputRequiredResult` 补要，而非报错。
- 额外未知参数 **SHOULD** 忽略。

## 4. `subscriptions/listen` 深挖

取代旧的 `resources/subscribe` RPC 与 HTTP GET 端点。长连接「请求/响应」形式：响应是一个开放的 notification 流，状态绑定到**请求本身**而非底层连接。

### 4.1 过滤器与确认

客户端在 `notifications` 过滤器里 opt-in：`toolsListChanged` / `promptsListChanged` / `resourcesListChanged`（布尔）+ `resourceSubscriptions`（URI 列表）。服务端 **MUST NOT** 发客户端未请求的类型。

服务端 **MUST** 以 `notifications/subscriptions/acknowledged` 作为**首条**消息，且在此之前不得发任何通知；ack 里的 `notifications` 是服务端实际同意支持的子集。客户端 **SHOULD** 比对请求与 ack，处理不支持的类型。

### 4.2 订阅关联（stdio 的关键）

- 每条通知带 `_meta.io.modelcontextprotocol/subscriptionId`，值 = 该 `subscriptions/listen` 请求的 JSON-RPC `id`。
- stdio 上所有消息共享一条通道，客户端 **MUST** 靠 `subscriptionId` 把通知归属到各自订阅。
- 一个客户端可同时持多个订阅，靠 `subscriptionId` 解复用。

### 4.3 取消的三条路径

| 触发方 | 机制 |
|---|---|
| 客户端（HTTP） | 关闭 SSE 响应流 |
| 客户端（stdio） | 发 `notifications/cancelled`，引用订阅请求 id |
| 服务端主动（如关停） | **SHOULD** 先回一个 `resultType: "complete"` 的 `subscriptions/listen` 响应（优雅关闭），再关流 |
| 底层传输断开 | HTTP 超时 / TCP 断开 / stdio 进程退出 |

优雅关闭 vs 异常断开的区别：收到带 `subscriptionId` 的 completion 响应 = 干净关闭；传输直接断 = 意外断连，客户端 **MAY** 视为重连触发。

### 4.4 重连语义 + 背压缺口

- **stdio 重连后，服务端不保留订阅态**，客户端 **MUST** 重新发 `subscriptions/listen`。
- **背压（backpressure）/ 流控：规范未定义。** 通知是单向、fire-and-forget；服务端产速快于客户端消费时，规范没有规定窗口、缓冲上限或丢弃策略。这是实现层必须自决的缺口——本地 stdio 靠 OS 管道缓冲，远程 Streamable HTTP 靠 SSE 反压（服务端能否感知客户端消费速度取决于 HTTP 栈）。

### 4.5 与取消语义的关系

通用取消通知 `notifications/cancelled` 有一处不对称：**服务端发送它时，MUST 只能引用 `subscriptions/listen` 请求 id**（即服务端用它终止订阅流），**MUST NOT** 用于其他目的。客户端发送它则可引用任意进行中的请求。这是「客户端取消任意请求」vs「服务端只能取消订阅流」的不对称。

## 5. 弃用政策与版本演进

### 5.1 生命周期三态（SEP-2596）

特性经历 `Active → Deprecated → Removed`。**Deprecated = 仍在规范里但已排期移除**：新实现 **SHOULD NOT** 采用，存量实现 **SHOULD** 在最早移除日前迁移。

### 5.2 「最早移除日」≠「移除日」

`earliest removal` 标记的是特性**具备被移除资格**的时间点；**实际移除是 Core Maintainer 在发版准备期的决定，可能更晚**。所以「≥12 个月」是**下限保证**，不是硬性倒计时——这点常被误读成「到点就删」。

### 5.3 当前弃用清单

| 特性 | 弃用版本 | 迁移路径 | 最早移除 |
|---|---|---|---|
| Roots | 2026-07-28 | 目录/文件改经工具参数、资源 URI 或服务端配置传递 | 2027-07-28 或之后首个修订版 |
| Sampling | 2026-07-28 | 直连 LLM 提供商 API | 同上 |
| Logging | 2026-07-28 | stdio 用 stderr；可观测性用 OpenTelemetry | 同上 |
| DCR | 2026-07-28 | 改 CIMD（Client ID Metadata Documents） | 同上 |
| HTTP+SSE 传输 | 2025-03-26 | Streamable HTTP | SEP-2596 达 Final 后三个月（特例，非 12 个月） |

> 注意：HTTP+SSE 与 `includeContext` 是在生命周期政策**之前**就已标记弃用的，SEP-2596 以过渡条款把它们重分类，所以它的移除期是「Final 后三个月」而非统一 12 个月——这是政策的例外通道，不是漏洞。

### 5.4 版本协商：无握手，逐请求判定

- 无协商握手。每个请求自带版本；服务端不支持则回 `UnsupportedProtocolVersionError`（`-32022`，附 `supported` 列表），客户端换双方都支持的版本重试。
- HTTP 上版本同时走 `MCP-Protocol-Version` 头，与 `_meta` 不一致 → `400 HeaderMismatch`。
- **modern / legacy / dual-era** 三分法：`2026-07-28+` 是 modern（逐请求 `_meta`），`≤2025-11-25` 是 legacy（`initialize` 握手）。era 判定是**服务端属性**（非单请求属性），客户端 **SHOULD** 按服务端进程/源缓存结果，失效再重探。
- 兼容矩阵的坑：**Modern 客户端连 Legacy 服务端会失败**——服务端可能静默、可能按 legacy 语义误处理 era 模糊的方法；stdio 上客户端 **SHOULD** 先发 `server/discover` 以获得确定性失败。

## 6. 研究结论与待验证项

**已由规范原文支撑（grounded）**：

- 无状态三约束与「连接 ≠ 会话」（`basic/index` Statelessness）。
- MRTR 的 `requestState` 安全模型：attacker-controlled、完整性保护、防重放三件套、**不保证单次消费**（`basic/patterns/mrtr` Security Considerations）。
- 三种状态机制边界：handle（`basic/index` 显式标识符）、requestState（MRTR）、taskId（Tasks extension）。
- `subscriptions/listen` 的 ack 顺序、subscriptionId 关联、stdio 重连需重发（`basic/patterns/subscriptions`）。
- 弃用政策的 `earliest removal` 语义与 12 个月下限、HTTP+SSE 例外（`deprecated`）。
- 版本协商无握手、era 三分法与兼容矩阵（`basic/versioning`）。

**待验证 / 推断（inference）**：

- 订阅流**背压未定义**是「规范缺口」的判断，需对照 Streamable HTTP 传输章节确认 SSE 是否有隐式反压，才能定论为「协议缺口」还是「传输层兜底」。
- 「MRTR 幂等性 = 服务端职责」是综合 `requestState` 安全模型 + 重试用新 id 得出的**推论**；规范全文未直接出现「idempotency」一词，即规范没有显式幂等语义。

## 参考

- [basic/index — Statelessness & resultType](https://modelcontextprotocol.io/specification/2026-07-28/basic/index)
- [basic/patterns/mrtr — Multi Round-Trip Requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)
- [basic/patterns/subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions)
- [basic/patterns/cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation)
- [basic/versioning — Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [server/tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [deprecated — Feature Lifecycle](https://modelcontextprotocol.io/specification/2026-07-28/deprecated)
- [extensions/tasks/overview](https://modelcontextprotocol.io/extensions/tasks/overview)
