// ==UserScript==
// @name         7DS*: Hiring Scan 💼 (Wrath Theme + Draggable + Search + Submit)
// @namespace    7ds-hiring-scan
// @version      1.1.0
// @description  💼 Hiring overlay: recruiter search + player opt-in submit (manual or verified via player's key). Draggable badge, tap to open/close.
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

  const BASE_URL = "https://sevends-hiring-scan.onrender.com"; // change if needed

  // Recruiter-only token (keep private). Players do NOT need this.
  const ADMIN_TOKEN = ""; // set this for recruiter searches

  const POS_KEY = "hiringScanPosV1";
  const OPEN_KEY = "hiringScanOpenV1";
  const TAB_KEY = "hiringScanTabV1";

  const DEFAULT_POS = { top: 160, right: 12 };
  const state = {
    open: !!GM_getValue(OPEN_KEY, false),
    tab: GM_getValue(TAB_KEY, "recruiter"),
    pos: GM_getValue(POS_KEY, null) || DEFAULT_POS,
  };

  function httpJson(method, url, bodyObj) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        data: bodyObj ? JSON.stringify(bodyObj) : undefined,
        onload: (r) => {
          try { resolve(JSON.parse(r.responseText || "{}")); }
          catch (e) { reject(e); }
        },
        onerror: reject,
        ontimeout: reject,
        timeout: 15000,
      });
    });
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  GM_addStyle(`
    #hs-badge, #hs-panel { all: initial; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Arial, sans-serif; }
    #hs-badge {
      position: fixed; z-index: 999999;
      width: 46px; height: 46px; border-radius: 16px;
      display:flex; align-items:center; justify-content:center;
      background: radial-gradient(circle at 30% 30%, rgba(255,215,0,0.35), rgba(255,215,0,0.10));
      border: 1px solid rgba(255,215,0,0.35);
      box-shadow: 0 10px 24px rgba(0,0,0,0.45);
      user-select:none; -webkit-user-select:none; touch-action:none;
    }
    #hs-badge span { font-size: 22px; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6)); }
    #hs-panel {
      position: fixed; z-index: 999998;
      width: 344px; max-width: calc(100vw - 18px);
      border-radius: 16px; padding: 12px; color: #e9eef5;
      background: linear-gradient(180deg, rgba(25,35,50,0.92), rgba(12,16,24,0.92));
      border: 1px solid rgba(255,255,255,0.10);
      box-shadow: 0 14px 30px rgba(0,0,0,0.55);
      backdrop-filter: blur(6px);
    }
    #hs-title { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom: 8px; }
    #hs-title b { font-size: 14px; letter-spacing: 0.3px; }
    #hs-mini { font-size: 12px; opacity: 0.8; }
    #hs-tabs { display:flex; gap:8px; margin: 8px 0 10px; }
    .hs-tab {
      flex:1; text-align:center; padding:8px 10px; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(0,0,0,0.20);
      color:#e9eef5; font-weight: 800; font-size: 12px;
    }
    .hs-tab.on {
      border: 1px solid rgba(255,215,0,0.35);
      background: rgba(255,215,0,0.12);
      color: #ffe7a6;
    }
    #hs-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    #hs-panel label { display:block; font-size: 11px; opacity: 0.85; margin: 8px 0 4px; }
    #hs-panel input, #hs-panel select, #hs-panel textarea {
      width: 100%; box-sizing: border-box;
      padding: 9px 10px; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(0,0,0,0.25);
      color: #e9eef5; outline: none; font-size: 13px;
    }
    #hs-panel textarea { min-height: 54px; resize: vertical; }
    #hs-actions { display:flex; gap:8px; margin-top: 10px; }
    #hs-actions button {
      flex:1; padding: 10px 10px; border-radius: 12px;
      border: 1px solid rgba(255,215,0,0.35);
      background: rgba(255,215,0,0.12);
      color: #ffe7a6; font-weight: 900; font-size: 13px;
    }
    #hs-actions button.secondary {
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.18);
      color:#e9eef5;
      font-weight: 800;
    }
    #hs-actions button:active { transform: translateY(1px); }
    #hs-results { margin-top: 10px; max-height: 46vh; overflow:auto; }
    .hs-row {
      display:flex; justify-content:space-between; gap:8px;
      padding: 8px 10px; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(0,0,0,0.22);
      margin-bottom: 8px;
    }
    .hs-left { display:flex; flex-direction:column; gap:2px; min-width: 0; }
    .hs-name a { color:#d9e7ff; text-decoration:none; font-weight: 900; font-size: 13px; }
    .hs-sub { font-size: 11px; opacity: 0.8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 210px; }
    .hs-right { text-align:right; font-size: 11px; opacity: 0.95; }
    .hs-pill { display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid rgba(255,255,255,0.12); margin-top:4px; }
    .hs-msg { font-size: 12px; opacity: 0.85; line-height: 1.35; }
    .hs-warn { font-size: 11px; opacity: 0.75; line-height: 1.35; margin-top: 8px; }
  `);

  const badge = document.createElement("div");
  badge.id = "hs-badge";
  badge.style.top = (state.pos.top ?? DEFAULT_POS.top) + "px";
  badge.style.right = (state.pos.right ?? DEFAULT_POS.right) + "px";
  badge.innerHTML = `<span>💼</span>`;

  const panel = document.createElement("div");
  panel.id = "hs-panel";
  panel.style.display = state.open ? "block" : "none";

  function placePanel() {
    const top = parseInt(badge.style.top, 10) || 160;
    panel.style.top = Math.max(10, top - 10) + "px";
    panel.style.right = "64px";
  }

  panel.innerHTML = `
    <div id="hs-title">
      <b>7DS Hiring Scan</b>
      <div id="hs-mini">tap 💼 to close</div>
    </div>

    <div id="hs-tabs">
      <button class="hs-tab" id="tab-recruiter">Recruiter</button>
      <button class="hs-tab" id="tab-submit">Submit</button>
    </div>

    <div id="view-recruiter">
      <div id="hs-grid">
        <div>
          <label>Job status</label>
          <select id="hs-job">
            <option value="any">Any</option>
            <option value="none">Unemployed (none)</option>
            <option value="company">Company</option>
            <option value="city">City job</option>
          </select>
        </div>
        <div>
          <label>Sort</label>
          <select id="hs-sort">
            <option value="total">Total</option>
            <option value="man">MAN</option>
            <option value="intel">INT</option>
            <option value="endu">END</option>
            <option value="updated">Updated</option>
          </select>
        </div>

        <div><label>MAN min</label><input id="hs-min-man" inputmode="numeric" placeholder="0"></div>
        <div><label>MAN max</label><input id="hs-max-man" inputmode="numeric" placeholder="999999999"></div>

        <div><label>INT min</label><input id="hs-min-int" inputmode="numeric" placeholder="0"></div>
        <div><label>INT max</label><input id="hs-max-int" inputmode="numeric" placeholder="999999999"></div>

        <div><label>END min</label><input id="hs-min-end" inputmode="numeric" placeholder="0"></div>
        <div><label>END max</label><input id="hs-max-end" inputmode="numeric" placeholder="999999999"></div>

        <div><label>Total min</label><input id="hs-min-total" inputmode="numeric" placeholder="0"></div>
        <div><label>Total max</label><input id="hs-max-total" inputmode="numeric" placeholder="999999999"></div>
      </div>

      <div id="hs-actions">
        <button id="hs-search">Search</button>
        <button class="secondary" id="hs-clear">Clear</button>
      </div>

      <div id="hs-results"></div>
    </div>

    <div id="view-submit" style="display:none;">
      <div class="hs-msg">
        Opt-in here so recruiters can find you. You can submit manually, or paste a limited API key to auto-verify.
      </div>

      <label>Your Torn ID</label>
      <input id="sub-id" inputmode="numeric" placeholder="123456">

      <label>Your name (optional)</label>
      <input id="sub-name" placeholder="YourName">

      <label>Job status</label>
      <select id="sub-job">
        <option value="unknown">Unknown</option>
        <option value="none">Unemployed (none)</option>
        <option value="company">Company</option>
        <option value="city">City job</option>
      </select>

      <label>Company/City job name (optional)</label>
      <input id="sub-jobname" placeholder="e.g. 10* AN or Grocer">

      <div id="hs-grid" style="margin-top:6px;">
        <div><label>MAN</label><input id="sub-man" inputmode="numeric" placeholder="0"></div>
        <div><label>INT</label><input id="sub-int" inputmode="numeric" placeholder="0"></div>
        <div><label>END</label><input id="sub-end" inputmode="numeric" placeholder="0"></div>
        <div><label>Total (optional)</label><input id="sub-total" inputmode="numeric" placeholder="auto"></div>
      </div>

      <label>Note (optional)</label>
      <textarea id="sub-note" placeholder="What job you want, availability, etc"></textarea>

      <div id="hs-actions">
        <button id="btn-submit-manual">Submit (manual)</button>
        <button class="secondary" id="btn-submit-key">Submit (verify with key)</button>
      </div>

      <label style="margin-top:10px;">Limited API key (optional)</label>
      <input id="sub-key" placeholder="Paste key here (used once to verify; not stored)">

      <div class="hs-warn">
        Tip: Only use a key you’re okay sharing for verification. The server stores your stats & job status, not the key.
      </div>

      <div id="sub-status" class="hs-msg" style="margin-top:10px;"></div>
    </div>
  `;

  document.body.appendChild(panel);
  document.body.appendChild(badge);
  placePanel();

  function setOpen(v) {
    state.open = v;
    GM_setValue(OPEN_KEY, !!v);
    panel.style.display = v ? "block" : "none";
    if (v) placePanel();
  }

  badge.addEventListener("click", () => setOpen(!state.open));

  // drag logic
  let dragging = false, startY = 0, startTop = 0;
  function onDown(clientY) {
    dragging = true;
    startY = clientY;
    startTop = parseInt(badge.style.top, 10) || DEFAULT_POS.top;
  }
  function onMove(clientY) {
    if (!dragging) return;
    const dy = clientY - startY;
    const nextTop = Math.min(window.innerHeight - 60, Math.max(10, startTop + dy));
    badge.style.top = nextTop + "px";
    placePanel();
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    const top = parseInt(badge.style.top, 10) || DEFAULT_POS.top;
    const right = parseInt(badge.style.right, 10) || DEFAULT_POS.right;
    GM_setValue(POS_KEY, { top, right });
  }
  badge.addEventListener("mousedown", (e) => onDown(e.clientY));
  window.addEventListener("mousemove", (e) => onMove(e.clientY));
  window.addEventListener("mouseup", onUp);
  badge.addEventListener("touchstart", (e) => onDown(e.touches[0].clientY), { passive: true });
  window.addEventListener("touchmove", (e) => onMove(e.touches[0].clientY), { passive: true });
  window.addEventListener("touchend", onUp);

  const $ = (id) => panel.querySelector(id);

  function setTab(tab) {
    state.tab = tab;
    GM_setValue(TAB_KEY, tab);
    $("#view-recruiter").style.display = (tab === "recruiter") ? "block" : "none";
    $("#view-submit").style.display = (tab === "submit") ? "block" : "none";
    $("#tab-recruiter").classList.toggle("on", tab === "recruiter");
    $("#tab-submit").classList.toggle("on", tab === "submit");
  }

  $("#tab-recruiter").addEventListener("click", () => setTab("recruiter"));
  $("#tab-submit").addEventListener("click", () => setTab("submit"));
  setTab(state.tab);

  function valNumSel(sel, fallback = "") {
    const v = ($(sel).value || "").trim();
    return v === "" ? fallback : v.replace(/[^0-9]/g, "");
  }

  function setResults(html) { $("#hs-results").innerHTML = html; }
  function setStatus(msg) { $("#sub-status").innerHTML = msg; }

  async function runSearch() {
    if (!ADMIN_TOKEN) {
      setResults(`<div class="hs-row"><div class="hs-left"><div class="hs-sub">Recruiter: set ADMIN_TOKEN in the script.</div></div></div>`);
      return;
    }

    setResults(`<div class="hs-row"><div class="hs-left"><div class="hs-sub">Searching...</div></div></div>`);

    const params = new URLSearchParams({
      token: ADMIN_TOKEN,
      job_type: $("#hs-job").value,
      sort: $("#hs-sort").value,
      min_man: valNumSel("#hs-min-man"),
      max_man: valNumSel("#hs-max-man"),
      min_int: valNumSel("#hs-min-int"),
      max_int: valNumSel("#hs-max-int"),
      min_end: valNumSel("#hs-min-end"),
      max_end: valNumSel("#hs-max-end"),
      min_total: valNumSel("#hs-min-total"),
      max_total: valNumSel("#hs-max-total"),
    });

    const data = await httpJson("GET", `${BASE_URL}/api/search?${params.toString()}`).catch(() => null);

    if (!data || !data.ok) {
      setResults(`<div class="hs-row"><div class="hs-left"><div class="hs-sub">Error (bad token / service down).</div></div></div>`);
      return;
    }
    if (!data.rows || !data.rows.length) {
      setResults(`<div class="hs-row"><div class="hs-left"><div class="hs-sub">No matches.</div></div></div>`);
      return;
    }

    const html = data.rows.map(r => {
      const jobLabel =
        r.job_type === "none" ? "Unemployed" :
        r.job_type === "company" ? "Company" :
        r.job_type === "city" ? "City job" : "Unknown";
      const jobName = r.job_name ? ` • ${esc(r.job_name)}` : "";
      const verify = r.verified ? `<span class="hs-pill">verified</span>` : `<span class="hs-pill">opt-in</span>`;
      return `
        <div class="hs-row">
          <div class="hs-left">
            <div class="hs-name"><a target="_blank" href="https://www.torn.com/profiles.php?XID=${r.id}">${esc(r.name || ("ID " + r.id))}</a></div>
            <div class="hs-sub">${jobLabel}${jobName}</div>
            <div class="hs-sub">${esc(r.note || "")}</div>
          </div>
          <div class="hs-right">
            <div>MAN ${Number(r.man).toLocaleString()}</div>
            <div>INT ${Number(r.intel).toLocaleString()}</div>
            <div>END ${Number(r.endu).toLocaleString()}</div>
            <div><b>Total ${Number(r.total).toLocaleString()}</b></div>
            ${verify}
          </div>
        </div>
      `;
    }).join("");

    setResults(html);
  }

  $("#hs-search").addEventListener("click", runSearch);
  $("#hs-clear").addEventListener("click", () => {
    ["#hs-min-man","#hs-max-man","#hs-min-int","#hs-max-int","#hs-min-end","#hs-max-end","#hs-min-total","#hs-max-total"].forEach(s => $(s).value = "");
    $("#hs-job").value = "any";
    $("#hs-sort").value = "total";
    setResults("");
  });

  async function submitManual() {
    const torn_id = valNumSel("#sub-id");
    if (!torn_id) { setStatus("⚠️ Enter your Torn ID."); return; }

    const man = valNumSel("#sub-man","0");
    const intel = valNumSel("#sub-int","0");
    const endu = valNumSel("#sub-end","0");
    const total = valNumSel("#sub-total","");

    const payload = {
      torn_id: Number(torn_id),
      name: ($("#sub-name").value || "").trim(),
      job_type: $("#sub-job").value,
      job_name: ($("#sub-jobname").value || "").trim(),
      man: Number(man || 0),
      intel: Number(intel || 0),
      endu: Number(endu || 0),
      total: total ? Number(total) : undefined,
      note: ($("#sub-note").value || "").trim(),
    };

    setStatus("Submitting...");
    const res = await httpJson("POST", `${BASE_URL}/api/submit`, payload).catch(() => null);
    if (!res || !res.ok) { setStatus("❌ Submit failed."); return; }
    setStatus("✅ Submitted (manual).");
  }

  async function submitKeyVerified() {
    const key = ($("#sub-key").value || "").trim();
    if (!key) { setStatus("⚠️ Paste your limited API key first."); return; }

    setStatus("Verifying with Torn API...");
    const res = await httpJson("POST", `${BASE_URL}/api/submit_key`, {
      key,
      note: ($("#sub-note").value || "").trim(),
    }).catch(() => null);

    if (!res || !res.ok) {
      setStatus("❌ Verify failed (invalid key / API error).");
      return;
    }

    // Clear key box after use
    $("#sub-key").value = "";
    setStatus(`✅ Verified & submitted: ${esc(res.name)} • ${esc(res.job_type)} • Total ${Number(res.total).toLocaleString()}`);
  }

  $("#btn-submit-manual").addEventListener("click", submitManual);
  $("#btn-submit-key").addEventListener("click", submitKeyVerified);

})();
