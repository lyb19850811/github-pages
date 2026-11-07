---
report: 73
title: Python 装饰器深度研究：语法糖的编译期展开、闭包与 functools 底层
date: 2026-11-07
tags: [python, cpython, decorator, functools, closure, descriptor]
summary: 从 CPython 3.15 源码（Python/codegen.c、Lib/functools.py、Modules/_functoolsmodule.c、Objects/funcobject.c）与 PEP 318/3129/614/557 一手核验装饰器的底层实现：@ 语法糖在编译期由 codegen_decorators + codegen_apply_decorators 展开为「求值装饰器表达式 → MAKE_FUNCTION → 自底向上 CALL → STORE_NAME」，functools.wraps/update_wrapper 的元数据复制与 __wrapped__ 链、lru_cache 的 C 双向链表实现，以及 staticmethod/classmethod/property 为何「借了 @ 语法却不是真装饰器」。
math: false
---

## 一、结论先行

装饰器不是运行时魔法，而是**编译期展开的语法糖 + 高阶函数/闭包**。三条底层事实：

1. **`@deco def f` 在编译期被 CPython 编译器重写为 `f = deco(f)`**。3.15 里这发生在 `Python/codegen.c` 的 `codegen_decorators` + `codegen_apply_decorators`（注意：3.13 之前这段逻辑在 `Python/compile.c`，3.15 编译器已拆分为 `compile.c` 编排 + `codegen.c` 生成代码）。
2. **装饰器表达式自顶向下求值、自底向上应用**：`@a @b def f` 先求值 `a` 再求值 `b`（都在函数对象创建之前），但应用顺序是 `f = a(b(f))`（`b` 先包 `f`，`a` 再包 `b(f)`）。字节码可见：`LOAD a → LOAD b → MAKE_FUNCTION → CALL(b) → CALL(a) → STORE f`。
3. **`staticmethod`/`classmethod`/`property` 不是「返回新函数」的真装饰器，而是返回描述符对象**。它们借用了 `@` 语法，但语义走描述符协议（`__get__`）。这解释了「叠加顺序坑」：`@classmethod @staticmethod` 能跑、`@staticmethod @classmethod` 报 `TypeError: 'classmethod' object is not callable`——根源是 `staticmethod` 可调用（3.10 起 `sm_call` 委托给被包装函数）而 `classmethod` 不可调用（`tp_call = 0`）。

一句话定位：装饰器是**把「函数是一等公民」这一普通能力，用一行 `@` 语法固化成工程惯例**——没有虚拟机层面的特殊支持，全程是编译器的字节码生成 + 运行时的普通函数调用。

## 二、设计目标

### 2.1 PEP 318：把「变换」移到声明处

装饰器诞生前的写法（PEP 318 原文动机）：

```python
def foo(self):
    perform method operation
foo = classmethod(foo)
```

PEP 318 指出的问题：**关键的变换行为写在了函数体之后**，长函数会把「函数对外接口的关键组成」和「函数体其余部分」隔开；而且要写三次函数名（`def foo`、`foo =`、`classmethod(foo)`）才完成一次声明。目标是：

```python
@classmethod
def foo(self):
    perform method operation
```

| 项 | 值 | 依据 |
|---|---|---|
| 提案 | PEP 318 Decorators for Functions and Methods | `peps/pep-0318.rst` |
| 引入版本 | Python 2.4（仅函数/方法装饰器） | PEP 318 |
| 核心等价式 | `@deco def f` ≡ `f = deco(f)` | PEP 318 / 字节码 |

### 2.2 PEP 3129：类装饰器

PEP 318 当时把类装饰器视为「晦涩且不必要」而搁置（因为可以用 metaclass）。几年后 BDFL 重新评估：**metaclass 会被继承，类装饰器不会**；用 metaclass 表达「单个类的特定变换」既繁琐又脆弱。于是 PEP 3129 在 Python 3.0 引入：

```python
@foo
@bar
class A:
    pass
# 等价于
class A: pass
A = foo(bar(A))
```

| 项 | 值 | 依据 |
|---|---|---|
| 提案 | PEP 3129 Class Decorators | `peps/pep-3129.rst` |
| 引入版本 | Python 3.0 | PEP 3129 |
| 语义 | 与函数装饰器完全相同，只是装饰对象是类 | PEP 3129 Semantics |

### 2.3 PEP 614：放宽装饰器语法

装饰器最初要求「点分名 + 可选调用」，即 `@deco` 或 `@pkg.deco(x)`。PEP 614 在 Python 3.9 放宽为**任意合法表达式**：

```python
# 3.9 之前必须改写，3.9 起直接可写
@buttons[0].clicked.connect
def spam(): ...
```

Guido 当年限制语法只是「偏好，不是技术必要」；PyQt 的 `@buttons[i].clicked.connect` 这类真实用例促使语法放宽。

| 项 | 值 | 依据 |
|---|---|---|
| 提案 | PEP 614 Relaxing Grammar Restrictions On Decorators | `peps/pep-0614.rst` |
| 引入版本 | Python 3.9 | PEP 614 |
| 变化 | `@` 后从「点分名（+可选调用）」放宽为任意表达式 | PEP 614 |

### 2.4 PEP 557：装饰器作为「类后处理」的代表

`@dataclass`（PEP 557，3.7）是类装饰器的典型应用：**检查类定义里的带注解变量，往类里注入 `__init__`/`__repr__`/`__eq__` 等方法，并返回同一个类**（不是返回新类）。它说明装饰器的本质能力之一是「在声明点做一次性的元编程」，而 `dataclass` 本身只是个普通函数（`Lib/dataclasses.py` 纯 Python）。

## 三、特点

| 特点 | 说明 | 依据 |
|---|---|---|
| 编译期展开 | `@` 是语法糖，非运行时魔法；展开发生在编译器生成字节码时 | `Python/codegen.c` |
| 可叠加 | 多个装饰器自底向上应用 | PEP 318 / 字节码 |
| 装饰器工厂 | `@deco(x)` ≡ `deco(x)(f)`，工厂先求值得到装饰器再应用 | 语法规则 |
| 定义期求值 | 装饰器表达式与工厂参数在**定义时（import 时）求值一次**，不在每次调用时 | 字节码实测 |
| 元数据保留 | `functools.wraps` 复制 `__name__` 等 + 设 `__wrapped__` | `Lib/functools.py` |
| 签名穿透 | `inspect.signature`/`inspect.unwrap` 沿 `__wrapped__` 看穿 wrapper | `Lib/inspect.py` |
| 描述符型「装饰器」 | `staticmethod`/`classmethod`/`property` 返回描述符对象，非新函数 | `Objects/funcobject.c`、`Objects/descrobject.c` |
| 类装饰器 | `@deco class C` ≡ `C = deco(C)` | PEP 3129 |

## 四、使用场景

| 该用装饰器 | 不该用（换别的） |
|---|---|
| 横切关注点：日志 / 计时 / 重试 / 鉴权 / 限流 | 强耦合、需要读写多个函数的局部状态（改用显式调用） |
| 缓存 / 记忆化：`@functools.lru_cache`、`@functools.cache` | 装饰器数量过多导致调用栈深、调试困难 |
| 注册表：Flask `@app.route`、pytest `@pytest.fixture`、单例注册 | 逻辑依赖「装饰器求值顺序」这类隐式约定（易错） |
| 类后处理：`@dataclass`、`@total_ordering` | 用 decorator 替代一个简单的显式函数调用（过度包装） |
| 接口包装：`@contextmanager`、`@asynccontextmanager`、`@singledispatch` | 装饰器内部有副作用且依赖 import 顺序（隐式时序） |
| 描述符声明：`@property`、`@classmethod`、`@staticmethod` | 需要保留原函数对象本身做多重引用（装饰器会「替换」名字绑定） |

**典型范例**：`@functools.lru_cache(maxsize=128)` 记忆化递归/纯函数；`@app.route('/x', methods=['POST'])` 注册路由；`@dataclass` 免手写样板方法。反例：把装饰器当「魔法」掩盖一个本该显式传入的参数，或堆叠 5+ 个装饰器让签名和调试栈面目全非。

## 五、装饰器原理图解

### 5.1 编译期展开：`@a @b def f` 的字节码时序

![装饰器编译期展开与应用顺序]({{ '/assets/images/decorator-apply-order.svg' | relative_url }})

上图对应 CPython 3.15 实际字节码（本地 `dis.dis` 实测，Python 3.15.0）：

```
 1   LOAD_NAME    0 (a)      # ① 求值装饰器表达式 a（自顶向下）
 2   LOAD_NAME    1 (b)      # ② 求值装饰器表达式 b
 3   LOAD_CONST   0 (<code>) # ③ 函数体编译为 code object
     MAKE_FUNCTION          # ④ 由 code object 创建函数对象
 2   CALL         0          # ⑤ b(f) —— 最内层装饰器先应用
 1   CALL         0          # ⑥ a(b(f)) —— 外层再应用
 3   STORE_NAME   2 (f)      # ⑦ 结果重绑定到名字 f
```

两个易混淆点，一图说清：

- **求值顺序**（①→②）是**自顶向下**：`a` 先于 `b` 求值。
- **应用顺序**（⑤→⑥）是**自底向上**：`b` 先包 `f`，`a` 再包 `b(f)`。

这正是 `codegen_decorators`（正序遍历 `decorator_list` 逐条 `VISIT` 求值）与 `codegen_apply_decorators`（**倒序**遍历、逐条 `CALL`）在源码里的直接体现。

> 细节：糖展开用的是 `CALL 0`（函数对象占据 self 槽位），而手写 `a(b(f))` 会编译成 `PUSH_NULL` + `CALL 1`。这是编译器对装饰器应用的一条专用代码路径，不是普通的「函数调用另一函数」指令序列。

### 5.2 调用期：wrapper 闭包链与 `__wrapped__`

![装饰器调用链与 __wrapped__]({{ '/assets/images/decorator-call-chain.svg' | relative_url }})

调用 `f()` 时，真正执行的是 wrapper 链：外层 wrapper 捕获内层函数为闭包变量，逐层调用，最终抵达原始函数。`functools.wraps` 把原始函数的元数据复制到最外层 wrapper，并设置 `__wrapped__` 指回原始函数，让 `inspect.signature` / `inspect.unwrap` 能沿链看穿。

## 六、底层实现（源码级）

### 6.1 编译器展开：`codegen_decorators` + `codegen_apply_decorators`

3.15 编译器职责拆分（`Python/compile.c` 头注释）：`compile.c` 只做编排（future 检查 → 符号表 → 调 `codegen.c` → CFG → 汇编），实际代码生成在 `Python/codegen.c`。装饰器逻辑两段：

```c
// Python/codegen.c —— codegen_decorators：正序遍历，逐条求值入栈
static int
codegen_decorators(compiler *c, asdl_expr_seq* decos)
{
    for (Py_ssize_t i = 0; i < asdl_seq_LEN(decos); i++) {
        VISIT(c, expr, (expr_ty)asdl_seq_GET(decos, i));  // 求值每个装饰器表达式
    }
    return SUCCESS;
}

// Python/codegen.c —— codegen_apply_decorators：倒序遍历，逐条 CALL
static int
codegen_apply_decorators(compiler *c, asdl_expr_seq* decos)
{
    for (Py_ssize_t i = asdl_seq_LEN(decos) - 1; i > -1; i--) {
        location loc = LOC((expr_ty)asdl_seq_GET(decos, i));
        ADDOP_I(c, loc, CALL, 0);   // 自底向上应用
    }
    return SUCCESS;
}
```

在 `codegen_function`（约 codegen.c:1485-1574）里的调用次序，就是第 5.1 节字节码的直接来源：

```c
RETURN_IF_ERROR(codegen_decorators(c, decos));   // 先求值所有装饰器表达式
...
int ret = codegen_function_body(c, s, is_async, funcflags, firstlineno); // 生成 code object + MAKE_FUNCTION
...
RETURN_IF_ERROR(codegen_apply_decorators(c, decos));  // 再倒序 CALL
return codegen_nameop(c, loc, name, Store);          // 最后 STORE_NAME 重绑定
```

类装饰器同理（约 codegen.c:1690-1761），区别只是先 `LOAD_BUILD_CLASS` 构造类对象，再 `codegen_apply_decorators`。装饰器的语法位置由 AST 的 `decorator_list` 字段承载（`Parser/Python.asdl`：`FunctionDef`/`AsyncFunctionDef`/`ClassDef` 均含 `expr* decorator_list`）。

### 6.2 `functools.wraps` / `update_wrapper`：元数据复制与 `__wrapped__`

`Lib/functools.py`（3.15 行级）：

```python
WRAPPER_ASSIGNMENTS = ('__module__', '__name__', '__qualname__', '__doc__',
                       '__annotate__', '__type_params__')   # 行 32-33
WRAPPER_UPDATES = ('__dict__',)                              # 行 34

def update_wrapper(wrapper, wrapped,
                   assigned = WRAPPER_ASSIGNMENTS,
                   updated = WRAPPER_UPDATES):
    for attr in assigned:                  # 逐个复制「赋值型」属性
        try:
            value = getattr(wrapped, attr)
        except AttributeError:
            pass
        else:
            setattr(wrapper, attr, value)
    for attr in updated:                   # 逐个 merge「更新型」属性
        getattr(wrapper, attr).update(getattr(wrapped, attr, {}))
    # Issue #17482: 最后才设 __wrapped__，避免更新 __dict__ 时把它一并复制进来
    wrapper.__wrapped__ = wrapped
    return wrapper

def wraps(wrapped, assigned=..., updated=...):   # wraps = 一个装饰器工厂
    return partial(update_wrapper, wrapped=wrapped, assigned=assigned, updated=updated)
```

三个值得注意的版本细节：

1. **`__annotate__` 而非 `__annotations__`**：3.14+ 注解延迟求值（PEP 649 落地后），函数注解存于 `__annotate__`（惰性求值函数），`update_wrapper` 复制的是它。旧的 `__annotations__` 仍可用（通过 `__annotate__` 物化），但复制走的是惰性版本。
2. **`__type_params__`**：PEP 695（3.12）引入的泛型类型参数，也在复制清单里。
3. **`__wrapped__` 最后设置**：源码注释明确说明——若先设 `__wrapped__`，`updated` 阶段 `__dict__.update` 会把它从原函数复制进 wrapper 的 `__dict__`，污染元数据。

`wraps` 本身也是个「装饰器工厂」：`@wraps(f)` 先调 `partial(update_wrapper, wrapped=f)` 得到一个装饰器，再应用到 wrapper。`inspect.signature` 看穿 wrapper 的原理是沿 `__wrapped__` 链走到底（`inspect.unwrap` 同理），所以**只有正确设了 `__wrapped__`，签名内省才可靠**。

### 6.3 `functools.lru_cache`：C 双向链表 + dict

`functools.lru_cache` 在 CPython 里是 C 实现（`Modules/_functoolsmodule.c`），类型名 `_lru_cache_wrapper`；`Lib/functools.py` 里的同名实现只是非 CPython 的 fallback。

核心结构（`_functoolsmodule.c` 行级）：

```c
typedef struct lru_list_elem {          // 行 1176
    PyObject_HEAD
    struct lru_list_elem *prev, *next;  /* 借用引用，双向链表 */
    Py_hash_t hash;
    PyObject *key;
    PyObject *result;
} lru_list_elem;

typedef struct lru_cache_object {       // 行 1211
    lru_list_elem root;                 /* 含 PyObject_HEAD，链表哨兵 */
    lru_cache_ternaryfunc wrapper;      /* 指向 uncached/infinite/bounded 之一 */
    int typed;
    PyObject *cache;                    /* dict：key → lru_list_elem */
    Py_ssize_t hits, misses;
    Py_ssize_t maxsize;                 /* -1 = 无界 */
    ...
} lru_cache_object;
```

设计要点：

| 点 | 事实 | 依据 |
|---|---|---|
| 三态 wrapper | `maxsize==0` → `uncached_lru_cache_wrapper`；`None` → `infinite_lru_cache_wrapper`；正整数 → `bounded_lru_cache_wrapper` | `lru_cache_new`（行 1643-1657） |
| 数据结构 | **dict 查键 + 双向链表管 LRU 顺序**：链表节点既在链上，也是 dict 的值 | `lru_cache_object` 字段 |
| O(1) 命中 | 命中时 `lru_cache_extract_link` + `lru_cache_append_link` 把节点移到链表尾（最近使用） | `bounded_lru_cache_get_lock_held`（行 1418-1421） |
| 淘汰 | 缓存满时取 `root.next`（最久未用）摘链 + dict 删除 | `bounded_lru_cache_update_lock_held`（行 1517-1518） |
| 线程安全 | 3.13+ 用 critical section（`Py_BEGIN_CRITICAL_SECTION`）保护，而非全局 GIL 假设 | `bounded_lru_cache_wrapper`（行 1589-1591） |
| 四次 dict 调用 | 有界版本含 4 次 dict 调用：命中检查、用户函数返回后复查、删最旧、加最新 | 源码注释（行 1372-1375） |

`lru_cache` 是装饰器能力的边界案例：它返回的不再是「函数」，而是一个带 `cache_info()`/`cache_clear()` 方法的**可调用对象**（`_lru_cache_wrapper` 类型，`tp_call = lru_cache_call`），同时通过 `__wrapped__` 暴露原函数。这也说明装饰器「返回一个（通常不同的）可调用对象」里的「通常」二字的分量。

### 6.4 描述符型「装饰器」：为何不是真装饰器

`staticmethod` / `classmethod` 在 `Objects/funcobject.c`（注意：不是 `Objects/descrobject.c` 里的 `classmethod_descriptor`，那是 C 扩展 `METH_CLASS` 用的另一套）；`property` 在 `Objects/descrobject.c`。它们都是**类（callable 对象）**，`@` 应用后得到的是描述符实例，存放在类的 `__dict__` 里，属性访问走描述符协议。

```c
// Objects/funcobject.c
// classmethod：__get__ 把 callable 绑到类上，tp_call = 0（不可调用）
static PyObject *cm_descr_get(PyObject *self, PyObject *obj, PyObject *type) {
    classmethod *cm = (classmethod *)self;
    if (type == NULL) type = (PyObject *)(Py_TYPE(obj));
    return PyMethod_New(cm->cm_callable, type);   // 行 1540-1544
}
// ... PyClassMethod_Type 的 tp_call = 0（行 1702）

// staticmethod：__get__ 原样返回被包装函数，tp_call = sm_call（可调用，3.10 起）
static PyObject *sm_descr_get(PyObject *self, PyObject *obj, PyObject *type) {
    staticmethod *sm = (staticmethod *)self;
    return Py_NewRef(sm->sm_callable);            // 行 1802-1804
}
static PyObject *sm_call(PyObject *callable, PyObject *args, PyObject *kwargs) {
    staticmethod *sm = (staticmethod *)callable;
    return PyObject_Call(sm->sm_callable, args, kwargs);  // 行 1860-1862 委托给原函数
}
```

关键差异表：

| | `staticmethod` | `classmethod` | `property` |
|---|---|---|---|
| `__get__` 行为 | 原样返回被包装 callable | `PyMethod_New(callable, type)` 绑到类 | 调 getter（`property_descr_get`） |
| 可调用？ | 是（`sm_call` 委托，3.10 起） | 否（`tp_call=0`） | 否 |
| `__func__` / `__wrapped__` | 都指向被包装 callable | 同左 | 仅 `fget`/`fset`/`fdel` |

这精确解释了第 2 条结论的叠加顺序坑。`@classmethod @staticmethod def m` 展开为 `classmethod(staticmethod(f))`：访问 `A.m` 时 `classmethod.__get__` 把 `staticmethod` 对象绑到类上，调用时 `staticmethod.__call__`（可调用）委托给 `f(cls)`，返回类本身，**能跑**。反过来 `@staticmethod @classmethod def m` 展开为 `staticmethod(classmethod(f))`：`staticmethod.__get__` 原样返回 `classmethod` 对象，而 `classmethod` 不可调用，`A.m()` 直接 `TypeError: 'classmethod' object is not callable`。**实践中不要叠加这两者**——一个普通 `def` 定义在类体里，本就不需要 `staticmethod` 也能当「无 self 参数的方法」用；需要类对象就用 `@classmethod`。

## 七、缺点

| 缺点 | 说明 | 后果 |
|---|---|---|
| 元数据丢失 | 不 `wraps` 时，wrapper 的 `__name__`/`__doc__`/注解全变成 wrapper 自己的 | 日志、文档、签名内省全错 |
| 异步函数需 async wrapper | 同步 wrapper 包 `async def` 会返回协程对象而非可等待结果 | 需 `async def wrapper` + `await`，易漏 |
| 叠加顺序坑 | `staticmethod`/`classmethod` 返回描述符，非函数，叠加顺序敏感 | `@staticmethod @classmethod` 直接报错 |
| 定义期副作用 | 装饰器工厂参数在 import 时求值一次，注册/连接等副作用发生在模块加载期 | 隐式时序、循环 import 风险 |
| 内省被遮断 | wrapper 遮住原函数签名与属性（除非正确 `__wrapped__`） | `help()`/`inspect`/IDE 跳转失效 |
| 每次调用多一层开销 | wrapper 每次调用多一次函数调用（`lru_cache` 则多 hash + dict 查找） | 热路径可感知（通常 < 1μs 量级） |
| 调试栈加深 | 多装饰器嵌套让 traceback 多出若干 wrapper 帧 | 定位真正报错帧更费力 |

## 八、附录

### 8.1 PEP 索引

| PEP | 主题 | 版本 |
|---|---|---|
| PEP 318 | 函数/方法装饰器（`@` 语法） | Python 2.4 |
| PEP 3129 | 类装饰器 | Python 3.0 |
| PEP 614 | 放宽装饰器语法（任意表达式） | Python 3.9 |
| PEP 557 | Data Classes（`@dataclass`） | Python 3.7 |

### 8.2 CPython 源码索引（3.15）

| 文件 | 内容 |
|---|---|
| `Python/compile.c` | 编译器编排（头注释说明 codegen 在 codegen.c） |
| `Python/codegen.c` | `codegen_decorators` / `codegen_apply_decorators` / `codegen_function` / `codegen_class` |
| `Parser/Python.asdl` | AST `decorator_list` 字段定义 |
| `Lib/functools.py` | `update_wrapper` / `wraps` / `WRAPPER_ASSIGNMENTS`（行 32-63） |
| `Modules/_functoolsmodule.c` | `lru_cache` C 实现（行 1152-1906） |
| `Objects/funcobject.c` | `classmethod` / `staticmethod`（行 1480-2022） |
| `Objects/descrobject.c` | `property`（`property_descr_get` 等） |
| `Lib/inspect.py` | `signature` / `unwrap` 沿 `__wrapped__` 穿透 |

### 8.3 术语表

- **语法糖（syntactic sugar）**：不引入新语义、仅改善写法的语法，可被展开为既有构造。
- **desugar（去糖）**：编译器把语法糖还原成等价的基础操作。
- **装饰器工厂（decorator factory）**：返回装饰器的函数，`@deco(x)` 里的 `deco` 即工厂。
- **闭包（closure）**：函数连同其捕获的外层局部变量，wrapper 捕获被包装函数即闭包。
- **描述符（descriptor）**：实现了 `__get__`/`__set__`/`__delete__` 的对象，控制属性访问。
- **`__wrapped__`**：wrapper 指向被包装函数的约定属性，内省/反装饰据此穿透。

### 8.4 参考

- PEP 318 / 3129 / 614 / 557（`github.com/python/peps`）
- CPython 3.15 源码（`github.com/python/cpython`，`3.15` 分支）
- 官方文档：`docs.python.org/3/glossary.html#term-decorator`、`functools` 模块文档
- 本地实测：Python 3.15.0（`dis.dis`、`inspect.signature`、`functools.wraps`、`staticmethod`/`classmethod` 叠加）
