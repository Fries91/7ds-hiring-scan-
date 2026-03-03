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
COMPANY_POLL_SECONDS = int(os.getenv("COMPANY_POLL_SECONDS") or "90")

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

    # Train tracker (server-side, shared)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS train_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id TEXT NOT NULL,
        buyer TEXT NOT NULL,
        trains INTEGER NOT NULL,
        note TEXT,
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
    # If ADMIN_TOKEN is empty, admin guard is disabled
    if not ADMIN_TOKEN:
        return None
    got = (request.args.get("admin", "") or "").strip()
    if got != ADMIN_TOKEN:
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    return None

# ------------------------
# EVENT POLLING (applications)
# ------------------------

ID_PATTERN = re.compile(r"\[(\d+)\]")

def poll_events_loop():
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
            print("[poll_events_loop] ERROR:", repr(e), flush=True)

        time.sleep(POLL_SECONDS)

# ------------------------
# COMPANY + EMPLOYEE POLLING
# ------------------------

_company_lock = threading.Lock()
_company_state = {
    "updated_at": None,
    "rows": []  # [{company_id, name, employees:[{id,name,position,days_in_company,status}]}]
}

def _parse_employees(payload: dict):
    """
    Torn company endpoint schema can vary; we parse defensively.
    """
    company = payload.get("company", payload) if isinstance(payload, dict) else {}
    name = company.get("name") or company.get("company_name") or company.get("company") or None

    employees_obj = company.get("employees") or company.get("employee") or {}
    employees = []

    if isinstance(employees_obj, dict):
        # often keyed by user id
        for k, v in employees_obj.items():
            if not isinstance(v, dict):
                continue
            uid = str(v.get("id") or k or "")
            employees.append({
                "id": uid,
                "name": v.get("name") or v.get("username") or "",
                "position": v.get("position") or v.get("job") or v.get("role") or "",
                "days_in_company": v.get("days_in_company") or v.get("daysincompany") or v.get("days") or None,
                "status": v.get("status") or "",
            })
    elif isinstance(employees_obj, list):
        for v in employees_obj:
            if not isinstance(v, dict):
                continue
            uid = str(v.get("id") or "")
            employees.append({
                "id": uid,
                "name": v.get("name") or v.get("username") or "",
                "position": v.get("position") or v.get("job") or v.get("role") or "",
                "days_in_company": v.get("days_in_company") or v.get("daysincompany") or v.get("days") or None,
                "status": v.get("status") or "",
            })

    # stable sort
    employees.sort(key=lambda x: (x.get("position") or "", x.get("name") or ""))
    return name, employees

def fetch_company(company_id: str, session: requests.Session):
    """
    Uses Torn API company endpoint. We request employees selection.
    """
    # Torn API: /company/{id}?selections=employees&key=...
    url = f"{API_BASE}/company/{company_id}"
    r = session.get(url, params={"selections": "employees", "key": TORN_API_KEY}, timeout=20)
    r.raise_for_status()
    return r.json()

def poll_companies_loop():
    session = requests.Session()

    while True:
        try:
            if not TORN_API_KEY or not COMPANY_IDS:
                time.sleep(10)
                continue

            rows = []
            for cid in COMPANY_IDS:
                try:
                    payload = fetch_company(cid, session)
                    name, employees = _parse_employees(payload)
                    rows.append({
                        "company_id": str(cid),
                        "name": name or f"Company {cid}",
                        "employees": employees,
                    })
                except Exception as e:
                    # don't kill the whole poll
                    print(f"[poll_companies_loop] company {cid} ERROR:", repr(e), flush=True)
                    rows.append({
                        "company_id": str(cid),
                        "name": f"Company {cid}",
                        "employees": [],
                        "error": str(e),
                    })

            with _company_lock:
                _company_state["updated_at"] = utc()
                _company_state["rows"] = rows

        except Exception as e:
            print("[poll_companies_loop] ERROR:", repr(e), flush=True)

        time.sleep(COMPANY_POLL_SECONDS)

# ------------------------
# safe boot
# ------------------------

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
        threading.Thread(target=poll_events_loop, daemon=True).start()
        threading.Thread(target=poll_companies_loop, daemon=True).start()
        _booted = True

# ------------------------
# ROUTES
# ------------------------

@app.get("/")
def index():
    return (
        "7DS Hiring Scan is running.\n"
        "Use /health, /api/applications, /api/companies, /api/trains\n",
        200,
        {"Content-Type": "text/plain; charset=utf-8"},
    )

@app.get("/health")
def health():
    return ("ok", 200, {"Content-Type": "text/plain; charset=utf-8"})

# -------- Applications --------

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

# -------- Applicant workstats --------

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

# -------- Companies + employees --------

@app.get("/api/companies")
def companies():
    guard = require_admin()
    if guard:
        return guard

    with _company_lock:
        payload = {
            "ok": True,
            "updated_at": _company_state["updated_at"],
            "rows": _company_state["rows"],
        }
    return payload

# -------- Train tracker --------

@app.get("/api/trains")
def trains_list():
    guard = require_admin()
    if guard:
        return guard

    company_id = (request.args.get("company_id") or "").strip()
    if not company_id:
        return {"ok": False, "error": "missing company_id"}, 400

    con = db()
    cur = con.cursor()
    cur.execute("""
        SELECT id, company_id, buyer, trains, note, created_at
        FROM train_entries
        WHERE company_id=?
        ORDER BY id DESC
        LIMIT 50
    """, (company_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return {"ok": True, "rows": rows}

@app.post("/api/trains/add")
def trains_add():
    guard = require_admin()
    if guard:
        return guard

    body = request.get_json(silent=True) or {}
    company_id = (body.get("company_id") or "").strip()
    buyer = (body.get("buyer") or "").strip()
    trains = body.get("trains")
    note = (body.get("note") or "").strip()

    if not company_id or not buyer or trains is None:
        return {"ok": False, "error": "missing company_id/buyer/trains"}, 400

    try:
        trains_int = int(trains)
    except Exception:
        return {"ok": False, "error": "trains must be int"}, 400

    con = db()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO train_entries(company_id, buyer, trains, note, created_at)
        VALUES (?,?,?,?,?)
    """, (company_id, buyer, trains_int, note, utc()))
    con.commit()
    con.close()
    return {"ok": True}
