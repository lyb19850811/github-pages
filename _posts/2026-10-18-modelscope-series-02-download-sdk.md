---
report: 43
title: 魔搭研究 · 第 2 章：模型下载与 SDK
date: 2026-10-18
tags: [modelscope, sdk, huggingface, download]
summary: modelscope 下载层与 huggingface_hub 逐项对照：snapshot_download 签名、缓存结构差异、默认分支 master、环境变量、断点续传与国内下载速度优势。
math: false
---

《魔搭社区深度研究》系列第 2 章（共 12 篇）。版本锚点（实测）：modelscope 1.40.2 / modelscope_hub 0.4.6。

## 1. 机制定位

魔搭下载层解决的唯一硬问题：**国内网络下稳定快速拉取模型/数据集权重**。它存在的理由就是第 0 章的实测——huggingface.co 直连超时（000/8s），modelscope.cn 秒回（302/0.4s）。下载走阿里云 OSS/CDN。

**边界（不该用）**：模型只在 HF 有、魔搭没有；只是 `from_pretrained` 加载、缓存已有；平台内（Notebook/创空间）已预置缓存；私有/gated 模型需 token。

## 2. 实操

```bash
pip install modelscope
python -c "import modelscope; print(modelscope.__version__)"  # 1.40.2
```

单文件下载（匿名成功）：

```python
from modelscope.hub.file_download import model_file_download
p = model_file_download("Qwen/Qwen2.5-7B-Instruct", "config.json")
print(p)
# ~/.cache/modelscope/models/Qwen--Qwen2.5-7B-Instruct/snapshots/master/config.json
```

整仓库（带过滤）：

```python
from modelscope import snapshot_download
p = snapshot_download("Qwen/Qwen2.5-7B-Instruct", allow_patterns=["config.json", "tokenizer.json", "*.md"])
```

`snapshot_download` 完整签名：

```python
snapshot_download(
    model_id=None, revision=None, cache_dir=None, user_agent=None,
    local_files_only=False, cookies=None, ignore_file_pattern=None,
    allow_file_pattern=None, local_dir=None, allow_patterns=None,
    ignore_patterns=None, max_workers=None, repo_id=None, repo_type=None,
    progress_callbacks=None, token=None, endpoint=None,
) -> str
```

下载→加载闭环：

```python
from modelscope import snapshot_download
from transformers import AutoModelForCausalLM
local_path = snapshot_download("Qwen/Qwen2.5-7B-Instruct")
model = AutoModelForCausalLM.from_pretrained(local_path)  # 本地路径，零网络
```

## 3. 架构分层

关键架构事实：modelscope 1.40.2 已把 hub 层拆成独立包 `modelscope_hub`。`modelscope/hub/` 是 shim 兼容层，真正干活的是 `modelscope_hub`。

| 层 | 位置 | 作用 |
|---|---|---|
| shim | `modelscope/hub/file_download.py`、`snapshot_download.py` | 保持旧签名转发 |
| 下载引擎 | `modelscope_hub`（独立 pip 包） | 下载/缓存/上传 |
| 常量 | `modelscope_hub.compat.constants` | 域名/缓存/环境变量 |
| 服务端 | modelscope.cn API | 文件清单 + 下载 |

下载 URL 对比：HF `https://huggingface.co/{org}/{repo}/resolve/{rev}/{file}`（路径式）；魔搭 `https://www.modelscope.cn/api/v1/models/{org}/{repo}/repo?Revision={rev}&FilePath={file}`（查询式）。魔搭先调目录树接口 `.../repo/files?Revision=master&Recursive=True` 拿清单。

缓存结构对比：HF `~/.cache/huggingface/hub/models--{org}--{repo}/snapshots/{sha}/`；魔搭 `~/.cache/modelscope/models/{org}--{repo}/snapshots/master/`。三个坑：根目录不同、HF 带 `models--` 前缀、snapshot 用 commit sha（HF）vs revision 名（魔搭默认 master）。

## 4. HF 对照表

| 概念 | HF | 魔搭 | 标注 |
|---|---|---|---|
| 下载整仓库 | snapshot_download | snapshot_download（同名） | 等价 |
| 下载单文件 | hf_hub_download | model_file_download | 等价 |
| 下载数据集 | snapshot_download(repo_type="dataset") | dataset_snapshot_download | 等价 |
| 缓存根目录 | ~/.cache/huggingface/hub（HF_HOME） | ~/.cache/modelscope（MODELSCOPE_CACHE） | 等价（env 名不同） |
| 默认分支 | main | master | 魔搭独有（坑） |
| snapshot 目录 | commit SHA | revision 名 | 魔搭独有 |
| token | HF_TOKEN | MODELSCOPE_API_TOKEN | 等价 |
| 下载 URL | /resolve/ 路径式 | /api/v1/.../repo 查询式 | 魔搭独有 |
| 镜像 | hf-mirror（第三方） | 官方国内站 + 国际站 modelscope.ai | 魔搭增强 |
| gated | GatedRepoError | GatedMode/ProtectedMode | 等价 |

## 5. 生产实践

- 国内速度：huggingface.co 000/8s vs modelscope.cn 302/0.4s。国内训练/推理机权重下载，魔搭是首选。
- 断点续传：源码 `http_get_model_file` 用 `Range: bytes={partial}-{size-1}` + 检测 `partial_length`；重试 `Retry(total=5, backoff_factor=1)`。
- 环境变量：`MODELSCOPE_DOWNLOAD_PARALLELS`（默认 1）、`MODELSCOPE_PARALLEL_DOWNLOAD_THRESHOLD_MB`（默认 500）、`MODELSCOPE_API_HTTP_CLIENT_TIMEOUT`（默认 90）、`MODELSCOPE_ENABLE_DEFAULT_HASH_VALIDATION`。
- 公共模型匿名无配额；私有需 `MODELSCOPE_API_TOKEN` 或 `~/.modelscope/credentials`。

典型报错（实测，下不存在的模型）：

```
requests.exceptions.HTTPError: [E3020] [404] 获取模型目录树失败，信息：record not found ... | code=10010205001
  Request: GET https://modelscope.cn/api/v1/models/{org}/{repo}/repo/files?Revision=master&Recursive=True
```

排查：异常类型是裸 `requests.exceptions.HTTPError`；`code=10010205001` + `record not found` = 模型 id 不存在（不是网络）；报错里印了请求 URL，先核对 `{org}/{repo}`。

## 6. 时效性检查

- modelscope_hub 拆分（1.38 后新架构）【需验证】：`pypi.org/pypi/modelscope-hub/json`。
- 缓存目录结构【需验证】：`modelscope_hub/_download.py` docstring。
- 国际站域名 www.modelscope.ai【需验证】：`modelscope_hub.compat.constants` 的 `DEFAULT_MODELSCOPE_INTL_DOMAIN`。
- env 改名（MODELSCOPE_DOMAIN → MODELSCOPE_ENDPOINT）【需验证】：`modelscope_hub/config.py`。
- 下载额度数字未公开【需验证】：以实测为准。
- max_workers 不一致（shim 4 vs hub 8）【需验证】。

## 7. 自检题

**Q1** 两台机器下同一模型（阿里云 ECS 北京 vs AWS us-west），默认 endpoint 各是什么？缓存路径一致吗？
→ 国内 www.modelscope.cn，国际站 www.modelscope.ai（.ai 不是 .com/.co）。缓存都是 `~/.cache/modelscope/models/{org}--{repo}/snapshots/{rev}/`，与 HF 的 `models--` 前缀 + commit sha 不同。

**Q2** 下 2GB 模型 kill 重跑，重新下还是续传？依据？
→ 续传。`Range` 头 + `partial_length` 检测。

**Q3** 内网代理下 modelscope.cn 连不上，列三个可改出口，哪个最稳？
→ ① `MODELSCOPE_ENDPOINT` 指向内网可达 endpoint；② `local_files_only=True`/cache_dir 指向已有缓存；③ HTTP 代理。最稳是 endpoint 覆盖 + 内网缓存兜底。

## 系列导航

《魔搭社区深度研究》全 12 篇：0 HF 生态速览 / 1 平台与生态版图 / 2 模型下载与 SDK / 3 pipeline 推理 / 4 MsDataset 数据集 / 5 训练微调（ms-swift vs LLaMA-Factory）/ 6 创空间部署 / 7 API-Inference 推理服务 / 8 MCP 广场与 Agent 生态 / 9 免费资源额度与付费路径 / 10 License 与商用合规 / 11 HF 模型互操作与迁移路径。
