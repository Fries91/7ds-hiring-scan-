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

API_V1_BASE = "https://api.torn.com"
API_V2_BASE = "https://api.torn.com/v2"

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
                f"{API_V1_BASE}/user/",
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
    company = payload.get("company", payload) if isinstance(payload, dict) else {}
    name = company.get("name") or company.get("company_name") or company.get("company") or None

    employees_obj = company.get("employees") or company.get("employee") or {}
    employees = []

    if isinstance(employees_obj, dict):
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

    employees.sort(key=lambda x: (x.get("position") or "", x.get("name") or ""))
    return name, employees

def fetch_company(company_id: str, session: requests.Session):
    url = f"{API_V1_BASE}/company/{company_id}"
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
# HOF SEARCH (workstats)
# ------------------------

# Very lightweight cache to avoid hammering Torn API
_hof_cache_lock = threading.Lock()
_hof_cache = {
    "key": None,
    "ts": 0.0,
    "data": None
}

def _hof_fetch_page(session: requests.Session, offset: int, limit: int):
    # Torn API v2 hall of fame endpoint
    # https://api.torn.com/v2/torn/hof?key=XXX&limit=100&offset=0&cat=workstats
    url = f"{API_V2_BASE}/torn/hof"
    r = session.get(url, params={
        "key": TORN_API_KEY,
        "cat": "workstats",
        "limit": limit,
        "offset": offset,
    }, timeout=25)
    r.raise_for_status()
    return r.json()

def _hof_extract_entries(payload: dict):
    """
    Tries multiple possible schemas, returns list of dict entries.
    We expect each entry to have:
      - user_id / id
      - name
      - value (workstats)
      - rank
    """
    if not isinstance(payload, dict):
        return []

    # common candidates
    for k in ("hof", "hall_of_fame", "rankings", "entries", "data"):
        v = payload.get(k)
        if isinstance(v, list):
            return v

    # sometimes nested
    if isinstance(payload.get("hall_of_fame"), dict):
        for k in ("entries", "rankings", "hof"):
            v = payload["hall_of_fame"].get(k)
            if isinstance(v, list):
                return v

    return []

def search_hof_workstats(min_val: int, max_val: int, limit_results: int = 100):
    """
    Searches HoF workstats for values between [min_val, max_val].
    To keep this safe + fast:
      - scans a bounded number of pages
      - stops once it collects enough results
    """
    if min_val > max_val:
        min_val, max_val = max_val, min_val

    session = requests.Session()

    found = []
    scanned_pages = 0

    # You can tweak these to balance speed vs coverage
    page_limit = 100           # results per page from HoF
    max_pages = 30             # hard cap API calls (safety)
    offsets = [i * page_limit for i in range(max_pages)]

    for off in offsets:
        scanned_pages += 1
        try:
            payload = _hof_fetch_page(session, off, page_limit)
        except Exception as e:
            print("[hof] fetch error:", repr(e), flush=True)
            continue

        entries = _hof_extract_entries(payload)

        if not entries:
            # no entries means end or schema changed; stop to avoid spamming
            break

        for e in entries:
            # normalize keys
            uid = str(e.get("user_id") or e.get("id") or e.get("userid") or "")
            name = e.get("name") or e.get("username") or ""
            rank = e.get("rank") or e.get("position") or e.get("place") or None

            # workstats value may be called "value" or "score"
            raw_val = e.get("value")
            if raw_val is None:
                raw_val = e.get("score")
            if raw_val is None:
                raw_val = e.get("workstats")

            try:
                val = int(raw_val)
            except Exception:
                continue

            if min_val <= val <= max_val:
                found.append({
                    "id": uid,
                    "name": name,
                    "rank": rank,
                    "value": val,
                })

            if len(found) >= limit_results:
                return found, scanned_pages

        # OPTIONAL early break if we're clearly beyond the range:
        # If HoF is sorted descending, once values drop below min_val, later pages will be even smaller.
        try:
            # find smallest value on page
            vals = []
            for e in entries:
                raw_val = e.get("value") if e.get("value") is not None else e.get("score")
                if raw_val is None:
                    raw_val = e.get("workstats")
                try:
                    vals.append(int(raw_val))
                except Exception:
                    pass
            if vals and min(vals) < min_val and max(vals) < min_val:
                # whole page below min => stop
                break
        except Exception:
            pass

    return found, scanned_pages

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
        "Use /health, /api/applications, /api/companies, /api/trains, /api/search_workstats\n",
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

# -------- Search HoF workstats --------

@app.get("/api/search_workstats")
def api_search_workstats():
    guard = require_admin()
    if guard:
        return guard

    if not TORN_API_KEY:
        return {"ok": False, "error": "TORN_API_KEY not set on server"}, 400

    try:
        min_val = int((request.args.get("min") or "").strip())
        max_val = int((request.args.get("max") or "").strip())
    except Exception:
        return {"ok": False, "error": "min/max must be integers"}, 400

    try:
        limit_results = int((request.args.get("limit") or "100").strip())
        limit_results = max(1, min(limit_results, 300))
    except Exception:
        limit_results = 100

    # cache for 60s per exact query to avoid spam
    cache_key = f"{min_val}:{max_val}:{limit_results}"
    now = time.time()

    with _hof_cache_lock:
        if _hof_cache["key"] == cache_key and (now - _hof_cache["ts"]) < 60 and _hof_cache["data"] is not None:
            return {"ok": True, "cached": True, **_hof_cache["data"]}

    rows, pages = search_hof_workstats(min_val, max_val, limit_results=limit_results)

    data = {
        "cached": False,
        "min": min_val,
        "max": max_val,
        "scanned_pages": pages,
        "count": len(rows),
        "rows": rows,
        "updated_at": utc(),
    }

    with _hof_cache_lock:
        _hof_cache["key"] = cache_key
        _hof_cache["ts"] = now
        _hof_cache["data"] = data

    return {"ok": True, **data}
