---
report: 61
title: n8n 深度研究：fair-code 工作流自动化平台的 AI agent 化之路
date: 2026-10-25
tags: [n8n, workflow-automation, ai-agents, self-hosted, langchain, mcp]
summary: 从仓库源码、LICENSE 与官方文档一手核验 n8n：fair-code 工作流自动化平台的 monorepo 架构、queue mode 水平扩展、LangChain/MCP 驱动的 AI agent 能力、Sustainable Use License 许可边界，以及它与 Zapier、Make、Node-RED、Activepieces、Windmill、Temporal 六个同类工具的选型边界。
math: false
---

n8n 是 n8n GmbH（德国柏林）出品的 fair-code 工作流自动化平台：用可视化画布拼 node、再在需要时嵌入 JS/Python 代码，把「AI agent 编排 + 业务自动化」装进一个可自托管的 TypeScript monorepo。本文基于仓库 `n8n-io/n8n` 的 README、LICENSE.md、根 `package.json`、`packages/cli/package.json` 与官方文档 `docs.n8n.io` 一手核验它的架构、执行引擎、AI 能力与许可边界，并与六个同类工具做选型对比。

## 一、结论先行

- **它是「平台」，且是「开源自动化」赛道的事实领导者。** ≈208k GitHub stars / 61k forks（2026-10，GitHub API 直出），是 Zapier/Make 之外自托管工作流自动化的头号选择；2025-10 完成 $180M Series C（Accel 领投、Nvidia 参投），估值 $2.5B，累计融资 $240M。
- **许可不是 OSI 开源，是「fair-code / 源可见」。** 核心走 **Sustainable Use License v1.0**：内部业务、非商业、个人用途免费，商用二次分发受限；带 `.ee.` 的文件走独立 Enterprise License。与 AnythingLLM（MIT）、Activepieces（MIT）的真开源有本质区别。
- **技术栈是单一 TypeScript monorepo。** pnpm + turbo 编排，Node.js ≥24；后端 `packages/cli`（Node + Express + TypeORM），前端 `n8n-editor-ui`（Vue.js），AI 节点层 `@n8n/n8n-nodes-langchain`。不是 AnythingLLM 的「三进程」、也不是 Open WebUI 的「Python + SvelteKit」，三者三条完全不同的栈。
- **扩展路径清晰：queue mode。** 默认单实例（SQLite + 内嵌），要水平扩展就把状态外化：`main` 进程收 trigger → Redis（Bull 队列）→ N 个 `worker` 执行 → 回写数据库，webhook 处理器再独立一层；`multi-main`（高可用）是 Enterprise 独占。
- **AI 能力建立在 LangChain.js 之上，且 MCP 是双角色。** cluster node（root + sub-node）把 LangChain 的 Chain/Agent/LLM/VectorStore/Memory/Tool 概念映射成可拼装节点；n8n 既是 **MCP client**（agent 调外部 MCP server 工具），又是 **MCP server**（把工作流/数据表/agent 暴露给 Claude 等客户端）。
- **1.x → 2.x 是一次减法。** 2.x 把数据库收敛到 SQLite + PostgreSQL 两档，**MySQL/MariaDB 已移除**（`packages/cli` 里 `test:mariadb` 退化成 `echo true`），同时维持 1.123.x 维护线。
- **选型边界一句话：** 要「自托管、可扩展、能把 AI agent 接进任意业务系统」的工作流平台 → n8n；要「零运维、点几下就通的 SaaS 自动化」→ Zapier/Make；要「开发者写代码编排、耐久执行」→ Temporal/Windmill；要「纯聊天/RAG 知识库」→ 去 AnythingLLM / Open WebUI（本系列已研究）。

## 二、认识：它是什么

### 血统与技术栈

| 项 | 事实 | 依据 |
|---|---|---|
| 出品方 | n8n GmbH（德国，柏林起家），创始人 Jan Oberhauser（现任 CEO） | GitHub README |
| 仓库 | `n8n-io/n8n`；原身项目名 "nodemation"（node + automation），n8n 读音 n-eight-n | README 作者自述 |
| 定位 | "The Platform for AI Agents and Workflow Automation"：visual canvas + custom code，self-host 或 cloud | README |
| 社区 | ≈208k stars / 61k forks / 1,234 open issues（2026-10，GitHub API） | GitHub API |
| 最新版本 | 2.x 主线 `2.45.3`（2026-10-23）+ 1.x 维护线 `1.123.87`（2026-10-23） | GitHub releases |
| 语言 | TypeScript（monorepo），Node.js ≥24、pnpm ≥12.4.2、TypeScript 6.0.2 | 根 package.json |
| 后端 | Node.js + Express（`helmet`/`compression`/`express-rate-limit`/`swagger-ui-express`），TypeORM（`@n8n/typeorm`） | packages/cli/package.json |
| 前端 | `n8n-editor-ui`（Vue.js）+ `@n8n/design-system`（设计系统） | 根/前端 package.json |
| 数据库 | SQLite 默认，可换 PostgreSQL（16/17/18，截至 2026-07）；MySQL/MariaDB 已移除 | docs choose-n8ns-database |
| 许可 | fair-code：Sustainable Use License v1.0 + n8n Enterprise License（`.ee.` 文件） | LICENSE.md 原文 |
| 集成 | 1500+ integrations、9000+ workflow templates | README |

两个值得注意的细节：

- **集成数量口径**：GitHub API 的仓库摘要写「400+ integrations」，但 README 正文写「1500+ integrations」。以 README 正文 1500+ 为准——它是 n8n 主动维护的当前口径（n8n.io/integrations 也列 1500+）。
- **技术栈的「现代性」信号**：Node ≥24、pnpm workspace + turbo、TypeScript 6.0.2，这是 2026 年活跃维护的证明，也意味着**自建旧 Node 环境会装不上**（engines 硬性约束）。

### 融资与商业化态势

| 轮次 | 时间 | 金额 | 领投 |
|---|---|---|---|
| Series A | 2021-04 | $12M | Felicis Ventures |
| Series B | 2025-03 | $60M | Highland Europe |
| Series C | 2025-10 | $180M | Accel（Nvidia/NVentures 参投），估值 $2.5B |
| 战略投资 | 2026-05 | — | 未完全披露（Nvidia 生态方向） |

累计融资 $240M。关键信号：**2025 年一年内从 B 轮到 C 轮、估值冲到 $2.5B，Nvidia 参投**——资本押注的是「AI agent 编排」叙事：n8n 不是又一家 RAG 聊天工具，而是把 AI 塞进真实业务流程（连接 CRM/DB/消息系统）的中间层。

### 三种产品形态

| 形态 | 定位 | 关键差异 |
|---|---|---|
| **n8n Cloud** | 托管 SaaS | Starter / Pro / Enterprise 三档，`app.n8n.cloud`；Gateway credits 直接跑 AI 模型免 provider 账号 |
| **Self-hosted** | 自托管（免费起步） | Community（免费）/ Registered Community（免费）/ Business / Enterprise 四档 edition，同一份产品、license key 解锁 |
| **Embedded（OEM）** | 内嵌进自家产品 | OAuth 2.0 Token Exchange + iframe SSO，把 n8n 画布塞进自己的 UI |

### 核心概念：workflow / node / trigger / credential

- **Workflow（工作流）**：一列 node 的有向组合。由 trigger 触发、手动运行、或被别的 workflow（sub-workflow）调用；可分支、合并、循环。
- **Node（节点）**：工作流的原子单元。三类——**trigger node**（启动：定时/webhook/消息）、**app node**（连外部服务）、**core node**（数据处理/流程控制：If、Switch、Merge、Loop、Code、Aggregate、AI Transform）。社区可发布 **community node**（npm 安装，未经 n8n 审计）。
- **Credential（凭据）**：存 OAuth/API key/账号密码，与 node 绑定复用；数据用实例级 encryption key 加密后入库。
- **Expression（表达式）**：用 `{% raw %}{{ ... }}{% endraw %}` 内嵌 JS 片段动态取前序 node 数据（Luxon 处理时间、JMESPath 查询 JSON），不必写完整 node。
- **Project / Data Table**：project 隔离 workflow/credential/variable/agent（RBAC）；data table 提供项目内的轻量结构化存储，免外部数据库。

## 三、解剖：架构与进程模型

### 单 monorepo，多个逻辑进程

n8n 不是微服务。它是一份 TypeScript monorepo（pnpm workspace + turbo），核心包：

- `packages/cli`（包名 `n8n`）：后端主体——REST API、editor 静态资源托管、执行引擎、凭据加密、license 校验。
- `n8n-workflow` / `n8n-core`：工作流模型与执行内核。
- `n8n-editor-ui`（Vue.js）：可视化画布编辑器。
- `@n8n/n8n-nodes-langchain`：AI/LangChain 节点层。
- `@n8n/design-system` / `@n8n/db` / `@n8n/task-runner` / `@n8n/scheduler` / `@n8n/telemetry` 等几十个 workspace 包。

同一份代码跑三种进程角色（`packages/cli/bin/n8n <main|worker|webhook>`）：

- **main**：默认进程，收 trigger（定时器/webhook）、生成 execution、暴露 editor UI 与 REST API。
- **worker**：只执行工作流，从队列领活、跑完回写结果。`--concurrency` 控制并行度，默认 10。
- **webhook**：独立 webhook 处理器，在 LB 后面横向扩，只负责收 webhook 请求、丢进队列，不碰 UI。

### queue mode：状态外化的水平扩展

默认单实例（SQLite + 文件/内存二进制数据）零配置起。要水平扩展，官方给了 queue mode 的数据流：

queue mode 的数据流（官方文档 process flow 直译）：

1. main 进程收定时器/webhook 触发，生成（但不运行）一个 execution。
2. 它把 execution ID 交给消息队列 **Redis（Bull）**，Redis 维护待执行队列。
3. 空闲 worker 从 Redis 领走消息。
4. worker 用 execution ID 从数据库取 workflow 信息。
5. worker 执行完：结果写回数据库，并告知 Redis 执行已结束。
6. Redis 通知 main 进程。

关键约束（官方文档明示，踩坑高发）：

1. **encryption key 必须共享**：main 与所有 worker/webhook 进程共用同一个 `N8N_ENCRYPTION_KEY`，否则 worker 读不出库里加密的 credential。
2. **SQLite 上跑 queue mode 不推荐**：官方原话 "Running n8n with execution mode set to queue with an SQLite database isn't recommended"，分布式执行必须上 PostgreSQL。
3. **二进制数据不能放文件系统**：queue mode 下 worker 可能在任何机器上跑，文件系统二进制数据读不到，要外化到 S3/Azure（`N8N_DEFAULT_BINARY_DATA_MODE=s3`）。
4. **Redis 用 Bull**（`bull` 4.16.4，非 BullMQ），`QUEUE_BULL_REDIS_*` 配置；大 webhook 响应在 Redis 内传递，`N8N_WEBHOOK_RESPONSE_RELAY_SIZE_MAX` 默认 64 MiB，超限需开 `_OFFLOAD_ENABLED` 外化到存储。
5. **multi-main（高可用）是 Enterprise 独占**：多个 main 进程共享 queue，社区版只能单 main + 多 worker。

**对照 Open WebUI**（本系列 §60）：两者都走「默认单实例自包含 → 状态外化后水平扩展」的路线，但 n8n 用 **Bull 队列 + worker 进程**做的是「执行层横向扩展」，Open WebUI 用 **无状态副本 + PG/Redis/外部向量库**做的是「应用层无状态扩展」。n8n 的 main 天然有状态（持有 editor UI、调度器、webhook 入口），所以 multi-main 才需要 Enterprise；Open WebUI 把状态全部外化后任何副本都能重建。

### 数据库：SQLite 默认 + TypeORM

- **默认 SQLite**：`~/.n8n/database.sqlite`，存 workflow/credential/execution/用户。
- **PostgreSQL**：`DB_TYPE=postgresdb`，官方支持 16/17/18（截至 2026-07，随 PG 每年 11 月滚动）；不兼容 AlloyDB/CockroachDB/YugabyteDB 等衍生库。
- **TypeORM**（`@n8n/typeorm` 定制版）管查询与 migration；表结构有 20+ 张（`workflow_entity`、`execution_entity`、`credentials_entity`、`shared_workflow`、`project`、`variables`…）。
- **MySQL/MariaDB 已死**：docs 只列 SQLite + Postgres；`packages/cli/package.json` 里 `test:mariadb` 脚本是 `echo true`（空跑）。这是 2.x 相对 1.x 的明确减法。

## 四、解剖：工作流执行引擎

### 执行模型

- **Execution（执行）** = 一次 workflow 运行。分 manual（编辑器手动跑）、production（trigger 触发）、partial（部分节点）。
- **Item / binary data**：数据在节点间以 `item`（json 对象）流动，文件/图片走独立的 `binary` 对象（与 json 分离，避免大文件拖慢主数据流）。
- **Dirty node / data pinning**：改了一个节点，下游变「dirty」要重跑；开发时用 pinning 冻结节点输出、mock 数据，生产 execution 忽略 pinned 数据。
- **执行顺序**：多分支下 n8n 按依赖决定顺序；用 `If`/`Switch` 分支、`Merge` 汇合、`Loop` 迭代、`Wait` 挂起（含 human-in-the-loop 的 send-and-wait）。
- **版本化**：draft（草稿自动保存）→ publish（发布版本才被 trigger 跑），带 workflow history 可回滚。

### 表达式与代码执行

n8n 给数据转换两条路：

- **表达式**：`{% raw %}{{ }}{% endraw %}` 内嵌 JS 片段，配合 Luxon（时间）、JMESPath（JSON 查询）、`$json`/`$node`/`$workflow` 快捷变量——轻量场景不写 node。
- **Code node / LangChain Code node**：写完整 JS（可配 Python 通过 task runner），能 `require` 内置模块、启用外部模块。

代码执行有**双层沙箱**：默认 `isolated-vm` 在进程内跑 JS 表达式；`@n8n/task-runner` 把重代码（Code node、社区节点、外部模块）丢进**独立进程**隔离，防单个节点拖垮主进程、也可加固（`harden task runners`）。这是 n8n 相比「表达式即代码、无隔离」的竞品更工程化的一处。

### 数据表与 sub-workflow

- **Data Table**：项目内的结构化存储，配 `Data Table` node 读写，省掉外部数据库——适合轻中量状态存续（如 agent 记住用户偏好）。
- **Sub-workflow**：大 workflow 拆小、复用；`Execute Sub-workflow` 节点调用，或用 `.n8np` package（含 manifest 的打包格式）跨实例迁移。

## 五、解剖：AI 能力（LangChain + MCP）

### LangChain.js 之上的 cluster node

n8n 的 AI 节点建在 **LangChain 的 JavaScript 框架**上（`@n8n/n8n-nodes-langchain`，依赖 `@langchain/core`）。核心抽象是 **cluster node**：一个 root node 定义主功能，挂 sub-node 扩展。LangChain 概念→n8n 节点的映射：

| LangChain 概念 | n8n 节点类型 | 示例 |
|---|---|---|
| Chain | root | Basic LLM Chain、Question & Answer、Summarization |
| Agent | root | **AI Agent**（挂 chat model + tools + memory） |
| LLM | sub-node | OpenAI / Anthropic / Ollama Chat Model |
| Vector store | root | Pinecone / Qdrant / In-Memory Vector Store |
| Memory | sub-node | Postgres / Redis Chat Memory、Simple Memory |
| Tool | sub-node | Call n8n Workflow Tool、Custom Code Tool、Wikipedia |
| Retriever | sub-node | Vector Store / Workflow Retriever |
| Embeddings | sub-node | OpenAI / Cohere Embeddings |
| Document loader | sub-node | Default Data Loader、GitHub Document Loader |
| Output parser | sub-node | Structured / Auto-fixing Output Parser |
| Text splitter | sub-node | Recursive Character、Token Splitter |

两个关键机制差异：

- **只有 AI Agent root 能挂 Memory**。n8n 的 chain 节点一律不带 memory（「Unlike LangChain, none of n8n's chain nodes support memory」），要连续多轮对话必须用 agent，不能用 chain。
- **工具即工作流**：`Call n8n Workflow Tool` 把任意 workflow 包装成 agent 工具——这正是 n8n 的差异化：**1500+ 集成节点天然就是 agent 的工具库**，不用另写 connector。

### MCP 双角色

n8n 对 Model Context Protocol 的支持是**双向**的（`@modelcontextprotocol/sdk` + `@modelcontextprotocol/node` + `@modelcontextprotocol/server`）：

- **作为 MCP client**：agent / AI Agent node 通过 one-click registry 或 `MCP Client Tool` 节点调外部 MCP server 的工具。
- **作为 MCP server**：实例级 MCP server 让 Claude Desktop / Claude Code / Codex CLI 等客户端能「构建、编辑、运行、测试工作流、管理 data table 和 agent」；`MCP Server Trigger` 节点把**单个 workflow 的工具**暴露成它自己的 MCP server。

这一层让 n8n 站上了「AI 编排」的十字路口：它既能当工具消费者，也能当工具提供者。

### Agent 层：Agent Builder + n8n Assistant

- **AI Agent node**（workflow 内）：LangChain cluster node，跑在工作流里，工具/记忆/模型都是 sub-node。
- **Agent（Agent Builder，Preview）**：独立于 workflow 的一等公民——有 LLM、指令、工具、skills（指令+工具打包）、memory、knowledge base（CSV/PDF/MD 上传检索）、sub-agent（把活分给别的 agent）；通过 chat、channels（Slack/Discord/Teams/Telegram/WhatsApp/Linear，`@chat-adapter/*`）、schedules 触达。带 **tool approval**（敏感工具调用前人工确认，human-in-the-loop）。
- **n8n Assistant（Preview）**：对话式 agent，用自然语言建/改/测/排障 workflow，也能建 agent、协助实例任务。
- **Evaluations**：把测试用例数据集跑过 workflow，比预期输出/指标——用于换模型/改 prompt 后确认 AI 工作流没退化（AI 工作流的「单元测试」）。

值得注意的工程事实：`packages/cli/package.json` 里同时存在 `@langchain/core` 与 `ai`（Vercel AI SDK，`@ai-sdk/anthropic`、`@ai-sdk/openai-compatible`）+ `@n8n/agents`、`@n8n/ai-node-sdk`。这暗示 **Agent Builder 的新代码路径已开始用 Vercel AI SDK**，而 workflow 内的 AI node 仍是 LangChain.js——两条 AI 栈并存 `[INFERENCE]`（依赖清单佐证，官方文档尚未说明切换）。

## 六、解剖：许可边界（fair-code 拆解）

n8n 的许可分两层，都**不是 OSI 开源**：

**1. Sustainable Use License v1.0**（`LICENSE.md`，覆盖主分支非 `.ee.` 文件）逐条拆解：

- **允许**：内部业务用途、非商业用途、个人用途，可复制/修改/派生、免费分发（限非商业）。
- **限制**：**只能自用或免费分发**——不能拿它做「向他人收费提供的服务」；不可移除版权/许可告示；商标使用受限。
- **专利/终止**：附专利授权；违规即自动终止（30 天整改可恢复，再犯永久终止）；无担保、无责任。

一句话：**「源码可见 + 可自托管 + 可改」，但「商用二次分发/托管销售」要另谈。** 这是「fair-code」（faircode.io）路线，与 MIT（AnythingLLM/Activepieces）、Apache（RAGFlow/Temporal）的真开源有硬边界。

**2. n8n Enterprise License**（`LICENSE_EE.md`）：文件名/目录名含 `.ee.` 的源码不归 SUL，必须持有效 Enterprise License 才能访问/使用。这意味着「企业功能」的代码就在仓库里，但**法律上被独立许可隔离**，社区版运行时也受 `@n8n_io/license-sdk` 的 entitlement 校验（license key 解锁 paid 功能）。

**许可历史**：n8n 最初是「Apache 2.0 + Commons Clause」，2022-03-17 切换成自拟的 Sustainable Use License（动机：防云厂商白嫖打包销售）。2025-10 C 轮后商业化加速，但**核心仍是 SUL，没有回退到闭源**——这与 Open WebUI（品牌条款「源可见」）同属「源可见但不 OSI」阵营，具体条款不同：n8n 限制的是「商用分发/托管」，Open WebUI 限制的是「去品牌」。

**商业化靠增值，不靠锁功能**：Community edition 免费且「几乎完整功能」；付费（Business/Enterprise）解锁的是 SSO（SAML/LDAP）、environments、projects、external secrets、external storage、log streaming、multi-main、workflow/credential sharing、Git 版本控制——**全是「团队/企业治理」功能，不是「核心自动化」功能**。这是 n8n 相对 Dify（附加条件限制运行方式）更「厚道」的地方：个人/小团队白嫖几乎完整产品。

## 七、为什么这么设计（取舍）

每个取舍配反面案例：

| 取舍 | 换来的 | 牺牲的 | 反面案例 |
|---|---|---|---|
| **fair-code（SUL）而非 MIT** | 防云厂商打包销售、保商业化空间、公司可持续 | 非 OSI，企业法务对「源可见」敏感、商用分发受限 | Activepieces/Temporal（MIT）、Windmill（AGPL 更硬核 copyleft） |
| **单 monorepo + queue mode** | 一份代码三进程角色、执行层可水平扩展、部署心智低 | main 有状态，multi-main 高可用要 Enterprise | 真微服务（Temporal 拆 frontend+history+matching+worker）扩展强但运维重 |
| **SQLite 默认** | 零依赖一键起、单文件备份 | queue mode 不推荐、并发写上限 | PostgreSQL（生产标配） |
| **AI 建在 LangChain.js 而非自研** | 直接吃 LangChain 生态、概念映射成节点零学习成本 | 绑定 LangChain 版本节奏、Agent Builder 疑似又引 Vercel AI SDK 造成双栈 | 自研推理/编排（Dify 自研 agent runtime） |
| **表达式 + Code node 双轨** | 轻量用表达式、复杂用代码，门槛弹性 | 表达式沙箱（isolated-vm）与 task-runner 两层隔离，心智负担 | 纯 no-code（Zapier 无代码兜底）或纯 code-first（Temporal 全是代码） |
| **内建 AI 而非纯自动化** | 1500+ 集成天然是 agent 工具库，AI 编排与业务打通 | 定位从「iPaaS」漂向「AI 平台」，与 AI 聊天工具正面竞争 | Zapier/Make 仍以「连接器自动化」为主 |

一句话设计哲学：**把「自托管 + 可扩展 + 代码兜底」做成权利，把「企业治理」做成付费项。** 默认值走零配置（SQLite + 单实例），要扩展逐层外化（PostgreSQL → Redis/queue → 外部存储 → multi-main）。

## 八、横向对比（六竞品）

对比维度：定位、许可、技术栈、AI 深度、企业能力、部署、目标用户。

| 工具 | 定位 | 许可 | AI 能力 | 目标用户 |
|---|---|---|---|---|
| **n8n** | 自托管工作流 + AI agent 编排（平台） | 源可见（SUL + Enterprise，fair-code） | LangChain cluster node + AI Agent + MCP 双角色 + Agent Builder + evaluations | 要自托管、可扩展、打通 AI 与业务系统的团队/开发者 |
| **Zapier** | SaaS iPaaS（闭源） | 专有 | 有限（Zapier Agents/Copilot 起步） | 零运维、点几下就通的无代码用户 |
| **Make** | SaaS iPaaS（闭源，原 Integromat） | 专有 | 有限（可视化 + 少量 AI 模块） | 要更复杂可视化场景的 no-code 用户 |
| **Node-RED** | 流式编程 / IoT（开源） | Apache-2.0 | 弱（社区 node 接 LLM） | 硬件/物联网/事件流开发 |
| **Activepieces** | 开源 Zapier 替代 + AI agent/MCP | MIT（核心，企业版商业许可） | AI Agent + ~400 MCP server 一键接 | 要 MIT 许可、AI agent 化的团队 |
| **Windmill** | 开源开发者平台（脚本+工作流） | AGPL-3.0（dual commercial） | 中等（脚本内接 LLM） | 要「workflow-as-code + 脚本」的开发者 |
| **Temporal** | 耐久执行引擎（dev-first） | MIT（核心） | 无内建（代码里接） | 要 checkpoint/重试/持久化的后端工程师 |

**三条选型分水岭：**

1. **「SaaS no-code」vs「自托管平台」**：Zapier/Make 是「付钱、点几下、跑起来」，n8n/Activepieces/Windmill/Node-RED 是「自己部署、自己运维、代码兜底」。要零运维选前二者，要数据隐私/定制/成本控制选后者。
2. **「许可」**：Activepieces/Temporal（MIT）、Node-RED（Apache）是真正开源；**n8n 是 fair-code「源可见」**（商用分发受限）；Windmill 是 AGPL copyleft（更强传染性）。企业自用都免费，商用二次分发/托管销售才有分水岭。
3. **「AI 编排深度」**：n8n 与 Activepieces 是「AI agent + MCP」做得最深的两个（n8n 靠 LangChain + 1500 集成，Activepieces 靠 400 MCP server）；Zapier/Make 的 AI 是后补的；Node-RED/Temporal 把 AI 当普通节点/代码，不内建编排。想要「AI 接进真实业务」优先 n8n/Activepieces。

**与 AI 聊天/RAG 赛道的关系**（衔接本系列 anythingLLM / Open WebUI）：n8n **不做**内建 RAG 聊天产品，它做的是「编排层」——你可以用 n8n 把 AnythingLLM/Open WebUI 的 API、向量库、LLM 全部接进来组成 agent。若需求是「知识库问答产品」→ AnythingLLM/Open WebUI；需求是「把 AI 动作嵌入业务流程（审单、客服、数据管道）」→ n8n。

## 九、实践与红线

**何时用 n8n：**

- 要**自托管工作流 + AI agent 编排**：把 LLM、向量库、内部 API、CRM/DB/消息系统拼成多步 agent，且要数据不出内网。
- 要**可水平扩展**：queue mode（main + 多 worker + webhook 处理器）扛大并发执行。
- 要**代码兜底**：表达式不够就 Code node / 自定义 node / 外部模块，不被 no-code 天花板卡死。
- 要**免费但完整**：Community edition 几乎完整功能，个人/小团队零成本；企业治理（SSO/项目/环境）再付费。
- 要**MCP 双向**：既当 client 调工具、又当 server 把 workflow 暴露给 Claude 等。

**何时别用：**

- **纯 SaaS、零运维**：选 Zapier/Make。
- **重批处理 ETL / 大数据管道**：n8n 是「事件/工作流」引擎，不是 Airflow/Spark 那类批调度；大表 Join/聚合场景弱。
- **深文档解析 RAG**：去 RAGFlow（DeepDoc 版面/OCR/表格）或 AnythingLLM；n8n 的 RAG 是「节点拼装」不是「内建产品」。
- **代码优先的耐久执行**（checkpoint、超长存活、精确一次语义）：Temporal/Windmill 更专业。
- **要 OSI 真开源 + MIT**：选 Activepieces（MIT）。

**常见坑（来自官方文档 + 依赖/配置核验）：**

1. **SQLite 上跑 queue mode**：官方不推荐，分布式执行必须 PostgreSQL，否则并发写/锁竞争致命。
2. **encryption key 不共享**：worker 读不出 credential，表现为「跑起来但全部认证失败」。所有进程必须同一 `N8N_ENCRYPTION_KEY`。
3. **queue mode + 文件系统二进制数据**：worker 跨机器读不到，必须 `N8N_DEFAULT_BINARY_DATA_MODE=s3/azure`。
4. **大 webhook 响应**：Redis 内传响应默认 64 MiB 上限，超限开 `_OFFLOAD_ENABLED` 外化；开之前先升级所有 main/webhook 实例到 ≥2.34.0。
5. **community node 未审计**：npm 装的社区节点可执行任意代码，是最大攻击面；task runner 加固 + 只装可信源 + 限制用户权限。
6. **Node ≥24 / pnpm ≥12.4.2 硬性 engines**：旧环境装不上，别在 EOL Node 上硬起。
7. **MySQL/MariaDB 已不支持**：从 1.x 迁 2.x 若还指望着 MySQL，先迁 Postgres（`DB_TYPE=postgresdb`）。

## 十、前瞻与风险

**演进轨迹**：从「iPaaS 连接器平台」→「AI 编排平台」再→「AI agent 平台」。证据链：v1.x 把 LangChain 节点收进核心 → 引入 MCP（client+server）→ Agent Builder / n8n Assistant（Preview）→ 2.x 做数据库减法（砍 MySQL/MariaDB、收敛 SQLite+Postgres）聚焦质量。趋势清晰：**n8n 正在从「自动化工具」变成「自托管 AI agent 操作系统的编排层」**，与 Open WebUI（「自托管 agent 操作系统」）在同一赛道会师，只是 n8n 偏「业务流程编排」、Open WebUI 偏「聊天/知识/插件」。

**商业化与许可风险**：$2.5B 估值 + $240M 融资下，商业化压力真实存在。当前模式是「Community 免费 + 企业治理付费」，风险点在于：(1) 未来可能像 HashiCorp/Terraform 一样**再次收紧许可**（SUL → BUSL 或更严）；(2) `.ee.` 代码隔离已为「更多功能企业化」留了门；(3) fair-code 非 OSI，部分企业采购/法务会卡。

**双 AI 栈隐忧**：LangChain.js（workflow 内 AI node）与 Vercel AI SDK（`@n8n/agents` 等新包）并存，若长期不收敛，节点生态与文档会分裂 `[INFERENCE]`——这是「功能扩张极快」的代价，与 Open WebUI 的多仓库生态碎片化风险同源。

**1.x → 2.x 迁移**：2.x 是 breaking 大版本（数据库收敛、许可/entitlement 机制、包结构重整），1.123.x 仍在维护但会逐步 EOL。自托管存量 1.x 用户要么停在维护线，要么付出迁移成本。

## 十一、附录

### LangChain 概念 → n8n node 速查（已见 §5 表）

### 数据库表速查（20+ 张，核心）

`workflow_entity`（工作流）、`execution_entity` + `execution_data`（执行与执行时快照）、`credentials_entity`（凭据）、`shared_workflow` / `shared_credentials`（共享映射）、`project` / `project_relation`（项目与角色）、`user` / `auth_identity`（用户与 SSO 身份）、`variables`（变量）、`webhook_entity`（活跃 webhook）、`workflow_history`（版本历史）、`installed_nodes` / `installed_packages`（社区节点）、`migrations`（TypeORM 迁移日志）。

### 关键环境变量速查

- 数据库：`DB_TYPE=postgresdb` + `DB_POSTGRESDB_*`
- 队列：`EXECUTIONS_MODE=queue` + `QUEUE_BULL_REDIS_HOST/PORT/DB` + `N8N_GRACEFUL_SHUTDOWN_TIMEOUT`
- 加密：`N8N_ENCRYPTION_KEY`（多进程必须一致）
- 二进制数据：`N8N_DEFAULT_BINARY_DATA_MODE`（filesystem/database/s3/azure/default）
- 大响应：`N8N_WEBHOOK_RESPONSE_RELAY_SIZE_MAX`（默认 64 MiB）+ `N8N_WEBHOOK_RESPONSE_RELAY_OFFLOAD_ENABLED`
- webhook 禁用：`N8N_DISABLE_PRODUCTION_MAIN_PROCESS=true` / `N8N_ENDPOINT_WEBHOOK`
- 溯源：`LANGCHAIN_TRACING_V2=true` + `LANGCHAIN_ENDPOINT`（LangSmith，仅 self-hosted 所有 edition）

### 存疑 / 未文档化项（标注）

- **前端 Vue 大版本**：`n8n-editor-ui` 为 Vue.js，但版本号与包路径（`packages/editor-ui` 已 404，根 package.json 引 `packages/frontend/**`）未硬确认，以「Vue.js（editor-ui）」表述 `[INFERENCE]`。
- **集成数量口径**：GitHub API 摘要「400+」vs README 正文「1500+」，以 1500+ 为准并注明差异。
- **双 AI 栈**（LangChain.js + Vercel AI SDK 并存）为依赖清单佐证，官方文档未说明，标 `[INFERENCE]`。
- **2026-05 战略投资**细节未完整披露（press 页截断于「strategic inv…」），金额/领投方未核实。
- **star 数多源口径**：GitHub API 208k vs n8n-pulse 175.9k，以 GitHub API 为准。

### 术语

- **fair-code**：非 OSI 的「源可见」许可路线（faircode.io），核心可自用/自托管，但商用分发受限。
- **Sustainable Use License (SUL)**：n8n 核心许可，2022-03-17 起替代「Apache 2.0 + Commons Clause」。
- **cluster node**：root node + sub-node 的组合，n8n 对 LangChain 概念的节点化抽象。
- **queue mode / multi-main**：main + worker + Redis(Bull) 的执行扩展模式；multi-main 为 Enterprise 高可用。
- **task runner**：独立进程执行重代码，隔离 Code node / 社区节点。
- **Gateway credits**：n8n Cloud 上直接跑 AI 模型/第三方服务、免 provider 账号的预付额度。

## 参考来源

- 仓库：https://github.com/n8n-io/n8n（README、LICENSE.md、根 package.json、packages/cli/package.json，经 GitHub API + raw 直取）
- 官方文档：https://docs.n8n.io（welcome / choose-how-to-use-n8n / key-concept-glossary / community-edition-features / scaling/enable-queue-mode / choose-n8ns-database / understand-the-database / integrate-ai / langchain-in-n8n）
- 版本：https://github.com/n8n-io/n8n/releases（2.45.3 / 1.123.87）
- 融资与估值：https://blog.n8n.io/series-c、https://n8n.io/press、https://pitchbook.com（$2.5B / $180M Series C）、https://siliconangle.com（Nvidia 参投）
- 许可历史：https://blog.n8n.io/announcing-new-sustainable-use-license/、https://docs.n8n.io/n8n-community-license
- 竞品：Zapier（zapier.com）、Make（make.com）、Node-RED（nodered.org，Apache-2.0）、Activepieces（github.com/activepieces/activepieces，MIT）、Windmill（windmill.dev，AGPL-3.0）、Temporal（temporal.io，MIT）；交叉：blog.n8n.io/open-source-workflow-automation
