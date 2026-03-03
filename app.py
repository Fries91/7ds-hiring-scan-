import os
import time
import sqlite3
from datetime import datetime, timezone
from flask import Flask, request, jsonify, Response

APP_NAME = "7DS Hiring Scan"
DB_PATH = os.getenv("DB_PATH", "hiring.db")

ADMIN_TOKEN = (os.getenv("ADMIN_TOKEN") or "").strip()   # YOU (recruiter) token
PUBLIC_BASE_URL = (os.getenv("PUBLIC_BASE_URL") or "").strip()  # e.g. https://sevends-hiring-scan.onrender.com

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
      verified INTEGER NOT NULL DEFAULT 0,        -- 0/1 (if you later verify via key)
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

def upsert_candidate(payload: dict):
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT verified FROM candidates WHERE torn_id=?), 0), ?, ?)
    ON CONFLICT(torn_id) DO UPDATE SET
      name=excluded.name,
      man=excluded.man,
      intel=excluded.intel,
      endu=excluded.endu,
      total=excluded.total,
      job_type=excluded.job_type,
      job_name=excluded.job_name,
      note=excluded.note,
      updated_at=excluded.updated_at
    """, (torn_id, name, man, intel, endu, total, job_type, job_name, torn_id, note, now))
    con.commit()
    con.close()

def query_candidates(filters: dict):
    # filters: min/max per stat, job_type, sort
    min_man = int(filters.get("min_man") or 0)
    max_man = int(filters.get("max_man") or 2_000_000_000)

    min_int = int(filters.get("min_int") or 0)
    max_int = int(filters.get("max_int") or 2_000_000_000)

    min_end = int(filters.get("min_end") or 0)
    max_end = int(filters.get("max_end") or 2_000_000_000)

    min_total = int(filters.get("min_total") or 0)
    max_total = int(filters.get("max_total") or 2_000_000_000)

    job_type = (filters.get("job_type") or "any").strip().lower()  # any|none|company|city
    if job_type not in ("any", "none", "company", "city"):
        job_type = "any"

    sort = (filters.get("sort") or "total").strip().lower()  # man|intel|endu|total|updated
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

# ---------------- UI (simple embedded panel) ----------------
def html_page():
    # keep this CSP/iframe-safe for Torn
    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{APP_NAME}</title>
<style>
  body {{
    margin:0; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif;
    background: #0b0f14; color:#e9eef5;
  }}
  .wrap {{ padding:12px; }}
  .card {{
    border:1px solid rgba(255,255,255,0.10);
    background: linear-gradient(180deg, rgba(25,35,50,0.9), rgba(12,16,24,0.9));
    border-radius:14px;
    padding:12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.35);
  }}
  h1 {{ font-size:16px; margin:0 0 8px; display:flex; align-items:center; gap:8px; }}
  .badge {{
    display:inline-flex; align-items:center; justify-content:center;
    width:28px; height:28px; border-radius:10px;
    background: radial-gradient(circle at 30% 30%, rgba(255,215,0,0.35), rgba(255,215,0,0.10));
    border:1px solid rgba(255,215,0,0.35);
  }}
  .row {{ display:flex; gap:8px; flex-wrap:wrap; }}
  .row > div {{ flex:1 1 130px; min-width:130px; }}
  label {{ font-size:12px; opacity:0.85; display:block; margin:8px 0 4px; }}
  input, select {{
    width:100%; border-radius:10px; padding:10px;
    border:1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.25); color:#e9eef5;
    outline:none;
  }}
  button {{
    margin-top:10px;
    width:100%; padding:10px 12px; border-radius:12px;
    border:1px solid rgba(255,215,0,0.35);
    background: rgba(255,215,0,0.12);
    color:#ffe7a6; font-weight:700;
  }}
  .hint {{ font-size:12px; opacity:0.75; margin-top:8px; line-height:1.35; }}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1><span class="badge">💼</span> {APP_NAME}</h1>
      <div class="hint">
        Players opt-in by submitting their work stats + current job status. Recruiters search/sort from the overlay.
      </div>
      <hr style="border:none;border-top:1px solid rgba(255,255,255,0.10);margin:10px 0;">
      <div class="hint"><b>Submission endpoint:</b> <code>/api/submit</code></div>
      <div class="hint"><b>Recruiter search:</b> <code>/api/search</code> (requires ADMIN_TOKEN)</div>
    </div>
  </div>
</body>
</html>"""

# ---------------- Routes ----------------
@app.after_request
def add_headers(resp):
    # iframe-safe
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
    # Player opt-in. NO token required.
    data = request.get_json(silent=True) or {}
    if not str(data.get("torn_id") or "").isdigit():
        return jsonify({"ok": False, "error": "torn_id required"}), 400

    # minimum fields accepted; totals computed if missing
    upsert_candidate(data)
    return jsonify({"ok": True})

@app.route("/api/search", methods=["GET"])
def api_search():
    # Recruiter search (protected)
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
