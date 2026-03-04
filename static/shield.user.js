// ==UserScript==
// @name         Company Hub 💼 
// @namespace    Fries91-7ds-Wrath
// @version      6.0.1
// @description  Company Hub overlay. Auth via /api/auth then uses /state with X-Session-Token. Includes Bad JSON preview debug.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      sevends-hiring-scan.onrender.com
// ==/UserScript==

(function () {
  "use strict";

  // ================= USER CONFIG =================
  const BASE_URL = "https://sevends-hiring-scan.onrender.com"; // <-- your Render service
  const POLL_MS = 15000;
  // ==============================================

  if (window.__PEACE_HUB_RUNNING__) return;
  window.__PEACE_HUB_RUNNING__ = true;

  const EL_BTN = "peacehub-btn";
  const EL_PANEL = "peacehub-panel";
  const EL_TOAST = "peacehub-toast";

  try {
    document.getElementById(EL_BTN)?.remove();
    document.getElementById(EL_PANEL)?.remove();
    document.getElementById(EL_TOAST)?.remove();
  } catch {}

  const S = {
    get(k, fb) {
      try {
        const v = GM_getValue(k);
        if (v === undefined || v === null || v === "") return fb;
        return JSON.parse(v);
      } catch {
        const v = GM_getValue(k);
        return v === undefined || v === null || v === "" ? fb : v;
      }
    },
    set(k, v) {
      try { GM_setValue(k, JSON.stringify(v)); }
      catch { GM_setValue(k, String(v)); }
    },
    del(k) { try { GM_deleteValue(k); } catch {} }
  };

  const qs = (sel, root = document) => root.querySelector(sel);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const fmt = (x) => (x === null || x === undefined || x === "") ? "—" : String(x);

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toastMsg(msg) {
    const t = document.getElementById(EL_TOAST);
    if (!t) return;
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(toastMsg._t);
    toastMsg._t = setTimeout(() => (t.style.display = "none"), 2200);
  }

  // --------- DEBUG JSON: show preview if server returns HTML/502/etc ----------
  function reqJSON(path, method = "GET", body = null, extraHeaders = {}) {
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
    const headers = { ...extraHeaders };
    if (body) headers["Content-Type"] = "application/json";

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data: body ? JSON.stringify(body) : null,
        timeout: 25000,
        onload: (r) => {
          const txt = r.responseText || "";
          try {
            const j = JSON.parse(txt || "{}");
            resolve({ status: r.status, json: j, raw: txt });
          } catch {
            // show a short preview so you can see what it is
            const prev = String(txt).replace(/\s+/g, " ").slice(0, 140);
            toastMsg(`Bad JSON (${r.status}): ${prev || "[empty]"}`);
            resolve({
              status: r.status,
              json: { ok: false, error: "bad_json", status: r.status, preview: prev },
              raw: txt
            });
          }
        },
        onerror: () => reject(new Error("Network error")),
        ontimeout: () => reject(new Error("Timeout")),
      });
    });
  }

  const state = {
    open: false,
    tab: S.get("peacehub_tab", "hub"),
    last: "—",
    timer: null,

    admin_key: S.get("peacehub_admin_key", "") || "",
    api_key: S.get("peacehub_api_key", "") || "",
    token: S.get("peacehub_session_token", "") || "",

    selected_company_id: "",
    company_ids_input: S.get("peacehub_company_ids_input", "") || "",

    data: null,
    hofRows: [],
    hofCount: 0,
  };

  GM_addStyle(`
    #${EL_BTN}{
      position: fixed; z-index: 2147483647;
      width: 46px; height: 46px; border-radius: 14px;
      display:flex; align-items:center; justify-content:center;
      background: rgba(12,12,18,.92);
      border: 1px solid rgba(255,255,255,.16);
      box-shadow: 0 12px 30px rgba(0,0,0,.55);
      user-select:none; -webkit-user-select:none;
      touch-action:none; cursor:pointer;
    }
    #${EL_BTN} .ico{font-size:21px;line-height:1}
    #${EL_BTN} .badge{
      position:absolute; top:-6px; right:-6px;
      min-width: 20px; height: 20px; padding: 0 6px;
      border-radius: 999px;
      background: rgba(220,60,60,.95);
      border: 1px solid rgba(255,255,255,.22);
      display:none; align-items:center; justify-content:center;
      color:#fff; font-weight: 900; font-size: 12px;
    }
    #${EL_TOAST}{
      position: fixed; z-index: 2147483647;
      left: 50%; bottom: 18px; transform: translateX(-50%);
      padding: 10px 12px; border-radius: 12px;
      background: rgba(0,0,0,.82);
      border: 1px solid rgba(255,255,255,.12);
      color: #fff; font-weight: 800; font-size: 12px;
      display:none; max-width: 92vw; text-align:center;
    }
    #${EL_PANEL}{
      position: fixed; z-index: 2147483646;
      width: 372px; max-width: 94vw;
      height: 590px; max-height: 84vh;
      border-radius: 16px;
      background: rgba(12,12,18,.92);
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: 0 18px 46px rgba(0,0,0,.55);
      overflow: hidden; display:none;
      backdrop-filter: blur(10px);
    }
    #${EL_PANEL} .head{
      height: 44px; display:flex; align-items:center; justify-content:space-between;
      padding: 0 10px;
      background: rgba(255,255,255,.06);
      border-bottom: 1px solid rgba(255,255,255,.08);
      color:#fff;
      user-select:none; -webkit-user-select:none;
      touch-action:none; cursor: grab;
    }
    #${EL_PANEL} .title{ font-weight: 900; font-size: 13px; }
    #${EL_PANEL} .sub{ opacity:.85; font-weight: 800; font-size: 11px; }
    #${EL_PANEL} .btn{
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(0,0,0,.20);
      color: #fff; border-radius: 10px;
      padding: 7px 10px;
      font-weight: 900; font-size: 12px;
      cursor: pointer; user-select:none;
    }
    #${EL_PANEL} .btn:active{ transform: scale(.98); }
    #${EL_PANEL} .btn.danger{ border-color: rgba(220,60,60,.5); }
    #${EL_PANEL} .tabs{
      display:flex; gap: 8px; padding: 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      overflow-x:auto;
    }
    #${EL_PANEL} .tab{
      flex:0 0 auto; text-align:center;
      padding: 8px 10px; border-radius: 12px;
      font-weight: 900; font-size: 12px;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.05);
      color:#fff; user-select:none; white-space:nowrap;
    }
    #${EL_PANEL} .tab.active{ background: rgba(0,0,0,.28); border-color: rgba(255,255,255,.18); }
    #${EL_PANEL} .body{
      height: calc(100% - 44px - 56px);
      overflow: auto; padding: 10px; color: #fff;
    }
    #${EL_PANEL} .card{
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 14px;
      padding: 10px; margin-bottom: 10px;
    }
    #${EL_PANEL} .muted{ opacity:.80; font-weight: 700; font-size: 12px; }
    #${EL_PANEL} input, #${EL_PANEL} select, #${EL_PANEL} textarea{
      width: 100%;
      background: rgba(0,0,0,.22);
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 12px;
      padding: 10px;
      color:#fff; font-weight: 900;
      outline: none; box-sizing:border-box;
    }
    #${EL_PANEL} textarea{ min-height: 62px; resize: vertical; }
    #${EL_PANEL} .row{ display:flex; gap: 8px; align-items:center; }
    #${EL_PANEL} .row > *{ flex:1; }
  `);

  const toast = document.createElement("div");
  toast.id = EL_TOAST;
  document.documentElement.appendChild(toast);

  const btn = document.createElement("div");
  btn.id = EL_BTN;
  btn.innerHTML = `<span class="ico">💼</span><span class="badge" id="peacehub-badge">0</span>`;
  document.documentElement.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = EL_PANEL;
  document.documentElement.appendChild(panel);

  function setInitialPos() {
    const bL = S.get("peacehub_btn_left", null);
    const bT = S.get("peacehub_btn_top", null);
    if (bL != null && bT != null) {
      btn.style.left = bL + "px";
      btn.style.top = bT + "px";
      btn.style.right = "auto";
      btn.style.bottom = "auto";
    } else {
      btn.style.right = "14px";
      btn.style.top = "155px";
    }

    const pL = S.get("peacehub_panel_left", null);
    const pT = S.get("peacehub_panel_top", null);
    if (pL != null && pT != null) {
      panel.style.left = pL + "px";
      panel.style.top = pT + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    } else {
      panel.style.right = "14px";
      panel.style.top = "220px";
    }
  }
  setInitialPos();

  function makeDraggableTap(node, opts) {
    const { onTap, onSavePos, allowDrag = true, dragThreshold = 7 } = opts;
    let down = false, moved = false;
    let sx = 0, sy = 0, ox = 0, oy = 0;

    node.addEventListener("pointerdown", (e) => {
      down = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      const r = node.getBoundingClientRect();
      ox = r.left; oy = r.top;
      node.setPointerCapture?.(e.pointerId);
      node.style.right = "auto"; node.style.bottom = "auto";
      node.style.left = ox + "px"; node.style.top = oy + "px";
    }, { passive: true });

    node.addEventListener("pointermove", (e) => {
      if (!down || !allowDrag) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > dragThreshold) moved = true;
      const x = clamp(ox + dx, 6, window.innerWidth - node.offsetWidth - 6);
      const y = clamp(oy + dy, 6, window.innerHeight - node.offsetHeight - 6);
      node.style.left = x + "px";
      node.style.top = y + "px";
    }, { passive: true });

    node.addEventListener("pointerup", () => {
      if (!down) return;
      down = false;
      const r = node.getBoundingClientRect();
      onSavePos?.(Math.round(r.left), Math.round(r.top));
      if (!moved) onTap?.();
    }, { passive: true });

    node.addEventListener("pointercancel", () => { down = false; }, { passive: true });
  }

  makeDraggableTap(btn, {
    onTap: () => toggle(),
    onSavePos: (x, y) => { S.set("peacehub_btn_left", x); S.set("peacehub_btn_top", y); }
  });

  function tokenHeaders() {
    const t = (state.token || "").trim();
    return t ? { "X-Session-Token": t } : {};
  }

  async function doAuth(admin_key, api_key) {
    const { status, json } = await reqJSON("/api/auth", "POST", { admin_key, api_key });
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || `Auth failed (${status})`);
    state.token = json.token || "";
    S.set("peacehub_session_token", state.token);
    return json;
  }

  async function fetchState(companyIdMaybe = "") {
    const q = companyIdMaybe ? `?company_id=${encodeURIComponent(companyIdMaybe)}` : "";
    const { status, json } = await reqJSON(`/state${q}`, "GET", null, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || `State failed (${status})`);
    return json;
  }

  function stopPolling() { if (state.timer) clearInterval(state.timer); state.timer = null; }
  function startPolling() {
    stopPolling();
    state.timer = setInterval(async () => {
      if (!state.open || !state.token) return;
      try { await refresh(true); } catch {}
    }, POLL_MS);
  }

  async function refresh(silent = false) {
    if (!state.token) { if (!silent) toastMsg("Login first"); return; }
    try {
      const j = await fetchState(state.selected_company_id || "");
      state.data = j;
      state.selected_company_id = j.selected_company_id || state.selected_company_id || "";
      state.last = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      const unseen = Number(j.unseen_count || 0);
      const b = document.getElementById("peacehub-badge");
      if (b) {
        if (unseen > 0) { b.style.display = "flex"; b.textContent = unseen > 99 ? "99+" : String(unseen); }
        else b.style.display = "none";
      }

      render();
    } catch (e) {
      if (!silent) toastMsg(String(e.message || "Refresh failed"));
    }
  }

  function viewSettings() {
    const wrap = document.createElement("div");

    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div style="font-weight:900;">Settings / Login</div>
      <div class="muted">Server: ${escapeHtml(BASE_URL)}</div>
      <div class="muted">If login shows “Bad JSON”, read the preview — it tells you what the server returned.</div>
    `;
    wrap.appendChild(c);

    const admin = document.createElement("input");
    admin.placeholder = "Admin key";
    admin.value = state.admin_key || "";

    const api = document.createElement("input");
    api.placeholder = "Torn API key";
    api.value = state.api_key || "";

    const login = document.createElement("button");
    login.className = "btn";
    login.textContent = "Login";

    const logout = document.createElement("button");
    logout.className = "btn danger";
    logout.textContent = "Logout";

    const testHealth = document.createElement("button");
    testHealth.className = "btn";
    testHealth.textContent = "Test /health";

    const status = document.createElement("div");
    status.className = "muted";
    status.style.marginTop = "8px";
    status.textContent = state.token ? "Session: saved" : "Session: none";

    c.appendChild(admin);
    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(api);
    c.appendChild(document.createElement("div")).style.height = "10px";
    c.appendChild(login);
    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(logout);
    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(testHealth);
    c.appendChild(status);

    testHealth.onclick = async () => {
      try {
        const { status: st, raw } = await reqJSON("/health", "GET");
        const prev = String(raw || "").replace(/\s+/g, " ").slice(0, 140);
        toastMsg(`/health ${st}: ${prev || "[empty]"}`);
      } catch (e) {
        toastMsg(e.message || "Health failed");
      }
    };

    login.onclick = async () => {
      try {
        const ak = admin.value.trim();
        const pk = api.value.trim();
        if (!ak || !pk) return toastMsg("Admin key + API key required");

        login.disabled = true;
        state.admin_key = ak; state.api_key = pk;
        S.set("peacehub_admin_key", ak);
        S.set("peacehub_api_key", pk);

        const j = await doAuth(ak, pk);
        status.textContent = `Logged in as ${j.name || "user"} [${j.user_id || ""}]`;
        toastMsg("Logged in");
        await refresh(true);
        startPolling();
      } catch (e) {
        status.textContent = e.message || "Login failed";
        toastMsg(e.message || "Login failed");
      } finally {
        login.disabled = false;
      }
    };

    logout.onclick = () => {
      state.token = "";
      S.del("peacehub_session_token");
      state.data = null;
      stopPolling();
      toastMsg("Logged out");
      status.textContent = "Session: none";
      render();
    };

    return wrap;
  }

  function viewHubPlaceholder() {
    const w = document.createElement("div");
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div style="font-weight:900;">Hub</div>
      <div class="muted">Login in Settings, then hit Refresh.</div>
    `;
    w.appendChild(c);
    return w;
  }

  function render() {
    S.set("peacehub_tab", state.tab);

    const service = state.data?.service || "Peace Company Hub";
    panel.innerHTML = `
      <div class="head" id="peacehub-head">
        <div>
          <div class="title">${escapeHtml(service)}</div>
          <div class="sub">Last: ${escapeHtml(state.last || "—")}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn" id="ph-refresh">↻</button>
          <button class="btn" id="ph-close">✕</button>
        </div>
      </div>

      <div class="tabs">
        <div class="tab ${state.tab === "hub" ? "active" : ""}" data-tab="hub">Hub</div>
        <div class="tab ${state.tab === "settings" ? "active" : ""}" data-tab="settings">Settings</div>
      </div>

      <div class="body" id="peacehub-body"></div>
    `;

    qs("#ph-close", panel).onclick = () => toggle(false);
    qs("#ph-refresh", panel).onclick = () => refresh(false);

    panel.querySelectorAll("[data-tab]").forEach(el => {
      el.addEventListener("click", () => {
        state.tab = el.getAttribute("data-tab") || "hub";
        render();
      });
    });

    const body = qs("#peacehub-body", panel);
    if (state.tab === "settings") body.appendChild(viewSettings());
    else body.appendChild(viewHubPlaceholder());

    const head = qs("#peacehub-head", panel);
    makeDraggableTap(head, {
      onTap: null,
      onSavePos: (x, y) => {
        panel.style.left = x + "px";
        panel.style.top = y + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        S.set("peacehub_panel_left", x);
        S.set("peacehub_panel_top", y);
      },
      allowDrag: true
    });
  }

  function toggle(open) {
    const isOpen = panel.style.display === "block";
    const next = open ?? !isOpen;
    state.open = next;
    panel.style.display = next ? "block" : "none";
    btn.style.display = "flex";
    if (next) {
      render();
      refresh(true);
      startPolling();
    } else stopPolling();
  }

  render();
})();
