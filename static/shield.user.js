// ==UserScript==
// @name         7DS*: Peace Hiring Hub 💼 (NO URL prompt + Cancel stops prompts)
// @namespace    sevends-hiring-scan
// @version      2.0.3
// @description  Multi-user Hiring Hub. No BASE_URL prompt. Users enter Admin Key + their Torn API key via Settings only. Cancel won't re-prompt.
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

  // ✅ HARD-CODED SERVICE URL (NO PROMPTS EVER)
  const BASE_URL = "https://sevends-hiring-scan.onrender.com";

  // -----------------------
  // Storage keys
  // -----------------------
  const K_ADMIN = "peace_hub_admin_key";
  const K_API = "peace_hub_user_api_key";
  const K_TOKEN = "peace_hub_session_token";
  const K_COMPANY_IDS = "peace_hub_company_ids";
  const K_CANCELLED = "peace_hub_cancelled_setup"; // if cancelled, never prompt again automatically

  // -----------------------
  // Helpers
  // -----------------------
  function gmReq(method, url, dataObj, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: { "Content-Type": "application/json", ...extraHeaders },
        data: dataObj ? JSON.stringify(dataObj) : null,
        onload: (res) => {
          try {
            const json = JSON.parse(res.responseText || "{}");
            resolve({ status: res.status, json });
          } catch (e) {
            resolve({ status: res.status, json: { ok: false, error: "bad json" } });
          }
        },
        onerror: () => reject(new Error("network error")),
      });
    });
  }

  function gmReqAuthed(method, url, dataObj) {
    const token = (GM_getValue(K_TOKEN, "") || "").trim();
    return gmReq(method, url, dataObj, { "X-Session-Token": token });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function promptMaybe(label, currentVal) {
    const out = prompt(label, currentVal || "");
    if (out === null) return null; // Cancel
    return String(out).trim();
  }

  // ✅ ONLY called from Settings button (never auto-called)
  async function runSettingsWizard() {
    const cancelled = !!GM_getValue(K_CANCELLED, false);
    // If previously cancelled, we still allow Settings to try again (because they clicked Settings intentionally)
    // but we won't auto-prompt anywhere else.
    if (cancelled) {
      // keep cancelled true until they successfully complete auth
    }

    let admin = (GM_getValue(K_ADMIN, "") || "").trim();
    let api = (GM_getValue(K_API, "") || "").trim();
    let cids = (GM_getValue(K_COMPANY_IDS, "") || "").trim();

    const a = promptMaybe("Admin Access Key (from Fries)", admin);
    if (a === null) {
      GM_setValue(K_CANCELLED, true);
      return { ok: false, error: "Cancelled" };
    }
    admin = a;

    const k = promptMaybe("Your Torn API Key (your own key)", api);
    if (k === null) {
      GM_setValue(K_CANCELLED, true);
      return { ok: false, error: "Cancelled" };
    }
    api = k;

    const ci = promptMaybe("Your Company IDs (comma-separated) (optional)\nExample: 12345,67890", cids);
    if (ci === null) {
      GM_setValue(K_CANCELLED, true);
      return { ok: false, error: "Cancelled" };
    }
    cids = ci;

    GM_setValue(K_ADMIN, admin);
    GM_setValue(K_API, api);
    GM_setValue(K_COMPANY_IDS, cids);

    // Clear token so we re-auth cleanly
    GM_setValue(K_TOKEN, "");

    // Try auth now
    try {
      await ensureAuth(true);
      // ✅ only clear cancelled flag after successful auth
      GM_setValue(K_CANCELLED, false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async function ensureAuth(allowErrorThrow = false) {
    const admin = (GM_getValue(K_ADMIN, "") || "").trim();
    const api = (GM_getValue(K_API, "") || "").trim();
    const cancelled = !!GM_getValue(K_CANCELLED, false);

    // ✅ NEVER prompt automatically
    if (!admin || !api) {
      if (allowErrorThrow) throw new Error("Missing keys");
      return false;
    }

    // If token exists, trust it until server rejects
    const tok = (GM_getValue(K_TOKEN, "") || "").trim();
    if (tok) return true;

    const { status, json } = await gmReq("POST", `${BASE_URL}/api/auth`, {
      admin_key: admin,
      api_key: api,
    });

    if (!json || json.ok !== true || !json.token) {
      GM_setValue(K_TOKEN, "");
      throw new Error(json?.error || `Auth failed (HTTP ${status})`);
    }

    GM_setValue(K_TOKEN, json.token);

    // Push company IDs right after auth (optional)
    const cids = (GM_getValue(K_COMPANY_IDS, "") || "").trim();
    if (cids) {
      await gmReqAuthed("POST", `${BASE_URL}/api/user/companies`, { company_ids: cids });
    }

    return true;
  }

  // -----------------------
  // UI
  // -----------------------
  GM_addStyle(`
    #peace-badge, #peace-panel { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial; }
    #peace-badge {
      position: fixed; right: 14px; bottom: 110px; z-index: 999999;
      width: 54px; height: 54px; border-radius: 16px;
      background: linear-gradient(135deg, #111827, #0b1220);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 10px 25px rgba(0,0,0,0.35);
      display: grid; place-items: center; cursor: pointer;
      user-select:none;
    }
    #peace-badge span { font-size: 26px; line-height: 1; }
    #peace-panel {
      position: fixed; right: 14px; bottom: 170px; z-index: 999999;
      width: min(92vw, 360px);
      background: rgba(10,14,22,0.94);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.5);
      overflow: hidden;
      display: none;
      backdrop-filter: blur(6px);
    }
    #peace-head {
      padding: 10px 12px;
      display:flex; align-items:center; justify-content:space-between;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      color: #e5e7eb;
      font-weight: 900;
    }
    #peace-tabs {
      display:flex; gap:6px; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-wrap: wrap;
    }
    .p-tab {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.08);
      color: #e5e7eb;
      font-weight: 800;
      border-radius: 10px;
      padding: 6px 8px;
      font-size: 12px;
      cursor: pointer;
    }
    .p-tab.active { background: rgba(99,102,241,0.22); border-color: rgba(99,102,241,0.35); }
    #peace-body { padding: 10px; color: #e5e7eb; }
    .p-btn {
      background: rgba(34,197,94,0.20);
      border: 1px solid rgba(34,197,94,0.25);
      color: #e5e7eb;
      border-radius: 10px;
      padding: 8px 10px;
      font-weight: 900;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    .p-btn.red { background: rgba(239,68,68,0.20); border-color: rgba(239,68,68,0.25); }
    .muted { opacity: 0.75; font-size: 12px; }
    .card {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 12px;
      padding: 10px;
      margin: 8px 0;
    }
  `);

  const badge = document.createElement("div");
  badge.id = "peace-badge";
  badge.innerHTML = `<span>💼</span>`;
  document.body.appendChild(badge);

  const panel = document.createElement("div");
  panel.id = "peace-panel";
  panel.innerHTML = `
    <div id="peace-head">
      <div>7DS*: Peace Hiring Hub</div>
      <div style="display:flex;gap:6px;">
        <button class="p-btn" id="p-settings">Settings</button>
        <button class="p-btn red" id="p-close">X</button>
      </div>
    </div>
    <div id="peace-tabs">
      <button class="p-tab active" data-tab="companies">Companies</button>
      <button class="p-tab" data-tab="trains">Trains</button>
      <button class="p-tab" data-tab="apps">Applications</button>
      <button class="p-tab" data-tab="search">Search</button>
    </div>
    <div id="peace-body"></div>
  `;
  document.body.appendChild(panel);

  function togglePanel() {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    if (panel.style.display !== "none") renderActiveTab();
  }

  badge.addEventListener("click", togglePanel);
  panel.querySelector("#p-close").addEventListener("click", togglePanel);

  panel.querySelector("#p-settings").addEventListener("click", async () => {
    const body = panel.querySelector("#peace-body");
    body.innerHTML = `<div class="card"><div class="muted">Opening setup…</div></div>`;

    const res = await runSettingsWizard();
    if (!res.ok) {
      body.innerHTML = `
        <div class="card">
          <div style="font-weight:900;">Setup not completed</div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(res.error || "Cancelled")}</div>
          <div class="muted" style="margin-top:6px;">It will NOT ask again unless you click Settings.</div>
        </div>`;
      return;
    }

    renderActiveTab();
  });

  const tabs = Array.from(panel.querySelectorAll(".p-tab"));
  let active = "companies";
  tabs.forEach((b) => {
    b.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      active = b.getAttribute("data-tab");
      renderActiveTab();
    });
  });

  const body = panel.querySelector("#peace-body");

  async function renderActiveTab() {
    body.innerHTML = `<div class="muted">Loading…</div>`;

    // ✅ NEVER auto-prompt. If missing keys, show a message.
    const admin = (GM_getValue(K_ADMIN, "") || "").trim();
    const api = (GM_getValue(K_API, "") || "").trim();

    if (!admin || !api) {
      body.innerHTML = `
        <div class="card">
          <div style="font-weight:900;">Setup needed</div>
          <div class="muted" style="margin-top:6px;">
            Click <b>Settings</b> to enter your Admin Key + Torn API key.
            <br/>No popups will appear unless you click Settings.
          </div>
        </div>`;
      return;
    }

    try {
      await ensureAuth(true);
    } catch (e) {
      body.innerHTML = `
        <div class="card">
          <div style="font-weight:900;">Auth error</div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(e.message || String(e))}</div>
          <div class="muted" style="margin-top:6px;">Click <b>Settings</b> to fix keys.</div>
        </div>`;
      return;
    }

    if (active === "companies") return renderCompanies();
    if (active === "trains") return renderTrains();
    if (active === "apps") return renderApps();
    if (active === "search") return renderSearch();
  }

  async function renderCompanies() {
    const res = await gmReqAuthed("GET", `${BASE_URL}/api/companies`, null);
    if (!res.json || res.json.ok !== true) {
      body.innerHTML = `<div class="card"><div style="font-weight:900;">Error</div><div class="muted">${escapeHtml(res.json?.error || "Failed")}</div></div>`;
      return;
    }
    const rows = res.json.rows || [];
    if (!rows.length) {
      body.innerHTML = `<div class="card"><div style="font-weight:900;">No companies loaded</div><div class="muted" style="margin-top:6px;">Add company IDs in Settings.</div></div>`;
      return;
    }
    body.innerHTML = rows
      .map((c) => {
        const emps = (c.employees || []).length;
        const err = c.error ? `<div class="muted" style="margin-top:6px;color:#fca5a5;">${escapeHtml(c.error)}</div>` : "";
        return `
          <div class="card">
            <div style="font-weight:900;">${escapeHtml(c.name || ("Company " + c.company_id))}</div>
            <div class="muted" style="margin-top:6px;">Employees: ${escapeHtml(String(emps))}</div>
            <div class="muted" style="margin-top:4px;">ID: ${escapeHtml(c.company_id)}</div>
            ${err}
          </div>`;
      })
      .join("");
  }

  async function renderTrains() {
    const companyIds = (GM_getValue(K_COMPANY_IDS, "") || "").trim();
    if (!companyIds) {
      body.innerHTML = `<div class="card"><div style="font-weight:900;">No company IDs</div><div class="muted" style="margin-top:6px;">Add company IDs in Settings to use train tracking.</div></div>`;
      return;
    }
    body.innerHTML = `<div class="card"><div class="muted">Trains tab is enabled (backend endpoints ready). If you want the full trains UI list/add/delete here, tell me and I’ll drop it in.</div></div>`;
  }

  async function renderApps() {
    body.innerHTML = `<div class="card"><div class="muted">Applications tab is enabled (backend endpoints ready). If you want the full applications UI here, tell me and I’ll drop it in.</div></div>`;
  }

  async function renderSearch() {
    body.innerHTML = `<div class="card"><div class="muted">Search tab is enabled (backend endpoints ready). If you want the full HoF search UI here, tell me and I’ll drop it in.</div></div>`;
  }

  // start
  panel.style.display = "none";
})();
