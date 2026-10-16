---
report: 4
title: Redis 发展史
date: 2026-10-16
tags: [database, redis, open-source, nosql]
summary: 梳理 Redis 从 2009 年诞生、经 VMware/Pivotal/Redis Labs 商业化，到 2024 年许可收紧与 Valkey 分叉的完整脉络。
math: false
---

Redis 从一个为实时日志分析服务而写的内存存储，成长为事实标准的数据结构服务器。本文按时间线梳理其诞生、商业化、版本演进与开源许可之变。

## 结论先行

1. **定位从第一天就不是「缓存」**：名字 = **RE**mote **DI**ctionary **S**erver，最初定位是「数据结构服务器」。
2. **诞生动机是性能缺口**：为实时日志分析服务 LLOOGG 造的内存存储（MySQL 太慢），先有概念验证 LLOOGG Memory DB，再演化为 Redis。
3. **商业化走了三代赞助**：VMware（2010）→ Pivotal（2013）→ Redis Labs（2015），核心始终由原作者 antirez 主导，直到 2020 年卸任。
4. **许可是一条清晰的退化线**：BSD（2009–2024）→ 部分模块收紧（2018）→ 核心收紧 RSALv2/SSPLv1（2024）→ fork 出 Valkey（2024）。
5. **商标是 fork 改名的根因**：Redis Ltd. 2021 年买下「Redis」商标，开源阵营续命只能改名 Valkey。

## 起源（2009）

创建者是意大利程序员 Salvatore Sanfilippo（网名 antirez），**2009 年 2 月 25 日**在 Hacker News 上首次公布。此前他已做出 Idle scan 端口扫描、Hping 网络工具、Jim（Tcl 解释器）等知名工具。

诞生链条：

```text
LLOOGG（实时日志分析服务）
   → 需要比 MySQL 快得多的内存存储
   → LLOOGG Memory DB（概念验证）
   → Redis（2009，开源）
```

早期贡献者：Engine Yard（BLPOP、部分 Virtual Memory）、Hitmeister（部分 Cluster）、Citrusbyte（Virtual Memory）；Slicehost/Linode 提供测试机，Shuttleworth 基金会捐赠 5000 美元。Pieter Noordhuis 与 Matt Stancliff 后来贡献了大量核心代码。

## 商业化三阶段

| 阶段 | 时间 | 事件 |
|---|---|---|
| VMware | 2010.3–2013.5 | 聘请 antirez 全职开发，承诺保持开源 |
| Pivotal | 2013.5–2015.6 | VMware 分拆，Pivotal 继续赞助 |
| Redis Labs | 2015–2021 | antirez 加入；公司 2011 年以 Garantia Data 起家 |

公司命名沿革与商标：

- 2011 年 Garantia Data 成立，做 Redis 托管服务。
- 2013 年想改名「RedisDB」，被 antirez 公开反对（项目与公司应可区分），撤回。
- 2014 年改名 **Redis Labs**。
- 2021 年改名 **Redis Ltd.**，并从 antirez 手中**买下「Redis」商标与 logo**。

## 版本里程碑

| 版本 | 年份 | 关键特性 |
|---|---|---|
| 1.x | 2009 | 核心数据结构（strings/lists/sets/sorted sets）、RDB 快照持久化 |
| 2.0 | 2010 | pub/sub、hashes、MULTI/EXEC 事务、Virtual Memory（后移除） |
| 2.6 | 2012 | Lua 脚本（EVAL），服务端可编程 |
| 2.8 | 2013 | Sentinel 高可用、SCAN 系列游标 |
| 3.0 | 2015 | **Redis Cluster（GA）**，首个正式分布式/容错版本 |
| 3.2 | 2016 | GEO 地理命令 |
| 4.0 | 2017 | Modules 模块系统、PSYNC2、混合 RDB+AOF 持久化 |
| 5.0 | 2018 | Streams 流（带消费组） |
| 6.0 | 2020 | ACL 权限、I/O 多线程、RESP3、客户端缓存 |
| 7.0 | 2022 | Functions、multi-part AOF、分片 pub/sub |
| 7.4 | 2024 | **许可变更** |
| 8.0 | 2025.5 | 改名 Redis Open Source，Search/JSON/Time Series/概率结构并入内核 |

## 开源之变

这是 Redis 历史最重要的一条线，分四步：

1. **2018 · 模块收紧**：Redis Labs 把部分模块（非核心 Redis）从 AGPL 改成 source-available，阻止云厂商白嫖。引发「Redis 不再开源」误解，antirez 澄清「核心仍是 BSD」。

2. **2020 · 作者卸任**：antirez 宣布卸任维护者，维护交予 Yossi Gottlieb 与 Oran Agra，组建 core team。

3. **2024.3 · 核心收紧**：核心许可从 BSD 改为 **RSALv2 / SSPLv1** 双 source-available。两者都**不是开源许可**：RSALv2 禁止用于数据库产品，违反开源定义第 6 条；SSPL 同理。

4. **2024.3 · fork**：许可变更 8 天后，**Valkey** 作为 Linux Foundation 项目成立，由 Alibaba/Amazon/Ericsson/Google/Huawei/Tencent 六家各一名活跃贡献者发起，延续 BSD，首个版本 Valkey 7.2.5。因 Redis Ltd. 握有商标，必须改名。另有独立 fork **Redict**。

> **关键点**：2024 年之前「Redis 是 BSD、会一直是 BSD」的承诺，最终被公司打破——这是 fork 的直接导火索，也是理解当前 Redis 生态分裂的核心。

## 现状（2025–2026）

- Redis 8.x 起发布节奏明显加快，大致季度发版：8.0（2025.5）→ 8.2（2025.8）→ 8.4（2025.11）→ 8.6（2026.2）→ 8.8（2026.5）→ 8.10（2026.7）。
- 8.0 在 RSALv2/SSPLv1 之外新增 **AGPLv3** 选项；把 RediSearch、RedisJSON、RedisTimeSeries、RedisBloom 等模块**并入内核**。
- 主线转向 **AI/向量**：Vector set（beta）、Query Engine 向量搜索、LLM 语义缓存/RAG。
- 生态分叉定型：**BSD 阵营走 Valkey**，商业/企业特性走 Redis Ltd.；协议与命令基本兼容，但**许可与治理已分道扬镳**。

## 参考

- [Valkey Documentation: History](https://valkey.io/topics/history/)
- [Redis 8.0 Release Notes](https://raw.githubusercontent.com/redis/redis/8.0/00-RELEASENOTES)
- [antirez: The end of the Redis adventure](http://antirez.com/news/133)
- [Redis Adopts Dual Source-Available Licensing](https://redis.io/blog/redis-adopts-dual-source-available-licensing/)
- [Linux Foundation Launches Valkey](https://www.linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community)
- [Hacker News 首次公布（2009）](https://news.ycombinator.com/item?id=494649)
