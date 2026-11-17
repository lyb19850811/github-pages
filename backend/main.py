"""留言板后端：实现 guestbook/ 前端契约的 3 个接口。

GET  /api/health
GET  /api/messages?limit=20&offset=0
POST /api/messages

详见 README.md 与 ../guestbook/README.md。
"""

import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StringConstraints

import db

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "https://lyb19850811.github.io").split(",")
    if o.strip()
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="留言板后端", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


class MessageIn(BaseModel):
    author: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] = ""
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


_LABELS = {"author": "昵称", "content": "留言内容"}


def _friendly(exc: RequestValidationError) -> str:
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", []) if p != "body"]
        field = _LABELS.get(loc[-1], loc[-1]) if loc else "参数"
        t = err.get("type", "")
        if t == "string_too_long":
            return f"{field}不能超过 {err.get('ctx', {}).get('max_length', '')} 字"
        if t in ("string_too_short", "missing"):
            return f"{field}不能为空"
        return f"{field}参数不合法"
    return "请求参数不合法"


# 把 FastAPI 默认的 422 校验响应，统一成契约要求的 400 {"error": "..."}
@app.exception_handler(RequestValidationError)
async def _validation_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(status_code=400, content={"error": _friendly(exc)})


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/messages")
def list_messages(limit: int = 20, offset: int = 0):
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    total, messages = db.list_page(limit, offset)
    return {"total": total, "messages": messages}


@app.post("/api/messages", status_code=201)
def create_message(body: MessageIn):
    msg = {
        "id": uuid.uuid4().hex,
        "author": body.author,
        "content": body.content,
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    db.insert(msg)
    return {"message": msg}
