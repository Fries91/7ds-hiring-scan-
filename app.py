import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, request, send_from_directory, render_template_string
from dotenv import load_dotenv

from db import (
    init_db,
    upsert_user,
    get_user,
    set_company_ids,
    touch_user,
    create_session,
    get_session,
    touch_session,
    add_notification,
    list_notifications,
    mark_notifications_seen,
    add_train,
    list_trains,
    set_trains_used,
    delete_train,
    add_contract,
    list_contracts,
    delete_contract,
)
from torn_api import me_basic, company_profile, hof_scan_workstats

load_dotenv()
app = Flask(__name__)

init_db()

ADMIN_KEYS = [x.strip() for x in (os.getenv("ADMIN_KEYS") or "").split(",") if x.strip()]
DB_MAX_HOF_PAGES = int(os.getenv("MAX_HOF_PAGES", "10"))
SERVICE_NAME = os.getenv("SERVICE_NAME", "7DS*: Peace Hiring/Company Hub")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bad(msg: str, code: int = 400):
    return jsonify({"ok": False, "error": msg}), code


def _is_admin_key(k: str) -> bool:
    return bool(k and k.strip() and k.strip() in ADMIN_KEYS)


def _token() -> str:
    return (request.headers.get("X-Session-Token") or "").strip()


def _require_session() -> Optional[Dict[str, Any]]:
    t = _token()
    if not t:
        return None
    s = get_session(t)
    if not s:
        return None
    touch_session(t)
    return s


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": SERVICE_NAME, "time": _utc_now()})


@app.get("/static/<path:path>")
def static_files(path: str):
    return send_from_directory("static", path)


@app.get("/")
def home():
    return render_template_string(
        """
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{service}}</title>
<style>
  body{font-family:system-ui;background:#0b0f14;color:#e9eef6;margin:0;padding:18px}
  .wrap{max-width:920px;margin:0 auto}
  .card{background:#0f1722;border:1px solid #203042;border-radius:16px;padding:14px;margin:12px 0}
  code{background:#0b0f14;padding:2px 8px;border-radius:10px}
  .muted{opacity:.85;font-size:13px}
</style>
</head>
<body>
<div class="wrap">
  <h2>{{service}}</h2>
  <div class="card">
    <b>Install overlay</b>
    <div class="muted" style="margin-top:8px">
      Use: <code>/static/shield.user.js</code><br>
      In the script, change BASE_URL to this service domain.
    </div>
  </div>
  <div class="card muted">
    <b>Key handling</b><br>
    Users enter their own Torn API key in the overlay. This service stores it to fetch company + HoF scan data.
    Only share admin keys with people you trust.
  </div>
</div>
</body>
</html>
        """,
        service=SERVICE_NAME,
    )


# -------- AUTH ----------
@app.post("/api/auth")
def api_auth():
    data = request.get_json(force=True) or {}
    admin_key = (data.get("admin_key") or "").strip()
    api_key = (data.get("api_key") or "").strip()

    if not _is_admin_key(admin_key):
        return _bad("Invalid admin key", 403)
    if not api_key or len(api_key) < 8:
        return _bad("Missing/invalid api_key")

    # Validate key and identify user
    try:
        me = me_basic(api_key)
    except Exception as e:
        return _bad(f"API key validation failed: {e}")

    user_id = str(me.get("player_id") or me.get("user_id") or me.get("playerid") or "")
    name = (me.get("name") or "").strip()
    if not user_id or not re.fullmatch(r"\\d+", user_id):
        return _bad("Could not read user id from Torn response")

    upsert_user(user_id=user_id, name=name, api_key=api_key)
    token = create_session(user_id)
    add_notification(user_id, "system", "Authenticated successfully.")
    return jsonify({"ok": True, "token": token, "user_id": user_id, "name": name})


# -------- USER SETTINGS ----------
@app.post("/api/user/companies")
def api_user_companies():
    s = _require_session()
    if not s:
        return _bad("Missing/invalid session token", 403)

    data = request.get_json(force=True) or {}
    company_ids = data.get("company_ids") or []

    if not isinstance(company_ids, list) or not company_ids:
        return _bad("company_ids must be a non-empty list")

    company_ids = [str(x).strip() for x in company_ids if str(x).strip()]
    if not all(re.fullmatch(r"\\d+", cid) for cid in company_ids):
        return _bad("All company_ids must be numeric")

    user_id = s["user_id"]
    set_company_ids(user_id, company_ids)
    add_notification(user_id, "system", f"Saved {len(company_ids)} company id(s).")
    return jsonify({"ok": True, "company_ids": company_ids})


@app.post("/api/notifications/seen")
def api_notifs_seen():
    s = _require_session()
    if not s:
        return _bad("Missing/invalid session token", 403)
    mark_notifications_seen(s["user_id"])
    return jsonify({"ok": True})


# -------- STATE (CSP-SAFE) ----------
@app.get("/state")
def state():
    s = _require_session()
    if not s:
        return jsonify({"ok": False, "error": "No session"}), 403

    user_id = s["user_id"]
    u = get_user(user_id)
    if not u:
        return _bad("User missing", 403)

    touch_user(user_id)

    company_ids: List[str] = u.get("company_ids") or []
    selected_company_id = (request.args.get("company_id") or "").strip()
    if not selected_company_id and company_ids:
        selected_company_id = company_ids[0]
    if selected_company_id and selected_company_id not in company_ids:
        selected_company_id = company_ids[0] if company_ids else ""

    notifs = list_notifications(user_id, limit=10)
    unseen = sum(1 for n in notifs if int(n.get("seen") or 0) == 0)

    out: Dict[str, Any] = {
        "ok": True,
        "service": SERVICE_NAME,
        "user": {"user_id": user_id, "name": u.get("name") or ""},
        "company_ids": company_ids,
        "selected_company_id": selected_company_id,
        "company": None,
        "employees": [],
        "stats": {},
        "trains": [],
        "contracts": [],
        "notifications": notifs,
        "unseen_count": unseen,
        "updated_at": _utc_now(),
    }

    if selected_company_id:
        try:
            c = company_profile(selected_company_id, u["api_key"])
            out["company"] = {
                "id": selected_company_id,
                "name": (c.get("company", {}) or {}).get("name") if isinstance(c.get("company"), dict) else c.get("name"),
                "rating": (c.get("company", {}) or {}).get("rating") if isinstance(c.get("company"), dict) else c.get("rating"),
            }

            employees = c.get("company_employees") or c.get("employees") or {}
            rows = []
            if isinstance(employees, dict):
                for eid, e in employees.items():
                    if isinstance(e, dict):
                        rows.append({"id": str(eid), **e})
            elif isinstance(employees, list):
                rows = employees

            # Normalize
            now = datetime.now(timezone.utc)
            norm = []
            inactive_3d = 0

            for e in rows:
                name = e.get("name") or e.get("username") or ""
                last_ts = None
                la = e.get("last_action")
                if isinstance(la, dict) and la.get("timestamp"):
                    last_ts = la.get("timestamp")
                elif isinstance(la, (int, str)):
                    try:
                        last_ts = int(la)
                    except Exception:
                        last_ts = None

                inactive_days = None
                try:
                    if last_ts:
                        dt = datetime.fromtimestamp(int(last_ts), tz=timezone.utc)
                        inactive_days = (now - dt).days
                except Exception:
                    inactive_days = None

                if inactive_days is not None and inactive_days >= 3:
                    inactive_3d += 1

                norm.append(
                    {
                        "id": str(e.get("id") or e.get("employee_id") or ""),
                        "name": name,
                        "position": e.get("position") or e.get("job") or "",
                        "effectiveness": e.get("effectiveness") or e.get("efficiency"),
                        "man": e.get("manual_labor") or e.get("man"),
                        "int": e.get("intelligence") or e.get("int"),
                        "end": e.get("endurance") or e.get("end"),
                        "inactive_days": inactive_days,
                    }
                )

            out["employees"] = norm
            out["stats"] = {"employee_count": len(norm), "inactive_3d_plus": inactive_3d}

            out["trains"] = list_trains(user_id, selected_company_id)
            out["contracts"] = list_contracts(user_id, selected_company_id)

        except Exception as e:
            out["company_error"] = str(e)

    return jsonify(out)


# -------- TRAINS ----------
@app.post("/api/trains/add")
def trains_add():
    s = _require_session()
    if not s:
        return _bad("Missing/invalid session token", 403)
    user_id = s["user_id"]
    u = get_user(user_id)
    if not u:
        return _bad("User missing", 403)

    data = request.get_json(force=True) or {}
    company_id = (data.get("company_id") or "").strip()
    buyer_name = (data.get("buyer_name") or "").strip()
    trains_bought = int(data.get("trains_bought") or 0)
    note = (data.get("note") or "").strip()

    if company_id not in (u.get("company_ids") or []):
        return _bad("company_id not registered", 403)
    if not buyer_name or trains_bought <= 0:
        return _bad("buyer_name and trains_bought required")

    add_train(user_id, company_id, buyer_name, trains_bought, note)
    add_notification(user_id, "trains", f"Added: {buyer_name} bought {trains_bought} trains.")
    return jsonify({"ok": True})


@app.post("/api/trains/set_used")
def trains_set_used():
    s = _require_session()
    if not s:
        return _bad("Missing/invalid session token", 403)
    user_id = s["user_id"]

    data = request.get_json(force=True) or {}
    train_id = int(data.get("id") or 0)
    used = int(data.get("trains_used") or 0)
    if train_id <= 0 or used < 0:
        return _bad("bad id/used")

    set_trains_used(user_id, train_id, used)
    return jsonify({"ok": True})


@app.post("/api/trains/delete")
def trains_delete():
    s = _require_session()
    if not s:
        return _bad("Missing/invalid session token", 403)
    user_id = s["user_id"]

    data = request.get_json(force=True) or {}
    train_id = int(data.get("id") or 0)
    if train_id <= 0:
        return _bad("bad id")

    delete_train(user_id, train_id)
    add_notification(user_id, "trains", f"Deleted train record #{train_id}.")
    return jsonify({"ok": True})


# -------- CONTRACTS ----------
@app.post("/api/contracts/add")
def contracts_add():
    s = _require_session()
    if not s:
        return _bad("Missing/invalid session token", 403)
    user_id = s["user_id"]
    u = get_user(user_id)
    if not u:
        return _bad("User missing", 403)

    data = request.get_json(force=True) or {}
    company_id = (data.get("company_id") or "").strip()
    title = (data.get("title") or "").strip()
    employee_id = (data.get("employee_id") or "").strip()
    employee_name = (data.get("employee_name") or "").strip()
    expires_at = (data.get("expires_at") or "").strip()
    note = (data.get("note") or "").strip()

    if company_id not in (u.get("company_ids") or []):
        return _bad("company_id not registered", 403)
    if not title:
        return _bad("title required")

    add_contract(user_id, company_id, title, employee_id, employee_name, expires_at, note)
    add_notification(user_id, "contract", f"Added contract: {title}")
    return jsonify({"ok": True})


@app.post("/api/contracts/delete")
def contracts_delete():
    s = _require_session()
    if not s:
        return _bad("Missing/invalid session token", 403)
    user_id = s["user_id"]

    data = request.get_json(force=True) or {}
    contract_id = int(data.get("id") or 0)
    if contract_id <= 0:
        return _bad("bad id")

    delete_contract(user_id, contract_id)
    add_notification(user_id, "contract", f"Deleted contract #{contract_id}.")
    return jsonify({"ok": True})


# -------- HOF SEARCH ----------
@app.post("/api/search/hof")
def search_hof():
    s = _require_session()
    if not s:
        return _bad("Missing/invalid session token", 403)
    user_id = s["user_id"]
    u = get_user(user_id)
    if not u:
        return _bad("User missing", 403)

    data = request.get_json(force=True) or {}

    def _i(k: str, default: int) -> int:
        try:
            return int(data.get(k) or default)
        except Exception:
            return int(default)

    min_man = _i("min_man", 0)
    max_man = _i("max_man", 10**12)
    min_int = _i("min_int", 0)
    max_int = _i("max_int", 10**12)
    min_end = _i("min_end", 0)
    max_end = _i("max_end", 10**12)

    try:
        rows = hof_scan_workstats(
            api_key=u["api_key"],
            min_man=min_man, max_man=max_man,
            min_int=min_int, max_int=max_int,
            min_end=min_end, max_end=max_end,
            max_pages=DB_MAX_HOF_PAGES,
            page_size=25,
        )
        return jsonify({"ok": True, "count": len(rows), "rows": rows[:200]})
    except Exception as e:
        return _bad(f"HoF scan failed: {e}")
