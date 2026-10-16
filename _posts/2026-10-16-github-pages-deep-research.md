---
title: GitHub Pages 深度研究
date: 2026-10-16
tags: [github-pages, jekyll, static-site, hosting, deployment]
summary: 梳理 GitHub Pages 的定位、静态托管原理、两种发布源与 Jekyll 构建机制，以及配额、可见性、插件白名单等需要关注的点。
math: false
---

GitHub Pages 把 Git 仓库直接变成静态网站，零服务器、零运维。本文梳理其定位、原理、适用场景与边界。

## 结论先行

1. **本质是静态托管**：仓库里的 HTML/CSS/JS →（可选构建）→ CDN 发布，服务器端不执行任何代码。
2. **两种站点类型**：用户/组织站（`<owner>.github.io`，每账号 1 个）与项目站（`<owner>.github.io/<repo>`，每仓库 1 个）。
3. **两种发布源**：分支发布（Jekyll 服务端构建，受插件白名单约束）与 Actions 工作流（任意静态站点生成器）。
4. **天花板在三处**：配额（1 GB 站点 / 100 GB 月带宽 / 10 分钟构建）、插件白名单、无后端。

## 定位与站点类型

官方定位：把仓库里的 HTML/CSS/JS 直接拿来（可选经过一次构建），发布成公开网站，**无需单独租服务器**。免费、git 版本化、push 即发布、自带 HTTPS、可绑自定义域名。

| 属性 | 用户/组织站 | 项目站 |
|---|---|---|
| 源码位置 | 必须放在名为 `<owner>.github.io` 的仓库 | 仓库根目录或 `/docs` 文件夹 |
| 数量限制 | 每个账号 1 个 | 每个仓库 1 个 |
| 默认地址 | `https://<owner>.github.io` | `https://<owner>.github.io/<reponame>` |

> 本项目即**项目站**：仓库名 `github-pages`，故 `baseurl: /github-pages`，最终地址 `lyb19850811.github.io/github-pages/`。

## 原理

纯静态、无后端。链路：

```text
仓库文件（源码）
   →（可选）构建：Jekyll / 任意静态站点生成器 / 直接静态文件
   → 发布到 GitHub 静态托管（经 CDN）
   → 浏览器访问 *.github.io 或自定义域名
```

服务器端**不执行任何代码**——无 PHP/数据库/鉴权/表单处理，动态能力只能靠浏览器端 JS 或第三方服务。

### 两种发布源

| 发布源 | 机制 | 适用 |
|---|---|---|
| **分支发布** | push 到源分支（根目录或 `/docs`）→ GitHub 服务端跑 Jekyll 构建 → 发布；`.nojekyll` 文件可跳过构建 | 零配置、开箱即用 |
| **Actions 工作流** | `checkout` → 构建（任意 SSG）→ `upload-pages-artifact` → `deploy-pages` | 非 Jekyll 构建、任意插件、部署预览 |

细节：

- 即使是分支发布，内部也**包装成一次 Actions 运行**；`GITHUB_TOKEN` 触发的 push 不会再次触发构建。
- **Jekyll**：Markdown + Liquid → 静态 HTML；front matter 定义元数据；`site.tags` 构建期自动聚合。
- **插件白名单**：分支发布只能用 GitHub 白名单内插件（版本固定，见 `pages.github.com/versions.json`）；白名单外的插件（如 `jekyll-archives`）只能本地构建 + Actions 发布。
- **配置强制锁定**：`lsi: false`、`safe: true`、`incremental: false` 等不可改。

## 适用场景

**适合**（静态、可版本化、低动态）：

- 个人博客 / 研究笔记 / 技术文档
- 开源项目主页、landing page
- 作品集、简历、课程页面
- 内容靠 git 管理、需 PR 评审的场景

**不适合**（官方明确排除）：

- 电商、SaaS、在线业务
- 涉及敏感交易的站点（传密码、信用卡号）
- 需要服务端逻辑的一切：登录鉴权、数据库、表单落库、定时任务
- 高流量商业站点

## 需要关注的点

| 方面 | 要点 |
|---|---|
| **配额** | 源仓库建议 ≤ 1 GB；发布站点 ≤ 1 GB；构建 10 分钟超时；**软性**带宽 100 GB/月；**软性** 10 次构建/小时（Actions 发布不受此限）；超限返回 `429` |
| **可见性** | 站点**始终公网可见**，即使仓库私有（付费方案）；敏感数据须发布前删除 |
| **插件白名单** | 分支发布仅限白名单插件，超出需 Actions 发布 |
| **自定义域名** | 支持 apex/subdomain，DNS 记录不同；**必须验证域名**防 takeover；`CNAME` 文件不会自动加域名 |
| **本地测试** | 用 `github-pages` gem 对齐线上依赖版本（`versions.json`），避免「本地能跑、线上失败」；Jekyll 官方不支持 Windows |
| **无后端** | 评论/表单/搜索/统计需外挂第三方（Giscus、Formspree、Algolia 等） |
| **项目站 baseurl** | `url` + `baseurl` 拼接必须正确，否则 sitemap 与深链全错 |
| **替代方案** | Netlify / Vercel / Cloudflare Pages：构建分钟宽松、插件任意、edge functions、部署预览完善 |

**迁移信号**：命中构建超时/带宽上限、需要非白名单插件又不想维护 Actions、需要服务端函数或私有访问控制时，就该考虑离开 GitHub Pages。

## 参考

- [What is GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [About GitHub Pages and Jekyll](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll)
- [About custom domains and GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages)
