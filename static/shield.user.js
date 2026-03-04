// ==UserScript==
// @name         Company Hub 💼
// @namespace    fries91-7ds-wrath
// @version      6.2.1
// @description  Company Hub overlay. Auth via /api/auth then uses /state with X-Session-Token. High-value company theme. Briefcase always on top, smaller, no duplicates. HoF search is TOTAL-only.
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

  // Cleanup remnants from older versions
  try { document.getElementById(EL_BTN)?.remove(); } catch {}
  try { document.getElementById(EL_PANEL)?.remove(); } catch {}
  try { document.getElementById(EL_TOAST)?.remove(); } catch {}

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

  // Toast
  function toastMsg(msg) {
    const t = document.getElementById(EL_TOAST);
    if (!t) return;
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(toastMsg._t);
    toastMsg._t = setTimeout(() => (t.style.display = "none"), 2200);
  }

  // Requests with “Bad JSON preview”
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
            const prev = String(txt).replace(/\s+/g, " ").slice(0, 160);
            toastMsg(`Bad JSON (${r.status}): ${prev || "[empty]"}`);
            resolve({ status: r.status, json: { ok: false, error: "bad_json", status: r.status, preview: prev }, raw: txt });
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
    tab: S.get("peacehub_tab", "hub") || "hub",
    last: "—",
    timer: null,

    // saved inputs
    admin_key: S.get("peacehub_admin_key", "") || "",
    api_key: S.get("peacehub_api_key", "") || "",

    // session
    token: S.get("peacehub_session_token", "") || "",

    // selection + inputs
    selected_company_id: "",
    company_ids_input: S.get("peacehub_company_ids_input", "") || "",

    // /state cache
    data: null,

    // HoF results
    hofRows: [],
    hofCount: 0,

    // positions
    btnLeft: S.get("peacehub_btn_left", null),
    btnTop: S.get("peacehub_btn_top", null),
    panelLeft: S.get("peacehub_panel_left", null),
    panelTop: S.get("peacehub_panel_top", null),
  };

  // ---------------- High-value theme styles ----------------
  GM_addStyle(`
    #${EL_BTN}{
      position: fixed;
      z-index: 2147483647;
      width: 40px; height: 40px;
      border-radius: 14px;
      display:flex; align-items:center; justify-content:center;
      background: linear-gradient(180deg, rgba(18,22,30,.95), rgba(10,12,18,.92));
      border: 1px solid rgba(255, 215, 120, .22);
      box-shadow: 0 14px 34px rgba(0,0,0,.60), inset 0 1px 0 rgba(255,255,255,.08);
      user-select:none; -webkit-user-select:none; touch-action:none;
      cursor:pointer;
    }
    #${EL_BTN} .ico{font-size:18px; line-height:1; filter: drop-shadow(0 2px 6px rgba(0,0,0,.55));}
    #${EL_BTN} .badge{
      position:absolute; top:-6px; right:-6px;
      min-width: 18px; height: 18px; padding: 0 6px;
      border-radius: 999px;
      background: linear-gradient(180deg, rgba(225,80,80,.98), rgba(165,35,35,.95));
      border: 1px solid rgba(255,255,255,.22);
      display:none; align-items:center; justify-content:center;
      color:#fff; font-weight: 900; font-size: 11px;
      box-shadow: 0 10px 20px rgba(0,0,0,.45);
    }

    #${EL_TOAST}{
      position: fixed; z-index: 2147483647;
      left: 50%; bottom: 18px; transform: translateX(-50%);
      padding: 10px 12px; border-radius: 12px;
      background: rgba(0,0,0,.86);
      border: 1px solid rgba(255, 215, 120, .18);
      color: #fff; font-weight: 900; font-size: 12px;
      display:none; max-width: 92vw; text-align:center;
      box-shadow: 0 12px 30px rgba(0,0,0,.55);
    }

    #${EL_PANEL}{
      position: fixed; z-index: 2147483646;
      width: 380px; max-width: 94vw;
      height: 600px; max-height: 84vh;
      border-radius: 18px;
      overflow: hidden;
      display:none;
      background:
        radial-gradient(1200px 700px at 20% -20%, rgba(255,215,120,.12), transparent 60%),
        radial-gradient(900px 600px at 110% 10%, rgba(120,200,255,.08), transparent 55%),
        linear-gradient(180deg, rgba(18,22,30,.94), rgba(9,11,16,.92));
      border: 1px solid rgba(255, 215, 120, .18);
      box-shadow: 0 24px 70px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.06);
      backdrop-filter: blur(10px);
    }

    #${EL_PANEL} .head{
      height: 48px;
      display:flex; align-items:center; justify-content:space-between;
      padding: 0 12px;
      background: linear-gradient(180deg, rgba(255,215,120,.12), rgba(255,255,255,.03));
      border-bottom: 1px solid rgba(255,215,120,.14);
      color:#fff;
      user-select:none; -webkit-user-select:none; touch-action:none;
      cursor: grab;
    }
    #${EL_PANEL} .title{ font-weight: 1000; font-size: 13px; letter-spacing:.2px; }
    #${EL_PANEL} .sub{ opacity:.86; font-weight: 800; font-size: 11px; }

    #${EL_PANEL} .btn{
      border: 1px solid rgba(255, 215, 120, .18);
      background: rgba(0,0,0,.20);
      color: #fff;
      border-radius: 12px;
      padding: 8px 10px;
      font-weight: 950;
      font-size: 12px;
      cursor: pointer;
      user-select:none;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
    }
    #${EL_PANEL} .btn:active{ transform: scale(.98); }
    #${EL_PANEL} .btn.danger{
      border-color: rgba(235,90,90,.45);
      background: rgba(235,90,90,.08);
    }

    #${EL_PANEL} .tabs{
      display:flex; gap: 8px;
      padding: 10px 10px;
      border-bottom: 1px solid rgba(255,215,120,.10);
      overflow-x:auto;
    }
    #${EL_PANEL} .tab{
      flex:0 0 auto;
      padding: 8px 10px;
      border-radius: 999px;
      font-weight: 950;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid rgba(255,215,120,.12);
      background: rgba(255,255,255,.04);
      color:#fff;
      user-select:none;
      white-space:nowrap;
    }
    #${EL_PANEL} .tab.active{
      background: rgba(255,215,120,.10);
      border-color: rgba(255,215,120,.22);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
    }

    #${EL_PANEL} .body{
      height: calc(100% - 48px - 60px);
      overflow: auto;
      padding: 10px;
      color: #fff;
    }

    #${EL_PANEL} .card{
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,215,120,.10);
      border-radius: 16px;
      padding: 12px;
      margin-bottom: 10px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
    }
    #${EL_PANEL} .muted{ opacity:.82; font-weight: 800; font-size: 12px; }
    #${EL_PANEL} input, #${EL_PANEL} select, #${EL_PANEL} textarea{
      width: 100%;
      background: rgba(0,0,0,.22);
      border: 1px solid rgba(255,215,120,.16);
      border-radius: 14px;
      padding: 10px;
      color:#fff;
      font-weight: 950;
      outline: none;
      box-sizing:border-box;
    }
    #${EL_PANEL} textarea{ min-height: 62px; resize: vertical; }
    #${EL_PANEL} .row{ display:flex; gap: 8px; align-items:center; }
    #${EL_PANEL} .row > *{ flex:1; }
    #${EL_PANEL} .list{ display:grid; gap: 8px; }
    #${EL_PANEL} .pill{
      display:inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255,215,120,.16);
      background: rgba(0,0,0,.18);
      font-weight: 950;
      font-size: 11px;
      opacity:.95;
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

  // KeepAlive
  setInterval(() => {
    if (!document.getElementById(EL_BTN)) { try { document.documentElement.appendChild(btn); } catch {} }
    if (!document.getElementById(EL_TOAST)) { try { document.documentElement.appendChild(toast); } catch {} }
    if (!document.getElementById(EL_PANEL)) { try { document.documentElement.appendChild(panel); } catch {} }
  }, 2000);

  // ---------------- Initial positions ----------------
  function setInitialPos() {
    if (state.btnLeft != null && state.btnTop != null) {
      btn.style.left = state.btnLeft + "px";
      btn.style.top = state.btnTop + "px";
      btn.style.right = "auto"; btn.style.bottom = "auto";
    } else {
      btn.style.right = "14px";
      btn.style.top = "160px";
    }

    if (state.panelLeft != null && state.panelTop != null) {
      panel.style.left = state.panelLeft + "px";
      panel.style.top = state.panelTop + "px";
      panel.style.right = "auto"; panel.style.bottom = "auto";
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
    onSavePos: (x, y) => {
      state.btnLeft = x; state.btnTop = y;
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

  async function saveCompanyIds(ids) {
    const { status, json } = await reqJSON("/api/user/companies", "POST", { company_ids: ids }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || `Save failed (${status})`);
    return json;
  }

  // HoF Search
  async function hofSearch(filters) {
    const { status, json } = await reqJSON("/api/search/hof", "POST", filters, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "HoF failed");
    return json;
  }

  // Recruit
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

  // Trains
  async function trainsAdd(company_id, buyer_name, trains_bought, note) {
    const { status, json } = await reqJSON("/api/trains/add", "POST", { company_id, buyer_name, trains_bought, note }, tokenHeaders());
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
    const { status, json } = await reqJSON("/api/contracts/add", "POST", { company_id, title, employee_id, employee_name, expires_at, note }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Add contract failed");
    return json;
  }
  async function contractsDelete(id) {
    const { status, json } = await reqJSON("/api/contracts/delete", "POST", { id }, tokenHeaders());
    if (status >= 400 || !json || json.ok !== true) throw new Error(json?.error || "Delete failed");
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

  // ---------------- Views ----------------
  function viewHub() {
    const wrap = document.createElement("div");
    const d = state.data;

    if (!d) {
      const c = document.createElement("div");
      c.className = "card";
      c.innerHTML = `<div style="font-weight:1000;">Hub</div><div class="muted">Login in <b>Settings</b>, then tap Refresh.</div>`;
      wrap.appendChild(c);
      return wrap;
    }

    const top = document.createElement("div");
    top.className = "card";
    top.innerHTML = `
      <div style="font-weight:1000;">${escapeHtml(d.service || "Company Hub")}</div>
      <div class="muted">User: ${escapeHtml(d.user?.name || "")} [${escapeHtml(d.user?.user_id || "")}]</div>
      <div class="muted">Updated: ${escapeHtml(d.updated_at || "")}</div>
    `;
    wrap.appendChild(top);

    const cids = Array.isArray(d.company_ids) ? d.company_ids : [];
    const sel = document.createElement("select");
    sel.innerHTML = `<option value="">Select company…</option>` + cids.map(cid => {
      const selected = String(cid) === String(d.selected_company_id) ? "selected" : "";
      const label = (d.company && String(d.company.id) === String(cid))
        ? `${d.company.name || "Company"} (${cid})`
        : `Company ${cid}`;
      return `<option value="${escapeHtml(cid)}" ${selected}>${escapeHtml(label)}</option>`;
    }).join("");
    sel.onchange = async () => {
      state.selected_company_id = sel.value;
      await refresh(true);
    };
    wrap.appendChild(sel);

    const comp = d.company;
    const stats = d.stats || {};
    const c2 = document.createElement("div");
    c2.className = "card";
    c2.innerHTML = `
      <div class="row" style="align-items:flex-start;">
        <div>
          <div style="font-weight:1000;">Company Overview</div>
          <div class="muted">Name: ${escapeHtml(fmt(comp?.name))}</div>
          <div class="muted">Rating: ${escapeHtml(fmt(comp?.rating))}</div>
        </div>
        <div style="text-align:right;">
          <div class="pill">Employees: ${escapeHtml(fmt(stats.employee_count))}</div><br>
          <div class="pill" style="margin-top:6px;">Inactive 3d+: ${escapeHtml(fmt(stats.inactive_3d_plus))}</div>
        </div>
      </div>
      ${d.company_error ? `<div class="muted" style="margin-top:10px;color:#ffb3b3;">Error: ${escapeHtml(String(d.company_error))}</div>` : ""}
    `;
    wrap.appendChild(c2);

    const emps = Array.isArray(d.employees) ? d.employees : [];
    const c3 = document.createElement("div");
    c3.className = "card";
    c3.innerHTML = `<div style="font-weight:1000;">Employees</div><div class="muted">Tap an employee to open profile.</div>`;
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
        const total = (Number(e.man || 0) + Number(e.int || 0) + Number(e.end || 0)) || 0;
        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";
        item.innerHTML = `
          <div class="row">
            <button class="btn" data-open style="flex:1;text-align:left;">
              ${escapeHtml(e.name || "Employee")} [${escapeHtml(e.id || "")}]
            </button>
            <div style="text-align:right;min-width:120px;">
              <div class="pill">Total: ${escapeHtml(String(total))}</div><br>
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
    c.innerHTML = `<div style="font-weight:1000;">Trains</div><div class="muted">Add purchases, track used, delete records.</div>`;
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
    add.innerHTML = `<div style="font-weight:1000;">Add Train Purchase</div>`;

    const buyer = document.createElement("input"); buyer.placeholder = "Buyer name (required)";
    const qty = document.createElement("input"); qty.type = "number"; qty.placeholder = "Trains bought (required)";
    const note = document.createElement("input"); note.placeholder = "Note (optional)";

    const btnAdd = document.createElement("button");
    btnAdd.className = "btn";
    btnAdd.textContent = "Add";

    add.appendChild(buyer);
    add.appendChild(document.createElement("div")).style.height = "8px";
    add.appendChild(qty);
    add.appendChild(document.createElement("div")).style.height = "8px";
    add.appendChild(note);
    add.appendChild(document.createElement("div")).style.height = "10px";
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
        buyer.value = ""; qty.value = ""; note.value = "";
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
    listCard.innerHTML = `<div style="font-weight:1000;">Records</div><div class="muted">Company #${escapeHtml(d.selected_company_id)}</div>`;
    const list = document.createElement("div");
    list.className = "list";
    listCard.appendChild(list);

    if (!rows.length) {
      list.innerHTML = `<div class="muted">—</div>`;
    } else {
      rows.forEach(r => {
        const id = r.id ?? r.train_id ?? r.rowid ?? 0;
        const bought = Number(r.trains_bought ?? r.bought ?? 0);
        const used = Number(r.trains_used ?? r.used ?? 0);

        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";
        item.innerHTML = `
          <div class="row">
            <div style="flex:2;min-width:0;">
              <div style="font-weight:1000;">${escapeHtml(fmt(r.buyer_name || r.buyer))}</div>
              <div class="muted">${escapeHtml(fmt(r.created_at))}${r.note ? " • " + escapeHtml(String(r.note)) : ""}</div>
              <div class="muted">Bought: ${escapeHtml(String(bought))} • Used: ${escapeHtml(String(used))}</div>
            </div>
            <button class="btn danger" data-del style="flex:0 0 auto;">Delete</button>
          </div>

          <div class="row" style="margin-top:10px;">
            <input data-used type="number" placeholder="Set used…" value="${escapeHtml(String(used))}">
            <button class="btn" data-set>Save Used</button>
          </div>
        `;

        item.querySelector("[data-del]")?.addEventListener("click", async () => {
          try { await trainsDelete(Number(id)); toastMsg("Deleted"); await refresh(true); }
          catch (e) { toastMsg(e.message || "Delete failed"); }
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
    c.innerHTML = `<div style="font-weight:1000;">Contracts</div><div class="muted">Add contracts per company and delete when done.</div>`;
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
    add.innerHTML = `<div style="font-weight:1000;">Add Contract</div>`;

    const title = document.createElement("input"); title.placeholder = "Title (required)";
    const empId = document.createElement("input"); empId.placeholder = "Employee id (optional)";
    const empName = document.createElement("input"); empName.placeholder = "Employee name (optional)";
    const exp = document.createElement("input"); exp.placeholder = "Expires at (text) e.g. 2026-04-01";
    const note = document.createElement("input"); note.placeholder = "Note (optional)";

    const btnAdd = document.createElement("button");
    btnAdd.className = "btn";
    btnAdd.textContent = "Add";

    [title, empId, empName, exp, note].forEach((x, i) => {
      if (i) add.appendChild(document.createElement("div")).style.height = "8px";
      add.appendChild(x);
    });
    add.appendChild(document.createElement("div")).style.height = "10px";
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
    listCard.innerHTML = `<div style="font-weight:1000;">Records</div><div class="muted">Company #${escapeHtml(d.selected_company_id)}</div>`;
    const list = document.createElement("div");
    list.className = "list";
    listCard.appendChild(list);

    if (!rows.length) {
      list.innerHTML = `<div class="muted">—</div>`;
    } else {
      rows.forEach(r => {
        const id = r.id ?? r.contract_id ?? 0;
        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";
        item.innerHTML = `
          <div class="row">
            <div style="flex:2;min-width:0;">
              <div style="font-weight:1000;">${escapeHtml(fmt(r.title))}</div>
              <div class="muted">${escapeHtml(fmt(r.employee_name))}${r.employee_id ? " ["+escapeHtml(String(r.employee_id))+"]" : ""}</div>
              <div class="muted">Expires: ${escapeHtml(fmt(r.expires_at))}</div>
              <div class="muted">${escapeHtml(fmt(r.note))}</div>
            </div>
            <button class="btn danger" data-del style="flex:0 0 auto;">Delete</button>
          </div>
        `;
        item.querySelector("[data-del]")?.addEventListener("click", async () => {
          try { await contractsDelete(Number(id)); toastMsg("Deleted"); await refresh(true); }
          catch (e) { toastMsg(e.message || "Delete failed"); }
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
      <div style="font-weight:1000;">Recruit Leads</div>
      <div class="muted">Scans HoF and stores leads beating your weakest employee total.</div>
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
      <div style="font-weight:1000;">Actions</div>
      <div class="row" style="margin-top:10px;">
        <button class="btn" data-scan>Scan This Company</button>
        <button class="btn" data-load>Load Leads</button>
      </div>
      <div class="row" style="margin-top:10px;">
        <button class="btn" data-seen>Mark Seen</button>
        <button class="btn danger" data-clear>Clear Leads</button>
      </div>
      <div class="muted" style="margin-top:10px;" id="rec-msg">—</div>
    `;
    wrap.appendChild(actions);

    const msg = qs("#rec-msg", actions);

    const listCard = document.createElement("div");
    listCard.className = "card";
    listCard.innerHTML = `<div style="font-weight:1000;">Leads</div><div class="muted">Company #${escapeHtml(d.selected_company_id)}</div>`;
    const list = document.createElement("div");
    list.className = "list";
    listCard.appendChild(list);
    wrap.appendChild(listCard);

    async function loadLeads(showToast) {
      list.innerHTML = `<div class="muted">Loading…</div>`;
      try {
        const res = await recruitLeads(d.selected_company_id);
        const rows = Array.isArray(res.rows) ? res.rows : [];
        list.innerHTML = rows.length ? "" : `<div class="muted">—</div>`;
        rows.forEach(r => {
          const item = document.createElement("div");
          item.className = "card";
          item.style.marginBottom = "0";
          const pid = r.player_id || r.id;
          item.innerHTML = `
            <div class="row">
              <button class="btn" data-open style="flex:1;text-align:left;">
                ${escapeHtml(fmt(r.name))} [${escapeHtml(fmt(pid))}]
              </button>
              <div style="text-align:right;min-width:120px;">
                <div class="pill">+${escapeHtml(fmt(r.delta_vs_floor))}</div><br>
                <div class="muted" style="margin-top:6px;">Total: ${escapeHtml(fmt(r.total))}</div>
              </div>
            </div>
            <div class="muted" style="margin-top:8px;">
              MAN ${escapeHtml(fmt(r.man))} • INT ${escapeHtml(fmt(r.intel || r.int))} • END ${escapeHtml(fmt(r.endu || r.end))}
            </div>
          `;
          item.querySelector("[data-open]")?.addEventListener("click", () => {
            if (!pid) return;
            window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(pid)}`, "_blank");
          });
          list.appendChild(item);
        });
        if (showToast) toastMsg("Loaded");
      } catch (e) {
        list.innerHTML = `<div class="muted">${escapeHtml(e.message || "Load failed")}</div>`;
        if (showToast) toastMsg("Load failed");
      }
    }

    qs("[data-scan]", actions).onclick = async () => {
      try {
        msg.textContent = "Scanning…";
        await recruitScan(d.selected_company_id);
        msg.textContent = "Scan complete.";
        toastMsg("Scan done");
        await loadLeads(false);
        await refresh(true);
      } catch (e) {
        msg.textContent = e.message || "Scan failed";
        toastMsg("Scan failed");
      }
    };

    qs("[data-load]", actions).onclick = async () => { await loadLeads(true); };

    qs("[data-seen]", actions).onclick = async () => {
      try { await recruitSeen(d.selected_company_id); toastMsg("Marked seen"); await refresh(true); }
      catch (e) { toastMsg(e.message || "Seen failed"); }
    };

    qs("[data-clear]", actions).onclick = async () => {
      try { await recruitClear(d.selected_company_id); toastMsg("Cleared"); await loadLeads(false); await refresh(true); }
      catch (e) { toastMsg(e.message || "Clear failed"); }
    };

    const cached = Array.isArray(d.recruit_leads) ? d.recruit_leads : [];
    if (cached.length) {
      list.innerHTML = "";
      cached.forEach(r => {
        const pid = r.player_id || r.id;
        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";
        item.innerHTML = `
          <div class="row">
            <button class="btn" data-open style="flex:1;text-align:left;">
              ${escapeHtml(fmt(r.name))} [${escapeHtml(fmt(pid))}]
            </button>
            <div style="text-align:right;min-width:120px;">
              <div class="pill">+${escapeHtml(fmt(r.delta_vs_floor))}</div><br>
              <div class="muted" style="margin-top:6px;">Total: ${escapeHtml(fmt(r.total))}</div>
            </div>
          </div>
        `;
        item.querySelector("[data-open]")?.addEventListener("click", () => {
          if (!pid) return;
          window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(pid)}`, "_blank");
        });
        list.appendChild(item);
      });
    } else {
      list.innerHTML = `<div class="muted">Tap “Load Leads”</div>`;
    }

    return wrap;
  }

  // ✅ CHANGED: HoF view = TOTAL ONLY
  function viewHof() {
    const wrap = document.createElement("div");

    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div style="font-weight:1000;">HoF Workstats Search</div>
      <div class="muted">TOTAL-only filter (MAN+INT+END). Server ignores per-stat filters.</div>
    `;
    wrap.appendChild(c);

    const minTotal = document.createElement("input"); minTotal.type="number"; minTotal.placeholder="Min TOTAL (e.g. 50,000)";
    const maxTotal = document.createElement("input"); maxTotal.type="number"; maxTotal.placeholder="Max TOTAL (leave blank = huge)";

    const go = document.createElement("button");
    go.className = "btn";
    go.textContent = "Search";

    const meta = document.createElement("div");
    meta.className = "muted";
    meta.style.marginTop = "10px";
    meta.textContent = "—";

    const grid = document.createElement("div"); grid.className="row"; grid.append(minTotal, maxTotal);

    c.appendChild(document.createElement("div")).style.height="10px";
    c.appendChild(grid);
    c.appendChild(document.createElement("div")).style.height="10px";
    c.appendChild(go);
    c.appendChild(meta);

    const listCard = document.createElement("div");
    listCard.className = "card";
    listCard.innerHTML = `<div style="font-weight:1000;">Results</div>`;
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
            <div style="text-align:right;min-width:120px;">
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

    go.onclick = async () => {
      if (!state.token) return toastMsg("Login first");
      try {
        go.disabled = true;
        meta.textContent = "Searching…";

        const min_total = Number(minTotal.value || 0);
        const max_total = maxTotal.value === "" ? (10 ** 12) : Number(maxTotal.value || (10 ** 12));

        const filters = { min_total, max_total }; // ✅ server expects these now

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
        go.disabled = false;
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
    c.innerHTML = `<div style="font-weight:1000;">Notifications</div><div class="muted">Recent system + hub alerts.</div>`;
    wrap.appendChild(c);

    const actions = document.createElement("div");
    actions.className = "card";
    actions.innerHTML = `
      <div class="row">
        <button class="btn" data-seen>Mark Seen</button>
        <button class="btn" data-refresh>Refresh</button>
      </div>
    `;
    wrap.appendChild(actions);

    qs("[data-seen]", actions).onclick = async () => {
      try { await notifsSeen(); toastMsg("Seen"); await refresh(true); }
      catch (e) { toastMsg(e.message || "Failed"); }
    };
    qs("[data-refresh]", actions).onclick = async () => { await refresh(false); };

    const listCard = document.createElement("div");
    listCard.className = "card";
    listCard.innerHTML = `<div style="font-weight:1000;">Recent</div>`;
    const list = document.createElement("div");
    list.className = "list";
    listCard.appendChild(list);
    wrap.appendChild(listCard);

    const rows = Array.isArray(d?.notifications) ? d.notifications : [];
    if (!rows.length) {
      list.innerHTML = `<div class="muted">—</div>`;
      return wrap;
    }

    rows.forEach(n => {
      const seen = Number(n.seen || 0) === 1;
      const item = document.createElement("div");
      item.className = "card";
      item.style.marginBottom = "0";
      item.innerHTML = `
        <div style="font-weight:1000;">
          ${escapeHtml(fmt(n.kind || n.type || "system"))}
          ${seen ? `<span class="pill" style="opacity:.65;margin-left:6px;">seen</span>` : `<span class="pill" style="margin-left:6px;">new</span>`}
        </div>
        <div class="muted" style="margin-top:8px;">${escapeHtml(fmt(n.message || n.msg || ""))}</div>
        <div class="muted" style="margin-top:8px;">${escapeHtml(fmt(n.created_at || ""))}</div>
      `;
      list.appendChild(item);
    });

    return wrap;
  }

  function viewSettings() {
    const wrap = document.createElement("div");

    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = `
      <div style="font-weight:1000;">Settings / Login</div>
      <div class="muted">Server: ${escapeHtml(BASE_URL)}</div>
      <div class="muted">If you see “Bad JSON”, the preview is your server’s actual response (502/HTML/error).</div>
    `;
    wrap.appendChild(c);

    const admin = document.createElement("input");
    admin.placeholder = "Admin key (provided by you)";
    admin.value = state.admin_key || "";

    const api = document.createElement("input");
    api.placeholder = "User Torn API key";
    api.value = state.api_key || "";

    const row = document.createElement("div");
    row.className = "row";

    const login = document.createElement("button");
    login.className = "btn";
    login.textContent = "Login";

    const logout = document.createElement("button");
    logout.className = "btn danger";
    logout.textContent = "Logout";

    row.appendChild(login);
    row.appendChild(logout);

    const health = document.createElement("button");
    health.className = "btn";
    health.textContent = "Test /health";

    const status = document.createElement("div");
    status.className = "muted";
    status.style.marginTop = "10px";
    status.textContent = state.token ? "Session: saved" : "Session: none";

    c.appendChild(document.createElement("div")).style.height = "10px";
    c.appendChild(admin);
    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(api);
    c.appendChild(document.createElement("div")).style.height = "10px";
    c.appendChild(row);
    c.appendChild(document.createElement("div")).style.height = "8px";
    c.appendChild(health);
    c.appendChild(status);

    health.onclick = async () => {
      try {
        const { status: st, raw } = await reqJSON("/health", "GET");
        const prev = String(raw || "").replace(/\s+/g, " ").slice(0, 160);
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

    const c2 = document.createElement("div");
    c2.className = "card";
    c2.innerHTML = `
      <div style="font-weight:1000;">My Company IDs</div>
      <div class="muted">Comma separated (example): 123,456</div>
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
    note.style.marginTop = "10px";
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

    const service = state.data?.service || "7DS*: Peace Company Hub";
    const userName = state.data?.user?.name ? `• ${state.data.user.name}` : "";
    const last = state.last || "—";

    panel.innerHTML = `
      <div class="head" id="peacehub-head">
        <div>
          <div class="title">${escapeHtml(service)}</div>
          <div class="sub">Last: ${escapeHtml(last)} ${escapeHtml(userName)}</div>
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
        <div class="tab ${state.tab === "hof" ? "active" : ""}" data-tab="hof">HoF</div>
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

    const head = qs("#peacehub-head", panel);
    makeDraggableTap(head, {
      onTap: null,
      onSavePos: (x, y) => {
        panel.style.left = x + "px";
        panel.style.top = y + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        state.panelLeft = x; state.panelTop = y;
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

})();
