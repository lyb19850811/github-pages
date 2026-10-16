---
title: MCP 2026-07-28 协议演进：从有状态到无状态
date: 2026-10-16
tags: [mcp, protocol, agents]
summary: 梳理 MCP 2026-07-28 版本如何把协议从双向有状态改为无状态请求/响应——移除 initialize 握手与会话头、引入 server/discover 与 MRTR 多轮往返、header 路由与列表缓存，并同步收紧传输/授权与生态。
math: false
---

MCP（Model Context Protocol）在 2026-07-28 发布了一次「破坏性」改版：把协议核心从**双向有状态**改成**无状态请求/响应**。本文梳理这次改版改了什么、为什么改，以及它对传输、授权与生态的连带影响。

## 一、结论先行

1. **核心是无状态化**：移除 `initialize`/`initialized` 握手和 `Mcp-Session-Id` 头（SEP-2575、2567）。每个请求自描述，任何请求都能落到普通轮询负载均衡后的任意实例，无需共享存储。
2. **动机是可靠性与可扩展性**：官方口径称之为「开发者呼声最高的特性」，目标是把 MCP server 做得像普通 Web 服务一样可横向扩展。
3. **状态没有消失，只是显式化**：跨调用状态改由 server 铸造一个显式 handle、模型作为普通参数传回。官方认为这比藏在传输层里的会话状态更好——模型能看见 handle 并在工具间穿针引线。
4. **配套收紧**：MRTR 取代服务端主动请求、`Mcp-Method`/`Mcp-Name` header 路由、列表结果带缓存提示、授权加固 + 正式弃用政策（≥12 个月）。

## 二、分水岭与背景

MCP 采用 `YYYY-MM-DD` 日期版本号，只在发生向后不兼容变更时递增；当前版本即 2026-07-28，上一版为 2025-11-25。治理由 SEP-932 形式化：个体成员制（Contributors → Maintainers → Core → Lead Maintainers），SEP 流程管理协议变更；项目已移交 Linux Foundation 下的社区基金会托管。

Tier 1 SDK（TypeScript、Python、Go、C#）在发布当日同步支持 2026-07-28，Rust SDK 处于 beta。官方数据：Tier 1 SDK 月下载接近 5 亿次，TS 与 Python 累计各突破 10 亿次。

## 三、无状态核心（方向 A：协议层）

### 3.1 移除握手与会话

- **移除** `initialize`/`notifications/initialized` 握手，以及 Streamable HTTP 的 `Mcp-Session-Id` 头。
- 每个请求在 `_meta` 里携带 `io.modelcontextprotocol/protocolVersion`、`clientInfo`、`clientCapabilities`；server 在每个结果的 `_meta` 返回 `serverInfo`。
- 列表端点（`tools/list` 等）不再因连接而异——凭证改为随请求携带，不再是连接态。

### 3.2 server/discover 与版本协商

- `server/discover` 是**强制 RPC**，返回 server 支持的版本、能力与身份；客户端**可选**调用（提前选版本，或作为 stdio 上的兼容探测）。
- 每个请求带版本；版本不匹配返回 `UnsupportedProtocolVersionError`（列出支持的版本），客户端换版本重试。
- Streamable HTTP 上，`MCP-Protocol-Version` 头必须与 `_meta` 里的版本一致，不一致 → `400 HeaderMismatch`。

### 3.3 显式 handle 取代会话状态

无状态化不等于应用无状态。需要跨调用状态的 server，做法是：工具调用时铸造一个 handle，模型把它作为普通参数在后续工具间传递。官方对比结论是这比「藏在传输里的会话态」更好——handle 对模型可见，可穿线程、可组合。

### 3.4 一并移除的机制

`ping`、`logging/setLevel`、`notifications/roots/list_changed`、HTTP GET 端点、`resources/subscribe`/`unsubscribe`、SSE 断线重续（`Last-Event-ID`）全部移除或重构。所有结果必须携带 `resultType` 字段（`complete` | `input_required`）。

### 3.5 迁移决策树（方向 A 产出）

```text
跨调用状态管理决策：

需要跨调用状态吗？
|-- 否 --> 直接无状态部署，任意实例可接（最简，优先）
|-- 是 --> 状态能否塞进单次工具参数？
|          |-- 能 --> 直接作参数传（最简）
|          |-- 不能 / 状态大 / 需多步 --> 工具铸造显式 handle，模型作为参数穿线程
|                                        |-- 短会话 --> handle 即可
|                                        |-- 长任务 / 断点续做 / 中途输入 --> Tasks 扩展（tasks/get 轮询 + tasks/update）
```

## 四、传输与授权（方向 B）

### 4.1 传输

- **stdio**：本地进程内传输，凭证从环境变量取，不走本授权规范。
- **Streamable HTTP**：远程传输（2025-03-26 引入，取代 HTTP+SSE；2026-07-28 移除 GET 端点与协议级会话）。单端点 `POST`，server 按请求选择单 JSON 对象或 SSE 流响应。
- **DNS rebinding 防护是强制项**：server 必须校验 `Origin` 头，非法即 `403`；本地 server 只应绑定 127.0.0.1。

### 4.2 授权：OAuth 2.1 子集

授权对 MCP 实现是**可选**的。角色划分：MCP server = OAuth 资源服务器，MCP client = OAuth 客户端，授权服务器独立。

- **发现**：server 用 RFC 9728（Protected Resource Metadata）公布授权服务器；client 用 RFC 8414 / OIDC Discovery 拿到 AS 元数据。
- **注册三机制**：CIMD（Client ID Metadata Documents，新标准）、预注册、DCR（已弃用）。
- **流程要点**：`401` + `WWW-Authenticate(resource_metadata, scope)` → 取元数据 → AS 发现 → 注册 → PKCE + `resource`(RFC 8707) + scope → 授权 → `iss`(RFC 9207) 校验 → 换 token → `Authorization: Bearer`。

### 4.3 本次授权加固

- **`iss` 校验**（SEP-2468）：client 换码前必须校验 AS 返回的 `iss` 与记录值一致，堵住「授权服务器混淆」漏洞。
- **DCR `application_type`**（SEP-837）：修复桌面/CLI 客户端 OAuth 被拒的 `redirect_uri` 报错。
- **凭证绑定签发方**（SEP-2352）：凭证按签发方存储，禁止跨授权服务器复用。
- **DCR 正式弃用 → CIMD**：DCR 保留向后兼容，未来版本移除。
- **EMA（Enterprise-Managed Authorization）**：正式 extension，经企业 IdP 集中管控访问。

### 4.4 授权时序图（方向 B 产出）

```text
Client  --无 token 请求-->  MCP Server（资源服务器）
        <--401 + WWW-Authenticate(resource_metadata, scope)--
Client  --取 Protected Resource Metadata-->  MCP Server
        <--resource_metadata--
Client  --AS 发现（RFC 8414 / OIDC Discovery）-->  Authorization Server
        <--AS metadata--
Client  --注册（CIMD / 预注册 / DCR）-->  Authorization Server
Client  --authorize（浏览器：PKCE + resource + scope）-->  Authorization Server
        <--回调 code + iss--
Client  校验 iss（RFC 9207，与记录值一致）
Client  --token + code_verifier + resource-->  Authorization Server
        <--access_token--
Client  --MCP 请求 + Authorization: Bearer-->  MCP Server
        <--MCP 响应--
```

### 4.5 本地 / 远程安全检查清单（方向 B 产出）

- [ ] 本地 stdio server：凭证从环境变量取，不套 OAuth 流程
- [ ] Streamable HTTP server：校验 `Origin` 头，非法即 403（防 DNS rebinding）
- [ ] 本地 server 只绑定 127.0.0.1，不绑 0.0.0.0
- [ ] client 换码前校验 `iss`（RFC 9207），与记录值一致
- [ ] 凭证按签发方（issuer）存储，禁止跨 AS 复用（SEP-2352）
- [ ] 新实现不再用 DCR，改用 CIMD 注册
- [ ] 最小权限 scope：优先取 `WWW-Authenticate` 中的 scope，按需增量授权
- [ ] tool annotations 视为 untrusted，工具调用前人工确认（human-in-the-loop）
- [ ] 企业多租户场景用 EMA 经 IdP 集中管控访问

## 五、一次 tools/call 全链路（2026-07-28）

```text
(可选) server/discover               → 版本 / 能力 / 身份

tools/list                          → tools[] + ttlMs/cacheScope（可缓存、确定性顺序）
                                      LLM 选择工具

tools/call                          → 两条路径：
  (Mcp-Method: tools/call,
   Mcp-Name: <tool>,
   MCP-Protocol-Version,
   _meta, Bearer)

  普通结果       → resultType: complete + content + isError
  需要输入 MRTR  → resultType: input_required + inputRequests + requestState
                → 客户端收集输入 / LLM 完成
                → tools/call 重试（新 id + inputResponses + requestState）
                → 最终结果
```

几个要点：

- **header 路由**：`Mcp-Method`（方法名）与 `Mcp-Name`（工具/资源名）是必带头，网关/WAF/限流器可直接按头路由与计量，无需解析 JSON body。
- **列表可缓存**：`tools/list` 等返回 `ttlMs`（新鲜度提示）与 `cacheScope`（`public`/`private`），配合确定性排序，客户端可缓存工具目录、稳定 prompt cache 命中率。
- **MRTR（Multi Round-Trip Requests）**：服务端需要输入时不再主动发请求，而是返回 `resultType: "input_required"` + `inputRequests`；客户端收集答案后**带新 id 重试原请求**并附 `inputResponses`。取消了「持续打开的双向流」这一前提。
- **取消**：关闭 SSE 响应流即视为取消该请求。

## 六、与 2025 版的差异清单

| # | 维度 | 2025（≤ 2025-11-25） | 2026-07-28 |
|---|---|---|---|
| 1 | 会话 | `initialize` 握手 + `Mcp-Session-Id` | 无会话，每请求自描述（`server/discover` 可选） |
| 2 | 服务端主动请求 | 在 SSE 流上发 `sampling/createMessage`、`elicitation/create`、`roots/list` 独立请求 | MRTR：`InputRequiredResult` + 客户端重试 |
| 3 | 结果结构 | 无 `resultType` | 所有结果必带 `resultType` |
| 4 | 请求头 | 无标准请求头 | 必带 `Mcp-Method`/`Mcp-Name`/`MCP-Protocol-Version` |
| 5 | 列表缓存 | 无缓存提示 | `ttlMs`/`cacheScope` + 确定性顺序 |
| 6 | 变更订阅 | HTTP GET 端点 + `resources/subscribe` | `subscriptions/listen` 单流，按类型 opt-in |
| 7 | 弃用 | 无正式弃用政策 | Roots/Sampling/Logging 弃用（SEP-2577），HTTP+SSE 正式弃用 |

## 七、生态格局速览（方向 G）

- **SDK**：Tier 1 四语言同日跟进，Rust beta。
- **Registry**：官方 MCP Registry（preview）是集中式元数据仓库，Anthropic、GitHub、PulseMCP、Microsoft 背书；反向 DNS 命名空间 + 验证；`server.json` 元数据指向 npm/PyPI/Docker Hub；REST API + OpenAPI 供下游 marketplace 聚合；不支持私有 server。
- **Extensions**：Tasks（AWS 贡献，poll 式 `tasks/get` + `tasks/update`）、MCP Apps、Skills over MCP、EMA、OAuth Client Credentials。
- **采用者**：AWS Bedrock AgentCore（无状态部署）、Cloudflare Agents SDK（Workers 日零支持，Sentry/Linear 借其接入）、Google Cloud、Figma、honeycomb.io（约 20% 月度交互查询来自 agent）。
- **协议定位**：MCP 是「Agent↔工具」的垂直连接；Google 主导的 A2A 是「Agent↔Agent」的水平协作，二者互补而非竞争，且均纳入 Linux Foundation 治理（ACP 已并入 A2A）。选型时二者常同时出现：MCP 接工具，A2A 做多 Agent 编排。

**协议格局图（方向 G 产出）**

```text
Agent / Host（宿主应用）
        |
        |-- MCP（垂直）── Agent <-> 工具 / 数据 / 提示
        |-- A2A（水平）── Agent <-> Agent
```

**选型决策树（方向 G 产出）**

```text
需求是什么？
|-- 给单个 Agent 接外部工具 / 数据 / 提示 --> MCP
|-- 多个 Agent 之间协作 / 编排 --> A2A
|-- 单厂商单模型、无跨平台诉求、只在单一宿主 --> 原生 function calling（最简）
|-- 既要接工具、又要多 Agent 编排 --> MCP + A2A 同时用（分层，不冲突）
|-- 内部确定性流程 / 领域知识（教工作流而非接工具）--> Agent Skills
```

一句话总结：2026-07-28 把 MCP 从「需要 sticky session 的有状态协议」改成「像 Web 一样无状态、可缓存、可路由」的基础设施——这是一次把 MCP 推向生产级可扩展性的关键转身。

## 参考

- [The 2026-07-28 Specification（官方 blog）](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [Specification 2026-07-28: Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Specification 2026-07-28: Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [Specification 2026-07-28: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Specification 2026-07-28: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Specification 2026-07-28: Versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning)
- [SEP-932: Model Context Protocol Governance](https://modelcontextprotocol.io/seps/932-model-context-protocol-governance)
- [The MCP Registry](https://modelcontextprotocol.io/registry/about)
- SEPs: 2322（MRTR）、2243（header 路由）、2549（缓存）、2468/2352/837（授权）、2567/2575（无状态）、2577（弃用）、2596（弃用政策）、2663（Tasks）
