---
report: 18
title: 分布式锁研究：Redis 互斥原语的能力边界
date: 2026-10-16
tags: [redis, distributed-lock, redlock, consistency]
summary: 论证 Redis 分布式锁的失效本质（持有者可被暂停而自己不知）、效率锁与正确性锁的分界、DELEX 8.4 新命令、Redlock 争议与 Redisson 弃用现状，并附可复现实验。
---

**分布式锁是「看起来最简单、实际最容易答错」的分布式系统原语。** 本文要证明一个反直觉的结论：

> **在 Redis 上，即使每一行加锁/释放命令都写对了，锁仍然会失效。**

失效的根因不是命令写错，而是分布式锁与本地互斥锁存在一个本质差异——**持有者可以被 GC 停顿、VM 迁移、CPU 饿死、网络挂起冻结一段超过锁有效期的时间，而它自己完全不知道**。锁服务端无法伸进一个被暂停的进程里收回权限。

由此推出本文的核心框架：**分布式锁的正确性 = 锁服务的安全性 + 资源端的自我保护**，只做前者是半成品。以及一句贯穿全文的判断——

> **锁只决定谁先走，但只有资源端能执行这个决定。**

## 一、为什么需要分布式锁

三个真实驱动，由浅入深：

| 驱动 | 典型场景 | 不用锁会怎样 |
| --- | --- | --- |
| **互斥语义跨进程失效** | 服务多副本部署，本地 `mutex` / `synchronized` 只在一个进程地址空间内有效 | 副本 A 上的锁对副本 B **完全不可见**——最浅一层，但很多人就错在这一层 |
| **临界区跨越多个资源** | 读 Redis → 计算 → 写 DB → 调第三方 API，这个序列本身没有任何原子性保证 | 两个请求交错，写回的是基于过期快照算出的结果 |
| **跨服务协调** | 单例调度器 / leader 选举 / 缓存重建防击穿 / 防重复提交 / 严格串行扣减 | 重复执行、重复发货、重复扣款 |

**但真正的题眼是下面这一条，它决定了后面所有取舍：**

> 本地 mutex 由操作系统保证你持有；分布式锁的持有者却可以被冻结超过锁有效期而自己浑然不知。锁服务端做对了所有事情，它还是失败了——因为它没有能力伸进一个被暂停的进程里收回权限。

这条用一句话概括：**分布式锁和本地 mutex 不是同一种东西。**

## 二、正确性边界：效率锁 vs 正确性锁

Martin Kleppmann 在《How to do distributed locking》里给出的分界，是这个问题唯一正确的思考起点：

| | **效率锁**（efficiency） | **正确性锁**（correctness） |
| --- | --- | --- |
| 双重执行的代价 | 浪费一次算力（重复跑任务、多发一封邮件） | 数据损坏或资金损失（重复扣款、覆盖写） |
| 需要什么 | 单实例 `SET NX PX` + 安全释放，已经够 | **必须由资源端参与**：fencing token + 条件写 |
| Redlock 的位置 | 一般用不上；想抗单点才考虑 | 单独使用**不成立**——它不发放 fencing token |
| 典型手段 | Redis 单实例锁 + 看门狗 | etcd / ZooKeeper lease + 资源端拒绝旧 token 的写 |

这个二分法回答了"我到底该用什么锁"——而答案取决于**双重执行的代价是什么**，不是"哪个技术更高级"。

## 三、Redis 上的正确写法，以及它的三个版本

### 3.1 获取：一条命令，必须原子

```bash
SET resource_name <unique-token> NX PX 30000
```

- `NX`：只有不存在时才成功。
- `PX`：自动释放，防止持有者崩溃后死锁。
- `<unique-token>`：全局唯一的持有凭证（官方建议 20 字节 `/dev/urandom`；实务上 UUID4 + 客户端 ID 拼接足够）。它不是用来"识别是谁"，是用来做**安全释放**的。

### 3.2 释放：必须是原子的 compare-and-delete

```bash
DELEX resource_name IFEQ <unique-token>     # Redis 8.4+ ← 官方文档已改为推荐这条
```

```lua
-- 8.4 之前：Lua 脚本，也就是大家背了十年的那个版本
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

**绝对不能用裸 `DEL`**——A 超时后会删掉 B 刚拿到的锁。

### 3.3 三个版本的对照（E1 实验已复现）

| 写法 | 缺陷 | 复现结果 |
| --- | --- | --- |
| `SETNX` + `EXPIRE` 两步 | 非原子，中间崩溃留下永不过期的锁 | E1 实测：TTL = -1，死锁 |
| 裸 `DEL` 释放 | A 删掉了 B 刚拿到的锁 | E1 实测：B 的锁被误删 |
| `SET NX PX` + compare-and-delete | **仍挡不住"持有者被暂停"导致的安全失效** | E2 实测：双持有者同时存在 |

> **关键结论：`DELEX` 修的是「误删别人的锁」这个 bug，对「锁过期后失效」的安全性一分钱帮助都没有。** Redis 有了 `DELEX` 不代表 Redis 锁变安全了——这是 2026 年正在形成的新认知误区，把它写清楚就是差异化。

### 3.4 续租 / 看门狗

执行时间不确定时，用后台线程在 TTL/3 左右 `PEXPIRE` 延长（同样要校验 token）。

**关键纪律：续租失败或迟到，必须假定锁已丢失并立即中止正在做的工作**，而不是把活干完。Redisson 的 watchdog 就是这套机制（默认 `lockWatchdogTimeout` 30s，每 10s 续一次）。

**另一条反直觉纪律**：watchdog 与工作者必须共享取消信号。工作线程已卡死却还在不停续租的 watchdog，本身就是一个 bug——它掩盖了一个僵尸持有者。

## 四、核心实验：复现"双持有者同时存在"

这是整篇研究最重要的一张图，也是 E2 实验的结论。用 `fakeredis` 模拟单实例 Redis，复现如下时序：

```
客户端 A                       Redis 锁                     客户端 B
   │ ① SET lock token-A NX PX 10000 ──> key = token-A
   │ ② 进入临界区，随即 STW 停顿 15s（锁 TTL 只有 10s）
   │                              ③ 锁到期，自动删除
   │                                                   ④ SET lock token-B NX PX → 成功
   │ ⑥ 醒来，仍以为持锁
   │ ⑦ 继续写共享资源 ──────────────────────────────> 资源端（此刻 B 也在写）
```

E2 实验实测输出：

```
[A] 尝试加锁  token=0b9c7396  ->  成功
[锁] A 冻结期间 TTL 走完（原剩余 10000ms < STW 15000ms）
[B] 尝试加锁  token=d637990e  ->  成功
[A] 醒来，仍以为自己持锁，继续执行临界区写操作...
结果验证：锁被 B 持有 = True
>>> B 已经合法持有锁，但 A 也认为自己持有锁。双重持有，锁失效。
```

**核心观察**：A 的每一行命令都是正确的，锁服务端也没有做错任何事。失效来自一个锁服务端"够不到"的地方——被暂停的持有者进程。

## 五、Fencing Token：真正的修复在哪里

Kleppmann 指出的修复不在锁里，在资源端。锁服务每次授予锁时发放一个**单调递增的 token**，每个写请求必须携带它，资源端拒绝任何"小于已见过的最大 token"的写：

```
A 拿到 token 33 → A 停顿 → 锁过期 → B 拿到 token 34 并写入 → 资源端 max_seen = 34
A 醒来，带着 token 33 迟到写入 → 资源端判断 33 < 34 → 拒绝
```

**fencing token 从哪里来？** 这是 Kleppmann 批评 Redlock 的具体落点：

| 来源 | 是否可用作 fence token |
| --- | --- |
| ZooKeeper 的 `czxid` / znode version | ✅ 天然单调递增 |
| etcd 的 `mod_revision` | ✅ 天然单调递增 |
| **Redis 的 `INCR`** | ❌ **主从切换后可能回退**，不能保证单调 |
| 数据库 sequence | ✅（在单库范围内） |

> **一句话：锁只决定谁先走，只有资源端能执行这个决定。** 如果你无法在资源端做条件写（比如一个不提供幂等键的第三方 API、一个纯文件共享），fencing 就无法落地，此时诚实的做法是把不变式挪到一个能检查的地方去。

## 六、Redlock：算法、争议、以及它今天的真实地位

### 6.1 算法

antirez 提出，N 个**互相独立**的 Redis 主节点（**不用复制**，通常 N=5）：

1. 取当前毫秒时间
2. 用相同的 key 和 token 并行向 N 个节点加锁（单节点超时远小于锁自动释放时间）
3. 只有当**在多数节点成功（≥ N/2+1）且总耗时 < 锁有效期**时才算拿到
4. 否则向所有节点发起释放

### 6.2 争议核心（Kleppmann vs antirez，2016）

- Redlock 的安全性依赖**有界的时钟漂移和有界的进程暂停**，而这正是分布式系统里最不能假设的两件事。
- 它**不发放 fence token**，因此解决不了第四节的 GC 停顿场景。
- antirez 的反驳是"这些时序假设在实践里是合理的"。两边其实在回答不同的问题：一个讲数学上的安全性证明，一个讲工程上的可用性。

### 6.3 2026 年的现状（四条必须说到，否则会被判定为背八股）

1. **Redis 官方文档仍收录 Redlock**（未撤下），措辞是"我们相信比朴素单实例更安全"。
2. **但 Redisson 已把 `RedissonRedLock` 标记为 `@Deprecated`**（已从 GitHub 源码确认：`@Deprecated public class RedissonRedLock extends RedissonMultiLock`），官方推荐退回普通 `RLock` + watchdog，或按需用 `MultiLock`。**这是最重要的信号：连最主流的 Java 客户端都已不再背书它。**
3. **`MultiLock` 不解决 Redlock 的多数派共识问题**——它只是把多个锁打包管理。网上有文章声称官方已给出替代共识方案，**这是错的**。
4. 运维性价比被普遍质疑：为了一把锁维护 5 套独立 Redis，换来的安全性提升不成比例。

### 6.4 主从 + 故障转移方案的本质缺陷

Redis 官方文档明确说明，用「主从 + 故障转移」做锁存在 **SAFETY VIOLATION**：

> A 在主节点拿到锁 → 主节点在把写同步给副本前崩溃 → 副本提升为主 → B 对同一资源拿到锁 → **安全违规**。

原因一句话：**Redis 复制是异步的**。

但官方紧接着补了一句**极少被人引用、却最能体现判断力**的话：

> *"Sometimes it is perfectly fine that, under special circumstances, for example during a failure, multiple clients can hold the lock at the same time. If this is the case, you can use your replication based solution."*

也就是说：**如果你的场景容忍偶发的多重持有，主从方案是官方认可的。** 这不是妥协，是判断力。

## 七、实现全景：七类方案横向对照

| 方案 | 互斥依据 | fence token | 崩溃释放 | 一致性模型 | 适合 | 不适合 |
| --- | --- | --- | --- | --- | --- | --- |
| **① Redis 单实例 `SET NX PX`** | NX 原子性 + TTL | ❌ | TTL 到期 | 弱 | 效率锁：去重、防重复跑批、防缓存击穿 | 正确性场景；节点即单点 |
| **② Redis 主从 + 故障转移** | 同上，只加了副本 | ❌ | TTL 到期 | ❌ **异步复制会丢锁** | 官方认可：容忍偶发多重持有时可用 | 任何严格互斥场景 |
| **③ Redlock（N=5 独立主节点）** | 多数派 quorum | ❌ | TTL 到期 | 近似（依赖时序假设） | 想抗单点、且场景是效率锁 | 正确性锁；已被主流客户端边缘化 |
| **④ ZooKeeper** | EPHEMERAL_SEQUENTIAL + watch 前驱 | ✅ `czxid` / znode version | **会话断开即自动删除**（不靠 TTL 猜） | ZAB 强一致 | leader 选举、严格互斥 | 不值得为此单独引入一套 ensemble |
| **⑤ etcd** | Lease + lease-bound key | ✅ revision（`mod_revision`） | lease 到期 / keep-alive 中断 | Raft 强一致 | K8s 原生、需要 fence 的正确性锁 | 分区时少数派**直接不可用**（设计取舍：宁可不可用也不给错） |
| **⑥ 数据库**：Postgres advisory lock / MySQL `GET_LOCK` / 行锁 | DB 自身锁管理器 | ❌（advisory 无；行锁则"行本身即资源"） | 会话断开自动释放 | 单机强一致 | 临界区已在一个库内；`FOR UPDATE SKIP LOCKED` 做队列 | 微服务各自独立库；跨数据中心 |
| **⑦ DynamoDB / Cosmos 条件写 + TTL** | 条件写（CAS） | 可用版本号 | TTL 到期 | 分区级强一致 | 云上轻量 lease，不想运维协调服务 | 需要极低延迟（每次加锁都是一次写） |

### 两个生产 footgun（表格塞不下的细节）

- **Postgres advisory lock 分 session 级和事务级**：`pg_advisory_xact_lock()`（事务结束自动释放）通常更安全；**session 级在 PgBouncer transaction 模式下会失效**——下一个事务被分配到不同后端连接，你以为握着的锁属于一条你再也见不到的连接。
- **ZooKeeper 的正确做法是 watch 自己的前驱节点，而不是轮询父节点**：后者会产生惊群（thundering herd）。etcd / Consul 的 watch 同理。

## 八、第 ⑧ 类实现：不用锁

这张表可能比上面那张更值钱：

| 你想解决的问题 | 更便宜的原生方案 |
| --- | --- |
| 重复执行（重试、重复投递） | **幂等键**：第二次执行变成 no-op。**它还顺带覆盖了重试，而锁从来管不了重试** |
| 每个实体只能有一个消费者 | **按 key 分区**（Kafka partition key），或 `SELECT ... FOR UPDATE SKIP LOCKED` 领取任务 |
| 自己库里的行不变式 | 事务 + `FOR UPDATE`：跟着事务自动释放、没有时钟问题——**行就是资源，行就是 fence** |
| 缓存击穿 | 进程内 `singleflight` / 本地锁 + Redis 二级检查，不必上分布式锁 |
| 限流 | **不要用锁实现**。计数语义 ≠ 互斥语义——用 Redis 8.8 的 `INCREX` 或滑动窗口 |

> **检验判断力的一句话：最好的分布式锁，是你从设计里删掉的那把。** 在 review 中反复出现的锁，往往是某个结构问题的 workaround，而那个结构问题通常有更便宜的原生解法。

## 九、必须能回答的判断力问题

1. **TTL 怎么定？** 不能拍脑袋。必须 > 最坏情况临界区耗时 + 余量，且余量覆盖一次最坏情况 STW。**但更重要的一句：如果你发现需要一个很大的 TTL，说明临界区设计错了**——应该是"快速拿锁 → 立刻写状态 → 释放"，把大块计算挪出临界区。
2. **粒度怎么切？** 全局 / per-user / per-order，吞吐可差一个数量级。库存扣减为什么通常按 SKU 而不是全局加锁。
3. **要不要可重入？** Redisson 的 `RLock` 用 Hash 记重入次数 + Lua 保证原子。自己实现时，可重入会把释放逻辑复杂化（什么时候才真正删 key）。
4. **惊群怎么消？** ZK 顺序节点 watch 前驱 vs Redis 轮询重试 + 随机抖动。
5. **时钟怎么用？** 跨机器**绝不用墙钟**做 lease 计算；进程内部用单调时钟（`clock_gettime(CLOCK_MONOTONIC)` / `time.monotonic()`）判断"我超时了没"。
6. **fence token 从哪里来？** Redis 的 `INCR` 不能当 fence token（见第五节）。
7. **Cluster 下的限制**：涉及多 key 的原子操作（如 `MSETEX`）受槽约束，需要 hash tag，而 hash tag 滥用会导致数据倾斜。

## 十、结论

1. **分布式锁 ≠ 本地 mutex**：持有者可以被冻结超过锁有效期而自己不知，锁服务端够不到被暂停的进程。
2. **Redis 锁的正确用法**：`SET NX PX` + compare-and-delete（8.4 起用 `DELEX IFEQ`），配看门狗。它只能做**效率锁**。
3. **`DELEX` 不解决安全问题**：它修"误删"，修不了"过期失效"。
4. **Redlock 已边缘化**：Redis 官方未撤，但主流客户端（Redisson）已 `@Deprecated`。
5. **正确性锁必须靠资源端**：fencing token + 条件写，锁服务端（etcd/ZK）只提供单调 token。
6. **最好先问一句：能不能不用锁**——幂等、分区、行锁、乐观锁往往更便宜。

## 附录 A：关键事实卡

| 事实 | 出处/确认方式 |
| --- | --- |
| `DELEX key IFEQ <value>` 自 **Redis Open Source 8.4.0** 起提供 | Redis 官方命令页 |
| 官方《Distributed Locks with Redis》已把释放锁写法改为 `DELEX` | 官方文档页 |
| 8.4 带 `IFEQ/IFNE/IFDEQ/IFDNE` 时 key 必须是 string 类型 | 官方命令页 |
| 官方仍收录 Redlock（未撤下） | 官方文档页仍保留 The Redlock Algorithm 章节 |
| 官方承认主从方案存在 SAFETY VIOLATION，但同时写明"容忍偶发多重持有时可用复制方案" | 官方文档页原文 |
| Redisson 的 `RedissonRedLock` 已 `@Deprecated` | GitHub 源码确认 |
| `MultiLock` 不解决 Redlock 多数派共识问题 | 源码 + 官方文档无此承诺 |

> ⚠️ **信源警告**：检索中发现多篇中文热文转述 Redisson 源码时，引用了一段**源码中并不存在的 javadoc**（宣称"官方注释推荐改用 MultiLock"）。以源码为准。这类文章的其他结论请一律交叉验证。

## 附录 B：实验产出（可复现）

| 实验 | 文件 | 状态 | 证明什么 |
| --- | --- | --- | --- |
| E1 | `redis-lock-lab/e1_three_ways.py` | ✅ 已跑通 | 三种写法的确定性 bug（死锁 / 误删 / 正确但不够） |
| E2 | `redis-lock-lab/e2_double_holder.py` | ✅ 已跑通 | 双持有者同时存在——锁的本质失效 |
| E3 | 主从故障转移丢锁 | ⏳ 待补（需真实 redis-server 或 docker） | 官方 SAFETY VIOLATION 的实测 |
| E4 | fencing token 端到端 | ⏳ 待补 | 资源端拒绝旧 token |
| E5 | Redlock 代价量化 | ⏳ 待补 | 单实例 vs 5 节点延迟/吞吐 |
| E6 | DELEX vs Lua 对比 | ⏳ 待补 | 8.4 新命令的收益 |

## 附录 C：主要信源

- Redis 官方 · Distributed Locks with Redis：<https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/>
- Redis 官方 · DELEX 命令参考：<https://redis.io/docs/latest/commands/delex/>
- Redis 官方博客 · Simplifying streams and strings：<https://redis.io/blog/simplifying-streams-and-strings/>
- Redisson 源码 · RedissonRedLock：<https://github.com/redisson/redisson/blob/master/redisson/src/main/java/org/redisson/RedissonRedLock.java>
- Martin Kleppmann · How to do distributed locking
- antirez · Is Redlock safe?
