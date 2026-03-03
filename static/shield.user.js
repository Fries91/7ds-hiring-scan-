// ==UserScript==
// @name         7DS Hiring Hub 💼
// @namespace    7ds-wrath-hiring
// @version      3.1.0
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
const TOKEN_KEY = "wh_admin_token";

function api(path, method="GET", body=null) {
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
position:fixed;right:14px;top:180px;
width:60px;height:60px;
background:#0b1220;border-radius:18px;
display:flex;align-items:center;justify-content:center;
z-index:999999;color:white;font-size:28px;
box-shadow:0 10px 30px rgba(0,0,0,.6);
cursor:pointer;
}
#whPanel{
position:fixed;right:14px;top:250px;
width:800px;height:600px;
background:#0b0f14;color:white;
border-radius:16px;
display:none;z-index:999998;
padding:12px;overflow:auto;
}
.whBtn{padding:6px 10px;margin:4px;background:#111;border:1px solid #333;color:white;border-radius:8px;cursor:pointer;}
`);

const badge=document.createElement("div");
badge.id="whBadge";
badge.innerHTML="💼";
document.body.appendChild(badge);

const panel=document.createElement("div");
panel.id="whPanel";
panel.innerHTML=`
<button class="whBtn" id="setTok">Set Token</button>
<button class="whBtn" id="loadApps">Load Applications</button>
<button class="whBtn" id="closeWh">Close</button>
<hr>
<div id="appsOut">No data</div>
<hr>
<h4>Applicant Scan (One-time key)</h4>
<input id="appId" placeholder="Applicant ID">
<input id="appKey" placeholder="Applicant API key">
<button class="whBtn" id="scanApp">Scan</button>
<div id="appOut"></div>
`;
document.body.appendChild(panel);

badge.onclick=()=>panel.style.display=panel.style.display==="block"?"none":"block";
document.getElementById("closeWh").onclick=()=>panel.style.display="none";

document.getElementById("setTok").onclick=()=>{
  const t=prompt("Enter ADMIN_TOKEN:");
  if(t) GM_setValue(TOKEN_KEY,t);
};

document.getElementById("loadApps").onclick=async()=>{
  const data=await api("/api/applications");
  if(!data.ok){document.getElementById("appsOut").innerText="Error";return;}
  document.getElementById("appsOut").innerHTML=
    data.rows.map(r=>`
      <div style="margin-bottom:6px">
        <b>${r.applicant_id||"Unknown"}</b>
        <small>(${r.status})</small>
        <button class="whBtn" onclick="updateStatus(${r.id},'reviewed')">Reviewed</button>
      </div>
    `).join("");
};

window.updateStatus=async(id,status)=>{
  await api("/api/applications/status","POST",{id,status});
  document.getElementById("loadApps").click();
};

document.getElementById("scanApp").onclick=async()=>{
  const id=document.getElementById("appId").value;
  const key=document.getElementById("appKey").value;
  if(!id||!key) return;
  const data=await api(`/api/applicant?id=${id}&key=${key}`);
  if(!data.ok){document.getElementById("appOut").innerText="Error";return;}
  const ws=data.workstats;
  document.getElementById("appOut").innerText=
    `MAN:${ws.man} INT:${ws.int} END:${ws.end} TOTAL:${ws.total}`;
  document.getElementById("appKey").value=""; // clears key (one-time use)
};

})();
