// ==UserScript==
// @name         7DS*: Hiring Scan 🛡️ (Wrath Theme + HoF Scan + Opt-in Applicants + Employment Filter)
// @namespace    7ds-wrath-hiring-scan
// @version      1.2.0
// @description  Shield overlay like war-bot. HoF TOTAL scan + Applicants list with MAN/INT/END + employment (none/company/city).
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      sevends-hiring-scan.onrender.com
// ==/UserScript==

(function () {
  "use strict";

  const BASE_URL = "https://sevends-hiring-scan.onrender.com";

  const POS_KEY  = "hiring_scan_shield_pos_v3";
  const OPEN_KEY = "hiring_scan_open_v3";
  const TOK_KEY  = "hiring_scan_admin_token_v3";
  const CFG_KEY  = "hiring_scan_cfg_v3";

  function gmGet(k, d){ try { return GM_getValue(k, d); } catch { return d; } }
  function gmSet(k, v){ try { GM_setValue(k, v); } catch {} }

  function httpJson(method, url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        data: body ? JSON.stringify(body) : null,
        headers: { "Content-Type": "application/json", ...headers },
        onload: (res) => {
          try { resolve(JSON.parse(res.responseText || "{}")); }
          catch (e) { reject(e); }
        },
        onerror: reject,
      });
    });
  }

  function copyToClipboard(text) {
    try { navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  GM_addStyle(`
    #wrath-hiring-shield{
      position:fixed; z-index:999999;
      width:54px; height:54px;
      border-radius:18px;
      background: radial-gradient(circle at 30% 20%, rgba(255,255,255,.14), rgba(255,255,255,0) 42%),
                  linear-gradient(180deg, #1b2436, #0f1420);
      border:1px solid rgba(255,255,255,.12);
      box-shadow:0 12px 34px rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center;
      user-select:none; cursor:grab;
      right:12px; top:160px;
    }
    #wrath-hiring-shield:active{ cursor:grabbing; }
    #wrath-hiring-shield span{ font-size:22px; filter: drop-shadow(0 2px 6px rgba(0,0,0,.65)); }

    #wrath-hiring-panel{
      position:fixed; z-index:999999;
      right:14px; top:86px;
      width:min(590px, calc(100vw - 28px));
      max-height:min(80vh, 780px);
      overflow:hidden;
      border-radius:18px;
      background: rgba(12,16,24,.92);
      backdrop-filter: blur(10px);
      border:1px solid rgba(255,255,255,.10);
      box-shadow:0 18px 50px rgba(0,0,0,.60);
      color:#e8eefc;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    #wrath-hiring-panel header{
      padding:12px; display:flex; align-items:center; gap:10px;
      border-bottom:1px solid rgba(255,255,255,.08);
    }
    #wrath-hiring-panel header .title{ font-weight:900; letter-spacing:.2px; }
    #wrath-hiring-panel header .pill{
      margin-left:auto; font-size:12px;
      padding:4px 10px; border-radius:999px;
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.10);
      font-weight:700;
    }
    #wrath-hiring-panel .body{
      padding:12px; overflow:auto;
      max-height: calc(min(80vh, 780px) - 54px);
    }
    .row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
    .ctl{
      flex:1 1 auto;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 12px;
      padding: 8px 10px;
      color: #e8eefc;
      outline:none;
    }
    .btn{
      background: linear-gradient(180deg,#2a3a5e,#17243e);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 12px;
      padding: 8px 10px;
      color:#e8eefc;
      cursor:pointer;
      font-weight:900;
      white-space:nowrap;
    }
    .btn:active{ transform: translateY(1px); }
    .danger{
      background: linear-gradient(180deg,#5e1f2c,#3a1420);
      border-color: rgba(255,255,255,.10);
    }
    .muted{ opacity:.78; font-size:12px; }
    .sectionTitle{ font-weight:900; margin:12px 0 8px; opacity:.95; }
  `);

  const shield = document.createElement("div");
  shield.id = "wrath-hiring-shield";
  shield.title = "Hiring Scan (drag / tap)";
  shield.innerHTML = `<span>🛡️</span>`;
  document.body.appendChild(shield);

  const panel = document.createElement("div");
  panel.id = "wrath-hiring-panel";
  panel.style.display = gmGet(OPEN_KEY, false) ? "block" : "none";
  panel.innerHTML = `
    <header>
      <div class="title">💼 Hiring Scan</div>
      <div class="pill" id="hs-pill">idle</div>
    </header>
    <div class="body">

      <div class="row">
        <input class="ctl" id="hs-token" placeholder="ADMIN_TOKEN (stored locally)" />
        <button class="btn" id="hs-save">Save</button>
      </div>

      <div class="row">
        <button class="btn" id="hs-copy">Copy recruit message</button>
        <button class="btn" id="hs-apply">Open apply page</button>
      </div>

      <div class="sectionTitle">HoF TOTAL Scan</div>
      <div class="row">
        <input class="ctl" id="hs-min" inputmode="numeric" placeholder="Min TOTAL workstats" />
        <input class="ctl" id="hs-max" inputmode="numeric" placeholder="Max TOTAL workstats" />
      </div>
      <div class="row">
        <input class="ctl" id="hs-limit" inputmode="numeric" placeholder="Limit (1-200)" />
        <button class="btn" id="hs-scan">Scan</button>
      </div>
      <div class="row">
        <select class="ctl" id="hs-dd">
          <option value="">No scan results yet…</option>
        </select>
      </div>

      <div class="sectionTitle">Applicants (MAN / INT / END)</div>
      <div class="row">
        <select class="ctl" id="hs-emp">
          <option value="">Employment: All</option>
          <option value="none">No company</option>
          <option value="company">In a company</option>
          <option value="city">City job</option>
          <option value="unknown">Unknown</option>
        </select>
        <button class="btn" id="hs-refresh-app">Refresh</button>
      </div>

      <div class="row">
        <select class="ctl" id="hs-app-dd">
          <option value="">No applicants yet…</option>
        </select>
      </div>

      <div class="row">
        <button class="btn danger" id="hs-del">Delete selected applicant</button>
      </div>

      <div class="muted">
        Applicants submit here: <b>${BASE_URL}/apply</b> (manual or limited key).
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const setStatus = (t) => { $("#hs-pill").textContent = t; };

  // restore token
  $("#hs-token").value = gmGet(TOK_KEY, "");

  // restore last scan inputs
  const cfg = gmGet(CFG_KEY, { min:"", max:"", limit:"50" });
  $("#hs-min").value = cfg.min || "";
  $("#hs-max").value = cfg.max || "";
  $("#hs-limit").value = cfg.limit || "50";

  $("#hs-save").onclick = () => {
    gmSet(TOK_KEY, ($("#hs-token").value || "").trim());
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 700);
  };

  $("#hs-copy").onclick = async () => {
    const token = (gmGet(TOK_KEY, "") || "").trim();
    if (!token) { setStatus("token?"); return; }
    try {
      const data = await httpJson("GET", `${BASE_URL}/api/applicants`, null, { "X-ADMIN-TOKEN": token });
      const msg = (data && data.message) ? data.message : "looking to hire if you can reply with working stats or an limited API key";
      copyToClipboard(msg);
    } catch {
      copyToClipboard("looking to hire if you can reply with working stats or an limited API key");
    }
    setStatus("copied");
    setTimeout(() => setStatus("idle"), 900);
  };

  $("#hs-apply").onclick = () => window.open(`${BASE_URL}/apply`, "_blank", "noopener,noreferrer");

  $("#hs-scan").onclick = async () => {
    const token = (gmGet(TOK_KEY, "") || "").trim();
    const min = ($("#hs-min").value || "").trim();
    const max = ($("#hs-max").value || "").trim();
    let limit = ($("#hs-limit").value || "50").trim();

    if (!token) { setStatus("token?"); return; }
    if (!min || !max) { setStatus("min/max?"); return; }
    if (!limit) limit = "50";
    gmSet(CFG_KEY, { min, max, limit });

    setStatus("loading");
    try {
      const qs = new URLSearchParams({ min, max, limit });
      const data = await httpJson("GET", `${BASE_URL}/state?${qs.toString()}`, null, { "X-ADMIN-TOKEN": token });
      if (!data.ok) throw new Error(data.error || "failed");

      const rows = data.rows || [];
      const dd = $("#hs-dd");
      dd.innerHTML = "";

      if (!rows.length) {
        dd.innerHTML = `<option value="">No matches</option>`;
        setStatus("0");
        return;
      }

      for (const r of rows) {
        const label = `${r.name} [${r.user_id}] — ${Number(r.value).toLocaleString()}`;
        const opt = document.createElement("option");
        opt.value = String(r.user_id);
        opt.textContent = label;
        dd.appendChild(opt);
      }

      dd.onchange = () => {
        const xid = dd.value;
        if (xid) window.open(`https://www.torn.com/profiles.php?XID=${xid}`, "_blank", "noopener,noreferrer");
      };

      setStatus(String(rows.length));
    } catch {
      $("#hs-dd").innerHTML = `<option value="">Error (token / logs)</option>`;
      setStatus("error");
    }
  };

  async function refreshApplicants() {
    const token = (gmGet(TOK_KEY, "") || "").trim();
    if (!token) { setStatus("token?"); return; }

    setStatus("loading");
    try {
      const emp = ($("#hs-emp").value || "").trim();
      const qs = new URLSearchParams({ sort: "total" });
      if (emp) qs.set("employment", emp);

      const data = await httpJson("GET", `${BASE_URL}/api/applicants?${qs.toString()}`, null, { "X-ADMIN-TOKEN": token });
      if (!data.ok) throw new Error(data.error || "failed");

      const rows = data.rows || [];
      const dd = $("#hs-app-dd");
      dd.innerHTML = "";

      if (!rows.length) {
        dd.innerHTML = `<option value="">No applicants</option>`;
        setStatus("0");
        return;
      }

      for (const r of rows) {
        const empLabel = (r.employment || "unknown").toUpperCase();
        const comp = r.company_name ? ` | ${r.company_name}` : "";
        const jt = r.job_title ? ` (${r.job_title})` : "";
        const label =
          `${r.name} [${r.torn_id}] — MAN ${Number(r.manuallabor).toLocaleString()} | ` +
          `INT ${Number(r.intelligence).toLocaleString()} | END ${Number(r.endurance).toLocaleString()} | ` +
          `TOTAL ${Number(r.total).toLocaleString()} | ${empLabel}${comp}${jt}`;
        const opt = document.createElement("option");
        opt.value = String(r.torn_id);
        opt.textContent = label;
        dd.appendChild(opt);
      }

      dd.onchange = () => {
        const xid = dd.value;
        if (xid) window.open(`https://www.torn.com/profiles.php?XID=${xid}`, "_blank", "noopener,noreferrer");
      };

      setStatus(String(rows.length));
    } catch {
      $("#hs-app-dd").innerHTML = `<option value="">Error loading applicants</option>`;
      setStatus("error");
    }
  }

  $("#hs-refresh-app").onclick = refreshApplicants;

  $("#hs-del").onclick = async () => {
    const token = (gmGet(TOK_KEY, "") || "").trim();
    const id = ($("#hs-app-dd").value || "").trim();
    if (!token) { setStatus("token?"); return; }
    if (!id) { setStatus("pick one"); return; }

    setStatus("deleting");
    try {
      const data = await httpJson("POST", `${BASE_URL}/api/applicants/delete`, { torn_id: Number(id) }, { "X-ADMIN-TOKEN": token });
      if (!data.ok) throw new Error();
      await refreshApplicants();
      setStatus("deleted");
      setTimeout(() => setStatus("idle"), 800);
    } catch {
      setStatus("error");
    }
  };

  // ----- drag + toggle like war-bot -----
  let pos = gmGet(POS_KEY, { right: 12, top: 160 });
  function applyPos(){ shield.style.right = `${pos.right}px`; shield.style.top = `${pos.top}px`; }
  applyPos();

  let drag = null;
  shield.addEventListener("pointerdown", (e) => {
    shield.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, sr: pos.right, st: pos.top };
    shield.dataset.dragging = "0";
  });
  shield.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) shield.dataset.dragging = "1";
    pos.right = Math.max(6, drag.sr - dx);
    pos.top   = Math.max(60, drag.st + dy);
    applyPos();
  });
  shield.addEventListener("pointerup", () => {
    if (!drag) return;
    gmSet(POS_KEY, pos);
    drag = null;
    setTimeout(() => (shield.dataset.dragging = "0"), 0);
  });

  function togglePanel() {
    const open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "block";
    gmSet(OPEN_KEY, !open);
  }
  shield.addEventListener("click", () => {
    if (shield.dataset.dragging === "1") return;
    togglePanel();
  });
})();
