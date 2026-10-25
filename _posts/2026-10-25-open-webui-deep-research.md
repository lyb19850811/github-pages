---
report: 60
title: Open WebUI 深度研究：无状态架构下的自托管 AI 平台
date: 2026-10-25
tags: [open-webui, self-hosted, llm, rag, agents, svelte, fastapi]
summary: 从仓库源码、LICENSE 与官方文档一手核验 Open WebUI：无状态容器优先架构、混合检索 RAG、Python 插件体系、可水平扩展，以及它与 AnythingLLM、Dify、RAGFlow 等六个同类工具的选型边界。
math: false
---

Open WebUI 是一个自托管 AI 平台（官网原话 "a home for AI"），把多模型聊天、RAG 知识库、Agent 工具、语音/图像、团队协作打包进一个可完全离线运行的界面。本文基于仓库 `open-webui/open-webui`、LICENSE 原文与官方文档 `docs.openwebui.com` 一手核验它的架构、RAG 机制、插件体系与许可边界，并与 AnythingLLM（本系列已研究对象）、Dify、RAGFlow 等六个同类工具做选型对比。

## 一、结论先行

- **它是一个「平台」，不是「产品」。** 官方自己说 "Open WebUI is a platform, not a locked-down product"——它的哲学是让任何人用 Python 扩展、连接任何模型、拥有自己的数据（"Own it" 使命），与 AnythingLLM「把能用门槛压到最低」的产品化取向相反。
- **许可是「源可见」而非 OSI 开源。** 核心条款 `Open WebUI License` 要求保留 "Open WebUI" 品牌标识（名称/logo/符号），但给了一个关键豁免：**任何滚动 30 天内终端用户 ≤ 50 人的部署可以去掉品牌**。商用二次分发/改品牌必须读原文，不能当 MIT 用。
- **技术栈干净且现代：** 前端 SvelteKit，后端 Python + FastAPI + Uvicorn，**自 v0.9.0 起完全异步**（async SQLAlchemy + aiosqlite）。对比 AnythingLLM 的 Vite+React + Node/Express + Node collector 三进程，栈完全不同。
- **架构是「无状态、容器优先」。** 默认单实例（SQLite + ChromaDB + 本地文件）最小部署；要水平扩展就必须把状态外化到 PostgreSQL + Redis + 外部向量库 + 共享存储，让应用层无状态、可在负载均衡后任意扩副本。这是它与 AnythingLLM「单容器有状态」最本质的工程分野。
- **社区体量惊人：** ≈156k GitHub stars（2026-10）、512K+ 社区成员、3 亿+ 次下载，是同类里最大的；背后有 A16z 2025 开源资助、Mozilla Builders 2024、GitHub Accelerator 2024。
- **RAG 深度不弱：** 混合检索（BM25 + 向量）+ cross-encoder rerank，9+ 向量库、8 个内容提取引擎，且有「Full Context 全文注入」模式（不切块）。比 AnythingLLM 的 `RecursiveCharacterTextSplitter` + 余弦检索更立体，但默认 chunk/embedding 模型未硬编码文档化（见 §4 存疑项）。
- **插件体系极宽：** Tools / Functions / Filters / Actions / Pipes / Skills + 原生 MCP（Streamable HTTP）+ OpenAPI 自动发现 + 任意 Python 代码。代价是安全责任完全转移给用户（见 §6 安全警告）。
- **选型边界一句话：** 想要「可扩展、可水平扩展、多模型统一界面、能写 Python 插件」的自托管 AI 平台 → Open WebUI；想要「零代码、开箱即用的私有知识库 + 简单 Agent 产品」→ AnythingLLM。

## 二、认识：它是什么

### 血统与技术栈

| 项 | 事实 | 依据 |
|---|---|---|
| 出品方 | Timothy Jaeryang Baek（GitHub 用户名 tjbck），现归 Open WebUI Inc. | GitHub README / LICENSE |
| 仓库 | `open-webui/open-webui`，创建于 2023-10-07（原名 `ollama-webui`，后随生态改名） | GitHub / stackquadrant |
| 最新版本 | v0.12.3（2026-10-16）；近期 v0.12.1(10-15)、v0.12.0(10-11，引入实时语音/3D 头像/MFA) | stackness / openwebui.com 博客 |
| 语言 | Python（后端）+ SvelteKit（前端，静态资源 `/_app/immutable/`） | docs scaling 页 |
| 后端 | FastAPI + Uvicorn（ASGI），自 v0.9.0 起完全异步；`UVICORN_WORKERS` 控 worker 数，默认 1 | docs scaling 页 |
| 数据库 | SQLite 默认（可加密），可换 PostgreSQL | README / docs scaling |
| 部署镜像 | `ghcr.io/open-webui/open-webui`；标签 `:main`（内置 embeddings/提取/STT）、`:slim`（197MB 下载、~300MiB 空闲内存）、`:ollama`、`:cuda` | README / docs |
| 许可 | Open WebUI License（非 OSI） | LICENSE 原文 |
| 社区 | ≈156k stars / 22k forks / 874 contributors（2026-10）；512K+ 社区成员；3 亿+ 下载 | openwebui.com / stackness |

值得注意：与 AnythingLLM 的 Mintplex Labs（YC S22）不同，Open WebUI 由个人开发者 tjbck 起家、现公司化运营，且**社区规模约为 AnythingLLM（≈67k stars）的 2.3 倍**——这是它在「自托管 AI 界面」赛道的事实领导者地位。

### 部署形态与核心概念

| 形态 | 定位 | 关键差异 |
|---|---|---|
| **Docker / Compose** | 服务器自托管，多用户 | 单容器 `ghcr.io/open-webui/open-webui`（端口 3000 → 容器 8080），多用户 + RBAC |
| **pip / uv** | 单机/开发者 | `pip install open-webui && open-webui serve`，60 秒起 |
| **Desktop** | macOS/Win/Linux 原生 App | 系统级 Spotlight 聊天栏、截图、推话语音；可选内置 llama.cpp 全本地推理 |
| **Cloud / Enterprise** | 托管与企业版 | 自定义品牌、LTS、SLA、SSO/SCIM、审计日志、Sovereign AI（air-gapped 部署） |

核心概念：**Model**（任意 base model + 系统提示词 + 绑定工具/知识 + 参数，称为「预设」）、**Knowledge**（文档集合，挂载到模型或会话）、**Workspace**（用户侧工具/模型/知识管理区）、**Channels**（团队与 AI 实时共享空间，可 `@模型` 召唤）、**Notes**（会话外的富文本工作区，可注入上下文）。

### 许可边界（重点）

`Open WebUI License` 是 BSD-3-Clause 的改造版，关键差异在第 4 条「品牌保留」：

> "licensees are strictly prohibited from altering, removing, obscuring, or replacing any 'Open WebUI' branding ... except in the following circumstances: (i) deployments where total end users ≤ 50 within any rolling 30-day period; (ii) prior written permission; (iii) a duly executed enterprise license."

含义拆解：

1. **默认不能去品牌**：名称、logo、任何视觉/文本/符号标识都受保护，移除即「material breach」。
2. **50 人以下豁免**：小团队/个人自用（滚动 30 天 ≤ 50 用户）可以合法移除品牌——这是它相对 Dify 附加条款更宽松的地方。
3. **企业可谈**：超过 50 人又想改品牌，要么拿书面许可，要么买企业许可。
4. **非 OSI 批准**：这不是 OSI 定义的开源许可，Free/开源软件基金会口径下属于「源可见（source-available）」。

对比 AnythingLLM 的 **MIT**（真开源、无品牌限制），这是两者商业化路径的根本不同：AnythingLLM 靠 Cloud/Pro/企业服务赚钱但不限制开源；Open WebUI 用品牌条款为企业版/定制品牌「留门」。

### 社区与维护态势

- 资助/认可：A16z Open Source AI Grant 2025、Mozilla Builders 2024、GitHub Accelerator 2024——机构背书强。
- 活跃度：874 contributors、每周提交活跃、最新 release 10-16（研究时点前 9 天）——维护健康。
- 风险点（见 §7）：**单仓库 + 核心个人起家**的 bus factor 风险；功能扩张极快，文档与代码同步压力不小。

## 三、解剖：架构与机制

### 无状态、容器优先架构

Open WebUI 的架构范式是 **stateless, container-first**。默认交付是「自包含单实例」：嵌入式 SQLite（应用数据）+ 嵌入式 ChromaDB（RAG，同样基于 SQLite）+ 本地文件存储 + 单 Uvicorn worker。这套默认栈让个人/小团队零运维起服务。

但真正的设计亮点在**扩展路径**：它把「状态」与「计算」分离，应用层本身不持久化状态，因此可以在负载均衡器后跑任意数量的相同副本。要水平扩展，必须按序完成四件事：

1. **PostgreSQL 替换 SQLite**（数据库外移）；
2. **客户端-服务器向量库**（如 PGVector）替换嵌入式 ChromaDB；
3. **共享文件存储**（NFS/RWX PVC 或 S3/GCS/Azure Blob）；
4. **Redis** 协调会话、WebSocket、应用状态（`REDIS_URL` + `WEBSOCKET_MANAGER=redis`）。

完成外化后，副本可随时销毁重建而不丢状态。文档还给了关键生产开关：`THREAD_POOL_SIZE=2000`（默认仅 40，规模大时会全局 freeze）、`UVICORN_WORKERS=1`（推荐「同机多容器」而非「同容器多 worker」，后者在 ChromaDB 的 SQLite 后端 fork 下会崩）、以及所有副本必须共用同一 `WEBUI_SECRET_KEY`（否则登录循环/401）。

**对照 AnythingLLM**：AnythingLLM 是 `frontend + server + collector` 三进程、单容器、SQLite + LanceDB 默认且**有状态**——它的设计目标是「零配置一键起」，默认没有为水平扩展预留外化路径；高并发生产场景官方建议直接上 Open WebUI 的 Redis/多节点方案。一句话：**Open WebUI 把「可扩展」做进架构，AnythingLLM 把「能跑」做进默认**。

### RAG 机制

Open WebUI 的文档问答提供**两种检索模式**：

- **Focused Retrieval（默认，即 RAG）**：切块 → 向量化 → 按查询检索最相关 chunk 注入。开 `ENABLE_RAG_HYBRID_SEARCH` 后，**混合检索 = BM25 关键词 + 向量检索 + cross-encoder reranking**，检索质量显著强于纯向量。
- **Full Context**：把整篇文档**逐字全文注入**每条消息，不切块、不做语义检索。适合短参考文档/风格指南；代价是大文档会挤占对话历史上下文。

关键机制细节（来自官方文档 `knowledge`）：

- **提取引擎 8 个**：Tika、Docling、Azure Document Intelligence、Mistral OCR、Datalab Marker、MinerU、PaddleOCR、custom loaders——覆盖版面/OCR/表格等重解析，比 AnythingLLM 偏「抽文本」的解析厚。
- **向量库 9+ 个**：ChromaDB 与 PGVector 官方维护，另有 Qdrant、Milvus、OpenSearch、Elasticsearch、Pinecone、S3Vector、Oracle 23ai 等（README 列 9 个名字，docs features 页写「13 个」，口径差异见 §11 存疑）。
- **Agentic retrieval**：模型可自主搜索、浏览、阅读整个知识库。
- **内容处理位置可外化**：`:slim` 镜像把 embeddings/提取/语音交给外部服务，自身仅 197MB、~300MiB 空闲内存——极致轻量。

**对照 AnythingLLM**：AnythingLLM 用固定 `RecursiveCharacterTextSplitter`（1000 字符/20 重叠）、余弦检索、可选 rerank（**仅 LanceDB 支持**）、相似度阈值默认 20%。Open WebUI 的混合检索 + cross-encoder rerank + 8 提取引擎 + Full Context 模式，在「检索立体度」上更厚；**但 AnythingLLM 把 chunk 大小/重叠/阈值都透明写死并可调，Open WebUI 把这些做成可配置项、官方文档未给硬编码默认值**——前者对「想立刻理解机制」的工程师更友好，后者对「要按场景调优」的运维更灵活。

### 多模型适配层

Open WebUI 是 **provider-agnostic**：

- 原生对接 **Ollama**（本地推理首选）与**任意 OpenAI 兼容 API**（把 API URL 指向 LM Studio、GroqCloud、Mistral、OpenRouter、vLLM、LocalAI、Together、Fireworks、Perplexity、DeepSeek、xAI、Azure OpenAI、Anthropic、Google Gemini 等即可自由混用）。
- 多模型会话（side-by-side 对比）、per-user/group 模型访问控制、社区预设导入。

**对照 AnythingLLM 的本地推理**：AnythingLLM 内置 **Lemonade + llama.cpp** 推理引擎（跑 GGUF），开箱即本地推理；核心 Open WebUI **自身不做推理**，靠连接外部引擎（Ollama/LM Studio/LocalAI/vLLM），只在 **Desktop 版**内置 llama.cpp。换言之，纯服务端 Open WebUI 的「本地优先」靠 Ollama 这类外部进程实现，而 AnythingLLM 把推理引擎也收进了自家容器。

### 插件系统与 Agent 执行

这是 Open WebUI 与 AnythingLLM `@agent` 路线最大的分野——它用**一套 Python 插件体系**覆盖「模型能力」与「平台行为」两层：

- **Tools**（扩展 LLM 能力）：给模型外部实时能力（天气、股价、航班等），运行时由模型调用；在用户侧 **Workspace** 管理，可授权给用户。
- **Functions**（扩展平台本身）：改 Open WebUI 行为（加新模型 provider 如 Vertex AI、自定义过滤器、按钮、响应后处理、按用户路由/限流/计费）——在 **Admin Panel** 管理，仅管理员。
- **Filters / Actions / Pipes / Skills**：过滤器、动作、管道、Markdown 指令集（Skills 带支持文件与版本历史）。
- **MCP + OpenAPI + MCPO**：原生 Streamable HTTP 接 MCP server；OpenAPI 端点自动发现工具；`mcpo` 把任意 MCP server 转成 OpenAPI 供无胶水调用。
- **Open Terminal / Computer**：Open Terminal 给 agent 真实 terminal + filesystem，多步执行（写码、跑脚本、修错、产出文件）；**Terminals (Enterprise)** 每用户隔离容器（资源限制 + 生命周期管理）。Open WebUI Computer 是独立 mobile-first coding agent 项目，可把「机器工作区」作为模型接入。

**安全警告（官方明确）**：Tools/Functions/Pipes/Filters/Pipelines **执行任意 Python 代码**——「Featured 不等于已审计」，社区插件未经审查，且 `data` 目录（含缓存的插件）若被写入即可在服务端执行恶意代码。官方建议：只装可信源、装前读源码、限制用户 Workspace 权限、定期审计。这是「平台化」的必然代价：**灵活度与安全责任一起交给了部署者**。

## 四、为什么这么设计（取舍）

每个取舍都配反面案例：

| 取舍 | 换来的 | 牺牲的 | 反面案例 |
|---|---|---|---|
| **无状态架构** | 水平扩展、副本可随意重建、LB 后弹性 | 单实例默认栈简单但扩展前必须外化 4 组件 | AnythingLLM 单容器有状态，扩展路径不内置 |
| **平台 vs 产品** | 用户可用 Python 改一切，无需等发版 | 新手要懂插件/部署，上手门槛高 | AnythingLLM 零代码开箱即用，但深度定制受限 |
| **ChromaDB 默认** | 嵌入式零依赖、单实例零运维 | 大规模检索上限、多 worker 下 SQLite 后端崩溃风险 | PGVector/Qdrant/Milvus 云原生横向扩展 |
| **插件即 Python 代码** | 几乎任何功能都能插件化，生态爆炸 | 安全责任转移给用户，恶意插件可搞崩服务器 | Dify 给 agent 独立沙箱；AnythingLLM 工具内嵌 server 自身 |
| **Open WebUI License（品牌条款）** | 为企业版/定制品牌「留门」、保社区辨识度 | 非 OSI 开源，>50 人部署改品牌受限 | AnythingLLM MIT 无品牌限制 |
| **核心不内置推理** | 服务端轻、不绑死推理引擎 | 纯服务端本地推理需另跑 Ollama 等 | AnythingLLM 内置 Lemonade+llama.cpp 一键本地 |

一句话概括设计哲学：**把「可拥有、可扩展」做成权利，把「易用」交给 Desktop 版与社区插件。** 默认值走轻量/外化路线，需要更强能力时逐层替换（embedder → 向量库 → 数据库 → 推理引擎）。

## 五、横向对比（六竞品）

对比维度：定位、许可、技术栈、RAG 深度、多租户、Agent/MCP、目标用户。

| 工具 | 定位 | 许可 | RAG/知识 | Agent/MCP | 目标用户 |
|---|---|---|---|---|---|
| **Open WebUI** | 自托管 AI 平台 / 多模型聊天界面（平台） | 源可见（Open WebUI License，保留品牌，50 人以下可去） | 混合检索 BM25+向量+rerank；9+ 向量库；8 提取引擎；Full Context | Tools/Functions/Filters/Pipes/Skills + 原生 MCP + OpenAPI + Open Terminal | 要 ChatGPT 替代 + 多 provider + 可扩展的团队/个人 |
| **AnythingLLM** | 自托管 RAG + Agent 工作区（产品） | MIT | 内置 RAG（LanceDB 默认，可换 9 库；RecursiveCharacterTextSplitter + 余弦 + rerank 仅 LanceDB） | `@agent` + Skills + MCP + Flows（无代码） | 非开发者、小团队、要私有知识库 |
| **Dify** | LLM 应用开发平台 | 源可见（Dify OSL，Apache-2.0 + 附加条件） | RAG 管线（可视化） | Agent + 沙箱 + Marketplace + MCP | 开发者搭生产级工作流 |
| **RAGFlow** | RAG 引擎（深文档解析） | Apache-2.0 | 最强：DeepDoc 版面/OCR/表格、模板切块、Agentic RAG | Agentic RAG + 多步检索 | 企业级复杂文档 RAG |
| **LibreChat** | 多 provider ChatGPT 界面 | MIT | 弱（RAG 拆到独立 `rag-api`） | Agents + Skills + Subagents + MCP + 代码解释器 | 要统一聊天入口的个人/团队 |
| **PrivateGPT** | 本地 AI 的 API 层（不是产品） | Apache-2.0 | 检索 + 引用 + agentic RAG（API 暴露） | Claude API 风格工具 + MCP | 开发者自建私有 AI 应用 |
| **Khoj** | 个人「第二大脑」 | AGPL-3.0 | 语义搜索个人文件 | 自定义 Agent + 自动化 | 个人知识管理 |

**AnythingLLM ↔ Open WebUI 重点 1v1 对照**（本系列两研究对象）：

| 维度 | Open WebUI | AnythingLLM |
|---|---|---|
| 自我定位 | 平台（platform, not locked-down product） | 产品（all-in-one 工作区） |
| 许可 | Open WebUI License（源可见，品牌条款，50 人豁免） | MIT（真开源） |
| 前端/后端 | SvelteKit / Python FastAPI（异步） | Vite+React / Node Express + Node collector |
| 架构 | 无状态容器优先，可水平扩展 | 单容器三进程，有状态 |
| 本地推理 | 靠外部 Ollama 等；Desktop 内置 llama.cpp | 内置 Lemonade + llama.cpp |
| RAG | 混合 BM25+向量+rerank；8 引擎；Full Context | RecursiveCharacter+余弦；rerank 仅 LanceDB |
| 扩展方式 | Python 插件（Tools/Functions…）+ MCP + 任意代码 | `@agent` + Skills + 无代码 Flows |
| 社区（2026-10） | ≈156k stars / 512K+ 成员 | ≈67k stars |
| 适合 | 要可扩展、多模型统一、能写插件的团队/平台 | 要零代码私有知识库 + 简单 Agent 的非开发者 |

**三条选型分水岭：**

1. **「平台」vs「产品」**：Open WebUI / Dify / PrivateGPT 是给「要扩展/要二次开发」的人；AnythingLLM / Khoj / LibreChat 是给「最终用户直接用」的人。你若想写 Python 插件改平台行为 → Open WebUI；你想零代码起一个知识库 → AnythingLLM。
2. **「许可」**：AnythingLLM / LibreChat（MIT）、RAGFlow / PrivateGPT（Apache）是真正开源；**Open WebUI 与 Dify 是「源可见」而非 OSI 开源**——商用二次分发/改品牌要读原文（Open WebUI 有 50 人豁免，Dify 附加条件限制运行方式）。
3. **「RAG 深度 vs 扩展弹性」**：RAGFlow 用 DeepDoc 做版面/OCR/表格，是七者里文档解析最重；Open WebUI 混合检索 + 多引擎也强且能水平扩展；AnythingLLM 是标准切块 + 余弦，够用但不深、默认不可水平扩展。

## 六、实践与红线

**何时用 Open WebUI：**

- 要一个**多模型统一界面**（Ollama 本地 + 多个云端 API 混用），且要**完全离线/私有**。
- 要**可水平扩展**的多用户平台（团队/组织级，上千 seat，靠 PG+Redis+外部向量库）。
- 要**用 Python 写插件**改平台行为（自定义认证、限流、路由、计费、上下文管理）——官方明确说「多数看似要改核心的功能都能插件化」。
- 要**富功能全家桶**：语音/视频通话、图像生成、Channels 协作、Notes、Calendar、Automations、Open Terminal 代码执行。

**何时别用：**

- **只想零代码起一个知识库问答**：AnythingLLM / Khoj 更轻、更开箱即用；Open WebUI 的插件/部署自由度对纯用户是负担。
- **重工作流编排**（审批、条件分支、多数据源转换）：Dify / n8n 的可视化 pipeline 更合适。
- **复杂版面文档（扫描件/表格/多栏）深解析**：RAGFlow 的 DeepDoc 才是为版面/OCR/表格设计的。
- **要真开源、无品牌限制**：选 AnythingLLM（MIT）/ RAGFlow（Apache）。

**常见坑（来自官方文档 + 架构页）：**

1. **SQLite 绝不能放网络存储**（NFS/CephFS/Azure Files）：异步后端下 `fsync` 延迟会致连接池饱和、WAL 不可靠，即使不扩展也会致命锁死。要么切 PG，要么把 `webui.db` 放回本地 SSD。
2. **多 worker / 多副本必须外部向量库**：只要 `UVICORN_WORKERS>1` 或副本 >1，ChromaDB 的 SQLite 后端在 fork 下会让 worker 崩溃——强制切 PGVector/Qdrant/Milvus。
3. **无 Redis 时注销不撤销 token**：单实例无 Redis，token 直到 `JWT_EXPIRES_IN` 过期才失效；多实例无 Redis 还会 WebSocket 403、配置不同步、间歇性认证失败。
4. **`THREAD_POOL_SIZE` 默认仅 40**：规模大时阻塞操作排队致全局 freeze，生产建议 2000（这是并发上限非 CPU 数，别调低）。
5. **插件即任意 Python 代码**：只装可信源，社区插件未经审计，保护好 `data` 目录写权限，限制用户 Workspace 权限。
6. **品牌条款**：>50 人部署改/去 "Open WebUI" 品牌属 material breach，要么拿书面/企业许可，要么守默认品牌（50 人以下例外）。

## 七、前瞻与风险

**演进轨迹**（从版本与文档）：v0.9.0 后端全面异步 → v0.12.0 实时语音通话 + 3D 头像 + MFA + 模型版本历史 → v0.12.1 Channel Apps + `.skill` 文件 → **Open WebUI Computer / Terminals 成为独立生态项目**（把「真机 agent」从 Computer 先发、再 Graduated 进 Open WebUI）。趋势清晰：**从「聊天界面」转向「自托管 Agent 操作系统」**，且把本地推理/终端/真机操作做厚。

**商业化与许可**：核心靠 Enterprise（自定义品牌/LTS/SLA）、Sovereign AI（air-gapped 受监管行业）、Desktop Pro 与社区市场。风险点在于**许可的「源可见」属性**可能让某些企业法务却步（对比 MIT 的 AnythingLLM）；同时**核心个人起家 + 单仓库**的 bus factor 是长期隐忧。

**需要注意的两点：**

- **安全边界**：插件执行任意代码是设计使然，但也是最大攻击面。自托管多用户实例上，Tools/Functions 的导入权限必须收紧到管理员，且 `data` 目录写权限要严控。
- **生态碎片化风险**：功能扩张极快（语音/Computer/Terminals/oikb/desktop/mcpo 多仓库），文档/代码同步压力与版本兼容性是实操中的真实成本。

## 八、附录

### 向量库 / 提取引擎 / Web Search 速查

- **向量库（9+）**：ChromaDB、PGVector（官方维护），Qdrant、Milvus、OpenSearch、Elasticsearch、Pinecone、S3Vector、Oracle 23ai 等。
- **内容提取引擎（8）**：Tika、Docling、Azure Document Intelligence、Mistral OCR、Datalab Marker、MinerU、PaddleOCR、custom loaders。
- **Web Search for RAG（20+）**：SearXNG、Google PSE、Brave、Kagi、Mojeek、Tavily、Perplexity、Firecrawl、serpstack、serper、Serply、DuckDuckGo、SearchApi、SerpApi、Bing、Jina、Exa、Sougou、Azure AI Search、Ollama Cloud。
- **生态仓库**：`open-webui/open-terminal`、`open-webui/terminals`、`open-webui/oikb`、`open-webui/computer`、`open-webui/desktop`、`open-webui/mcpo`、`open-webui/pipelines`。

### 存疑 / 未文档化项（标注）

- **默认 chunk size / overlap、默认 embedding 模型名、相似度阈值**：官方文档未给出硬编码默认值，均做成可配置项 `[INFERENCE]`；与 AnythingLLM 透明写死默认值不同。
- **向量库数量口径**：README 列 9 个名字，docs features 页写「13 个」，本文以 9 个列名为准并注明差异。
- **团队规模 / bus factor 量化**：文档未披露核心团队人数，仅能从贡献者与单仓库结构推断。

### 术语

- **Stateless / Container-first**：应用层不持久化状态，状态外化到 PG/Redis/外部向量库/共享存储，便于水平扩展。
- **Focused Retrieval vs Full Context**：RAG 切块检索 vs 整篇全文注入。
- **Tools vs Functions**：扩展 LLM 能力（用户侧 Workspace）vs 扩展平台行为（Admin 侧）。
- **MCPO**：MCP-to-OpenAPI 代理，让任意 MCP server 以 OpenAPI 方式被调用。

## 参考来源

- 仓库：https://github.com/open-webui/open-webui（README / LICENSE 原文）
- 官方文档：https://docs.openwebui.com（首页 / getting-started/advanced-topics/scaling / features/workspace/knowledge / features/extensibility/plugin / features）
- 官方站与博客：https://openwebui.com（社区规模、v0.12.x 发布说明）
- 社区/数据交叉：stackness.dev/tools/open-webui（v0.12.3）、stackquadrant.com/repos/open-webui（stars/contributors/创建时间）、zairalabs.ai/guide/tools/open-webui（许可与架构描述）
- 竞品（复用本系列 anythingLLM 报告已核实项 + 各自官方文档）：Mintplex-Labs/anythingllm、langgenius/dify、infiniflow/ragflow、danny-avila/LibreChat、zylon-ai/private-gpt、khoj-ai/khoj
