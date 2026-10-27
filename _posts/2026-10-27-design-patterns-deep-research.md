---
report: 66
title: 设计模式深度研究：GoF 23 模式、SOLID 原则与它们的选型边界
date: 2026-10-27
tags: [design-patterns, solid, gof, architecture, cpp]
summary: 从 GoF 原著、Refactoring Guru、Uncle Bob《Design Principles and Design Patterns》原文核验设计模式与 SOLID：23 模式三族全景、工厂/策略/观察者等场景实例（C++）、SOLID 五原则逐一，以及「原则是评判标准、模式是具体方案」的映射关系与选型边界。
math: false
---

设计模式是面向对象设计里「重复出现的问题的可复用解决方案」：它不给你代码，给你一套经过命名、可沟通、被验证的骨架。本文基于 GoF 原著（1994）、Refactoring Guru（现代权威参考）、Uncle Bob 2000 年论文《Design Principles and Design Patterns》一手核验：23 个经典模式的三族全景、工厂/策略/观察者等高频模式的 C++ 场景实例、SOLID 五原则逐一，以及「原则 vs 模式」的关系与选型边界。

## 一、结论先行

- **设计模式不是「套路」而是「词汇表」。** GoF 1994 年的《Design Patterns》把 Christopher Alexander 建筑学里的「模式语言」搬进软件，命名了 23 个模式，让工程师能用「这是一个工厂方法」六个字替代一段设计意图的描述。
- **23 个模式按「目的」分三族：创建型 5、结构型 7、行为型 11。** 一个常见口径偏差：Refactoring Guru 目录只列 22 个——它把行为型的**解释器（Interpreter）**当冷门模式剔除了；GoF 原著是 23 个，本文以 23 为准并标注。
- **SOLID 是「原则」，设计模式是「方案」，两者是「标准」与「实现」的关系。** SOLID 是 Robert C. Martin（Uncle Bob）2000 年论文提出、Michael Feathers 起名的五条类设计原则（SRP/OCP/LSP/ISP/DIP）；设计模式是这些原则的**具体落地**——Strategy/Decorator 兑现 OCP、Factory 兑现 DIP、继承类模式依赖 LSP 才成立。
- **最重要的一个判断：「模式不是目的，满足原则才是目的。」** 为了模式而模式（过度设计）比不用模式更糟；YAGNI 优先，模式是重构时的「语法」而非设计时的「目标」。
- **现代语境下很多模式被语言内建化了。** C++ 的 `std::function`/lambda 替代了 Strategy 类层级、范围 for 替代了 Iterator 模式、`std::variant` 消解了部分 Visitor；但「原则」不变——语言的糖只是把模式的样板代码藏进标准库。
- **选型边界一句话：** 行为会变 → Strategy/State；创建复杂 → Factory/Builder；想给对象加职责 → Decorator/Proxy；想统一一群子系统的入口 → Facade；想解耦「谁变化」→ Observer；想固定流程骨架 → Template Method。

## 二、认识：它是什么

### 血统：从建筑学到软件

| 项 | 事实 | 依据 |
|---|---|---|
| 源头 | Christopher Alexander《A Pattern Language》(1977)，建筑学「模式语言」 | Refactoring Guru history |
| 软件化 | Erich Gamma / Richard Helm / Ralph Johnson / John Vlissides 四人（Gang of Four，简称 GoF） | 原著 / Refactoring Guru |
| 时间 | 1994 年出版《Design Patterns: Elements of Reusable Object-Oriented Software》 | 原著 |
| 规模 | 23 个模式，分三族 | 原著 |
| 语言 | 原著用 Smalltalk + C++；现代参考（Refactoring Guru）给 10 种语言示例 | 原著 / Refactoring Guru |

GoF 原著的核心主张：**好的面向对象设计来自可复用的「协作关系」，而不是可复用的类**。一个模式描述的不是「某个类怎么实现」，而是「一组类如何协作解决一类反复出现的问题」。所以模式的关键是**命名**——把「用继承延迟对象创建的决定」「用组合让算法可插拔」这类意图压缩成一个词，团队沟通才有共同语言。

### 三族分类（按「目的」）

| 族 | 目的 | 数量 | 关键问句 |
|---|---|---|---|
| **创建型 Creational** | 对象创建机制，提高灵活性与复用 | 5 | 「谁、何时、如何创建对象？」 |
| **结构型 Structural** | 类与对象如何组合成更大的结构 | 7 | 「类和对象怎么组装才能既灵活又高效？」 |
| **行为型 Behavioral** | 算法与对象间的职责分配 | 11 | 「对象之间如何交互、职责怎么分？」 |

### 23 模式全景目录

**创建型（5）**

| 模式 | 意图（一句话） |
|---|---|
| 工厂方法 Factory Method | 父类定义创建接口，子类决定实例化哪个类（虚构造器） |
| 抽象工厂 Abstract Factory | 创建**一族相关**对象，而不指定具体类 |
| 单例 Singleton | 一个类只允许一个实例，并提供全局访问点 |
| 建造者 Builder | 分步构建复杂对象，让同一构建过程产出不同表示 |
| 原型 Prototype | 克隆已有对象，而非从头 `new`（免去昂贵初始化） |

**结构型（7）**

| 模式 | 意图 |
|---|---|
| 适配器 Adapter | 把一个接口转成客户端期望的另一个接口（插头转换器） |
| 桥接 Bridge | 把抽象与实现解耦，两者可独立变化 |
| 组合 Composite | 用树形结构统一「单个对象」与「对象组合」 |
| 装饰器 Decorator | 动态给对象叠加职责，不改变其接口 |
| 外观 Facade | 给复杂子系统提供一个统一简单入口 |
| 享元 Flyweight | 共享大量细粒度对象，省内存 |
| 代理 Proxy | 为对象提供替身，控制访问（懒加载/权限/缓存） |

**行为型（11）**

| 模式 | 意图 |
|---|---|
| 责任链 Chain of Responsibility | 把请求沿处理器链传递，直到有人处理 |
| 命令 Command | 把请求封装成对象（可排队/撤销/记录日志） |
| **解释器 Interpreter** | 定义文法并解释句子（GoF 有、Refactoring Guru 已剔除） |
| 迭代器 Iterator | 顺序遍历集合而不暴露内部结构 |
| 中介者 Mediator | 用中间对象协调多对象交互，消除网状依赖 |
| 备忘录 Memento | 捕获对象内部状态，支持回滚 |
| 观察者 Observer | 一对多依赖，状态变化自动通知所有订阅者 |
| 状态 State | 对象状态改变时行为随之改变（用状态类替代条件分支） |
| 策略 Strategy | 定义一族算法，各自封装，可互换 |
| 模板方法 Template Method | 固定算法骨架，子类填空可变的步骤 |
| 访问者 Visitor | 把算法从对象结构中分离出来，新增操作不改类 |

> 口径说明：GoF 原著 23 个；Refactoring Guru 目录列 22 个（剔除解释器 Interpreter，因其在现代工程里几乎不用）。本文目录按 GoF 23 个列全，解释器只在附录速查表出现，不展开。

## 三、实例：高频模式的 C++ 场景

> 代码用 C++11/14 惯用法，只给「意图 → 结构」的骨架，不写生产级完整实现。

### 创建型

**① 工厂方法 Factory Method**（别名「虚构造器」）

场景：物流系统要先只支持卡车，后来要加海运、空运，而主流程代码不能每次加一种交通工具就改一遍。

```cpp
class Transport {
public:
    virtual ~Transport() = default;
    virtual void deliver() = 0;            // 产品接口
};
class Truck : public Transport { void deliver() override { /*陆运*/ } };
class Ship  : public Transport { void deliver() override { /*海运*/ } };

class Logistics {                            // 创建者：核心业务逻辑只依赖抽象产品
public:
    virtual ~Logistics() = default;
    virtual std::unique_ptr<Transport> createTransport() = 0;   // 工厂方法
    void planDelivery() { auto t = createTransport(); t->deliver(); }
};
class RoadLogistics : public Logistics {
    std::unique_ptr<Transport> createTransport() override { return std::make_unique<Truck>(); }
};
class SeaLogistics : public Logistics {
    std::unique_ptr<Transport> createTransport() override { return std::make_unique<Ship>(); }
};
```

要点：**工厂方法把「创建」的决定推迟到子类**，父类的 `planDelivery` 不必知道 `Truck`/`Ship` 的存在。代价是每加一种产品都要加一个子类。

**② 抽象工厂 Abstract Factory**——与工厂方法的区别

工厂方法解决「**一种产品**」的多态创建；抽象工厂解决「**一族相关产品**」的一致创建——比如 UI 框架要保证 Windows 上按钮、复选框、输入框都是 Windows 风格，不能混搭。

```cpp
class Button   { public: virtual void render() = 0; virtual ~Button() = default; };
class Checkbox { public: virtual void render() = 0; virtual ~Checkbox() = default; };
class WinButton : public Button   { void render() override {} };
class MacCheckbox : public Checkbox { void render() override {} };

class GUIFactory {                          // 抽象工厂：一族产品的创建接口
public:
    virtual std::unique_ptr<Button>   createButton()   = 0;
    virtual std::unique_ptr<Checkbox> createCheckbox() = 0;
    virtual ~GUIFactory() = default;
};
class WinFactory : public GUIFactory {
    std::unique_ptr<Button>   createButton()   override { return std::make_unique<WinButton>(); }
    std::unique_ptr<Checkbox> createCheckbox() override { return std::make_unique<WinCheckbox>(); }
};
```

一句话分水岭：**工厂方法 = 单产品多态创建（用继承）；抽象工厂 = 一族相关产品的一致创建（用组合 + 多工厂方法）。**

**③ 单例 Singleton**

场景：进程内只应有一份的全局配置、日志器、线程池。

```cpp
class Config {
public:
    static Config& get() {           // C++11 起局部静态变量初始化线程安全
        static Config instance;      // Meyers' Singleton
        return instance;
    }
    Config(const Config&) = delete;
    Config& operator=(const Config&) = delete;
private:
    Config() = default;
};
```

要点：Meyers' Singleton 是 C++ 里唯一推荐的写法——懒加载、线程安全、无显式锁。但要警惕：单例本质是**全局可变状态**，破坏可测试性、隐藏依赖（详见 §9）。

**④ 建造者 Builder**

场景：HTTP 请求有 method/path/headers/body 一堆可选参数，构造函数参数爆炸。

```cpp
class HttpRequest {
    std::string method_, path_, body_;
    std::map<std::string, std::string> headers_;
    friend class Builder;
public:
    class Builder {
        std::string method_ = "GET", path_ = "/", body_;
        std::map<std::string, std::string> headers_;
    public:
        Builder& method(std::string m) { method_ = std::move(m); return *this; }
        Builder& header(std::string k, std::string v) { headers_[std::move(k)] = std::move(v); return *this; }
        HttpRequest build() &&;               // 末端 build，链式调用
    };
    static Builder builder() { return {}; }
};
```

要点：建造者把「构造步骤」与「最终表示」分离，链式调用可读性强，避免 `HttpRequest("GET", "/", {}, {}, true, false, ...)` 这种无意义参数位。

**⑤ 原型 Prototype**（目录级）：克隆已有对象替代 `new`，典型如「从原型细胞分裂」。现代 C++ 直接写拷贝构造/`clone()` 即可，模式感不强，不展开。

### 结构型

**⑥ 适配器 Adapter**

场景：接入一个遗留绘图库，它用「左上角 + 宽高」，你的接口用「两对角点」。

```cpp
class LegacyRectangle {                       // 不能改的第三方库
public: void draw(int x, int y, int w, int h) { /*...*/ }
};
class Shape {                                  // 你的目标接口
public:
    virtual void draw(int x1, int y1, int x2, int y2) = 0;
    virtual ~Shape() = default;
};
class RectangleAdapter : public Shape {        // 适配器：接口转换
    LegacyRectangle legacy_;
public:
    void draw(int x1, int y1, int x2, int y2) override {
        legacy_.draw(x1, y1, x2 - x1, y2 - y1);   // 对角点 → 左上角+宽高
    }
};
```

要点：适配器是**事后**的接口调和（两个已存在、不能改的接口之间架桥）。

**⑦ 装饰器 Decorator**

场景：文件数据源，要能一层层叠加「加密」「压缩」能力，且运行时按需组合。

```cpp
class DataSource {
public:
    virtual std::string read() = 0;
    virtual void write(std::string) = 0;
    virtual ~DataSource() = default;
};
class FileDataSource : public DataSource { /*读写文件*/ };

class DataSourceDecorator : public DataSource {   // 装饰器：与产品同接口，内部持有一个产品
protected:
    std::unique_ptr<DataSource> inner_;
public:
    explicit DataSourceDecorator(std::unique_ptr<DataSource> d) : inner_(std::move(d)) {}
};

class EncryptDecorator : public DataSourceDecorator {
public:
    using DataSourceDecorator::DataSourceDecorator;
    std::string read() override { return decrypt(inner_->read()); }
    void write(std::string s) override { inner_->write(encrypt(s)); }
};
// 使用：new EncryptDecorator(new CompressDecorator(new FileDataSource(...)))
```

要点：装饰器「给对象换皮肤」——**动态叠加职责，不改接口**；与策略的差别见 §9。

**⑧ 代理 Proxy**

场景：大对象懒加载、权限控制、远程对象本地替身、缓存。

```cpp
class Subject { public: virtual void request() = 0; virtual ~Subject() = default; };
class RealSubject : public Subject { void request() override { /*重活，昂贵*/ } };

class Proxy : public Subject {
    std::unique_ptr<RealSubject> real_;      // 延迟到真正需要才实例化
public:
    void request() override {
        if (!checkAccess()) return;          // 访问控制
        if (!real_) real_ = std::make_unique<RealSubject>();   // 懒加载
        real_->request();
    }
};
```

要点：代理与装饰器结构几乎一样（都包一层同接口对象），但**意图不同**：代理控制「访问」，装饰器叠加「职责」。

**⑨ 外观 Facade**（目录级）：给 `libcurl + OpenSSL + JSON 解析` 一坨子系统暴露一个 `downloadJson(url)` 入口。**外观是「减负」，适配器是「转换」**。

**⑩ 组合 Composite**（目录级）：文件系统的「目录 vs 文件」用同一 `FileNode` 接口递归处理。**统一「个体」与「组合」**，典型树形结构。

### 行为型

**⑪ 策略 Strategy**（用户点名）

场景：导航 App 的路线规划——开车、步行、公交、骑行，算法一族且要能运行时切换。

```cpp
class Strategy {                                // 策略接口
public:
    virtual int execute(int a, int b) = 0;
    virtual ~Strategy() = default;
};
class AddStrategy : public Strategy { int execute(int a, int b) override { return a + b; } };
class SubStrategy : public Strategy { int execute(int a, int b) override { return a - b; } };

class Context {                                  // 上下文：持有一个策略，按接口调用
    std::unique_ptr<Strategy> strategy_;
public:
    void setStrategy(std::unique_ptr<Strategy> s) { strategy_ = std::move(s); }
    int run(int a, int b) { return strategy_->execute(a, b); }
};
```

要点：策略「给对象换内核」——**把变化的部分（算法）从类里抽出去**，用组合替代继承，运行时可换。它是对 OCP 的直接兑现：新增算法不改 `Context`。**现代 C++ 里 `std::function<int(int,int)>` 常常就够用，不必建类层级**（见 §10）。

**⑫ 观察者 Observer**

场景：事件发布/订阅——数据变了，UI、日志、缓存等多个订阅者要自动收到通知。

```cpp
class Observer {
public:
    virtual void update(const std::string& msg) = 0;
    virtual ~Observer() = default;
};
class Subject {
    std::vector<std::weak_ptr<Observer>> obs_;   // weak_ptr 防悬垂/内存泄漏
public:
    void attach(std::shared_ptr<Observer> o) { obs_.push_back(o); }
    void notify(const std::string& msg) {
        for (auto& w : obs_)
            if (auto o = w.lock()) o->update(msg);
    }
};
```

要点：观察者解耦「谁变了」和「谁关心」。C++ 里**必须用 `weak_ptr`**，否则订阅者泄漏是经典坑（§9）。

**⑬ 模板方法 Template Method**

场景：棋类/扑克游戏流程骨架相同（初始化 → 循环走子 → 清理），具体步骤各异。

```cpp
class Game {
public:
    void play() {                        // 模板方法：固定骨架，不可被子类改
        initialize();
        while (!end()) makeMove();
        cleanup();
    }
protected:
    virtual void initialize() = 0;       // 子类填空可变步骤
    virtual bool end() = 0;
    virtual void makeMove() = 0;
    virtual void cleanup() = 0;
};
class Chess : public Game { /*实现四步*/ };
```

要点：模板方法「在类级别」固定算法骨架，用继承填空——静态；策略「在对象级别」交换整个算法，用组合——动态。**这是二者最本质的区别。**

**⑭ 命令 Command**（目录级）：把操作封装成对象，支持撤销/重做/任务队列。`CopyCommand` 持有 `Editor&`，`execute()` 调 `copy()`，`undo()` 回滚。

**⑮ 状态 State**（目录级）：订单的「待支付→已支付→已发货→已完成」用状态类替代巨型 `switch`。**State 与 Strategy 结构相同，区别在于：State 各状态之间知道彼此、能自行切换；Strategy 各策略互不相知。**

## 四、SOLID：五原则逐一

SOLID 是 **Robert C. Martin（Uncle Bob）** 在其 2000 年论文《Design Principles and Design Patterns》里系统化的「类设计原则」，缩写由 **Michael Feathers** 后来命名。其中 **LSP** 源自 **Barbara Liskov** 1987 年 OOPSLA 大会报告《Data Abstraction and Hierarchy》。Uncle Bob 的原始定义只有五条是「类设计」层面，另有一组**包（package）原则**（REP/CCP/CRP/ADP/SDP/SAP），常被忽略但同源。

| 缩写 | 原则 | 原始定义（Uncle Bob） |
|---|---|---|
| **SRP** | 单一职责 Single Responsibility | A class should have one, and only one, reason to change.（一个类只该有一个理由改变） |
| **OCP** | 开闭 Open/Closed | You should be able to extend a class's behavior, without modifying it.（扩展行为，而不修改它） |
| **LSP** | 里氏替换 Liskov Substitution | Derived classes must be substitutable for their base classes.（子类必须能替换父类） |
| **ISP** | 接口隔离 Interface Segregation | Make fine grained interfaces that are client specific.（做细粒度、面向特定客户端的接口） |
| **DIP** | 依赖倒置 Dependency Inversion | Depend on abstractions, not on concretions.（依赖抽象，不依赖具体） |

### 逐一拆解（违反示例 → 修正）

**SRP**：一个类干两件「会因不同理由而变」的事就是违反。典型反例：一个 `Report` 类既算数据又管打印格式——数据口径变了和打印排版变了是两个理由。修正：拆成 `ReportData`（算）+ `ReportFormatter`（排）。SRP 的「职责」=「改变的理由」，不是「做的事的数量」。

**OCP**：新增功能不该改既有代码。反例：每次加一种动物就进 `Zoo::feed` 加一个 `if (type == DOG)` 分支。修正：让 `Animal` 有 `eat()` 虚方法，新动物继承即可。**这是最需要「模式」来落地的一条**（见 §7）。

**LSP**：父类能用的地方，换子类进去行为不坏。经典反例：`Square` 继承 `Rectangle`，正方形改 `setWidth` 时 `setHeight` 也变，破坏了矩形「宽高独立」的契约。修正：**别让不满足 is-a 语义的类继承**；用组合或拆接口。

**ISP**：别让客户端依赖它用不到的接口。反例：一个 `Worker` 接口同时有 `work()` 和 `eat()`，机器人 `Robot` 被迫实现 `eat()` 空方法。修正：拆成 `Workable` 和 `Eatable` 两个细接口。

**DIP**：高层模块不该依赖低层模块，都该依赖抽象。反例：`NotificationService` 直接 `new EmailSender()`，换短信要改它。修正：构造函数注入 `std::unique_ptr<MessageSender>` 抽象，具体实现从外部传入。**DIP 是现代「依赖注入」的理论根基。**

## 五、SOLID 与设计模式的关系

**一句话：SOLID 是「评判标准」，设计模式是「具体方案」。** 原则告诉你「好设计长什么样」（目标函数），模式给你「怎么达到」的成熟套路（可行解）。两者不是并列的两个工具箱，而是**标准与实现**的关系——每一个经典模式几乎都是某条原则的具象化。

### 原则 ↔ 模式映射表

| 原则 | 直接兑现它的模式 | 机制 |
|---|---|---|
| **OCP** | 策略、装饰器、模板方法、访问者、工厂方法 | 通过「新增子类/策略」扩展而非「改现有类」 |
| **DIP** | 工厂方法、抽象工厂、依赖注入、策略、观察者 | 让代码依赖抽象接口，具体实现由外部注入 |
| **LSP** | 模板方法、工厂方法、装饰器、策略（一切基于继承/多态的） | 这些模式成立的前提就是子类可替换父类 |
| **SRP** | 外观、中介者、建造者、工厂方法 | 把「职责」拆到专门的类/入口，各管一件事 |
| **ISP** | 适配器、外观、代理 | 把宽接口切成客户端需要的窄接口 |

几个典型对应：

- **OCP → Strategy/Decorator**：Refactoring Guru 在 Strategy 的 Pros 里原话点明「Open/Closed Principle. You can introduce new strategies without having to change the context.」装饰器同理——加能力是「套一层新装饰器」，不是改旧类。
- **DIP → Factory/依赖注入**：工厂方法让 `Logistics` 依赖抽象 `Transport`，而非 `Truck`/`Ship`；依赖注入（DIP 的现代形式）把「选哪个实现」推到程序边界。
- **LSP → 一切继承类模式**：模板方法要求子类正确填空父类骨架，前提就是 LSP；违反了 LSP 的继承（Square→Rectangle），任何基于继承的模式都会崩。

### 关键结论：方向不能反

**原则是目的，模式是手段。** 工程师的思考顺序应当是「这里变化的是什么？用什么原则约束它？」，然后才「有没有现成模式正好解决」。反过来「这地方适合用个什么模式」就是**模式驱动设计**，是过度设计的根源（§8）。Refactoring Guru 的批评页说得直白：模式被滥用，正是因为人们把它当「积木」硬套，而不是当「出现了问题的信号」。

## 六、为什么这么设计（取舍）：模式的两面性

每个模式都有代价，配反面：

| 模式 | 换来的 | 牺牲的 | 反面案例 |
|---|---|---|---|
| 工厂方法 | 解耦创建与使用、OCP | 每加一产品要加一子类，类爆炸 | 只有两三种产品且几乎不变，直接 `new` 更清晰 |
| 抽象工厂 | 一族产品一致性 | 增加一层工厂抽象，改产品族要动工厂接口 | 只有一个平台/一族，工厂方法是更轻选择 |
| 单例 | 全局唯一访问点、懒加载 | 全局可变状态，破坏测试、隐藏依赖 | 依赖注入 + 单实例作用域更可控 |
| 装饰器 | 运行时任意叠加职责 | 大量小对象、调试难（嵌套难读） | 固定几种组合，用普通子类就行 |
| 策略 | 算法可插拔、OCP | 类数量增多、客户端要懂各策略差异 | 两三种算法且稳定，`if/else` 或 `std::function` 更轻 |
| 观察者 | 解耦发布/订阅 | 通知顺序不可控、易内存泄漏 | 只有一个订阅者，直接调用即可 |
| 模板方法 | 复用骨架、强制流程 | 继承耦合、子类被骨架束缚 | 骨架不稳定/各步组合灵活，用策略替代 |

**两条元原则：**

1. **YAGNI（You Aren't Gonna Need It）优先。** 模式是「重构出来的」，不是「预先设计出来的」——Kerievsky 的《Refactoring to Patterns》书名本身就是立场：先写简单代码，出现坏味道（重复、巨型条件分支、改一处牵一发动全身）时再**重构成**模式。
2. **组合优于继承。** GoF 原著开篇就主张「优先用对象组合而非类继承」。策略、装饰器、观察者全走组合路线，正因组合能在运行时变化、继承只能编译期定型。

## 七、实践与红线：常见坑

1. **单例 = 全局可变状态。** 它让单元测试彼此污染（状态残留）、隐藏类依赖（`Config::get()` 不体现在函数签名里）。红线的判据：**如果这个「单例」需要传不同实现做测试，它就不是真单例，该用依赖注入。**
2. **观察者必须用 `weak_ptr`。** Subject 持有订阅者的 `shared_ptr` 会造成循环引用/订阅者永不死；§3 的 `weak_ptr` 是 C++ 下的标准答案。
3. **装饰器 vs 代理 vs 适配器，长得像、意图不同。** 装饰器「加职责」、代理「控访问」、适配器「转接口」。结构相同不意味着是同一模式——Refactoring Guru 强调「模式不仅是代码结构，更是它**要解决的什么问题**」。
4. **策略 vs 模板方法：组合 vs 继承。** 策略在对象级运行时切换（灵活、但多类）；模板方法在类级编译期定型（简单、但死板）。骨架稳定选模板方法，算法要运行时换选策略。
5. **抽象工厂「接口冻结」。** 产品族要加一种新类型（比如 UI 要加「下拉框」），所有工厂子类都得改。抽象工厂适合「产品类型稳定、产品族会扩展」的场景，反之该退回工厂方法。
6. **依赖倒置 ≠ 依赖注入。** DIP 是原则（依赖抽象），DI 是兑现它的技术（构造器/Setter 注入）。混淆二者是常见口误。
7. **别硬套解释器（Interpreter）。** 连 Refactoring Guru 都把它从目录剔除了——现代工程里真正需要「定义文法并解释」的场景极窄，多数时候用正则、解析器生成器或手写递归下降更实在。

## 八、现代演进：模式被语言内建化

GoF 时代（Smalltalk/C++ 老语法）需要大量样板代码实现模式，现代 C++ 的糖直接消解了一批：

| 旧模式写法 | 现代 C++ 替代 | 说明 |
|---|---|---|
| Iterator 模式（自写迭代器类） | 范围 for + `begin()/end()` | 遍历语义进语言/标准库 |
| Strategy 类层级 | `std::function<int(int,int)>` + lambda | 单个算法变体用函数对象，不必建类 |
| Observer 手写 `Subject/Observer` | `std::function` 回调 / 信号槽（如 Qt signal-slot） | 订阅语义进框架 |
| Visitor 双分派样板 | `std::variant` + `std::visit` | 类型安全的并集替代继承式双分派 |
| Singleton 手写锁 | Meyers' Singleton（局部静态变量） | C++11 起线程安全，一行搞定 |
| Command 类层级 | `std::function` / lambda + 队列 | 简单命令用闭包 |

**但注意：原则没有过时，过时的只是样板代码。** 语言内建化改变的是「怎么表达」，不改变「为什么这样解耦」。`std::function` 替代 Strategy 类，恰恰还是 OCP 在起作用——新增一个 lambda 不改调用方。同理，函数式编程里的「高阶函数」本质就是策略模式的函数式表达。真正从「模式」里沉淀下来的，是那几条 SOLID 原则，以及「命名一个设计意图」的沟通价值。

## 九、附录

### 23 模式速查（意图 / 适用 / 反面）

| 模式 | 意图 | 何时用 | 何时别用 |
|---|---|---|---|
| 工厂方法 | 子类决定创建哪个类 | 事先不知对象确切类型 | 产品种类少且稳定 |
| 抽象工厂 | 创建一族相关对象 | 多产品族、需一致性 | 产品类型要频繁增加 |
| 单例 | 全局唯一实例 | 真·全局唯一（日志/配置） | 需要多实例测试/多实现 |
| 建造者 | 分步构建复杂对象 | 构造参数多、可选组合多 | 对象简单、参数少 |
| 原型 | 克隆而非新建 | 创建昂贵、要保初始态 | 对象状态简单、拷贝代价低 |
| 适配器 | 接口转换 | 接入不能改的遗留接口 | 接口还没定、可从头设计 |
| 桥接 | 抽象与实现解耦 | 抽象与实现都要独立扩展 | 变化维度只有一个 |
| 组合 | 统一个体与组合 | 树形结构、需递归处理 | 结构是扁平的 |
| 装饰器 | 动态叠加职责 | 运行时按需组合能力 | 组合固定且少 |
| 外观 | 统一简化入口 | 子系统复杂、客户端要简单 API | 客户端需要子系统精细控制 |
| 享元 | 共享细粒度对象 | 大量相似对象、内存吃紧 | 对象状态差异大、无法共享 |
| 代理 | 控制访问 | 懒加载/权限/远程/缓存 | 不需要额外控制、直接访问即可 |
| 责任链 | 请求沿链传递 | 多处理器、顺序不固定 | 处理器固定且就一个 |
| 命令 | 请求封装成对象 | 要撤销/重做/排队/日志 | 操作简单、无需回滚 |
| 解释器 | 定义并解释文法 | 真正的 DSL/表达式解析 | 绝大多数场景，用正则/递归下降 |
| 迭代器 | 遍历不暴露内部 | 要统一遍历不同容器 | 语言已有范围 for，不必手写 |
| 中介者 | 集中协调多对象 | 多对象网状交互、难以维护 | 对象间关系简单清晰 |
| 备忘录 | 捕获状态可回滚 | 要快照/撤销 | 状态小、直接拷贝即可 |
| 观察者 | 一对多自动通知 | 多订阅者、解耦发布订阅 | 只有一个消费者 |
| 状态 | 状态改变行为 | 对象状态多、行为随状态变 | 状态少、`switch` 可读 |
| 策略 | 算法一族可互换 | 算法多且要运行时切换 | 算法少而稳、`if/else` 更轻 |
| 模板方法 | 固定骨架子类填空 | 流程骨架稳定、步骤可变 | 骨架不稳定、需运行时组合 |
| 访问者 | 算法从结构分离 | 结构稳定、要频繁加新操作 | 结构常变、新增类型频繁 |

### SOLID 速查

- **SRP** 单一职责：一个类一个改变理由。
- **OCP** 开闭：扩展开放、修改关闭。
- **LSP** 里氏替换：子类可替换父类。
- **ISP** 接口隔离：客户端只依赖它要的接口。
- **DIP** 依赖倒置：依赖抽象不依赖具体。

> 补充：Uncle Bob 同源的**包原则**——REP（复用/发布等价）、CCP（共同闭包）、CRP（共同复用）、ADP（无环依赖）、SDP（稳定依赖）、SAP（稳定抽象）。

### 术语

- **GoF**：Gang of Four，指四位作者（Gamma/Helm/Johnson/Vlissides），也代指他们的书。
- **模式（Pattern）**：命名了的、可复用的常见问题解决方案。
- **原则（Principle）**：评判设计好坏的准则，不提供具体实现。
- **组合优于继承**：GoF 核心主张，运行时变化优先于编译期继承。

## 参考来源

- GoF 原著《Design Patterns: Elements of Reusable Object-Oriented Software》(1994)，四位作者与 23 模式（经 Refactoring Guru history 页交叉）
- Refactoring Guru：https://refactoring.guru/design-patterns（目录 / catalog / history / factory-method / strategy 各页）
- Uncle Bob 原文：http://butunclebob.com/ArticleS.UncleBob.PrinciplesOfOod（五条类原则 + 六条包原则原始定义）
- Robert C. Martin《Design Principles and Design Patterns》(2000)——SOLID 出处（Wikipedia SOLID 条目交叉）
- Michael Feathers 命名 SOLID 缩写（freecodecamp / Wikipedia 交叉）
- Barbara Liskov《Data Abstraction and Hierarchy》(OOPSLA 1987)——LSP 出处
- Wikipedia：SOLID、Software design pattern、Liskov substitution principle
