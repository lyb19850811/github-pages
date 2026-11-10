---
report: 77
title: ROS 与 ROS 2 深度研究：Master 中心化到 DDS 去中心化的架构跃迁
date: 2026-11-09
tags: [ros, ros2, robotics, dds, middleware, rtps, real-time, architecture]
summary: 基于官方设计文档与一手公告，核验 ROS 1（Noetic 已 EOL）与 ROS 2 的定位关系、版本生命周期、核心架构差异（Master→DDS、rmw 抽象层、QoS、构建系统）、DDS 取舍、实时性/安全/迁移生态与生产选型。
math: false
---

ROS（Robot Operating System）是机器人/自动驾驶/无人系统的**事实标准软件中间件**。它并非操作系统内核，而是「进程间消息传递 + 包管理 + 构建工具 + 驱动与算法生态」的分布式框架。ROS 2 是对同一目标的重写——核心通信、发现机制、构建系统全部重新设计。本文基于官方设计文档与一手公告，把「ROS 2 为什么推倒重来、DDS 带来什么、rmw 抽象层怎么工作」挖到设计层。结论先行，随后逐节给证据。

## 一、结论先行

- **ROS 1 已进入维护终点。** 最后一个发行版 Noetic 于 **2025-05-31 EOL**，ROS Wiki 随之转为只读存档（[ros.org](https://www.ros.org/blog/noetic-eol/)、[Discourse](https://discourse.openrobotics.org/t/ros-noetic-end-of-life-may-31-2025/43160)）。新项目已无理由从 ROS 1 起步。
- **ROS 2 的本质差异 = 用「去中心化 DDS + rmw 抽象 + QoS + 组件化进程模型」解决 ROS 1 的三大硬伤**：Master 单点故障、无实时、无跨平台（[Changes between ROS 1 and ROS 2](https://design.ros2.org/articles/changes.html)）。
- **通信层换标准：** ROS 1 用自定义 TCPROS/UDPROS + 中央 Master；ROS 2 改用 DDS/RTPS 标准 + 去中心化自动发现，并通过 **rmw 抽象接口**运行时切换 DDS 供应商（[middleware interface](https://design.ros2.org/articles/ros_middleware_interface.html)）。
- **发布节奏：** 年度发布，偶数年 LTS（5 年支持）、奇数年非 LTS（1.5 年）；当前 LTS 为 **Jazzy（至 2029）与 Lyrical（至 2031）**（[Release Schedule](https://docs.ros.org/en/rolling/The-ROS2-Project/Release-Schedule.html)）。
- **DDS 是「复用成熟标准」与「引入复杂度/构建开销」的权衡**，官方在《ROS on DDS》里明确承认（[ros_on_dds.html](https://design.ros2.org/articles/ros_on_dds.html)）。

## 二、定位与历史

| 维度 | ROS 1 | ROS 2 |
|---|---|---|
| 起源 | 2007 Stanford（Willow Garage），2009-2010 成型 | 2014 宣布、2015-08 alpha、2017-12 首个发行版 |
| 维护方 | Open Robotics（OSRF）及社区 | 同左 |
| 最后/首个发行版 | Noetic（2020，EOL 2025-05） | Ardent Apalone（2017-12-08） |
| 关系 | — | 同目标重写，非简单升级 |

ROS 2 不是 ROS 1 的补丁迭代，而是从**通信中间件、发现机制、构建系统、进程模型、语言/平台支持**五个维度重新设计。设计动机写在官方文档里：ROS 1 的架构在 2010 年代已无法满足**多机器人协同、实时控制、跨平台、安全、嵌入式**等新需求。

## 三、版本生命周期现状（截至 2026-11）

ROS 2 采用年度发布，LTS 与非 LTS 交替（[官方发布计划](https://docs.ros.org/en/rolling/The-ROS2-Project/Release-Schedule.html)）：

| 发行版 | 发布时间 | 类型 | EOL |
|---|---|---|---|
| Humble Hawksbill | 2022-05 | **LTS** | 2027-05 |
| Iron Irwini | 2023-05 | 非 LTS | 2024-11（已 EOL）|
| Jazzy Jalisco | 2024-05 | **LTS** | 2029-05 |
| Kilted Kaiju | 2025-05 | 非 LTS | 2026-11 |
| **Lyrical Luth（最新）** | 2026-05 | **LTS** | 2031-05 |

规则（官方文档原文）：**偶数年 LTS**，紧跟在 Ubuntu LTS 后一个月（约 5 月），支持期与 Ubuntu LTS 标准支持窗口对齐（约 5 年）；**奇数年非 LTS**，绑定上一个 LTS 的 Ubuntu 版本，仅支持 1.5 年，与下一个 LTS 重叠 6 个月作为迁移窗口。生产选型：**Jazzy（生态成熟）或 Lyrical（最新 LTS）**；Humble 仍受支持但已进入后半程。

## 四、核心架构差异

### 4.1 通信与发现：集中式 Master → 去中心化 DDS

这是 ROS 1 → ROS 2 最本质的变化。ROS 1 的所有节点信息（注册、话题、服务）由中央 **roscore/Master** 统一管理；ROS 2 则完全去中心化，每个节点即一个 **DDS Participant**，通过 RTPS 发现协议自动找到彼此，无需任何中心节点。

**ROS 1：Master 中心化**

![ROS 1 Master 中心化架构]({{ '/assets/images/ros1-architecture.svg' | relative_url }})

**ROS 2：DDS 去中心化**

![ROS 2 DDS 去中心化架构]({{ '/assets/images/ros2-architecture.svg' | relative_url }})

| 维度 | ROS 1 | ROS 2 |
|---|---|---|
| 传输协议 | 自定义 TCPROS/UDPROS，自定义序列化 | 标准 **DDS/RTPS** |
| 发现机制 | 中央 **roscore/Master**（单点故障、启动顺序依赖）| 去中心化自动发现（SPDP/SEDP，无单点）|
| 中间件抽象 | 无（写死 TCPROS）| **rmw 抽象层**，可换 DDS 实现 |
| QoS | 基本无 | 完整 QoS 策略（可靠性、持久性、历史、期限等）|
| 实时性 | 不支持，依赖 Orocos 等外部框架 | 原生支持（配合 RTOS + 谨慎代码）|
| 进程模型 | 一进程一节点，nodelet 与 node API 分离 | 一进程多节点，组件共享库，部署时定进程布局 |

### 4.2 rmw 中间件抽象层

ROS 2 在客户端库与具体 DDS 实现之间插入 **rmw（ROS Middleware Interface）**，屏蔽 DDS 细节（[middleware interface 设计](https://design.ros2.org/articles/ros_middleware_interface.html)）：

![ROS 2 rmw 抽象层栈]({{ '/assets/images/ros2-rmw-stack.svg' | relative_url }})

三个关键设计点（官方文档原文）：

1. **纯 C 函数接口**（`create_node` / `create_publisher` / `publish`），使得 C++、Python、Java 等语言的客户端库**无需各自重实现核心逻辑**——C ABI 天然跨语言。
2. **信息流单向转换**：客户端库只操作 ROS 数据结构；中间件层负责把 ROS 消息转换为 DDS sample（或反向）。`type support` 封装了这层双向转换。
3. **运行时切换**：`RMW_IMPLEMENTATION` 环境变量在 Fast DDS / Cyclone DDS / Connext 之间切换，代价是每个 `.msg` 包需为各供应商生成 type support，构建/分发包数量放大。

### 4.3 QoS（服务质量）

ROS 2 引入 DDS 的 QoS 策略（[qos 设计](https://design.ros2.org/articles/qos.html)），按话题维度配置：可靠性（Reliable/Best-Effort）、持久性（Transient Local 等）、历史深度（Keep Last/Keep All）、Deadline、Liveliness、Lifespan 等。这是 ROS 1 完全没有的能力，直接决定实时链路（Best-Effort 低延迟）与低带宽/丢包网络（Reliable 重传）的取舍。

### 4.4 消息与类型系统

- C++ 代码生成使用**分离命名空间**，解决 `.msg`/`.srv` 同名冲突与 service 请求/响应冲突（ROS 1 会碰撞）。
- 支持**原始字段默认值**、**数组/字符串上限**——上限使消息最大尺寸可静态计算，从而**预分配内存**，支撑实时与性能。
- `time`/`duration` 统一为消息类型，跨语言字段名一致（ROS 1 中 C++ 的 `sec` 与 Python 的 `secs` 不一致）。
- 移除 `Header` 中已废弃的 `sequence` 字段。

### 4.5 构建与环境

| 维度 | ROS 1 | ROS 2 |
|---|---|---|
| 构建工具 | catkin（`catkin_make`）| **ament** 系列 + **colcon** |
| 构建隔离 | 支持非隔离（共享 CMake context，易命名冲突）| 仅隔离构建（每包独立）|
| devel space | 支持（免安装直接用）| 无，需 `install` 后使用（可用 symlink 模拟）|
| Python 包 | `setup.py` 被 catkin 自定义逻辑限制 | 完整 `setup.py`（entry points 等）|
| 资源查找 | 遍历文件系统（`ROS_PACKAGE_PATH`）| 编译期注册资源索引，运行时高效查询 |

### 4.6 平台与语言

- ROS 1：CI 仅测 Ubuntu，C++03、Python 2。
- ROS 2：Tier 1 支持 Ubuntu（每个发行版绑定单一 Ubuntu LTS）、Windows、macOS；C++14+（近期发行版已用 C++17）、Python 3.5+。

## 五、DDS 的取舍（为何选 DDS）

官方《ROS on DDS》论证（[ros_on_dds.html](https://design.ros2.org/articles/ros_on_dds.html)）：

**收益**
- 复用成熟标准，省去自研可靠传输/发现/序列化的维护成本。
- 自带发现、QoS、安全（DDS-Security）、实时性生态。
- 多供应商竞争（Fast DDS / Cyclone DDS / RTI Connext），可按性能/内存/平台选最优解。

**代价**
- DDS 规范复杂度高，被抽象层隔离但也带来性能与构建开销。
- 静态 vs 动态类型（XTypes DynamicData）——动态类型灵活但性能低于静态生成代码。
- 不同 DDS 供应商互操作性受限（RTPS 线协议之上仍有 vendor 差异），混用需谨慎。

## 六、实时性与性能

- ROS 2 通过**消息预分配**（有界数组/字符串）、**loaned messages（零拷贝）**、**intra-process communication**（同进程节点走共享内存/指针，跳过序列化）、**自定义 executor** 支持实时调度。
- 真正的硬实时仍依赖 RTOS 与用户代码约束；ROS 2 提供的是「可实时化」的路径而非开箱即用的硬实时。
- 微控制器场景由 **micro-ROS**（基于 DDS-XRCE）承接，连接 MCU 与 ROS 2 图。

## 七、安全

ROS 1 无内置安全。ROS 2 通过 **SROS 2** 提供：基于 DDS-Security 的**认证、加密、访问控制**（节点级权限策略），支持安全节点通信、密钥分发（keystore）。这是工业/车载场景采用 ROS 2 的重要驱动之一。

## 八、迁移与生态

- **迁移**：官方提供 `ros1_bridge`，在同一主机上桥接 ROS 1 与 ROS 2 话题/服务，支持渐进式迁移。
- **核心生态**：Nav2（导航，替代 ROS 1 move_base）、MoveIt 2（机械臂）、Gazebo/`gz`（Ignition→Gazebo 系列仿真器）、rviz2、tf2、rosbag2、驱动层（`ros2_control`）。
- **工具**：`ros2` CLI（`ros2 run/launch/topic/node/param/bag`）、`colcon`、`launch`（Python 版 launch，替代 XML roslaunch，支持条件/逻辑）。

## 九、选型建议

1. **ROS 1 已进入维护终点**（Noetic EOL 2025-05），任何新项目都应基于 ROS 2。
2. **架构本质差异**：ROS 2 用「去中心化 DDS + rmw 抽象 + QoS + 组件化进程模型」解决了 ROS 1 的三大硬伤——Master 单点、无实时、无跨平台。
3. **生产选型**：Jazzy（成熟 LTS）或 Lyrical（最新 LTS，至 2031）；DDS 供应商按实时/带宽/资源需求在 Fast DDS / Cyclone DDS 间选择，车队/异构网络可关注 rmw_zenoh（非 DDS 的 Zenoh 协议）。
4. **迁移存量系统**：用 `ros1_bridge` 渐进切换，优先迁移核心驱动与算法层。

## 十、附录

### 10.1 版本时间线

**ROS 1**：Box Turtle（2010-03）→ C Turtle（2010-08）→ Diamondback（2011-03）→ Electric（2011-08）→ Fuerte（2012-04）→ Groovy（2012-12）→ Hydro（2013-09）→ **Indigo**（2014-07，LTS）→ Jade（2015-05）→ **Kinetic**（2016-05，LTS）→ Lunar（2017-05）→ **Melodic**（2018-05，LTS）→ **Noetic**（2020-05，LTS，EOL 2025-05-31）。

**ROS 2**：Ardent Apalone（2017-12-08）→ Bouncy Bolson（2018-07-02）→ Crystal Clemmys（2018-12-14）→ Dashing Diademata（2019-05-31）→ Eloquent Elusor（2019-11-22）→ Foxy Fitzroy（2020-06，LTS）→ Galactic Geochelone（2021-05）→ Humble Hawksbill（2022-05，LTS）→ Iron Irwini（2023-05）→ Jazzy Jalisco（2024-05，LTS）→ Kilted Kaiju（2025-05，非 LTS）→ **Lyrical Luth**（2026-05，LTS）。

### 10.2 术语表

| 术语 | 含义 |
|---|---|
| ROS Master / roscore | ROS 1 中央注册表 + 参数服务器，单点故障源 |
| DDS / RTPS | 数据分发服务标准及其线协议，ROS 2 通信底座 |
| rmw | ROS Middleware Interface，隔离 DDS 细节的纯 C 抽象接口 |
| QoS | Quality of Service，按话题配置的可靠性/持久性等策略 |
| Participant / DataWriter / DataReader | DDS 通信实体（对应 ROS 2 节点 / 发布者 / 订阅者）|
| type support | ROS 消息 ↔ DDS sample 的双向转换封装 |
| ament / colcon | ROS 2 的构建工具链，替代 catkin |
| nodelet / 组件 | 同进程共享地址空间的节点复用方式 |

### 10.3 参考文献

- Changes between ROS 1 and ROS 2：https://design.ros2.org/articles/changes.html
- ROS 2 middleware interface：https://design.ros2.org/articles/ros_middleware_interface.html
- ROS on DDS：https://design.ros2.org/articles/ros_on_dds.html
- QoS settings：https://design.ros2.org/articles/qos.html
- Release Schedule（官方发布计划）：https://docs.ros.org/en/rolling/The-ROS2-Project/Release-Schedule.html
- Noetic EOL 公告：https://www.ros.org/blog/noetic-eol/ 与 https://discourse.openrobotics.org/t/ros-noetic-end-of-life-may-31-2025/43160
- 版本生命周期数据库：https://endoflife.date/ros-2
