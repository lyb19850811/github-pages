---
report: 68
title: Python collections 深度研究：九种专用容器与 dict/tuple/list 的工程边界
date: 2026-11-01
tags: [python, collections, cpython, deque, namedtuple, defaultdict, counter, dict]
summary: 从 CPython 3.15 源码（Modules/_collectionsmodule.c 与 Lib/collections/__init__.py）与官方文档一手核验 collections 模块：deque 的块状双向链表、dict 系（defaultdict/OrderedDict/Counter/ChainMap）的 __missing__ 机制、namedtuple 的 eval 生成与 __slots__、User* 包装器，以及它们与内置 dict/list/tuple 和 dataclasses 的选型边界。
math: false
---

`collections` 是 Python 标准库里对内置容器 `dict` / `list` / `set` / `tuple` 的一层「专用化补充」：九个类，每个都是「内置容器解决不了某类专门问题」的答案。本文基于 CPython 3.15 源码（`Modules/_collectionsmodule.c` 的 deque C 实现、`Lib/collections/__init__.py` 的纯 Python 实现）与官方文档一手核验：deque 的块状双向链表、dict 系的 `__missing__` 钩子、namedtuple 的 `eval` 生成与 `__slots__`、User* 包装器，以及它们与内置容器、`dataclasses` 的选型边界。读者定位：C++ 后端工程师，故每节配 `std::` 对照。

## 一、结论先行

- **九个类分三族：C 加速的「性能容器」、dict 系的「语义扩展」、纯 Python 的「工厂/包装」。** `deque`/`defaultdict`/`OrderedDict` 在 3.15 里都是 C 实现（`_collections` 模块）；`Counter`/`ChainMap`/`namedtuple`/`UserDict`/`UserList`/`UserString` 是纯 Python（`collections/__init__.py`）。C 化与否直接决定热路径性能。
- **deque 是「块状双向链表」，不是「环形数组」。** C 源码 `_collectionsmodule.c` 明示：`BLOCKLEN=64`（每块 64 个指针）、`MAXFREEBLOCKS=16`（块空闲链表复用）、数据存于**固定长度块的双向链表**。这带来两端 O(1)、中间 O(n) 的索引——与 `std::deque` 的 O(1) 随机访问**不同**：Python 故意放弃中间随机访问，换取「append/pop 绝不搬动其他元素、绝不 realloc」的可预测性。
- **dict 系的共同基石是 `__missing__` 钩子。** `defaultdict` 和 `Counter` 都靠覆盖 `__missing__(key)`：前者调 `default_factory`，后者返回 0。**关键坑：`__missing__` 只被 `__getitem__`（`d[k]`）触发，不被 `d.get(k)` / `d.setdefault` / `in` 触发**——这是 `defaultdict` 最常被误解的一点（已实测验证）。
- **`OrderedDict` 在 3.7 后已「被 dict 背刺」。** 内置 `dict` 自 3.7 起保证插入序，`OrderedDict` 只剩三个 `dict` 没有的「重排」能力：`move_to_end()`（含 O(1) 移到队首，dict 无等价）、`popitem(last=False)`（FIFO 弹出）、**顺序敏感的 `==`**（`OrderedDict([a,b]) != OrderedDict([b,a])`，而 `dict` 顺序不敏感）。它的适用场景收窄到 LRU 缓存一类。
- **`namedtuple` 是「eval 生成 + 空 `__slots__`」的 tuple 子类。** 源码用 `eval` 拼 `lambda _cls, x, y, z: _tuple_new(_cls, (x, y, z))` 生成 `__new__`；`class_namespace['__slots__'] = ()`（tuple 本就无实例 dict）+ 每个字段用 C 的 `_tuplegetter`（`operator.itemgetter` 包装成 property）。**实测 `namedtuple` 实例与同字段普通 `tuple` 等大（72 字节）、无 `__dict__`**；`dataclass`（无 slots）则每个实例挂一个 `__dict__`，字段实际存在那里面。
- **选型边界一句话：** 两端增删/定长缓冲 → `deque`；计数/多重集 → `Counter`；缺键自动建值 → `defaultdict`；需要重排（LRU）→ `OrderedDict`；只读命名记录、要 tuple 兼容 → `namedtuple`；可变命名记录、要类型注解 → `dataclass`；分层配置覆盖 → `ChainMap`；要子类化 dict/list/str → `User*`（而不是直接子类化内置类型）。

## 二、认识：九个类与 C/Python 分工

| 类 | 定位 | 3.15 实现 | 对应 C++ |
|---|---|---|---|
| `deque` | 两端 O(1) 的双端队列 | **C**（`_collections`） | `std::deque`（但中间随机访问语义不同） |
| `defaultdict` | 缺键调工厂自动建值 | **C** | `std::map` 的 `operator[]`（默认构造） |
| `OrderedDict` | 记插入序 + 可重排的 dict | **C**（3.15） | 按「插入序」而非「键序」的 `std::map` |
| `Counter` | 可哈希对象计数（多重集/bag） | 纯 Python（C 辅助 `_count_elements`） | `std::multiset` |
| `ChainMap` | 多个映射的单一视图 | 纯 Python | 无直接对应（嵌套作用域/配置分层） |
| `namedtuple` | 带字段名的 tuple 子类 | 纯 Python 工厂（C 辅助 `_tuplegetter`） | `struct`（但不可变） |
| `UserDict` / `UserList` / `UserString` | 便于子类化的包装器 | 纯 Python | 无直接对应（组合优于继承） |

两个关键实现事实（源码级核实）：

- **C 化的判定**：`collections/__init__.py` 顶部 `from _collections import deque, defaultdict`，文件尾还有 `from _collections import OrderedDict`（覆盖纯 Python 回退）。实测 `_collections` 导出 `deque, defaultdict, OrderedDict, _count_elements, _tuplegetter, _deque_iterator, _deque_reverse_iterator` 七个名字；`collections.OrderedDict` 无 `__hardroot`、类字典里无 `__new__`，证明 3.15 走的是 C 版。
- **`Counter`/`ChainMap`/`namedtuple` 纯 Python**，但 Counter 的计数热路径 `_count_elements`、namedtuple 的字段访问 `_tuplegetter` 都下沉到 C 辅助函数——「Python 逻辑 + C 热点」是标准库的常见分层。

### `collections.abc`：结构类型的根基

`collections.abc` 提供 `Container` / `Iterable` / `Iterator` / `Sized` / `Callable` / `Hashable` / `Sequence` / `MutableSequence` / `Mapping` / `MutableMapping` / `Set` / `MutableSet` / `MappingView` 等抽象基类。关键是**虚拟子类（virtual subclass）**机制：任何实现对应协议的类，即使不显式继承 ABC，也会被 `isinstance(x, collections.abc.Sequence)` 判定为真——靠 `__subclasshook__` 做结构化判定。这与 C++ 的 `concept`/`requires`（C++20）同源：**按「能做什么」而非「继承自谁」判定类型**。`deque` 正是靠 `_collections_abc.MutableSequence.register(deque)` 注册为 `MutableSequence` 的虚拟子类（`__init__.py` 明示）。

## 三、解剖：deque 的块状双向链表

### 为什么不用数组、也不用「每元素一个节点」

C 源码注释原文给了三个设计理由：

1. **append/pop 绝不搬动其他元素**——与 `list` 的 `insert(0, v)`/`pop(0)` 触发 O(n) 内存搬移形成对照。
2. **完全避免 realloc**——性能可预测（`list` 扩容会 realloc）。
3. **教科书双向链表每元素一个节点 → 200% 内存开销（prev+next 两个指针）+ 每元素一次 malloc**；改用固定长度块，指针开销摊薄、malloc 次数按比例下降、连续指针块还改善 cache 局部性。

### 结构（源码 `_collectionsmodule.c`）

```
BLOCKLEN 64         // 每块 64 个 PyObject* 指针
CENTER  31          // (64-1)/2，空 deque 的中心偏移
MAXFREEBLOCKS 16    // 块空闲链表上限
```

```c
typedef struct BLOCK {
    struct BLOCK *leftlink;
    PyObject *data[BLOCKLEN];   // 64 个指针
    struct BLOCK *rightlink;
} block;

struct dequeobject {
    block *leftblock, *rightblock;
    Py_ssize_t leftindex, rightindex;  // 0 <= index < 64
    size_t state;              // 索引变化即 +1，用于迭代中检测变更
    Py_ssize_t maxlen;         // -1 = 无界
    Py_ssize_t numfreeblocks;
    block *freeblocks[MAXFREEBLOCKS];
    PyObject *weakreflist;
};
```

关键设计点：

- **空 deque 的居中表示**：`leftblock == rightblock`、`leftindex = CENTER+1 = 32`、`rightindex = CENTER = 31`。这样空 deque 在左/右任一方向 append 都有空间，无需立即分配新块。
- **索引含两端**：`leftindex`/`rightindex` 都是**闭区间**（与 Python 切片半开区间不同），使左右操作对称。
- **`state` 字段**：每次索引移动就 +1，迭代器记住初始 state，若迭代中 deque 被改，`state` 变了就抛 `RuntimeError`——这是「迭代中检测修改」的底层机制。
- **块空闲链表**：`freeblock` 复用最多 16 个已释放块，减少 `malloc`/`free` 抖动（左右 append/pop 高频场景，块释放与分配速率接近，复用收益大）。
- **`@critical_section`**：源码里 `deque_pop`/`deque_popleft` 等标了 `@critical_section`——这是 PEP 703 自由线程构建（3.13+）下的每对象锁，保证无 GIL 时两端操作线程安全（官方文档也声明「thread-safe appends and pops」）。

### 复杂度（实测 + 文档）

| 操作 | 复杂度 | 说明 |
|---|---|---|
| `append` / `appendleft` / `pop` / `popleft` | O(1) | 两端 |
| `len` | O(1) | 存于 `Py_SIZE` |
| `d[0]` / `d[-1]` | O(1) | 两端索引 |
| `d[i]`（中间） | O(n) | 从近端走块链表，**没有 std::deque 的块算术 O(1)** |
| `insert` / `del d[i]` / `remove` | O(n) | 中间 |
| `rotate(n)` | O(k)，k=min(n, len) | 移动 n 个元素 |
| `count` / `index` / `in` | O(n) | 线性扫 |
| `extendleft` | O(m) 且**逆序** | `extendleft('abc')` → `['c','b','a']` |

**与 `std::deque` 的关键差异**：C++ `std::deque` 通过「块指针数组 + 块内偏移」的算术，做到 O(1) 随机访问；Python `deque` 没有这个块索引数组，`d[i]` 中间访问要从近端**逐个块走**，故 O(n)。这是 Python 的**刻意简化**——它只优化两端，把「要随机访问就用 list」这件事留给调用者。

### `maxlen`：定长缓冲

`maxlen` 非 None 时 deque 有界，满了之后从**相反端**丢弃元素——等价 Unix `tail`。经典用途：`deque(f, n)` 保留文件最后 n 行、`moving_average`（右 append 左 popleft）、`roundrobin`（迭代器轮转调度，靠 `rotate(-1)`）。

> 实测注意：`sys.getsizeof(deque)` 会**低报**——块是独立 malloc 的，`getsizeof` 只算 `dequeobject` 结构体本身（空 deque 760 字节），不遍历块链表。用 `getsizeof` 估算 deque 内存会严重失真。

## 四、解剖：dict 系（`__missing__` 之上的四个扩展）

内置 `dict` 自 3.7 起保证插入序（PEP 412 紧凑字典的副产品，3.6 是实现细节、3.7 成为语言保证）。`collections` 的四个 dict 扩展都建立在这个现代 dict 之上。

### defaultdict：`__missing__` 钩子的最小演示

```python
class defaultdict(dict):       # C 实现，语义等价
    def __missing__(self, key):      # 只在 d[key] 缺键时被调用
        if self.default_factory is None:
            raise KeyError(key)
        self[key] = self.default_factory()   # 工厂结果插入并返回
        return self[key]
```

- **`__missing__` 是 dict 的官方扩展点**：`dict.__getitem__` 在缺键时先找 `__missing__`，找到就调它，把返回值当查找结果。`defaultdict`、`Counter` 都靠它。
- **`default_factory` 是可变实例属性**，可在运行时改。
- **核心坑（实测验证）**：`d[k]` 触发工厂；`d.get(k)` 返回 `None` **不触发**工厂；`k in d` 不触发。所以 `defaultdict` 与 `get` 混用是隐患。

**选型：`defaultdict(list)` vs `dict.setdefault(k, [])`**——文档明示前者「simpler and faster」：`setdefault` 每次调用都要**先构造默认值**（哪怕键已存在），`defaultdict` 只在真正缺键时才调工厂。

### Counter：多重集（bag）

```python
class Counter(dict):
    def __missing__(self, key): return 0        # 缺键计数为 0
    def most_common(self, n=None):
        if n is None:
            return sorted(self.items(), key=itemgetter(1), reverse=True)  # O(n log n)
        return _nlargest(n, self.items(), key=itemgetter(1))              # heapq，O(n log k)
```

- **计数为任意整数（含 0/负数）**：`c['x'] = 0` 不删除条目（条目仍在，`del` 才删）；`c['missing']` 返回 0 而非 KeyError。
- **`most_common(n)` 用 `heapq.nlargest`**（源码 `from heapq import nlargest as _nlargest`），复杂度 O(n log k)；不传 n 时退化 `sorted` O(n log n)。
- **`elements()` 用 `itertools` 惰性展开**：`chain.from_iterable(starmap(repeat, items))`——每个元素按计数重复。
- **多重集运算**：`+`（和）、`-`（差，只留正）、`&`（min）、`|`（max）、`^`（对称差，3.15 新增）、以及 `==`/`<`/`<=`/`>`/`>=`（缺键当 0）。这是 Knuth TAOCP II §4.6.3 的多重集语义。
- **`fromkeys` 被显式禁用**（`raise NotImplementedError`）——语义有歧义（`Counter.fromkeys('aaabbc', v=2)` 到底算几次？）。
- **计数热路径 `_count_elements` 是 C 函数**：纯 Python 版 `mapping[elem] = mapping_get(elem, 0) + 1`，有 C 加速版时优先用。

**对照 C++**：`Counter` ≈ `std::multiset`，但 `std::multiset` 是平衡树（O(log n) 插入/查找），`Counter` 是哈希（O(1) 平均）+ 惰性计数，且 `most_common` 是 `std::multiset` 没有的「按频次 Top-K」（对应 `std::priority_queue` + 计数）。

### OrderedDict：被 dict 背刺后剩下的三件事

纯 Python 回退版（3.15 已 C 化，但语义/结构同源）用**循环双向链表**记顺序：

```python
class _Link:
    __slots__ = 'prev', 'next', 'key', '__weakref__'   # prev 是弱引用代理
# self.__map: dict 映射 key -> _Link
# 哨兵 __hardroot（硬引用）+ __root（弱引用代理），永不被删
```

- **`prev` 用 weakref proxy**——防止循环引用导致内存泄漏（链表 prev/next 若都强引用，会形成环）。
- `__setitem__`：新键 → 链表尾插 link；`__delitem__`：从 `__map` 取 link 摘除；`__iter__`：沿链表遍历（O(n)）。
- **`__eq__` 顺序敏感**（vs OrderedDict），**顺序不敏感**（vs 普通 Mapping）——这个不对称是刻意的，让 OrderedDict 能随处替代 dict。

三个 `dict` 没有的能力（这也是它活着的唯一理由）：

| 能力 | dict 能否等价 | 说明 |
|---|---|---|
| `move_to_end(k, last=True)` | `d[k] = d.pop(k)` 可等价 | 移到队尾 |
| `move_to_end(k, last=False)` | **无等价** | O(1) 移到队首，dict 做不到 |
| `popitem(last=False)` | `(k := next(iter(d)), d.pop(k))` | FIFO 弹出 |

**结论**：除非要「移到队首」或「FIFO 弹出」或「顺序敏感相等」，否则用 `dict`。典型留存场景是 LRU 缓存（`move_to_end` + `popitem(last=False)`，`functools.lru_cache` 的思路同源）。

### ChainMap：多映射的单一视图

```python
class ChainMap:
    def __getitem__(self, key):              # 查找：从前往后搜所有 maps
        for m in self.maps:
            if key in m: return m[key]
        raise KeyError(key)
    def __setitem__(self, key, value):       # 写：只写第一个 map
        self.maps[0][key] = value
```

- **查找搜全链，写/删只动第一个 map**——这是「模拟嵌套作用域」的精髓：`ChainMap(locals(), globals(), vars(builtins))`。
- **按引用持有**：底层映射变了，ChainMap 立即反映。
- `new_child()` / `parents` 对应 `nonlocal`/`super()` 的语义：压入/弹出作用域层。
- **`maps` 是公开可变列表**，`maps[0]` 是当前层、`maps[-1]` 是根层。
- 迭代顺序 = 从最后一个 map 往前扫（等价一串 `dict.update` 的结果顺序）。

**选型**：`ChainMap` 是「零拷贝的视图」（不合并、不复制）；若要一份真正的合并 dict，用 `dict |` 或 `{**a, **b}` 或 `a.update(b)`。PEP 584 的 `|`/`|=`（3.9）之后，ChainMap 的「合并」用例进一步被 `|` 挤压——ChainMap 留存的价值是**持续反映底层变化**和**分层写入隔离**，而不是一次性合并。

## 五、解剖：namedtuple 的 eval 生成

`namedtuple` 是个**工厂函数**，运行时用 `eval` 生成一个 tuple 子类：

```python
# 源码简化（collections/__init__.py）
code = f'lambda _cls, {arg_list}: _tuple_new(_cls, ({arg_list}))'   # arg_list = 'x, y, z'
__new__ = eval(code, namespace)
...
class_namespace = {
    '__slots__': (),                       # 关键：空 slots，实例无 __dict__
    '_fields': field_names,
    '_field_defaults': field_defaults,
    '__new__': __new__,
    '_make': _make, '_replace': _replace, '__replace__': _replace,
    '_asdict': _asdict, '__getnewargs__': __getnewargs__,
    '__match_args__': field_names,         # 结构化模式匹配
}
for index, name in enumerate(field_names):
    class_namespace[name] = _tuplegetter(index, doc)   # C 的 property(itemgetter(index))
result = type(typename, (tuple,), class_namespace)
```

设计要点：

- **`eval` 拼 `__new__`**：因为 `__new__` 要接收与字段数匹配的定位参数签名，静态代码写不出「N 个字段就 N 个参数」的签名，只能动态生成。`_tuple_new = tuple.__new__`，构造仍是 C 的 tuple 分配。
- **`__slots__ = ()`**：namedtuple 是 `tuple` 子类，`tuple` 实例本就无 `__dict__`（数据存于对象体内联），空 `__slots__` 只是**显式禁止**再长出实例字典——所以 **namedtuple 实例与普通 tuple 等大**（实测 3 字段都 72 字节），无每实例 dict 开销。
- **字段访问 = C 的 `_tuplegetter`**：每个字段名绑定一个 `property(operator.itemgetter(index))`，`p.x` 即 `p[index]`，O(1) 且无需查找实例 dict。
- **`__match_args__ = field_names`**：让 `match p: case Point(x, y):` 结构化匹配能按字段解构。
- **`_replace`（= `__replace__`）**：返回替换字段的新实例，被 `copy.replace(obj, **kwds)` 通用协议支持（3.13 起错误从 ValueError 改 TypeError）。
- **pickling**：`__getnewargs__` 返回 `tuple(self)`，并把 `__module__` 设到调用帧（`_getframemodulename`）保证反序列化能找到类。

**核心语义：不可变。** namedtuple 是 tuple 子类，字段不可改（`_replace` 是「返回新实例」不是「原地改」）。这是它和 `dataclass`（默认可变）最本质的差异。

**对照 C++**：namedtuple ≈ 不可变的 `struct`（字段名访问 + 位置索引 + 可解包 + 可哈希），但多了 `_asdict`/`_replace`/`_make` 和零额外内存。C++ 要同样的「轻量命名记录」通常用 `struct` 或 `std::tuple` + `std::get<N>`（后者可读性差）。

## 六、解剖：UserDict / UserList / UserString 与 abc

这三个是「组合优于继承」的具象：**包装内置类型，把真实数据放在 `.data` 属性里**，让你子类化时不用和内置类型的方法约定搏斗。

**为什么要它们？** 直接子类化 `dict` 有个陷阱：`dict` 的很多方法（如 `__init__`、`update`）在 C 层直接操作内部哈希表，**不走你覆盖的 `__setitem__`**——所以 `class MyDict(dict): def __setitem__...` 后，`MyDict({...})` 初始化可能绕过你的覆盖。`UserDict` 把所有操作都委托给 `self.data`（一个普通 dict），你覆盖 `__setitem__` 就真的处处生效。这是「封装一个成员对象」对「继承内置类型」的经典胜利。

- `UserDict.data`：真实 dict，可访问、可替换。
- `UserList.data`：真实 list；子类构造器须支持「无参或单序列参数」（因为返回新序列的操作会 `cls(data)` 重建实例）。
- `UserString.data`：真实 str。

**`collections.abc`** 提供的 ABC 是「鸭子类型的形式化」：`isinstance(x, Sequence)` 不要求继承 `Sequence`，只要求实现 `__len__` + `__getitem__`（`__subclasshook__` 判定）。deque 就是被 `MutableSequence.register(deque)` 显式登记的虚拟子类。对 C++ 工程师，这就是 Python 版的 `concept`/`requires`。

## 七、为什么这么设计（取舍）

| 取舍 | 换来的 | 牺牲的 | 反面案例 |
|---|---|---|---|
| deque 用「块状双向链表」而非数组 | 两端 O(1)、不搬元素、不 realloc、cache 友好 | 中间索引/插入 O(n)，无 O(1) 随机访问 | `std::deque`（块算术 O(1) 随机访问）更全但更复杂 |
| deque 用「块」而非「每元素一节点」 | 指针开销从 200% 摊薄、malloc 次数大降 | 实现复杂度上升（双索引 + 居中空表示） | 朴素双向链表（每元素 malloc）简单但慢 |
| defaultdict 用 `__missing__` | 缺键才调工厂，省掉 `setdefault` 的提前构造 | `get()`/`in` 不触发，行为不一致的坑 | 显式 `setdefault` 更直白但每次都构造默认值 |
| Counter 用 `__missing__` 返回 0 | `c[k] += 1` 无需先判存在 | 与 dict 的 KeyError 语义分裂（缺键不抛错） | 显式 `d[k] = d.get(k,0)+1` 更一致但啰嗦 |
| namedtuple 用 `eval` 生成 `__new__` | 任意字段数都有正确签名 | `eval` 让人不适、生成类无静态源码可查 | 手写类（`dataclass`）可读但非 tuple 兼容 |
| namedtuple 空 `__slots__` | 实例与 tuple 等大、无 dict | 不可变、不能加实例属性 | `dataclass` 可变但每实例挂 dict（除非 slots） |
| OrderedDict 用双向链表记序 | O(1) `move_to_end` 到两端 | 内存翻倍（dict + 链表）、3.7 后大半冗余 | 现代 `dict` 本身已记插入序 |
| ChainMap 用「视图」而非「合并」 | 零拷贝、持续反映底层、分层写隔离 | 查找 O(m)（m=映射数）、写只动首层 | `dict | dict` 合并是一次性快照 |

**贯穿的元设计**：collections 的每个类都是「把某类高频操作的成本结构改对」，而不是「加功能」。deque 改的是「两端操作成本」，defaultdict/Counter 改的是「缺键分支成本」，namedtuple 改的是「命名访问的内存成本」，OrderedDict 改的是「重排成本」。**选错容器 = 用错误的成本结构硬扛**，这在 Python 里尤其致命（常数因子差可达数量级）。

## 八、横向对比（选型边界）

### namedtuple vs dataclass vs dict（实测）

| 维度 | `namedtuple` | `dataclass`（无 slots） | `dataclass(slots=True)` | 普通 `dict` |
|---|---|---|---|---|
| 可变性 | 不可变 | 可变 | 可变 | 可变 |
| 每实例 dict | 无（`__slots__=()`） | **有**（`__dict__`） | 无（slots） | 无 |
| 实测 3 字段实例 sizeof | 72（==tuple） | 48 + 隐藏 `__dict__` | 56 | 184 |
| tuple 兼容（解包/索引） | 是 | 否 | 否 | 否 |
| 可哈希 | 是 | 否（默认） | 否（默认） | 否 |
| 类型注解 | 需 `typing.NamedTuple` | 原生 | 原生 | 否 |
| 字段默认值 | `defaults=`（右对齐） | 原生 | 原生 | 否 |
| 方法/继承 | 可子类化加 property | 原生 | 原生 | 否 |

一句话：**不可变 + 要 tuple 兼容 + 可哈希（作 dict 键）→ `namedtuple`；可变 + 要类型注解 + 要方法 → `dataclass`（3.10+ 记得加 `slots=True` 省内存）；临时键值 → `dict`。** `typing.NamedTuple` 用 `class` 语法写 namedtuple 并带类型注解，是「要类型提示的 namedtuple」的折中。

### deque vs list

| 操作 | `list` | `deque` |
|---|---|---|
| `append`/`pop`（右端） | O(1) 摊还 | O(1) |
| `pop(0)`/`insert(0,v)` | **O(n)**（搬移整个数组） | O(1) |
| 中间 `d[i]` 随机访问 | O(1) | **O(n)** |
| 中间插入/删除 | O(n) | O(n) |
| 定长缓冲（maxlen） | 无 | 有 |

一句话：**「两端都要快」→ deque；「要随机访问 + 右端追加」→ list。** 这是 Python 里最典型的「看起来都能用、选错慢一个数量级」的分叉。

### Counter vs defaultdict(int) vs 手写

- `Counter`：要 `most_common`、多重集运算、`elements()` 时用；缺键返回 0 的语义内置。
- `defaultdict(int)`：只要「计数累加」、不需要 Top-K/多重集运算时更轻（但它没有 `most_common`）。
- 手写 `d[k] = d.get(k, 0) + 1`：最直白但每次都要写 get 分支，且无 `most_common`。

### ChainMap vs dict 合并（PEP 584）

- `ChainMap(a, b, c)`：零拷贝视图，底层变化即时反映，写只动首层。
- `a | b | c` 或 `{**a, **b, **c}`：一次性快照，后层覆盖前层，与底层脱钩。

### OrderedDict vs dict vs functools.lru_cache

- `dict`：3.7 起已记插入序，绝大多数场景够了。
- `OrderedDict`：只要「移到队首」/「FIFO 弹出」/「顺序敏感相等」。
- `functools.lru_cache`：直接用它，别手写 LRU；OrderedDict 的 LRU 是「自己实现变体」时的底座。

## 九、实践与红线（反向结论）

**何时用 collections：**

- 队列/栈/滑动窗口/定长 tail → `deque`。
- 频次统计、Top-K、词频 → `Counter`。
- 分组聚合（`defaultdict(list/set)`）、邻接表建图 → `defaultdict`。
- LRU / 需要重排 / FIFO 弹出 → `OrderedDict`。
- 配置分层覆盖（命令行 > 环境变量 > 默认）→ `ChainMap`。
- 只读命名记录、要作 dict 键、要 tuple 兼容 → `namedtuple`。
- 要子类化 dict/list/str 且覆盖方法要处处生效 → `User*`。

**何时别用（反向结论）：**

1. **要中间随机访问 → 别用 deque，用 list。** deque 中间 O(n)，list O(1)。「两端都快」是 deque 的全部价值。
2. **要可变命名记录 → 别用 namedtuple，用 dataclass。** namedtuple 不可变，`_replace` 是新实例；频繁改字段用 namedtuple 是自虐。
3. **只需记插入序 → 别用 OrderedDict，用 dict。** 3.7 后 dict 已记插入序，OrderedDict 内存翻倍却只多三个重排能力。
4. **要一次性合并字典 → 别用 ChainMap，用 `|`。** ChainMap 的「视图」在不需要持续反映底层时是隐性成本（查找 O(m)、写只动首层的语义易踩）。
5. **只要简单计数累加、不要 Top-K → 别用 Counter，用 defaultdict(int)。** Counter 的多重集运算和 most_common 是它的价值，纯累加用不上。
6. **要覆盖 `__setitem__` 且期望处处生效 → 别直接子类化 dict，用 UserDict。** C 层的 dict 方法会绕过 Python 覆盖。

**常见坑：**

1. **`defaultdict` 的 `get()` 不触发工厂**（实测 `d.get('x')` 返回 None，`d['x']` 才建值）。混用 `get` 和下标访问是经典 bug 源。
2. **`Counter` 设 0 不删条目**：`c['x'] = 0` 后 `'x' in c` 仍为 True；要删用 `del c['x']`。`elements()` 会忽略 count ≤ 0 的元素。
3. **`sys.getsizeof(deque)` 低报**：块是独立 malloc，`getsizeof` 不遍历块链表。
4. **`extendleft` 逆序**：`d.extendleft('abc')` 得到 `['c','b','a']`，容易搞反。
5. **`namedtuple` 字段名不能以 `_` 开头、不能是关键字、不能重复**（`rename=True` 会自动改名 `_0`/`_1`）；字段名用 `str.isidentifier()` 校验。
6. **`OrderedDict` 的 `==` 顺序敏感只对 OrderedDict**：与普通 dict 比较又是顺序不敏感的，不对称易误判。
7. **`ChainMap` 写/删只动 `maps[0]`**：以为「覆盖了深层键」实际是往首层塞了新键。

## 十、前瞻与版本沿革（3.15 视角）

**演进轨迹**（源码 + 文档沿革核验）：

- **dict 已记插入序**（3.7 保证）→ OrderedDict 收窄为「重排专用」。
- **PEP 584（3.9）** `|`/`|=` → 挤压 ChainMap 的合并用例。
- **dataclasses（3.7）/ `slots=True`（3.10）** → 挤压 namedtuple 的可变记录用例。
- **3.15 的变化**（本文一手核验）：`Counter` 新增对称差 `^`；`OrderedDict` 已 C 化（`_collections.OrderedDict`）；源码里 `lazy from ... import` 的惰性导入、`@critical_section` 的自由线程支持（PEP 703）都已就位。

**趋势判断**：collections 的「专用容器」正在被**两个方向的更优解挤压**——向上被「内置类型变强」（dict 记序、dict 合并）挤压，向下被「专用模块」（dataclasses 之于 namedtuple、lru_cache 之于 OrderedDict）挤压。留存下来的都是「成本结构不可替代」的硬核：deque 的两端 O(1)、Counter 的 Top-K、defaultdict 的缺键工厂、ChainMap 的零拷贝分层视图。**这套模块不是「旧代码」，而是「把高频成本结构改对」的最小工具集**，值得作为 C++ 工程师理解 Python 性能模型的切入点。

## 十一、附录

### 复杂度速查

| 类 | 关键操作 | 复杂度 |
|---|---|---|
| deque | append/pop 两端 | O(1) |
| deque | 中间索引/插入/删除 | O(n) |
| defaultdict | 查找/插入 | O(1) 平均（同 dict） |
| Counter | 构造（从可迭代） | O(n) |
| Counter | `most_common(n)` | O(n log k)（nlargest）|
| Counter | `most_common()` | O(n log n)（sorted）|
| OrderedDict | 查找/插入 | O(1) 平均 |
| OrderedDict | `move_to_end` | O(1) |
| ChainMap | 查找 | O(m)，m=映射数 |
| namedtuple | 字段访问 | O(1) |

### 术语

- **`__missing__(key)`**：dict 子类的缺键钩子，仅被 `__getitem__` 触发。
- **`__slots__`**：类属性，声明实例的固定属性槽，禁用实例 `__dict__`。
- **虚拟子类（virtual subclass）**：经 `ABC.register` 或 `__subclasshook__` 判定的结构化类型关系。
- **多重集（multiset / bag）**：元素可重复、带计数的集合。
- **紧凑字典（compact dict）**：PEP 412，dict 的紧凑存储，副产品是插入序保留。

### C/Python 分工速查（3.15，实测）

- **C（`_collections`）**：`deque`、`defaultdict`、`OrderedDict`、`_count_elements`、`_tuplegetter`、`_deque_iterator`、`_deque_reverse_iterator`。
- **纯 Python（`collections/__init__.py`）**：`Counter`、`ChainMap`、`namedtuple`、`UserDict`、`UserList`、`UserString`。

## 参考来源

- 官方文档：https://docs.python.org/3/library/collections.html（3.15，2026-11-01 更新）
- CPython 源码：`Modules/_collectionsmodule.c`（deque 块状链表、BLOCKLEN/MAXFREEBLOCKS、`@critical_section`）
- CPython 源码：`Lib/collections/__init__.py`（namedtuple/Counter/ChainMap/OrderedDict/User* 纯 Python 实现）
- CPython 源码：`Lib/_collections_abc.py`（ABC 与 `__subclasshook__`）
- 本地 Python 3.15.0 实测：namedtuple/dataclass/dict 内存、defaultdict `get` 行为、OrderedDict 重排、Counter `most_common`/`total`、C 化判定（`_collections` 导出清单）
- PEP 412（紧凑字典）、PEP 584（dict 合并）、PEP 703（自由线程）
