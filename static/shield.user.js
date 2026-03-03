// ==UserScript==
// @name         7DS Hiring Hub 💼 (Draggable + CSP-proof) [Applications + Company Train Tracker]
// @namespace    7ds-wrath-hiring
// @version      1.0.0
// @description  💼 Draggable launcher for your Hiring Hub. CSP-proof (no iframe): pulls applications from your Render service, lets you change status, open Torn profiles, and includes per-company Train Tracker dropdowns (local storage).
// @author       Fries91
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      sevends-hiring-scan.onrender.com
// @connect      api.torn.com
// ==/UserScript==

(function () {
  "use strict";

  // =========================
  // CONFIG
  // =========================
  const BASE_URL = "https://sevends-hiring-scan.onrender.com"; // your Render service
  // If your server has ADMIN_TOKEN enabled, put it here. If server ADMIN_TOKEN is blank, leave this blank too.
  const ADMIN_TOKEN = ""; // e.g. "your_admin_token"

  // Company cards (local UI + train tracking). Add/edit names here.
  const DEFAULT_COMPANIES = [
    { id: "c1", name: "Company 1" },
    { id: "c2", name: "Company 2" },
    { id: "c3", name: "Company 3" },
  ];

  // polling
  const POLL_MS = 20000;

  // =========================
  // SMALL HELPERS
  // =========================
  const LS = {
    get(key, fallback) {
      try {
        const v = GM_getValue(key);
        return v === undefined || v === null || v === "" ? fallback : JSON.parse(v);
      } catch {
        try {
          const v = GM_getValue(key);
          return v === undefined || v === null || v === "" ? fallback : v;
        } catch {
          return fallback;
        }
      }
    },
    set(key, value) {
      try {
        GM_setValue(key, JSON.stringify(value));
      } catch {
        GM_setValue(key, String(value));
      }
    },
  };

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  }

  function nowTS() {
    const d = new Date();
    return d.toLocaleString();
  }

  function reqJSON(url, method = "GET", data = null) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: data ? { "Content-Type": "application/json" } : {},
        data: data ? JSON.stringify(data) : null,
        timeout: 25000,
        onload: (r) => {
          try {
            const j = JSON.parse(r.responseText);
            resolve(j);
          } catch (e) {
            reject(new Error("Bad JSON response"));
          }
        },
        onerror: () => reject(new Error("Request failed")),
        ontimeout: () => reject(new Error("Request timeout")),
      });
    });
  }

  function withAdmin(url) {
    if (!ADMIN_TOKEN) return url;
    return url.includes("?") ? `${url}&admin=${encodeURIComponent(ADMIN_TOKEN)}` : `${url}?admin=${encodeURIComponent(ADMIN_TOKEN)}`;
  }

  // =========================
  // UI: 💼 + PANEL
  // =========================
  const BTN_ID = "h7ds-briefcase";
  const PANEL_ID = "h7ds-panel";
  const TOAST_ID = "h7ds-toast";

  if (document.getElementById(BTN_ID)) return;

  GM_addStyle(`
    #${BTN_ID}, #${PANEL_ID}, #${TOAST_ID}, #${PANEL_ID} * { box-sizing:border-box; }

    #${BTN_ID}{
      position:fixed; z-index:9999999;
      width:42px; height:42px;
      display:flex; align-items:center; justify-content:center;
      border-radius:14px;
      background:rgba(10,10,14,.88);
      border:1px solid rgba(255,255,255,.14);
      box-shadow:0 8px 22px rgba(0,0,0,.45);
      font-size:24px; cursor:pointer;
      user-select:none; -webkit-user-select:none;
    }

    #${PANEL_ID}{
      position:fixed; z-index:9999998;
      width:360px; max-width:94vw;
      height:520px; max-height:80vh;
      border-radius:16px;
      background:rgba(12,12,18,.92);
      border:1px solid rgba(255,255,255,.12);
      box-shadow:0 18px 46px rgba(0,0,0,.55);
      overflow:hidden;
      display:none;
      backdrop-filter: blur(10px);
    }

    #${PANEL_ID} .h7ds-head{
      height:44px;
      display:flex; align-items:center; justify-content:space-between;
      padding:0 10px;
      background:rgba(255,255,255,.06);
      border-bottom:1px solid rgba(255,255,255,.08);
      color:#fff;
      font:700 13px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    #${PANEL_ID} .h7ds-head .left{
      display:flex; gap:8px; align-items:center;
    }
    #${PANEL_ID} .h7ds-pill{
      font:600 11px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      padding:6px 8px;
      border-radius:999px;
      background:rgba(0,0,0,.25);
      border:1px solid rgba(255,255,255,.10);
      color:#fff;
    }
    #${PANEL_ID} .h7ds-btn{
      border:1px solid rgba(255,255,255,.14);
      background:rgba(0,0,0,.20);
      color:#fff;
      border-radius:10px;
      padding:7px 10px;
      font:700 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      cursor:pointer;
    }
    #${PANEL_ID} .h7ds-btn:active{ transform:scale(.98); }
    #${PANEL_ID} .h7ds-close{
      width:34px; height:34px; padding:0;
      display:flex; align-items:center; justify-content:center;
      border-radius:10px;
    }

    #${PANEL_ID} .h7ds-tabs{
      display:flex;
      padding:8px 10px;
      gap:8px;
      border-bottom:1px solid rgba(255,255,255,.08);
    }
    #${PANEL_ID} .h7ds-tab{
      flex:1;
      text-align:center;
      padding:8px 10px;
      border-radius:12px;
      font:800 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      cursor:pointer;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(255,255,255,.05);
      color:#fff;
      user-select:none;
    }
    #${PANEL_ID} .h7ds-tab.active{
      background:rgba(0,0,0,.28);
      border-color:rgba(255,255,255,.18);
    }

    #${PANEL_ID} .h7ds-body{
      height:calc(100% - 44px - 48px);
      overflow:auto;
      padding:10px;
      color:#fff;
      font:600 12px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }

    #${PANEL_ID} .h7ds-card{
      border:1px solid rgba(255,255,255,.10);
      background:rgba(0,0,0,.18);
      border-radius:14px;
      padding:10px;
      margin-bottom:10px;
    }
    #${PANEL_ID} .h7ds-row{
      display:flex; align-items:center; justify-content:space-between;
      gap:8px;
    }
    #${PANEL_ID} .h7ds-title{
      font:900 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    #${PANEL_ID} .h7ds-sub{
      opacity:.82;
      font:600 11px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      margin-top:4px;
      word-break:break-word;
    }
    #${PANEL_ID} .h7ds-actions{
      display:flex; gap:6px; flex-wrap:wrap;
      margin-top:10px;
    }
    #${PANEL_ID} select, #${PANEL_ID} input{
      width:100%;
      padding:8px 10px;
      border-radius:12px;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(0,0,0,.22);
      color:#fff;
      outline:none;
      font:700 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    #${PANEL_ID} .h7ds-mini{
      padding:7px 9px;
      border-radius:10px;
      font:800 11px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }

    #${PANEL_ID} .h7ds-drop{
      margin-top:10px;
      border-top:1px dashed rgba(255,255,255,.14);
      padding-top:10px;
      display:none;
    }

    #${TOAST_ID}{
      position:fixed; z-index:99999999;
      left:50%; transform:translateX(-50%);
      bottom:14px;
      padding:10px 12px;
      border-radius:14px;
      background:rgba(0,0,0,.78);
      border:1px solid rgba(255,255,255,.14);
      color:#fff;
      font:800 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      display:none;
      max-width:92vw;
      text-align:center;
    }
  `);

  // default positions (saved)
  const savedPos = LS.get("h7ds_pos", { btnLeft: null, btnTop: null, panelLeft: null, panelTop: null });
  const btn = el("div", { id: BTN_ID }, ["💼"]);
  const panel = el("div", { id: PANEL_ID });

  // Set initial positions
  function setInitial() {
    if (savedPos.btnLeft !== null && savedPos.btnTop !== null) {
      btn.style.left = savedPos.btnLeft + "px";
      btn.style.top = savedPos.btnTop + "px";
      btn.style.right = "auto";
      btn.style.bottom = "auto";
    } else {
      btn.style.right = "16px";
      btn.style.bottom = "120px";
    }

    if (savedPos.panelLeft !== null && savedPos.panelTop !== null) {
      panel.style.left = savedPos.panelLeft + "px";
      panel.style.top = savedPos.panelTop + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    } else {
      panel.style.right = "16px";
      panel.style.bottom = "170px";
    }
  }

  const toast = el("div", { id: TOAST_ID }, []);
  document.body.appendChild(btn);
  document.body.appendChild(panel);
  document.body.appendChild(toast);
  setInitial();

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (toast.style.display = "none"), 1800);
  }

  // =========================
  // PANEL CONTENT
  // =========================
  const state = {
    tab: "apps",
    lastFetch: null,
    apps: [],
    companies: LS.get("h7ds_companies", null) || DEFAULT_COMPANIES,
    trains: LS.get("h7ds_trains", {}), // { companyId: [ {buyer, trains, note, ts} ] }
    timer: null,
  };

  function saveCompanies() {
    LS.set("h7ds_companies", state.companies);
  }
  function saveTrains() {
    LS.set("h7ds_trains", state.trains);
  }

  function headerView() {
    const left = el("div", { class: "left" }, [
      el("div", { class: "h7ds-title" }, ["7DS Hiring Hub"]),
      el("div", { class: "h7ds-pill", id: "h7ds-last" }, ["—"]),
    ]);

    const right = el("div", { class: "right" }, [
      el("button", { class: "h7ds-btn h7ds-mini", onclick: () => refreshNow() }, ["↻ Refresh"]),
      el("button", { class: "h7ds-btn h7ds-close", onclick: () => toggle(false) }, ["✕"]),
    ]);

    return el("div", { class: "h7ds-head" }, [left, right]);
  }

  function tabsView() {
    const tApps = el("div", {
      class: "h7ds-tab" + (state.tab === "apps" ? " active" : ""),
      onclick: () => {
        state.tab = "apps";
        render();
      },
    }, ["Applications"]);

    const tCo = el("div", {
      class: "h7ds-tab" + (state.tab === "companies" ? " active" : ""),
      onclick: () => {
        state.tab = "companies";
        render();
      },
    }, ["Companies"]);

    return el("div", { class: "h7ds-tabs" }, [tApps, tCo]);
  }

  function appsView() {
    const body = el("div", { class: "h7ds-body" }, []);

    // warning if admin empty
    if (!ADMIN_TOKEN) {
      body.appendChild(el("div", { class: "h7ds-card" }, [
        el("div", { class: "h7ds-title" }, ["Admin token not set"]),
        el("div", { class: "h7ds-sub" }, [
          "If your server ADMIN_TOKEN is enabled, add it in the script (ADMIN_TOKEN). If your server has ADMIN_TOKEN blank, you're fine.",
        ]),
      ]));
    }

    if (!state.apps || state.apps.length === 0) {
      body.appendChild(el("div", { class: "h7ds-card" }, [
        el("div", { class: "h7ds-title" }, ["No applications yet"]),
        el("div", { class: "h7ds-sub" }, ["Waiting for Torn events… (polling your Render service)"]),
      ]));
      return body;
    }

    for (const row of state.apps) {
      const applicantId = row.applicant_id || "";
      const raw = row.raw_text || "";
      const status = row.status || "new";
      const created = row.created_at || "";

      const openProfile = el("button", {
        class: "h7ds-btn h7ds-mini",
        onclick: () => {
          if (!applicantId) return showToast("No applicant id found in event");
          window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(applicantId)}`, "_blank");
        },
      }, ["Open"]);

      const statusSel = el("select", {});
      ["new", "seen", "interview", "hired", "rejected"].forEach((s) => {
        const o = document.createElement("option");
        o.value = s;
        o.textContent = s.toUpperCase();
        if (s === status) o.selected = true;
        statusSel.appendChild(o);
      });

      statusSel.addEventListener("change", async () => {
        try {
          const url = withAdmin(`${BASE_URL}/api/applications/status`);
          const res = await reqJSON(url, "POST", { id: row.id, status: statusSel.value });
          if (!res || res.ok !== true) throw new Error("bad response");
          showToast("Status updated");
          row.status = statusSel.value;
        } catch {
          showToast("Failed to update status");
        }
      });

      const card = el("div", { class: "h7ds-card" }, [
        el("div", { class: "h7ds-row" }, [
          el("div", {}, [
            el("div", { class: "h7ds-title" }, [
              applicantId ? `Applicant [${applicantId}]` : "Applicant [unknown]",
            ]),
            el("div", { class: "h7ds-sub" }, [created ? `Created: ${created}` : ""]),
          ]),
          openProfile,
        ]),
        el("div", { class: "h7ds-sub" }, [raw]),
        el("div", { class: "h7ds-actions" }, [
          el("div", { style: "flex:1;min-width:160px;" }, [statusSel]),
        ]),
      ]);

      body.appendChild(card);
    }

    return body;
  }

  function companiesView() {
    const body = el("div", { class: "h7ds-body" }, []);

    // Add company UI
    const addWrap = el("div", { class: "h7ds-card" }, [
      el("div", { class: "h7ds-title" }, ["Companies (local)"]),
      el("div", { class: "h7ds-sub" }, ["These boxes are for your tracking (stored on your device)."]),
      el("div", { style: "margin-top:10px;display:flex;gap:8px;" }, [
        el("input", { id: "h7ds-newco", placeholder: "New company name..." }),
        el("button", {
          class: "h7ds-btn",
          onclick: () => {
            const inp = document.getElementById("h7ds-newco");
            const name = (inp.value || "").trim();
            if (!name) return showToast("Enter a company name");
            const id = "c" + Math.random().toString(16).slice(2, 10);
            state.companies.unshift({ id, name });
            inp.value = "";
            saveCompanies();
            render();
            showToast("Company added");
          },
        }, ["Add"]),
      ]),
    ]);

    body.appendChild(addWrap);

    // Company cards
    for (const co of state.companies) {
      const cid = co.id;

      if (!state.trains[cid]) state.trains[cid] = [];

      const dropId = `h7ds-drop-${cid}`;
      const drop = el("div", { class: "h7ds-drop", id: dropId });

      const toggleBtn = el("button", {
        class: "h7ds-btn h7ds-mini",
        onclick: () => {
          const d = document.getElementById(dropId);
          d.style.display = d.style.display === "block" ? "none" : "block";
        },
      }, ["▼ Tracker"]);

      const delBtn = el("button", {
        class: "h7ds-btn h7ds-mini",
        onclick: () => {
          state.companies = state.companies.filter((x) => x.id !== cid);
          delete state.trains[cid];
          saveCompanies();
          saveTrains();
          render();
          showToast("Company removed");
        },
      }, ["Delete"]);

      // tracker inputs
      const buyer = el("input", { placeholder: "Buyer (name or ID)" });
      const trains = el("input", { placeholder: "Amount of trains", type: "number", min: "0" });
      const note = el("input", { placeholder: "Notes (optional)" });

      const addTrain = el("button", {
        class: "h7ds-btn",
        onclick: () => {
          const b = (buyer.value || "").trim();
          const t = (trains.value || "").trim();
          const n = (note.value || "").trim();
          if (!b || !t) return showToast("Need buyer + trains");
          state.trains[cid].unshift({ buyer: b, trains: Number(t), note: n, ts: nowTS() });
          buyer.value = "";
          trains.value = "";
          note.value = "";
          saveTrains();
          render();
          showToast("Added");
        },
      }, ["Add Entry"]);

      // list
      const listWrap = el("div", { style: "margin-top:10px;" });
      const entries = state.trains[cid] || [];
      if (entries.length === 0) {
        listWrap.appendChild(el("div", { class: "h7ds-sub" }, ["No train entries yet."]));
      } else {
        for (let i = 0; i < Math.min(entries.length, 20); i++) {
          const e = entries[i];
          const rm = el("button", {
            class: "h7ds-btn h7ds-mini",
            onclick: () => {
              state.trains[cid].splice(i, 1);
              saveTrains();
              render();
              showToast("Removed");
            },
          }, ["✕"]);

          listWrap.appendChild(el("div", { class: "h7ds-card", style: "margin:8px 0 0 0;padding:8px;border-radius:12px;" }, [
            el("div", { class: "h7ds-row" }, [
              el("div", {}, [
                el("div", { class: "h7ds-title" }, [`${e.buyer} — ${e.trains} trains`]),
                el("div", { class: "h7ds-sub" }, [`${e.ts}${e.note ? " • " + e.note : ""}`]),
              ]),
              rm,
            ]),
          ]));
        }
      }

      drop.appendChild(el("div", { class: "h7ds-sub" }, ["Train Tracker (local)"]));
      drop.appendChild(el("div", { style: "display:grid;gap:8px;margin-top:8px;" }, [buyer, trains, note, addTrain]));
      drop.appendChild(listWrap);

      const card = el("div", { class: "h7ds-card" }, [
        el("div", { class: "h7ds-row" }, [
          el("div", {}, [
            el("div", { class: "h7ds-title" }, [co.name]),
            el("div", { class: "h7ds-sub" }, [`Entries: ${(state.trains[cid] || []).length}`]),
          ]),
          el("div", { style: "display:flex;gap:6px;" }, [toggleBtn, delBtn]),
        ]),
        drop,
      ]);

      body.appendChild(card);
    }

    return body;
  }

  function render() {
    panel.innerHTML = "";
    panel.appendChild(headerView());
    panel.appendChild(tabsView());

    const body = state.tab === "apps" ? appsView() : companiesView();
    panel.appendChild(body);

    const last = panel.querySelector("#h7ds-last");
    if (last) last.textContent = state.lastFetch ? `Last: ${state.lastFetch}` : "Last: —";
  }

  // =========================
  // DATA FETCH
  // =========================
  async function refreshNow() {
    try {
      const url = withAdmin(`${BASE_URL}/api/applications`);
      const res = await reqJSON(url, "GET");
      if (!res || res.ok !== true) {
        const err = (res && res.error) ? res.error : "bad response";
        showToast(`Fetch failed: ${err}`);
        return;
      }
      state.apps = res.rows || [];
      state.lastFetch = nowTS();
      render();
    } catch (e) {
      showToast("Fetch failed (service offline?)");
    }
  }

  function startPolling() {
    stopPolling();
    refreshNow();
    state.timer = setInterval(() => {
      // only poll when panel is open (keeps it light)
      if (panel.style.display === "block") refreshNow();
    }, POLL_MS);
  }

  function stopPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  // =========================
  // OPEN / CLOSE
  // =========================
  function toggle(open) {
    const isOpen = panel.style.display === "block";
    const next = open ?? !isOpen;
    panel.style.display = next ? "block" : "none";
    if (next) startPolling();
    else stopPo
