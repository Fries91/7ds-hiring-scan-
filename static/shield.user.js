// ==UserScript==
// @name         7DS*: Peace Hiring Hub 💼 (Multi-User Admin Key + User API Key)
// @namespace    sevends-hiring-scan
// @version      2.0.0
// @description  Multi-user Hiring Hub. You need an Admin Key (from Fries) + your own Torn API key. Session-token auth. Companies/Trains/Applications/HoF Search.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  // -----------------------
  // Storage keys
  // -----------------------
  const K_BASE = "peace_hub_base_url";
  const K_ADMIN = "peace_hub_admin_key";
  const K_API = "peace_hub_user_api_key";
  const K_TOKEN = "peace_hub_session_token";
  const K_COMPANY_IDS = "peace_hub_company_ids";

  // -----------------------
  // Helpers
  // -----------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function gmReq(method, url, dataObj) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: { "Content-Type": "application/json" },
        data: dataObj ? JSON.stringify(dataObj) : null,
        onload: (res) => {
          try {
            const json = JSON.parse(res.responseText || "{}");
            resolve({ status: res.status, json });
          } catch (e) {
            resolve({ status: res.status, json: { ok: false, error: "bad json" } });
          }
        },
        onerror: () => reject(new Error("network error")),
      });
    });
  }

  function gmReqAuthed(method, url, dataObj) {
    return new Promise((resolve, reject) => {
      const token = (GM_getValue(K_TOKEN, "") || "").trim();
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": token,
        },
        data: dataObj ? JSON.stringify(dataObj) : null,
        onload: (res) => {
          try {
            const json = JSON.parse(res.responseText || "{}");
            resolve({ status: res.status, json });
          } catch (e) {
            resolve({ status: res.status, json: { ok: false, error: "bad json" } });
          }
        },
        onerror: () => reject(new Error("network error")),
      });
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function promptSetupIfNeeded() {
    let base = (GM_getValue(K_BASE, "") || "").trim();
    let admin = (GM_getValue(K_ADMIN, "") || "").trim();
    let api = (GM_getValue(K_API, "") || "").trim();
    let cids = (GM_getValue(K_COMPANY_IDS, "") || "").trim();

    if (!base) base = prompt("Peace Hub BASE_URL (your Render URL)\nExample: https://sevends-hiring-scan.onrender.com", "") || "";
    if (!admin) admin = prompt("Admin Access Key (from Fries)", "") || "";
    if (!api) api = prompt("Your Torn API Key (your own key)", "") || "";
    if (!cids) cids = prompt("Your Company IDs (comma-separated) (optional)\nExample: 12345,67890", "") || "";

    base = base.trim().replace(/\/+$/, "");
    admin = admin.trim();
    api = api.trim();
    cids = cids.trim();

    GM_setValue(K_BASE, base);
    GM_setValue(K_ADMIN, admin);
    GM_setValue(K_API, api);
    GM_setValue(K_COMPANY_IDS, cids);
    return { base, admin, api, cids };
  }

  async function ensureAuth() {
    const base = (GM_getValue(K_BASE, "") || "").trim().replace(/\/+$/, "");
    const admin = (GM_getValue(K_ADMIN, "") || "").trim();
    const api = (GM_getValue(K_API, "") || "").trim();

    if (!base || !admin || !api) {
      promptSetupIfNeeded();
      return ensureAuth();
    }

    // If token exists, trust it until server rejects
    let tok = (GM_getValue(K_TOKEN, "") || "").trim();
    if (tok) return true;

    const { status, json } = await gmReq("POST", `${base}/api/auth`, {
      admin_key: admin,
      api_key: api,
    });

    if (!json || json.ok !== true || !json.token) {
      GM_setValue(K_TOKEN, "");
      throw new Error(json?.error || `Auth failed (HTTP ${status})`);
    }

    GM_setValue(K_TOKEN, json.token);

    // push company IDs right after auth (optional)
    const cids = (GM_getValue(K_COMPANY_IDS, "") || "").trim();
    if (cids) {
      await gmReqAuthed("POST", `${base}/api/user/companies`, { company_ids: cids });
    }

    return true;
  }

  // -----------------------
  // UI
  // -----------------------
  GM_addStyle(`
    #peace-badge, #peace-panel { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial; }
    #peace-badge {
      position: fixed; right: 14px; bottom: 110px; z-index: 999999;
      width: 54px; height: 54px; border-radius: 16px;
      background: linear-gradient(135deg, #111827, #0b1220);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 10px 25px rgba(0,0,0,0.35);
      display: grid; place-items: center; cursor: pointer;
      user-select:none;
    }
    #peace-badge span { font-size: 26px; line-height: 1; }
    #peace-panel {
      position: fixed; right: 14px; bottom: 170px; z-index: 999999;
      width: min(92vw, 360px);
      background: rgba(10,14,22,0.94);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.5);
      overflow: hidden;
      display: none;
      backdrop-filter: blur(6px);
    }
    #peace-head {
      padding: 10px 12px;
      display:flex; align-items:center; justify-content:space-between;
      border-bottom: 1px solid rgba(255,255,255,0.10);
      color: #e5e7eb;
      font-weight: 900;
      letter-spacing: 0.2px;
    }
    #peace-head small { font-weight: 700; opacity: 0.75; margin-left: 8px; }
    #peace-tabs {
      display:flex; gap:6px; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);
      flex-wrap: wrap;
    }
    .p-tab {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.08);
      color: #e5e7eb;
      font-weight: 800;
      border-radius: 10px;
      padding: 6px 8px;
      font-size: 12px;
      cursor: pointer;
    }
    .p-tab.active { background: rgba(99,102,241,0.22); border-color: rgba(99,102,241,0.35); }
    #peace-body { padding: 10px; color: #e5e7eb; }
    .p-row { display:flex; gap:8px; align-items:center; margin: 8px 0; }
    .p-row input, .p-row select {
      width: 100%;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 10px;
      padding: 8px 10px;
      color: #e5e7eb;
      outline: none;
      font-size: 12px;
    }
    .p-btn {
      background: rgba(34,197,94,0.20);
      border: 1px solid rgba(34,197,94,0.25);
      color: #e5e7eb;
      border-radius: 10px;
      padding: 8px 10px;
      font-weight: 900;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    .p-btn.red { background: rgba(239,68,68,0.20); border-color: rgba(239,68,68,0.25); }
    .muted { opacity: 0.75; font-size: 12px; }
    .card {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 12px;
      padding: 10px;
      margin: 8px 0;
    }
    .card .top { display:flex; justify-content:space-between; gap:10px; align-items:center; }
    .pill { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.08); }
  `);

  const badge = document.createElement("div");
  badge.id = "peace-badge";
  badge.innerHTML = `<span>💼</span>`;
  document.body.appendChild(badge);

  const panel = document.createElement("div");
  panel.id = "peace-panel";
  panel.innerHTML = `
    <div id="peace-head">
      <div>7DS*: Peace <small>Hiring Hub</small></div>
      <div style="display:flex;gap:6px;">
        <button class="p-btn" id="p-settings">Settings</button>
        <button class="p-btn red" id="p-close">X</button>
      </div>
    </div>
    <div id="peace-tabs">
      <button class="p-tab active" data-tab="companies">Companies</button>
      <button class="p-tab" data-tab="trains">Trains</button>
      <button class="p-tab" data-tab="apps">Applications</button>
      <button class="p-tab" data-tab="search">Search</button>
    </div>
    <div id="peace-body"></div>
  `;
  document.body.appendChild(panel);

  function togglePanel() {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  }

  badge.addEventListener("click", togglePanel);
  panel.querySelector("#p-close").addEventListener("click", togglePanel);

  panel.querySelector("#p-settings").addEventListener("click", () => {
    GM_setValue(K_TOKEN, "");
    promptSetupIfNeeded();
    renderActiveTab();
  });

  const tabs = Array.from(panel.querySelectorAll(".p-tab"));
  let active = "companies";

  tabs.forEach((b) => {
    b.addEventListener("click", () => {
      tabs.forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      active = b.getAttribute("data-tab");
      renderActiveTab();
    });
  });

  const body = panel.querySelector("#peace-body");

  async function renderActiveTab() {
    body.innerHTML = `<div class="muted">Loading…</div>`;

    try {
      promptSetupIfNeeded();
      await ensureAuth();
    } catch (e) {
      body.innerHTML = `
        <div class="card">
          <div style="font-weight:900;">Auth Error</div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(e.message || String(e))}</div>
          <div class="p-row" style="margin-top:10px;">
            <button class="p-btn" id="fix">Re-enter Settings</button>
          </div>
        </div>`;
      body.querySelector("#fix").onclick = () => {
        GM_setValue(K_TOKEN, "");
        promptSetupIfNeeded();
        renderActiveTab();
      };
      return;
    }

    if (active === "companies") return renderCompanies();
    if (active === "trains") return renderTrains();
    if (active === "apps") return renderApps();
    if (active === "search") return renderSearch();
  }

  async function renderCompanies() {
    const base = (GM_getValue(K_BASE, "") || "").trim().replace(/\/+$/, "");
    const res = await gmReqAuthed("GET", `${base}/api/companies`, null);
    if (!res.json || res.json.ok !== true) {
      body.innerHTML = `<div class="card"><div style="font-weight:900;">Error</div><div class="muted">${escapeHtml(res.json?.error || "Failed")}</div></div>`;
      return;
    }
    const rows = res.json.rows || [];
    if (!rows.length) {
      body.innerHTML = `
        <div class="card">
          <div style="font-weight:900;">No companies loaded</div>
          <div class="muted" style="margin-top:6px;">Add company IDs in Settings (comma-separated), then reopen tab.</div>
        </div>`;
      return;
    }

    body.innerHTML = rows
      .map((c) => {
        const emps = (c.employees || []).length;
        const err = c.error ? `<div class="muted" style="margin-top:6px;color:#fca5a5;">${escapeHtml(c.error)}</div>` : "";
        return `
          <div class="card">
            <div class="top">
              <div style="font-weight:900;min-width:0;">${escapeHtml(c.name || ("Company " + c.company_id))}</div>
              <div class="pill">${escapeHtml(String(emps))} employees</div>
            </div>
            ${err}
            <div class="muted" style="margin-top:8px;">ID: ${escapeHtml(c.company_id)}</div>
          </div>`;
      })
      .join("");
  }

  async function renderTrains() {
    const base = (GM_getValue(K_BASE, "") || "").trim().replace(/\/+$/, "");
    const companyIds = (GM_getValue(K_COMPANY_IDS, "") || "").trim();

    if (!companyIds) {
      body.innerHTML = `
        <div class="card">
          <div style="font-weight:900;">No company IDs set</div>
          <div class="muted" style="margin-top:6px;">Go to Settings and add company IDs to use train tracking.</div>
        </div>`;
      return;
    }

    const ids = companyIds.split(",").map((x) => x.trim()).filter(Boolean);

    body.innerHTML = `
      <div class="card">
        <div style="font-weight:900;">Add Train Entry</div>
        <div class="p-row">
          <select id="cid">${ids.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("")}</select>
        </div>
        <div class="p-row"><input id="buyer" placeholder="Buyer name" /></div>
        <div class="p-row"><input id="trains" placeholder="Amount of trains" inputmode="numeric" /></div>
        <div class="p-row"><input id="note" placeholder="Note (optional)" /></div>
        <div class="p-row"><button class="p-btn" id="add">Add</button></div>
      </div>
      <div id="train-list"></div>
    `;

    async function loadList() {
      const cid = body.querySelector("#cid").value;
      const res = await gmReqAuthed("GET", `${base}/api/trains?company_id=${encodeURIComponent(cid)}`, null);
      const wrap = body.querySelector("#train-list");
      if (!res.json || res.json.ok !== true) {
        wrap.innerHTML = `<div class="card"><div style="font-weight:900;">Error</div><div class="muted">${escapeHtml(res.json?.error || "Failed")}</div></div>`;
        return;
      }
      const rows = res.json.rows || [];
      if (!rows.length) {
        wrap.innerHTML = `<div class="card"><div class="muted">No train entries yet.</div></div>`;
        return;
      }
      wrap.innerHTML = rows
        .map((r) => {
          return `
            <div class="card">
              <div class="top">
                <div style="font-weight:900;">${escapeHtml(r.buyer)} • ${escapeHtml(String(r.trains))} trains</div>
                <button class="p-btn red" data-del="${escapeHtml(String(r.id))}">Delete</button>
              </div>
              <div class="muted" style="margin-top:6px;">${escapeHtml(r.note || "")}</div>
              <div class="muted" style="margin-top:4px;">${escapeHtml(r.created_at || "")}</div>
            </div>
          `;
        })
        .join("");

      wrap.querySelectorAll("[data-del]").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-del");
          await gmReqAuthed("POST", `${base}/api/trains/delete`, { id: Number(id) });
          loadList();
        };
      });
    }

    body.querySelector("#cid").onchange = loadList;

    body.querySelector("#add").onclick = async () => {
      const cid = body.querySelector("#cid").value;
      const buyer = body.querySelector("#buyer").value.trim();
      const trains = body.querySelector("#trains").value.trim();
      const note = body.querySelector("#note").value.trim();

      const res = await gmReqAuthed("POST", `${base}/api/trains/add`, {
        company_id: cid,
        buyer,
        trains: Number(trains),
        note,
      });

      if (!res.json || res.json.ok !== true) {
        alert(res.json?.error || "Failed");
        return;
      }

      body.querySelector("#buyer").value = "";
      body.querySelector("#trains").value = "";
      body.querySelector("#note").value = "";
      loadList();
    };

    await loadList();
  }

  async function renderApps() {
    const base = (GM_getValue(K_BASE, "") || "").trim().replace(/\/+$/, "");
    const res = await gmReqAuthed("GET", `${base}/api/applications`, null);
    if (!res.json || res.json.ok !== true) {
      body.innerHTML = `<div class="card"><div style="font-weight:900;">Error</div><div class="muted">${escapeHtml(res.json?.error || "Failed")}</div></div>`;
      return;
    }
    const rows = res.json.rows || [];
    if (!rows.length) {
      body.innerHTML = `<div class="card"><div style="font-weight:900;">No applications yet</div><div class="muted" style="margin-top:6px;">This reads from your own Torn Events when you open this tab.</div></div>`;
      return;
    }

    body.innerHTML = rows
      .map((row) => {
        const applicantId = (row.applicant_id || "").trim();
        const status = row.status || "new";
        return `
          <div class="card">
            <div class="top">
              <div style="min-width:0;">
                <div style="font-weight:900;">Applicant ${applicantId ? `[${escapeHtml(applicantId)}]` : "[unknown]"}</div>
                <div class="muted">${escapeHtml(row.created_at || "")}</div>
              </div>
              <a class="p-btn" href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(applicantId)}" target="_blank">Open</a>
            </div>
            <div class="muted" style="margin-top:8px;word-break:break-word;">${escapeHtml(row.raw_text || "")}</div>

            <div class="p-row" style="margin-top:10px;">
              <select data-sel="${escapeHtml(String(row.id))}">
                ${["new","seen","interview","hired","rejected"].map((s)=>`<option value="${s}" ${s===status?"selected":""}>${s.toUpperCase()}</option>`).join("")}
              </select>
              <button class="p-btn" data-ws="${escapeHtml(applicantId)}">Workstats</button>
            </div>
            <div class="muted" id="ws-${escapeHtml(String(row.id))}" style="margin-top:6px;"></div>
          </div>
        `;
      })
      .join("");

    body.querySelectorAll("select[data-sel]").forEach((sel) => {
      sel.onchange = async () => {
        const id = Number(sel.getAttribute("data-sel"));
        await gmReqAuthed("POST", `${base}/api/applications/status`, { id, status: sel.value });
      };
    });

    body.querySelectorAll("button[data-ws]").forEach((btn) => {
      btn.onclick = async () => {
        const applicantId = (btn.getAttribute("data-ws") || "").trim();
        const card = btn.closest(".card");
        const sel = card.querySelector("select[data-sel]");
        const id = Number(sel.getAttribute("data-sel"));
        const out = card.querySelector(`#ws-${CSS.escape(String(id))}`);
        out.textContent = "Loading…";

        const r = await gmReqAuthed("GET", `${base}/api/applicant?id=${encodeURIComponent(applicantId)}`, null);
        if (!r.json || r.json.ok !== true) {
          out.textContent = r.json?.error || "Failed";
          return;
        }
        const ws = r.json.workstats || {};
        out.textContent = `MAN ${ws.man ?? "?"} • INT ${ws.int ?? "?"} • END ${ws.end ?? "?"} • TOTAL ${ws.total ?? "?"}`;
      };
    });
  }

  async function renderSearch() {
    const base = (GM_getValue(K_BASE, "") || "").trim().replace(/\/+$/, "");

    body.innerHTML = `
      <div class="card">
        <div style="font-weight:900;">HoF Workstats Search</div>
        <div class="muted" style="margin-top:6px;">Searches Hall of Fame workstats using YOUR API key.</div>
        <div class="p-row"><input id="min" placeholder="Min total (e.g., 20000)" inputmode="numeric" /></div>
        <div class="p-row"><input id="max" placeholder="Max total (e.g., 40000)" inputmode="numeric" /></div>
        <div class="p-row"><input id="limit" placeholder="Limit (max 300)" inputmode="numeric" value="100" /></div>
        <div class="p-row"><button class="p-btn" id="go">Search</button></div>
      </div>
      <div id="results"></div>
    `;

    body.querySelector("#go").onclick = async () => {
      const min = body.querySelector("#min").value.trim();
      const max = body.querySelector("#max").value.trim();
      const limit = body.querySelector("#limit").value.trim() || "100";
      const out = body.querySelector("#results");
      out.innerHTML = `<div class="card"><div class="muted">Searching…</div></div>`;

      const r = await gmReqAuthed(
        "GET",
        `${base}/api/search_workstats?min=${encodeURIComponent(min)}&max=${encodeURIComponent(max)}&limit=${encodeURIComponent(limit)}`,
        null
      );

      if (!r.json || r.json.ok !== true) {
        out.innerHTML = `<div class="card"><div style="font-weight:900;">Error</div><div class="muted">${escapeHtml(r.json?.error || "Failed")}</div></div>`;
        return;
      }

      const rows = r.json.rows || [];
      if (!rows.length) {
        out.innerHTML = `<div class="card"><div class="muted">No matches found.</div></div>`;
        return;
      }

      out.innerHTML = rows
        .map((x) => {
          return `
            <div class="card">
              <div class="top">
                <div style="font-weight:900;min-width:0;">${escapeHtml(x.name || "")} [${escapeHtml(x.id || "")}]</div>
                <div class="pill">${escapeHtml(String(x.value))}</div>
              </div>
              <div class="muted" style="margin-top:6px;">Rank: ${escapeHtml(String(x.rank ?? "?"))}</div>
              <div class="p-row" style="margin-top:8px;">
                <a class="p-btn" target="_blank" href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(x.id)}">Profile</a>
              </div>
            </div>
          `;
        })
        .join("");
    };
  }

  // initial render
  panel.style.display = "none";
  renderActiveTab();
})();
