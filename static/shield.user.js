// ==UserScript==
// @name         7DS Hiring Scan 💼 (In-Page Overlay, CSP-Proof)
// @namespace    7ds-wrath-hiring
// @version      2.0.0
// @description  In-page hiring scan overlay (no iframe) + company employees + applicant compare (CSP-proof via GM_xmlhttpRequest)
// @author       Fries91
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      sevends-hiring-scan.onrender.com
// @updateURL    https://raw.githubusercontent.com/Fries91/sevends-hiring-scan/main/static/shield.user.js
// @downloadURL  https://raw.githubusercontent.com/Fries91/sevends-hiring-scan/main/static/shield.user.js
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // CONFIG
  // =========================
  const BASE_URL = "https://sevends-hiring-scan.onrender.com"; // no trailing slash
  const POS_KEY_BADGE = "wrath_hiring_badge_pos_v3";
  const POS_KEY_PANEL = "wrath_hiring_panel_pos_v3";
  const ADMIN_TOKEN_KEY = "wrath_hiring_admin_token_v1";

  // =========================
  // CSS
  // =========================
  GM_addStyle(`
    #wrathHireBadge{
      position:fixed; z-index:999999;
      width:56px; height:56px;
      right:14px; top:180px;
      border-radius:16px;
      background:linear-gradient(180deg,#1a2434,#0b1220);
      border:1px solid rgba(255,255,255,.15);
      box-shadow:0 12px 30px rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center;
      cursor:pointer; user-select:none;
      backdrop-filter: blur(6px);
      -webkit-tap-highlight-color: transparent;
    }
    #wrathHireBadge .icon{ font-size:26px; }
    #wrathHireBadge .dot{
      position:absolute; right:8px; bottom:8px;
      width:10px; height:10px; border-radius:999px;
      background:rgba(80,255,160,.9);
      box-shadow:0 0 12px rgba(80,255,160,.55);
      opacity:.9;
    }

    #wrathHirePanel{
      position:fixed; z-index:999998;
      right:14px; top:250px;
      width:min(94vw,860px);
      height:min(82vh,860px);
      border-radius:16px;
      border:1px solid rgba(255,255,255,.15);
      background:#0b0f14;
      box-shadow:0 20px 60px rgba(0,0,0,.7);
      overflow:hidden;
      display:none;
      color:#e8eef7;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    }

    #wrathHireTop{
      display:flex; align-items:center; justify-content:space-between;
      padding:10px 12px;
      background:rgba(16,24,38,.9);
      border-bottom:1px solid rgba(255,255,255,.10);
      cursor:move;
      user-select:none;
    }
    #wrathHireTop .title{
      font-weight:800; font-size:13px; letter-spacing:.2px;
      display:flex; gap:8px; align-items:center;
    }
    #wrathHireTop .btns{ display:flex; gap:8px; align-items:center; }
    .whBtn{
      border:1px solid rgba(255,255,255,.15);
      background:#0c1320;
      color:#e8eef7;
      padding:7px 10px;
      border-radius:12px;
      font-size:12px;
      cursor:pointer;
    }
    .whBtn:active{ transform:scale(.98); }

    #wrathHireBody{
      padding:12px;
      height:calc(100% - 54px);
      overflow:auto;
    }

    .whCard{
      background:#101826;
      border:1px solid rgba(255,255,255,.08);
      border-radius:14px;
      padding:12px;
      margin-bottom:12px;
    }
    .whH{
      margin:0 0 10px 0;
      font-size:13px;
      font-weight:800;
      opacity:.95;
    }
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
    .whPill{
      display:inline-block;
      padding:4px 10px;
      border-radius:999px;
      background:rgba(255,255,255,.08);
      font-size:12px;
      margin-right:8px;
      margin-top:6px;
    }
    .whGood{ background:rgba(50,255,140,.14); }
    .whWarn{ background:rgba(255,200,70,.14); }
    .whBad{  background:rgba(255,60,60,.18); }

    table.whTable{
      width:100%;
      border-collapse: collapse;
      font-size:12px;
      margin-top:10px;
      overflow:hidden;
      border-radius:12px;
    }
    .whTable th, .whTable td{
      padding:8px;
      border-bottom:1px solid rgba(255,255,255,.08);
      text-align:left;
      vertical-align:middle;
    }
    .whTable th{
      position:sticky; top:0;
      background:#0c1320;
      z-index:1;
      font-size:12px;
      opacity:.95;
    }

    .whToast{
      margin-top:10px;
      padding:10px;
      border-radius:12px;
      background:rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.10);
      font-size:12px;
      opacity:.95;
    }
  `);

  // =========================
  // STATE
  // =========================
  let applicantStats = null; // {man,int,end,total}
  let companies = [];
  let panelOpen = false;

  // =========================
  // HELPERS
  // =========================
  const $ = (sel, root = document) => root.querySelector(sel);

  function getAdminToken() {
    return (GM_getValue(ADMIN_TOKEN_KEY, "") || "").trim();
  }

  function setAdminToken(tok) {
    GM_setValue(ADMIN_TOKEN_KEY, (tok || "").trim());
  }

  function apiGet(pathWithQuery) {
    return new Promise((resolve) => {
      const admin = getAdminToken();
      const joiner = pathWithQuery.includes("?") ? "&" : "?";
      const url = `${BASE_URL}${pathWithQuery}${joiner}admin=${encodeURIComponent(admin)}`;

      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 25000,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText || "{}");
            resolve(data);
          } catch (e) {
            resolve({ ok: false, error: "Bad JSON from server" });
          }
        },
        ontimeout: () => resolve({ ok: false, error: "Request timed out" }),
        onerror: () => resolve({ ok: false, error: "Network error" }),
      });
    });
  }

  function pillDelta(delta) {
    if (delta === null || delta === undefined) return `<span class="whPill">—</span>`;
    if (delta >= 0) return `<span class="whPill whGood">+${delta}</span>`;
    if (delta > -5000) return `<span class="whPill whWarn">${delta}</span>`;
    return `<span class="whPill whBad">${delta}</span>`;
  }

  function toInt(v) {
    const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  // =========================
  // UI CREATION
  // =========================
  const badge = document.createElement("div");
  badge.id = "wrathHireBadge";
  badge.innerHTML = `<div class="icon">💼</div><div class="dot"></div>`;
  document.body.appendChild(badge);

  const panel = document.createElement("div");
  panel.id = "wrathHirePanel";
  panel.innerHTML = `
    <div id="wrathHireTop">
      <div class="title">💼 7DS Hiring Scan <span style="opacity:.65;font-weight:700">| compare MAN/INT/END</span></div>
      <div class="btns">
        <button class="whBtn" id="whSetToken">Admin Token</button>
        <button class="whBtn" id="whRefresh">Refresh</button>
        <button class="whBtn" id="whClose">Close</button>
      </div>
    </div>
    <div id="wrathHireBody">

      <div class="whCard">
        <div class="whH">Applicant</div>
        <div class="whRow">
          <input class="whInput" id="whApplicantId" placeholder="Applicant Torn ID (optional if manual entry)" />
          <input class="whInput" id="whApplicantKey" placeholder="Applicant opt-in API key (optional)" />
          <button class="whBtn" id="whScanApplicant">Scan</button>
        </div>
        <div class="whSmall">If applicant key is blank (or denied), use manual entry below.</div>
        <div class="whRow" style="margin-top:10px">
          <input class="whInput" id="whMan" placeholder="MAN (manual)" />
          <input class="whInput" id="whInt" placeholder="INT (manual)" />
          <input class="whInput" id="whEnd" placeholder="END (manual)" />
          <button class="whBtn" id="whUseManual">Use Manual</button>
        </div>
        <div id="whApplicantOut" class="whToast">No applicant loaded yet.</div>
      </div>

      <div class="whCard">
        <div class="whH">Your Companies → Employees</div>
        <div class="whRow">
          <select class="whSelect" id="whCompanySel"><option>Loading…</option></select>
          <button class="whBtn" id="whLoadCompany">Load Company</button>
        </div>
        <div id="whCompanyOut" class="whToast">Select a company to load employees.</div>
      </div>

    </div>
  `;
  document.body.appendChild(panel);

  // =========================
  // POSITION SAVE/LOAD
  // =========================
  function loadPos(el, key, defaults) {
    const raw = GM_getValue(key, "");
    if (!raw) {
      if (defaults?.top != null) el.style.top = defaults.top + "px";
      if (defaults?.right != null) el.style.right = defaults.right + "px";
      return;
    }
    try {
      const p = JSON.parse(raw);
      if (typeof p.top === "number") el.style.top = p.top + "px";
      if (typeof p.right === "number") el.style.right = p.right + "px";
    } catch (e) {
      if (defaults?.top != null) el.style.top = defaults.top + "px";
      if (defaults?.right != null) el.style.right = defaults.right + "px";
    }
  }

  function savePos(el, key) {
    const top = parseInt(el.style.top || "0", 10);
    const right = parseInt(el.style.right || "0", 10);
    GM_setValue(key, JSON.stringify({ top, right }));
  }

  loadPos(badge, POS_KEY_BADGE, { top: 180, right: 14 });
  loadPos(panel, POS_KEY_PANEL, { top: 250, right: 14 });

  // =========================
  // DRAG LOGIC (badge + panel header)
  // =========================
  function enableDrag(el, handleEl, saveKey) {
    let dragging = false, moved = false;
    let startY = 0, startX = 0, startTop = 0, startRight = 0;

    handleEl.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = false;
      el.setPointerCapture?.(e.pointerId);
      startY = e.clientY;
      startX = e.clientX;

      const rect = el.getBoundingClientRect();
      startTop = rect.top;
      startRight = window.innerWidth - rect.right;
      e.preventDefault();
    });

    handleEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;

      const dy = e.clientY - startY;
      const dx = e.clientX - startX;
      if (Math.abs(dy) > 3 || Math.abs(dx) > 3) moved = true;

      const newTop = Math.max(8, Math.min(window.innerHeight - 70, startTop + dy));
      const newRight = Math.max(8, Math.min(window.innerWidth - 70, startRight - dx));
      el.style.top = newTop + "px";
      el.style.right = newRight + "px";
    });

    handleEl.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;
      savePos(el, saveKey);
      // return moved state so badge click logic can ignore after drag
      handleEl.__moved = moved;
      setTimeout(() => (handleEl.__moved = false), 0);
    });
  }

  enableDrag(badge, badge, POS_KEY_BADGE);
  enableDrag(panel, $("#wrathHireTop", panel), POS_KEY_PANEL);

  // =========================
  // OPEN/CLOSE
  // =========================
  function setPanel(open) {
    panelOpen = open;
    panel.style.display = open ? "block" : "none";
  }

  badge.addEventListener("click", () => {
    // ignore click that was actually a drag
    if (badge.__moved) return;
    setPanel(!panelOpen);
  });

  $("#whClose", panel).addEventListener("click", () => setPanel(false));

  // =========================
  // TOKEN BUTTON
  // =========================
  $("#whSetToken", panel).addEventListener("click", () => {
    const cur = getAdminToken();
    const tok = prompt("Enter ADMIN_TOKEN for your Render service:", cur || "");
    if (tok === null) return;
    setAdminToken(tok);
    toast($("#whCompanyOut", panel), "Token saved. Hit Refresh.");
  });

  // =========================
  // TOAST HELPERS
  // =========================
  function toast(el, msg) {
    el.innerHTML = msg;
  }

  function renderApplicant() {
    const out = $("#whApplicantOut", panel);
    if (!applicantStats) {
      toast(out, "No applicant loaded yet.");
      return;
    }
    toast(out, `
      <div>
        <span class="whPill">MAN: ${applicantStats.man ?? "?"}</span>
        <span class="whPill">INT: ${applicantStats.int ?? "?"}</span>
        <span class="whPill">END: ${applicantStats.end ?? "?"}</span>
        <span class="whPill">TOTAL: ${applicantStats.total ?? "?"}</span>
      </div>
    `);
  }

  // =========================
  // API ACTIONS
  // =========================
  async function loadCompanies() {
    const sel = $("#whCompanySel", panel);
    sel.innerHTML = `<option>Loading…</option>`;
    const data = await apiGet("/api/companies");

    if (!data.ok) {
      sel.innerHTML = `<option>—</option>`;
      toast($("#whCompanyOut", panel), `<span class="whPill whBad">Error: ${data.error || "failed"}</span>`);
      return;
    }

    companies = data.companies || [];
    if (!companies.length) {
      sel.innerHTML = `<option value="">No companies found</option>`;
      toast($("#whCompanyOut", panel), "No companies returned. Check COMPANY_IDS + TORN_API_KEY on Render.");
      return;
    }

    sel.innerHTML = companies
      .map((c) => `<option value="${String(c.id)}">${escapeHtml(c.name)} (#${escapeHtml(String(c.id))})</option>`)
      .join("");

    toast($("#whCompanyOut", panel), "Select a company and click Load Company.");
  }

  async function scanApplicant() {
    const id = ($("#whApplicantId", panel).value || "").trim();
    const key = ($("#whApplicantKey", panel).value || "").trim();
    const out = $("#whApplicantOut", panel);

    if (!id && !key) {
      toast(out, `<span class="whPill whWarn">Enter applicant ID + key, or use manual entry.</span>`);
      return;
    }
    if (!id) {
      toast(out, `<span class="whPill whWarn">Applicant ID is required to scan via API.</span>`);
      return;
    }
    if (!key) {
      toast(out, `<span class="whPill whWarn">No applicant key provided. Use manual entry.</span>`);
      return;
    }

    toast(out, "Scanning applicant…");
    const data = await apiGet(`/api/applicant?id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);

    if (!data.ok) {
      applicantStats = null;
      toast(out, `<span class="whPill whBad">Error: ${escapeHtml(data.error || "scan failed")}</span>`);
      return;
    }

    applicantStats = data.workstats || null;
    renderApplicant();
  }

  function useManual() {
    const man = toInt($("#whMan", panel).value);
    const inte = toInt($("#whInt", panel).value);
    const end = toInt($("#whEnd", panel).value);

    applicantStats = {
      man,
      int: inte,
      end,
      total: (man != null && inte != null && end != null) ? (man + inte + end) : null,
    };
    renderApplicant();
  }

  async function loadCompanyEmployees() {
    const sel = $("#whCompanySel", panel);
    const cid = (sel.value || "").trim();
    const out = $("#whCompanyOut", panel);

    if (!cid) {
      toast(out, `<span class="whPill whWarn">Pick a company first.</span>`);
      return;
    }

    toast(out, "Loading company…");
    const data = await apiGet(`/api/company?id=${encodeURIComponent(cid)}`);

    if (!data.ok) {
      toast(out, `<span class="whPill whBad">Error: ${escapeHtml(data.error || "load failed")}</span>`);
      return;
    }

    const company = data.company || { id: cid, name: `Company ${cid}` };
    const rows = data.employees || [];

    // Build table
    let html = `
      <div class="whSmall">Company: <b>${escapeHtml(company.name)}</b> (#${escapeHtml(String(company.id))})</div>
      <table class="whTable">
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

    for (const e of rows) {
      const ws = e.workstats || {};
      const eTotal = (ws.total ?? null);
      const aTotal = (applicantStats?.total ?? null);

      const delta = (aTotal != null && eTotal != null) ? (eTotal - aTotal) : null;

      html += `
        <tr>
          <td>${escapeHtml(e.name || ("#" + e.id))} <span style="opacity:.65">(#${escapeHtml(String(e.id))})</span></td>
          <td>${escapeHtml(e.position || "-")}</td>
          <td>${ws.man ?? "?"}</td>
          <td>${ws.int ?? "?"}</td>
          <td>${ws.end ?? "?"}</td>
          <td>${ws.total ?? "?"}</td>
          <td>${pillDelta(delta)}</td>
        </tr>
      `;
    }

    html += `</tbody></table>`;

    if (!applicantStats) {
      html += `<div class="whSmall" style="margin-top:8px">Load an applicant (or manual stats) to activate the compare column.</div>`;
    }

    toast(out, html);
  }

  // =========================
  // EVENTS
  // =========================
  $("#whRefresh", panel).addEventListener("click", loadCompanies);
  $("#whScanApplicant", panel).addEventListener("click", scanApplicant);
  $("#whUseManual", panel).addEventListener("click", useManual);
  $("#whLoadCompany", panel).addEventListener("click", loadCompanyEmployees);

  // =========================
  // HTML ESCAPE
  // =========================
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // =========================
  // BOOT
  // =========================
  (async function boot() {
    // If server is locked and token isn't set, prompt once
    // (You can cancel, but /api/companies will return unauthorized)
    if (!getAdminToken()) {
      // Optional: don’t annoy — comment this out if you want.
      const tok = prompt("Enter ADMIN_TOKEN for your Hiring Scan (Cancel to skip):", "");
      if (tok) setAdminToken(tok);
    }
    await loadCompanies();
  })();
})();
