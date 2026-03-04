// ==UserScript==
// @name         7DS*: Peace Hub 💼 (High-Value Theme + Draggable Briefcase + Click to Open/Close)
// @namespace    7ds-peace-hub
// @version      1.1.0
// @description  Company owner hub: employees, trains, contracts, HoF working stat scan. Briefcase stays on top, is draggable, and CLICK toggles open/close.
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

  // ================= USER CONFIG =================
  const BASE_URL = "https://sevends-hiring-scan.onrender.com"; // <-- CHANGE to your Render URL
  // ==============================================

  // Storage keys
  const K_ADMIN = "hub_admin_key_v1";
  const K_API   = "hub_api_key_v1";
  const K_TOK   = "hub_session_token_v1";
  const K_COMP  = "hub_company_ids_v1";
  const K_SEL   = "hub_selected_company_v1";

  const el = (tag, attrs = {}, html = "") => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => (n[k] = v));
    if (html) n.innerHTML = html;
    return n;
  };

  const getVal = (k, d = "") => { try { return GM_getValue(k, d); } catch { return d; } };
  const setVal = (k, v) => { try { GM_setValue(k, v); } catch {} };

  function apiReq(method, url, body, token) {
    return new Promise((resolve, reject) => {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["X-Session-Token"] = token;

      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data: body ? JSON.stringify(body) : null,
        onload: (r) => {
          try { resolve(JSON.parse(r.responseText)); }
          catch (e) { reject(e); }
        },
        onerror: reject,
      });
    });
  }
  const apiGet  = (url, token) => apiReq("GET",  url, null, token);
  const apiPost = (url, body, token) => apiReq("POST", url, body, token);

  // ================== HIGH VALUE THEME ==================
  GM_addStyle(`
    :root{
      --hv-bg:#070A0F;
      --hv-panel:#0B1019;
      --hv-card:#0A0F16;
      --hv-border:#263548;
      --hv-border2:#364C67;
      --hv-text:#E9EEF6;
      --hv-muted:rgba(233,238,246,.72);
      --hv-gold:#E6C36A;
      --hv-gold2:#B8872B;
      --hv-blue:#8BD0FF;
      --hv-danger:#ff5b5b;
      --hv-warn:#ffcc66;
      --hv-shadow:0 18px 55px rgba(0,0,0,.62);
    }

    /* Briefcase always OVER the overlay */
    #p7ds-bag {
      position:fixed;
      right:16px; bottom:118px;
      z-index:99999999;
      width:60px; height:60px;               /* larger */
      border-radius:18px;
      background: radial-gradient(140% 140% at 15% 10%, rgba(230,195,106,.25) 0%, rgba(11,16,25,1) 60%);
      border:1px solid var(--hv-border2);
      display:flex; align-items:center; justify-content:center;
      box-shadow: var(--hv-shadow);
      cursor:grab;
      user-select:none;
      -webkit-tap-highlight-color: transparent;
    }
    #p7ds-bag:active{ cursor:grabbing; }
    #p7ds-bag .icon{
      font-size:28px;                         /* larger icon */
      filter: drop-shadow(0 2px 8px rgba(0,0,0,.5));
    }
    #p7ds-bag .badge{
      position:absolute; top:-7px; right:-7px;
      min-width:22px; height:22px; padding:0 6px;
      border-radius:999px;
      background: var(--hv-danger);
      color:#fff;
      font-weight:800;
      font-size:12px;
      display:none; align-items:center; justify-content:center;
      border:2px solid var(--hv-bg);
    }

    #p7ds-panel {
      position:fixed;
      right:16px; bottom:188px;
      z-index:9999990;                        /* below bag */
      width:360px; max-height:72vh; overflow:auto;
      border-radius:18px;
      background: linear-gradient(180deg, rgba(15,22,34,.98) 0%, rgba(8,11,16,.98) 100%);
      border:1px solid var(--hv-border2);
      box-shadow: var(--hv-shadow);
      display:none;
      backdrop-filter: blur(8px);
    }
    #p7ds-panel *{ box-sizing:border-box; font-family:system-ui; }

    #p7ds-head{
      padding:10px 12px;
      border-bottom:1px solid rgba(54,76,103,.55);
      display:flex; gap:10px; align-items:center;
      background: linear-gradient(90deg, rgba(230,195,106,.12) 0%, rgba(11,16,25,.2) 60%);
    }
    #p7ds-title{
      font-weight:900; font-size:13px; letter-spacing:.35px;
      color: var(--hv-text);
      text-transform: uppercase;
    }
    #p7ds-sub{ color: var(--hv-muted); font-size:12px; }

    #p7ds-tabs{
      display:flex; gap:6px; padding:10px 12px;
      flex-wrap:wrap;
      border-bottom:1px solid rgba(54,76,103,.35);
    }

    /* Smaller buttons + high-value feel */
    .p7btn{
      background: rgba(6,10,15,.92);
      border:1px solid rgba(38,53,72,.95);
      color: var(--hv-text);
      border-radius:12px;
      padding:6px 8px;                        /* smaller */
      font-size:11px;                         /* smaller */
      cursor:pointer;
      transition: transform .06s ease, border-color .12s ease, box-shadow .12s ease;
    }
    .p7btn:hover{ border-color: rgba(230,195,106,.55); }
    .p7btn:active{ transform: translateY(1px); }
    .p7btn.on{
      border-color: rgba(230,195,106,.9);
      box-shadow: 0 0 0 2px rgba(230,195,106,.12) inset;
    }
    .p7btn.gold{
      border-color: rgba(230,195,106,.9);
      background: linear-gradient(180deg, rgba(230,195,106,.18), rgba(6,10,15,.92));
    }

    #p7ds-body{ padding:12px; }

    .card{
      background: rgba(6,10,15,.88);
      border:1px solid rgba(38,53,72,.9);
      border-radius:14px;
      padding:10px;
      margin:10px 0;
    }

    .row{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }

    input,select,textarea{
      width:100%;
      padding:8px;                            /* smaller */
      border-radius:12px;
      border:1px solid rgba(38,53,72,.9);
      background: rgba(4,7,12,.95);
      color: var(--hv-text);
      outline:none;
    }
    input:focus,select:focus,textarea:focus{
      border-color: rgba(230,195,106,.65);
      box-shadow: 0 0 0 3px rgba(230,195,106,.10);
    }

    .mini{ font-size:12px; color: var(--hv-muted); }
    .pill{
      display:inline-block;
      padding:2px 8px;
      border-radius:999px;
      border:1px solid rgba(38,53,72,.95);
      font-size:11px;
      color: var(--hv-muted);
      margin-left:6px;
    }
    .pill.gold{ border-color: rgba(230,195,106,.55); color: rgba(230,195,106,.95); }
    .emp{
      display:flex; justify-content:space-between; gap:10px;
      padding:8px 0;
      border-bottom:1px dashed rgba(233,238,246,.08);
    }
    .emp:last-child{ border-bottom:none; }
    .bad{ color: var(--hv-danger); }
    .warn{ color: var(--hv-warn); }
    a{ color: var(--hv-blue); text-decoration:none; }
  `);

  // ================== UI ROOTS ==================
  const bag = el("div", { id: "p7ds-bag", title: "Company Hub" });
  const icon = el("div", { className: "icon" }, "💼");
  const badge = el("div", { className: "badge" }, "0");
  bag.appendChild(icon);
  bag.appendChild(badge);

  const panel = el("div", { id: "p7ds-panel" });
  panel.innerHTML = `
    <div id="p7ds-head">
      <div style="font-size:18px;filter:drop-shadow(0 2px 8px rgba(0,0,0,.45))">💼</div>
      <div style="flex:1">
        <div id="p7ds-title">Company Hub</div>
        <div id="p7ds-sub">Loading...</div>
      </div>
      <button class="p7btn" id="p7ds-seen" title="Mark notifications seen">Seen</button>
    </div>
    <div id="p7ds-tabs"></div>
    <div id="p7ds-body"></div>
  `;

  document.body.appendChild(panel);
  document.body.appendChild(bag);

  // ================== DRAG + CLICK TOGGLE (briefcase) ==================
  let dragging = false;
  let moved = false;
  let sx = 0, sy = 0, ox = 0, oy = 0;

  function startDrag(clientX, clientY) {
    dragging = true;
    moved = false;
    sx = clientX; sy = clientY;
    const r = bag.getBoundingClientRect();
    ox = r.left; oy = r.top;
  }

  function doDrag(clientX, clientY) {
    if (!dragging) return;
    const dx = clientX - sx;
    const dy = clientY - sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;

    const nx = ox + dx;
    const ny = oy + dy;

    bag.style.left = nx + "px";
    bag.style.top  = ny + "px";
    bag.style.right = "auto";
    bag.style.bottom = "auto";

    // keep panel near bag when open (nice UX)
    if (panel.style.display === "block") {
      panel.style.left = (nx - 300) + "px";
      panel.style.top  = (ny - 10) + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
  }

  function endDrag() { dragging = false; }

  // Touch
  bag.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startDrag(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });

  bag.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    doDrag(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });

  bag.addEventListener("touchend", () => endDrag());

  // Mouse
  bag.addEventListener("mousedown", (e) => {
    startDrag(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => doDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", () => endDrag());

  // CLICK toggles open/close (but ignore click after dragging)
  bag.addEventListener("click", () => {
    if (moved) { moved = false; return; }
    togglePanel();
  });

  function togglePanel() {
    const open = (panel.style.display === "block");
    panel.style.display = open ? "none" : "block";
    if (!open) {
      // Position panel near briefcase (but don't go off-screen too much)
      const r = bag.getBoundingClientRect();
      const left = Math.max(10, r.left - 320);
      const top  = Math.max(10, r.top - 10);
      panel.style.left = left + "px";
      panel.style.top  = top + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
  }

  // ================== APP ==================
  const tabsEl = panel.querySelector("#p7ds-tabs");
  const bodyEl = panel.querySelector("#p7ds-body");
  const subEl  = panel.querySelector("#p7ds-sub");
  const seenBtn= panel.querySelector("#p7ds-seen");

  const TABS = ["Employees","Trains","Contracts","Search","Broadcast","Settings"];
  let activeTab = "Employees";
  let state = null;

  function setBadge(n){
    if(n>0){ badge.style.display="flex"; badge.textContent=String(n); }
    else { badge.style.display="none"; }
  }
  function money(n){ try{return Number(n).toLocaleString();}catch{return String(n);} }

  function renderTabs(){
    tabsEl.innerHTML = "";
    TABS.forEach(t=>{
      const b = el("button",{className:"p7btn"},t);
      if(t===activeTab) b.classList.add("on");
      b.addEventListener("click",()=>{ activeTab=t; render(); });
      tabsEl.appendChild(b);
    });
  }

  function companyPicker(){
    const c = el("div",{className:"card"});
    const sel = el("select");
    (state.company_ids||[]).forEach(cid=>{
      const o = el("option");
      o.value = cid;
      o.textContent = `Company #${cid}`;
      sel.appendChild(o);
    });

    const saved = getVal(K_SEL,"");
    const cur = state.selected_company_id || (state.company_ids||[])[0] || "";
    sel.value = saved && (state.company_ids||[]).includes(saved) ? saved : cur;

    sel.addEventListener("change", async ()=>{
      setVal(K_SEL, sel.value);
      await refresh(sel.value);
    });

    c.appendChild(el("div",{className:"mini"}, `<b>Selected Company</b> <span class="pill gold">${sel.value || ""}</span>`));
    c.appendChild(sel);
    return c;
  }

  function renderEmployees(){
    const c = el("div",{className:"card"});
    const stats = state.stats||{};
    c.appendChild(el("div",{className:"mini"},
      `<b>Employees</b>
       <span class="pill gold">${stats.employee_count||0}</span>
       <span class="pill ${(stats.inactive_3d_plus||0)>0?"bad":""}">Inactive 3d+: ${stats.inactive_3d_plus||0}</span>`
    ));

    const list = el("div");
    (state.employees||[]).forEach(e=>{
      const row = el("div",{className:"emp"});
      const left = el("div",{},`<div><b>${e.name||"Unknown"}</b></div>
        <div class="mini">${e.position||""} ${e.inactive_days!=null?`• inactive ${e.inactive_days}d`:""}</div>`);
      const right = el("div",{style:"text-align:right"});
      const warn = (e.inactive_days!=null && e.inactive_days>=3) ? "bad":"";
      right.innerHTML = `
        <div class="mini ${warn}">MAN ${e.man!=null?money(e.man):"-"}</div>
        <div class="mini ${warn}">INT ${e.int!=null?money(e.int):"-"}</div>
        <div class="mini ${warn}">END ${e.end!=null?money(e.end):"-"}</div>
      `;
      row.appendChild(left); row.appendChild(right);
      list.appendChild(row);
    });
    c.appendChild(list);
    return c;
  }

  function renderTrains(token){
    const c = el("div",{className:"card"});
    c.appendChild(el("div",{className:"mini"},"<b>Train Tracker</b>"));

    const grid = el("div",{className:"row",style:"margin-top:8px"});
    const buyer = el("input",{placeholder:"Buyer name"});
    const amt   = el("input",{placeholder:"Trains bought",type:"number"});
    const note  = el("input",{placeholder:"Note (optional)"});
    const addBtn= el("button",{className:"p7btn gold",style:"grid-column:1/-1"},"Add Train Record");

    addBtn.addEventListener("click", async ()=>{
      await apiPost(`${BASE_URL}/api/trains/add`,{
        company_id: state.selected_company_id,
        buyer_name: buyer.value.trim(),
        trains_bought: Number(amt.value||0),
        note: note.value.trim()
      }, token);
      await refresh(state.selected_company_id);
    });

    [buyer,amt,note,addBtn].forEach(x=>grid.appendChild(x));
    c.appendChild(grid);

    (state.trains||[]).forEach(t=>{
      const r = el("div",{className:"card"});
      r.innerHTML = `
        <div><b>${t.buyer_name}</b>
          <span class="pill">Bought: ${t.trains_bought}</span>
          <span class="pill ${t.remaining===0?"warn":""}">Remaining: ${t.remaining}</span>
        </div>
        <div class="mini">${t.note||""}</div>
      `;
      const row = el("div",{className:"row",style:"margin-top:8px"});
      const used = el("input",{type:"number",value:String(t.trains_used||0),placeholder:"Used"});
      const save = el("button",{className:"p7btn"},"Save Used");
      const del  = el("button",{className:"p7btn"},"Delete");

      save.addEventListener("click", async ()=>{
        await apiPost(`${BASE_URL}/api/trains/set_used`,{id:t.id,trains_used:Number(used.value||0)}, token);
        await refresh(state.selected_company_id);
      });
      del.addEventListener("click", async ()=>{
        await apiPost(`${BASE_URL}/api/trains/delete`,{id:t.id}, token);
        await refresh(state.selected_company_id);
      });

      [used,save,del].forEach(x=>row.appendChild(x));
      r.appendChild(row);
      c.appendChild(r);
    });

    return c;
  }

  function renderContracts(token){
    const c = el("div",{className:"card"});
    c.appendChild(el("div",{className:"mini"},"<b>Contracts</b>"));

    const title = el("input",{placeholder:"Title (ex: 50 trains / 10 days)"});
    const empN  = el("input",{placeholder:"Employee name (optional)"});
    const empI  = el("input",{placeholder:"Employee id (optional)"});
    const exp   = el("input",{placeholder:"Expires ISO (optional) e.g. 2026-03-10T00:00:00+00:00"});
    const note  = el("input",{placeholder:"Note (optional)"});
    const add   = el("button",{className:"p7btn gold",style:"margin-top:8px"},"Add Contract");

    add.addEventListener("click", async ()=>{
      await apiPost(`${BASE_URL}/api/contracts/add`,{
        company_id: state.selected_company_id,
        title: title.value.trim(),
        employee_name: empN.value.trim(),
        employee_id: empI.value.trim(),
        expires_at: exp.value.trim(),
        note: note.value.trim()
      }, token);
      await refresh(state.selected_company_id);
    });

    const grid = el("div",{className:"row",style:"margin-top:8px"});
    [title,empN,empI,exp,note].forEach(x=>grid.appendChild(x));
    c.appendChild(grid);
    c.appendChild(add);

    (state.contracts||[]).forEach(k=>{
      const r = el("div",{className:"card"});
      r.innerHTML = `
        <div><b>${k.title}</b> ${k.expires_at?`<span class="pill gold">${k.expires_at}</span>`:""}</div>
        <div class="mini">${k.employee_name||""} ${k.employee_id?`(#${k.employee_id})`:""}</div>
        <div class="mini">${k.note||""}</div>
      `;
      const del = el("button",{className:"p7btn",style:"margin-top:8px"},"Delete");
      del.addEventListener("click", async ()=>{
        await apiPost(`${BASE_URL}/api/contracts/delete`,{id:k.id}, token);
        await refresh(state.selected_company_id);
      });
      r.appendChild(del);
      c.appendChild(r);
    });

    return c;
  }

  function renderSearch(token){
    const c = el("div",{className:"card"});
    c.appendChild(el("div",{className:"mini"},"<b>HoF Working Stats Scan</b>"));

    const minMan = el("input",{type:"number",placeholder:"Min MAN"});
    const maxMan = el("input",{type:"number",placeholder:"Max MAN"});
    const minInt = el("input",{type:"number",placeholder:"Min INT"});
    const maxInt = el("input",{type:"number",placeholder:"Max INT"});
    const minEnd = el("input",{type:"number",placeholder:"Min END"});
    const maxEnd = el("input",{type:"number",placeholder:"Max END"});
    const go     = el("button",{className:"p7btn gold",style:"grid-column:1/-1"},"Scan");

    const out = el("div",{className:"mini",style:"margin-top:10px"},"");

    go.addEventListener("click", async ()=>{
      out.textContent = "Scanning...";
      const res = await apiPost(`${BASE_URL}/api/search/hof`,{
        min_man:Number(minMan.value||0),
        max_man:Number(maxMan.value||999999999999),
        min_int:Number(minInt.value||0),
        max_int:Number(maxInt.value||999999999999),
        min_end:Number(minEnd.value||0),
        max_end:Number(maxEnd.value||999999999999),
      }, token);

      if(!res.ok){ out.textContent = "Error: " + (res.error||"unknown"); return; }
      const rows = res.rows || [];
      out.innerHTML =
        `<div><b>Found ${rows.length}</b></div>` +
        rows.slice(0,50).map(r=>{
          const prof = `https://www.torn.com/profiles.php?XID=${r.id}`;
          const msg = `Hey ${r.name}, I saw your working stats and wanted to invite you to apply to our company. We offer trains + active leadership. If interested, message me back!`;
          return `<div style="margin-top:8px">
            <a href="${prof}" target="_blank"><b>${r.name}</b> (#${r.id})</a>
            <div>MAN ${money(r.man)} • INT ${money(r.int)} • END ${money(r.end)} • <b>Total ${money(r.total)}</b></div>
            <button class="p7btn" data-msg="${encodeURIComponent(msg)}">Copy Recruit Msg</button>
          </div>`;
        }).join("");

      out.querySelectorAll("button[data-msg]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const txt = decodeURIComponent(btn.getAttribute("data-msg"));
          await navigator.clipboard.writeText(txt);
          btn.textContent = "Copied!";
          setTimeout(()=>btn.textContent="Copy Recruit Msg", 900);
        });
      });
    });

    const grid = el("div",{className:"row",style:"margin-top:8px"});
    [minMan,maxMan,minInt,maxInt,minEnd,maxEnd,go].forEach(x=>grid.appendChild(x));
    c.appendChild(grid);
    c.appendChild(out);
    return c;
  }

  function renderBroadcast(){
    const c = el("div",{className:"card"});
    c.appendChild(el("div",{className:"mini"},"<b>Broadcast</b> (copy/paste)"));
    const ta = el("textarea",{rows:5,placeholder:"Write message..."});
    ta.value = "Reminder: contracts renewing soon. Please stay active and reply if you need anything.";
    const copy = el("button",{className:"p7btn gold",style:"margin-top:8px"},"Copy");
    copy.addEventListener("click", async ()=>{
      await navigator.clipboard.writeText(ta.value);
      copy.textContent="Copied!";
      setTimeout(()=>copy.textContent="Copy",900);
    });
    c.appendChild(ta); c.appendChild(copy);
    return c;
  }

  function renderSettings(token){
    const c = el("div",{className:"card"});
    c.appendChild(el("div",{className:"mini"},"<b>Settings</b>"));

    const admin = el("input",{placeholder:"Admin Key"});
    const api   = el("input",{placeholder:"Torn API Key"});
    const comps = el("input",{placeholder:"Company IDs (comma separated) e.g. 123,456"});
    admin.value = getVal(K_ADMIN,"");
    api.value   = getVal(K_API,"");
    comps.value = getVal(K_COMP,"");

    const save = el("button",{className:"p7btn gold",style:"margin-top:8px"},"Login / Save");
    const info = el("div",{className:"mini",style:"margin-top:8px"},"");

    save.addEventListener("click", async ()=>{
      setVal(K_ADMIN, admin.value.trim());
      setVal(K_API, api.value.trim());
      setVal(K_COMP, comps.value.trim());

      info.textContent = "Authenticating...";
      const res = await apiPost(`${BASE_URL}/api/auth`,{
        admin_key: admin.value.trim(),
        api_key: api.value.trim()
      }, null);

      if(!res.ok){ info.textContent = "Auth failed: " + (res.error||"unknown"); return; }
      setVal(K_TOK, res.token);

      // save companies if provided
      const ids = comps.value.split(",").map(s=>s.trim()).filter(Boolean);
      if(ids.length){
        const r2 = await apiPost(`${BASE_URL}/api/user/companies`, { company_ids: ids }, res.token);
        if(!r2.ok){ info.textContent = "Saved token, but company ids failed: " + (r2.error||"unknown"); return; }
      }

      info.textContent = "Saved. Reloading...";
      await refresh(getVal(K_SEL,""));
      activeTab = "Employees";
      render();
    });

    c.appendChild(admin);
    c.appendChild(api);
    c.appendChild(comps);
    c.appendChild(save);
    c.appendChild(info);

    c.appendChild(el("div",{className:"mini",style:"margin-top:10px"},
      `BASE_URL: <b>${BASE_URL}</b><br>Token saved: <b>${token ? "YES" : "NO"}</b>`
    ));
    return c;
  }

  async function refresh(companyId){
    const token = getVal(K_TOK,"");
    if(!token){
      subEl.textContent = "Not logged in";
      state = {ok:false};
      setBadge(0);
      render();
      return;
    }

    const sel = companyId || getVal(K_SEL,"");
    const url = `${BASE_URL}/state${sel?`?company_id=${encodeURIComponent(sel)}`:""}`;

    try{
      state = await apiGet(url, token);
      if(!state.ok){
        subEl.textContent = "Session invalid";
        setBadge(0);
        render();
        return;
      }
      subEl.textContent = `${state.user?.name||""} • ${state.selected_company_id?("Company #"+state.selected_company_id):"No company"}`;
      setBadge(state.unseen_count||0);
      render();
    }catch{
      subEl.textContent = "Load error";
      state = {ok:false};
      render();
    }
  }

  async function render(){
    renderTabs();
    bodyEl.innerHTML = "";
    const token = getVal(K_TOK,"");

    if(!state || !state.ok){
      bodyEl.appendChild(renderSettings(token));
      return;
    }

    if((state.company_ids||[]).length){
      bodyEl.appendChild(companyPicker());
    } else {
      bodyEl.appendChild(el("div",{className:"card"}, "No company IDs saved. Go to Settings and add them."));
    }

    if(activeTab==="Employees") bodyEl.appendChild(renderEmployees());
    if(activeTab==="Trains") bodyEl.appendChild(renderTrains(token));
    if(activeTab==="Contracts") bodyEl.appendChild(renderContracts(token));
    if(activeTab==="Search") bodyEl.appendChild(renderSearch(token));
    if(activeTab==="Broadcast") bodyEl.appendChild(renderBroadcast());
    if(activeTab==="Settings") bodyEl.appendChild(renderSettings(token));
  }

  seenBtn.addEventListener("click", async ()=>{
    const token = getVal(K_TOK,"");
    if(!token) return;
    await apiPost(`${BASE_URL}/api/notifications/seen`,{}, token);
    await refresh(state?.selected_company_id||"");
  });

  // Start + polling
  refresh(getVal(K_SEL,""));
  setInterval(()=>refresh(state?.selected_company_id||getVal(K_SEL,"")), 15000);
})();
