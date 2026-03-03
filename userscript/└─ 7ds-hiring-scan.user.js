// ==UserScript==
// @name         7DS*: Hiring Scan 💼 (Wrath Theme + TOTAL Scan + Employment Integrated)
// @namespace    7ds-wrath-hiring-scan
// @version      1.4.0
// @description  Draggable 💼 icon overlay like war-bot. Tap 💼 to open/close. HoF TOTAL scan by range with employment integrated (none/company/city/unknown) via opt-in DB join.
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

  const BASE_URL = "https://sevends-hiring-scan.onrender.com";

  const POS_KEY  = "hiring_scan_briefcase_pos_v1";
  const OPEN_KEY = "hiring_scan_open_v5";
  const TOK_KEY  = "hiring_scan_admin_token_v5";
  const CFG_KEY  = "hiring_scan_cfg_v5";

  function gmGet(k, d){ try { return GM_getValue(k, d); } catch { return d; } }
  function gmSet(k, v){ try { GM_setValue(k, v); } catch {} }

  function httpJson(method, url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        data: body ? JSON.stringify(body) : null,
        headers: { "Content-Type": "application/json", ...headers },
        onload: (res) => {
          try { resolve(JSON.parse(res.responseText || "{}")); }
          catch (e) { reject(e); }
        },
        onerror: reject,
      });
    });
  }

  function copyToClipboard(text) {
    try { navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  GM_addStyle(`
    /* 💼 ICON */
    #wrath-hiring-icon{
      position:fixed; z-index:999999;
      width:54px; height:54px;
      border-radius:18px;
      background: radial-gradient(circle at 30% 20%, rgba(255,255,255,.14), rgba(255,255,255,0) 42%),
                  linear-gradient(180deg, #1b2436, #0f1420);
      border:1px solid rgba(255,255,255,.12);
      box-shadow:0 12px 34px rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center;
      user-select:none; cursor:grab;
      right:12px; top:160px;
    }
    #wrath-hiring-icon:active{ cursor:grabbing; }
    #wrath-hiring-icon span{ font-size:24px; filter: drop-shadow(0 2px 6px rgba(0,0,0,.65)); }

    /* PANEL */
    #wrath-hiring-panel{
      position:fixed; z-index:999999;
      right:14px; top:86px;
      width:min(600px, calc(100vw - 28px));
      max-height:min(80vh, 780px);
      overflow:hidden;
      border-radius:18px;
      background: rgba(12,16,24,.92);
      backdrop-filter: blur(10px);
      border:1px solid rgba(255,255,255,.10);
      box-shadow:0 18px 50px rgba(0,0,0,.60);
      color:#e8eefc;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    #wrath-hiring-panel header{
      padding:12px; display:flex; align-items:center; gap:10px;
      border-bottom:1px solid rgba(255,255,255,.08);
    }
    #wrath-hiring-panel header .title{ font-weight:900; letter-spacing:.2px; }
    #wrath-hiring-panel header .pill{
      margin-left:auto; font-size:12px;
      padding:4px 10px; border-radius:999px;
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.10);
      font-weight:700;
    }
    #wrath-hiring-panel .body{
      padding:12px; overflow:auto;
      max-height: calc(min(80vh, 780px) - 54px);
    }
    .row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
    .ctl{
      flex:1 1 auto;
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 12px;
      padding: 8px 10px;
      color: #e8eefc;
      outline:none;
    }
    .btn{
      background: linear-gradient(180deg,#2a3a5e,#17243e);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 12px;
      padding: 8px 10px;
      color:#e8eefc;
      cursor:pointer;
      font-weight:900;
      white-space:nowrap;
    }
    .btn:active{ transform: translateY(1px); }
    .muted{ opacity:.78; font-size:12px; }
    .sectionTitle{ font-weight:900; margin:12px 0 8px; opacity:.95; }
  `);

  // ---------- 💼 ICON ----------
  const icon = document.createElement("div");
  icon.id = "wrath-hiring-icon";
  icon.title = "Hiring Scan (drag / tap)";
  icon.innerHTML = `<span>💼</span>`;
  document.body.appendChild(icon);

  // ---------- PANEL ----------
  const panel = document.createElement("div");
  panel.id = "wrath-hiring-panel";
  panel.style.display = gmGet(OPEN_KEY, false) ? "block" : "none";
  panel.innerHTML = `
    <header>
      <div class="title">💼 Hiring Scan</div>
      <div class="pill" id="hs-pill">idle</div>
    </header>
    <div class="body">

      <div class="row">
        <input class="ctl" id="hs-token" placeholder="ADMIN_TOKEN (stored locally)" />
        <button class="btn" id="hs-save">Save</button>
      </div>

      <div class="row">
        <button class="btn" id="hs-copy">Copy recruit message</button>
        <button class="btn" id="hs-apply">Open apply page</button>
      </div>

      <div class="sectionTitle">TOTAL Scan (employment integrated)</div>

      <div class="row">
        <input class="ctl" id="hs-min" inputmode="numeric" placeholder="Min TOTAL workstats" />
        <input class="ctl" id="hs-max" inputmode="numeric" placeholder="Max TOTAL workstats" />
      </div>

      <div class="row">
        <input class="ctl" id="hs-limit" inputmode="numeric" placeholder="Limit (1-200)" />
        <select class="ctl" id="hs-emp">
          <option value="all">Employment: All</option>
          <option value="none">No company</option>
          <option value="company">In a company</option>
          <option value="city">City job</option>
          <option value="unknown">Unknown (not opted-in)</option>
        </select>
        <button class="btn" id="hs-scan">Scan</button>
      </div>

      <div class="row">
        <select class="ctl" id="hs-dd">
          <option value="">No results yet…</option>
        </select>
      </div>

      <div class="muted">
        Employment shows only for opted-in players; everyone else is <b>unknown</b>.
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const setStatus = (t) => { $("#hs-pill").textContent = t; };

  // restore token
  $("#hs-token").value = gmGet(TOK_KEY, "");

  // restore last scan inputs
  const cfg = gmGet(CFG_KEY, { min:"", max:"", limit:"50", emp:"all" });
  $("#hs-min").value = cfg.min || "";
  $("#hs-max").value = cfg.max || "";
  $("#hs-limit").value = cfg.limit || "50";
  $("#hs-emp").value = cfg.emp || "all";

  $("#hs-save").onclick = () => {
    gmSet(TOK_KEY, ($("#hs-token").value || "").trim());
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 700);
  };

  $("#hs-copy").onclick = async () => {
    const token = (gmGet(TOK_KEY, "") || "").trim();
    if (!token) { setStatus("token?"); return; }
    try {
      const data = await httpJson("GET", `${BASE_URL}/api/applicants`, null, { "X-ADMIN-TOKEN": token });
      const msg = (data && data.message) ? data.message : "looking to hire if you can reply with working stats or an limited API key";
      copyToClipboard(msg);
    } catch {
      copyToClipboard("looking to hire if you can reply with working stats or an limited API key");
    }
    setStatus("copied");
    setTimeout(() => setStatus("idle"), 900);
  };

  $("#hs-apply").onclick = () => window.open(`${BASE_URL}/apply`, "_blank", "noopener,noreferrer");

  $("#hs-scan").onclick = async () => {
    const token = (gmGet(TOK_KEY, "") || "").trim();
    const min = ($("#hs-min").value || "").trim();
    const max = ($("#hs-max").value || "").trim();
    let limit = ($("#hs-limit").value || "50").trim();
    const emp = ($("#hs-emp").value || "all").trim();

    if (!token) { setStatus("token?"); return; }
    if (!min || !max) { setStatus("min/max?"); return; }
    if (!limit) limit = "50";

    gmSet(CFG_KEY, { min, max, limit, emp });

    setStatus("loading");
    try {
      const qs = new URLSearchParams({ min, max, limit, emp });
      const data = await httpJson("GET", `${BASE_URL}/state?${qs.toString()}`, null, { "X-ADMIN-TOKEN": token });
      if (!data.ok) throw new Error(data.error || "failed");

      const rows = data.rows || [];
      const dd = $("#hs-dd");
      dd.innerHTML = "";

      if (!rows.length) {
        dd.innerHTML = `<option value="">No matches</option>`;
        setStatus("0");
        return;
      }

      for (const r of rows) {
        const empLabel = String(r.employment || "unknown").toUpperCase();
        const comp = r.company_name ? ` | ${r.company_name}` : "";
        const jt = r.job_title ? ` (${r.job_title})` : "";
        const label = `${r.name} [${r.user_id}] — ${Number(r.value).toLocaleString()} | ${empLabel}${comp}${jt}`;
        const opt = document.createElement("option");
        opt.value = String(r.user_id);
        opt.textContent = label;
        dd.appendChild(opt);
      }

      dd.onchange = () => {
        const xid = dd.value;
        if (xid) window.open(`https://www.torn.com/profiles.php?XID=${xid}`, "_blank", "noopener,noreferrer");
      };

      setStatus(String(rows.length));
    } catch {
      $("#hs-dd").innerHTML = `<option value="">Error (token / logs)</option>`;
      setStatus("error");
    }
  };

  // ---------- Drag + Tap-to-open/close ----------
  let pos = gmGet(POS_KEY, { right: 12, top: 160 });
  function applyPos(){ icon.style.right = `${pos.right}px`; icon.style.top = `${pos.top}px`; }
  applyPos();

  let drag = null;
  icon.addEventListener("pointerdown", (e) => {
    icon.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, sr: pos.right, st: pos.top };
    icon.dataset.dragging = "0";
  });

  icon.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) icon.dataset.dragging = "1";
    pos.right = Math.max(6, drag.sr - dx);
    pos.top   = Math.max(60, drag.st + dy);
    applyPos();
  });

  icon.addEventListener("pointerup", () => {
    if (!drag) return;
    gmSet(POS_KEY, pos);
    drag = null;
    setTimeout(() => (icon.dataset.dragging = "0"), 0);
  });

  function togglePanel() {
    const open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "block";
    gmSet(OPEN_KEY, !open);
  }

  // tap 💼 opens AND closes
  icon.addEventListener("click", () => {
    if (icon.dataset.dragging === "1") return;
    togglePanel();
  });

})();
