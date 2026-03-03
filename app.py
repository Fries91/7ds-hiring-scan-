import os
import re
import time
import threading
import sqlite3
from datetime import datetime, timezone

import requests
from flask import Flask, jsonify, request
from dotenv import load_dotenv

from torn_api import get_user_workstats, normalize_workstats

load_dotenv()
app = Flask(__name__)

TORN_API_KEY = (os.getenv("TORN_API_KEY") or "").strip()
ADMIN_TOKEN = (os.getenv("ADMIN_TOKEN") or "").strip()
COMPANY_IDS = [c.strip() for c in (os.getenv("COMPANY_IDS") or "").split(",") if c.strip()]

DB_PATH = (os.getenv("DB_PATH") or "hiring.db").strip()
POLL_SECONDS = int(os.getenv("POLL_SECONDS") or "45")

API_BASE = "https://api.torn.com"

# ------------------------
# helpers
# ------------------------

def utc():
    return datetime.now(timezone.utc).isoformat()

def db():
    con = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    con = db()
    cur = con.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        k TEXT PRIMARY KEY,
        v TEXT
    )
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER UNIQUE,
        company_id TEXT,
        applicant_id TEXT,
        raw_text TEXT,
        status TEXT DEFAULT 'new',
        created_at TEXT
    )
    """)
    con.commit()
    con.close()

def get_setting(k, default="0"):
    con = db()
    cur = con.cursor()
    cur.execute("SELECT v FROM settings WHERE k=?", (k,))
    row = cur.fetchone()
    con.close()
    return row["v"] if row else default

def set_setting(k, v):
    con = db()
    cur = con.cursor()
    cur.execute("INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)", (k, v))
    con.commit()
    con.close()

def require_admin():
    # If ADMIN_TOKEN is empty, admin guard is disabled (handy for testing)
    if not ADMIN_TOKEN:
        return None
    got = request.args.get("admin", "").strip()
    if got != ADMIN_TOKEN:
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    return None

# ------------------------
# EVENT POLLING
# ------------------------

ID_PATTERN = re.compile(r"\[(\d+)\]")

def poll_loop():
    """
    Background poller:
    - Reads Torn user events
    - Inserts application-like events into sqlite
    """
    session = requests.Session()

    while True:
        try:
            if not TORN_API_KEY:
                time.sleep(10)
                continue

            last = int(get_setting("last_event_id", "0"))

            r = session.get(
                f"{API_BASE}/user/",
                params={"selections": "events", "key": TORN_API_KEY},
                timeout=20,
            )
            r.raise_for_status()
            data = r.json()

            events = data.get("events", {}) or {}
            ids = sorted(int(i) for i in events.keys() if str(i).isdigit())

            max_seen = last

            for eid in ids:
                if eid <= last:
                    continue

                ev = events.get(str(eid), {}) or {}
                text = (ev.get("event") or "").strip()

                # crude filter (same as your logic, but safer)
                low = text.lower()
                if "appl" in low and "company" in low:
                    match = ID_PATTERN.search(text)
                    applicant_id = match.group(1) if match else None

                    con = db()
                    cur = con.cursor()
                    cur.execute("""
                        INSERT OR IGNORE INTO applications
                        (event_id, company_id, applicant_id, raw_text, status, created_at)
                        VALUES (?,?,?,?,?,?)
                    """, (eid, None, applicant_id, text, "new", utc()))
                    con.commit()
                    con.close()

                if eid > max_seen:
                    max_seen = eid

            if max_seen > last:
                set_setting("last_event_id", str(max_seen))

        except Exception as e:
            # Do NOT silently swallow errors — Render logs are your friend
            print("[poll_loop] ERROR:", repr(e), flush=True)

        time.sleep(POLL_SECONDS)

# start poller safely (NOT at import time)
_boot_lock = threading.Lock()
_booted = False

@app.before_request
def boot_once():
    global _booted
    if _booted:
        return
    with _boot_lock:
        if _booted:
            return
        init_db()
        threading.Thread(target=poll_loop, daemon=True).start()
        _booted = True

# ------------------------
# ROUTES
# ------------------------

@app.get("/")
def index():
    # Keep this FAST. Render may hit / by default.
    return (
        "7DS Hiring Scan is running. "
        "Use /health, /api/applications?admin=TOKEN, /api/applicant?id=ID&key=APIKEY&admin=TOKEN\n",
        200,
        {"Content-Type": "text/plain; charset=utf-8"},
    )

@app.get("/health")
def health():
    # Must be instant and simple
    return ("ok", 200, {"Content-Type": "text/plain; charset=utf-8"})

@app.get("/api/applications")
def apps():
    guard = require_admin()
    if guard:
        return guard

    con = db()
    cur = con.cursor()
    cur.execute("SELECT * FROM applications ORDER BY id DESC LIMIT 50")
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return {"ok": True, "rows": rows}

@app.post("/api/applications/status")
def app_status():
    guard = require_admin()
    if guard:
        return guard

    body = request.get_json(silent=True) or {}
    app_id = body.get("id")
    status = body.get("status")

    if not app_id or not status:
        return {"ok": False, "error": "missing id/status"}, 400

    con = db()
    cur = con.cursor()
    cur.execute("UPDATE applications SET status=? WHERE id=?", (status, app_id))
    con.commit()
    con.close()
    return {"ok": True}

@app.get("/api/applicant")
def applicant():
    guard = require_admin()
    if guard:
        return guard

    uid = (request.args.get("id") or "").strip()
    key = (request.args.get("key") or "").strip()

    if not uid or not key:
        return {"ok": False, "error": "missing id/key"}, 400

    data = get_user_workstats(uid, key)
    ws = normalize_workstats(data)
    return {"ok": True, "workstats": ws}
