import os
import json
import sqlite3
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("DB_PATH", "hub.db")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _con():
    con = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    con = _con()
    cur = con.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            name TEXT DEFAULT '',
            api_key TEXT NOT NULL,
            company_ids TEXT NOT NULL DEFAULT '[]',
            created_at TEXT,
            last_seen_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT,
            last_seen_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            kind TEXT DEFAULT 'info',
            message TEXT NOT NULL,
            created_at TEXT,
            seen INTEGER NOT NULL DEFAULT 0
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS trains (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            company_id TEXT DEFAULT '',
            buyer TEXT DEFAULT '',
            amount INTEGER NOT NULL DEFAULT 0,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS contracts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL,
            note TEXT DEFAULT '',
            created_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            player_id TEXT DEFAULT '',
            name TEXT DEFAULT '',
            value INTEGER DEFAULT 0,
            note TEXT DEFAULT '',
            created_at TEXT,
            seen INTEGER NOT NULL DEFAULT 0
        )
        """
    )

    con.commit()
    con.close()


# -------- users / sessions --------

def upsert_user(user_id: str, name: str, api_key: str):
    con = _con()
    cur = con.cursor()
    now = _utc_now()

    cur.execute("SELECT user_id FROM users WHERE user_id=?", (user_id,))
    exists = cur.fetchone() is not None

    if exists:
        cur.execute(
            "UPDATE users SET name=?, api_key=?, last_seen_at=? WHERE user_id=?",
            (name or "", api_key, now, user_id),
        )
    else:
        cur.execute(
            """
            INSERT INTO users (user_id, name, api_key, company_ids, created_at, last_seen_at)
            VALUES (?, ?, ?, '[]', ?, ?)
            """,
            (user_id, name or "", api_key, now, now),
        )

    con.commit()
    con.close()


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE user_id=?", (user_id,))
    row = cur.fetchone()
    con.close()
    if not row:
        return None
    d = dict(row)
    try:
        d["company_ids"] = json.loads(d.get("company_ids") or "[]")
    except Exception:
        d["company_ids"] = []
    return d


def touch_user(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("UPDATE users SET last_seen_at=? WHERE user_id=?", (_utc_now(), user_id))
    con.commit()
    con.close()


def set_company_ids(user_id: str, company_ids: List[str]):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE users SET company_ids=? WHERE user_id=?",
        (json.dumps([str(x) for x in company_ids]), user_id),
    )
    con.commit()
    con.close()


def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(24)
    con = _con()
    cur = con.cursor()
    now = _utc_now()
    cur.execute(
        "INSERT INTO sessions (token, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
        (token, user_id, now, now),
    )
    con.commit()
    con.close()
    return token


def get_session(token: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM sessions WHERE token=?", (token,))
    row = cur.fetchone()
    con.close()
    return dict(row) if row else None


def touch_session(token: str):
    con = _con()
    cur = con.cursor()
    cur.execute("UPDATE sessions SET last_seen_at=? WHERE token=?", (_utc_now(), token))
    con.commit()
    con.close()


# -------- notifications --------

def add_notification(user_id: str, message: str, kind: str = "info"):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "INSERT INTO notifications (user_id, kind, message, created_at, seen) VALUES (?, ?, ?, ?, 0)",
        (user_id, kind, message, _utc_now()),
    )
    con.commit()
    con.close()


def list_notifications(user_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?",
        (user_id, int(limit)),
    )
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def mark_notifications_seen(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("UPDATE notifications SET seen=1 WHERE user_id=?", (user_id,))
    con.commit()
    con.close()


def count_unseen_notifications(user_id: str) -> int:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND seen=0", (user_id,))
    row = cur.fetchone()
    con.close()
    return int(row["c"]) if row else 0


# -------- trains --------

def add_train(user_id: str, company_id: str, buyer: str, amount: int):
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO trains (user_id, company_id, buyer, amount, used, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
        """,
        (user_id, str(company_id or ""), buyer or "", int(amount or 0), _utc_now()),
    )
    con.commit()
    con.close()


def list_trains(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM trains WHERE user_id=? ORDER BY id DESC LIMIT 200", (user_id,))
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def set_trains_used(user_id: str, train_id: int, used: int):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE trains SET used=? WHERE id=? AND user_id=?",
        (1 if used else 0, int(train_id), user_id),
    )
    con.commit()
    con.close()


def delete_train(user_id: str, train_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM trains WHERE id=? AND user_id=?", (int(train_id), user_id))
    con.commit()
    con.close()


# -------- contracts --------

def add_contract(user_id: str, title: str, note: str = ""):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "INSERT INTO contracts (user_id, title, note, created_at) VALUES (?, ?, ?, ?)",
        (user_id, title, note or "", _utc_now()),
    )
    con.commit()
    con.close()


def list_contracts(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM contracts WHERE user_id=? ORDER BY id DESC LIMIT 200", (user_id,))
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def delete_contract(user_id: str, contract_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM contracts WHERE id=? AND user_id=?", (int(contract_id), user_id))
    con.commit()
    con.close()


# -------- leads --------

def add_lead(user_id: str, player_id: str, name: str, value: int, note: str = ""):
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO leads (user_id, player_id, name, value, note, created_at, seen)
        VALUES (?, ?, ?, ?, ?, ?, 0)
        """,
        (user_id, str(player_id or ""), name or "", int(value or 0), note or "", _utc_now()),
    )
    con.commit()
    con.close()


def list_leads(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM leads WHERE user_id=? ORDER BY id DESC LIMIT 500", (user_id,))
    rows = cur.fetchall()
    con.close()
    return [dict(r) for r in rows]


def clear_leads(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM leads WHERE user_id=?", (user_id,))
    con.commit()
    con.close()


def mark_leads_seen(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("UPDATE leads SET seen=1 WHERE user_id=?", (user_id,))
    con.commit()
    con.close()


def count_unseen_leads(user_id: str) -> int:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM leads WHERE user_id=? AND seen=0", (user_id,))
    row = cur.fetchone()
    con.close()
    return int(row["c"]) if row else 0
