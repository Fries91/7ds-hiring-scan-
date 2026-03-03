import os
import re
import time
import threading
import sqlite3
from datetime import datetime, timezone

import requests
from flask import Flask, jsonify, request, Response
from dotenv import load_dotenv

from torn_api import get_company, get_user_workstats, normalize_workstats, TornAPIError

load_dotenv()
app = Flask(__name__)

TORN_API_KEY = (os.getenv("TORN_API_KEY") or "").strip()  # must include access to user events on your account
ADMIN_TOKEN = (os.getenv("ADMIN_TOKEN") or "").strip()
COMPANY_IDS = [c.strip() for c in (os.getenv("COMPANY_IDS") or "").split(",") if c.strip()]

DB_PATH = (os.getenv("DB_PATH") or "hiring.db").strip()
POLL_SECONDS = int(os.getenv("POLL_SECONDS") or "45")

API_BASE = "https://api.torn.com"

_boot_lock = threading.Lock()
_booted = False

def utcnow_iso():
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
        company_name TEXT,
        applicant_id TEXT,
        applicant_name TEXT,
        raw_text TEXT,
        status TEXT NOT NULL DEFAULT 'new',  -- new / reviewed / shortlist / declined
        created_at TEXT NOT NULL
      )
    """)

    con.commit()
    con.close()

def get_setting(key: str, default: str = "") -> str:
    con = db()
    cur = con.cursor()
    cur.execute("SELECT v FROM settings WHERE k=?", (key,))
    row = cur.fetchone()
    con.close()
    return (row["v"] if row else default) or default

def set_setting(key: str, value: str) -> None:
    con = db()
    cur = con.cursor()
    cur.execute("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (key, value))
    con.commit()
    con.close()

def require_admin():
    if not ADMIN_TOKEN:
        return None
    got = (request.headers.get("X-Admin-Token") or request.args.get("admin") or "").strip()
    if got != ADMIN_TOKEN:
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    return None

init_db()

# ---------------------------
# Torn events polling
# ---------------------------

# Best-effort patterns for application events (Torn wording varies)
APPLY_HINTS = [
    "applied", "application", "job", "position", "company"
]

# Try to pull IDs like [123456] or (123456) or ID: 123456
ID_PATTERNS = [
    re.compile(r"\[(\d{3,10})\]"),
    re.compile(r"\((\d{3,10})\)"),
    re.compile(r"\bID[:\s]+(\d{3,10})\b", re.IGNORECASE),
]

# Try to pull a company id if it appears
COMPANY_ID_PATTERNS = [
    re.compile(r"\bcompany\s*#\s*(\d{1,10})\b", re.IGNORECASE),
    re.compile(r"\bCompany\s*\((\d{1,10})\)", re.IGNORECASE),
]

def torn_get_events() -> dict:
    # /user/?selections=events&key=...
    url = f"{API_BASE}/user/"
    r = requests.get(url, params={"selections": "events", "key": TORN_API_KEY}, timeout=25)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and "error" in data:
        raise RuntimeError(str(data["error"]))
    return data.get("events") or {}

def looks_like_application(text: str) -> bool:
    t = (text or "").lower()
    # quick filter first
    if not any(h in t for h in APPLY_HINTS):
        return False
    # require at least "appl" + ("company" or "job" or "position")
    if ("appl" in t) and (("company" in t) or ("job" in t) or ("position" in t)):
        return True
    # fallback: "applied for" often appears
    if "applied for" in t:
        return True
    return False

def extract_first_id(text: str) -> str | None:
    for pat in ID_PATTERNS:
        m = pat.search(text or "")
        if m:
            return m.group(1)
    return None

def extract_company_id(text: str) -> str | None:
    for pat in COMPANY_ID_PATTERNS:
        m = pat.search(text or "")
        if m:
            return m.group(1)
    return None

def insert_application(event_id: int, company_id: str | None, applicant_id: str | None, raw_text: str):
    # Try to fill company_name from known COMPANY_IDS list (best-effort, can be blank)
    company_name = None
    if company_id and company_id in COMPANY_IDS:
        try:
            data = get_company(company_id, TORN_API_KEY)
            prof = data.get("company") or data.get("profile") or {}
            company_name = prof.get("name") or data.get("name")
        except Exception:
            company_name = None

    con = db()
    cur = con.cursor()
    cur.execute("""
      INSERT OR IGNORE INTO applications(event_id, company_id, company_name, applicant_id, applicant_name, raw_text, status, created_at)
      VALUES(?,?,?,?,?,?,?,?)
    """, (
        int(event_id),
        company_id,
        company_name,
        applicant_id,
        None,
        raw_text,
        "new",
        utcnow_iso()
    ))
    con.commit()
    con.close()

def poll_loop():
    while True:
        try:
            if not TORN_API_KEY:
                time.sleep(10)
                continue

            last_seen = int(get_setting("last_event_id", "0") or "0")
            events = torn_get_events()  # dict keyed by id, newest-ish
            # event ids are keys, can be strings
            ids = []
            for k in events.keys():
                try:
                    ids.append(int(k))
                except Exception:
                    pass
            ids.sort()  # ascending

            new_ids = [eid for eid in ids if eid > last_seen]
            for eid in new_ids:
                ev = events.get(str(eid)) or {}
                text = (ev.get("event") or ev.get("message") or ev.get("text") or "")
                if not text:
                    continue
                if not looks_like_application(text):
                    continue

                applicant_id = extract_first_id(text)
                company_id = extract_company_id(text)

                insert_application(eid, company_id, applicant_id, text)

                # Move last_seen forward as we process
                set_setting("last_event_id", str(eid))

            # If there were no new ids, still keep last_seen stable
            if ids:
                # Don’t jump last_seen forward unless we actually processed new ids
                if not new_ids and last_seen == 0:
                    # first boot: set baseline so we don't import years of events
                    set_setting("last_event_id", str(max(ids)))

        except Exception:
            # Don’t crash the thread; just wait and retry
            pass

        time.sleep(POLL_SECONDS)

def boot_once():
    global _booted
    if _booted:
        return
    with _boot_lock:
        if _booted:
            return
        t = threading.Thread(target=poll_loop, daemon=True)
        t.start()
        _booted = True

@app.before_request
def _boot():
    boot_once()

# ---------------------------
# API endpoints used by overlay
# ---------------------------

@app.get("/health")
def health():
    return {"ok": True, "poll_seconds": POLL_SECONDS}

@app.get("/")
def home():
    return Response("Hiring Scan API running (overlay-only hub).", mimetype="text/plain")

@app.get("/api/companies")
def api_companies():
    guard = require_admin()
    if guard: return guard

    comps = []
    for cid in COMPANY_IDS:
        name = f"Company {cid}"
        try:
            data = get_company(cid, TORN_API_KEY)
            prof = data.get("company") or data.get("profile") or {}
            name = prof.get("name") or data.get("name") or name
        except Exception:
            pass
        comps.append({"id": cid, "name": name})
    return {"ok": True, "companies": comps}

@app.get("/api/company")
def api_company():
    guard = require_admin()
    if guard: return guard
    if not TORN_API_KEY:
        return {"ok": False, "error": "Server missing TORN_API_KEY"}, 500

    cid = (request.args.get("id") or "").strip()
    if not cid:
        return {"ok": False, "error": "Missing company id"}, 400

    try:
        data = get_company(cid, TORN_API_KEY)
        prof = data.get("company") or data.get("profile") or {}
        cname = prof.get("name") or data.get("name") or f"Company {cid}"

        employees_obj = data.get("employees") or data.get("company_employees") or {}
        employees = []
        if isinstance(employees_obj, dict):
            for emp_id, emp in employees_obj.items():
                name = emp.get("name") if isinstance(emp, dict) else str(emp)
                position = emp.get("position") if isinstance(emp, dict) else None

                man = emp.get("manual_labor") if isinstance(emp, dict) else None
                inte = emp.get("intelligence") if isinstance(emp, dict) else None
                endu = emp.get("endurance") if isinstance(emp, dict) else None

                total = None
                try:
                    if man is not None and inte is not None and endu is not None:
                        total = int(man) + int(inte) + int(endu)
                except Exception:
                    total = None

                employees.append({
                    "id": str(emp_id),
                    "name": name or f"#{emp_id}",
                    "position": position,
                    "workstats": {
                        "man": int(man) if man is not None else None,
                        "int": int(inte) if inte is not None else None,
                        "end": int(endu) if endu is not None else None,
                        "total": total
                    }
                })

        return {"ok": True, "company": {"id": cid, "name": cname}, "employees": employees}
    except TornAPIError as e:
        return {"ok": False, "error": f"Torn API error: {e}"}, 400
    except Exception as e:
        return {"ok": False, "error": str(e)}, 500

@app.get("/api/applicant")
def api_applicant():
    guard = require_admin()
    if guard: return guard

    uid = (request.args.get("id") or "").strip()
    key = (request.args.get("key") or "").strip()

    if not uid:
        return {"ok": False, "error": "Missing applicant id"}, 400
    if not key:
        return {"ok": False, "error": "No applicant key provided. Use manual entry instead."}, 400

    try:
        data = get_user_workstats(uid, key)
        ws = normalize_workstats(data)
        return {"ok": True, "workstats": ws}
    except TornAPIError as e:
        return {"ok": False, "error": f"Torn API error: {e}"}, 400
    except Exception as e:
        return {"ok": False, "error": str(e)}, 500

# ---- NEW: applications feed for overlay ----

@app.get("/api/applications")
def api_applications():
    guard = require_admin()
    if guard: return guard

    limit = request.args.get("limit", "25")
    try:
        limit = max(1, min(100, int(limit)))
    except Exception:
        limit = 25

    con = db()
    cur = con.cursor()
    cur.execute("""
      SELECT id, event_id, company_id, company_name, applicant_id, applicant_name, raw_text, status, created_at
      FROM applications
      ORDER BY id DESC
      LIMIT ?
    """, (limit,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()

    return {"ok": True, "rows": rows}

@app.post("/api/applications/status")
def api_applications_status():
    guard = require_admin()
    if guard: return guard

    body = request.get_json(force=True, silent=True) or {}
    app_id = body.get("id")
    status = (body.get("status") or "").strip().lower()

    if status not in ("new", "reviewed", "shortlist", "declined"):
        return {"ok": False, "error": "bad status"}, 400
    try:
        app_id = int(app_id)
    except Exception:
        return {"ok": False, "error": "bad id"}, 400

    con = db()
    cur = con.cursor()
    cur.execute("UPDATE applications SET status=? WHERE id=?", (status, app_id))
    con.commit()
    con.close()
    return {"ok": True}
