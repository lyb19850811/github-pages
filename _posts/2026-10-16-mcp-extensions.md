---
title: MCP 扩展体系：Tasks、MCP Apps、Skills 与 auth 扩展
date: 2026-10-16
tags: [mcp, protocol, extensions]
summary: 深入 MCP 的扩展层——扩展的协商机制与 SEP-2133 生命周期、Tasks 的异步任务语义、MCP Apps 的 sandboxed iframe 安全模型、Skills over MCP 与原生 Agent Skills 的差异，以及 OAuth Client Credentials 机对机认证。
math: false
---

> 核心协议在 `2026-07-28` 已经收敛，**差异化与创新能力正在向扩展层迁移**。本篇讲透扩展的机制本身，以及四个官方扩展各自的能力边界与客户端支持现状。

## 0. 结论先行

1. **扩展是 MCP 的「增长层」**：通过 `extensions` 字段在 capabilities 里协商，标识符 `{vendor-prefix}/{extension-name}`，官方用 `io.modelcontextprotocol` 前缀；默认关闭、显式 opt-in。
2. **四个官方扩展**：Tasks（异步任务）、MCP Apps（交互 UI，标识符 `ui`）、Skills（工作流指令）、auth 扩展（EMA + OAuth Client Credentials）。
3. **扩展的治理是 SEP 轨道**（SEP-2133）：实验扩展（`experimental-ext-`）+ Working Group 孵化 → SEP → 官方；演进独立于核心协议，破坏性变更换新标识符（`-v2`）而非改旧字段。
4. **客户端支持的真相高度不均**：MCP Apps 11 家宿主支持；Skills 仅 1 家全支持 + 3 家 partial；OAuth Client Credentials 仅 1 家（mcpc）；EMA 仅 2 家。**选扩展先查矩阵，不是查文档。**
5. **三个扩展的分工**：Tasks 把「同步阻塞」变「异步 handle」；MCP Apps 把「文本回复」变「交互 UI」（安全靠 sandboxed iframe）；Skills 把「工作流指令」经 resources 原语下发——但**「读 SKILL.md 不等于激活 skill」**。
6. **关键边界**：Skills 的身份 = 服务端身份 + URI（name 不唯一）；MCP Apps 走 postMessage 的「自己的 MCP 方言」（`ui/` 前缀）；Tasks 的取消是协作式、task 必须在发响应前持久创建。

## 1. 扩展机制（地基）

### 1.1 标识符与协商

扩展标识符遵循 `_meta` key 命名规则、必须带前缀，官方前缀 `io.modelcontextprotocol`；第三方用自己拥有的反域名（如 `com.example/`）。客户端在每请求的 `_meta.clientCapabilities.extensions` 声明，服务端在 `server/discover` 的 `capabilities.extensions` 声明。settings 对象由扩展自定义 schema，空对象 = 支持但无额外设置。

**graceful degradation**：一方支持另一方不支持时，支持方要么回退核心协议行为、要么在扩展 mandatory 时拒绝请求。扩展应文档化回退行为（例如：提供 UI 的 server 仍要为不支持的客户端返回有意义的文本）。

### 1.2 生命周期与演进（SEP-2133）

官方扩展走 SEP 扩展轨道：提案（Extensions Track SEP）→ **至少一个官方 SDK 参考实现**（这是评审前置条件）→ Core Maintainers 审 → 发布 → 其他端采纳。实验扩展在 `experimental-ext-` 前缀仓库孵化（必须挂靠 Working Group），经 SEP 升格为官方。

演进独立于核心协议（扩展仓库维护者自管，无需 core 审）。**破坏性变更的定义**很严：删/改字段名、改字段类型、改语义、加必填字段都算 breaking，必须换新标识符（`io.modelcontextprotocol/my-extension-v2`），否则用 capability flag 或 settings 内版本化。

## 2. Tasks（D1）

> 已在方向 A 详述（handle vs requestState vs taskId 三分），这里只补与扩展机制相关的部分。

Tasks（`io.modelcontextprotocol/tasks`，AWS 贡献）把「可能很长的请求」变成「服务端返回持久 taskId + 客户端轮询」。核心语义：

- server 返回 `CreateTaskResult`（`resultType: "task"`，含 `taskId`/初始状态/`ttlMs`/`pollIntervalMs`），**task 必须在发响应前就持久创建**（crash resilience 的前提）。
- 生命周期五态：`working` / `input_required` / `completed`（带 result）/ `failed`（带 error）/ `cancelled`，后三者终态。
- 中途输入走 `tasks/update`（不是 MRTR 的「重试原请求」——这是 Task 与 MRTR 的关键区别：Task 的 `input_required` 是对已有 taskId 的补充，MRTR 是重发原请求）。
- `tasks/cancel` 协作式：server 确认意图但不保证停止。
- 可选 `notifications/tasks`（经 `subscriptions/listen`）免轮询。

**观察**：官方 client-matrix 页只追踪 4 个扩展（MCP Apps / OAuth CC / EMA / Skills），**Tasks 不在其中**——它的客户端支持在 ext-tasks 仓库单独维护。这是「扩展治理碎片化」的一个具体信号。

## 3. MCP Apps（D2）

### 3.1 为什么不是独立 web app

四个独立页面给不了的优势：**上下文保持**（app 在对话里，不切标签）、**双向数据流**（app 可调本 server 的 tool，host 可推结果给 app）、**宿主能力集成**（app 委托动作给 host，走用户已连的 capability）、**安全保证**（sandboxed iframe，无需完全信任 server 作者）。

### 3.2 工作原理

核心是「工具声明 UI 资源 + UI 资源渲染交互 HTML」两个原语的组合：

1. tool 描述里带 `_meta.ui.resourceUri` 指向 `ui://` 资源，host 可在调用前**预加载**（支持把工具输入流式推给 app）。
2. host 拉取 UI 资源（HTML + 打包的 JS/CSS，也可从 `_meta.ui.csp` 允许的 origin 加载外部资源）。
3. 在 **sandboxed iframe** 里渲染——隔离于宿主。
4. app 与 host 通过 **postMessage** 双向通信（JSON-RPC，自己的 MCP 方言：共享 `tools/call`、相似 `ui/initialize`、大多为新的 `ui/` 前缀方法）。

### 3.3 安全模型（D2 的核心）

sandbox 隔离保证：app **不能**碰 parent 页 DOM、读宿主 cookie/localStorage、导航 parent、在 parent 上下文执行脚本。所有通信走 postMessage，**host 控制 app 能访问哪些 capability**（如限制 app 可调的 tool、禁用 `sendOpenLink`）；`_meta.ui` 里的 `permissions`（mic/camera）与 `csp`（可加载的外部 origin）由 host 按资源声明控制。

> 判断：MCP Apps 是「MCP 从工具协议扩展为应用平台」的标志——它把「给 LLM 接能力」变成了「给 LLM 接带 UI 的应用」，同时用 iframe sandbox 把第三方代码的可信边界收紧到「无需完全信任 server 作者」。这是方向 B/C 里「信任域」问题的 UI 侧解法。

## 4. Skills over MCP（D3）

### 4.1 是什么

skill = 一个目录，含 `SKILL.md` + 可选支持文件，遵循 Agent Skills 规范（agentskills.io）。Skills 扩展（`io.modelcontextprotocol/skills`）通过 MCP 的 **resources 原语**发现与读取它——`skills/list` 发现、`skills/get` 取元数据、`resources/read` 读文件、可选 `resources/directory/read` 读目录（`directoryRead: true` 才允许）。

### 4.2 与原生 Agent Skills 的差异（D3 核心）

| 维度 | 原生 Agent Skills | Skills over MCP |
|---|---|---|
| 位置 | 宿主本地文件系统 | server 持有，跟着服务走 |
| 发现 | 宿主扫本地目录 | `skills/list` 动态发现（可 `"dynamic"` 生成式） |
| 完整性 | 本地文件约定 | **协议级 manifest**：每文件带 SHA-256 digest + size |
| 审批 | 宿主本地策略 | **审批绑定 manifest**，不要求先取文件；host **MUST NOT** 提前拉文件 |
| 身份 | 本地路径 | **服务端身份 + URI**（name 只是标签，不唯一） |

四个值得记死的语义：
- **「读 `SKILL.md` 不激活 skill」**：host 必须把 read 路由到自己的 skill-loading 路径，验证内容 + 用户批准后才载入上下文。
- **manifest 的 cache 字段不提供完整性**：`ttlMs`/`cacheScope` 只描述新鲜度与共享，**digest 才是内容完整性来源**。
- **身份 = 服务端身份 + URI**：host **MUST** 在注册表/审批/缓存里同时保留两者；**MUST NOT** 仅凭 URI scheme 判断某资源是 skill。这是防「不同 server 同名 skill 冒充」的关键。
- **目录读取不能扩展 manifest**：live 目录结果不得当 skill 的一部分暴露，访问新文件需 refresh + 审批。

## 5. auth 扩展（D4）

两个 auth 扩展是方向 C 的「增量」：

**OAuth Client Credentials**（`io.modelcontextprotocol/oauth-client-credentials`）：机对机认证，无用户交互。两种凭证格式——**JWT Bearer Assertions**（RFC 7523，推荐，`iss`/`sub` = client_id、`aud` = AS token endpoint、短生命周期）与 **client secret**（`grant_type=client_credentials`）。适用：后台服务、CI/CD、server-to-server、daemon。安全警示：client secret 是**长期凭证**，泄漏即静默冒充直到轮换，故优先 JWT assertion。

**EMA**（`io.modelcontextprotocol/enterprise-managed-authorization`）：已在方向 C 详述（ID-JAG 流、企业 IdP 集中决策）。这里只补标识符与定位：把「逐用户授权」变成「组织级策略」。

## 6. 客户端矩阵的生态判断

官方 client-matrix 的现实（社区维护，可能过时）：

| 扩展 | 支持现状 |
|---|---|
| MCP Apps (`ui`) | **11 家**：Claude web/Desktop、VS Code Copilot、M365 Copilot、Goose、Postman、MCPJam、ChatGPT、Cursor、Archestra.AI、PostHog Code |
| Skills | 1 家全支持（mcpc）+ 3 家 partial（ChatGPT、fast-agent、MCP Inspector） |
| Enterprise Auth | 2 家：Archestra.AI、mcpc |
| OAuth Client Credentials | 1 家：mcpc |

**生态判断**：MCP Apps 是「已被验证的通用能力」（11 家宿主跟进，含全部主流）；Skills 尚在铺开（partial 为主）；auth 扩展最滞后（1–2 家，多为 CLI/工具类客户端）。对开发者的工程结论：**做 UI 型能力选 MCP Apps 有生态保障；做 Skills 或 auth 扩展，先确认目标宿主在矩阵里，否则能力发出去没人能消费。**

## 7. 结论与待验证项

**已由规范/文档原文支撑（grounded）**：扩展标识符/协商/graceful degradation/SEP-2133 生命周期与演进规则（`extensions/overview`）；四扩展标识符与支持矩阵（`extensions/client-matrix`）；MCP Apps 的 ui:// + sandboxed iframe + postMessage + 安全模型（`extensions/apps/overview`）；Skills 的 list/get/read、manifest digest、审批绑定、身份 = 服务端身份 + URI、不激活语义（`extensions/skills/overview`）；OAuth Client Credentials 的两种凭证格式（`extensions/auth/oauth-client-credentials`）；Tasks 的 taskId/五态/协作取消（`extensions/tasks/overview`，方向 A 已读）。

**待验证 / 推断（inference）**：
- **「Tasks 不在官方 client-matrix」**：这是从 client-matrix 页只列 4 个扩展观察到的**事实**，但「是否意味着 Tasks 生态更弱」是推断——需查 ext-tasks 仓库的实现清单才能下结论。
- **「MCP Apps 是工具协议→应用平台的标志」**：定位性判断，规范没有此表述，是综合「UI 资源 + 双向工具调用 + 宿主集成」得出的推论。

**下一篇衔接（方向 E SDK 与一致性）**：扩展的 `extensions` 协商、graceful degradation 的「回退」语义，最终都要落到 SDK 怎么实现——方向 E 正好从「协议纪元（protocol eras）兼容」切入 SDK 内部。

## 参考

- [extensions/overview — Extensions](https://modelcontextprotocol.io/extensions/overview)
- [extensions/client-matrix — Extension Support Matrix](https://modelcontextprotocol.io/extensions/client-matrix)
- [extensions/tasks/overview](https://modelcontextprotocol.io/extensions/tasks/overview)
- [extensions/apps/overview](https://modelcontextprotocol.io/extensions/apps/overview)
- [extensions/skills/overview](https://modelcontextprotocol.io/extensions/skills/overview)
- [extensions/auth/oauth-client-credentials](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials)
- 已有产出：`_posts/2026-10-16-mcp-protocol-core.md`、`_posts/2026-10-16-mcp-transport-scale.md`、`_posts/2026-10-16-mcp-auth-security.md`
