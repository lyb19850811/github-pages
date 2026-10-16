---
title: Transformer 位置编码综述
date: 2026-10-16
tags: [nlp, transformers, deep-learning]
summary: 梳理正弦位置编码、可学习位置编码与旋转位置编码 RoPE 的数学形式、设计动机与适用场景。
---

Transformer 的自注意力机制本身是置换等变的——不感知 token 顺序。位置编码（positional encoding）把位置信息注入模型，是序列建模的关键一环。本文梳理三种主流做法。

## 正弦位置编码（Sinusoidal PE）

原版 Transformer 使用固定频率的正弦/余弦，不参与训练：

$$
PE_{(pos, 2i)} = \sin\left(\frac{pos}{10000^{2i/d_{model}}}\right),
\qquad
PE_{(pos, 2i+1)} = \cos\left(\frac{pos}{10000^{2i/d_{model}}}\right)
$$

其中 $pos$ 是位置，$i$ 是维度下标，$d_{model}$ 是隐层维度。不同维度对应不同频率，从高频递减到低频。

![正弦位置编码不同维度的频率示意]({{ '/assets/images/positional-encoding.svg' | relative_url }})

优点是不需额外参数，且理论上可借助相对位置外推；缺点是形式固定，超出训练长度的位置表现下降。

## 可学习位置编码（Learned PE）

把位置向量作为可学习参数，与词嵌入相加或拼接。表达能力强，但无法外推，且每个位置需独立参数。

## 旋转位置编码（RoPE）

RoPE 把位置编码实现为对 query/key 的旋转，旋转角随维度指数衰减：

$$
\theta_i = 10000^{-2i/d}
$$

位置信息进入注意力分数的相对形式，天然支持相对位置，外推性好，是 LLaMA 等主流大模型的默认选择。

## 参考

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/abs/2104.09864)
