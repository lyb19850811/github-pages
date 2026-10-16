---
title: "Oh My Pi (omp) 研究报告：一个把 IDE 焊进终端的编码智能体"
date: 2026-10-16
tags: [ai, coding-agent, cli]
summary: 系统拆解 Oh My Pi（omp）——定位与血统、设计理念、架构、多智能体、Skills/MCP/扩展、安全与授权、竞品对比与趋势，附使用最佳实践。
---

> **TL;DR**：Oh My Pi（CLI 名为 `omp`）是一个**终端原生的 AI 编码智能体**，由 [Stencil Labs](https://stencil.so) 构建，是 Mario Zechner 的 [Pi](https://github.com/badlogic/pi-mono) 的 fork。它的核心主张是「**把 IDE 焊进终端**」——用 Rust 原生层把 ripgrep、bash、AST、LSP、调试器全部编进进程内，把「编辑格式」「工具契约」这类 **harness 问题**当作一等工程问题来优化。MIT 开源，60+ 模型提供商、31 个内置工具、约 8 万行 Rust；多智能体、Skills、MCP、扩展市场、记忆、本地模型、计算机使用全部内置。与 Claude Code / Codex / OpenCode 等相比，它的差异点不是「模型更强」，而是**对 harness 本身的极致工程投入**。

- **写作基线**：2026-10-16；仓库 `can1357/oh-my-pi`（Stars 35,654 / Forks 3,904 / Issues 3,811，MIT，TypeScript+Rust）。
- **数据来源**：① 仓库内 harness 文档（一手事实，标注 `docs/*.md`）；② GitHub / 官网 / 竞品仓库（2026-10 抓取）；③ 作者博客（一手但单一立场，已标注）。
- **存疑项标注**：`[INFERENCE]` 表示推断；「待核实」表示外部源暂未拿到。

---

## 1. 它是什么

### 1.1 一句话与血统

Oh My Pi 是一个**终端里的编码 agent**：`omp` 启动交互式 TUI，或 `omp -p "..."` 一次性执行，或 `--mode rpc/acp` 作为被嵌入的引擎。官方定位是 **"A coding agent with the IDE wired in"**（把 IDE 接进来的编码 agent），口号是 **"complete out of the box, open all the way down"**（开箱即用、全程开放）。

血统链：

```text
Mario Zechner 的 Pi (badlogic/pi-mono, 现 earendil-works/pi)
        │  fork，改写为 coding-first surface
        ▼
Oh My Pi (can1357/oh-my-pi)  —— 由 Stencil Labs 构建，主作者 Can Bölük
```

上游 **Pi** 的定位是「minimal, extensible agent harness（最小可扩展 agent 底座）」，作者自己说 Pi **刻意跳过 sub-agents 和 plan mode** 这类功能，把它交给扩展。omp 则反其道：「The Pi you love, with **batteries included**」——把会话、子 agent、slash 命令、扩展、市场、调试器、LSP 全部做进核心。「Oh My + 工具名」是沿用 [Oh My Zsh](https://ohmyz.sh) 的命名传统：给一个「裸」工具加上一套开箱即用的社区配置层。[INFERENCE：官方未明文解释前缀，但 Pi→Oh My Pi 与 zsh→Oh My Zsh 的「基础工具 + 增强发行版」结构一致]

### 1.2 关键数字

| 维度 | 数值 | 来源 |
|---|---|---|
| 模型提供商 | 60+（前沿 API + 订阅计划 + 本地 + 自定义 OpenAI 兼容） | README |
| 内置工具 | 31 个（另有一批 `xd://` 可发现设备） | README |
| LSP / DAP 操作 | 14 个 LSP ops、28 个 DAP ops | README |
| Rust 核心 | ~80k 行（6+ crates，另 vendored brush bash fork 约 38k 行） | README |
| 平台 | macOS / Linux / Windows（含 win32-arm64）；x64 双 AVX2/baseline 二进制 | README |
| 运行时 | Bun ≥ 1.3.14 | README |
| 许可证 | MIT（© 2025 Mario Zechner · © 2025-2026 Can Bölük · © 2026 Stencil Labs） | README |

### 1.3 安装与入口

```bash
curl -fsSL https://omp.sh/install | sh      # macOS/Linux
brew install can1357/tap/omp                 # Homebrew
bun install -g @oh-my-pi/pi-coding-agent     # Bun（推荐）
nix run github:can1357/oh-my-pi              # Nix
irm https://omp.sh/install.ps1 | iex         # Windows
```

四个运行入口（同一引擎）：**交互 TUI**（`omp`）、**一次性**（`omp -p`）、**RPC**（`omp --mode rpc`，NDJSON over stdio）、**ACP**（`omp acp`，Agent Client Protocol，可被 Zed 等编辑器驱动），另有 **Node SDK** 嵌入（`@oh-my-pi/pi-coding-agent`）。

---

## 2. 竞品对比与优缺点

### 2.1 竞品格局（2026-10 公开资料）

| 工具 | 定位 | Stars | 语言 | License |
|---|---|---|---|---|
| **Oh My Pi (omp)** | 终端原生，IDE 焊进终端 | 35,654 | TypeScript | MIT |
| [Claude Code](https://github.com/anthropics/claude-code) | 终端 agentic 编码工具 | 151,182 | TypeScript | 专有（非开源） |
| [Codex](https://github.com/openai/codex) | 轻量终端编码 agent | 129,509 | Rust | Apache-2.0 |
| [OpenCode](https://github.com/sst/opencode) | 「开源编码 agent」 | 214,213 | TypeScript | MIT |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | 把 Gemini 带进终端 | 107,408 | TypeScript | Apache-2.0 |
| [Aider](https://github.com/Aider-AI/aider) | 终端 AI 结对编程 | 49,584 | Python | Apache-2.0 |
| [Goose](https://github.com/block/goose) | 可扩展 AI agent（任何 LLM） | 55,344 | Rust | Apache-2.0 |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | AI 驱动的自主开发 | 91,057 | TypeScript | MIT |
| Cursor CLI | 终端 agent（IDE 生态延伸） | 闭源 | — | 专有 |

> 说明：Stars/语言/License 来自各 GitHub 仓库页（2026-10 抓取）；「定位」为各仓库自述。能力细节层面，竞争产品列以公开资料为据，下节「差异」尽量只用有出处的事实。

### 2.2 omp 的差异点（有据可查）

1. **编辑格式是工程研究对象**。作者博客 *The Harness Problem*（[blog.can.ac](https://blog.can.ac/2026/02/12/the-harness-problem/)）给出了各家的编辑实现：Codex 用 `apply_patch`（OpenAI 风格 diff，换给别的模型失败率暴涨，Grok 4 patch 失败率 50.7%）；Claude Code 用 `str_replace`（要求逐字符精确复现旧文本，「String to replace not found」有专门的 issue 大集合）；Gemini 在 str_replace 上加模糊空白匹配；Cursor 干脆训练了一个 70B 模型专做合并。omp 的方案是 **hashline**：每行带 2–3 字符内容哈希作为锚点，文件变化即拒绝，避免复现旧内容与空白。实测 16 个模型 × 3 种编辑格式：Grok Code Fast 1 从 6.7% → 68.3%（十倍），MiniMax 翻倍，Grok 4 Fast 输出 token 降 61%。作者的核心结论：**「+8% 的 Gemini 成功率比多数模型升级都大，训练成本为零」**。
2. **原生进程内执行，而非 fork/exec 外部二进制**。ripgrep、glob、find 编进进程；bash 是 vendored 的 [brush](https://github.com/reubeno/brush) fork（`pi-shell`，约 38k 行），带 58~67 个 coreutils（ls/sed/sort/xargs/jq）编译进内置 crate，零 fork/exec；同一二进制跑 macOS/Linux/Windows，无需 WSL。
3. **LSP/调试器接进每次写与运行**：重命名走 `workspace/willRenameFiles`（re-export、barrel、别名导入跟着更新）；调试器驱动真实 lldb/dlv/debugpy。
4. **`pr://`/`issue://` 内部 scheme**：GitHub PR 就是路径，`read pr://1428` 与 `read src/foo.ts` 同形，一个接口通吃文件系统与远程对象。
5. **模型无关**：60+ 提供商 + 9 个角色路由（`default/smol/slow/plan/commit/vision/task/advisor/tiny`），「模型只是参数，harness 才是变量」。

### 2.3 优缺点

**优点**：终端原生 + TUI 交互；MIT 全开源、可嵌入；工具面全（LSP/调试器/浏览器/桌面/计算机使用）；多 provider 聚合 + 回退链 + 凭据轮转；多智能体一等公民；会话可分支/回放/审计；对编辑格式等 harness 细节的量化工程投入。

**缺点 / 代价**：学习曲线陡（31 工具 + 内部 scheme + 大量 slash 命令）；生态与心智份额小于 Claude Code / Codex / OpenCode（star 差距明显）；fork 自 Pi，与上游存在双向漂移风险；`web_search` 依赖 23 个第三方 provider（作者本人曾因跑 benchmark 被 Google 封号，见 §14）；默认 `yolo` 授权模式对新手偏激进（§11）。

---

## 3. 设计理念

### 3.1 「Harness Problem」：模型不是唯一变量

这是 omp 最鲜明的理念，也解释了它为什么把力气花在「编辑格式」「工具 schema」「错误信息」这些「模型知道改什么」与「问题被解决」之间的环节。作者的原话立场：

> 「工具 schema、错误信息、状态管理——'模型知道要改什么' 与 '问题被解决' 之间的一切，才是实践中大多数失败发生的地方。」

三个推论贯穿整个产品：① **模型无关**（model-agnostic），harness 为所有模型调优而非为某一家；② **harness 是你有巨大控制权的变量**，值得量化投入；③ **开放式 harness 能修封闭 harness 修不了的问题**（例如「subagent 输出不再泄漏原始 JSONL，改返回结构化数据」）。

### 3.2 官方 Philosophy 三原则

README 明确列了三点：

1. **Keep interactive terminal-first UX** —— 真实编码工作保持终端优先的交互。
2. **Include practical built-ins** —— 工具、会话、分支、子 agent、可扩展性，做进内置而不是让你自己装。
3. **Make advanced behavior configurable rather than hidden** —— 高级行为做成可配置，而不是藏起来。

### 3.3 贯穿产品的具体体现

- **文件即真理**：会话是 append-only 的 JSONL 树，可分支、可回放、可审计、可迁移（§5）。
- **显式控制**：授权分 `read/write/exec` 三级；思维档位（`off→max`）；魔法关键词（`ultrathink`/`orchestrate`/`workflowz`）；vibe 导演模式。
- **本地优先**：本地模型（tiny-models）、本地记忆（Mnemopi）、auth broker 把凭据移出个人机。
- **信任模型明确**：打开仓库即按设计加载其项目输入（settings/extensions/hooks/tools/commands/skills/rules/项目 MCP），并用 `--no-extensions` / `--trusted-extension` / `--config` 显式收窄。

---

## 4. 系统架构

### 4.1 分层

```text
┌─────────────────────────────────────────────┐
│ 交互层  packages/tui  （差分渲染 TUI）        │
│         packages/collab-web（浏览器协作客户端）│
├─────────────────────────────────────────────┤
│ 核心    packages/coding-agent               │
│         agent loop · 工具 · 会话 · 扩展 · 发现 │
├─────────────────────────────────────────────┤
│ AI 层   packages/ai（pi-ai，多 provider 客户端）│
│         packages/catalog（模型目录/描述符）    │
├─────────────────────────────────────────────┤
│ 原生层  packages/natives（pi-natives）       │
│         JS ESM loader + Rust N-API addon     │
│         crates/*：pi-shell/pi-ast/pi-iso/... │
└─────────────────────────────────────────────┘
```

### 4.2 Monorepo 包（README 官方表）

| 包 | 职责 |
|---|---|
| `pi-coding-agent` | 交互式编码 agent CLI 与 SDK |
| `pi-agent-core` | agent 运行时（tool calling + 状态管理） |
| `pi-ai` | 多 provider LLM 客户端（流式） |
| `pi-catalog` | 模型目录：内置数据库、provider 描述符、身份 |
| `pi-tui` | 终端 UI 库（差分渲染） |
| `pi-natives` | N-API 绑定（grep/shell/image/text/高亮…） |
| `omp-stats` | 本地用量观测面板 |
| `omptype` | ArkType 兼容 schema 校验（懒 JIT） |
| `pi-mnemopi` | 本地 SQLite 记忆引擎 |
| `snapcompact` | 位图帧上下文压缩 |
| `browser-relay` | 让 eval 浏览器驱动现有 Chrome 标签页的扩展 |
| `pi-metaharness` | 统一 benchmark 管理（Harbor/edit/SnapCompact） |

### 4.3 原生层：把别的 harness「shell out」出去的东西编进进程

`pi-natives` 是 JS ESM loader + Rust Node-API addon，平台叶子包按 `${platform}-${arch}` 分发，x64 双 AVX2/baseline 变体，加载时校验版本哨兵。Rust crates 与行数（README 官方口径）：

| Crate | 职责 | ~LoC |
|---|---|---|
| `pi-shell` | 内嵌 bash 引擎 · 持久会话 · 进程内 coreutils 派发 | 38,000 |
| `pi-natives` | N-API 表面（下表所有模块） | 25,000 |
| `pi-walker` | 并行忽略感知 walker + 扫描缓存（grep/glob/workspace 共享） | 5,200 |
| `pi-iso` | 工作区隔离：apfs/btrfs/zfs reflink/overlayfs/projfs/rcopy | 3,300 |
| `pi-ast` | tree-sitter + ast-grep 匹配、块解析、结构化摘要 | 2,900 |
| `pi-voice` | 音频采集/播放 · Opus · 实时 WebRTC | 1,000 |
| `pi-edit` | `edit` 工具引擎：行锚点/hashline 补丁、流式预览、原子应用 | — |

`pi-natives` 内部模块覆盖：`desktop`（窗口/截图/AX 树，~10.6k LoC）、`grep`、`text`、`snapcompact`、`keys`（Kitty 键盘协议）、`ast`、`diff`、`pty`、`highlight`、`task`（libuv 线程池阻塞工作 + 取消）、`glob`、`clipboard`、`workspace`、`tokens`（O200k/Cl100k BPE）、`sixel` 等。

### 4.4 发现系统：capability-based discovery

omp 的核心可扩展机制是**能力发现**（`loadCapability(...)`）：extensions / hooks / skills / tools / commands / MCP servers / LSP servers 都由 provider 按优先级发现并 first-wins 去重。这与传统「读一个配置文件」不同——它允许同一套发现逻辑从 `.omp/`、npm 插件、Claude marketplace 插件、`.claude/.cursor/.vscode` 等多个来源聚合（§7/§8/§9）。

### 4.5 内部 URL scheme

16 个内部 scheme 在所有「文件形状」的工具里透明解析：`skill://`、`pr://`、`issue://`、`agent://`、`history://`、`memory://`、`ssh://`、`conflict://`、`xd://`（可发现设备）等。`agent://<id>/findings.0.path` 还能按路径从子 agent 输出里取字段。

---

## 5. 会话模型：可分支、可回放、可审计

这是 omp 区别于多数编码 agent 的结构性设计，也是「文件即真理」理念的落点。

- **append-only 树 + 可变 leaf 指针**：每个 entry 带 `id`/`parentId`，追加不改历史；`branch(entryId)` 只移动 leaf 指针；`resetLeaf()` 开新根。历史永不删除。
- **持久化**：`~/.omp/agent/sessions/<encoded-cwd>/<ts>_<id>.jsonl`，一行一个 JSON；256 字节 title 槽 + session header + entries；版本化迁移（当前 v3）；图片 data-URL 一律 content-addressed 到 blob store（`blobs/<sha256>`）。
- **entry 分类**：`message`、`compaction`（压缩摘要）、`branch_summary`（分支摘要）、`reset_boundary`（`/clear`）、`custom`（子系统不透明记录）、`label`、`title_change`、`ttsr_injection`、`credential_pin`、`session_init`、`mode_change` 等。
- **上下文重建**（`buildSessionContext`）：沿 `parentId` 走到根再反转为 root→leaf；沿路重放 thinking/tier/model/mode 状态；尊重 `reset_boundary` 与最近一次 compaction；丢弃 dangling tool call 与不安全的 aborted turn。
- **操作**：`/tree`（会话树导航）、`/branch`、`/fork`、`/resume`、`--continue`、`--from-claude`/`--from-codex`（导入外部会话）、`--export`（导出 HTML）、checkpoint 标签。
- **压缩**：自动 compaction + `checkpoint`/`rewind` 工具 + `snapcompact`（把丢弃的历史栅格化成 PNG 交给视觉模型压缩，无需 API key）。

为什么这重要：它是**审计与回放的基础**，也是「安全/恢复」的地基——异常退出后有 `session_exit` 记录与 pending-tool-call 重建，恢复时不会把中断的 turn 呈现成还活着。

---

## 6. 内置工具面

31 个内置工具，另有一批 `xd://` 可发现设备（`read xd://` 列出，`write xd://<tool>` 调用）。按类别：

- **文件与搜索**：`read`（文件/目录/归档/SQLite/PDF/notebook/URL/`ssh://`/内部 scheme 一个入口）、`write`、`edit`（hashline 锚点补丁 + 陈旧锚点恢复）、`ast_edit`（ast-grep 结构化改写，先提案后 `xd://resolve` 原子应用）、`ast_grep`（50+ tree-sitter 语法结构查询）、`grep`、`glob`。
- **运行时**：`bash`（46 个进程内 coreutils、可选 PTY、后台任务派发）、`eval`（持久 Python/JS 内核，可回调 agent 自身工具）。
- **代码智能**：`lsp`（诊断/导航/符号/重命名/code action）、`debug`（DAP 断点/单步/线程/栈/变量）、`security_scan`。
- **协调**：`task`（并行子 agent fan-out，可选工作区隔离）、`wait`、`todo`、`ask`（结构化追问选择器）。
- **桌面与网络**：`browser`（Puppeteer/headless Chromium/relay 驱动真实 Chrome）、`computer`（宿主桌面 JS：窗口/截图/原生输入/AX 树/剪贴板）、`web_search`（23 provider 链 + 站点感知提取）、`github`、`generate_image`、`tts`。
- **记忆与技能**：`checkpoint`、`rewind`、`retain`/`recall`/`reflect`/`memory_edit`、`learn`、`manage_skill`。

设计特点：核心工具与 `read`/`bash` 同名空间，`--tools read,edit,bash,...` 精确收窄活动集；`github`/`security_scan`/`generate_image`/`tts`/`checkpoint`/`rewind`/记忆工具默认关闭。

---

## 7. 如何安装 SKILLS

### 7.1 Skill 是什么

Skill 是**文件背书的「能力包」**：一个目录 + 一个 `SKILL.md`，启动时被发现，作为轻量元数据（name + description）注入系统提示词，正文按需经 `read skill://<name>` 或 `/skill:<name>` 拉取。它只提供知识/工作流内容，不执行代码（执行代码是 custom tool 的事）。

### 7.2 布局与 frontmatter

```
<skills-root>/
  ├─ postgres/SKILL.md   ✅ 发现
  ├─ pdf/SKILL.md        ✅ 发现
  └─ team/internal/SKILL.md  ❌ 不发现（provider loader 非递归）
```

`SKILL.md` frontmatter：`name`（默认目录名）、`description`（多数来源必填）、`globs`、`alwaysApply`、`hide`、`disableModelInvocation` 等。

### 7.3 安装方式（按推荐度）

1. **`.omp/skills/<name>/SKILL.md`（项目）** 或 `~/.omp/agent/skills/<name>/SKILL.md`（用户）——omp 原生，优先级最高（`native` provider，priority 100）。
2. **`.agent[s]/skills/<name>/SKILL.md`** —— OMP 规范位置（`agents` provider，priority 70 组），有独立 `enableAgentsUser`/`enableAgentsProject` 开关。
3. **直接复用第三方目录**：Claude（`~/.claude/skills`）、Codex（`~/.codex/skills`）、Agent Skills、opencode、GitHub（`.github/skills/<name>/SKILL.md`）——omp 直接兼容读取，无需迁移脚本。
4. **`skills.customDirectories`**：指向任意 `*/SKILL.md` 目录（同样非递归，嵌套 taxonomy 需指向嵌套父目录）。
5. **通过插件/市场**：`omp plugin install ...` 或 `/marketplace install` 安装的插件可携带 `skills/`。

### 7.4 发现优先级（first-wins 按名字去重）

`native(100) → omp-plugins(90) → claude(80) → {claude-plugins, agents, codex}(70) → opencode(55) → github(30) → omp-managed(5)`。`omp-managed`（自动学习技能，`~/.omp/agent/managed-skills`）永远让位于同名手写 skill。

### 7.5 配置开关与使用

```yaml
skills:
  enabled: true                # 总开关，false 则完全不发现
  customDirectories: ["~/skills"]
  ignoredSkills: ["*-draft"]   # 排除（glob）
  includeSkills: ["git-*"]     # 白名单（glob，空=全含）
  enableSkillCommands: true    # 开 /skill:<name>
# 另有 enableClaudeUser/enableCodexUser/... 源开关
```

使用：`read skill://<name>`（或 `skill://<name>/references/foo.md` 读附带资产）；`/skill:<name> [args]` 交互注入正文。编写要点：每 skill 一个目录、必填 `name`+`description`、附带资产放同目录用 `skill://` 引用、避免跨来源重名（first-wins）。

---

## 8. 如何连接 MCP

### 8.1 配置位置

- 项目（推荐）：`.omp/mcp.json`
- 用户：`~/.omp/agent/mcp.json`（profile 激活时为 `~/.omp/profiles/<name>/agent/mcp.json`）
- 便携回退：项目根 `mcp.json` / `.mcp.json`

文件顶部加 `$schema` 可得编辑器补全与校验（[schema 地址](https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json)）。

### 8.2 三种传输

```jsonc
// stdio（默认，省略 type 即 stdio）
{ "mcpServers": { "filesystem": {
  "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/abs/path"] } } }

// http（Streamable HTTP，新 server 推荐）
{ "mcpServers": { "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/" } } }

// sse（兼容旧式，仍支持）
{ "mcpServers": { "legacy": { "type": "sse", "url": "https://example.com/mcp/sse" } } }
```

共享字段：`enabled`、`timeout`（ms，`0` 禁用客户端超时；`OMP_MCP_TIMEOUT_MS` 进程级优先）、`requestIdFormat`、`auth`、`oauth`。

### 8.3 发现与优先级：直接读你已有的工具配置

omp **从 Claude Code / Codex / Gemini CLI / OpenCode / Cursor / Windsurf / VS Code / marketplace 插件** 原生读取 MCP 配置，无需迁移脚本。优先级：OMP native → OMP 扩展包 → Claude Code → Claude 市场插件/Codex → Gemini → OpenCode → Cursor/Windsurf → VS Code → 根 `mcp.json` 回退，first-wins 不合并。

### 8.4 认证

- **OAuth**（`http`/`sse` 远程）：`auth` 块描述如何定位/刷新存储凭据；`oauth` 块覆盖 clientId/clientSecret/redirectUri/callbackPort。走完 OAuth 后凭据存于 `mcp_oauth:profile:<profile>:<url>`，项目里只需提交「定义」不带凭据，各 profile 各自 `/mcp reauth` 授权。
- **secrets 解析**：`${VAR}` / `${VAR:-default}` 在发现期递归展开；预连接时 `env`/`headers` 值若以 `!` 开头则当 shell 命令执行（10s 超时、进程级缓存）；否则整值若为环境变量名则取环境值，否则字面量。典型写法：`"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"`。

### 8.5 命令与排错

```text
/mcp add       引导式添加            /mcp list       看每个 server 来自哪个文件
/mcp reload    重新发现+重连         /mcp test <n>   测单个
/mcp reauth <n> 替换 OAuth 凭据      /mcp unauth <n> 移除
/mcp resources|prompts|notifications 查看非工具能力
```

校验规则（`validateServerConfig`）：stdio 必填 `command`；http/sse 必填 `url`；`command` 与 `url` 互斥；未知 `type` 拒绝。两个高频坑：远程 server 忘了 `"type": "http"` 会被当 stdio 报「缺 command」；同时写 `command` 和 `url` 报「二选一」。

用户级跨源覆盖：`disabledServers`（最高优先级黑名单）/ `enabledServers`（强制启用 `enabled:false` 的同名项，但不能压过黑名单）。

---

## 9. 扩展、插件与 marketplace

omp 把「扩展」统一成一个 TS 模块系统，同时兼容 Claude Code 插件市场。

- **Extension**：默认导出一个 factory，拿到 `ExtensionAPI`（`pi`），一次性注册事件处理器 / LLM 工具 / slash 命令 / 快捷键 / 渲染器 / provider。事件面覆盖会话生命周期、prompt/turn 生命周期、工具生命周期（`tool_call` 可阻断或改写入参、`tool_result` 中间件式后处理）、MCP notification（可桥接 push 型 MCP 到会话 steer）。
- **Hooks**：独立的旧事件 API（`src/extensibility/hooks/*`），与 extension 并存。
- **Custom tools**：纯工具模块，被 extension 拦截器包裹。
- **边界**（`skills.md` 权威口径）：Skill = 被动内容；Custom tool = 可执行 API；Hook = 事件驱动的运行时拦截器；Extension = 以上统一的超集。
- **文件写/删回退缝**：`registerFileWriteFallback` / `registerFileDeleteFallback` 让宿主在沙箱拒绝直接写盘时，通过特权通道完成 `write`/`edit`/`apply_patch` 的落盘——这是「把 agent 嵌进受限宿主」的关键接缝。
- **Marketplace**：与 Claude Code plugin registry 格式兼容（`.omp-plugin/marketplace.json` 优先，`.claude-plugin/marketplace.json` 回退）。`/marketplace add anthropics/claude-plugins-official` + `/marketplace install wordpress.com@claude-plugins-official`。插件可携带 skills/commands/agents/rules/hooks/tools/MCP/LSP server。作用域 user（默认）/project；project 启用项遮蔽 user 同名项。

---

## 10. 多智能体：是，且是三层

**结论：是。** omp 不是「一个 agent 单打独斗」，而是把多智能体做成了三层正交的能力。

### 10.1 三层

| 层 | 机制 | 定位 |
|---|---|---|
| **task 子智能体** | `task` 工具 fan-out，可选工作区隔离（`pi-iso`），返回 schema 校验的结构化结果 | 并行、隔离、专业化 |
| **vibe 导演/工人** | `/vibe` 把主会话变成只读导演，`vibe_spawn` 拉 `fast`(sonic)/`good`(task) 持久 worker | 长期分工的「导演—工人」 |
| **hub/collab/advisor** | `Alt+A` Agent Hub 看板；`hub send/wait` 程序化协调；`/collab` 人类协作；advisor 第二模型旁听 | 可观测、可协调、可审查 |

### 10.2 为什么

- **并行**：独立工作流并发跑，`vibe_spawn`/`send` 立即返回，`vibe_wait` 只在真正阻塞时用。
- **上下文隔离**：每个 worker 是独立持久会话（自己的子 transcript），start blank、看不到导演的对话；`task` 支持 `isolated` worktree，sibling 互不污染。
- **专业化**：bundled agents 有 `scout`（只读侦察，更快模型）/ `designer` / `reviewer` / `security-reviewer` / `librarian`（源码溯源）/ `task` / `sonic`；自定义 agent 从 `~/.omp/agent/agents/*.md` 与 `.omp/agents/*.md` 发现，frontmatter 指定 `model`/`tools`/`spawns`/`output` schema。
- **审查**：advisor 角色用第二个模型逐 turn 旁听注入笔记；`/review` 并行 reviewer 子智能体扫分支/提交/未提交改动，按 P0–P3 打分给结论。

### 10.3 怎么做

- 直接：`task` 工具（`context` + `tasks[]`，每项 `agent`/`task`/`outputSchema`）。
- 程序化：`eval` 的 `agent()`/`parallel()`/`pipeline()`（工作流编排，workflowz 关键词注入该契约）。
- 导演式：`/vibe` → `vibe_spawn {cli: fast|good, prompt, name}` → `vibe_send/wait/kill/list`。
- 魔法关键词：`orchestrate`（并行子智能体 + 逐阶段验证）、`workflowz`（确定性多子智能体工作流）。
- 协调与产物：`hub send/wait` 跨 agent 发消息；`agent://<id>`（终稿产物）、`history://<id>`（只读 transcript）；`Alt+A` 看板读直播 transcript、steer、复活 parked、杀掉卡死 worker。

### 10.4 关键约束与权衡

- **深度门**：`task.maxRecursionDepth` 默认 2，到顶后子 agent 移除 `task` 工具并清空 spawn policy。
- **spawn policy**：父会话 `spawns` 名单限制可派生的 agent；`""`/`false` 拒绝一切。
- **结构化产出**：`outputSchema` + `schemaMode`（permissive/strict），父 agent 直接读 `agent://<id>/<path>`，不解析散文。
- **授权边界**：子 agent 默认 `yolo` 跑（不阻塞），父 `task` 授权是真正的边界；用户 `tools.approval.<tool>` 仍权威（§11）。
- **成本与一致性的诚实代价**：worker 完成 = turn settled，**不等于其结论正确**——导演仍要对最终结果负责，靠 `read` 触碰过的文件验证。

---

## 11. 安全与授权模型

（值得单列：上游 Pi **没有内置权限系统**，作者推荐外部容器化；omp 把授权做进了核心，这是 fork 的重要增强。）

### 11.1 三级授权 + 三种模式

每个工具声明 `approval` 档位：`read`（只读）/ `write`（改工作区，不执行任意代码）/ `exec`（执行代码、起 shell、驱动浏览器、派生 agent）。未声明的自定义工具安全默认按 `exec`。

| 模式 `tools.approvalMode` | 自动批准 | 提示 |
|---|---|---|
| `always-ask` | `read` | `write`,`exec` |
| `write` | `read`,`write` | `exec` |
| `yolo`（**默认**） | 全部 | 无 |

`--auto-approve`/`--yolo` 强制 yolo；`tools.approval.<tool>: allow|deny|prompt` 在所有模式下生效（可对 `bash`/`eval`/`mcp__*` 精控）。

### 11.2 安全覆盖与失败关闭

- `bash` 对 `rm -rf /`、fork bomb、远端拉取即执行、写 `/etc/passwd`、关机命令等危险模式强制 `override:true` 提示；`bash.patterns` 支持 `deny`（绝对）/`prompt`/`allow`。
- provider 来源的 computer-use 调用带 `pendingSafetyChecks` 时**无视 yolo 强制提示**，无交互 UI 则 fail-closed。
- 注意：`bash.patterns` 只作用于 `bash`；同一命令走 `eval`（exec 档）在 yolo 下会放行——需另配 `tools.approval.eval`。

### 11.3 凭据与 secret

- **Auth broker / gateway**（`omp auth-broker serve` + `omp auth-gateway serve`）：把 OAuth refresh token 从开发者电脑移到单一 broker 主机，client 只拿「refresh 字段被 sentinel 替换」的脱敏快照；gateway 是前置代理，client 永远看不到 access token。SQLite 单写者、后台刷新器、条件长轮询、加密快照缓存。
- **Secret 混淆**（`secrets.enabled`）：环境变量名匹配 secret 模式、`secrets.yml`、内建 token 正则，在送往 provider 前替换为可逆占位符，模型写回的工具参数执行前还原。`obfuscate`（可逆）/`replace`（单向）两种模式。
- **Profile 隔离**：`omp --profile <name>` 隔离 auth/会话/设置/缓存/MCP 用户层。

### 11.4 ACP 的授权边界

ACP 会话里，`bash`/`edit`/`delete`/`move` 走编辑器侧的 `session/request_permission`，通用提示走 form elicitation；拒绝即拒绝，不静默放行。schema 默认 yolo，但默认配置的 ACP 会话**仍保留客户端权限门**——显式设 yolo 才无人值守。

---

## 12. 使用与最佳实践

### 12.1 快速上手

```bash
omp                       # 交互 TUI
omp "列出 src 下所有 .ts"   # 带初始 prompt
omp @prompt.md @图.png "看图"   # 附件
omp -p "总结最近一次提交"    # headless 一次性
omp -p --mode json "..."   # 结构化输出（管道）
omp -c / omp -r / omp --fork <id>   # 续接/恢复/fork 会话
```

### 12.2 模型角色路由

九个角色按意图分工：`default`（常规）、`smol`（廉价子 agent fan-out）、`slow`（深推理）、`plan`（规划）、`commit`（changelog）、`vision`、`task`、`advisor`、`tiny`。启动覆盖 `--smol/--slow/--plan`，`Ctrl+P` 循环切换，`/model` 会话中换。回退链 `retry.fallbackChains`、路径作用域 `path:` 前缀、多 key 轮转。

### 12.3 最佳实践（可操作清单）

1. **用 todo + 阶段拆分**，别让一个 turn 吞掉多阶段任务。
2. **会话即分支**：大方向不确定时 `--fork` 或 `/branch` 分叉，别在同一线性历史里反复改口；关键节点打 checkpoint 标签。
3. **授权分级而非裸 yolo**：日常 `tools.approvalMode: write`（自动批读/写，`exec` 提示），比默认 yolo 更稳；危险命令靠 `bash.patterns` 兜底。
4. **prewalk/plan-yolo 控成本**：规划阶段用便宜模型，落地再切主力（`--prewalk`/`--plan-yolo`）。
5. **多智能体分工**：机械执行交给 `fast`(sonic)，判断/审查交给 `good`(task)/`reviewer`；`outputSchema` 让子 agent 返回结构化结果，别解析散文。
6. **导演要验证**：vibe/task 完成 ≠ 正确，用 `read` 复查触碰过的文件再收口。
7. **skill 精确加载**：把团队知识沉淀成 `SKILL.md`（`description` 写清楚触发场景），用 `--skills git-*` 或 `includeSkills` 过滤。
8. **MCP 走 OMP native + profile 隔离**：项目只提交 `.omp/mcp.json` 定义，凭据各自 profile `/mcp reauth`；共享远程 server 用 `disabledServers` 兜底。
9. **`/model` 换模型而不是换工具**：omp 的卖点是「换任何模型都能跑」，单任务可以 smol 起草、slow 复核、advisor 旁听。
10. **先 `read xd://` 再 `write xd://<tool>`**：ast_edit/lsp/debug/browser/inspect_image 等可发现设备默认收在 `xd://`，`tools.xdev` 控制。

---

## 13. 最佳搭档工具与生态

### 13.1 同生态包

| 包 | 用途 |
|---|---|
| `browser-relay` | 让 eval 浏览器驱动你已打开的 Chrome 标签页（`omp browser-relay install`） |
| `collab-web` | `/collab` 的浏览器协作客户端（my.omp.sh），带二维码加入 |
| `robomp` | 自托管 GitHub triage/fix 服务（webhook → 分类 → RPC 会话 → 评论/PR） |
| `omp-stats` | 本地 AI 用量观测面板（`omp stats`） |
| `pi-mnemopi` | 本地 SQLite 记忆引擎 + 独立 CLI（`mnemopi`），也带 MCP server |
| `pi-metaharness` | 统一 benchmark 管理（Harbor/edit/SnapCompact，REST/SSE + dashboard） |
| `snapcompact` | 位图帧上下文压缩 API（无需模型调用） |
| `omptype` | ArkType 兼容 schema（可独立 `bun add`） |

### 13.2 与其它工具的互操作

- **导入会话**：`--from-claude` / `--from-codex`。
- **继承配置**：首启即读 `.claude`/`.cursor`/`.windsurf`/`.gemini`/`.codex`/`.cline`/`.github/copilot`/`.vscode` 里的 rules、skills、MCP——「你团队上季度写的配置今晚照常工作」。
- **市场互通**：Claude Code 插件市场格式兼容（§9）。

### 13.3 外部「搭档」

MCP servers（filesystem/GitHub/Slack 等，§8）、Skills（Claude/Codex/Agent Skills/GitHub 来源，§7）、LSP servers（Biome/TS 等）、DAP adapters（lldb/dlv/debugpy）、23 个 web_search provider（Perplexity/Gemini/Anthropic/Exa/Kagi/Brave/Tavily/…）。

---

## 14. 发展趋势与风险

### 14.1 现状信号

- **非常活跃**：changelog 的 Unreleased 段已有大量近期 PR（issue 号到 ~#15900），贡献者来自社区；「PR 对所有人临时开放」是贡献模式的试验（此前需 vouch）。
- **从 fork 到独立产品**：已从「Pi 的增强版」走向自己的路线——把编辑格式、原生执行、多智能体、记忆做成独立卖点；Pi 上游仍在演进（115k stars，有自己的 RFC 流程），两条线双向漂移。

### 14.2 方向线索

1. **harness 工程化 / benchmark 驱动**：作者以 benchmark（16 模型 × 3 编辑格式、react-edit-benchmark、metaharness）作为产品决策依据——「+8% 成功率、零训练成本」是这种打法的成果展示。
2. **向编辑器靠拢**：ACP（Zed 集成）把同一个 agent 带进编辑器；LSP/调试器接进每个写操作。
3. **本地与私有**：本地 tiny-models（标题/记忆/思考档分类）、本地记忆 Mnemopi、auth broker 移凭据出个人机——隐私叙事清晰。
4. **多智能体成熟**：vibe 导演模式 + `orchestrate`/`workflowz` 关键词 + advisor 旁听，方向是「编排 + 审查」而非「单个更聪明的模型」。
5. **协议标准化对齐**：MCP（含 OAuth、从多家工具继承配置）、ACP、Skills（兼容 Agent Skills/GitHub skills）。

### 14.3 风险与不确定性

- **上游漂移**：与 Pi 的 fork 关系意味着维护者需持续同步或明确放弃上游特性（`porting-from-pi-mono.md` 记录了 15 类「有意分歧」）。
- **第三方依赖**：web_search 依赖 23 个 provider；作者博客自述因跑 benchmark 被 Google 封号、Anthropic 封禁 OpenCode 访问——「harness 是桥，厂商在烧桥」是真实生态摩擦（注：此为作者单一立场陈述）。
- **默认 yolo**：开箱授权宽松，对不熟悉的新用户是风险面（可配 `write` 模式缓解）。
- **终端本位的受众边界**：IDE 重度用户（尤其是 GUI 交互偏好）可能不买账；TUI 学习曲线本身是门槛。

---

## 15. 其它你可能想了解的

- **本地模型**：`omp tiny-models` 下载 1B–1.7B 级本地模型，专做三件「小任务」——会话标题生成（sub-1B 够用，LFM2-350M 速度/质量最优）、记忆抽取/合并（需 1B–1.7B，Qwen3-1.7B 抽取最稳但 ONNX 暂不可跑，注册表推荐 `lfm2-1.2b`）、`auto` 思维档难度分类。默认 `online`，不选就不下载、无本地推理成本；q4 量化是甜点。
- **记忆**：四种后端 `off`/`local`（项目级摘要+教训，后台两阶段抽取→合并→生成 `MEMORY.md`/`memory_summary.md`/`skills/`）/`hindsight`（远程）/`mnemopi`（本地 SQLite）。工具 `retain`/`recall`/`reflect`/`memory_edit`/`learn`（`learn` 可把教训升级成托管 skill）。
- **计算机使用**：`computer` 工具用 JS 控制宿主桌面——窗口/多显示器枚举、截图、原生输入、OS 无障碍 AX 树、剪贴板；`read_only` 只是审批档位声明**不是沙箱**；macOS 需屏幕录制 + 辅助功能授权。
- **SDK/嵌入**：`@oh-my-pi/pi-coding-agent` 暴露 `ModelRegistry`/`SessionManager`/`createAgentSession`，Node 进程内嵌入；`omptype` 提供 ArkType/TypeBox/Zod 兼容 schema。
- **会话导出/协作**：`--export`（HTML）、`/share`（加密链接）、`/collab`（实时协作 + 二维码 + 只读视图）。
- **命名与血统**：上游 Pi 官网 `pi.dev`（原 `badlogic/pi-mono`，现 `earendil-works/pi`，115k+ stars，MIT）；Oh My Pi 是「给 Pi 装上电池」的 coding-first fork，「Oh My」命名与 Oh My Zsh 的「基础工具 + 增强发行版」结构一致 [INFERENCE，官方未明文解释]。

---

## 参考文献

1. Oh My Pi 仓库：https://github.com/can1357/oh-my-pi （README、CHANGELOG、docs/）
2. omp 官网与文档：https://omp.sh · https://omp.sh/docs/tools · https://omp.sh/docs/providers · https://omp.sh/docs/sdk
3. Can Bölük, *The Harness Problem*（2026-02-12）：https://blog.can.ac/2026/02/12/the-harness-problem/
4. 上游 Pi：https://github.com/badlogic/pi-mono （现 https://github.com/earendil-works/pi）· https://pi.dev
5. 仓库内 harness 文档（docs/）：`skills.md`、`mcp-config.md`、`session.md`、`extensions.md`、`marketplace.md`、`agent-hub.md`、`task-agent-discovery.md`、`vibe-mode.md`、`magic-keywords.md`、`approval-mode.md`、`auth-broker-gateway.md`、`secrets.md`、`local-models.md`、`memory.md`、`computer-use.md`、`natives-architecture.md`、`cli-reference.md`
6. 竞品仓库：Claude Code（github.com/anthropics/claude-code）、Codex（github.com/openai/codex）、Gemini CLI（github.com/google-gemini/gemini-cli）、OpenCode（github.com/sst/opencode）、Aider（github.com/Aider-AI/aider）、Goose（github.com/block/goose）、OpenHands（github.com/All-Hands-AI/OpenHands）、Cursor CLI（cursor.com/cli）
7. Agent Client Protocol：https://github.com/zed-industries/agent-client-protocol
8. MCP 规范：https://modelcontextprotocol.io
