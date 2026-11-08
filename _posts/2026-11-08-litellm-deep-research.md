---
report: 75
title: LiteLLM 深度研究：开源 AI 网关的 SDK 统一调用、路由策略与 FastAPI 网关架构
date: 2026-11-08
tags: [litellm, ai-gateway, llm, openai, fastapi, router, llmops, berriai]
summary: 从 litellm 1.108.3 本地源码与 PyPI/GitHub 一手数据核验 LiteLLM：BerriAI 出品（YC W23）的开源 AI 网关，一套 OpenAI 格式统一调用 100+ LLM；深挖 SDK 的 @client 装饰器与模型字符串解析、Router 多策略路由（least_busy/lowest_cost/latency/tpm_rpm 等）、Proxy 网关的 FastAPI 架构与虚拟密钥/预算/护栏，以及 Portkey、OpenRouter、one-api·new-api 等竞品矩阵与缺点。
math: false
---

LiteLLM 是 LLM 工程里「一个 API 调百模」的事实标准之一，也是本仓库 AnythingLLM、Mem0 两篇报告里被反复当作「LLM 供应商」列举、却从未被拆开研究的对象。本文基于**本地安装的 litellm 1.108.3**（Python 3.14 venv）源码 + PyPI/GitHub 一手数据 + 本地实测，回答五个问题：**谁/何时推出 → 设计目标 → 特点 → 使用场景 → 底层实现原理 → 缺点与竞品**。读者定位：资深后端/LLM 应用工程师，默认会用 `completion()`，聚焦「黑箱」内部与选型边界。

## 一、结论先行

- **LiteLLM 是「AI 网关」，不是模型、不是推理引擎。** 它把自己定位为「Open Source AI Gateway for 100+ LLMs」，核心价值是**用一套 OpenAI 格式的接口，屏蔽 100+ 个 LLM 供应商各自不同的 SDK、鉴权、请求格式与错误类型**（README 原文）。
- **双形态交付：Python SDK + Proxy 网关。** SDK 是 `import litellm` 直接调 `completion()`；Proxy 是独立部署的 OpenAI 兼容网关（`litellm[proxy]`），带虚拟密钥、预算/消费追踪、护栏、负载均衡、管理后台。**两者共享同一套 provider 适配层。**
- **Proxy 本体就是一个 FastAPI 应用**——`litellm/proxy/proxy_server.py:1919` 的 `app = FastAPI(...)`，且显式设了 `strict_content_type=False`（这正是 74 号 FastAPI 报告 §6.5 讲过的参数，两篇报告在此交叉印证）。
- **作者与出身**：BerriAI（Y Combinator W23 批次），首发 **0.1.0 于 2023-07-27**，MIT 许可，**973 个发行版**、当前 1.108.3（2026-11-07），**63k⭐**（2026-11 实测）。成长速度极快：三年从 0 到 63k。
- **SDK 的核心是「模型字符串 → provider」的解析 + 一个 `@client` 装饰器。** `model="openai/gpt-4o"` 靠 `get_llm_provider()` 拆成 `provider=openai, model=gpt-4o`，再由 `@client` 装饰器统一做 `litellm_call_id` 打点、日志对象构造、凭证加载，最后分发到 `llms/<provider>/` 目录里的适配器。
- **Router 是「多模型调度层」。** `router_strategy/` 目录里躺着 14 种路由策略：`least_busy`、`lowest_cost`、`lowest_latency`、`lowest_tpm_rpm`、`simple_shuffle`、`tag_based_routing`、`complexity_router`、`adaptive_router`、`quality_router`、`budget_limiter` 等——本质是「给同一逻辑模型名挂多个部署，按策略选一个，失败自动切换」。

## 二、设计目标

### 2.1 谁、什么时候、为什么

| 事实 | 依据 |
|---|---|
| 作者 | BerriAI，Y Combinator W23 | README badge |
| 首发 | 0.1.0，**2023-07-27** | PyPI |
| 现状 | 1.108.3（2026-11-07），973 个发行版，MIT | PyPI |
| 体量 | **63k⭐** | shields.io（2026-11） |
| 定位 | 「Open Source AI Gateway for 100+ LLMs. Self-hosted. Enterprise-ready. Call any LLM in OpenAI format.」 | README |

2023 年的 LLM 应用开发痛点：每个供应商（OpenAI/Anthropic/Gemini/Bedrock/Azure/本地 Ollama…）都有**自己的 SDK、鉴权方式、请求字段、错误码和流式格式**。要在一个应用里用多家模型，就得维护一堆 `if provider == ...` 的分支。LiteLLM 的切入点是**一个「翻译层」**：把 OpenAI 的调用格式作为「普通话」，内部翻译成各家方言，对上层暴露统一的 `completion(model, messages, ...)`。

### 2.2 定位：SDK vs 网关，两条腿走路

LiteLLM 刻意做成两个可独立使用的形态（README）：

```
┌─ Python SDK（import litellm）──────────────┐
│ completion() / embedding() / image_gen()   │  单进程、库级集成
│ Router —— 多模型调度                        │
└────────────────────────────────────────────┘
┌─ Proxy 网关（litellm[proxy] = FastAPI 应用）┐
│ 虚拟密钥 / 预算 / 消费追踪 / 护栏 / 管理后台  │  团队/组织级、集中部署
│ 负载均衡 / 缓存 / 限流 / A2A / MCP           │
└────────────────────────────────────────────┘
```

两者**共享同一套 `llms/` provider 适配层**——SDK 是「库」，Proxy 是「把库包成服务再叠加治理能力」。

## 三、特点

| 维度 | 值 | 依据 |
|---|---|---|
| 统一接口 | 一套 OpenAI 格式调 100+ LLM | README / `completion()` |
| 形态 | Python SDK + Proxy 网关，共享 provider 层 | README |
| Provider 覆盖 | `llms/` 158 条目（100+ 真实 provider，含 Azure/Bedrock/Vertex/vLLM/Ollama/Xinference 等） | 本地源码 |
| 路由策略 | 14 种：least_busy/lowest_cost/lowest_latency/lowest_tpm_rpm/simple_shuffle/tag_based/complexity/adaptive/quality/budget_limiter… | `router_strategy/` |
| 网关治理 | 虚拟密钥、消费/预算追踪、护栏（guardrails）、限流、缓存、管理后台 | README |
| 协议 | `/chat/completions`、`/responses`、`/embeddings`、`/images`、`/audio`、`/batches`、`/rerank`、`/a2a`、`/messages` | README |
| 生态 | A2A Agent、MCP 工具、OpenTelemetry 插桩 | README / 源码 |
| 性能 | 声称 8ms P95 @ 1k RPS | README benchmark |
| 依赖 | `openai` SDK、httpx、tiktoken、tokenizers、huggingface-hub、click、jinja2、aiohttp… | PyPI |
| Python | ≥3.10、**<3.15**（3.15 尚未支持，本地用 3.14 venv 装） | PyPI / 实测 |
| 新拆分 | `litellm-core`：不含 extras/CLI/后台的最小 SDK 发行版 | README |

**一个关键工程事实**：基础 `litellm` 包**不含 FastAPI**（本地实测 `import fastapi` 报 `PackageNotFoundError`），FastAPI 是 `[proxy]` extra 才引入的。这跟 74 号报告「FastAPI 是胶水」的结论互为印证——LiteLLM 的 SDK 层刻意保持轻，网关层才引入 Web 框架。

## 四、使用场景

| 该用 | 不该用 |
|---|---|
| 一个应用要用 2+ 家模型、想统一成 OpenAI 格式 | 只用一家模型、且已深度绑定其原生 SDK |
| 团队/组织要集中管 API key、按人/项目分虚拟密钥、追消费 | 单机玩具项目，直接调原生 SDK 更省事 |
| 需要成本优化：按 `lowest_cost`/`lowest_latency` 自动路由、故障自动切换 | 需要极致的单模型时延（多一层转发有 P95 开销，LiteLLM 自己称 8ms） |
| 想用 OpenAI 生态工具（LangChain/Agent SDK）却要接非 OpenAI 模型 | 强监管、数据必须不出域、不能引入任何第三方中间层 |
| 内部 LLM 网关：统一鉴权、限流、审计、护栏 | 需要推理引擎本身（那是 vLLM/TGI/Ollama 的职责，不是 LiteLLM 的） |

## 五、架构图解

![LiteLLM SDK 与 Proxy 网关架构]({{ '/assets/images/litellm-architecture.svg' | relative_url }})

一句话：**上半是 SDK（库），下半是 Proxy（FastAPI 服务），中间共享 `llms/` provider 适配层**。SDK 里 `Router` 负责「多模型调度」，Proxy 里 `Router` + 治理中间件负责「多租户 + 多模型调度」。

## 六、底层实现原理（源码级）

### 6.1 SDK 统一入口：`completion()` + `@client` 装饰器

统一入口是 `litellm/main.py:5247` 的 `completion()`，被 `@client` 装饰器包裹（`litellm/utils.py:1741`）。`@client` 做的事（源码顺序）：

1. **`litellm_call_id`**——给每次调用生成 UUID，用于跨层追踪（流式、重试、回调都靠它关联）。
2. **`function_setup(...)`**——构造 `LiteLLMLoggingObject`，把这次调用纳入日志/回调/消费追踪管线。
3. **`load_credentials_from_list(kwargs)`**——从环境变量/`model_list`/密钥管理器加载凭证。
4. 分发到 provider 适配器，返回 `ModelResponse`（或 `CustomStreamWrapper` 流式）。

### 6.2 模型字符串解析：`get_llm_provider()`

「统一格式」的关键是 `model` 参数的 `provider/model` 前缀约定（`litellm_core_utils/get_llm_provider_logic.py:173`）：

```python
get_llm_provider("openai/gpt-4o")      -> model='gpt-4o',      provider='openai'
get_llm_provider("anthropic/claude-...")-> model='claude-...', provider='anthropic'
get_llm_provider("gpt-4o")             -> model='gpt-4o',      provider='openai'   # 无前缀默认 openai
```

（以上三条本地实测，逐字复现。）`provider` 决定去 `llms/<provider>/` 目录找哪个适配器（如 `llms/anthropic/`、`llms/bedrock/`），每个适配器负责把 OpenAI 格式的请求翻译成该家的 HTTP 调用、再把响应/流式块翻译回 OpenAI 的 `ModelResponse` 结构。

### 6.3 Router：多模型调度 + 故障转移

`Router`（`litellm/router.py:1070`）解决「同一个逻辑模型名，背后挂多个部署」的问题：

```python
router = Router(model_list=[
    {"model_name": "gpt-4o", "litellm_params": {"model": "openai/gpt-4o", "api_key": "..."}},
    {"model_name": "gpt-4o", "litellm_params": {"model": "azure/gpt-4o", ...}},   # 多个部署同名
])
```

策略在 `router_strategy/` 目录里，实测可枚举到：`least_busy`（最少占用）、`lowest_cost`（最低成本，读 `cost.json` 定价表）、`lowest_latency`（最低时延）、`lowest_tpm_rpm`（剩余额度最多）、`simple_shuffle`（随机）、`tag_based_routing`（按标签）、`complexity_router`（按提示复杂度分级）、`adaptive_router`、`quality_router`、`budget_limiter`（预算限流）等。选不到可用部署时**自动 failover 到下一个**，并带冷却（cooldown）机制。

### 6.4 Proxy：FastAPI 应用 + 治理能力

Proxy 入口 `litellm/proxy/proxy_server.py:1919`：

```python
app = FastAPI(
    docs_url=get_docs_url(), redoc_url=get_redoc_url(), openapi_url=get_openapi_url(),
    title=title, description=_description, version=version,
    root_path=server_root_path,
    lifespan=proxy_startup_event,
    strict_content_type=False,          # ← 74 号报告 §6.5 讲过的参数
)
```

- **`lifespan=proxy_startup_event`**——启动时做 DB 迁移、加载 `config.yaml`、初始化 Redis/缓存、预热 provider。
- **`strict_content_type=False`**——放宽请求头校验，兼容各家 SDK 不规范的 `Content-Type`，这是网关类项目对 FastAPI 的典型定制。
- **治理能力挂在代理端点后面**：虚拟密钥（virtual keys，把主密钥拆成可回收的子密钥）、预算/消费追踪（`budget_manager.py` + `cost_calculator.py`，按 token 定价累计）、护栏（guardrails）、限流、缓存（`caching/`）、管理后台。

> 本地实测（`litellm --model gpt-4o` 起服）：**无 master key 时 Proxy 拒绝启动**（抛 `UnsafeMasterKeyError`——fail-closed 默认安全姿态，明确提示「every request would be accepted without authentication」）；设 `LITELLM_MASTER_KEY` 后启动成功，`/health/liveliness` 返回 200，`/openapi.json` 是 OpenAPI 3.1.0、`title: LiteLLM API`、**共 717 条路径**（一个相当庞大的 FastAPI 应用）；而 `/v1/models` 在无 DB 时返回 `no_db_connection`（模型管理端点依赖持久化）。

### 6.5 与 74 号 FastAPI 报告的交叉点

LiteLLM Proxy 是「FastAPI 被当作生产级 AI 网关底座」的现成案例：它把 FastAPI 的 `lifespan`、`root_path`、`strict_content_type`、OpenAPI 文档开关（可关 `docs_url` 保安全）都用上了，还叠加 OpenTelemetry 插桩（`instrument_fastapi_app(app)`）。这印证了 74 号报告的判断——FastAPI 的价值不在网络层（那是 Starlette），而在「依赖注入 + 类型驱动 + 生态胶水」刚好适合网关这类「薄转发 + 重治理」的中间层。

## 七、缺点与竞品

### 7.1 缺点

- **抽象泄漏不可避免**。100+ provider 不可能完全同构，总有参数（如 Anthropic 的 `thinking`、各家的 `max_completion_tokens` vs `max_tokens`）在原生日志里不通用，用户仍要碰「某模型特有参数」。
- **多一层转发有延迟开销**。LiteLLM 自称 8ms P95 @ 1k RPS，但对极致时延场景仍是额外一跳；对**高吞吐流式**场景，代理层要做流式透传与重试缓冲，复杂度不低。
- **版本迭代极快**。973 个发行版、三年从 0.1 到 1.108，API 面广（completion/responses/a2a/mcp 都在膨胀），跟进成本高；且当前 `requires_python <3.15`，用最新 Python 会被挡（本地实测）。
- **proxy 治理功能重**。虚拟密钥/预算/护栏/SSO/企业计费这些能力让它偏向「企业级网关」，个人想轻量用反而觉得重。
- **竞品分流**：纯路由选 OpenRouter 更轻；纯观测选 Helicone 更专；国内部署 one-api/new-api 生态更熟。

### 7.2 竞品矩阵

| 竞品 | 定位 | 与 LiteLLM 的关系 |
|---|---|---|
| **OpenRouter** | 托管式统一 API（聚合多家，按 token 计费） | 更「省事」但托管、数据经第三方；LiteLLM 可自托管 |
| **Portkey** | AI 网关（开源 + 托管），观测/缓存/护栏 | 功能高度重叠，最直接的同赛道竞品 |
| **one-api / new-api** | OpenAI 兼容网关（国内生态，songquanpeng/one-api、Calcium-Ion/new-api） | 主打「多模型统一成 OpenAI 接口 + 计费」，国内部署首选 |
| **Helicone** | LLM 可观测性/网关 | 偏观测，网关能力弱于 LiteLLM |
| **Kong AI Gateway** | Kong 的 AI 网关插件 | 绑定 Kong 生态，偏 API 管理 |
| **Cloudflare AI Gateway** | 托管网关（CDN 边缘） | 托管、集成 Cloudflare，自托管不适用 |
| **vLLM / TGI / Ollama** | 推理引擎（不是网关） | 不同层：LiteLLM 的 provider 里能接它们 |

## 八、附录

### 8.1 版本时间线（PyPI，共 973 个发行版）

| 版本 | 日期 | 意义 |
|---|---|---|
| 0.1.0 | 2023-07-27 | 首发 |
| ~1.0 | 2024 中 | 进入 1.x，Proxy 网关成熟 |
| 1.108.3 | 2026-11-07 | 当前（本文核验版本） |

### 8.2 源码文件索引（1.108.3）

| 文件 | 关键内容 |
|---|---|
| `litellm/main.py` | `completion()`/`embedding()`/`image_generation()` 统一入口 |
| `litellm/utils.py:1741` | `@client` 装饰器（打点/日志/凭证加载/分发） |
| `litellm/litellm_core_utils/get_llm_provider_logic.py:173` | `get_llm_provider()` 模型字符串解析 |
| `litellm/router.py:1070` | `Router` 类（多模型调度） |
| `litellm/router_strategy/` | 14 种路由策略实现 |
| `litellm/llms/` | 158 个 provider 适配器目录 |
| `litellm/budget_manager.py` / `cost_calculator.py` | 预算 / 成本计算 |
| `litellm/proxy/proxy_server.py:1919` | Proxy 的 FastAPI 应用 |

### 8.3 参考文献

- PyPI `litellm` JSON（作者/版本/依赖/发行历史）
- GitHub `BerriAI/litellm` README（定位/特性/采用者）+ shields.io（63k⭐）
- 本地安装源码：`litellm 1.108.3`（Python 3.14 venv 实测）

### 8.4 术语表

| 术语 | 含义 |
|---|---|
| AI Gateway | 统一 LLM 访问入口，负责鉴权/路由/限流/计费/观测 |
| Virtual Key | 从主密钥派生的子密钥，可单独限额/回收 |
| `@client` | LiteLLM 包装 `completion()` 的装饰器，统一打点与分发 |
| Router | 多模型部署的调度器，按策略选部署 + 故障转移 |
| failover | 主部署失败后自动切到备选部署 |
| provider 适配层 | `llms/<provider>/` 目录，负责 OpenAI 格式 ↔ 各家格式翻译 |
