import json
import sqlite3
from typing import Any, Dict, List, Optional


def _con(db_path: str):
    con = sqlite3.connect(db_path, timeout=30, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def init_db(db_path: str):
    con = _con(db_path)
    cur = con.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            name TEXT,
            api_key TEXT,
            token TEXT,
            token_created_at TEXT,
            last_seen_at TEXT,
            company_ids TEXT DEFAULT ''
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            event_id INTEGER NOT NULL,
            applicant_id TEXT,
            raw_text TEXT,
            status TEXT DEFAULT 'new',
            created_at TEXT,
            UNIQUE(user_id, event_id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS train_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            buyer TEXT NOT NULL,
            trains INTEGER NOT NULL,
            note TEXT,
            created_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS cache (
            k TEXT PRIMARY KEY,
            v TEXT,
            created_at INTEGER
        )
        """
    )

    con.commit()
    con.close()


# ---------------- USERS ----------------
def upsert_user(
    db_path: str,
    user_id: str,
    name: str,
    api_key: str,
    token: str,
    token_created_at: str,
    last_seen_at: str,
):
    con = _con(db_path)
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO users(user_id, name, api_key, token, token_created_at, last_seen_at)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET
            name=excluded.name,
            api_key=excluded.api_key,
            token=excluded.token,
            token_created_at=excluded.token_created_at,
            last_seen_at=excluded.last_seen_at
        """,
        (user_id, name, api_key, token, token_created_at, last_seen_at),
    )
    con.commit()
    con.close()


def get_user_by_token(db_path: str, token: str, ttl_seconds: int) -> Optional[Dict[str, Any]]:
    # TTL is enforced by last_seen_at and token_created_at in app.py logic; we do a simple lookup.
    con = _con(db_path)
    cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE token=?", (token,))
    row = cur.fetchone()
    if not row:
        con.close()
        return None
    # update last_seen_at opportunistically
    cur.execute("UPDATE users SET last_seen_at=last_seen_at WHERE user_id=?", (row["user_id"],))
    con.commit()
    con.close()
    return dict(row)


def set_user_company_ids(db_path: str, user_id: str, ids: List[str]):
    con = _con(db_path)
    cur = con.cursor()
    cur.execute("UPDATE users SET company_ids=? WHERE user_id=?", (",".join(ids), user_id))
    con.commit()
    con.close()


def get_user_company_ids(db_path: str, user_id: str) -> List[str]:
    con = _con(db_path)
    cur = con.cursor()
    cur.execute("SELECT company_ids FROM users WHERE user_id=?", (user_id,))
    row = cur.fetchone()
    con.close()
    if not row:
        return []
    raw = (row["company_ids"] or "").strip()
    if not raw:
        return []
    return [c.strip() for c in raw.split(",") if c.strip()]


# ---------------- APPLICATIONS ----------------
def upsert_application_rows(db_path: str, user_id: str, rows: List[Dict[str, Any]]):
    con = _con(db_path)
    cur = con.cursor()
    for r in rows:
        cur.execute(
            """
            INSERT OR IGNORE INTO applications(user_id, event_id, applicant_id, raw_text, status, created_at)
            VALUES(?,?,?,?,?,?)
            """,
            (
                user_id,
                int(r["event_id"]),
                r.get("applicant_id"),
                r.get("raw_text") or "",
                "new",
                r.get("created_at") or "",
            ),
        )
    con.commit()
    con.close()


def list_applications(db_path: str, user_id: str, limit: int = 60) -> List[Dict[str, Any]]:
    con = _con(db_path)
    cur = con.cursor()
    cur.execute(
        "SELECT * FROM applications WHERE user_id=? ORDER BY id DESC LIMIT ?",
        (user_id, int(limit)),
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def update_application_status(db_path: str, user_id: str, app_id: int, status: str):
    con = _con(db_path)
    cur = con.cursor()
    cur.execute(
        "UPDATE applications SET status=? WHERE user_id=? AND id=?",
        (status, user_id, int(app_id)),
    )
    con.commit()
    con.close()


# ---------------- TRAINS ----------------
def add_train_entry(db_path: str, user_id: str, company_id: str, buyer: str, trains: int, note: str, created_at: str):
    con = _con(db_path)
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO train_entries(user_id, company_id, buyer, trains, note, created_at)
        VALUES(?,?,?,?,?,?)
        """,
        (user_id, company_id, buyer, int(trains), note, created_at),
    )
    con.commit()
    con.close()


def list_train_entries(db_path: str, user_id: str, company_id: str, limit: int = 80) -> List[Dict[str, Any]]:
    con = _con(db_path)
    cur = con.cursor()
    cur.execute(
        """
        SELECT id, company_id, buyer, trains, note, created_at
        FROM train_entries
        WHERE user_id=? AND company_id=?
        ORDER BY id DESC
        LIMIT ?
        """,
        (user_id, company_id, int(limit)),
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def delete_train_entry(db_path: str, user_id: str, entry_id: int):
    con = _con(db_path)
    cur = con.cursor()
    cur.execute("DELETE FROM train_entries WHERE user_id=? AND id=?", (user_id, int(entry_id)))
    con.commit()
    con.close()


# ---------------- CACHE ----------------
def cache_set(db_path: str, k: str, v: Dict[str, Any]):
    con = _con(db_path)
    cur = con.cursor()
    cur.execute(
        "INSERT OR REPLACE INTO cache(k,v,created_at) VALUES(?,?,strftime('%s','now'))",
        (k, json.dumps(v)),
    )
    con.commit()
    con.close()


def cache_get(db_path: str, k: str, ttl_seconds: int) -> Optional[Dict[str, Any]]:
    con = _con(db_path)
    cur = con.cursor()
    cur.execute("SELECT v, created_at FROM cache WHERE k=?", (k,))
    row = cur.fetchone()
    con.close()
    if not row:
        return None
    created_at = int(row["created_at"] or 0)
    # crude TTL check in DB time seconds
    import time as _time

    if (_time.time() - created_at) > ttl_seconds:
        return None
    try:
        return json.loads(row["v"])
    except Exception:
        return None
