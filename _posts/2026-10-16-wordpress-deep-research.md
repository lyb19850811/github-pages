---
title: WordPress 深度研究
date: 2026-10-16
tags: [wordpress, php, architecture, database, rest-api, security, deployment]
summary: 基于 WordPress 核心源码逐文件溯源，梳理架构、请求生命周期、数据模型、数据库、REST API、认证安全与部署运维的完整脉络。
math: false
---

WordPress 的源码是一份「为了 20 年不迁移 schema、不改核心地装 6 万个插件」而刻意做出的工程取舍样本。本文基于核心源码（trunk，`$wp_version = '7.2-alpha-64353'`）逐文件溯源，并结合实际部署（Docker/ECS 与共享主机两条路线）交叉验证。

## 结论先行

1. **核心抽象只有两个**：内容是「一切皆 post」（`wp_posts` 单表 + `post_type` 区分），配置是「键值对」（`wp_options`）。其余表都是这两张表的附属。
2. **扩展机制是一个发布/订阅事件系统**：`add_action`/`add_filter` 注册回调到 `WP_Hook`，`do_action`/`apply_filters` 按优先级触发。主题、插件、mu-plugins、核心内部全是这套机制的消费者。
3. **远程自动化不依赖 SSH**：WordPress 自带 REST API（`/wp-json/wp/v2/*`）+ 应用密码（WP 5.6+）即可完成增删改。
4. **数据模型是「为稳定与可扩展性牺牲关系规范性」的产物**：用 EAV + 单表多态 + 键值配置换来了 20 年不迁移 schema 的能力。

> **说明**：本文「文件:行号」均相对 WordPress 核心仓库根目录。

## 架构

### 四层结构

![WordPress 四层架构]({{ '/assets/images/wordpress-architecture.svg' | relative_url }})

`index.php` 是唯一前端入口（Front Controller），向下经引导层初始化运行时，再分流到后台、核心运行时与用户层三个目录。

### 关键特征

1. **Front Controller 单入口**：所有非静态请求被 rewrite 到 `index.php`（pretty permalink 由 `$wp_rewrite` 生成规则，Apache 写 `.htaccess`、Nginx 用 `try_files`）。
2. **事件驱动扩展**：`WP_Hook`（`class-wp-hook.php`）+ `add_action`/`add_filter`/`do_action`/`apply_filters`。核心、主题、插件全是平等参与者——这是「装 6 万个插件也不改核心」的架构根因。
3. **非 MVC**：是「过程式 + 少量 OOP 类 + 模板层级」的混合体。没有统一 Controller/Model 分离；`WP_Query` 是事实上的「模型」，模板文件是「视图」。

### 核心子系统

| 子系统 | 实现文件 | 职责 |
|---|---|---|
| 查询引擎 | `class-wp-query.php` | 把 URL 查询变量翻译成 SQL，主循环 |
| 数据库层 | `class-wpdb.php` | `$wpdb` 全局单例，`prepare()`/CRUD |
| 事件系统 | `plugin.php` + `class-wp-hook.php` | action / filter |
| REST API | `rest-api.php` + `rest-api/` | `/wp-json/` 路由 |
| 重写 | `class-wp-rewrite.php` | pretty permalink |
| 角色能力 | `capabilities.php` | `current_user_can` / `map_meta_cap` |
| 缓存 | `class-wp-object-cache.php` + `cache.php` | 对象缓存 + transients |
| 定时任务 | `cron.php` | 伪 Cron（访问触发，非系统 crontab） |
| 认证 | `user.php` + `pluggable.php` | 登录、应用密码、nonce |

## 请求生命周期

```text
HTTP 请求（非静态资源）
        │  rewrite → index.php（Front Controller）
        ▼
index.php  →  wp-blog-header.php
                ├─ require wp-load.php → wp-settings.php
                │    · 初始化 $wpdb / $wp / $wp_query / $wp_rewrite
                │    · 加载 mu-plugins → plugins → theme functions.php
                │    · 依次触发 muplugins_loaded / plugins_loaded /
                │      setup_theme / after_setup_theme / init / wp_loaded
                ├─ wp()  主查询：parse_request → query_posts → handle_404
                └─ require template-loader.php → 选模板 → 输出 HTML
```

> **说明**：**事件时序**：`mu-plugins_loaded` → `plugins_loaded` → `setup_theme` → `after_setup_theme` → `init` → `wp_loaded`，之后才是 `wp()` 主查询与模板输出。插件/主题就是靠这些时机点挂自己的逻辑。

关键源码锚点：

- `wp-blog-header.php` 只做三件事：`require wp-load.php` → `wp()` → `require template-loader.php`。
- 主查询引擎是 `WP_Query`（`class-wp-query.php`），由 `$wp`（`class-wp.php`）驱动。
- 模板选择在 `template-loader.php:114`，通过 `apply_filters( 'template_include', $template )` 允许覆盖。

## 内容模型：一切皆 post

页面、文章、附件、菜单项、修订、自定义 CSS、自定义文章类型（CPT）**全部存 `wp_posts` 一张表**，用 `post_type` 与 `post_status` 区分。

| post_type | 含义 |
|---|---|
| `page` | 页面 |
| `post` | 博客文章 |
| `attachment` | 附件 |
| `nav_menu_item` | 导航菜单项 |
| `revision` | 修订版（`post_status=inherit`，`post_parent` 指向原稿） |
| `custom_css` | 「外观 → 额外 CSS」 |
| `wpforms` | WPForms 表单定义（第三方 CPT） |

### 分类系统（3+1 张表）

- `wp_terms`：词条本体（名字、slug）。
- `wp_term_taxonomy`：词条属于哪种分类法（`category`/`tag`/`nav_menu`）+ 计数。**一个 term 可同时是 category 又是 nav_menu**。
- `wp_term_relationships`：内容与词条的多对多关联（`object_id` ↔ `term_taxonomy_id`）。
- `wp_termmeta`：词条元数据。

菜单 = 「两系统叠加」：菜单本身是 `nav_menu` 分类法，菜单项是 `nav_menu_item` 类型的 post，通过 `term_relationships` 挂到菜单上。

### Gutenberg 区块格式

正文以「区块序列化 HTML」存储：

```html
<!-- wp:group {"align":"full","className":"aurion-hero"} -->
<div class="wp-block-group alignfull aurion-hero">…</div>
<!-- /wp:group -->
```

既是可读 HTML，又能被块解析器（`class-wp-block-parser.php`）还原回可视化编辑器；REST API 导入后后台仍可编辑。

## 数据模型与设计理由

### 四大设计支柱

**支柱一 · 单表多态**：`wp_posts` 23 个固定列承载所有内容类型，`post_type` 列做类型判别。注册 CPT 只需 `register_post_type()`，**零 schema 变更**。

**支柱二 · EAV 元数据**：`wp_postmeta`/`wp_usermeta`/`wp_termmeta`/`wp_commentmeta` 统一为 `(entity_id, meta_key, meta_value)` 键值对，插件可挂任意字段而不改表。

**支柱三 · 分类拆表**：`terms` 与 `term_taxonomy` 分离，让「分类法类型」成为关联属性而非词条属性；`count` 反范式缓存避免每次 `COUNT(*)`。

**支柱四 · 键值配置**：`wp_options` 存全站配置（`active_plugins` 是序列化数组）；用户/评论独立成表但仍带 meta 表复用 EAV。

### 为什么这么设计：四个深层约束

| 约束 | 导致的设计 |
|---|---|
| **Schema 二十年稳定** | 核心升级永不破坏性迁移；单表 + EAV + 反范式缓存让表结构长期不变 |
| **扩展优先（6 万插件生态）** | CPT / option / meta / hook 四把钥匙，扩展不改核心表 |
| **共享主机友好** | 无外键、无触发器、无复杂类型；DB 直连不可用时配 REST API + 应用密码 |
| **PHP 序列化向后兼容** | 复合值用 `serialize()`，跨版本可读——代价是 URL 迁移必须 `wp search-replace` 而非 SQL `REPLACE` |

### 代价与已知痛点

- **无外键 → 孤儿数据**：删文章不自动删 meta/关系，靠 `wp_delete_post` 应用层清理，历史遗留垃圾靠插件清扫。
- **EAV 查询慢**：`meta_value` 无类型、无强索引，复杂 `meta_query` 是性能重灾区。
- **`serialize()` 不可搜索**：序列化数组无法被 SQL 语义查询，只能整体取出反序列化。
- **`guid` 命名误导**：存的是「原始 URL」而非全局唯一 ID（官方明示不要当唯一键用）。
- **`count` 反范式**：`wp_term_taxonomy.count` 需 hooks 手动同步。

> **关键结论**：WordPress 的数据模型是「为稳定与可扩展性牺牲关系规范性」的产物——用 EAV + 单表多态 + 键值配置换来了 20 年不迁移 schema 的能力，这正是它能承载庞大插件生态、并让非技术用户在自己服务器上长期自维护的根本原因。

## 数据库

引擎 MySQL / MariaDB；表前缀 `wp_`（`wp-config.php` 的 `$table_prefix`）。核心表 = **单站点 12 张 + 多站点全局 6 张 = 18 张基础表**（源码 `wp-admin/includes/schema.php`）。

### 12 张单站点表

| 分组 | 表 | 职责 |
|---|---|---|
| 内容 | `wp_posts` | **中心表** |
| 内容 | `wp_postmeta` | 文章键值元数据 |
| 分类 | `wp_terms` / `wp_term_taxonomy` / `wp_term_relationships` / `wp_termmeta` | 词条 + 类型 + 关联 + 元数据 |
| 配置 | `wp_options` | 全站键值配置 |
| 用户 | `wp_users` / `wp_usermeta` | 用户 + 元数据（含能力、应用密码） |
| 评论 | `wp_comments` / `wp_commentmeta` | 评论 + 元数据 |
| 遗留 | `wp_links` | 友情链接（已废弃） |

6 张多站点全局表（`$ms_global_tables`）：`wp_blogs` / `wp_blogmeta` / `wp_site` / `wp_sitemeta` / `wp_signups` / `wp_registration_log`。

### 实体关系

| 主表 | 关联表 | 关联键 |
|---|---|---|
| `wp_posts` | `wp_postmeta` | `post_id` |
| `wp_posts` | `wp_comments` | `comment_post_ID` |
| `wp_posts` | `wp_term_relationships` | `object_id` |
| `wp_term_taxonomy` | `wp_term_relationships` | `term_taxonomy_id` |
| `wp_terms` | `wp_term_taxonomy` | `term_id` |
| `wp_terms` | `wp_termmeta` | `term_id` |
| `wp_users` | `wp_posts` | `post_author` |
| `wp_users` | `wp_usermeta` | `user_id` |
| `wp_comments` | `wp_commentmeta` | `comment_id` |

> **注意**：**没有外键**。核心建表语句里没有任何 `FOREIGN KEY` 约束——参照完整性完全由应用层（`$wpdb` + 清理逻辑）维护。这是刻意的：升级时不触发 ALTER FK 连锁问题，并兼容最廉价的 MySQL 版本。

## REST API

URL 前缀 `/wp-json/`；核心命名空间 `wp/v2`，WooCommerce 为 `wc/v3`。路由在 `rest_api_init` 动作上注册：

- `default-filters.php:550`：`add_action('init', 'rest_api_init')`
- `default-filters.php:554`：优先级 99 挂 `create_initial_rest_routes`（定义于 `rest-api.php:265`）
- `/wp-json/…` 经重写映射为 `index.php?rest_route=…`，由 `rest_api_loaded()`（`rest-api.php:448`，挂载于 `parse_request`）用 `rest_get_server()->serve_request()` 派发。

### 认证方式对比

| 方式 | 端点 | 凭据 | 场景 |
|---|---|---|---|
| Cookie（已登录会话） | 所有 | session cookie + nonce | 浏览器内 fetch |
| **应用密码（Basic Auth）** | `wp/v2` | `用户名:应用密码` | 脚本/CI 无 SSH 场景 |
| WooCommerce Basic Auth | `wc/v3` | `ck_…:cs_…`（consumer key/secret，HTTPS 下） | 产品管理 |
| WooCommerce OAuth 1.0a | `wc/v3` | 签名请求 | 非 HTTPS 时 |

### 权限模型

每条路由注册时带 `permission_callback`，默认检查 `current_user_can()`。应用密码继承所属用户角色：用管理员账号开应用密码即能增删改全部内容。菜单端点（`menu-items`）要求 WP 5.9+。

### 案例：无第三方依赖的 REST 客户端

脚本用标准库 `urllib` 直接发 REST 请求：

```python
# request(): 按 auth_type 选 Basic Auth 头（wp → 应用密码，wc → consumer key/secret）
def request(cfg, path, method="GET", data=None, auth_type="wp"):
    url = cfg["WP_URL"].rstrip("/") + path
    if auth_type == "wp":
        headers["Authorization"] = basic_auth(cfg["WP_USER"], cfg["WP_APP_PASSWORD"])
    else:  # wc
        headers["Authorization"] = basic_auth(cfg["WC_CONSUMER_KEY"], cfg["WC_CONSUMER_SECRET"])
```

| 资源 | 端点 |
|---|---|
| 页面 | `/wp-json/wp/v2/pages` |
| 文章 | `/wp-json/wp/v2/posts` |
| 菜单 | `/wp-json/wp/v2/menus` + `/wp-json/wp/v2/menu-items` |
| 产品 | `/wp-json/wc/v3/products`（`auth_type="wc"`） |

## 认证与安全

### 应用密码

WP 5.6+ 内置。实现集中 `class-wp-application-passwords.php`：

- 存储：哈希后存用户元数据 `_application_passwords`（常量 `USERMETA_KEY_APPLICATION_PASSWORDS`，第 24 行）。
- 认证：`wp_authenticate_application_password()`（`user.php:372`）在普通密码失败后兜底尝试。
- 特性：每用户多条、每条可单独吊销、生成时明文只显示一次。

### Nonce

`wp_create_nonce`/`wp_verify_nonce`/`check_admin_referer`（`pluggable.php`）、`wp_nonce_field`（`functions.php`）。绑定「用户 + 动作 + 会话令牌」，默认 12–24 小时过期，用于表单/URL 防 CSRF。

### 角色与能力

`capabilities.php` 定义 `WP_Roles`/`current_user_can()`。默认角色 administrator / editor / author / contributor / subscriber；元能力（`edit_post`、`delete_page` 等）经 `map_meta_cap()` 映射到「作者是谁、状态是什么」。

> **警告**：应用密码天然继承角色能力，**用管理员账号开应用密码等于授予最高权限**——自动化应单独建最小权限用户。

### 净化与转义

- 输入：`sanitize_text_field`（`formatting.php:5723`）、`sanitize_email` 等；富文本用 KSES 白名单 `wp_kses`（`kses.php:979`）。
- 输出：`esc_html`/`esc_attr`/`esc_url`/`esc_js`（`formatting.php`）。
- 数据层：`$wpdb->prepare()` 防注入。

## 扩展机制

- **插件**：`wp-content/plugins/`，主文件带插件头注释，由 `wp_get_active_and_valid_plugins()` 加载。
- **主题**：`wp-content/themes/`，`style.css` + `functions.php` + 模板文件，经 `template_include` 被 template-loader 选用。
- **mu-plugins**：`wp-content/mu-plugins/*.php`，先于普通插件自动加载、后台不可停用。
- **短代码**：`add_shortcode` / `do_shortcode`，旧版扩展手段，逐步被块取代。

> **警告**：**mu-plugins 的真实事故**：macOS 的 `wp-content` 会混入 `._*` AppleDouble 文件（如 `mu-plugins/._allow-svg.php`），被 WordPress 当插件加载、向页面输出二进制垃圾，故导出脚本加 `--exclude='._*'`。**任何落进 mu-plugins 目录的 .php 都成为代码执行入口**。

## 部署与运维

### 官方镜像 + wp-cli

```dockerfile
FROM wordpress:php8.3-apache
RUN apt-get update && apt-get install -y --no-install-recommends curl less \
    && curl -fsSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar \
    && chmod +x /usr/local/bin/wp
```

官方镜像入口脚本负责「读 `WORDPRESS_DB_*` → 自动生成 `wp-config.php` → 等 DB 就绪 → 安装」。

### wp-cli 关键命令

| 命令 | 用途 |
|---|---|
| `wp search-replace '旧' '新' --all-tables` | 序列化数据感知的全局 URL 替换（迁移关键） |
| `wp rewrite flush` | 重建固定链接重写规则 |

> **技巧**：**为什么必须 `wp search-replace` 而非 SQL `REPLACE`**：`wp_options` 等表存的是 PHP 序列化字符串，字符串长度写死在数据里，裸替换会破坏反序列化。

### 低内存调优（1.6 GB ECS）

- MariaDB：`mem_limit: 256m` + `--innodb-buffer-pool-size=64M --max-connections=50 --performance-schema=OFF`
- WordPress：`mem_limit: 448m` + prefork `MaxRequestWorkers 5` + PHP `memory_limit=64M`

## 最佳实践

- **应用密码按最小权限签发**：不要用管理员账号，为自动化单独建低权限用户。
- **HTTPS 强制**：应用密码走 Basic Auth，明文等于密码。
- **密钥不入库**：`.env*` 一律 `.gitignore`。
- **mu-plugins 目录严格管控**：任何落进去的 .php 都会执行。
- **URL 迁移用 `wp search-replace`**：勿用裸 SQL 替换序列化数据。
- **低内存环境显式限资源**：`mem_limit` + prefork/PHP 参数，避免 OOM 拖垮整机。

## 关键源码索引

| 主题 | 文件（相对 WordPress 核心） |
|---|---|
| 入口/引导 | `index.php`、`wp-blog-header.php`、`wp-load.php`、`wp-settings.php` |
| 主查询 | `wp-includes/class-wp.php`、`wp-includes/class-wp-query.php` |
| 模板加载 | `wp-includes/template-loader.php` |
| 事件系统 | `wp-includes/plugin.php`、`wp-includes/class-wp-hook.php` |
| 数据库访问 | `wp-includes/class-wpdb.php` |
| 建表 SQL | `wp-admin/includes/schema.php` |
| REST API | `wp-includes/rest-api.php`、`wp-includes/default-filters.php`、`wp-includes/rest-api/` |
| 应用密码 | `wp-includes/user.php`、`wp-includes/class-wp-application-passwords.php` |
| 角色能力 | `wp-includes/capabilities.php` |
| Nonce | `wp-includes/pluggable.php`、`wp-includes/functions.php` |
| 净化/转义 | `wp-includes/formatting.php`、`wp-includes/kses.php` |

## 参考

官方文档：

- [Code Reference](https://developer.wordpress.org/reference/) · [REST API 手册](https://developer.wordpress.org/rest-api/) · [插件手册](https://developer.wordpress.org/plugins/) · [主题手册](https://developer.wordpress.org/themes/) · [区块编辑器手册](https://developer.wordpress.org/block-editor/)
- [Database Description（表结构说明最全）](https://codex.wordpress.org/Database_Description) · [WordPress 源码仓库](https://github.com/WordPress/WordPress)

社区与工具：

- [Bedrock](https://github.com/roots/bedrock) · [Sage](https://github.com/roots/sage) · [wp-cli](https://github.com/wp-cli/wp-cli) · [Query Monitor](https://github.com/johnbillion/query-monitor)
- [10up Engineering Best Practices](https://github.com/10up/Engineering-Best-Practices) · [WordPress Coding Standards](https://github.com/WordPress/WordPress-Coding-Standards)
