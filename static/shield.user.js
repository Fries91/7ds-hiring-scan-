// ==UserScript==
// @name         Company Hub 💼 (Multi-User Auth + No Duplicates + Click Toggle + Draggable)
// @namespace    sevends-hiring-scan
// @version      3.0.1
// @description  Works with app.py multi-user: POST /api/auth {admin_key, api_key} -> X-Session-Token. No duplicates. Badge click open/close. Draggable. High-value theme.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      sevends-hiring-scan.onrender.com
// ==/UserScript==

(function () {
  "use strict";

  // ✅ LOCKED BASE URL (no asking, no prompts)
  const BASE_URL = "https://sevends-hiring-scan.onrender.com";

  // ✅ Element IDs
  const BADGE_ID = "companyhub-badge";
  const PANEL_ID = "companyhub-panel";
  const STYLE_ID = "companyhub-style";

  // ✅ Strong de-dupe: global flag + remove any existing nodes
  if (window.__COMPANY_HUB_V3__) return;
  window.__COMPANY_HUB_V3__ = true;

  // Remove any leftover elements from older script runs/versions
  const oldBadge = document.getElementById(BADGE_ID);
  const oldPanel = document.getElementById(PANEL_ID);
  if (oldBadge) oldBadge.remove();
  if (oldPanel) oldPanel.remove();

  // -----------------------
  // Storage keys
  // -----------------------
  const K_ADMIN = "company_hub_admin_key_v3";
  const K_API = "company_hub_api_key_v3";
  const K_TOKEN = "company_hub_session_token_v3";
  const K_COMPANY_IDS = "company_hub_company_ids_v3";
  const K_BADGE_POS = "company_hub_badge_pos_v3";
  const K_PANEL_POS = "company_hub_panel_pos_v3";

  // -----------------------
  // Helpers
  // -----------------------
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function safeParseJSON(str, fallback) {
    try {
      const v = JSON.parse(str);
      return v && typeof v === "object" ? v : fallback;
    } catch {
      return fallback;
    }
  }

  function getSavedPos(key, fallback) {
    const raw = GM_getValue(key, "");
    if (!raw) return fallback;
    const obj = safeParseJSON(raw, null);
    if (!obj) return fallback;
    const x = Number(obj.x);
    const y = Number(obj.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
    return { x, y };
  }

  function savePos(key, x, y) {
    GM_setValue(key, JSON.stringify({ x, y }));
  }

  function gmReq(method, url, dataObj, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: { "Content-Type": "application/json", ...extraHeaders },
        data: dataObj ? JSON.stringify(dataObj) : null,
        onload: (res) => {
          let json = {};
          try {
            json = JSON.parse(res.responseText || "{}");
          } catch {}
          resolve({ status: res.status, json });
        },
        onerror: () => reject(new Error("network error")),
      });
    });
  }

  function tokenHeader() {
    const tok = (GM_getValue(K_TOKEN, "") || "").trim();
    return tok ? { "X-Session-Token": tok } : {};
  }

  async function authed(method, path, dataObj) {
    return gmReq(method, `${BASE_URL}${path}`, dataObj, tokenHeader());
  }

  function promptMaybe(label, currentVal) {
    const out = prompt(label, currentVal || "");
    if (out === null) return null;
    return String(out).trim();
  }

  // -----------------------
  // Auth
  // -----------------------
  async function login(force = false) {
    const admin_key = (GM_getValue(K_ADMIN, "") || "").trim();
    const api_key = (GM_getValue(K_API, "") || "").trim();
    const existing = (GM_getValue(K_TOKEN, "") || "").trim();

    if (!admin_key || !api_key) return { ok: false, error: "Missing admin key / api key. Click Settings." };
    if (existing && !force) return { ok: true, token: existing };

    const res = await gmReq("POST", `${BASE_URL}/api/auth`, { admin_key, api_key });
    if (res.status !== 200 || !res.json || res.json.ok !== true || !res.json.token) {
      GM_setValue(K_TOKEN, "");
      return { ok: false, error: res.json?.error || `Auth failed (HTTP ${res.status})` };
    }

    GM_setValue(K_TOKEN, res.json.token);
    return { ok: true, token: res.json.token, user: res.json.user };
  }

  async function openSettings() {
    const curAdmin = (GM_getValue(K_ADMIN, "") || "").trim();
    const curApi = (GM_getValue(K_API, "") || "").trim();
    const curCids = (GM_getValue(K_COMPANY_IDS, "") || "").trim();

    const a = promptMaybe("Admin Key (must be in Render ADMIN_KEYS list)", curAdmin);
    if (a === null) return { ok: false, error: "Cancelled" };

    const k = promptMaybe("Your Torn API Key (your own key)", curApi);
    if (k === null) return { ok: false, error: "Cancelled" };

    const c = promptMaybe("Your Company IDs (comma-separated) (optional)\nExample: 12345,67890", curCids);
    if (c === null) return { ok: false, error: "Cancelled" };

    GM_setValue(K_ADMIN, a);
    GM_setValue(K_API, k);
    GM_setValue(K_COMPANY_IDS, c || "");
    GM_setValue(K_TOKEN, ""); // force refresh token

    const auth = await login(true);
    if (!auth.ok) return { ok: false, error: auth.error || "Auth failed" };

    const ids = (c || "").trim();
    if (ids) {
      await authed("POST", "/api/user/companies", { company_ids: ids });
    }

    return { ok: true };
  }

  // -----------------------
  // CSS
  // -----------------------
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :root{ --hv-text:#e5e7eb; --hv-muted:rgba(229,231,235,0.72); }
      #${BADGE_ID}, #${PANEL_ID} { all: initial; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial; }

      #${BADGE_ID}{
        position:fixed; right:14px; bottom:110px;
        z-index:1000001;
        width:44px; height:44px; border-radius:14px;
        background:
          radial-gradient(120% 120% at 20% 10%, rgba(212,175,55,0.20), transparent 45%),
          linear-gradient(135deg, rgba(18,22,32,0.95), rgba(7,9,13,0.95));
        border:1px solid rgba(212,175,55,0.35);
        box-shadow:0 14px 34px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06) inset;
        display:grid; place-items:center; cursor:pointer;
        user-select:none; touch-action:none;
      }
      #${BADGE_ID}::after{
        content:""; position:absolute; inset:5px; border-radius:11px;
        border:1px solid rgba(247,231,169,0.18); pointer-events:none;
      }
      #${BADGE_ID} span{ font-size:22px; line-height:1; filter:drop-shadow(0 2px 6px rgba(0,0,0,0.55)); }

      #${PANEL_ID}{
        position:fixed; right:14px; bottom:170px;
        z-index:1000000;
        width:min(92vw, 380px);
        background:
          radial-gradient(120% 120% at 0% 0%, rgba(212,175,55,0.10), transparent 40%),
          radial-gradient(120% 120% at 100% 0%, rgba(99,102,241,0.08), transparent 45%),
          linear-gradient(180deg, rgba(14,18,28,0.96), rgba(8,10,14,0.96));
        border:1px solid rgba(255,255,255,0.10);
        border-radius:16px;
        box-shadow:0 18px 52px rgba(0,0,0,0.65);
        overflow:hidden;
        display:none;
        backdrop-filter:blur(8px);
        touch-action:none;
      }

      #companyhub-head{
        padding:10px 12px;
        display:flex; align-items:center; justify-content:space-between;
        border-bottom:1px solid rgba(255,255,255,0.10);
        color:var(--hv-text);
        font-weight:950;
        cursor:move;
        user-select:none;
      }

      #companyhub-title{ display:flex; align-items:center; gap:8px; min-width:0; }
      #companyhub-title .crest{
        width:18px; height:18px; border-radius:6px;
        background: radial-gradient(110% 110% at 30% 20%, rgba(247,231,169,0.35), transparent 55%),
                    linear-gradient(135deg, rgba(212,175,55,0.32), rgba(212,175,55,0.10));
        border:1px solid rgba(212,175,55,0.35);
        box-shadow:0 0 0 1px rgba(255,255,255,0.06) inset;
        flex:0 0 auto;
      }
      #companyhub-title .text{ display:flex; flex-direction:column; min-width:0; }
      #companyhub-title .main{ font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #companyhub-title .sub{ font-size:11px; color:rgba(247,231,169,0.70); font-weight:800; margin-top:2px; }

      #companyhub-tabs{
        display:flex; gap:6px; padding:8px 10px;
        border-bottom:1px solid rgba(255,255,255,0.08);
        flex-wrap:wrap;
      }
      .ch-tab{
        background:rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.08);
        color:var(--hv-text);
        font-weight:900;
        border-radius:10px;
        padding:6px 8px;
        font-size:12px;
        cursor:pointer;
        user-select:none;
      }
      .ch-tab.active{
        background:linear-gradient(135deg, rgba(212,175,55,0.20), rgba(99,102,241,0.14));
        border-color:rgba(212,175,55,0.28);
      }

      #companyhub-body{ padding:10px; color:var(--hv-text); }
      .muted{ color:var(--hv-muted); font-size:12px; }

      .ch-btn{
        background:rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.10);
        color:var(--hv-text);
        border-radius:10px;
        padding:8px 10px;
        font-weight:950;
        cursor:pointer;
        font-size:12px;
        white-space:nowrap;
        user-select:none;
      }
      .ch-btn.primary{ background:rgba(16,185,129,0.16); border-color:rgba(16,185,129,0.25); }
      .ch-btn.red{ background:rgba(239,68,68,0.16); border-color:rgba(239,68,68,0.25); }

      .card{
        background: radial-gradient(120% 120% at 0% 0%, rgba(212,175,55,0.07), transparent 45%),
                    rgba(255,255,255,0.05);
        border:1px solid rgba(255,255,255,0.10);
        border-radius:12px;
        padding:10px;
        margin:8px 0;
        box-shadow:0 6px 20px rgba(0,0,0,0.35);
      }
      .headline{ font-weight:950; letter-spacing:0.1px; }
      .row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px; }

      input.ch-in, select.ch-sel{
        all: initial;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial;
        background:rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.12);
        color:var(--hv-text);
        border-radius:10px;
        padding:8px 10px;
        font-size:12px;
        width: 100%;
        box-sizing:border-box;
      }

      .mini{ font-size:11px; color:rgba(247,231,169,0.70); font-weight:800; }
      .line{ height:1px; background:rgba(255,255,255,0.08); margin:10px 0; }

      .listrow{
        display:flex; justify-content:space-between; gap:10px; align-items:center;
        padding:8px 8px; border-radius:10px;
        background:rgba(255,255,255,0.04);
        border:1px solid rgba(255,255,255,0.08);
        margin-top:6px;
      }
      .listrow .left{ min-width:0; }
      .listrow .left .t{ font-weight:950; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .listrow .left .s{ font-size:11px; color:var(--hv-muted); margin-top:2px; }
    `;
    document.head.appendChild(style);
  }

  // -----------------------
  // DOM
  // -----------------------
  const badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.innerHTML = `<span>💼</span>`;
  document.body.appendChild(badge);

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div id="companyhub-head">
      <div id="companyhub-title">
        <div class="crest"></div>
        <div class="text">
          <div class="main">Company Hub</div>
          <div class="sub">High-Value Suite</div>
        </div>
      </div>
      <div class="row" style="margin:0;">
        <button class="ch-btn primary" id="ch-settings">Settings</button>
        <button class="ch-btn red" id="ch-close">X</button>
      </div>
    </div>
    <div id="companyhub-tabs">
      <button class="ch-tab active" data-tab="companies">Companies</button>
      <button class="ch-tab" data-tab="trains">Trains</button>
      <button class="ch-tab" data-tab="apps">Applications</button>
      <button class="ch-tab" data-tab="search">Search</button>
    </div>
    <div id="companyhub-body"></div>
  `;
  document.body.appendChild(panel);

  // Restore positions
  (function restorePositions() {
    const b = getSavedPos(K_BADGE_POS, null);
    if (b) {
      badge.style.left = b.x + "px";
      badge.style.top = b.y + "px";
      badge.style.right = "auto";
      badge.style.bottom = "auto";
    }
    const p = getSavedPos(K_PANEL_POS, null);
    if (p) {
      panel.style.left = p.x + "px";
      panel.style.top = p.y + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
  })();

  function togglePanel() {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    if (panel.style.display !== "none") renderActiveTab();
  }

  function makeBadgeDraggableAndToggle(el, storeKey) {
    const threshold = 8;
    let down = false, moved = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    function onDown(ev) {
      const pt = ev.touches ? ev.touches[0] : ev;
      down = true; moved = false;

      const r = el.getBoundingClientRect();
      startX = pt.clientX; startY = pt.clientY;
      startLeft = r.left; startTop = r.top;

      el.style.left = startLeft + "px";
      el.style.top = startTop + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";

      window.addEventListener("mousemove", onMove, { passive: false });
      window.addEventListener("mouseup", onUp, { passive: false });
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp, { passive: false });
      window.addEventListener("touchcancel", onUp, { passive: false });
    }

    function onMove(ev) {
      if (!down) return;
      const pt = ev.touches ? ev.touches[0] : ev;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;

      if (Math.abs(dx) + Math.abs(dy) > threshold) moved = true;

      const rect = el.getBoundingClientRect();
      let x = startLeft + dx;
      let y = startTop + dy;

      x = clamp(x, 6, window.innerWidth - rect.width - 6);
      y = clamp(y, 6, window.innerHeight - rect.height - 6);

      el.style.left = x + "px";
      el.style.top = y + "px";

      if (moved) { ev.preventDefault(); ev.stopPropagation(); }
    }

    function onUp(ev) {
      if (!down) return;
      down = false;

      const rect = el.getBoundingClientRect();
      savePos(storeKey, Math.round(rect.left), Math.round(rect.top));

      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);

      if (!moved) togglePanel();
      ev?.preventDefault?.(); ev?.stopPropagation?.();
    }

    el.addEventListener("mousedown", onDown, { passive: false });
    el.addEventListener("touchstart", onDown, { passive: false });
  }

  function makePanelDraggable(handleEl, moveEl, storeKey) {
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    function onDown(ev) {
      const t = ev.target;
      if (t && (t.tagName === "BUTTON" || t.closest("button") || t.tagName === "INPUT" || t.tagName === "SELECT")) return;

      dragging = true;
      const pt = ev.touches ? ev.touches[0] : ev;

      const r = moveEl.getBoundingClientRect();
      startX = pt.clientX; startY = pt.clientY;
      startLeft = r.left; startTop = r.top;

      moveEl.style.left = startLeft + "px";
      moveEl.style.top = startTop + "px";
      moveEl.style.right = "auto";
      moveEl.style.bottom = "auto";

      ev.preventDefault(); ev.stopPropagation();

      window.addEventListener("mousemove", onMove, { passive: false });
      window.addEventListener("mouseup", onUp, { passive: false });
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp, { passive: false });
      window.addEventListener("touchcancel", onUp, { passive: false });
    }

    function onMove(ev) {
      if (!dragging) return;
      const pt = ev.touches ? ev.touches[0] : ev;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;

      const rect = moveEl.getBoundingClientRect();
      let x = startLeft + dx;
      let y = startTop + dy;

      x = clamp(x, 6, window.innerWidth - rect.width - 6);
      y = clamp(y, 6, window.innerHeight - rect.height - 6);

      moveEl.style.left = x + "px";
      moveEl.style.top = y + "px";

      ev.preventDefault(); ev.stopPropagation();
    }

    function onUp(ev) {
      if (!dragging) return;
      dragging = false;

      const rect = moveEl.getBoundingClientRect();
      savePos(storeKey, Math.round(rect.left), Math.round(rect.top));

      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);

      ev?.preventDefault?.(); ev?.stopPropagation?.();
    }

    handleEl.addEventListener("mousedown", onDown, { passive: false });
    handleEl.addEventListener("touchstart", onDown, { passive: false });
  }

  makeBadgeDraggableAndToggle(badge, K_BADGE_POS);
  makePanelDraggable(panel.querySelector("#companyhub-head"), panel, K_PANEL_POS);

  // Tabs
  const body = panel.querySelector("#companyhub-body");
  const tabs = Array.from(panel.querySelectorAll(".ch-tab"));
  let active = "companies";

  function setActive(tab) {
    active = tab;
    tabs.forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === tab));
    renderActiveTab();
  }

  tabs.forEach((t) =>
    t.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      setActive(t.getAttribute("data-tab"));
    })
  );

  panel.querySelector("#ch-close").addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    togglePanel();
  });

  panel.querySelector("#ch-settings").addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    body.innerHTML = `<div class="card"><div class="muted">Opening settings…</div></div>`;
    const res = await openSettings();
    if (!res.ok) {
      body.innerHTML = `<div class="card"><div class="headline">Settings</div><div class="muted" style="margin-top:6px;">${escapeHtml(res.error || "Cancelled")}</div></div>`;
      return;
    }
    renderActiveTab();
  });

  async function ensureLoggedIn() {
    const tok = (GM_getValue(K_TOKEN, "") || "").trim();
    if (tok) return { ok: true };
    const res = await login(false);
    return res.ok ? { ok: true } : { ok: false, error: res.error || "Auth failed" };
  }

  async function renderActiveTab() {
    const admin = (GM_getValue(K_ADMIN, "") || "").trim();
    const api = (GM_getValue(K_API, "") || "").trim();

    if (!admin || !api) {
      body.innerHTML = `
        <div class="card">
          <div class="headline">Setup needed</div>
          <div class="muted" style="margin-top:6px;">
            Click <b>Settings</b> and enter:
            <br/>• your <b>Admin Key</b>
            <br/>• your <b>Torn API key</b>
            <br/>• your company IDs (optional)
          </div>
        </div>`;
      return;
    }

    body.innerHTML = `<div class="card"><div class="muted">Loading…</div></div>`;

    const auth = await ensureLoggedIn();
    if (!auth.ok) {
      body.innerHTML = `
        <div class="card">
          <div class="headline">Auth error</div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(auth.error)}</div>
          <div class="row">
            <button class="ch-btn primary" id="btn-retry">Retry Login</button>
            <button class="ch-btn" id="btn-reset">Reset Token</button>
          </div>
        </div>`;
      body.querySelector("#btn-retry").onclick = async () => { await login(true); renderActiveTab(); };
      body.querySelector("#btn-reset").onclick = () => { GM_setValue(K_TOKEN, ""); renderActiveTab(); };
      return;
    }

    if (active === "companies") return renderCompanies();
    if (active === "trains") return renderTrains();
    if (active === "apps") return renderApplications();
    if (active === "search") return renderSearch();
  }

  // ---------------- Companies ----------------
  async function renderCompanies() {
    const savedCids = (GM_getValue(K_COMPANY_IDS, "") || "").trim();

    const res = await authed("GET", "/api/companies", null);
    if (res.status === 401) { GM_setValue(K_TOKEN, ""); return renderActiveTab(); }
    if (!res.json || res.json.ok !== true) {
      body.innerHTML = `<div class="card"><div class="headline">Error</div><div class="muted" style="margin-top:6px;">${escapeHtml(res.json?.error || "Failed")}</div></div>`;
      return;
    }

    const rows = res.json.rows || [];
    let html = `
      <div class="card">
        <div class="headline">Companies</div>
        <div class="muted" style="margin-top:6px;">Set IDs → Save → then your employees load.</div>
        <div class="line"></div>
        <div class="mini">Company IDs (comma separated)</div>
        <div class="row" style="margin-top:6px;">
          <input class="ch-in" id="cids" placeholder="12345,67890" value="${escapeHtml(savedCids)}" />
        </div>
        <div class="row">
          <button class="ch-btn primary" id="saveCids">Save</button>
          <button class="ch-btn" id="refreshCompanies">Refresh</button>
        </div>
      </div>
    `;

    if (!rows.length) {
      html += `<div class="card"><div class="muted">No companies returned yet.</div></div>`;
      body.innerHTML = html;
      wireCompaniesButtons();
      return;
    }

    for (const c of rows) {
      const emps = Array.isArray(c.employees) ? c.employees : [];
      html += `
        <div class="card">
          <div class="headline">${escapeHtml(c.name || ("Company " + c.company_id))}</div>
          <div class="muted" style="margin-top:6px;">ID: ${escapeHtml(c.company_id)} • Employees: ${escapeHtml(String(emps.length))}</div>
          ${c.error ? `<div class="muted" style="margin-top:6px;color:rgba(248,113,113,0.9);">${escapeHtml(c.error)}</div>` : ""}
          <div class="line"></div>
          ${emps.slice(0, 25).map((e) => {
            const nm = e.name || "Employee";
            const id = e.id || "";
            return `
              <div class="listrow">
                <div class="left">
                  <div class="t">${escapeHtml(nm)} ${id ? `<span class="muted">[${escapeHtml(id)}]</span>` : ""}</div>
                  <div class="s">${escapeHtml(e.position || "")}</div>
                </div>
              </div>`;
          }).join("")}
          ${emps.length > 25 ? `<div class="muted" style="margin-top:8px;">Showing first 25 employees.</div>` : ""}
        </div>
      `;
    }

    body.innerHTML = html;
    wireCompaniesButtons();
  }

  function wireCompaniesButtons() {
    const saveBtn = body.querySelector("#saveCids");
    const refBtn = body.querySelector("#refreshCompanies");
    const cidsEl = body.querySelector("#cids");

    if (saveBtn) {
      saveBtn.onclick = async () => {
        const ids = (cidsEl?.value || "").trim();
        GM_setValue(K_COMPANY_IDS, ids);
        const r = await authed("POST", "/api/user/companies", { company_ids: ids });
        if (r.status === 401) { GM_setValue(K_TOKEN, ""); return renderActiveTab(); }
        renderCompanies();
      };
    }
    if (refBtn) refBtn.onclick = () => renderCompanies();
  }

  // ---------------- Trains ----------------
  async function renderTrains() {
    const saved = (GM_getValue(K_COMPANY_IDS, "") || "").trim();
    const list = saved ? saved.split(",").map((s) => s.trim()).filter(Boolean) : [];

    body.innerHTML = `
      <div class="card">
        <div class="headline">Train Tracker</div>
        <div class="muted" style="margin-top:6px;">Per-user train records (saved on server DB).</div>
        <div class="line"></div>
        <div class="mini">Company</div>
        <div class="row" style="margin-top:6px;">
          <select class="ch-sel" id="trainCompany">
            ${list.length ? list.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("") : `<option value="">(set company IDs in Companies tab)</option>`}
          </select>
        </div>
        <div class="row"><button class="ch-btn primary" id="loadTrains">Load</button></div>
      </div>
      <div id="trainArea"></div>
    `;

    const loadBtn = body.querySelector("#loadTrains");
    if (loadBtn) loadBtn.onclick = () => loadTrains();
    if (list.length) loadTrains();
  }

  async function loadTrains() {
    const area = body.querySelector("#trainArea");
    const companyId = (body.querySelector("#trainCompany")?.value || "").trim();
    if (!companyId) {
      area.innerHTML = `<div class="card"><div class="muted">Set company IDs first (Companies tab).</div></div>`;
      return;
    }

    area.innerHTML = `<div class="card"><div class="muted">Loading trains…</div></div>`;
    const res = await authed("GET", `/api/trains?company_id=${encodeURIComponent(companyId)}`, null);
    if (res.status === 401) { GM_setValue(K_TOKEN, ""); return renderActiveTab(); }
    if (!res.json || res.json.ok !== true) {
      area.innerHTML = `<div class="card"><div class="headline">Error</div><div class="muted" style="margin-top:6px;">${escapeHtml(res.json?.error || "Failed")}</div></div>`;
      return;
    }

    const rows = res.json.rows || [];
    let html = `
      <div class="card">
        <div class="headline">Add Train Entry</div>
        <div class="row"><input class="ch-in" id="trBuyer" placeholder="Buyer name" /></div>
        <div class="row"><input class="ch-in" id="trCount" placeholder="Trains (number)" inputmode="numeric" /></div>
        <div class="row"><input class="ch-in" id="trNote" placeholder="Note (optional)" /></div>
        <div class="row">
          <button class="ch-btn primary" id="trAdd">Add</button>
          <button class="ch-btn" id="trReload">Reload</button>
        </div>
      </div>
    `;

    if (!rows.length) {
      html += `<div class="card"><div class="muted">No train entries yet.</div></div>`;
      area.innerHTML = html;
      wireTrainButtons(companyId);
      return;
    }

    html += `<div class="card"><div class="headline">Recent Entries</div>`;
    for (const r of rows) {
      html += `
        <div class="listrow">
          <div class="left">
            <div class="t">${escapeHtml(r.buyer || "Buyer")} • ${escapeHtml(String(r.trains || 0))} trains</div>
            <div class="s">${escapeHtml(r.note || "")}${r.created_at ? ` • ${escapeHtml(r.created_at)}` : ""}</div>
          </div>
          <div><button class="ch-btn red" data-del="${escapeHtml(String(r.id))}">Del</button></div>
        </div>
      `;
    }
    html += `</div>`;

    area.innerHTML = html;
    wireTrainButtons(companyId);
  }

  function wireTrainButtons(companyId) {
    const area = body.querySelector("#trainArea");
    area.querySelector("#trReload").onclick = () => loadTrains();

    area.querySelector("#trAdd").onclick = async () => {
      const buyer = (area.querySelector("#trBuyer")?.value || "").trim();
      const trains = (area.querySelector("#trCount")?.value || "").trim();
      const note = (area.querySelector("#trNote")?.value || "").trim();

      const res = await authed("POST", "/api/trains/add", { company_id: companyId, buyer, trains, note });
      if (res.status === 401) { GM_setValue(K_TOKEN, ""); return renderActiveTab(); }
      if (!res.json || res.json.ok !== true) { alert(res.json?.error || "Failed to add"); return; }
      loadTrains();
    };

    area.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-del");
        const res = await authed("POST", "/api/trains/delete", { id });
        if (res.status === 401) { GM_setValue(K_TOKEN, ""); return renderActiveTab(); }
        loadTrains();
      };
    });
  }

  // ---------------- Applications ----------------
  async function renderApplications() {
    body.innerHTML = `<div class="card"><div class="muted">Loading applications…</div></div>`;
    const res = await authed("GET", "/api/applications", null);
    if (res.status === 401) { GM_setValue(K_TOKEN, ""); return renderActiveTab(); }
    if (!res.json || res.json.ok !== true) {
      body.innerHTML = `<div class="card"><div class="headline">Error</div><div class="muted" style="margin-top:6px;">${escapeHtml(res.json?.error || "Failed")}</div></div>`;
      return;
    }

    const rows = res.json.rows || [];
    let html = `
      <div class="card">
        <div class="headline">Applications</div>
        <div class="muted" style="margin-top:6px;">Pulled from your Torn events (per-user).</div>
        <div class="row"><button class="ch-btn primary" id="appRefresh">Refresh</button></div>
      </div>
    `;

    if (!rows.length) {
      html += `<div class="card"><div class="muted">No application events found yet.</div></div>`;
      body.innerHTML = html;
      body.querySelector("#appRefresh").onclick = () => renderApplications();
      return;
    }

    html += `<div class="card"><div class="headline">Recent</div>`;
    for (const r of rows) {
      html += `
        <div class="listrow">
          <div class="left">
            <div class="t">${escapeHtml(r.applicant_id || "Applicant")} <span class="muted">• ${escapeHtml(r.status || "new")}</span></div>
            <div class="s">${escapeHtml(r.raw_text || "")}</div>
          </div>
          <div class="row" style="margin:0;">
            <button class="ch-btn" data-status="review" data-id="${escapeHtml(String(r.id))}">Review</button>
            <button class="ch-btn" data-status="reject" data-id="${escapeHtml(String(r.id))}">Reject</button>
            <button class="ch-btn primary" data-status="accept" data-id="${escapeHtml(String(r.id))}">Accept</button>
          </div>
        </div>
      `;
    }
    html += `</div>`;

    body.innerHTML = html;
    body.querySelector("#appRefresh").onclick = () => renderApplications();
    body.querySelectorAll("button[data-status][data-id]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-id");
        const status = btn.getAttribute("data-status");
        const rr = await authed("POST", "/api/applications/status", { id, status });
        if (rr.status === 401) { GM_setValue(K_TOKEN, ""); return renderActiveTab(); }
        renderApplications();
      };
    });
  }

  // ---------------- Search ----------------
  async function renderSearch() {
    body.innerHTML = `
      <div class="card">
        <div class="headline">HoF Workstats Search</div>
        <div class="muted" style="margin-top:6px;">Scans HoF pages using your API key.</div>
        <div class="line"></div>
        <div class="mini">Min Total Workstats</div>
        <div class="row"><input class="ch-in" id="minv" placeholder="e.g. 50000" inputmode="numeric"></div>
        <div class="mini" style="margin-top:10px;">Max Total Workstats</div>
        <div class="row"><input class="ch-in" id="maxv" placeholder="e.g. 120000" inputmode="numeric"></div>
        <div class="mini" style="margin-top:10px;">Limit (1-300)</div>
        <div class="row"><input class="ch-in" id="lim" placeholder="100" inputmode="numeric" value="100"></div>
        <div class="row"><button class="ch-btn primary" id="runSearch">Search</button></div>
      </div>
      <div id="searchOut"></div>
    `;

    body.querySelector("#runSearch").onclick = async () => {
      const out = body.querySelector("#searchOut");
      const minv = (body.querySelector("#minv").value || "").trim();
      const maxv = (body.querySelector("#maxv").value || "").trim();
      const lim = (body.querySelector("#lim").value || "100").trim();

      out.innerHTML = `<div class="card"><div class="muted">Searching…</div></div>`;
      const res = await authed(
        "GET",
        `/api/search_workstats?min=${encodeURIComponent(minv)}&max=${encodeURIComponent(maxv)}&limit=${encodeURIComponent(lim)}`,
        null
      );

      if (res.status === 401) { GM_setValue(K_TOKEN, ""); return renderActiveTab(); }
      if (!res.json || res.json.ok !== true) {
        out.innerHTML = `<div class="card"><div class="headline">Error</div><div class="muted" style="margin-top:6px;">${escapeHtml(res.json?.error || "Failed")}</div></div>`;
        return;
      }

      const rows = res.json.rows || [];
      let html = `
        <div class="card">
          <div class="headline">Results</div>
          <div class="muted" style="margin-top:6px;">
            Count: ${escapeHtml(String(res.json.count || rows.length))} • Pages: ${escapeHtml(String(res.json.scanned_pages || "?"))}
            ${res.json.cached ? " • cached" : ""}
          </div>
        </div>
      `;

      if (!rows.length) {
        html += `<div class="card"><div class="muted">No matches.</div></div>`;
        out.innerHTML = html;
        return;
      }

      html += `<div class="card"><div class="headline">Players</div>`;
      for (const r of rows.slice(0, 100)) {
        const name = r.name || "Player";
        const id = r.id || "";
        const total = r.value ?? r.total ?? "";
        html += `
          <div class="listrow">
            <div class="left">
              <div class="t">${escapeHtml(name)} ${id ? `<span class="muted">[${escapeHtml(id)}]</span>` : ""}</div>
              <div class="s">Workstats: ${escapeHtml(String(total))}</div>
            </div>
            <div>
              ${id ? `<a href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}" target="_blank" class="ch-btn" style="text-decoration:none; display:inline-block;">Open</a>` : ""}
            </div>
          </div>
        `;
      }
      html += `</div>`;
      out.innerHTML = html;
    };
  }

  // Start hidden
  panel.style.display = "none";
})();
