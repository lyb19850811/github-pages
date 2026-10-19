---
report: 53
title: StartLux-Decision-4B 深度研究：System One 决策模型多渠道核验
date: 2026-10-19
tags: [decision-model, startlux, modelscope, huggingface, llm]
summary: 从魔搭、HF、StartLux 官网三渠道核验 StartLux-Decision-4B：类型化决策模型的架构与 letter 读出机制、与 TypeSafe Jev 的生态关系，以及本地部署文档的四处修正。
math: false
---

StartLux-Decision-4B 是一台「类型化决策模型」，不是小 LLM：一次前向对一段材料 + 一组带固定选项的问题直接返回每个选项的概率，不生成文字。本文基于本地权重/源码 + 魔搭 + HF + StartLux 官网 + TypeSafe/Akka 旁证，核验它的身份、架构、生态定位与部署文档的准确性。

## 一、结论先行

- 模型**真实可验证**：本地下载与官方元数据一致，权重已公开在魔搭（`StartLuxAI/StartLux-Decision-4B`）与 HF（`startlux-models/StartLux-Decision-4B`）。
- 它与 StartLux 官网主推的**不是同一产品线**：官网首页通篇讲 `StartLux-V1.0-27B-Preview`（Agent 模型，Qwen3.6 基座，还在备案/内测）；Decision 系列是另一条「类型化决策」线（Qwen3.5 基座，已开源 CC BY-NC）。
- 它是 TypeSafe「System One」生态里的一个**开源替代品**，与 Jev 的 `/v1/systemone` 接口同构。
- 本地部署文档整体准确，但有 **4 处需修正**（体积、参数量、注意力机制、README 错引），已修正。

## 二、模型本质（代码级证据）

读本地 `startlux_decision/` 源码后，机制完全确定：

| 事实 | 证据 |
|---|---|
| 基座 | `config.json`：`model_type: qwen3_5`，`Qwen3_5ForConditionalGeneration`；`NOTICE`：基座 Apache-2.0，Copyright 2026 Alibaba Cloud |
| 层结构 | 32 层**混合线性注意力**：`layer_types` = 3×`linear_attention` + 1×`full_attention` 重复 8 次 |
| 视觉塔 | 738 个张量中 297 个为 `model.visual.*`；mrope 多模态位置编码 `[11,11,10]` |
| 读出机制 | **不生成文字**：每选项渲染成字母 A–Z，一次前向读**最后一个位置 26 个字母 token 的 next-token logits**，按题型温度 softmax 归一化（`model.py` 头注释 + `jevfmt.py`） |
| 温度 | `decision_config.json`：noul 1.5905 / choice 1.3872 / score 1.4172 |

「option-letter 读出」本质：把分类头用 LM 的 next-token 分布实现——字母 token 的 logits 当分类 logits 用。这解释了为什么不能用 vLLM / llama.cpp / mlx-lm 裸加载：它们会把它当因果 chat 模型去**生成文字**，而不是读字母概率。

## 三、三渠道对比

| 维度 | 魔搭 `StartLuxAI/…-4B` | HF `startlux-models/…-4B` | StartLux 官网 `www.startlux.com` |
|---|---|---|---|
| 参数 | 标 4.7B | — | — |
| 许可 | cc-by-nc-4.0 | cc-by-nc-4.0 | 不提 Decision 系列 |
| 下载物 | 2 个 safetensors（~9.3 GB），无 GGUF | 另含 GGUF（文本 only）+ assets | 模型未开源（备案中） |
| 数据 | 283 下载、2 star、更新 2026-10-04 | 全家族 6 尺寸 | 主推 V1.0-27B-Preview |

魔搭 = HF README 镜像 + 平台元数据；HF 多了 GGUF；官网是另一条产品线。三渠道彼此一致，无矛盾。

## 四、生态定位：System One 决策模型

TypeSafe（`typesafe.ai`，SF）在 2026-09-15 发布 **Jev** 并披露 $40M 种子轮，发明了「System One Models」：机器原生、类型化输出、校准置信度、零幻觉（由 schema 保证），接口为 `POST /v1/systemone`，训练用 **RLCD**（Reinforcement Learning for Calibrated Decisions）。Akka 官方博客（2026-09-23）明确：「Jev 才刚发布，已有多个开源替代品，全都通过 TypeSafe 的 SystemOne 概念通信」。

StartLux-Decision 就是其中一个开源替代品。模型卡对比表（自报）关键行：

| 模型 | JevBench 正确数/231 | Decision Index 0.2.1 | 延迟(3 问) |
|---|---|---|---|
| StartLux-Decision-27B | 208 | 63.88 | 102.3 ms |
| StartLux-Decision-35B-A3B | 210 | 61.55 | 52.5 ms |
| **StartLux-Decision-4B** | 204 | 52.75 | 26.0 ms |
| Jev 1.13 | 199 | 57.91 | 64.0 ms |
| Intern-Decision-4B | 201 | 37.81 | 44.2 ms |

> 注意方向：4B 版 DI 52.75 **低于** Jev 1.13 的 57.91；StartLux 宣称「榜首」的是 **27B**（63.88）。这些数字是模型卡自报，公共榜 `evals.typesafe.ai` 本次访问被 HTTP 451 拦截，未能独立复核。

## 五、部署文档核对与修正

**准确的部分**：Qwen3.5 基座、32 层/2560/16 头、256K 上下文、`/v1/systemone` 同构、CC BY-NC + Apache-2.0 分层许可、`confidence=(p_max−1/n)/(1−1/n)`、必须走官方包、MLX 仅文本、Mac 2~3s vs H200 26ms。

**四处修正**（已在文档内改）：

| 原文 | 改为 | 依据 |
|---|---|---|
| 体积 8.7 GB（5.35G+3.96G） | ~9.3 GB | 分片实为 5.36G+3.96G=9.32G；index `total_size` 9,319,737,856 |
| 参数量 4B | 实际 ~4.66B（4B 文本 + 0.66B 视觉塔） | total_size/2(bf16)=4.66B；魔搭也标 4.7B |
| 「内置双向注意力 mask」 | 因果注意力 + letter 读出 + 混合线性注意力内核 | `model.py` 明确「every layer is causal」 |
| 「README 明确说明直读变 causal」 | 该句不在 README；真正原因见上 | README 只提 fast kernels 慢 10 倍 + GPU 拒启动 |

## 六、许可与合规

- 权重：CC BY-NC 4.0（研究等非商用免费、需署名；商用需单独向 StartLux Labs 授权，contact@startlux.com）。
- 推理代码 `startlux_decision/`：Apache-2.0。
- 基座：Qwen3.5（Apache-2.0，Alibaba Cloud）；tokenizer 等未改文件保持 Apache-2.0（`NOTICE`）。

公司侧：上海原点星辉科学技术有限公司（CEO 陈大年，CTO 郭权玮博士），自称「全球第一家主打本地模型的 AI 公司」。官网 FAQ 说模型「计划在完成审核后开源、暂无收费计划」——那指的是 V1.0（Qwen3.6 基座，内测）；Decision 系列已以 CC BY-NC 开源，商用仍要单独授权，二者不矛盾但易混。

## 七、未决事项

- **榜单不可复核**：`evals.typesafe.ai` 返回 451，Decision Index 52.75 / JevBench 204/231 / Intern 91.17 均为模型卡自报。
- **HF 访问失败**：本次连 HF API/页面均超时，HF 侧下载量、GGUF 具体清单未能亲见（GGUF 存在性仅据 README 文字推断）。
- **`noul` 命名**：StartLux 用 `noul` 表示 yes/no，TypeSafe/Akka 文档用 `yesNo`。「Jev 客户端改 base_url 即复用」是否 100% 成立，题型命名未从 TypeSafe schema 验证。

## 参考来源

- 魔搭模型页：https://www.modelscope.cn/models/StartLuxAI/StartLux-Decision-4B
- HF 模型页：https://huggingface.co/startlux-models/StartLux-Decision-4B
- StartLux 官网：https://www.startlux.com
- TypeSafe：https://typesafe.ai
- Akka 博客《Fast, Cheap Agent Decisions》：https://akka.io/blog/fast-cheap-agent-decisions
