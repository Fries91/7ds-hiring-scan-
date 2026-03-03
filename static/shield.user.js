// ==UserScript==
// @name         7DS Hiring Hub 💼 (FAILSAFE v4) [Trains + Search + Apps]
// @namespace    7ds-wrath-hiring
// @version      4.0.0
// @description  💼 ALWAYS injects the briefcase + overlay on Torn. Tabs: Trains (companies+employees+train tracker), Applications, Search (HoF workstats between X-Y), Settings (ADMIN_TOKEN). Matches app.py endpoints: /api/companies /api/trains /api/trains/add /api/applications /api/applications/status /api/search_workstats.
// @author       Fries91
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      sevends-hiring-scan.onrender.com
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // CONFIG
  // =========================
  const BASE_URL = "https://sevends-hiring-scan.onrender.com";
  const POLL_MS = 15000;

  // =========================
  // IDS
  // =========================
  const BTN_ID = "h7ds-briefcase";
  const PANEL_ID = "h7ds-panel";
  const TOAST_ID = "h7ds-toast";

  // =========================
  // STORAGE
  // =========================
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
  };

  // =========================
  // HELPERS
  // =========================
  function qs(sel, root = document) { return root.querySelector(sel); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function nowNice() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
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

  // =========================
  // FAILSAFE INJECTOR
  // - waits for body
  // - re-injects if something removes it
  // =========================
  function ensureInjected() {
    if (!document.body) return false;

    // remove broken leftovers (hidden/partial)
    const oldBtn = document.getElementById(BTN_ID);
    const oldPanel = document.getElementById(PANEL_ID);
    const oldToast = document.getElementById(TOAST_ID);

    if (oldBtn && !oldBtn.isConnected) oldBtn.remove();
    if (oldPanel && !oldPanel.isConnected) oldPanel.remove();
    if (oldToast && !oldToast.isConnected) oldToast.remove();

    if (document.getElementById(BTN_ID) && document.getElementById(PANEL_ID)) return true;

    // hard remove duplicates if any
    document.querySelectorAll(`#${BTN_ID}`).forEach((n, i) => { if (i > 0) n.remove(); });
    document.querySelectorAll(`#${PANEL_ID}`).forEach((n, i) => { if (i > 0) n.remove(); });
    document.querySelectorAll(`#${TOAST_ID}`).forEach((n, i) => { if (i > 0) n.remove(); });

    injectUI();
    return true;
  }

  // Retry loop (covers SPA navigation / slow body)
  let tries = 0;
  const bootTimer = setInterval(() => {
    tries++;
    if (ensureInjected()) {
      clearInterval(bootTimer);
      // watch for removals
      startObserver();
    }
    if (tries > 40) clearInterval(bootTimer); // ~20s
  }, 500);

  function startObserver() {
    const obs = new MutationObserver(() => {
      // if the briefcase or panel disappears, re-add
      if (!document.getElementById(BTN_ID) || !document.getElementById(PANEL_ID)) {
        ensureInjected();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // =========================
  // UI INJECT
  // =========================
  function injectUI() {
    // wipe any existing elements (fresh start)
    document.getElementById(BTN_ID)?.remove();
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(TOAST_ID)?.remove();

    GM_addStyle(`
      #${BTN_ID}, #${PANEL_ID}, #${TOAST_ID}, #${PANEL_ID} * {
        box-sizing:border-box;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
      }

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
        height:580px; max-height:84vh;
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

      #${PANEL_ID} select, #${PANEL_ID} input{
        width:100%; padding:8px 10px; border-radius:12px;
        border:1px solid rgba(255,255,255,.12);
        background:rgba(0,0,0,.22); color:#fff; outline:none;
        font-weight:800; font-size:12px;
      }

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

    const savedPos = S.get("h7ds_hiring_pos_failsafe", { btnLeft: null, btnTop: null, panelLeft: null, panelTop: null });

    const state = {
      tab: "trains",
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
      searchMeta: null,

      timer: null,
    };

    function toastMsg(msg) {
      toast.textContent = msg;
      toast.style.display = "block";
      clearTimeout(toastMsg._t);
      toastMsg._t = setTimeout(() => (toast.style.display = "none"), 1600);
    }

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

    async function loadCompanies() {
      const res = await reqJSON(withAdmin(`${BASE_URL}/api/companies`), "GET");
      if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
      state.companiesUpdated = res.updated_at || null;
      state.companies = res.rows || [];
    }

    async function loadTrainsForSelected() {
      state.trains = [];
      if (!state.selectedCompanyId) return;
      const res = await reqJSON(withAdmin(`${BASE_URL}/api/trains?company_id=${encodeURIComponent(state.selectedCompanyId)}`), "GET");
      if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
      state.trains = res.rows || [];
    }

    async function loadApps() {
      const res = await reqJSON(withAdmin(`${BASE_URL}/api/applications`), "GET");
      if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
      state.apps = res.rows || [];
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

    function toggle(open) {
      const isOpen = panel.style.display === "block";
      const next = open ?? !isOpen;
      panel.style.display = next ? "block" : "none";
      if (next) startPolling();
      else stopPolling();
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
          if (!res || res.ok !== true) throw new Error();
          toastMsg("OK");
          state.tab = "trains";
          await loadCompanies();
          await loadTrainsForSelected();
          render();
        } catch {
          toastMsg("Test failed (token wrong or service down)");
        }
      };

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
            <button class="h-btn" data-open="1">Open</button>
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
            if (!res || res.ok !== true) throw new Error();
            toastMsg("Status updated");
          } catch {
            toastMsg("Update failed (token?)");
          }
        };

        actions.appendChild(sel);

        card.querySelector("[data-open]")?.addEventListener("click", () => {
          if (!applicantId) return toastMsg("No applicant id");
          window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(applicantId)}`, "_blank");
        });

        wrap.appendChild(card);
      }

      return wrap;
    }

    function viewSearch() {
      const wrap = document.createElement("div");

      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div style="font-weight:900;">Search HoF (Workstats)</div>
        <div class="muted">Find players where HoF workstats is between X and Y.</div>
        <div class="muted">Uses: /api/search_workstats?min=X&max=Y</div>
      `;

      const minInp = document.createElement("input");
      minInp.type = "number";
      minInp.placeholder = "Min value (X)";
      minInp.value = String(state.searchMin || "");

      const maxInp = document.createElement("input");
      maxInp.type = "number";
      maxInp.placeholder = "Max value (Y)";
      maxInp.value = String(state.searchMax || "");

      const go = document.createElement("button");
      go.className = "h-btn";
      go.textContent = "Search";

      const meta = document.createElement("div");
      meta.className = "muted";
      meta.style.marginTop = "10px";
      meta.textContent = state.searchMeta ? state.searchMeta : "—";

      const results = document.createElement("div");
      results.style.marginTop = "10px";

      function renderResults() {
        results.innerHTML = "";
        if (!state.searchRows.length) {
          results.innerHTML = `<div class="muted">No results yet.</div>`;
          return;
        }

        for (const r of state.searchRows.slice(0, 200)) {
          const c = document.createElement("div");
          c.className = "card";
          c.style.margin = "8px 0 0 0";
          c.style.padding = "8px";
          c.style.borderRadius = "12px";

          const name = r.name || "";
          const id = r.id || "";
          const value = r.value != null ? r.value : "";
          const rank = r.rank != null ? r.rank : "";

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
            if (!id) return toastMsg("Missing id");
            window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}`, "_blank");
          });

          results.appendChild(c);
        }
      }

      go.onclick = async () => {
        const minv = parseInt((minInp.value || "").trim(), 10);
        const maxv = parseInt((maxInp.value || "").trim(), 10);
        if (Number.isNaN(minv) || Number.isNaN(maxv)) return toastMsg("Enter min and max");

        state.searchMin = minv;
        state.searchMax = maxv;
        S.set("h7ds_search_min", minv);
        S.set("h7ds_search_max", maxv);

        toastMsg("Searching…");
        try {
          const url = withAdmin(`${BASE_URL}/api/search_workstats?min=${encodeURIComponent(minv)}&max=${encodeURIComponent(maxv)}&limit=150`);
          const res = await reqJSON(url, "GET");
          if (!res || res.ok !== true) throw new Error(res?.error || "bad response");

          state.searchRows = res.rows || [];
          state.searchMeta = `Found ${res.count} • pages: ${res.scanned_pages} • cached: ${res.cached ? "yes" : "no"} • ${res.updated_at || ""}`;
          meta.textContent = state.searchMeta;
          renderResults();
          toastMsg(`Found ${res.count}`);
        } catch {
          toastMsg("Search failed (token/service?)");
        }
      };

      card.appendChild(document.createElement("div")).style.height = "8px";
      card.appendChild(minInp);
      card.appendChild(document.createElement("div")).style.height = "8px";
      card.appendChild(maxInp);
      card.appendChild(document.createElement("div")).style.height = "10px";
      card.appendChild(go);
      card.appendChild(meta);

      wrap.appendChild(card);
      wrap.appendChild(results);

      renderResults();
      return wrap;
    }

    function viewTrains() {
      const wrap = document.createElement("div");

      const header = document.createElement("div");
      header.className = "card";
      header.innerHTML = `
        <div style="font-weight:900;">Companies & Employees</div>
        <div class="muted">Updated: ${state.companiesUpdated || "—"}</div>
        <div class="muted">Pick company → employee → track trains.</div>
      `;
      wrap.appendChild(header);

      const companyCard = document.createElement("div");
      companyCard.className = "card";

      const companySel = document.createElement("select");
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

      if (state.selectedCompanyId && !state.companies.find(x => x.company_id === state.selectedCompanyId)) {
        state.selectedCompanyId = "";
        state.selectedEmployeeId = "";
        S.set("h7ds_sel_company", "");
        S.set("h7ds_sel_employee", "");
      }

      fillEmployees();

      companySel.onchange = async () => {
        state.selectedCompanyId = companySel.value;
        state.selectedEmployeeId = "";
        S.set("h7ds_sel_company", state.selectedCompanyId);
        S.set("h7ds_sel_employee", state.selectedEmployeeId);
        fillEmployees();
        await loadTrainsForSelected();
        render();
      };

      employeeSel.onchange = () => {
        state.selectedEmployeeId = employeeSel.value;
        S.set("h7ds_sel_employee", state.selectedEmployeeId);
        render();
      };

      const info = document.createElement("div");
      info.className = "muted";
      info.style.marginTop = "10px";

      const cSel = state.companies.find(x => x.company_id === state.selectedCompanyId);
      const eSel = cSel ? (cSel.employees || []).find(x => (x.id || "") === state.selectedEmployeeId) : null;
      info.textContent = eSel
        ? `Selected: ${eSel.name || eSel.id}${eSel.position ? " • " + eSel.position : ""}`
        : "Selected: —";

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
          if (!res || res.ok !== true) throw new Error();
          buyer.value = ""; trains.value = ""; note.value = "";
          toastMsg("Added");
          await loadTrainsForSelected();
          render();
        } catch {
          toastMsg("Add failed (token?)");
        }
      };

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
    }

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
        S.set("h7ds_hiring_pos_failsafe", savedPos);

        if (which === "btn" && !moved) toggle();
      });

      node.addEventListener("pointercancel", () => { down = false; });
    }

    // BOOT UI
    render();
    makeDraggableTap(btn, "btn");
    makeDraggableTap(panel, "panel");
    toastMsg("💼 Hiring Hub loaded");
  }
})();
