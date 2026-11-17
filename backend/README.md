# 留言板后端（FastAPI + SQLite）

实现 `guestbook/` 前端契约的 3 个接口（契约全文见 `../guestbook/README.md`）。

## 目录

- `main.py` — FastAPI 应用：路由 + 校验 + CORS
- `db.py` — SQLite 存取（接口层与存储层分离）
- `requirements.txt`
- `.gitignore` — 排除本地数据库与虚拟环境

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查，返回 `{"status":"ok"}` |
| GET | `/api/messages?limit=20&offset=0` | 留言列表（最新在前），返回 `{"total":N,"messages":[...]}` |
| POST | `/api/messages` | 发布留言，返回 201 `{"message":{...}}` |

## 运行

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

自检：

```bash
curl http://127.0.0.1:8000/api/health
curl 'http://127.0.0.1:8000/api/messages?limit=20&offset=0'
curl -X POST http://127.0.0.1:8000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"author":"测试","content":"你好"}'
```

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `CORS_ORIGINS` | `https://lyb19850811.github.io` | 允许的前端源，逗号分隔 |
| `DB_PATH` | `./guestbook.db` | SQLite 文件路径 |

## 校验规则（与前端一致）

- `author`：可选，去空格后 ≤ 40 字符；空值由前端显示为「匿名」。
- `content`：必填，去空格后 1–1000 字符。
- 校验失败统一返回 400 `{"error": "..."}`（FastAPI 默认的 422 被重写为该格式，前端按此解析）。

## ECS 部署注意

- 用 `uvicorn main:app --host 0.0.0.0 --port 8000` 单 worker 即可（留言板流量低）。
- 前面挂 ALB/nginx 做 HTTPS 终结；ALB 健康检查指向 `/api/health`。
- **SQLite 是单机存储**：单 ECS 任务可用；扩到多任务/多实例时必须换 Postgres（RDS），只改 `db.py`，`main.py` 接口层不变。
- 生产建议把依赖锁定到具体版本（`pip freeze > requirements.lock.txt`）。
