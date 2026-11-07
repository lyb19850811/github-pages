---
report: 72
title: Python deque 深度研究：块状双向链表的底层原理、复杂度与工程取舍
date: 2026-11-07
tags: [python, cpython, deque, collections, data-structures]
summary: 从 CPython 3.15 源码（Modules/_collectionsmodule.c）与本地实测一手核验 collections.deque：块状双向链表（BLOCKLEN=64、每块 528 字节）的底层结构、空 deque 居中表示、两端 O(1) 增删的指针移动、rotate 的块级搬运与 maxlen 修剪、freeblocks 空闲块复用、线程安全，并修正 68 号报告关于 sys.getsizeof(deque)「低报」的结论。
math: false
---

`deque`（double-ended queue）是 Python 标准库里「成本结构最纯粹」的容器——它只做一件事：**两端 O(1) 增删，绝不搬动其他元素、绝不 realloc**。本文基于 CPython 3.15 源码（`Modules/_collectionsmodule.c` 2906 行）与本地实测，按「设计目标 → 特点 → 场景 → 底层原理 → 缺点」五问深挖，配三张图解。读者定位：C++ 后端工程师。deque 在 **68 号报告**（collections 总览）里作为九类容器之一已有初步解剖，本文独立成篇、补图解与 benchmark，并**修正 68 号报告一处结论**（`sys.getsizeof(deque)` 并非低报）。

## 一、结论先行

- **deque 是「块状双向链表」，不是数组、不是每元素一节点。** 数据存于固定长度块（`BLOCKLEN=64`，每块 64 个指针 + 2 个链接指针 = **528 字节**），块间用 `leftlink`/`rightlink` 串成双向链表。
- **两端 O(1)、中间 O(n)。** `append`/`appendleft`/`pop`/`popleft` 只移动一个索引、写/读一个指针，绝不搬动其他元素、绝不 realloc（源码注释明示）。但 `d[i]` 中间索引要从近端**逐个块走**，O(n)——这是与 `std::deque`（块算术 O(1) 随机访问）的本质差异。
- **空 deque 用「居中表示」**：`leftindex=32`、`rightindex=31`（`CENTER=(64-1)/2=31`），使左/右任一方向 append 都有空间，无需立即分配新块。
- **`insert`/`remove`/`del d[i]` 都是「rotate 的包装」**：源码注释明示 `insert(index, v)` = `rotate(-index)` → `appendleft(v)` → `rotate(index)`，图简单而非图极致性能。
- **`maxlen` 有界队列**：满了之后 append 自动从**对面端**丢弃（`NEEDS_TRIM` 宏），等价 Unix `tail`。
- **修正 68 号结论**：`sys.getsizeof(deque)` **不会低报**。3.15 的 `deque.__sizeof__`（源码行级）返回 `结构体 232 + 块数×528`；实测每分配一块 getsizeof 精确 +528。68 号报告「只算结构体、不遍历块链表」的说法有误。

## 二、设计目标

### 2.1 唯一目标：两端 O(1) 增删，绝不搬动其他元素

`deque` 的设计目标写在 `_collectionsmodule.c` 顶部注释里，一字不差：

> Data for deque objects is stored in a doubly-linked list of fixed length blocks. This assures that appends or pops never move any other data elements besides the one being appended or popped. Another advantage is that it completely avoids use of realloc(), resulting in more predictable performance.

三个关键词：

1. **绝不搬动其他元素**——`list.insert(0, x)` 要把后面所有指针 `memmove` 一格（O(n)）；deque 的 `appendleft` 只移动 `leftindex`。
2. **绝不 realloc**——`list.append` 容量满时要 realloc 整个数组（可能搬动全部指针）；deque 只新分配/释放一个块。
3. **可预测的性能**——没有摊销式 realloc 的尖刺，适合实时/低延迟场景。

### 2.2 语义定位：双端队列 + MutableSequence

deque 是「栈 + 队列 + 双端队列」的统一抽象：`append`/`pop` 当栈用，`append`/`popleft` 当 FIFO 队列用，四个方法全上就是双端队列。它被注册为 `collections.abc.MutableSequence` 的虚拟子类（68 号报告详述虚拟子类机制），所以支持索引、切片、`in`、`+`、`*` 等序列协议——尽管中间操作是 O(n)。

### 2.3 为什么用「块」而不是「每元素一节点」

教科书式双向链表是「每元素一个节点」，但源码注释算了一笔账：每元素一个节点要 **200% 内存开销**（prev + next 两个链接指针，且每元素一次 malloc/free）。用固定长度块，链接指针摊薄到 64 个元素上，malloc 次数降 64 倍，连续指针还改善 cache locality。这是「块状链表」的经典工程动机。

## 三、特点

| 维度 | deque | 对照 list |
|---|---|---|
| 底层 | 块状双向链表（块长 64） | 动态指针数组 |
| 两端增删 | **O(1)** | 左端 O(n)、右端 O(1) 均摊 |
| 中间索引 `d[i]` | O(n)（从近端走块） | O(1) |
| 中间插入/删除 | O(n)（rotate 包装） | O(n) |
| 随机访问 | 无 O(1) | 有 |
| 内存 | 空 760 字节，每块 528 字节 | 空 56 字节 |
| 有界 | `maxlen` 可选 | 无 |
| 线程安全 | append/pop 文档声明线程安全 | 无此保证 |
| 特有方法 | `appendleft`/`popleft`/`rotate`/`extendleft`/`maxlen` | — |

一句话：**「两端都要快」→ deque；「随机访问 + 右端追加」→ list。**

## 四、使用场景

| 该用 deque | 不该用（用 list/其他） |
|---|---|
| FIFO 队列（`append` + `popleft`） | 需要 `d[i]` 随机访问 |
| 栈（`append` + `pop`） | 需要中间插入（两者都是 O(n)，但 deque 常数更大） |
| 滑动窗口 / 最近 N 条（`maxlen`） | 元素少、只要顺序遍历（list 更省内存更快） |
| 定长 tail（`deque(f, maxlen=n)` 保留文件最后 n 行） | 需要切片 `d[a:b]`（deque 切片 O(n) 且返回新 deque） |
| 轮转调度（`rotate(-1)` 把队首移到队尾） | 需要按值频繁查找（两者都是 O(n)，无优势） |
| `extendleft` 反向批量入队 | 需要排序/二分查找 |

**典型范例**：移动平均 `deque(iterable, maxlen=window)`——每次 append 自动挤出最旧值；BFS/队列；`roundrobin` 轮转；Unix `tail -n` 语义。

## 五、底层原理图解

### 5.1 结构：块状双向链表

![deque 块状双向链表结构]({{ '/assets/images/deque-structure.svg' | relative_url }})

`dequeobject` 结构体（`_collectionsmodule.c` 行级）关键字段：

```c
typedef struct BLOCK {
    struct BLOCK *leftlink;
    PyObject *data[BLOCKLEN];   /* 64 个指针 */
    struct BLOCK *rightlink;
} block;                        /* 8 + 512 + 8 = 528 字节 */

struct dequeobject {
    PyObject_VAR_HEAD
    block *leftblock;            /* 第一个元素所在块 */
    block *rightblock;           /* 最后一个元素所在块 */
    Py_ssize_t leftindex;        /* 0 <= leftindex < 64 */
    Py_ssize_t rightindex;       /* 0 <= rightindex < 64 */
    size_t state;                /* 索引每动一次 +1，迭代检测修改 */
    Py_ssize_t maxlen;           /* -1 = 无界 */
    block *freeblocks[MAXFREEBLOCKS];  /* 16 个空闲块缓存 */
};
```

**不变量**（源码注释）：`(leftindex + len - 1) % BLOCKLEN == rightindex`。`leftindex`/`rightindex` 是**闭区间**下标（与 Python 切片不同），这让左右操作完全对称。

### 5.2 两端增删：leftindex / rightindex 怎么动

![deque 两端增删四操作]({{ '/assets/images/deque-append-pop.svg' | relative_url }})

四个操作的共性：**只动一个索引 + 读/写一个指针**，所以 O(1)。

- `append(x)`：`rightindex++` 写入；块满（`rightindex==63`）时先在右端新分配一块。
- `appendleft(x)`：`leftindex--` 写入；`leftindex==0` 时先在左端新分配一块。
- `popleft()`：读 `data[leftindex]`，`leftindex++`；越过块尾（==64）时释放整块、跳到下一块。
- `pop()`：读 `data[rightindex]`，`rightindex--`；越过块头时释放整块、跳到上一块。

### 5.3 rotate 与 maxlen

![deque rotate 与 maxlen]({{ '/assets/images/deque-rotate-maxlen.svg' | relative_url }})

- `rotate(n)`：把右边 n 个元素搬到左边（n<0 反向）。源码 `_deque_rotate` 是**块级批量搬运**（`memcpy` 在块间移指针），且 `n` 超过长度一半时自动反向转，等效 O(min(n, len−n)) 的指针移动量。
- `maxlen`：`NEEDS_TRIM` 宏检测 `maxlen < size`，append 超限就调 `popleft` 丢最左元素、appendleft 超限就调 `pop` 丢最右元素，全程仍 O(1)。

## 六、底层实现（源码级）

### 6.1 块的分配与空闲块复用

`newblock` 先从 `freeblocks` 空闲列表取（有则复用，无则 `malloc`）；`freeblock` 在 `numfreeblocks < MAXFREEBLOCKS(=16)` 时把块塞回空闲列表，否则 `PyMem_Free`。这是**每个 deque 各自的** 16 块缓存，用于 `popleft`/`pop` 连续释放块时避免 malloc/free 抖动。

### 6.2 空 deque 的居中表示

`deque_new` 分配一块后设 `leftindex = CENTER+1 = 32`、`rightindex = CENTER = 31`。这样空 deque 在**左、右任一方向 append 都有空间**（右端可用 32..63 共 32 格、左端可用 0..31 共 32 格），无需立即分配新块。这也是为什么第一个块只装 32 个元素就「满」，后续块才装满 64 个。

### 6.3 内存：getsizof 是准的（修正 68 号）

`deque.__sizeof__`（源码 `deque___sizeof___impl`）：

```c
res = _PyObject_SIZE(Py_TYPE(deque));        /* 结构体 232 字节 */
blocks = (leftindex + len + BLOCKLEN - 1) / BLOCKLEN;
res += blocks * sizeof(block);               /* 每块 +528 字节 */
```

实测验证（Python 3.15.0）：

```text
空 deque = 760 字节（= 232 结构体 + 528 一块）
每分配一块 getsizeof 精确 +528（跳变点：33 / 97 / 161 元素）
200 元素 = 2344 字节（232 + 4 块×528）
```

**68 号报告说「`getsizeof(deque)` 低报、只算结构体」是错的**：760 这个数字本身就已经包含一块（528），且 `__sizeof__` 明确 `+blocks*sizeof(block)`。用 `getsizeof` 估 deque 内存是**准确**的。每个元素在块里的指针成本 ≈ 528/64 = 8.25 字节，再加元素对象本身。

### 6.4 复杂度与 `d[i]` 的从近端走

`deque_item`（索引 `d[i]`）源码：`i==0` 和 `i==len-1` 直接取端点（O(1)）；否则 `i < len/2` 从**左端**走、否则从**右端**走，O(min(i, len−i))。这是「从近端走块链表」的典型实现——没有 `std::deque` 那种「块指针数组 + 块内偏移」的 O(1) 随机访问。

### 6.5 线程安全

3.13+ 自由线程构建（PEP 703）下，`deque_append`/`deque_pop`/`deque_rotate` 等标了 `@critical_section`（每对象锁）。官方文档声明「deque 的 appends 和 pops 是线程安全的（从不同线程同时操作两端）」。这是 deque 相对 list 的独特卖点——list 无此保证。

### 6.6 insert/remove/del 都是 rotate 的包装

源码注释直白：

> insert(), remove(), and delitem() are implemented in terms of rotate() for simplicity and reasonable performance near the endpoints.

`insert(index, v)` = `rotate(-index)` → `appendleft(v)` → `rotate(index)`（把目标位置转到队首、插入、再转回去）。代价是中间插入每个指针可能被**移动两次**（源码注释承认「若这些方法变热门，改造成直接移动数据也不难，每个指针只移一次」）。

## 七、缺点

1. **中间索引/插入 O(n)**：`d[i]`、`d.insert(i)`、`d.remove(v)` 都比 list 慢（常数更大，且无 O(1) 随机访问）。这是 deque 与 list 最硬的边界。
2. **内存基线高**：空 deque 760 字节 vs 空 list 56 字节。元素少、只做顺序遍历时，list 更省更快。
3. **内存非连续**：数据分散在多个 528 字节块里，跨块访问有 cache miss（虽比每元素一节点好得多）。
4. **可变 → 不可哈希**：不能作 dict 的 key / set 元素（无 frozendeque）。
5. **迭代中改大小抛 RuntimeError**：`state` 字段检测，报「deque mutated during iteration」。
6. **切片/`+`/`*` 是 O(n) 且返回新 deque**：习惯 list 切片的人会踩「以为便宜」的坑。

## 八、附录

### 8.1 源码索引（CPython 3.15，`Modules/_collectionsmodule.c`）

| 主题 | 符号 / 行 |
|---|---|
| 结构体 | `BLOCK`（`data[64]`）、`dequeobject`（`leftindex`/`rightindex`/`state`/`freeblocks[16]`） |
| 常量 | `BLOCKLEN=64`、`CENTER=31`、`MAXFREEBLOCKS=16` |
| 空 deque 居中 | `deque_new`（`leftindex=CENTER+1`、`rightindex=CENTER`） |
| 两端增删 | `deque_append_lock_held`、`deque_appendleft_lock_held`、`deque_pop_impl`、`deque_popleft_impl` |
| rotate | `_deque_rotate`（块级 `memcpy` + halflen 优化） |
| 索引/插入 | `deque_item_lock_held`（从近端走）、`deque_insert_impl`（rotate 包装） |
| 内存 | `deque___sizeof___impl`（`+blocks*sizeof(block)`） |
| 线程安全 | `@critical_section` 装饰（PEP 703） |
| 有界 | `NEEDS_TRIM` 宏 |

### 8.2 本地实测数据（Python 3.15.0，darwin arm64）

```text
空 deque=760B  空 list=56B   块=528B（64 指针+2 链接）  结构体=232B
getsizeof 跳变：元素 33 / 97 / 161 处各 +528（精确对应新块分配）
popleft ×100k：deque=0.0036s  list.pop(0)=0.8015s   → list 慢 226 倍
中间索引 ×100k：deque=0.077s  list=0.0038s           → deque 慢 20 倍
append ×100k：deque=0.039s  list=0.031s              → 接近（list 略快）
rotate(1) ×100k：deque=0.0035s
maxlen=3 append(4)：[1,2,3] → [2,3,4]（左丢 1）
迭代中 append：RuntimeError「deque mutated during iteration」
```

### 8.3 参考文献

- [collections.deque 官方文档（中文）](https://docs.python.org/zh-cn/3/library/collections.html#collections.deque)
- CPython 3.15 源码：`Modules/_collectionsmodule.c`
- 本仓库 68 号报告《Python collections 深度研究》（deque 初步解剖）、70 号报告《Python 内置数据结构深度研究》
