/* =========================================================
   Eboard HQ — members each have their own calendar + personal
   space. Projects are shared (tasks assigned across people).
   All data lives in Supabase (if configured) and localStorage.
   ========================================================= */

const STORE_KEY = "eboard-hq-v1";

const MONTHS = [
  "August", "September", "October", "November", "December", "January",
  "February", "March", "April", "May", "June", "July"
];

const AVATAR_COLORS = [
  "#6d4aff", "#1faa6d", "#d98a00", "#d44b5d", "#2f8fd6",
  "#b54ad6", "#0f9e9e", "#e0673a", "#3a6fe0", "#c0428a"
];

/* ---------- State ---------- */
let state = load();

function blankMonths() {
  const months = {};
  MONTHS.forEach(m => (months[m] = { tasks: [], events: [] }));
  return months;
}
function blankState() {
  return { members: [], projects: [] };
}

/* Make sure any loaded data has the shape the app expects,
   and migrate older formats (global calendar / personal map). */
function normalize(s) {
  if (!s || typeof s !== "object") return blankState();
  if (!Array.isArray(s.members)) s.members = [];
  if (!Array.isArray(s.projects)) s.projects = [];

  s.members.forEach(m => {
    if (!m.months) m.months = blankMonths();
    else MONTHS.forEach(mo => { if (!m.months[mo]) m.months[mo] = { tasks: [], events: [] }; });
    if (!m.personal) m.personal = { ideas: [], goals: [] };
    if (!Array.isArray(m.personal.ideas)) m.personal.ideas = [];
    if (!Array.isArray(m.personal.goals)) m.personal.goals = [];
  });

  // migrate old per-member personal map -> member.personal
  if (s.personal) {
    s.members.forEach(m => {
      const old = s.personal[m.id];
      if (old) {
        if (Array.isArray(old.ideas)) m.personal.ideas = old.ideas.concat(m.personal.ideas);
        if (Array.isArray(old.goals)) m.personal.goals = old.goals.concat(m.personal.goals);
      }
    });
    delete s.personal;
  }
  // old global calendar is no longer used
  if (s.months) delete s.months;
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return blankState();
    return normalize(JSON.parse(raw));
  } catch (e) {
    return blankState();
  }
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  schedulePush();
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* =========================================================
   CLOUD SYNC (Supabase) — optional.
   ========================================================= */
const ROW_ID = "main";
const CLIENT_ID = (() => {
  let c = localStorage.getItem("eboard-client-id");
  if (!c) { c = uid(); localStorage.setItem("eboard-client-id", c); }
  return c;
})();

let sb = null;
let syncEnabled = false;
if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase) {
  try {
    sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    syncEnabled = true;
  } catch (e) { console.error("Supabase init failed", e); }
}

let lastSeen = null;
let pushTimer = null;
let pendingRemote = null;

const statusEl = document.getElementById("syncStatus");
function setStatus(kind, text) {
  statusEl.className = "sync-status " + kind;
  statusEl.textContent = text;
}

function schedulePush() {
  if (!syncEnabled) return;
  setStatus("saving", "Saving…");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushRemote, 600);
}

async function pushRemote() {
  if (!syncEnabled) return;
  const stamp = new Date().toISOString();
  try {
    const { error } = await sb.from("board").upsert(
      { id: ROW_ID, data: state, client_id: CLIENT_ID, updated_at: stamp },
      { onConflict: "id" }
    );
    if (error) throw error;
    lastSeen = stamp;
    setStatus("live", "Live · shared with everyone");
  } catch (e) {
    console.error("push failed", e);
    setStatus("error", "Couldn't sync · saved locally");
  }
}

function isTyping() {
  const a = document.activeElement;
  return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
}

function applyRemote(remoteData, stamp) {
  if (isTyping()) { pendingRemote = { remoteData, stamp }; return; }
  state = normalize(remoteData);
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  lastSeen = stamp;
  render();
  setStatus("live", "Live · shared with everyone");
}

document.addEventListener("focusout", () => {
  if (!pendingRemote) return;
  const p = pendingRemote;
  setTimeout(() => {
    if (pendingRemote === p && !isTyping()) { pendingRemote = null; applyRemote(p.remoteData, p.stamp); }
  }, 80);
});

async function pollRemote() {
  if (!syncEnabled) return;
  try {
    const { data, error } = await sb.from("board")
      .select("data, client_id, updated_at").eq("id", ROW_ID).maybeSingle();
    if (error) throw error;
    if (!data || data.updated_at === lastSeen) return;
    if (data.client_id === CLIENT_ID) { lastSeen = data.updated_at; return; }
    applyRemote(data.data, data.updated_at);
  } catch (e) {
    console.error("poll failed", e);
  }
}

async function initSync() {
  if (!syncEnabled) {
    setStatus("local", "Saved on this device only — see SETUP.md to share");
    return;
  }
  setStatus("saving", "Connecting…");
  try {
    const { data, error } = await sb.from("board")
      .select("data, client_id, updated_at").eq("id", ROW_ID).maybeSingle();
    if (error) throw error;
    if (data && data.data) {
      state = normalize(data.data);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      lastSeen = data.updated_at;
      render();
      setStatus("live", "Live · shared with everyone");
    } else {
      await pushRemote();
    }
  } catch (e) {
    console.error("connect failed", e);
    setStatus("error", "Can't reach the cloud · saved locally");
  }
  setInterval(pollRemote, 4000);
}

/* ---------- Helpers ---------- */
function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}
function colorFor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}
function memberById(id) { return state.members.find(m => m.id === id); }
function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/* ---------- Router ---------- */
let currentView = "members";   // "members" | "member" | "projects"
let activeMemberId = null;
let memberSubview = "calendar"; // "calendar" | "personal"
let activeMonth = MONTHS[0];

const app = document.getElementById("app");

document.getElementById("tabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  currentView = btn.dataset.view;
  render();
});

function render() {
  const topFor = currentView === "projects" ? "projects" : "members";
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.view === topFor));

  if (currentView === "members") renderMembers();
  else if (currentView === "member") renderMember();
  else if (currentView === "projects") renderProjects();
}

/* =========================================================
   MEMBERS (list)
   ========================================================= */
function renderMembers() {
  const cards = state.members.map(m => {
    const openTasks = MONTHS.reduce((n, mo) => n + m.months[mo].tasks.filter(t => !t.done).length, 0);
    return `
    <div class="card member-card clickable" data-id="${m.id}">
      <div class="avatar" style="background:${colorFor(m.id)}">${initials(m.name)}</div>
      <div class="member-meta">
        <div class="name">${escapeHtml(m.name)}</div>
        <div class="role">${escapeHtml(m.role) || "Member"}</div>
        <div class="mini">${openTasks} open task${openTasks === 1 ? "" : "s"} · open ›</div>
      </div>
      <button class="icon-btn" data-action="del-member" title="Remove">✕</button>
    </div>`;
  }).join("");

  app.innerHTML = `
    <div class="view-head">
      <div>
        <h2>Eboard Members</h2>
        <p>Click a person to open their own calendar and personal space.</p>
      </div>
    </div>
    <div class="card" style="margin-bottom:18px">
      <form id="memberForm" class="row">
        <input type="text" id="mName" placeholder="Full name" required />
        <input type="text" id="mRole" placeholder="Role (e.g. President)" />
        <button class="btn" type="submit">+ Add member</button>
      </form>
    </div>
    ${state.members.length
      ? `<div class="grid cols">${cards}</div>`
      : emptyState("👥", "No members yet", "Add your first eboard member above.")}
  `;

  document.getElementById("memberForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = document.getElementById("mName").value.trim();
    if (!name) return;
    const role = document.getElementById("mRole").value.trim();
    state.members.push({ id: uid(), name, role, months: blankMonths(), personal: { ideas: [], goals: [] } });
    save();
    renderMembers();
  });

  app.querySelectorAll(".member-card").forEach(card => {
    const id = card.dataset.id;
    // open member space when clicking the card (but not the delete button)
    card.addEventListener("click", e => {
      if (e.target.closest('[data-action="del-member"]')) return;
      activeMemberId = id;
      memberSubview = "calendar";
      currentView = "member";
      render();
    });
    card.querySelector('[data-action="del-member"]').addEventListener("click", e => {
      e.stopPropagation();
      const m = memberById(id);
      if (!confirm(`Remove ${m.name}? This deletes their calendar and personal notes, and clears their project assignments.`)) return;
      state.members = state.members.filter(x => x.id !== id);
      state.projects.forEach(p => p.lists.forEach(l => l.tasks.forEach(t => {
        if (t.assignee === id) t.assignee = null;
      })));
      save();
      renderMembers();
    });
  });
}

/* =========================================================
   MEMBER (detail) — their own calendar + personal
   ========================================================= */
function renderMember() {
  const m = memberById(activeMemberId);
  if (!m) { currentView = "members"; return renderMembers(); }

  const body = memberSubview === "calendar" ? memberCalendarHtml(m) : memberPersonalHtml(m);

  app.innerHTML = `
    <button class="back-btn" id="backBtn">‹ All members</button>
    <div class="member-header">
      <div class="avatar lg" style="background:${colorFor(m.id)}">${initials(m.name)}</div>
      <div>
        <h2>${escapeHtml(m.name)}</h2>
        <p>${escapeHtml(m.role) || "Member"}</p>
      </div>
    </div>
    <div class="subtabs">
      <button class="month-chip ${memberSubview === "calendar" ? "active" : ""}" data-sub="calendar">📅 Calendar</button>
      <button class="month-chip ${memberSubview === "personal" ? "active" : ""}" data-sub="personal">💡 Personal</button>
    </div>
    <div id="memberBody">${body}</div>
  `;

  document.getElementById("backBtn").addEventListener("click", () => {
    currentView = "members"; render();
  });
  app.querySelectorAll("[data-sub]").forEach(b =>
    b.addEventListener("click", () => { memberSubview = b.dataset.sub; renderMember(); }));

  if (memberSubview === "calendar") wireMemberCalendar(m);
  else wireMemberPersonal(m);
}

/* ----- Member calendar ----- */
function memberCalendarHtml(m) {
  const chips = MONTHS.map(mo => {
    const open = m.months[mo].tasks.filter(t => !t.done).length;
    return `<button class="month-chip ${mo === activeMonth ? "active" : ""}" data-month="${mo}">
      ${mo}${open ? ` <span class="pill">${open}</span>` : ""}</button>`;
  }).join("");

  const data = m.months[activeMonth];
  return `
    <div class="month-bar">${chips}</div>
    <div class="two-col">
      <div class="card">
        <div class="section-title">✓ To-Do · <span class="pill">${activeMonth}</span></div>
        <form id="taskForm" class="row" style="margin-bottom:14px">
          <input type="text" id="taskText" placeholder="Add a task…" required />
          <button class="btn" type="submit">Add</button>
        </form>
        <ul class="list" id="taskList">${data.tasks.map(taskRow).join("") ||
          `<li class="empty" style="padding:24px">No tasks yet.</li>`}</ul>
      </div>
      <div class="card">
        <div class="section-title">📅 Events · <span class="pill">${activeMonth}</span></div>
        <form id="eventForm" style="margin-bottom:14px">
          <div class="row" style="margin-bottom:8px">
            <input type="text" id="evTitle" placeholder="Event name…" required />
          </div>
          <div class="row">
            <input type="date" id="evDate" />
            <input type="text" id="evNote" placeholder="Location / note" />
            <button class="btn" type="submit">Add</button>
          </div>
        </form>
        <ul class="list" id="eventList">${
          [...data.events].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(eventRow).join("") ||
          `<li class="empty" style="padding:24px">No events yet.</li>`}</ul>
      </div>
    </div>
  `;
}

function wireMemberCalendar(m) {
  const data = m.months[activeMonth];

  app.querySelectorAll(".month-bar .month-chip").forEach(c =>
    c.addEventListener("click", () => { activeMonth = c.dataset.month; renderMember(); }));

  document.getElementById("taskForm").addEventListener("submit", e => {
    e.preventDefault();
    const text = document.getElementById("taskText").value.trim();
    if (!text) return;
    data.tasks.push({ id: uid(), text, done: false });
    save(); renderMember();
  });

  document.getElementById("eventForm").addEventListener("submit", e => {
    e.preventDefault();
    const title = document.getElementById("evTitle").value.trim();
    if (!title) return;
    data.events.push({
      id: uid(), title,
      date: document.getElementById("evDate").value,
      note: document.getElementById("evNote").value.trim()
    });
    save(); renderMember();
  });

  wireTaskList(app.querySelector("#taskList"), data.tasks, renderMember);
  wireEventList(app.querySelector("#eventList"), data.events, renderMember);
}

/* ----- Member personal ----- */
function memberPersonalHtml(m) {
  const p = m.personal;
  return `
    <div class="two-col">
      <div class="card">
        <div class="section-title">💡 Ideas</div>
        <form id="ideaForm" class="row" style="margin-bottom:14px">
          <input type="text" id="ideaText" placeholder="Capture an idea…" required />
          <button class="btn" type="submit">Add</button>
        </form>
        <ul class="list" id="ideaList">${p.ideas.map(simpleRow).join("") ||
          `<li class="empty" style="padding:24px">No ideas yet.</li>`}</ul>
      </div>
      <div class="card">
        <div class="section-title">🎯 Goals</div>
        <form id="goalForm" class="row" style="margin-bottom:14px">
          <input type="text" id="goalText" placeholder="Set a goal…" required />
          <button class="btn" type="submit">Add</button>
        </form>
        <ul class="list" id="goalList">${p.goals.map(taskRow).join("") ||
          `<li class="empty" style="padding:24px">No goals yet.</li>`}</ul>
      </div>
    </div>
  `;
}

function wireMemberPersonal(m) {
  const p = m.personal;
  document.getElementById("ideaForm").addEventListener("submit", e => {
    e.preventDefault();
    const text = document.getElementById("ideaText").value.trim(); if (!text) return;
    p.ideas.push({ id: uid(), text }); save(); renderMember();
  });
  document.getElementById("goalForm").addEventListener("submit", e => {
    e.preventDefault();
    const text = document.getElementById("goalText").value.trim(); if (!text) return;
    p.goals.push({ id: uid(), text, done: false }); save(); renderMember();
  });

  app.querySelector("#ideaList").addEventListener("click", e => {
    if (e.target.closest("[data-action]")?.dataset.action !== "del") return;
    const li = e.target.closest(".list-item");
    const i = p.ideas.findIndex(x => x.id === li.dataset.id);
    if (i > -1) { p.ideas.splice(i, 1); save(); renderMember(); }
  });
  wireTaskList(app.querySelector("#goalList"), p.goals, renderMember);
}

/* ---------- Shared row renderers ---------- */
function taskRow(t) {
  return `<li class="list-item ${t.done ? "done" : ""}" data-id="${t.id}">
    <div class="check ${t.done ? "on" : ""}" data-action="toggle">${t.done ? "✓" : ""}</div>
    <span class="li-text">${escapeHtml(t.text)}</span>
    <button class="icon-btn" data-action="del">✕</button>
  </li>`;
}
function eventRow(ev) {
  const meta = [fmtDate(ev.date), ev.note].filter(Boolean).join(" · ");
  return `<li class="list-item" data-id="${ev.id}">
    <span class="li-text">${escapeHtml(ev.title)}${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</span>
    <button class="icon-btn" data-action="del">✕</button>
  </li>`;
}
function simpleRow(it) {
  return `<li class="list-item" data-id="${it.id}">
    <span class="li-text">${escapeHtml(it.text)}</span>
    <button class="icon-btn" data-action="del">✕</button>
  </li>`;
}

function wireTaskList(ul, arr, rerender) {
  if (!ul) return;
  ul.addEventListener("click", e => {
    const li = e.target.closest(".list-item"); if (!li) return;
    const item = arr.find(x => x.id === li.dataset.id); if (!item) return;
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "toggle") item.done = !item.done;
    else if (action === "del") arr.splice(arr.indexOf(item), 1);
    else return;
    save(); rerender();
  });
}
function wireEventList(ul, arr, rerender) {
  if (!ul) return;
  ul.addEventListener("click", e => {
    if (e.target.closest("[data-action]")?.dataset.action !== "del") return;
    const li = e.target.closest(".list-item");
    const i = arr.findIndex(x => x.id === li.dataset.id);
    if (i > -1) { arr.splice(i, 1); save(); rerender(); }
  });
}

/* =========================================================
   PROJECTS  (shared: project → to-do lists → assigned tasks)
   ========================================================= */
function renderProjects() {
  const projectsHtml = state.projects.map(projectCard).join("");

  app.innerHTML = `
    <div class="view-head">
      <div>
        <h2>Projects</h2>
        <p>Create a project, add to-do lists, and assign tasks to members.</p>
      </div>
    </div>
    <div class="card" style="margin-bottom:18px">
      <form id="projForm">
        <div class="row" style="margin-bottom:8px">
          <input type="text" id="projName" placeholder="Project name…" required />
          <button class="btn" type="submit">+ Create project</button>
        </div>
        <input type="text" id="projDesc" placeholder="Short description (optional)" style="width:100%" />
      </form>
    </div>
    ${state.projects.length
      ? `<div class="grid">${projectsHtml}</div>`
      : emptyState("📂", "No projects yet", "Spin up your first project above.")}
  `;

  document.getElementById("projForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = document.getElementById("projName").value.trim(); if (!name) return;
    state.projects.push({
      id: uid(), name,
      desc: document.getElementById("projDesc").value.trim(),
      lists: []
    });
    save(); renderProjects();
  });

  wireProjects();
}

function projectCard(p) {
  const lists = p.lists.map(l => todoListHtml(p.id, l)).join("");
  return `
    <div class="card" data-project="${p.id}">
      <div class="project-head">
        <div><h3>${escapeHtml(p.name)}</h3></div>
        <button class="icon-btn" data-action="del-project" title="Delete project">✕</button>
      </div>
      ${p.desc ? `<p class="project-desc">${escapeHtml(p.desc)}</p>` : ""}
      ${lists || `<p class="project-desc">No to-do lists yet.</p>`}
      <form data-action="add-list" class="row" style="margin-top:14px">
        <input type="text" placeholder="New to-do list (e.g. Logistics)" required />
        <button class="btn ghost" type="submit">+ List</button>
      </form>
    </div>
  `;
}

function todoListHtml(projectId, list) {
  const total = list.tasks.length;
  const done = list.tasks.filter(t => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const rows = list.tasks.map(t => {
    const m = t.assignee ? memberById(t.assignee) : null;
    const tag = m
      ? `<span class="assignee-tag"><span class="dot" style="background:${colorFor(m.id)}">${initials(m.name)}</span>${escapeHtml(m.name)}</span>`
      : `<span class="assignee-tag" style="color:var(--ink-soft)">Unassigned</span>`;
    return `<li class="list-item ${t.done ? "done" : ""}" data-id="${t.id}">
      <div class="check ${t.done ? "on" : ""}" data-action="toggle-ptask">${t.done ? "✓" : ""}</div>
      <span class="li-text">${escapeHtml(t.text)}</span>
      <select data-action="assign" title="Assign to">
        <option value="">— Assign —</option>
        ${state.members.map(mm =>
          `<option value="${mm.id}" ${mm.id === t.assignee ? "selected" : ""}>${escapeHtml(mm.name)}</option>`).join("")}
      </select>
      ${tag}
      <button class="icon-btn" data-action="del-ptask">✕</button>
    </li>`;
  }).join("");

  return `
    <div class="todolist" data-list="${list.id}">
      <div class="todolist-head">
        <h4>${escapeHtml(list.name)} <span class="pill">${done}/${total}</span></h4>
        <button class="icon-btn" data-action="del-list" title="Delete list">✕</button>
      </div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <ul class="list">${rows || `<li class="empty" style="padding:16px">No tasks yet.</li>`}</ul>
      <form data-action="add-ptask" class="row" style="margin-top:10px">
        <input type="text" placeholder="Add task…" required />
        <button class="btn sm" type="submit">Add</button>
      </form>
    </div>
  `;
}

function findList(projectId, listId) {
  const p = state.projects.find(x => x.id === projectId);
  return [p, p?.lists.find(l => l.id === listId)];
}

function wireProjects() {
  app.querySelectorAll("[data-project]").forEach(card => {
    const projectId = card.dataset.project;
    const project = state.projects.find(p => p.id === projectId);

    card.querySelector('[data-action="del-project"]').addEventListener("click", () => {
      if (!confirm(`Delete project "${project.name}"?`)) return;
      state.projects = state.projects.filter(p => p.id !== projectId);
      save(); renderProjects();
    });

    card.querySelector('form[data-action="add-list"]').addEventListener("submit", e => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const name = input.value.trim(); if (!name) return;
      project.lists.push({ id: uid(), name, tasks: [] });
      save(); renderProjects();
    });

    card.querySelectorAll("[data-list]").forEach(listEl => {
      const listId = listEl.dataset.list;
      const [, list] = findList(projectId, listId);

      listEl.querySelector('[data-action="del-list"]').addEventListener("click", () => {
        if (!confirm(`Delete list "${list.name}"?`)) return;
        project.lists = project.lists.filter(l => l.id !== listId);
        save(); renderProjects();
      });

      listEl.querySelector('form[data-action="add-ptask"]').addEventListener("submit", e => {
        e.preventDefault();
        const input = e.target.querySelector("input");
        const text = input.value.trim(); if (!text) return;
        list.tasks.push({ id: uid(), text, done: false, assignee: null });
        save(); renderProjects();
      });

      listEl.querySelectorAll(".list-item").forEach(li => {
        const task = list.tasks.find(t => t.id === li.dataset.id); if (!task) return;
        li.querySelector('[data-action="toggle-ptask"]')?.addEventListener("click", () => {
          task.done = !task.done; save(); renderProjects();
        });
        li.querySelector('[data-action="del-ptask"]')?.addEventListener("click", () => {
          list.tasks = list.tasks.filter(t => t.id !== task.id); save(); renderProjects();
        });
        li.querySelector('[data-action="assign"]')?.addEventListener("change", e => {
          task.assignee = e.target.value || null; save(); renderProjects();
        });
      });
    });
  });
}

/* =========================================================
   Shared bits
   ========================================================= */
function emptyState(icon, title, sub) {
  return `<div class="empty"><div class="big">${icon}</div>
    <div style="font-weight:600;color:var(--ink)">${title}</div>
    <div>${sub}</div></div>`;
}

/* ---------- Backup export / import ---------- */
document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `eboard-hq-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById("importBtn").addEventListener("click", () =>
  document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.members) throw new Error("bad file");
      if (!confirm("Importing will replace your current data. Continue?")) return;
      state = normalize(data);
      save(); render();
    } catch (err) { alert("Sorry, that doesn't look like a valid backup file."); }
  };
  reader.readAsText(file);
  e.target.value = "";
});

/* ---------- Go ---------- */
render();      // show local data instantly
initSync();    // then connect to the cloud and keep in sync
