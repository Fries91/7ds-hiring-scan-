import os
from dotenv import load_dotenv
from flask import Flask, jsonify, request, Response

from torn_api import (
    get_company, get_user_workstats, normalize_workstats, TornAPIError
)

load_dotenv()
app = Flask(__name__)

TORN_API_KEY = (os.getenv("TORN_API_KEY") or "").strip()
ADMIN_TOKEN = (os.getenv("ADMIN_TOKEN") or "").strip()
COMPANY_IDS = [c.strip() for c in (os.getenv("COMPANY_IDS") or "").split(",") if c.strip()]

def require_admin():
    if not ADMIN_TOKEN:
        return None
    got = (request.headers.get("X-Admin-Token") or request.args.get("admin") or "").strip()
    if got != ADMIN_TOKEN:
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    return None

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/")
def home():
    # Simple single-page panel (no templates needed)
    return Response("""
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>7DS Hiring Scan</title>
  <style>
    body {{ font-family: system-ui, Arial; background:#0b0f14; color:#e8eef7; margin:0; }}
    .wrap {{ max-width: 1100px; margin: 18px auto; padding: 0 14px; }}
    .card {{ background:#101826; border:1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 14px; margin-bottom: 14px; }}
    h2 {{ margin: 0 0 10px 0; font-size: 16px; }}
    input, select, button {{ border-radius: 10px; border:1px solid rgba(255,255,255,.14); background:#0c1320; color:#e8eef7; padding:10px; }}
    button {{ cursor:pointer; }}
    .row {{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }}
    .row > * {{ flex: 1 1 220px; }}
    table {{ width:100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ padding:8px; border-bottom:1px solid rgba(255,255,255,.08); text-align:left; }}
    .muted {{ opacity:.75; font-size: 12px; }}
    .pill {{ display:inline-block; padding:3px 8px; border-radius:999px; background:rgba(255,255,255,.08); }}
    .bad {{ background: rgba(255,60,60,.18); }}
    .good {{ background: rgba(50,255,140,.14); }}
    .warn {{ background: rgba(255,200,70,.14); }}
  </style>
</head>
<body>
<div class="wrap">

  <div class="card">
    <h2>Applicant scan (MAN / INT / END)</h2>
    <div class="row">
      <input id="applicantId" placeholder="Applicant Torn ID (e.g. 123456)"/>
      <input id="applicantKey" placeholder="Applicant opt-in API key (optional)"/>
      <button onclick="scanApplicant()">Scan Applicant</button>
    </div>
    <div class="muted" style="margin-top:8px">
      If the applicant key is blank, you can still compare by manually typing stats below.
    </div>
    <div class="row" style="margin-top:10px">
      <input id="mMan" placeholder="Manual (optional manual entry)"/>
      <input id="mInt" placeholder="Intelligence (optional manual entry)"/>
      <input id="mEnd" placeholder="Endurance (optional manual entry)"/>
      <button onclick="useManual()">Use Manual Stats</button>
    </div>
    <div id="applicantOut" style="margin-top:12px"></div>
  </div>

  <div class="card">
    <h2>Your companies → employees + compare</h2>
    <div class="row">
      <select id="companySel"></select>
      <button onclick="loadCompany()">Load Company</button>
    </div>
    <div id="companyOut" style="margin-top:12px"></div>
  </div>

</div>

<script>
  let applicantStats = null;
  let companies = [];

  async function api(path) {{
    const admin = localStorage.getItem("ADMIN_TOKEN") || "";
    const url = path + (path.includes("?") ? "&" : "?") + "admin=" + encodeURIComponent(admin);
    const res = await fetch(url);
    return await res.json();
  }}

  async function init() {{
    const list = await api("/api/companies");
    companies = list.companies || [];
    const sel = document.getElementById("companySel");
    sel.innerHTML = companies.map(c => `<option value="${{c.id}}">${{c.name}} (#${{c.id}})</option>`).join("");
  }}

  function pillClass(delta) {{
    if (delta === null) return "pill";
    if (delta >= 0) return "pill good";
    if (delta > -5000) return "pill warn";
    return "pill bad";
  }}

  function renderApplicant() {{
    const out = document.getElementById("applicantOut");
    if (!applicantStats) {{
      out.innerHTML = `<div class="muted">No applicant loaded yet.</div>`;
      return;
    }}
    out.innerHTML = `
      <div class="row">
        <div><span class="pill">MAN: ${applicantStats.man ?? "?"}</span></div>
        <div><span class="pill">INT: ${applicantStats.int ?? "?"}</span></div>
        <div><span class="pill">END: ${applicantStats.end ?? "?"}</span></div>
        <div><span class="pill">TOTAL: ${applicantStats.total ?? "?"}</span></div>
      </div>
    `;
  }}

  async function scanApplicant() {{
    const id = document.getElementById("applicantId").value.trim();
    const key = document.getElementById("applicantKey").value.trim();
    if (!id) return;
    const data = await api(`/api/applicant?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
    if (!data.ok) {{
      applicantStats = null;
      document.getElementById("applicantOut").innerHTML = `<div class="pill bad">Error: ${data.error}</div>`;
      return;
    }}
    applicantStats = data.workstats;
    renderApplicant();
  }}

  function useManual() {{
    const man = parseInt(document.getElementById("mMan").value || "");
    const inte = parseInt(document.getElementById("mInt").value || "");
    const end = parseInt(document.getElementById("mEnd").value || "");
    const ws = {{
      man: Number.isFinite(man) ? man : null,
      int: Number.isFinite(inte) ? inte : null,
      end: Number.isFinite(end) ? end : null,
      total: (Number.isFinite(man) && Number.isFinite(inte) && Number.isFinite(end)) ? (man+inte+end) : null
    }};
    applicantStats = ws;
    renderApplicant();
  }}

  async function loadCompany() {{
    const cid = document.getElementById("companySel").value;
    const data = await api(`/api/company?id=${encodeURIComponent(cid)}`);
    const out = document.getElementById("companyOut");
    if (!data.ok) {{
      out.innerHTML = `<div class="pill bad">Error: ${data.error}</div>`;
      return;
    }}

    const rows = data.employees || [];
    const app = applicantStats;

    const header = `<div class="muted">Company: <b>${data.company.name}</b> (#${data.company.id})</div>`;
    let table = `
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Position</th>
            <th>MAN</th>
            <th>INT</th>
            <th>END</th>
            <th>TOTAL</th>
            <th>Δ TOTAL vs Applicant</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const e of rows) {{
      const dTotal = (app && app.total != null && e.workstats.total != null) ? (e.workstats.total - app.total) : null;
      table += `
        <tr>
          <td>${e.name} <span class="muted">(#${e.id})</span></td>
          <td>${e.position || "-"}</td>
          <td>${e.workstats.man ?? "?"}</td>
          <td>${e.workstats.int ?? "?"}</td>
          <td>${e.workstats.end ?? "?"}</td>
          <td>${e.workstats.total ?? "?"}</td>
          <td><span class="${pillClass(dTotal)}">${dTotal === null ? "—" : (dTotal>=0? "+"+dTotal : dTotal)}</span></td>
        </tr>
      `;
    }}

    table += `</tbody></table>`;

    const note = app ? "" : `<div class="muted" style="margin-top:8px">Load an applicant (or manual stats) to see the comparison column.</div>`;
    out.innerHTML = header + table + note;
  }}

  // First run: ask for admin token if your server is locked
  (function boot() {{
    const needsToken = {("true" if ADMIN_TOKEN else "false")};
    if (needsToken) {{
      const existing = localStorage.getItem("ADMIN_TOKEN");
      if (!existing) {{
        const t = prompt("Enter ADMIN_TOKEN (only you) to use this panel:");
        if (t) localStorage.setItem("ADMIN_TOKEN", t.trim());
      }}
    }}
    init();
  }})();
</script>

</body>
</html>
""", mimetype="text/html")

@app.get("/api/companies")
def api_companies():
    guard = require_admin()
    if guard: return guard

    # If COMPANY_IDS provided, use that. Otherwise attempt a minimal list from your key (best-effort).
    comps = []
    for cid in COMPANY_IDS:
        try:
            data = get_company(cid, TORN_API_KEY)
            prof = data.get("company") or data.get("profile") or {}
            name = prof.get("name") or data.get("name") or f"Company {cid}"
            comps.append({"id": cid, "name": name})
        except Exception:
            comps.append({"id": cid, "name": f"Company {cid}"})
    return {"ok": True, "companies": comps}

@app.get("/api/company")
def api_company():
    guard = require_admin()
    if guard: return guard
    if not TORN_API_KEY:
        return {"ok": False, "error": "Server missing TORN_API_KEY"}, 500

    cid = (request.args.get("id") or "").strip()
    if not cid:
        return {"ok": False, "error": "Missing company id"}, 400

    try:
        data = get_company(cid, TORN_API_KEY)
        # Try to extract company profile/name
        prof = data.get("company") or data.get("profile") or {}
        cname = prof.get("name") or data.get("name") or f"Company {cid}"

        # Employees shape varies; normalize to list
        employees_obj = data.get("employees") or data.get("company_employees") or {}
        employees = []
        if isinstance(employees_obj, dict):
            for emp_id, emp in employees_obj.items():
                # Emp may contain name/position/workstats or similar
                name = emp.get("name") if isinstance(emp, dict) else str(emp)
                position = emp.get("position") if isinstance(emp, dict) else None

                # Some company responses include work stats; if not, we can’t magically get them.
                # We’ll try common fields; otherwise return unknown.
                ws_guess = {
                    "manual_labor": (emp.get("manual_labor") if isinstance(emp, dict) else None),
                    "intelligence": (emp.get("intelligence") if isinstance(emp, dict) else None),
                    "endurance": (emp.get("endurance") if isinstance(emp, dict) else None),
                }
                # If the company endpoint doesn’t provide ws fields, leave as nulls.
                man = ws_guess["manual_labor"]
                inte = ws_guess["intelligence"]
                end = ws_guess["endurance"]
                total = None
                try:
                    if man is not None and inte is not None and end is not None:
                        total = int(man) + int(inte) + int(end)
                except Exception:
                    total = None

                employees.append({
                    "id": str(emp_id),
                    "name": name or f"#{emp_id}",
                    "position": position,
                    "workstats": {
                        "man": int(man) if man is not None else None,
                        "int": int(inte) if inte is not None else None,
                        "end": int(end) if end is not None else None,
                        "total": total
                    }
                })

        return {
            "ok": True,
            "company": {"id": cid, "name": cname},
            "employees": employees
        }
    except TornAPIError as e:
        return {"ok": False, "error": f"Torn API error: {e}"}, 400
    except Exception as e:
        return {"ok": False, "error": str(e)}, 500

@app.get("/api/applicant")
def api_applicant():
    guard = require_admin()
    if guard: return guard

    uid = (request.args.get("id") or "").strip()
    key = (request.args.get("key") or "").strip()

    if not uid:
        return {"ok": False, "error": "Missing applicant id"}, 400
    if not key:
        return {"ok": False, "error": "No applicant key provided. Use manual entry instead."}, 400

    try:
        data = get_user_workstats(uid, key)
        ws = normalize_workstats(data)
        return {"ok": True, "workstats": ws}
    except TornAPIError as e:
        return {"ok": False, "error": f"Torn API error: {e}"}, 400
    except Exception as e:
        return {"ok": False, "error": str(e)}, 500
