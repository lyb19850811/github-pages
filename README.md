# 研究日志(GitHub Pages)

用 GitHub Pages 管理日常研究产物:每篇研究一个文件、多标签归类、按标签筛选,支持长文(公式、图、参考文献)。纯静态、免费托管、git 版本化,每次 push 自动发布。

## 目标

- 每篇研究独立成文件:git diff 干净、逐篇编辑、可迁移。
- 一篇可打多个标签,按标签筛选浏览。
- 长文内容:公式、图、参考文献。
- 零后端、零运维成本。

## 架构

构建期 + 客户端两层:

- **构建期(Jekyll,GitHub Pages 原生)**:markdown → HTML;front matter 标签经 `site.tags` 自动聚合;产出每篇独立静态页、标签索引页、sitemap。
- **客户端(原生 JS)**:研究笔记页做多选标签筛选(AND 交集),即时无刷新。

数据流:

```
_posts/*.md (front matter + markdown 正文)
        │  Jekyll 构建
        ▼
静态 HTML(每篇正文 / 列表 / 标签索引 / sitemap)
        │  浏览器端 JS
        ▼
研究笔记页多选标签筛选(AND 交集)
```

### 目录结构

```
_config.yml          站点配置:标题/baseurl/permalink/默认布局/插件/exclude
_layouts/
  default.html       全站外壳:导航、SEO、按需加载 KaTeX
  research.html      研究正文模板(标题/日期/标签/正文)
_posts/              每篇研究一个 markdown 文件(核心内容)
index.html           首页(站点介绍 + 快速入口)
notes.html           研究笔记列表 + 标签筛选
games.html           小游戏合集(在线试玩链接)
tags.html            标签索引(构建期自动聚合:计数 + 分组 + 深链)
about.html           关于
404.html             404(noindex)
assets/
  js/filter.js       多选 AND 筛选逻辑
  images/            配图
style.css            全站样式
```

### 一篇研究的文件形态

```markdown
---
report: 你的唯一编号
title: 你的标题
date: 2026-10-16
tags: [nlp, evaluation]
summary: 一句话摘要(显示在列表页)
---

正文 markdown。
块级公式用 $$...$$;内联公式用 $...$。
图:![说明]({{ '/assets/images/xxx.svg' | relative_url }})
```

## 做了什么(关键实现)

1. **Jekyll 骨架**:`_config.yml` + `default`/`research` 两个布局,导航与 SEO 元信息统一到一处。
2. **每篇一文件**:内容放 `_posts/`,日期即文件名前缀,`permalink: /research/:slug/` 生成稳定独立 URL。
3. **标签聚合**:`site.tags` 构建期聚合,tags.html 展示全部标签 + 计数 + 分组,零手工索引。
4. **标签筛选**:研究笔记页每篇带 `data-tags`(JSON),filter.js 读 DOM 构建标签按钮并做多选 AND 筛选;`?tag=` 深链可分享可收藏。
5. **数学**:KaTeX 客户端渲染;kramdown 把块级 `$$` 转 `\[...\]`、内联 `$...$` 原样保留,KaTeX 分隔符同时兼容。
6. **SEO**:sitemap 由 `jekyll-sitemap` 自动生成,robots.txt 已指向;404 设 `noindex`。

## 为什么这么做(设计决策与权衡)

### 每篇一个文件,而不是单个 JSON

长文(公式、图、引用)用 markdown 每篇一文件:git diff 干净、可读、可移植、可单独编辑。单 JSON 只适合「链接 + 一两句摘要」的形态,长文会变成难以维护的一坨。产物是长文 → 选每篇一文件。

### Jekyll,而不是延续原有的「JSON + 纯 JS」方案

原站点是手写 HTML + products.json + 客户端 JS,没有构建层,导致:

- 标签索引要手工维护,篇数一多必漂移;
- 内容靠 JS 渲染,无独立 URL、无 SEO,无 JS 环境(抓取、搜索)看不到正文。

Jekyll 是 GitHub Pages 原生构建,无需 CI:`site.tags` 自动聚合解决标签管理痛点,markdown 免费转 HTML,每篇有独立静态页利于检索与分享。

### 用 `_posts`,而不是自定义 collection

`site.tags` 只聚合 posts、不聚合 collection。用 `_posts` 让标签聚合、日期排序、permalink 全部开箱即用。代价是文件名带日期前缀——对「按天记录研究」恰好合适。

### 筛选用客户端 JS,内容页用静态页(混合)

- 内容页(长文)= 静态 HTML:SEO、无 JS 可读、可分享、可抓取。
- 列表筛选 = 客户端 JS:多选即时、AND 交集,无需刷新。
- 为什么不做「每标签一个静态页」:需要 `jekyll-archives` 插件,不在 GitHub Pages 白名单内,得引入 Actions CI,复杂度不值。改用 tags.html(构建期静态标签索引)+ `?tag=` 深链兜底。

### 多选筛选语义 = AND(交集)

「筛选」的直觉是逐条件收窄,AND 更符合;默认 AND,再点取消。

### 数学用 KaTeX + kramdown 原生转换

- KaTeX 比 MathJax 轻、渲染快,适合静态站客户端渲染。
- kramdown 会把块级 `$$...$$` 转 `\[...\]`、内联 `$...$` 原样保留;KaTeX 分隔符同时配 `$$`/`\[`/`\(`/`$`,兼容不同 kramdown 版本行为,避免上线后公式不渲染。

### 标签治理约定

单一层级、小写 kebab-case(`machine-learning`),避免 `ML` / `machine learning` / `machine-learning` 发散成三个标签。当前无词表校验,篇数多后可加 GitHub Action 强校验。

### 编号治理约定

每篇研究报告的 front matter 带唯一整数 `report` 编号,**越早完成编号越小**,从 1 起永久递增、不复用、不因标题/日期/文件名变更而改变。编号 = 报告首次提交时间升序(同日提交内按完成先后细分);新增报告取「当前最大编号 + 1」。当前最大编号:17。

### 更新元数据约定

每篇研究报告需体现「最后更新时间」与「更新总次数」,通过 front matter 两个字段记录:

| 字段 | 类型 | 含义 | 何时填写 |
|---|---|---|---|
| `updated` | 日期 `YYYY-MM-DD` | 最后一次实质更新的日期 | 首次发布**可不填**;每次实质更新后改为当次更新日期 |
| `updates` | 整数 | 累计实质更新次数 | 首次发布**可不填**(默认视为 0);每次实质更新后 `+1` |

规则:

1. **首次发布**不写 `updated` / `updates`,页面不显示「更新于…」。
2. **每次实质更新**(补充/修正内容、新增章节等)后,`updates` 在原有基础上 `+1`,`updated` 改为当次更新日期。
3. 仅改错别字、格式等非实质改动,可不必计次(自行判断,但一旦计次则必须同步两个字段)。
4. 页面模板按 `{% if page.updated %}` 条件渲染,无 `updated` 字段的旧文档不受影响;有 `updated` 时显示「更新于 `updated` · 共 `updates` 次更新」。

示例(第二次实质更新后的 front matter):

```markdown
---
report: 5
title: 示例标题
date: 2026-10-16
updated: 2026-10-17
updates: 2
tags: [github-pages]
---
```

## 日常使用

1. 在 `_posts/` 新建 `YYYY-MM-DD-英文slug.md`。
2. front matter 填 `report / title / date / tags / summary`(`report` 为唯一编号,见下);有更新时补 `updated / updates`,见「更新元数据约定」。
3. 正文 markdown:公式 `$$`/`$`,图用 `relative_url` 引用,参考文献普通链接。
4. `git commit && git push`,GitHub Pages 自动构建发布。

## 验证

本地 Jekyll 构建通过;浏览器实测标签聚合/计数、多选 AND 筛选、`?tag=` 深链、KaTeX 数学渲染、SVG 配图加载均正常;线上部署后 sitemap、首页、正文数学输出与本地一致。
