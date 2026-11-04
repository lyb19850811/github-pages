---
report: 70
title: Python 内置数据结构深度研究：list/tuple/dict/set/str 的底层原理与选型边界
date: 2026-11-04
tags: [python, cpython, data-structures, list, dict, set, tuple, str]
summary: 从 CPython 3.15 源码（Objects/listobject.c、tupleobject.c、dictobject.c、setobject.c、unicodeobject.c 与对应头文件）一手核验五大内置数据结构：list 动态指针数组的 over-allocate 公式、tuple 定长数组与 freelist、dict/set 开放寻址哈希表（紧凑字典）、str 的 PEP 393 灵活表示；给出复杂度对照、适用场景与「相似结构差异」的四维取舍框架。
math: false
---

Python 的内置数据结构不是五个互不相干的名字，而是同一套工程取舍——**可变性 × 存储布局 × 访问模式 × 演进历史**——在不同维度上的投影。本文基于 CPython 3.15 源码（`Objects/listobject.c`、`tupleobject.c`、`dictobject.c`、`setobject.c`、`unicodeobject.c` 及对应 `Include/*.h` 头文件）与 Python 3.15.0 本地实测，逐一手核验五大最常用结构：`list`、`tuple`、`dict`、`set`、`str`。读者定位：C++ 后端工程师，故每节配 `std::` 对照。

## 一、结论先行

- **所有容器存的是「对象引用」（8 字节指针），不是值本身。** 只有 `array`、`bytes` 这类「紧凑类型」才存裸值。这是 Python 容器内存「比 C++ 同款大」的根本原因——`list[int]` 每个元素是 `PyObject*` + 堆上的 `int` 对象，而非连续 8 字节整数。
- **五种结构的底层分三类机制：动态指针数组（list）、定长指针数组（tuple）、开放寻址哈希表（dict/set）、紧凑字符数组（str）。** 三类机制直接决定复杂度画像：数组索引 O(1)、中间增删 O(n)；哈希表键操作均摊 O(1)；紧凑数组省内存但元素同型。
- **`list` 的 over-allocate 公式（源码级）**：`new_allocated = (newsize + (newsize >> 3) + 6) & ~3`，增长序列实测为 `0, 4, 8, 16, 24, 32, 40, 52, 64, 76, ...`——每次预留约 1/8 额外容量并对齐到 4 的倍数。
- **`dict` 是「紧凑字典」**：`PyDictKeysObject` 把哈希表拆成稀疏索引数组 `dk_indices` + 密集条目数组 `dk_entries`，负载因子 `USABLE_FRACTION = 2/3`；**插入序不是额外维护的，而是「顺序迭代 `dk_entries`」的免费副产品**（源码注释明示）。
- **`set` 与 `dict` 同源**，都是开放寻址哈希表，只是 `setentry` 只存 `key + hash` 不存 `value`；`PySet_MINSIZE = 8` 的小集合内联 `smalltable[8]`，所以空 `set` 占 216 字节而空 `dict` 只占 64 字节（本地实测）。
- **`str` 走 PEP 393 灵活表示**：按最大码点动态选 1/2/4 字节每字符——`maxchar < 128` 用 ASCII、`< 256` 用 Latin-1（均 1 字节）、`< 65536` 用 UCS-2（2 字节）、否则 UCS-4（4 字节）。
- **相似结构多的根源是四个正交维度的组合**：可变性（list↔tuple、set↔frozenset）、存储布局（list↔array↔deque）、访问模式（按位 vs 按键 vs 查存在）、演进历史（dict 有序化、namedtuple→dataclass）。

## 二、认识：四族分类与官方文档

### 2.1 四族分类

| 族 | 成员 | 一句话定位 |
|---|---|---|
| 序列（Sequence） | `list` `tuple` `str` `bytes` `bytearray` `range` | 按整数下标有序访问 |
| 映射（Mapping） | `dict` | 按任意可哈希键访问 |
| 集合（Set） | `set` `frozenset` | 只关心「是否存在」，去重 + 集合运算 |
| 文本/字节 | `str` `bytes` `bytearray` `memoryview` | 字符/字节序列，常跨「序列」族 |

`collections` 模块的 `deque`/`defaultdict`/`Counter`/`ChainMap`/`namedtuple` 等九类专用容器不在本文范围，已由 **68 号报告** 深挖，此处仅作选型对照。

### 2.2 官方与中文文档清单

| 文档 | 中文版 | 覆盖 |
|---|---|---|
| 教程 · 5. 数据结构 | [docs.python.org/zh-cn/3/tutorial/datastructures.html](https://docs.python.org/zh-cn/3/tutorial/datastructures.html) | list 全方法、推导式、tuple、set、dict、序列比较 |
| 标准库 · 内建类型 | [docs.python.org/zh-cn/3/library/stdtypes.html](https://docs.python.org/zh-cn/3/library/stdtypes.html) | 各结构的语义定义 |
| 语言参考 · 数据模型 | [docs.python.org/zh-cn/3/reference/datamodel.html](https://docs.python.org/zh-cn/3/reference/datamodel.html) | 可变性、`__hash__` 等底层语义（讲原理必读） |
| 标准库 · collections | [docs.python.org/zh-cn/3/library/collections.html](https://docs.python.org/zh-cn/3/library/collections.html) | 专用容器（68 号报告范围） |

第三方中文教程（易读，非权威）：[菜鸟教程 · Python3 数据结构](https://www.runoob.com/python3/python3-data-structure.html)、[廖雪峰 · list/tuple](https://liaoxuefeng.com/books/python/basic/list-tuple/index.html)、[廖雪峰 · dict/set](https://liaoxuefeng.com/books/python/basic/dict-set/index.html)。⚠️ 官方中文是社区翻译，可能滞后于英文版；**语义以英文版为准**，中文版用于快速阅读。

## 三、解剖：五种结构的底层实现

### 3.1 `list` —— 动态指针数组

**源码结构**（`Include/cpython/listobject.h` / `Objects/listobject.c`）：`PyListObject` 持有 `PyObject **ob_item`（指针数组）+ `Py_ssize_t allocated`（已分配容量）。`ob_size`（`Py_SIZE`）是当前长度，`allocated` 是容量；两者分离正是「动态数组」的标志。

**over-allocate 公式**（`py_list_resize` 源码，逐字）：

```c
new_allocated = ((size_t)newsize + (newsize >> 3) + 6) & ~(size_t)3;
```

即 `newsize + newsize/8 + 6`，再对齐到 4 的倍数。源码注释给出增长序列 `0, 4, 8, 16, 24, 32, 40, 52, 64, 76, ...`，本地 `sys.getsizeof` 实测完全吻合：

| 长度 n | sizeof(list) | 容量（推断） |
|---|---|---|
| 0–3 | 88 | 4 |
| 4–7 | 120 | 8 |
| 8–15 | 184 | 16 |
| 16–23 | 248 | 24 |
| 24–29 | 312 | 32 |

**复杂度来源**：`append` 只在容量满时才 realloc，均摊 O(1)；但**中间 `insert`/`del` 要 `memmove` 后续所有指针**（源码 `list_insert` 里 `for (i = n; --i >= where;) items[i+1] = items[i]`），是 O(n)。这与 `std::vector` 完全同构：连续内存、索引 O(1)、尾部增删均摊 O(1)、中间 O(n)。

**内存细节**：`list` 存指针而非值 → 可异构（一个 list 可同时装 `int`/`str`/自定义对象）；每个元素是 8 字节指针 + 堆上对象本身。空 `list` 占 56 字节，空 `tuple` 占 48 字节，差的 8 字节正是 `allocated` 字段（tuple 无容量概念）。

### 3.2 `tuple` —— 定长不可变指针数组

**源码结构**（`Include/cpython/tupleobject.h`）：

```c
typedef struct {
    PyObject_VAR_HEAD
    Py_hash_t ob_hash;
    PyObject *ob_item[1];
} PyTupleObject;
```

创建时一次性分配 `ob_size` 个指针，之后**长度和内容都不可变**。没有 `allocated` 字段，所以比 `list` 省 8 字节头 + 无 over-allocate 浪费。

**freelist 缓存**（`Objects/tupleobject.c`）：小 tuple 释放时不真正归还内存，而是按长度放进 freelist 复用：

```c
index = size - 1;
if (index < PyTuple_MAXSAVESIZE)   /* 20 */
    _Py_FREELIST_POP(PyTupleObject, tuples[index]);
```

`PyTuple_MAXSAVESIZE = 20`：长度 ≤20 的 tuple 享受 freelist 复用，`PyTuple_MAXFREELIST = 2000` 限制每个尺寸最多缓存 2000 个。这是「不可变 + 高频小对象」场景的典型优化（同理 `str` 有 intern、小整数有缓存池）。

**可哈希**：`ob_hash` 字段缓存 `__hash__` 值；只要所有元素可哈希，tuple 即可哈希 → 可作 `dict` key / `set` 元素。这是 tuple 与 list 最本质的语义分界。

### 3.3 `dict` —— 紧凑哈希表

**这是五种结构里最值得精读的一个。** 现代 CPython（3.6+）的 dict 不是经典「key-value 数组 + 桶链表」，而是**紧凑字典**（compact dict），源码 `Objects/dictobject.c` 顶部注释画了结构图：

```
+---------------------+
| dk_refcnt           |
| dk_log2_size        |
| dk_log2_index_bytes |
| dk_kind             |
| dk_version          |
+---------------------+
| dk_indices[]        |   ← 稀疏索引数组（真哈希表）
+---------------------+
| dk_entries[]        |   ← 密集条目数组（顺序存储）
+---------------------+
```

- **`dk_indices`** 是真正的哈希表：每个槽存「entry 下标」，或 `DKIX_EMPTY(-1)` / `DKIX_DUMMY(-2)`。槽类型随表大小变（int8/int16/int32/int64）。
- **`dk_entries`** 是密集数组，元素为 `PyDictKeyEntry {me_key, me_hash, me_value}`（通用键）或 `PyDictUnicodeEntry`（纯字符串键，省掉 `me_hash` 字段——字符串 hash 缓存在对象里）。长度 = `USABLE_FRACTION(dk_size)`。
- **插入序是免费的**：源码注释明示「`dk_entries` is mostly append only, we can get insertion order by just iterating `dk_entries`」。所以 3.7 起「dict 保序」不是额外链表维护，而是紧凑布局的副产品。
- **负载因子**：`USABLE_FRACTION(n) = ((n) << 1) / 3`，即 **2/3 满就扩容**（源码注释：1/2 到 2/3 之间实践最优）。
- **探测**：开放寻址 + 扰动，`i = (i * 5 + 1 + perturb) & mask`，`perturb >>= PERTURB_SHIFT`（与 `set` 同一套）。
- **三种 kind**：`DICT_KEYS_GENERAL`（任意键）、`DICT_KEYS_UNICODE`（全字符串键，走 `_PyDictKeys_StringLookup` 快路径）、`DICT_KEYS_SPLIT`（共享键，用于对象属性）。

**版本边界（关键）**：3.6 引入紧凑字典时**顺带**保持了插入序，但这是 CPython 实现细节；3.7 才把「插入序」写入语言规范（What's New 3.7）。这意味着：**写库代码若依赖 dict 顺序，3.7+ 才安全**；3.6 及以下无此保证。

### 3.4 `set` / `frozenset` —— 只存键的哈希表

**源码结构**（`Include/cpython/setobject.h`）：

```c
typedef struct {
    PyObject *key;
    Py_hash_t hash;   /* Cached hash code of the key */
} setentry;

typedef struct {
    PyObject_HEAD
    Py_ssize_t fill;   /* active + dummy 槽数 */
    Py_ssize_t used;   /* active 槽数 */
    Py_ssize_t mask;   /* 表大小 - 1（2 的幂） */
    setentry *table;
    Py_hash_t hash;    /* 仅 frozenset 用 */
    Py_ssize_t finger; /* pop() 的搜索指针 */
    setentry smalltable[PySet_MINSIZE];  /* 8 个内联槽 */
    PyObject *weakreflist;
} PySetObject;
```

与 dict 的关键差异：

- `setentry` **只存 `key + hash`，没有 `value`**——所以 set 是「值就是键」的哈希表。
- **小集合内联 `smalltable[8]`**：`PySet_MINSIZE = 8`，≤8 个元素时不 malloc，直接内联在对象里。这是空 `set` 占 216 字节（vs 空 `dict` 64 字节）的原因——8 个 `setentry`（各 16 字节）= 128 字节内联槽。
- **负载因子 0.6**：`fill*5 >= mask*3` 触发 resize（`set_add_entry_takeref` 里 `(size_t)so->fill*5 < mask*3` 不扩容），比 dict 的 2/3 略保守，因为 set 无 value 分摊开销。
- **`frozenset` 可哈希**：hash = 对所有元素 hash 的「乱序位异或」（`_shuffle_bits(entry->hash)` 后 xor），与顺序无关——这正是「集合相等性」要求（两个集合相等当且仅当元素相同，与顺序无关）。
- `set` 与 `frozenset` 共享同一个 `PySetObject` 结构（源码注释明示「shared by set and frozenset objects」），差别只在类型对象的可变方法集。

### 3.5 `str` —— PEP 393 灵活表示

**核心思想**：字符串不必每个字符都占 4 字节（UCS-4），而是按「最大码点」选最窄表示。源码 `_PyUnicode_FromUCS*` 的 kind 选择逻辑（`unicodeobject.c`）：

| 最大码点 maxchar | kind | 每字符字节 |
|---|---|---|
| `< 128` | `PyUnicode_1BYTE_KIND` + ASCII 标志 | 1 |
| `< 256` | `PyUnicode_1BYTE_KIND`（Latin-1） | 1 |
| `< 65536` | `PyUnicode_2BYTE_KIND`（UCS-2） | 2 |
| 否则 | `PyUnicode_4BYTE_KIND`（UCS-4） | 4 |

三种对象形态：`PyASCIIObject`（纯 ASCII，最省）、`PyCompactUnicodeObject`（紧凑，数据紧随对象头）、`PyUnicodeObject`（传统，数据堆上单独分配）。标志位 `ascii` / `compact` / `kind` 记录在对象状态里。

**intern 机制**：每个解释器维护一个 intern 字典（`interned_strings`）+ 静态 intern 哈希表。标识符、字符串字面量等会被 intern——相同内容共享同一对象，使「字符串相等比较」可先比 `is`（指针相等）再比内容，并让 dict 的字符串键查找走 `_PyDictKeys_StringLookup` 快路径。这与 C++ 的字符串池、Java 的 `String.intern()` 同源。

**与 bytes 的关系**：`str` 存 Unicode 码点（1/2/4 字节），`bytes` 存 8 位字节（1 字节），二者**不共享底层表示**；`memoryview` 则是「不拷贝的缓冲区视图」，用来零拷贝访问 `bytes`/`bytearray`/numpy 数组的内存。

## 四、复杂度与适用场景

### 4.1 复杂度对照表

| 结构 | 底层 | 索引/按键 | 尾部增删 | 中间增删 | 成员测试 | 内存 |
|---|---|---|---|---|---|---|
| list | 动态指针数组 | O(1) | O(1) 均摊 | O(n) | O(n) | 中（存指针） |
| tuple | 定长指针数组 | O(1) | —（不可变） | — | O(n) | 略小于 list |
| dict | 紧凑哈希表 | O(1) 均摊 | O(1) 均摊 | — | O(1) 均摊 | 高 |
| set/frozenset | 哈希表（只存键） | — | O(1) 均摊 | — | O(1) 均摊 | 高 |
| str/bytes | 紧凑字符数组 | O(1) | — | — | O(n) | 低（1/2/4 B/字符） |
| range | 惰性 (start,stop,step) | O(1) | — | — | O(1) | O(1) |

（参照，不在本文深挖：`deque` 两端 O(1)/中间 O(n)、`array` 紧凑同型、`heapq` 基于 list 的二叉堆 O(log n)。）

### 4.2 适用场景 + 反例（双向论证）

| 结构 | 该用 | 不该用 |
|---|---|---|
| list | 通用有序可变序列、栈、顺序遍历、结果收集 | 频繁「按值查找」（O(n) 应用 set/dict）、大量中间插入（应用 deque） |
| tuple | 不可变记录、多返回值、dict key、常量表、需要「不可变保证」 | 需要原地修改的内容 |
| dict | 键值映射、缓存、计数、图邻接表、JSON 对象 | 只需「是否存在」时（应用 set，省一半内存） |
| set/frozenset | 去重、O(1) 成员测试、集合交并差 | 需要顺序、需要重复元素时 |
| str | 文本处理 | 二进制数据（应用 bytes）、大量可变字符拼接（用 `''.join` 而非 `+`） |

## 五、为什么相似结构这么多？—— 四维取舍框架

「为什么 list 和 tuple 这么像却有俩」「dict 和 set 是不是一回事」——答案都在四个正交维度上。**每个维度单独成对，两两组合就产生了大量「形似神不似」的结构。**

### 维度一：可变性（mutable vs immutable）

`list`↔`tuple`、`set`↔`frozenset`、`bytearray`↔`bytes`。不可变带来的**三个硬收益**：

1. **可哈希** → 可作 dict key / set 元素（`tuple` 能、`list` 不能，`frozenset` 能、`set` 不能）。
2. **可安全共享** → 不可变对象可被多处引用而无需防御性拷贝，天然线程安全。
3. **可复用缓存** → tuple 的 freelist、str 的 intern，都建立在「不可变」前提上。

代价是「不能原地改」，频繁改动的场景只能退回可变版本。

### 维度二：存储布局（指针数组 vs 紧凑数组 vs 哈希表 vs 链表）

- `list`（指针数组）↔ `array`（裸值数组）：前者异构灵活、后者同型省内存但读写有装箱/拆箱开销。
- `list`（连续数组，索引快、中间慢）↔ `deque`（块状双向链表，两端快、中间慢）：见 68 号报告。
- `dict/set`（哈希表，键 O(1)）↔ `list`（顺序数组）：哈希表要求元素**可哈希**且内存高，顺序数组则对「按值查找」无能为力。

### 维度三：访问模式（按位 / 按键 / 查存在）

- `list/tuple/str` 按**整数下标**访问；
- `dict` 按**任意可哈希键**访问；
- `set` 只回答**「在不在」**。

同一个「查找」需求，三种结构给出三种代价与语义。

### 维度四：演进历史（新类型是旧类型「语义不够用」的补丁）

- **dict 有序化**：3.7 前 dict 无序 → 用 `OrderedDict` 补「保序」；3.7 后普通 dict 已有序 → `OrderedDict` 只剩 `move_to_end()` + 顺序敏感 `==`（68 号报告详述）。
- **轻量记录**：`tuple`（无名字）→ `namedtuple`（命名不可变）→ `dataclass`（可变可注解）→ `typing.NamedTuple`（类型检查友好）。四者语义/可变性/内存各不相同，是「用类表达记录」的渐进式需求。

### 五组成对对比速查

| 对比 | 本质差别 |
|---|---|
| list ↔ tuple | 可变性（能否原地改 / 能否哈希）+ 内存（allocated 字段 + over-allocate） |
| dict ↔ set | set 是「只有键没有值」的 dict，`setentry` 省掉 value |
| set ↔ frozenset | 可变性 + 可哈希（能否作 key/set 元素） |
| str ↔ bytes | Unicode 码点（1/2/4B）vs 8 位字节（1B），互不共享表示 |
| list ↔ array ↔ deque | 指针数组 vs 裸值数组 vs 块链表（布局 + 访问模式） |
| namedtuple ↔ dataclass | 不可变 tuple 子类 vs 可变类（见 68 号报告） |

## 六、附录

### 6.1 源码索引（CPython 3.15）

| 结构 | 实现文件 | 关键符号 |
|---|---|---|
| list | `Objects/listobject.c`、`Include/cpython/listobject.h` | `py_list_resize`、`LIST_SMALL_ALLOCATED` |
| tuple | `Objects/tupleobject.c`、`Include/cpython/tupleobject.h` | `PyTuple_MAXSAVESIZE`、freelist |
| dict | `Objects/dictobject.c`、`Include/cpython/dictobject.h` | `PyDictKeysObject`、`USABLE_FRACTION` |
| set | `Objects/setobject.c`、`Include/cpython/setobject.h` | `setentry`、`PySet_MINSIZE` |
| str | `Objects/unicodeobject.c`、`Include/cpython/unicodeobject.h` | `PyUnicode_*BYTE_KIND`、`interned` |

### 6.2 本地实测数据（Python 3.15.0，darwin arm64）

```text
n=   0: list= 56  tuple= 48
n=   4: list= 88  tuple= 80
n=1000: list=8056  tuple=8048
list sizeof growth (append 0..29): 88,88,88,88,120,...,184,...,248,...,312
empty set=216  empty dict=64
dict order (insert 'zebra'): ['z','e','b','r','a']   # 插入序保序
```

- 空 list 56 / 空 tuple 48 的 8 字节差 = `allocated` 字段。
- list 增长序列 `4→8→16→24→32` 精确吻合源码 over-allocate 公式。
- 空 set 216 字节 = 内联 `smalltable[8]`（128 字节）主导；空 dict 64 字节（共享空键对象）。
- dict 插入序 `z,e,b,r,a` 实证 3.7+ 保序。

### 6.3 参考文献

- [Python 教程 · 5. 数据结构（中文）](https://docs.python.org/zh-cn/3/tutorial/datastructures.html)
- [Python 标准库 · 内建类型（中文）](https://docs.python.org/zh-cn/3/library/stdtypes.html)
- [Python 语言参考 · 数据模型（中文）](https://docs.python.org/zh-cn/3/reference/datamodel.html)
- [PEP 393 — Flexible String Representation](https://peps.python.org/pep-0393/)
- [What's New in Python 3.7（dict 保序）](https://docs.python.org/3/whatsnew/3.7.html)
- CPython 3.15 源码：`Objects/{listobject,tupleobject,dictobject,setobject,unicodeobject}.c`
- 本仓库 68 号报告《Python collections 深度研究》
