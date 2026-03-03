// ==UserScript==
// @name         7DS Hiring Scan 💼 (Shield Overlay)
// @namespace    7ds-wrath-hiring
// @version      1.0.0
// @description  Shield overlay that opens your hiring/company comparison panel.
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

  const PANEL_URL = "https://sevends-hiring-scan.onrender.com/?embed=1";

  const SHIELD_ID = "wrath-hiring-shield";
  const POS_KEY = "wrath_hiring_pos";

  GM_addStyle(`
    #${SHIELD_ID}{
      position:fixed; z-index:999999;
      width:54px; height:54px;
      right:12px; top:170px;
      border-radius:16px;
      background: linear-gradient(180deg, #1a2434, #0b1220);
      border:1px solid rgba(255,255,255,.15);
      box-shadow: 0 10px 30px rgba(0,0,0,.45);
      display:flex; align-items:center; justify-content:center;
      user-select:none;
    }
    #${SHIELD_ID} .icon{ font-size:26px; }
    #wrath-hiring-frame{
      position:fixed; z-index:999998;
      right:12px; top:230px;
      width: min(92vw, 760px);
      height: min(76vh, 760px);
      border-radius:16px;
      border:1px solid rgba(255,255,255,.15);
      background:#0b0f14;
      box-shadow: 0 18px 50px rgba(0,0,0,.55);
      overflow:hidden;
      display:none;
    }
    #wrath-hiring-frame iframe{
      width:100%; height:100%;
      border:0;
      background:#0b0f14;
    }
  `);

  function loadPos(el){
    const raw = GM_getValue(POS_KEY, "");
    if (!raw) return;
    try{
      const p = JSON.parse(raw);
      if (typeof p.top === "number") el.style.top = p.top + "px";
      if (typeof p.right === "number") el.style.right = p.right + "px";
    }catch(e){}
  }
  function savePos(el){
    const top = parseInt(el.style.top || "0", 10);
    const right = parseInt(el.style.right || "0", 10);
    GM_setValue(POS_KEY, JSON.stringify({top, right}));
  }

  const shield = document.createElement("div");
  shield.id = SHIELD_ID;
  shield.innerHTML = `<div class="icon">💼</div>`;
  document.body.appendChild(shield);

  const frameWrap = document.createElement("div");
  frameWrap.id = "wrath-hiring-frame";
  frameWrap.innerHTML = `<iframe src="${PANEL_URL}"></iframe>`;
  document.body.appendChild(frameWrap);

  loadPos(shield);

  // Click to toggle panel
  shield.addEventListener("click", () => {
    frameWrap.style.display = (frameWrap.style.display === "none" || !frameWrap.style.display) ? "block" : "none";
  });

  // Drag shield
  let dragging = false, startY = 0, startX = 0, startTop = 0, startRight = 0;

  shield.addEventListener("pointerdown", (e) => {
    dragging = true;
    shield.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startX = e.clientX;

    const rect = shield.getBoundingClientRect();
    startTop = rect.top;
    startRight = window.innerWidth - rect.right;
    e.preventDefault();
  });

  shield.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    const dx = e.clientX - startX;
    const newTop = Math.max(8, Math.min(window.innerHeight - 62, startTop + dy));
    const newRight = Math.max(8, Math.min(window.innerWidth - 62, startRight - dx));
    shield.style.top = newTop + "px";
    shield.style.right = newRight + "px";
  });

  shield.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    savePos(shield);
  });
})();
