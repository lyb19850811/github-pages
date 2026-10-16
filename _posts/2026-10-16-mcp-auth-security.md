---
report: 11
title: MCP 授权与安全：OAuth 2.1 子集、confused deputy 与 token passthrough
date: 2026-10-16
tags: [mcp, protocol, security]
summary: 深入 MCP 的授权与攻击面——OAuth 2.1 子集的完整流程与 iss/resource 硬约束、confused deputy 的最小控制集、token passthrough 的 audience 边界、SSRF/mix-up/state handle 劫持等攻击面，以及企业 EMA 与无状态化下的授权上下文。
math: false
---

> 这是六个方向里最重的一个：MCP 的「工具即能力」模型把 LLM 的非确定性直接暴露给系统权限，授权与安全既是 L3 的必修，也是安全岗的主场。本篇基于授权规范原文 + 安全最佳实践，覆盖 C1–C6 六个主题。

## 0. 结论先行

1. **授权对 MCP 是可选的**，但一旦做就分道扬镳：stdio 用环境变量凭证（**SHOULD NOT** 走 OAuth），HTTP 走 **OAuth 2.1 的一个子集**（不是完整 OAuth）。
2. **角色映射**：MCP server = OAuth 2.1 资源服务器，MCP client = OAuth 2.1 客户端，授权服务器独立。整个规范是「安全 + 简单」的取舍。
3. **C1 全流程的两个硬约束**：`iss` 校验（RFC9207，防 mix-up/授权服务器混淆）与 `resource` 参数（RFC8707，audience 绑定）——前者堵「把 code 交给错误的 AS」，后者堵「token 被别的资源服务器复用」。
4. **confused deputy 的根因**：静态 client_id + 动态客户端注册 + consent cookie 三者叠加，让「同意」被静默跳过；最小控制集 = per-client 同意注册表 + `redirect_uri` 精确匹配 + `state` 单次校验。
5. **token passthrough 是明令禁止的反模式**：server **MUST NOT** 接受不是发给它的 token，**MUST NOT** 透传未校验 token；audience 校验是唯一的信任边界。
6. **prompt injection 是结构性风险不是 bug**：tool 定义（名字/描述）就是给模型读的指令，天然不可信；human-in-the-loop 是 SHOULD 级默认。
7. **EMA 把授权决策从个人上移到企业 IdP**（ID-JAG 流），是 MCP 进企业的关键拼图；无状态化则让「凭证」变成随请求的输入而非连接态。

## 1. 授权可选性与角色（地基）

授权对 MCP 实现**可选**。当支持时：
- HTTP 传输 **SHOULD** 遵循本规范；stdio 传输 **SHOULD NOT**（从环境变量取凭证）；自定义传输 **MUST** 遵循其协议的安全最佳实践。

角色三方：**MCP server**（资源服务器，接受 access token 响应受保护请求）、**MCP client**（OAuth 客户端，代表资源所有者发起请求）、**authorization server**（与用户交互、签发 token，可独立或与资源服务器同驻）。

规范基于一整套 RFC 但只取子集，核心是：OAuth 2.1 draft、RFC6750（Bearer）、RFC8414（AS 元数据）、RFC7591（DCR，已弃用）、RFC8707（resource indicators）、RFC9728（protected resource metadata）、RFC9207（iss）、CIMD draft、OIDC Discovery。

## 2. OAuth 2.1 子集全流程（C1）

### 2.1 十步流程

```text
client --无 token 请求--> MCP server
  <-- 401 + WWW-Authenticate(resource_metadata, scope)--
client --取 Protected Resource Metadata (RFC9728)--> server
client --AS 发现 (RFC8414 / OIDC Discovery)--> AS
client --注册 (预注册 > CIMD > DCR > 手动输入)--> AS
client --authorize (浏览器: PKCE + resource + scope, 记录 issuer)--> AS
  <-- 回调 code + iss--
client 校验 iss (RFC9207, 与记录值一致)
client --token (code_verifier + resource)--> AS
  <-- access_token (+ refresh)--
client --MCP 请求 + Authorization: Bearer--> server
  <-- 响应--
```

### 2.2 三个最易被跳过、但最关键的硬约束

**① `iss` 校验（RFC9207，防 mix-up）**：客户端在重定向浏览器**之前**必须记录所选 AS 的 issuer，并关联到与 PKCE code verifier 同一条 per-request 记录。回调时用 RFC3986 简单字符串比较校验 `iss`——**MUST NOT** 做 scheme/host 大小写折叠、默认端口省略、尾斜杠、percent-encoding 归一化。校验失败连 error 响应都不许处理/展示。这张表决定动作：

| `authorization_response_iss_parameter_supported` | `iss` 是否出现 | 客户端动作 |
|---|---|---|
| `true` | 出现 | 与记录 issuer 字符串比较 |
| `true` | 缺失 | **拒绝** |
| `false`/缺失 | 出现 | 与记录 issuer 比较（本地策略条款） |
| `false`/缺失 | 缺失 | 放行 |

> 为什么 PKCE 不够：mix-up 攻击里客户端会把 `code_verifier` 发给攻击者的 token endpoint，PKCE 防不住；resource indicator 也防不住（攻击者的 AS 拦截在诚实 AS 之前）。`iss` 是唯一把响应绑定回「我信任的那个 AS」的机制——但它依赖诚实 AS 真的发 `iss`。

**② `resource` 参数（RFC8707，audience 绑定）**：授权请求与 token 请求**都必须**带 `resource`，且必须是目标 MCP server 的规范 URI（如 `https://mcp.example.com/mcp`，无 fragment，无尾斜杠）。这是 C3 的反面：从源头保证 token 只发给「我要用的那个 server」。

**③ 每请求 Bearer**：`Authorization: Bearer <token>` **必须**出现在每个 HTTP 请求；token **MUST NOT** 进 URI query；server **MUST** 校验 token 确实是发给它的 audience（RFC8707/RFC9068），校验失败回 401。

### 2.3 scope：最小权限 + step-up

- 401 挑战里的 `scope` 参数是**权威**的（客户端 **MUST NOT** 假设它与 `scopes_supported` 有集合关系）；缺失时才回退 `scopes_supported`。
- 运行时权限不足：`403 Forbidden` + `WWW-Authenticate: Bearer error="insufficient_scope", scope="..."`。
- **step-up 流**：客户端取「已授权 scope ∪ 本次挑战 scope」重新授权（防止丢权限），重试设上限，别对同一资源-操作组合反复撞墙。

## 3. confused deputy（C2）

**场景**：MCP 代理 server（连接客户端与第三方 API，作为单一 OAuth client 与第三方 AS 交互）。

**攻击成立的四个条件**：① 代理用静态 client_id 连第三方 AS；② 允许客户端动态注册（各自拿 client_id）；③ 第三方 AS 在首次授权后设 consent cookie；④ 代理没做 per-client 同意检查。

**攻击链路**：用户正常授权 → 第三方 AS 设了静态 client_id 的 consent cookie → 攻击者动态注册恶意客户端（redirect_uri = attacker.com）→ 发恶意链接给用户 → 浏览器带着 consent cookie → 第三方 AS 检测到 cookie **跳过同意页** → code 重定向到 attacker.com → 攻击者换 code 得 token，冒充用户。

**最小必需控制集**（规范原文 MUST）：

1. **per-client 同意注册表**：按用户维护已批准的 `client_id` 列表，转发第三方授权**之前**先查；同意决策服务端持久化。
2. **同意 UI**：明确展示请求客户端名、第三方 API scope、`redirect_uri`；CSRF 防护（state/token）；`frame-ancestors` CSP 或 `X-Frame-Options: DENY` 防点击劫持。
3. **consent cookie 安全**：`__Host-` 前缀 + `Secure` + `HttpOnly` + `SameSite=Lax`，加密签名或服务端 session，绑定到具体 `client_id`。
4. **`redirect_uri` 精确匹配**：与注册值**完全一致**（字符串精确匹配，不用通配）。
5. **`state` 校验**：加密安全随机、**仅在同意批准后**才存（不能同意前就设 cookie，否则同意页形同虚设）、单次使用、短 TTL（如 10 分钟）。

## 4. token passthrough 与 audience 校验（C3）

**反模式定义**：server 接受客户端传来的 token 却不校验它是否**发给本 server**（audience），甚至原样透传给下游 API。

规范定性：token passthrough 被授权规范**明确禁止**。server **MUST NOT** 接受任何未显式发给它的 token；**MUST** 只接受对自己资源有效的 token；**MUST NOT** 接受或中转任何其他 token。

四个风险维度：
- **绕过安全控制**：下游按 audience 做的限流/校验/监控全失效。
- **审计失效**：server 无法区分客户端身份，下游日志显示的是别的来源。
- **信任边界破坏**：一个服务被攻破，token 就能横向打穿其他「同 token 可接受」的服务。
- **演进负债**：今天纯代理，明天要加控制，audience 分离是前提。

> C3 的落地一句话：**audience 校验是 MCP server 与下游之间唯一的信任边界**——「这个 token 是不是发给我的」用 `resource`/`aud` claim 校验，校验失败即 401，不通过、不转发。

## 5. 其余攻击面（C2/C3 的延伸）

| 攻击 | 一句话机制 | 关键缓解 |
|---|---|---|
| **SSRF** | 恶意 server 把 OAuth 发现 URL（`resource_metadata`/`authorization_servers`/`token_endpoint`）指向内网/云元数据/`localhost` | 强制 HTTPS、封私网 IP 段、**不要手写 IP 校验**（八进制/十六进制/IPv4-mapped IPv6 会漏）、egress proxy、注意 DNS TOCTOU |
| **mix-up** | 攻击者控制的 AS 诱使客户端把诚实 AS 的 code 交给自己 | `iss` 绑定（见 2.2①） |
| **state handle 劫持** | 无状态协议下 server 铸 handle，攻击者猜中/盗取 handle 冒充他人 | **MUST NOT 把持有 handle 当认证**；handle 用安全随机数；服务端按 `<user_id>:<handle>` 绑定到认证主体，拒绝其他主体出示 |
| **授权 URL 注入** | 恶意 server 给 `javascript:` URL（XSS）或含 shell 元字符的 URL（RCE） | **MUST** 只允许 http/https scheme、**MUST NOT** 用 shell 打开 URL、allowlist 而非 blocklist |
| **stdio 代理提权** | XSS 拿到代理 auth token → 代理经 stdio spawn 任意命令 | 只存在于代理架构；sandbox/容器化 spawn、日志、最小权限 |
| **localhost redirect 冒充** | CIMD 证明域名控制，但证明不了「谁在 localhost 端口上监听」 | AS 对 localhost-only redirect 额外警示、明确展示 hostname |

## 6. prompt injection 与工具毒化（C4）

**结构性风险，不是 bug**：MCP 的 tool 是「模型发现 + 自动调用」的，tool 的 name/title/description **就是给模型读的指令**。本地安全文档把「毒化工具目录」（tool poisoning / tool shadowing / rug pull）列为五类本地威胁之一——tool 定义不用被调用就能操控 agent 如何使用**别的** server 的工具，而且 server 能在你批准后静默改定义。

规范与文档给出的防线：
- tools 规范原话：**「在信任与安全上，SHOULD 永远保留 human-in-the-loop 并有权拒绝工具调用」**——明确展示暴露了哪些工具、调用时有视觉指示、操作前有确认提示。
- 把 tool 定义当不可信输入：安装后先读一遍工具描述；优先用「批准后改动要重新确认」的客户端（协议不要求，是客户端属性）；保持工具清单最小。
- 这与 C6 相通：工具列表本身可以随授权变化，授权又是随请求的输入——所以「信任一个工具列表」是每次请求的动态决策，不是安装时的一次性决定。

## 7. 企业授权：EMA 与机对机（C5）

**EMA（Enterprise-Managed Authorization）**：把「授权决策」从个人上移到企业 IdP。标准模式里每个用户逐个授权每个 server；EMA 里 IdP（Okta/Azure AD/SSO）是权威决策者，员工用公司身份登录，IdP 按组/角色/条件访问策略放行或拒绝。

核心是 **ID-JAG**（Identity Assertion JWT Authorization Grant）流：

```text
用户 --登录--> 企业 IdP --> ID Token
client 存 ID Token
client --用 ID Token 换 ID-JAG--> IdP（此时评估策略）
client --用 ID-JAG 换 access token--> MCP AS
client --Bearer access token--> MCP server
```

要点：集中策略 + SSO + 策略执行（未授权者拿不到 token）+ 集中吊销（IdP 一改全生效）。MCP AS 侧要做：验 ID-JAG 签名（JWKS）+ audience/issuer/exp、把 IdP claim 映射成权限、用 `sub` claim 做账号关联（`email` 兜底）。另有 **OAuth Client Credentials** 扩展做机对机认证（`client_credentials` 客户端，不重定向用户）。

## 8. 无状态化后的授权上下文（C6）

方向 A 的无状态化在授权上的具体含义：

- **凭证是随请求的输入，不是连接态**。tools 规范明确：「工具集合 **MUST NOT** 因连接不同、或因同连接上其他请求的副作用而变化，但 **MAY** 因请求携带的授权而变化——因为凭证是 per-request 输入，不是连接状态。」
- 因此「同一 client 连接两次、拿到不同工具集」是**合法**的（两次授权不同）；「同一连接上先列后调、因前面请求改变工具集」是**非法**的。
- 无 session 可存授权上下文，每个请求都要重新带 token（`Authorization` 头每请求必带）。这对 C2/C3 是好事：没有会话态可劫持，audience 校验变成每个请求独立的干净边界。

## 9. 结论与待验证项

**已由规范原文支撑（grounded）**：授权可选性与角色、十步流程、`iss` 校验表、`resource` 参数、每请求 Bearer、scope step-up（`basic/authorization`）；注册三机制与 AS 凭证绑定（`client-registration`）；confused deputy、token passthrough、SSRF、mix-up、state handle 劫持、URL 注入、scope 最小化（`security_best_practices`）；EMA 的 ID-JAG 流（`enterprise-managed-authorization`）；无状态化下凭证随请求（`server/tools`）。

**待验证 / 推断（inference）**：
- **「prompt injection 是结构性风险」**：这是综合 tools.md 的 HITL 警告 + local-server-security 的「工具定义即指令」得出的定性判断，规范没有「prompt injection」专节；是否需要把「间接 prompt injection 经 tool 描述操控 agent」单列一个攻击面，值得再查 OWASP LLM 威胁模型对照。
- **audience 校验的具体落地（`aud` vs `resource`）**：规范要求「校验 token 是发给本 server 的（RFC8707/RFC9068）」，但 `aud` claim 与 `resource` 参数在落地时如何统一（JWT `aud` 数组、`resource` URI 的规范化），规范未给单一路径，是实现自决。

**下一篇衔接（方向 D 扩展体系）**：EMA / OAuth Client Credentials 是「auth extensions」，Tasks / MCP Apps / Skills 是另一批扩展——方向 D 正好把「扩展的协商机制与客户端矩阵」讲透。

## 参考

- [basic/authorization — Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index)
- [basic/authorization/client-registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)
- [tutorials/security/security_best_practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- [tutorials/security/authorization](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization)
- [tutorials/security/local-server-security](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/local-server-security)
- [extensions/auth/enterprise-managed-authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization)
- 已有产出：`_posts/2026-10-16-mcp-protocol-core.md`、`_posts/2026-10-16-mcp-transport-scale.md`
