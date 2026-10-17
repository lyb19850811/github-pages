---
report: 50
title: 魔搭研究 · 第 9 章：免费资源额度与付费路径
date: 2026-10-18
tags: [modelscope, quota, cost, deployment]
summary: 魔搭免费资源与付费路径：免费档实测（2v-cpu-8g-mem）、QuotaExceededError vs RateLimitError、百炼按 token vs EAS 按资源小时的成本模型。
math: false
---

《魔搭社区深度研究》系列第 9 章（共 12 篇）。版本锚点（实测）：modelscope 1.40.2 / modelscope_hub 0.4.6。所有额度数字标【需验证】，免费/付费结构用线上 API 实测。

## 1. 机制定位

纠正第 6 章一个结论：创空间**有**程序化接口，只是藏在 `modelscope_hub`（`HubApi.create_studio` / `list_studio_hardware` + `ms studio` CLI），不在 `modelscope` 框架包。

本章核心问题：免费和付费的边界在哪、怎么查、什么时候必切付费。三套资源三套成本模型：

| 资源 | 标记 | 成本模型 | 免费档 |
|---|---|---|---|
| 创空间 | [平台] | 免费档按应用实例，付费档按实例类型 | CPU 免费档 |
| 免费 Notebook | [平台] | GPU 时长配额 | 有（【需验证】） |
| API-Inference | [平台] | 免费调用额度 | 免费（36 模型） |
| 百炼 DashScope | [云] | 按 token | 无 |
| EAS/ECS | [云] | 按资源·小时 | 无 |

铁律：一旦要 SLA、稳定性、可预测成本，就切 [云]；[平台] 免费档只做原型/demo/学习。

## 2. 实操

查免费/付费硬件档（匿名实测）：

```python
from modelscope_hub.api import HubApi
api = HubApi()
hw = api.list_studio_hardware()
print(hw)
```

匿名实测（只返回免费档）：

```json
[{"name": "platform/2v-cpu-8g-mem",
  "resource_type": "free",
  "supported_sdk_types": ["gradio", "streamlit", "docker", "static"]}]
```

登录后同接口额外返回付费档（resource_type="paid"，带价格），选中 `paid/<instance_type>`。

查基础镜像和 gradio 版本（实测）：

```python
api.list_studio_base_images()                 # ubuntu22.04-py311-torch2.3.1 等
api.list_studio_sdk_versions(sdk_type="gradio")  # 3.35.2 ... 5.34.1
```

`ms studio` CLI（modelscope_hub 实测源码）：子命令 `list / deploy / stop / logs / settings / secret / variable / hardware / base-images / sdk-versions`；`ms studio hardware` 带 gpu_type、stock（库存）、cost（价格）。

免费 Notebook / API-Inference 额度：SDK 无接口，只能平台查（modelscope.cn 配额页 / 调用时限流报错暴露）。

## 3. 架构分层

| 层 | 位置 | 说明 |
|---|---|---|
| 免费/付费硬件档 | `modelscope_hub/api.py` → list_studio_hardware | anonymous 只看 free，登录看 paid |
| 硬件档 CLI | `modelscope_hub/cli/studio.py` → _StudioHardware | stock/cost，硬件类型 xgpu/amd |
| 配额错误 | `modelscope_hub/errors.py` → QuotaExceededError(E3027) | 见生产实践 |
| 付费云部署 | `modelscope/hub/deploy.py` → ServiceDeployer | EAS 机型计费 |
| 框架常量 | `modelscope/utils/constant.py` → StudioHardware | 滞后于线上（见下） |

「常量滞后」实锤：框架常量写 `CPU_2V_16G = 'platform/2v-cpu-16g-mem'`（16GB），线上匿名实测返回 `platform/2v-cpu-8g-mem`（8GB）。框架常量跟不上平台策略调整。

## 4. HF 对照表

| 概念 | HF | 魔搭 | 标注 |
|---|---|---|---|
| 免费推理额度 | Serverless 月度 credits | API-Inference 免费额度 | 等价 |
| 免费应用托管 | Spaces 免费 CPU basic | 创空间免费 2v-cpu-8g-mem | 等价 |
| 免费 GPU 托管 | Spaces GPU basic | 创空间 GPU 档（归属【需验证】） | 等价 |
| 免费 Notebook | Colab（非 HF） | 魔搭免费 Notebook | 等价 |
| 付费订阅 | HF PRO（【需验证】） | 无订阅，按 token/资源计费 | 各有侧重 |
| 付费推理 | Endpoints（按小时） | 百炼（按 token）+ EAS（按小时） | 等价 |
| 配额报错 | HTTP 429 | QuotaExceededError(403) + RateLimitError(429) | 魔搭增强 |

## 5. 生产实践

配额 vs 限流（源码精确定义）：

- `RateLimitError`（HTTP 429，RateLimitExceed）：可重试，限流自己恢复。
- `QuotaExceededError`（HTTP 403，QuotaLimitExceed，E3027）：不可重试，配额耗尽持续失败。suggestion：「Free up existing resources or request a higher quota.」

成本模型选型：按 token（百炼）= 流量型弹性；按资源·小时（EAS/ECS）= 常驻可预测；免费档 = 0 元但有配额/休眠/无 SLA。免费档坑：创空间休眠（SLEEPING）、API-Inference 模型池活、免费 Notebook 排队。

## 6. 时效性检查

- 免费 CPU 档规格（线上 2v-cpu-8g-mem，框架常量 16g）【需验证】：`api.list_studio_hardware()` 匿名实测，别信常量。
- 免费 Notebook GPU 机型/时长/排队【需验证】：modelscope.cn 免费 Notebook 创建页 + 官方文档。
- API-Inference 免费额度【需验证】：官方文档 + 实测触发限流。
- 付费档价格【需验证】：`ms studio hardware`（登录）或创空间创建页。
- 百炼按 token 价格【需验证】：百炼控制台定价页。
- EAS 机型（ecs.c6/gn5/gn6）【需验证】：`modelscope/hub/deploy.py` + 阿里云 EAS 文档。

## 7. 自检题

**Q1** 创空间部署请求报 HTTP 403 QuotaLimitExceed，退避重试 3 次仍失败。为什么重试没用？正确动作？
→ QuotaExceededError(E3027) 是配额耗尽不是限流，持续失败，重试只延迟看到错误。动作：释放资源（停占用的 Space/实例）或提额。

**Q2** 读了 `constant.py` 的 `CPU_2V_16G = 'platform/2v-cpu-16g-mem'`，硬编码了这个免费档字符串。为什么错？
→ 常量滞后：线上匿名 list_studio_hardware 实测返回 2v-cpu-8g-mem（8GB）不是 16GB。运行时查 API 而非读常量。

**Q3** 固定 QPS、7×24 常驻推理服务，评估免费 API-Inference / 百炼按 token / EAS 按资源小时，选哪个？
→ 免费排除（无 SLA/模型池活/配额）；固定 QPS 常驻选 EAS 按资源小时（成本可预测、自托管）；百炼按 token 适合弹性流量。

## 系列导航

《魔搭社区深度研究》全 12 篇：0 HF 生态速览 / 1 平台与生态版图 / 2 模型下载与 SDK / 3 pipeline 推理 / 4 MsDataset 数据集 / 5 训练微调（ms-swift vs LLaMA-Factory）/ 6 创空间部署 / 7 API-Inference 推理服务 / 8 MCP 广场与 Agent 生态 / 9 免费资源额度与付费路径 / 10 License 与商用合规 / 11 HF 模型互操作与迁移路径。
