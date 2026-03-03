// ==UserScript==
// @name         7DS Hiring Hub 💼 (Applications + Compare) [CSP-Proof]
// @namespace    7ds-wrath-hiring
// @version      3.0.0
// @description  In-Torn Hiring Hub: auto-detected applications (from events) + compare vs employees. No Discord/webhooks.
// @author       Fries91
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      sevends-hiring-scan.onrender.com
// @updateURL    https://raw.githubusercontent.com/Fries91/7ds-hiring-scan-/main/static/shield.user.js
// @downloadURL  https://raw.githubusercontent.com/Fries91/7ds-hiring-scan-/main/static/shield.user.js
// ==/UserScript==

(function () {
  "use strict";

  const BASE_URL = "https://sevends-hiring-scan.onrender.com";
  const POS_BADGE = "wh_badge_pos_v1";
  const POS_PANEL = "wh_panel_pos_v1";
  const ADMIN_TOKEN_KEY = "wh_admin_token_v1";

  let panelOpen = false;
  let applicantStats = null; // {man,int,end,total}

  const $ = (sel, root = document) => root.querySelector(sel);

  function getToken() { return (GM_getValue(ADMIN_TOKEN_KEY, "") || "").trim(); }
  function setToken(v) { GM_setValue(ADMIN_TOKEN_KEY, (v || "").trim()); }

  function api(path, method = "GET", body = null) {
    return new Promise((resolve) => {
      const admin = getToken();
      const joiner = path.includes("?") ? "&" : "?";
      const url = `${BASE_URL}${path}${joiner}admin=${encodeURIComponent(admin)}`;

      GM_xmlhttpRequest({
        method,
        url,
        data: body ? JSON.stringify(body) : null,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        timeout: 25000,
        onload: (res) => {
          try { resolve(JSON.parse(res.responseText || "{}")); }
          catch { resolve({ ok: false, error: "Bad JSON from server" }); }
        },
        ontimeout: () => resolve({ ok: false, error: "Request timed out" }),
        onerror: () => resolve({ ok: false, error: "Network error" }),
      });
    });
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function toInt(v) {
    const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }
  function sum3(a,b,c){ return (a!=null && b!=null && c!=null) ? (a+b+c) : null; }

  GM_addStyle(`
    #whBadge{
      position:fixed; z-index:999999;
      width:60px; height:60px; right:14px; top:180px;
      border-radius:18px;
      background:linear-gradient(180deg,#1a2434,#0b1220);
      border:1px solid rgba(255,255,255,.15);
      box-shadow:0 14px 32px rgba(0,0,0,.6);
      display:flex; align-items:center; justify-content:center;
      user-select:none; -webkit-tap-highlight-color: transparent;
      touch-action:none;
    }
    #whBadge .icon{ font-size:28px; pointer-events:none; }
    #whBadge .dot{
      position:absolute; right:9px; bottom:9px;
      width:10px; height:10px; border-radius:999px;
      background:rgba(80,255,160,.92);
      box-shadow:0 0 12px rgba(80,255,160,.55);
    }

    #whPanel{
      position:fixed; z-index:999998;
      right:14px; top:255px;
      width:min(95vw,920px);
      height:min(84vh,920px);
      border-radius:18px;
      border:1px solid rgba(255,255,255,.15);
      background:#0b0f14;
      box-shadow:0 22px 64px rgba(0,0,0,.75);
      overflow:hidden;
      display:none;
      color:#e8eef7;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      touch-action:none;
    }

    #whTop{
      display:flex; align-items:center; justify-content:space-between;
      padding:10px 12px;
      background:rgba(16,24,38,.92);
      border-bottom:1px solid rgba(255,255,255,.10);
      cursor:grab; user-select:none; touch-action:none;
    }
    #whTop:active{ cursor:grabbing; }

    .whBtn{
      border:1px solid rgba(255,255,255,.15);
      background:#0c1320;
      color:#e8eef7;
      padding:7px 10px;
      border-radius:12px;
      font-size:12px;
      cursor:pointer;
    }
    #whBody{ padding:12px; height:calc(100% - 54px); overflow:auto; }

    .whCard{
      background:#101826;
      border:1px solid rgba(255,255,255,.08);
      border-radius:14px;
      padding:12px;
      margin-bottom:12px;
    }
    .whH{ margin:0 0 10px 0; font-size:13px; font-weight:800; opacity:.95; }
    .whRow{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .whRow > *{ flex:1 1 220px; }
    .whInput, .whSelect{
      width:100%;
      border-radius:12px;
      border:1px solid rgba(255,255,255,.14);
      background:#0c1320;
      color:#e8eef7;
      padding:10px;
      font-size:13px;
      outline:none;
    }
    .whSmall{ font-size:12px; opacity:.75; margin-top:6px; }
    .whToast{
      margin-top:10px; padding:10px; border-radius:12px;
      background:rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.10);
      font-size:12px;
    }
    .whPill{
      display:inline-block; padding:4px 10px; border-radius:999px;
      background:rgba(255,255,255,.08); font-size:12px; margin-right:8px; margin-top:6px;
    }
    .whGood{ background:rgba(50,255,140,.14); }
    .whWarn{ background:rgba(255,200,70,.14); }
    .whBad{ background:rgba(255,60,60,.18); }

    table.whTable{ width:100%; border-collapse:collapse; font-size:12px; margin-top:10px; border-radius:12px; overflow:hidden; }
    .whTable th,.whTable td{ padding:8px; border-bottom:1px solid rgba(255,255,255,.08); text-align:left; vertical-align:middle; }
    .whTable th{ position:sticky; top:0; background:#0c1320; z-index:1; }

    .whTag{ font-size:11px; padding:3px 8px; border-radius:999px; background:rgba(255,255,255,.08); }
    .whNew{ background:rgba(80,255,160,.14); }
    .whDecl{ background:rgba(255,60,60,.18); }
    .whShort{ background:rgba(255,200,70,.14); }
  `);

  // Position save/load
  function loadPos(el, key, defTop, defRight) {
    const raw = GM_getValue(key, "");
    if (!raw) { el.style.top = defTop + "px"; el.style.right = defRight + "px"; return; }
    try {
      const p = JSON.parse(raw);
      el.style.top = (typeof p.top === "number" ? p.top : defTop) + "px";
      el.style.right = (typeof p.right === "number" ? p.right : defRight) + "px";
    } catch {
      el.style.top = defTop + "px"; el.style.right = defRight + "px";
    }
  }
  function savePos(el, key) {
    const rect = el.getBoundingClientRect();
    const top = Math.max(8, Math.min(window.innerHeight - 80, rect.top));
    const right = Math.max(8, Math.min(window.innerWidth - 80, window.innerWidth - rect.right));
    GM_setValue(key, JSON.stringify({ top, right }));
  }

  // Better drag (click-safe + snap)
  function enableDrag(el, handle, key, onClick) {
    let dragging = false, moved = false;
    let startX = 0, startY = 0, startTop = 0, startRight = 0;

    handle.addEventListener("pointerdown", (e) => {
      dragging = true; moved = false;
      el.setPointerCapture?.(e.pointerId);

      const rect = el.getBoundingClientRect();
      startTop = rect.top;
      startRight = window.innerWidth - rect.right;
      startX = e.clientX; startY = e.clientY;
      e.preventDefault();
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;

      let newTop = startTop + dy;
      let newRight = startRight - dx;

      newTop = Math.max(8, Math.min(window.innerHeight - 72, newTop));
      newRight = Math.max(8, Math.min(window.innerWidth - 72, newRight));

      el.style.top = newTop + "px";
      el.style.right = newRight + "px";
    });

    handle.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;

      // snap to nearest edge if close
      const rect = el.getBoundingClientRect();
      const distRight = window.innerWidth - rect.right;
      const distLeft = rect.left;
      if (distRight < 40) el.style.right = "14px";
      if (distLeft < 40) el.style.right = (window.innerWidth - 14 - rect.width) + "px";

      savePos(el, key);
      if (!moved && typeof onClick === "function") onClick();
    });
  }

  // UI
  const badge = document.createElement("div");
  badge.id = "whBadge";
  badge.innerHTML = `<div class="icon">💼</div><div class="dot"></div>`;
  document.body.appendChild(badge);

  const panel = document.createElement("div");
  panel.id = "whPanel";
  panel.innerHTML = `
    <div id="whTop">
      <div style="font-weight:900;font-size:13px;">💼 Hiring Hub (Overlay)</div>
      <div style="display:flex;gap:8px;">
        <button class="whBtn" id="whToken">Token</button>
        <button class="whBtn" id="whRefresh">Refresh</button>
        <button class="whBtn" id="whClose">Close</button>
      </div>
    </div>

    <div id="whBody">

      <div class="whCard">
        <div class="whH">Applications Hub (auto from events)</div>
        <div class="whRow">
          <button class="whBtn" id="whLoadApps">Load Applications</button>
          <input class="whInput" id="whAppLimit" placeholder="Limit (default 25)" />
        </div>
        <div id="whAppsOut" class="whToast">Press “Load Applications”.</div>
      </div>

      <div class="whCard">
        <div class="whH">Applicant Stats (optional for deltas)</div>
        <div class="whRow">
          <input class="whInput" id="whApplicantId" placeholder="Applicant Torn ID" />
          <input class="whInput" id="whApplicantKey" placeholder="Applicant opt-in API key (optional)" />
          <button class="whBtn" id="whScanApplicant">Scan</button>
        </div>
        <div class="whSmall">If key fails, use manual entry.</div>
        <div class="whRow" style="margin-top:10px">
          <input class="whInput" id="whMan" placeholder="MAN (manual)" />
          <input class="whInput" id="whInt" placeholder="INT (manual)" />
          <input class="whInput" id="whEnd" placeholder="END (manual)" />
          <button class="whBtn" id="whUseManual">Use Manual</button>
        </div>
        <div id="whApplicantOut" class="whToast">No applicant loaded yet.</div>
      </div>

      <div class="whCard">
        <div class="whH">Company Compare</div>
        <div class="whRow">
          <select class="whSelect" id="whCompanySel"><option>Loading…</option></select>
          <button class="whBtn" id="whLoadCompany">Load Company</button>
        </div>
        <div id="whCompanyOut" class="whToast">Select a company (or use Compare from an application).</div>
      </div>

    </div>
  `;
  document.body.appendChild(panel);

  loadPos(badge, POS_BADGE, 180, 14);
  loadPos(panel, POS_PANEL, 255, 14);

  enableDrag(badge, badge, POS_BADGE, () => setPanel(!panelOpen));
  enableDrag(panel, $("#whTop", panel), POS_PANEL, null);

  function setPanel(open) {
    panelOpen = open;
    panel.style.display = open ? "block" : "none";
  }
  $("#whClose", panel).addEventListener("click", () => setPanel(false));

  $("#whToken", panel).addEventListener("click", () => {
    const tok = prompt("Enter ADMIN_TOKEN for your Render service:", getToken() || "");
    if (tok === null) return;
    setToken(tok);
    toast($("#whAppsOut", panel), "Token saved. Hit Refresh.");
  });

  function toast(el, msg) { el.innerHTML = msg; }

  function renderApplicant() {
    const out = $("#whApplicantOut", panel);
    if (!applicantStats) return toast(out, "No applicant loaded yet.");
    toast(out, `
      <div>
        <span class="whPill">MAN: ${applicantStats.man ?? "?"}</span>
        <span class="whPill">INT: ${applicantStats.int ?? "?"}</span>
        <span class="whPill">END: ${applicantStats.end ?? "?"}</span>
        <span class="whPill">TOTAL: ${applicantStats.total ?? "?"}</span>
      </div>
    `);
  }

  function deltaPill(delta) {
    if (delta == null) return `<span class="whPill">—</span>`;
    if (delta >= 0) return `<span class="whPill whGood">+${delta}</span>`;
    if (delta > -5000) return `<span class="whPill whWarn">${delta}</span>`;
    return `<span class="whPill whBad">${delta}</span>`;
  }

  // Load companies
  async function loadCompanies() {
    const data = await api("/api/companies");
    const sel = $("#whCompanySel", panel);

    if (!data.ok) {
      sel.innerHTML = `<option>—</option>`;
      toast($("#whCompanyOut", panel), `<span class="whPill whBad">Error: ${esc(data.error || "failed")}</span>`);
      return;
    }

    const companies = data.companies || [];
    if (!companies.length) {
      sel.innerHTML = `<option value="">No companies</option>`;
      toast($("#whCompanyOut", panel), "No companies returned. Check COMPANY_IDS + TORN_API_KEY.");
      return;
    }

    sel.innerHTML = companies.map(c => `<option value="${esc(c.id)}">${esc(c.name)} (#${esc(c.id)})</option>`).join("");
  }

  $("#whRefresh", panel).addEventListener("click", async () => {
    await loadCompanies();
    toast($("#whAppsOut", panel), "Refreshed. Load Applications again to see newest.");
  });

  // Applications hub
  async function loadApplications() {
    const limitRaw = ($("#whAppLimit", panel).value || "").trim();
    const limit = limitRaw ? encodeURIComponent(limitRaw) : "25";
    const out = $("#whAppsOut", panel);

    toast(out, "Loading applications…");
    const data = await api(`/api/applications?limit=${limit}`);

    if (!data.ok) {
      toast(out, `<span class="whPill whBad">Error: ${esc(data.error || "failed")}</span>`);
      return;
    }

    const rows = data.rows || [];
    if (!rows.length) {
      toast(out, "No applications logged yet. (Polling runs every ~45s.)");
      return;
    }

    const html = `
      <table class="whTable">
        <thead>
          <tr>
            <th>Status</th>
            <th>Applicant</th>
            <th>Company</th>
            <th>Time</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const st = (r.status || "new");
            const tagClass = st === "new" ? "whTag whNew" : (st === "declined" ? "whTag whDecl" : (st === "shortlist" ? "whTag whShort" : "whTag"));
            const applicant = r.applicant_id ? `#${esc(r.applicant_id)}` : "Unknown";
            const company = r.company_name ? esc(r.company_name) : (r.company_id ? `#${esc(r.company_id)}` : "Unknown");
            return `
              <tr>
                <td><span class="${tagClass}">${esc(st)}</span></td>
                <td>${applicant}</td>
                <td>${company}</td>
                <td style="opacity:.75">${esc(r.created_at || "")}</td>
                <td>
                  <button class="whBtn" data-act="compare" data-cid="${esc(r.company_id || "")}" data-aid="${esc(r.applicant_id || "")}">Compare</button>
                  <button class="whBtn" data-act="status" data-id="${esc(r.id)}" data-status="reviewed">Reviewed</button>
                  <button class="whBtn" data-act="status" data-id="${esc(r.id)}" data-status="shortlist">Shortlist</button>
                  <button class="whBtn" data-act="status" data-id="${esc(r.id)}" data-status="declined">Decline</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      <div class="whSmall" style="margin-top:8px;opacity:.85">
        Tip: “Compare” loads the company employee table. If applicant stats are unknown, deltas show — until you scan/enter stats.
      </div>
    `;

    toast(out, html);

    // delegate clicks
    out.querySelectorAll("button[data-act]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-act");
        if (act === "compare") {
          const cid = (btn.getAttribute("data-cid") || "").trim();
          const aid = (btn.getAttribute("data-aid") || "").trim();

          if (aid) $("#whApplicantId", panel).value = aid;

          if (cid) {
            $("#whCompanySel", panel).value = cid;
            await loadCompany();
          } else {
            toast($("#whCompanyOut", panel), `<span class="whPill whWarn">Company id not found in event text. Select company manually.</span>`);
          }
        }

        if (act === "status") {
          const id = btn.getAttribute("data-id");
          const status = btn.getAttribute("data-status");
          const res = await api("/api/applications/status", "POST", { id, status });
          if (res.ok) {
            await loadApplications();
          }
        }
      });
    });
  }

  $("#whLoadApps", panel).addEventListener("click", loadApplications);

  // Applicant scan/manual
  $("#whScanApplicant", panel).addEventListener("click", async () => {
    const id = ($("#whApplicantId", panel).value || "").trim();
    const key = ($("#whApplicantKey", panel).value || "").trim();
    const out = $("#whApplicantOut", panel);

    if (!id) return toast(out, `<span class="whPill whWarn">Applicant ID required to scan</span>`);
    if (!key) return toast(out, `<span class="whPill whWarn">No applicant key. Use manual entry.</span>`);

    toast(out, "Scanning…");
    const data = await api(`/api/applicant?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
    if (!data.ok) {
      applicantStats = null;
      return toast(out, `<span class="whPill whBad">Error: ${esc(data.error || "scan failed")}</span>`);
    }
    applicantStats = data.workstats || null;
    renderApplicant();
  });

  $("#whUseManual", panel).addEventListener("click", () => {
    const man = toInt($("#whMan", panel).value);
    const inte = toInt($("#whInt", panel).value);
    const end = toInt($("#whEnd", panel).value);
    applicantStats = { man, int: inte, end, total: sum3(man, inte, end) };
    renderApplicant();
  });

  // Company compare
  async function loadCompany() {
    const cid = ($("#whCompanySel", panel).value || "").trim();
    const out = $("#whCompanyOut", panel);
    if (!cid) return toast(out, `<span class="whPill whWarn">Pick a company first</span>`);

    toast(out, "Loading company…");
    const data = await api(`/api/company?id=${encodeURIComponent(cid)}`);
    if (!data.ok) return toast(out, `<span class="whPill whBad">Error: ${esc(data.error || "load failed")}</span>`);

    const company = data.company || { id: cid, name: `Company ${cid}` };
    const rows = data.employees || [];

    const html = `
      <div class="whSmall">Company: <b>${esc(company.name)}</b> (#${esc(company.id)})</div>
      <table class="whTable">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Position</th>
            <th>MAN</th><th>INT</th><th>END</th><th>TOTAL</th>
            <th>Δ TOTAL vs Applicant</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(e => {
            const ws = e.workstats || {};
            const d = (applicantStats?.total != null && ws.total != null) ? (ws.total - applicantStats.total) : null;
            return `<tr>
              <td>${esc(e.name || ("#" + e.id))} <span style="opacity:.65">(#${esc(e.id)})</span></td>
              <td>${esc(e.position || "-")}</td>
              <td>${ws.man ?? "?"}</td>
              <td>${ws.int ?? "?"}</td>
              <td>${ws.end ?? "?"}</td>
              <td>${ws.total ?? "?"}</td>
              <td>${deltaPill(d)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      ${applicantStats ? "" : `<div class="whSmall" style="margin-top:8px">Load applicant stats (scan/manual) to show deltas.</div>`}
    `;

    toast(out, html);
  }

  $("#whLoadCompany", panel).addEventListener("click", loadCompany);

  // Boot
  (async function boot() {
    if (!getToken()) {
      const tok = prompt("Enter ADMIN_TOKEN (Cancel to skip):", "");
      if (tok) setToken(tok);
    }
    await loadCompanies(
