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

/* =========================================================
   EVENT CHECKLIST RULES  —  EDIT THESE IN ONE PLACE
   ---------------------------------------------------------
   When an event with a date is created, each rule below
   becomes a checklist item with a due date worked out from
   the event date.

   For each rule:
     label     – the text shown on the checklist item
     offset    – how many days before/after the event
                 (set to null to leave the due date BLANK)
     unit      – "business" (skips weekends) or "calendar"
     direction – "before" or "after" the event

   To set a lead time later (e.g. the two blank ones), just
   change offset from null to a number and pick the unit +
   direction. Nothing else needs to change.
   ========================================================= */
const EVENT_CHECKLIST_RULES = [
  { label: "Submit contract / speaker request",              offset: 30,   unit: "business", direction: "before" },
  { label: "Submit room request (Secretary)",                offset: 30,   unit: "calendar", direction: "before" },
  { label: "Submit purchase request (Treasurer Anthony)",    offset: 15,   unit: "business", direction: "before" },
  { label: "Submit Event Proposal in Nole HQ",               offset: 14,   unit: "calendar", direction: "before" },
  { label: "Submit receipts (Treasurer Anthony)",            offset: 10,   unit: "business", direction: "after"  },
  // Blank for now — fill in offset/unit/direction once the lead time is known:
  { label: "Submit flyer / graphics request (Graphics Chair)", offset: null, unit: "business", direction: "before" },
  { label: "Submit video request (Videographer)",             offset: null, unit: "business", direction: "before" },
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
    // backfill checklists for events made before this feature existed
    MONTHS.forEach(mo => m.months[mo].events.forEach(ev => {
      if (ev.checklist === undefined) ev.checklist = ev.date ? buildEventChecklist(ev.date) : [];
    }));
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

  // projects -> events -> assignable to-do items
  s.projects.forEach(p => {
    if (!Array.isArray(p.events)) p.events = [];

    // migrate legacy project.lists/tasks into a single catch-all event
    if (Array.isArray(p.lists) && p.lists.length) {
      const migrated = [];
      p.lists.forEach(l => (l.tasks || []).forEach(t => migrated.push({
        id: t.id || uid(),
        label: t.text || "Task",
        due: null,
        done: !!t.done,
        assignees: Array.isArray(t.assignees) ? t.assignees : (t.assignee ? [t.assignee] : [])
      })));
      if (migrated.length) {
        p.events.push({ id: uid(), title: "General tasks", date: "", note: "", todos: migrated });
      }
    }
    delete p.lists;

    p.events.forEach(ev => {
      if (!Array.isArray(ev.todos)) {
        if (Array.isArray(ev.checklist)) {
          // older project events stored a non-assignable checklist
          ev.todos = ev.checklist.map(c => ({
            id: c.id || uid(), label: c.label, due: c.due == null ? null : c.due,
            done: !!c.done, assignees: []
          }));
        } else {
          ev.todos = ev.date ? buildEventTodos(ev.date) : [];
        }
      }
      ev.todos.forEach(t => { if (!Array.isArray(t.assignees)) t.assignees = []; });
      delete ev.checklist;
    });
  });
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

// function declaration (hoisted) so normalize() can use it during initial load
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

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

/* ---------- Cross-links between projects and member pages ---------- */
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
function monthNameOf(dateStr) {
  if (!dateStr) return null;
  return MONTH_NAMES[new Date(dateStr + "T00:00:00").getMonth()];
}
// project events that land in a given month (shown on everyone's calendar)
function projectEventsForMonth(monthName) {
  const out = [];
  state.projects.forEach(p => (p.events || []).forEach(ev => {
    if (ev.date && monthNameOf(ev.date) === monthName) out.push({ ev, project: p });
  }));
  return out;
}
// project to-do items assigned to a member (shown on their to-do list)
function assignedTasksFor(memberId) {
  const out = [];
  state.projects.forEach(p => (p.events || []).forEach(ev => (ev.todos || []).forEach(t => {
    if (Array.isArray(t.assignees) && t.assignees.includes(memberId))
      out.push({ todo: t, event: ev, project: p });
  })));
  return out;
}
function findProjectTodo(pid, eid, tid) {
  const p = state.projects.find(x => x.id === pid);
  const ev = p && (p.events || []).find(x => x.id === eid);
  return ev && (ev.todos || []).find(x => x.id === tid);
}

/* ---------- Event checklist date math ---------- */
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addCalendarDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
// days > 0 moves forward, < 0 moves backward, counting weekdays only (skips Sat/Sun)
function addBusinessDays(date, days) {
  const d = new Date(date);
  const step = days < 0 ? -1 : 1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d;
}
function computeDueDate(eventDateStr, rule) {
  if (rule.offset == null) return null; // blank — lead time not decided yet
  const base = new Date(eventDateStr + "T00:00:00");
  const signed = rule.direction === "after" ? rule.offset : -rule.offset;
  const due = rule.unit === "business"
    ? addBusinessDays(base, signed)
    : addCalendarDays(base, signed);
  return toISODate(due);
}
function buildEventChecklist(eventDateStr) {
  if (!eventDateStr) return [];
  const items = EVENT_CHECKLIST_RULES.map(rule => ({
    id: uid(),
    label: rule.label,
    due: computeDueDate(eventDateStr, rule),
    done: false
  }));
  // sort by due date (earliest first); blank due dates go to the bottom
  items.sort((a, b) => {
    if (!a.due && !b.due) return 0;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due.localeCompare(b.due);
  });
  return items;
}
// same items, but each is an assignable project to-do
function buildEventTodos(dateStr) {
  return buildEventChecklist(dateStr).map(it => ({ ...it, assignees: [] }));
}

/* ---------- Router ---------- */
let currentView = "dashboard"; // dashboard | members | member | projects | project
let activeMemberId = null;
let memberSubview = "calendar"; // "calendar" | "personal"
let activeMonth = MONTHS[0];
let activeProjectId = null;
let expandedEvents = new Set();

const app = document.getElementById("app");

document.getElementById("tabs").addEventListener("click", e => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  currentView = btn.dataset.view;
  render();
});

function render() {
  const topFor =
    (currentView === "projects" || currentView === "project") ? "projects" :
    (currentView === "members" || currentView === "member") ? "members" :
    "dashboard";
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.view === topFor));

  if (currentView === "dashboard") renderDashboard();
  else if (currentView === "members") renderMembers();
  else if (currentView === "member") renderMember();
  else if (currentView === "projects") renderProjects();
  else if (currentView === "project") renderProject();
}

/* =========================================================
   DASHBOARD
   ========================================================= */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderDashboard() {
  const today = todayISO();

  // upcoming project events (dated, today or later)
  const allEv = [];
  state.projects.forEach(p => (p.events || []).forEach(ev => { if (ev.date) allEv.push({ ev, p }); }));
  const upcoming = allEv.filter(x => x.ev.date >= today)
    .sort((a, b) => a.ev.date.localeCompare(b.ev.date)).slice(0, 8);

  const upcomingHtml = upcoming.length ? upcoming.map(x => {
    const todos = x.ev.todos || [];
    const done = todos.filter(t => t.done).length;
    return `<li class="list-item clickable dash-event" data-pid="${x.p.id}" data-eid="${x.ev.id}">
      <span class="li-text">${escapeHtml(x.ev.title)}<small>${escapeHtml(fmtDate(x.ev.date))} · 📁 ${escapeHtml(x.p.name)}</small></span>
      <span class="pill">${done}/${todos.length}</span>
    </li>`;
  }).join("") : `<li class="empty" style="padding:20px">No upcoming events. Add one in a project.</li>`;

  // workload per member (open assigned project to-dos)
  const workload = state.members.map(m => {
    const a = assignedTasksFor(m.id);
    const open = a.filter(x => !x.todo.done);
    const nextDue = open.map(x => x.todo.due).filter(Boolean).sort()[0] || null;
    return { m, open: open.length, nextDue };
  }).sort((a, b) => b.open - a.open);

  const workloadHtml = state.members.length ? workload.map(w => `
    <li class="list-item clickable dash-member" data-id="${w.m.id}">
      <div class="avatar" style="background:${colorFor(w.m.id)};width:34px;height:34px;font-size:13px">${initials(w.m.name)}</div>
      <span class="li-text">${escapeHtml(w.m.name)}<small>${w.open} open task${w.open === 1 ? "" : "s"}${w.nextDue ? ` · next due ${escapeHtml(fmtDate(w.nextDue))}` : ""}</small></span>
      <span class="pill">${w.open}</span>
    </li>`).join("") : `<li class="empty" style="padding:20px">No members yet.</li>`;

  const totalOpen = workload.reduce((n, w) => n + w.open, 0);

  app.innerHTML = `
    <div class="view-head"><div><h2>Dashboard</h2><p>A quick overview of what's coming up and who's on what.</p></div></div>
    <div class="grid cols" style="margin-bottom:18px">
      <div class="card stat"><div class="stat-num">${state.members.length}</div><div class="stat-lbl">Members</div></div>
      <div class="card stat"><div class="stat-num">${state.projects.length}</div><div class="stat-lbl">Projects</div></div>
      <div class="card stat"><div class="stat-num">${upcoming.length}</div><div class="stat-lbl">Upcoming events</div></div>
      <div class="card stat"><div class="stat-num">${totalOpen}</div><div class="stat-lbl">Open assigned tasks</div></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="section-title">📅 Upcoming events</div>
        <ul class="list">${upcomingHtml}</ul>
      </div>
      <div class="card">
        <div class="section-title">👥 Workload by person</div>
        <ul class="list">${workloadHtml}</ul>
      </div>
    </div>
  `;

  app.querySelectorAll(".dash-event").forEach(li => li.addEventListener("click", () => {
    activeProjectId = li.dataset.pid;
    expandedEvents.add(li.dataset.eid);
    currentView = "project";
    render();
  }));
  app.querySelectorAll(".dash-member").forEach(li => li.addEventListener("click", () => {
    activeMemberId = li.dataset.id;
    memberSubview = "calendar";
    currentView = "member";
    render();
  }));
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
      state.projects.forEach(p => (p.events || []).forEach(ev => (ev.todos || []).forEach(t => {
        if (Array.isArray(t.assignees)) t.assignees = t.assignees.filter(a => a !== id);
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

  // ONE combined to-do list: assigned project items first, then personal tasks
  const assigned = assignedTasksFor(m.id).slice().sort((a, b) => {
    const ad = a.todo.due, bd = b.todo.due;
    if (!ad && !bd) return 0; if (!ad) return 1; if (!bd) return -1;
    return ad.localeCompare(bd);
  });
  const assignedRows = assigned.map(a => `
    <li class="list-item assigned-row ${a.todo.done ? "done" : ""}" data-pid="${a.project.id}" data-eid="${a.event.id}" data-tid="${a.todo.id}">
      <div class="check ${a.todo.done ? "on" : ""}" data-action="toggle-assigned">${a.todo.done ? "✓" : ""}</div>
      <span class="li-text">${escapeHtml(a.todo.label)}<small>📁 ${escapeHtml(a.project.name)} › ${escapeHtml(a.event.title)}${a.todo.due ? ` · due ${escapeHtml(fmtDate(a.todo.due))}` : ""}</small></span>
    </li>`).join("");
  const personalRows = data.tasks.map(taskRow).join("");
  const todoBody =
    (assigned.length ? `<li class="list-subhead">From projects · assigned to you</li>${assignedRows}` : "") +
    `<li class="list-subhead">${activeMonth} · personal</li>` +
    (personalRows || `<li class="empty" style="padding:16px">No personal tasks yet.</li>`);

  // events = this member's own events for the month + project events in this month
  const merged = [
    ...data.events.map(ev => ({ ev, kind: "own" })),
    ...projectEventsForMonth(activeMonth).map(x => ({ ev: x.ev, kind: "project", project: x.project }))
  ].sort((a, b) => (a.ev.date || "").localeCompare(b.ev.date || ""));
  const eventsHtml = merged.map(x =>
    x.kind === "own" ? eventRow(x.ev) : projectEventRow(x.ev, x.project)
  ).join("") || `<li class="empty" style="padding:24px">No events yet.</li>`;

  return `
    <div class="month-bar">${chips}</div>
    <div class="two-col">
      <div class="card">
        <div class="section-title">✓ To-Do <span class="pill">${assigned.filter(a => !a.todo.done).length + data.tasks.filter(t => !t.done).length} open</span></div>
        <form id="taskForm" class="row" style="margin-bottom:14px">
          <input type="text" id="taskText" placeholder="Add a personal task for ${activeMonth}…" required />
          <button class="btn" type="submit">Add</button>
        </form>
        <ul class="list" id="taskList">${todoBody}</ul>
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
        <ul class="list" id="eventList">${eventsHtml}</ul>
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
    const date = document.getElementById("evDate").value;
    data.events.push({
      id: uid(), title, date,
      note: document.getElementById("evNote").value.trim(),
      checklist: buildEventChecklist(date)
    });
    save(); renderMember();
  });

  wireEventList(app.querySelector("#eventList"), data.events, renderMember);

  // one combined to-do list handles both assigned project items and personal tasks
  app.querySelector("#taskList").addEventListener("click", e => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    const li = e.target.closest(".list-item"); if (!li) return;
    if (action === "toggle-assigned") {
      const t = findProjectTodo(li.dataset.pid, li.dataset.eid, li.dataset.tid);
      if (t) { t.done = !t.done; save(); renderMember(); }
    } else if (action === "toggle") {
      const t = data.tasks.find(x => x.id === li.dataset.id);
      if (t) { t.done = !t.done; save(); renderMember(); }
    } else if (action === "del") {
      const i = data.tasks.findIndex(x => x.id === li.dataset.id);
      if (i > -1) { data.tasks.splice(i, 1); save(); renderMember(); }
    }
  });
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
  const checklist = Array.isArray(ev.checklist) ? ev.checklist : [];
  const done = checklist.filter(c => c.done).length;
  const items = checklist.map(c => `
    <li class="check-item ${c.done ? "done" : ""}" data-cid="${c.id}">
      <div class="check sm ${c.done ? "on" : ""}" data-action="toggle-check">${c.done ? "✓" : ""}</div>
      <span class="ci-label">${escapeHtml(c.label)}</span>
      <span class="ci-due ${c.due ? "" : "tbd"}">${c.due ? fmtDate(c.due) : "TBD"}</span>
    </li>`).join("");
  return `<li class="list-item event-item" data-id="${ev.id}">
    <div class="event-main">
      <span class="li-text">${escapeHtml(ev.title)}${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</span>
      ${checklist.length ? `<span class="pill">${done}/${checklist.length}</span>` : ""}
      <button class="icon-btn" data-action="del">✕</button>
    </div>
    ${checklist.length ? `<ul class="checklist">${items}</ul>` : ""}
  </li>`;
}
function simpleRow(it) {
  return `<li class="list-item" data-id="${it.id}">
    <span class="li-text">${escapeHtml(it.text)}</span>
    <button class="icon-btn" data-action="del">✕</button>
  </li>`;
}
// a project event shown (read-only) on a member's calendar; managed in Projects
function projectEventRow(ev, project) {
  const meta = [fmtDate(ev.date), ev.note].filter(Boolean).join(" · ");
  const todos = ev.todos || [];
  const done = todos.filter(t => t.done).length;
  return `<li class="list-item event-item project-event" data-id="${ev.id}">
    <div class="event-main">
      <span class="li-text">${escapeHtml(ev.title)}<small>${meta ? escapeHtml(meta) + " · " : ""}📁 ${escapeHtml(project.name)}</small></span>
      <span class="tag-proj">Project${todos.length ? ` · ${done}/${todos.length}` : ""}</span>
    </div>
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
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action !== "del" && action !== "toggle-check") return;
    const li = e.target.closest(".list-item");
    const ev = arr.find(x => x.id === li.dataset.id); if (!ev) return;
    if (action === "del") {
      arr.splice(arr.indexOf(ev), 1);
    } else {
      const ci = e.target.closest(".check-item");
      const item = (ev.checklist || []).find(c => c.id === ci.dataset.cid);
      if (!item) return;
      item.done = !item.done;
    }
    save(); rerender();
  });
}

/* =========================================================
   PROJECTS  (shared: project → to-do lists → assigned tasks)
   ========================================================= */
/* =========================================================
   PROJECTS  —  drill-down:
   Projects list → a project → its events → expand an event
   to see/assign its to-do list.
   ========================================================= */
function renderProjects() {
  const cards = state.projects.map(p => {
    const evs = (p.events || []).length;
    const open = (p.events || []).reduce((n, ev) => n + (ev.todos || []).filter(t => !t.done).length, 0);
    return `
    <div class="card project-card clickable" data-project="${p.id}">
      <div class="project-head">
        <div>
          <h3>${escapeHtml(p.name)}</h3>
          ${p.desc ? `<p class="project-desc" style="margin:4px 0 0">${escapeHtml(p.desc)}</p>` : ""}
        </div>
        <button class="icon-btn" data-action="del-project" title="Delete project">✕</button>
      </div>
      <div class="mini">${evs} event${evs === 1 ? "" : "s"} · ${open} open task${open === 1 ? "" : "s"} · open ›</div>
    </div>`;
  }).join("");

  app.innerHTML = `
    <div class="view-head">
      <div>
        <h2>Projects</h2>
        <p>Click a project to open its events, then expand an event to see its to-do list.</p>
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
      ? `<div class="grid cols">${cards}</div>`
      : emptyState("📂", "No projects yet", "Spin up your first project above.")}
  `;

  document.getElementById("projForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = document.getElementById("projName").value.trim(); if (!name) return;
    state.projects.push({
      id: uid(), name,
      desc: document.getElementById("projDesc").value.trim(),
      events: []
    });
    save(); renderProjects();
  });

  app.querySelectorAll(".project-card").forEach(card => {
    const id = card.dataset.project;
    card.addEventListener("click", e => {
      if (e.target.closest('[data-action="del-project"]')) return;
      activeProjectId = id;
      currentView = "project";
      render();
    });
    card.querySelector('[data-action="del-project"]').addEventListener("click", e => {
      e.stopPropagation();
      const p = state.projects.find(x => x.id === id);
      if (!confirm(`Delete project "${p.name}"?`)) return;
      state.projects = state.projects.filter(x => x.id !== id);
      save(); renderProjects();
    });
  });
}

/* ----- Project detail (events + expandable to-do lists) ----- */
function renderProject() {
  const p = state.projects.find(x => x.id === activeProjectId);
  if (!p) { currentView = "projects"; return renderProjects(); }

  const events = (p.events || [])
    .slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .map(ev => projectEventBlock(p, ev)).join("");

  app.innerHTML = `
    <button class="back-btn" id="backProjects">‹ All projects</button>
    <div class="view-head">
      <div>
        <h2>${escapeHtml(p.name)}</h2>
        ${p.desc ? `<p>${escapeHtml(p.desc)}</p>` : ""}
      </div>
    </div>
    <div class="section-title">📅 Events <span class="pill">on everyone's calendar</span></div>
    <div class="events-wrap">${events ||
      `<div class="empty" style="padding:28px">No events yet — add your first one below.</div>`}</div>
    <div class="card" style="margin-top:16px">
      <div class="section-title">➕ New event</div>
      <form id="projEventForm">
        <div class="row" style="margin-bottom:8px">
          <input type="text" name="title" placeholder="Event name…" required />
        </div>
        <div class="row">
          <input type="date" name="date" />
          <input type="text" name="note" placeholder="Location / note" />
          <button class="btn" type="submit">Add event</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("backProjects").addEventListener("click", () => {
    currentView = "projects"; render();
  });

  document.getElementById("projEventForm").addEventListener("submit", e => {
    e.preventDefault();
    const title = e.target.querySelector('[name="title"]').value.trim(); if (!title) return;
    const date = e.target.querySelector('[name="date"]').value;
    const ev = {
      id: uid(), title, date,
      note: e.target.querySelector('[name="note"]').value.trim(),
      todos: buildEventTodos(date)
    };
    p.events.push(ev);
    expandedEvents.add(ev.id); // open it so they can start assigning right away
    save(); renderProject();
  });

  wireProjectEvents(p);
}

function projectEventBlock(p, ev) {
  const expanded = expandedEvents.has(ev.id);
  const todos = ev.todos || [];
  const done = todos.filter(t => t.done).length;
  const meta = [fmtDate(ev.date), ev.note].filter(Boolean).join(" · ");
  return `
    <div class="event-block ${expanded ? "open" : ""}" data-event="${ev.id}">
      <div class="event-head" data-action="toggle-event" title="Click to expand / collapse">
        <span class="caret">${expanded ? "▾" : "▸"}</span>
        <div class="event-title">${escapeHtml(ev.title)}${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</div>
        <span class="pill">${done}/${todos.length}</span>
        <span class="expand-hint">${expanded ? "Hide list" : "Show list"}</span>
        <button class="icon-btn" data-action="del-event" title="Delete event">✕</button>
      </div>
      ${expanded ? `
      <div class="event-body">
        <ul class="list">${todos.map(t => todoRow(t)).join("") ||
          `<li class="empty" style="padding:14px">No to-do items yet.</li>`}</ul>
        <form data-action="add-todo" class="row" style="margin-top:10px">
          <input type="text" name="label" placeholder="Add a to-do item…" required />
          <input type="date" name="due" title="Due date (optional)" />
          <button class="btn sm" type="submit">Add</button>
        </form>
      </div>` : ""}
    </div>`;
}

function todoRow(t) {
  const assignees = Array.isArray(t.assignees) ? t.assignees : [];
  const tags = assignees.map(aid => {
    const mm = memberById(aid);
    if (!mm) return "";
    return `<span class="assignee-tag">
      <span class="dot" style="background:${colorFor(mm.id)}">${initials(mm.name)}</span>
      ${escapeHtml(mm.name)}
      <button class="tag-x" data-action="unassign" data-aid="${aid}" title="Remove">×</button>
    </span>`;
  }).join("");
  const available = state.members.filter(mm => !assignees.includes(mm.id));
  let picker;
  if (available.length) {
    picker = `<select data-action="assign" title="Assign to">
      <option value="">${assignees.length ? "+ Add…" : "— Assign —"}</option>
      ${available.map(mm => `<option value="${mm.id}">${escapeHtml(mm.name)}</option>`).join("")}
    </select>`;
  } else if (!assignees.length) {
    picker = `<span class="assignee-tag" style="color:var(--ink-soft)">Add members to assign</span>`;
  } else {
    picker = "";
  }
  return `<li class="list-item todo-row ${t.done ? "done" : ""}" data-tid="${t.id}">
    <div class="check ${t.done ? "on" : ""}" data-action="toggle-todo">${t.done ? "✓" : ""}</div>
    <span class="li-text">${escapeHtml(t.label)}${t.due
      ? `<small>due ${escapeHtml(fmtDate(t.due))}</small>`
      : `<small class="tbd">TBD</small>`}</span>
    <span class="assignees">${tags}${picker}</span>
    <button class="icon-btn" data-action="del-todo">✕</button>
  </li>`;
}

function wireProjectEvents(p) {
  app.querySelectorAll("[data-event]").forEach(block => {
    const ev = p.events.find(x => x.id === block.dataset.event);
    if (!ev) return;

    block.querySelector(".event-head").addEventListener("click", e => {
      if (e.target.closest('[data-action="del-event"]')) return;
      if (expandedEvents.has(ev.id)) expandedEvents.delete(ev.id);
      else expandedEvents.add(ev.id);
      renderProject();
    });
    block.querySelector('[data-action="del-event"]').addEventListener("click", e => {
      e.stopPropagation();
      if (!confirm(`Delete event "${ev.title}" and its to-do list?`)) return;
      p.events = p.events.filter(x => x.id !== ev.id);
      save(); renderProject();
    });

    const addForm = block.querySelector('form[data-action="add-todo"]');
    if (addForm) addForm.addEventListener("submit", e => {
      e.preventDefault();
      const label = e.target.querySelector('[name="label"]').value.trim(); if (!label) return;
      const due = e.target.querySelector('[name="due"]').value || null;
      ev.todos.push({ id: uid(), label, due, done: false, assignees: [] });
      save(); renderProject();
    });

    block.querySelectorAll(".todo-row").forEach(li => {
      const t = ev.todos.find(x => x.id === li.dataset.tid); if (!t) return;
      li.querySelector('[data-action="toggle-todo"]').addEventListener("click", () => {
        t.done = !t.done; save(); renderProject();
      });
      li.querySelector('[data-action="del-todo"]').addEventListener("click", () => {
        ev.todos = ev.todos.filter(x => x.id !== t.id); save(); renderProject();
      });
      li.querySelector('[data-action="assign"]')?.addEventListener("change", e => {
        const id = e.target.value; if (!id) return;
        if (!Array.isArray(t.assignees)) t.assignees = [];
        if (!t.assignees.includes(id)) t.assignees.push(id);
        save(); renderProject();
      });
      li.querySelectorAll('[data-action="unassign"]').forEach(b =>
        b.addEventListener("click", () => {
          t.assignees = (t.assignees || []).filter(a => a !== b.dataset.aid);
          save(); renderProject();
        }));
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
