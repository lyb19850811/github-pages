---
report: 74
title: FastAPI 深度研究：类型驱动的异步 Web 框架——设计目标、三层架构与底层实现原理
date: 2026-11-07
tags: [fastapi, python, starlette, pydantic, asgi, web-framework, dependency-injection, openapi]
summary: 从 fastapi 0.162.1 / starlette 1.10.0 / pydantic 2.14.3 一手源码与本地实测核验 FastAPI 的设计目标、三层架构分工（FastAPI=胶水+DI+OpenAPI / Starlette=ASGI 网络层 / Pydantic=Rust 校验序列化）、路由注册链、依赖注入递归解析与每请求缓存、同步/异步端点线程池分派、OpenAPI 自动生成，以及缺点与选型边界。
math: false
---

FastAPI 是 Python 生态里「增长最快」的 Web 框架，也是本仓库多篇 LLM 应用报告（Open WebUI、Coze、ms-swift）默认引用的后端，但从未被当作研究对象挖到源码层。本文基于**本地安装的 fastapi 0.162.1 + starlette 1.10.0 + pydantic 2.14.3（pydantic-core 2.50.4）** 的源码与实测，逐一手核验五个问题：**谁/何时推出 → 设计目标 → 特点 → 使用场景 → 底层实现原理 → 缺点**。读者定位：资深 Python/后端工程师，默认已会「写」FastAPI，聚焦「黑箱」内部。

## 一、结论先行

- **FastAPI 不是「从零写的 Web 框架」，而是「站在两个巨人肩膀上的胶水」。** 网络/ASGI/路由原语全部来自 Starlette（`fastapi.applications.FastAPI(Starlette)` 直接继承），数据校验/序列化全部来自 Pydantic v2（Rust 内核 `pydantic-core`）。FastAPI 自己的核心增量只有三样：**① 依赖注入（`Depends`）；② 从类型注解自动生成 OpenAPI/Swagger 文档；③ 把类型注解、Pydantic 模型、路由装饰器粘成「声明一次、处处生效」的开发体验**。
- **但「胶水」已经不小了。** fastapi 包共 **22,748 行** Python，是 Starlette（7,075 行）的 **3.2 倍**——`routing.py` 单文件 6,552 行。0.162 已塞进 SSE/JSONL 流式、原生 OpenTelemetry、路由上下文（included router）等大量机制，「薄封装」是历史说法，不适用于 2026 年的现状。
- **作者与出身：** Sebastián Ramírez（GitHub `tiangolo`），个人开源，首发 **0.1.0 于 2018-12-08**（PyPI 与 GitHub 仓库同一天创建）。MIT 许可，**至今仍是 0.x（`Development Status :: 4 - Beta`），8 年未发 1.0**。当前由作者团队的 **FastAPI Cloud**（fastapicloud.com）作为主要赞助方提供资金。
- **同步/异步端点在路由注册时就定型了。** `async def` 端点跑事件循环；`def` 端点被 `run_in_threadpool`（`anyio.to_thread.run_sync`）丢进线程池（默认容量 40）。**同步依赖函数同样进线程池**——这是「async 优先但兼容同步」的实现落点。
- **依赖注入 = 注册期建树 + 请求期缓存求解。** 路由注册时 `get_dependant` 递归把函数签名展开成一棵 `Dependant` 树；每个请求里 `solve_dependencies` 递归求解，`use_cache=True`（默认）时同一依赖函数每请求只执行一次。本地实测：同一个依赖函数被引用 3 次，实际只调用 1 次。

## 二、设计目标

### 2.1 谁、什么时候、为什么做

| 事实 | 依据 |
|---|---|
| 作者 | Sebastián Ramírez（`tiangolo`），PyPI owner 唯一 `tiangolo` | PyPI `/pypi/fastapi/json` |
| 首发 | 0.1.0，**2018-12-08** 08:14 UTC | PyPI release 时间戳 |
| 许可 | MIT | PyPI `license_expression` + GitHub |
| 现状 | 0.162.1（2026-11-07，即今日）、360 个发行版、仍标 Beta | PyPI |
| GitHub | 104,540 stars（对比 Starlette 12,711、Pydantic 29,367） | GitHub API 2026-11-07 |

2018 年 Python Web 的痛点：Flask 是同步 WSGI、写 async 要自己上 gevent；Django 重且「全家桶」；aiohttp 原生 async 但**无类型校验、无文档生成**；DRF 有序列化但绑死 Django。FastAPI 的切入点是**一个尚未被占位的组合**：`async + 标准类型提示 + 自动文档 + 极低样板`。它不发明新语法——只用 PEP 484/526/585/604 的**标准类型提示**，一次声明同时拿到「编辑器补全 + 输入校验 + 序列化 + OpenAPI 文档」四样，官方 README 把这概括为「fast to code」「fewer bugs」「short」。

### 2.2 三层架构分工（核心）

```
FastAPI（胶水，22,748 行）
  ├─ 依赖注入：Depends → get_dependant/solve_dependencies
  ├─ OpenAPI 生成：get_openapi + Swagger UI/ReDoc 挂载
  ├─ 类型驱动：签名 → ModelField → 校验/序列化管道
  └─ 流式/遥测/路由上下文等机制
        │ 继承 + 委托
Starlette（ASGI 网络层，7,075 行，BSD-3-Clause）
  ├─ Router 路由匹配（compile_path 正则 + 参数转换器）
  ├─ Request/Response、middleware 栈、异常处理
  └─ run_in_threadpool（anyio 线程池）
        │ 依赖
Pydantic v2（校验/序列化，MIT）
  └─ pydantic-core（Rust）：ModelField.validate/serialize
```

FastAPI 对 Starlette 的「定制」不是重写，而是**插入两个 AsyncExitStack**（见 §6.4）来管理依赖的 yield 清理，其余网络行为全部沿用。

## 三、特点

| 维度 | 值 | 依据 |
|---|---|---|
| 协议 | ASGI（非 WSGI），跑在 uvicorn/hypercorn 上 | 官方 docs / `FastAPI(Starlette)` |
| 异步模型 | async-first；`def` 端点自动进线程池 | `routing.py:363` `run_endpoint_function` |
| 校验 | 类型注解 + Pydantic 模型，失败返回 **422**（Pydantic v2 错误格式） | 本地实测 |
| 文档 | OpenAPI 3.1.0 + Swagger UI（`/docs`）+ ReDoc（`/redoc`）零配置 | `applications.py:1120` `setup` |
| 依赖注入 | `Depends`，递归子依赖、每请求缓存、`yield` 清理、`app.dependency_overrides` 测试覆盖 | `dependencies/utils.py:643` |
| 响应模型 | 返回注解 → `response_field`（`mode="serialization"`），自动过滤/序列化 | `routing.py:1173` |
| 测试 | `TestClient`（基于 httpx），`TestClient(app)` 上下文即启动 lifespan | `fastapi/testclient.py` |
| 安全 | OAuth2/JWT/HTTP Basic/API Key 一等公民（`fastapi/security/`） | 源码目录 |
| WebSocket | 原生 `@app.websocket`，`APIWebSocketRoute` | `routing.py:854` |
| 版本 | 仍 0.x，Python 要求 ≥3.10 | PyPI |

**一个容易误解的点**：`FastAPI` 类的 `routes` 参数在源码里被 `deprecated(...)` 标注——它是从 Starlette 继承的兼容参数，正常应通过 `app.get()/post()` 等路径操作方法注册。

## 四、使用场景

| 该用 | 不该用 |
|---|---|
| API/微服务（JSON 为主） | 重模板渲染的整站（用 Django/Flask+Jinja 更顺） |
| ML/LLM 模型推理服务（uvicorn 部署、OpenAPI 供客户端/Agent 调用） | CPU 密集计算（同步端点仍受 GIL 限制，见 §7） |
| 异步 I/O 密集：聚合多个外部 API、流式响应（SSE/JSONL，0.162 原生支持） | 大量有状态长连接、需要精细背压的实时系统（FastAPI 无内置连接状态，需外置） |
| 内部工具 API、想用类型注解同时拿到文档+校验 | 团队不想引入「隐式魔法」、需要极透明调用栈的场景 |

## 五、请求生命周期（看不懂原理就看这里）

```mermaid
sequenceDiagram
    participant C as 客户端
    participant U as Uvicorn (ASGI)
    participant M as Middleware 栈
    participant R as Starlette Router
    participant AR as APIRoute
    participant H as get_request_handler
    participant D as solve_dependencies
    participant E as 端点函数
    participant P as Pydantic (pydantic-core)

    C->>U: HTTP 请求
    U->>M: ASGI scope/receive/send
    M->>R: 路由匹配 (compile_path 正则)
    R->>AR: matches() 命中 APIRoute
    AR->>H: app(request)
    H->>D: solve_dependencies(request, dependant, body)
    D-->>H: values dict（含依赖+参数校验结果）
    H->>E: run_endpoint_function(**values)
    Note over E: async def → 事件循环 await<br/>def → run_in_threadpool(线程池)
    E-->>H: 返回值
    H->>P: serialize_response(response_field)
    P-->>H: JSON bytes
    H-->>U: Response
    U-->>C: HTTP 响应
```

三层职责在图中清晰可见：**Router 匹配和 ASGI 协议是 Starlette**；**`solve_dependencies` 依赖解析是 FastAPI**；**校验/序列化是 Pydantic**。端点执行时唯一的「分叉」就是 `async def` vs `def`。

## 六、底层实现原理（源码级）

### 6.1 路由注册：`@app.get` → APIRoute → ASGI app

装饰器链（呼应 73 号装饰器报告，`@` 就是编译期重绑定）：

```
@app.get(path)                        # applications.py / routing.py APIRouter.get
  └─ APIRouter.api_route(path, methods=["GET"])   # routing.py:3078，返回 decorator
       └─ decorator(func) → add_api_route(path, func, ...)   # routing.py:2994
            └─ route_class = APIRoute(path, endpoint, ...)   # 默认 self.route_class
                 └─ self.routes.append(route) + _mark_routes_changed()
```

`APIRoute.__init__`（`routing.py:1179`）内部调用 `_populate_api_route_state`（`routing.py:1014`），做四件事：

1. **`compile_path(path)`** → 拆出 `path_regex`、`path_format`、`param_convertors`（这是 Starlette 的路径匹配正则 + 参数转换器，如 `{item_id}` → `int` 转换）。
2. **`_build_dependant_with_parameterless_dependencies(path, call, dependencies)`** → 用 `get_dependant` 把端点签名递归展开成 `Dependant` 树（详见 §6.2），同时收集 `body_params`。
3. **`_get_body_field(...)`** → 单请求体字段（一个端点最多一个 body，多模型用 embedding）。
4. **返回注解 → `response_field`**：`get_typed_return_annotation(endpoint)` 取返回类型，非 `Response` 子类则 `create_model_field(name, type_, mode="serialization")` 建序列化字段。

最后 `self.app = request_response(self.get_route_handler())`——`get_route_handler()` 返回 `get_request_handler(dependant, body_field, response_field, ...)`，那是一个 `async def app(request)`，**这条路由真正的 ASGI 应用**。注册进 Starlette Router 后，Router 匹配到路径就调用这个 app。

> 实测：`app.routes` 里默认有 4 条 Starlette `Route`（`/openapi.json`、`/docs`、`/docs/oauth2-redirect`、`/redoc`，在 `FastAPI.setup()` 里 `add_route(..., include_in_schema=False)` 加入），用户路由则是 `APIRoute`。每条 `APIRoute` 都带一个 `dependant` 属性（类型 `Dependant`）。

### 6.2 依赖注入：注册期建树 + 请求期缓存求解

这是 FastAPI 相对 Starlette **最本质的增量**，分两阶段：

**阶段一（注册期，`dependencies/utils.py:300` `get_dependant`）：** 遍历端点签名每个参数，`analyze_param` 三分：

| 参数类型 | 去向 |
|---|---|
| `Depends(...)` / `Security(...)` | **递归调用 `get_dependant` 建子依赖**，append 到 `dependant.dependencies` |
| `Request`/`Response`/`WebSocket`/`BackgroundTasks`/`SecurityScopes` | 存 `xxx_param_name`，请求期直接注入对象 |
| 其它（Query/Body/Path/Header/Cookie 或裸 Pydantic 模型） | 建成 `ModelField`，按来源归类到 `query_params`/`body_params`/… |

`Dependant` 是 `@dataclass(slots=True)`（`dependencies/models.py:32`），核心字段：`path_params/query_params/header_params/cookie_params/body_params`、`dependencies: list[Dependant]`、`call`、`use_cache: bool = True`、`scope`。

**阶段二（请求期，`dependencies/utils.py:643` `solve_dependencies`）：** 对每个 `sub_dependant` 递归求解，然后按可调用性分派：

```python
if sub_dependant.use_cache and sub_dependant_cache_key in dependency_cache:
    solved = dependency_cache[sub_dependant_cache_key]        # 命中缓存
elif _is_gen_callable(...) or _is_async_gen_callable(...):
    solved = await _solve_generator(...)                      # yield 依赖 → exit stack
elif _is_coroutine_callable(use_sub_dependant.call):
    solved = await call(**solved_result.values)               # async 依赖 → 事件循环
else:
    solved = await run_in_threadpool(call, **solved_result.values)  # sync 依赖 → 线程池
```

缓存键 `_get_cache_key`（`dependencies/models.py:84`）= `(dependant.call, 排序后的 oauth scopes, 计算出的 scope)`——**以函数对象身份为准**，所以「同一个依赖函数」在一个请求内只算一次。缓存 dict 在 `solve_dependencies` 入口创建、向下递归传递，**作用域是「每请求」**，不是全局。

> 实测：`expensive_dep` 被三个参数引用（`a=Depends(expensive_dep)`、`b=Depends(expensive_dep)`、`c=Depends(nested_dep)` 而 `nested_dep` 又依赖它），一个请求后计数器 `{'expensive': 1, 'nested': 1}`——**3 次引用只执行 1 次**，且三个参数拿到的是**同一个对象**。

`yield` 依赖的清理靠 `request_response`（`routing.py:129`）插入的两个嵌套 `AsyncExitStack`：`fastapi_inner_astack`（request 作用域）与 `fastapi_function_astack`（function 作用域），这正是 FastAPI 对 Starlette 网络层的唯一「侵入点」。

### 6.3 同步/异步分派：线程池 vs 事件循环

关键在 `run_endpoint_function`（`routing.py:363`）：

```python
if is_coroutine:
    return await dependant.call(**values)              # 事件循环直接 await
else:
    return await run_in_threadpool(_run_sync_endpoint, ...)  # 线程池
```

`is_coroutine` 在 `get_request_handler`（`routing.py:416`）里由 `_is_coroutine_callable(dependant.call)` **在路由注册时就判定**，闭包进 `app(request)`——所以「是 async 还是 sync」是启动时定死的，不是每请求判断。`run_in_threadpool` 来自 Starlette（`starlette/concurrency.py`），实现是 `anyio.to_thread.run_sync`；anyio 默认线程池 `CapacityLimiter(40)`（`anyio/_backends/_asyncio.py:3257`），**40 个线程上限**。

> 实测（`threading.get_ident()` + `asyncio.get_running_loop()` 探测）：
> - `def` 端点：`in_event_loop=False` → 在 anyio 线程池线程里跑，无运行中的事件循环。
> - `async def` 端点：`in_event_loop=True` → 在事件循环线程里 `await`。
> - `def` 依赖函数：同样 `in_event_loop=False` → **同步依赖也进线程池**。

### 6.4 OpenAPI 自动生成

`FastAPI.openapi()`（`applications.py:1085`）**惰性 + 缓存**：首次调用生成并存入 `self.openapi_schema`，之后只有当 `self.router._get_routes_version()` 变化（路由增删）才重新生成。生成入口 `get_openapi`（`openapi/utils.py:577`）流程：

```
get_openapi
 ├─ get_fields_from_routes(routes)        # 收集所有路由的 ModelField
 ├─ get_flat_models_from_fields(...)      # 拍平嵌套 Pydantic 模型
 ├─ get_model_name_map(...)               # 命名去重（同名模型加后缀）
 ├─ get_definitions(...)                  # 生成 JSON Schema（components.schemas）
 ├─ get_openapi_path(route, ...)          # 逐路由生成 parameters/requestBody/responses
 └─ OpenAPI(**output) → jsonable_encoder(by_alias=True)   # 输出 OpenAPI 3.1.0
```

`/docs`、`/redoc` 不是预生成 HTML，而是在 `setup()` 里挂两个内联端点，请求时 `get_swagger_ui_html(openapi_url=...)` 动态返回指向 `/openapi.json` 的 HTML。

### 6.5 请求体校验与响应序列化（Pydantic v2 管道）

- **请求体**：`request_body_to_args`（`dependencies/utils.py:1156`）对 `body_field` 调 `field.validate(...)`，底层是 Rust 的 `pydantic-core`。失败抛 `RequestValidationError` → **422**，错误体是 Pydantic v2 结构。
- **响应**：`serialize_response`（`routing.py:320`）对 `response_field` 调 `field.validate(..., loc=("response",))` + `field.serialize(...)`。0.162 新增 `dump_json` 快路径：当未自定义响应类且有 `TypeAdapter` 响应字段时，**直接用 Rust 核心序列化成 JSON bytes，跳过「中间 Python dict + `json.dumps`」一步**。

> 实测 422 错误体：`{"detail": [{"type": "missing", "loc": ["body", "price"], "msg": "Field required", "input": {"name": "x"}}]}`——缺 `price` 字段，Pydantic v2 的 `missing` 错误直接透传。

## 七、缺点

- **隐式魔法多、调用栈深。** 装饰器 + 类型注解 + `Depends` 让「一个请求实际执行了什么」高度隐式，出错时栈里夹着 `get_request_handler`/`solve_dependencies`/`serialize_response` 多层胶水，排障比显式框架费劲。
- **同步端点受 GIL 限制。** `def` 端点只是「换个线程」，CPU 密集任务仍撞 GIL，不会并行提速（并发上限还受 40 线程池限制）。要用多核得靠多 worker 进程。
- **Pydantic v1→v2 迁移阵痛。** 0.100.0（2023-07-07）切 Pydantic v2，`dict()→model_dump()`、`.json()→model_dump_json()`、`orm_mode→from_attributes` 等大量破坏性变化，存量项目升级成本不低（`pydantic.v1` 兼容命名空间只能缓解）。
- **版本仍在 0.x。** 8 年 360 个版本仍标 Beta，API 持续演进（0.162 刚塞进 SSE/JSONL 流式、原生 OpenTelemetry），锁定版本的团队需要持续跟进 breaking change。
- **WebSocket/长连接有状态场景弱。** 无内置连接状态/消息路由，需外置 Redis 等；重背压、精细流控也不是它的主战场。
- **隐式依赖 Starlette/Pydantic 版本。** FastAPI 的 `requires_dist` 只写 `starlette>=0.46.0`、`pydantic>=2.9.0`，新版兼容性靠 CI 保证，生产升级有联动风险。
- **请求体解析的「单 body」限制。** 一个端点最多一个裸 Pydantic body 字段，多模型需手动 `embed`，是常见新手坑。

## 八、附录

### 8.1 版本时间线（PyPI 一手数据，共 360 个发行版）

| 版本 | 日期 | 意义 |
|---|---|---|
| 0.1.0 | 2018-12-08 | 首发 |
| 0.50.0 | 2020-02-29 | 功能稳定期 |
| 0.68.0 | 2021-07-29 | 社区爆发期 |
| **0.100.0** | **2023-07-07** | **切换 Pydantic v2（重大破坏性升级）** |
| 0.115.0 | 2024-09-17 | 长期稳定基线（大量 0.115.x 补丁） |
| 0.130.0 | 2026-02-22 | 提速发布（2026 起高频率） |
| **0.162.1** | **2026-11-07** | **当前（本文核验版本）** |

### 8.2 源码文件索引（0.162.1）

| 文件 | 行数 | 关键符号 |
|---|---|---|
| `fastapi/routing.py` | 6,552 | `APIRoute`、`get_request_handler`、`run_endpoint_function`、`serialize_response`、`APIRouter` |
| `fastapi/applications.py` | 4,816 | `FastAPI(Starlette)`、`openapi`、`setup` |
| `fastapi/param_functions.py` | 2,568 | `Depends`、`Security`、`Query`、`Body` 等参数工厂 |
| `fastapi/dependencies/utils.py` | 1,464 | `get_dependant`、`solve_dependencies`、`analyze_param` |
| `fastapi/dependencies/models.py` | 234 | `Dependant`、`_get_cache_key` |
| `fastapi/openapi/utils.py` | 671 | `get_openapi`、`get_openapi_path` |
| `starlette/concurrency.py` | — | `run_in_threadpool`、`iterate_in_threadpool` |

### 8.3 参考文献

- PyPI `fastapi` JSON（作者/版本/依赖/发行历史）：https://pypi.org/pypi/fastapi/json
- GitHub `fastapi/fastapi`、`encode/starlette`、`pydantic/pydantic`（stars/创建时间/许可）
- 本地安装源码：`site-packages/fastapi/`、`starlette/`、`anyio/`（0.162.1 实测）

### 8.4 术语表

| 术语 | 含义 |
|---|---|
| ASGI | Asynchronous Server Gateway Interface，异步 Web 服务器/应用接口（对比 WSGI） |
| `Dependant` | FastAPI 依赖树节点，含参数分类、子依赖、call 与 use_cache |
| `ModelField` | FastAPI 对 Pydantic 字段的封装，承载 `mode="serialization"`/`"validation"` |
| `run_in_threadpool` | 把同步可调用对象丢进 anyio 线程池执行 |
| 422 | Unprocessable Entity，FastAPI 用此状态码返回请求体校验失败 |
