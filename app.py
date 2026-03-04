import os
from typing import Any, Dict, Optional

from flask import Flask, jsonify, request
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
    count_unseen_notifications,
    add_train,
    list_trains,
    set_trains_used,
    delete_train,
    add_contract,
    list_contracts,
    delete_contract,
    add_lead,
    list_leads,
    clear_leads,
    mark_leads_seen,
    count_unseen_leads,
)
from torn_api import me_basic, company_profile, hof_scan_workstats, TornAPIError

load_dotenv()
app = Flask(__name__)

ADMIN_KEYS = [k.strip() for k in (os.getenv("ADMIN_KEYS") or "").split(",") if k.strip()]
HOF_PAGE_SIZE = int(os.getenv("HOF_PAGE_SIZE", "100"))


def ok(data: Any, status: int = 200):
    return jsonify({"ok": True, "data": data}), status


def fail(message: str, status: int = 400, extra: Optional[Dict[str, Any]] = None):
    payload = {"ok": False, "error": message}
    if extra:
        payload.update(extra)
    return jsonify(payload), status


@app.get("/health")
def health():
    return "ok", 200


def _require_admin(admin_key: str) -> bool:
    return bool(admin_key) and (admin_key in ADMIN_KEYS)


def _require_session() -> Optional[Dict[str, Any]]:
    token = (request.headers.get("X-Session-Token") or "").strip()
    if not token:
        return None
    s = get_session(token)
    if not s:
        return None
    touch_session(token)
    return s


@app.post("/api/login")
def api_login():
    body = request.get_json(silent=True) or {}
    admin_key = (body.get("admin_key") or "").strip()
    api_key = (body.get("api_key") or "").strip()

    if not _require_admin(admin_key):
        return fail("Invalid admin key.", 403)
    if not api_key:
        return fail("Missing api_key.")

    try:
        me = me_basic(api_key)
    except Exception as e:
        return fail("API key failed.", 401, {"details": str(e)})

    user_id = str(me.get("player_id") or me.get("id") or "")
    name = str(me.get("name") or "")
    if not user_id:
        return fail("Could not read user id from Torn response.", 500, {"raw_keys": list(me.keys())})

    upsert_user(user_id=user_id, name=name, api_key=api_key)
    token = create_session(user_id)

    add_notification(user_id, f"Logged in as {name} [{user_id}].", "info")
    return ok({"token": token, "user_id": user_id, "name": name})


@app.get("/api/state")
def api_state():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    u = get_user(s["user_id"])
    if not u:
        return fail("User not found.", 404)

    touch_user(s["user_id"])
    u_safe = dict(u)
    u_safe.pop("api_key", None)

    unseen = {
        "notifications": count_unseen_notifications(s["user_id"]),
        "leads": count_unseen_leads(s["user_id"]),
    }

    return ok({"me": u_safe, "unseen": unseen})


@app.post("/api/company_ids")
def api_set_company_ids():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    body = request.get_json(silent=True) or {}
    ids = body.get("company_ids", [])
    if not isinstance(ids, list):
        return fail("company_ids must be a list.")
    set_company_ids(s["user_id"], [str(x) for x in ids])
    return ok({"company_ids": [str(x) for x in ids]})


@app.get("/api/company/<company_id>")
def api_company(company_id: str):
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    u = get_user(s["user_id"])
    if not u:
        return fail("User not found.", 404)

    try:
        data = company_profile(u["api_key"], company_id)
    except TornAPIError as e:
        return fail("Torn API error fetching company.", 502, {"details": str(e)})
    except Exception as e:
        return fail("Server error fetching company.", 500, {"details": str(e)})

    return ok(data)


@app.get("/api/hof_scan")
def api_hof_scan():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    u = get_user(s["user_id"])
    if not u:
        return fail("User not found.", 404)

    try:
        min_v = int(request.args.get("min", "0"))
        max_v = int(request.args.get("max", "0"))
    except Exception:
        return fail("min/max must be integers.")

    if max_v <= 0:
        return fail("max must be > 0")

    try:
        data = hof_scan_workstats(u["api_key"], min_v, max_v, page_size=HOF_PAGE_SIZE)
    except TornAPIError as e:
        return fail("Torn API error during HoF scan.", 502, {"details": str(e)})
    except Exception as e:
        return fail("Server error during HoF scan.", 500, {"details": str(e)})

    return ok(data)


# ---- trains ----

@app.get("/api/trains")
def api_list_trains():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)
    return ok(list_trains(s["user_id"]))


@app.post("/api/trains")
def api_add_train():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    body = request.get_json(silent=True) or {}
    company_id = str(body.get("company_id") or "")
    buyer = str(body.get("buyer") or "")
    amount = int(body.get("amount") or 0)
    if amount <= 0:
        return fail("amount must be > 0")

    add_train(s["user_id"], company_id, buyer, amount)
    return ok({"saved": True})


@app.post("/api/trains/used")
def api_train_used():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    body = request.get_json(silent=True) or {}
    train_id = int(body.get("id") or 0)
    used = 1 if body.get("used") else 0
    if train_id <= 0:
        return fail("Missing train id.")

    set_trains_used(s["user_id"], train_id, used)
    return ok({"updated": True})


@app.post("/api/trains/delete")
def api_train_delete():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    body = request.get_json(silent=True) or {}
    train_id = int(body.get("id") or 0)
    if train_id <= 0:
        return fail("Missing train id.")

    delete_train(s["user_id"], train_id)
    return ok({"deleted": True})


# ---- contracts ----

@app.get("/api/contracts")
def api_list_contracts():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)
    return ok(list_contracts(s["user_id"]))


@app.post("/api/contracts")
def api_add_contract():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    body = request.get_json(silent=True) or {}
    title = str(body.get("title") or "").strip()
    note = str(body.get("note") or "").strip()
    if not title:
        return fail("Missing title.")
    add_contract(s["user_id"], title, note)
    return ok({"saved": True})


@app.post("/api/contracts/delete")
def api_contract_delete():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    body = request.get_json(silent=True) or {}
    cid = int(body.get("id") or 0)
    if cid <= 0:
        return fail("Missing contract id.")
    delete_contract(s["user_id"], cid)
    return ok({"deleted": True})


# ---- leads ----

@app.get("/api/leads")
def api_list_leads():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)
    return ok(list_leads(s["user_id"]))


@app.post("/api/leads")
def api_add_lead():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    body = request.get_json(silent=True) or {}
    player_id = str(body.get("player_id") or "")
    name = str(body.get("name") or "")
    value = int(body.get("value") or 0)
    note = str(body.get("note") or "")
    add_lead(s["user_id"], player_id, name, value, note)
    return ok({"saved": True})


@app.post("/api/leads/seen")
def api_leads_seen():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)
    mark_leads_seen(s["user_id"])
    return ok({"seen": True})


@app.post("/api/leads/clear")
def api_leads_clear():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)
    clear_leads(s["user_id"])
    return ok({"cleared": True})


# ---- notifications ----

@app.get("/api/notifications")
def api_notifications():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)
    return ok(list_notifications(s["user_id"]))


@app.post("/api/notifications/seen")
def api_notifications_seen():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)
    mark_notifications_seen(s["user_id"])
    return ok({"seen": True})


@app.errorhandler(Exception)
def handle_any_error(e):
    return fail("Unhandled error.", 500, {"details": str(e)})


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
