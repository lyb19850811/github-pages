---
report: 79
title: 本体（Ontology）深度研究
date: 2026-11-12
tags: [ontology, knowledge-graph, semantic-web, rdf, owl, description-logic, knowledge-representation]
summary: 系统梳理计算机/AI 知识本体的定义谱系（Gruber 1993→Borst→Studer et al. 1998）、形式基础（描述逻辑/RDF/OWL 语义）、本体工程方法学（METHONTOLOGY/OntoClean/能力问题）、顶层本体（Cyc/SUMO/DOLCE/BFO）与应用（Gene Ontology/OBO Foundry/知识图谱），并辨析知识图谱定义之争与 LLM 时代本体的重新定位。
---

## 结论先行

1. **本质**：计算机本体是把某一领域**共享概念化**写成**带形式语义的显式规约**——Gruber 定义 + Guarino 的术语澄清 + 描述逻辑（DL）语义，三者合流。
2. **定义谱系**：Gruber (1993)「explicit specification of a conceptualization」→ Borst (1997) 加「formal/shared」→ Studer et al. (1998) 融合为「formal, explicit specification of a shared conceptualization」。关键澄清：conceptualization（语义层）≠ ontology（逻辑理论层）。
3. **形式基础**：OWL DL = $\mathcal{SHOIN}(D)$，OWL 2 DL = $\mathcal{SROIQ}(D)$（N2ExpTime-完全）；开放世界假设是本体推理区别于数据库的关键。
4. **方法学**：METHONTOLOGY 生命周期 + OntoClean 元性质（rigidity/identity/unity/dependence）+ 能力问题（competency questions）。
5. **顶层本体**：实在论（BFO）vs 描述论（DOLCE）的对立，是「本体是设计制品还是对实在的刻画」这一哲学分歧的工程体现，且无唯一正确答案。
6. **应用实证链**：Gene Ontology（三正交子本体）→ OBO Foundry（BFO 对齐 + 治理原则）→ SNOMED CT（OWL 2 EL）→ 语义网/知识图谱。
7. **两大贯穿张力**：表达力 vs 推理可扩展性（工程取舍）；设计制品 vs 实在刻画（哲学分歧）。

---

## 1. 引言与写作约定

> 面向有技术/哲学背景读者的学术严谨综述。本文区分原始文献（一手）与二手综述；凡陈述必有出处，凡有争议必标明。术语首次出现给出英文原文。

「本体」（Ontology）一词在计算机科学中的用法与哲学中的「本体论」有同源关系，但含义已发生实质偏移。本报告聚焦信息科学/人工智能意义上的 ontology，即**对某一领域共享概念化的形式化、显式规约**（见第 2 节），同时追溯其哲学渊源，因为不理解后者的范畴论（substance/accident、universal/particular、identity、part-whole）就无法理解现代本体工程中的关键分歧（见第 6、8 节）。

三点写作约定：

1. **"ontology" 的翻译**：中文文献常译「本体」「本体论」「知识本体」「实体论」。本文统一用「本体」指代计算机科学意义上的 ontology 这一**人造工程制品**（artifact），用「本体论」指代哲学学科。这一区分本身正是 Guarino 与 Giaretta 1995 年论文的核心关切 \[2\]。
2. **一手 vs 二手**：定义、公理、设计准则等核心论断优先引用原作者原始论文；教科书式归纳（如「OWL 的复杂度为 X」）引用 The Description Logic Handbook \[8\] 或 W3C 规范 \[10\] 而非博文。
3. **争议标注**：凡学界对某术语定义无共识（最典型者即「ontology」与「knowledge graph」本身的定义），显式标明「存在分歧」，不给出伪精确的唯一答案。

## 2. 定义与概念辨析

### 2.1 经典定义的谱系

计算机本体最广为引用的定义形成于 1990 年代，历经三次递进修订：

| 出处 | 定义原文 | 关键增补 |
|---|---|---|
| Gruber (1993) \[1\] | "An ontology is an **explicit specification of a conceptualization**." | 首次把 ontology 定位为**共享知识的设计制品**，并提出设计准则 |
| Borst (1997) \[4\] | "A **formal specification** of a shared conceptualization." | 加入「formal」与「shared」 |
| Studer, Benjamins & Fensel (1998) \[3\] | "An ontology is a **formal, explicit specification of a shared conceptualization**." | 融合前两者，成为最常引用的「标准表述」 |

这一「explicit specification of a conceptualization」的定义有三处需要澄清，否则会严重误解本体是什么：

- **conceptualization（概念化）**：指一个世界的**意向性语义结构**——把相关实体及其关系抽象出来的方式。Gruber 原文借自 Genesereth 与 Nilsson 的「本体承诺（ontological commitment）」传统 \[1\]。
- **explicit（显式）**：概念化本是**认知层面**的、可以存在于人脑或共同体习惯中而**不显式存在**的东西；ontology 则是把它**用某种语言写出来**的结果。
- **specification（规约）**：本体不是对世界的「真实描述」，而是对术语用法的**约定/承诺**——它规定了「当我们用 `City` 这个词时，我们指的是什么」。

### 2.2 Guarino 与 Giaretta 的术语澄清（关键文献）

1995 年 Guarino 与 Giaretta 在 *Towards Very Large Knowledge Bases* 中撰文《Ontologies and Knowledge Bases: Towards a Terminological Clarification》\[2\]，指出「ontology」一词在知识表示社群中被**歧义地**用于指称至少两个不同层次的东西：

1. **conceptualization（概念化）**：一种**非语言**的、独立于任何特定词汇的语义结构，可看作对某域的可能世界结构 $\langle D, \mathcal{R} \rangle$（域 $D$ 与 $D$ 上的关系族 $\mathcal{R}$）。
2. **ontological commitment（本体承诺）**：一个语言/逻辑理论**对某一 conceptualization 的承诺**，即该理论的预期模型（intended models）所对应概念化的程度。
3. **ontology（本体）**：一个**逻辑理论**（通常为一阶公理集），其**预期模型**构成对某一 conceptualization 的刻画。

这一区分（conceptualization 是语义层、ontology 是句法/逻辑层）是后来所有形式本体工作的基石。Guarino 后来（1998, *Formal Ontology and Information Systems*）进一步把本体按其**通用性**划分为多个层次，构成「本体谱系（ontology spectrum）」：

```
顶层本体 (top-level / upper ontology)   —— 最通用：对象、事件、性质、时间、空间
  ├─ 领域本体 (domain ontology)        —— 医学、法律、生物
  ├─ 任务本体 (task ontology)          —— 诊断、规划、销售
  └─ 应用本体 (application ontology)   —— 最专用：某具体系统
```

这一分层对理解第 6 节的顶层本体为何存在、以及第 8 节的「轻/重量级」之争，都是必要前提。

### 2.3 易混淆术语的边界

学术严谨要求把 ontology 与相邻概念区分清楚，这是后续所有讨论（尤其是知识图谱争议，见 8.1）的起点：

- **Taxonomy（分类体系）**：仅含**子类层级**（is-a 关系）。本体**至少**包含分类关系，但通常还含非分类关系、属性约束、公理。
- **Controlled vocabulary（受控词表）**：一组术语 + 同义/层级关系，**无形式公理**，通常不承诺形式语义。Gene Ontology 早期即是「dynamic controlled vocabulary」\[17\]（其论文标题自述），后逐步形式化为本体——这个演变本身就是术语漂移的实证。
- **Thesaurus（叙词表）**：如 WordNet，提供同义、上下位、反义等**词汇层**关系，但不作形式化公理刻画。SUMO 与 WordNet 的映射工作（6.2）正体现了「词汇资源 ≠ 本体」。
- **Knowledge base（知识库）**：本体 + **实例（individuals/ABox）**。OWL 中区分 TBox（术语层）与 ABox（断言层）\[10\]。Hogan et al. 用更精确的现代语言重述了这一区分 \[20\]。
- **Knowledge graph（知识图谱）**：见 8.1，其定义至今「remain contentious」\[20\]，关键分歧在于它是否**必须**带本体/模式层。

> **要点**：一个可判定的形式化层级递进是：`词表 ⊂ 分类体系 ⊂ 本体(含公理) ⊂ 知识库(含实例)`。这个递进不是严格数学包含关系，而是**表达能力与语义承诺**的单调增强。

## 3. 思想史与起源

计算机本体的历史可视为哲学本体论「机器化」的过程：从哲学问「存在什么（What is there?）」，到知识工程问「我们如何让机器在共享术语上达成一致」。

### 3.1 哲学渊源（简要）

哲学本体论（Aristotle《范畴篇》《形而上学》以降）为计算机本体提供了**分析工具**而非直接蓝图：

- **范畴（categories）**：实体/性质/关系/事件的基本分类，对应现代顶层本体（第 6 节）的顶层划分。
- **共相 vs 殊相（universal vs particular）**：类/性质（共相）与个体（殊相）的区分，正是 OWL 中 class 与 individual、TBox 与 ABox 的哲学对应物。BFO 明确以「实在论」立场区分 universal 与 particular \[18\]。
- **同一性（identity）与整体部分（part-whole/mereology）**：直接成为 OntoClean 的核心分析工具（5.3）。

但二者有一个**根本性分歧**，必须在报告中显式指出：哲学本体论通常追问「世界本身的结构是什么」（实在论立场），而计算机本体（尤其 Gruber 传统）把本体视为**约定/设计制品**——Gruber 明言 "formal ontologies are viewed as **designed artifacts**, formulated for specific purposes" \[1\]。这一「本体是设计物还是对实在的刻画」的对立，是后来 BFO（实在论，realist）与 DOLCE（描述论，descriptivist）两大顶层本体阵营分裂的哲学根源（第 6 节）。

### 3.2 AI 知识表示传统（1960s–1980s）

- **Quillian (1967/1968) 语义记忆（semantic memory）与语义网络**：提出以节点（概念）与带标签的边（关系）表示词义，并通过「扩散激活（spreading activation）」模拟联想检索 \[5\]。语义网络是后世语义网、RDF 图、知识图谱的**直接形式祖先**。
- **Minsky (1975) 框架（frames）**：用「槽-值（slot-filler）」结构表示定型知识，槽有默认值与继承关系。框架是**面向对象/描述逻辑**中「类 + 角色」结构的认知原型。
- **Sowa (1984) 概念图（conceptual graphs）**：把语义网络置于**一阶逻辑**的形式基础上，试图弥合「图直观」与「逻辑严格」\[6\]。这一「图表示 + 形式逻辑语义」的双重要求，正是后来 RDF/OWL 设计的核心张力（第 4 节）。

### 3.3 知识工程与本体承诺（1980s–1990s）

1990 年代知识获取（knowledge acquisition）的瓶颈——**知识难以跨系统复用**——催生了本体作为「共享规约」的思想：

- **Genesereth & Nilsson（1987）**在《Logical Foundations of AI》中提出 **ontological commitment（本体承诺）**：一个逻辑理论对其符号的**预期解释**所作的承诺 \[1\]。
- **Gruber (1993)** 把本体明确为**支持知识共享与重用的设计制品**，并提出五条设计准则（5.1）\[1\]。
- 同期**知识级建模**（Newell 的知识层次假设）与 **CommonKADS**（Schreiber et al.）等方法学，为后来的本体工程方法学（第 5 节）提供了工程土壤。

### 3.4 语义网路线（1998–2004）

- **RDF (1999)** 成为 W3C 推荐标准，提供「主语-谓语-宾语」三元组与 URI 全局标识；**RDFS (2004)** 提供类/子类/属性/域/值域等最小词汇层。
- **Berners-Lee, Hendler & Lassila (2001)** 在 *Scientific American* 发表《The Semantic Web》\[7\]，提出**语义网层叠（layer cake）**：XML → RDF → RDFS → **Ontology vocabulary (OWL)** → Logic → Proof → Trust。这篇纲领性文章把 ontology 定位为语义网栈中「赋予术语以形式语义」的关键层。
- **OWL (2004)** 成为 W3C 推荐标准，把描述逻辑（第 4 节）作为其形式语义基础 \[10\]。

> **要点**：计算机本体有两条汇流线——（a）知识表示/知识工程线（语义网络→框架→概念图→共享本体），关注**推理与知识复用**；（b）Web 线（RDF→RDFS→OWL→语义网），关注**开放世界下的分布式互操作**。二者在 OWL 处合流。

## 4. 形式基础：描述逻辑、RDF/OWL

本体之所以区别于词表/分类体系，关键在于其**形式语义**——即公理有模型论解释、可被自动推理。OWL 的形式基础是**描述逻辑（Description Logic, DL）**\[8\]\[9\]。

### 4.1 描述逻辑的核心语法与语义

描述逻辑是**一阶逻辑的可判定片段**，专为表示「类（concept）+ 角色（role）」设计。基础语言 **ALC**（Attributive Language with Complement）的构造子：

- **概念构造子**：交 $\sqcap$、并 $\sqcup$、补 $\neg$、全称约束 $\forall r.C$、存在约束 $\exists r.C$、顶 $\top$、底 $\bot$。
- **公理**：概念包含 $C \sqsubseteq D$（TBox，术语公理）、断言 $C(a)$、$r(a,b)$（ABox，个体断言）。

模型论语义：一个解释 $\mathcal{I} = (\Delta^\mathcal{I}, \cdot^\mathcal{I})$ 把概念映射到 $\Delta^\mathcal{I}$ 的子集、角色映射到二元关系。$C \sqsubseteq D$ 成立当且仅当 $C^\mathcal{I} \subseteq D^\mathcal{I}$。**本体推理的核心判定问题是概念可满足性（satisfiability）与包含（subsumption）**，二者可互相归约 \[8\]。

### 4.2 描述逻辑家族与 OWL 的对应

| 字母 | 含义 |
|---|---|
| $\mathcal{AL}$ | 基础属性语言（原子否定、交、值约束、受限存在） |
| $\mathcal{C}$ | 补/全否定（$\mathcal{ALC}$ = $\mathcal{AL}$+补） |
| $\mathcal{S}$ | $\mathcal{ALC}$ + 传递角色（transitive roles，源自 $\mathcal{ALC}_{R^+}$） |
| $\mathcal{H}$ | 角色层级（role hierarchy） |
| $\mathcal{I}$ | 逆角色（inverse roles） |
| $\mathcal{O}$ | 枚举/名词（nominals，如 `{Alice}`） |
| $\mathcal{N}$ | 数量约束（number restrictions） |
| $\mathcal{Q}$ | 限定数量约束（qualified number restrictions） |
| $\mathcal{F}$ | 函数性角色（functional properties） |
| $\mathcal{R}$ | 复合角色包含公理（role inclusion axioms） |
| $(\mathcal{D})$ | 具体域/数据类型（datatypes） |

**OWL 版本与 DL 的精确对应**（这是常被引用错的事实，此处以规范为准 \[10\]\[9\]）：

- **OWL Lite** ≈ $\mathcal{SHIF}(D)$（为效率牺牲表达力，实践中几乎无人使用）。
- **OWL DL** = $\mathcal{SHOIN}(D)$（可判定；实际为 NExpTime-完全\[8\]）。
- **OWL 2 DL** = $\mathcal{SROIQ}(D)$（加入角色链、自反、不相交、限定基数、逆角色的角色链等）。

**复杂度**：$\mathcal{ALC}$ 相对一般 TBox 的可满足性为 **ExpTime-完全**；$\mathcal{SROIQ}$ 为 **N2ExpTime-完全**，且 Kazakov (2008) 证明 $\mathcal{RIQ}$ 与 $\mathcal{SROIQ}$ **严格难于** $\mathcal{SHOIQ}$ \[21\]。这一结果有实际含义：**OWL 2 的表达力提升以最坏情形推理代价翻倍为代价**，因此在工程中常用可判定的**可扩展片段**（profile），见 4.5。

### 4.3 开放世界假设与「无唯一名」假设

DL/OWL 语义与关系数据库语义的关键差别，是理解本体推理时最易踩的坑：

- **开放世界假设（Open World Assumption, OWA）**：未陈述的事实**不视为假**，只视为**未知**。关系数据库默认封闭世界（CWA）：表里没有的就是假。
- **无唯一名假设（No Unique Name Assumption）**：两个不同的名字**不默认指代不同个体**，除非显式声明 `differentFrom`。关系数据库默认主键不同即不同实体。

> **推论**：OWL 推理（如表格式 tableau 算法、或现代的超表格/一阶可判定程序）是**单调、基于模型论的**：它只推导「在**所有**模型中为真」的结论，而非「在当前数据中为真」的结论。这与知识图谱的嵌入模型（8.3）形成鲜明对比——后者是**非单调、基于统计**的。

### 4.4 RDF/RDFS 语义 vs OWL 语义

- **RDF 简单蕴含（simple entailment）**：纯句法图匹配，无语义。
- **RDFS 蕴含**：引入 `rdfs:subClassOf`、`rdfs:subPropertyOf`、`rdfs:domain`、`rdfs:range` 的极小语义。
- **OWL 直接语义（direct semantics）**：基于 DL 的模型论语义，是推理器（reasoner）实际使用的语义 \[10\]。
- **OWL RDF-based semantics**：把 OWL 公理也解释进 RDF 图模型，用于与纯 RDF 数据的互操作，但推理更受限。

**设计张力**：RDF 图是**开放、可扩展、无模式**的（Hogan et al. 强调其相对关系模型的灵活性\[20\]），而 OWL 公理是**封闭、承诺性**的。OWL 本体通常以 RDF 语法（RDF/XML、Turtle）序列化，但其**语义超出 RDF**——这正是「本体既是 Web 数据又是逻辑理论」这一双重身份的体现。

### 4.5 OWL 2 的三个 profile（可扩展性片段）

OWL 2 定义了三个以**不同复杂度/表达力取舍**为目标的子语言 \[10\]：

| Profile | 目标复杂度 | 特点 |
|---|---|---|
| **OWL 2 EL** | PTime（多项式） | 仅含存在约束与交；面向**大型生物医学术语**（SNOMED CT、GO 家族即用 EL 刻画） |
| **OWL 2 QL** | NLogSpace（可翻译到 SQL） | 面向**数据密集、查询为主**场景，可映射到关系数据库 |
| **OWL 2 RL** | PTime | 面向**规则引擎**（RETE 等），可翻译为规则语言 |

这三个 profile 的并存本身说明了一个重要的工程结论：**表达力与推理可扩展性不可兼得**，实际系统必须选择与领域需求匹配的片段。生物医学领域大量选用 EL，正是因为它能在十万级术语规模上保持多项式推理。

## 5. 本体工程方法学

本体从「艺术（art）」走向「工程（engineering）」的转折，正是 Gruber 1993 论文与 METHONTOLOGY 1997 论文的标题所宣示的进程 \[1\]\[11\]。

### 5.1 Gruber 的五条设计准则 \[1\]

Gruber (1993) 提出本体设计的五条准则，是本体工程的「原始契约」，至今仍被引用：

1. **清晰性（Clarity）**：定义应客观、独立于具体应用语境，尽量给出充分必要条件和逻辑公理，而非仅自然语言释义。
2. **一致性（Coherence）**：本体推导出的结论必须与公理相容；应能作出一致性检查。
3. **可扩展性（Extendibility）**：应能定义新术语而不需改动已有定义。
4. **最小编码偏差（Minimal encoding bias）**：概念化不应依赖特定的符号编码约定；编码选择应尽量延迟到实现阶段。
5. **最小本体承诺（Minimal ontological commitment）**：仅承诺领域任务**必需**的语义，允许使用者按需自由扩展。这与「最小承诺」原则互为表里。

> **要点**：第 5 条「最小本体承诺」与 Guarino 的「本体承诺」概念（2.2）形成呼应：**本体应只承诺最少的东西，把多余解释的自由留给使用者**。这是「本体作为可复用制品」设计哲学的核心。

### 5.2 METHONTOLOGY 与生命周期方法学

**METHONTOLOGY**（Fernández-López, Gómez-Pérez & Juristo, 1997）\[11\] 是最早、影响最广的完整本体开发方法学。它把本体开发分为：

- **管理活动（management）**：规划、控制、质量保证。
- **开发活动（development）**：
  - **规格说明（specification）**：产出本体目的、范围、预期用途文档。
  - **概念化（conceptualization）**：用中间表示（intermediate representations）建模领域概念与关系——这是与 Gruber 定义中「conceptualization」一词的工程对应。
  - **形式化（formalization）**：把概念化转写为形式语言。
  - **实现（implementation）**：编码为可计算本体（如 OWL）。
  - **维护（maintenance）**：持续更新。
- **支持活动（support）**：知识获取、评估、文档化、集成。

其「生命周期」（specification → conceptualization → formalization → implementation → maintenance）成为后来几乎所有方法学的模板。这一方法学与 Gruber 定义**逐词对应**，是「概念化→显式规约」的工程落地。

**其他重要方法学**：

- **On-To-Knowledge (OTK)**（Staab et al., 2001）：以**知识元过程**驱动，强调从非结构化文本到本体的转化，与知识管理应用绑定。
- **NeOn 方法学**（Suárez-Figueroa et al., 2006–2010）：面向**网络化本体**（ontology networks），处理本体复用、本体对齐、多本体协作等场景。
- **本体设计模式（Ontology Design Patterns, ODPs）**（Gangemi）：把本体构建视为**模式复用**，类比软件工程的设计模式。

### 5.3 本体评估：OntoClean

**OntoClean**（Guarino & Welty, 2002, 2004）\[12\] 是本体评估中最具形式哲学基础的方法。它不评估「本体是否好用」，而是评估**分类关系的本体论正确性**，通过给每个性质打上**元性质（meta-property）标签**，再据约束检查 `subClassOf` 层级是否「干净」。

四个核心元性质（分析工具直接来自哲学范畴论）：

1. **刚性（Rigidity, ±R）**：刚性性质（rigid）对其所有实例在所有可能情形下都成立（如「是人」）；非刚性（anti-rigid, −R）只在特定阶段/情形成立（如「是学生」）。
2. **同一性（Identity, ±I）**：性质是否**携带**同一性判据（identity criteria）——即能否判定两个个体是否同一（如「是同一个物理对象」有同一性，而「是红色」没有）。
3. **统一性（Unity, ±U）**：性质是否**携带**整体性判据（unity criteria）——即能否判定某物是否构成一个整体（如「是一头牛」有统一性，「是一堆沙」则弱）。
4. **依赖性（Dependence, ±D）**：性质是否**固有地**依赖另一个实体存在（如「是学生」依赖「是学校」）。

OntoClean 的**约束规则**（示例）：

- 一个**反刚性**（−R）类不能包含（subsume）一个**刚性**（+R）类——因为「是学生」不能是「是人」的父类。违反此约束即「分类错误」。
- 一个**携带统一性**（+U）类不能包含一个**不携带统一性**（−U）类。

> **价值与局限**：OntoClean 提供了一套**独立于领域内容**的形式化分析工具，被用于审计 WordNet、Enterprise Ontology 等既有本体的分类错误 \[12\]。但其局限在于：分析依赖专家对元性质的人工判定，难以自动化；且它只评估**分类关系**，不覆盖属性的领域/值域等其他维度。

### 5.4 需求获取：能力问题（Competency Questions）

**Grüninger & Fox (1995)** 提出 **competency questions（能力问题）** 方法 \[13\]：在构建本体**之前**，先以非形式语言写出本体建成后应能回答的问题（如「该组件是否能在温度 X 下工作？」），再把每个能力问题**形式化为本体的查询**。本体「完备」的判据是：**它能回答全部能力问题，且不能回答出问题的非法实例**。

能力问题至今仍是本体规格说明（5.2 的 specification 活动）的事实标准，也是 2000 年后「测试驱动」式本体开发的思想源头。

## 6. 顶层本体与分类体系

**顶层本体（top-level/upper/foundational ontology）** 提供最通用的范畴（对象、事件、性质、时间、空间、依赖），领域本体在其上对齐。其存在理由是 2.2 所述 Guarino 本体谱系：**若各领域本体共享同一顶层，跨领域集成更易**。但顶层本体本身也存在深刻分歧，且**没有、也不存在共识的「标准顶层本体」**（Niles & Pease 2001 论文标题《Towards a Standard Upper Ontology》的「Towards」即暗示未竟）\[15\]。

### 6.1 两大哲学阵营

顶层本体的根本分歧是**哲学立场**：

- **实在论（realist）**：本体应刻画**世界本身**的结构，术语应指称真实存在的共相（universals）。代表：**BFO**（Basic Formal Ontology）、**Cyc**。
- **描述论/认知论（descriptivist/cognitive）**：本体刻画的是**概念化/认知结构**，术语可指称概念、角色、甚至依赖语境的实体。代表：**DOLCE** 官方立场、**UFO** 的部分设计。

Gruber 传统（本体 = 设计制品，3.1）偏描述论；而 BFO 的创始人 Barry Smith 明确批评「本体即概念模型」的观点，主张本体应指称实在 \[18\]。这一哲学分歧有**直接的工程后果**：实在论本体拒绝「角色（role）」「语境相关性质」作为一级实体，而描述论本体（如 DOLCE 的 social role）将其纳入。

### 6.2 四个主要顶层本体

| 本体 | 年份/出处 | 哲学立场 | 形式基础 | 特点与用途 |
|---|---|---|---|---|
| **Cyc** | Lenat, 1984 起 \[14\] | 实在论（常识） | CycL（高阶逻辑） | 以**海量常识**（数百万条断言）为目标的长期项目；OpenCyc 2002 开源 |
| **SUMO** | Niles & Pease, 2001 \[15\] | 混合（务实的「merged」） | SUO-KIF（一阶） | 由多个既有顶层本体**合并**而来；与 WordNet 建立映射（2.3 的「词汇≠本体」实证） |
| **DOLCE** | Masolo et al., 2002/2003 \[16\] | **描述论** | 一阶逻辑（FOL，已证一致性） | 明确为「认知/语言学」目的而设计；有 OWL 版本 DOLCE-Lite/DUL；UFO 的母体 |
| **BFO** | Grenon & Smith, 2002–2004 \[18\] | **实在论** | 一阶逻辑（ISO 化中） | 2007 起成为 **OBO Foundry** 的默认顶层（7.2）；ISO/IEC 21838 顶层本体标准 |

**派生/关联本体**：

- **UFO（Unified Foundational Ontology）**（Guizzardi, 2005）：基于 DOLCE 与 OntoClean，广泛用于**概念建模**（conceptual modeling）社区，是「本体驱动概念建模」的代表。
- **GFO（General Formal Ontology）**（OntoMed/Leipzig）：德国学派的顶层本体，强调**过程/时间**与「存在物（persistant）」的划分，与 BFO 的 SNAP/SPAN 二分对应 \[18\]。

### 6.3 顶层本体的关键设计分歧

两个最具教学意义的**实质分歧**：

1. **3D 持存 vs 4D 延存（endurantism vs perdurantism）**：对象是**完整地存在于每个时刻**（3D/持存，BFO 的 SNAP 层），还是**是跨时间的时空段**（4D/延存，BFO 的 SPAN 层）？BFO 用 SNAP（快照、静态）/SPAN（跨度、过程）两层**显式并存**来回避形而上学争论 \[18\]；DOLCE 则用**时间索引 + 性质**处理。这一选择决定了一个本体能否自然表达「过程本体」「事件」等动态知识。
2. **角色与依赖**：DOLCE 把 **social role**（如「教授」「病人」）建模为一级实体（借助 OntoClean 的「依赖性」分析），而实在论者认为「教授」不是世界里的实在共相。这直接关系到医疗、组织本体的建模方式（7.3）。

> **要点**：顶层本体的「正确性」没有可判定的唯一答案，因为分歧根源于**不可证伪的哲学承诺**。工程上的务实做法（也是现状）是：**选择与本领域社区已采纳的顶层对齐**（生物医学 → BFO；语言/认知/概念建模 → DOLCE/UFO），而非追求「唯一正确」。

## 7. 应用：从基因本体到知识图谱

### 7.1 Gene Ontology（GO）—— 最成功的领域本体

**Gene Ontology**（Ashburner et al., 2000）\[17\] 是本体思想在真实科学中**最成功的大规模部署**，也是「受控词表 → 形式本体」演进的典型案例（其论文标题即 "tool for the unification of biology"）。

- **结构**：GO 由**三个正交（orthogonal）子本体**构成，每个基因产物可在三个轴上独立注释：
  1. **生物过程（biological process, BP）**：基因参与的过程（如「细胞周期」）。
  2. **分子功能（molecular function, MF）**：基因产物的分子活性（如「激酶活性」）。
  3. **细胞组分（cellular component, CC）**：基因产物所处的细胞位置（如「线粒体」）。
- **核心机制**：三个轴的**正交性**（一个基因可同时有 BP/MF/CC 注释，且三轴互不冗余）解决了生物学注释的「多对多」混乱，是本体设计的经典范本。
- **形式化演进**：GO 早期是**有向无环图（DAG）** 组织的受控词表；后逐步增加形式公理，并使用 **OWL 2 EL**（4.5）刻画以支持大型术语上的多项式推理。
- **工具链**：Protégé（Stanford）、ELK/HermiT 等推理器，构成事实上的本体开发/推理标准栈。

### 7.2 OBO Foundry —— 协调演进的生物医学本体族

**OBO Foundry**（Smith et al., 2007）\[19\] 是 GO 成功的**制度化推广**：规定一组**互操作、正交（orthogonal）、共享 BFO 顶层**的参考本体族，覆盖生物医学各子域（解剖、病理、化学、表型、关系本体 RO 等）。

其核心**原则**（也是本体工程的最佳实践清单）：

- **正交性（orthogonality）**：每个领域只由**一个**权威本体覆盖，避免同一术语被多个本体矛盾定义。
- **共同顶层**：所有成员本体对齐到 **BFO**（6.2），保证跨域集成。
- **共享关系本体**：使用 **Relation Ontology (RO)** 统一定义 `part_of`、`has_part`、`regulates` 等关系。
- **开源 + 受控版本**：用唯一 ID、可追溯的注释（annotation）管理术语生命周期。

> **意义**：OBO Foundry 是「本体工程方法学 + 顶层本体 + 社区治理」三者的**合流实证**——它同时体现了 OntoClean 的严谨（在 RO 中），BFO 的实在论顶层，以及 METHONTOLOGY 的生命周期维护。它证明：**本体能否成功，取决于治理与社区共识，而非仅仅形式正确**。

### 7.3 其他代表性应用

- **SNOMED CT**：临床医学术语本体，规模达数十万概念，使用 **OWL 2 EL** 支持临床决策支持与推理，是医疗本体的工业标准。
- **语义网与链接数据（Linked Data）**：以 RDF 发布、用本体（如 FOAF、Schema.org、DBpedia Ontology）标注的开放数据网络。Hogan et al. 详述了其图模型、SPARQL 查询与发布协议 \[20\]。
- **企业知识图谱**：Google Knowledge Graph（2012）之后，Airbnb、Amazon、LinkedIn、eBay、Microsoft 等相继构建内部知识图谱，用于搜索、推荐、风控等 \[20\]。

## 8. 前沿与争议

### 8.1 「知识图谱」的定义之争（与 ontology 的关系）

Hogan et al. (2021) 的权威综述开篇即指出，**「knowledge graph」一词的定义 "remains contentious"** \[20\]。其提出的包容性定义为：*"a graph of data intended to accumulate and convey knowledge of the real world, whose nodes represent entities of interest and whose edges represent relations between these entities"* \[20\]。

关键论点：知识图谱的**数据层**是图（RDF 图或属性图），而**本体/规则是可选的、叠加的模式/语义层**——即知识图谱「**可以**」带本体，也可以只带轻量 schema 或完全没有 schema。这与 ontology 形成互补而非等同关系：

| 维度 | 本体（OWL） | 知识图谱 |
|---|---|---|
| 主要关切 | 术语语义、推理 | 实体、关系、大规模集成 |
| 语义承诺 | 强（DL 模型论） | 弱/可选（可无 schema） |
| 世界假设 | 开放世界 | 实践中常混合 OWA/CWA |
| 典型形式 | TBox 公理 | 三元组/属性图 |

**争议焦点**：一方（含部分 DB 社区）认为无本体的 RDF/属性图集合即「知识图谱」；另一方（含部分 KR 社区）坚持「知识」须含可推理的模式语义。这一分歧在工程上体现为：**Schema.org（弱语义、SEO 驱动）与 OBO Foundry（强语义、科学驱动）是否属于同一「知识图谱」谱系**。

### 8.2 轻量级 vs 重量级本体

- **轻量级本体（lightweight）**：taxonomy + 少量约束，无强公理，可扩展、易维护，但推理能力弱。Schema.org、FOAF、多数企业图谱 schema 属此类。
- **重量级本体（heavyweight）**：富公理、可判定推理、本体论严谨（如 BFO 对齐的 OBO 本体）。

**取舍**（不可兼得，4.5 的复杂度结论在此的应用）：重量级本体推理可扩展性差，轻量级本体语义贫乏。学界正探索**中间地带**——如 OWL 2 的三个 profile（4.5）、以及用 SHACL/ShEx 提供**验证语义**（而非推理语义）作为轻量替代。

### 8.3 本体学习、嵌入与神经符号

- **本体学习（ontology learning）**：从文本/数据**自动或半自动**抽取概念、层级、关系构建本体。传统方法（2000s）用模式匹配、聚类、统计共现；**可靠性有限**，故多定位为「辅助人工」，而非「取代人工」。
- **知识图谱嵌入（KGE）**：把实体/关系映射为**低维向量**（TransE、DistMult、RotatE 等），用向量运算做链接预测。其语义是**非单调、统计的**，与 OWL 的模型论语义（4.3）**本质不同**——KGE 学的是「统计规律」，OWL 推理给的是「逻辑必然」。
- **LLM 与本体（2024–2025 活跃前沿）**：大语言模型被用于**本体生成、知识图谱构建、实体链接**。代表性工作如 Lippolis et al. (2025) 的 LLM 本体生成，以及多篇 2024–2025 的 LLM 辅助 KG/本体构建综述与系统。**核心张力**：LLM 擅长**自然语言 ↔ 结构化**的翻译与零样本抽取，但存在**幻觉、不一致、缺乏逻辑保证**——因此主流定位是 LLM **辅助**本体工程师（起草候选术语/公理），而非**自动生成**可信本体。这与神经符号（neuro-symbolic）范式的思路一致：**用符号层（本体）保证正确性与可解释性，用神经层（LLM/KGE）处理非结构化输入与统计近似**。

### 8.4 未决问题（研究级综述视角）

1. **定义分歧**：ontology 与 knowledge graph 的边界无共识（8.1），影响论文可比性与评价标准。
2. **本体对齐（ontology alignment/matching）的自动化**：跨本体映射仍是 OAEI 竞赛长期未解决的高难度问题。
3. **本体维护的可扩展治理**：OBO Foundry 的社区治理模式难以直接推广到企业/Web 场景。
4. **LLM 时代的本体角色**：LLM 是否会「取代」形式本体，还是使形式本体**更重要**（作为可验证、可解释的约束层）——目前学界倾向后者，但尚无定论。

## 9. 参考文献

> 标注 \[一手\] = 原始论文/规范；\[综述\] = 权威综述；\[教科书\] = 手册/教材。

1. \[一手\] Gruber, T. R. (1993/1995). "Toward principles for the design of ontologies used for knowledge sharing." *International Journal of Human-Computer Studies*, 43(5-6), 907–928. （最初发表于 1993 年 Padova 国际形式本体工作坊；修订版见 IJHCS 1995。）
2. \[一手\] Guarino, N., & Giaretta, P. (1995). "Ontologies and knowledge bases: Towards a terminological clarification." In *Towards Very Large Knowledge Bases: Knowledge Building and Knowledge Sharing* (pp. 25–32). IOS Press.
3. \[一手\] Studer, R., Benjamins, V. R., & Fensel, D. (1998). "Knowledge engineering: Principles and methods." *Data & Knowledge Engineering*, 25(1-2), 161–197.
4. \[一手\] Borst, W. N. (1997). *Construction of Engineering Ontologies for Knowledge Sharing and Reuse*. PhD thesis, University of Twente.
5. \[一手\] Quillian, M. R. (1967). "Word concepts: A theory and simulation of some basic semantic capabilities." *Behavioral Science*, 12(5), 410–430. （语义记忆的原始文献。）
6. \[一手\] Sowa, J. F. (1984). *Conceptual Structures: Information Processing in Mind and Machine*. Addison-Wesley.
7. \[一手\] Berners-Lee, T., Hendler, J., & Lassila, O. (2001). "The Semantic Web." *Scientific American*, 284(5), 34–43.
8. \[教科书\] Baader, F., Calvanese, D., McGuinness, D., Nardi, D., & Patel-Schneider, P. F. (Eds.) (2003). *The Description Logic Handbook: Theory, Implementation, and Applications*. Cambridge University Press.
9. \[一手\] Horrocks, I., Patel-Schneider, P. F., & van Harmelen, F. (2003). "From SHIQ and RDF to OWL: The making of a Web ontology language." *Journal of Web Semantics*, 1(1), 7–26.
10. \[一手/规范\] W3C (2004). *OWL Web Ontology Language Overview*; W3C (2012). *OWL 2 Web Ontology Language Document Overview (Second Edition)*.
11. \[一手\] Fernández-López, M., Gómez-Pérez, A., & Juristo, N. (1997). "METHONTOLOGY: From ontological art towards ontological engineering." *AAAI Spring Symposium on Ontological Engineering*.
12. \[一手\] Guarino, N., & Welty, C. A. (2002). "Evaluating ontological decisions with OntoClean." *Communications of the ACM*, 45(2), 61–65; 及 Guarino & Welty (2004). "An overview of OntoClean." In *Handbook on Ontologies* (pp. 151–171). Springer.
13. \[一手\] Grüninger, M., & Fox, M. S. (1995). "Methodology for the design and evaluation of ontologies." *IJCAI Workshop on Basic Ontological Issues in Knowledge Sharing*.
14. \[一手\] Lenat, D. B., & Guha, R. V. (1990). *Building Large Knowledge-Based Systems: Representation and Inference in the Cyc Project*. Addison-Wesley.
15. \[一手\] Niles, I., & Pease, A. (2001). "Towards a standard upper ontology." *Proceedings of FOIS 2001*.
16. \[一手\] Masolo, C., Borgo, S., Gangemi, A., Guarino, N., & Oltramari, A. (2003). *WonderWeb Deliverable D18: Ontology Library (final)*. ISTC-CNR. （DOLCE 的官方规范。）
17. \[一手\] Ashburner, M., et al. (The Gene Ontology Consortium) (2000). "Gene Ontology: Tool for the unification of biology." *Nature Genetics*, 25(1), 25–29.
18. \[一手\] Grenon, P., & Smith, B. (2004). "SNAP and SPAN: Towards dynamic spatial ontology." *Spatial Cognition and Computation*, 4(1), 69–104. （BFO 的 SNAP/SPAN 二分。）
19. \[一手\] Smith, B., et al. (2007). "The OBO Foundry: Coordinated evolution of ontologies to support biomedical data integration." *Nature Biotechnology*, 25(11), 1251–1255.
20. \[综述\] Hogan, A., Blomqvist, E., Cochez, M., et al. (2021). "Knowledge Graphs." *ACM Computing Surveys*, 54(4), Article 71. （知识图谱的定义、图模型、本体关系、创建/精化/发布的权威综述。）
21. \[一手\] Kazakov, Y. (2008). "RIQ and SROIQ are harder than SHOIQ." *Proceedings of KR 2008*. （$\mathcal{SROIQ}$ 复杂度上界。）
22. \[一手\] Suárez-Figueroa, M. C., Gómez-Pérez, A., & Fernández-López, M. (2012). "The NeOn methodology for ontology engineering." In *Ontology Engineering in a Networked World*. Springer. （NeOn 方法学的系统阐述。）

## 附：一句话总结

计算机本体的本质是**「把某一领域共享概念化写成带形式语义的显式规约」**（Gruber 定义 + Guarino 澄清 + DL 语义三层合流）；其 30 年历史主线是**从知识工程的重用工具，演化为语义网/知识图谱的可推理模式层，再到 LLM 时代作为可信、可解释约束层重新定位**。贯穿始终的未决张力有二：**表达力 vs 推理可扩展性**（4.5），以及**「本体是设计制品还是对实在的刻画」**（3.1、6.1）——前者是工程取舍，后者是哲学分歧。
