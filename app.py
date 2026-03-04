import os
import re
import time
import sqlite3
import secrets
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List

from flask import Flask, jsonify, request

from torn_api import (
    TornAPIError,
    get_user_basic,
    get_user_events,
    get_company_employees,
    get_user_workstats,
    normalize_workstats,
    search_hof_workstats_v2,
)

from db import (
    init_db,
    upsert_user,
    get_user_by_token,
    set_user_company_ids,
    get_user_company_ids,
    upsert_application_rows,
    list_applications,
    update_application_status,
    add_train_entry,
    list_train_entries,
    delete_train_entry,
    cache_get,
    cache_set,
)

app = Flask(__name__)

DB_PATH = (os.getenv("DB_PATH") or "hiring.db").strip()
ADMIN_KEYS = [k.strip() for k in (os.getenv("ADMIN_KEYS") or "").split(",") if k.strip()]
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS") or "2592000")  # 30 days
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS") or "60")  # per-user small cache


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_error(msg: str, code: int = 400):
    return jsonify({"ok": False, "error": msg}), code


def _require_admin_key(admin_key: str) -> bool:
    # If ADMIN_KEYS is empty, nobody can auth (fail closed)
    if not ADMIN_KEYS:
        return False
    return admin_key in ADMIN_KEYS


def _get_token_from_request() -> str:
    # Prefer header, allow query for convenience
    tok = (request.headers.get("X-Session-Token") or "").strip()
    if not tok:
        tok = (request.args.get("token") or "").strip()
    return tok


def require_session() -> Dict[str, Any]:
    tok = _get_token_from_request()
    if not tok:
        raise PermissionError("missing token")
    user = get_user_by_token(DB_PATH, tok, SESSION_TTL_SECONDS)
    if not user:
        raise PermissionError("invalid/expired token")
    return user


@app.before_request
def boot_once():
    init_db(DB_PATH)


@app.get("/")
def index():
    return (
        "7DS*: Peace Hiring Scan is running.\n\n"
        "Endpoints:\n"
        "POST  /api/auth\n"
        "POST  /api/user/companies\n"
        "GET   /api/applications\n"
        "POST  /api/applications/status\n"
        "GET   /api/companies\n"
        "GET   /api/trains\n"
        "POST  /api/trains/add\n"
        "POST  /api/trains/delete\n"
        "GET   /api/applicant\n"
        "GET   /api/search_workstats\n\n"
        "Use the userscript (static/shield.user.js) to access UI.\n",
        200,
        {"Content-Type": "text/plain; charset=utf-8"},
    )


@app.get("/health")
def health():
    return ("ok", 200, {"Content-Type": "text/plain; charset=utf-8"})


# ------------------------
# AUTH
# ------------------------
@app.post("/api/auth")
def api_auth():
    body = request.get_json(silent=True) or {}
    admin_key = (body.get("admin_key") or "").strip()
    api_key = (body.get("api_key") or "").strip()

    if not admin_key or not api_key:
        return _json_error("missing admin_key/api_key", 400)

    if not _require_admin_key(admin_key):
        return _json_error("admin key not allowed", 401)

    # Validate Torn key by pulling basic user info
    try:
        basic = get_user_basic(api_key)
    except TornAPIError as e:
        return _json_error(f"torn api error: {e}", 401)
    except Exception:
        return _json_error("failed to validate api key", 401)

    user_id = str(basic.get("player_id") or basic.get("user_id") or basic.get("id") or "")
    name = (basic.get("name") or basic.get("username") or "").strip()

    if not user_id:
        return _json_error("could not read user_id from api key", 401)

    # Create session token (random)
    token = secrets.token_urlsafe(32)

    upsert_user(
        DB_PATH,
        user_id=user_id,
        name=name,
        api_key=api_key,
        token=token,
        token_created_at=utc(),
        last_seen_at=utc(),
    )

    return jsonify(
        {
            "ok": True,
            "token": token,
            "user": {"id": user_id, "name": name},
        }
    )


@app.post("/api/user/companies")
def api_user_companies():
    try:
        user = require_session()
    except PermissionError as e:
        return _json_error(str(e), 401)

    body = request.get_json(silent=True) or {}
    company_ids_raw = (body.get("company_ids") or "").strip()

    # Accept "123,456" or array
    ids: List[str] = []
    if isinstance(body.get("company_ids"), list):
        ids = [str(x).strip() for x in body["company_ids"] if str(x).strip()]
    else:
        ids = [c.strip() for c in company_ids_raw.split(",") if c.strip()]

    # Normalize digits only
    ids = [re.sub(r"\D+", "", c) for c in ids]
    ids = [c for c in ids if c]

    set_user_company_ids(DB_PATH, user["user_id"], ids)
    return jsonify({"ok": True, "company_ids": ids})


# ------------------------
# APPLICATIONS (pull on demand from user events)
# ------------------------
def _extract_application_events(events_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Torn user events contain strings like '... applied to your company ... [123456]'
    This keeps it broad (schema changes safe).
    """
    events = events_payload.get("events", {}) or {}
    rows: List[Dict[str, Any]] = []

    id_pattern = re.compile(r"\[(\d+)\]")

    # events is usually dict { "event_id": {event,...} }
    for k, v in events.items():
        try:
            eid = int(k)
        except Exception:
            continue
        if not isinstance(v, dict):
            continue
        text = (v.get("event") or "").strip()
        low = text.lower()
        if ("appl" in low or "apply" in low) and "company" in low:
            m = id_pattern.search(text)
            applicant_id = m.group(1) if m else None
            rows.append(
                {
                    "event_id": eid,
                    "applicant_id": applicant_id,
                    "raw_text": text,
                    "created_at": utc(),
                }
            )
    return rows


@app.get("/api/applications")
def api_applications():
    try:
        user = require_session()
    except PermissionError as e:
        return _json_error(str(e), 401)

    # Pull latest events and upsert applications (fast; Torn returns recent events only)
    try:
        events_payload = get_user_events(user["api_key"])
        new_rows = _extract_application_events(events_payload)
        if new_rows:
            upsert_application_rows(DB_PATH, user["user_id"], new_rows)
    except TornAPIError as e:
        return _json_error(f"torn api error: {e}", 400)
    except Exception:
        return _json_error("failed to fetch events", 500)

    rows = list_applications(DB_PATH, user["user_id"], limit=60)
    return jsonify({"ok": True, "rows": rows})


@app.post("/api/applications/status")
def api_applications_status():
    try:
        user = require_session()
    except PermissionError as e:
        return _json_error(str(e), 401)

    body = request.get_json(silent=True) or {}
    app_id = body.get("id")
    status = (body.get("status") or "").strip()

    if not app_id or not status:
        return _json_error("missing id/status", 400)

    update_application_status(DB_PATH, user["user_id"], int(app_id), status)
    return jsonify({"ok": True})


# ------------------------
# COMPANIES + EMPLOYEES (per-user)
# ------------------------
@app.get("/api/companies")
def api_companies():
    try:
        user = require_session()
    except PermissionError as e:
        return _json_error(str(e), 401)

    company_ids = get_user_company_ids(DB_PATH, user["user_id"])
    if not company_ids:
        return jsonify({"ok": True, "updated_at": utc(), "rows": [], "note": "No company IDs set for this user."})

    cache_key = f"companies:{user['user_id']}:{','.join(company_ids)}"
    cached = cache_get(DB_PATH, cache_key, CACHE_TTL_SECONDS)
    if cached is not None:
        return jsonify({"ok": True, "cached": True, **cached})

    rows = []
    for cid in company_ids:
        try:
            payload = get_company_employees(cid, user["api_key"])
            rows.append(
                {
                    "company_id": cid,
                    "name": payload.get("company_name") or payload.get("name") or f"Company {cid}",
                    "employees": payload.get("employees") or [],
                }
            )
        except TornAPIError as e:
            rows.append({"company_id": cid, "name": f"Company {cid}", "employees": [], "error": str(e)})
        except Exception as e:
            rows.append({"company_id": cid, "name": f"Company {cid}", "employees": [], "error": "fetch failed"})

    data = {"updated_at": utc(), "rows": rows}
    cache_set(DB_PATH, cache_key, data)
    return jsonify({"ok": True, "cached": False, **data})


# ------------------------
# TRAIN TRACKER (per-user)
# ------------------------
@app.get("/api/trains")
def api_trains_list():
    try:
        user = require_session()
    except PermissionError as e:
        return _json_error(str(e), 401)

    company_id = (request.args.get("company_id") or "").strip()
    company_id = re.sub(r"\D+", "", company_id)

    if not company_id:
        return _json_error("missing company_id", 400)

    rows = list_train_entries(DB_PATH, user["user_id"], company_id, limit=80)
    return jsonify({"ok": True, "rows": rows})


@app.post("/api/trains/add")
def api_trains_add():
    try:
        user = require_session()
    except PermissionError as e:
        return _json_error(str(e), 401)

    body = request.get_json(silent=True) or {}
    company_id = re.sub(r"\D+", "", (body.get("company_id") or "").strip())
    buyer = (body.get("buyer") or "").strip()
    trains = body.get("trains")
    note = (body.get("note") or "").strip()

    if not company_id or not buyer or trains is None:
        return _json_error("missing company_id/buyer/trains", 400)

    try:
        trains_int = int(trains)
    except Exception:
        return _json_error("trains must be int", 400)

    add_train_entry(DB_PATH, user["user_id"], company_id, buyer, trains_int, note, utc())
    return jsonify({"ok": True})


@app.post("/api/trains/delete")
def api_trains_delete():
    try:
        user = require_session()
    except PermissionError as e:
        return _json_error(str(e), 401)

    body = request.get_json(silent=True) or {}
    entry_id = body.get("id")
    if not entry_id:
        return _json_error("missing id", 400)

    delete_train_entry(DB_PATH, user["user_id"], int(entry_id))
    return jsonify({"ok": True})


# ------------------------
# APPLICANT WORKSTATS (uses user's own key)
# ------------------------
@app.get("/api/applicant")
def api_applicant():
    try:
        user = require_session()
    except PermissionError as e:
        return _json_error(str(e), 401)

    uid = re.sub(r"\D+", "", (request.args.get("id") or "").strip())
    if not uid:
        return _json_error("missing id", 400)

    try:
        payload = get_user_workstats(uid, user["api_key"])
        ws = normalize_workstats(payload)
        return jsonify({"ok": True, "workstats": ws})
    except TornAPIError as e:
        return _json_error(f"torn api error: {e}", 400)
    except Exception:
        return _json_error("failed to fetch workstats", 500)


# ------------------------
# HoF SEARCH (uses user's own key)
# ------------------------
@app.get("/api/search_workstats")
def api_search_workstats():
    try:
        user = require_session()
    except PermissionError as e:
        return _json_error(str(e), 401)

    try:
        min_val = int((request.args.get("min") or "").strip())
        max_val = int((request.args.get("max") or "").strip())
    except Exception:
        return _json_error("min/max must be integers", 400)

    try:
        limit_results = int((request.args.get("limit") or "100").strip())
        limit_results = max(1, min(limit_results, 300))
    except Exception:
        limit_results = 100

    cache_key = f"hof:{user['user_id']}:{min_val}:{max_val}:{limit_results}"
    cached = cache_get(DB_PATH, cache_key, 60)
    if cached is not None:
        return jsonify({"ok": True, "cached": True, **cached})

    try:
        rows, pages = search_hof_workstats_v2(user["api_key"], min_val, max_val, limit_results=limit_results)
    except TornAPIError as e:
        return _json_error(f"torn api error: {e}", 400)
    except Exception:
        return _json_error("HoF search failed", 500)

    data = {
        "cached": False,
        "min": min_val,
        "max": max_val,
        "scanned_pages": pages,
        "count": len(rows),
        "rows": rows,
        "updated_at": utc(),
    }
    cache_set(DB_PATH, cache_key, data)
    return jsonify({"ok": True, **data})
