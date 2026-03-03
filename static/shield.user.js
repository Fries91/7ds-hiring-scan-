// ==UserScript==
// @name         7DS Hiring Hub 💼 (Companies + Employees + Train Tracker)
// @namespace    7ds-wrath-hiring
// @version      2.0.0
// @description  💼 Draggable button + overlay hub. Tabs: Applications + Companies (dropdown -> employees dropdown) + Train Tracker (buyer + trains + note) saved to server. Matches your app.py endpoints: /api/companies, /api/trains, /api/trains/add, /api/applications.
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

  // ---------------- storage ----------------
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
    },
  };

  function qs(sel, root = document) { return root.querySelector(sel); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function nowNice() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

  // ---------------- UI bootstrap ----------------
  document.getElementById(BTN_ID)?.remove();
  document.getElementById(PANEL_ID)?.remove();
  document.getElementById(TOAST_ID)?.remove();

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
    }
    #${PANEL_ID}{
      position:fixed; z-index:2147483646;
      width:372px; max-width:94vw;
      height:560px; max-height:82vh;
      border-radius:16px;
      background:rgba(12,12,18,.92);
      border:1px solid rgba(255,255,255,.12);
      box-shadow:0 18px 46px rgba(0,0,0,.55);
      overflow:hidden;
      display:none;
      backdrop-filter: blur(10px);
      touch-action:none;
    }
    #${PANEL_ID} .h-head{
      height:44px; display:flex; align-items:center; justify-content:space-between;
      padding:0 10px; background:rgba(255,255,255,.06);
      border-bottom:1px solid rgba(255,255,255,.08); color:#fff;
    }
    #${PANEL_ID} .h-title{ font-weight:900; font-size:13px; }
    #${PANEL_ID} .h-sub{ opacity:.85; font-weight:700; font-size:11px; }
    #${PANEL_ID} .h-btn{
      border:1px solid rgba(255,255,255,.14);
      background:rgba(0,0,0,.20);
      color:#fff; border-radius:10px;
      padding:7px 10px; font-weight:900; font-size:12px;
      cursor:pointer; user-select:none;
    }
    #${PANEL_ID} .h-btn:active{ transform:scale(.98); }
    #${PANEL_ID} .h-tabs{
      display:flex; gap:8px; padding:8px 10px;
      border-bottom:1px solid rgba(255,255,255,.08);
    }
    #${PANEL_ID} .h-tab{
      flex:1; text-align:center; padding:8px 10px; border-radius:12px;
      font-weight:900; font-size:12px; cursor:pointer;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(255,255,255,.05); color:#fff;
      user-select:none;
    }
    #${PANEL_ID} .h-tab.active{
      background:rgba(0,0,0,.28);
      border-color:rgba(255,255,255,.18);
    }
    #${PANEL_ID} .h-body{
      height:calc(100% - 44px - 48px);
      overflow:auto; padding:10px; color:#fff;
      font-size:12px; font-weight:700;
    }
    #${PANEL_ID} .card{
      border:1px solid rgba(255,255,255,.10);
      background:rgba(0,0,0,.18);
      border-radius:14px; padding:10px; margin-bottom:10px;
    }
    #${PANEL_ID} .row{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
    #${PANEL_ID} .muted{ opacity:.85; font-size:11px; font-weight:700; margin-top:4px; }
    #${PANEL_ID} .actions{ display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
    #${PANEL_ID} select, #${PANEL_ID} input, #${PANEL_ID} textarea{
      width:100%; padding:8px 10px; border-radius:12px;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(0,0,0,.22); color:#fff; outline:none;
      font-weight:800; font-size:12px;
    }
    #${PANEL_ID} textarea{ min-height:92px; resize:vertical; }
    #${TOAST_ID}{
      position:fixed; z-index:2147483647; left:50%; transform:translateX(-50%);
      bottom:14px; padding:10px 12px; border-radius:14px;
      background:rgba(0,0,0,.78); border:1px solid rgba(255,255,255,.14);
      color:#fff; font-weight:900; font-size:12px; display:none;
      max-width:92vw; text-align:center;
    }
  `);

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

  function toastMsg(msg) {
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(toastMsg._t);
    toastMsg._t = setTimeout(() => (toast.style.display = "none"), 1600);
  }

  // ---------------- state ----------------
  const savedPos = S.get("h7ds_hiring_pos_v3", { btnLeft: null, btnTop: null, panelLeft: null, panelTop: null });

  const state = {
    tab: "companies",
    last: null,
    adminToken: S.get("h7ds_hiring_admin", "") || "",
    apps: [],
    companiesUpdated: null,
    companies: [], // rows from /api/companies
    selectedCompanyId: "",
    selectedEmployeeId: "",
    trains: [],
    timer: null,
  };

  function withAdmin(url) {
    const tok = (state.adminToken || "").trim();
    if (!tok) return url;
    return url.includes("?")
      ? `${url}&admin=${encodeURIComponent(tok)}`
      : `${url}?admin=${encodeURIComponent(tok)}`;
  }

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

  // ---------------- render ----------------
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
        <div class="h-tab ${state.tab === "companies" ? "active" : ""}" id="tab-companies">Companies</div>
        <div class="h-tab ${state.tab === "apps" ? "active" : ""}" id="tab-apps">Applications</div>
        <div class="h-tab ${state.tab === "settings" ? "active" : ""}" id="tab-settings">Settings</div>
      </div>

      <div class="h-body" id="h-body"></div>
    `;

    qs("#h-close", panel).onclick = () => toggle(false);
    qs("#h-refresh", panel).onclick = () => refreshNow(true);

    qs("#tab-companies", panel).onclick = () => { state.tab = "companies"; render(); };
    qs("#tab-apps", panel).onclick = () => { state.tab = "apps"; render(); };
    qs("#tab-settings", panel).onclick = () => { state.tab = "settings"; render(); };

    const body = qs("#h-body", panel);
    if (state.tab === "companies") body.appendChild(viewCompanies());
    if (state.tab === "apps") body.appendChild(viewApps());
    if (state.tab === "settings") body.appendChild(viewSettings());
  }

  function viewSettings() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="card">
        <div style="font-weight:900;">Settings</div>
        <div class="muted">Server: ${BASE_URL}</div>
        <div class="muted">If Render env <code>ADMIN_TOKEN</code> is set, paste the same token here.</div>
        <div style="margin-top:10px;display:grid;gap:8px;">
          <input id="adm" placeholder="Admin token (optional)" />
          <button class="h-btn" id="save">Save</button>
          <button class="h-btn" id="test">Test Connection</button>
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
        const res = await reqJSON(withAdmin(`${BASE_URL}/api/companies`), "GET");
        if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
        toastMsg("OK");
        state.tab = "companies";
        await loadCompanies();
        render();
      } catch {
        toastMsg("Test failed (token wrong or service down)");
      }
    };

    return wrap;
  }

  function viewCompanies() {
    const wrap = document.createElement("div");

    const header = document.createElement("div");
    header.className = "card";
    header.innerHTML = `
      <div style="font-weight:900;">Companies & Employees</div>
      <div class="muted">Source: /api/companies • Updated: ${state.companiesUpdated || "—"}</div>
      <div class="muted">Pick a company → pick an employee → track trains below.</div>
    `;
    wrap.appendChild(header);

    // company dropdown
    const companyCard = document.createElement("div");
    companyCard.className = "card";

    const companySel = document.createElement("select");
    companySel.id = "coSel";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = state.companies.length ? "Select company…" : "No companies loaded yet";
    companySel.appendChild(opt0);

    for (const c of state.companies) {
      const o = document.createElement("option");
      o.value = c.company_id;
      o.textContent = `${c.name} (${(c.employees || []).length})`;
      if (c.company_id === state.selectedCompanyId) o.selected = true;
      companySel.appendChild(o);
    }

    const employeeSel = document.createElement("select");
    employeeSel.id = "empSel";

    function fillEmployees() {
      employeeSel.innerHTML = "";
      const c = state.companies.find(x => x.company_id === state.selectedCompanyId);
      const emp = (c && c.employees) ? c.employees : [];

      const o0 = document.createElement("option");
      o0.value = "";
      o0.textContent = emp.length ? "Select employee…" : "No employees found";
      employeeSel.appendChild(o0);

      for (const e of emp) {
        const o = document.createElement("option");
        o.value = e.id || "";
        const pos = e.position ? ` • ${e.position}` : "";
        o.textContent = `${e.name || e.id}${pos}`;
        if ((e.id || "") === state.selectedEmployeeId) o.selected = true;
        employeeSel.appendChild(o);
      }
    }

    companySel.onchange = async () => {
      state.selectedCompanyId = companySel.value;
      state.selectedEmployeeId = "";
      S.set("h7ds_sel_company", state.selectedCompanyId);
      fillEmployees();
      await loadTrainsForSelected();
      render();
    };

    employeeSel.onchange = () => {
      state.selectedEmployeeId = employeeSel.value;
      S.set("h7ds_sel_employee", state.selectedEmployeeId);
      render();
    };

    // preload selection
    if (!state.selectedCompanyId) state.selectedCompanyId = S.get("h7ds_sel_company", "") || "";
    if (!state.selectedEmployeeId) state.selectedEmployeeId = S.get("h7ds_sel_employee", "") || "";
    if (state.selectedCompanyId && !state.companies.find(x => x.company_id === state.selectedCompanyId)) {
      state.selectedCompanyId = "";
      state.selectedEmployeeId = "";
    }

    fillEmployees();

    // employee info box
    const info = document.createElement("div");
    info.className = "muted";
    info.style.marginTop = "10px";

    const cSel = state.companies.find(x => x.company_id === state.selectedCompanyId);
    const eSel = cSel ? (cSel.employees || []).find(x => (x.id || "") === state.selectedEmployeeId) : null;
    if (eSel) {
      const days = (eSel.days_in_company !== null && eSel.days_in_company !== undefined) ? ` • ${eSel.days_in_company}d` : "";
      const stt = eSel.status ? ` • ${eSel.status}` : "";
      info.textContent = `Selected: ${eSel.name || eSel.id}${eSel.position ? " • " + eSel.position : ""}${days}${stt}`;
    } else {
      info.textContent = "Selected: —";
    }

    // train tracker
    const trainCard = document.createElement("div");
    trainCard.className = "card";

    const buyer = document.createElement("input");
    buyer.placeholder = "Buyer (name or ID)";

    const trains = document.createElement("input");
    trains.type = "number";
    trains.min = "0";
    trains.placeholder = "Amount of trains";

    const note = document.createElement("input");
    note.placeholder = "Note (optional)";

    const addBtn = document.createElement("button");
    addBtn.className = "h-btn";
    addBtn.textContent = "Add Train Entry";

    addBtn.onclick = async () => {
      if (!state.selectedCompanyId) return toastMsg("Pick a company first");
      const b = (buyer.value || "").trim();
      const t = (trains.value || "").trim();
      const n = (note.value || "").trim();
      if (!b || !t) return toastMsg("Need buyer + trains");

      try {
        const res = await reqJSON(withAdmin(`${BASE_URL}/api/trains/add`), "POST", {
          company_id: state.selectedCompanyId,
          buyer: b,
          trains: Number(t),
          note: n,
        });
        if (!res || res.ok !== true) throw new Error("bad response");
        buyer.value = ""; trains.value = ""; note.value = "";
        toastMsg("Added");
        await loadTrainsForSelected();
        render();
      } catch {
        toastMsg("Add failed (token?)");
      }
    };

    // train list
    const list = document.createElement("div");
    list.style.marginTop = "10px";

    if (!state.selectedCompanyId) {
      list.innerHTML = `<div class="muted">Select a company to view train entries.</div>`;
    } else if (!state.trains.length) {
      list.innerHTML = `<div class="muted">No train entries yet.</div>`;
    } else {
      for (const r of state.trains.slice(0, 25)) {
        const item = document.createElement("div");
        item.className = "card";
        item.style.margin = "8px 0 0 0";
        item.style.padding = "8px";
        item.style.borderRadius = "12px";
        item.innerHTML = `
          <div class="row">
            <div style="min-width:0;">
              <div style="font-weight:900;">${escapeHtml(r.buyer)} — ${r.trains} trains</div>
              <div class="muted">${escapeHtml(r.created_at || "")}${r.note ? " • " + escapeHtml(r.note) : ""}</div>
            </div>
          </div>
        `;
        list.appendChild(item);
      }
    }

    companyCard.appendChild(companySel);
    companyCard.appendChild(employeeSel);
    companyCard.appendChild(info);

    trainCard.innerHTML = `<div style="font-weight:900;">Train Tracker</div><div class="muted">Saved to server per company</div>`;
    trainCard.appendChild(document.createElement("div")).style.height = "8px";
    trainCard.appendChild(buyer);
    trainCard.appendChild(document.createElement("div")).style.height = "8px";
    trainCard.appendChild(trains);
    trainCard.appendChild(document.createElement("div")).style.height = "8px";
    trainCard.appendChild(note);
    trainCard.appendChild(document.createElement("div")).style.height = "10px";
    trainCard.appendChild(addBtn);
    trainCard.appendChild(list);

    wrap.appendChild(companyCard);
    wrap.appendChild(trainCard);

    return wrap;
  }

  function viewApps() {
    const wrap = document.createElement("div");

    const head = document.createElement("div");
    head.className = "card";
    head.innerHTML = `<div style="font-weight:900;">Applications</div><div class="muted">Source: /api/applications</div>`;
    wrap.appendChild(head);

    if (!state.apps.length) {
      const c = document.createElement("div");
      c.className = "card";
      c.innerHTML = `<div style="font-weight:900;">No applications yet</div><div class="muted">Waiting for Torn events → poller → DB.</div>`;
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
            <div style="font-weight:900;">${applicantId ? `Applicant [${escapeHtml(applicantId)}]` : "Applicant [unknown]"}</div>
            <div class="muted">${escapeHtml(created)}</div>
          </div>
          <button class="h-btn" data-open="${escapeAttr(applicantId)}">Open</button>
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
          toastMsg("Update failed (token?)");
        }
      };

      actions.appendChild(sel);

      card.querySelector("[data-open]")?.addEventListener("click", () => {
        if (!applicantId) return toastMsg("No applicant id");
        window.open(`https://www.torn.com/profiles.ph
