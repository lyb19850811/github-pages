---
report: 76
title: FastAPI 深度研究（二）：中间件栈、异常派发、生命周期、响应流式、后台任务与安全子系统
date: 2026-11-09
tags: [fastapi, python, starlette, asgi, middleware, exception-handling, lifespan, streaming, security, concurrency]
summary: 承接 74 号报告（路由/依赖注入/OpenAPI/同步异步分派），本文基于 fastapi 0.162.2 / starlette 1.10.0 / anyio 4.16.0 源码与本地实测，核验中间件栈的洋葱式构建顺序、异常处理的 MRO 就近派发与「响应已开始」保护、lifespan 与 on_event 的兼容与陷阱、Response/Streaming/FileResponse 的实现、BackgroundTasks 的时序、security 子系统的安全方案与 Security=Depends+scopes 语义，以及线程池上限与 GIL 边界。
math: false
---

这是 74 号《FastAPI 深度研究》的续篇。74 号把「路由注册 → 依赖注入 → OpenAPI 生成 → 同步/异步分派 → Pydantic 校验管道」挖到了源码层；本文继续把**请求从 ASGI 服务器进来之后、到端点返回响应之前的整条「胶水链路」**补齐：中间件栈怎么搭、异常怎么派发成响应、启动/关闭靠什么驱动、响应和流式/后台任务怎么落地、`security` 包到底是不是「魔法」。结论先行，随后逐节给源码与实测证据。

## 一、结论先行

- **中间件栈是一颗「洋葱」，后注册的用户中间件反而在最外层。** `FastAPI.build_middleware_stack`（`applications.py:1032`）把列表固定成 `[ServerErrorMiddleware → ExceptionTelemetryMiddleware → 用户中间件 → ExceptionMiddleware → AsyncExitStackMiddleware]`，再 `for cls in reversed(middleware)` 逐层包裹 `self.router`；而 `add_middleware` 用 `user_middleware.insert(0, …)` 插到队首，所以**越晚 `add_middleware` 越靠外**。实测：先加 `mw1` 再加 `mw2`，调用序是 `mw2-in → mw1-in → endpoint → mw1-out → mw2-out`。
- **异常处理 = 「按状态码 + 按异常类型 MRO 就近匹配」两套索引。** 已注册异常处理函数其实挂进 Starlette 的 `ExceptionMiddleware`；`wrap_app_handling_exceptions` 先查 HTTPException 的**状态码处理器**，再沿 `type(exc).__mro__` 逐级查**异常类处理器**。实测：`BizErrorSub(BizError)` 抛异常会命中给 `BizError` 注册的处理器；`HTTPException(404)` 会命中给状态码 `404` 注册的处理器而**不是**默认的 HTTPException 处理器。
- **生命周期：`on_event` 已被标记废弃，且与显式 `lifespan` 互斥。** Starlette 已删除 `on_startup`/`on_shutdown`（源码注释指向 Kludex/starlette PR #3117），FastAPI 为兼容 vendored 了一份 `_DefaultLifespan`。**致命陷阱：一旦你给 `FastAPI(lifespan=…)` 传了显式 lifespan，`on_event`/`on_startup` 处理器会被静默忽略**——实测 `events == ['lifespan-enter', 'lifespan-exit']`，legacy startup 根本没跑。
- **`security` 包没有任何魔法，本质是「可调用对象当依赖」。** `HTTPBearer`/`APIKeyHeader`/`OAuth2PasswordBearer` 都是实现了 `__call__(self, request)` 的实例，用 `Depends(instance)` 或 `Security(instance, scopes=[…])` 注入；`Security` 与 `Depends` 的唯一差别是多了 `scopes`，用于写进 OpenAPI。`OAuth2PasswordBearer` 只是「从 `Authorization: Bearer <token>` 里取出 `<token>`」，不校验、不签发 token。
- **后台任务在响应体**发送之后**才执行。** `Response.__call__` 先 `send(http.response.start)` 与 `send(http.response.body)`，最后才 `await self.background()`；同步后台任务也走 `run_in_threadpool` 进线程池。实测 `seq == ['endpoint', 'bg']`。
- **同步端点/同步后台任务共享同一个 40 线程池。** `run_in_threadpool = anyio.to_thread.run_sync`，默认 `CapacityLimiter(40)`；`def` 端点实测跑在非主线程（`tid != main_tid`）。CPU 密集的同步任务仍撞 GIL，不会并行提速。

## 二、中间件栈：洋葱的构建与顺序陷阱

### 2.1 两层结构：FastAPI 覆写了 Starlette 的 build

`FastAPI` 继承 `Starlette`，但**覆写了 `build_middleware_stack`**（`fastapi/applications.py:1032`），理由写在源码注释里：要把 FastAPI 特有的 `AsyncExitStackMiddleware` 放在 `ExceptionMiddleware` **内侧、所有用户中间件内侧**，以保证 contextvars 上下文一致。栈列表（外层→内层）：

```
ServerErrorMiddleware        # 兜底：未处理异常 → 500；handler=注册给 500/Exception 的处理函数
ExceptionTelemetryMiddleware # 0.162：给进入 ExceptionMiddleware 的异常挂 OpenTelemetry
用户中间件 user_middleware     # @app.middleware("http") / app.add_middleware(...)
ExceptionMiddleware           # 已注册异常处理函数 → 响应（§三）
AsyncExitStackMiddleware      # FastAPI 特有：关闭文件等资源 + contextvars
self.router                  # 最内层：APIRouter 路由匹配 + 依赖解析 + 端点
```

构建尾段（`applications.py:1082`）是 `for cls, args, kwargs in reversed(middleware): app = cls(app, …)`——列表第一个元素最终在最外层，即 `ServerErrorMiddleware` 最外面。中间件栈示意图见 §五。

### 2.2 `add_middleware` 的「后加 = 外层」语义

`Starlette.add_middleware`（`starlette/applications.py:104`）：

```python
self.user_middleware.insert(0, Middleware(middleware_class, *args, **kwargs))
```

`insert(0)` 插到队首，而队首又在栈的最外层——所以**先 add 的靠内、后 add 的靠外**。这与直觉（先声明的先执行）相反，是高频坑。`@app.middleware("http")` 只是语法糖，最终等价于 `add_middleware(BaseHTTPMiddleware, dispatch=fn)`。

> 实测（先 `mw1` 后 `mw2`，各记录进出）：
> `['mw2-in', 'mw1-in', 'endpoint', 'mw1-out', 'mw2-out']`——`mw2` 包住 `mw1`，确认后注册者在外。

### 2.3 两种中间件与 BaseHTTPMiddleware 的注意点

| 类型 | 形态 | 典型 | 边界 |
|---|---|---|---|
| 纯 ASGI 中间件 | `def mw(app) -> app`（无类型依赖） | CORS、GZip、TrustedHost、HTTPSRedirect | 全 scope 生效，行为最可预测 |
| `BaseHTTPMiddleware` 子类 | 覆写 `dispatch(request, call_next)` | 请求日志/计时、注入请求态 | **只处理 HTTP scope**，非 http（websocket/lifespan）直接 `await self.app(...)` 透传 |

`BaseHTTPMiddleware.__call__`（`starlette/middleware/base.py:96`）把请求包成 `_CachedRequest`（`wrapped_receive` 允许你在 `dispatch` 里先 `await request.body()` 再把同一份 body 重放给下游），并把响应重包成 `_StreamingResponse`。两个衍生注意点（源码结构可见，非官方「bug」）：

1. **响应对象被重包**：`call_next` 返回的是 `_StreamingResponse`，`response.body`/`response.background` 的语义与裸响应不同，应只读 `response.headers`/状态码这类稳定字段。
2. **contextvars 隔断**：内部用 `anyio.create_task_group()` 起任务，会复制一份 context 副本，中间件内设的 contextvar 未必能传出——这正是 FastAPI 把 `AsyncExitStackMiddleware` 塞到用户中间件内侧的原因（源码注释明说）。

## 三、异常处理：两套索引 + MRO 就近派发

### 3.1 注册去向：Starlette 的 ExceptionMiddleware

FastAPI 的 `app.exception_handlers` dict 在 `__init__`（`applications.py:997`）里预置三个默认项，`build_middleware_stack` 再据此装配：

```python
self.exception_handlers.setdefault(HTTPException, http_exception_handler)                     # {"detail": exc.detail}
self.exception_handlers.setdefault(RequestValidationError, request_validation_exception_handler)  # 422 + exc.errors()
self.exception_handlers.setdefault(WebSocketRequestValidationError, websocket_request_validation_exception_handler)
```

注意一个**拆分**：`build_middleware_stack` 里 `if key in (500, Exception): error_handler = value`——注册给 `500` 或 `Exception` 的处理函数被抽出来交给**最外层** `ServerErrorMiddleware`（只兜底「没有任何处理器接住的异常」），其余交给内层 `ExceptionMiddleware`。两者职责不同，别混。

`ExceptionMiddleware`（`starlette/middleware/exceptions.py`）维护两份索引：

- `_exception_handlers`: `{异常类: handler}`，默认 `{HTTPException: http_exception, WebSocketException: websocket_exception}`；
- `_status_handlers`: `{int 状态码: handler}`，由 `add_exception_handler(404, handler)` 这类调用写入。

### 3.2 派发流程：状态码优先，再沿 MRO 找

真正的查找在 `wrap_app_handling_exceptions`（`starlette/_exception_handler.py`）：

```python
if isinstance(exc, HTTPException):
    handler = status_handlers.get(exc.status_code)      # 先按状态码
if handler is None:
    handler = _lookup_exception_handler(exception_handlers, exc)  # 再按类型 MRO
```

`_lookup_exception_handler` 是 `for cls in type(exc).__mro__: if cls in exc_handlers: return ...`——**子类异常会命中父类注册的处理器**（就近向上找）。找到后：`response_started` 为真则抛 `RuntimeError("Caught handled exception, but response already started.")`（响应一旦开始发送就不能再换处理器）；handler 是 async 就 `await`，是 sync 就 `run_in_threadpool`；最后把 `exc.__traceback__ = None` 防止跨请求累积栈。

> 实测：
> - `raise BizErrorSub()`（`BizErrorSub` 继承 `BizError`，只给 `BizError` 注册了处理器）→ 返回 418 + `{"biz": "BizErrorSub"}`，确认 MRO 就近命中。
> - `raise HTTPException(404)`，同时 `@app.exception_handler(404)` 注册了状态码处理器 → 返回 `{"custom_404": True}`，确认**状态码处理器优先于默认 HTTPException 处理器**。

### 3.3 默认错误体

| 异常 | 状态码 | 响应体 |
|---|---|---|
| `HTTPException(status, detail)` | status | `{"detail": detail}`；204/304 返回空体 |
| `RequestValidationError` | 422 | `{"detail": exc.errors()}`（Pydantic v2 结构，`jsonable_encoder` 兜底） |
| `WebSocketRequestValidationError` | WS 1008 | 关闭帧 reason = errors() |

## 四、生命周期（lifespan）：on_event 的兼容与陷阱

### 4.1 ASGI lifespan 协议驱动启动/关闭

入口在 `Router.lifespan`（`starlette/routing.py:652`），严格按 ASGI lifespan 协议走：`await receive()` 等服务器发 `lifespan.startup` → `async with self.lifespan_context(app)` 进入上下文 → `send(lifespan.startup.complete)` → `await receive()` 等 `lifespan.shutdown` → 退出上下文 → `send(lifespan.shutdown.complete)`。异常时回 `startup.failed` / `shutdown.failed`。`lifespan_context` 可以 `yield` 状态 dict，会写进 `scope["state"]`（对应 `request.state`）。

### 4.2 Starlette 删了 on_startup，FastAPI vendored 回来

Starlette 在 2025 年删除了 `on_startup`/`on_shutdown`（Kludex/starlette PR #3117）。FastAPI 为了向后兼容，**在 `fastapi/routing.py:260` 自己 copy 了一份 `_DefaultLifespan`**，其 `__aenter__`/`__aexit__` 分别调 `APIRouter._startup()`/`_shutdown()`，依次跑 `self.on_startup`/`self.on_shutdown` 列表（sync 直接调、async 则 `await`）。`on_event` 本身被 `@deprecated(...)` 标注（`applications.py:4704`、`routing.py:6528`）。

### 4.3 关键陷阱：显式 lifespan 会静默吞掉 on_event

`APIRouter.__init__`（`routing.py:2594`）的判定：

```python
if lifespan is None:
    lifespan_context = _DefaultLifespan(self)   # 跑 on_startup/on_shutdown
elif inspect.isasyncgenfunction(lifespan):
    lifespan_context = asynccontextmanager(lifespan)   # 你的 lifespan 替换掉默认值
```

也就是说：**只要传了 `lifespan=`，`_DefaultLifespan` 就被替换，`on_event`/`on_startup` 处理器不再被任何东西调用**，且不报错。这是升级迁移最常见的「启动逻辑突然不执行」根因。

> 实测：`FastAPI(lifespan=lifespan)` + `@app.on_event("startup")`，请求后 `events == ['lifespan-enter', 'lifespan-exit']`——legacy startup 从未进入。

### 4.4 `include_router` 会合并生命周期

`APIRouter.include_router`（`routing.py:3418`）做两件事：把子路由的 `on_startup`/`on_shutdown` 处理器追加进父路由列表；并用 `_merge_lifespan_context`（`routing.py:241`）把父子 lifespan 嵌套——**父路由的 lifespan 包住子路由的**（`async with original: async with nested:`），状态 dict 深合并。所以「拆成多个 router 再 include」时，各自 lifespan 不会丢，只是有包裹顺序。

## 五、中间件栈与请求响应（图解）

![FastAPI 中间件栈洋葱图]({{ '/assets/images/fastapi-middleware-stack.svg' | relative_url }})

结合 74 号的请求生命周期时序图：本图是「ASGI 服务器 ↔ 端点」之间的纵向栈。请求自顶向下逐层穿过，响应自底向上逐层返回；`ServerErrorMiddleware` 在最外负责兜底 500，`ExceptionMiddleware` 在中层把已注册异常转成响应，`self.router` 在最内做路由匹配与依赖解析。

## 六、响应与流式

### 6.1 `Response` 基类：render → 头 → 体 → background

`Response.__call__`（`starlette/responses.py:158`）顺序固定：

```python
await send({"type": "http.response.start", "status": ..., "headers": self.raw_headers})
await send({"type": "http.response.body", "body": self.body})
if self.background is not None:
    await self.background()          # 体发送之后才跑
```

`__init__` 里 `self.body = self.render(content)`（把 str/bytes/memoryview 归一成 bytes），`init_headers` 自动算 `content-length` 与 `content-type`（`text/*` 补 `charset=utf-8`；204/304/1xx 不写 content-length）。派生类只改两件事：`media_type` 与 `render`——例如 `JSONResponse.render` 就是 `json.dumps(...).encode("utf-8")`，`HTMLResponse`/`PlainTextResponse` 只改 `media_type`。

### 6.2 `StreamingResponse`：sync 迭代器进线程池

`StreamingResponse` 的 `body_iterator` 是 async 迭代器；若你传的是 sync 生成器，会用 `iterate_in_threadpool`（`starlette/concurrency.py`）在**线程池里逐块 `next()`**，并把 `StopIteration` 强转成内部 `_StopIteration` 以跨越线程边界。这是「边算边发」零缓冲的关键：不必把整段内容读进内存再 `json.dumps`。SSE/JSONL 流式（0.162 原生支持，见 74 号 §8.5）都建立在它之上。

### 6.3 `FileResponse`：Range / ETag / sendfile

`FileResponse.__call__`（`starlette/responses.py:315`）比普通响应复杂得多：`os.stat` 在 `anyio.to_thread.run_sync` 里跑（不阻塞事件循环），据此设 `content-length`/`last-modified`/`etag`（`md5(mtime-size)`），并处理 `Range`/`If-Range` 头做单段/多段断点续传（416 越界、400 畸形）。ASGI spec ≥2.4 时还会走 `http.response.pathsend` 扩展，让服务器用 `sendfile` 零拷贝直接发文件，绕开 Python 逐块读。`chunk_size = 64 * 1024`。

## 七、BackgroundTasks：不是「真正的后台线程」

- 实现只有两层：`starlette/background.py` 的 `BackgroundTask`（`__call__`：async 直接 `await`、sync 走 `run_in_threadpool`）与 `BackgroundTasks`（`for task in tasks: await task()`，**按加入顺序串行**）。
- `fastapi/background.py` 的 `BackgroundTasks` 继承前者，`__call__` 里给每个任务套一个 `_operation(name="background_task")`（OpenTelemetry 遥测），其余零逻辑。
- 时序上它是**「响应体发送完后、在同一个请求生命周期里」**执行，不是派生的独立线程/进程；它不增加响应延迟观感（客户端已收到 body），但**服务器进程仍要等它跑完才算这次 ASGI 调用结束**——慢任务会占用连接/worker，长任务该用消息队列（Celery/Taskiq）而非 BackgroundTasks。

> 实测：端点记录 `'endpoint'`、后台函数记录 `'bg'`，`seq == ['endpoint', 'bg']`，且客户端先拿到 200 响应、后台随后才跑。

## 八、安全子系统：可调用对象当依赖，无魔法

### 8.1 骨架：SecurityBase + `__call__(request)`

`fastapi/security/base.py` 只有 `model`（OpenAPI 安全方案模型）与 `scheme_name` 两个字段；每个具体方案都是一个**实现了 `async def __call__(self, request)` 的类实例**。所以它天然能被 `Depends(instance)` / `Security(instance)` 当依赖用——这是 FastAPI「安全 = 普通依赖」的落点，不是黑盒。

| 方案 | 从哪取 | 返回 | 失败（auto_error=True 默认） |
|---|---|---|---|
| `HTTPBearer` | `Authorization: Bearer x` | `HTTPAuthorizationCredentials(scheme, credentials)` | 401 |
| `HTTPBasic` | `Authorization: Basic x`（base64 解） | `HTTPBasicCredentials(username, password)` | 401 |
| `APIKeyHeader(name)` | 指定请求头 | `str` 值 | 401 |
| `APIKeyQuery(name)` | query 参数 | `str` 值 | 401 |
| `APIKeyCookie(name)` | cookie | `str` 值 | 401 |
| `OAuth2PasswordBearer(tokenUrl)` | `Authorization: Bearer <token>` | `<token>`（纯 token，**不含** `Bearer ` 前缀） | 401 + `WWW-Authenticate: Bearer` |

`auto_error=False` 时，缺失则返回 `None` 而非抛错，用于「可选认证」或「多方案其一」。

### 8.2 `OAuth2PasswordBearer` 到底做了什么

`OAuth2PasswordBearer.__call__`（`fastapi/security/oauth2.py:540`）完整逻辑：取 `Authorization` 头 → `get_authorization_scheme_param` 按第一个空格拆成 `(scheme, param)` → 若头为空或 `scheme.lower() != "bearer"` 则 401 或 `None` → 否则 `return param`。**它不验证 token 签名、不查库、不签发**——解析出 token 后交给你自己的 `get_current_user` 依赖继续处理。`OAuth2PasswordRequestForm` 则是把 `username/password/grant_type/scope` 从 form 字段收集成对象，配合 `/token` 端点做密码流。

### 8.3 `Security` = `Depends` + scopes

`Security`（`param_functions.py:2480`）与 `Depends` 的唯一差别是多了 `scopes: Sequence[str]`，最终 `return params.Security(dependency, scopes, use_cache)`。这些 scope 写进 OpenAPI 的 `security` 声明（在 `/docs` 的 OAuth2 授权框可见）；运行时通过 `SecurityScopes.scopes`（空格连接的 scope 串）注入你的依赖去校验。`use_cache` 语义与普通依赖完全一致（每请求缓存，见 74 号 §6.2）。

## 九、性能与并发边界

- **线程池统一为 40。** `run_in_threadpool = functools.partial` + `anyio.to_thread.run_sync`；`run_sync` 默认用 anyio 的默认线程 limiter，实测 `total_tokens == 40`。这意味着「同步端点 + 同步依赖 + 同步后台任务」共享同一 40 线程上限，超出的并发会排队。
- **同步 ≠ 并行。** `def` 端点只是「换到线程池线程」跑，CPU 密集的纯 Python 计算仍受 GIL 限制，多线程不会提速；要榨多核得靠多 worker 进程（uvicorn `--workers`）或把 CPU 任务下沉到独立进程池。
- **async 的价值在 I/O 密集。** `async def` 端点直接 `await` 事件循环（74 号 §6.3 实测 `in_event_loop=True`），对外部 API 聚合、DB/Redis 异步驱动、SSE 长连接这类「大量等待」场景能显著提升吞吐；对纯 CPU 计算无增益。
- 实测线程身份：`def` 端点内 `threading.get_ident()` 与主线程 `main_thread().ident` 不同，确认其在 worker 线程执行；`async def` 端点则在事件循环线程。

## 十、附录

### 10.1 版本与实测环境

| 包 | 版本 | 说明 |
|---|---|---|
| fastapi | 0.162.2 | 本文核验版本（74 号时为 0.162.1，两天后已 +0.0.1） |
| starlette | 1.10.0 | 中间件/异常/响应/后台任务来源 |
| pydantic | 2.14.3（pydantic-core 2.50.4） | 校验/序列化 |
| anyio | 4.16.0 | 线程池实现（默认 limiter 40） |
| uvicorn | 0.54.0 / httpx 0.28.1 | 服务器 / TestClient |

### 10.2 源码文件索引（0.162.2 / 1.10.0）

| 文件 | 关键符号 |
|---|---|
| `fastapi/applications.py` | `build_middleware_stack`、`setup`、`__call__`、默认异常处理器、`on_event`(deprecated) |
| `fastapi/routing.py` | `_DefaultLifespan`(vendored)、`_merge_lifespan_context`、`include_router`、`add_event_handler` |
| `fastapi/exception_handlers.py` | `http_exception_handler`、`request_validation_exception_handler` |
| `fastapi/background.py` | `BackgroundTasks`（+遥测 `_operation`） |
| `fastapi/security/{http,api_key,oauth2}.py` | `HTTPBearer`/`HTTPBasic`、`APIKey*`、`OAuth2PasswordBearer`、`SecurityScopes` |
| `fastapi/param_functions.py` | `Depends`、`Security` |
| `starlette/middleware/exceptions.py` | `ExceptionMiddleware`、状态码/异常类两套索引 |
| `starlette/middleware/errors.py` | `ServerErrorMiddleware` |
| `starlette/middleware/base.py` | `BaseHTTPMiddleware`、`_CachedRequest` |
| `starlette/_exception_handler.py` | `wrap_app_handling_exceptions`、`_lookup_exception_handler`(MRO) |
| `starlette/responses.py` | `Response`、`JSONResponse`、`StreamingResponse`、`FileResponse` |
| `starlette/background.py` / `starlette/concurrency.py` | `BackgroundTask(s)`、`run_in_threadpool`、`iterate_in_threadpool` |

### 10.3 关键结论速查

| 问题 | 答案 |
|---|---|
| 中间件谁最外？ | 后 `add_middleware` 的（`insert(0)`）；最外层是 `ServerErrorMiddleware` |
| 自定义异常怎么接？ | `@app.exception_handler(Exc)`，子类沿 MRO 就近命中 |
| HTTPException 能按状态码覆盖吗？ | 能，`@app.exception_handler(404)` 优先于类型处理器 |
| `on_event` 还能用吗？ | 已废弃；且和显式 `lifespan` 互斥（后者静默吞掉前者） |
| 后台任务何时跑？ | 响应体发送后、同一请求内、串行 |
| OAuth2PasswordBearer 校验 token 吗？ | 不，只取出 token，校验靠你自己的依赖 |
| 同步端点线程池多大？ | 40（anyio 默认 `CapacityLimiter`） |

### 10.4 参考文献

- Starlette 源码与「BaseHTTPMiddleware 注意点」：https://www.starlette.io/middleware/#basehttpmiddleware
- Starlette 移除 on_startup 的 PR：https://github.com/Kludex/starlette/pull/3117
- FastAPI 官方文档（Middleware / Background Tasks / Security / Events）：https://fastapi.tiangolo.com/
- 74 号前篇《FastAPI 深度研究》：路由注册 / 依赖注入 / OpenAPI / 同步异步分派
