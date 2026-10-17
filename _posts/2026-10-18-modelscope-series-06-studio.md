---
report: 47
title: 魔搭研究 · 第 6 章：创空间部署
date: 2026-10-18
tags: [modelscope, deployment, gradio, studio]
summary: 魔搭创空间（Studio）部署：SDK 类型/硬件档/状态机实测，模型挂载方式，以及 SDK 侧 ServiceDeployer→EAS 的付费云出口。
math: false
---

《魔搭社区深度研究》系列第 6 章（共 12 篇）。版本锚点（实测）：modelscope 1.40.2 / modelscope_hub 0.4.6。

## 1. 机制定位

创空间（Studio）解决：把 Gradio/Streamlit 应用托管到 modelscope.cn，获得公网 URL，免费 CPU/GPU 跑 demo。等价 HF Spaces。

决定性结论：

> 创空间是纯 [平台]（网站）能力，`modelscope` 框架包没有 SDK；但 `modelscope_hub` 包（拆分层）有 `HubApi.create_studio` / `list_studio_hardware` 和一个 `ms studio` CLI（第 9 章详述）。

**边界（不该用）**：稳定/SLA/自动扩缩容生产推理 → `ServiceDeployer`（EAS）或百炼；程序化批量管理 Space → 魔搭支持有限（git + 网站 + modelscope_hub）；训练/长任务 → 免费 Notebook 或 ECS。

## 2. 实操

创建 Space（网站）→ 选 SDK 类型（四选一，源码 `StudioSDKType`）：`gradio / streamlit / docker / static`。硬件档（源码 `StudioHardware`）：`CPU_2V_16G`（platform/2v-cpu-16g-mem，免费）/ `GPU_16G` / `GPU_48G`。

写 `app.py`（挂魔搭模型）：

```python
import gradio as gr
from modelscope.pipelines import pipeline

p = pipeline("sentiment-classification",
             model="damo/nlp_structbert_sentiment-classification_chinese-base",
             device="cpu")

def predict(text):
    out = p(text)
    return {out["labels"][0]: float(out["scores"][0])}

gr.Interface(fn=predict, inputs="text", outputs="label").launch()
```

挂模型三种方式：`pipeline(task, model)` 自动下载（第 3 章）；`snapshot_download` 手动下载再 `from_pretrained(local)`（第 2 章）；平台预置（【需验证】列表）。

`requirements.txt`（平台 build 时安装）：

```
modelscope[framework]
gradio
transformers==4.55.0
```

git push 后平台按 `StudioStatus` 状态机构建：`INITIALIZED → BUILDING → DEPLOYING → RUNNING`（还有 BUILD_FAILED/DEPLOY_FAILED/SLEEPING/STOPPED）。

## 3. 架构分层

| 层 | 位置 | 说明 |
|---|---|---|
| 平台（网站） | modelscope.cn 创空间 | 创建/配置/构建/运行，闭源 |
| SDK 常量 | `modelscope/utils/constant.py` → StudioSDKType/StudioHardware/StudioStatus | 字符串枚举 |
| SDK 云部署 | `modelscope/hub/deploy.py` → ServiceDeployer | 部署到 PAI EAS |
| 应用 SDK | Gradio / Streamlit（复用） | 跑你的 app.py |

关键区分：创空间 = [平台]（免费托管 demo）；`ServiceDeployer` = [云]（`create(model_id, revision, instance_name, resource, provider)` 部署到 EAS，需 `access_key_id`/`access_key_secret`，付费）。EAS 实例规格源码：CPU `ecs.c6.2xlarge/4xlarge/6xlarge/8xlarge`，GPU `ecs.gn5/gn6i/gn6e` 系列。

## 4. HF 对照表

| 概念 | HF Spaces | 魔搭创空间 | 标注 |
|---|---|---|---|
| 应用托管 | Spaces | 创空间 | 等价 |
| SDK 类型 | Gradio/Streamlit/Static/Docker | 同名四类 | 等价 |
| 免费 CPU 档 | CPU basic | CPU_2V_16G | 等价 |
| 免费 GPU 档 | GPU basic | GPU_16G/GPU_48G（免费/付费归属【需验证】） | 等价 |
| 休眠 | Spaces 免费档 idle 休眠 | StudioStatus.SLEEPING | 等价 |
| secrets | Spaces 设置页 | 创空间设置页（【需验证】） | 等价 |
| 程序化创建 | huggingface_hub space API | modelscope_hub（第 9 章）+ git | 各有（不同层） |
| 部署方式 | git push / gradio deploy | git push / 网站上传 | 等价 |
| 模型挂载 | snapshot_download / env 预置 | snapshot_download / pipeline 自动下载 | 等价 |
| 转生产推理 | Inference Endpoints | ServiceDeployer（EAS）/ 平台转 API | 等价（云不同） |

## 5. 生产实践

- 冷启动：免费档空闲进 SLEEPING，下次访问重拉，首次加载模型延迟明显。生产别指望免费档。
- 挂模型坑：免费 CPU 档上 `pipeline` 默认 device=gpu 会失败（显式 device="cpu"）；requirements.txt 不 pin transformers==4.55.0 → 平台装最新 5.20.x 崩（is_decoder，第 3 章）；私有模型需 `MODELSCOPE_API_TOKEN` 或 `~/.modelscope/credentials`。
- build 失败常见根因：requirements.txt 缺 extras（裸 modelscope 缺 addict/datasets，报 `ModuleNotFoundError: No module named 'addict'`），写 `modelscope[framework]`。

## 6. 时效性检查

- 免费/付费档归属【需验证】：modelscope.cn 创空间创建页 + 官方文档。
- 免费 CPU 档规格【需验证】：`StudioHardware`。
- SDK 类型集合【需验证】：`StudioSDKType`。
- 一键转 API-Inference/百炼路径【需验证】：创空间页面「部署」按钮。
- EAS 实例类型【需验证】：`modelscope/hub/deploy.py` + 阿里云 EAS 文档。
- 是否新增创空间 SDK【需验证】：`pip index versions modelscope-studio`。

## 7. 自检题

**Q1** 创空间部署私有模型，`app.py` 里 `snapshot_download("你的org/私有模型")`，能匿名下载成功吗？需要什么？
→ 不能，private 需认证。Space 环境配 `MODELSCOPE_API_TOKEN` 或登录凭证，或 `snapshot_download(..., token=...)`。token 别写进 app.py（git 推走泄露）。

**Q2** `pip install modelscope` 后想「用 SDK 部署创空间」发现没对应 API，说明什么？正确方式？
→ 创空间是纯 [平台] 能力，框架 SDK 只暴露常量 + EAS 部署（ServiceDeployer）。正确：git push / 网站操作（modelscope_hub 有 ms studio CLI）。

**Q3** 免费 CPU 档 `pipeline("text-generation", model="damo/某LLM")` 没显式传 device，会发生什么？
→ 魔搭 pipeline 默认 device=gpu，免费 CPU 档无 GPU 失败。改 device="cpu"。

## 系列导航

《魔搭社区深度研究》全 12 篇：0 HF 生态速览 / 1 平台与生态版图 / 2 模型下载与 SDK / 3 pipeline 推理 / 4 MsDataset 数据集 / 5 训练微调（ms-swift vs LLaMA-Factory）/ 6 创空间部署 / 7 API-Inference 推理服务 / 8 MCP 广场与 Agent 生态 / 9 免费资源额度与付费路径 / 10 License 与商用合规 / 11 HF 模型互操作与迁移路径。
