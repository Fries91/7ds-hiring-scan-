# app.py
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
    add_train,
    list_trains,
    set_trains_used,
    delete_train,
)
from torn_api import me_basic, hof_scan_workstats, TornAPIError

load_dotenv()

app = Flask(__name__)

ADMIN_KEYS = [k.strip() for k in (os.getenv("ADMIN_KEYS") or "").split(",") if k.strip()]

# Tune HoF performance
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
    """
    User provides:
      - admin_key (must be one of ADMIN_KEYS)
      - api_key (their own torn api key)
    Returns session token.
    """
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

    # Normalize v2 user payload a bit
    user_id = str(me.get("player_id") or me.get("id") or "")
    name = str(me.get("name") or "")

    if not user_id:
        return fail("Could not read user id from Torn response.", 500, {"raw_keys": list(me.keys())})

    upsert_user(user_id=user_id, name=name, api_key=api_key)
    token = create_session(user_id)

    return ok({"token": token, "user_id": user_id, "name": name})


@app.get("/api/me")
def api_me():
    s = _require_session()
    if not s:
        return fail("Missing/invalid session.", 401)

    u = get_user(s["user_id"])
    if not u:
        return fail("User not found.", 404)

    touch_user(s["user_id"])
    # Never echo api_key to the client
    u.pop("api_key", None)
    return ok(u)


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


@app.get("/api/hof_scan")
def api_hof_scan():
    """
    Query params:
      min=500&max=120000
    Returns HoF workstats entries whose "value" is inside that range.
    """
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

    api_key = u["api_key"]
    try:
        data = hof_scan_workstats(api_key, min_v, max_v, page_size=HOF_PAGE_SIZE)
    except TornAPIError as e:
        return fail("Torn API error during HoF scan.", 502, {"details": str(e)})
    except Exception as e:
        return fail("Server error during HoF scan.", 500, {"details": str(e)})

    return ok(data)


@app.errorhandler(Exception)
def handle_any_error(e):
    # Always return JSON (so userscript never hits "bad json")
    return fail("Unhandled error.", 500, {"details": str(e)})


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
