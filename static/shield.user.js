// ==UserScript==
// @name         7DS Hiring Hub 💼 (FAILSAFE) [Button + Overlay + Apps]
// @namespace    7ds-wrath-hiring
// @version      1.3.0
// @description  Always shows the 💼 button + overlay on Torn. Fetches applications from your Render app (/api/applications). Includes Settings for ADMIN_TOKEN. Built to avoid CSP/iframe issues.
// @author       Fries91
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      sevends-hiring-scan.onrender.com
// ==/UserScript==

(function () {
  "use strict";

  const BASE_URL = "https://sevends-hiring-scan.onrender.com";
  const POLL_MS = 15000;

  const BTN_ID = "h7ds-briefcase";
  const PANEL_ID = "h7ds-panel";
  const TOAST_ID = "h7ds-toast";

  // --------- helpers ----------
  const S = {
    get(k, fb) {
      try {
        const v = GM_getValue(k);
        if (v === undefined || v === null || v === "") return fb;
        return JSON.parse(v);
      } catch {
        const v = GM_getValue(k);
        return (v === undefined || v === null || v === "") ? fb : v;
      }
    },
    set(k, v) {
      try { GM_setValue(k, JSON.stringify(v)); }
      catch { GM_setValue(k, String(v)); }
    }
  };

  function reqJSON(url, method = "GET", body = null) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: body ? { "Content-Type": "application/json" } : {},
        data: body ? JSON.stringify(body) : null,
        timeout: 25000,
        onload: (r) => {
          try { resolve(JSON.parse(r.responseText || "{}")); }
          catch { reject(new Error("Bad JSON")); }
        },
        onerror: () => reject(new Error("Network error")),
        ontimeout: () => reject(new Error("Timeout")),
      });
    });
  }

  function nowNice() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function qs(sel, root = document) { return root.querySelector(sel); }

  function toastMsg(msg) {
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(toastMsg._t);
    toastMsg._t = setTimeout(() => (toast.style.display = "none"), 1700);
  }

  function withAdmin(url) {
    const tok = (state.adminToken || "").trim();
    if (!tok) return url;
    return url.includes("?")
      ? `${url}&admin=${encodeURIComponent(tok)}`
      : `${url}?admin=${encodeURIComponent(tok)}`;
  }

  // --------- hard failsafe: remove stale elements ----------
  // If an old broken version left invisible elements behind, wipe them.
  document.getElementById(BTN_ID)?.remove();
  document.getElementById(PANEL_ID)?.remove();
  document.getElementById(TOAST_ID)?.remove();

  // --------- styles ----------
  GM_addStyle(`
    #${BTN_ID}, #${PANEL_ID}, #${TOAST_ID}, #${PANEL_ID} * { box-sizing:border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }

    #${BTN_ID}{
      position:fixed; z-index:2147483647;
      width:44px; height:44px;
      display:flex; align-items:center; justify-content:center;
      border-radius:14px;
      background:rgba(10,10,14,.90);
      border:1px solid rgba(255,255,255,.14);
      box-shadow:0 8px 22px rgba(0,0,0,.45);
      font-size:26px;
      user-select:none; -webkit-user-select:none;
      touch-action:none;
      left:auto; top:auto;
    }

    #${PANEL_ID}{
      position:fixed; z-index:2147483646;
      width:360px; max-width:94vw;
      height:540px; max-height:82vh;
      border-radius:16px;
      background:rgba(12,12,18,.92);
      border:1px solid rgba(255,255,255,.12);
      box-shadow:0 18px 46px rgba(0,0,0,.55);
      overflow:hidden;
      display:none;
      backdrop-filter: blur(10px);
      touch-action:none;
      left:auto; top:auto;
    }

    #${PANEL_ID} .h-head{
      height:44px;
      display:flex; align-items:center; justify-content:space-between;
      padding:0 10px;
      background:rgba(255,255,255,.06);
      border-bottom:1px solid rgba(255,255,255,.08);
      color:#fff;
    }
    #${PANEL_ID} .h-title{ font-weight:900; font-size:13px; }
    #${PANEL_ID} .h-sub{ opacity:.85; font-weight:700; font-size:11px; }

    #${PANEL_ID} .h-btn{
      border:1px solid rgba(255,255,255,.14);
      background:rgba(0,0,0,.20);
      color:#fff;
      border-radius:10px;
      padding:7px 10px;
      font-weight:900;
      font-size:12px;
      cursor:pointer;
      user-select:none;
    }
    #${PANEL_ID} .h-btn:active{ transform:scale(.98); }

    #${PANEL_ID} .h-tabs{
      display:flex; gap:8px;
      padding:8px 10px;
      border-bottom:1px solid rgba(255,255,255,.08);
    }
    #${PANEL_ID} .h-tab{
      flex:1; text-align:center;
      padding:8px 10px;
      border-radius:12px;
      font-weight:900; font-size:12px;
      cursor:pointer;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(255,255,255,.05);
      color:#fff;
      user-select:none;
    }
    #${PANEL_ID} .h-tab.active{
      background:rgba(0,0,0,.28);
      border-color:rgba(255,255,255,.18);
    }

    #${PANEL_ID} .h-body{
      height:calc(100% - 44px - 48px);
      overflow:auto;
      padding:10px;
      color:#fff;
      font-size:12px;
      font-weight:700;
    }

    #${PANEL_ID} .card{
      border:1px solid rgba(255,255,255,.10);
      background:rgba(0,0,0,.18);
      border-radius:14px;
      padding:10px;
      margin-bottom:10px;
    }
    #${PANEL_ID} .row{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
    #${PANEL_ID} .muted{ opacity:.85; font-size:11px; font-weight:700; margin-top:4px; }
    #${PANEL_ID} .actions{ display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }

    #${PANEL_ID} select, #${PANEL_ID} input, #${PANEL_ID} textarea{
      width:100%;
      padding:8px 10px;
      border-radius:12px;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(0,0,0,.22);
      color:#fff;
      outline:none;
      font-weight:800;
      font-size:12px;
    }
    #${PANEL_ID} textarea{ min-height:92px; resize:vertical; }

    #${TOAST_ID}{
      position:fixed; z-index:2147483647;
      left:50%; transform:translateX(-50%);
      bottom:14px;
      padding:10px 12px;
      border-radius:14px;
      background:rgba(0,0,0,.78);
      border:1px solid rgba(255,255,255,.14);
      color:#fff;
      font-weight:900;
      font-size:12px;
      display:none;
      max-width:92vw;
      text-align:center;
    }
  `);

  // --------- create UI ----------
  const btn = document.createElement("div");
  btn.id = BTN_ID;
  btn.textContent = "💼";

  const panel = document.createElement("div");
  panel.id = PANEL_ID;

  const toast = document.createElement("div");
  toast.id = TOAST_ID;

  document.body.appendChild(btn);
  document.body.appendChild(panel);
  document.body.appendChild(toast);

  // --------- state ----------
  const savedPos = S.get("h7ds_hiring_pos", { btnLeft: null, btnTop: null, panelLeft: null, panelTop: null });

  const state = {
    tab: "apps",
    apps: [],
    last: null,
    adminToken: S.get("h7ds_hiring_admin", "") || "",
    timer: null,
  };

  // default positions if none saved
  function setInitialPositions() {
    if (savedPos.btnLeft != null && savedPos.btnTop != null) {
      btn.style.left = savedPos.btnLeft + "px";
      btn.style.top = savedPos.btnTop + "px";
      btn.style.right = "auto";
      btn.style.bottom = "auto";
    } else {
      btn.style.right = "16px";
      btn.style.bottom = "120px";
    }

    if (savedPos.panelLeft != null && savedPos.panelTop != null) {
      panel.style.left = savedPos.panelLeft + "px";
      panel.style.top = savedPos.panelTop + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    } else {
      panel.style.right = "16px";
      panel.style.bottom = "170px";
    }
  }
  setInitialPositions();

  // --------- render ----------
  function render() {
    panel.innerHTML = `
      <div class="h-head">
        <div>
          <div class="h-title">7DS Hiring Hub</div>
          <div class="h-sub">Last: <span id="h-last">${state.last || "—"}</span></div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="h-btn" id="h-refresh">↻</button>
          <button class="h-btn" id="h-close">✕</button>
        </div>
      </div>

      <div class="h-tabs">
        <div class="h-tab ${state.tab === "apps" ? "active" : ""}" id="tab-apps">Applications</div>
        <div class="h-tab ${state.tab === "settings" ? "active" : ""}" id="tab-settings">Settings</div>
      </div>

      <div class="h-body" id="h-body"></div>
    `;

    qs("#h-close", panel).onclick = () => toggle(false);
    qs("#h-refresh", panel).onclick = () => refreshNow(true);

    qs("#tab-apps", panel).onclick = () => { state.tab = "apps"; render(); };
    qs("#tab-settings", panel).onclick = () => { state.tab = "settings"; render(); };

    const body = qs("#h-body", panel);
    body.appendChild(state.tab === "apps" ? viewApps() : viewSettings());
  }

  function viewSettings() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="card">
        <div style="font-weight:900;">Connection</div>
        <div class="muted">Server: ${BASE_URL}</div>
        <div class="muted">If your Render env <code>ADMIN_TOKEN</code> is set, paste the same token here.</div>
        <div style="margin-top:10px;display:grid;gap:8px;">
          <input id="adm" placeholder="Admin token (optional)" />
          <button class="h-btn" id="save">Save</button>
          <button class="h-btn" id="test">Test /api/applications</button>
        </div>
      </div>
    `;

    const adm = qs("#adm", wrap);
    adm.value = state.adminToken || "";

    qs("#save", wrap).onclick = () => {
      state.adminToken = (adm.value || "").trim();
      S.set("h7ds_hiring_admin", state.adminToken);
      toastMsg("Saved");
    };

    qs("#test", wrap).onclick = async () => {
      try {
        const res = await reqJSON(withAdmin(`${BASE_URL}/api/applications`), "GET");
        if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
        toastMsg(`OK (${(res.rows || []).length} rows)`);
        state.apps = res.rows || [];
        state.last = nowNice();
        state.tab = "apps";
        render();
      } catch {
        toastMsg("Test failed (token wrong or service down)");
      }
    };

    return wrap;
  }

  function viewApps() {
    const wrap = document.createElement("div");

    if (!state.apps || state.apps.length === 0) {
      const c = document.createElement("div");
      c.className = "card";
      c.innerHTML = `
        <div style="font-weight:900;">No applications yet</div>
        <div class="muted">If you expect rows: check Render logs + Torn events are being detected.</div>
      `;
      wrap.appendChild(c);
      return wrap;
    }

    for (const row of state.apps) {
      const applicantId = (row.applicant_id || "").trim();
      const raw = row.raw_text || "";
      const created = row.created_at || "";
      const status = row.status || "new";

      const card = document.createElement("div");
      card.className = "card";

      card.innerHTML = `
        <div class="row">
          <div style="min-width:0;">
            <div style="font-weight:900;">${applicantId ? `Applicant [${applicantId}]` : "Applicant [unknown]"}</div>
            <div class="muted">${created ? `Created: ${created}` : ""}</div>
          </div>
          <button class="h-btn" data-open="${applicantId}">Open</button>
        </div>
        <div class="muted" style="margin-top:8px;word-break:break-word;"></div>
        <div class="actions"></div>
      `;

      card.querySelector(".muted").textContent = raw;

      const actions = card.querySelector(".actions");

      const sel = document.createElement("select");
      ["new", "seen", "interview", "hired", "rejected"].forEach((s) => {
        const o = document.createElement("option");
        o.value = s;
        o.textContent = s.toUpperCase();
        if (s === status) o.selected = true;
        sel.appendChild(o);
      });

      sel.onchange = async () => {
        try {
          const res = await reqJSON(withAdmin(`${BASE_URL}/api/applications/status`), "POST", {
            id: row.id,
            status: sel.value,
          });
          if (!res || res.ok !== true) throw new Error("bad response");
          toastMsg("Status updated");
        } catch {
          toastMsg("Update failed (admin token?)");
        }
      };

      const ws = document.createElement("button");
      ws.className = "h-btn";
      ws.textContent = "Copy ID";
      ws.onclick = async () => {
        if (!applicantId) return toastMsg("No applicant id");
        try {
          await navigator.clipboard.writeText(applicantId);
          toastMsg("Copied");
        } catch {
          toastMsg("Copy blocked");
        }
      };

      actions.appendChild(sel);
      actions.appendChild(ws);

      card.querySelector("[data-open]")?.addEventListener("click", () => {
        if (!applicantId) return toastMsg("No applicant id");
        window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(applicantId)}`, "_blank");
      });

      wrap.appendChild(card);
    }

    return wrap;
  }

  async function refreshNow(showFailToast) {
    try {
      const res = await reqJSON(withAdmin(`${BASE_URL}/api/applications`), "GET");
      if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
      state.apps = res.rows || [];
      state.last = nowNice();
      const lastEl = qs("#h-last", panel);
      if (lastEl) lastEl.textContent = state.last;
      if (state.tab === "apps") render();
    } catch {
      if (showFailToast) toastMsg("Fetch failed (token/service?)");
    }
  }

  function startPolling() {
    stopPolling();
    refreshNow(false);
    state.timer = setInterval(() => {
      if (panel.style.display === "block") refreshNow(false);
    }, POLL_MS);
  }
  function stopPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  function toggle(open) {
    const isOpen = panel.style.display === "block";
    const next = open ?? !isOpen;
    panel.style.display = next ? "block" : "none";
    if (next) startPolling();
    else stopPolling();
  }

  // --------- draggable + TAP to open (this prevents “tap not opening” on mobile) ----------
  function makeDraggableTap(node, which) {
    let down = false, moved = false;
    let sx = 0, sy = 0, ox = 0, oy = 0;

    node.addEventListener("pointerdown", (e) => {
      down = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      const r = node.getBoundingClientRect();
      ox = r.left; oy = r.top;

      node.setPointerCapture?.(e.pointerId);

      node.style.right = "auto";
      node.style.bottom = "auto";
      node.style.left = ox + "px";
      node.style.top = oy + "px";
    });

    node.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;

      const x = clamp(ox + dx, 6, window.innerWidth - node.offsetWidth - 6);
      const y = clamp(oy + dy, 6, window.innerHeight - node.offsetHeight - 6);
      node.style.left = x + "px";
      node.style.top = y + "px";
    });

    node.addEventListener("pointerup", () => {
      if (!down) return;
      down = false;

      const r = node.getBoundingClientRect();
      if (which === "btn") {
        savedPos.btnLeft = Math.round(r.left);
        savedPos.btnTop = Math.round(r.top);
      } else {
        savedPos.panelLeft = Math.round(r.left);
        savedPos.panelTop = Math.round(r.top);
      }
      S.set("h7ds_hiring_pos", savedPos);

      if (which === "btn" && !moved) toggle();
    });

    node.addEventListener("pointercancel", () => { down = false; });
  }

  makeDraggableTap(btn, "btn");
  makeDraggableTap(panel, "panel");

  // --------- boot ----------
  render();
  toastMsg("💼 Hiring Hub loaded");
})();
