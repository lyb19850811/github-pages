---
report: 63
title: Pi / Oh My Pi 记忆深度研究：从「交给扩展」到「内置五个后端」
date: 2026-10-26
tags: [pi, oh-my-pi, memory, ai-memory, coding-agent, agents]
summary: 从仓库内 harness 文档、上游 pi 文档与扩展生态一手核验：上游 Pi 核心没有内置记忆（靠 pi-memory / Mnemosyne / pi-hermes-memory 扩展），而 Oh My Pi 把记忆做成一等公民，内置 off/local/hindsight/mnemopi/sharpshooter 五个后端——拆解每个后端的机制，并解释为什么这样设计。
math: false
---

Pi 与 Oh My Pi 是同一条血缘线上的两代终端编码智能体：前者是 Mario Zechner 的「minimal terminal coding harness」，后者是 Stencil Labs 的 fork，口号是「The Pi you love, with batteries included」。本文回答三个问题：上游 **Pi 有没有实现记忆**？**Oh My Pi 有没有**？有的话**怎么做的、为什么这么做**。结论先行，然后逐层拆解。

## 一、结论先行

- **上游 Pi：核心没有记忆。** `pi.dev` 官方文档索引里没有任何 memory 页；最流行的记忆扩展 `pi-memory` 的开场白是「Your coding agent forgets everything between sessions」（你的编码智能体每次会话之间失忆）。记忆在上游被当成**扩展生态问题**，而不是 harness 的一等公民。
- **Oh My Pi：内置了记忆，且做成五个后端。** `memory.backend` 可选 `off` / `local` / `hindsight` / `mnemopi` / `sharpshooter`，**默认 `off`**（关）。README §13 用一句话定调：「Memory the agent curates」——是**智能体自己**维护记忆，而非用户手动整理。
- **五个后端是五种哲学，不是五种存储格式。** `local` 是「后台把历史会话蒸馏成摘要文档」；`mnemopi` 是「本地 SQLite + 工作/情节双记忆 + veracity 加权检索」；`hindsight` 是「连远程记忆服务」；`sharpshooter` 是「免服务器维护三份项目决策文件」；`off` 是「什么都不做」。
- **「为什么」的核心是两条：** ① 上游把记忆当可选扩展（minimal 核心哲学），fork 把它升级成「harness 自己的工程问题」；② 隐私叙事——本地 SQLite、本地 1B–1.7B 小模型做抽取/合并、默认 project-scoped，数据不出本机。
- **一条贯穿的记忆生态血统线：`~/.hermes/`。** Mnemosyne（「Hermes-first」SQLite 记忆层）、Hindsight（Nous Research Hermes Agent 的记忆 provider）、以及 Oh My Pi 的 `pi-mnemopi` 独立 CLI 默认目录 `~/.hermes/mnemopi/`，共享同一个 `hermes` 主目录——这是「记忆」这个子生态的谱系标记，也是理解 Oh My Pi 记忆从哪来的钥匙。

---

## 二、认识：血统与「记忆」的层级位置

### 2.1 同一条血缘，两种产品定位

| 项 | Pi（上游） | Oh My Pi（fork） |
|---|---|---|
| 作者/组织 | Mario Zechner（`@mariozechner`/`badlogic`），现 `earendil-works` | Stencil Labs |
| 仓库 | 曾 `badlogic/pi-mono`，现 `earendil-works/pi` | `can1357/oh-my-pi` |
| 官网 | `pi.dev` | `omp.sh` |
| 定位 | minimal terminal coding harness（最小终端编码 harness） | 「The Pi you love, with batteries included」 |
| 核心记忆 | **无**（扩展生态承担） | **有**（五个后端，默认关） |

Oh My Pi 的 README 明确写「Originally built on Mario Zechner's wonderful Pi, omp adds everything you're missing」——记忆正是「你缺的东西」清单里的一项（§13，排在 LSP、调试器、子智能体、collab 等 20 项卖点中间）。这决定了本节的关键判断：**记忆在两者中的「层级位置」完全不同**。

### 2.2 记忆的层次谱系（锚定坐标系）

沿用本系列 Mem0 研究的谱系（`_posts/2026-10-26-mem0-deep-research.md`），把 LLM 记忆按持久性与成本排成一条线：

| 层次 | 机制 | 成本 | 缺陷 |
|---|---|---|---|
| 上下文窗口 | 近期对话塞进 prompt | 每轮 O(n) token | 会话结束即失忆 |
| 会话记忆 | 全量历史重放 | 随会话线性增长 | token 爆炸 |
| 摘要记忆 | LLM 把历史压成摘要 | 单次蒸馏 | 有损、粒度粗 |
| 语义/向量记忆 | embed 后按相似度检索 | 检索时少量 token | 丢关系、无时间性 |
| 结构化事实记忆 | LLM 抽取「事实/偏好/决策」入库 | 抽取 + 检索 | 抽取质量定上限 |
| 知识图谱记忆 | 实体 + 关系 + 时间有效性 | 建图 + 查询 | 建模重 |

Pi 与 Oh My Pi 的记忆落在**摘要记忆**（`local`）与**结构化事实/半图记忆**（`mnemopi` 的 working/episodic + veracity + 事实表）之间，且都保留「上下文窗口」这条底线。这与 Mem0（纯结构化事实 + 实体链接半图）和 AnythingLLM（工作区级 `## Things I Remember About You` 注入）形成对照，后文 §14 再做选型对比。

---

## 三、上游 Pi：核心没有记忆，靠扩展生态

### 3.1 证据

三条独立证据都指向同一结论：

1. **文档索引无 memory 页。** `pi.dev/docs/latest` 的目录完整列了 quickstart / usage / models / sessions / configuration / how-pi-works / cli / json / rpc / sdk / settings / providers / keybindings / environment-variables / security 等，**没有任何记忆章节**。
2. **最流行扩展的开场白。** `pi-memory`（`jayzeng/pi-memory`，README 自称「The most popular memory extension for pi」）第一句就是「Your coding agent forgets everything between sessions. pi-memory gives it a memory」。如果核心有记忆，这句开场白不成立。
3. **记忆以扩展形式发行。** pi 的官方 package 目录（`pi.dev/packages`）里有多个记忆扩展：`pi-memory`、`@mnemosyne-oss/pi-mnemosyne`、`pi-hermes-memory`（`pi-persistent-intelligence`）。它们都是 `pi install` 装的第三方包，不是核心。

### 3.2 上游的记忆扩展生态（三类）

**① `pi-memory` —— markdown 文件 + 可选 qmd 语义搜索。** 最流行、最「pi 风格」的一个：

- 存储：`~/.pi/agent/memory/` 下的纯 markdown——`MEMORY.md`（长期记忆）、`SCRATCHPAD.md`（待办）、`daily/`（按日期追加日志）、`recovery/`（删除的恢复记录）。可直接 `cat`、可 git 提交。
- 工具：`memory_write` / `memory_forget` / `memory_restore` / `memory_read` / `scratchpad` / `memory_status`，外加可选 `memory_search`（依赖 `qmd`，BM25 关键词 + 向量语义 + 混合重排三档）。
- 注入：每轮把「打开的 scratchpad → 今日 daily → MEMORY.md → 昨日 daily」按优先级注入系统提示，总量 16K 字符封顶。
- **KV-cache 稳定快照**（这是它的亮点）：本地前缀缓存运行时（llama.cpp/vLLM/MLX）从第一个分歧 token 起失效，所以扩展默认 `PI_MEMORY_SNAPSHOT=stable`——会话开始时拍一次快照、之后每轮发**同样的字节**，只在 `session_start` 和压缩前刷新；长期写入不重渲染，成本是「写入事实已在 tool-call 历史里可见」。

**② `pi-mnemosyne` / Mnemosyne —— SQLite 记忆层。** `@mnemosyne-oss/pi-mnemosyne` 是 `mnemosyne-oss/mnemosyne`（「Hermes-first」、SQLite-backed、零云、单纯 Python 依赖）的 pi 封装：注册 `mnemosyne_remember` / `mnemosyne_recall` / `mnemosyne_forget` / `mnemosyne_stats` / `mnemosyne_sleep`（合并旧记忆为摘要）五个工具 + 一个 `/skill:mnemosyne`，数据默认 `~/.hermes/mnemosyne/data`。

**③ `pi-hermes-memory` / `pi-persistent-intelligence` —— JSONL 治理记忆。** 「canonical memory is JSONL」，提供持久项目记忆、会话搜索、可审查的治理、诊断，以及可选 Obsidian vault 集成。

三个扩展的共同特征：**记忆是「另一个扩展」，与 hooks/skills 平级**——符合 pi「minimal core + 可扩展」的设计哲学，但代价是记忆质量取决于第三方维护者，且各自为政（文件格式、工具名、注入策略互不兼容）。

---

## 四、Oh My Pi：内置记忆，五个后端

### 4.1 结论：有，且是一等公民

Oh My Pi 的记忆是 `packages/coding-agent/src/memories/` 下的核心子系统（管弦编排、注入、clear/enqueue 入口都在 `index.ts`），通过 `memory.backend` 配置选择。`omp://memory.md` 开篇：「omp supports five memory modes. Memory is disabled by default」：

| `memory.backend` | 存储与行为 |
|---|---|
| `off` | 无记忆后端（默认） |
| `local` | 项目级摘要与教训，从持久化会话后台生成 |
| `hindsight` | 远程 Hindsight 记忆服务 |
| `mnemopi` | 本地 Mnemopi SQLite 记忆 |
| `sharpshooter` | 摩擦门控的项目决策文件（架构/产品/风格） |

> 版本差异提示：README §13 营销口径只写了「local, Hindsight, or Mnemopi」三个，`sharpshooter` 是文档里更新、更完整的存在——README 落后于文档，报告以 `omp://memory.md` 的五后端为准。

### 4.2 横切的记忆基础设施（所有后端共用）

- **`memory://` 内部 URL**：`memory://root`（启动注入的紧凑摘要）、`memory://root/MEMORY.md`（长期记忆文档）、`memory://root/learned.md`（`learn` 捕获的教训）、`memory://<memory-id>`（Mnemopi 全量行，带 YAML 元数据头）。注意 `root` 系列只在 `local` 后端存在——`hindsight`/`mnemopi` 不写 root，改用 `recall`/`reflect`。
- **`/memory` slash 命令**：`view` / `stats` / `diagnose` / `queue` / `sync` / `clear` / `reset` / `enqueue` / `rebuild`，以及 hindsight 的 `mm` 子命令（mental-model 维护）。
- **`memory` 模型角色**：记忆抽取/合并 piggyback 在模型角色系统上——阶段一（抽取）用 `default`，阶段二（合并）用 `smol`（回落 `default` → 当前会话模型 → registry 第一个）。本地 tiny-models 里 1B–1.7B 模型专门为此服务（§7.5）。
- **「启发式上下文而非指令」原则**：记忆注入的是 background context，不是 instructions；「当前 repo 状态 + 用户指令」优先级高于记忆，冲突时记忆视为过期（stale）。

---

## 五、怎么做：五个后端逐一拆解

### 5.1 `off` —— 什么都不做

默认。没有任何记忆后端，`memory://root` 等 URL 不解析。这也是最容易被忽视的一点：**装完 Oh My Pi，记忆是关的**，要显式开。

### 5.2 `local` —— 两阶段后台蒸馏管线（摘要记忆）

项目级摘要 + 教训，从**持久化的历史会话**里后台生成。

**启用**：`memory.backend: local`（旧 `memories.enabled: true` 会迁移成这个）。

**两阶段管线**（后台跑，子智能体和未持久化会话跳过）：

- **阶段一 · 逐会话抽取**：对每个「自上次处理后有变化」的历史会话，用 `default` 角色模型读会话历史，抽取持久信号——技术决策、约束、已解决的失败、重复工作流。太新/太老/当前活跃/超出扫描限制的会话跳过。产出每会话一段原始记忆块 + 短摘要。
- **阶段二 · 合并**：用 `smol` 角色模型读所有逐会话抽取，产出三个写盘文件：`MEMORY.md`（精编长期记忆）、`memory_summary.md`（会话启动注入的紧凑文本）、`skills/`（可复用的程序化 playbook）。阶段二用 lease + heartbeat 防多进程并发双跑，过期 skill 目录自动清理。

**注入**：会话启动时，若当前项目存在合并摘要或手动捕获的教训，注入系统提示里的 **Memory Guidance** 块（摘要 + 教训共享 `memories.summaryInjectionTokenLimit`，默认 5000 token）。

**`learn` 教训**：`autolearn.enabled: true` 暴露 `learn` 工具，把显式教训写进项目的 `learned.md`（新在前、去重、脱敏、封顶 100 条、每条正文 2000 字符 + 上下文 400 字符）。**`learn` 只影响后续会话**，不改变当前会话的 prompt-cache 前缀。

**关键配置**（默认值）：`maxRolloutAgeDays 30`（太老不处理）、`minRolloutIdleHours 12`（太近活跃跳过）、`maxRolloutsPerStartup 64`、`threadScanLimit 300`、`stage1Concurrency 8`、`summaryInjectionTokenLimit 5000`。提示词模板在 `packages/coding-agent/src/prompts/memories/`（`stage_one_system.md` / `stage_one_input.md` / `consolidation_system.md` / `consolidation.md` / `read-path.md`）。

**边界**：`local` 后端**没有** `recall`/`retain`/`reflect`/`memory_edit`——结构化记忆搜索不属于它，它只做「后台蒸馏摘要」。

### 5.3 `mnemopi` —— 本地 SQLite，工作/情节双记忆 + veracity 加权（结构化事实记忆）

这是 Oh My Pi 记忆的**旗舰**，也是最复杂的一个。核心是 `@oh-my-pi/pi-mnemopi`（独立 CLI 也叫 `mnemopi`，README 定位「standalone local-memory CLI」）。

**启用**：`memory.backend: mnemopi`，可选 `mnemopi.scoping`（`per-project` 默认 / `global` / `per-project-tagged`）。

**记忆模型**（与 `local` 的本质区别）：

- **working memory（工作记忆）**：新写入的原始行，有 TTL（默认 24h）。
- **episodic memory（情节记忆）**：`sleep`/consolidate 把过期工作记忆升级成的情节记忆，按时间**降级分 tier**（tier1/2/3）。
- **veracity 标签**：`stated`（显式保存）/ `unknown`（自动转录保留）/ `inferred` / `imported` / `tool`（`retain`/`learn` 写入）——用于加权召回。

**召回排序权重**（每次 recall 从环境变量读）：

| 权重 | 默认 | 作用于 |
|---|---|---|
| `MNEMOPI_STATED_WEIGHT` | 1.0 | `stated`（显式记忆保存） |
| `MNEMOPI_UNKNOWN_WEIGHT` | 0.8 | `unknown`（自动转录保留） |
| `MNEMOPI_INFERRED_WEIGHT` | 0.7 | `inferred` |
| `MNEMOPI_IMPORTED_WEIGHT` | 0.6 | `imported` |
| `MNEMOPI_TOOL_WEIGHT` | 0.5 | `tool`（`retain`/`learn`） |
| `MNEMOPI_TIER1/2/3_WEIGHT` | 1.0 / 0.85 / 0.7 | 情节记忆降级 tier |

`true`/`likely_true` 恒为 1.0，`false` 为 0。`polyphonicRecall` 开启时，标准 ranking（reciprocal rank）成为融合后的 `hybrid` 声部，再叠加向量、图、事实、时间四声部，让**没有关键词命中**但被情节图链接的记忆也能浮现。

**工具集**（选择 mnemopi 才可用）：`recall`（搜记忆，返回带 ID 的截断预览）、`retain`（显式存持久事实）、`reflect`（跨记忆综合回答）、`memory_edit`（`update`/`forget`/`invalidate`，事实表只读），外加可选 `learn`（`autolearn` 开启时也写入 mnemopi）。**`memory_edit update` 前必须 `read memory://<id>` 拿全量行**——截断预览（默认 500 字符，`truncated: true`）不是安全的 update payload，`update` 会整段替换内容。

**嵌入与 LLM**：

- 嵌入默认**本地**：`en` = `BAAI/bge-base-en-v1.5`（768d），`multilingual` = `intfloat/multilingual-e5-large`（1024d），走 fastembed；也可切远程 OpenAI-compatible 端点（`embeddingModel`/`embeddingApiUrl`/`embeddingApiKey`）。`noEmbeddings: true` 退化为纯 FTS。
- LLM 抽取/合并走 `mnemopi.llmMode`（`smol` 默认，解析 `memory` 角色；`remote` 用 OpenAI-compatible 端点；`none` 禁用 LLM）。

**scoping**：`global` 一个共享 bank；`per-project` 按 cwd basename + 绝对路径稳定哈希派生项目 bank（与 git 布局无关）；`per-project-tagged` 写项目本地、召回合并项目本地 + 全局。`global`/`per-project-tagged` 下 `retain`/`learn` 可带 `scope: "global"` 写共享 bank。

**会话一致性**：首轮 recall 作为 `memory_recall` entry 存进会话文件，resume/switch/fork 时原样重放（不重新 recall），保证跨进程 system prompt 与 prompt-cache 一致；记忆被删/失效后，下一轮带一次性隐藏 note 说明变化。

### 5.4 `hindsight` —— 远程 Hindsight 服务（Hermes Agent 记忆 provider）

需要可达的 Hindsight 服务（默认 `http://localhost:8888`，配 token）。Hindsight 是 `hindsight.vectorize.io` 出品的记忆服务，是 Nous Research **Hermes Agent** 的 memory-provider 插件（支持 cloud / local embedded / local external 三模式）。

- **scoping** 默认 `per-project-tagged`：写共享 bank + 项目 tag，召回含项目 tagged 与 untagged 全局；`per-project` 隔离项目；`global` 单共享 bank。
- **自动 recall/retain**：主会话首轮模型 turn 自动 recall（`hindsight.autoRecall: true`），每 3 个用户轮自动 retain 完成的对话轮；子智能体 alias 父客户端/bank/scope，可显式 `recall`/`retain`/`reflect` 但不跑自己的自动 recall/retain。
- **工具差异**：暴露 `recall`/`retain`/`reflect`；**无 `memory_edit`**（上游 Hindsight 记忆不通过此后端编辑）。
- **陷阱**：`/memory clear` 只清本地会话状态与 recall 缓存，**不删服务端 bank**（要去 Hindsight UI/API 删）。

### 5.5 `sharpshooter` —— 免服务器，三份项目决策文件

维护三份短的项目决策文件 `architecture.md` / `product.md` / `style.md`，注入系统提示；无需服务器，文件在 `<agentDir>/memories/sharpshooter/<bank>/`。

- **抽取**：主会话每个用户 prompt（子智能体跳过）发给抽取模型，记录用户做的持久决策（架构/产品/风格、约束、被否方案、纠正）为 per-session 队列里的 delta；slash 命令和短于 `sharpshooter.minPromptLength`（默认 16 字符）的 prompt 不送。
- **合并**：调度器每分钟检查，距上次超过 `sharpshooter.intervalMinutes`（默认 5）就把队列 delta 一次模型 pass 写进三份文件并清队列；`/memory enqueue` 立即合并。
- **设计意图**：「摩擦门控」——只记录用户**明确做过的决策**，不自动从所有对话里捞信号，适合要「决策留痕、可审查」的团队。

---

## 六、为什么要这样做：取舍

### 6.1 上游为什么「交给扩展」

pi 的核心定位是 minimal harness：工具、会话、模型适配是核心，记忆、Skills、MCP 这类「能力」都留给扩展/package。Mnemosyne 集成文档直接写「Pi is a minimal terminal coding harness」。好处是核心小、可组合、第三方能自由创新；代价是**记忆没有统一语义**——`pi-memory` 的 markdown、`pi-mnemosyne` 的 SQLite、`pi-hermes-memory` 的 JSONL 互不兼容，用户要自己选、自己装、自己维护。

### 6.2 Oh My Pi 为什么「内置」

三个动机，对应 fork 的三条设计主线：

1. **harness 哲学：把记忆当一等工程问题。** fork 的核心卖点就是把「编辑格式」「工具契约」「原生执行」「记忆」这类 harness 问题做厚（README「The harness problem」）。记忆从「用户自己拼」变成「开箱即用的子系统」，且提供**多个后端**让用户在隐私/成本/能力之间选，而不是一个后端硬塞。
2. **隐私叙事：本地优先、project-scoped。** 本地 SQLite、本地 1B–1.7B tiny-models 做抽取/合并（不联网推理）、默认按项目隔离——「what it learns about this repo stays with this repo」。这是 fork 区别于「云端记忆服务」的最大差异化，也与 Oh My Pi 一贯的「local models / auth broker / 本地优先」叙事一致（见 oh-my-pi-research §14）。
3. **记忆是启发式，不是权威。** 五个后端统一遵守：注入的是 background context 不是 instructions；veracity 加权 + 降级 tier 让「不确定的记忆」排名靠后；`false` 权重归零；「当前 repo 状态 > 记忆」冲突时记忆过期。这防止「记忆污染」——智能体不会因为一条旧记忆而违背眼前的代码和用户指令。

### 6.3 两个贯穿的工程约束（为什么这么具体地设计）

- **KV-cache 稳定性。** 本地前缀缓存运行时从第一个分歧 token 起整体失效。所以 `local` 的 `learn` 不碰当前会话前缀、`mnemopi` 把首轮 recall 存进会话文件原样重放、`pi-memory` 扩展的 `stable` 快照——都是**同一个约束的不同解法**：记忆注入必须字节稳定，否则每轮重算整个上下文。
- **后台化 + lease。** 抽取/合并都是后台管线，用 lease/heartbeat 防多进程双跑，子智能体跳过——记忆绝不能阻塞或拖慢编码会话本身。

---

## 七、生态地图与横向对比

### 7.1 记忆生态谱系（`~/.hermes/` 主线）

Oh My Pi 的记忆不是凭空发明的，它站在一个现成的「Hermes 记忆生态」上：

```mermaid
graph LR
    H[Hermes Agent<br/>Nous Research] --> HD[Hindsight 服务<br/>hindsight.vectorize.io]
    H --> MN[Mnemosyne<br/>mnemosyne-oss<br/>SQLite Hermes-first 记忆层]
    MN --> PM[pi-mnemosyne 扩展<br/>上游 pi 生态]
    MN --> MP[pi-mnemopi<br/>@oh-my-pi 原生重实现]
    HD --> OMPH[Oh My Pi hindsight 后端]
    MP --> OMPM[Oh My Pi mnemopi 后端]
```

谱系证据链：

- Mnemosyne 自称「Hermes-first memory layer」，默认数据目录 `~/.hermes/mnemosyne/data`。
- Hindsight 是 Hermes Agent 的 memory-provider 插件（`hindsight.vectorize.io/sdks/integrations/hermes`）。
- Oh My Pi 的 `pi-mnemopi` 独立 CLI 默认 `~/.hermes/mnemopi/data/mnemopi.db`；后端文档文件名是 `mnemosyne-memory-backend.md`（保留了「mnemosyne」旧名）；`sleep`/`consolidate` 语义与 Mnemosyne 的 `mnemosyne_sleep` 一致。

`[INFERENCE]`：`pi-mnemopi` 与 `mnemosyne-oss/mnemosyne` 的确切代码关系（fork / 重写 / 仅命名致敬）未逐一比对源码；但命名（mnemopi ≈ mnemosyne + pi）、`~/.hermes/` 主目录、`sleep`/consolidate 语义三点一致，可断定它**脱胎于 Mnemosyne**，并在 Oh My Pi 里被重实现为原生 Bun/TypeScript 包、叠加了更丰富的记忆模型（working/episodic、veracity、降级、polyphonic recall、本地嵌入）。

### 7.2 选型边界一句话

| 要什么 | 选什么 |
|---|---|
| 完全不折腾、零配置 | 上游 Pi + `pi-memory` 扩展（markdown 可读可 git） |
| 本地结构化记忆、veracity 加权、双记忆模型 | Oh My Pi `mnemopi` 后端 |
| 免服务器、只要「决策留痕」 | Oh My Pi `sharpshooter` 后端 |
| 团队共享记忆服务（可自托管/云） | Oh My Pi `hindsight` 后端 |
| 后台自动蒸馏摘要、零手动维护 | Oh My Pi `local` 后端 |
| 独立的、可移植的记忆层插进任意框架 | Mem0（本系列 report 62） |
| 自托管知识库 + 工作区级记忆注入 | AnythingLLM（本系列 report 58） |

---

## 八、红线与坑

1. **默认是关的。** 装完 Oh My Pi 记忆是 `off`，必须显式配 `memory.backend`；别默认它有记忆。
2. **`learn` 只影响后续会话。** 当前会话的 prompt-cache 前缀不变；「这轮教的教训」要下次会话才注入。
3. **`memory_edit update` 前必须先 `read memory://<id>`。** 召回预览是截断的（默认 500 字符，尾部 `…`），直接 update 会丢掉没显示的后半段。
4. **hindsight 的 `/memory clear` 不清服务端。** 只清本地 recall 缓存；bank 要去 Hindsight UI/API 删。
5. **`local` 后端没有 `recall`/`retain`/`reflect`/`memory_edit`。** 想要结构化搜索 + 显式写入，用 `mnemopi` 或 `hindsight`。
6. **本地嵌入模型按机器共享一个 server。** 每个 `(model, cache-dir)` 对由 `~/.omp/run/mnemopi/` 下单个 detached `omp mnemopi embed` 进程服务，15 分钟空闲退出；多进程共享，不要重复加载。
7. **记忆注入的 token 预算。** `summaryInjectionTokenLimit`（5000）/`injectionTokenLimit`（5000）/sharpshooter `injectionTokenLimit`（15000）——注入是有上限的，不是「全量塞进 prompt」。
8. **记忆不是权威。** 文档明确「prefer repo state and user instruction when they conflict with memory」——别让一条过期记忆推翻眼前的代码。

---

## 九、附录

### 术语

- **working/episodic memory**：Mnemopi 的双记忆模型——工作记忆（新、有 TTL）与情节记忆（consolidate 后、按时间降级）。
- **veracity**：记忆的可信标签（stated/unknown/inferred/imported/tool），驱动召回权重。
- **sleep/consolidate**：把过期工作记忆合并/升级为情节记忆或摘要的后台过程。
- **scoping**：记忆可见范围（global / per-project / per-project-tagged）。
- **KV-cache stable**：记忆注入字节稳定，避免本地前缀缓存每轮整体失效。
- **Hermes-first / `~/.hermes/`**：记忆子生态的谱系标记，指向 Nous Research 的 Hermes Agent 及其记忆 provider（Hindsight、Mnemosyne）。

### 参考文献

1. Oh My Pi 仓库内 harness 文档（一手）：`memory.md`、`mnemosyne-memory-backend.md`、`local-models.md`、`porting-from-pi-mono.md`、`user-facing-packages.md`、`session.md`、`models.md`。
2. Oh My Pi 仓库：https://github.com/can1357/oh-my-pi（README §13「Memory the agent curates」）。
3. 上游 Pi：https://github.com/earendil-works/pi · https://pi.dev/docs/latest（文档索引，无 memory 页）。
4. `pi-memory` 扩展：https://github.com/jayzeng/pi-memory（README，markdown + qmd + KV-cache 快照）。
5. Mnemosyne：https://github.com/mnemosyne-oss/mnemosyne（「Hermes-first」SQLite 记忆层）· 集成 https://github.com/mnemosyne-oss/mnemosyne/blob/main/docs/integrations/pi.md · 扩展 `@mnemosyne-oss/pi-mnemosyne`。
6. Hindsight：https://hindsight.vectorize.io（Hermes Agent 记忆 provider）· Hermes Agent https://github.com/NousResearch/hermes-agent。
7. 姊妹篇：report 58（AnythingLLM 记忆注入）、report 62（Mem0 记忆层）、report 17（Oh My Pi 研究报告）。
