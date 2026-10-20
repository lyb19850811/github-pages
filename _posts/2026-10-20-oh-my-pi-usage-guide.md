---
report: 56
title: "Oh My Pi（omp）使用深入指南：界面、命令、配置、扩展与 Skills/MCP"
date: 2026-10-20
updated: 2026-10-21
updates: 2
tags: [ai, coding-agent, cli]
summary: 面向「怎么真正用起来」的 omp 操作手册：TUI 界面与快捷键、slash 命令与魔法关键词、配置分层与 profile、四种扩展面、Skills/MCP 的配置与排错。
---

> **TL;DR**：本文是 omp 的**使用手册**，回答五个操作性问题——① TUI 界面怎么看；② 有哪些交互指令（slash 命令 / 魔法关键词 / CLI 旗标）；③ 配置在哪、怎么配；④ 功能怎么扩展；⑤ Skills、MCP 怎么用，以及「等等」还覆盖了什么。
>
> 与姊妹篇 [report 17（`2026-10-16-oh-my-pi-research.md`，定位/架构/竞品全景）]({{ '/research/oh-my-pi-research/' | relative_url }}) 互补：那份讲「是什么、为什么」，这份讲「怎么用」。所有结论以仓库内 harness 文档（`docs/*.md`，即 `omp://` 一手事实）为准，外部推断标注 `[INFERENCE]`。
>
> 本文已于 **2026-10-21 对照 omp v18.12.3 全文复核更新**：补齐 goal/vibe/prewalk 三种会话模式、advisor/WATCHDOG 评审、`always-ask-cached` 授权档、`/delete`/`/restart`/`/btw` 等命令更名与新增，并修正 profile、环境变量与 MCP 细节（updates 2）。

---

## 0. 先建立心智模型

omp 是**终端原生**的编码智能体。一个引擎，四个入口：

```bash
omp                     # 交互 TUI（默认）
omp -p "总结最近一次提交"   # headless 一次性：turn 完成后整段写出文本并退出（非逐 token 流式，Working... 指示走 stderr）
omp --mode rpc           # 行分隔 JSON 命令/响应/事件传输 server over stdio（注意：不是 JSON-RPC 2.0）
omp acp                  # Agent Client Protocol server（Zed 等编辑器驱动；--mode acp 等价）
```

只要第一非旗标参数不是已注册子命令，`omp "..."` 就当默认 `launch` 子命令并把它当初始 prompt。例外：裸的插件管理词（`marketplace`/`uninstall`/`extensions`）不再被当 prompt，而是提示改用 `omp plugin …`；非要把它们当 prompt 需显式写 `omp launch <word>`。理解 omp 只需抓住三件事：

1. **一个 TUI**：transcript + editor/composer + status line + 内联工具输出（§1）。
2. **一个会话树**：append-only JSONL + leaf 指针，可分支/回放/审计（`/fork` `/tree` `/resume`）。
3. **一个发现系统**：能力（capability）由 provider 按优先级发现、first-wins 去重——settings/skills/commands/tools/hooks/extensions/MCP 全走同一套逻辑（§3/§4/§5）。

---

## 1. 界面怎么看

### 1.1 TUI 的分层与「读法」

交互 TUI 由 `packages/tui`（差分终端渲染器）渲染。用户可见的稳定面：

| 面 | 内容 | 如何操作 |
|---|---|---|
| **主会话 transcript** | 对话、消息、模型输出（`role`/`model`/`provider` 元数据） | 滚动阅读；Agent Hub（`Alt+A`）可看子 agent 的独立 transcript |
| **editor / composer** | 输入区，支持 Composer Shape（`composer.shape`，内置 id 全套 `box/band/claude/pi/borderless/rule/field/rail`，或扩展自定义；内置 id 不可被扩展替换，扩展缺失回退 `box`） | 输入 prompt；`Ctrl+G` 用 `$EDITOR` 编辑草稿 |
| **status line** | 模型、thinking 档、状态段（可配置） | 只读，指示当前会话状态 |
| **工具输出** | 内联渲染，可展开 | `Ctrl+O` 展开/折叠；`Ctrl+Shift+O` 显示/隐藏工具活动 |
| **thinking block** | 模型推理过程（默认可见） | `Ctrl+T` 折叠/展开；`Shift+Tab` 循环 thinking 档 |
| **魔法关键词高亮** | 编辑期动画渐变、已发送消息静态渐变 | 仅视觉提示，识别本身独立于高亮 |

![omp 主界面 TUI（启动欢迎屏）]({{ '/assets/images/omp-tui-welcome.png' | relative_url }})

*omp 主界面：上方为 transcript 区（欢迎面板 + 右侧 Tips / LSP / Recent sessions 面板），底部为 status line（模型 · 思维档 · 目录 · 分支）与 editor/composer。*

> 界面「读法」的关键是**状态 + 动作分离**：transcript 是只读的历史，editor 是待提交的输入，status line 是「当前谁在跑、用哪个模型、什么思维档」。魔法关键词（§2.4）的全局开关会同时停掉编辑期动画与 notice 注入，但**已发送消息里的静态高亮**仍在——高亮是视觉 affordance，不是触发开关。

### 1.2 快捷键速查（`app.*` action ID）

运行 `/hotkeys` 看**当前 build 的生效 chord**（含磁盘 remap 与扩展新增的绑定）。下表为默认值：

| Action ID | 默认 | 含义 |
|---|---|---|
| `app.model.cycleForward` / `cycleBackward` | `Ctrl+P` / `Shift+Ctrl+P` | 循环角色模型（前进/后退） |
| `app.model.selectTemporary` | `Alt+P` | 本次会话临时换模型 |
| `app.model.select` | `Alt+M` | 打开模型选择器、设定角色 |
| `app.plan.toggle` | `Alt+Shift+P` | 切换 plan mode |
| `app.history.search` | `Ctrl+R` | 搜索 prompt 历史（SQLite，`history.db`） |
| `app.tools.expand` / `toggleVisibility` | `Ctrl+O` / `Ctrl+Shift+O` | 展开工具输出 / 显隐工具活动 |
| `app.thinking.toggle` / `cycle` | `Ctrl+T` / `Shift+Tab` | 折叠思维块 / 循环思维档 |
| `app.editor.external` | `Ctrl+G` | `$VISUAL`/`$EDITOR` 编辑草稿 |
| `app.message.followUp` | `Ctrl+Q`, `Ctrl+Enter` | 排队 follow-up 消息（`Ctrl+Enter` 与 Copilot CLI 同键，Windows Terminal 吞 `Ctrl+Enter` 故双绑） |
| `app.message.dequeue` | `Alt+Up`, `Shift+Up` | 把排队消息取回编辑器 |
| `app.retry` | `F5`, `Alt+R` | 重放上次失败的工具批次 / 重试失败的助手 turn |
| `app.display.reset` | `Alt+L` | 重置终端显示 |
| `app.clipboard.*` | `Alt+Shift+L` / `Alt+Shift+C` / `Ctrl+Shift+V`+`Alt+Shift+V` | 复制当前行 / 复制整段 prompt / 原样粘贴（双绑） |
| `app.clipboard.pasteImage` | Linux/mac `Ctrl+V`、mac `Cmd+V`；Win `Ctrl+V`/`Alt+V` | 粘贴剪贴板（图优先，无图回退文本） |
| `app.stt.pushToTalk` | `Space`（按住） | push-to-talk 语音转写（按住录、松开转写；禁用写 `app.stt.pushToTalk: []`） |
| `app.stt.toggle` | 未绑 | 按键开/停语音转写（与 push-to-talk 独立） |
| `app.live.toggle` | `Ctrl+L` | 开/关实时语音（同 `/live`） |
| `app.agents.hub` | `Alt+A`（旧 `app.session.observe` 为 `Ctrl+S`） | 打开 Agent Hub |
| `app.ask.hide` | `Alt+H` | 把挂起的 ask 问题收成一行（同键/Enter 恢复） |
| `app.approval.approve` | `Ctrl+Enter`, `Ctrl+Q` | 直接批准挂起的工具调用（`Esc` 拒绝，`Enter` 取箭头高亮项） |
| `app.tree.previousBranch` / `nextBranch` | 未绑 | `/tree` 中跳前/后可见分支 |

Remap 到 `~/.omp/agent/keybindings.yml`（独立文件，**不在** `config.yml` 里，也无嵌套 `keybindings` 对象）：

```yaml
app.model.cycleForward: Ctrl+P
app.plan.toggle: Alt+Shift+P
app.history.search: []          # 空数组 = 禁用该 action
```

chord 大小写不敏感，写法同 UI（`Ctrl+P`、`Alt+Shift+P`、`Shift+Enter`）。旧 `keybindings.json` 仍被接受并迁移到 `.yml`；`keybindings.yaml` 同样接受；命名 profile 先继承默认 profile 绑定、再逐 action 覆盖。

补两个编辑期细节：`Ctrl+C` 清空草稿后按 `Up` 可召回（含图片附件，上限 100 条，`composer.recallClearedDrafts` 默认开）；`tui.vimMode`（默认关）提供 Insert/Normal/Visual 的 Vim 编辑模式（operators + text objects，状态栏模式指示 `tui.vimModeDisplay: text|icon|none`）。

### 1.3 Agent Hub：多智能体的看板

`Alt+A` 打开 Agent Hub——当前会话所有子 agent 的**实时花名册 + 控制面**（主 agent 不列，它就是你面前的 ambient 会话视图）。roster 行显示 `running/idle/parked/aborted` 状态、模型角色、任务、cost、请求/工具调用/token 计数、未读 IRC 计数与距上次活动 age；按 `t` 切换扁平视图与父子树；宽终端侧边是 inspector（当前工具+参数、最后意图、重试状态、上下文窗口占用、血缘、output/patch 路径）。空主会话编辑器且会话有 agent 时，双击 `←` 也能打开 Hub。

![omp Agent Hub（空会话）]({{ '/assets/images/omp-tui-agent-hub.png' | relative_url }})

*Agent Hub（`Alt+A`）：左栏 roster + usage，右栏 inspector；截图为空会话（`No agents in this session`），底部为 Hub 快捷键栏。*

| 键 | 动作 |
|---|---|
| `j/k`、`↑/↓`、滚轮 | 选择 agent |
| `Enter` | 聚焦该 agent 的会话（parked 会被复活） |
| `t` | 扁平 / 父子树 |
| `Tab` | 窄终端切换 inspector |
| `r` | 复活 parked 或 killed（aborted）agent（killed 以完整磁盘历史作为新实例回来） |
| `x` | 中断并 kill 选中的 agent |
| `/` | 按 id/显示名过滤 roster |
| `1` / `2` | Agents / Activity 区切换 |
| `PageUp` / `PageDown` | 滚动已开 inspector |
| `Esc` | 先清活动 filter/搜索 → 关窄终端 inspector → 关 Hub |

聚焦子 agent 后，transcript/status line/editor 都属于它：可读它的直播 transcript，可 `Enter` steer 运行中的 turn 或 prompt 空闲 agent；空编辑器按 `Esc` 或双击 `←` 回到主会话。聚焦时还可用 `Alt+P`、`/switch`、`Ctrl+P`、`Shift+Tab`、`/effort` **只改该子 agent 的模型/思维档**（session-only，不影响主会话）；`/model`、`Alt+M` 仍开主会话选择器。advisor 行只读（不能发消息/复活/kill）。编辑器上方有 pinned `Subagents` jump list（`display.pinnedAgents: collapsed|full|off`，默认 collapsed；`display.subagentLivePreview` 每行加当前工具预览，默认关）。

相关 agent-facing 内部 scheme：`agent://<id>`（终稿产物）、`history://<id>`（只读 transcript）。程序化协调走 `write agent://<id>`（steer/follow-up；消息发给 parked/killed agent 会复活它）与 `agent://all`（对 live peers 广播）。

---

## 2. 交互指令

「交互指令」分三层：**会话内 slash 命令**、**提示词魔法关键词**、**CLI 旗标**。

### 2.1 内置 slash 命令清单（按用途）

| 分组 | 命令 | 作用 |
|---|---|---|
| 设置/模型 | `/settings` `/model` `/hotkeys` | 交互设置面板 / 会话内换模型 / 查看生效快捷键 |
| 会话 | `/new` `/fresh` `/clear` `/delete` `/restart` | 新空会话 / 只重置 provider 流状态保对话 / 原位清上下文 / 尽力删除当前会话与 artifacts 再开新 / 按原始 launch flags 原地重启并恢复当前会话 |
| 会话树 | `/tree` `/branch`（别名 `/rewind`） `/fork` `/resume` | 树导航 / 分支 / 建新会话文件并切换 / 恢复选择器 |
| 历史/侧问 | `/btw <question>` `/seance [id|path]` `/annotate` `/record` `/plan-review` | 对当前 transcript 提独立侧问（不污染主会话，有历史面板）/ 把历史会话分叉为只读顾问子 agent / 给 diff/消息/文件加批注再交 agent / 录屏为 .ompcast / plan mode 下重开计划评审浮层 |
| 导出分享 | `/export` `/dump` `/share` | 导出 HTML / 文本+LLM 请求 dump / 端到端加密分享链接 |
| 协作 | `/join` `/collab` | 加入共享会话 / 实时协作 |
| 工具/生态 | `/mcp` `/marketplace` `/plugins` `/reload-plugins` `/login` `/memory` `/forget-approvals` | MCP 管理 / 插件市场 / 插件列表 / 重载插件 / 提供商登录 / 记忆管理（view/stats/queue/sync…）/ 清除授权缓存与全会话授权记忆 |
| 智能体 | `/agents` `/vibe` `/review` `/advisor [on|off|status|dump|configure]` `/jobs` `/pause` `/live` | 任务 agent hub / 导演模式 / 并行审查 / advisor 运行时（§2.6）/ 异步任务快照 / 暂停 / 实时语音 |
| 模式/工作流 | `/goal` `/prewalk [restart|off]` `/retry` `/compact` | 进入 goal mode / 规划→实现一次性模型交接 / 重放失败工具批次（同 F5/Alt+R）/ 手动压缩上下文 |
| 工作区 | `/move` | 切换工作目录（刷新 cwd 相关能力） |
| 技能 | `/skill:<name>` | 注入某 skill 正文（§5.1） |

几个高频命令的语义差异值得记牢：

- **`/fresh` vs `/clear` vs `/new` vs `/delete`**：`/fresh` 只重置 provider 流状态（server-side conversation/prompt-cache id）**保留可见与模型上下文**；`/clear` 原位清空 live/model 上下文但保留会话身份与磁盘历史（追加 `reset_boundary`）；`/new` 开全新空会话；`/delete` 尽力删除当前持久化会话 JSONL 与 artifacts 再开新（删除失败仍开新会话，不是保证擦除边界）。
- **`/fork`**：从当前会话新建 JSONL 并切换身份，历史条目不变，header 记 `parentSession`；等价 CLI `omp --fork <id>`。另有 placement fork——`/fork pane|window|tab` 在 tmux/Zellij/Herdr/CMUX/Orca 里开子进程分叉（父会话不动）。
- **`/restart`**：按原始 launch flags 重启 omp 并在原地恢复当前会话（CLI 侧的恢复旗标是 `--restore`，见 §2.5，语义不同：它还接续上次进程中断时未完成的 turn 与其子 agent）。
- **`/resume`**：无参开选择器（当前目录范围，`Tab` 切全项目）；`/resume @claude`/`@codex` 打开外部会话导入器。
- **`/pause`**：仅 TUI。挂起进程级 gate，主 agent/子 agent/advisor 都在下一个安全边界停住（在飞调用跑完，不中断，不放新工作）；`Esc`/`Enter`/`Space`/`Ctrl+C` 恢复。

### 2.2 slash 命令的发现与优先级

slash 命令也是一种能力（`slash-commands`），按 provider 优先级 first-wins 去重：

```
native(.omp/commands, priority 100)  >  omp-plugins(90)  >  claude(80)
>  {claude-plugins, agents(.agent[s]/commands), codex}(70)  >  opencode(55)
```

- 每个命令是一个 `.md` 文件：`<cwd>/.omp/commands/*.md`（项目）与 `~/.omp/agent/commands/*.md`（用户，profile 生效时为 `~/.omp/profiles/<name>/agent/commands/`）。**项目 native 优先于用户 native**。
- 注意：外来**用户级**来源（claude/codex/opencode/claude-plugins）默认**关闭**，需 `enabledProviders: [claude, codex, …]`（或 `*`/`all`）显式 opt-in；另有细开关 `commands.enableClaudeUser`（默认 false）与 `commands.enableOpencodeUser`（默认 false）。**项目级**外部来源不受影响、默认可发现。
- Claude 来源递归读 `~/.claude/commands/**/*.md` 与 `<cwd>/.claude/commands/**/*.md`，子目录额外注册 `foo/bar` → `bar` 与 `foo:bar` 命名别名；**用户优于项目**。
- Codex/OpenCode 读 `~/.codex(或 .config/opencode)/commands/*.md` 与项目 `.codex(或 .opencode)/commands/*.md`，frontmatter 支持 `name` 覆盖与 argumentHint；frontmatter `description` 在发现阶段被剥掉、**不会被使用**（runtime description 回落到 body 首行）。
- agents 来源从 cwd 向上扫到 repo root 的 `.agent/commands` 与 `.agents/commands`（最近者优先、`.agent` 先于 `.agents`），再扫 `~/.agent[s]/commands`；项目优于用户。
- 隐藏文件/目录不加载、gitignore 生效、非递归 `*.md`。

### 2.3 自写 slash 命令

一个命令 = 一个 `.md`，body 是可执行模板。支持占位符替换：

- `$1`、`$2`、… 位置参数；`$@`、`$ARGUMENTS` 全量；`$@[start]` / `$@[start:length]` 切片（1-based）。
- 引号感知的参数解析（`'single'`/`"double"` 保空格），不做反斜杠转义；未闭合引号不算错。模板**未使用任何内联占位符**时，参数自动追加到展开文本末尾；空引号参数被丢弃，缺失位置参数/越界切片渲染为空串。

```markdown
---
description: 生成一个带上下文的 PR 描述
---
为这个改动写 PR 描述，重点关注 $@。
```

调用 `/review-pr 日志 缓存` → `$1=日志`，`$@=日志 缓存`。内置命令先于文件命令分派；未知 `/...` 不报错，作为普通 prompt 透传。

### 2.4 魔法关键词（magic keywords）

prompt 正文中的**独立小写单词**，为当轮注入隐藏的、归因于用户的指令（默认开启；`magicKeywords.enabled` 总开关 + **四个** per-keyword 开关，均默认 `true`）：

| 关键词 | 效果 |
|---|---|
| `ultrathink` | 注入多步推理 notice；auto thinking 激活时，当轮选当前模型支持的最高推理档（并绕过 `providers.autoThinkingMaxEffort`） |
| `orchestrate` | 注入多智能体编排契约：整体 scope、并行委托、逐阶段验证、直到完成 |
| `workflowz` | 注入确定性多子智能体工作流契约，围绕持久 `eval` 内核的 `agent()`/`completion()`/handle/`wait()`/`workpool()`；仅当 `eval` 与 `task` 都激活时注入（配置键是 `magicKeywords.workflow`，不是 `workflowz`） |
| `jevify` | 注入 `eval` 内核 `judge()` 的批量分类契约：先冻结问题/rubric/预过滤/升级阈值，单批 judge 全量后只读被标记项；仅当 `eval` 激活时注入 |

匹配故意严格，避免误触发：必须精确小写、独立成词（`orchestrate,` 命中，`orchestrated`/`orchestrate.ts`/`orchestrate()` 不命中）；围栏代码块、inline code、HTML/XML 注释标签及其内容被忽略。关闭全局开关只停隐藏注入与编辑期动画，**静态高亮与拼写豁免保留**（关键词免于 macOS 拼写自动纠正）。开关：`omp config set magicKeywords.ultrathink false`（另三键 `orchestrate`/`workflow`/`jevify`）。

### 2.5 CLI launch 旗标（精讲）

`omp`/`omp launch` 的启动面（完整见 `omp --help` 与 `cli-reference.md`）：

| 类别 | 旗标 | 说明 |
|---|---|---|
| 会话 | `--continue/-c` `--resume/-r [id]`（别名 `--session`） `--fork <id>` `--no-session` `--restore [id]` | 续接 / 恢复（id 前缀、路径或缺省开选择器）/ 分叉 / 不落盘（ephemeral）/ 恢复并接续上次进程中断时未完成的 turn 与其子 agent（仅交互、不带 prompt） |
| 会话导入 | `--from-claude` `--from-codex` `--export <s>` | 导入外部会话 / 导出 HTML |
| 模型 | `--model` `--smol` `--slow` `--plan` `--models` `--provider` | 角色路由 / 切换循环 / 提供商（legacy） |
| 思维 | `--thinking <level>` `--hide-thinking` `--print-thoughts` | 档位 `off/minimal/low/medium/high/xhigh/max/auto` / 隐藏（仅显示层）/ headless 输出含思维 |
| 规划 | `--prewalk` `--prewalk-into <id>` `--no-prewalk` `--plan-yolo` `--plan-yolo-into <id>` | 规划→实现一次性模型交接（§2.6）/ 目标模型（默认 `smol` 角色）/ 本次会话禁用 prewalk（含 auto）/ 只读规划+自动批准计划再落地 / 执行目标模型 |
| 工具/授权 | `--tools` `--no-tools` `--no-lsp` `--no-pty` `--approval-mode <mode>` `--auto-approve/--yolo` | 收窄工具集 / 授权模式（`always-ask`\|`always-ask-cached`\|`write`\|`yolo`，见 §3.6；会话内 `/forget-approvals` 清授权缓存） |
| 扩展 | `--extension/-e` `--hook` `--trusted-extension` `--plugin-dir` `--no-extensions` `--skills` `--no-skills` `--no-rules` | 扩展加载 / 信任路径（精确白名单）/ 技能过滤 |
| 系统提示 | `--system-prompt` `--system-prompt-template <path>` `--append-system-prompt` | 覆盖 / Handlebars 模板（与前者互斥）/ 追加 |
| 输出 | `--mode text/json/rpc/rpc-ui/acp`（`acp` 等价 `omp acp` 子命令） `--no-ui` | 传输模式 / rpc 与 rpc-ui 下扩展 headless（rpc-ui 工具 UI 保留） |
| 运行时 | `--advisor` `--service-tier <tier>` `--max-time <dur>` `--external-thinking` `--api-key <key>` | 启动即启用 advisor 运行时 / OpenAI 服务档（none/auto/default/flex/scale/priority/ultrafast）/ 到时停会话（`600`、`10m`、`1h`）/ 私有 scratchpad 替代 GPT/Claude/Gemini 原生推理（官方提示此请求形态有 abuse 风险）/ 覆盖 API key |
| 工作区 | `--cwd` `--add-dir` `--profile <name>` `--config <file>` `--session-dir` | 目录 / profile / 配置 overlay |

`@path` 把文件/图片附到初始消息；非 TTY stdin 自动当初始 prompt（勿加 `-`）；`--` 之后全是字面消息文本。

### 2.6 三种会话模式：goal / vibe / prewalk（v18.12 重点新增）

- **goal mode**：`/goal`（或启动时 `--goal <objective>`）把会话收敛到单一目标——围绕目标规划、执行、收敛，直到达成。需 `goal.enabled`（默认 true）；`--goal` 仅交互、绕过 `autoResume`，且与位置 prompt/`@file`/stdin/`--resume`/`--fork`/导入/`--plan-yolo`/`--no-tools`/启动 plan mode 互斥。RPC 侧有对应 `goal` op。状态栏可显示目标（`goal.statusInFooter`）。
- **vibe mode**：`/vibe`（或 `/vibe <第一条指令>`）把顶层会话变成**导演**——自己的工具集收窄为 `read`（+ 可选的父级 `todo`）加五个 worker 控制工具（`vibe_spawn`/`vibe_send`/`vibe_wait`/`vibe_kill`/`vibe_list`），真实干活的是持久后台 worker 子 agent。worker 分两档：`fast`（bundled `sonic`、默认 `@smol`，机械执行/草稿）与 `good`（bundled `task`、默认 `@task`，设计/判断/复核）；每个 worker 有独立持久 child transcript，导演靠 `read` 复核其产出。与 active/paused 的 plan/goal 模式互斥；开启时 status line 显示 `Vibe`。再跑一次 `/vibe` 退出（退出会取消在飞 worker turn）。
- **prewalk**：规划→实现**一次性模型交接**——起始模型做探查/todo/首批改动，到第一个合格 `edit`/`write`（todo 激活时还需成功 todo 调用开闸）即切到 `@smol`（或 `--prewalk-into <id>` 指定目标）继续实现。开关：`prewalk.enabled`（默认 off）、`--prewalk`/`--no-prewalk`（本次会话）、会话内 `/prewalk`/`/prewalk restart`/`/prewalk off`。**auto-prewalk**（`prewalk.auto: suggest|on`，`prewalk.autoTarget` 默认 `@smol`）：由 native judge 按任务判断值不值得交接（`suggest` 只报决策不执行；`on` 且 prewalk 概率 ≥ 0.70 才 arm），只分类新任务、失败静默降级。子 agent 有独立开关：agent frontmatter / `task.prewalk` / `task.agentPrewalk`。

**advisor / WATCHDOG**（相关）：`/advisor` 家族与 `--advisor` 给会话挂被动评审模型——每轮/仅收尾时评审主 agent 的 transcript 增量，可自配工具，经 `advise` 工具注入 `nit/concern/blocker` 三级批注（`concern` 及以上可在允许时打断/续跑）。评审规则写 `WATCHDOG.md`（advisor 专用，不进主 agent 上下文），多评审者名册写 `WATCHDOG.yml`（`/advisor configure` 交互编辑；`advisor.reviewMode`/`reviewInterval` 等控制节奏，默认模型走 `modelRoles.advisor`）。子 agent 默认不挂 advisor，按 agent frontmatter `advisor: true|"<model>"` 或 `task.agentAdvisor` 逐个 opt-in。

---

## 3. 配置在哪里、怎么配

### 3.1 配置根与来源顺序

通用 helper 的固定来源优先级（`config.ts`）：

```text
.omp（native） > .claude > .codex > .gemini
```

每个来源分**用户级**与**项目级**：

| 层级 | OMP native | 外部工具 |
|---|---|---|
| 用户 | `~/.omp/agent/`（profile 生效时 `~/.omp/profiles/<name>/agent/`） | `~/.claude` `~/.codex` `~/.gemini` |
| 项目 | `<cwd>/.omp/` | `<cwd>/.claude` `.codex` `.gemini` |

`getConfigDirs()` 返回「先用户后项目、按来源优先级」的有序条目；能力 provider 按优先级排序（native `100` > claude `80` > codex/agents/…`70` > gemini `60`），再按 capability key first-wins 去重。**「打开仓库即加载其项目输入」是设计行为**——settings/extensions/hooks/tools/commands/skills/rules/项目 MCP 都会被发现；不信任的仓库用 `--no-extensions` / `--trusted-extension` / `--config` 收窄。

### 3.2 settings 分层与优先级

settings 是 plain YAML mapping，每 key 的类型/默认/枚举来自 settings schema。有效值从低到高：

```text
schema 默认  <-  全局 config.yml  <-  项目 config  <-  PI_CONFIG_FILES overlay  <-  --config overlay  <-  运行时 override  <-  setting 环境变量
```

最高层是 settings schema 里**声明了 `env:` 的变量**（如 `PI_PY` → `eval.py`、`OMP_AUTH_BROKER_URL` → `auth.broker.url`）；未声明 `env:` 的变量才由各特性自读（§3.4）。

| 层 | 路径 | 写行为 |
|---|---|---|
| 全局 | `~/.omp/agent/config.yml`（兼容 `config.yaml`） | `/settings`、`omp config set/reset` 写这里 |
| 全局 legacy | `~/.omp/agent/settings.json` | 仅当两个 YAML 都不存在时迁移一次，之后不写 |
| 项目 | `<cwd>/.omp/config.yml`（+ `.omp/settings.json`） | 命令不写任意键；`modelRoleStorage: project` 时模型选择器只写 `modelRoles` |
| overlay | `--config <file>`（可重复）/ `PI_CONFIG_FILES` | 永不落盘 |
| 运行时 | `--model` `--approval-mode` … 与特性 env | 永不落盘 |

合并是**深合并**：对象递归合并（高层覆盖低层、低层独有 key 保留），标量与**数组整体替换**。最容易踩的坑是数组替换——项目 `disabledProviders: [groq]` 会**取代**全局 `disabledProviders: [anthropic, openai]`，而非追加。三条补充规则：配置里的 `null` 视为 unset（回落默认/低层）；runtime/overlay 层的 `null` record 条目可作 tombstone 遮蔽低层条目；**命名 model preset 整体替换**而非深合并。

### 3.3 `omp config` 命令

```bash
omp config list                # 全部设置+当前有效值（--json 机器可读，凭据字段脱敏）
omp config get theme.dark      # 单个值（显式单键请求，凭据不脱敏）
omp config set compaction.enabled false
omp config reset steeringMode  # 删掉全局 key，让更低配置层或 schema 默认生效（不是持久化一个默认值）
omp config path                # 打印活动 agent 目录（honors PI_CODING_AGENT_DIR）
omp config init-xdg            # 建 XDG data/state/cache 目录（不迁移已有文件）
```

`omp config set` 按目标 key 的 schema 类型解析值：值先 trim；bool 大小写不敏感、收 `true/false/yes/no/on/off/1/0`；enum 精确匹配；array/record 收 JSON；另有 number 类型（任意有限 JS 数，`Infinity`/`NaN` 拒绝）；string 收 bare 文本或 JSON-quoted 字符串（多词用空格连接）。

### 3.4 keybindings / .env / 环境变量

- **键位**：`~/.omp/agent/keybindings.yml`（§1.2）。named profile 会继承默认 profile 的键位文件再逐 action 覆盖（键位描述的是终端/键盘，不随 profile 变）。
- **`.env` 加载顺序**（`$env`）：进程环境 → 项目 `.env`（启动 cwd）→ `~/.omp/agent/.env` → `~/.omp/.env` → `~/.env`，**只对当前值为空的 key 生效**；每个 `.env` 文件内 `OMP_*` 自动镜像为 `PI_*` 别名并覆盖同文件 `PI_*` 值。
- **环境变量分两类**：settings schema 里声明了 `env:` 的变量（`PI_PY`→`eval.py` 等）是**最高配置层**（§3.2）；未声明的变量才由各特性自读（进程内覆盖/回退，永不写回 `config.yml`）。直接映射 settings 的：`PI_SMOL_MODEL`/`PI_SLOW_MODEL`/`PI_PLAN_MODEL`（→`modelRoles.*`）、`PI_NO_PTY=1`、`PI_PY=0`/`PI_JS=0`（禁用 eval 后端）、`PI_CODING_AGENT_DIR`（整体迁移 agent 目录，**仅默认 profile 生效**）、`PI_CONFIG_FILES`（overlay 路径表，`:` 分隔）。provider 密钥另走 `getEnvApiKey()`（存储凭据 → OAuth → `models.yml` → 环境 → `.env`）。

### 3.5 profile 隔离

`omp --profile <name>`（或 `OMP_PROFILE`/`PI_PROFILE`，`OMP_PROFILE` 优先）把 OMP 用户级根迁移到 `~/.omp/profiles/<name>/agent/`——auth/会话/设置/缓存/MCP 用户层全隔离；一个 profile 只看到自己的 OMP 配置，**从不**读默认 profile 的 agent 配置（键位是唯一例外，见上）。`--alias <command>` + `--profile` 生成该 profile 的 shell 快捷方式。项目级 `.omp/` 按 cwd 键控，跨 profile 共享。

### 3.6 常用配置示例

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  default: anthropic/claude-sonnet-4-5
  smol: openai/gpt-4.1-mini
  slow: anthropic/claude-opus-4-5:high      # 角色可带 :thinking 后缀
cycleOrder: [smol, default, slow]

defaultThinkingLevel: high
hideThinkingBlock: false

tools:
  approvalMode: write          # always-ask | always-ask-cached | write | yolo(默认)
  approval:
    bash: prompt
    eval: prompt               # 补上 eval，堵住 bash.patterns 的旁路

bash:
  patterns:
    - match: "git *"
      approval: allow
    - match: "rm -rf *"
      approval: deny
    - match: "*"
      approval: allow

retry:
  modelFallback: true
  fallbackChains:
    default: [anthropic/claude-opus-4-5, openai/gpt-5.5]

skills:
  enabled: true
  customDirectories: ["~/skills"]
  ignoredSkills: ["*-draft"]
  includeSkills: ["git-*"]
  enableSkillCommands: true

mcp:
  enableProjectConfig: true    # false = 排除所有项目级 MCP 源
```

`bash.patterns` 只作用于 `bash`；`deny`/`prompt` 规则按「整条命令**或任一单段**」（按 `&& || ; | &` 子壳/换行切分）匹配，`allow` 必须匹配整条且不覆盖复合行。同一命令走 `eval`（exec 档）在 yolo 下会绕过 `deny`——故需同时配 `tools.approval.eval`。`bash.allowCompoundCommands`（默认 false）开启后，纯字面量 `&&` 链可逐段按 `bash.patterns` 求值（任何段 `deny` 赢、否则 `prompt` 赢；未命中段回落 `tools.approval.bash` 与 approval mode），仅限识别出的 POSIX shell，重定向/变量/控制流等不参与。`always-ask-cached`（Ask and remember）在 `write` 基础上对**未被授权过的文件读**也询问，可整目录/单文件授权并跨会话记住（存 `approval-cache.db`；`/forget-approvals` 清除）。

---

## 4. 功能如何扩展

### 4.1 四种扩展面的边界（`skills.md` 权威口径）

| 面 | 是什么 | 谁调用 |
|---|---|---|
| **Skill** | 被动知识/工作流内容（`SKILL.md`） | 模型经 `skill://` 读、用户经 `/skill:` 注入 |
| **Custom tool** | 可执行工具 API（schema + `execute` + 副作用） | 模型 `tool call` |
| **Hook** | 事件驱动的运行时拦截器（可阻断/改写） | 运行时事件 |
| **Extension** | 以上三者的统一超集（事件 + 工具 + 命令 + 渲染器 + provider 注册） | 运行时 |

选型：要「模型直接调代码」→ custom tool；要「拦截/改写行为」→ hook；要「一个包同时拥有策略、工具、命令 UX、渲染」→ extension。

### 4.2 Extension（主路径）

一个 TS/JS 模块默认导出 factory，拿到 `ExtensionAPI`（`pi`）：

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const z = pi.zod;

  pi.on("tool_call", async (event) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf"))
      return { block: true, reason: "blocked by extension policy" };
  });

  pi.registerTool({
    name: "hello_ext",
    description: "Return a greeting",
    parameters: z.object({ name: z.string() }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      return { content: [{ type: "text", text: `Hello, ${params.name}` }] };
    },
  });

  pi.registerCommand("hello-ext", {
    description: "Show queue state",
    handler: async (_args, ctx) => ctx.ui.notify("ok", "info"),
  });
}
```

关键 API：`on(event, handler)`（事件面覆盖会话生命周期、prompt/turn 生命周期、工具生命周期 `tool_call`/`tool_result`、MCP `mcp_notification`、`user_bash`/`user_python` 拦截；另有 `input`（提交入口，可改写 text/images 或 `handled: true` 短路）、`assistant_message`（定稿后改写）、`session.compacting`、`before_subagent_spawn`（可换模型/`block`）、`tool_execution_start/update/end`、`tool_approval_requested/resolved`、`session_stop`（可 `{decision:"block"}` 拒停））；`registerTool`/`registerCommand`/`registerShortcut`/`registerFlag`/`registerMessageRenderer`/`registerAssistantThinkingRenderer`/`registerComposerShape`/`registerProvider`/`unregisterProvider`；`sendMessage`（`deliverAs: steer|followUp|nextTurn|aside` + `triggerTurn`）/`sendUserMessage`（`attribution: user|agent`）/`appendEntry`/`exec`；`registerFileWriteFallback`/`registerFileDeleteFallback`；以及 `setLabel`、`setModel`/`setThinkingLevel`/`setServiceTier`、`getActiveTools`/`setActiveTools`、`getSessionName`/`setSessionName` 与共享 `events` 事件总线。注入 `pi.zod`（Zod 兼容）/`pi.arktype`（omptype）/`pi.typebox`（legacy）。handler ctx 侧有 `runEphemeralTurn`（`/btw` 同款旁路问答，不进历史）、`invokeTool`（重注册内置名时委托原生实现）、`models`（list/current/resolve/family）、`annotations`（`/annotate` 编程 API）、`ctx.ui.openTerminal`（multiplexer 窗格启动）。

要点：

- **load 阶段只能注册**：调用 `pi.sendMessage()` 这类 action 方法会抛 `ExtensionRuntimeNotInitializedError`（例外：`pi.exec()` 在 load 阶段可用；provider 注册会排队到会话建立后生效）；先 register，运行时行为从事件/命令/工具里触发。
- **进程内无隔离**：裸 `setInterval`/`setTimeout`/detached promise 抛错会作为 `uncaughtException` 把整个会话干掉——用 `ctx.setInterval`/`ctx.setTimeout`（异常被隔离上报，会话继续），并在 `session_shutdown` 清理。
- **文件写/删回退缝**：`registerFileWriteFallback`/`registerFileDeleteFallback` 让宿主在沙箱拒绝直接写盘时通过特权通道完成 `write`/`edit`/`apply_patch` 落盘（含 hashline `MV`/`REM` 与 symlink 解析后的真实目标）。
- **持久状态**：`pi.appendEntry("com.example.my-extension.state", data)` 写进会话 custom entry，`session_start`/`session_branch`/`session_tree` 时从 `ctx.sessionManager.getBranch()` 重建。

### 4.3 Custom tools

模块默认导出 factory，返回一个或一组 tool：

```ts
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";

const factory: CustomToolFactory = (pi) => ({
  name: "repo_stats",
  description: "Count tracked TypeScript files",
  parameters: pi.zod.object({ glob: pi.zod.string().optional() }),
  async execute(_id, params, onUpdate, _ctx, signal) {
    onUpdate?.({ content: [{ type: "text", text: "Scanning..." }] });
    const r = await pi.exec("git", ["ls-files", params.glob ?? "**/*.ts"], { signal, cwd: pi.cwd });
    if (r.code !== 0) throw new Error(r.stderr || "failed");
    return { content: [{ type: "text", text: `found ${r.stdout.split("\n").length - 1}` }] };
  },
});
export default factory;
```

工具名必须全局唯一（与内置、已加载自定义冲突即拒）；`execute(toolCallId, params, onUpdate, ctx, signal)` 里 `onUpdate` 流式部分结果、`signal` 透传给 `pi.exec` 协作取消。发现位置：`~/.omp/agent/tools`、`.omp/tools`、插件 manifest 与显式路径；外来目录（`~/.claude/tools`、`.claude/tools`、`.codex/tools` 等）**项目级默认可发现、用户级需 `enabledProviders` opt-in**（与 slash 命令同源策略）；`.md`/`.json` 只当元数据，不做可执行模块。长运行工具可用 `pushPendingAction(action)` 暂存预览，经向 `xd://resolve`/`xd://reject` 写纯文本来定稿；开启 `tools.xdev` 时 discoverable 自定义工具挂载为 `xd://<tool>` 而非顶层函数。

### 4.4 Hooks（legacy，仍可加载）

独立旧事件 API（`@oh-my-pi/pi-coding-agent/extensibility/hooks` 子路径，根包不 re-export `HookAPI`）。默认 CLI 运行时把 `--hook` 当 `--extension` 别名，并把 `hookCapability` 发现的 `.ts/.js` hook factory 经 extension runner 加载。事件面同 §4.2，`tool_call` 可 `{ block }` 或改写 `input`（`computer` 工具除外），`tool_result` 可改写 `content/details`（extension runner 路径还应用 `isError` 补丁；legacy `HookToolWrapper` 库路径不应用），`context` 链式改写模型消息。

### 4.5 发现位置与加载顺序

扩展模块的发现顺序（`extension-loading.md`）：

1. **native 自动发现**：`<cwd>/.omp/extensions`、`~/.omp/agent/extensions`（+ legacy `settings.json#extensions`）
2. **JS/TS hook factory**（hook capability 里的 `.ts/.js` 项）
3. **已安装插件的 `omp.extensions`/`pi.extensions` manifest**
4. **显式配置路径**：`-e/--extension`、`--hook`、settings `extensions` 数组

绝对路径去重，first-seen 生效。目录解析顺序：`package.json#omp.extensions` → `index.ts` → `index.js` → 单层扫描。`disabledExtensions` 按 id（`extension-module:<name>`、`skill:<name>`、`context-file:<level>:<basename>`）过滤。加载控制面：`--trusted-extension <abs-file>` 是精确模块白名单（可重复、与 `-e`/`--hook` 互斥、任一加载失败即中止启动）；`--no-extensions` 是 explicit-only 语义（显式 `-e`/`--hook` 仍加载）；显式文件与插件 manifest 条目支持 `.mjs`/`.cjs`（目录自动扫描仅 `.ts`/`.js`）；主会话内改 `extensions`/`disabledExtensions` 可挂起/恢复已加载源。

### 4.6 Marketplace / 插件

兼容 Claude Code 插件注册表格式（`.omp-plugin/marketplace.json` 优先，`.claude-plugin/marketplace.json` 回退）：

```
/marketplace add anthropics/claude-plugins-official
/marketplace install wordpress.com@claude-plugins-official
```

一个插件可携带 skills/commands/agents/rules/hooks/tools/MCP servers/LSP servers（`lspServers` → `.lsp.json`、`dapAdapters` → `.dap.json`）。作用域 user（默认，`~/.omp/plugins/`）/project（cwd 向上最近含 `.omp/` 的祖先目录，无则最近 Git 根）；project 启用项遮蔽 user 同名项。CLI 等价：`omp plugin install/list/marketplace …`；除市场外还有 npm/git 包与 `omp plugin link` 本地链接路径，以及 `omp plugin enable/disable/upgrade/doctor`、`marketplace.autoUpdate: off|notify|auto`。会话内 `/plugins enable|disable` **立即刷新** skills/commands/task agents/MCP；install/uninstall/upgrade 等市场操作需 `/reload-plugins`，且新装非 MCP 工具/hook/扩展模块需重启会话。

### 4.7 其它扩展点

- **注册 provider**：`pi.registerProvider(name, config)`（含可选 `usage.fetchUsage` 供 `omp usage` 集成）；还可给命令式 provider 提供自有 `api` 字符串 + `streamSimple`，把本地 CLI/stdio 进程当模型后端（非 HTTP 传输）。
- **LSP / DAP**：LSP server 配置接进每次写操作与调试（`lsp-config.md`）；debug 工具驱动真实 lldb/dlv/debugpy。
- **`xd://` 可发现设备**：自定义设备以 `xd://<tool>` 形态注册，`write` JSON 调用（`read xd://` 列出）。
- **Composer Shape**：`registerComposerShape` 给输入区加自定义布局（Appearance → Composer Shape）。
- **系统提示定制**：`SYSTEM.md`/`APPEND_SYSTEM.md`/`RULES.md`/`AGENTS.md`（§5.3）；另有 `SYSTEM_TEMPLATE.md`（Handlebars 模板路线，同 scope 内字面量 `SYSTEM.md` 优先）、`TITLE_SYSTEM.md`（自动会话命名）、`PERSONALITY.md`（人格块）。

---

## 5. Skills、MCP 与「等等」

### 5.1 Skills：安装、发现、使用

Skill 是**文件背书的被动能力包**：一个目录 + 一个 `SKILL.md`，启动时发现为「name + description」轻量元数据注入系统提示，正文按需经 `read skill://<name>` 或 `/skill:<name>` 拉取。

布局（provider loader **非递归**，只认一层）：

```text
<skills-root>/
  ├─ postgres/SKILL.md    ✅
  ├─ pdf/SKILL.md         ✅
  └─ team/internal/SKILL.md  ❌（嵌套不发现；指向嵌套父目录可救）
```

`SKILL.md` frontmatter：`name`（默认目录名）、`description`（native/omp-plugins/github/customDirectories 来源**必填**）、`globs`、`alwaysApply`、`hide`（隐藏但不禁用，仍可 `skill://` 直达）、`disableModelInvocation`、`enabled: false`（常规扫描器与 Skillshare 直接跳过该 skill）。

发现优先级（first-wins 按名去重）：

```
native(.omp/skills, 100) → skillshare(95，skills.lock.json 锁定的注册包)
→ omp-plugins(90) → claude(80) → agent-plugins(75，plugin.json 便携包)
→ {claude-plugins, agents(.agent[s]/skills), codex}(70) → opencode(55)
→ github(.github/skills, 30) → omp-managed(auto-learn, 5)
```

同名冲突可命名空间化共存：内容不同的同名 skill 以 `<namespace>/<name>` 注册（插件名/包名作 namespace，占用再加 `~2`/`~3`），可经 `skill://<namespace>/<name>`、`/skill:<namespace>/<name>` 直达；raw name 含 `/`、`\` 被拒。

安装方式（按推荐度）：

1. `.omp/skills/<name>/SKILL.md`（项目）或 `~/.omp/agent/skills/<name>/SKILL.md`（用户）——native，优先级最高。
2. `.agent[s]/skills/<name>/SKILL.md`——OMP 规范位置，独立 `enableAgentsUser/Project` 开关（关掉 claude/codex/pi 不会关它）。
3. 直接复用第三方目录：`~/.claude/skills`、`~/.codex/skills`、Agent Skills、opencode、`.github/skills/`——零迁移。
4. `skills.customDirectories: ["~/skills"]`——任意 `*/SKILL.md` 目录。
5. 经插件/市场携带 `skills/`。
6. `omp skill install/search/publish`——skills.omp.sh 注册中心分发，`skills.lock.json` 固定（对应 skillshare 层）。

使用：`read skill://<name>`（`skill://<name>/references/foo.md` 读附带资产，`..` 越界与绝对路径被拒）；本地未命中时回退到 MCP server 以该 URI 发布的资源。`/skill:<name> [args]` 注入正文（嵌入 prose 中的 `/skill:<name>` token 会被剥离并把周围文字当参数）。`/skill:` 的投递模式由**提交键**决定：`Enter` → steer 队列，`Ctrl+Q`/`Ctrl+Enter` → followUp 队列（与自由文本流式路由一致，无独立开关）。开启 `autolearn.enabled: true` 后，模型可用 `manage_skill` 工具 create/update/delete 托管 skill（写 `<agent-dir>/managed-skills/<name>/SKILL.md`，≤64KB）。

### 5.2 MCP：配置、传输、认证、排错

**配置位置**（OMP native）：

- 项目（推荐）：`.omp/mcp.json`
- 用户：`~/.omp/agent/mcp.json`（profile 生效时 `~/.omp/profiles/<name>/agent/mcp.json`）
- 便携回退：项目根 `mcp.json` / `.mcp.json`

文件顶部加 `$schema` 得编辑器补全校验。**三种传输**：

```jsonc
// stdio（默认，省略 type 即 stdio）
{ "mcpServers": { "filesystem": {
  "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/abs/path"] } } }

// http（Streamable HTTP，新 server 推荐）
{ "mcpServers": { "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/" } } }

// sse（旧式，兼容）
{ "mcpServers": { "legacy": { "type": "sse", "url": "https://example.com/mcp/sse" } } }
```

共享字段：`enabled`、`timeout`（ms，`0` 禁用客户端超时；`OMP_MCP_TIMEOUT_MS` 进程级优先）、`requestIdFormat`、`instructions`（默认 `true`；设 `false` 不把该 server 的 instructions 注入系统提示而不禁用工具，仅 OMP 原生文件生效）、`auth`、`oauth`。

**发现与优先级**：omp 原生读 Claude Code / Codex / Gemini CLI / OpenCode / Cursor / Windsurf / VS Code / 插件里的 MCP 配置，first-wins 不合并。OMP native → OMP 扩展包 → Claude Code → Agent Plugins → Claude 市场插件/Codex → Gemini → OpenCode → Cursor/Windsurf → VS Code → 根 `mcp.json` 回退。

**认证与 secret**：

- **OAuth**（`http`/`sse` 远程）：`oauth` 块覆盖 clientId/clientSecret/redirectUri/callbackPort；走完 OAuth 凭据存 `mcp_oauth:profile:<profile>:<url>`——项目里**只提交定义不带凭据**，各 profile 各自 `/mcp reauth` 授权。
- **secrets 解析**：`${VAR}` / `${VAR:-default}` 发现期递归展开；预连接时 `env`/`headers` 值以 `!` 开头则当 shell 命令执行（10s 超时、进程级缓存，失败后 30s 重试退避，最终失败/空输出则该条目被**省略**而非传字面量），否则整值为环境变量名则取环境值，否则字面量。典型写法 `"GITHUB_PERSONAL_ACCESS_TOKEN": "GITHUB_PERSONAL_ACCESS_TOKEN"`。

**命令与排错**：

```text
/mcp add          引导式添加        /mcp list         看每个 server 来自哪个文件
/mcp reload       重新发现+重连     /mcp test <n>     测单个
/mcp reauth <n>   替换 OAuth 凭据    /mcp unauth <n>   移除凭据
/mcp reconnect <n> 单 server 重连    /mcp enable|disable <n>  启用/停用（OMP 文件改 enabled；第三方源写用户级 allow/denylist）
/mcp resources|prompts|notifications  非工具能力
```

校验规则（`validateServerConfig`）：stdio 必填 `command`；http/sse 必填 `url`；`command` 与 `url` 互斥；未知 `type` 拒绝。高频坑：同时写 `command` 和 `url` 报「二选一」；远程 server 建议显式 `"type": "http"`——发现阶段对仅含 `url` 的条目会**自动推断 http**，但直接交给 writer/client 的配置要求显式 type。用户级 `disabledServers`（最高黑名单）/`enabledServers`（强制启用 `enabled:false` 同名项）跨源覆盖；`mcp.enableProjectConfig: false` 可排除全部项目级来源（含第三方 `.claude/` 等），让同名用户级条目生效。

运行时模型（`mcp-runtime-lifecycle.md`）：启动 250ms 快启 gate，慢 server 不阻塞（可配 `mcp.startupTimeoutMs`/`OMP_MCP_STARTUP_TIMEOUT_MS`，`0`=等首批连接落定；print 模式另有就绪屏障，默认 30s，`OMP_MCP_REQUIRE_READY=1` 未就绪即 exit 1）；stdio 进程退出/流关闭→pending 请求 `Transport closed`，manager 用 backoff（500/1000/2000/4000ms）自动重连，30s 内超 5 次触发熔断（手动 `/mcp reconnect` 复位）；熔断阶梯失败后，**曾连上过的** HTTP/SSE server 还会以 15s 起翻倍至 5 分钟间隔持续探测直至恢复（stdio 与从未连上的远程不参与）；工具名 `mcp__<server>_<tool>`（小写、字母下划线清洗）。内置 browser 工具可用时，识别出的浏览器自动化 MCP server（playwright/puppeteer/browserbase 等）会被静默丢弃，需 `browser.enabled: false` 才能用这类 MCP。

### 5.3 「等等」：上下文文件、models、主题、记忆、本地模型、LSP/DAP

- **上下文文件（AGENTS.md）**：`AGENTS.md`、`.omp/AGENTS.md`、`SYSTEM.md`、`APPEND_SYSTEM.md`、`RULES.md`（`RULES.md` 变 always-apply 粘性规则）、`rules/*.{md,mdc}`、`instructions/*.md`、`prompts/*.md`——按 user/project 合并进模型上下文；ancestor 深度合并只适用于 standalone `AGENTS.md` 等 walk-up 文件，**native 项目级是「最近非空 `.omp/` 独占」**（找到最近非空 `.omp/` 即停，缺文件不继续向父级找）。`contextFiles.extra` 可加任意额外 basename（如 `AGENTS.local.md`）按 agents-md 规则发现；`disabledExtensions` 用 `context-file:<level>:<basename>` 精确禁用。advisor 专用另有两个文件（§2.6）：`WATCHDOG.md`（评审关注点，不进主 agent 上下文）与 `WATCHDOG.yml`（多评审者名册）。
- **models.yml**：自定义模型与 provider 定义（`.yml/.yaml/.json/.jsonc`，自动 JSON→YAML 迁移）。chat 角色 `default/smol/slow/vision/plan/commit/tiny/memory/task/advisor`，角色值可带 `:minimal…:max` thinking 后缀、**逗号分隔多选择器**（取第一个可用）与 `@role` 别名（`@smol` 等，`*`=`@default`）；另有 model-kind 角色 `image/web/speech/dictation/judge`（auto 思维档实际走 `judge` 角色）。
- **主题**：`theme.dark`/`theme.light`；`/settings` Appearance 面板或 `omp config set theme.dark titanium`。
- **记忆**：后端 `off`/`local`/`hindsight`/`mnemopi`/`sharpshooter`（免服务器，维护 `architecture.md`/`product.md`/`style.md` 三个项目决策文件并注入系统提示）。工具**按后端而异**：local 只有 `learn`（无 recall/retain/reflect/memory_edit）；hindsight 无 `memory_edit`；mnemopi 有全套四件 + `learn`。管理入口 `/memory`（view/stats/diagnose/queue/sync/clear…）与 `memory://root`、`memory://<memory-id>` 读取 URL。mnemopi 细项：`mnemopi.scoping`（global/per-project/per-project-tagged）、`polyphonicRecall`/`proactiveLinking`/`enhancedRecall` 开关。
- **本地模型**：`omp tiny-models` 下载 1B–1.7B 级模型做标题/记忆/auto 思维档三件小任务；`PI_TINY_DEVICE`/`PI_TINY_DTYPE` 控制 ONNX 执行（`PI_TINY_DEVICE=mlx` 启用 Apple silicon MLX 后端，此时 `PI_TINY_DTYPE` 被忽略）。另有 `omp setup speech` 与 speech/dictation 本地角色（kokoro TTS、whisper/parakeet/nemotron STT）。
- **LSP / DAP**：LSP server 配置、DAP adapter（`lspServers`/`dapAdapters` 插件字段或 `.lsp.json`/`.dap.json`）。

### 5.4 一个「端到端配好」的最小工作流

```bash
# 1. 建全局配置（授权分级 + 角色路由 + 回退链）
mkdir -p ~/.omp/agent
# 编辑 ~/.omp/agent/config.yml（§3.6 示例）

# 2. 项目放 skill 与 MCP 定义（凭据不进仓库）
mkdir -p .omp/skills/deploy .omp
# .omp/skills/deploy/SKILL.md   —— name+description 写清触发场景
# .omp/mcp.json                 —— 只放定义，凭据各 profile /mcp reauth

# 3. 启动（plan-yolo 控成本，规划用便宜模型、落地切主力）
omp --plan-yolo "重构 src/api 的错误处理"

# 4. 会话内
#    /model 换模型 · Ctrl+P 循环 · Alt+A 看子 agent
#    /fork 分叉不确定方向 · /export 或 /share 产出
```

---

## 参考文献

1. 仓库内 harness 文档（`docs/*.md`，即 `omp://` 一手事实，v18.12.3）：`cli-reference.md`、`keybindings.md`、`tui.md`、`agent-hub.md`、`slash-command-internals.md`、`magic-keywords.md`、`session.md`、`session-operations-export-share-fork-resume.md`、`session-switching-and-recent-listing.md`、`config-usage.md`、`settings.md`、`environment-variables.md`、`approval-mode.md`、`extensions.md`、`extension-loading.md`、`hooks.md`、`custom-tools.md`、`marketplace.md`、`plugin-manager-installer-plumbing.md`、`skills.md`、`mcp-config.md`、`mcp-protocol-transports.md`、`mcp-runtime-lifecycle.md`、`mcp-server-tool-authoring.md`、`context-files.md`、`system-prompt-customization.md`、`models.md`、`prewalk.md`、`vibe-mode.md`、`advisor-watchdog.md`、`memory.md`、`mnemosyne-memory-backend.md`、`local-models.md`、`python-repl.md`、`tree.md`。
2. Oh My Pi 仓库：https://github.com/can1357/oh-my-pi
3. omp 官网与文档：https://omp.sh
4. 姊妹篇 report 17：Oh My Pi 研究报告（定位/架构/竞品全景）。
