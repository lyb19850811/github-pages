---
report: 71
title: Python dict 与 set 深度研究：紧凑哈希表的底层原理、设计目标与工程取舍
date: 2026-11-07
tags: [python, cpython, dict, set, frozenset, frozendict, hashtable]
summary: 从 CPython 3.15 源码（Objects/dictobject.c、setobject.c、Include/internal/pycore_dict.h、Include/cpython/setobject.h）与 PEP 814 一手核验 dict 与 set 的底层实现：紧凑字典的 dk_indices+dk_entries 双数组布局、perturb 开放寻址探测、2/3 负载因子与 used×3 扩容、set 的 0.6 负载因子与 LINEAR_PROBES 混合探测、frozenset/frozendict 的序无关哈希，以及两者的设计目标、使用场景与工程缺点。
math: false
---

`dict` 和 `set` 是同一套「开放寻址哈希表」工程在两个语义维度上的投影——dict 回答「键对应什么值」，set 只回答「在不在」。本文基于 CPython 3.15 源码（`Objects/dictobject.c` 8578 行、`Objects/setobject.c` 3218 行、`Include/internal/pycore_dict.h`、`Include/cpython/setobject.h`）与 PEP 814，逐一手核验，直接回答五个问题：**设计目标 → 特点 → 使用场景 → 底层原理 → 缺点**。读者定位：C++ 后端工程师，每节配 `std::` 对照。本文是 **70 号报告**（五大内置结构总览）里 dict/set 两节的纵深展开，不重复其 list/tuple/str 内容。

## 一、结论先行

- **dict 和 set 是同一套开放寻址哈希表的两副面孔。** dict 存 `(key, hash, value)` 三字段条目，set 存 `(key, hash)` 两字段条目——set 就是「值即键」的 dict，`setentry` 比 `PyDictKeyEntry` 省掉一个 `me_value` 指针（8 字节/槽）。
- **dict 是「紧凑字典」（compact dict，3.6 起）**：哈希表拆成 `dk_indices`（稀疏索引数组，真哈希表，槽宽随表大小自适应 int8/int16/int32/int64）+ `dk_entries`（密集条目数组，顺序 append）。**插入序不是额外维护，而是「顺序迭代 dk_entries」的免费副产品**（源码注释明示）。
- **探测用 perturb 开放寻址**：`i = mask & (i*5 + perturb + 1)`，`perturb >>= 5`。`5*j+1` 递推在 2^i 步内恰好遍历每个下标一次；配合 Python int 哈希「恒等」（`hash(i)==i`），连续整数键零冲突、低 i 位直接当槽位。
- **负载因子 dict 2/3、set 0.6**：`USABLE_FRACTION(n)=(n<<1)/3`（dict）；set 是 `fill*5 >= mask*3` 触发 resize。扩容 dict 用 `GROWTH_RATE = used*3`（无删除时即翻倍），set 是 `used>50000 ? used*2 : used*4`。
- **3.15 新增 `frozendict`（PEP 814）**：不可变、可哈希的 dict，哈希序无关（`hash(frozenset(items()))` 语义），继承 `object` 而非 `dict`。`set` 早有 `frozenset` 对应物，二者构成「可变 ↔ 不可变可哈希」的对称镜像。
- **dict 永不缩容**：删空 10 万元素后 `sys.getsizeof` 仍是 5242960 字节（本地实测）；字符串键 dict 比 int 键 dict 每条目省 8 字节（hash 缓存在 str 对象里，无需 `me_hash` 字段）。

## 二、设计目标

### 2.1 dict：O(1) 平均按键访问 + 语言基石

**第一目标**：对「任意可哈希键」做平均 O(1) 的增删查改。这是它与 list 的本质分工——list 按**整数下标** O(1) 访问，dict 按**任意可哈希键** O(1) 访问。

**第二目标（常被忽视，却是 dict 在 Python 里无可替代的根源）**：dict 是整个语言的**运行时基质**。名字空间（`globals()`/`locals()`）、对象属性（`obj.__dict__`）、关键字参数（`**kwargs`）、模块导入缓存（`sys.modules`）——全都是 dict。这也是为什么 CPython 愿意在 dict 上投入这么多工程（紧凑化、split table、字符串键快路径、watcher 机制）：**dict 每快 1%，解释器整体就快一个可感知的比例**。

### 2.2 set：O(1) 成员测试 + 数学集合语义

set 的直接目标是**集合论**：去重、成员测试、交/并/差/对称差。它与 dict 的目标差异决定了实现差异——set 的 `setobject.c` 顶部注释明示：

> Use cases for sets differ considerably from dictionaries where looked-up keys are more likely to be present. In contrast, sets are primarily about membership testing where the presence of an element is not known in advance. Accordingly, the set implementation needs to optimize for both the found and not-found case.

即：dict 查的大多是**存在的键**（命中为主），set 查的大多是**未知存在性**（未命中同样常见）。这个差异直接落在 `LINEAR_PROBES` 混合探测的取舍上（见 §6.7）。

### 2.3 紧凑字典的重设计动机：内存

3.6 前 dict 是**稀疏表**：每个槽都固定存 `(hash, key, value)` 三字段，即使槽为空也占满 24 字节，空 dict 也要一次性分配一堆空槽。3.6 的紧凑化把「稀疏索引」（小、窄）与「密集条目」（只有实际用到的才存在）拆开，**内存省了一大半，还顺带白送了插入序**。这个动机贯穿 dict 全部结构设计。

## 三、特点

### 3.1 dict

| 维度 | 值 |
|---|---|
| 可变性 | 可变（不可哈希，不能作 key/set 元素） |
| 顺序 | **插入序**（3.7 起语言保证，3.6 是 CPython 实现细节） |
| 键约束 | 必须可哈希；值任意对象 |
| 复杂度 | 增删查改均摊 O(1) |
| 相等性 | **序无关**：`{'a':1,'b':2} == {'b':2,'a':1}` |
| 视图 | `keys()/values()/items()` 是**动态视图**，随 dict 变化 |
| 内存 | 高（稀疏索引 + 密集条目 + 8 字节指针 + 键值对象本身） |

### 3.2 set / frozenset

| 维度 | set | frozenset |
|---|---|---|
| 可变性 | 可变 | 不可变 |
| 可哈希 | 否（不能嵌套、不能作 key） | **是**（可作 key/set 元素） |
| 顺序 | **无序**（迭代序是哈希槽序，非插入序） | 无序 |
| 元素约束 | 必须可哈希、唯一 | 必须可哈希、唯一 |
| 复杂度 | 成员测试/增删均摊 O(1) | 同左 |
| 特有 | 集合代数 `\| & - ^` | 集合代数（返回 frozenset/set） |

### 3.3 frozendict（3.15 新增，PEP 814）

`dict` 的不可变镜像，填补了「set 有 frozenset、list 有 tuple，但 dict 一直缺不可变版本」的长期空白（PEP 416/603 曾两度提议未果）。关键语义：

- 继承 `object` 而非 `dict`（**拒绝理由**：若继承 dict，`dict.__setitem__(frozendict, k, v)` 仍能绕过不可变性改它；且为防此需在 dict 每个方法里排除 frozendict，拖慢 dict 热路径）。
- **可哈希当且仅当所有值也可哈希**；哈希与顺序无关（`hash(frozenset(items()))` 语义）；`ma_hash` 缓存。
- 支持 `|`/`|=`（`|=` 返回新对象不改原对象）、`.copy()`（CPython 直接返回自身引用）、`Mapping` 协议。
- 与 `dict` 可互比相等：`frozendict(x=1,y=2) == dict(x=1,y=2)`。

## 四、使用场景

### 4.1 dict 该用 / 不该用

| 该用 | 不该用 |
|---|---|
| 缓存 / memoization（含 `functools.lru_cache`） | 只需「是否存在」时（用 set，省一半内存） |
| 计数（`Counter`，见 68 号报告） | 需要紧凑同型值数组时（用 `array`/numpy） |
| 图邻接表、JSON/配置对象、符号表 | 需要按键有序遍历时（用 `sorted()` 或有序结构） |
| 关键字参数、命名空间、对象属性（语言自动用） | 键不可哈希时（如要按 `list` 键查，只能换编码） |
| 分组聚合（`defaultdict`，见 68 号报告） | 少量固定键的简单记录（dataclass/命名元组更省） |

### 4.2 set / frozenset 该用 / 不该用

| 该用 | 不该用 |
|---|---|
| 去重 | 需要保留顺序 + 去重（用 `dict.fromkeys(seq)` 保序去重，或有序集合） |
| O(1) 成员测试（白名单/黑名单/已访问集合） | 需要按值顺序遍历（set 无序） |
| 集合交并差（共同好友、差集） | 需要重复元素（multiset 用 `Counter`） |
| 图遍历的 `visited` 集合 | 需要下标访问（用 list） |

**frozenset / frozendict 场景**：作为 dict 的 key / set 的元素（如缓存「参数集合 → 结果」）；函数默认参数（`def f(conf=frozendict(a=1))` 避开可变默认值坑）；跨线程共享的只读常量表。

### 4.3 关键选型对照（C++ 视角）

| Python | C++ | 差异本质 |
|---|---|---|
| dict | `std::unordered_map` | dict 开放寻址（扁平、缓存友好），unordered_map 链地址（桶+链表） |
| — | `std::map` | RB 树，有序但 O(log n)；dict 无序但 O(1) |
| set | `std::unordered_set` | 同 dict/unordered_map 的开放寻址 vs 链地址差异 |
| frozenset | `const std::unordered_set` | C++ 靠 `const` 表达只读，Python 靠类型（frozenset 还额外**可哈希**） |

## 五、哈希表原理图解（看不懂原理就看这里）

这一节用**表大小 8 的最小例子**，把「哈希表到底怎么工作」从头讲清楚。表大小 8 是 CPython 新建 dict 的初始值（`PyDict_MINSIZE = 8`），所以 mask = 7。下面三张图配着读。

### 5.1 哈希值是怎么算的

`hash(key)` 只是给 key 打一个「几乎唯一」的整数标签，真正决定放哪个槽的是 `hash & mask`（取哈希的低 `log2(表大小)` 位）。表大小 8 时就是取低 3 位（`& 7`）：

![哈希值如何落到槽位]({{ '/assets/images/dict-hash-computation.svg' | relative_url }})

不同 key 类型的哈希算法不同：

| key 类型 | hash() 怎么算 | 例子（本次进程实测） |
|---|---|---|
| int | **恒等**：hash(n) == n；唯一例外 hash(-1) == -2（-1 是「哈希失败」错误哨兵） | hash(8) = 8 |
| str / bytes | SipHash-1-3，**每进程随机种子**（防碰撞攻击），同一字符串每次启动哈希都不同 | hash('python') = 4586472508326149777 |
| tuple | 递归混入各元素哈希的 xxHash 变体 | hash((8,'a')) = 2446371590048142261 |

> **关键：哈希冲突是常态，不是 bug。** 两个不同 key 算到同一个槽（上图中 key=8 和 key=0 都落到槽 0）时，靠「探测」找下一个空槽（见 §5.3 的增、§6.3 的公式）。

### 5.2 结构长什么样：两个数组

dict 不是「槽里直接塞 key/value」的一张表，而是**两个数组**：稀疏的 `dk_indices`（真哈希表，决定「放哪个槽」）+ 密集的 `dk_entries`（实际存 key/value，按插入顺序 append）。下图是插入 `0→'A'`、`8→'B'`、`1→'C'` 之后的状态：

![dict 双数组结构]({{ '/assets/images/dict-structure.svg' | relative_url }})

注意三件事：

1. **槽位由哈希决定，与插入序无关**：key 8 的哈希是 8，却因冲突被放到槽 1；key 1 的哈希是 1，却被挤到槽 6。
2. **插入序由 dk_entries 的 append 顺序决定**：entries 是 0、8、1，这就是 `list(d.keys())` 的顺序。
3. **槽里存的是「下标」不是数据**：槽 0 存「→0」意思是「去 entry 0 找」。数据本体都在 dk_entries。

### 5.3 增删改查四步：每次操作哈希表怎么变

![增删改查四步]({{ '/assets/images/dict-crud.svg' | relative_url }})

四步的共性：**「查」是一切的基础**——改、增、删都要先按「查」的探测路径定位到槽。

- **查（lookup）**：算 `hash & mask` 得初始槽 → 逐槽「先比 hash、再比 key」→ 命中返回；遇到 EMPTY 返回「不存在」。
- **改（update）**：先查到 entry，**就地改 value**，`dk_indices` 一个字节都不动（结构零变化）。
- **增（insert）**：探测到空槽，把「entry 下标」写进那个槽，再往 `dk_entries` 末尾追加新条目（插入序因此保住）。
- **删（delete）**：命中后把槽标成 **DUMMY（墓碑）** 而不是 EMPTY——因为其他 key 可能正是「探测时跳过这个槽」才落到后面的（见上图 ④ 下方说明，这是哈希表删除最重要的坑）。

---

## 六、底层实现原理（源码级）

### 6.1 共同基石：开放寻址 vs 链地址

C++ 的 `std::unordered_map` 用**链地址法**（separate chaining：每个桶挂一条链表/节点链）。CPython 的 dict/set 用**开放寻址**（open addressing：冲突了就按探测序列找下一个空槽，全部数据平铺在连续内存里）。

开放寻址的优势（CPython 的选择理由）：

- **缓存友好**：一次查找走的是连续内存上的探测序列，比追指针链表的 cache miss 少。
- **省内存**：无链表节点指针开销；Python 对象已是堆上指针，再加节点指针更亏。
- **无二次分配**：不需要为每个桶分配节点链表。

代价是**负载因子必须严格 < 1**（否则探测可能找不到空槽、死循环），且删除要留「墓碑」（dummy），不能直接清空——否则探测序列会被打断。

### 6.2 dict：紧凑字典的双数组布局

`Include/internal/pycore_dict.h` 的 `_dictkeysobject` 结构（即 `PyDictKeysObject`）：

```
+---------------------+
| dk_refcnt           |
| dk_log2_size        |   ← 表大小（2 的幂）的对数
| dk_log2_index_bytes |   ← dk_indices 每槽字节数的对数
| dk_kind             |   ← GENERAL / UNICODE / SPLIT
| dk_version          |
| dk_usable           |   ← dk_entries 可用槽数
| dk_nentries         |   ← dk_entries 已用条目数
+---------------------+
| dk_indices[]        |   ← 稀疏索引数组（真哈希表）
+---------------------+
| dk_entries[]        |   ← 密集条目数组（顺序存储）
+---------------------+
```

- **`dk_indices` 是真正的哈希表**：长度 `dk_size`（2 的幂），每槽存「entry 下标」或哨兵 `DKIX_EMPTY(-1)` / `DKIX_DUMMY(-2)`。槽宽随表大小自适应：int8（≤128 槽）/ int16 / int32 / int64，由 `dk_log2_index_bytes` 记录——小表省内存，大表够用。
- **`dk_entries` 是密集数组**：长度 `USABLE_FRACTION(dk_size)`，元素为两种：

```c
typedef struct {
    Py_hash_t me_hash;   /* 缓存的键哈希 */
    PyObject *me_key;
    PyObject *me_value;  /* 仅 combined 表有意义 */
} PyDictKeyEntry;                        // 通用键：24 字节

typedef struct {
    PyObject *me_key;    /* 键必须是 str，哈希已缓存在 str 对象里 */
    PyObject *me_value;
} PyDictUnicodeEntry;                     // 字符串键：16 字节，省掉 me_hash
```

**字符串键省 8 字节/条目的原因**：str 的哈希缓存在对象自身（PEP 393 对象头里），dict 无需再存一份 `me_hash`。本地实测：1000 个字符串键 dict = 26032 字节，1000 个 int 键 dict = 36952 字节，差 10920 = 1365 槽 × 8 字节（精确吻合）。

- **三种 kind**：`DICT_KEYS_GENERAL`（任意键，走 `PyDictKeyEntry` + 通用 `lookdict`）、`DICT_KEYS_UNICODE`（全字符串键，走 `PyDictUnicodeEntry` + `unicode_eq` 快路径）、`DICT_KEYS_SPLIT`（共享键，用于对象属性）。

- **combined vs split 表**（`dictobject.c` 顶部注释）：
  - **combined 表**：`ma_values == NULL`，值存在 `dk_entries[i].me_value` 里，`dk_refcnt == 1`。普通 dict 都是这种。
  - **split 表**：`ma_values != NULL`，键表被**多个同类实例共享**（`dk_refcnt >= 1`），值存在各自独立的 `ma_values` 数组里，只允许字符串键。这正是 **PEP 412「key-sharing dictionary」**——一个类的所有实例共享同一份属性名键表，每个实例只存自己的值数组，大幅降低实例内存。

### 6.3 探测序列：perturb 算法

`dictobject.c` 的 `do_lookup` 核心循环（含手动循环展开）：

```c
size_t perturb = hash;
size_t i = (size_t)hash & mask;   /* 初始槽 = 哈希低 log2(size) 位 */
for (;;) {
    ix = dictkeys_get_index(dk, i);
    if (ix >= 0) { /* 命中或继续比较 */ }
    else if (ix == DKIX_EMPTY) return DKIX_EMPTY;
    perturb >>= PERTURB_SHIFT;              /* 5 */
    i = mask & (i*5 + perturb + 1);
}
```

三个关键设计（源码注释详述）：

1. **初始下标直接取哈希低 i 位**：`i = hash & mask`。因为 Python int 的哈希就是它自己（`hash(i)==i`），连续整数键映射到连续槽位、**零冲突**。源码注释明言「这不是巧合，是刻意的优化」——牺牲了「坏哈希」场景，换取「常见场景」的极致速度。

2. **`5*j+1` 递推**：`j = (5*j+1) mod 2^i` 在 2^i 步内**恰好遍历每个下标一次**（数论性质，任何随机数生成教材有证明）。它比线性探测 `j+=1` 强在：若键在槽 5 冲突，下一个看的是槽 2 而非 6，不会跟「连续键连续到达」的常见模式互相踩。

3. **perturb 混入高位**：初始 `perturb = hash`，每步 `perturb >>= 5` 再 `j = (5*j)+1+perturb`。这让探测序列**最终依赖哈希的每一位**，放大初始下标没用到的高位差异。`PERTURB_SHIFT = 5` 是 Tim Peters 实测权衡的产物（4 和 6 也没差多少）。经典病理案例：`[i << 16 for i in range(20000)]` 这类键的低 15 位全 0、全映射到同一槽，全靠 perturb 把高位搅进来打破长冲突链。

> 安全注：Python 的 str/bytes 哈希用 SipHash 且**每进程随机种子**（3.3 起，`PYTHONHASHSEED` 控制），正是为了防「哈希碰撞 DoS」——攻击者构造大量同哈希键把 dict 退化成 O(n)。int 哈希恒等不随机，但 int 无法构造这种攻击（无法碰撞出远超 int 值域的键集）。这段是 [INFERENCE]，依据 CPython 长期沿革，非本次源码行级核验。

### 6.4 负载因子与扩容

- **负载因子 2/3**：`#define USABLE_FRACTION(n) (((n) << 1)/3)`。源码注释：1/2 到 2/3 区间实践最优——太密则冲突多、太疏则浪费内存和 cache line。
- **最小表 8**：`PyDict_MINSIZE = 8`，能装 `USABLE_FRACTION(8) = 5` 个条目（源码注释：这已覆盖大多数「传 kwargs 的小 dict」）。
- **扩容**：`GROWTH_RATE = used*3`，再取 ≥ 它的最小 2 的幂。`used*3` 而非 `used*2` 的用意（源码注释引 bpo-17563/33205）：**无删除时**约等于翻倍，但**删除多时**留更多余量。
- **删空也不缩容**：本地实测，10 万条目 dict 全删后 `getsizeof` 仍 5242960 字节。dict 只有「长」没有「缩」——高频增删的长期 dict 会一直占着峰值内存。

### 6.5 插入序：免费副产品

`dictobject.c` 注释明示：combined 表里 `dk_entries` 基本是只增的，**顺序迭代 dk_entries 就是插入序**。唯一例外是 `.popitem()`（移除最后一条，decrement `dk_nentries` 达均摊 O(1)，但 `dk_indices` 里留 DKIX_DUMMY，故 `dk_usable` 不能加回）。

版本边界：3.6 紧凑字典**顺带**保持了插入序（实现细节），3.7 才写入语言规范。**写库代码依赖 dict 顺序，需 3.7+**。split 表（对象属性）的插入序用位向量额外维护，与 combined 不同。

### 6.6 键哈希的三条事实

1. **int 哈希恒等**：`hash(1)=1`、`hash(2)=2`……唯一例外 `hash(-1)=-2`（`-1` 是 CPython 保留的「哈希计算失败」错误哨兵，见 `PyObject_Hash` 约定）。所以 `hash(-1)==hash(-2)==-2`。
2. **str 哈希缓存**：SipHash 算出后存进 str 对象，dict 字符串键条目因此能省 `me_hash` 字段（§6.2）。
3. **可变对象不可哈希**：list/set/dict 的 `__hash__` 是 `None`（数据模型规定「可变 → 不可哈希」），故不能作键；tuple/frozenset/frozendict 在其元素都可哈希时可哈希，并可缓存哈希值（`ob_hash`/`ma_hash` 字段）。

### 6.7 set：只存键的哈希表 + 混合探测

`Include/cpython/setobject.h` 的 `PySetObject`：

```c
typedef struct {
    PyObject *key;
    Py_hash_t hash;      /* 缓存的键哈希 */
} setentry;              // 16 字节，比 PyDictKeyEntry 省 me_value

typedef struct {
    PyObject_HEAD
    Py_ssize_t fill;     /* active + dummy 槽数 */
    Py_ssize_t used;     /* active 槽数 */
    Py_ssize_t mask;     /* 表大小 - 1（2 的幂） */
    setentry *table;
    Py_hash_t hash;      /* 仅 frozenset 用 */
    Py_ssize_t finger;   /* pop() 的搜索指针 */
    setentry smalltable[PySet_MINSIZE];  /* 8 个内联槽 */
    PyObject *weakreflist;
} PySetObject;
```

与 dict 的四点关键差异：

1. **`setentry` 无 value**：set 是「值即键」的哈希表，每条目省 8 字节。
2. **小集合内联 `smalltable[8]`**：≤ 阈值时不 malloc，直接内联在对象里——这是空 set 占 216 字节（vs 空 dict 64 字节）的原因：8 个 `setentry` × 16 字节 = 128 字节内联槽。
3. **负载因子 0.6**（比 dict 的 2/3 保守）：`set_add_entry_takeref` 里 `if ((size_t)so->fill*5 < mask*3) return 0;` 即 `fill*5 >= mask*3` 才 resize（0.6）。因为 set 无 value 分摊开销，且未命中场景多，宜更稀疏。实测 set 大小序列 216（≤4 元素）→ 728（5–18）→ 2264（19+），精确吻合 0.6 负载因子。
4. **混合探测 `LINEAR_PROBES = 9`**：`setobject.c` 注释说明，为改善 cache locality，每个探测点先**连续线性探测 9 个相邻槽**（`entry++`，连续内存访问便宜），再落入 `i = (i*5+1+perturb) & mask` 的随机化探测（打破长冲突链）。这是 set 独有的「线性 + 随机」混合，dict 不这么做（dict 命中率高、冲突链短）。

**扩容**：`used > 50000 ? used*2 : used*4`（5 万元素以下四倍增长、以上两倍），比 dict 更激进，用空间换「大集合构建期更少 rehash」。

**frozenset 的序无关哈希**（`setobject.c` `frozenset_hash_impl`）：

```c
_shuffle_bits(h) = ((h ^ 89869747UL) ^ (h << 16)) * 3644798167UL;
for (entry = table; entry <= &table[mask]; entry++)
    hash ^= _shuffle_bits(entry->hash);
```

对所有槽哈希做 `_shuffle_bits` 后 **XOR**——XOR 交换律保证**哈希与元素顺序无关**，这正是「集合相等 = 元素相同、与顺序无关」对哈希一致性的要求。末尾再混入元素个数、做位分散、`-1` 映射到 `590923713UL` 避开错误哨兵。

### 6.8 frozendict（3.15）：不可变 dict 的实现

`dictobject.c` 里 `frozendict` 与 dict **共享绝大部分代码**，`PyFrozenDictObject` 继承 `PyDictObject` 只多加一个 `ma_hash` 字段：

```c
typedef struct {
    PyDictObject ob_base;
    Py_hash_t ma_hash;   /* 缓存，-1 表示未计算 */
} PyFrozenDictObject;
```

- **哈希序无关**：`frozendict_hash` 遍历条目，对每个 `(key, value)` 算 `frozendict_pair_hash`（复用 `tuple_hash` 的 xxHash 变体，即 `hash((k,v))`），再 `hash ^= _shuffle_bits(pair_hash)`。XOR 交换律 → 与顺序无关，等价 `hash(frozenset(items()))`（PEP 814 明示）。
- **递归防护**：值本身是 frozendict 时哈希会递归回 `frozendict_hash`，源码用 `_Py_EnterRecursiveCall` 防深嵌套 frozendict 撑爆 C 栈。
- **不可变靠「不继承 dict」**：继承 `object`，所有可变方法（`__setitem__`/`clear`/`pop`/`update` 等）根本不存在，从类型层面杜绝了 `dict.__setitem__` 绕过。
- **浅不可变**：值对象仍可变（`frozendict(mutable=[])` 的 list 还能改），PEP 814 明示「shallow immutability」——这正是 `.copy()` 直接返回自身引用仍安全的前提。

## 七、缺点

### 7.1 dict 的缺点

1. **内存高**：稀疏索引 + 密集条目 + 8 字节指针 + 键值对象本身，比紧凑数组（`array`/numpy）大一个数量级。且**删空不缩容**，高频增删的长期 dict 会钉在峰值内存。
2. **键必须可哈希**：list/set/dict 不能作键；想按「可变组合」查找需手动编码成 tuple/frozenset。
3. **自身不可哈希、不可共享**：dict 不能作 dict 的 key / set 元素（这也是 3.15 才补 frozendict 的痛点）；作为函数默认参数是经典坑（可变默认值被复用）。补救是 `frozendict` 或 `types.MappingProxyType`。
4. **迭代中改大小抛 RuntimeError**：`dictionary changed size during iteration`——动态视图 + 开放寻址使「边遍历边改」无安全语义，只能快照 `list(d)` 再改。
5. **顺序语义的历史包袱**：3.6/3.7 边界导致旧代码「以为无序」与「依赖保序」并存；`OrderedDict` 与 dict 的关系一度混乱（见 68 号报告）。

### 7.2 set 的缺点

1. **元素必须可哈希**：list/dict/set 不能进 set；嵌套集合要用 frozenset（`{frozenset({1,2})}` 可以，`{% raw %}{{1,2}}{% endraw %}` 报 `unhashable type`）。
2. **无序**：迭代序是哈希槽序，且会随元素变化；要保序去重得用 `dict.fromkeys(seq)` 或额外维护 list。
3. **无重复元素**：需要 multiset 计数语义时退到 `Counter`（68 号报告）。
4. **内存高**：空 set 就 216 字节（内联 `smalltable[8]`），远高于空 list 的 56 字节；适合「确实要 O(1) 成员测试」的场景，只为存几个值则 list 更省。
5. **迭代中改大小抛 RuntimeError**：同 dict（`Set changed size during iteration`）。

### 7.3 二者共有的工程代价

- **哈希碰撞 DoS 防护**：str/bytes 哈希每进程随机化（SipHash + 随机种子），牺牲了「跨进程哈希稳定」的便利（不能把 `hash()` 结果持久化后跨进程比对）。
- **比顺序结构慢/大的常数**：即便均摊 O(1)，每次操作要算哈希 + 探测 + 比较，常数远高于 list 下标访问；元素少时 list 的 O(n) 反而更快（小 n 用 list 更优的经典结论）。

## 八、附录

### 8.1 源码索引（CPython 3.15）

| 结构 | 文件 | 关键符号 |
|---|---|---|
| dict 紧凑字典 | `Objects/dictobject.c`、`Include/internal/pycore_dict.h` | `_dictkeysobject`、`USABLE_FRACTION`、`GROWTH_RATE`、`do_lookup`、`PERTURB_SHIFT` |
| dict 条目 | `Include/internal/pycore_dict.h` | `PyDictKeyEntry`、`PyDictUnicodeEntry`、`DictKeysKind`、`DKIX_EMPTY/DUMMY` |
| set | `Objects/setobject.c`、`Include/cpython/setobject.h` | `PySetObject`、`setentry`、`PySet_MINSIZE`、`LINEAR_PROBES`、`set_table_resize` |
| frozenset 哈希 | `Objects/setobject.c` | `frozenset_hash_impl`、`_shuffle_bits` |
| frozendict | `Objects/dictobject.c`、PEP 814 | `PyFrozenDictObject`、`frozendict_hash`、`frozendict_pair_hash` |

### 8.2 本地实测数据（Python 3.15.0，darwin arm64）

```text
空 dict=64  空 set/frozenset=216
dict 容量序列（含 0..33 元素）：224→352→632→1168   （5/21/… 触发 resize）
set 容量序列（0..24 元素）：216→728→2264           （5/19 元素触发 resize，吻合 0.6 负载）
dict 删空 10 万元素后 sizeof 不变：5242960（不缩容）
字符串键 dict(1000)=26032  vs  int 键 dict(1000)=36952   （差 8 字节/条目）
hash(-1)==hash(-2)==-2   （-1 是错误哨兵）
frozendict: 可哈希、哈希序无关、| 合并、赋值抛 TypeError、sizeof=192
迭代中改大小：dict/set 均抛 RuntimeError
```

### 8.3 参考文献

- [PEP 814 — Add frozendict built-in type](https://peps.python.org/pep-0814/)
- [PEP 412 — Key-Sharing Dictionary](https://peps.python.org/pep-0412/)
- [What's New in Python 3.6（紧凑字典）](https://docs.python.org/3/whatsnew/3.6.html)
- [What's New in Python 3.7（dict 保序）](https://docs.python.org/3/whatsnew/3.7.html)
- [Python 标准库 · 内建类型 dict/set（中文）](https://docs.python.org/zh-cn/3/library/stdtypes.html)
- CPython 3.15 源码：`Objects/dictobject.c`、`Objects/setobject.c`、`Include/internal/pycore_dict.h`、`Include/cpython/setobject.h`
- 本仓库 70 号报告《Python 内置数据结构深度研究》、68 号报告《Python collections 深度研究》
