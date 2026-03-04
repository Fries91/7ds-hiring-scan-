// ==UserScript==
// @name         7DS Hiring Hub 💼 (Stable v5 - No Duplicates + Draggable + Tabs Fix)
// @namespace    fries-7ds-hiring-hub
// @version      5.0.0
// @description  Hiring Hub overlay for Torn. Tabs: Trains, Applications, Search (HoF workstats), Settings. Briefcase toggles open/close. No duplicates.
// @author       Fries91
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

  // -------- HARD GUARD: prevents duplicates even if injected twice ----------
  if (window.__H7DS_HIRING_HUB_RUNNING__) return;
  window.__H7DS_HIRING_HUB_RUNNING__ = true;

  const BTN_ID = "h7ds-briefcase";
  const PANEL_ID = "h7ds-panel";
  const TOAST_ID = "h7ds-toast";

  // If an old/broken version left nodes behind, remove them
  try {
    document.getElementById(BTN_ID)?.remove();
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(TOAST_ID)?.remove();
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
    del(k) {
      try { GM_deleteValue(k); } catch {}
    }
  };

  // ---------------- Helpers ----------------
  const qs = (sel, root = document) => root.querySelector(sel);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function nowNice() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

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

  // Adds ?admin= token if set (your backend style)
  function withAdmin(url, adminToken) {
    const tok = (adminToken || "").trim();
    if (!tok) return url;
    return url.includes("?")
      ? `${url}&admin=${encodeURIComponent(tok)}`
      : `${url}?admin=${encodeURIComponent(tok)}`;
  }

  // ---------------- UI State ----------------
  const state = {
    tab: S.get("h7ds_tab", "trains") || "trains",
    last: null,

    adminToken: S.get("h7ds_hiring_admin", "") || "",

    companiesUpdated: null,
    companies: [],
    selectedCompanyId: S.get("h7ds_sel_company", "") || "",
    selectedEmployeeId: S.get("h7ds_sel_employee", "") || "",

    trains: [],
    apps: [],

    searchMin: S.get("h7ds_search_min", 0) || 0,
    searchMax: S.get("h7ds_search_max", 0) || 0,
    searchRows: [],
    searchMeta: S.get("h7ds_search_meta", null),

    timer: null,

    // positions
    btnLeft: S.get("h7ds_btn_left", null),
    btnTop: S.get("h7ds_btn_top", null),
    panelLeft: S.get("h7ds_panel_left", null),
    panelTop: S.get("h7ds_panel_top", null),
  };

  // ---------------- Styles ----------------
  GM_addStyle(`
    #${BTN_ID}{
      position: fixed;
      z-index: 2147483647;
      width: 48px;
      height: 48px;
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
    #${BTN_ID} span{
      font-size: 22px;
      line-height: 1;
    }

    #${TOAST_ID}{
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

    #${PANEL_ID}{
      position: fixed;
      z-index: 2147483646;
      width: 372px;
      max-width: 94vw;
      height: 580px;
      max-height: 84vh;
      border-radius: 16px;
      background: rgba(12,12,18,.92);
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: 0 18px 46px rgba(0,0,0,.55);
      overflow: hidden;
      display:none;
      backdrop-filter: blur(10px);
    }

    #${PANEL_ID} .h-head{
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
    #${PANEL_ID} .h-title{ font-weight: 900; font-size: 13px; }
    #${PANEL_ID} .h-sub{ opacity:.85; font-weight: 800; font-size: 11px; }

    #${PANEL_ID} .h-btn{
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
    #${PANEL_ID} .h-btn:active{ transform: scale(.98); }

    #${PANEL_ID} .h-tabs{
      display:flex;
      gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    #${PANEL_ID} .h-tab{
      flex:1;
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
    }
    #${PANEL_ID} .h-tab.active{
      background: rgba(0,0,0,.28);
      border-color: rgba(255,255,255,.18);
    }

    #${PANEL_ID} .h-body{
      height: calc(100% - 44px - 48px);
      overflow: auto;
      padding: 10px;
      color: #fff;
    }

    #${PANEL_ID} .card{
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 14px;
      padding: 10px;
      margin-bottom: 10px;
    }
    #${PANEL_ID} .muted{ opacity:.80; font-weight: 700; font-size: 12px; }
    #${PANEL_ID} input, #${PANEL_ID} select{
      width: 100%;
      background: rgba(0,0,0,.22);
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 12px;
      padding: 10px;
      color:#fff;
      font-weight: 900;
      outline: none;
    }
    #${PANEL_ID} .row{
      display:flex;
      gap: 8px;
      align-items:center;
      justify-content: space-between;
    }
    #${PANEL_ID} .list{
      display:grid;
      gap: 8px;
      margin-top: 10px;
    }
  `);

  // ---------------- Toast ----------------
  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  document.documentElement.appendChild(toast);

  function toastMsg(msg) {
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(toastMsg._t);
    toastMsg._t = setTimeout(() => (toast.style.display = "none"), 1600);
  }

  // ---------------- Button + Panel ----------------
  const btn = document.createElement("div");
  btn.id = BTN_ID;
  btn.innerHTML = `<span>💼</span>`;
  document.documentElement.appendChild(btn);

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  document.documentElement.appendChild(panel);

  // Initial positions (mobile friendly)
  function setInitialPositions() {
    if (state.btnLeft != null && state.btnTop != null) {
      btn.style.left = state.btnLeft + "px";
      btn.style.top = state.btnTop + "px";
    } else {
      btn.style.right = "14px";
      btn.style.top = "155px";
    }

    if (state.panelLeft != null && state.panelTop != null) {
      panel.style.left = state.panelLeft + "px";
      panel.style.top = state.panelTop + "px";
    } else {
      panel.style.right = "14px";
      panel.style.top = "220px";
    }
  }
  setInitialPositions();

  // ---------------- Drag helpers (tap vs drag) ----------------
  function makeDraggableTap(node, opts) {
    const {
      onTap,
      onSavePos,
      allowDrag = true,
      dragThreshold = 7
    } = opts;

    let down = false;
    let moved = false;
    let sx = 0, sy = 0, ox = 0, oy = 0;

    node.addEventListener("pointerdown", (e) => {
      down = true;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;

      const r = node.getBoundingClientRect();
      ox = r.left;
      oy = r.top;

      node.setPointerCapture?.(e.pointerId);

      // convert to left/top positioning
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

  // Badge: tap toggles open/close. Drag saves position.
  makeDraggableTap(btn, {
    onTap: () => toggle(),
    onSavePos: (x, y) => {
      state.btnLeft = x; state.btnTop = y;
      S.set("h7ds_btn_left", x);
      S.set("h7ds_btn_top", y);
    },
    allowDrag: true
  });

  // Panel: drag ONLY from header (so tabs/buttons always clickable)
  // We'll attach draggable after render builds header.

  // ---------------- Data loaders ----------------
  async function loadCompanies() {
    const res = await reqJSON(withAdmin(`${BASE_URL}/api/companies`, state.adminToken), "GET");
    if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
    state.companiesUpdated = res.updated_at || null;
    state.companies = res.rows || [];

    // keep selection valid
    if (state.selectedCompanyId && !state.companies.some(c => String(c.company_id) === String(state.selectedCompanyId))) {
      state.selectedCompanyId = "";
      S.set("h7ds_sel_company", "");
    }
  }

  async function loadTrainsForSelected() {
    state.trains = [];
    if (!state.selectedCompanyId) return;

    const res = await reqJSON(
      withAdmin(`${BASE_URL}/api/trains?company_id=${encodeURIComponent(state.selectedCompanyId)}`, state.adminToken),
      "GET"
    );
    if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
    state.trains = res.rows || [];
  }

  async function addTrain(companyId, employeeId, buyer, amount, note) {
    const res = await reqJSON(
      withAdmin(`${BASE_URL}/api/trains/add`, state.adminToken),
      "POST",
      {
        company_id: String(companyId || ""),
        employee_id: String(employeeId || ""),
        buyer: String(buyer || ""),
        amount: Number(amount || 0),
        note: String(note || "")
      }
    );
    if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
    return res;
  }

  async function loadApps() {
    const res = await reqJSON(withAdmin(`${BASE_URL}/api/applications`, state.adminToken), "GET");
    if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
    state.apps = res.rows || [];
  }

  async function setAppStatus(id, status) {
    const res = await reqJSON(withAdmin(`${BASE_URL}/api/applications/status`, state.adminToken), "POST", {
      id,
      status
    });
    if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
    return res;
  }

  async function searchWorkstats(min, max) {
    const url = withAdmin(
      `${BASE_URL}/api/search_workstats?min=${encodeURIComponent(min)}&max=${encodeURIComponent(max)}`,
      state.adminToken
    );
    const res = await reqJSON(url, "GET");
    if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
    state.searchRows = res.rows || [];
    state.searchMeta = res.meta || `Found: ${state.searchRows.length}`;
    S.set("h7ds_search_meta", state.searchMeta);
  }

  // ---------------- Polling ----------------
  function startPolling() {
    stopPolling();
    refreshNow(false);
    state.timer = setInterval(() => {
      if (panel.style.display === "block") {
        if (state.tab === "apps" || state.tab === "trains") refreshNow(false);
      }
    }, POLL_MS);
  }

  function stopPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  async function refreshNow(showFailToast) {
    try {
      if (state.tab === "trains") {
        await loadCompanies();
        if (state.selectedCompanyId) await loadTrainsForSelected();
      } else if (state.tab === "apps") {
        await loadApps();
      }
      state.last = nowNice();
      const lastEl = qs("#h-last", panel);
      if (lastEl) lastEl.textContent = state.last;
      render();
    } catch (e) {
      if (showFailToast) toastMsg("Fetch failed (token/service?)");
    }
  }

  // ---------------- Views ----------------
  function viewTrains() {
    const wrap = document.createElement("div");

    const top = document.createElement("div");
    top.className = "card";
    top.innerHTML = `
      <div style="font-weight:900;">Trains</div>
      <div class="muted">Companies → Employees → Add trains + buyer</div>
      <div class="muted">${state.companiesUpdated ? `Updated: ${escapeHtml(state.companiesUpdated)}` : ""}</div>
    `;
    wrap.appendChild(top);

    const companySel = document.createElement("select");
    companySel.innerHTML = `<option value="">Select company…</option>` +
      state.companies.map(c => {
        const cid = String(c.company_id ?? "");
        const name = String(c.company_name ?? `Company ${cid}`);
        const selected = String(state.selectedCompanyId) === cid ? "selected" : "";
        return `<option value="${escapeHtml(cid)}" ${selected}>${escapeHtml(name)} (${escapeHtml(cid)})</option>`;
      }).join("");
    wrap.appendChild(companySel);

    const employeeSel = document.createElement("select");
    employeeSel.style.marginTop = "8px";
    employeeSel.innerHTML = `<option value="">Select employee…</option>`;
    wrap.appendChild(employeeSel);

    const info = document.createElement("div");
    info.className = "muted";
    info.style.marginTop = "8px";
    wrap.appendChild(info);

    function fillEmployees() {
      employeeSel.innerHTML = `<option value="">Select employee…</option>`;
      const company = state.companies.find(c => String(c.company_id) === String(state.selectedCompanyId));
      const emps = company?.employees || company?.members || [];
      // Accept multiple possible shapes
      (Array.isArray(emps) ? emps : []).forEach(e => {
        const id = String(e.id ?? e.user_id ?? e.torn_id ?? "");
        const name = String(e.name ?? e.username ?? "Unknown");
        const selected = String(state.selectedEmployeeId) === id ? "selected" : "";
        employeeSel.innerHTML += `<option value="${escapeHtml(id)}" ${selected}>${escapeHtml(name)} [${escapeHtml(id)}]</option>`;
      });
      info.textContent = company ? `Employees: ${(Array.isArray(emps) ? emps.length : 0)}` : "—";
    }

    companySel.onchange = async () => {
      state.selectedCompanyId = companySel.value;
      S.set("h7ds_sel_company", state.selectedCompanyId);
      state.selectedEmployeeId = "";
      S.set("h7ds_sel_employee", "");
      fillEmployees();
      try {
        await loadTrainsForSelected();
        render();
      } catch {
        toastMsg("Could not load trains");
      }
    };

    employeeSel.onchange = () => {
      state.selectedEmployeeId = employeeSel.value;
      S.set("h7ds_sel_employee", state.selectedEmployeeId);
    };

    // Add Train Card
    const addCard = document.createElement("div");
    addCard.className = "card";
    addCard.innerHTML = `
      <div style="font-weight:900;">Add Train</div>
      <div class="muted">Saved to server per company</div>
    `;
    wrap.appendChild(addCard);

    const buyer = document.createElement("input");
    buyer.placeholder = "Buyer (name or id)";
    buyer.style.marginTop = "8px";

    const amount = document.createElement("input");
    amount.type = "number";
    amount.placeholder = "Amount of trains";
    amount.style.marginTop = "8px";

    const note = document.createElement("input");
    note.placeholder = "Note (optional)";
    note.style.marginTop = "8px";

    const addBtn = document.createElement("button");
    addBtn.className = "h-btn";
    addBtn.textContent = "Add";
    addBtn.style.marginTop = "10px";

    addCard.appendChild(buyer);
    addCard.appendChild(amount);
    addCard.appendChild(note);
    addCard.appendChild(addBtn);

    addBtn.onclick = async () => {
      if (!state.selectedCompanyId) return toastMsg("Pick a company first");
      if (!state.selectedEmployeeId) return toastMsg("Pick an employee");
      if (!buyer.value.trim()) return toastMsg("Buyer required");
      const n = Number(amount.value || 0);
      if (!n || n < 1) return toastMsg("Amount must be 1+");

      addBtn.disabled = true;
      try {
        await addTrain(state.selectedCompanyId, state.selectedEmployeeId, buyer.value.trim(), n, note.value.trim());
        toastMsg("Added");
        buyer.value = "";
        amount.value = "";
        note.value = "";
        await loadTrainsForSelected();
        render();
      } catch {
        toastMsg("Add failed");
      } finally {
        addBtn.disabled = false;
      }
    };

    // Train list
    const listCard = document.createElement("div");
    listCard.className = "card";
    listCard.innerHTML = `<div style="font-weight:900;">Train Records</div><div class="muted">${state.selectedCompanyId ? "Showing selected company" : "Select a company"}</div>`;
    wrap.appendChild(listCard);

    const list = document.createElement("div");
    list.className = "list";
    listCard.appendChild(list);

    if (!state.trains.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "—";
      list.appendChild(empty);
    } else {
      state.trains.forEach(r => {
        const item = document.createElement("div");
        item.className = "card";
        item.style.marginBottom = "0";
        item.innerHTML = `
          <div class="row">
            <div style="min-width:0;">
              <div style="font-weight:900;">${escapeHtml(String(r.employee_name ?? r.employee_id ?? "Employee"))}</div>
              <div class="muted">Buyer: ${escapeHtml(String(r.buyer ?? ""))} • Trains: ${escapeHtml(String(r.amount ?? ""))}</div>
              <div class="muted">${escapeHtml(String(r.created_at ?? ""))}${r.note ? " • " + escapeHtml(String(r.note)) : ""}</div>
            </div>
          </div>
        `;
        list.appendChild(item);
      });
    }

    // ensure employee dropdown filled
    fillEmployees();
    return wrap;
  }

  function viewApps() {
    const wrap = document.createElement("div");

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="font-weight:900;">Applications</div>
      <div class="muted">Pulled from /api/applications</div>
    `;
    wrap.appendChild(card);

    const list = document.createElement("div");
    list.className = "list";
    wrap.appendChild(list);

    if (!state.apps.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No applications yet.";
      list.appendChild(empty);
      return wrap;
    }

    state.apps.forEach(row => {
      const applicantId = row.applicant_id || row.player_id || row.id || "";
      const created = row.created_at || "";
      const status = row.status || "new";
      const raw = row.raw_text || row.text || "";

      const c = document.createElement("div");
      c.className = "card";
      c.innerHTML = `
        <div class="row">
          <div style="min-width:0;">
            <div style="font-weight:900;">${applicantId ? `Applicant [${escapeHtml(applicantId)}]` : "Applicant [unknown]"}</div>
            <div class="muted">${escapeHtml(created)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <select class="h-sel" style="width:auto;min-width:130px;"></select>
          </div>
        </div>
        <div class="muted" style="margin-top:8px;word-break:break-word;"></div>
      `;
      c.querySelector(".muted").textContent = raw;

      const sel = c.querySelector("select");
      ["new", "seen", "interview", "hired", "rejected"].forEach(s => {
        const o = document.createElement("option");
        o.value = s;
        o.textContent = s.toUpperCase();
        if (s === status) o.selected = true;
        sel.appendChild(o);
      });

      sel.onchange = async () => {
        try {
          await setAppStatus(row.id, sel.value);
          toastMsg("Updated");
        } catch {
          toastMsg("Update failed");
        }
      };

      list.appendChild(c);
    });

    return wrap;
  }

  function viewSearch() {
    const wrap = document.createElement("div");

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="font-weight:900;">Search HoF (Workstats)</div>
      <div class="muted">Uses: /api/search_workstats?min=X&max=Y</div>
    `;
    wrap.appendChild(card);

    const minInp = document.createElement("input");
    minInp.type = "number";
    minInp.placeholder = "Min value (X)";
    minInp.value = String(state.searchMin || "");
    minInp.style.marginTop = "8px";

    const maxInp = document.createElement("input");
    maxInp.type = "number";
    maxInp.placeholder = "Max value (Y)";
    maxInp.value = String(state.searchMax || "");
    maxInp.style.marginTop = "8px";

    const go = document.createElement("button");
    go.className = "h-btn";
    go.textContent = "Search";
    go.style.marginTop = "10px";

    const meta = document.createElement("div");
    meta.className = "muted";
    meta.style.marginTop = "10px";
    meta.textContent = state.searchMeta ? state.searchMeta : "—";

    card.appendChild(minInp);
    card.appendChild(maxInp);
    card.appendChild(go);
    card.appendChild(meta);

    const results = document.createElement("div");
    results.className = "list";
    wrap.appendChild(results);

    function renderResults() {
      results.innerHTML = "";
      if (!state.searchRows.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No results yet.";
        results.appendChild(empty);
        return;
      }

      state.searchRows.forEach(r => {
        const id = String(r.torn_id ?? r.id ?? "");
        const name = String(r.name ?? "Unknown");
        const value = r.value != null ? r.value : "";
        const rank = r.rank != null ? r.rank : "";

        const c = document.createElement("div");
        c.className = "card";
        c.innerHTML = `
          <div class="row">
            <div style="min-width:0;">
              <div style="font-weight:900;">${escapeHtml(name)} [${escapeHtml(id)}]</div>
              <div class="muted">Workstats: ${escapeHtml(String(value))}${rank !== "" ? " • Rank: " + escapeHtml(String(rank)) : ""}</div>
            </div>
            <button class="h-btn" data-open="1">Open</button>
          </div>
        `;
        c.querySelector("[data-open]")?.addEventListener("click", () => {
          if (!id) return;
          window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}`, "_blank");
        });
        results.appendChild(c);
      });
    }

    go.onclick = async () => {
      const min = Number(minInp.value || 0);
      const max = Number(maxInp.value || 0);
      if (!min || !max || min < 0 || max < 0) return toastMsg("Enter X and Y");
      if (max < min) return toastMsg("Max must be ≥ Min");

      state.searchMin = min;
      state.searchMax = max;
      S.set("h7ds_search_min", min);
      S.set("h7ds_search_max", max);

      go.disabled = true;
      try {
        await searchWorkstats(min, max);
        meta.textContent = state.searchMeta || `Found: ${state.searchRows.length}`;
        renderResults();
        toastMsg("Done");
      } catch {
        toastMsg("Search failed (token/service?)");
      } finally {
        go.disabled = false;
      }
    };

    renderResults();
    return wrap;
  }

  function viewSettings() {
    const wrap = document.createElement("div");

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="font-weight:900;">Settings</div>
      <div class="muted">Server: ${escapeHtml(BASE_URL)}</div>
      <div class="muted">Paste your ADMIN token here (matches your Render env ADMIN_TOKEN).</div>
      <div style="margin-top:10px;display:grid;gap:8px;">
        <input id="adm" placeholder="Admin token" />
        <button class="h-btn" id="save">Save</button>
        <button class="h-btn" id="test">Test Connection</button>
      </div>
    `;
    wrap.appendChild(card);

    const adm = qs("#adm", card);
    adm.value = state.adminToken || "";

    qs("#save", card).onclick = () => {
      state.adminToken = (adm.value || "").trim();
      S.set("h7ds_hiring_admin", state.adminToken);
      toastMsg("Saved");
    };

    qs("#test", card).onclick = async () => {
      try {
        const res = await reqJSON(withAdmin(`${BASE_URL}/api/companies`, (adm.value || "").trim()), "GET");
        if (!res || res.ok !== true) throw new Error();
        toastMsg("OK");
        state.adminToken = (adm.value || "").trim();
        S.set("h7ds_hiring_admin", state.adminToken);

        state.tab = "trains";
        S.set("h7ds_tab", state.tab);
        await loadCompanies();
        await loadTrainsForSelected();
        render();
      } catch {
        toastMsg("Test failed (token wrong or service down)");
      }
    };

    return wrap;
  }

  // ---------------- Render ----------------
  function render() {
    S.set("h7ds_tab", state.tab);

    panel.innerHTML = `
      <div class="h-head" id="h7ds-head">
        <div>
          <div class="h-title">7DS Hiring Hub</div>
          <div class="h-sub">Last: <span id="h-last">${state.last || "—"}</span></div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="h-btn" id="h-refresh" title="Refresh">↻</button>
          <button class="h-btn" id="h-close" title="Close">✕</button>
        </div>
      </div>

      <div class="h-tabs">
        <div class="h-tab ${state.tab === "trains" ? "active" : ""}" id="tab-trains">Trains</div>
        <div class="h-tab ${state.tab === "apps" ? "active" : ""}" id="tab-apps">Applications</div>
        <div class="h-tab ${state.tab === "search" ? "active" : ""}" id="tab-search">Search</div>
        <div class="h-tab ${state.tab === "settings" ? "active" : ""}" id="tab-settings">Settings</div>
      </div>

      <div class="h-body" id="h-body"></div>
    `;

    qs("#h-close", panel).onclick = () => toggle(false);
    qs("#h-refresh", panel).onclick = () => refreshNow(true);

    qs("#tab-trains", panel).onclick = () => { state.tab = "trains"; render(); };
    qs("#tab-apps", panel).onclick = () => { state.tab = "apps"; render(); };
    qs("#tab-search", panel).onclick = () => { state.tab = "search"; render(); };
    qs("#tab-settings", panel).onclick = () => { state.tab = "settings"; render(); };

    const body = qs("#h-body", panel);
    if (state.tab === "trains") body.appendChild(viewTrains());
    if (state.tab === "apps") body.appendChild(viewApps());
    if (state.tab === "search") body.appendChild(viewSearch());
    if (state.tab === "settings") body.appendChild(viewSettings());

    // Drag panel ONLY from header so it never blocks tab clicks
    const head = qs("#h7ds-head", panel);
    makeDraggableTap(head, {
      onTap: null, // no tap action on header
      onSavePos: (x, y) => {
        // move panel using the panel element (not header)
        panel.style.left = x + "px";
        panel.style.top = y + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";

        state.panelLeft = x; state.panelTop = y;
        S.set("h7ds_panel_left", x);
        S.set("h7ds_panel_top", y);
      },
      allowDrag: true
    });
  }

  // ---------------- Open/Close ----------------
  function toggle(open) {
    const isOpen = panel.style.display === "block";
    const next = open ?? !isOpen;

    panel.style.display = next ? "block" : "none";
    // Keep the briefcase always above
    btn.style.display = "flex";

    if (next) {
      startPolling();
      render();
    } else {
      stopPolling();
    }
  }

  // ---------------- Start ----------------
  // First render so tabs exist even before first fetch
  render();

  // Optional: if you want it open by default, uncomment:
  // toggle(true);

})();
