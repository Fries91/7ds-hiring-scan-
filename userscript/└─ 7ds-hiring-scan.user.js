// ==UserScript==
// @name         7DS Hiring Scanner 💼 (HoF Workstats Range -> Dropdown)
// @namespace    7ds-hiring-scan
// @version      1.0.0
// @description  Scans Torn HoF total workstats via your Render proxy, filters by digit range, puts candidates into a dropdown.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      torn-hiring-scan.onrender.com
// ==/UserScript==

(function () {
  "use strict";

  // ✅ change to your Render URL
  const BASE_URL = "https://torn-hiring-scan.onrender.com";

  const POS_KEY = "hire_scan_icon_pos_v1";
  const TOKEN_KEY = "hire_scan_admin_token_v1";
  const OPEN_KEY = "hire_scan_open_v1";

  function gmGet(k, d){ try { return GM_getValue(k, d); } catch { return d; } }
  function gmSet(k, v){ try { GM_setValue(k, v); } catch {} }

  function httpJson(method, url, headers = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: { ...headers },
        onload: (res) => {
          try { resolve(JSON.parse(res.responseText || "{}")); }
          catch(e){ reject(e); }
        },
        onerror: reject
      });
    });
  }

  GM_addStyle(`
    #hireScanIcon{
      position:fixed; z-index:999999;
      width:52px; height:52px; border-radius:16px;
      background:linear-gradient(180deg,#1b2436,#0f1420);
      border:1px solid rgba(255,255,255,.10);
      box-shadow:0 10px 30px rgba(0,0,0,.45);
      display:flex; align-items:center; justify-content:center;
      cursor:grab; user-select:none;
      right:12px; top:220px;
    }
    #hireScanIcon:active{ cursor:grabbing; }
    #hireScanIcon span{ font-size:22px; }

    #hireScanPanel{
      position:fixed; z-index:999999;
      right:14px; top:86px;
      width:min(520px, calc(100vw - 28px));
      border-radius:18px;
      background:rgba(12,16,24,.92);
      backdrop-filter: blur(10px);
      border:1px solid rgba(255,255,255,.10);
      box-shadow:0 18px 50px rgba(0,0,0,.55);
      color:#e8eefc;
      font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;
      overflow:hidden;
    }
    #hireScanPanel header{
      padding:12px; display:flex; align-items:center; gap:10px;
      border-bottom:1px solid rgba(255,255,255,.08);
      font-weight:800;
    }
    #hireScanPanel .pill{
      margin-left:auto;
      font-size:12px; padding:4px 10px; border-radius:999px;
      background:rgba(255,255,255,.08);
      border:1px solid rgba(255,255,255,.10);
      font-weight:600;
    }
    #hireScanPanel .body{ padding:12px; }
    .row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
    .ctl{
      flex:1 1 auto;
      background:rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.10);
      border-radius:12px;
      padding:8px 10px; color:#e8eefc; outline:none;
    }
    .btn{
      background:linear-gradient(180deg,#2a3a5e,#17243e);
      border:1px solid rgba(255,255,255,.12);
      border-radius:12px;
      padding:8px 10px; color:#e8eefc;
      cursor:pointer; font-weight:800;
    }
    .muted{ opacity:.75; font-size:12px; }
  `);

  const icon = document.createElement("div");
  icon.id = "hireScanIcon";
  icon.title = "Hiring Scanner (drag / tap)";
  icon.innerHTML = `<span>💼</span>`;
  document.body.appendChild(icon);

  const panel = document.createElement("div");
  panel.id = "hireScanPanel";
  panel.style.display = gmGet(OPEN_KEY, false) ? "block" : "none";
  panel.innerHTML = `
    <header>
      Hiring Scanner
      <div class="pill" id="hsStatus">idle</div>
    </header>
    <div class="body">
      <div class="row">
        <input class="ctl" id="hsToken" placeholder="Admin token (stored locally)" />
        <button class="btn" id="hsSave">Save</button>
      </div>

      <div class="row">
        <input class="ctl" id="hsMin" inputmode="numeric" placeholder="Min total workstats (digits)" />
        <input class="ctl" id="hsMax" inputmode="numeric" placeholder="Max total workstats (digits)" />
      </div>

      <div class="row">
        <button class="btn" id="hsSearch">Search</button>
        <input class="ctl" id="hsLimit" inputmode="numeric" value="50" placeholder="Limit (1-200)" />
      </div>

      <div class="row">
        <select class="ctl" id="hsDropdown">
          <option value="">No results yet…</option>
        </select>
      </div>

      <div class="muted">
        Uses HoF TOTAL workstats (public leaderboard). Open selected player in a new tab.
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const hsStatus = () => panel.querySelector("#hsStatus");

  // restore token
  $("#hsToken").value = gmGet(TOKEN_KEY, "");

  $("#hsSave").onclick = () => {
    gmSet(TOKEN_KEY, ($("#hsToken").value || "").trim());
    hsStatus().textContent = "saved";
    setTimeout(() => hsStatus().textContent = "idle", 700);
  };

  $("#hsSearch").onclick = async () => {
    const token = (gmGet(TOKEN_KEY, "") || "").trim();
    if (!token) { hsStatus().textContent = "token?"; return; }

    const min = ($("#hsMin").value || "").trim();
    const max = ($("#hsMax").value || "").trim();
    const limit = ($("#hsLimit").value || "50").trim();

    if (!min || !max) { hsStatus().textContent = "min/max?"; return; }

    hsStatus().textContent = "loading";
    try{
      const qs = new URLSearchParams({ min, max, limit });
      const data = await httpJson("GET", `${BASE_URL}/api/search?${qs.toString()}`, {
        "X-ADMIN-TOKEN": token
      });
      if (!data.ok) throw new Error(data.error || "failed");

      const dd = $("#hsDropdown");
      dd.innerHTML = "";

      const rows = data.rows || [];
      if (!rows.length){
        dd.innerHTML = `<option value="">No matches</option>`;
        hsStatus().textContent = "0";
        return;
      }

      for (const r of rows){
        const label = `${r.name} [${r.user_id}] — ${Number(r.value).toLocaleString()}`;
        const opt = document.createElement("option");
        opt.value = String(r.user_id);
        opt.textContent = label;
        dd.appendChild(opt);
      }

      hsStatus().textContent = String(rows.length);

      dd.onchange = () => {
        const xid = dd.value;
        if (xid) window.open(`https://www.torn.com/profiles.php?XID=${xid}`, "_blank", "noopener,noreferrer");
      };

    } catch(e){
      hsStatus().textContent = "error";
      $("#hsDropdown").innerHTML = `<option value="">Error (check token / logs)</option>`;
    }
  };

  function toggle(){
    const open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "block";
    gmSet(OPEN_KEY, !open);
  }

  // drag
  let pos = gmGet(POS_KEY, { right: 12, top: 220 });
  function applyPos(){ icon.style.right = `${pos.right}px`; icon.style.top = `${pos.top}px`; }
  applyPos();

  let drag = null;
  icon.addEventListener("pointerdown", (e) => {
    icon.setPointerCapture(e.pointerId);
    drag = { x:e.clientX, y:e.clientY, sr:pos.right, st:pos.top };
    icon.dataset.dragging = "0";
  });
  icon.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) icon.dataset.dragging = "1";
    pos.right = Math.max(6, drag.sr - dx);
    pos.top   = Math.max(60, drag.st + dy);
    applyPos();
  });
  icon.addEventListener("pointerup", () => {
    if (!drag) return;
    gmSet(POS_KEY, pos);
    drag = null;
    setTimeout(() => (icon.dataset.dragging = "0"), 0);
  });

  icon.addEventListener("click", () => {
    if (icon.dataset.dragging === "1") return;
    toggle();
  });

})();
