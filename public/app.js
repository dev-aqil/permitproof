const app = document.getElementById('app');
const port = Number(window.location.port);
const hosted = port !== 1500 && port !== 1501 && port !== 1502 && port !== 1503;
const role = hosted ? (window.location.pathname.startsWith('/technician/') ? 'technician' : 'supervisor') : port === 1501 ? 'technician' : port === 1502 ? 'supervisor' : 'launcher';
const apiPath = (name) => hosted ? `/${role}/api/${name}` : `/api/${name}`;
const dashboardPath = (name) => hosted ? `/${name}/` : `http://localhost:${name === 'technician' ? 1501 : 1502}`;
const homePath = hosted ? (role === 'technician' ? '/' : '/technician/') : 'http://localhost:1503';
let state = null;
let feedback = null;
let loading = false;
let failed = false;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const clock = (value) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No tap recorded';
const statusLabel = { pending: 'Awaiting approval', approved: 'Approved', checked_in: 'Checked in', completed: 'Completed', revoked: 'Revoked' };
const statusTone = { pending: 'yellow', approved: 'green', checked_in: 'green', completed: 'green', revoked: 'red' };

function launcher() {
  app.innerHTML = `<main class="launcher"><div class="brand">Permit<span>Proof</span></div><p class="eyebrow">Server-room maintenance demo</p><h1>One site. Two role-specific views.</h1><p>Open both dashboards in separate windows. Supervisor actions update the technician screen through one shared demo service.</p><div class="launchgrid"><a class="launchcard" href="${dashboardPath('technician')}"><h2>Technician dashboard</h2><p>Assigned work, approved room, simulated NFC check-in, and maintenance checklist.</p><span class="link">Open technician view →</span></a><a class="launchcard" href="${dashboardPath('supervisor')}"><h2>Supervisor dashboard</h2><p>Create and approve work orders, simulate the Room B reader, and monitor the event log.</p><span class="link">Open supervisor view →</span></a></div><div class="notice">Public prototype: all visitors share temporary demo state. There is no login or hardware/API integration. Never enter real operational data or use this as access control.</div></main>`;
}

function shell(body) {
  const roleName = role === 'supervisor' ? 'Supervisor' : 'Technician';
  return `<div class="shell"><aside class="rail"><div class="brand">Permit<span>Proof</span></div><small>${roleName} view</small><nav aria-label="Main navigation"><a class="navitem active" href="#overview">▦ &nbsp; Site overview</a><a class="navitem" href="${homePath}">↗ &nbsp; Switch view</a></nav><div class="rail-note">Public interaction prototype<br>Simulated access events<br>Not a live occupancy tracker</div></aside><main class="main" id="overview">${body}</main></div>`;
}

function roomMap() {
  const active = state.tasks.find((task) => task.status === 'checked_in');
  const rooms = state.rooms.map((room) => {
    const isActive = active?.room === room;
    const isOwn = role === 'technician' && state.tasks.some((task) => task.room === room && ['approved', 'checked_in'].includes(task.status));
    const text = isActive ? `${role === 'supervisor' ? `${escapeHtml(active.technician)} · ` : ''}NFC check-in ${clock(active.checkInAt)}` : isOwn ? 'Authorised room · no check-in yet' : role === 'technician' ? 'No access details' : 'No confirmed check-in';
    return `<div class="room ${isActive ? 'active' : 'dim'}"><h3>${escapeHtml(room)}</h3>${isActive ? '<div class="person" aria-hidden="true">✓</div>' : ''}<p>${text}</p></div>`;
  }).join('');
  return `<section class="card"><div class="card-header"><div><h2>Server-room overview</h2><p class="sub">Three-room demo floor plan</p></div><span class="badge ${active ? 'green' : ''}">${active ? 'NFC check-in recorded' : 'Awaiting check-in'}</span></div><div class="floor" aria-label="Server-room map">${rooms}</div><div class="corridor">Service corridor</div><div class="legend"><span>Last verified NFC tap</span><span>No confirmed check-in</span></div><p class="muted tiny">A tap is a check-in event, not continuous proof that someone remains in the room.</p></section>`;
}

function technicianTasks() {
  if (!state.tasks.length) return `<div class="empty"><strong>No work orders assigned.</strong><br>Ask your supervisor to create one.</div>`;
  return state.tasks.slice().reverse().map((task) => {
    const canWork = task.status === 'checked_in';
    return `<article class="task"><div class="task-top"><div><h3>${escapeHtml(task.title)}</h3><div class="task-meta"><span>${escapeHtml(task.id)}</span><span>${escapeHtml(task.room)}</span><span>${escapeHtml(task.asset)}</span></div></div><span class="badge ${statusTone[task.status]}">${statusLabel[task.status]}</span></div><p>${escapeHtml(task.instructions)}</p><p class="tiny muted">Due ${escapeHtml(task.due.replace('T', ' '))} · ${task.checkInAt ? `Last NFC check-in ${clock(task.checkInAt)}` : 'No NFC check-in yet'}</p><div class="checklist" aria-label="Maintenance checklist">${task.checklist.map((item, index) => `<label class="checkline"><input type="checkbox" data-check-index="${index}" data-id="${escapeHtml(task.id)}" ${item.done ? 'checked' : ''} ${canWork ? '' : 'disabled'}><span>${escapeHtml(item.label)}</span></label>`).join('')}</div><div class="task-actions"><button class="btn primary compact" data-action="complete" data-id="${escapeHtml(task.id)}" ${canWork && task.checklist.every((item) => item.done) ? '' : 'disabled'}>Complete task</button></div></article>`;
  }).join('');
}

function supervisorTasks() {
  if (!state.tasks.length) return `<div class="empty">No work orders yet. Use Assign task to create one.</div>`;
  return state.tasks.slice().reverse().map((task) => `<article class="task"><div class="task-top"><div><h3>${escapeHtml(task.title)}</h3><div class="task-meta"><span>${escapeHtml(task.id)}</span><span>${escapeHtml(task.technician)}</span><span>${escapeHtml(task.room)}</span><span>${escapeHtml(task.asset)}</span></div></div><span class="badge ${statusTone[task.status]}">${statusLabel[task.status]}</span></div><p>${escapeHtml(task.instructions)}</p><div class="task-actions">${task.status === 'pending' ? `<button class="btn primary compact" data-action="approve" data-id="${escapeHtml(task.id)}">Approve access</button>` : ''}${task.status === 'approved' && task.room === 'Server Room B' ? `<button class="btn compact" data-action="checkin" data-id="${escapeHtml(task.id)}">Simulate NFC check-in</button>` : ''}${['approved', 'checked_in'].includes(task.status) ? `<button class="btn danger compact" data-action="revoke" data-id="${escapeHtml(task.id)}">Revoke access</button>` : ''}</div></article>`).join('');
}

function supervisorSide() {
  const approvals = state.tasks.filter((task) => ['approved', 'checked_in', 'completed'].includes(task.status)).slice().reverse().slice(0, 3);
  return `<aside class="stack"><section class="card"><div class="card-header"><div><h2>Recent approvals</h2><p class="sub">Approved work orders</p></div></div>${approvals.length ? `<div class="list">${approvals.map((task) => `<div class="task"><strong>${escapeHtml(task.id)}</strong> · ${escapeHtml(task.room)}<br><span class="muted tiny">${escapeHtml(task.technician)} · ${statusLabel[task.status]}</span></div>`).join('')}</div>` : '<div class="empty">No approvals yet. Approve a pending work order to begin.</div>'}</section><section class="card"><div class="card-header"><div><h2>Security event log</h2><p class="sub">Live local demo events</p></div><span class="badge green">● Live</span></div><div class="log" role="log" aria-label="Security event log">${state.events.map((event) => `<div class="event ${escapeHtml(event.kind)}"><time>${clock(event.time)}</time><strong>${escapeHtml(event.text)}</strong></div>`).join('')}</div></section></aside>`;
}

function modal() {
  return `<dialog id="assign-dialog" aria-labelledby="modal-title"><div class="modal-inner"><div class="modal-head"><h2 id="modal-title">Assign task</h2><button type="button" class="icon-btn" id="close-dialog" aria-label="Close dialog">×</button></div><form id="assign-form"><div class="field"><label for="technician">Technician</label><select id="technician" name="technician"><option>Amir H.</option></select></div><div class="field"><label for="room">Server room</label><select id="room" name="room"><option>Server Room A</option><option selected>Server Room B</option><option>Server Room C</option></select></div><div class="field"><label for="asset">Rack or asset ID</label><input id="asset" name="asset" required maxlength="60" placeholder="Rack B-04"></div><div class="field"><label for="title">Task title</label><input id="title" name="title" required maxlength="100" placeholder="Inspect network switch"></div><div class="field"><label for="instructions">Instructions</label><textarea id="instructions" name="instructions" required maxlength="500" placeholder="What should the technician inspect and record?"></textarea></div><div class="field"><label for="due">Due date and time</label><input id="due" name="due" type="datetime-local" required></div><p class="hint">Assignment does not grant room access until a supervisor approves it. The physical demo reader is assigned to Server Room B only.</p><p id="form-error" class="feedback error" role="alert" hidden></p><div class="modal-actions"><button type="button" class="btn" id="cancel-dialog">Cancel</button><button type="submit" class="btn primary">Create assignment</button></div></form></div></dialog>`;
}

function render() {
  if (role === 'launcher') return launcher();
  if (loading && !state) return app.innerHTML = shell(`<div class="topline"><div><p class="eyebrow">PermitProof</p><h1>Loading dashboard</h1></div></div><div class="layout"><div class="skeleton"></div><div class="skeleton"></div></div>`);
  if (failed && !state) return app.innerHTML = shell(`<div class="topline"><div><p class="eyebrow">PermitProof</p><h1>Dashboard unavailable</h1></div></div><div class="feedback error">Could not load the local dashboard. Check that the server is running.</div><button class="btn" id="retry">Retry</button>`);
  const admin = role === 'supervisor';
  const heading = admin ? 'Site overview' : 'My maintenance work';
  const lead = admin ? 'Server-room permissions, check-ins, and events' : 'Your assigned server-room work and access status';
  const body = `<div class="topline"><div><p class="eyebrow">${admin ? 'Supervisor control' : 'Technician workspace'}</p><h1>${heading}</h1><p class="sub">${lead}</p></div>${admin ? '<div class="actions"><button class="btn primary" id="open-dialog">+ Assign task</button></div>' : ''}</div>${feedback ? `<div class="feedback ${feedback.error ? 'error' : ''}" role="status">${escapeHtml(feedback.text)}</div>` : ''}<div class="layout ${admin ? 'admin' : ''}"><div class="stack">${roomMap()}${admin ? `<section class="card"><div class="card-header"><div><h2>Work orders</h2><p class="sub">Approval is separate from assignment</p></div></div><div class="list">${supervisorTasks()}</div></section>` : ''}</div>${admin ? supervisorSide() : `<section class="card"><div class="card-header"><div><h2>My work orders</h2><p class="sub">Checklist unlocks after approved NFC check-in</p></div></div><div class="list">${technicianTasks()}</div></section>`}</div>${admin ? modal() : ''}`;
  app.innerHTML = shell(body);
}

async function fetchState(force = false) {
  if (role === 'launcher') return;
  if (!state) { loading = true; render(); }
  try {
    const response = await fetch(apiPath('state'), { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load dashboard');
    const next = await response.json();
    const dialogOpen = document.getElementById('assign-dialog')?.open;
    if (force || !state || next.version !== state.version) {
      state = next;
      if (!dialogOpen) render();
    }
    failed = false;
  } catch (error) {
    failed = true;
    feedback = { text: 'Connection lost. Changes may not be current. Retry when the local server is available.', error: true };
    render();
  } finally { loading = false; }
}

async function postAction(action, fields = {}) {
  try {
    const response = await fetch(apiPath('action'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...fields }) });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error || 'Action failed');
    state = next;
    feedback = { text: action === 'checkin' ? 'Simulated NFC check-in recorded. Technician view updated.' : 'Change saved. Both role views will update automatically.', error: false };
    render();
  } catch (error) {
    feedback = { text: error.message, error: true };
    render();
  }
}

async function createTask(form) {
  const submit = form.querySelector('button[type="submit"]');
  const errorBox = form.querySelector('#form-error');
  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  errorBox.hidden = true;
  try {
    const response = await fetch(apiPath('action'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', ...Object.fromEntries(new FormData(form)) }) });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error || 'Could not create assignment');
    state = next;
    feedback = { text: 'Assignment created. Approve it before check-in.', error: false };
    document.getElementById('assign-dialog').close();
    render();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    if (submit.isConnected) {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
    }
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.id === 'retry') return fetchState(true);
  if (target.id === 'open-dialog') return document.getElementById('assign-dialog').showModal();
  if (target.id === 'close-dialog' || target.id === 'cancel-dialog') { document.getElementById('assign-dialog').close(); return render(); }
  if (target.dataset.action) postAction(target.dataset.action, { id: target.dataset.id });
});
document.addEventListener('change', (event) => {
  if (event.target.matches('[data-check-index]')) postAction('checklist', { id: event.target.dataset.id, index: Number(event.target.dataset.checkIndex) });
});
document.addEventListener('submit', (event) => {
  if (event.target.id !== 'assign-form') return;
  event.preventDefault();
  createTask(event.target);
});

if (role === 'launcher') launcher();
else { fetchState(); setInterval(() => fetchState(), 2000); }
