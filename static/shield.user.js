// ==UserScript==
// @name         Company Hub 💼 (No Duplicates + Repo Admin Token + Click Toggle + Draggable)
// @namespace    sevends-hiring-scan
// @version      2.1.1
// @description  Prevents duplicate badge/panel injections. Matches Fries91/7ds-hiring-scan- backend: ADMIN_TOKEN via ?admin=. Badge click opens/closes, draggable, badge stays on top.
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

  // ✅ HARD-CODED SERVICE URL
  const BASE_URL = "https://sevends-hiring-scan.onrender.com";

  // ✅ UNIQUE IDS (used to prevent duplicates)
  const BADGE_ID = "companyhub-badge";
  const PANEL_ID = "companyhub-panel";
  const STYLE_ID = "companyhub-style";

  // ✅ If already injected (script re-ran), do nothing
  if (document.getElementById(BADGE_ID) || document.getElementById(PANEL_ID)) {
    return;
  }

  // -----------------------
  // Storage keys
  // -----------------------
  const K_ADMIN = "company_hub_admin_token";
  const K_API = "company_hub_user_api_key";
  const K_BADGE_POS = "company_hub_badge_pos_v6";
  const K_PANEL_POS = "company_hub_panel_pos_v6";

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

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function gmReq(method, url, dataObj) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: { "Content-Type": "application/json" },
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

  // ✅ backend expects ?admin=TOKEN on every endpoint
  function withAdmin(url) {
    const admin = (GM_getValue(K_ADMIN, "") || "").trim();
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}admin=${encodeURIComponent(admin || "")}`;
  }

  function promptMaybe(label, currentVal) {
    const out = prompt(label, currentVal || "");
    if (out === null) return null;
    return String(out).trim();
  }

  async function openSettings() {
    const curAdmin = (GM_getValue(K_ADMIN, "") || "").trim();
    const curApi = (GM_getValue(K_API, "") || "").trim();

    const a = promptMaybe("Admin Token (must match Render ENV: ADMIN_TOKEN)", curAdmin);
    if (a === null) return { ok: false, error: "Cancelled" };

    const k = promptMaybe("Your Torn API Key (optional, for applicant tools)", curApi);
    if (k === null) return { ok: false, error: "Cancelled" };

    GM_setValue(K_ADMIN, a);
    GM_setValue(K_API, k);
    return { ok: true };
  }

  // -----------------------
  // CSS (inject once)
  // -----------------------
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :root{
        --hv-text: #e5e7eb;
        --hv-muted: rgba(229,231,235,0.72);
      }

      #${BADGE_ID}, #${PANEL_ID} { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial; }

      /* Badge always on top */
      #${BADGE_ID} {
        position: fixed; right: 14px; bottom: 110px;
        z-index: 1000001;
        width: 44px; height: 44px; border-radius: 14px;
        background:
          radial-gradient(120% 120% at 20% 10%, rgba(212,175,55,0.20), transparent 45%),
          linear-gradient(135deg, rgba(18,22,32,0.95), rgba(7,9,13,0.95));
        border: 1px solid rgba(212,175,55,0.35);
        box-shadow:
          0 14px 34px rgba(0,0,0,0.55),
          0 0 0 1px rgba(255,255,255,0.06) inset;
        display: grid; place-items: center; cursor: pointer;
        user-select:none;
        touch-action: none;
      }

      #${BADGE_ID}::after{
        content:"";
        position:absolute; inset: 5px;
        border-radius: 11px;
        border: 1px solid rgba(247,231,169,0.18);
        pointer-events:none;
      }

      #${BADGE_ID} span {
        font-size: 22px; line-height: 1;
        filter: drop-shadow(0 2px 6px rgba(0,0,0,0.55));
      }

      #${PANEL_ID} {
        position: fixed; right: 14px; bottom: 170px;
        z-index: 1000000;
        width: min(92vw, 360px);
        background:
          radial-gradient(120% 120% at 0% 0%, rgba(212,175,55,0.10), transparent 40%),
          radial-gradient(120% 120% at 100% 0%, rgba(99,102,241,0.08), transparent 45%),
          linear-gradient(180deg, rgba(14,18,28,0.96), rgba(8,10,14,0.96));
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 16px;
        box-shadow: 0 18px 52px rgba(0,0,0,0.65);
        overflow: hidden;
        display: none;
        backdrop-filter: blur(8px);
        touch-action: none;
      }

      #companyhub-head {
        padding: 10px 12px;
        display:flex; align-items:center; justify-content:space-between;
        border-bottom: 1px solid rgba(255,255,255,0.10);
        color: var(--hv-text);
        font-weight: 950;
        cursor: move;
        user-select:none;
        letter-spacing: 0.2px;
      }

      #companyhub-title { display:flex; align-items:center; gap:8px; min-width:0; }

      #companyhub-title .crest{
        width: 18px; height: 18px; border-radius: 6px;
        background:
          radial-gradient(110% 110% at 30% 20%, rgba(247,231,169,0.35), transparent 55%),
          linear-gradient(135deg, rgba(212,175,55,0.32), rgba(212,175,55,0.10));
        border: 1px solid rgba(212,175,55,0.35);
        box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset;
        flex: 0 0 auto;
      }

      #companyhub-title .text{ display:flex; flex-direction:column; min-width:0; }
      #companyhub-title .text .main{ font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #companyhub-title .text .sub{ font-size: 11px; color: rgba(247,231,169,0.70); font-weight: 800; margin-top: 2px; }

      #companyhub-tabs {
        display:flex; gap:6px; padding: 8px 10px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        flex-wrap: wrap;
      }

      .ch-tab {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.08);
        color: var(--hv-text);
        font-weight: 900;
        border-radius: 10px;
        padding: 6px 8px;
        font-size: 12px;
        cursor: pointer;
        user-select:none;
      }

      .ch-tab.active {
        background: linear-gradient(135deg, rgba(212,175,55,0.20), rgba(99,102,241,0.14));
        border-color: rgba(212,175,55,0.28);
      }

      #companyhub-body { padding: 10px; color: var(--hv-text); }

      .ch-btn {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.10);
        color: var(--hv-text);
        border-radius: 10px;
        padding: 8px 10px;
        font-weight: 950;
        cursor: pointer;
        font-size: 12px;
        white-space: nowrap;
        user-select:none;
      }
      .ch-btn.primary{ background: rgba(16,185,129,0.16); border-color: rgba(16,185,129,0.25); }
      .ch-btn.red { background: rgba(239,68,68,0.16); border-color: rgba(239,68,68,0.25); }

      .muted { color: var(--hv-muted); font-size: 12px; }

      .card {
        background:
          radial-gradient(120% 120% at 0% 0%, rgba(212,175,55,0.07), transparent 45%),
          rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 12px;
        padding: 10px;
        margin: 8px 0;
        box-shadow: 0 6px 20px rgba(0,0,0,0.35);
      }

      .card .headline{ font-weight: 950; letter-spacing: 0.1px; }

      .pill{
        display:inline-flex; align-items:center; gap:6px;
        font-size: 11px; padding: 3px 8px; border-radius: 999px;
        background: rgba(255,255,255,0.07);
        border: 1px solid rgba(255,255,255,0.10);
      }
      .pill.gold{
        background: rgba(212,175,55,0.12);
        border-color: rgba(212,175,55,0.22);
        color: rgba(247,231,169,0.92);
      }
      .row-actions{ display:flex; gap:6px; align-items:center; }
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
      <div class="row-actions">
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

  // -----------------------
  // Badge: draggable + tap toggle (no duplicates)
  // -----------------------
  function togglePanel() {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    if (panel.style.display !== "none") renderActiveTab();
  }

  function makeBadgeDraggableAndToggle(el, storeKey) {
    const threshold = 8;
    let down = false;
    let moved = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;

    function getLeftTop(node) {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top };
    }

    function onDown(ev) {
      const pt = ev.touches ? ev.touches[0] : ev;
      down = true;
      moved = false;

      const pos = getLeftTop(el);
      startX = pt.clientX;
      startY = pt.clientY;
      startLeft = pos.left;
      startTop = pos.top;

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

      let x = startLeft + dx;
      let y = startTop + dy;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = el.getBoundingClientRect();
      x = clamp(x, 6, vw - rect.width - 6);
      y = clamp(y, 6, vh - rect.height - 6);

      el.style.left = x + "px";
      el.style.top = y + "px";

      if (moved) {
        ev.preventDefault();
        ev.stopPropagation();
      }
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

      ev?.preventDefault?.();
      ev?.stopPropagation?.();
    }

    el.addEventListener("mousedown", onDown, { passive: false });
    el.addEventListener("touchstart", onDown, { passive: false });
  }

  makeBadgeDraggableAndToggle(badge, K_BADGE_POS);

  // Panel drag
  function makePanelDraggable(handleEl, moveEl, storeKey) {
    let dragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;

    function getLeftTop(node) {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top };
    }

    function onDown(ev) {
      const t = ev.target;
      if (t && (t.tagName === "BUTTON" || t.closest("button"))) return;

      dragging = true;
      const pt = ev.touches ? ev.touches[0] : ev;

      const pos = getLeftTop(moveEl);
      startX = pt.clientX;
      startY = pt.clientY;
      startLeft = pos.left;
      startTop = pos.top;

      moveEl.style.left = startLeft + "px";
      moveEl.style.top = startTop + "px";
      moveEl.style.right = "auto";
      moveEl.style.bottom = "auto";

      ev.preventDefault();
      ev.stopPropagation();

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

      let x = startLeft + dx;
      let y = startTop + dy;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = moveEl.getBoundingClientRect();
      x = clamp(x, 6, vw - rect.width - 6);
      y = clamp(y, 6, vh - rect.height - 6);

      moveEl.style.left = x + "px";
      moveEl.style.top = y + "px";

      ev.preventDefault();
      ev.stopPropagation();
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

      ev?.preventDefault?.();
      ev?.stopPropagation?.();
    }

    handleEl.addEventListener("mousedown", onDown, { passive: false });
    handleEl.addEventListener("touchstart", onDown, { passive: false });
  }

  makePanelDraggable(panel.querySelector("#companyhub-head"), panel, K_PANEL_POS);

  // Buttons
  panel.querySelector("#ch-close").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePanel();
  });

  panel.querySelector("#ch-settings").addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const res = await openSettings();
    renderActiveTab(res.ok ? null : res.error);
  });

  // Tabs
  const tabs = Array.from(panel.querySelectorAll(".ch-tab"));
  let active = "companies";
  tabs.forEach((b) => {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      tabs.forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      active = b.getAttribute("data-tab");
      renderActiveTab();
    });
  });

  const body = panel.querySelector("#companyhub-body");

  async function renderActiveTab(optionalError) {
    if (optionalError) {
      body.innerHTML = `
        <div class="card">
          <div class="headline">Settings</div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(optionalError)}</div>
        </div>`;
      return;
    }

    const admin = (GM_getValue(K_ADMIN, "") || "").trim();
    if (!admin) {
      body.innerHTML = `
        <div class="card">
          <div class="headline">Setup needed</div>
          <div class="muted" style="margin-top:6px;">
            Click <b>Settings</b> and enter your Admin Token.
            <br/>Server checks <b>?admin=</b> against <b>ADMIN_TOKEN</b>.
          </div>
        </div>`;
      return;
    }

    body.innerHTML = `<div class="muted">Loading…</div>`;

    try {
      if (active === "companies") return renderCompanies();
      if (active === "trains") return renderPlaceholder("Trains UI (hooked to /api/trains)");
      if (active === "apps") return renderPlaceholder("Applications UI (hooked to /api/applications)");
      if (active === "search") return renderPlaceholder("Search UI (hooked to /api/search_workstats)");
    } catch (e) {
      body.innerHTML = `
        <div class="card">
          <div class="headline">Error</div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(e.message || String(e))}</div>
        </div>`;
    }
  }

  function renderPlaceholder(txt) {
    body.innerHTML = `
      <div class="card">
        <div class="headline">${escapeHtml(txt)}</div>
        <div class="muted" style="margin-top:6px;">Say “enable full UI for this tab” and I’ll wire it completely.</div>
      </div>`;
  }

  async function renderCompanies() {
    const url = withAdmin(`${BASE_URL}/api/companies`);
    const res = await gmReq("GET", url, null);

    if (res.status === 401 || res.json?.ok === false) {
      body.innerHTML = `
        <div class="card">
          <div class="headline">Unauthorized</div>
          <div class="muted" style="margin-top:6px;">
            Admin Token mismatch. Render → Environment → set <b>ADMIN_TOKEN</b> exactly, then redeploy.
          </div>
        </div>`;
      return;
    }

    const rows = res.json?.rows || [];
    if (!rows.length) {
      body.innerHTML = `
        <div class="card">
          <div class="headline">No companies yet</div>
          <div class="muted" style="margin-top:6px;">
            Your server fills company data using its own <b>TORN_API_KEY</b> + <b>COMPANY_IDS</b>.
          </div>
        </div>`;
      return;
    }

    body.innerHTML = rows
      .map((c) => {
        const emps = (c.employees || []).length;
        const err = c.error
          ? `<div class="muted" style="margin-top:6px;color:rgba(248,113,113,0.9);">${escapeHtml(c.error)}</div>`
          : "";
        return `
          <div class="card">
            <div class="headline">${escapeHtml(c.name || ("Company " + c.company_id))}</div>
            <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
              <div class="pill gold">👥 ${escapeHtml(String(emps))} employees</div>
              <div class="pill">🆔 ${escapeHtml(c.company_id)}</div>
            </div>
            ${err}
          </div>`;
      })
      .join("");
  }

  // start hidden
  panel.style.display = "none";
})();
