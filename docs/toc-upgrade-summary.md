# 文章目录（TOC）语雀式升级 — 复盘文档

> 项目：`lyb19850811/github-pages`（Jekyll 静态站）
> 时间：2026-10-17
> 涉及文件：`_layouts/research.html`、`_layouts/default.html`、`assets/js/article.js`、`style.css`

---

## 1. 创造过程（时间线）

| 阶段 | 内容 | 关键决策 |
|---|---|---|
| ① 初版升级 | 平滑滚动 + 防遮挡 + 高亮重写 + 移动端 FAB | 左侧正文/右侧目录的 Grid 布局；`scrollIntoView` 平滑滚动；用滚动事件 + 位置区间替代 `IntersectionObserver` |
| ② 对齐语雀 | 用户指出 3 个差距：数字层级重复、不能折叠、不能隐藏 | 放弃 `<ol>` 改为树形 `<ul>`；引入父子层级、折叠、面板隐藏 |
| ③ 目录移出 article | 用户要求目录贴屏幕右侧 | 目录从 `article` 内移到 `<main>` 层，`position: fixed` 贴右缘 |
| ④ 定位修正 | 目录顶到导航栏 | 引入 `--nav-h` / `--toc-top` CSS 变量统一顶部偏移 |
| ⑤ 交互增强 | 折叠/展开单按钮、默认折叠、默认显示、起始位置下移 | 合并按钮；叶子节点不参与折叠判定 |
| ⑥ Bug 修复 | 「展开」无反应 | 折叠判定误把叶子节点算作展开项 |
| ⑦ 视觉提示 | 隐藏后右缘提示条 | 竖排「目录」标签 + 主题色 + 悬停加宽 |
| ⑧ 发布 | 提交 `8ef4abb` 推送 main | GitHub Pages 自动部署 |

---

## 2. 目录（功能清单）

最终交付的 TOC 具备以下能力：

1. **树形结构**：`h2` 为父节点、`h3` 为子节点，层级缩进表达。
2. **子级折叠/展开**：每个含子级的节点有箭头 `▸/▾`，点击切换。
3. **整体折叠/展开**：头部单按钮，文案随状态在「展开/折叠」间切换。
4. **默认折叠**：目录内容初始只显示 h2 层级，h3 收起。
5. **面板隐藏/恢复**：桌面端隐藏后缩到窗口右缘，露出提示条。
6. **右缘提示条**：隐藏后右缘出现竖排「目录」标签，悬停展开目录。
7. **移动端浮层 + FAB**：≤768px 用底部浮层 + 右下角悬浮按钮。
8. **平滑滚动**：点击目录项 `scrollIntoView({ behavior: 'smooth' })`。
9. **防遮挡**：`scroll-margin-top` 预留顶部空间。
10. **滚动高亮**：滚动监听 + 位置区间判定当前章节，高亮项自动滚入目录可视区。
11. **自动展开父级**：高亮到被折叠的子项时，自动展开其父级。

---

## 3. 问题与解决方案

### 3.1 数字层级重复
- **现象**：目录显示成 `1. 1. 它是什么`、`2. 1.1 …`。
- **根因**：目录用 `<ol>` 生成，而 CSS 未 `list-style: none`，浏览器自动加序号；文章标题又自带编号。
- **解决**：`<ol>` → `<ul>` + `list-style: none`，只显示标题原文。

### 3.2 不能折叠 / 不能隐藏
- **根因**：初版是扁平列表，无树形结构，无隐藏入口。
- **解决**：构建 h2/h3 父子树；头部增加折叠、隐藏按钮。

### 3.3 目录顶到导航栏
- **根因**：`position: fixed; top: 1.5rem` 相对视口，未让开导航栏高度。
- **解决**：引入 `--nav-h` / `--toc-top` 变量，目录从标题下方开始。

### 3.4 「展开」按钮无反应（Bug）
- **根因**：用 `li.toc-node:not(.collapsed)` 判断是否有展开项，但叶子节点（无子级）从不带 `.collapsed`，导致判定恒为「有展开项」，按钮永远执行折叠。
- **解决**：收窄判定范围到「含 `.toc-arrow` 的可折叠节点」：
  ```js
  var anyExpanded = toc.querySelector('li.toc-node:not(.collapsed) > .toc-row > button.toc-arrow');
  ```

### 3.5 高亮项滚动抖动
- **根因**：每次 `scroll` 都执行 `scrollIntoView({ block:'nearest' })`。
- **解决**：仅在当前高亮项变化时触发一次。

---

## 4. 实现方案（技术要点）

### 4.1 目录构建（`article.js`）
- 遍历 `.content` 内 `h2, h3`，按 `h2` 分组构建树（`roots` / `current`）。
- 无 `id` 的标题自动生成 `sec-N-xxxx`。
- 递归 `renderNode` 生成嵌套 HTML，含子级的节点默认带 `collapsed`。

### 4.2 高亮（滚动监听）
```js
var threshold = 100;
function highlight() {
  var active = headings[0];
  for (var i = 0; i < headings.length; i++) {
    if (headings[i].getBoundingClientRect().top <= threshold) active = headings[i];
  }
  // 到底部强制高亮最后一项
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
    active = headings[headings.length - 1];
  }
  // ...
}
window.addEventListener('scroll', highlight, { passive: true });
```

### 4.3 桌面端定位（`style.css`）
- `.toc { position: fixed; top: var(--toc-top); right: 1.5rem; width: 220px; }`
- 隐藏态用 `translateX(calc(100% + 1.5rem))` 滑出，而非 `display:none`，保留过渡动画。
- 右缘提示条 `.toc-tab`：`writing-mode: vertical-rl` 竖排文字。

### 4.4 响应式
- 桌面端（>768px）：右侧固定目录 + 右缘提示条悬停恢复。
- 移动端（≤768px）：底部浮层 + 悬浮按钮（FAB）。

### 4.5 状态管理
- 状态类统一挂 `document.body`：`toc-hidden`（桌面隐藏）、`toc-open`（移动端浮层展开）。
- 目录在 `article` 之外，与正文布局解耦。

---

## 5. 是否可复用

**可复用，且复用成本低。**

- `article.js` 的 TOC 逻辑与站点内容结构弱耦合，仅依赖：
  - 一个 `#toc` 容器
  - 一个 `.content` 正文容器
  - 正文内 `h2` / `h3` 标题
  - 可选的 `#toc-tab`、`#toc-fab` 元素
- CSS 类名全部用 `toc-*` 前缀，命名独立，不与其他样式冲突。
- 无第三方依赖，纯原生 JS + CSS。

**不可直接复用的部分**：`research.html` 里的 Liquid 模板（Jekyll 专用）需按目标框架替换为对应模板语法。

---

## 6. 如何复用

### 6.1 最小接入步骤

1. **HTML 骨架**（放在正文容器之外）：
   ```html
   <aside class="toc" id="toc"></aside>
   <div class="toc-tab" id="toc-tab"></div>
   <button class="toc-fab" id="toc-fab">目录</button>
   <div class="content"><!-- 正文 h2/h3 --></div>
   ```

2. **引入脚本**：加载 `article.js`（去掉文件头部的「复制链接」「返回顶部」两个与 TOC 无关的模块，或保留按需适配）。

3. **引入样式**：复制 `style.css` 中 `--nav-h` / `--toc-top` 变量与全部 `.toc-*` 规则。

4. **调参**：按目标站点的导航高度、正文宽度调整 `--nav-h`、`--toc-top`、`.toc` 的 `width`、断点 `768px`。

### 6.2 适配要点
- 标题层级：当前只处理 h2/h3。若需 h4，扩展 `querySelectorAll('h2, h3, h4')` 并调整树构建的分组规则（h3 变为中间层）。
- 主题色：`.toc-tab`、`.toc-fab`、`.toc-link.active` 均用 `var(--accent)`，替换主题色变量即可换肤。

---

## 7. 是否可落成 Skill

**可以，且建议落地为一个可复用 Skill**，价值在于：将「语雀式 TOC」这套经过多轮打磨的交互范式沉淀为可一键接入的模板。

建议 Skill 形态：

- **名称**：`toc-yuque-style`（语雀式文章目录）
- **触发场景**：用户要求「给文章/博客加目录」「升级 TOC」「做侧边目录」等。
- **Skill 内容**：
  1. 一套 HTML 骨架模板（含 `#toc` / `.toc-tab` / `.toc-fab` / `.content`）。
  2. 一份完整 `article.js`（TOC 模块，已剥离站点无关代码）。
  3. 一份完整 `toc.css`（含 CSS 变量，便于换肤调参）。
  4. 一份接入说明（含参数表：标题层级、断点、颜色、顶部偏移）。
- **优势**：未来在其他静态站（Jekyll/Hugo/Hexo 或纯 HTML）接入时，只需改骨架 + 调变量，无需重写逻辑。

> 注：落成 Skill 需将当前散落在 `style.css` / `article.js` 的代码抽离为独立、自包含的文件，并补充参数化说明。

---

## 8. 后续优化方向

1. **折叠/隐藏状态持久化**：用 `localStorage` 记住用户偏好，跨页面/跨会话保持。
2. **更多标题层级**：支持 h4，形成三级树。
3. **目录项计数徽标**：在 h2 后显示子项数量。
4. **目录搜索/过滤**：标题过多时支持关键词过滤。
5. **阅读进度条**：结合滚动高亮，显示文章阅读进度。
6. **触屏优化**：移动端提示条改为可点按、支持手势（当前依赖 hover，触屏体验一般）。
7. **暗色主题**：通过 CSS 变量自动适配 `prefers-color-scheme`。
8. **无障碍增强**：目录项补 `aria-current`，箭头补完整 `aria-label` 语义。
9. **目录栏宽度自适应**：按标题长度/视口宽度动态调整，避免长标题换行挤压。
10. **性能**：`highlight` 中的 `getBoundingClientRect` 可做节流（`requestAnimationFrame`），减少大量标题时的布局抖动。

---

## 附：关键文件与职责

| 文件 | 职责 |
|---|---|
| `_layouts/research.html` | 文章页骨架，放置 `#toc` / `#toc-tab` / `#toc-fab` |
| `_layouts/default.html` | 全站 `<body>` / `<nav>` 外壳 |
| `assets/js/article.js` | TOC 构建、折叠、隐藏、高亮、平滑滚动逻辑 |
| `style.css` | `.toc-*` 样式、CSS 变量、响应式断点 |
