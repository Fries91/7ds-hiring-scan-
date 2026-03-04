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


def _has_col(cur: sqlite3.Cursor, table: str, col: str) -> bool:
    cur.execute(f"PRAGMA table_info({table})")
    rows = cur.fetchall()
    return any((r["name"] == col) for r in rows)


def _add_col(cur: sqlite3.Cursor, table: str, col_ddl: str):
    # col_ddl example: "created_at TEXT"
    cur.execute(f"ALTER TABLE {table} ADD COLUMN {col_ddl}")


def init_db():
    con = _con()
    cur = con.cursor()

    # ---------- Base tables (fresh install) ----------
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
        CREATE TABLE IF NOT EXISTS trains (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            buyer_name TEXT NOT NULL,
            trains_bought INTEGER NOT NULL,
            trains_used INTEGER NOT NULL DEFAULT 0,
            note TEXT DEFAULT '',
            created_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS contracts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            employee_id TEXT DEFAULT '',
            employee_name TEXT DEFAULT '',
            title TEXT NOT NULL,
            expires_at TEXT DEFAULT '',
            note TEXT DEFAULT '',
            created_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT,
            seen INTEGER NOT NULL DEFAULT 0
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS recruit_leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            player_id TEXT NOT NULL,
            name TEXT NOT NULL,
            man INTEGER NOT NULL,
            intel INTEGER NOT NULL,
            endu INTEGER NOT NULL,
            total INTEGER NOT NULL,
            delta_vs_floor INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            seen INTEGER NOT NULL DEFAULT 0,
            UNIQUE(user_id, company_id, player_id)
        )
        """
    )

    # ---------- ✅ MIGRATIONS (fix older /var/data DBs) ----------
    # users table
    if not _has_col(cur, "users", "company_ids"):
        _add_col(cur, "users", "company_ids TEXT NOT NULL DEFAULT '[]'")
    if not _has_col(cur, "users", "created_at"):
        _add_col(cur, "users", "created_at TEXT")
    if not _has_col(cur, "users", "last_seen_at"):
        _add_col(cur, "users", "last_seen_at TEXT")

    # sessions table
    if not _has_col(cur, "sessions", "created_at"):
        _add_col(cur, "sessions", "created_at TEXT")
    if not _has_col(cur, "sessions", "last_seen_at"):
        _add_col(cur, "sessions", "last_seen_at TEXT")

    # trains table
    if not _has_col(cur, "trains", "trains_used"):
        _add_col(cur, "trains", "trains_used INTEGER NOT NULL DEFAULT 0")
    if not _has_col(cur, "trains", "note"):
        _add_col(cur, "trains", "note TEXT DEFAULT ''")
    if not _has_col(cur, "trains", "created_at"):
        _add_col(cur, "trains", "created_at TEXT")

    # contracts table
    if not _has_col(cur, "contracts", "employee_id"):
        _add_col(cur, "contracts", "employee_id TEXT DEFAULT ''")
    if not _has_col(cur, "contracts", "employee_name"):
        _add_col(cur, "contracts", "employee_name TEXT DEFAULT ''")
    if not _has_col(cur, "contracts", "expires_at"):
        _add_col(cur, "contracts", "expires_at TEXT DEFAULT ''")
    if not _has_col(cur, "contracts", "note"):
        _add_col(cur, "contracts", "note TEXT DEFAULT ''")
    if not _has_col(cur, "contracts", "created_at"):
        _add_col(cur, "contracts", "created_at TEXT")

    # notifications table
    if not _has_col(cur, "notifications", "created_at"):
        _add_col(cur, "notifications", "created_at TEXT")
    if not _has_col(cur, "notifications", "seen"):
        _add_col(cur, "notifications", "seen INTEGER NOT NULL DEFAULT 0")

    # recruit_leads table
    if not _has_col(cur, "recruit_leads", "created_at"):
        _add_col(cur, "recruit_leads", "created_at TEXT")
    if not _has_col(cur, "recruit_leads", "seen"):
        _add_col(cur, "recruit_leads", "seen INTEGER NOT NULL DEFAULT 0")

    con.commit()
    con.close()


# ---------------- USERS ----------------
def upsert_user(user_id: str, name: str, api_key: str):
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO users(user_id, name, api_key, company_ids, created_at, last_seen_at)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET
          name=excluded.name,
          api_key=excluded.api_key,
          last_seen_at=excluded.last_seen_at
        """,
        (user_id, name or "", api_key, "[]", _utc_now(), _utc_now()),
    )
    con.commit()
    con.close()


def set_company_ids(user_id: str, company_ids: List[str]):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE users SET company_ids=?, last_seen_at=? WHERE user_id=?",
        (json.dumps(company_ids), _utc_now(), user_id),
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


# ---------------- SESSIONS ----------------
def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    con = _con()
    cur = con.cursor()
    cur.execute(
        "INSERT INTO sessions(token, user_id, created_at, last_seen_at) VALUES(?,?,?,?)",
        (token, user_id, _utc_now(), _utc_now()),
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


# ---------------- NOTIFICATIONS ----------------
def add_notification(user_id: str, kind: str, message: str):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "INSERT INTO notifications(user_id, kind, message, created_at, seen) VALUES(?,?,?,?,0)",
        (user_id, kind, message, _utc_now()),
    )
    con.commit()
    con.close()


def list_notifications(user_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?",
        (user_id, int(limit)),
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def mark_notifications_seen(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("UPDATE notifications SET seen=1 WHERE user_id=?", (user_id,))
    con.commit()
    con.close()


# ---------------- TRAINS ----------------
def add_train(user_id: str, company_id: str, buyer_name: str, trains_bought: int, note: str = ""):
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO trains(user_id, company_id, buyer_name, trains_bought, trains_used, note, created_at)
        VALUES(?,?,?,?,?,?,?)
        """,
        (user_id, company_id, buyer_name, int(trains_bought), 0, note or "", _utc_now()),
    )
    con.commit()
    con.close()


def list_trains(user_id: str, company_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT * FROM trains WHERE user_id=? AND company_id=? ORDER BY id DESC",
        (user_id, company_id),
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    for r in rows:
        r["remaining"] = max(0, int(r["trains_bought"]) - int(r["trains_used"]))
    return rows


def set_trains_used(user_id: str, train_id: int, trains_used: int):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE trains SET trains_used=? WHERE user_id=? AND id=?",
        (int(trains_used), user_id, int(train_id)),
    )
    con.commit()
    con.close()


def delete_train(user_id: str, train_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM trains WHERE user_id=? AND id=?", (user_id, int(train_id)))
    con.commit()
    con.close()


# ---------------- CONTRACTS ----------------
def add_contract(
    user_id: str,
    company_id: str,
    title: str,
    employee_id: str = "",
    employee_name: str = "",
    expires_at: str = "",
    note: str = "",
):
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO contracts(user_id, company_id, employee_id, employee_name, title, expires_at, note, created_at)
        VALUES(?,?,?,?,?,?,?,?)
        """,
        (user_id, company_id, employee_id or "", employee_name or "", title, expires_at or "", note or "", _utc_now()),
    )
    con.commit()
    con.close()


def list_contracts(user_id: str, company_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT * FROM contracts WHERE user_id=? AND company_id=? ORDER BY id DESC",
        (user_id, company_id),
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def delete_contract(user_id: str, contract_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM contracts WHERE user_id=? AND id=?", (user_id, int(contract_id)))
    con.commit()
    con.close()


# ---------------- RECRUIT LEADS ----------------
def upsert_lead(
    user_id: str,
    company_id: str,
    player_id: str,
    name: str,
    man: int,
    intel: int,
    endu: int,
    total: int,
    delta_vs_floor: int,
):
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO recruit_leads(user_id, company_id, player_id, name, man, intel, endu, total, delta_vs_floor, created_at, seen)
        VALUES(?,?,?,?,?,?,?,?,?,?,0)
        ON CONFLICT(user_id, company_id, player_id) DO UPDATE SET
          name=excluded.name,
          man=excluded.man,
          intel=excluded.intel,
          endu=excluded.endu,
          total=excluded.total,
          delta_vs_floor=excluded.delta_vs_floor
        """,
        (user_id, company_id, player_id, name, int(man), int(intel), int(endu), int(total), int(delta_vs_floor), _utc_now()),
    )
    con.commit()
    con.close()


def list_leads(user_id: str, company_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        SELECT * FROM recruit_leads
        WHERE user_id=? AND company_id=?
        ORDER BY delta_vs_floor DESC, total DESC, id DESC
        LIMIT ?
        """,
        (user_id, company_id, int(limit)),
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def count_unseen_leads(user_id: str) -> int:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) as c FROM recruit_leads WHERE user_id=? AND seen=0", (user_id,))
    row = cur.fetchone()
    con.close()
    return int(row["c"] if row else 0)


def mark_leads_seen(user_id: str, company_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE recruit_leads SET seen=1 WHERE user_id=? AND company_id=?",
        (user_id, company_id),
    )
    con.commit()
    con.close()


def clear_leads(user_id: str, company_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM recruit_leads WHERE user_id=? AND company_id=?", (user_id, company_id))
    con.commit()
    con.close()
