import os
import sqlite3
import time
from datetime import datetime, timezone

import requests
from flask import Flask, request, jsonify, Response

app = Flask(__name__)

# ===== ENV =====
TORN_API_KEY = (os.getenv("TORN_API_KEY") or "").strip()   # YOUR key for HoF scanning
ADMIN_TOKEN  = (os.getenv("ADMIN_TOKEN") or "").strip()    # protects admin endpoints
DB_PATH      = os.getenv("DB_PATH", "hiring_scan.db")

# ===== CONSTANTS =====
HOF_URL = "https://api.torn.com/v2/torn/hof"
USER_URL = "https://api.torn.com/v2/user"  # key-owner fetch (personalstats)

CACHE_TTL = 90
_page_cache = {}  # (offset, limit) -> (ts, rows)

RECRUIT_MESSAGE = "looking to hire if you can reply with working stats or an limited API key"

# ===== DB =====
def _con():
    con = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    con = _con()
    cur = con.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS applicants (
        torn_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        manuallabor INTEGER NOT NULL,
        intelligence INTEGER NOT NULL,
        endurance INTEGER NOT NULL,
        total INTEGER NOT NULL,
        source TEXT NOT NULL, -- 'manual' or 'apikey'
        updated_at TEXT NOT NULL
    )
    """)
    con.commit()
    con.close()

init_db()

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def iframe_safe_html(body: str) -> Response:
    return Response(
        body,
        headers={
            "Content-Type": "text/html; charset=utf-8",
            "X-Frame-Options": "ALLOWALL",
            "Content-Security-Policy": "frame-ancestors *;",
        },
    )

def require_admin(req) -> bool:
    return (req.headers.get("X-ADMIN-TOKEN") or "").strip() == ADMIN_TOKEN

# ===== HOME / HEALTH =====
@app.get("/")
def home():
    return iframe_safe_html(f"""
<!doctype html>
<meta charset="utf-8"/>
<title>7DS Hiring Scan</title>
<body style="font-family:system-ui;background:#0b0f16;color:#e8eefc;padding:16px">
  <h2>7DS Hiring Scan ✅ Running</h2>
  <p><b>Public:</b> <code>/apply</code> (candidates submit stats or limited key)</p>
  <p><b>Admin JSON:</b> <code>/state?min=100000&max=200000&limit=50</code> (HoF scan, token required)</p>
  <p><b>Admin Applicants:</b> <code>/api/applicants</code> (token required)</p>
  <p><b>Recruit message:</b> {RECRUIT_MESSAGE}</p>
</body>
""")

@app.get("/health")
def health():
    return jsonify({"ok": True})

# ===== PUBLIC APPLY PAGE =====
@app.get("/apply")
def apply_page():
    # simple public form – posts to /api/apply
    return iframe_safe_html(f"""
<!doctype html>
<meta charset="utf-8"/>
<title>Apply - 7DS Hiring</title>
<body style="font-family:system-ui;background:#0b0f16;color:#e8eefc;padding:16px;max-width:680px">
  <h2>Apply for Company</h2>
  <p>Option A: enter your MAN / INT / END.</p>
  <p>Option B: paste a <b>limited/custom API key</b> that allows <b>user → personalstats</b> so we can fetch your work stats once.</p>
  <p style="opacity:.8">You can revoke your key anytime in Torn settings.</p>

  <form id="f" style="display:grid;gap:10px">
    <input name="name" placeholder="Your Torn name" required
      style="padding:10px;border-radius:10px;border:1px solid #2a3550;background:#121a29;color:#e8eefc"/>
    <input name="torn_id" placeholder="Your Torn ID (digits)" required
      style="padding:10px;border-radius:10px;border:1px solid #2a3550;background:#121a29;color:#e8eefc"/>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <input name="manuallabor" placeholder="Manual (optional)"
        style="padding:10px;border-radius:10px;border:1px solid #2a3550;background:#121a29;color:#e8eefc"/>
      <input name="intelligence" placeholder="Intelligence (optional)"
        style="padding:10px;border-radius:10px;border:1px solid #2a3550;background:#121a29;color:#e8eefc"/>
      <input name="endurance" placeholder="Endurance (optional)"
        style="padding:10px;border-radius:10px;border:1px solid #2a3550;background:#121a29;color:#e8eefc"/>
    </div>

    <input name="api_key" placeholder="Limited/Custom API key (optional)"
      style="padding:10px;border-radius:10px;border:1px solid #2a3550;background:#121a29;color:#e8eefc"/>

    <button type="submit"
      style="padding:10px;border-radius:10px;border:1px solid #3a4c78;background:linear-gradient(#2a3a5e,#17243e);color:#e8eefc;font-weight:800;cursor:pointer">
      Submit
    </button>

    <div id="msg" style="opacity:.85"></div>
  </form>

<script>
  const f = document.getElementById('f');
  const msg = document.getElementById('msg');
  f.addEventListener('submit', async (e) => {{
    e.preventDefault();
    msg.textContent = 'Submitting...';
    const fd = new FormData(f);
    const payload = Object.fromEntries(fd.entries());
    const res = await fetch('/api/apply', {{
      method:'POST',
      headers: {{'Content-Type':'application/json'}},
      body: JSON.stringify(payload)
    }});
    const data = await res.json();
    msg.textContent = data.ok ? '✅ Submitted. Thanks!' : ('❌ ' + (data.error || 'Failed'));
    if (data.ok) f.reset();
  }});
</script>
</body>
""")

# ===== APPLY API (PUBLIC) =====
@app.post("/api/apply")
def api_apply():
    """
    Public. Accept either:
    - manual manuallabor/intelligence/endurance
    - or api_key to fetch personalstats for key-owner
    """
    data = request.get_json(force=True, silent=True) or {}

    name = str(data.get("name") or "").strip()
    torn_id_raw = str(data.get("torn_id") or "").strip()
    api_key = str(data.get("api_key") or "").strip()

    if not name:
        return jsonify({"ok": False, "error": "Missing name"}), 400
    try:
        torn_id = int(torn_id_raw)
    except Exception:
        return jsonify({"ok": False, "error": "Invalid Torn ID"}), 400

    # Option B: API key fetch
    if api_key:
        try:
            stats = fetch_workstats_from_key(api_key)
            manuallabor = int(stats["manuallabor"])
            intelligence = int(stats["intelligence"])
            endurance = int(stats["endurance"])
            source = "apikey"
        except Exception as e:
            return jsonify({"ok": False, "error": f"API key failed: {str(e)}"}), 400
    else:
        # Option A: manual numbers
        try:
            manuallabor = int(str(data.get("manuallabor") or "").replace(",", "").strip())
            intelligence = int(str(data.get("intelligence") or "").replace(",", "").strip())
            endurance = int(str(data.get("endurance") or "").replace(",", "").strip())
            source = "manual"
        except Exception:
            return jsonify({"ok": False, "error": "Enter MAN/INT/END or provide an API key"}), 400

    total = manuallabor + intelligence + endurance

    con = _con()
    cur = con.cursor()
    cur.execute("""
      INSERT INTO applicants (torn_id,name,manuallabor,intelligence,endurance,total,source,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(torn_id) DO UPDATE SET
        name=excluded.name,
        manuallabor=excluded.manuallabor,
        intelligence=excluded.intelligence,
        endurance=excluded.endurance,
        total=excluded.total,
        source=excluded.source,
        updated_at=excluded.updated_at
    """, (torn_id, name, manuallabor, intelligence, endurance, total, source, now_iso()))
    con.commit()
    con.close()

    return jsonify({"ok": True, "torn_id": torn_id, "total": total, "source": source})

def fetch_workstats_from_key(api_key: str):
    """
    Fetch key-owner personalstats and extract work stats.
    According to TornAPI docs, personalstats includes manuallabor/intelligence/endurance fields. :contentReference[oaicite:2]{index=2}
    """
    params = {
        "key": api_key,
        "selections": "personalstats"
    }
    r = requests.get(USER_URL, params=params, timeout=20)
    r.raise_for_status()
    data = r.json()

    # common shape: { "personalstats": { ... } }
    ps = data.get("personalstats") or {}
    # field names in docs: manuallabor, intelligence, endurance :contentReference[oaicite:3]{index=3}
    needed = ["manuallabor", "intelligence", "endurance"]
    for k in needed:
        if k not in ps:
            raise RuntimeError("personalstats missing required fields (check key selections)")
    return ps

# ===== ADMIN: APPLICANTS LIST =====
@app.get("/api/applicants")
def api_applicants():
    if not require_admin(request):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    sort = (request.args.get("sort") or "total").strip().lower()
    if sort not in {"manuallabor", "intelligence", "endurance", "total", "updated_at"}:
        sort = "total"

    con = _con()
    rows = [dict(r) for r in con.execute(
        f"SELECT torn_id,name,manuallabor,intelligence,endurance,total,source,updated_at "
        f"FROM applicants ORDER BY {sort} DESC LIMIT 500"
    ).fetchall()]
    con.close()

    return jsonify({"ok": True, "rows": rows, "message": RECRUIT_MESSAGE})

# ===== ADMIN: HOF TOTAL SCAN (WAR-BOT STYLE /state) =====
def fetch_hof_page(offset: int, limit: int):
    key = (offset, limit)
    now = time.time()

    if key in _page_cache and (now - _page_cache[key][0]) < CACHE_TTL:
        return _page_cache[key][1]

    if not TORN_API_KEY:
        raise RuntimeError("TORN_API_KEY not set")

    params = {"key": TORN_API_KEY, "cat": "workstats", "offset": offset, "limit": limit}
    r = requests.get(HOF_URL, params=params, timeout=20)
    r.raise_for_status()
    data = r.json()

    rows = data.get("hof") or data.get("hall_of_fame") or data.get("data") or []
    out = []
    for item in rows:
        pos = item.get("position") or item.get("rank") or item.get("pos")
        uid = item.get("user_id") or item.get("ID") or item.get("id")
        name = item.get("name") or item.get("username") or item.get("player")
        val = item.get("value") or item.get("score") or item.get("stat")
        try:
            uid = int(uid); val = int(val)
        except Exception:
            continue
        try:
            pos = int(pos) if pos is not None else None
        except Exception:
            pos = None
        out.append({"position": pos, "user_id": uid, "name": name or str(uid), "value": val})

    _page_cache[key] = (now, out)
    return out

def get_value_at(offset: int):
    rows = fetch_hof_page(offset, 1)
    return rows[0]["value"] if rows else None

def find_first_leq(target_value: int, hi_guess: int = 1500000):
    lo, hi = 0, hi_guess
    best = None
    for _ in range(24):
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

@app.get("/state")
def state():
    if not require_admin(request):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    try:
        min_v = int((request.args.get("min") or "").strip())
        max_v = int((request.args.get("max") or "").strip())
        limit = int((request.args.get("limit") or "50").strip())
        limit = max(1, min(limit, 200))
    except Exception:
        return jsonify({"ok": False, "error": "min/max/limit must be integers"}), 400

    if min_v <= 0 or max_v <= 0 or min_v > max_v:
        return jsonify({"ok": False, "error": "Use positive digits and min <= max"}), 400

    start = find_first_leq(max_v)
    if start is None:
        return jsonify({"ok": True, "rows": [], "meta": {"min": min_v, "max": max_v, "limit": limit}})

    rows = []
    offset = start
    budget = 25

    while len(rows) < limit and budget > 0:
        page = fetch_hof_page(offset, min(100, limit - len(rows)))
        budget -= 1
        if not page:
            break
        for item in page:
            if item["value"] < min_v:
                return jsonify({"ok": True, "rows": rows, "meta": {"min": min_v, "max": max_v, "limit": limit}})
            if min_v <= item["value"] <= max_v:
                rows.append(item)
                if len(rows) >= limit:
                    break
        offset += len(page)

    return jsonify({"ok": True, "rows": rows, "meta": {"min": min_v, "max": max_v, "limit": limit}})
