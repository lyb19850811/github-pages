---
title: MCP 传输与规模化：stdio 生命周期、Streamable HTTP 与 header 路由
date: 2026-10-16
tags: [mcp, protocol, transport]
summary: 深入 MCP 两条传输管道的工程边界——stdio 的子进程生命周期与 legacy 探测、Streamable HTTP 的无状态部署与单 POST 端点、header 路由（Mcp-Method/Mcp-Name/x-mcp-header）如何支撑限流计费及其校验边界，以及 DNS rebinding 防护与本地 server 的信任域。
math: false
---

> 上一篇《MCP 协议核心机制》讲协议语义；本篇讲承载语义的两条管道，以及把 MCP server 做成「像普通 Web 服务一样可横向扩展」的工程底座。

## 0. 结论先行

1. **传输是 binding，不是语义**：协议语义在两种传输上完全一致，binding 只定义消息分帧、元数据承载、取消/终止信号。协议不规定 LB/健康检查/灰度——那是实现层，但规范给了三个前提（无状态、单端点、header 路由）。
2. **stdio 与 Streamable HTTP 的分水岭是「信任域」**：stdio 客户端与服务端共享一个信任域（同机同权限、SDK 假设完全互信）；Streamable HTTP 是跨信任域的远程边界，所以要 Origin 校验 + OAuth。
3. **规模化三件套：无状态 + 单 POST 端点 + header 路由**。但 `subscriptions/listen` 的长 SSE 流是例外——长连接天然绑定单实例，是水平扩展的盲区。
4. **header 路由的边界**：`Mcp-Method`/`Mcp-Name` 只覆盖「方法名 + 工具/资源名」；租户/业务维度要靠 `x-mcp-header`（`Mcp-Param-*`）。安全前提是「header 与 body 必须一致」（Server Validation），否则 LB 按 header 路由、server 按 body 执行 = 越权。
5. **DNS rebinding 防护是 MUST**：`Origin` 非法即 `403`，配合只绑 `127.0.0.1` 与鉴权。本地 server 的真实风险不在协议，在「一个继承你环境变量、读你文件、能任意出站的普通 OS 进程」。

## 1. 传输层定位

规范的原文定义：**「协议语义在每一种传输上都一致；传输是一种 binding——定义消息如何分帧与投递、请求元数据如何承载、取消与终止如何发信号。它不定义消息的含义。」**

两条标准传输：

| 传输 | 分帧 | 模型 |
|---|---|---|
| stdio | 换行分隔的 JSON-RPC，每个消息一行 | 客户端拉起子进程，走标准流 |
| Streamable HTTP | 每个消息一次 HTTP POST 到单端点 | 服务端独立进程，响应为 JSON 或 SSE 流 |

两个硬约束（transport-agnostic）：
- 消息方向只有两种：客户端→服务端发 **request/notification**，服务端→客户端发 **response/notification**。服务端**不得**发起 request，客户端**不得**发 response。
- 所有协议元数据在消息体（`_meta`）；binding **MAY** 把部分字段镜像到 envelope（Streamable HTTP 镜像到 HTTP header），但 **body 是唯一真相源**，镜像与 body 不一致必须拒绝。

另有自定义传输通道：可靠双向字节流（Unix socket/TCP）**SHOULD** 复用 stdio framing（换行分隔 JSON-RPC），只有进程生命周期部分是 stdio 特有。

## 2. 选型矩阵

| 维度 | stdio | Streamable HTTP |
|---|---|---|
| 部署位置 | 本地子进程 | 远程独立进程 |
| 进程模型 | client 拉起，通常一对一 | server 独立，服务多个 client 连接 |
| 凭证 | 环境变量，不走 OAuth | OAuth 2.1（`Authorization: Bearer`） |
| 取消 | `notifications/cancelled` | 关闭 SSE 响应流 |
| 元数据 | 全在 body，无 header 层 | body + header 镜像 |
| 变更通知 | 单通道共享，靠 `subscriptionId` 解复用 | `subscriptions/listen` 的独立 SSE 流 |
| 水平扩展 | N/A（单进程） | 无状态可扩；订阅流例外 |
| 安全模型 | 同信任域，SDK 完全互信 | 跨信任域，Origin 校验 + OAuth |

**选型规则**：需要访问本地文件/工具/硬件 → stdio；只包装远程 API → **优先远程版**（Streamable HTTP）——这是安全建议里最反直觉的一条：远程版**不在你机器上跑任何代码**，用协议 OAuth 而非本地 token，且补丁集中一处。官方安全文档原话：「一个只跟互联网服务对话的 server，跑在你笔记本上得不到任何好处，却要承担本指南里的全部风险。」

## 3. Streamable HTTP 无状态部署（B1）

### 3.1 单端点模型

- 服务端 **MUST** 提供**唯一一个** MCP 端点（如 `/mcp`），只接受 POST。
- 客户端每个 JSON-RPC 消息 = 一次独立 POST；`Accept` 头 MUST 同时声明 `application/json` 与 `text/event-stream`。
- 响应二选一：单 JSON object（`application/json`）或 **request-scoped** SSE 流（`text/event-stream`）。客户端 **MUST** 支持两者。
- notification POST 被接受 → `202 Accepted` 空 body。
- SSE 流上：服务端 **MAY** 发 `notifications/progress`/`notifications/message`（必须归属本请求），**MUST NOT** 发独立 request（MRTR 取代），最终 response **SHOULD** 终止流。

### 3.2 规模化三件套与前提

`2026-07-28` 的破坏性改版（移除 GET 端点 + 协议级 session）把 Streamable HTTP 变成了「无状态请求/响应」，这才是横向扩展的地基。三个前提：

1. **无状态**：每请求自描述（`_meta`），任意实例可接，无需共享存储。
2. **单 POST 端点**：没有 sticky session 需求，普通轮询 LB 即可。
3. **header 路由**：中介者不解析 body 就能路由/计量（见第 4 节）。

**LB/健康检查/灰度是纯实现层**，规范不规定。落地做法：健康检查 = 对任意实例发 `server/discover` 探活（它同时返回能力，正好复用）；灰度/金丝雀 = `MCP-Protocol-Version` 头做版本路由 + 确定性列表保证缓存命中稳定。

### 3.3 规模化的例外：长订阅流

**关键 nuance（推断，非规范原文）**：无状态化解决的是「请求/响应」的横向扩展，但 `subscriptions/listen` 的响应是一个**长生命周期的 SSE 流**——它物理上绑定到打开它的那个实例。规范虽声称「订阅状态 scope 到请求本身而非底层连接」，但 SSE 连接本身是实例绑定的。因此：

- 实例死亡 → 该实例上的订阅流全断，客户端重连（stdio 明确要求重发 `subscriptions/listen`，HTTP 同理）。
- 要让「`notifications/tools/list_changed` 到达所有订阅者」，水平扩展的 server 必须自己解决**跨实例的变更通知分发**（pub/sub 广播），或接受「订阅绑定单实例、断线即重建」。

这是方向 B 与方向 A（subscriptions 背压缺口）的交叉点，也是「无状态 MCP」与「长连接推送」之间尚未被规范填平的张力。

### 3.4 SSE 工程细节（反代理/保活）

- 服务端 **SHOULD** 回 `X-Accel-Buffering: no`——否则 nginx 等反代会缓冲 SSE，把实时通知攒着不发。
- 长流 **SHOULD** 周期性发 SSE 注释行（`:\r\n`）作 keep-alive，防中介器/客户端 idle 超时断开。
- **不支持 `Last-Event-ID` 可恢复流**：断线不续传，客户端重开订阅。

## 4. header 路由：能做什么、边界在哪（B2）

### 4.1 标准请求头

| Header | 来源字段 | 必带于 |
|---|---|---|
| `MCP-Protocol-Version` | `_meta.protocolVersion` | **所有** POST |
| `Mcp-Method` | `method` | **所有** POST |
| `Mcp-Name` | `params.name` 或 `params.uri` | `tools/call` / `resources/read` / `prompts/get` |

作用：让 LB/gateway/observability **不解析 body** 就能路由、限流、计量。`Mcp-Name` 的值必须可安全表示为纯 ASCII header，否则 Base64 sentinel 编码（`=?base64?...?=`）。

### 4.2 自定义头：`x-mcp-header`（租户/业务维度）

标准头只到「工具名」粒度。租户 ID、region 这类业务维度，规范用 `x-mcp-header` 机制解决：工具 `inputSchema` 里某个 primitive 参数标注 `x-mcp-header: "Tenant"`，客户端就把它镜像成 `Mcp-Param-Tenant: <值>` 头。

约束很严（违反即工具定义非法，客户端 MUST 从 `tools/list` 排除）：
- 值必须符合 HTTP field-name token 语法，无控制字符（含 CR/LF——防 header 注入）。
- 大小写不敏感地唯一；只能标 primitive（number 不允许）；只能标**静态可达**的属性路径（不得穿过 `items`/`oneOf`/`anyOf`/`allOf`/`$ref`）。
- 值编码同 `Mcp-Name`：非 ASCII/控制字符/首尾空白 → Base64 sentinel。

> 这是 B2 的核心答案：**限流计费的标准粒度为「方法 + 工具名」，业务/租户粒度需 `x-mcp-header` 或解析 body。** 反过来，如果一个网关需要按「调用参数里的 tenant」限流，而工具作者没标 `x-mcp-header`，网关就只能解析 body——header 路由的「免解析」红利到此为止。

### 4.3 校验：header ≠ body 就是安全漏洞

规范点明 header 校验的动机：**「防止不同组件依赖不同真相源导致的安全漏洞——例如 LB 按 header 值路由，而 MCP server 按 body 值执行。」** 这是基础设施层的 confused-deputy：LB 把请求按 header 路由到租户 A，server 却按 body 执行了租户 B 的操作。

因此 Server Validation **MUST** 拒绝 header 与 body 不一致的请求：`400 Bad Request` + `-32020 HeaderMismatch`。失败条件：必带 header 缺失、header 值≠body 值（`Mcp-Name`/`Mcp-Param-*` 先解码 Base64 再比）、header 值含非法字符。

对中介者（LB/网关）的约束同样关键：**按镜像 header 执行策略的中介者 SHALL 先校验 `MCP-Protocol-Version` 是否指示了「需要 header-body 校验」的版本；旧版本或无 header 时 SHALL 拒绝而非信任未校验的 header 值。** 否则一个 legacy 客户端（不带这些头）就能绕过按 header 做的隔离。

### 4.4 版本/方法错误的 HTTP 语义

- 版本不支持 → `400` + `UnsupportedProtocolVersionError`（附 `supported`）。
- 方法未知 → `404` + `-32601`（JSON-RPC error body 区分「现代 server 不认识方法」vs「legacy HTTP+SSE server 根本没这个端点」的裸 404）。
- header 缺失且不支持老客户端 → 按 Server Validation 拒绝。

## 5. stdio 生命周期管理（B3）

### 5.1 分帧与通道纪律

- 换行分隔，消息 **MUST NOT** 内嵌换行。
- server 读 stdin、写 stdout；**stdout 上 MUST NOT 写任何非 MCP 消息**；客户端 **MUST NOT** 往 stdin 写非 MCP 消息。
- `stderr` 用于日志（logging 已弃用后的 stdio 落点），客户端 **MAY** 捕获/转发/忽略，**SHOULD NOT** 把 stderr 输出当作错误信号。

### 5.2 关闭与重启（规范给了完整协议）

**优雅关闭**：客户端 SHOULD 先关子进程 stdin → 等退出 → 超时才强杀。POSIX 上强杀从 `SIGTERM` 升级到 `SIGKILL`，Windows 用 `TerminateProcess`/Job Objects。**server SHOULD 在 stdin 关闭时立即退出**——这是唯一的可移植优雅关闭信号，守好它就能避免被强杀。

**意外退出**：客户端 **SHOULD** 重启。因为协议无状态，in-flight 请求直接丢失、客户端对着新进程重试即可；active 的 `subscriptions/listen` 也必须在重启后重建。

**谁拉起、谁监控、崩了谁重启**：规范只写「SHOULD 重启」，具体是宿主应用的职责，不是协议职责。

### 5.3 legacy 探测（三种结果）

双 era 客户端 SHOULD 先发 `server/discover`（带首选现代版本）探测：

1. 返回 `DiscoverResult` → 现代 server，从 `supportedVersions` 选版本继续。
2. 返回**可识别的现代 JSON-RPC 错误**（如 `UnsupportedProtocolVersionError`）→ 现代但不支持该版本，换版本，**不得**回退 `initialize`。
3. 返回其他错误、或超时 → legacy，回退 `initialize` 握手。

两个易踩的坑：
- fallback **MUST NOT** 绑定某个特定错误码——legacy server 对 pre-`initialize` 的未知请求返回的是实现自定义错误（常见 `-32601`/`-32602`）甚至不响应。
- 只支持现代版本的客户端也 **RECOMMENDED** 探测：有些 legacy server 不校验请求是否在 `initialize` 之后到达，会把 era 模糊的方法（如 `tools/call`）按 legacy 语义处理，探测换来的是确定性失败而非静默错乱。

## 6. DNS rebinding 与本地安全（B4）

### 6.1 协议层面的 MUST

Streamable HTTP 服务端：
- **MUST** 校验所有入连接的 `Origin` 头（防 DNS rebinding）；`Origin` 存在且非法 → **MUST** 回 `403 Forbidden`（body 可带无 `id` 的 JSON-RPC error）。
- 本地运行时 **SHOULD** 只绑 `127.0.0.1`，不绑 `0.0.0.0`。
- **SHOULD** 对所有连接做鉴权。

**边界 case（推断）**：规范只说「present 且非法 → 403」，没有定义「合法 Origin」的精确匹配规则——allowlist 由谁配置、是否支持通配符、`Origin: null`（非浏览器客户端常发）算合法还是非法，都是实现自决。这是方向 B 的待验证项。另外注意 DNS rebinding 只威胁「本地跑 Streamable HTTP」的 server；纯 stdio 不暴露 HTTP，不在此攻击面内。

### 6.2 真正的本地风险：信任域

官方本地安全文档的核心判断：**stdio 客户端与服务端共享一个信任域**——同机同权限，SDK 假设完全互信，两者之间没有 transport 可强制执行的边界。本地 server 是「由你的宿主拉起的普通 OS 进程」，能继承你的环境变量、读你账户能读的一切（SSH key、云凭证、浏览器 profile）、任意出站。**这些协议一概不管，取决于你怎么跑它。**

五大威胁：恶意 server（typosquat）、过度收集 server、被攻破的依赖、**毒化工具目录**（tool poisoning / rug pull——tool 描述就是给模型读的指令，可静默改）、脆弱 server/bridge。

缓解原则一句话：**把第三方本地 server 当不可信代码，给尽量少的权限**——优先远程版、查 provenance（publisher / 防 typosquat / 锁版本 / 镜像 digest / SBOM）、工具定义当不可信输入、容器/微 VM 隔离、per-server 凭证（窄 scope + OS secret store）、文件系统最小只读授权。

## 7. 结论与待验证项

**已由规范原文支撑（grounded）**：
- 传输 = binding、两条标准传输、消息方向二元性、自定义传输复用 stdio framing（`transports/index`）。
- stdio 生命周期：分帧纪律、关闭/重启协议、legacy 三态探测（`transports/stdio`）。
- Streamable HTTP：单端点、Accept/202/SSE 语义、Origin 校验 MUST、header 三件套 + `x-mcp-header` + Base64 sentinel + Server Validation `HeaderMismatch`、版本/方法错误码、`X-Accel-Buffering`/keep-alive/无 `Last-Event-ID`（`transports/streamable-http`）。
- 本地安全：stdio 信任域、五大威胁、缓解原则（`local-server-security`）。

**待验证 / 推断（inference）**：
- **长订阅流的横向扩展盲区**：`subscriptions/listen` SSE 流绑定单实例、跨实例通知分发需服务端自建 pub/sub，是「无状态化 + 长连接推送」之间的张力，规范未直接给出规模化方案。
- **`Origin` 合法值匹配规则未定义**：规范只给「present 且非法 → 403」，allowlist 语义、通配符、`Origin: null` 处理是实现自决。
- 「限流计费的标准粒度为方法+工具名、租户维度需 `x-mcp-header` 或解析 body」是综合 header 表 + `x-mcp-header` 机制得出的**推论**，规范未直接给出「限流计费能力边界」的表述。

**下一篇衔接（方向 C 授权与安全）**：本方向的 Origin/OAuth 入口、header 校验的 confused-deputy 动机，直接通向方向 C 的 OAuth 2.1 子集与 confused deputy / token passthrough 攻击面。

## 参考

- [basic/transports — Overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/index)
- [basic/transports/stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)
- [basic/transports/streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [tutorials/security/local-server-security](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/local-server-security)
- 已有产出：`_posts/2026-10-16-mcp-protocol-evolution.md`、`_posts/2026-10-16-mcp-protocol-core.md`
