// ==UserScript==
// @name         Company Hub 💼 
// @namespace    fries-7ds-company-hub
// @version      6.0.0
// @description  Peace Company Hub overlay. Auth via /api/auth then uses /state with X-Session-Token. Trains, Contracts, Recruit Leads, HoF Search.
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

  // -------- HARD GUARD: prevents duplicates ----------
  if (window.__PEACE_HUB_RUNNING__) return;
  window.__PEACE_HUB_RUNNING__ = true;

  const EL_BTN = "peacehub-btn";
  const EL_PANEL = "peacehub-panel";
  const EL_TOAST = "peacehub-toast";

  // Cleanup old remnants
  try {
    document.getElementById(EL_BTN)?.remove();
    document.getElementById(EL_PANEL)?.remove();
    document.getElementById(EL_TOAST)?.remove();
  } catch {}

  // ---------------- Storage ----------------
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

  // ---------------- Helpers ----------------
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
    toastMsg._t = setTimeout(() => (t.style.display = "none"), 1700);
  }

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
          try {
            const j = JSON.parse(r.responseText || "{}");
            resolve({ status: r.status, json: j });
          } catch {
            reject(new Error("Bad JSON"));
          }
        },
        onerror: () => reject(new Error("Network error")),
        ontimeout: () => reject(new Error("Timeout")),
      });
    });
  }

  // ---------------- State ----------------
  const state = {
    open: false,
    tab: S.get("peacehub_tab", "hub"),
    last: "—",
    timer: null,

    // auth inputs (saved)
    admin_key: S.get("peacehub_admin_key", "") || "",
    api_key: S.get("peacehub_api_key", "") || "",

    // session token from server
    token: S.get("peacehub_session_token", "") || "",

    // UI selections
    selected_company_id: "",
    company_ids_input: S.get("peacehub_company_ids_input", "") || "",

    // local caches from /state
    data: null,
    hofRows: [],
    hofCount: 0,
  };

  // ---------------- Styles ----------------
  GM_addStyle(`
    #${EL_BTN}{
      position: fixed;
      z-index: 2147483647;
      width: 46px;
      height: 46px;
      border-radius: 14px;
      display:flex;
      align-items:center;
      justify-content:center;
      background: rgba(12,12,18,.92);
      border: 1px solid rgba(255,255,255,.16);
      box-shadow: 0 12px 30px rgba(0,0,0,.55);
      user-select:none;
      -webkit-user-select:none;
      touch-action:none;
      cursor:pointer;
    }
    #${EL_BTN} .ico{font-size:21px;line-height:1}
    #${EL_BTN} .badge{
      position:absolute;
      top:-6px;
      right:-6px;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      background: rgba(220,60,60,.95);
      border: 1px solid rgba(255,255,255,.22);
      display:none;
      align-items:center;
      justify-content:center;
      color:#fff;
      font-weight: 900;
      font-size: 12px;
    }

    #${EL_TOAST}{
      position: fixed;
      z-index: 2147483647;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(0,0,0,.82);
      border: 1px solid rgba(255,255,255,.12);
      color: #fff;
      font-weight: 800;
      font-size: 12px;
      display:none;
      max-width: 92vw;
      text-align:center;
    }

    #${EL_PANEL}{
      position: fixed;
      z-index: 2147483646;
      width: 372px;
      max-width: 94vw;
      height: 590px;
      max-height: 84vh;
      border-radius: 16px;
      background: rgba(12,12,18,.92);
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: 0 18px 46px rgba(0,0,0,.55);
      overflow: hidden;
      display:none;
      backdrop-filter: blur(10px);
    }

    #${EL_PANEL} .head{
      height: 44px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      padding: 0 10px;
      background: rgba(255,255,255,.06);
      border-bottom: 1px solid rgba(255,255,255,.08);
      color:#fff;
      user-select:none;
      -webkit-user-select:none;
      touch-action:none;
      cursor: grab;
    }
    #${EL_PANEL} .title{ font-weight: 900; font-size: 13px; }
    #${EL_PANEL} .sub{ opacity:.85; font-weight: 800; font-size: 11px; }

    #${EL_PANEL} .btn{
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(0,0,0,.20);
      color: #fff;
      border-radius: 10px;
      padding: 7px 10px;
      font-weight: 900;
      font-size: 12px;
      cursor: pointer;
      user-select:none;
    }
    #${EL_PANEL} .btn:active{ transform: scale(.98); }
    #${EL_PANEL} .btn.danger{ border-color: rgba(220,60,60,.5); }

    #${EL_PANEL} .tabs{
      display:flex;
      gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      overflow-x:auto;
    }
    #${EL_PANEL} .tab{
      flex:0 0 auto;
      text-align:center;
      padding: 8px 10px;
      border-radius: 12px;
      font-weight: 900;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.05);
      color:#fff;
      user-select:none;
      white-space:nowrap;
    }
    #${EL_PANEL} .tab.active{
      background: rgba(0,0,0,.28);
      border-color: rgba(255,255,255,.18);
    }

    #${EL_PANEL} .body{
      height: calc(100% - 44px - 56px);
      overflow: auto;
      padding: 10px;
      color: #fff;
    }

    #${EL_PANEL} .card{
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 14px;
      padding: 10px;
      margin-bottom: 10px;
    }
    #${EL_PANEL} .muted{ opacity:.80; font-weight: 700; font-size: 12px; }
    #${EL_PANEL} input, #${EL_PANEL} select, #${EL_PANEL} textarea{
      width: 100%;
      background: rgba(0,0,0,.22);
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 12px;
      padding: 10px;
      color:#fff;
      font-weight: 900;
      outline: none;
      box-sizing:border-box;
    }
    #${EL_PANEL} textarea{ min-height: 62px; resize: vertical; }
    #${EL_PANEL} .row{
      display:flex;
      gap: 8px;
      align-items:center;
    }
    #${EL_PANEL} .row > *{ flex:1; }
    #${EL_PANEL} .list{ display:grid; gap: 8px; }
    #${EL_PANEL} .pill{
      display:inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.16);
      background: rgba(0,0,0,.20);
      font-weight:900;
      font-size: 11px;
      opacity:.92;
    }
  `);

  // ---------------- UI Nodes ----------------
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

  // ---------------- Positions ----------------
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

  // ---------------- Drag (tap vs drag) ----------------
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

      // convert to left/top
      node.style.right = "auto";
      node.style.bottom = "auto";
      node.style.left = ox + "px";
      node.style.top = oy + "px";
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

  // Badge button drag + tap toggle
  makeDraggableTap(btn, {
    onTap: () => toggle(),
    onSavePos: (x, y) => {
      S.set("peacehub_btn_left", x);
      S.set("peacehub_btn_top", y);
    }
  });

  // ---------------- Session helpers ----------------
  function tokenHeaders() {
    const t = (state.token || "").trim();
    return t ? { "X-Session-Token": t } : {};
  }

  async function doAuth(admin_key, api_key) {
    const { status, json } = await reqJSON("/api/auth", "POST", { admin_key, api_key });
    if (status >= 400 || !json || json.ok !== true) {
      throw new Error(json?.error || `Auth failed (${status})`);
    }
    state.token = json.token || "";
    S.set("peacehub_session_token", state.token);
    return json;
  }

  async function fetchState(companyIdMaybe = "") {
    const q = companyIdMaybe ? `?company_id=${encodeURIComponent(companyIdMaybe)}` : "";
    const { status, json } = await reqJSON(`/state${q}`, "GET", null, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) {
      throw new Error(json?.error || `State failed (${status})`);
    }
    return json;
  }

  async function saveCompanyIds(ids) {
    const { status, json } = await reqJSON("/api/user/companies", "POST", { company_ids: ids }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) {
      throw new Error(json?.error || `Save failed (${status})`);
    }
    return json;
  }

  // Trains
  async function trainsAdd(company_id, buyer_name, trains_bought, note) {
    const { status, json } = await reqJSON("/api/trains/add", "POST", {
      company_id, buyer_name, trains_bought, note
    }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Add train failed");
    return json;
  }
  async function trainsSetUsed(id, trains_used) {
    const { status, json } = await reqJSON("/api/trains/set_used", "POST", { id, trains_used }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Set used failed");
    return json;
  }
  async function trainsDelete(id) {
    const { status, json } = await reqJSON("/api/trains/delete", "POST", { id }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Delete failed");
    return json;
  }

  // Contracts
  async function contractsAdd(company_id, title, employee_id, employee_name, expires_at, note) {
    const { status, json } = await reqJSON("/api/contracts/add", "POST", {
      company_id, title, employee_id, employee_name, expires_at, note
    }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Add contract failed");
    return json;
  }
  async function contractsDelete(id) {
    const { status, json } = await reqJSON("/api/contracts/delete", "POST", { id }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Delete failed");
    return json;
  }

  // HoF Search
  async function hofSearch(filters) {
    const { status, json } = await reqJSON("/api/search/hof", "POST", filters, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "HoF failed");
    return json;
  }

  // Recruit leads
  async function recruitScan(company_id_or_empty) {
    const body = company_id_or_empty ? { company_id: company_id_or_empty } : {};
    const { status, json } = await reqJSON("/api/recruit/scan", "POST", body, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Recruit scan failed");
    return json;
  }
  async function recruitLeads(company_id) {
    const { status, json } = await reqJSON(`/api/recruit/leads?company_id=${encodeURIComponent(company_id)}`, "GET", null, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Leads failed");
    return json;
  }
  async function recruitSeen(company_id) {
    const { status, json } = await reqJSON("/api/recruit/seen", "POST", { company_id }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Seen failed");
    return json;
  }
  async function recruitClear(company_id) {
    const { status, json } = await reqJSON("/api/recruit/clear", "POST", { company_id }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Clear failed");
    return json;
  }

  // Notifications
  async function notifsSeen() {
    const { status, json } = await reqJSON("/api/notifications/seen", "POST", {}, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Notifs seen failed");
    return json;
  }

  // ---------------- Polling ----------------
  function stopPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  function startPolling() {
    stopPolling();
    state.timer = setInterval(async () => {
      if (!state.open) return;
      if (!state.token) return;
      // keep it light: just refresh state
      try {
        await refresh(true);
      } catch {}
    }, POLL_MS);
  }

  async function refresh(silent = false) {
    if (!state.token) {
      if (!silent) toastMsg("Login first");
      return;
    }
    try {
      const companyId = state.selected_company_id || "";
      const j = await fetchState(companyId);
      state.data = j;
      state.selected_company_id = j.selected_company_id || state.selected_company_id || "";
      state.last = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      // badge
      const unseen = Number(j.unseen_count || 0);
      const b = document.getElementById("peacehub-badge");
      if (b) {
        if (unseen > 0) {
          b.style.display = "flex";
          b.textContent = unseen > 99 ? "99+" : String(unseen);
        } else {
          b.style.display = "none";
        }
      }

      render();
    } catch (e) {
      if (!silent) toastMsg(String(e.message || "Refresh failed"));
    }
  }

  // ---------------- Views ----------------
  function viewHub() {
    const wrap = document.createElement("div");

    const d = state.data;
    if (!d) {
      const c = document.createElement("div");
      c.className = "card";
      c.innerHTML = `<div style="font-weight:900;">Not loaded</div><div class="muted">Tap Refresh or login in Settings.</div>`;
      wrap.appendChild(c);
      return wrap;
    }

    // Company picker
    const c1 = document.createElement("div");
    c1.className = "card";
    c1.innerHTML = `
      <div style="font-weight:900;">${escapeHtml(d.service || "Company Hub")}</div>
      <div class="muted">User: ${escapeHtml(d.user?.name || "")} [${escapeHtml(d.user?.user_id || "")}]</div>
      <div class="muted">Updated: ${escapeHtml(d.updated_at || "")}</div>
    `;
    wrap.appendChild(c1);

    const cids = Array.isArray(d.company_ids) ? d.company_ids : [];
    const sel = document.createElement("select");
    sel.innerHTML = `<option value="">Select company…</option>` + cids.map(cid => {
      const selected = String(cid) === String(d.selected_company_id) ? "selected" : "";
      const label = d.company && String(d.company.id) === String(cid) ? `${d.company.name || "Company"} (${cid})` : `Company ${cid}`;
      return `<option value="${escapeHtml(cid)}" ${selected}>${escapeHtml(label)}</option>`;
    }).join("");
    sel.onchange = async () => {
      state.selected_company_id = sel.value;
      await refresh(true);
    };
    wrap.appendChild(sel);

    // Company info + employees
    const comp = d.company;
    const stats = d.stats || {};
    const c2 = document.createElement("div");
    c2.className = "card";
    c2.innerHTML = `
      <div class="row" style="align-items:flex-start;">
        <div>
          <div style="font-weight:900;">Company</div>
          <div class="muted">Name: ${escapeHtml(fmt(comp?.name))}</div>
          <div class="muted">Rating: ${escapeHtml(fmt(comp?.rating))}</div>
        </div>
        <div style="text-align:right;">
          <div class="pill">Employees: ${escapeHtml(fmt(stats.employee_count))}</div><br>
          <div class="pill" style="margin-top:6px;">Inactive 3d+: ${escapeHtml(fmt(stats.inactive_3d_plus))}</div>
        </div>
      </div>
    `;
    wrap.appendChild(c2);

    const emps = Array.isArray(d.employees) ? d.employees : [];
    const c3 = document.createElement("div");
    c3.className = "card";
    c3.innerHTML = `<div style="font-weight:900;">Employees</div><div class="muted">Tap name to open profile.</div>`;
    const list = document.createElement("div");
    list.className = "list";
    c3.appendChild(list);

    if (!emps.length) {
      const m = document.createElement("div");
      m.className = "muted";
      m.textContent = "—";
      list.appendChild(m);
    } else {
      emps.forEach(e => {
        const total = (Number(e.man||0) + Number(e.int||0) + Number(e.end||0)) || 0;
        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";
        item.innerHTML = `
          <div class="row">
            <button class="btn" data-open style="flex:1;text-align:left;">
              ${escapeHtml(e.name || "Employee")} [${escapeHtml(e.id || "")}]
            </button>
            <div style="text-align:right;min-width:110px;">
              <div class="pill">T: ${escapeHtml(String(total))}</div><br>
              <div class="muted" style="margin-top:6px;">Inactive: ${escapeHtml(fmt(e.inactive_days))}d</div>
            </div>
          </div>
          <div class="muted" style="margin-top:8px;">
            ${escapeHtml(fmt(e.position))} • Eff: ${escapeHtml(fmt(e.effectiveness))}
          </div>
          <div class="muted">MAN ${escapeHtml(fmt(e.man))} • INT ${escapeHtml(fmt(e.int))} • END ${escapeHtml(fmt(e.end))}</div>
        `;
        item.querySelector("[data-open]")?.addEventListener("click", () => {
          if (!e.id) return;
          window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(e.id)}`, "_blank");
        });
        list.appendChild(item);
      });
    }

    wrap.appendChild(c3);
    return wrap;
  }

  function viewTrains() {
    const wrap = document.createElement("div");
    const d = state.data;

    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div style="font-weight:900;">Trains</div>
      <div class="muted">Uses: /api/trains/add, /api/trains/set_used, /api/trains/delete</div>
    `;
    wrap.appendChild(c);

    if (!d?.selected_company_id) {
      const m = document.createElement("div");
      m.className = "card muted";
      m.textContent = "Select a company in Hub tab first.";
      wrap.appendChild(m);
      return wrap;
    }

    const add = document.createElement("div");
    add.className = "card";
    add.innerHTML = `<div style="font-weight:900;">Add Train Purchase</div>`;
    const buyer = document.createElement("input"); buyer.placeholder = "Buyer name (required)";
    const qty = document.createElement("input"); qty.type="number"; qty.placeholder = "Trains bought (required)";
    const note = document.createElement("input"); note.placeholder = "Note (optional)";

    const btnAdd = document.createElement("button");
    btnAdd.className = "btn";
    btnAdd.textContent = "Add";

    add.appendChild(buyer);
    add.appendChild(qty);
    add.appendChild(note);
    add.appendChild(document.createElement("div")).style.height = "8px";
    add.appendChild(btnAdd);
    wrap.appendChild(add);

    btnAdd.onclick = async () => {
      try {
        const b = buyer.value.trim();
        const n = Number(qty.value || 0);
        if (!b || n <= 0) return toastMsg("Buyer + trains required");
        btnAdd.disabled = true;
        await trainsAdd(d.selected_company_id, b, n, note.value.trim());
        toastMsg("Added");
        buyer.value=""; qty.value=""; note.value="";
        await refresh(true);
      } catch (e) {
        toastMsg(e.message || "Add failed");
      } finally {
        btnAdd.disabled = false;
      }
    };

    const rows = Array.isArray(d.trains) ? d.trains : [];
    const listCard = document.createElement("div");
    listCard.className = "card";
    listCard.innerHTML = `<div style="font-weight:900;">Records</div><div class="muted">Company #${escapeHtml(d.selected_company_id)}</div>`;
    const list = document.createElement("div");
    list.className = "list";
    listCard.appendChild(list);

    if (!rows.length) {
      const m = document.createElement("div");
      m.className = "muted";
      m.textContent = "—";
      list.appendChild(m);
    } else {
      rows.forEach(r => {
        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";

        const id = r.id ?? r.train_id ?? r.rowid ?? 0;
        const bought = Number(r.trains_bought ?? r.bought ?? 0);
        const used = Number(r.trains_used ?? r.used ?? 0);

        item.innerHTML = `
          <div class="row">
            <div style="flex:2;min-width:0;">
              <div style="font-weight:900;">${escapeHtml(fmt(r.buyer_name || r.buyer))}</div>
              <div class="muted">${escapeHtml(fmt(r.created_at))}${r.note ? " • " + escapeHtml(String(r.note)) : ""}</div>
              <div class="muted">Bought: ${escapeHtml(String(bought))} • Used: ${escapeHtml(String(used))}</div>
            </div>
            <button class="btn danger" data-del style="flex:0 0 auto;">Del</button>
          </div>

          <div class="row" style="margin-top:8px;">
            <input data-used type="number" placeholder="Set used…" value="${escapeHtml(String(used))}">
            <button class="btn" data-set>Save Used</button>
          </div>
        `;

        item.querySelector("[data-del]")?.addEventListener("click", async () => {
          try {
            await trainsDelete(Number(id));
            toastMsg("Deleted");
            await refresh(true);
          } catch (e) {
            toastMsg(e.message || "Delete failed");
          }
        });

        item.querySelector("[data-set]")?.addEventListener("click", async () => {
          try {
            const v = Number(item.querySelector("[data-used]")?.value || 0);
            if (v < 0) return toastMsg("Used must be 0+");
            await trainsSetUsed(Number(id), v);
            toastMsg("Saved");
            await refresh(true);
          } catch (e) {
            toastMsg(e.message || "Save failed");
          }
        });

        list.appendChild(item);
      });
    }

    wrap.appendChild(listCard);
    return wrap;
  }

  function viewContracts() {
    const wrap = document.createElement("div");
    const d = state.data;

    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div style="font-weight:900;">Contracts</div>
      <div class="muted">Uses: /api/contracts/add, /api/contracts/delete</div>
    `;
    wrap.appendChild(c);

    if (!d?.selected_company_id) {
      const m = document.createElement("div");
      m.className = "card muted";
      m.textContent = "Select a company in Hub tab first.";
      wrap.appendChild(m);
      return wrap;
    }

    const add = document.createElement("div");
    add.className = "card";
    add.innerHTML = `<div style="font-weight:900;">Add Contract</div>`;

    const title = document.createElement("input"); title.placeholder = "Title (required)";
    const empId = document.createElement("input"); empId.placeholder = "Employee id (optional)";
    const empName = document.createElement("input"); empName.placeholder = "Employee name (optional)";
    const exp = document.createElement("input"); exp.placeholder = "Expires at (text, optional) e.g. 2026-04-01";
    const note = document.createElement("input"); note.placeholder = "Note (optional)";

    const btnAdd = document.createElement("button");
    btnAdd.className = "btn";
    btnAdd.textContent = "Add";

    add.appendChild(title);
    add.appendChild(empId);
    add.appendChild(empName);
    add.appendChild(exp);
    add.appendChild(note);
    add.appendChild(document.createElement("div")).style.height = "8px";
    add.appendChild(btnAdd);
    wrap.appendChild(add);

    btnAdd.onclick = async () => {
      try {
        const t = title.value.trim();
        if (!t) return toastMsg("Title required");
        btnAdd.disabled = true;
        await contractsAdd(d.selected_company_id, t, empId.value.trim(), empName.value.trim(), exp.value.trim(), note.value.trim());
        toastMsg("Added");
        title.value=""; empId.value=""; empName.value=""; exp.value=""; note.value="";
        await refresh(true);
      } catch (e) {
        toastMsg(e.message || "Add failed");
      } finally {
        btnAdd.disabled = false;
      }
    };

    const rows = Array.isArray(d.contracts) ? d.contracts : [];
    const listCard = document.createElement("div");
    listCard.className = "card";
    listCard.innerHTML = `<div style="font-weight:900;">Records</div><div class="muted">Company #${escapeHtml(d.selected_company_id)}</div>`;
    const list = document.createElement("div");
    list.className = "list";
    listCard.appendChild(list);

    if (!rows.length) {
      const m = document.createElement("div");
      m.className = "muted";
      m.textContent = "—";
      list.appendChild(m);
    } else {
      rows.forEach(r => {
        const id = r.id ?? r.contract_id ?? 0;
        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";
        item.innerHTML = `
          <div class="row">
            <div style="flex:2;min-width:0;">
              <div style="font-weight:900;">${escapeHtml(fmt(r.title))}</div>
              <div class="muted">${escapeHtml(fmt(r.employee_name))}${r.employee_id ? " ["+escapeHtml(String(r.employee_id))+"]" : ""}</div>
              <div class="muted">Expires: ${escapeHtml(fmt(r.expires_at))}</div>
              <div class="muted">${escapeHtml(fmt(r.note))}</div>
            </div>
            <button class="btn danger" data-del style="flex:0 0 auto;">Del</button>
          </div>
        `;
        item.querySelector("[data-del]")?.addEventListener("click", async () => {
          try {
            await contractsDelete(Number(id));
            toastMsg("Deleted");
            await refresh(true);
          } catch (e) {
            toastMsg(e.message || "Delete failed");
          }
        });
        list.appendChild(item);
      });
    }

    wrap.appendChild(listCard);
    return wrap;
  }

  function viewRecruit() {
    const wrap = document.createElement("div");
    const d = state.data;

    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div style="font-weight:900;">Recruit Leads (Premium)</div>
      <div class="muted">Scan HoF and store leads beating your weakest employee total.</div>
    `;
    wrap.appendChild(c);

    if (!d?.selected_company_id) {
      const m = document.createElement("div");
      m.className = "card muted";
      m.textContent = "Select a company in Hub tab first.";
      wrap.appendChild(m);
      return wrap;
    }

    const actions = document.createElement("div");
    actions.className = "card";
    actions.innerHTML = `
      <div style="font-weight:900;">Actions</div>
      <div class="row" style="margin-top:8px;">
        <button class="btn" data-scan>Scan This Company</button>
        <button class="btn" data-refresh>Load Leads</button>
      </div>
      <div class="row" style="margin-top:8px;">
        <button class="btn" data-seen>Mark Seen</button>
        <button class="btn danger" data-clear>Clear Leads</button>
      </div>
      <div class="muted" style="margin-top:8px;" id="recruit-msg">—</div>
    `;
    wrap.appendChild(actions);

    const msg = qs("#recruit-msg", actions);

    qs("[data-scan]", actions).onclick = async () => {
      try {
        msg.textContent = "Scanning…";
        const res = await recruitScan(d.selected_company_id);
        msg.textContent = "Scan complete.";
        toastMsg("Scan done");
        // Load leads after scan
        await loadLeads();
      } catch (e) {
        msg.textContent = e.message || "Scan failed";
        toastMsg("Scan failed");
      }
    };

    qs("[data-refresh]", actions).onclick = async () => {
      await loadLeads(true);
    };

    qs("[data-seen]", actions).onclick = async () => {
      try {
        await recruitSeen(d.selected_company_id);
        toastMsg("Marked seen");
        await refresh(true);
      } catch (e) {
        toastMsg(e.message || "Seen failed");
      }
    };

    qs("[data-clear]", actions).onclick = async () => {
      try {
        await recruitClear(d.selected_company_id);
        toastMsg("Cleared");
        await loadLeads(true);
        await refresh(true);
      } catch (e) {
        toastMsg(e.message || "Clear failed");
      }
    };

    const listCard = document.createElement("div");
    listCard.className = "card";
    listCard.innerHTML = `<div style="font-weight:900;">Leads</div><div class="muted">Company #${escapeHtml(d.selected_company_id)}</div>`;
    const list = document.createElement("div");
    list.className = "list";
    listCard.appendChild(list);
    wrap.appendChild(listCard);

    async function loadLeads(showToast) {
      list.innerHTML = `<div class="muted">Loading…</div>`;
      try {
        const res = await recruitLeads(d.selected_company_id);
        const rows = Array.isArray(res.rows) ? res.rows : [];
        list.innerHTML = "";
        if (!rows.length) {
          list.innerHTML = `<div class="muted">—</div>`;
        } else {
          rows.forEach(r => {
            const item = document.createElement("div");
            item.className = "card";
            item.style.marginBottom = "0";
            item.innerHTML = `
              <div class="row">
                <button class="btn" data-open style="flex:1;text-align:left;">
                  ${escapeHtml(fmt(r.name))} [${escapeHtml(fmt(r.player_id || r.id))}]
                </button>
                <div style="text-align:right;min-width:110px;">
                  <div class="pill">+${escapeHtml(fmt(r.delta_vs_floor))}</div><br>
                  <div class="muted" style="margin-top:6px;">Total: ${escapeHtml(fmt(r.total))}</div>
                </div>
              </div>
              <div class="muted" style="margin-top:8px;">
                MAN ${escapeHtml(fmt(r.man))} • INT ${escapeHtml(fmt(r.intel || r.int))} • END ${escapeHtml(fmt(r.endu || r.end))}
              </div>
            `;
            item.querySelector("[data-open]")?.addEventListener("click", () => {
              const id = r.player_id || r.id;
              if (!id) return;
              window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}`, "_blank");
            });
            list.appendChild(item);
          });
        }
        if (showToast) toastMsg("Loaded");
      } catch (e) {
        list.innerHTML = `<div class="muted">${escapeHtml(e.message || "Load failed")}</div>`;
        if (showToast) toastMsg("Load failed");
      }
    }

    // initial load from /state cache if present
    const cached = Array.isArray(d.recruit_leads) ? d.recruit_leads : [];
    if (cached.length) {
      list.innerHTML = "";
      cached.forEach(r => {
        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";
        item.innerHTML = `
          <div class="row">
            <button class="btn" data-open style="flex:1;text-align:left;">
              ${escapeHtml(fmt(r.name))} [${escapeHtml(fmt(r.player_id || r.id))}]
            </button>
            <div style="text-align:right;min-width:110px;">
              <div class="pill">+${escapeHtml(fmt(r.delta_vs_floor))}</div><br>
              <div class="muted" style="margin-top:6px;">Total: ${escapeHtml(fmt(r.total))}</div>
            </div>
          </div>
        `;
        item.querySelector("[data-open]")?.addEventListener("click", () => {
          const id = r.player_id || r.id;
          if (!id) return;
          window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}`, "_blank");
        });
        list.appendChild(item);
      });
    } else {
      list.innerHTML = `<div class="muted">Tap “Load Leads”</div>`;
    }

    return wrap;
  }

  function viewHof() {
    const wrap = document.createElement("div");

    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div style="font-weight:900;">HoF Workstats Search</div>
      <div class="muted">Uses POST /api/search/hof (server uses your API key)</div>
    `;
    wrap.appendChild(c);

    const manRow = document.createElement("div");
    manRow.className = "row";
    const minMan = document.createElement("input"); minMan.type="number"; minMan.placeholder="Min MAN";
    const maxMan = document.createElement("input"); maxMan.type="number"; maxMan.placeholder="Max MAN";
    manRow.appendChild(minMan); manRow.appendChild(maxMan);

    const intRow = document.createElement("div");
    intRow.className = "row";
    const minInt = document.createElement("input"); minInt.type="number"; minInt.placeholder="Min INT";
    const maxInt = document.createElement("input"); maxInt.type="number"; maxInt.placeholder="Max INT";
    intRow.appendChild(minInt); intRow.appendChild(maxInt);

    const endRow = document.createElement("div");
    endRow.className = "row";
    const minEnd = document.createElement("input"); minEnd.type="number"; minEnd.placeholder="Min END";
    const maxEnd = document.createElement("input"); maxEnd.type="number"; maxEnd.placeholder="Max END";
    endRow.appendChild(minEnd); endRow.appendChild(maxEnd);

    const btnGo = document.createElement("button");
    btnGo.className = "btn";
    btnGo.textContent = "Search";

    const meta = document.createElement("div");
    meta.className = "muted";
    meta.style.marginTop = "8px";
    meta.textContent = "—";

    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(manRow);
    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(intRow);
    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(endRow);
    c.appendChild(document.createElement("div")).style.height = "10px";
    c.appendChild(btnGo);
    c.appendChild(meta);

    const listCard = document.createElement("div");
    listCard.className = "card";
    listCard.innerHTML = `<div style="font-weight:900;">Results</div>`;
    const list = document.createElement("div");
    list.className = "list";
    listCard.appendChild(list);
    wrap.appendChild(listCard);

    function renderRows() {
      list.innerHTML = "";
      if (!state.hofRows.length) {
        list.innerHTML = `<div class="muted">—</div>`;
        return;
      }
      state.hofRows.forEach(r => {
        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";
        item.innerHTML = `
          <div class="row">
            <button class="btn" data-open style="flex:1;text-align:left;">
              ${escapeHtml(fmt(r.name))} [${escapeHtml(fmt(r.id))}]
            </button>
            <div style="text-align:right;min-width:110px;">
              <div class="pill">Total: ${escapeHtml(fmt(r.total))}</div>
            </div>
          </div>
          <div class="muted" style="margin-top:8px;">
            MAN ${escapeHtml(fmt(r.man))} • INT ${escapeHtml(fmt(r.int))} • END ${escapeHtml(fmt(r.end))}
          </div>
        `;
        item.querySelector("[data-open]")?.addEventListener("click", () => {
          if (!r.id) return;
          window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(r.id)}`, "_blank");
        });
        list.appendChild(item);
      });
    }

    btnGo.onclick = async () => {
      if (!state.token) return toastMsg("Login first");
      try {
        btnGo.disabled = true;
        meta.textContent = "Searching…";

        const filters = {
          min_man: Number(minMan.value || 0),
          max_man: Number(maxMan.value || 10 ** 12),
          min_int: Number(minInt.value || 0),
          max_int: Number(maxInt.value || 10 ** 12),
          min_end: Number(minEnd.value || 0),
          max_end: Number(maxEnd.value || 10 ** 12),
        };

        const res = await hofSearch(filters);
        state.hofCount = Number(res.count || 0);
        state.hofRows = Array.isArray(res.rows) ? res.rows : [];
        meta.textContent = `Found: ${state.hofCount} (showing ${state.hofRows.length})`;
        renderRows();
        toastMsg("Done");
      } catch (e) {
        meta.textContent = e.message || "Failed";
        toastMsg("Search failed");
      } finally {
        btnGo.disabled = false;
      }
    };

    renderRows();
    return wrap;
  }

  function viewNotifs() {
    const wrap = document.createElement("div");
    const d = state.data;

    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div style="font-weight:900;">Notifications</div>
      <div class="muted">From /state.notifications</div>
    `;
    wrap.appendChild(c);

    const btnRow = document.createElement("div");
    btnRow.className = "card";
    btnRow.innerHTML = `
      <div class="row">
        <button class="btn" data-seen>Mark Seen</button>
        <button class="btn" data-refresh>Refresh</button>
      </div>
    `;
    wrap.appendChild(btnRow);

    qs("[data-seen]", btnRow).onclick = async () => {
      try {
        await notifsSeen();
        toastMsg("Seen");
        await refresh(true);
      } catch (e) {
        toastMsg(e.message || "Failed");
      }
    };
    qs("[data-refresh]", btnRow).onclick = async () => {
      await refresh(false);
    };

    const listCard = document.createElement("div");
    listCard.className = "card";
    listCard.innerHTML = `<div style="font-weight:900;">Recent</div>`;
    const list = document.createElement("div");
    list.className = "list";
    listCard.appendChild(list);
    wrap.appendChild(listCard);

    const rows = Array.isArray(d?.notifications) ? d.notifications : [];
    if (!rows.length) {
      list.innerHTML = `<div class="muted">—</div>`;
    } else {
      rows.forEach(n => {
        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";
        const seen = Number(n.seen || 0) === 1;
        item.innerHTML = `
          <div style="font-weight:900;">${escapeHtml(fmt(n.kind || n.type || "system"))} ${seen ? `<span class="pill" style="opacity:.65;margin-left:6px;">seen</span>` : `<span class="pill" style="margin-left:6px;">new</span>`}</div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(fmt(n.message || n.msg || ""))}</div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(fmt(n.created_at || ""))}</div>
        `;
        list.appendChild(item);
      });
    }

    return wrap;
  }

  function viewSettings() {
    const wrap = document.createElement("div");

    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div style="font-weight:900;">Settings / Login</div>
      <div class="muted">Server: ${escapeHtml(BASE_URL)}</div>
      <div class="muted">Login uses: POST /api/auth then stores session token.</div>
    `;
    wrap.appendChild(c);

    const admin = document.createElement("input");
    admin.placeholder = "Admin key (provided by you)";
    admin.value = state.admin_key || "";

    const api = document.createElement("input");
    api.placeholder = "Your Torn API key (user’s key)";
    api.value = state.api_key || "";

    const login = document.createElement("button");
    login.className = "btn";
    login.textContent = "Login";

    const logout = document.createElement("button");
    logout.className = "btn danger";
    logout.textContent = "Logout";

    const status = document.createElement("div");
    status.className = "muted";
    status.style.marginTop = "8px";
    status.textContent = state.token ? "Session: saved" : "Session: none";

    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(admin);
    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(api);
    c.appendChild(document.createElement("div")).style.height = "10px";
    c.appendChild(login);
    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(logout);
    c.appendChild(status);

    login.onclick = async () => {
      try {
        const ak = admin.value.trim();
        const pk = api.value.trim();
        if (!ak || !pk) return toastMsg("Admin key + API key required");

        login.disabled = true;

        state.admin_key = ak;
        state.api_key = pk;
        S.set("peacehub_admin_key", ak);
        S.set("peacehub_api_key", pk);

        const j = await doAuth(ak, pk);
        status.textContent = `Logged in as ${j.name || "user"} [${j.user_id || ""}]`;
        toastMsg("Logged in");
        await refresh(true);
        startPolling();
      } catch (e) {
        status.textContent = e.message || "Login failed";
        toastMsg("Login failed");
      } finally {
        login.disabled = false;
      }
    };

    logout.onclick = async () => {
      state.token = "";
      S.del("peacehub_session_token");
      state.data = null;
      toastMsg("Logged out");
      status.textContent = "Session: none";
      stopPolling();
      render();
    };

    // Company IDs save
    const c2 = document.createElement("div");
    c2.className = "card";
    c2.innerHTML = `
      <div style="font-weight:900;">My Company IDs</div>
      <div class="muted">Comma separated (example): 123, 456</div>
    `;
    wrap.appendChild(c2);

    const ids = document.createElement("input");
    ids.placeholder = "123,456,789";
    ids.value = state.company_ids_input || "";

    const save = document.createElement("button");
    save.className = "btn";
    save.textContent = "Save Company IDs";

    const note = document.createElement("div");
    note.className = "muted";
    note.style.marginTop = "8px";
    note.textContent = "—";

    c2.appendChild(ids);
    c2.appendChild(document.createElement("div")).style.height = "10px";
    c2.appendChild(save);
    c2.appendChild(note);

    save.onclick = async () => {
      if (!state.token) return toastMsg("Login first");
      try {
        save.disabled = true;
        const raw = ids.value.split(",").map(s => s.trim()).filter(Boolean);
        if (!raw.length) return toastMsg("Enter at least 1 company id");
        if (!raw.every(x => /^\d+$/.test(x))) return toastMsg("Company IDs must be numeric");

        state.company_ids_input = raw.join(",");
        S.set("peacehub_company_ids_input", state.company_ids_input);

        const res = await saveCompanyIds(raw);
        note.textContent = `Saved ${res.company_ids?.length || 0} company ids.`;
        toastMsg("Saved");
        await refresh(true);
      } catch (e) {
        note.textContent = e.message || "Save failed";
        toastMsg("Save failed");
      } finally {
        save.disabled = false;
      }
    };

    return wrap;
  }

  // ---------------- Render ----------------
  function render() {
    S.set("peacehub_tab", state.tab);

    const title = "Peace Company Hub";
    const last = state.last || "—";
    const userName = state.data?.user?.name || "";
    const service = state.data?.service || title;

    panel.innerHTML = `
      <div class="head" id="peacehub-head">
        <div>
          <div class="title">${escapeHtml(service)}</div>
          <div class="sub">Last: <span id="ph-last">${escapeHtml(last)}</span> ${userName ? `• ${escapeHtml(userName)}` : ""}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn" id="ph-refresh" title="Refresh">↻</button>
          <button class="btn" id="ph-close" title="Close">✕</button>
        </div>
      </div>

      <div class="tabs">
        <div class="tab ${state.tab === "hub" ? "active" : ""}" data-tab="hub">Hub</div>
        <div class="tab ${state.tab === "trains" ? "active" : ""}" data-tab="trains">Trains</div>
        <div class="tab ${state.tab === "contracts" ? "active" : ""}" data-tab="contracts">Contracts</div>
        <div class="tab ${state.tab === "recruit" ? "active" : ""}" data-tab="recruit">Recruit</div>
        <div class="tab ${state.tab === "hof" ? "active" : ""}" data-tab="hof">HoF Search</div>
        <div class="tab ${state.tab === "notifs" ? "active" : ""}" data-tab="notifs">Notifs</div>
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
    if (state.tab === "hub") body.appendChild(viewHub());
    if (state.tab === "trains") body.appendChild(viewTrains());
    if (state.tab === "contracts") body.appendChild(viewContracts());
    if (state.tab === "recruit") body.appendChild(viewRecruit());
    if (state.tab === "hof") body.appendChild(viewHof());
    if (state.tab === "notifs") body.appendChild(viewNotifs());
    if (state.tab === "settings") body.appendChild(viewSettings());

    // Drag panel ONLY from header so tabs/buttons always clickable
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

  // ---------------- Open/Close ----------------
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
    } else {
      stopPolling();
    }
  }

  // ---------------- Start ----------------
  render();
  // If you want auto-open on load, uncomment:
  // toggle(true);

})();
