// ==UserScript==
// @name         7DS*: Peace Company Hub 💼 (PDA Friendly + TOTAL HoF Search)
// @namespace    Fries-company-hub
// @version      3.1.0
// @description  Company Hub: Companies/Employees, Trains, Contracts, HoF Search (TOTAL only), Recruit Leads, Notifications. Draggable 💼, tap toggles overlay, CSP-safe via /state.
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
  const BASE_URL = "https://sevends-hiring-scan.onrender.com"; // <-- CHANGE to your Render domain
  // ==============================================

  const K_ADMIN = "hub_admin_key_v3";
  const K_API   = "hub_api_key_v3";
  const K_TOKEN = "hub_session_token_v3";
  const K_CIDS  = "hub_company_ids_v3";
  const K_ICONP = "hub_icon_pos_v3";
  const ICON_ID = "hub-briefcase";
  const WRAP_ID = "hub-overlay";

  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  function safeJSON(t){ try { return JSON.parse(t); } catch { return null; } }
  function fmt(n){ try { return Intl.NumberFormat().format(Number(n||0)); } catch { return String(n||0); } }
  function gmGet(k, d=""){ const v = GM_getValue(k); return (v===undefined||v===null||v==="") ? d : v; }
  function gmSet(k, v){ GM_setValue(k, v); }
  function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }

  function toast(msg, ms=2200){
    const el = document.createElement("div");
    el.className = "hub-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(()=>el.classList.add("show"), 10);
    setTimeout(()=>{ el.classList.remove("show"); setTimeout(()=>el.remove(), 300); }, ms);
  }

  function apiReq(method, path, body=null){
    const url = BASE_URL.replace(/\/+$/,"") + path;
    const token = gmGet(K_TOKEN,"");
    return new Promise((resolve, reject)=>{
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          "Content-Type": "application/json",
          ...(token ? {"X-Session-Token": token} : {})
        },
        data: body ? JSON.stringify(body) : null,
        timeout: 25000,
        onload: (res)=>{
          const data = safeJSON(res.responseText);
          if (!data) return reject(new Error(`Bad JSON (${res.status})`));
          if (res.status >= 400 || data.ok === false) return reject(new Error(data.error || `HTTP ${res.status}`));
          resolve(data);
        },
        onerror: ()=>reject(new Error("Network error")),
        ontimeout: ()=>reject(new Error("Timeout")),
      });
    });
  }

  function ensureUI(){
    if (document.getElementById(ICON_ID) || document.getElementById(WRAP_ID)) return;

    const icon = document.createElement("div");
    icon.id = ICON_ID;
    icon.innerHTML = `
      <div class="hub-icon-inner">💼</div>
      <div class="hub-badge" style="display:none">0</div>
    `;
    document.body.appendChild(icon);

    const wrap = document.createElement("div");
    wrap.id = WRAP_ID;
    wrap.innerHTML = `
      <div class="hub-card">
        <div class="hub-topbar">
          <div class="hub-title">
            <div class="hub-title-main">Company Hub</div>
            <div class="hub-title-sub">7DS*: Peace — High Value Dashboard</div>
          </div>
          <div class="hub-top-actions">
            <button class="hub-btn ghost" data-act="refresh">Refresh</button>
            <button class="hub-btn ghost" data-act="close">Close</button>
          </div>
        </div>

        <div class="hub-tabs">
          <button class="hub-tab active" data-tab="dash">Dashboard</button>
          <button class="hub-tab" data-tab="companies">Companies</button>
          <button class="hub-tab" data-tab="trains">Trains</button>
          <button class="hub-tab" data-tab="contracts">Contracts</button>
          <button class="hub-tab" data-tab="search">HoF Search</button>
          <button class="hub-tab" data-tab="leads">Leads</button>
          <button class="hub-tab" data-tab="notifs">Notifications</button>
          <button class="hub-tab" data-tab="settings">Settings</button>
        </div>

        <div class="hub-body">
          <section class="hub-pane active" data-pane="dash">
            <div class="hub-grid">
              <div class="hub-panel">
                <div class="hub-panel-h">Status</div>
                <div class="hub-panel-b">
                  <div class="hub-row"><span>Service</span><span id="hub-service">—</span></div>
                  <div class="hub-row"><span>User</span><span id="hub-user">—</span></div>
                  <div class="hub-row"><span>Unseen</span><span id="hub-unseen">0</span></div>
                  <div class="hub-row"><span>Selected company</span><span id="hub-selco">—</span></div>
                  <div class="hub-muted" style="margin-top:8px">Tap 💼 to open/close. Drag 💼 anywhere.</div>
                </div>
              </div>

              <div class="hub-panel">
                <div class="hub-panel-h">Quick Actions</div>
                <div class="hub-panel-b">
                  <button class="hub-btn" data-act="goto-search">HoF Search</button>
                  <button class="hub-btn" data-act="goto-leads">Recruit Leads</button>
                  <button class="hub-btn ghost" data-act="run-recruit-scan">Run Recruit Scan (All Companies)</button>
                </div>
              </div>
            </div>
          </section>

          <section class="hub-pane" data-pane="companies">
            <div class="hub-panel">
              <div class="hub-panel-h">Companies & Employees</div>
              <div class="hub-panel-b">
                <div class="hub-inline">
                  <select id="hub-company" class="hub-input"></select>
                  <button class="hub-btn" data-act="load-company">Load</button>
                </div>
                <div id="hub-company-info" class="hub-muted" style="margin-top:10px"></div>
                <div id="hub-employee-list" class="hub-list" style="margin-top:10px"></div>
              </div>
            </div>
          </section>

          <section class="hub-pane" data-pane="trains">
            <div class="hub-panel">
              <div class="hub-panel-h">Train Tracking</div>
              <div class="hub-panel-b">
                <div class="hub-inline">
                  <input id="hub-train-buyer" class="hub-input" placeholder="Buyer name" />
                  <input id="hub-train-qty" class="hub-input" placeholder="Trains bought" inputmode="numeric" />
                </div>
                <div class="hub-inline">
                  <input id="hub-train-note" class="hub-input" placeholder="Note (optional)" />
                  <button class="hub-btn" data-act="add-train">Add</button>
                  <button class="hub-btn ghost" data-act="reload-state">Reload</button>
                </div>
                <div id="hub-train-list" class="hub-list" style="margin-top:10px"></div>
              </div>
            </div>
          </section>

          <section class="hub-pane" data-pane="contracts">
            <div class="hub-panel">
              <div class="hub-panel-h">Contracts</div>
              <div class="hub-panel-b">
                <div class="hub-inline">
                  <input id="hub-contract-title" class="hub-input" placeholder="Contract title" />
                  <input id="hub-contract-expires" class="hub-input" placeholder="Expires (YYYY-MM-DD)" />
                </div>
                <div class="hub-inline">
                  <input id="hub-contract-emp" class="hub-input" placeholder="Employee name (optional)" />
                  <input id="hub-contract-note" class="hub-input" placeholder="Note (optional)" />
                </div>
                <div class="hub-inline">
                  <button class="hub-btn" data-act="add-contract">Add</button>
                  <button class="hub-btn ghost" data-act="reload-state">Reload</button>
                </div>
                <div id="hub-contract-list" class="hub-list" style="margin-top:10px"></div>
              </div>
            </div>
          </section>

          <section class="hub-pane" data-pane="search">
            <div class="hub-panel">
              <div class="hub-panel-h">Hall of Fame Search (TOTAL only)</div>
              <div class="hub-panel-b">
                <div class="hub-muted">Filters ONLY by TOTAL (MAN + INT + END). Backend returns top matches.</div>
                <div class="hub-inline" style="margin-top:10px">
                  <input id="hub-min-total" class="hub-input" placeholder="Min total (e.g. 150000)" inputmode="numeric" />
                  <input id="hub-max-total" class="hub-input" placeholder="Max total (e.g. 350000)" inputmode="numeric" />
                </div>
                <div class="hub-inline">
                  <button class="hub-btn" data-act="hof-search">Search HoF</button>
                </div>
                <div id="hub-hof-results" class="hub-list" style="margin-top:10px"></div>
              </div>
            </div>
          </section>

          <section class="hub-pane" data-pane="leads">
            <div class="hub-panel">
              <div class="hub-panel-h">Recruit Leads</div>
              <div class="hub-panel-b">
                <div class="hub-inline">
                  <button class="hub-btn" data-act="run-recruit-scan">Run Recruit Scan (Selected)</button>
                  <button class="hub-btn ghost" data-act="reload-leads">Reload Leads</button>
                </div>
                <div class="hub-inline">
                  <button class="hub-btn ghost" data-act="mark-leads-seen">Mark Seen</button>
                  <button class="hub-btn ghost" data-act="clear-leads">Clear Leads</button>
                </div>
                <div id="hub-leads-list" class="hub-list" style="margin-top:10px"></div>
              </div>
            </div>
          </section>

          <section class="hub-pane" data-pane="notifs">
            <div class="hub-panel">
              <div class="hub-panel-h">Notifications</div>
              <div class="hub-panel-b">
                <div class="hub-inline">
                  <button class="hub-btn ghost" data-act="reload-state">Reload</button>
                  <button class="hub-btn ghost" data-act="notifs-seen">Mark Seen</button>
                </div>
                <div id="hub-notifs" class="hub-list" style="margin-top:10px"></div>
              </div>
            </div>
          </section>

          <section class="hub-pane" data-pane="settings">
            <div class="hub-panel">
              <div class="hub-panel-h">Login & Setup</div>
              <div class="hub-panel-b">
                <div class="hub-muted">Admin key is provided by the service owner. You use your own Torn API key.</div>
                <div class="hub-inline" style="margin-top:10px">
                  <input id="hub-admin" class="hub-input" placeholder="Admin key" />
                  <input id="hub-api" class="hub-input" placeholder="Your Torn API key" />
                </div>
                <div class="hub-inline">
                  <input id="hub-company-ids" class="hub-input" placeholder="Company IDs (comma separated)" />
                </div>
                <div class="hub-inline">
                  <button class="hub-btn" data-act="login">Login</button>
                  <button class="hub-btn ghost" data-act="save-companies">Save Companies</button>
                  <button class="hub-btn ghost" data-act="logout">Logout</button>
                </div>

                <div class="hub-divider"></div>
                <div class="hub-muted">
                  After login, open “Companies” tab and hit Load.
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    // restore icon position
    const p = safeJSON(gmGet(K_ICONP,""));
    if (p && typeof p.x==="number" && typeof p.y==="number"){
      icon.style.left = `${p.x}px`;
      icon.style.top  = `${p.y}px`;
    } else {
      icon.style.left = "14px";
      icon.style.top  = "140px";
    }

    // dragging icon (mobile safe)
    let dragging=false, startX=0, startY=0, baseX=0, baseY=0;
    const startDrag = (clientX, clientY)=>{
      dragging=true;
      startX=clientX; startY=clientY;
      baseX=parseInt(icon.style.left||"14",10);
      baseY=parseInt(icon.style.top||"140",10);
      icon.classList.add("drag");
    };
    const moveDrag = (clientX, clientY)=>{
      if(!dragging) return;
      const dx=clientX-startX, dy=clientY-startY;
      const x=clamp(baseX+dx, 6, window.innerWidth-58);
      const y=clamp(baseY+dy, 6, window.innerHeight-58);
      icon.style.left=`${x}px`; icon.style.top=`${y}px`;
    };
    const endDrag = ()=>{
      if(!dragging) return;
      dragging=false;
      icon.classList.remove("drag");
      gmSet(K_ICONP, JSON.stringify({x: parseInt(icon.style.left,10), y: parseInt(icon.style.top,10)}));
    };

    icon.addEventListener("mousedown", (e)=>{ if(e.button!==0) return; startDrag(e.clientX,e.clientY); });
    window.addEventListener("mousemove", (e)=>moveDrag(e.clientX,e.clientY));
    window.addEventListener("mouseup", endDrag);

    icon.addEventListener("touchstart", (e)=>{
      if(!e.touches || !e.touches[0]) return;
      startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, {passive:true});
    icon.addEventListener("touchmove", (e)=>{
      if(!e.touches || !e.touches[0]) return;
      moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, {passive:true});
    icon.addEventListener("touchend", endDrag, {passive:true});

    // tap to toggle (but not while dragging)
    let lastTap=0, tapMoved=false;
    icon.addEventListener("click", ()=>{
      // if user just dragged, ignore click
      if (icon.classList.contains("drag")) return;
      toggleOverlay();
    });

    // tabs
    $$(".hub-tab", wrap).forEach(btn=>{
      btn.addEventListener("click", ()=>{
        $$(".hub-tab", wrap).forEach(x=>x.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.getAttribute("data-tab");
        $$(".hub-pane", wrap).forEach(p=>p.classList.toggle("active", p.getAttribute("data-pane")===tab));
      });
    });

    // actions
    wrap.addEventListener("click", async (e)=>{
      const b = e.target.closest("[data-act]");
      if(!b) return;
      const act = b.getAttribute("data-act");
      try{
        if(act==="close") toggleOverlay(false);
        else if(act==="refresh" || act==="reload-state") await refreshState(true);
        else if(act==="goto-search") { switchTab("search"); }
        else if(act==="goto-leads") { switchTab("leads"); await reloadLeads(); }
        else if(act==="load-company") await refreshState(true);
        else if(act==="login") await doLogin();
        else if(act==="logout") doLogout();
        else if(act==="save-companies") await saveCompanies();
        else if(act==="add-train") await addTrain();
        else if(act==="add-contract") await addContract();
        else if(act==="hof-search") await hofSearch();
        else if(act==="reload-leads") await reloadLeads();
        else if(act==="mark-leads-seen") await markLeadsSeen();
        else if(act==="clear-leads") await clearLeads();
        else if(act==="run-recruit-scan") await runRecruitScan();
        else if(act==="notifs-seen") await notifsSeen();
      }catch(err){
        toast(String(err.message||err));
      }
    });

    // load saved settings
    $("#hub-admin").value = gmGet(K_ADMIN,"");
    $("#hub-api").value   = gmGet(K_API,"");
    $("#hub-company-ids").value = gmGet(K_CIDS,"");
  }

  function switchTab(tab){
    const wrap = document.getElementById(WRAP_ID);
    $$(".hub-tab", wrap).forEach(x=>x.classList.toggle("active", x.getAttribute("data-tab")===tab));
    $$(".hub-pane", wrap).forEach(p=>p.classList.toggle("active", p.getAttribute("data-pane")===tab));
  }

  function overlayOpen(){ return document.getElementById(WRAP_ID)?.classList.contains("open"); }
  function toggleOverlay(force){
    const wrap = document.getElementById(WRAP_ID);
    if(!wrap) return;
    const next = (typeof force==="boolean") ? force : !wrap.classList.contains("open");
    wrap.classList.toggle("open", next);
    if(next) refreshState(false);
  }

  function setBadge(n){
    const b = $("#"+ICON_ID+" .hub-badge");
    if(!b) return;
    const v = Number(n||0);
    if(v>0){
      b.style.display="flex";
      b.textContent = String(v>99 ? "99+" : v);
    }else{
      b.style.display="none";
      b.textContent = "0";
    }
  }

  function selectedCompanyId(){
    const sel = $("#hub-company");
    return (sel && sel.value) ? String(sel.value) : "";
  }

  async function refreshState(showToast){
    const cid = selectedCompanyId();
    const qs = cid ? `?company_id=${encodeURIComponent(cid)}` : "";
    const st = await apiReq("GET", "/state"+qs);
    renderState(st);
    if(showToast) toast("Updated");
  }

  function renderState(st){
    $("#hub-service").textContent = st.service || "—";
    $("#hub-user").textContent = (st.user?.name ? `${st.user.name} [${st.user.user_id}]` : (st.user?.user_id||"—"));
    $("#hub-unseen").textContent = String(st.unseen_count ?? 0);
    $("#hub-selco").textContent = st.selected_company_id || "—";

    setBadge(st.unseen_count ?? 0);

    // company dropdown
    const sel = $("#hub-company");
    const cids = Array.isArray(st.company_ids) ? st.company_ids : [];
    sel.innerHTML = "";
    if(cids.length === 0){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No companies set";
      sel.appendChild(opt);
    } else {
      cids.forEach(id=>{
        const opt = document.createElement("option");
        opt.value = String(id);
        opt.textContent = `Company #${id}`;
        sel.appendChild(opt);
      });
      sel.value = st.selected_company_id || String(cids[0]);
    }

    // company info
    const c = st.company;
    $("#hub-company-info").textContent = c
      ? `${c.name || "Company"} — Rating: ${c.rating ?? "?"} (ID ${c.id})`
      : (st.company_error ? `Company error: ${st.company_error}` : "Load a company to see employees.");

    // employees
    const emp = Array.isArray(st.employees) ? st.employees : [];
    const el = $("#hub-employee-list");
    el.innerHTML = emp.length ? "" : `<div class="hub-muted">No employees returned.</div>`;
    emp.forEach(e=>{
      const man = e.man ?? "-";
      const inte = e.int ?? "-";
      const end = e.end ?? "-";
      const total = (Number(e.man||0)+Number(e.int||0)+Number(e.end||0));
      const inactive = (e.inactive_days===null || e.inactive_days===undefined) ? "" : ` • inactive ${e.inactive_days}d`;
      const row = document.createElement("div");
      row.className = "hub-item";
      row.innerHTML = `
        <div class="hub-item-top">
          <div class="hub-item-title">${escapeHtml(e.name || "Employee")}</div>
          <div class="hub-pill">${escapeHtml(e.position || "")}</div>
        </div>
        <div class="hub-item-sub">
          MAN ${fmt(man)} • INT ${fmt(inte)} • END ${fmt(end)} • <b>Total ${fmt(total)}</b>${inactive}
        </div>
      `;
      el.appendChild(row);
    });

    // trains
    const trains = Array.isArray(st.trains) ? st.trains : [];
    const tl = $("#hub-train-list");
    tl.innerHTML = trains.length ? "" : `<div class="hub-muted">No train records yet.</div>`;
    trains.forEach(t=>{
      const row = document.createElement("div");
      row.className="hub-item";
      row.innerHTML = `
        <div class="hub-item-top">
          <div class="hu
