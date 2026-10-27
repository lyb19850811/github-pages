---
report: 64
title: Coze 深度研究：字节跳动的「AI Agent 平台」，与 Dify 的关系与分水岭
date: 2026-10-27
tags: [coze, ai-agent, workflow, rag, bytedance, dify, mcp]
summary: 从 GitHub 开源仓（coze-studio/coze-loop/eino）、官方文档与多源报道一手核验字节 Coze/扣子：四子产品架构、Go 微服务技术栈、RAG 机制、开源许可边界，并专门回答它与 Dify 的关系——同类竞品而非同源，Go vs Python、开源策略反制 Dify 许可的分水岭。
math: false
---

Coze（国内名「扣子」）是字节跳动的一站式 AI Agent 开发与工作流编排平台：把 Bot/Agent、工作流、插件、知识库、数据库、变量打包进一个可视化开发环境，支持零代码/低代码搭建并发布到豆包、抖音、微信、飞书、Discord、Web 等多端。本文基于 GitHub 开源仓 `coze-dev/*`、`cloudwego/eino`、官方文档与多源报道一手核验它的架构、RAG 机制、开源策略，并**专门回答「Coze 与 Dify 什么关系」**（§8）。

## 一、结论先行

- **它是「平台 + 生态」，不是单点产品。** 官方口径 Coze 是「新一代 AI Agent 平台」，由四个子产品组成：**Coze Space（扣子空间，多 Agent 协作工作台）、Coze Studio（一站式可视化开发）、Coze Loop（扣子罗盘，全生命周期评测/观测）、Eino（Go 语言 LLM 框架）**。
- **血统：字节跳动 AI 创新业务部门 Flow 出品。** 项目 2023 下半年启动（内部代号 "Bot Studio"），国内「扣子」与海外 Coze 于 2024-02 前后上线；运营主体「北京春田知韵科技有限公司」，北京抖音信息服务有限公司全资持股。
- **技术栈是 Go 微服务 + React/TS，与 Dify 的 Python/Flask 完全不同。** Coze Studio 后端 Golang（Hertz HTTP 框架 + Thrift IDL），前端 React + TypeScript，微服务 + DDD；运行引擎复用字节自研 **Eino**，前端工作流画布复用 **FlowGram**。
- **2025-07-26 把最核心的两个引擎开源（Apache 2.0 无附加条款）：** Coze Studio（源自服务数万企业/数百万开发者的「扣子开发平台」）+ Coze Loop（源自企业级「扣子罗盘」）。开源两天破 6k star，截至 2026-10 coze-studio ≈21.8k stars。
- **版本演进指向「多 Agent 协作」：** 2025-04 推出扣子空间（Coze Space），2026-05-29 发布 3.0（多人 + 多 Agent 协作、接入 OpenClaw/Claude Code），2026-08 传出扣子并入豆包、统一品牌「豆包工作」。
- **Coze 与 Dify 的关系一句话：** 同类**直接竞品**（都是「可视化 LLM 应用/Agent 开发平台」），但**零代码血缘**（Go vs Python、微服务 vs 一体化、字节 vs 开源创业公司）；且 Coze 2025 年的开源动作是**明确冲着 Dify 的「源可见」许可去的**——用「Apache 2.0 无附加条款」反制 Dify 的「Apache 2.0 + 附加条件」。
- **选型边界一句话：** 要「零代码/低代码、多 Agent 协作、发布到抖音/豆包等字节生态、不想管运维」→ Coze（SaaS）；要「私有化部署、深定制 RAG 管线、代码级可控、避免厂商锁定」→ Dify；要「纯 Go 技术栈自建 Agent 平台」→ 直接上开源版 Coze Studio + Eino。

## 二、认识：它是什么

### 血统与定位

| 项 | 事实 | 依据 |
|---|---|---|
| 出品方 | 字节跳动（ByteDance），AI 创新业务部门 **Flow**（2023-11 成立） | deepdh.com 导航 / SCMP |
| 内部代号 | "Bot Studio"，2023 下半年启动 | deepdh.com |
| 上线时间 | 国内「扣子」（coze.cn）与海外 Coze（coze.com）2024-02 前后上线 | SCMP / BaiduBaike |
| 运营主体 | 北京春田知韵科技有限公司（北京抖音信息服务有限公司全资持股） | deepdh.com |
| 定位 | 新一代 AI Agent 平台；四子产品 Space / Studio / Loop / Eino | byteplus blog 原文 |
| 对标 | OpenAI GPTs（海外）、Dify（国内开源 LLM 应用平台） | SCMP / 腾讯云访谈 |

值得注意：与 anythingLLM 的 Mintplex Labs（YC S22）、Dify 的 LangGenius（开源创业公司）不同，Coze 是**大厂内部 AI 创新部门的产品**——它背靠豆包（Doubao）模型与抖音/飞书分发生态，商业化路径与「开源创业公司靠企业版收费」完全不同（见 §11）。

### 四子产品：一次官方口径的确认

Coze 官方（byteplus blog，2025-07-29）明确把 Coze 拆成四个子产品：

| 子产品 | 中文名 | 职责 | 开源 |
|---|---|---|---|
| **Coze Space** | 扣子空间 | 多 Agent 协作工作台（一人/多人调度多个 Agent） | 否（SaaS） |
| **Coze Studio** | 扣子开发平台 | 一站式可视化开发：Agent/App/Workflow/插件/知识库 | ✅ Apache 2.0（2025-07-26） |
| **Coze Loop** | 扣子罗盘 | Agent 全生命周期：prompt 开发 / 评测 / 可观测性 | ✅ Apache 2.0（2025-07-26） |
| **Eino** | — | Go 语言 LLM 应用开发框架（运行引擎 + 模型抽象） | ✅ Apache 2.0（更早，cloudwego） |

一句话：**Space 是「用 Agent 干活的工作台」，Studio 是「造 Agent 的开发台」，Loop 是「调/测/看 Agent 的运维台」，Eino 是「支撑前三者的 Go 运行框架」。**

### 版本演进（1.0 → 开源 → 3.0 → 并入豆包）

- **2023 H2**：项目启动（代号 Bot Studio），Flow 部门成立。
- **2024-02**：国内「扣子」与海外 Coze 上线，最初形态是「Bot 开发平台」，对标 OpenAI GPTs。
- **2024-10**：上线 Coze IDE（在线编码 + 运行环境 + 插件托管 + AI 辅助）。
- **2025-04**：推出「扣子空间」（Coze Space），从单 Bot 转向多 Agent 协作工作台（科创板日报 4/22 报道）。
- **2025-07-26**：Coze Studio + Coze Loop 开源（Apache 2.0，无附加条款），开源两天破 6k star。
- **2026-01-19**：扣子 2.0 品牌升级，定位「职场 AI，就用扣子」，新增 **Agent Skills（技能商店）**、**Agent Plan（长期计划）**、**Agent Coding**（IT 之家 / 极客公园报道）。
- **2026-05-29 发布 / 06-01 全端上线**：扣子 3.0（iOS/Android/Mac/Windows/Web），核心是「多人 + 多 Agent 协作」，深化「编程项目」（网页/App/小程序多人协作开发）与「视频项目」两大领域，支持一键接入 OpenClaw、Claude Code。
- **2026-08**：传出「TRAE、扣子并入豆包，统一品牌『豆包工作』」[`[INFERENCE]` 二手源，品牌整合进度未官方确认]。

## 三、解剖：Coze Studio 系统架构

Coze Studio 是理解 Coze 工程底色的最佳样本——它把商业平台的「核心引擎」完整开源了。一手证据（`coze-dev/coze-studio` README + 源码结构）：

### 技术栈与进程模型

| 层 | 事实 | 依据 |
|---|---|---|
| 后端语言 | Golang（要求 go ≥ 1.23.4） | README badge |
| HTTP 框架 | Hertz（cloudwego/hertz，高性能 Go HTTP 框架） | README acknowledgments |
| 服务间通信 | Thrift IDL（源码 `backend/**/.hz` 目录，Hertz 的 IDL 生成） | 源码结构 + 阿里云对比文 |
| 前端 | React + TypeScript | README |
| 架构范式 | 微服务 + 领域驱动设计（DDD） | README |
| 运行引擎 | Eino（agent/workflow 运行时、模型抽象、知识库索引与检索） | README acknowledgments |
| 前端画布 | FlowGram（bytedance/flowgram.ai，工作流搭建引擎） | README acknowledgments |

关键洞察：**Coze Studio 自己不做「编排内核」，它把 Agent/Workflow 的运行时委托给 Eino，把前端画布委托给 FlowGram。** 这解释了为什么 Coze 能「开源核心引擎」——引擎本来就是独立框架，Studio 是「把这些框架组装成可用的开发平台的壳」。

### 后端源码结构（一手）

`backend/api/handler/coze/` 下的 handler 直接映射了功能域：`agent_run_service.go`、`workflow_service.go`、`plugin_develop_service.go`、`knowledge_service.go`、`database_service.go`、`memory_service.go`、`conversation_service.go`、`message_service.go`、`bot_open_api_service.go`、`developer_api_service.go`、`intelligence_service.go`、`resource_service.go`……这确认了 Coze Studio 的功能域边界：**Agent 运行、工作流、插件、知识库、数据库、记忆、会话、消息、OpenAPI/开发者 API、智能体（intelligence）**。`backend/api/middleware/` 还有 `session.go`、`openapi_auth.go`、`ctx_cache.go`、`request_inspector.go`，印证了 PAT（Personal Access Token）鉴权与会话模型。

### 部署形态

Docker Compose 一键起（`make web` 或 `docker compose up`），默认 `http://localhost:8888`。README 明确标注开源版与商业版有功能差异（如「tone 定制」等仅商业版），且给出**公网部署安全风险清单**：账户注册、工作流代码节点的 Python 执行环境、Coze Server 监听地址、SSRF、部分 API 越权——这与 Dify 的 agent 沙箱是两种不同的安全边界处理（§8）。

## 四、核心概念与构建单元

Coze 的「资源」概念把可复用单元统一收编（一手 `coze.cn/open/docs` + Studio README）：

- **Bot / Agent**：Coze 的构建主体。单 Agent 模式下，一个 Bot 由「人设与提示词 + 模型 + 插件 + 工作流 + 知识库 + 变量 + 记忆」组成；多 Agent 模式下（Coze 3.0），一个项目可编排多个 Agent 协作（`@` 调度）。
- **Workflow（工作流）**：可视化画布上拖拽节点搭建业务逻辑（LLM 节点、条件分支、循环、代码节点、数据库节点、插件节点），节点间用变量传值。这是与 Dify/n8n 最直接同构的能力。
- **Plugin（插件）**：把第三方 API/私有能力封装成可调用工具，是扩展 Agent 能力边界的核心机制；Coze 官方提供了开源插件示例。
- **Knowledge（知识库）**：RAG 的载体（见 §5）。
- **Database（数据库）**：结构化存储，可被 Agent 读写，配合变量做有状态业务。
- **Variable（变量）**：跨节点/跨轮次传值的状态容器。
- **Memory（记忆）**：按用户维度存历史对话与偏好，让 Agent 产生个性化回答（与 mem0/AnythingLLM 工作区记忆是同赛道能力）。
- **App（应用）**：把工作流/Agent 打包成可发布的应用，业务逻辑走工作流。

多 Agent 模式是 Coze 3.0 的分水岭（官方文档 `guides_multiagent`）：单 Agent 模式下复杂任务要写冗长提示词、堆插件/工作流，任何一处改动都可能牵动整体；多 Agent 模式把任务拆给多个专职 Agent，`@` 一下全员就位、多项目独立管理、资产自动沉淀。这是它相对 Dify「单 Agent 可控性优先」路线的最大差异（§8）。

### 常用功能全景（一手 `coze.cn` 文档 + 首页）

| 功能 | 具体能力 |
|---|---|
| 智能体（Agent/Bot） | 自然语言 / AI 创建；单 Agent 与多 Agent 两模式；人设 + 模型 + 插件 + 工作流 + 知识库 + 变量 + 记忆 |
| 工作流 / 对话流 | 工作流处理功能类请求（顺序节点）；对话流（chatflow）面向对话式 App / 客服，可拆分用户指令为步骤节点并设计 UI |
| 插件 | 官方 1 万+ 插件（图像/文本/搜索/数据分析/语音识别等）；可封装任意第三方 API/私有能力 |
| 知识库 | PDF/文本/表格/图片；数据源含 TXT、网页、Notion、数据库、API JSON |
| 数据库 / 变量 | 结构化存储 + 跨节点/跨轮次状态 |
| 长期记忆 | 按用户维度记历史与偏好，个性化回答 |
| 发布渠道 | 飞书、微信（含微信客服）、抖音（含抖音企业号）、豆包、智能体商店、Web、API/SDK |
| 触发器 / 日程 | 定时触发，Agent 云端按时自动开工 |
| 多模态 | 语音（旁听会议/按住说话）、图像、音频组件 |

### 执行环境三态与工具链

Coze 3.0 把「Agent 在哪干活」做成可组合的三态执行环境（`coze.cn` 首页原文）：

- **桌面端**（macOS/Windows）：Agent 操作本地文件与办公软件（如「整理下载目录里的合同，按项目归档并生成清单」）。
- **云端服务器**：运行代码、浏览器与数据任务。
- **云手机**：操作 App 与移动端流程。

配套工具链：**扣子云盘**（本地/云端/手机三端同步）、**扣子 App**（旁听会议实时识别多人发言、自动生成纪要，飞书/微信内接任务）、**Coze IDE**（在线编码 + 插件托管 + AI 辅助，2024-10）、**Coze CLI**（命令行管理 Web/App/小程序/Agent/工作流/Skill 项目全生命周期）。

## 五、RAG 机制

Coze 通过「知识库」实现 RAG。一手事实边界：

- **摄取**：上传文本、表格、图片等内容，自动分块（chunking）后写入向量库。
- **检索**：向量语义检索，支撑 Agent 在回答前召回相关片段，缓解幻觉与专业领域知识缺失。
- **底层**：开源版 Coze Studio 的知识库「索引与检索」由 **Eino** 提供（Studio README acknowledgments 原文），即 Coze 的 RAG 不是自研黑盒，而是落在 Eino 的 `Retriever`/`Embedding` 组件抽象 + 向量库实现上。

**对照 Dify/AnythingLLM：** Dify 的 RAG 是「可视化管线 + 父子分块 + 全文/向量/混合检索 + 重排」的深度可控；AnythingLLM 是写死的 `RecursiveCharacterTextSplitter`（1000 字符/20 重叠）+ 余弦检索。**Coze 的 RAG 偏「黑盒/开箱即用」**——底层实现在 Eino，商业 SaaS 版对 chunk 参数、检索算法、重排的暴露程度低于 Dify；要精细控制 RAG 应选 Dify，要「上传即用」选 Coze。[`[INFERENCE]` SaaS 版知识库 UI 的精细度因 SPA 文档无法逐一核验，以官方「自动分块 + 向量存储」口径为准]

## 六、模型适配层

Coze 的模型接入分三态（一手）：

| 形态 | 默认模型 | 可接外部 | 依据 |
|---|---|---|---|
| 国内扣子（coze.cn） | 豆包（Doubao）模型，如 `doubao-seed-2.x`（豆包 2.0 pro/Code 等） | 扣子模型按输入/输出 token 扣积分，官方统一收费 | coze.cn model_service 文档 |
| 海外 Coze（coze.com） | GPT/Claude/Gemini 等 | 多家第三方 | coze.com 文档口径 |
| 开源版 Coze Studio | 需自配 | OpenAI + Volcengine（Ark）等服务 | Studio README / model_config |

关键点：**国内扣子的模型默认是字节自家豆包，这是它相对 Dify（中立、可接上百家模型）的最大「厂商锁定」面**；但 Coze 也支持接外部模型，且开源版完全可自由配 OpenAI/火山引擎 Ark。Eino 的模型抽象层（`ChatModel`/`Embedding` 组件，官方实现覆盖 OpenAI/Claude/Gemini/Ark/Ollama 等）保证了「换模型」在开源版是可行且被官方支持的。

## 七、开源生态与许可边界

### 三个 Apache 2.0 内核

| 项目 | 语言 | stars（2026-10） | 许可 | 定位 |
|---|---|---|---|---|
| `coze-dev/coze-studio` | TypeScript（后端 Go） | ≈21.8k / 3.1k forks | Apache 2.0 | 一站式 Agent 开发平台（可视化） |
| `coze-dev/coze-loop` | Go | ≈5.8k / 802 forks | Apache 2.0 | 全生命周期（prompt 开发/评测/可观测） |
| `cloudwego/eino` | Go | ≈13.4k / 1.2k forks | Apache 2.0 | Go LLM 应用开发框架（借鉴 LangChain/ADK） |

三者都是 **Apache 2.0 无附加条款**，官方明确「可自由用于任何商业用途、含专利授权」。

### SDK 与生态矩阵（coze-dev org，一手）

- **API/SDK**：`coze-py`（Python，491★）、`coze-js`（TS，292★）、`coze-java`（214★）、`coze-go`（108★）、`coze-c`、`coze-ios`、`coze-android`——全 MIT。
- **CozeLoop SDK**：`cozeloop-python/js/go`（trace 上报，商业版与开源版通用）。
- **MCP**：`coze-mcp-server`（Python，把 Coze 以 MCP server 暴露给外部客户端）、`coze-openclaw-plugin`（OpenClaw 插件）。
- **示例**：`coze-cookbook`（Coze API/SDK 示例）。

**许可边界一句话：** 与 anythingLLM（MIT）、Eino/Studio/Loop（Apache 2.0）的「真开源」不同，Coze **SaaS 平台本体（Space/商业 Studio）是闭源的**；开源的是「引擎/开发台」，商业模式靠 SaaS 订阅 + 豆包模型 token 收费，而非卖开源的企业版。这与 Dify「源码可见但带附加条件」的路线形成一组有趣的对照（§8）。

## 八、Coze ↔ Dify：关系与分水岭（回答「什么关系」）

**直接结论：Coze 与 Dify 是同一品类（可视化 LLM 应用/Agent 开发平台）的直接竞品，但零代码血缘、零组织关系——不是 fork、不是衍生、不是上下游。** 它们的「关系」是市场竞对 + 一条刻意针对的许可/开源策略分水岭。

### 1. 代码血缘：零

| 维度 | Coze（扣子） | Dify |
|---|---|---|
| 出品方 | 字节跳动（Flow） | LangGenius（开源创业公司） |
| 后端语言 | **Go**（微服务 + Hertz + Thrift IDL + DDD） | **Python**（Flask/Celery，一体化） |
| 前端 | React + TypeScript | React + TypeScript（Next.js） |
| 运行/编排内核 | Eino（自研 Go 框架） | 自研 Python 编排 + LangChain 生态 |

两种完全不同的技术栈和演进路线，**不存在「Coze 抄 Dify 代码」的事实基础**（语言都不通）。社区早期有「扣子 UI 借鉴 Dify」的议论，但那是视觉/交互层面的观感，不是代码关系，本文不作事实断言。

### 2. 定位分水岭：产品 vs 平台、托管 vs 私有化

| 维度 | Coze | Dify |
|---|---|---|
| 形态 | **SaaS 为主**（coze.cn/coze.com），开源 Studio/Loop 可自托管 | **可自托管**为主（社区版），也有 Cloud |
| 目标用户 | 非开发者/业务用户/字节生态创作者，零代码优先 | 开发者/企业，代码级可控 + 低代码 |
| 多 Agent | Coze 3.0 强项（多人多 Agent 协作、Coze Space） | 单 Agent 可控性优先，多 Agent 较弱 |
| 分发 | 一键发布豆包/抖音/微信/飞书/Discord 等 | API/嵌入为主，无平台分发 |
| 模型 | 默认豆包（国内锁定字节生态） | 中立，上百家 provider |
| RAG | 开箱即用、黑盒（Eino 支撑） | 可视化管线、父子分块、混合检索 + 重排，深度可控 |
| 部署 | Docker Compose（Studio/Loop）；SaaS 免运维 | Docker Compose / Helm / K8s，运维可控 |

一句话：**Dify 是「给开发者的、可私有化的、深度可控的 LLM 应用中台」；Coze 是「给业务用户的、托管多端的、多 Agent 协作的 Agent 平台」**。国内企业常见的组合是「Dify 做核心 AI 中台（私有化/深定制）+ 扣子覆盖轻量终端场景（分钟级上线）」，高低搭配（知乎/阿里云对比文同口径）。

### 3. 开源策略：Coze 用 Apache 2.0 反制 Dify 的「源可见」许可

这是两者关系里**最锋利、也最有据可查**的一点：

- **Dify 的许可**是「Dify Open Source License」——**Apache 2.0 + 附加条件**，并非 OSI 纯开源（本系列 anythingLLM/Open WebUI 报告已核验）。它的核心是「源码可见 + 可自托管」，但商用二次分发有附加约束。
- **Coze 2025-07-26 的开源动作**，社区一手表述是「采用了**比 Dify 开放程度更高**、无任何附加条款、可自由用于任何商业用途的 Apache 2.0 许可证」（`coze-studio` GitHub issue #212 原文，及腾讯云对扣子负责人的访谈）。
- 官方（byteplus blog）也强调「Commercial use: free to use in commercial products without any additional terms; Patent licensing: clear patent licensing」。

**即：Coze 在「开源合法性/商业友好度」上对 Dify 发起了一场针对性竞争。** 这解释了为何 Coze 开源两天破 6k star——它把「开源但带条件」的 Dify 作为反衬，用「Apache 2.0 无附加条款」抢占「想商用又怕许可风险」的开发者心智。但要注意：**Coze 开源的是「引擎/开发台」，其 SaaS 本体和豆包模型仍是闭源/付费的**；Dify 的「附加条件」主要约束的是「拿它的源码去做托管 SaaS 再销售」的场景——两者商业化逻辑其实殊途同归（都靠托管/企业版增值），只是开源姿态不同。

## 九、横向对比（六竞品）

| 工具 | 定位 | 许可 | 技术栈 | RAG | Agent/编排 | 目标用户 |
|---|---|---|---|---|---|---|
| **Coze/扣子** | AI Agent 平台（SaaS + 开源引擎） | Studio/Loop/Eino Apache 2.0；SaaS 闭源 | Go 微服务 + React/TS | 知识库（Eino 支撑，黑盒） | 多 Agent 协作（3.0）、工作流、插件、MCP | 非开发者/字节生态/企业 |
| **Dify** | LLM 应用开发平台 | Dify OSL（Apache 2.0 + 条件） | Python/Flask + React/TS | 可视化管线 + 父子分块 + 混合检索 + 重排 | 单 Agent + 沙箱 + 工作流 + MCP | 开发者/企业私有化 |
| **RAGFlow** | RAG 引擎（深文档解析） | Apache 2.0 | Python | 最强：DeepDoc 版面/OCR/表格 + 模板切块 + Agentic RAG | Agentic RAG + 多步检索 | 企业级复杂文档 RAG |
| **n8n** | 工作流自动化 + AI 编排 | fair-code（SUL v1.0） | TypeScript monorepo（Node + Vue） | 非内建（节点拼装） | AI Agent node + MCP（双角色）+ 1500+ 集成 | 自托管自动化/系统集成 |
| **AnythingLLM** | 自托管 RAG + Agent 工作区 | MIT | Node/Express + React + Node collector | RecursiveCharacterTextSplitter + 余弦 | `@agent` + Skills + MCP + Flows | 非开发者/小团队私有知识库 |
| **Open WebUI** | 自托管 AI 平台/聊天界面 | 源可见（保留品牌） | Python/FastAPI + SvelteKit | 混合检索 BM25+向量 + rerank + 8 提取引擎 | Tools/Functions/Pipes + 原生 MCP + OpenAPI | 要 ChatGPT 替代 + 多 provider 团队 |

（FastGPT 为另一国内低代码 AI 平台，主打知识库问答 + 私有化，社区体量与文档深度弱于 Dify，未单独展开。）

**分水岭一句话：** Coze 与 Dify 是「Agent 开发平台」赛道里最直接的一对，区别在 **Go vs Python、托管 vs 私有化、多 Agent vs 单 Agent 可控、豆包锁定 vs 模型中立**；RAGFlow 拼文档解析深度，n8n 拼系统集成，AnythingLLM/Open WebUI 拼自托管知识库/聊天界面，各自守不同阵地。

## 十、实践与红线

**何时用 Coze（扣子）：**

- 要**零代码/低代码**快速把想法变成可发布的 Agent，且不想碰运维。
- 要**多 Agent 协作**（3.0 的多人多 Agent、Coze Space），把任务拆给多个专职 Agent。
- 要**发布到豆包/抖音/微信/飞书/Discord** 等字节/社交生态，吃平台分发红利。
- 团队已用豆包模型、愿意接受字节生态绑定。

**典型使用场景（官方文档/教程佐证）：**

- **智能客服**：0 代码搭微信智能客服，一键发布到微信公众号/微信客服；售后服务类发布抖音企业号（`docs.coze.cn/tutorial_0_code_wechat_customer_service`）。
- **办公提效**：写作、PPT 生成、数据分析、报告写作——Coze 2.0/3.0 的「职场 AI 伙伴」核心场景。
- **AI 编程**：对话式开发网页/App/小程序，多 Agent 协作开发 + 部署（「扣子编程」，编程项目 3.0 起支持多人协作）。
- **视频创作**：「扣子视频」，视频项目化处理。
- **内容创作**：自媒体、播客、平面设计。
- **会议纪要**：扣子 App 旁听会议、实时识别多人发言、自动生成纪要、会后追问决定。
- **行业垂直**：3.0 内置金融/自媒体/医疗/法律/科研等行业技能包，开箱即用。
- **情感陪伴/通用问答**：发布到豆包等渠道的个人助手类 Agent。

**何时别用 Coze：**

- **敏感数据私有化/合规强要求**：SaaS 托管意味着数据出域，选 Dify 私有化或 RAGFlow。
- **深定制 RAG 管线**（自定义 chunk、混合检索、重排、父子分块）：选 Dify，Coze 的知识库偏黑盒。
- **纯代码框架级控制**（要自己写编排、自定义算子、嵌入自研系统）：直接上 Eino（Go）或 LangChain/LlamaIndex，别套 SaaS。
- **中立模型策略 / 避免厂商锁定**：选 Dify 或 Open WebUI。

**常见坑：**

- **模型维度一致性**：换模型/换 embedding 要注意向量维度一致，否则检索报错（本系列 anythingLLM/mem0 已多次核验此机制，Coze 同理）。
- **公网部署安全**：开源版 Coze Studio/Loop 的 README 明确列出账户注册、代码节点 Python 执行环境、SSRF、越权等风险，公网部署前必须按官方 Quickstart 做加固——这与 Dify 的 agent 沙箱隔离是不同安全模型，别默认「开源 = 安全」。
- **国内/海外/开源三态差异**：coze.cn 默认豆包并扣积分、coze.com 接第三方、开源版要自配模型；三个文档体系、功能边界不完全一致，别混用结论。
- **开源版 ≠ 商业版功能全集**：README 明示部分能力（如 tone 定制）仅商业版。

## 十一、趋势与风险 + 附录

**趋势与风险：**

- **并入豆包（豆包工作）**：2026-08 传出 TRAE、扣子并入豆包、统一品牌。若落地，Coze 将从「独立产品」变成「豆包 AI 生产力矩阵的一环」，这强化了字节生态锁定，但也带来品牌/产品定位的再整合不确定性。[`[INFERENCE]` 二手源，进度未官方确认]
- **多 Agent 是主战场**：Coze 3.0 押注「多人 + 多 Agent 协作」，与 Dify 的「单 Agent 可控」、n8n 的「工作流编排」形成三角，Agent 协作编排会成为 2026 下半年的竞争焦点。
- **开源策略的双刃剑**：Apache 2.0 无附加条款抢占心智，但开源「引擎」而非「SaaS 本体」，长期社区共建能否跑通、是否重走「开源引流 + 云托管变现」的云厂商老路，需观察。
- **许可风险提示**：Coze 开源件（Studio/Loop/Eino）是干净的 Apache 2.0，但 Coze 商标、扣子/豆包品牌、抖音/飞书分发 API 各自有服务条款约束，商用集成要分别读原文，不能当「整体 Apache 2.0」用。

**附录 A：coze-dev 开源项目速查（2026-10）**

| 项目 | 语言 | stars | 许可 | 用途 |
|---|---|---|---|---|
| coze-studio | TS/Go | 21,762 | Apache-2.0 | Agent 开发平台（可视化） |
| coze-loop | Go | 5,789 | Apache-2.0 | Agent 全生命周期（评测/观测） |
| coze-py / js / java / go / c / ios / android | 多语言 | 491/292/214/108/15/8/15 | MIT | API/SDK |
| cozeloop-python / js / go | 多语言 | 33/19/57 | MIT | Loop trace SDK |
| coze-mcp-server | Python | 47 | MIT | Coze 的 MCP server |
| coze-cookbook | — | 17 | MIT | API/SDK 示例 |

**附录 B：与 Dify 对照速查**

| 问题 | 答案 |
|---|---|
| Coze 是 Dify 的 fork 吗？ | 否。Go vs Python，零代码血缘。 |
| 有组织/资本关系吗？ | 否。字节跳动 vs LangGenius（开源创业公司）。 |
| 是什么关系？ | 同类直接竞品 + 许可/开源策略上的针对性竞争。 |
| 谁更「开源」？ | 开源件层面 Coze（Apache 2.0 无附加条款）> Dify（OSL 带条件）；但 Coze SaaS 本体闭源，Dify 社区版整体可自托管。 |
| 选谁？ | 零代码多 Agent 发布字节生态 → Coze；私有化深定制 RAG/模型中立 → Dify。 |

**参考文献（一手源）：**

1. `coze-dev/coze-studio` GitHub README（技术栈/Feature list/License/部署/安全风险）。
2. `coze-dev/coze-loop` GitHub README（prompt 开发/评测/可观测，源自扣子罗盘）。
3. `cloudwego/eino` GitHub README（Go LLM 框架，借鉴 LangChain/ADK）。
4. BytePlus blog《Coze is Embracing Open Source》（2025-07-29，四子产品 + 开源声明）。
5. `langgenius/dify` GitHub README（Dify Open Source License + 159.6k stars）。
6. 财联社/新浪/腾讯新闻《扣子 3.0 上线》（2026-06）。
7. 科创板日报《大厂 AI Agent 角逐 字节跳动携扣子空间进击》（2025-04-22）。
8. 腾讯云开发者社区《扣子官宣开源，掀桌大动作背后如何决策？扣子负责人独家披露》（2025-07）。
9. 163《字节跳动整合 AI 生产力：TRAE、扣子并入豆包》（2026-08）。
10. 阿里云开发者社区《Coze 与 Dify 全面对比》（2025-08）。
