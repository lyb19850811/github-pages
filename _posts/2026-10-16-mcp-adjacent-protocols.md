---
title: MCP 相邻协议：A2A、function calling 与 Skills 的选型边界
date: 2026-10-16
tags: [mcp, protocol, agents]
summary: MCP 在更大的 Agent 生态里怎么定位——A2A（水平协作）、原生 function calling（单厂商最简）、Agent Skills（教工作流）各自的正反结论，以及何时该用、何时明确不该用。
math: false
---

> 前面六篇都在 MCP 内部；这篇是 L4 的落点——**选型论证与反向结论**。协议选错方向，后面所有工程努力都打折。

## 0. 结论先行

1. **MCP 是「垂直」连接（Agent↔工具/数据），A2A 是「水平」连接（Agent↔Agent），function calling 是「原生」连接（单厂商单模型），Skills 是「教工作流」而非「接能力」——四者不是竞品，是分工。**
2. **每个的反向结论**：MCP 的反面是「单厂商单宿主时它是过度标准化」；A2A 的反面是「只有一个 agent 时它是过度设计」；function calling 的反面是「要跨宿主复用/标准授权时它绑死供应商」；Skills 的反面是「要接外部动态能力时它是静态指令、不是执行环境」。
3. **A2A 是 Google 发起、已捐给 Linux Foundation 的开放标准**，让不同框架（LangGraph/CrewAI/Google ADK/Genkit）的 agent 互相发现能力并安全协作——与 MCP 同处 Linux Foundation 治理之下，互补而非竞争。
4. **组合是常态**：MCP + A2A 分层（接工具 + 多 agent 编排互不冲突），Skills + MCP（教工作流 + 接工具）。

## 1. 格局：四条线各司其职

| 技术 | 方向 | 一句话 | 归属 |
|---|---|---|---|
| MCP | 垂直：Agent ↔ 工具/数据 | 给单个 agent 接外部工具、数据源、提示，跨宿主复用 | Linux Foundation |
| A2A | 水平：Agent ↔ Agent | 不同框架的 agent 互相发现、协作完成一个任务 | Linux Foundation（Google 发起） |
| 原生 function calling | 原生：单厂商单模型 | 模型直接调宿主定义的函数，最简 | 各厂商私有 |
| Agent Skills | 教工作流：指令 + 支持文件 | 把「怎么做一件事」教给 agent，不接外部能力 | 宿主本地 / Skills over MCP |

> 承接上一篇《协议演进》的格局图：MCP 管「一个 agent 的触手」，A2A 管「多个 agent 的手拉手」。ACP（Agent Client Protocol）已并入 A2A，两者均入 Linux Foundation。

## 2. 四个反向结论（L4 核心）

选型不是「这个技术好不好」，是「这个技术**不该用在哪**」。每题给正反两面。

### 2.1 MCP 的反向结论

**正**：跨宿主复用同一套工具、标准授权（OAuth 2.1 子集）、生态（Registry + 官方扩展）。

**反（何时不该用 MCP）**：
- **单厂商单模型单宿主** → 原生 function calling 更简单，少一层协议、少一套 JSON-RPC 语义、少一次能力协商。
- **工具内部私有、永不换宿主** → MCP 的「标准化」是成本不是收益；直接用你语言的 SDK 调内部 API 更直接。
- **不需要「让 LLM 动态发现/选择工具」** → 如果调用图是确定的（代码里写死调用顺序），MCP 的 tools/list 发现 + 模型选择是多余的。

**一句话反论**：MCP 买的是「跨平台复用 + 标准授权 + 生态」，如果你这三样都不要，它就是纯开销。

### 2.2 A2A 的反向结论

**正**：多 agent、跨框架（LangGraph 的 agent 调 CrewAI 的 agent）、松耦合发现、安全协作。

**反（何时不该用 A2A）**：
- **只有一个 agent** → A2A 的发现/协商/capability 交换是过度设计；MCP 接工具就够了。
- **agent 之间是紧耦合编排**（你完全控制所有 agent 的代码和调用顺序）→ 用编排框架（LangGraph/ADK 的工作流）直接调，不需要 A2A 的「发现 + 协商」开销。
- **不需要跨团队/跨供应商的 agent 互操作** → A2A 的价值在「互不了解的 agent 之间协作」，同一团队内用函数调用更简单。

**一句话反论**：A2A 买的是「互不了解的 agent 之间的互操作」，同构、受控、单团队场景它是额外的发现层。

### 2.3 function calling 的反向结论

**正**：单厂商单模型最简，零额外协议。

**反（何时 function calling 不够）**：
- **同一套工具要接多个宿主**（Claude + ChatGPT + Copilot）→ function calling 绑死单厂商，换一个宿主重写一遍。
- **要标准授权与审计** → 原生 function calling 没有统一的授权语义（各厂商各做各的），MCP 的 OAuth 2.1 子集 + audience 校验是现成的。
- **要第三方工具生态** → function calling 没有 Registry、没有官方扩展、没有 Inspector 这类一致性工具。

**一句话反论**：function calling 是「当下最简」，MCP 是「跨平台的投资」——当「跨平台」不是需求时，function calling 赢。

### 2.4 Skills 的反向结论

**正**：把可复用的工作流（代码评审清单、文档处理步骤）教给 agent，指令跟着服务走（Skills over MCP）。

**反（何时不该用 Skills）**：
- **要接外部动态能力**（查数据库、调 API、执行动作）→ Skills 是「静态指令 + 支持文件」，不是执行环境；该用 tool（MCP）。
- **工作流依赖实时数据** → Skills 的 `SKILL.md` 是 markdown 指令，不执行、不联网；动态数据要 tool。
- **需要机器可验证的契约**（输入输出 schema、错误语义）→ Skills 教「怎么做」，tool 定义「能做什么、返回什么」。

**一句话反论**：Skills 教「流程知识」，tool 接「执行能力」——把「调用外部系统」硬塞进 `SKILL.md` 是错用。

## 3. 组合与分层

四个技术经常同时出现，分层不冲突：

```text
Agent / Host
  ├─ MCP（垂直）── 给单个 agent 接工具/数据/提示
  ├─ A2A（水平）── 多个 agent 之间协作/编排
  ├─ 原生 function calling ── 单宿主内的最简单工具调用
  └─ Skills ── 教 agent「怎么做」的工作流指令
```

典型组合：MCP + A2A（既接工具、又做多 agent 编排，分层不冲突）；Skills over MCP + tools（同一个 server 既发工作流指令、又暴露工具）；function calling 作为 MCP 的「最简降级」——单宿主时退回 function calling，跨平台时上 MCP。

## 4. 结论与待验证项

**已由原文支撑（grounded）**：A2A = Google 发起、捐给 Linux Foundation 的开放标准，跨框架（LangGraph/CrewAI/Google ADK/Genkit）agent 发现能力并安全协作（`a2a-protocol.org`）；MCP 的垂直定位、授权/生态能力（前六篇已证）；Skills 的「指令 + 支持文件」语义与「读 SKILL.md ≠ 激活」（方向 D）。

**待验证 / 推断（inference）**：
- **「A2A 的反向结论」**：A2A 的「发现/协商」原语（如 agent card）我未读其规范原文，只据官网「discover capabilities + collaborate」推断；「紧耦合编排用框架不用 A2A」这条反论需对照 A2A spec 的意图再定稿。
- **「ACP 已并入 A2A」**：承接上一篇《协议演进》的既有结论，本篇未重新核实（SEP-414 的参考里 ACP 还以 `agentclientprotocol/agent-client-protocol` 独立出现，时间点上可能早于并入）。

**下一篇衔接（方向 H 生产可观测）**：本篇是「MCP 之外的选型」，方向 H 回到 MCP 内部的生产化——可观测性、缓存、版本兼容。

## 参考

- [A2A Protocol — Agent2Agent](https://a2a-protocol.org/)
- 已有产出：`_posts/2026-10-16-mcp-protocol-evolution.md`（含 A2A 选型决策树初版）、`_posts/2026-10-16-mcp-extensions.md`（Skills 语义）
