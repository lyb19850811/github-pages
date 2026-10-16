---
report: 16
title: MCP 生产化：可观测性、缓存与版本兼容
date: 2026-10-16
tags: [mcp, protocol, production]
summary: MCP 从「能跑」到「能生产」——OpenTelemetry trace context 如何经 _meta 传播、缓存 ttlMs/cacheScope 的租户隔离陷阱、以及破坏性版本升级的兼容窗口设计。
math: false
---

> 这是方向 B（传输规模化）的姊妹篇：B 讲「怎么横向扩展」，本篇讲「怎么观测、怎么缓存、怎么升级」。protocol logging 已被弃用（改用 stderr/Otel），所以可观测性要自己搭——这是「资深」与「会写 demo」的分水岭。

## 0. 结论先行

1. **可观测性靠 OpenTelemetry**：trace context 经 `_meta` 里的**裸键** `traceparent`/`tracestate`/`baggage`（W3C 格式）传播——这是 `_meta` 命名规则的**例外**（不加 `io.modelcontextprotocol` 前缀），因为加了前缀会打断 trace/log 关联（SEP-414）。
2. **缓存的两个字段都是「提示」不是「保证」**：`ttlMs` 是新鲜度提示（不是数据不变保证），`cacheScope` 是可见性提示（**不是访问控制**）。
3. **`cacheScope` 的租户隔离陷阱**：`"public"` 意味着「无用户特定数据」，但从**已认证端点**返回的 `"public"` 结果仍可能被缓存并在不同授权上下文间共享——server **MUST** 自己做 per-primitive 访问控制，**MUST NOT** 靠 `cacheScope` 防越权。
4. **版本兼容窗口**：弃用政策给 ≥12 个月下限（`earliest removal` 只是「最早可移除」）；dual-era server 同时服务 legacy/modern，客户端缓存 era 判定。

## 1. 可观测性：Otel trace context（H1）

### 1.1 SEP-414：trace context 走 `_meta`

SEP-414（Final，Standards Track）把「OTel trace context 传播约定」写进规范：当 trace context 经 `_meta` 传播时，键 `traceparent`、`tracestate`、`baggage` 遵循 W3C Trace Context / Baggage 值格式：

```json
{
  "method": "tools/call",
  "params": {
    "_meta": {
      "traceparent": "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01"
    }
  }
}
```

**关键设计：这是 `_meta` 命名规则的例外。** `_meta` 的键本来要走 DNS 前缀（`io.modelcontextprotocol.*`），但 trace context 的三个键**不加前缀**——否则会有人把它命名成 `io.modelcontextprotocol.traceparent`，从而打断跨实现的 trace/log 关联（与 OTel 语义约定不兼容）。

落地状态（reference implementations）：C# SDK、Python SDK 已内置，OpenInference（Python/TS）、Envoy AI Gateway、Logfire、ToolHive 均已采用。这说明可观测性的实际路径是 **SDK 埋点 + 网关/APM 工具消费 trace context**，不是协议自己定义日志。

### 1.2 与弃用的关系

protocol logging（`logging/setLevel` + `notifications/message`）在 `2026-07-28` 被弃用（SEP-2577），迁移路径原文：stdio 用 `stderr`，可观测性用 OpenTelemetry。所以「生产可观测」的完整方案 = `stderr`（本地 stdio 日志）+ Otel trace（跨 server 链路）。方向 B 里的 `Mcp-Method`/`Mcp-Name` header 镜像，正好让网关/APM 不解析 body 就能按方法/工具名做 observability。

## 2. 缓存：ttlMs / cacheScope 与租户隔离（H2）

### 2.1 两个「提示」字段

| 字段 | 语义 | 类比 |
|---|---|---|
| `ttlMs` | 客户端 MAY 视为新鲜的毫秒数 | HTTP `Cache-Control: max-age` |
| `cacheScope` | `public` / `private` | HTTP `Cache-Control: public/private` |

硬规则：`ttlMs` 是**新鲜度提示，不是保证**——server 可能在 TTL 到期前就改了底层数据。`ttlMs=0`/缺失/负值都按「立即 stale」处理；server **MUST** 提供 `>= 0`。客户端不该把 TTL 当轮询间隔（要轮询就加 jitter/backoff），收到变更通知时缓存**立即失效**。

### 2.2 cacheScope 的租户隔离陷阱（H2 核心）

规范原文的 Security Considerations 点得很透：

- `"public"` 表示「不含用户特定数据」，可从共享网关/代理缓存、跨用户提供。
- `"private"` 表示「含私有数据」，缓存 **MAY** 在同一授权上下文内复用，**MUST NOT** 跨授权上下文共享（不同 token = 不同缓存）。

**陷阱在这**：**「从已认证端点返回的 `"public"` 结果，仍可能被缓存并在不同授权上下文间共享——不同 access token 可以利用同一份缓存。」** 换句话说，`cacheScope` 是「可见性提示」，不是「访问控制」：

- 一个按租户过滤的 `tools/list`，若误标 `"public"`，就会把租户 A 的工具目录缓存给租户 B。
- 规范明确要求：server **MUST** 应用 per-primitive 访问控制，**MUST NOT** 单独依赖 `cacheScope` 防止未授权访问。

**落地结论**：`cacheScope` 选错的代价是「数据隔离失效」；正确的安全边界永远是「授权 + audience 校验」（方向 C），`cacheScope` 只是优化缓存的提示。分页时 server **MUST** 对同一 list 请求的所有页用同一个 `cacheScope`。

### 2.3 与 MRTR / 分页的交互

- **MRTR 结果 MUST NOT 缓存**：带 `inputResponses`/`requestState` 的重试结果依赖「不在缓存键里」的输入。
- 缓存键 = 请求方法 + 影响结果的参数（如 `resources/read` 的 `uri`、分页的 `cursor`）；方法或参数不同就不得用缓存。
- 分页：每页独立缓存，无跨页一致性保证；要一致快照就从头重新拉（不带 cursor）；cursor 失效就丢弃所有缓存页重拉。

## 3. 版本兼容窗口（H3）

破坏性版本升级的兼容设计，三个层次（前几篇已详述，这里归总成「窗口设计」）：

1. **协议层**：`earliest removal` 是「最早可移除」不是「到期必移除」，≥12 个月是下限保证，实际移除由 Core Maintainer 发版时决定。所以升级窗口至少 12 个月，且「移除」是可延期的事件。
2. **实现层**：dual-era server 同一端点/进程同时服务 legacy（`initialize` 握手）与 modern（逐请求 `_meta`）；era 判定是 server 属性，客户端按进程/源缓存、失效重探。
3. **客户端层**：版本协商无握手，`UnsupportedProtocolVersionError` 附 `supported` 列表，客户端换双方都支持的版本重试；列表确定性排序 + `ttlMs`/`cacheScope` 保证升级期间缓存命中稳定。

**窗口设计的要点（推断）**：安全升级的关键不在「12 个月」，在于**服务端做好 dual-era + 客户端做好版本探测**——因为弃用政策只保「下限」，实际生态里 legacy 客户端可能存活远超 12 个月。兼容窗口不是「等 12 个月后删」，而是「一直服务到你的 legacy 客户端退出」。

## 4. 结论与待验证项

**已由规范原文支撑（grounded）**：SEP-414 的裸键 trace context 与命名例外（`seps/414-request-meta`）；`ttlMs`/`cacheScope` 语义、public 跨授权共享风险、MUST NOT 靠 cacheScope 防越权、MRTR 不缓存（`server/utilities/caching`）；opaque cursor 分页与 `-32602` 错误（`server/utilities/pagination`）；弃用政策 ≥12 个月与 earliest removal 语义（`deprecated`）。

**待验证 / 推断（inference）**：
- **「兼容窗口靠 dual-era 而非倒计时」**：这是综合「earliest removal 是可延期事件」+「dual-era server」得出的推论，规范未直接给出「升级窗口操作指南」。
- **「protocol logging 弃用后完整方案 = stderr + Otel」**：stderr 是 stdio 迁移路径、Otel 是可观测路径，二者在规范里分属不同迁移条目，合并成「完整方案」是我的综合。

## 参考

- [SEP-414: OpenTelemetry Trace Context Propagation](https://modelcontextprotocol.io/seps/414-request-meta)
- [specification/server/utilities/caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching)
- [specification/server/utilities/pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination)
- [specification/deprecated](https://modelcontextprotocol.io/specification/2026-07-28/deprecated)
- 已有产出：`_posts/2026-10-16-mcp-transport-scale.md`（header 镜像）、`_posts/2026-10-16-mcp-protocol-core.md`（弃用政策）
