// ==UserScript==
// @name         7DS Hiring Hub 💼 (MATCHES APP) [Draggable + Tap Open + Applications + Workstats Viewer]
// @namespace    7ds-wrath-hiring
// @version      1.2.0
// @description  💼 Draggable launcher that opens a hiring panel and pulls data from your Render app (/api/applications). Lets you change application status + open profile + fetch applicant workstats via /api/applicant (requires their API key). Built to match your current app.py endpoints and avoid CSP/iframe issues.
// @author       Fries91
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

  // =========================
  // CONFIG (MATCH YOUR APP)
  // =========================
  const BASE_URL = "https://sevends-hiring-scan.onrender.com"; // your Render service

  // If your Render env ADMIN_TOKEN is set (not blank), you MUST set the same value here,
  // or use the in-panel "Admin Token" box (it saves locally).
  const ADMIN_TOKEN_DEFAULT = ""; // optional: hardcode it

  const POLL_MS = 15000;

  // =========================
  // STORAGE HELPERS
  // =========================
  const S = {
    get(key, fallback) {
      try {
        const raw = GM_getValue(key);
        if (raw === undefined || raw === null || raw === "") return fallback;
        return JSON.parse(raw);
      } catch {
        const raw = GM_getValue(key);
        return raw === undefined || raw === null || raw === "" ? fallback : raw;
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

  function qs(sel, root = document) { return root.querySelector(sel); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function reqJSON(url, method = "GET", body = null) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: body ? { "Content-Type": "application/json" } : {},
        data: body ? JSON.stringify(body) : null,
        timeout: 25000,
        onload: (r) => {
          try {
            resolve(JSON.parse(r.responseText || "{}"));
          } catch {
            reject(new Error("Bad JSON"));
          }
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

  // =========================
  // UI SETUP
  // =========================
  const BTN_ID = "h7ds-briefcase";
  const PANEL_ID = "h7ds-hub";
  const TOAST_ID = "h7ds-toast";

  if (document.getElementById(BTN_ID)) return;

  GM_addStyle(`
    #${BTN_ID}, #${PANEL_ID}, #${TOAST_ID}, #${PANEL_ID} * { box-sizing:border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }

    #${BTN_ID}{
      position:fixed; z-index:2147483647;
      width:44px; height:44px;
      display:flex; align-items:center; justify-content:center;
      border-radius:14px;
      background:rgba(10,10,14,.88);
      border:1px solid rgba(255,255,255,.14);
      box-shadow:0 8px 22px rgba(0,0,0,.45);
      font-size:26px;
      user-select:none; -webkit-user-select:none;
      touch-action:none;
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
      display:flex;
      gap:8px;
      padding:8px 10px;
      border-bottom:1px solid rgba(255,255,255,.08);
    }
    #${PANEL_ID} .h-tab{
      flex:1;
      text-align:center;
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
    #${PANEL_ID} textarea{ min-height:84px; resize:vertical; }

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

  // =========================
  // STATE
  // =========================
  const pos = S.get("h7ds_pos_v2", {
    btnLeft: null, btnTop: null,
    panelLeft: null, panelTop: null
  });

  const st = {
    tab: "apps",
    apps: [],
    last: null,
    selectedApplicantId: "",
    applicantKey: "",
    workstatsJson: "",
    adminToken: S.get("h7ds_admin_token", ADMIN_TOKEN_DEFAULT) || "",
    timer: null,
  };

  function applyInitialPositions() {
    if (pos.btnLeft != null && pos.btnTop != null) {
      btn.style.left = pos.btnLeft + "px";
      btn.style.top = pos.btnTop + "px";
      btn.style.right = "auto";
      btn.style.bottom = "auto";
    } else {
      btn.style.right = "16px";
      btn.style.bottom = "120px";
    }

    if (pos.panelLeft != null && pos.panelTop != null) {
      panel.style.left = pos.panelLeft + "px";
      panel.style.top = pos.panelTop + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    } else {
      panel.style.right = "16px";
      panel.style.bottom = "170px";
    }
  }
  applyInitialPositions();

  function withAdmin(url) {
    const tok = (st.adminToken || "").trim();
    if (!tok) return url; // if server ADMIN_TOKEN blank, endpoints work without it
    return url.includes("?")
      ? `${url}&admin=${encodeURIComponent(tok)}`
      : `${url}?admin=${encodeURIComponent(tok)}`;
  }

  // =========================
  // RENDER
  // =========================
  function render() {
    panel.innerHTML = `
      <div class="h-head">
        <div>
          <div class="h-title">7DS Hiring Scan</div>
          <div class="h-sub">Last: <span id="h-last">${st.last || "—"}</span></div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="h-btn" id="h-refresh">↻</button>
          <button class="h-btn" id="h-close">✕</button>
        </div>
      </div>

      <div class="h-tabs">
        <div class="h-tab ${st.tab === "apps" ? "active" : ""}" id="tab-apps">Applications</div>
        <div class="h-tab ${st.tab === "work" ? "active" : ""}" id="tab-work">Workstats</div>
        <div class="h-tab ${st.tab === "settings" ? "active" : ""}" id="tab-settings">Settings</div>
      </div>

      <div class="h-body" id="h-body"></div>
    `;

    qs("#h-close", panel).onclick = () => toggle(false);
    qs("#h-refresh", panel).onclick = () => refreshNow(true);

    qs("#tab-apps", panel).onclick = () => { st.tab = "apps"; render(); };
    qs("#tab-work", panel).onclick = () => { st.tab = "work"; render(); };
    qs("#tab-settings", panel).onclick = () => { st.tab = "settings"; render(); };

    const body = qs("#h-body", panel);
    if (st.tab === "apps") body.appendChild(viewApps());
    if (st.tab === "work") body.appendChild(viewWorkstats());
    if (st.tab === "settings") body.appendChild(viewSettings());
  }

  function viewApps() {
    const wrap = document.createElement("div");

    // If no admin token is set AND your server requires it, you’ll get unauthorized.
    // We show that in the UI via error toast; this card helps remind.
    wrap.innerHTML = `
      <div class="card">
        <div class="row">
          <div>
            <div style="font-weight:900;">Connected to: ${BASE_URL}</div>
            <div class="muted">Pulls: <code>/api/applications</code> & updates status via <code>/api/applications/status</code></div>
          </div>
        </div>
      </div>
    `;

    if (!st.apps || st.apps.length === 0) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.innerHTML = `
        <div style="font-weight:900;">No applications yet</div>
        <div class="muted">If you EXPECT rows: check your Render logs + confirm Torn events are being detected.</div>
      `;
      wrap.appendChild(empty);
      return wrap;
    }

    for (const row of st.apps) {
      const applicantId = (row.applicant_id || "").trim();
      const raw = row.raw_text || "";
      const status = row.status || "new";
      const created = row.created_at || "";

      const card = document.createElement("div");
      card.className = "card";

      const top = document.createElement("div");
      top.className = "row";
      top.innerHTML = `
        <div style="min-width:0;">
          <div style="font-weight:900;">
            ${applicantId ? `Applicant [${applicantId}]` : "Applicant [unknown]"}
          </div>
          <div class="muted">${created ? `Created: ${created}` : ""}</div>
        </div>
        <button class="h-btn" data-open="${applicantId}">Open</button>
      `;

      const rawDiv = document.createElement("div");
      rawDiv.className = "muted";
      rawDiv.style.marginTop = "8px";
      rawDiv.textContent = raw;

      const actions = document.createElement("div");
      actions.className = "actions";

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
          if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
          row.status = sel.value;
          toastMsg("Status updated");
        } catch (e) {
          toastMsg("Failed to update (admin token?)");
        }
      };

      const wsBtn = document.createElement("button");
      wsBtn.className = "h-btn";
      wsBtn.textContent = "Workstats";
      wsBtn.onclick = () => {
        if (!applicantId) return toastMsg("No applicant id found");
        st.selectedApplicantId = applicantId;
        st.tab = "work";
        render();
        toastMsg("Paste their API key");
      };

      actions.appendChild(sel);
      actions.appendChild(wsBtn);

      card.appendChild(top);
      card.appendChild(rawDiv);
      card.appendChild(actions);

      card.querySelector("[data-open]")?.addEventListener("click", () => {
        if (!applicantId) return toastMsg("No applicant id found");
        window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(applicantId)}`, "_blank");
      });

      wrap.appendChild(card);
    }

    return wrap;
  }

  function viewWorkstats() {
    const wrap = document.createElement("div");

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="font-weight:900;">Fetch Applicant Workstats</div>
      <div class="muted">Uses your server: <code>/api/applicant?id=ID&key=APIKEY</code> (admin protected if your ADMIN_TOKEN is set)</div>
      <div style="margin-top:10px;display:grid;gap:8px;">
        <input id="ws-id" placeholder="Applicant ID (XID)" />
        <input id="ws-key" placeholder="Applicant API Key (they must give you one)" />
        <button class="h-btn" id="ws-fetch">Fetch Workstats</button>
      </div>
      <div class="muted" style="margin-top:10px;">Tip: Tap “Workstats” on an application to autofill the ID.</div>
    `;
    wrap.appendChild(card);

    const out = document.createElement("div");
    out.className = "card";
    out.innerHTML = `
      <div style="font-weight:900;">Result</div>
      <textarea id="ws-out" readonly></textarea>
    `;
    wrap.appendChild(out);

    const idInp = qs("#ws-id", wrap);
    const keyInp = qs("#ws-key", wrap);
    const outTa = qs("#ws-out", wrap);

    idInp.value = st.selectedApplicantId || "";
    keyInp.value = st.applicantKey || "";
    outTa.value = st.workstatsJson || "";

    qs("#ws-fetch", wrap).onclick = async () => {
      const uid = (idInp.value || "").trim();
      const key = (keyInp.value || "").trim();
      if (!uid || !key) return toastMsg("Missing id or key");

      st.selectedApplicantId = uid;
      st.applicantKey = key;
      S.set("h7ds_last_applicant_key", key); // optional convenience
      try {
        const url = withAdmin(`${BASE_URL}/api/applicant?id=${encodeURIComponent(uid)}&key=${encodeURIComponent(key)}`);
        const res = await reqJSON(url, "GET");
        if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
        const pretty = JSON.stringify(res.workstats || {}, null, 2);
        st.workstatsJson = pretty;
        outTa.value = pretty;
        toastMsg("Workstats loaded");
      } catch (e) {
        outTa.value = "";
        st.workstatsJson = "";
        toastMsg("Failed (admin token? bad key?)");
      }
    };

    return wrap;
  }

  function viewSettings() {
    const wrap = document.createElement("div");

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="font-weight:900;">Settings</div>
      <div class="muted">If your server has ADMIN_TOKEN set, you must put the same token here.</div>
      <div style="margin-top:10px;display:grid;gap:8px;">
        <input id="adm" placeholder="Admin token (optional)" />
        <button class="h-btn" id="save">Save</button>
        <button class="h-btn" id="test">Test Connection</button>
      </div>
      <div class="muted" style="margin-top:10px;">
        Test calls: <code>/api/applications</code>. If unauthorized, your ADMIN_TOKEN doesn’t match.
      </div>
    `;
    wrap.appendChild(card);

    const adm = qs("#adm", wrap);
    adm.value = st.adminToken || "";

    qs("#save", wrap).onclick = () => {
      st.adminToken = (adm.value || "").trim();
      S.set("h7ds_admin_token", st.adminToken);
      toastMsg("Saved");
    };

    qs("#test", wrap).onclick = async () => {
      try {
        const res = await reqJSON(withAdmin(`${BASE_URL}/api/applications`), "GET");
        if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
        toastMsg(`OK (${(res.rows || []).length} rows)`);
        st.apps = res.rows || [];
        st.last = nowNice();
        st.tab = "apps";
        render();
      } catch (e) {
        toastMsg("Test failed (service down or token wrong)");
      }
    };

    return wrap;
  }

  // =========================
  // DATA
  // =========================
  async function refreshNow(showToastOnFail) {
    try {
      const res = await reqJSON(withAdmin(`${BASE_URL}/api/applications`), "GET");
      if (!res || res.ok !== true) throw new Error(res?.error || "bad response");
      st.apps = res.rows || [];
      st.last = nowNice();
      const lastEl = qs("#h-last", panel);
      if (lastEl) lastEl.textContent = st.last;
      if (st.tab === "apps") render();
    } catch (e) {
      if (showToastOnFail) toastMsg("Fetch failed (token/service?)");
    }
  }

  function startPolling() {
    stopPolling();
    refreshNow(false);
    st.timer = setInterval(() => {
      if (panel.style.display === "block") refreshNow(false);
    }, POLL_MS);
  }
  function stopPolling() {
    if (st.timer) clearInterval(st.timer);
    st.timer = null;
  }

  // =========================
  // OPEN/CLOSE (CLICK MUST WORK)
  // =========================
  function toggle(open) {
    const isOpen = panel.style.display === "block";
    const next = open ?? !isOpen;
    panel.style.display = next ? "block" : "none";
    if (next) startPolling();
    else stopPolling();
  }

  render();

  // =========================
  // DRAGGING (POINTER EVENTS) - FIXES "NOT OPENING"
  // We only toggle if it was a TAP (not a drag).
  // =========================
  function makeDraggableTap(node, which) {
    let down = false;
    let moved = false;
    let sx = 0, sy = 0, ox = 0, oy = 0;

    node.addEventListener("pointerdown", (e) => {
      // only left click / touch
      down = true;
      moved = false;

      sx = e.clientX;
      sy = e.clientY;

      const r = node.getBoundingClientRect();
      ox = r.left;
      oy = r.top;

      node.setPointerCapture?.(e.pointerId);

      // lock to left/top for dragging
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
        pos.btnLeft = Math.round(r
