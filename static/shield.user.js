// ==UserScript==
// @name         Company Hub 💼 (HoF Range Fix + PDA)
// @namespace    Fries-company-hub
// @version      3.0.0
// @description  Company Hub: login with admin key + own API key. HoF workstats scan supports large ranges (e.g., 500-120000). PDA/mobile friendly.
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

  const K_ADMIN = "hub_admin_key_v3";
  const K_API   = "hub_api_key_v3";
  const K_SESS  = "hub_session_token_v3";

  function $(sel, root=document){ return root.querySelector(sel); }
  function el(tag, attrs={}, html=""){
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => n.setAttribute(k, v));
    if (html) n.innerHTML = html;
    return n;
  }

  function api(method, path, body){
    const token = GM_getValue(K_SESS, "");
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: BASE_URL + path,
        headers: Object.assign(
          { "Content-Type": "application/json" },
          token ? { "X-Session-Token": token } : {}
        ),
        data: body ? JSON.stringify(body) : undefined,
        onload: (r) => {
          let j;
          try { j = JSON.parse(r.responseText || "{}"); }
          catch (e) { return reject(new Error("Bad JSON from server: " + (r.responseText || "").slice(0, 120))); }
          if (!j.ok) return reject(new Error(j.error || "Request failed"));
          resolve(j.data);
        },
        onerror: () => reject(new Error("Network error")),
        ontimeout: () => reject(new Error("Timeout")),
        timeout: 60000
      });
    });
  }

  GM_addStyle(`
    #hub-badge {
      position: fixed; z-index: 2147483647;
      left: 14px; top: 170px;
      width: 44px; height: 44px;
      border-radius: 12px;
      display:flex; align-items:center; justify-content:center;
      font-size: 22px;
      background: linear-gradient(180deg, #2b2f36, #15171b);
      border: 1px solid rgba(255,255,255,0.10);
      box-shadow: 0 10px 22px rgba(0,0,0,0.40);
      user-select:none; -webkit-user-select:none; touch-action:none;
    }
    #hub-badge:active { transform: scale(0.98); }

    #hub-overlay {
      position: fixed; z-index: 2147483646;
      right: 10px; top: 70px;
      width: min(92vw, 420px);
      max-height: min(78vh, 640px);
      display: none;
      background: rgba(18,20,24,0.96);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(0,0,0,0.55);
      overflow: hidden;
      color: #e9eef6;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    }

    #hub-top {
      display:flex; align-items:center; justify-content:space-between;
      padding: 10px 12px;
      background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    #hub-title { font-weight: 800; letter-spacing: 0.2px; }
    #hub-close {
      border: 0; background: rgba(255,255,255,0.08);
      color: #fff; border-radius: 10px;
      padding: 6px 10px; font-weight: 700;
    }

    #hub-tabs { display:flex; gap:8px; padding: 10px 12px; flex-wrap: wrap; }
    .hub-tabbtn{
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.06);
      color: #e9eef6;
      padding: 6px 10px; border-radius: 999px;
      font-weight: 700; font-size: 12px;
    }
    .hub-tabbtn.active { background: rgba(255,255,255,0.14); }

    #hub-body { padding: 10px 12px 12px; overflow:auto; max-height: calc(min(78vh, 640px) - 108px); }

    .hub-card{
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.04);
      border-radius: 12px;
      padding: 10px;
      margin-bottom: 10px;
    }
    .hub-row{ display:flex; gap:8px; align-items:center; flex-wrap: wrap; }
    .hub-row input{
      width: 140px;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(0,0,0,0.18);
      color: #fff;
      outline: none;
    }
    .hub-btn{
      border: 0;
      border-radius: 10px;
      padding: 8px 10px;
      font-weight: 800;
      background: linear-gradient(180deg, rgba(60,175,255,0.35), rgba(60,175,255,0.18));
      color: #e9eef6;
    }
    .hub-small{ font-size: 12px; opacity: 0.9; }
    .hub-list{ margin-top: 8px; display:grid; gap:6px; }
    .hub-item{
      border-radius: 10px;
      padding: 8px 10px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(0,0,0,0.16);
      display:flex; justify-content:space-between; gap:10px;
      font-size: 13px;
    }
    .hub-item b{ font-weight: 900; }
  `);

  // UI nodes
  const badge = el("div", { id: "hub-badge", title: "Company Hub" }, "💼");
  const overlay = el("div", { id: "hub-overlay" });
  overlay.innerHTML = `
    <div id="hub-top">
      <div id="hub-title">Company Hub</div>
      <button id="hub-close">Close</button>
    </div>
    <div id="hub-tabs">
      <button class="hub-tabbtn active" data-tab="login">Login</button>
      <button class="hub-tabbtn" data-tab="search">Search</button>
      <button class="hub-tabbtn" data-tab="trains">Trains</button>
    </div>
    <div id="hub-body"></div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(badge);

  function showOverlay(on){
    overlay.style.display = on ? "block" : "none";
  }
  function toggleOverlay(){
    showOverlay(overlay.style.display !== "block");
  }

  // badge click toggles overlay
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleOverlay();
  });

  $("#hub-close", overlay).addEventListener("click", () => showOverlay(false));

  // draggable badge (mobile-friendly)
  (function makeDraggable(node){
    let dragging=false, startX=0, startY=0, origX=0, origY=0;
    node.addEventListener("pointerdown", (e) => {
      dragging = true;
      node.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
      const r = node.getBoundingClientRect();
      origX = r.left; origY = r.top;
    });
    node.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      node.style.left = Math.max(6, origX + dx) + "px";
      node.style.top  = Math.max(6, origY + dy) + "px";
      node.style.right = "auto";
    });
    node.addEventListener("pointerup", () => dragging=false);
    node.addEventListener("pointercancel", () => dragging=false);
  })(badge);

  const body = $("#hub-body", overlay);

  function setActiveTab(tab){
    overlay.querySelectorAll(".hub-tabbtn").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    renderTab(tab);
  }

  overlay.querySelectorAll(".hub-tabbtn").forEach(b => {
    b.addEventListener("click", () => setActiveTab(b.dataset.tab));
  });

  function renderTab(tab){
    if (tab === "login") return renderLogin();
    if (tab === "search") return renderSearch();
    if (tab === "trains") return renderTrains();
  }

  async function renderLogin(){
    const savedAdmin = GM_getValue(K_ADMIN, "");
    const savedApi   = GM_getValue(K_API, "");
    body.innerHTML = `
      <div class="hub-card">
        <div style="font-weight:900;margin-bottom:6px;">Login</div>
        <div class="hub-small">Admin key = the one you give your users. API key = their own Torn API key.</div>
        <div class="hub-row" style="margin-top:10px;">
          <input id="hub-admin" placeholder="Admin key" value="${escapeHtml(savedAdmin)}" />
          <input id="hub-api" placeholder="Your API key" value="${escapeHtml(savedApi)}" />
          <button class="hub-btn" id="hub-loginbtn">Sign in</button>
        </div>
        <div class="hub-small" id="hub-loginmsg" style="margin-top:10px;"></div>
      </div>
    `;

    $("#hub-loginbtn", body).addEventListener("click", async () => {
      const admin_key = ($("#hub-admin", body).value || "").trim();
      const api_key   = ($("#hub-api", body).value || "").trim();

      GM_setValue(K_ADMIN, admin_key);
      GM_setValue(K_API, api_key);

      $("#hub-loginmsg", body).textContent = "Signing in...";
      try{
        const data = await api("POST", "/api/login", { admin_key, api_key });
        GM_setValue(K_SESS, data.token);
        $("#hub-loginmsg", body).textContent = `✅ Logged in as ${data.name} [${data.user_id}]`;
      }catch(err){
        $("#hub-loginmsg", body).textContent = "❌ " + err.message;
      }
    });
  }

  async function renderSearch(){
    body.innerHTML = `
      <div class="hub-card">
        <div style="font-weight:900;margin-bottom:6px;">Hall of Fame: Work Stats Search</div>
        <div class="hub-small">Find players with total work stats between Min and Max (supports big ranges like 500 → 120,000).</div>
        <div class="hub-row" style="margin-top:10px;">
          <input id="hof-min" placeholder="Min (e.g. 500)" value="500" />
          <input id="hof-max" placeholder="Max (e.g. 120000)" value="120000" />
          <button class="hub-btn" id="hof-go">Scan</button>
        </div>
        <div class="hub-small" id="hof-msg" style="margin-top:10px;"></div>
        <div class="hub-list" id="hof-list"></div>
      </div>
    `;

    $("#hof-go", body).addEventListener("click", async () => {
      const min = parseInt(($("#hof-min", body).value || "0").trim(), 10);
      const max = parseInt(($("#hof-max", body).value || "0").trim(), 10);
      $("#hof-msg", body).textContent = "Scanning HoF...";
      $("#hof-list", body).innerHTML = "";

      try{
        const data = await api("GET", `/api/hof_scan?min=${encodeURIComponent(min)}&max=${encodeURIComponent(max)}`);
        $("#hof-msg", body).textContent = `✅ Found ${data.count} results (showing up to 200)`;
        const list = $("#hof-list", body);

        (data.results || []).slice(0, 200).forEach(r => {
          const id = r.id || "";
          const name = r.name || "(unknown)";
          const val = r.value || 0;
          const rank = r.rank || "";
          const node = el("div", { class: "hub-item" },
            `<div><b>${escapeHtml(name)}</b> <span class="hub-small">[${escapeHtml(id)}]</span></div>
             <div><span class="hub-small">rank</span> <b>${rank}</b> · <span class="hub-small">value</span> <b>${val.toLocaleString()}</b></div>`
          );
          list.appendChild(node);
        });

      }catch(err){
        $("#hof-msg", body).textContent = "❌ " + err.message + " (Try logging in again.)";
      }
    });
  }

  async function renderTrains(){
    body.innerHTML = `
      <div class="hub-card">
        <div style="font-weight:900;margin-bottom:6px;">Trains</div>
        <div class="hub-row">
          <input id="tr-company" placeholder="Company ID (optional)" value="" />
          <input id="tr-buyer" placeholder="Buyer" value="" />
          <input id="tr-amount" placeholder="Amount" value="1" />
          <button class="hub-btn" id="tr-add">Add</button>
        </div>
        <div class="hub-small" id="tr-msg" style="margin-top:10px;"></div>
        <div class="hub-list" id="tr-list"></div>
      </div>
    `;

    $("#tr-add", body).addEventListener("click", async () => {
      const company_id = ($("#tr-company", body).value || "").trim();
      const buyer = ($("#tr-buyer", body).value || "").trim();
      const amount = parseInt(($("#tr-amount", body).value || "0").trim(), 10);

      $("#tr-msg", body).textContent = "Saving...";
      try{
        await api("POST", "/api/trains", { company_id, buyer, amount });
        $("#tr-msg", body).textContent = "✅ Saved";
        await refreshTrains();
      }catch(err){
        $("#tr-msg", body).textContent = "❌ " + err.message;
      }
    });

    await refreshTrains();

    async function refreshTrains(){
      const list = $("#tr-list", body);
      list.innerHTML = "";
      try{
        const trains = await api("GET", "/api/trains");
        trains.forEach(t => {
          const node = el("div", { class: "hub-item" }, `
            <div>
              <b>${escapeHtml(t.buyer || "buyer")}</b>
              <span class="hub-small"> ${escapeHtml(String(t.company_id || ""))}</span>
              <div class="hub-small">${escapeHtml(String(t.created_at || ""))}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <b>${Number(t.amount||0)}</b>
              <button class="hub-btn" data-id="${t.id}" data-act="toggle" style="padding:6px 10px;">
                ${t.used ? "Used" : "New"}
              </button>
              <button class="hub-btn" data-id="${t.id}" data-act="del" style="padding:6px 10px;background:rgba(255,90,90,0.22);">
                Del
              </button>
            </div>
          `);
          list.appendChild(node);
        });

        list.querySelectorAll("button[data-act='toggle']").forEach(btn => {
          btn.addEventListener("click", async () => {
            const id = parseInt(btn.dataset.id, 10);
            const used = btn.textContent.trim() !== "Used";
            await api("POST", "/api/trains/used", { id, used });
            await refreshTrains();
          });
        });

        list.querySelectorAll("button[data-act='del']").forEach(btn => {
          btn.addEventListener("click", async () => {
            const id = parseInt(btn.dataset.id, 10);
            await api("POST", "/api/trains/delete", { id });
            await refreshTrains();
          });
        });

      }catch(err){
        $("#tr-msg", body).textContent = "❌ " + err.message + " (Login first.)";
      }
    }
  }

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  // default tab
  setActiveTab("login");
})();
