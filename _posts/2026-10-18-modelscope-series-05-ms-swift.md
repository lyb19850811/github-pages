---
report: 46
title: 魔搭研究 · 第 5 章：训练微调（ms-swift vs LLaMA-Factory）
date: 2026-10-18
tags: [modelscope, fine-tuning, lora, llm]
summary: ms-swift 与 LLaMA-Factory 的定位差异与选型矩阵：两者同是 transformers 底座上的应用层，差异在生态绑定、多模态、Megatron/GRPO 与一条龙部署。
math: false
---

《魔搭社区深度研究》系列第 5 章（共 12 篇）。版本锚点（实测）：ms-swift 4.6.0 / llamafactory 0.9.5。

## 1. 机制定位

决定性结论：

> ms-swift 和 LLaMA-Factory 是同一个物种——都是「包在 transformers/peft/trl/accelerate/datasets 之上的应用层」。都不重造训练底座，差异在覆盖广度和生态绑定方向。

两边 PyPI 核心依赖对比：

| 依赖 | ms-swift 4.6.0 | llamafactory 0.9.5 |
|---|---|---|
| 训练底座 | transformers `<5.20,>=4.33` + peft `<0.21,>=0.11` + trl `<1.0,>=0.15` | transformers `<=5.6,>=4.55` + peft `<=0.18.1` + trl `<=0.24` |
| 下载层 | **modelscope>=1.23 + oss2** | modelscope（无 pin）+ hf-transfer |
| WebUI | 无（gradio 不在 core，可选 swift web-ui） | **gradio（core，WebUI 一等公民）** |
| 推理服务 | fastapi/uvicorn + openai | fastapi/uvicorn + sse-starlette |
| torch | 不在 core（放 extras） | torch>=2.4（core） |
| Python | >=3.9 | >=3.11 |

一句话定位：LLaMA-Factory = 训练工具（WebUI 优先、通用 HF、文本模型 100+、单机 LoRA 最顺手）；ms-swift = 训练→推理→评估→量化→部署一条龙（CLI 优先、强绑魔搭、600+ 文本 + 400+ 多模态、Megatron/GRPO/量化训练/国产卡）。

**边界（ms-swift 不该用）**：只要单机文本 LoRA SFT 且团队已熟 LLaMA-Factory、不迁魔搭 → 继续 LLaMA-Factory；极致定制 loss/forward → 直接 transformers+peft 裸写；不绑阿里生态 → ms-swift 的「一条龙」价值（回灌魔搭/创空间部署）打折扣。

## 2. 实操

```bash
pip install ms-swift -U
# WebUI → 装 gradio；eval → ms-swift[eval]；Megatron → ms-swift[megatron]
```

LoRA SFT（官方 10 分钟示例，Qwen3-4B 单卡 3090）：

```bash
CUDA_VISIBLE_DEVICES=0 \
swift sft \
    --model Qwen/Qwen3-4B-Instruct-2507 \
    --tuner_type lora \
    --dataset 'AI-ModelScope/alpaca-gpt4-data-zh#500' \
              'AI-ModelScope/alpaca-gpt4-data-en#500' \
              'swift/self-cognition#500' \
    --torch_dtype bfloat16 --num_train_epochs 1 \
    --per_device_train_batch_size 1 --learning_rate 1e-4 \
    --lora_rank 8 --lora_alpha 32 --target_modules all-linear \
    --gradient_accumulation_steps 16 --max_length 2048 \
    --output_dir output --model_author swift --model_name swift-robot
```

`--dataset '...#500'` 是子采样语法（取前 500 条）。默认从魔搭下载，切 HF 加 `--use_hf true`。

训练完推理：

```bash
swift infer --adapters output/vx-xxx/checkpoint-xxx --stream true --temperature 0 --max_new_tokens 2048
```

回灌魔搭：

```bash
swift export \
    --adapters output/vx-xxx/checkpoint-xxx \
    --push_to_hub true \
    --hub_model_id '<your-namespace>/<your-model-name>' \
    --hub_token '<你的魔搭 SDK token>' \
    --use_hf false
```

`swift export` 做三件事：合并 LoRA → 打包标准目录 → 推到魔搭模型库。

CLI 全子命令（源码 `swift/cli/main.py` 的 ROUTE_MAPPING）：

```
pt  sft  infer  merge-lora  web-ui  deploy  rollout  rlhf  sample  export  eval  app
```

对比 LLaMA-Factory 的 `llamafactory-cli train|chat|export|webui`，ms-swift 多 `deploy`（OpenAI 兼容）和 `eval`（EvalScope）。

## 3. 架构分层

仓库 `github.com/modelscope/ms-swift`（Apache-2.0），包名 `swift`，PyPI 名 `ms-swift`。入口点（setup.py）：`swift = swift.cli.main:cli_main`、`megatron = swift.cli._megatron.main:cli_main`。

| 层 | 位置 | 作用 |
|---|---|---|
| CLI 路由 | `swift/cli/main.py` → ROUTE_MAPPING | 12 子命令 → `swift/cli/*.py` |
| 训练器 | `swift/trainers/`（Seq2SeqTrainer） | 包 transformers Trainer |
| 模型层 | `swift/model/models/`（qwen.py 等） | 模型注册/chat template |
| 数据处理 | `swift/llm/` + `swift/dataset/` | 加载 + encode + packing |
| 下载层 | 依赖 modelscope + oss2 | 默认魔搭下载 |
| Megatron | `swift/cli/_megatron/` | TP/PP/SP/CP/EP 并行 |

关键：CLI 自动判断是否 torchrun（`use_torchrun()` + `get_torchrun_args()`），多卡自动包 torchrun；支持 YAML 传参（`parse_yaml_args`）。

## 4. HF 对照表（选型矩阵）

| 概念 | HF 生态 | LLaMA-Factory | ms-swift | 标注 |
|---|---|---|---|---|
| 训练器 | Trainer | 包一层 | 包一层 | 等价 |
| SFT | Trainer + collator | ✅ | ✅ | 等价 |
| LoRA | peft.LoraConfig | ✅ | ✅（--tuner_type lora） | 等价 |
| DPO/RLHF | trl.DPOTrainer | ✅（DPO/KTO/ORPO/PPO） | ✅（DPO/KTO/RM/CPO/SimPO/ORPO） | 等价 |
| GRPO 家族 | 手写 | ❌ | ✅（GRPO/DAPO/GSPO/SAPO/CISPO/RLOO/Reinforce++） | 魔搭独有 |
| Megatron TP/PP/CP/EP | 自装 | ❌ | ✅（megatron 入口） | 魔搭独有 |
| 多模态训练 | 手写 | 有限 | ✅（400+ 多模态，packing） | 魔搭增强 |
| 量化训练 | bitsandbytes 手接 | ✅（QLoRA） | ✅（BNB/AWQ/GPTQ/AQLM/HQQ/EETQ，7B 9GB） | 魔搭增强 |
| 推理加速 | vLLM/TGI 手接 | 无内置 | ✅（vLLM/SGLang/LMDeploy） | 魔搭增强 |
| 评估 | lm-eval 手接 | ❌ | ✅（EvalScope 100+） | 魔搭独有 |
| 部署服务 | TGI/vLLM serve | 基础 API | ✅（swift deploy OpenAI 兼容） | 魔搭增强 |
| WebUI | —— | ✅ 一等公民 | ✅ 可选 | 各有侧重 |
| 下载默认源 | HF | HF（hf-transfer） | 魔搭（--use_hf 切 HF） | 魔搭独有 |
| 国产卡 | 社区 patch | 弱 | ✅（昇腾/MUSA/MetaX/ROCm） | 魔搭独有 |

选型：

| 场景 | 选谁 | 理由 |
|---|---|---|
| 单机文本 LoRA SFT、已熟、要 WebUI | LLaMA-Factory | 迁移成本为负 |
| 多模态（Qwen-VL）微调 | ms-swift | LLaMA-Factory 多模态弱 |
| 大模型/MoE 全参或大规模并行 | ms-swift | Megatron TP/PP/CP/EP |
| RLHF（GRPO/DeepSeek-R1 风格） | ms-swift | GRPO 家族 + vLLM 引擎 |
| 一条龙（训→评→量化→部署 OpenAI） | ms-swift | deploy/eval/export 闭环 |
| 绑定魔搭生态（回灌/创空间/百炼） | ms-swift | 默认魔搭 + export --push_to_hub |
| 国产卡 | ms-swift | 硬件支持硬需求 |
| 已有成熟 LLaMA-Factory 流水线、不迁 | LLaMA-Factory | 稳，别折腾 |

## 5. 生产实践

- 国内下载：ms-swift 默认魔搭，省掉配 hf-mirror 的折腾。
- 显存：量化训练 7B 只需 ~9GB（单张 3090 可跑）；7B LoRA 全流程 13GB。
- GRPO 支持 72B 4×80G（README 示例）；Megatron 对 MoE 有显著加速（Xing4.0 报告 ~3.7x）。
- 报错：`swift --help` 报 `KeyError: '--help'`（子命令优先，用 `swift sft --help`）；数据集 id 失效（NotExistError，第 4 章）；模型 id 在 HF 侧却忘 `--use_hf`（NotExistError）；transformers 版本（ms-swift pin `<5.20`，5.20.1 崩魔搭原生模型）。

## 6. 时效性检查

- ms-swift 版本（4.0 于 2026-03-03 发布，当前 4.6.0）【需验证】：`github.com/modelscope/ms-swift/releases`。
- 模型/数据集覆盖数（600+/400+）【需验证】：README 模型列表。
- 版本推荐表（torch 2.8/2.11、transformers 4.57.6/5.12.1）【需验证】：README "Running Environment"。
- GRPO/Megatron 支持范围【需验证】：README News 区块。
- 量化训练 7B 9GB【需验证】：README + 量化章节。
- `--push_to_hub` 参数名【需验证】：`swift export --help`。
- LLaMA-Factory 切魔搭 env 变量名【需验证】：LLaMA-Factory 源码。

## 7. 自检题

**Q1** 团队要微调 Qwen2.5-VL（多模态）并部署成 OpenAI 兼容接口，LLaMA-Factory 和 ms-swift 各缺什么？选谁？
→ LLaMA-Factory 多模态弱、无内置 deploy/eval；ms-swift 两者内置（swift sft 多模态 + swift deploy + swift eval）。选 ms-swift。

**Q2** `swift sft --model Qwen/Qwen2.5-7B-Instruct --dataset '...#500'` 报 NotExistError，怀疑下载源错，怎么确认+改？
→ 确认模型/数据集在哪个 hub。写的是 HF id 却没加 `--use_hf true`，ms-swift 默认去魔搭找导致 not found。加 `--use_hf true` 或换魔搭 id。

**Q3** 产出 LoRA 适配器（checkpoint-xxx），要同事在 modelscope.cn 上 `swift sft --model <你的id>` 直接续训，完整步骤+三个关键参数？
→ `swift export --adapters checkpoint-xxx --push_to_hub true --hub_model_id <ns>/<name> --hub_token <token> --use_hf false`。关键：--adapters（源）、--push_to_hub true（触发上传）、--hub_model_id（目标）。export 同时做合并 LoRA + 打包 + 上传。

## 系列导航

《魔搭社区深度研究》全 12 篇：0 HF 生态速览 / 1 平台与生态版图 / 2 模型下载与 SDK / 3 pipeline 推理 / 4 MsDataset 数据集 / 5 训练微调（ms-swift vs LLaMA-Factory）/ 6 创空间部署 / 7 API-Inference 推理服务 / 8 MCP 广场与 Agent 生态 / 9 免费资源额度与付费路径 / 10 License 与商用合规 / 11 HF 模型互操作与迁移路径。
