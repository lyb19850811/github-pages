---
title: Agent Skills 研究综述
date: 2026-10-16
tags: [agents, skills, llm]
summary: 梳理 Agent Skills 的产生背景、渐进式披露原理、SKILL.md 格式规范、编写最佳实践、生态案例与发展趋势。
---

**Agent Skills（下文简称 Skills）** 是把「指令 + 脚本 + 资源」打包成文件夹，让智能体按需发现、按需加载、按需执行的一种能力封装格式。它由 Anthropic 于 2025-10-16 随 Claude 发布，同年 12-18 以开放标准形式公开。本文从背景、原理、实践、案例、趋势五个维度做综述。

## 一、产生背景

随着 Claude Code 这类通用智能体可以在完整计算环境（本地代码执行、文件系统）中完成跨领域任务，一个结构性问题浮出水面：**模型能力很强，但真实工作依赖过程性知识与组织上下文**——某个团队特有的 API 用法、表单填写规范、品牌准则、故障恢复流程，这些不在模型的训练分布里，也无法靠一次对话交代清楚。

在此之前，向智能体注入这类知识主要有三种做法，各有短板：

- **写进 system prompt**：把所有规则堆进系统提示，随会话常驻。上下文随技能数量线性膨胀，无法组合、无法复用、无法版本化，且每个场景都要重写。
- **为每个场景定制一个 agent**：为 Excel 造一个、为 PPT 造一个。碎片化，维护成本随场景数爆炸。
- **MCP 服务器**：解决「接入外部工具」，但不解决「教会智能体一套工作流」。它暴露的是工具能力，不是过程性知识。

Skills 的定位是类比新员工 onboarding 手册：把专家经验打包成可组合、可移植、按需加载的资源，把「通用智能体」在运行时特化成「专用智能体」。此外还有一条动机：很多操作（排序、解析 PDF 表单字段）用确定性代码远比 token 生成可靠、廉价，Skills 允许打包可执行代码。

## 二、原理

### 渐进式披露（progressive disclosure）

这是 Skills 最核心的设计原则。智能体不把整个技能读进上下文，而是分三层按需加载：

| 层级 | 内容 | 何时加载 | 量级 |
| --- | --- | --- | --- |
| 元数据 | `name` + `description` | 启动时全部加载进系统提示 | ~100 tokens/技能 |
| 正文 | `SKILL.md` 全文 | 判定相关后加载 | 推荐 < 5000 tokens |
| 资源 | `scripts/`、`references/`、`assets/` 中的文件 | 仅当任务需要时按名引用 | 按需，理论上无界 |

于是上下文成本只与「被激活的内容」相关，而非技能库总量：

$$
C_{\text{loaded}} = \underbrace{\sum_{\text{all}} T_{\text{meta}}}_{\text{启动即付}} + \underbrace{\sum_{\text{active}} T_{\text{body}}}_{\text{按需付}} + \underbrace{\sum_{\text{on-demand}} T_{\text{resource}}}_{\text{更深层按需付}}
$$

因为智能体有文件系统与代码执行能力，`SKILL.md` 不必一次性读完，技能目录里可打包的上下文量实际上是**无界**的。这像一本手册：目录 → 章节 → 附录。

**触发与加载序列**（据 Anthropic 工程博客）：

1. 上下文窗口初始为「核心系统提示 + 所有技能元数据 + 用户消息」；
2. 智能体判断某技能相关，调用 Bash 读入该技能的 `SKILL.md`；
3. 若正文引用 `forms.md` 等子文件，再按需读入；
4. 带着已加载的指令继续执行任务。

### 目录结构与 SKILL.md 格式

一个技能是包含 `SKILL.md` 的目录：

```
skill-name/
├── SKILL.md          # 必需：元数据 + 指令
├── scripts/          # 可选：可执行代码
├── references/       # 可选：文档（按需加载）
├── assets/           # 可选：模板、静态资源
└── ...
```

`SKILL.md` 以 YAML frontmatter 开头，后接 Markdown 正文。关键字段：

| 字段 | 必需 | 约束 |
| --- | --- | --- |
| `name` | 是 | ≤64 字符，小写字母/数字/连字符，不得首尾连字符或双连字符，须与目录名一致 |
| `description` | 是 | ≤1024 字符，描述「做什么 + 何时用」，是触发的唯一依据 |
| `license` | 否 | 许可证名或捆绑的许可证文件 |
| `compatibility` | 否 | ≤500 字符，环境要求（产品、系统包、网络等） |
| `metadata` | 否 | 任意字符串键值对 |
| `allowed-tools` | 否 | 预批准工具（空格分隔，实验性） |

### 代码执行

Skills 可以捆绑脚本供智能体按需执行。举例：PDF 技能里预写一个读取 PDF 并抽取全部表单字段的 Python 脚本，智能体运行它时**无需把脚本或 PDF 本身读进上下文**，且代码是确定性的，可重复、可预期。这解决了两类问题：token 生成的效率劣势，以及需要确定性保证的场景。

### 与 MCP / system prompt 的关系

三者互补而非替代：system prompt 放全局恒定规则；MCP 提供外部工具接入；Skills 教「围绕工具的复杂工作流」与领域过程知识。Anthropic 明确把 Skills 定位为对 MCP 的补充——MCP 把工具接进来，Skills 教会智能体怎么用这些工具完成任务。

## 三、最佳实践

以下要点综合自开放标准的 skill-creation 文档与 Anthropic 工程博客。

1. **从真实经验出发，而非让 LLM 凭空生成**。让 LLM 仅凭通用知识写技能，产出的是「妥善处理错误」这类空话。有效做法是：先与智能体完成一个真实任务，把「奏效的步骤、你的纠正、输入输出格式、你补充的上下文」提炼成技能；或从内部文档、runbook、schema、code review 记录、git 历史中综合。

2. **精打细算上下文**。只写智能体「不知道会做错」的内容，省略它已知的常识。判断标准：删掉这句，它会做错吗？不会就删。

3. **校准控制力**。按任务脆弱度匹配 specificity：容错高的地方给自由度并解释原因；脆弱、需严格顺序的地方给死指令（如「照此命令执行，不要加参数」）。多选项时给默认值而非菜单。

4. **善用结构模式**：gotchas 清单（环境特定、违反直觉的事实，是最高价值内容）；输出模板（比散文描述可靠）；checklist（多步流程）；验证循环（做 → 跑校验脚本 → 修 → 重复）；plan-validate-execute（批量/破坏性操作先出中间计划再校验再执行）；把反复重写的逻辑固化成 `scripts/` 里的脚本。

5. **description 是触发的命门**。用触发率评估（~20 条 should/should-not 查询 × 3 次运行）验证，并做 train/validation 切分避免过拟合。原则：祈使句（「Use this skill when…」）、面向用户意图而非实现细节、宁可 pushy、保持简洁。

6. **eval 驱动迭代**。对每个测试用例跑「有技能 / 无技能」双配置对比，写断言并打分，记录 tokens 与耗时算 delta——质量提升多少、成本多少，是否划算。失败断言 + 人工反馈 + 执行轨迹三路信号回灌到技能修订。

7. **安全**。Skills 会引入指令与代码执行，恶意技能可能渗漏数据或诱导越权操作。只从可信来源安装；来自低信任来源时先审计其代码、依赖、网络连接指令。

## 四、优秀案例

- **Anthropic 官方 document-skills**：PDF/Excel/PPT/Word/表单填写系列。以 PDF 技能为例，`SKILL.md` 正文保持精简，把表单填写说明拆到 `forms.md`、参考拆到 `reference.md`，配合预写脚本抽取表单字段——是渐进式披露的教科书式结构。

- **skill-creator**：一个「元技能」，用交互式提问引导 Claude 生成技能目录、格式化 `SKILL.md`、打包资源，还能自动跑 description 触发率评估并产出 HTML 报告——把「写技能」本身也变成技能。

- **生态采用（跨平台开放标准）**：截至 2026 年，agentskills.io 客户端名单已覆盖 40+ 产品——Claude Code、Gemini CLI、Cursor、GitHub Copilot、VS Code、OpenAI Codex、OpenCode、OpenHands、Goose、JetBrains Junie、Spring AI、Databricks Genie Code、Letta、Laravel Boost 等，格式一次编写多处可用。

- **企业落地**：Rakuten 用 Skills 把管理会计与财务流程（多表处理、异常捕获、按规程生成报告）从「一天」压到「一小时」；Box 用它教 Claude 按组织标准把存储文件转成 PPT/Excel/Word；Canva、Notion 亦作为首批合作伙伴接入。

## 五、发展趋势

1. **从专有功能走向开放标准**。2025-12-18 公开 agentskills.io 规范，目标是跨平台可移植（build once, use everywhere），正被多个非 Anthropic 产品实现——这是与早期闭源「插件」形态最本质的分野。

2. **组织级分发与治理**。组织范围管理、partner 技能目录（connectors）、`/v1/skills` 端点提供程序化的版本创建与管理，呼应「企业级部署」路线。

3. **智能体自创、自评技能**。官方明确的方向是让 agent 自行创建、编辑、评估 Skills，把自己的行为模式固化为可复用能力——「能力工程」的自举。

4. **与 MCP 深度融合**，形成「MCP 接工具、Skills 教工作流」的分层能力栈。

5. **安全与信任边界成为关键约束**。代码执行能力越强，可信来源、审计、权限边界（`allowed-tools` 等实验字段）就越重要，这将是标准演进的持续议题。

一句话总结：Skills 用「文件夹 + 渐进式披露」这个朴素载体，把智能体的能力从「提示词工程」推进到「能力工程」——可组合、可移植、可版本化、可被 eval 度量，是 2025–2026 智能体基础设施最重要的形态之一。

## 参考

- [Introducing Agent Skills (Anthropic, 2025-10-16)](https://www.anthropic.com/news/skills)
- [Equipping agents for the real world with Agent Skills (Anthropic Engineering)](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Agent Skills 开放标准规范](https://agentskills.io/specification)
- [Best practices for skill creators](https://agentskills.io/skill-creation/best-practices)
- [Optimizing skill descriptions](https://agentskills.io/skill-creation/optimizing-descriptions)
- [Evaluating skill output quality](https://agentskills.io/skill-creation/evaluating-skills)
- [anthropics/skills 官方技能仓库](https://github.com/anthropics/skills)
- [Model Context Protocol](https://modelcontextprotocol.io/)
