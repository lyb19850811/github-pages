---
report: 39
title: WebAssembly 深度研究
date: 2026-10-17
updated: 2026-10-17
updates: 3
tags: [webassembly, wasm, wasi, vm, performance]
summary: 系统拆解 WebAssembly——它是什么、解决什么问题、内存与沙箱模型、与 JS/JVM 的关系、编译工具链，以及 WASI/组件模型如何把它从浏览器推向服务端与云原生，附 2026 年各提案标准化进度与典型场景。
math: false
---

WebAssembly（wasm）是一种**可移植、高效、安全沙箱化的二进制指令格式**，定位是「低层虚拟机 + 编译目标」，而非一门给人写的新语言。本文梳理其本质、模型、生态与 2026 年的落地边界。

## 结论先行

1. **本质是编译目标**：C/C++/Rust/Go 等编译成 `.wasm` 二进制，在浏览器或独立运行时以接近原生的速度执行；它处的位置类似「JVM 字节码」「汇编」，是「执行格式」而非「编程语言」。
2. **核心卖点是安全 + 高性能 + 可移植**：线性内存沙箱隔离、类型化预编译、一套字节码跑在所有支持 wasm 的环境。
3. **定位是 JS 的搭档而非替代**：wasm 管计算密集/性能敏感/已有原生代码库的部分，JS 管 DOM、胶水与生态。
4. **WASI 是「走出浏览器」的关键**：把 wasm 从浏览器专用推广到服务端/边缘/云原生；组件模型（Component Model）是其中枢。
5. **2026 现状**：GC、异常处理、Memory64、SIMD、尾调用等关键特性已标准化；W3C 在 2026-03-25 宣布 wasm 为「一级 Web 语言」，与 HTML/CSS/JS 并列；服务端生态（Wasmtime/WasmEdge/Spin/Docker）进入快速落地期。

## 是什么：一个精确的定义

WebAssembly 由 W3C WebAssembly Community Group（CG）制定，首个 MVP 于 2017 年完成、2019 年成为 W3C 正式标准。工程化定义：

> WebAssembly 是一种**基于栈机模型**的二进制指令格式，具备**可移植、沙箱化、安全可验证、接近原生执行效率**等特征，可在浏览器和独立 Wasm 运行时中运行，通常由 C/C++、Rust、Go 等语言编译生成。

要点澄清（常见误解）：

- **不是新语言**：它是编译产物格式，人一般不直接写（对应文本格式 WAT 也极少手写）。
- **不是 JS 的替代**：二者互补，wasm 不能直接操作 DOM，必须经 JS 桥接。
- **不绑定浏览器**：通过 WASI 可在浏览器之外运行。

## 它解决什么问题

JavaScript 是动态类型 + 解释/即时编译，性能有天花板。很多场景需要把现成的 C/C++/Rust 代码库搬上 Web，或需要接近原生的算力：

- 游戏引擎（Unity、Unreal 的 Web 导出）
- 设计/工程工具（Figma、AutoCAD Web 版）
- 音视频编解码（ffmpeg.wasm 浏览器内转码）
- 加密、图像处理、科学计算、SQLite 本地数据库、AI 推理（浏览器内跑小模型）

wasm 的答案是「**不用重写**」：把已有原生代码直接编译成 wasm，在浏览器里以接近原生速度运行。到 2026-05，Chrome 遥测显示 **5.5% 的页面加载包含 wasm 模块**。

## 核心模型

### 线性内存（Linear Memory）

wasm 模块拥有一块**连续、可增长的字节数组**，是它唯一能直接读写的内存。所有指针、数组、字符串都落在其中。这带来两个后果：

1. **安全**：模块无法越界访问宿主内存，只能在自己沙箱里操作，这是「沙箱隔离」的基础。
2. **性能**：与 C/C++ 的内存模型接近，编译器可直接映射，无需 JS 式的装箱/类型转换。

### 类型系统

基本类型只有 `i32 / i64 / f32 / f64`（早期 MVP），后续加入 `v128`（SIMD 向量）、引用类型等。早期无 GC 类型，内存由编译目标语言自行管理（Rust 的所有权、C++ 的 RAII/手动）。

### 模块与导入导出

wasm 以「模块」为单位，显式 `export` 函数，并 `import` 宿主提供的能力（如 `console.log`、文件读写、时钟）。导入导出构成模块与宿主的唯一边界。

### 与 JVM 的异同

| 维度 | WebAssembly | JVM |
|---|---|---|
| 指令格式 | 二进制（栈机） | 二进制（栈机） |
| 类型系统 | 简单（4 种基本类型） | 丰富（对象、泛型） |
| GC | 早期无，2026 已标准化 | 内建 |
| 安全边界 | 线性内存沙箱 | 类型安全 + 安全管理器 |
| 语言无关 | 是 | 是 |
| 定位 | 更接近「可移植汇编」 | 更接近「运行时平台」 |

一句话：wasm 比 JVM **更底层、更简单、更贴近汇编**，没有内建 GC 与对象模型，代价是语言运行时（GC、调度）需要自带或由宿主提供。

## 工具链与语言生态

| 语言 | 工具链 | 特点 |
|---|---|---|
| C/C++ | **Emscripten** | 最成熟，能把 POSIX 代码移植到 Web，自动生成 JS 胶水 |
| Rust | **wasm-pack / wasm-bindgen** | 一等公民，适合写高性能 wasm 库 |
| Go | `GOOS=wasip1 GOARCH=wasm` | 官方支持，但二进制体积较大（自带运行时） |
| C# / Java / Kotlin | Blazor / GraalVM / TeaVM | 依赖 GC 提案，2026 已可落地 |
| AssemblyScript | 专用编译器 | TS 风格语法，适合前端团队写 wasm |

## WASI：走出浏览器

**WASI（WebAssembly System Interface）** 是 wasm 访问系统能力的标准接口，解决「wasm 在浏览器外如何安全访问文件、网络、时钟、随机数」的问题。

演进：

- **WASI Preview 1**：`wasi_snapshot_preview1`，仅覆盖 POSIX 风格的文件系统、时钟、随机数等基础调用，能力模型粗糙（基于 fd 的权限）。
- **WASI Preview 2（WASI 0.2，2024 稳定）**：**根本性变化**——基于**组件模型（Component Model）**，所有接口用 WIT（Wasm Interface Type）定义，引入「**能力安全（capability-based security）**」与「**World**」概念。标准化了 `wasi:io`、`wasi:cli`、`wasi:http`、`wasi:sockets` 等接口。这是 wasm 进入服务端生态的里程碑。
- **WASI Preview 3（进行中）**：主要目标是加入 **async 与线程支持**，预计随 WASI 0.3 在 2026 年推进。

**组件模型**：wasm 模块的组合标准，类似「wasm 版的接口 + 包管理」，让不同语言写的模块能按接口组合成更大应用。它是 WASI Preview 2 的核心，也是云原生「wasm 微服务」的基础。

## 2026 年提案标准化进度

来源：[WebAssembly 官方路线图](https://webassembly.org/roadmap/)。

### 已标准化（Phase 5）

| 特性 | 说明 | 主流支持 |
|---|---|---|
| **GC** | 托管语言（Java/C#/Kotlin/Dart）高效编译 | Chrome 119+ / Firefox 120+ / Safari 18.2+ |
| **Exception Handling** | wasm 原生 try/catch/throw，不依赖 JS 桥接 | Chrome 137+ / Firefox 131+ / Safari 18.4+ |
| **Memory64** | 64 位内存寻址，突破 4GB 限制 | Chrome 133+ / Firefox 134+ |
| **Fixed/Relaxed SIMD** | 128 位向量指令，加速图像/音频/ML | Chrome 91+ / Firefox 89+ |
| **Tail Calls** | 尾调用优化，函数式语言必需 | Chrome 112+ / Firefox 121+ |
| **Reference Types / Multi-value / Bulk Memory** | 基础能力 | 全平台 |

### 标准化中 / 实现中（Phase 4 / 3）

- **Threads（线程）**：主流浏览器已实现（Chrome 74+），但仍处 Phase 4，尚未正式标准化。
- **Stack Switching**：协程/异步底层，Wasmtime/Wasmer 已支持，浏览器仅 Chrome 实验性支持——是 WASI Preview 3 async 的基础。
- **ESM Integration**：Deno 已支持，浏览器进行中。

### 提案阶段（Phase 1-2）

- **Shared-Everything Threads**、**Flexible Vectors**、**JIT Interface**、**Reference-Typed Strings** 等仍处早期。

## 服务端与云原生：2026 落地现状

wasm 正从浏览器走向服务端，核心动力是「**比容器更轻、更快、更安全**」：

| 运行时 | 主导方 | 定位 |
|---|---|---|
| **Wasmtime** | Bytecode Alliance | 性能最优的通用运行时，2026 年 GitHub Star 突破 18K，年增长 40%+ |
| **WasmEdge** | CNCF 沙箱项目 | 云原生集成最佳，AI 推理场景强 |
| **Wasmer** | 独立 | 支持 15+ 语言编译到 wasm |
| **Spin** | Fermyon | 专为微服务/边缘设计的框架，成为边缘 wasm 应用的事实标准 |

关键进展：

- **Docker 原生支持**：Docker Engine 26.0（2025 底）集成 WASM 运行时，`docker run --platform=wasi/wasm32` 可直接跑 `.wasm`，无需 OS 层，启动毫秒级、内存占用极小。
- **CNCF 生态**：WasmCloud 进入孵化阶段。
- **规模**：2026 年约 **35% 的边缘工作负载、15% 的云原生应用已采用 wasm**，预计 2027 年超 50%（第三方估算，谨慎参考）。

优势：冷启动毫秒级、内存占用小、能力安全模型（默认无权限，需显式授予）、跨平台二进制一次编译到处跑。

边界：生态与工具链不如容器成熟、可观测性/调试能力仍在补、异步与线程（WASI Preview 3）尚未标准化。

## 典型应用场景

- **浏览器内**：游戏、设计工具、音视频转码、加密、AI 推理、SQLite 本地数据库。
- **服务端/边缘**：无服务器函数（FaaS）、边缘计算、插件系统、数据面代理（如 Envoy 的 wasm filter）。
- **区块链**：智能合约（如 Polkadot、CosmWasm 用 wasm 作为合约 VM）。
- **插件沙箱**：给宿主应用提供安全、跨语言的插件执行环境。

## 专题：wasm 做 AI 推理

AI 推理是 wasm 在 2026 年最受关注的落地方向之一，本文单独展开。

### 为什么要用 wasm 做 AI 推理

1. **隐私与离线**：模型与数据都在本地（浏览器或边缘设备）处理，不上传服务器，满足隐私合规与断网可用。
2. **零服务器成本**：推理算力下放到客户端，服务端无需 GPU 集群，成本近乎为零。
3. **跨平台一次编译**：同一份模型/推理代码可跑在浏览器、桌面、移动、边缘设备，无需为每个平台重写后端。
4. **沙箱安全**：运行第三方或不可信模型/代码时，wasm 的线性内存沙箱提供天然隔离。
5. **复用成熟 C/C++ 推理内核**：llama.cpp、ONNX Runtime 等本身就是 C/C++ 实现，可近乎直接编译到 wasm。

代价与边界：纯 wasm（CPU）推理性能弱于原生/GPU；需要配合 WebGPU、SIMD、线程等能力才能实用；模型体积与首次加载时间需权衡（量化 + 缓存）。

### 怎么做：两条技术路线

**路线一：浏览器内推理（wasm + WebGPU / SIMD / 线程）**

- wasm 承载**推理内核/执行器**（把 llama.cpp 等 C/C++ 内核编译到 wasm）。
- **WebGPU** 提供 GPU 加速做张量运算（矩阵乘法等）。
- **SIMD + Threads（Web Worker）** 在纯 CPU 场景下补性能。
- 模型量化（GGUF/Q4 等）减小体积、适配内存。
- 典型技术栈：Emscripten 编译 llama.cpp；或 TVM 编译链（WebLLM）。

**路线二：服务端/边缘推理（WASI-NN）**

- **WASI-NN（WebAssembly System Interface - Neural Network）** 是 WASI 为 AI/ML 推理定义的标准接口。
- 设计哲学：**wasm 模块本身不包含推理实现**——模型加载、GPU/NPU/TPU 加速、内存管理都在**宿主（Host）侧**完成；wasm 通过标准接口调用宿主能力，硬件无关。
- 接口分三层：`wasi-nn-graph`（加载 `.tflite`/`.onnx` 模型）、`wasi-nn-execution-context`（执行推理）、`wasi-nn-tensor`（张量内存管理）。
- 典型宿主：WasmEdge（`wasi_nn-ggml` / `wasi_nn-openvino` 插件）、Wasmtime。

### 有什么标准

| 标准 | 层级 | 说明 |
|---|---|---|
| **WASI-NN** | WASI 服务端 | 硬件无关的神经网络推理接口，让同一份 wasm 在 Wasmtime/WasmEdge/WAMR 等运行时无缝跑推理 |
| **WebNN** | W3C（浏览器） | 浏览器层面的硬件无关 AI 推理抽象，处于提案阶段 |
| **WebGPU** | W3C（浏览器） | 浏览器端 GPU 计算标准，wasm AI 推理的算力来源 |
| **W3C 一级语言地位** | 生态 | 2026-03-25 wasm 成为与 HTML/CSS/JS 并列的一级 Web 语言 |

需注意：WASI-NN 仍在演进（v0.2.0 仅定义 load/init/compute 等顶层接口，**算子覆盖不全**，跨运行时落地仍有摩擦）；浏览器对 WASI-NN 支持参差（Chrome 110 支持、Firefox/Safari 未完整跟进）。

### 成功案例

| 项目 | 说明 |
|---|---|
| **WebLLM**（`mlc-ai/web-llm`） | 高性能浏览器内 LLM 推理引擎，19k+ stars；TVM 编译链 + wasm 执行器 + WebGPU 加速；支持 Llama/Phi/Gemma/Mistral/Qwen 等 0.5B~8B 模型；OpenAI API 完全兼容 |
| **llama.cpp wasm 分支**（`tangledgroup/llama-cpp-wasm`） | 把纯 C/C++ 的 llama.cpp 编译到 wasm，浏览器内跑量化 LLM，支持 WebGPU 后端 |
| **WasmEdge + WASI-NN** | CNCF 沙箱项目 WasmEdge 通过 `wasi_nn-ggml`（LLM）、`wasi_nn-openvino`（CV）插件，在服务端/边缘跑跨平台模型推理 |
| **ONNX Runtime Web** | 微软 ONNX Runtime 提供 WebAssembly 后端，在浏览器跑 ONNX 模型 |
| **browser-llm**（`andreinwald/browser-llm`） | 纯前端项目，用 WebGPU + wasm 把 Llama 3.2-1B 跑进浏览器，探索本地化、隐私化 AI |

### 小结

wasm 做 AI 推理的本质是：**用 wasm 当「可移植的推理内核容器」，用 WASI-NN / WebNN 做「硬件无关的推理接口」，用 WebGPU / 宿主加速器做「算力来源」**。价值在隐私、零服务器成本与跨平台复用，代价在性能调优与模型体积管理。

## 专题：SQLite 本地（浏览器内数据库）

「SQLite 本地」是 wasm 另一个典型落地方向——把完整的 SQLite 关系型数据库跑进浏览器，支撑 **local-first（本地优先）** 应用。

### 为什么要用 wasm 跑 SQLite

1. **完整 SQL 能力**：浏览器原生只有 `localStorage`/`IndexedDB`（键值/对象存储，无 SQL、无关系查询），wasm 让浏览器第一次有了「真正的 SQL 数据库」。
2. **复用成熟内核**：SQLite 本身是 C 实现，编译到 wasm 即可近乎原样运行，ACID 事务、索引、视图等能力完整保留。
3. **性能接近原生**：SQL 查询、聚合、连接在浏览器内以接近原生速度执行，秒杀用 JS 模拟的查询。
4. **local-first 架构基石**：数据存本地 + 支持离线 + 增量同步，是 2026 年「本地优先」应用范式的核心组件。

### 官方说明

SQLite WASM 是 **SQLite 官方项目**（`sqlite.org/wasm`）的 WebAssembly + JavaScript API，官方定位是「让 sqlite3 能在现代支持 WASM 的浏览器中运行」。官方列出的核心特性：

- 浏览器端运行**完整** SQLite 引擎，非裁剪版
- 完整的 JavaScript API
- 多种持久化方案（OPFS 等）
- 支持在 JS 中创建虚拟表（Virtual Tables）和表值函数
- 支持在 JS API 中操作 C 结构体
- npm 分发，方便集成

官方认知的生态项目：`sql.js`（2012 年，首个浏览器跑 sqlite3 的项目）、`wa-sqlite`（首个实现 OPFS 存储 sqlite3 的项目）、`absurd-sql`（在 IndexedDB 中存 sqlite3）、`postgres-wasm`（浏览器跑 Postgres）、`CoWasm`、`sqlite-wasm-rs`（Rust 绑定）。

### 怎么做：方案与持久化

**官方项目**：SQLite 官方提供 `sqlite3.wasm`（`ext/wasm/`），配套 `sql.js`、`wa-sqlite` 等社区封装。核心挑战是**持久化**——wasm 的线性内存是易失的，需落到浏览器存储。官方支持以下持久化后端：

| 方案 | 存储后端 | 并发 | 需 COOP/COEP 头 | Safari | 特点 |
|---|---|---|---|---|---|
| **kvvfs** | localStorage/sessionStorage | 无 | 否 | 全版本 | 约 5MB 配额，仅适合极小数据/配置 |
| **opfs** | Origin Private File System | 有限 | 是 | ≥17 | 主方案，纯 JS 实现 `sqlite3_vfs` 包装 |
| **opfs-wl** | OPFS + Web Locks | 公平排队 | 是 | 较新 | 3.53 新增，FIFO 锁，性能相当 |
| **opfs-sahpool** | OPFS + SyncAccessHandle 池 | 无（需客户端配合） | **否** | ≥16.4 | **性能最高**，批量操作优势明显 |

**选型建议**（官方）：重视性能或无法设 COOP/COEP 头 → `opfs-sahpool`；需要多标签页并发 → `opfs` / `opfs-wl`。

关键细节：

- OPFS（Origin Private File System）是浏览器私有高性能文件存储，仅 Worker 线程可用，是 SQLite wasm 的**主要持久化方案**。
- `opfs` 需要 `SharedArrayBuffer`，故需 `Cross-Origin-Embedder-Policy: require-corp` + `Cross-Origin-Opener-Policy: same-origin` 响应头；`opfs-sahpool` 则无需。
- WAL 模式（3.47+）在 OPFS 上需 `locking_mode=exclusive`，会牺牲并发。

### 成功案例 / 采用

**官方文档明确收录的第三方采用**（`sqlite.org/wasm/doc/trunk/index.md`）：

| 项目 | 说明 |
|---|---|
| **SQLime** | 数据库浏览器界面 |
| **Evolu** | local-first（本地优先）平台，注重隐私、易用、无供应商锁定 |
| **SQLiteNext** | 与 Next.js 集成 |
| **sqlite-wasm-esm** | 与 Vite 工具链配合 |
| **sqlite-wasm-http** | 提供只读 HTTP 访问的 SQLite VFS |

**知名同赛道 / 相关案例**：

- **DuckDB-Wasm**：同为「SQL 数据库跑进浏览器」的标杆，VLDB 2022 论文证明「wasm 让浏览器内高效数据分析可行」，与 SQLite wasm 互为印证。
- **local-first 生产力工具**：笔记、项目规划、任务系统、轻量 CRM、个人知识库等，大量产品用 SQLite wasm + OPFS 实现「即时读写 + 离线 + 最终同步」。
- **postgres-wasm、absurd-sql**（James Long）：把 SQLite 存进 IndexedDB 的早期探索，推动了这个方向。

**边界说明**：官方收录的采用多为**开发者工具、平台与集成方案**，目前尚无像 Figma/AutoCAD 那样「大众皆知的消费级明星产品」。SQLite wasm 的价值更多体现在——它是 **local-first 应用范式的地基组件**，被大量产品以「基础设施」方式默默采用，而非以「某某产品用了 SQLite wasm」的方式显眼宣传。

### 小结

wasm 跑 SQLite 的本质是：**把成熟 C 数据库内核编译成 wasm，用 OPFS 等浏览器存储做持久化，让浏览器拥有真正的本地关系数据库**。它是 local-first 应用的地基，价值在「完整 SQL + 接近原生性能 + 离线可用」，代价在持久化方案的兼容性取舍（COOP/COEP、Safari 版本、并发）与存储配额管理。

## 需要关注的点 / 边界

| 方面 | 要点 |
|---|---|
| **不是 JS 替代** | 无 DOM 直接访问，UI 逻辑仍靠 JS，wasm 适合计算内核 |
| **调试与工具链** | 调试器、profiler、source map 支持不如原生成熟 |
| **GC/线程尚在收敛** | GC 已标准化，但 Threads 仍在 Phase 4、Shared-Everything 在提案期 |
| **二进制体积** | 带运行时的语言（Go）编译产物偏大，需关注体积 |
| **能力安全双刃剑** | WASI 默认无权限、显式授权，安全但接入成本高 |
| **性能预期** | 通常比 JS 快、比原生慢 10%~30%，非「免费午餐」；wasm2c 转 C 再编译甚至可跑赢部分专用运行时（2026 基准） |

## 一句话总结

**WebAssembly 是一台跨语言、跨平台、安全沙箱化的低层虚拟机，让高性能原生代码跑进浏览器与更多环境；它是 JS 的「高性能搭档」，并借由 WASI + 组件模型，正在从浏览器扩展到服务端、边缘与云原生，成为「容器之外」的下一代轻量运行单元。**

## 参考

- [WebAssembly 官方路线图（各提案状态）](https://webassembly.org/roadmap/)
- [WebAssembly 官网](https://webassembly.org/)
- [WebAssembly Component Model](https://github.com/WebAssembly/component-model)
- [Bytecode Alliance](https://bytecodealliance.org/)
- [WASI 规范](https://github.com/WebAssembly/WASI)
- [WebAssembly MDN 文档](https://developer.mozilla.org/docs/WebAssembly)
- [WebLLM（浏览器内 LLM 推理）](https://github.com/mlc-ai/web-llm)
- [llama.cpp wasm 分支](https://github.com/tangledgroup/llama-cpp-wasm)
- [WasmEdge（WASI-NN 宿主）](https://wasmedge.org/)
- [WASI-NN 提案](https://github.com/WebAssembly/wasi-nn)
- [SQLite WASM 持久化方案](https://sqlite.org/wasm/doc/trunk/persistence.md)
- [SQLite WASM 文档索引](https://sqlite.org/wasm/doc/trunk/index.md)
- [DuckDB-Wasm](https://duckdb.org/why_duckdb)
- [sqlite-wasm（ES Module 封装）](https://github.com/sqlite/sqlite-wasm)
- [sqlocal（OPFS 后端封装）](https://github.com/DallasHoff/sqlocal)
