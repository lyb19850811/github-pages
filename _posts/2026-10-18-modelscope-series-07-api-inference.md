---
report: 48
title: 魔搭研究 · 第 7 章：API-Inference 推理服务
date: 2026-10-18
tags: [modelscope, api, inference, dashscope, llm]
summary: 魔搭免费 API-Inference 与百炼 DashScope 是两个独立系统：不同 base_url/key/模型命名/计价，附 36 个免费模型实测清单。
math: false
---

《魔搭社区深度研究》系列第 7 章（共 12 篇）。版本锚点（实测）：dashscope 1.27.7；魔搭 API-Inference 端点 `https://api-inference.modelscope.cn/v1` 实测 HTTP 200、36 个模型。

## 1. 机制定位

先纠正大纲假设：**魔搭免费 API-Inference 和 DashScope 不是「同一个 dashscope SDK 的两个后端」，是两个独立的 OpenAI 兼容端点**——不同 base_url、不同 key、不同模型命名、不同计费。

| | 免费 API-Inference | DashScope/百炼 | 本地 pipeline |
|---|---|---|---|
| 标记 | [平台] | [云] | [SDK] |
| base_url | api-inference.modelscope.cn/v1 | dashscope.aliyuncs.com/compatible-mode/v1 | 无 |
| key | 魔搭 SDK token | 阿里云 DashScope sk- key | 无 |
| 模型命名 | org/name（Qwen/Qwen3.8-Flash-Next） | 商业名（qwen-max） | 本地路径 |
| 计费 | 免费（有配额） | 按 token | 只烧自己 GPU |

**机制定位**：API-Inference 解决「不下载模型、不用 GPU，一行 OpenAI 风格调用用社区热门模型」；DashScope/百炼解决「生产级、有 SLA、按 token 计费」。

**边界（不该用）**：免费 API-Inference 生产不可靠（配额/限流/无 SLA/模型池活）；私有/自有微调模型走 DashScope 或 EAS；彻底控制推理细节走本地 pipeline。

## 2. 实操

魔搭免费 API-Inference（OpenAI SDK 直连）：

```python
from openai import OpenAI
client = OpenAI(
    api_key="<你的魔搭 SDK token>",       # 不是 DashScope sk- key
    base_url="https://api-inference.modelscope.cn/v1",
)
resp = client.chat.completions.create(
    model="Qwen/Qwen3.8-Flash-Next",     # org/name 格式
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.choices[0].message.content)
```

实测 `GET /v1/models` 返回 HTTP 200 + 36 个模型（匿名可查；带 token 的 chat 调用未做，token 类型标【需验证】）。当前模型节选：

```
deepseek-ai/DeepSeek-V4-Flash-0731   Qwen/Qwen3.5-122B-A10B
deepseek-ai/DeepSeek-V4-Pro          Qwen/Qwen3.8-Flash-Next
MiniMax/MiniMax-M3                   ZhipuAI/GLM-5.2
PaddlePaddle/ERNIE-4.5-21B-A3B-PT    OpenGVLab/InternVL3_5-241B-A28B
mistralai/Mistral-Large-Instruct-2407  stepfun-ai/Step-3.7-Flash
```

DashScope/百炼（dashscope SDK）：

```python
import dashscope
dashscope.api_key = "sk-..."   # 阿里云百炼控制台 DashScope key
resp = dashscope.Generation.call(
    model="qwen-max",           # 商业名，无 org 前缀
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.output.choices[0].message.content)
```

DashScope OpenAI 兼容模式：

```python
from openai import OpenAI
client = OpenAI(api_key="sk-...", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
```

dashscope 源码常量（`dashscope/common/env.py`）：`base_http_api_url = https://dashscope.aliyuncs.com/api/v1`；`base_compatible_api_url = .../compatible-mode/v1`；key env `DASHSCOPE_API_KEY`；多地域 `dashscope.set_region()` → `{workspace}.{region}.maas.aliyuncs.com`。

## 3. 架构分层

| 层 | 位置 | 说明 |
|---|---|---|
| 魔搭免费推理服务 | api-inference.modelscope.cn（闭源） | OpenAI 兼容网关，36 模型 |
| 魔搭 SDK 推理接口 | 无独立 InferenceClient | 仅 MCP 用 api-inference.modelscope.net |
| DashScope SDK | dashscope PyPI 包 → dashscope/client/、common/env.py | 原生 + OpenAI 兼容两套 |
| DashScope 服务端 | dashscope.aliyuncs.com | 百炼商用推理 |

域名坑（实测）：`.net` 的 `/v1/models` 404，`.cn` 的 `/v1/models` 才是推理网关（200）。`.net` 是 MCP 托管（第 8 章），`.cn` 是推理 API。

## 4. HF 对照表

| 概念 | HF | 魔搭 | 标注 |
|---|---|---|---|
| 免费在线推理 | Serverless Inference API（InferenceClient） | API-Inference（OpenAI 兼容） | 等价 |
| 免费鉴权 | HF token | 魔搭 SDK token | 等价 |
| 付费推理 | Inference Endpoints | 百炼/DashScope + EAS | 等价 |
| 付费 SDK | huggingface_hub / openai 兼容 | dashscope SDK / OpenAI 兼容 | 等价 |
| OpenAI 兼容 | 有 | 两条线都 OpenAI 兼容 | 等价 |
| 免费额度 | 月度 credits【需验证】 | 免费配额【需验证】 | 等价 |

关键差异：HF 免费推理有专属 `InferenceClient`；魔搭免费推理没有专属 SDK 类（直接用 OpenAI SDK 指 base_url）。魔搭 `dashscope` SDK 是商业专属，跟免费 API-Inference 两套东西。

## 5. 生产实践

四类坑（实测 + 源码）：

1. key 用错：DashScope sk- 连 modelscope.cn 或反过来，`AuthenticationError`。
2. 模型名用错：免费端点 org/name，DashScope 商业名；拿 qwen-max 连免费端点 404。
3. 域名用错：.net 是 MCP、.cn 是推理（.net 实测 404）。
4. 免费端点生产不可靠：模型池活（36 个随时变）、免费配额限流 `RateLimitError`、无 SLA。生产切 DashScope 或 EAS。

OpenAI 兼容模式下错误以 OpenAI 异常抛出（AuthenticationError/BadRequestError/RateLimitError）。

## 6. 时效性检查

- 免费端点域名【需验证】：`curl https://api-inference.modelscope.cn/v1/models`。
- 免费模型池（36，活列表）【需验证】：同上。
- 免费配额数字【需验证】：modelscope.cn/docs 的 API-Inference 章节。
- token 类型（魔搭 SDK token）【需验证】：模型页 → API-Inference → 示例代码 api_key 取值。
- DashScope 端点与模型名【需验证】：dashscope/common/env.py + 百炼控制台。
- MaaS 多地域【需验证】：dashscope/common/env.py 的 MAAS_REGIONS。

## 7. 自检题

**Q1** sk- 开头的 key 连 api-inference.modelscope.cn 报 AuthenticationError，同事说「魔搭和 DashScope 是同一个东西」。怎么纠正？
→ 两个独立系统：免费 API-Inference 用魔搭 token + modelscope.cn + org/name；DashScope 用 sk- + dashscope.aliyuncs.com + 商业名。证据：dashscope SDK base_compatible_api_url 指 aliyuncs.com，魔搭免费端点域名 modelscope.cn。

**Q2** 上生产推理，评估免费 API-Inference vs 百炼各有什么致命问题？
→ 免费：模型池活、配额限流、无 SLA；百炼：付费有 SLA。生产用百炼/EAS，免费只做原型。

**Q3** `client.chat.completions.create(model="qwen-max", ...)` 连 api-inference.modelscope.cn 报 404，改哪里？
→ 模型名错：免费端点用 org/name（Qwen/Qwen3.8-Flash-Next），qwen-max 是 DashScope 商业名。改模型名或改 base_url。

## 系列导航

《魔搭社区深度研究》全 12 篇：0 HF 生态速览 / 1 平台与生态版图 / 2 模型下载与 SDK / 3 pipeline 推理 / 4 MsDataset 数据集 / 5 训练微调（ms-swift vs LLaMA-Factory）/ 6 创空间部署 / 7 API-Inference 推理服务 / 8 MCP 广场与 Agent 生态 / 9 免费资源额度与付费路径 / 10 License 与商用合规 / 11 HF 模型互操作与迁移路径。
