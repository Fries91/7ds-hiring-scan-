import os
import time
import sqlite3
import asyncio
from datetime import datetime, timezone

from flask import Flask, request, jsonify, Response
import aiohttp

APP_NAME = "7DS Hiring Scan"
DB_PATH = os.getenv("DB_PATH", "hiring.db")
ADMIN_TOKEN = (os.getenv("ADMIN_TOKEN") or "").strip()

app = Flask(__name__)

# ---------------- DB ----------------
def _con():
    return sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)

def init_db():
    con = _con()
    cur = con.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS candidates (
      torn_id INTEGER PRIMARY KEY,
      name TEXT,
      man INTEGER NOT NULL DEFAULT 0,
      intel INTEGER NOT NULL DEFAULT 0,
      endu INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      job_type TEXT NOT NULL DEFAULT 'unknown',   -- none|company|city|unknown
      job_name TEXT,
      verified INTEGER NOT NULL DEFAULT 0,        -- 0/1
      note TEXT,
      updated_at TEXT
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_candidates_total ON candidates(total)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_candidates_man ON candidates(man)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_candidates_intel ON candidates(intel)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_candidates_endu ON candidates(endu)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_candidates_job_type ON candidates(job_type)")
    con.commit()
    con.close()

def upsert_candidate(payload: dict, verified: int = 0):
    now = datetime.now(timezone.utc).isoformat()
    torn_id = int(payload["torn_id"])
    name = (payload.get("name") or "").strip()

    man = int(payload.get("man") or 0)
    intel = int(payload.get("intel") or 0)
    endu = int(payload.get("endu") or 0)
    total = int(payload.get("total") or (man + intel + endu))

    job_type = (payload.get("job_type") or "unknown").strip().lower()
    if job_type not in ("none", "company", "city", "unknown"):
        job_type = "unknown"
    job_name = (payload.get("job_name") or "").strip() or None
    note = (payload.get("note") or "").strip() or None

    con = _con()
    cur = con.cursor()
    cur.execute("""
    INSERT INTO candidates (torn_id, name, man, intel, endu, total, job_type, job_name, verified, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(torn_id) DO UPDATE SET
      name=excluded.name,
      man=excluded.man,
      intel=excluded.intel,
      endu=excluded.endu,
      total=excluded.total,
      job_type=excluded.job_type,
      job_name=excluded.job_name,
      verified=excluded.verified,
      note=excluded.note,
      updated_at=excluded.updated_at
    """, (torn_id, name, man, intel, endu, total, job_type, job_name, int(verified), note, now))
    con.commit()
    con.close()

def query_candidates(filters: dict):
    min_man = int(filters.get("min_man") or 0)
    max_man = int(filters.get("max_man") or 2_000_000_000)
    min_int = int(filters.get("min_int") or 0)
    max_int = int(filters.get("max_int") or 2_000_000_000)
    min_end = int(filters.get("min_end") or 0)
    max_end = int(filters.get("max_end") or 2_000_000_000)
    min_total = int(filters.get("min_total") or 0)
    max_total = int(filters.get("max_total") or 2_000_000_000)

    job_type = (filters.get("job_type") or "any").strip().lower()
    if job_type not in ("any", "none", "company", "city"):
        job_type = "any"

    sort = (filters.get("sort") or "total").strip().lower()
    if sort not in ("man", "intel", "endu", "total", "updated"):
        sort = "total"
    order_col = {"man": "man", "intel": "intel", "endu": "endu", "total": "total", "updated": "updated_at"}[sort]

    sql = """
      SELECT torn_id, name, man, intel, endu, total, job_type, job_name, verified, note, updated_at
      FROM candidates
      WHERE man BETWEEN ? AND ?
        AND intel BETWEEN ? AND ?
        AND endu BETWEEN ? AND ?
        AND total BETWEEN ? AND ?
    """
    params = [min_man, max_man, min_int, max_int, min_end, max_end, min_total, max_total]

    if job_type != "any":
        sql += " AND job_type = ?"
        params.append(job_type)

    sql += f" ORDER BY {order_col} DESC, updated_at DESC LIMIT 250"

    con = _con()
    cur = con.cursor()
    cur.execute(sql, params)
    rows = cur.fetchall()
    con.close()

    out = []
    for r in rows:
        out.append({
            "id": r[0],
            "name": r[1],
            "man": r[2],
            "intel": r[3],
            "endu": r[4],
            "total": r[5],
            "job_type": r[6],
            "job_name": r[7],
            "verified": bool(r[8]),
            "note": r[9],
            "updated_at": r[10],
        })
    return out

# ---------------- Torn verify (player key) ----------------
async def torn_user(key: str):
    url = f"https://api.torn.com/user/?selections=basic,job,workstats&key={key}"
    timeout = aiohttp.ClientTimeout(total=12)
    async with aiohttp.ClientSession(timeout=timeout) as s:
        async with s.get(url) as r:
            return await r.json()

def parse_job_type(job_obj):
    # Torn job object varies by situation; we handle common patterns
    # If can't determine, return unknown.
    if not isinstance(job_obj, dict):
        return ("unknown", None)

    # City job often has "job" / "position" but no company_id
    # Company job often has company-related fields
    # Unemployed sometimes has empty dict
    company_id = job_obj.get("company_id") or job_obj.get("company", {}).get("id")
    company_name = job_obj.get("company_name") or job_obj.get("company", {}).get("name")

    # Some payloads include city job name in "job" or "name"
    city_job_name = job_obj.get("job") or job_obj.get("name") or job_obj.get("position")

    if company_id or company_name:
        return ("company", company_name)

    # If it has something that looks like a city job name/position, treat as city
    if city_job_name:
        return ("city", str(city_job_name))

    # If it's an empty object => none
    if len(job_obj.keys()) == 0:
        return ("none", None)

    return ("unknown", None)

# ---------------- UI (simple iframe-safe page) ----------------
def html_page():
    return f"""<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{APP_NAME}</title>
<style>
body {{ margin:0; font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif; background:#0b0f14; color:#e9eef5; }}
.wrap {{ padding:12px; }}
.card {{ border:1px solid rgba(255,255,255,0.10); background:linear-gradient(180deg, rgba(25,35,50,0.9), rgba(12,16,24,0.9));
border-radius:14px; padding:12px; box-shadow:0 10px 25px rgba(0,0,0,0.35); }}
h1 {{ font-size:16px; margin:0 0 8px; display:flex; align-items:center; gap:8px; }}
.badge {{ width:28px; height:28px; border-radius:10px; display:inline-flex; align-items:center; justify-content:center;
background:radial-gradient(circle at 30% 30%, rgba(255,215,0,0.35), rgba(255,215,0,0.10));
border:1px solid rgba(255,215,0,0.35); }}
.hint {{ font-size:12px; opacity:0.8; line-height:1.35; }}
code {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }}
</style></head><body>
<div class="wrap"><div class="card">
<h1><span class="badge">💼</span> {APP_NAME}</h1>
<div class="hint">Opt-in hiring list + recruiter search. Use /api/submit (manual) or /api/submit_key (verified via player's key).</div>
<div class="hint" style="margin-top:8px;"><b>Recruiter search:</b> <code>/api/search?token=ADMIN_TOKEN&job_type=none&min_total=100000&sort=total</code></div>
</div></div></body></html>"""

# ---------------- Routes ----------------
@app.after_request
def add_headers(resp):
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    resp.headers["Content-Security-Policy"] = "frame-ancestors *"
    return resp

@app.route("/")
def index():
    return Response(html_page(), mimetype="text/html")

@app.route("/health")
def health():
    return jsonify({"ok": True, "service": APP_NAME, "ts": int(time.time())})

@app.route("/api/submit", methods=["POST"])
def api_submit():
    data = request.get_json(silent=True) or {}
    if not str(data.get("torn_id") or "").isdigit():
        return jsonify({"ok": False, "error": "torn_id required"}), 400
    upsert_candidate(data, verified=0)
    return jsonify({"ok": True, "verified": False})

@app.route("/api/submit_key", methods=["POST"])
def api_submit_key():
    data = request.get_json(silent=True) or {}
    key = (data.get("key") or "").strip()
    note = (data.get("note") or "").strip()

    if not key:
        return jsonify({"ok": False, "error": "key required"}), 400

    try:
        raw = asyncio.run(torn_user(key))
    except Exception:
        return jsonify({"ok": False, "error": "torn api request failed"}), 502

    if not isinstance(raw, dict) or raw.get("error"):
        return jsonify({"ok": False, "error": "invalid key or api error", "details": raw.get("error")}), 400

    torn_id = raw.get("player_id") or raw.get("user_id") or raw.get("ID") or raw.get("id")
    name = raw.get("name") or ""
    work = raw.get("workstats") or {}
    job = raw.get("job") or {}

    if not torn_id:
        return jsonify({"ok": False, "error": "could not read torn_id from api"}), 400

    man = int(work.get("manual_labor") or 0)
    intel = int(work.get("intelligence") or 0)
    endu = int(work.get("endurance") or 0)
    total = man + intel + endu

    job_type, job_name = parse_job_type(job)

    upsert_candidate({
        "torn_id": int(torn_id),
        "name": name,
        "man": man,
        "intel": intel,
        "endu": endu,
        "total": total,
        "job_type": job_type,
        "job_name": job_name or "",
        "note": note
    }, verified=1)

    return jsonify({"ok": True, "verified": True, "torn_id": int(torn_id), "name": name, "job_type": job_type, "total": total})

@app.route("/api/search", methods=["GET"])
def api_search():
    token = (request.args.get("token") or "").strip()
    if not ADMIN_TOKEN or token != ADMIN_TOKEN:
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    filters = {
        "min_man": request.args.get("min_man"),
        "max_man": request.args.get("max_man"),
        "min_int": request.args.get("min_int"),
        "max_int": request.args.get("max_int"),
        "min_end": request.args.get("min_end"),
        "max_end": request.args.get("max_end"),
        "min_total": request.args.get("min_total"),
        "max_total": request.args.get("max_total"),
        "job_type": request.args.get("job_type"),
        "sort": request.args.get("sort"),
    }
    rows = query_candidates(filters)
    return jsonify({"ok": True, "count": len(rows), "rows": rows})

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
