---
title: LLM 评测指标速查
date: 2026-10-12
tags: [nlp, evaluation]
summary: 记录大模型评测中困惑度、任务准确率与基于模型判分的适用场景与注意点。
---

## 困惑度（Perplexity）

$$
\text{PPL} = \exp\left(-\frac{1}{N}\sum_{t} \log P(x_t \mid x_{\lt t})\right)
$$

困惑度越低，模型对测试语料的预测越确定，但仅在同一词表下可比。

## 任务准确率与判分

生成类任务难以用单一匹配指标衡量，常用基于模型的评分（LLM-as-a-judge）配合人工抽检。

## 注意

指标不是目标。评测集泄漏与词表差异会显著影响可比性。
