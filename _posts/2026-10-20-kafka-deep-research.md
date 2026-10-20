---
report: 57
title: Kafka 深度研究：从「日志」这一条原理推导出整个消息系统
date: 2026-10-20
tags: [kafka, message-queue, distributed-systems, streaming]
summary: Kafka 的本质不是消息队列，而是分布式提交日志：顺序写盘、offset 归消费者、分区与 ISR、投递语义边界，全部从「日志存储 vs 消息投递」这一条分水岭推导出来；本文给出完整机制、设计取舍、七类竞品对照与适用红线。
---

Kafka 常被归入「消息队列」，但把它当消息队列理解，就错过了它真正强的地方，也会用它做它根本不擅长的事。本文从第一性原理出发，把 Kafka 的全部机制收敛到一条原理上：**Kafka 是一门日志存储的学问，不是消息投递的学问**。所有看似奇怪的取舍——顺序写盘、offset 归消费者、pull 模型、ISR 复制、日志压缩——都从这一条原理推导出来。

> 数据来源：Apache Kafka 官方文档（4.3 版 design 章节，一手事实）、KIP 提案原文（KIP-932/405/98 等）、Apache 下载页版本信息。文中版本以 2026-10 为准：当前稳定版 **4.3.1**（2026-06-25 发布）。

## 结论先行

1. **定位分水岭**：RabbitMQ 是「投递系统」——broker 负责投递、等 ack、确认后删除，消息状态在 broker；Kafka 是「日志存储系统」——broker 只负责把消息顺序追加到日志里，读到哪了由消费者自己记（offset），状态在消费者。这是后面一切机制的根。

2. **三条第一性原理**：① 顺序写盘 ≈ 内存速度（pagecache + 顺序 I/O + 零拷贝 sendfile），所以 Kafka「不畏惧磁盘」；② 消费进度 = 一个整数 offset，状态极小化 → 可重放、可水平扩展、可多消费者各自读；③ 分区 = 并行度上限 + 顺序保证单元，二者不可兼得。

3. **投递语义边界**：默认 at-least-once；Kafka↔Kafka 之间用「幂等 producer + 事务 + read_committed」可达 exactly-once；跨到外部系统（数据库、下游服务）没有免费 exactly-once，必须把 offset 和输出存在同一个事务里。

4. **演进三件事**：KRaft 已彻底取代 ZooKeeper（4.0 移除，2025-03）；share group（KIP-932）补上了 Kafka 缺失的「队列」语义（逐条 ack、消费者数可超分区数）；tiered storage（KIP-405）已 GA，日志可以长在远端对象存储上。

5. **适用红线**：高吞吐、需回放、多订阅者的日志/事件流 → 用 Kafka；低吞吐的简单任务队列 → RabbitMQ/Redis；请求-响应 → RPC；逐条消息独立确认的场景，Kafka 传统上不擅长，直到 share group 才补上，但仍较新。

## 一、它是什么：分布式提交日志

Apache Kafka 2011 年诞生于 LinkedIn，作者 Jay Kreps、Neha Narkhede、Jun Rao，2012 年进入 Apache 并成为顶级项目。它最初是 LinkedIn 内部解决「实时日志聚合 + 活动流 + 指标」的统一管道：每个页面浏览产生几十次写入，海量数据要在多套下游系统（Hadoop、监控、推荐）之间流动，需要一个统一的高吞吐管道。

官方对它的定义是 **distributed event streaming platform（分布式事件流平台）**，而不是 message queue。「消息队列」只是它的一个用法。更准确的说法是：**Kafka 是一个分布式提交日志（distributed commit log）**。设计文档自己承认，它的设计「更接近数据库日志，而不是传统消息系统」。

技术栈与现状（2026-10）：

| 项 | 事实 |
|---|---|
| 当前稳定版 | 4.3.1（2026-06-25），支持 4.3/4.2/4.1 三个版本线 |
| 发布节奏 | 每年 3 个 release（每 4 个月一个） |
| Broker 语言 | JVM（Scala/Java），4.x 只出 Scala 2.13 构建 |
| 客户端 | 官方 Java 客户端 + 社区 C/C++/Go/Python/Rust（librdkafka 等） |
| 运行形态 | 标准 JVM 镜像 + GraalVM native 镜像（`apache/kafka-native`） |
| 元数据 | KRaft（Raft 共识），4.0.0（2025-03-18）起移除 ZooKeeper |

## 二、根本分水岭：日志存储 vs 消息投递

这是理解 Kafka 的关键，值得单独一节。传统消息队列（以 RabbitMQ 为代表）和 Kafka 长得很不一样，根因不是「谁更快」，而是**对「消息状态该放在哪里」的回答完全不同**。

| 维度 | RabbitMQ（投递系统） | Kafka（日志存储系统） |
|---|---|---|
| 核心隐喻 | 邮政：每封信追踪签收 | 账本：append-only，各自记读到第几行 |
| 消息状态在谁 | broker（未投递/已投递/已 ack） | 消费者（一个 offset 整数） |
| 删除时机 | 消费者 ack 后删除 | 按 retention 保留，与是否消费无关 |
| 消费模型 | push（broker 主动推） | pull（消费者拉 + 长轮询） |
| 吞吐模型 | 每条消息独立路由与确认 | 顺序日志批处理 |
| 消息级 ack | 原生支持 | 传统上不支持（share group 才补上） |
| 回放/重读 | 不支持（删了就没了） | 原生支持（rewind offset） |
| 多订阅者 | 需要 fanout 结构 | 天然（每个 group 独立读全量） |

一句话概括：**RabbitMQ 把「消息被消费到哪一步」当成 broker 的状态来管理；Kafka 把这件事从 broker 里删掉，变成消费者手里的一把游标。** 这一删，删出了吞吐、删出了回放能力，也删掉了几十年来消息队列最难做对的那部分——broker 与消费者就「到底消费了没」达成一致（见 §九、§十）。

代价也很清楚：Kafka 因此**没有消息级的独立确认**。传统队列里「这一条处理失败、只重试这一条」是免费的；Kafka 里一个分区是一个整体游标，你没法只把其中一条挑出来重新投递——直到 KIP-932 的 share group 出现（§十五），才把这条代价补回来。

## 三、核心抽象

| 抽象 | 含义 |
|---|---|
| Topic | 一类消息的逻辑命名，可理解为「主题」 |
| Partition | topic 的物理分片，append-only 日志文件；并行度与顺序保证的最小单元 |
| Offset | 消息在分区内的位置，单调递增的 64 位整数 |
| Producer | 写消息的客户端，决定消息进哪个分区 |
| Consumer | 读消息的客户端，自己记录读到哪个 offset |
| Consumer Group | 一组消费者协作消费；一个分区在同一 group 内只被一个消费者独占 |
| Broker | 一个 Kafka 服务节点 |
| Replica | 分区的一份副本（leader + followers） |

## 四、存储引擎：不畏惧磁盘

Kafka 的性能基础是它敢把消息直接落到磁盘上，而不是尽量塞进内存。这一判断来自一个被反复误解的事实：**磁盘顺序访问并不慢**。

### 4.1 顺序写盘 vs 随机写盘

设计文档给了一组数字：六块 7200rpm SATA 盘组 JBOD，顺序写吞吐约 600MB/s，随机写只有约 100kB/s——**相差 6000 倍**。磁盘真正慢的是「寻道」，不是「传输」。append-only 日志把写操作全部变成顺序追加，避开了寻道，于是磁盘的传输带宽几乎被完全利用。对比 BTree 类的随机访问结构，每次操作 O(log N) 次寻道，每次寻道约 10ms，数据一多性能就是超线性的劣化。Kafka 选择 O(1) 的「追加日志」，读不阻塞写，写之间也不互相阻塞。

### 4.2 pagecache 中心设计

「不畏惧磁盘」的第二层理由：现代 OS 会把**所有空闲内存**拿来当磁盘缓存（pagecache），而 Kafka 跑在 JVM 上，JVM 的堆对象开销巨大、GC 随着堆变大越来越难调。于是 Kafka 干脆不自己维护内存缓存，让数据直接写进 pagecache：

- 省掉「进程内缓存 + OS 缓存」的双重存储（数据存两份）；
- 字节紧凑存储，而不是堆里一个个对象；
- 32GB 机器上可达 28–30GB 缓存，没有 GC 压力；
- 服务重启后缓存还是热的（OS 层），而进程内缓存重启后要重建。

设计文档的原话是：与其「尽量放内存、空间不够了再慌慌张张刷盘」，不如反过来——**所有数据立即写入文件系统上的持久日志，但不强制 fsync**，实际上就是把数据移交到内核 pagecache。这就是「pagecache 中心的架构」。

### 4.3 零拷贝：sendfile

消费是 Kafka 的另一半成本。普通路径下，把日志数据发给消费者要 4 次拷贝（磁盘→pagecache→用户态 buffer→socket buffer→NIC）。Linux 的 `sendfile` 系统调用让 OS 直接从 pagecache 送到网卡，省掉中间两次用户态拷贝。再叠加「多消费者读同一份数据」：数据只进 pagecache 一次，每次消费都复用，于是消费速度逼近网卡上限。实际效果是——**当消费者基本追平时，磁盘上完全没有读 I/O，全部命中缓存**。

一个细节：TLS/SSL 在用户态工作，`SSL_sendfile` 目前 Kafka 不支持，所以启用 SSL 后零拷贝失效。这是「安全」与「极致吞吐」之间的一个真实取舍点。

### 4.4 端到端批压缩

瓶颈有时不是 CPU 或磁盘，而是跨数据中心网络带宽。逐条压缩消息的压缩率很差（冗余分散在消息之间，比如 JSON 字段名、日志里的 User-Agent），所以 Kafka 支持**整批压缩**：一批消息一起压缩、一起发送，broker 解压一次做校验（比如核对记录数），然后以压缩形态落盘、以压缩形态传给消费者，消费者端再解压。支持 GZIP / Snappy / LZ4 / ZStandard。整条链路上数据几乎不解压，既省网络又省磁盘。

### 4.5 日志结构与 retention

一个分区的日志物理上是**多个 segment 文件**（每个 segment 一组 `.log` / `.index` / `.timeindex`），配一个**稀疏索引**（offset→文件位置，不是每条消息一个条目）。数据按两种策略清理：

- **时间/大小**：超过 `retention.ms` 或 `retention.bytes` 的旧 segment 整体删除；
- **日志压缩（log compaction）**：按 key 保留每个 key 的最新值，见 §六末。

## 五、分区与顺序：鱼和熊掌

分区是 Kafka 最容易被误用的一环，本质是一个 trade-off：

- **并行度**：一个分区的吞吐上限是单分区吞吐。要更高吞吐 → 加分区 → 加消费者。消费者组里，一个分区只被一个消费者占用，所以**组内有效消费者数 ≤ 分区数**，多出来的消费者空闲。
- **顺序**：分区**内部**严格有序（同一分区内 offset 单调、消息按写入顺序）。跨分区**无全局顺序**。

把这两条放一起就是：**全局有序 = 单分区 = 没有并行 = 吞吐受限**；**高并行 = 多分区 = 只保证「同 key 局部有序」**。

Producer 通过 key 决定分区（默认对 key 取哈希、取模分区数），于是**同一个 key 的所有消息必然落进同一个分区 → 同一个 key 的消息有序**。例如用 user_id 做 key，则某个用户的所有事件严格有序，消费者可以对「同一用户」做局部有序假设——这正是设计文档说的「locality-sensitive processing」。key 分布不均会造出热点分区（§十三）。

## 六、副本与一致性：为什么不用 Raft 多数派做数据复制

Kafka 每个分区有多份副本（replication factor），一主（leader）多从（follower）。**写只走 leader，读可走 leader 或 follower**；follower 像普通消费者一样从 leader 拉取并应用到自己的日志上（拉取让 follower 天然能批量）。

这里有一个 Kafka 最反直觉、也最有意思的设计选择：**数据复制不用多数派（quorum/Raft），用 ISR（in-sync replicas）**。

### 6.1 ISR 与多数派的权衡

多数派（majority vote，ZooKeeper 的 Zab、Raft 都属此类）的规则是：容忍 $f$ 个故障，需要 $2f+1$ 个副本，写入需 $f+1$ 个副本确认，选主时选日志最完整的那个。它有个好处：**延迟只取决于最快的从节点**（$f+1$ 个里最快的先返回即可）。

但代价是致命的：**容忍 1 个故障要 3 份数据，容忍 2 个要 5 份**。在大流量数据系统里，每条数据写 5 次 = 5 倍磁盘 + 1/5 吞吐，不现实。所以多数派更多出现在「共享集群配置」（如 ZooKeeper）这类小数据量场景，而很少用于主数据存储。

Kafka 的做法：维护一个**ISR 集合**（已追上 leader 的副本），一条消息**要等 ISR 里所有副本都收到才算 committed**，且**只有 ISR 里的副本有资格当选 leader**。用 $f+1$ 个副本就能容忍 $f$ 个故障——比多数派少一整个副本。设计文档说这与微软的 PacificA 最接近。

两者的诚实对比：多数派能「不等最慢的从节点就提交」，ISR 则要等 ISR 里最慢的。Kafka 认为这个劣势被两件事抵消：① 客户端可以自己选要不要等 commit（`acks` 参数）；② 少一个副本带来的吞吐和磁盘节省值得。**用「允许用户选择阻塞 or 不阻塞」换「少一份数据」**，是这个取舍的核心。

### 6.2 谁算「in sync」

一个 broker 满足两个条件才算「in sync」：

1. 与 controller 保持活跃会话（KRaft 下通过心跳，超时由 `broker.session.timeout.ms` 控制）；
2. 作为 follower 不能落后 leader 太远（落后超过 `replica.lag.time.max.ms` 就踢出 ISR）。

### 6.3 提交、acks 与不丢数据

只有 committed 消息才会暴露给消费者。Producer 通过 `acks` 选择持久性级别：

| acks | 含义 |
|---|---|
| 0 | 不等待确认，可能丢 |
| 1 | 等 leader 确认，leader 宕机可能丢 |
| all / -1 | 等所有 ISR 副本确认 |

一个容易踩的坑：`acks=all` 里的「all」指的是**当前 ISR 里的全部**，不是「配置的副本数」。如果配置 3 副本、挂了 2 个（ISR 只剩 1 个），`acks=all` 依然会成功，但这条消息其实只存在一个副本上，这个副本再挂就丢了。要「宁可不可用也不丢」，需要配合 `min.insync.replicas`（ISR 数量低于它时拒绝写入）。

**Kafka 的持久性保证可以压缩成一句**：committed 消息不会丢，**只要始终有至少一个 ISR 副本存活**。

### 6.4 不干净的 leader 选举

如果某个分区的所有副本全挂了，怎么办？两条路：

1. 等 ISR 里的副本回来当 leader（可能永久不可用，但数据不丢）；
2. 让第一个回来的副本（即使不在 ISR）当 leader（可用，但可能丢已提交数据）。

默认（0.11.0.0 起）选第一条——**宁可不可用，不丢数据**；`unclean.leader.election.enable=true` 切到第二条。这是「可用性 vs 一致性」的标准权衡，不是 Kafka 特有。

### 6.5 日志压缩（log compaction）

时间/大小保留适合「每条消息独立」的日志；但对「带 key 的可变状态变更流」（比如用户邮箱变更、数据库表的变更）就不够——它需要的是「**每个 key 至少保留最新一条**」。日志压缩就是干这个的：

- 后台线程（log cleaner）定期重写 segment，删掉「同 key 有更新记录」的旧记录；
- 每个 key 保留最新值；带 key 且 value 为空的记录是**墓碑（tombstone）**，表示删除，它本身也会在 `delete.retention.ms`（默认 24h）后被清掉；
- 消息的 **offset 永不改变**——被压缩掉的 offset 位置变成「空洞」，读时返回该 offset 之后最近的一条。

这保证了：任何从日志头开始消费的消费者，能看到每个 key 的**最终状态**。这就是 changelog（变更日志）模式：下游可以靠一个 compacted topic 恢复自己的状态，而不用保留全量变更历史。

## 七、元数据演进：ZooKeeper → KRaft

Kafka 长期依赖 ZooKeeper 管理元数据（broker 注册、controller 选举、topic 配置、ISR 变更）。注意：**数据路径从来不经过 ZK**，ZK 只存「谁活着、谁是 leader、topic 长什么样」这类元数据。

这套架构的痛点很直接：

- 要运维两套分布式系统，版本、监控、备份都得双份；
- 元数据变更要在 ZK 和 broker 之间双写，一致性难搞；
- 故障恢复慢：ZK 模式下 broker 要重建元数据；
- ZK 成了集群规模的瓶颈（它本身是多数派系统）。

**KRaft**（KIP-500/595/631）把元数据管理内嵌进 Kafka 自身：一组 broker 组成 controller quorum，用 **Raft 共识**维护一份元数据日志（`__cluster_metadata`）。于是 Kafka 只剩一套系统、一个 Raft 协议、一条元数据日志。**4.0.0（2025-03-18）起彻底移除 ZooKeeper**，KRaft 成为唯一模式。

这里有层有意思的对比：Kafka 的**数据**复制用 ISR 而不是 Raft，但**元数据**复制用 Raft。为什么？因为元数据是小数据量、强一致优先的场景，正是多数派/共识算法的甜区；而数据是大流量、吞吐优先的场景，ISR 省掉的那份副本才是甜区（§六）。**两种复制协议各司其职，恰好印证了「选型取决于数据量与一致性需求的权重」。**

## 八、生产者：批量、幂等、事务

Producer 直接把消息发给目标分区的 leader，中间没有路由层。核心机制：

- **分区选择**：key 哈希（可自定义 partitioner），或随机。
- **异步批量**：producer 在内存里攒消息，攒到一定量或一定时间（文档示例 64kB 或 10ms）再一次性发。用少量延迟换更大批次、更少 I/O。
- **幂等 producer**（0.11.0.0 起）：broker 给每个 producer 发一个 PID，producer 给每条消息带 sequence number，broker 据此去重——**重发不会在日志里产生重复条目**。
- **事务**（0.11.0.0 起）：`transactional.id` 配置后，可以原子地写多个分区，提交/中止时写 marker record。

## 九、消费者：pull 模型与「位置即整数」

### 9.1 为什么 pull 而不是 push

设计文档直接回答了这个问题。push 系统里，broker 决定投递速率；当消费者消费速度低于生产速度，push 会把消费者淹没——本质上变成一次 DoS。pull 系统的消费者「跟不上就落后，跟得上就追上」，天然形成背压。想给 push 加背压协议很难做对「充分利用但不过载」。

pull 的第二个好处是**天然批处理**：消费者总是「拉取当前位置之后的所有可用消息」（或到某个大小上限），一次拿一大块，而不是 push 那种「要么单条发、要么猜下游能不能处理」。

pull 的缺陷是「没数据时空转轮询」，Kafka 用**长轮询**补：fetch 请求可以阻塞等待，直到有数据（或攒够字节数）再返回。

### 9.2 位置是整数：这是最聪明的一刀

「记录消费进度」这件事，传统队列在 broker 上给每条消息维护状态（已投递/已 ack/锁住防重投），这是消息系统里最麻烦的一块——「消息发出去了但一直没 ack 怎么办」这类问题都从这里来。

Kafka 的解法是釜底抽薪：**一个分区在同一 group 内同一时刻只被一个消费者消费，于是「进度」就是一个整数 offset**（下一个要读的位置）。状态极小化到「每个分区一个数」，可以定期 checkpoint。这等于把「消息确认」的成本降到了几乎为零。

副作用是一个意外之喜：**消费者可以故意把 offset 回拨，重读历史数据**。这违反了传统队列的契约，却是很多场景的救命能力——代码有 bug 消费错了，修完 bug 回拨 offset 重来一遍即可。

### 9.3 rebalance 的演进

消费者组的成员变化（加机器、宕机、改订阅）会触发 rebalance，把分区重新分给成员。演进分三代：

1. **eager（classic）**：全体停手、重新分配、再恢复——stop-the-world，代价是滚动重启时大面积暂停。
2. **cooperative sticky（KIP-429）**：增量调整，尽量保持已分配的分区不动，只挪必须挪的。
3. **next-gen（KIP-848）**：把分配逻辑从客户端搬到 broker 端（server-side assignor），协议重构。4.x 里消费者组类型分「consumer」（新协议）和「classic」（旧 eager 协议）。

静态成员（KIP-345）：给消费者配 `group.instance.id`，让它有持久身份，滚动重启不再触发 rebalance。

## 十、投递语义：三条边界与 exactly-once 的真相

投递语义要拆成两个独立问题：**发布端的持久化保证** 和 **消费端的处理保证**。

### 10.1 发布端

Producer 发出消息遇到网络错误时，无法知道「错误发生在提交前还是提交后」——这跟「往自增主键的表里插一行」是同一类语义。0.11.0.0 之前只能重发，于是 at-least-once（可能重复）；0.11.0.0 之后幂等 producer 让重发不产生重复。

### 10.2 消费端

消费者读消息后，有两个动作：**处理** 和 **提交 offset**。顺序不同，语义不同：

1. **先提交 offset、后处理**：提交后、处理前崩溃 → 接手者从新 offset 开始，那几条没处理 → **at-most-once**（可能丢）。
2. **先处理、后提交 offset**：处理后、提交前崩溃 → 接手者从旧 offset 开始，那几条重处理 → **at-least-once**（可能重复）。下游靠幂等（消息带主键、重复写入是覆盖自己）来消重。

### 10.3 exactly-once 的真边界

Kafka 默认 at-least-once。真正的 exactly-once 来自「**offset 提交和业务输出写进同一个事务**」：

- **Kafka→Kafka**（如 Kafka Streams）：消费者的 offset 存在内部 topic，把它和输出 topic 写进同一个事务。事务 abort 时，offset 回退、输出对其他消费者不可见。配合 `read_committed` 隔离级别，下游看不到未提交/已中止事务的记录。**这是 Kafka 能真正保证 exactly-once 的边界。**
- **Kafka→外部系统**：下游数据库大多不支持与 Kafka 的 offset 做两阶段提交。解法是把 offset 存在「输出所在的同一个地方」（比如 Kafka Connect 往 HDFS 写数据时把 offset 一并写进去），保证「数据和 offset 要么都更新、要么都不更新」。**做不到这一步，就没有 exactly-once，只有 at-least-once + 下游幂等。**

一句话：**exactly-once 不是 Kafka 单方面给的，是「offset 与输出同地原子提交」这个结构给的。** 谁要 exactly-once，谁就得设计出这个结构。

## 十一、为什么这么设计：取舍一览

把前面所有「为什么」压成一张表。每一行都是一个取舍，右边是它换来什么、牺牲什么。

| 取舍 | 反面做法 | 换来 | 牺牲 |
|---|---|---|---|
| 顺序写盘 | 内存为主 | 吞吐、持久、成本、无 GC 压力 | 读需走磁盘（热点靠缓存） |
| 状态归消费者（offset） | broker 记消息状态 | 状态极小化、可回放、多订阅者 | 无消息级 ack、无法逐条重投 |
| pull 模型 | push 模型 | 天然背压、天然批处理 | 需长轮询补空转 |
| 分区 | 单队列 | 水平扩展 | 无全局顺序 |
| ISR 复制 | 多数派/Raft | 少一份数据、高吞吐 | 提交要等最慢 ISR 副本 |
| 日志按 retention 保留 | ack 即删 | 回放、多订阅者、离线加载 | 磁盘占用 |
| KRaft | ZooKeeper | 单一系统、更快恢复、更大规模 | 重构成本（迁移） |
| share group（新） | 传统 consumer group | 消费者数超分区数、逐条 ack | 更复杂、较新、无 fencing |

**核心洞察**：Kafka 的几乎每一个「不同」都指向同一个方向——**把 broker 该记的状态删掉，把顺序访问留给磁盘，把一致性范围缩到最小**。这是「高吞吐、可扩展、可回放的日志」的代价结构，也是它区别于「把每条消息当独立工作项投递」的传统队列的根源。

## 十二、竞品对照

| 系统 | 语言/存储 | 定位 | 消息级 ack | 投递语义 | 特色 | 短板 |
|---|---|---|---|---|---|---|
| **Kafka** | JVM / 本地日志 | 分布式日志/流平台 | 传统无，share group 有 | at-least-once（+EOS） | 吞吐、回放、生态、KRaft | 运维重、低吞吐场景过重 |
| **RabbitMQ** | Erlang / 队列 | 经典消息队列（AMQP） | 原生 | at-least-once 等 | 路由灵活、ack/死信成熟 | 吞吐上限、无回放、复制较弱 |
| **Pulsar** | JVM + BookKeeper | 存算分离流平台 | 原生 | at-least-once / EOS | 计算与存储独立扩展、多租户 | 架构复杂、两套组件运维 |
| **RocketMQ** | JVM / 本地存储 | 阿里系消息队列 | 原生 | at-least-once / 事务消息 | 事务消息、topic 语义贴近业务队列 | 生态、多语言客户端弱于 Kafka |
| **NATS JetStream** | Go / 内存+文件 | 轻量流+队列 | 原生 | at-least-once | 轻、低延迟、可嵌入 | 吞吐与生态规模较小 |
| **Redis Streams** | C / 内存 | 轻量流（consumer group） | 原生（XACK） | at-least-once | 极低延迟、已有 Redis 时零成本 | 内存成本、持久化/复制受限 |
| **Redpanda** | C++ / Seastar | Kafka 协议兼容重写 | 同 Kafka | 同 Kafka | 线程每核、无 JVM GC 抖动、单二进制 | 生态兼容度、特性追赶 |

选型的心智模型不是「谁更快」，而是**对齐定位**：

- 要「每条消息独立确认、处理失败只重试这一条」的**任务队列** → RabbitMQ / NATS / Redis Streams（或 Kafka 的 share group，较新）。
- 要「高吞吐日志/事件流、多下游、要回放」→ Kafka（或协议兼容的 Redpanda）。
- 要「存算独立伸缩、强多租户」→ Pulsar。
- 已深度绑定 Redis、量不大 → Redis Streams 是零成本选择。

## 十三、实践与常见坑

**分区数**：分区是并行度上限，但每加一个分区都增加元数据量、文件句柄、rebalance 成本。设计文档在 KIP-932 动机里点名了「over-partition」——很多人为了峰值负载能并行，被迫过度分区。先估峰值并行度再定分区数，别盲目开大。

**key 设计**：key 决定局部有序，也决定热点。key 分布不均会造出热点分区，个别分区被打满而其他分区空闲。

**acks 与 min.insync**：要「不丢数据」，用 `acks=all` + `min.insync.replicas`（≥2）。默认 `acks=1` 在 leader 宕机时会丢。

**消息丢失的三条路径**（排查顺序）：

1. producer：`acks=0`/`acks=1` 且未开幂等重试；
2. broker：开了 unclean leader election；
3. consumer：先提交 offset 再处理（at-most-once 配置）。

**重复的三条路径**：producer 未开幂等就重试；consumer 处理完未提交就崩溃；`acks=all` 但 ISR 缩小导致的边缘重复。下游要么幂等，要么接受 at-least-once。

**rebalance 竞态**：offset 提交与 rebalance 之间的窗口是经典的重复/丢失来源，注意提交时机；滚动重启用静态成员或 cooperative/next-gen rebalance 减少抖动。

**监控指标**：ISR 收缩、under-replicated partitions、consumer lag（消费落后量）、unclean election 计数、请求延迟。前三项直接对应数据安全。

## 十四、适用场景与红线

**该用 Kafka 的信号**：日志/指标/事件流；高吞吐；多个下游各自读；需要回放或重处理（改 bug 重算、换模型重训练）；事件溯源；跨系统解耦的中央管道。

**别用 Kafka 的信号**：

- **低吞吐的简单任务队列** → RabbitMQ/Redis。Kafka 的吞吐优势在低量下毫无意义，运维成本却全价。
- **请求-响应** → 这是 RPC 的活，不是消息系统的。
- **逐条消息独立确认/单条重投** → 传统 Kafka 做不到（share group 才能，但较新）。
- **把 Kafka 当数据库做点查** → 它是日志，不支持按 key 随机读（有 ksqlDB/物化视图，但语义不同）。
- **把 Kafka 当定时调度器** → 它是传输层，不是调度器。

套用仓库里 AI 适用性研究的那套判据，Kafka 选型问三个问题：**吞吐高到值得承担这套运维吗？需要回放/多订阅者吗？需要消息级独立确认吗？** 三个答案决定选不选它，也决定要不要上 share group。

## 十五、发展趋势

- **KRaft 成熟**：4.0 移除 ZK 后成为唯一模式，单一系统、更快恢复、更大规模。这是过去两年 Kafka 最重要的架构变化。
- **queues for Kafka（KIP-932，share group）**：补上「队列」语义。share group 让多个消费者**协作消费**同一批分区，消费者数可以**超过分区数**，记录**逐条 ack**（acknowledge / release / reject / renew），并带**投递计数**用于自动处理无法处理的记录。获取记录带 30s 的时间锁（`share.record.lock.duration.ms`），锁超时自动释放重投，broker 用 `group.share.partition.max.record.locks` 限制在途记录数。它建立在 KIP-848 的 next-gen rebalance 之上。一句话：**Kafka 正在把自己过去「为日志牺牲掉的那部分队列能力」补回来。**
- **tiered storage（KIP-405）**：已 GA。本地 + 远端（HDFS/S3）两层存储，完成的 log segment 上移到对象存储，本地只留「热」段，日志实际上可以无限增长，向存算分离靠拢。局限：不支持 compacted topic；RemoteStorageManager 没有开箱实现，需自己接。
- **云原生与 native**：容器化（Strimzi）、GraalVM native 镜像（`kafka-native`）降低内存与冷启动成本。
- **与流处理一体化**：Kafka Streams / ksqlDB / Flink 都以 Kafka 为存储底座——**流处理是「日志」这一抽象的自然延伸**：日志记录事实，流处理对事实做有状态计算，结果又写回日志。

## 十六、附录

### 关键 KIP 索引

| KIP | 内容 |
|---|---|
| KIP-98 | exactly-once（幂等 producer + 事务） |
| KIP-345 | 静态成员（`group.instance.id`） |
| KIP-405 | tiered storage（分层存储） |
| KIP-429 | cooperative sticky rebalance |
| KIP-500 / 595 / 631 | KRaft（去 ZooKeeper） |
| KIP-848 | 下一代消费者 rebalance 协议 |
| KIP-932 | queues for Kafka（share group） |

### 版本时间线

| 版本 | 时间 | 关键变化 |
|---|---|---|
| 0.11.0.0 | 2017 | 幂等 producer + 事务（EOS） |
| 2.3 | 2019 | 静态成员 |
| 3.7 | 2024-02 | share group 早期接入（KIP-932） |
| 4.0.0 | 2025-03-18 | 移除 ZooKeeper，KRaft 唯一模式 |
| 4.3.1 | 2026-06-25 | 当前稳定版 |

### 参考

- [Apache Kafka 官方文档 · Design（4.3）](https://kafka.apache.org/43/design/design/)——本文存储、生产者、消费者、投递语义、副本、日志压缩章节的一手来源。
- [KIP-932: Queues for Kafka](https://cwiki.apache.org/confluence/display/KAFKA/KIP-932%3A+Queues+for+Kafka)——share group 机制全文。
- [Kafka Tiered Storage 官方文档（4.3）](https://kafka.apache.org/43/operations/tiered-storage/)——分层存储与 GA 状态。
- [Apache Kafka 下载页](https://kafka.apache.org/community/downloads/)——版本与发布节奏。
- [Kafka 协议与 KIP 总览](https://cwiki.apache.org/confluence/display/KAFKA/Kafka+Improvement+Proposals)。

---

> 本文「投递语义边界」「选型判据」的推理方式，与本仓库 [AI 适用场景深度研究](../ai-applicability-deep-research/)（报告 54）中「正确性来源 + 反馈闭环 + 可回滚 + 终局责任」的判据思路同构：先问清楚「正确性/一致性由谁保证」，再决定系统能承诺什么。消息系统与 AI 系统的可靠性，归根结底是同一个问题——**闭环和真值在哪里**。
