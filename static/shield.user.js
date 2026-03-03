// ==UserScript==
// @name         7DS Hiring Scan 💼
// @namespace    7ds-wrath-hiring
// @version      1.1.0
// @description  Hiring scanner overlay (Companies + Applicant Compare)
// @author       Fries91
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/Fries91/sevends-hiring-scan/main/static/shield.user.js
// @downloadURL  https://raw.githubusercontent.com/Fries91/sevends-hiring-scan/main/static/shield.user.js
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_URL = "https://sevends-hiring-scan.onrender.com/";
  const SHIELD_ID = "wrath-hiring-shield";
  const FRAME_ID = "wrath-hiring-frame";
  const POS_KEY = "wrath_hiring_pos_v1";

  GM_addStyle(`
    #${SHIELD_ID}{
      position:fixed;
      z-index:999999;
      width:56px;
      height:56px;
      right:14px;
      top:180px;
      border-radius:16px;
      background:linear-gradient(180deg,#1a2434,#0b1220);
      border:1px solid rgba(255,255,255,.15);
      box-shadow:0 12px 30px rgba(0,0,0,.5);
      display:flex;
      align-items:center;
      justify-content:center;
      cursor:pointer;
      user-select:none;
      backdrop-filter: blur(6px);
    }

    #${SHIELD_ID}:hover{
      transform:scale(1.05);
    }

    #${SHIELD_ID} .icon{
      font-size:26px;
    }

    #${FRAME_ID}{
      position:fixed;
      z-index:999998;
      right:14px;
      top:250px;
      width:min(94vw,800px);
      height:min(80vh,820px);
      border-radius:16px;
      border:1px solid rgba(255,255,255,.15);
      background:#0b0f14;
      box-shadow:0 20px 60px rgba(0,0,0,.65);
      overflow:hidden;
      display:none;
    }

    #${FRAME_ID} iframe{
      width:100%;
      height:100%;
      border:0;
      background:#0b0f14;
    }
  `);

  function loadPos(el){
    const raw = GM_getValue(POS_KEY,"");
    if(!raw) return;
    try{
      const p = JSON.parse(raw);
      if(typeof p.top==="number") el.style.top=p.top+"px";
      if(typeof p.right==="number") el.style.right=p.right+"px";
    }catch(e){}
  }

  function savePos(el){
    const top=parseInt(el.style.top||"0",10);
    const right=parseInt(el.style.right||"0",10);
    GM_setValue(POS_KEY,JSON.stringify({top,right}));
  }

  const shield=document.createElement("div");
  shield.id=SHIELD_ID;
  shield.innerHTML=`<div class="icon">💼</div>`;
  document.body.appendChild(shield);

  const frameWrap=document.createElement("div");
  frameWrap.id=FRAME_ID;
  frameWrap.innerHTML=`<iframe src="${PANEL_URL}"></iframe>`;
  document.body.appendChild(frameWrap);

  loadPos(shield);

  // Toggle open/close
  shield.addEventListener("click",()=>{
    frameWrap.style.display=
      (frameWrap.style.display==="none"||!frameWrap.style.display)
      ?"block":"none";
  });

  // Drag logic
  let dragging=false,startY=0,startX=0,startTop=0,startRight=0;

  shield.addEventListener("pointerdown",(e)=>{
    dragging=true;
    shield.setPointerCapture(e.pointerId);
    startY=e.clientY;
    startX=e.clientX;

    const rect=shield.getBoundingClientRect();
    startTop=rect.top;
    startRight=window.innerWidth-rect.right;
    e.preventDefault();
  });

  shield.addEventListener("pointermove",(e)=>{
    if(!dragging) return;
    const dy=e.clientY-startY;
    const dx=e.clientX-startX;

    const newTop=Math.max(8,
      Math.min(window.innerHeight-70,startTop+dy));
    const newRight=Math.max(8,
      Math.min(window.innerWidth-70,startRight-dx));

    shield.style.top=newTop+"px";
    shield.style.right=newRight+"px";
  });

  shield.addEventListener("pointerup",()=>{
    if(!dragging) return;
    dragging=false;
    savePos(shield);
  });

})();
