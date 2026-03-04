// ==UserScript==
// @name         Company Hub 💼 (FULL: Companies + Employees + Trains + Contracts + Leads + HoF + Bubble)
// @namespace    Fries-company-hub
// @version      4.0.0
// @description  Full Company Hub: login, company list, employees, trains, contracts, leads (HoF scan), profile links, unseen bubble. PDA-friendly.
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
  const BASE_URL = "https://sevends-hiring-scan.onrender.com"; // <-- your Render service
  // ==============================================

  const K_ADMIN = "hub_admin_key_v4";
  const K_API   = "hub_api_key_v4";
  const K_SESS  = "hub_session_token_v4";
  const K_COMP  = "hub_company_ids_v4"; // local convenience mirror

  function $(sel, root=document){ return root.querySelector(sel); }
  function el(tag, attrs={}, html=""){
    const n=document.createElement(tag);
    Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));
    if(html) n.innerHTML=html;
    return n;
  }
  function esc(s){
    return String(s||"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
  function api(method, path, body){
    const token = GM_getValue(K_SESS,"");
    return new Promise((resolve,reject)=>{
      GM_xmlhttpRequest({
        method,
        url: BASE_URL + path,
        headers: Object.assign({"Content-Type":"application/json"}, token ? {"X-Session-Token": token} : {}),
        data: body ? JSON.stringify(body) : undefined,
        timeout: 60000,
        onload: (r)=>{
          let j;
          try{ j = JSON.parse(r.responseText||"{}"); }
          catch(e){ return reject(new Error("Bad JSON from server: " + (r.responseText||"").slice(0,160))); }
          if(!j.ok) return reject(new Error(j.error || "Request failed"));
          resolve(j.data);
        },
        onerror: ()=>reject(new Error("Network error")),
        ontimeout: ()=>reject(new Error("Timeout")),
      });
    });
  }

  function openProfile(id){
    const pid = String(id||"").trim();
    if(!pid) return;
    window.open(`https://www.torn.com/profiles.php?XID=${encodeURIComponent(pid)}`, "_blank", "noopener,noreferrer");
  }

  async function copyText(t){
    try{ await navigator.clipboard.writeText(String(t)); return true; }
    catch{
      try{
        const ta = el("textarea"); ta.value=String(t);
        document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
        return true;
      }catch{ return false; }
    }
  }

  GM_addStyle(`
    #hub-badge{
      position:fixed; z-index:2147483647;
      left:14px; top:170px;
      width:44px; height:44px; border-radius:12px;
      display:flex; align-items:center; justify-content:center;
      font-size:22px;
      background:linear-gradient(180deg,#2b2f36,#15171b);
      border:1px solid rgba(255,255,255,0.10);
      box-shadow:0 10px 22px rgba(0,0,0,0.40);
      user-select:none; -webkit-user-select:none; touch-action:none;
    }
    #hub-bubble{
      position:absolute;
      right:-6px; top:-6px;
      min-width:18px; height:18px;
      padding:0 5px;
      border-radius:999px;
      display:none;
      align-items:center; justify-content:center;
      font-size:11px; font-weight:900;
      background:rgba(255,90,90,0.95);
      color:#fff;
      border:1px solid rgba(0,0,0,0.25);
      box-shadow:0 6px 14px rgba(0,0,0,0.35);
    }

    #hub-overlay{
      position:fixed; z-index:2147483646;
      right:10px; top:70px;
      width:min(92vw, 440px);
      max-height:min(80vh, 680px);
      display:none;
      background:rgba(18,20,24,0.96);
      border:1px solid rgba(255,255,255,0.10);
      border-radius:14px;
      box-shadow:0 18px 40px rgba(0,0,0,0.55);
      overflow:hidden; color:#e9eef6;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    }
    #hub-top{
      display:flex; align-items:center; justify-content:space-between;
      padding:10px 12px;
      background:linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
      border-bottom:1px solid rgba(255,255,255,0.08);
    }
    #hub-title{ font-weight:900; letter-spacing:0.2px; }
    #hub-close{
      border:0; background:rgba(255,255,255,0.08);
      color:#fff; border-radius:10px;
      padding:6px 10px; font-weight:900;
    }

    #hub-tabs{ display:flex; gap:8px; padding:10px 12px; flex-wrap:wrap; }
    .hub-tabbtn{
      border:1px solid rgba(255,255,255,0.10);
      background:rgba(255,255,255,0.06);
      color:#e9eef6;
      padding:6px 10px; border-radius:999px;
      font-weight:900; font-size:12px;
    }
    .hub-tabbtn.active{ background:rgba(255,255,255,0.14); }

    #hub-body{ padding:10px 12px 12px; overflow:auto; max-height:calc(min(80vh, 680px) - 108px); }

    .card{
      border:1px solid rgba(255,255,255,0.10);
      background:rgba(255,255,255,0.04);
      border-radius:12px;
      padding:10px;
      margin-bottom:10px;
    }
    .row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    input, select, textarea{
      padding:8px 10px;
      border-radius:10px;
      border:1px solid rgba(255,255,255,0.12);
      background:rgba(0,0,0,0.18);
      color:#fff; outline:none;
    }
    input{ width:140px; }
    textarea{ width:100%; min-height:64px; resize:vertical; }
    .btn{
      border:0; border-radius:10px;
      padding:8px 10px;
      font-weight:900;
      background:linear-gradient(180deg, rgba(60,175,255,0.35), rgba(60,175,255,0.18));
      color:#e9eef6;
    }
    .btn.ghost{ background:rgba(255,255,255,0.10); border:1px solid rgba(255,255,255,0.10); font-weight:800; }
    .btn.danger{ background:rgba(255,90,90,0.22); border:1px solid rgba(255,90,90,0.18); }
    .small{ font-size:12px; opacity:0.9; }
    .list{ margin-top:8px; display:grid; gap:6px; }
    .item{
      border-radius:12px;
      padding:10px;
      border:1px solid rgba(255,255,255,0.08);
      background:rgba(0,0,0,0.16);
      display:flex; justify-content:space-between; gap:10px;
      font-size:13px; align-items:flex-start;
    }
    .actions{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
    .pill{
      display:inline-flex; align-items:center; gap:6px;
      padding:4px 8px; border-radius:999px;
      background:rgba(255,255,255,0.08);
      border:1px solid rgba(255,255,255,0.10);
      font-size:12px; white-space:nowrap;
    }
  `);

  // UI mount
  const badge = el("div", {id:"hub-badge", title:"Company Hub"}, "💼");
  const bubble = el("div", {id:"hub-bubble"}, "0");
  badge.appendChild(bubble);

  const overlay = el("div", {id:"hub-overlay"});
  overlay.innerHTML = `
    <div id="hub-top">
      <div id="hub-title">Company Hub</div>
      <button id="hub-close">Close</button>
    </div>
    <div id="hub-tabs">
      <button class="hub-tabbtn active" data-tab="login">Login</button>
      <button class="hub-tabbtn" data-tab="companies">Companies</button>
      <button class="hub-tabbtn" data-tab="trains">Trains</button>
      <button class="hub-tabbtn" data-tab="contracts">Contracts</button>
      <button class="hub-tabbtn" data-tab="leads">Leads</button>
      <button class="hub-tabbtn" data-tab="notifications">Alerts</button>
    </div>
    <div id="hub-body"></div>
  `;
  document.body.appendChild(overlay);
  document.body.appendChild(badge);

  function showOverlay(on){ overlay.style.display = on ? "block" : "none"; }
  function toggleOverlay(){ showOverlay(overlay.style.display !== "block"); }

  badge.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); toggleOverlay(); });
  $("#hub-close", overlay).addEventListener("click", ()=>showOverlay(false));

  // draggable badge
  (function draggable(node){
    let dragging=false, sx=0, sy=0, ox=0, oy=0;
    node.addEventListener("pointerdown",(e)=>{
      dragging=true; node.setPointerCapture(e.pointerId);
      sx=e.clientX; sy=e.clientY;
      const r=node.getBoundingClientRect(); ox=r.left; oy=r.top;
    });
    node.addEventListener("pointermove",(e)=>{
      if(!dragging) return;
      const dx=e.clientX-sx, dy=e.clientY-sy;
      node.style.left=Math.max(6, ox+dx)+"px";
      node.style.top =Math.max(6, oy+dy)+"px";
      node.style.right="auto";
    });
    node.addEventListener("pointerup", ()=>dragging=false);
    node.addEventListener("pointercancel", ()=>dragging=false);
  })(badge);

  const body = $("#hub-body", overlay);

  function setTab(tab){
    overlay.querySelectorAll(".hub-tabbtn").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
    render(tab);
  }
  overlay.querySelectorAll(".hub-tabbtn").forEach(b=>b.addEventListener("click", ()=>setTab(b.dataset.tab)));

  // bubble updater
  async function refreshBubble(){
    try{
      const st = await api("GET", "/api/state");
      const n = (st.unseen?.notifications||0) + (st.unseen?.leads||0);
      bubble.style.display = n > 0 ? "flex" : "none";
      bubble.textContent = String(Math.min(n, 99));
    }catch{
      bubble.style.display = "none";
    }
  }
  setInterval(refreshBubble, 30000);

  // ---- tabs ----

  async function render(tab){
    if(tab==="login") return renderLogin();
    if(tab==="companies") return renderCompanies();
    if(tab==="trains") return renderTrains();
    if(tab==="contracts") return renderContracts();
    if(tab==="leads") return renderLeads();
    if(tab==="notifications") return renderNotifications();
  }

  async function renderLogin(){
    const savedAdmin = GM_getValue(K_ADMIN,"");
    const savedApi = GM_getValue(K_API,"");

    body.innerHTML = `
      <div class="card">
        <div style="font-weight:900;margin-bottom:6px;">Login</div>
        <div class="small">Admin key = key you provide. API key = user’s own Torn key.</div>
        <div class="row" style="margin-top:10px;">
          <input id="admin" placeholder="Admin key" value="${esc(savedAdmin)}" />
          <input id="apikey" placeholder="Your API key" value="${esc(savedApi)}" />
          <button class="btn" id="login">Sign in</button>
        </div>
        <div class="small" id="msg" style="margin-top:10px;"></div>
      </div>
    `;

    $("#login", body).addEventListener("click", async ()=>{
      const admin_key = ($("#admin", body).value||"").trim();
      const api_key = ($("#apikey", body).value||"").trim();
      GM_setValue(K_ADMIN, admin_key);
      GM_setValue(K_API, api_key);
      $("#msg", body).textContent = "Signing in...";
      try{
        const data = await api("POST", "/api/login", {admin_key, api_key});
        GM_setValue(K_SESS, data.token);
        $("#msg", body).textContent = `✅ Logged in as ${data.name} [${data.user_id}]`;
        await refreshBubble();
      }catch(err){
        $("#msg", body).textContent = "❌ " + err.message;
      }
    });
  }

  async function renderCompanies(){
    const localCompanyIds = GM_getValue(K_COMP, []);
    body.innerHTML = `
      <div class="card">
        <div style="font-weight:900;margin-bottom:6px;">Companies</div>
        <div class="small">Add your company IDs (comma-separated). Then pick one to view employees.</div>
        <div class="row" style="margin-top:10px;">
          <input id="companyids" style="width:100%;" placeholder="e.g. 12345,67890" value="${esc((localCompanyIds||[]).join(","))}" />
          <button class="btn" id="save">Save</button>
        </div>
        <div class="small" id="cmsg" style="margin-top:10px;"></div>
      </div>

      <div class="card">
        <div class="row">
          <select id="picker" style="width:100%;"></select>
          <button class="btn ghost" id="load">Load</button>
        </div>
        <div class="small" id="pmsg" style="margin-top:10px;"></div>
        <div class="list" id="elist"></div>
      </div>
    `;

    function fillPicker(ids){
      const sel = $("#picker", body);
      sel.innerHTML = "";
      const opt0 = el("option", {value:""}, "Select company...");
      sel.appendChild(opt0);
      (ids||[]).forEach(id=>{
        sel.appendChild(el("option", {value:String(id)}, String(id)));
      });
    }

    fillPicker(localCompanyIds);

    $("#save", body).addEventListener("click", async ()=>{
      const raw = ($("#companyids", body).value||"").trim();
      const ids = raw ? raw.split(",").map(s=>s.trim()).filter(Boolean) : [];
      GM_setValue(K_COMP, ids);
      $("#cmsg", body).textContent = "Saving to server...";
      try{
        await api("POST", "/api/company_ids", {company_ids: ids});
        $("#cmsg", body).textContent = "✅ Saved.";
        fillPicker(ids);
      }catch(err){
        $("#cmsg", body).textContent = "❌ " + err.message + " (Login first.)";
      }
    });

    $("#load", body).addEventListener("click", async ()=>{
      const cid = ($("#picker", body).value||"").trim();
      if(!cid) return;
      $("#pmsg", body).textContent = "Loading company...";
      $("#elist", body).innerHTML = "";
      try{
        const data = await api("GET", `/api/company/${encodeURIComponent(cid)}`);
        const name = data?.name || data?.company?.name || "Company";
        $("#pmsg", body).textContent = `✅ ${name} (${cid})`;

        // employees shape varies; normalize:
        const employees =
          data?.employees ||
          data?.company?.employees ||
          data?.staff ||
          [];

        if(!Array.isArray(employees) || employees.length === 0){
          $("#elist", body).innerHTML = `<div class="small">No employees found (API payload might differ). We can adjust if you paste the payload.</div>`;
          return;
        }

        const list = $("#elist", body);
        employees.forEach(emp=>{
          const pid = emp?.id || emp?.user_id || emp?.player_id || emp?.XID || "";
          const ename = emp?.name || emp?.username || emp?.player_name || "Employee";
          const job = emp?.position || emp?.role || emp?.job || "";
          const node = el("div", {class:"item"}, `
            <div>
              <div><b>${esc(ename)}</b> <span class="small">[${esc(pid)}]</span></div>
              <div style="margin-top:6px;">
                ${job ? `<span class="pill"><span class="small">role</span> <b>${esc(job)}</b></span>` : ""}
              </div>
            </div>
            <div class="actions">
              <button class="btn ghost" data-act="profile" data-id="${esc(pid)}">Profile</button>
              <button class="btn ghost" data-act="copy" data-id="${esc(pid)}">Copy</button>
            </div>
          `);
          node.querySelector("[data-act='profile']").addEventListener("click",(e)=>{e.preventDefault();e.stopPropagation();openProfile(pid);});
          node.querySelector("[data-act='copy']").addEventListener("click", async (e)=>{
            e.preventDefault();e.stopPropagation();
            const b = e.currentTarget;
            const ok = await copyText(pid);
            b.textContent = ok ? "Copied" : "Nope";
            setTimeout(()=>b.textContent="Copy", 900);
          });
          list.appendChild(node);
        });

      }catch(err){
        $("#pmsg", body).textContent = "❌ " + err.message + " (Login first.)";
      }
    });
  }

  async function renderTrains(){
    body.innerHTML = `
      <div class="card">
        <div style="font-weight:900;margin-bottom:6px;">Trains</div>
        <div class="row">
          <input id="t_company" placeholder="Company ID (optional)" />
          <input id="t_buyer" placeholder="Buyer" />
          <input id="t_amount" placeholder="Amount" value="1" />
          <button class="btn" id="t_add">Add</button>
        </div>
        <div class="small" id="t_msg" style="margin-top:10px;"></div>
        <div class="list" id="t_list"></div>
      </div>
    `;

    $("#t_add", body).addEventListener("click", async ()=>{
      const company_id = ($("#t_company", body).value||"").trim();
      const buyer = ($("#t_buyer", body).value||"").trim();
      const amount = parseInt(($("#t_amount", body).value||"0").trim(), 10);
      $("#t_msg", body).textContent = "Saving...";
      try{
        await api("POST","/api/trains",{company_id,buyer,amount});
        $("#t_msg", body).textContent = "✅ Saved.";
        await load();
      }catch(err){
        $("#t_msg", body).textContent = "❌ " + err.message;
      }
    });

    async function load(){
      const list=$("#t_list", body); list.innerHTML="";
      try{
        const trains = await api("GET","/api/trains");
        trains.forEach(t=>{
          const node = el("div",{class:"item"},`
            <div>
              <div><b>${esc(t.buyer||"buyer")}</b> <span class="small">${esc(String(t.company_id||""))}</span></div>
              <div class="small">${esc(String(t.created_at||""))}</div>
            </div>
            <div class="actions">
              <span class="pill"><b>${Number(t.amount||0)}</b></span>
              <button class="btn ghost" data-act="toggle" data-id="${t.id}">${t.used ? "Used" : "New"}</button>
              <button class="btn danger" data-act="del" data-id="${t.id}">Del</button>
            </div>
          `);
          node.querySelector("[data-act='toggle']").addEventListener("click", async (e)=>{
            const id = parseInt(e.currentTarget.dataset.id,10);
            const used = e.currentTarget.textContent.trim() !== "Used";
            await api("POST","/api/trains/used",{id,used});
            await load();
          });
          node.querySelector("[data-act='del']").addEventListener("click", async (e)=>{
            const id = parseInt(e.currentTarget.dataset.id,10);
            await api("POST","/api/trains/delete",{id});
            await load();
          });
          list.appendChild(node);
        });
      }catch(err){
        $("#t_msg", body).textContent = "❌ " + err.message + " (Login first.)";
      }
    }

    await load();
  }

  async function renderContracts(){
    body.innerHTML = `
      <div class="card">
        <div style="font-weight:900;margin-bottom:6px;">Contracts</div>
        <div class="row">
          <input id="ct_title" placeholder="Title" style="width:100%;" />
        </div>
        <div style="margin-top:8px;">
          <textarea id="ct_note" placeholder="Notes (optional)"></textarea>
        </div>
        <div class="row" style="margin-top:8px;">
          <button class="btn" id="ct_add">Add</button>
        </div>
        <div class="small" id="ct_msg" style="margin-top:10px;"></div>
        <div class="list" id="ct_list"></div>
      </div>
    `;

    $("#ct_add", body).addEventListener("click", async ()=>{
      const title = ($("#ct_title", body).value||"").trim();
      const note = ($("#ct_note", body).value||"").trim();
      $("#ct_msg", body).textContent = "Saving...";
      try{
        await api("POST","/api/contracts",{title,note});
        $("#ct_msg", body).textContent = "✅ Saved.";
        $("#ct_title", body).value="";
        $("#ct_note", body).value="";
        await load();
      }catch(err){
        $("#ct_msg", body).textContent = "❌ " + err.message;
      }
    });

    async function load(){
      const list=$("#ct_list", body); list.innerHTML="";
      try{
        const items = await api("GET","/api/contracts");
        items.forEach(c=>{
          const node = el("div",{class:"item"},`
            <div>
              <div><b>${esc(c.title||"Contract")}</b></div>
              ${c.note ? `<div class="small" style="margin-top:6px;">${esc(c.note)}</div>` : ""}
              <div class="small" style="margin-top:6px;">${esc(String(c.created_at||""))}</div>
            </div>
            <div class="actions">
              <button class="btn danger" data-id="${c.id}">Del</button>
            </div>
          `);
          node.querySelector("button").addEventListener("click", async ()=>{
            await api("POST","/api/contracts/delete",{id:c.id});
            await load();
          });
          list.appendChild(node);
        });
      }catch(err){
        $("#ct_msg", body).textContent = "❌ " + err.message + " (Login first.)";
      }
    }
    await load();
  }

  async function renderLeads(){
    body.innerHTML = `
      <div class="card">
        <div style="font-weight:900;margin-bottom:6px;">Leads</div>
        <div class="small">Run HoF scan then save any result as a lead (stored on server).</div>

        <div class="row" style="margin-top:10px;">
          <input id="hmin" placeholder="Min" value="500" />
          <input id="hmax" placeholder="Max" value="120000" />
          <button class="btn" id="scan">Scan HoF</button>
        </div>

        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" id="seen">Mark Leads Seen</button>
          <button class="btn danger" id="clear">Clear Leads</button>
        </div>

        <div class="small" id="lmsg" style="margin-top:10px;"></div>
        <div class="list" id="scan_list"></div>
      </div>

      <div class="card">
        <div style="font-weight:900;margin-bottom:6px;">Saved Leads</div>
        <div class="small" id="smsg"></div>
        <div class="list" id="saved_list"></div>
      </div>
    `;

    $("#scan", body).addEventListener("click", async ()=>{
      const min = parseInt(($("#hmin", body).value||"0").trim(),10);
      const max = parseInt(($("#hmax", body).value||"0").trim(),10);
      $("#lmsg", body).textContent = "Scanning...";
      $("#scan_list", body).innerHTML = "";
      try{
        const data = await api("GET", `/api/hof_scan?min=${encodeURIComponent(min)}&max=${encodeURIComponent(max)}`);
        $("#lmsg", body).textContent = `✅ Found ${data.count} (showing 60)`;
        const list = $("#scan_list", body);

        (data.results||[]).slice(0,60).forEach(r=>{
          const pid = String(r.id||"");
          const name = r.name||"(unknown)";
          const val = Number(r.value||0);
          const node = el("div",{class:"item"},`
            <div>
              <div><b>${esc(name)}</b> <span class="small">[${esc(pid)}]</span></div>
              <div style="margin-top:6px;">
                <span class="pill"><span class="small">value</span> <b>${val.toLocaleString()}</b></span>
              </div>
            </div>
            <div class="actions">
              <button class="btn ghost" data-act="profile">Profile</button>
              <button class="btn ghost" data-act="copy">Copy</button>
              <button class="btn" data-act="save">Save</button>
            </div>
          `);

          node.querySelector("[data-act='profile']").addEventListener("click",(e)=>{e.preventDefault();openProfile(pid);});
          node.querySelector("[data-act='copy']").addEventListener("click", async (e)=>{
            e.preventDefault();
            const b=e.currentTarget;
            const ok=await copyText(pid);
            b.textContent=ok?"Copied":"Nope";
            setTimeout(()=>b.textContent="Copy", 900);
          });
          node.querySelector("[data-act='save']").addEventListener("click", async ()=>{
            await api("POST","/api/leads",{player_id: pid, name, value: val, note:"HoF workstats lead"});
            await loadSaved();
            await refreshBubble();
          });

          list.appendChild(node);
        });

      }catch(err){
        $("#lmsg", body).textContent = "❌ " + err.message + " (Login first.)";
      }
    });

    $("#seen", body).addEventListener("click", async ()=>{
      try{ await api("POST","/api/leads/seen",{}); await loadSaved(); await refreshBubble(); }
      catch(err){ $("#lmsg", body).textContent = "❌ " + err.message; }
    });

    $("#clear", body).addEventListener("click", async ()=>{
      try{ await api("POST","/api/leads/clear",{}); await loadSaved(); await refreshBubble(); }
      catch(err){ $("#lmsg", body).textContent = "❌ " + err.message; }
    });

    async function loadSaved(){
      const list=$("#saved_list", body); list.innerHTML="";
      try{
        const leads = await api("GET","/api/leads");
        $("#smsg", body).textContent = `Saved: ${leads.length}`;
        leads.forEach(l=>{
          const pid=String(l.player_id||"");
          const node = el("div",{class:"item"},`
            <div>
              <div><b>${esc(l.name||"Lead")}</b> <span class="small">[${esc(pid)}]</span></div>
              <div style="margin-top:6px;">
                <span class="pill"><span class="small">value</span> <b>${Number(l.value||0).toLocaleString()}</b></span>
                ${l.seen ? `<span class="pill"><span class="small">seen</span> <b>yes</b></span>` : `<span class="pill"><span class="small">seen</span> <b>no</b></span>`}
              </div>
              ${l.note ? `<div class="small" style="margin-top:6px;">${esc(l.note)}</div>` : ""}
            </div>
            <div class="actions">
              <button class="btn ghost" data-act="profile">Profile</button>
              <button class="btn ghost" data-act="copy">Copy</button>
            </div>
          `);
          node.querySelector("[data-act='profile']").addEventListener("click",(e)=>{e.preventDefault();openProfile(pid);});
          node.querySelector("[data-act='copy']").addEventListener("click", async (e)=>{
            e.preventDefault();
            const b=e.currentTarget;
            const ok=await copyText(pid);
            b.textContent=ok?"Copied":"Nope";
            setTimeout(()=>b.textContent="Copy", 900);
          });
          list.appendChild(node);
        });
      }catch(err){
        $("#smsg", body).textContent = "❌ " + err.message + " (Login first.)";
      }
    }

    await loadSaved();
  }

  async function renderNotifications(){
    body.innerHTML = `
      <div class="card">
        <div style="font-weight:900;margin-bottom:6px;">Alerts</div>
        <div class="row">
          <button class="btn ghost" id="n_seen">Mark Alerts Seen</button>
          <button class="btn" id="n_refresh">Refresh</button>
        </div>
        <div class="small" id="nmsg" style="margin-top:10px;"></div>
        <div class="list" id="nlist"></div>
      </div>
    `;

    $("#n_seen", body).addEventListener("click", async ()=>{
      try{ await api("POST","/api/notifications/seen",{}); await load(); await refreshBubble(); }
      catch(err){ $("#nmsg", body).textContent = "❌ " + err.message; }
    });

    $("#n_refresh", body).addEventListener("click", load);

    async function load(){
      const list=$("#nlist", body); list.innerHTML="";
      $("#nmsg", body).textContent = "Loading...";
      try{
        const items = await api("GET","/api/notifications");
        $("#nmsg", body).textContent = `Alerts: ${items.length}`;
        items.forEach(n=>{
          const node = el("div",{class:"item"},`
            <div>
              <div><b>${esc(n.kind||"info")}</b></div>
              <div style="margin-top:6px;">${esc(n.message||"")}</div>
              <div class="small" style="margin-top:6px;">${esc(String(n.created_at||""))} · seen: ${n.seen ? "yes":"no"}</div>
            </div>
          `);
          list.appendChild(node);
        });
      }catch(err){
        $("#nmsg", body).textContent = "❌ " + err.message + " (Login first.)";
      }
    }

    await load();
  }

  // boot
  setTab("login");
  refreshBubble();
})();
