---
title: MCP SDK 与一致性：Tier 分级、协议纪元与 conformance
date: 2026-10-16
tags: [mcp, protocol, sdk]
summary: 深入 MCP 的 SDK 生态与一致性工程——10 个官方 SDK 的 Tier 分级现状、协议纪元（protocol eras）如何让同一 server 以 legacy/modern 两种形态被调试、以及 Inspector 作为一致性工具如何覆盖 error taxonomy 与 MRTR。
math: false
---

> 协议规范是「纸上契约」，SDK 是它的落地，Inspector 是它的验证器。本篇讲「规范 → SDK → 一致性」这条链，重点在协议纪元（protocol eras）这个把 legacy/modern 差异做成一等公民的工程概念。

## 0. 结论先行

1. **SDK 生态已扩到 10 个语言**，Tier 1 现在有 **6 个**（TypeScript、Python、C#、Go、Rust、Ruby），Java Tier 2，Swift/PHP/Kotlin Tier 3。注意这比「Rust 仍 beta」的发布日快照又往前走了一步。
2. **「协议纪元」是一等公民的 per-server 设置，与传输正交**：同一个 HTTP URL 可以按 legacy 或 modern 两种形态去调试。Inspector 默认 `legacy`（不自动探测），因为调试工具必须不能污染你来看的 transcript。
3. **几乎每个特性都有 era 差异**：logging（session 级 `setLevel` vs per-request `logLevel` stamp）、订阅（`resources/subscribe` vs `subscriptions/listen` + 流状态机）、Tasks（`capabilities.tasks` + `tasks/list` + 阻塞 `tasks/result` vs 扩展 + `tasks/get` only + 内联 result）、取消（`notifications/cancelled` vs 关 SSE 流）。
4. **Inspector 就是 conformance 工具**：composable test servers 复现每个 era 的每个特性，error taxonomy（`-32020/-32021/-32022/-32601`）被渲染成 typed spec error 而非 generic failure，`MRTR_MAX_ROUNDS` 兜底死循环。
5. **无状态化在测试层有个隐蔽后果**：modern 无状态 handler 每次请求是 throwaway 实例，「改资源再读」这类跨请求测试在无状态部署下根本不可见——这就是为什么 modern 的订阅 test server 不提供 `update_resource` 工具。

## 1. SDK 生态与 Tier 分级（E1）

官方 SDK 按「功能完整度 + 协议支持 + 维护承诺」分三档：

| Tier | SDK |
|---|---|
| **Tier 1** | TypeScript、Python、C#、Go、Rust、Ruby |
| **Tier 2** | Java |
| **Tier 3** | Swift、PHP、Kotlin |

每个 SDK 功能一致、只随语言习惯不同：都能写 server（tools/resources/prompts）、写 client（连任意 server）、支持本地 + 远程传输、类型安全的协议合规。

> **待核对的演进点**：上一篇《协议演进》写「Tier 1 四语言、Rust beta」——那是 `2026-07-28` 发布日的快照；当前 SDK 页 Rust 已是 Tier 1，且新增了 Ruby 进 Tier 1。Rust 显然在这段时间从 beta 升格了。要写死这条，需查 SDK tier 的变更记录确认升格时间点。

## 2. 协议纪元（protocol eras）（E2）

`2026-07-28` 的破坏性改版让 Inspector 把「era」做成 per-server 的一等设置：`legacy` | `auto` | `modern`，与传输正交。

| Era | 连接时行为 |
|---|---|
| `legacy`（**默认**） | 直接 `initialize`，完全不探测 |
| `auto` | 先探测 `server/discover`，非 modern 结果回退 `initialize` |
| `modern` | 锁死 `2026-07-28`，不回退，非 modern server 大声失败 |

**为什么默认是 legacy 而不是 auto**（规范原文的理由，很关键）：调试工具不能自动探测——`server/discover` 探测会卡住「静默的 legacy stdio server」，还会污染你专程来读的 transcript。opt-in 到 `auto`/`modern` 是刻意的动作。

### 2.1 逐特性的 era 差异

| 特性 | legacy（≤ 2025-11-25） | modern（2026-07-28） |
|---|---|---|
| 连接/会话 | `initialize` + `Mcp-Session-Id` + `DELETE` | 无会话，每请求 `_meta` |
| Logging | session 级 `logging/setLevel` 一次生效 | **per-request**：`_meta.logLevel` stamp，未 opt-in 的请求 MUST NOT 发日志 |
| 资源订阅 | `resources/subscribe`（session 标志） | `subscriptions/listen` 长流 + ack + 流状态徽标（Connecting→Listening→Reconnecting→Stream ended） |
| Tasks | `capabilities.tasks` + `tasks/list` + **阻塞** `tasks/result` | 扩展 + `CreateTaskResult`（`resultType:"task"`）+ 只 `tasks/get` + **内联** result |
| 服务端请求 | `server.elicitInput` 等合法 | **报错**；改 MRTR（`input_required` + 重试，`MRTR_MAX_ROUNDS` 兜底） |
| 取消 | `notifications/cancelled` | HTTP 关 SSE 流；stdio 仍 `notifications/cancelled` |
| 通知流 | `initialize` 后独立 `GET` stream | `subscriptions/listen` 的响应流 |

两个最能体现「era 是语义差异、不是渲染差异」的例子：

- **Logging**：modern 下「把 logLevel 关掉 → 同一次工具调用零日志」是**正确行为，不是 bug**。日志跟着 opt-in 的请求走，走该请求的 SSE 流。
- **Tasks**：modern 下没有 `tasks/list`，Inspector 的 Refresh 是「重轮询已知 handle」；legacy 才有 `tasks/list` 填充 tab。同一功能，两套方法集。

### 2.2 era 对调试工具的意义

Inspector 用两个监控面板分工：**Network** tab 是 HTTP 视图（`Mcp-*` 头高亮 + sentinel 解码），**Protocol** tab 是 JSON-RPC 视图（每个 spec error 单独渲染）。一个 `400` 响应在 Network 看是「400 Bad Request」，在 Protocol 看是 typed 的 `-32022 UnsupportedProtocolVersion` + `data.supported`。

## 3. conformance：Inspector 即一致性工具（E3）

一致性工程落在 Inspector 上，三块拼图：

- **composable test servers**：仓库内置一组「可组合」测试 server，每个 era 每个特性一个 config（`mrtr-showcase`、`subscriptions-never-acknowledged`、`xmcpheader-modern`…），可本地复现。
- **MRTR 全覆盖**：`mrtr_confirm`（单轮 elicitation）、`mrtr_two_step`（两轮、穿 `requestState`）、`mrtr_edge`（先只 `inputRequests`、再只 `requestState`）、`mrtr_empty`（空结果）、`mrtr_loop`（永不完成，测 `MRTR_MAX_ROUNDS`）。
- **x-mcp-header 的合规展示**：无效注解的工具（如 header 名 `"Bad Header"` 含空格）被划掉、归入 `Excluded (SEP-2243)` 区并给原因——对应方向 B 里「客户端 MUST 从 `tools/list` 排除无效工具」，Inspector 展示的是「为什么被排除」而非静默隐藏。

**conformance 的边界（推断）**：Inspector 覆盖的是「行为级一致性」（era 差异、error taxonomy、MRTR、header 镜像），但**没有独立于 Inspector 的规范化 conformance suite**——官方文档索引里没有独立的 conformance 页面，CI 集成走 Inspector CLI 的 recipes。跨语言 SDK 的「协议合规」更多靠类型系统 + 参考实现而非一套公开的 conformance 测试矩阵。

## 4. 结论与待验证项

**已由文档原文支撑（grounded）**：SDK Tier 分级（6 个 Tier 1 + Java Tier 2 + 3 个 Tier 3）（`docs/sdk`）；协议纪元三态与默认 legacy 的理由、逐特性 era 差异、error taxonomy、MRTR 测试矩阵（`tools/inspector/protocol-eras`）。

**待验证 / 推断（inference）**：
- **Rust 升格 Tier 1 的时间点**：当前 SDK 页 Rust 是 Tier 1，与上一篇「Rust beta」的发布日快照矛盾，需查 SDK tier 变更记录确认升格时间（很可能是 2026-07-28 之后）。
- **「无独立 conformance suite」**：从文档索引「无独立 conformance 页面」+「CI 走 Inspector CLI recipes」得出的推断，需对照 Inspector CLI 文档确认 CI 能力覆盖范围后再定性。
- **「无状态化让跨请求测试在测试层不可见」**：这是 protocol-eras 页「modern 订阅 test server 不提供 `update_resource` 工具」的直接推论——modern 无状态 handler 是 throwaway 实例，改完就丢。

**下一篇衔接（方向 F 生态与治理）**：SDK 的 Tier 分级、扩展的 SEP 轨道，都指向同一个治理结构——方向 F 讲 SEP-932 与 Registry。

## 参考

- [docs/2026-07-28/sdk — SDKs](https://modelcontextprotocol.io/docs/2026-07-28/sdk)
- [docs/2026-07-28/tools/inspector/protocol-eras](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/protocol-eras)
- 已有产出：`_posts/2026-10-16-mcp-protocol-core.md`、`_posts/2026-10-16-mcp-transport-scale.md`、`_posts/2026-10-16-mcp-auth-security.md`、`_posts/2026-10-16-mcp-extensions.md`
