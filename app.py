import os
import time
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

TORN_API_KEY = (os.getenv("TORN_API_KEY") or "").strip()
ADMIN_TOKEN  = (os.getenv("ADMIN_TOKEN") or "").strip()

API_BASE = "https://api.torn.com/v2/torn/hof"

# simple in-memory cache to reduce calls
CACHE_TTL = 60  # seconds
_page_cache = {}  # (offset, limit) -> (ts, rows)

def require_admin(req) -> bool:
    return (req.headers.get("X-ADMIN-TOKEN") or "").strip() == ADMIN_TOKEN

def fetch_hof_page(offset: int, limit: int):
    """Returns list of rows with: position, user_id, name, value (TOTAL workstats)."""
    key = (offset, limit)
    now = time.time()
    if key in _page_cache and (now - _page_cache[key][0]) < CACHE_TTL:
        return _page_cache[key][1]

    if not TORN_API_KEY:
        raise RuntimeError("TORN_API_KEY not set")

    params = {"key": TORN_API_KEY, "cat": "workstats", "offset": offset, "limit": limit}
    r = requests.get(API_BASE, params=params, timeout=20)
    r.raise_for_status()
    data = r.json()

    # API response shape can vary; try common keys
    rows = (
        data.get("hof")
        or data.get("hall_of_fame")
        or data.get("data")
        or []
    )

    out = []
    for item in rows:
        # try common field names
        pos = item.get("position") or item.get("rank") or item.get("pos")
        uid = item.get("user_id") or item.get("ID") or item.get("id")
        name = item.get("name") or item.get("username") or item.get("player")
        val = item.get("value") or item.get("score") or item.get("stat")

        # normalize
        try:
            pos = int(pos) if pos is not None else None
        except Exception:
            pos = None
        try:
            uid = int(uid) if uid is not None else None
        except Exception:
            uid = None
        try:
            val = int(val) if val is not None else None
        except Exception:
            val = None

        if uid is None or val is None:
            continue

        out.append({"position": pos, "user_id": uid, "name": name or str(uid), "value": val})

    _page_cache[key] = (now, out)
    return out

def get_value_at(offset: int):
    rows = fetch_hof_page(offset, 1)
    if not rows:
        return None
    return rows[0]["value"]

def find_first_leq(target_value: int, hi_guess: int = 1500000):
    """
    Binary search for first leaderboard position where value <= target_value.
    We need an upper bound for positions; hi_guess is a safe large guess.
    """
    lo, hi = 0, hi_guess
    best = None
    # basic guard to avoid endless calls
    for _ in range(24):  # ~16M range
        mid = (lo + hi) // 2
        v = get_value_at(mid)
        if v is None:
            hi = mid - 1
            continue

        if v <= target_value:
            best = mid
            hi = mid - 1
        else:
            lo = mid + 1

        if lo > hi:
            break
    return best

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/api/search")
def api_search():
    """
    Query:
      min=digits   (inclusive)
      max=digits   (inclusive)
      limit=1..200 (how many to return)
    Returns:
      rows: [{user_id,name,value,position}]
      next_offset: for pagination (optional)
    """
    if not require_admin(request):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    try:
        min_v = int((request.args.get("min") or "0").strip())
        max_v = int((request.args.get("max") or "0").strip())
        limit = int((request.args.get("limit") or "50").strip())
        limit = max(1, min(limit, 200))
    except Exception:
        return jsonify({"ok": False, "error": "min/max/limit must be integers"}), 400

    if min_v <= 0 or max_v <= 0 or min_v > max_v:
        return jsonify({"ok": False, "error": "Use positive digits and min <= max"}), 400

    # Find where values drop to <= max_v
    start = find_first_leq(max_v)
    if start is None:
        return jsonify({"ok": True, "rows": []})

    # Now stream forward until we pass below min_v or hit limit
    rows = []
    offset = start
    requests_budget = 30  # keep under rate limits

    while len(rows) < limit and requests_budget > 0:
        page = fetch_hof_page(offset, min(100, limit - len(rows)))
        requests_budget -= 1
        if not page:
            break

        for item in page:
            if item["value"] < min_v:
                # below range; stop completely
                return jsonify({"ok": True, "rows": rows})
            if min_v <= item["value"] <= max_v:
                rows.append(item)
                if len(rows) >= limit:
                    break

        offset += len(page)

    # If we filled the limit and might have more, provide next_offset
    next_offset = offset if len(rows) >= limit else None
    return jsonify({"ok": True, "rows": rows, "next_offset": next_offset})
