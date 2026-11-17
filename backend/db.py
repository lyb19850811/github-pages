"""SQLite 存取层。单机存储；多实例部署需换共享数据库（见 README.md）。"""

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("DB_PATH", Path(__file__).parent / "guestbook.db"))


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    # WAL：读写并发更好；busy_timeout：并发写时等待而非立即报 "database is locked"
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
    return c


def init_db() -> None:
    c = _conn()
    try:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id         TEXT PRIMARY KEY,
                author     TEXT NOT NULL DEFAULT '',
                content    TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        c.commit()
    finally:
        c.close()


def insert(msg: dict) -> None:
    c = _conn()
    try:
        c.execute(
            "INSERT INTO messages (id, author, content, created_at)"
            " VALUES (:id, :author, :content, :created_at)",
            msg,
        )
        c.commit()
    finally:
        c.close()


def list_page(limit: int, offset: int) -> tuple[int, list[dict]]:
    c = _conn()
    try:
        rows = c.execute(
            "SELECT id, author, content, created_at FROM messages"
            " ORDER BY rowid DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        total = c.execute("SELECT COUNT(*) AS c FROM messages").fetchone()["c"]
        return total, [dict(r) for r in rows]
    finally:
        c.close()
