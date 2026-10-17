---
report: 51
title: 魔搭研究 · 第 10 章：License 与商用合规
date: 2026-10-18
tags: [modelscope, license, compliance, open-source]
summary: 魔搭 License 与商用合规：8 个 license 枚举、Llama 空字段/GLM other 的坑、权重/数据/代码三层 license 分离审。
math: false
---

《魔搭社区深度研究》系列第 10 章（共 12 篇）。版本锚点（实测）：modelscope 1.40.2，用 `api.get_model()` 实测几个真实模型的 license 字段。

## 1. 机制定位

魔搭 license 体系解决：在「免费下载」和「商用许可」之间画线。核心矛盾：

> 下载是技术动作，商用是法律动作。魔搭（和 HF）都只保证你能下载，不保证你能商用——license 判断是你自己的责任。

**边界（license 字段解决不了的）**：`get_model()` 的 `License` 字段只是字符串标签，不是法律文本。可能为空（Llama）、为 other（GLM）、或滞后于真实条款。商用决策必须回到模型卡原文。

## 2. 实操

查模型 license（实测）：

```python
from modelscope.hub.api import HubApi
api = HubApi()
d = api.get_model("Qwen/Qwen2.5-7B-Instruct")
print(d["License"], d["gated"], d["Visibility"])
# apache-2.0  False  5    (5 = PUBLIC)
```

实测 license 分布：

| 模型 | License | gated | 备注 |
|---|---|---|---|
| Qwen/Qwen2.5-7B-Instruct | apache-2.0 | False | 可商用 |
| Qwen/Qwen3-8B | apache-2.0 | False | 可商用 |
| deepseek-ai/DeepSeek-R1 | mit | False | 可商用 |
| LLM-Research/Meta-Llama-3-8B-Instruct | （空） | False | ⚠️ 自定义条款 |
| ZhipuAI/glm-4-9b-chat | other | False | ⚠️ 自定义条款 |

命名格式坑（实测）：API 返回小写 SPDX（apache-2.0/mit）；上传枚举是展示格式（'Apache License 2.0'/'MIT'）。

上传选 license（`modelscope cli modelcard`，源码硬编码 8 个白名单）：

```bash
modelscope modelcard --help
# --license: Apache License 2.0 | GPL-2.0 | GPL-3.0 | LGPL-2.1 | LGPL-3.0 | AFL-3.0 | ECL-2.0 | MIT
```

这 8 个是「上传白名单」，不是「平台 license 全集」——Llama 的空、GLM 的 other 都超出白名单。

## 3. 架构分层

| 层 | 位置 | 说明 |
|---|---|---|
| License 枚举 | `modelscope/hub/constants.py` → Licenses | 8 个上传白名单 |
| 模型元数据 | `modelscope/hub/info.py` → ModelInfo.license（API 字段 License） | 查询 |
| 数据集元数据 | info.py → DatasetInfo.license | 查询 |
| 上传 CLI | `modelscope/cli/modelcard.py` | --license 校验白名单 |
| gated 机制 | constants.py → GatedMode/ProtectedMode | 应用式下载 |
| 可见性 | ModelVisibility/DatasetVisibility：PRIVATE=1/INTERNAL=3/PUBLIC=5 | 与 license 正交 |

关键：`Visibility`（谁能下载）和 `License`（能否商用）是两个正交维度。公开模型照样可能不能商用（Llama 空字段 + 自定义条款）。别把 public 当可商用。

## 4. HF 对照表

| 概念 | HF | 魔搭 | 标注 |
|---|---|---|---|
| license 字段 | model card license:（SPDX + 自定义） | License 字段（SPDX/other/空） | 等价 |
| license 白名单 | 极宽（SPDX 全量 + openrail + 任意） | 8 个固定枚举 | 魔搭独有（更窄） |
| gated | GatedRepoError（公开但需同意） | GatedMode/ProtectedMode（private 应用式） | 语义不同【需验证】 |
| 商用红线提示 | model card + 社区 | 依赖人工看模型卡 | 等价 |

## 5. 生产实践

核心坑：Llama 的 license 字段是空的（实测）。原因：Llama Community License 不在魔搭 8 个枚举里，字段空。**空 ≠ 免费商用**——Llama 条款有红线（MAU > 700M 需商业授权、命名带 Llama 前缀、禁止用输出训竞品【需验证当前条款】）。字段空时必须读模型卡原文。

「免费下载 ≠ 可商用」三层分离（核心问题）：

1. 权重 license：模型卡 License 字段（Qwen=apache-2.0 可商用）。
2. 数据集 license：训练数据许可，即使权重 apache，数据可能非商用。
3. 代码 license：仓库推理代码（.py、trust_remote_code），可能 GPL（传染）/CC-BY-NC（非商用）。

实锤：魔搭 SDK 代码库就混着 CC-BY-NC 4.0（非商用）第三方代码（`models/models/audio/ssr/models/Unet.py`、`vc/src/Starganv3.py`）。同一仓库不同文件不同 license——不能只看仓库级 license。

gated 模型：`GatedMode.GATED=True` 对应 API `ProtectedMode=True`（申请式下载）。实测公开 Qwen/DeepSeek/Llama/GLM 都是 gated=False。

排查三步：① `get_model()` 查 License/gated；② 空/other/gated=True → 读模型卡原文；③ 逐层审权重/数据/代码。

## 6. 时效性检查

- Qwen 系 license（实测 Qwen2.5/3=apache-2.0；初代 Qwen-7B 用自定义协议）【需验证】：各模型卡 license 声明。
- Llama 系条款（MAU 门槛/命名/限制）【需验证】：Meta 官方 Llama license 原文。
- 8 个 license 枚举【需验证】：`modelscope/hub/constants.py` 的 Licenses.to_list()。
- gated 语义【需验证】：constants.py 的 GatedMode + 平台 gated 模型实测。
- other/空字段处理【需验证】：实测 get_model() 对比模型卡。

## 7. 自检题

**Q1** `get_model("LLM-Research/Meta-Llama-3-8B-Instruct")["License"]` 返回空，同事说「没写就是随便用」。怎么纠正？
→ 空字段因 Llama Community License 不在 8 个枚举，不是「没 license」。Llama 有商用红线（MAU 门槛/命名/限制），必须读模型卡原文。

**Q2** 微调 Qwen2.5-7B（apache-2.0）商用，觉得万事大吉。还有哪两层 license 必须审？
→ 数据集 license（训练数据可能非商用）+ 代码 license（trust_remote_code 的 .py 可能 GPL/CC-BY-NC）。魔搭 SDK 就混着 CC-BY-NC 代码。

**Q3** 用 `License == 'apache-2.0' or 'mit'` 做商用白名单自动放行，有什么致命漏洞？
→ 字段不是法律文本，可能空/other/滞后；apache-2.0 标签下权重可商用但数据/代码可能不是。字段只做初筛，other/空/gated 一律人工读卡。

## 系列导航

《魔搭社区深度研究》全 12 篇：0 HF 生态速览 / 1 平台与生态版图 / 2 模型下载与 SDK / 3 pipeline 推理 / 4 MsDataset 数据集 / 5 训练微调（ms-swift vs LLaMA-Factory）/ 6 创空间部署 / 7 API-Inference 推理服务 / 8 MCP 广场与 Agent 生态 / 9 免费资源额度与付费路径 / 10 License 与商用合规 / 11 HF 模型互操作与迁移路径。
