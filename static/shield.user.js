// ==UserScript==
// @name         7DS Hiring Hub 💼 (Compact Overlay)
// @namespace    7ds-wrath-hiring
// @version      3.2.0
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      sevends-hiring-scan.onrender.com
// @updateURL    https://raw.githubusercontent.com/Fries91/7ds-hiring-scan-/main/static/shield.user.js
// @downloadURL  https://raw.githubusercontent.com/Fries91/7ds-hiring-scan-/main/static/shield.user.js
// ==/UserScript==

(function () {
"use strict";

const BASE = "https://sevends-hiring-scan.onrender.com";
const TOKEN_KEY = "wh_admin_token_v2";
const POS_BADGE = "wh_badge_pos_compact";
const POS_PANEL = "wh_panel_pos_compact";

function api(path, method="GET", body=null){
  return new Promise(resolve=>{
    GM_xmlhttpRequest({
      method,
      url: BASE+path+"?admin="+encodeURIComponent(GM_getValue(TOKEN_KEY,"")),
      data: body?JSON.stringify(body):null,
      headers: body?{"Content-Type":"application/json"}:undefined,
      onload:r=>resolve(JSON.parse(r.responseText||"{}")),
      onerror:()=>resolve({ok:false})
    });
  });
}

GM_addStyle(`
#whBadge{
position:fixed;
right:12px; top:170px;
width:48px; height:48px;
border-radius:14px;
background:linear-gradient(180deg,#1a2434,#0b1220);
border:1px solid rgba(255,255,255,.15);
display:flex;align-items:center;justify-content:center;
font-size:22px;color:white;
z-index:999999;
box-shadow:0 8px 22px rgba(0,0,0,.6);
cursor:pointer;
user-select:none;
}

#whPanel{
position:fixed;
right:12px; top:230px;
width:min(92vw,720px);
height:min(78vh,640px);
background:#0b0f14;
border-radius:14px;
border:1px solid rgba(255,255,255,.12);
box-shadow:0 18px 50px rgba(0,0,0,.7);
display:none;
z-index:999998;
padding:10px;
overflow:auto;
color:#e8eef7;
font-family:system-ui,Arial;
font-size:12px;
}

.whHeader{
display:flex;justify-content:space-between;align-items:center;
margin-bottom:6px;font-weight:700;font-size:13px;
}

.whBtn{
padding:4px 8px;
background:#111;
border:1px solid #333;
color:#fff;
border-radius:6px;
font-size:11px;
cursor:pointer;
}

.whInput{
padding:6px;
background:#111;
border:1px solid #333;
border-radius:6px;
color:white;
font-size:11px;
width:100%;
}

.whRow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;}

.whCard{
background:#101826;
border:1px solid rgba(255,255,255,.08);
border-radius:10px;
padding:8px;
margin-bottom:8px;
}

table{
width:100%;
border-collapse:collapse;
font-size:11px;
}
th,td{
padding:4px;
border-bottom:1px solid rgba(255,255,255,.08);
text-align:left;
}
th{background:#0c1320;}
`);

const badge=document.createElement("div");
badge.id="whBadge";
badge.innerHTML="💼";
document.body.appendChild(badge);

const panel=document.createElement("div");
panel.id="whPanel";
panel.innerHTML=`
<div class="whHeader">
  <span>Hiring Hub</span>
  <div>
    <button class="whBtn" id="setTok">Token</button>
    <button class="whBtn" id="loadApps">Apps</button>
    <button class="whBtn" id="closeWh">X</button>
  </div>
</div>

<div class="whCard">
  <div class="whRow">
    <input class="whInput" id="appId" placeholder="Applicant ID">
    <input class="whInput" id="appKey" placeholder="API key">
    <button class="whBtn" id="scanApp">Scan</button>
  </div>
  <div id="appOut">No applicant loaded</div>
</div>

<div class="whCard">
  <div id="appsOut">Press Apps</div>
</div>
`;
document.body.appendChild(panel);

/* Toggle */
badge.onclick=()=>panel.style.display=panel.style.display==="block"?"none":"block";
document.getElementById("closeWh").onclick=()=>panel.style.display="none";

/* Token */
document.getElementById("setTok").onclick=()=>{
  const t=prompt("Enter ADMIN_TOKEN:");
  if(t) GM_setValue(TOKEN_KEY,t);
};

/* Applications */
document.getElementById("loadApps").onclick=async()=>{
  const data=await api("/api/applications");
  if(!data.ok){appsOut.innerText="Error loading";return;}
  appsOut.innerHTML=data.rows.map(r=>`
    <div style="margin-bottom:4px;">
      <b>${r.applicant_id||"Unknown"}</b>
      <small>(${r.status})</small>
    </div>
  `).join("");
};

/* Scan (one-time key) */
document.getElementById("scanApp").onclick=async()=>{
  const id=appId.value;
  const key=appKey.value;
  if(!id||!key)return;
  const data=await api(\`/api/applicant?id=\${id}&key=\${key}\`);
  if(!data.ok){appOut.innerText="Scan error";return;}
  const ws=data.workstats;
  appOut.innerText=\`MAN:\${ws.man} INT:\${ws.int} END:\${ws.end} TOTAL:\${ws.total}\`;
  appKey.value=""; // clears key immediately
};

/* Simple smooth drag */
let dragging=false,startX=0,startY=0,startTop=0,startRight=0;

badge.addEventListener("pointerdown",e=>{
  dragging=true;
  startX=e.clientX; startY=e.clientY;
  const rect=badge.getBoundingClientRect();
  startTop=rect.top;
  startRight=window.innerWidth-rect.right;
});
document.addEventListener("pointermove",e=>{
  if(!dragging)return;
  const dx=e.clientX-startX;
  const dy=e.clientY-startY;
  badge.style.top=Math.max(8,startTop+dy)+"px";
  badge.style.right=Math.max(8,startRight-dx)+"px";
});
document.addEventListener("pointerup",()=>dragging=false);

})();
