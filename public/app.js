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
const statusLabel = { assigned: 'Assigned', verifying: 'Waiting for verification', verified: 'Verification done', rejected: 'Verification failed', completed: 'Completed', revoked: 'Revoked' };
const statusTone = { assigned: 'yellow', verifying: 'yellow', verified: 'green', rejected: 'red', completed: 'green', revoked: 'red' };

function launcher() {
  app.innerHTML = `<main class="launcher"><div class="brand">Permit<span>Proof</span></div><p class="eyebrow">Server-room maintenance demo</p><h1>One site. Two role-specific views.</h1><p>Open both dashboards in separate windows. Assignments appear immediately; an NFC tap then waits for simulated verification before room access is shown.</p><div class="launchgrid"><a class="launchcard" href="${dashboardPath('technician')}"><h2>Technician dashboard</h2><p>Assigned work, simulated NFC tap, verification status, and maintenance checklist.</p><span class="link">Open technician view →</span></a><a class="launchcard" href="${dashboardPath('supervisor')}"><h2>Supervisor dashboard</h2><p>Create work orders and monitor verification, room access, and security events.</p><span class="link">Open supervisor view →</span></a></div><div class="notice">Public prototype: verification is simulated after a short delay. There is no login, real NFC, or server-side device verification yet. Never use this as real access control.</div></main>`;
}

function shell(body) {
  const roleName = role === 'supervisor' ? 'Supervisor' : 'Technician';
  return `<div class="shell"><aside class="rail"><div class="brand">Permit<span>Proof</span></div><small>${roleName} view</small><nav aria-label="Main navigation"><a class="navitem active" href="#overview">▦ &nbsp; Site overview</a><a class="navitem" href="${homePath}">↗ &nbsp; Switch view</a></nav><div class="rail-note">Public interaction prototype<br>Simulated access events<br>Not a live occupancy tracker</div></aside><main class="main" id="overview">${body}</main></div>`;
}

function roomMap() {
  const active = state.tasks.find((task) => task.status === 'verified');
  const waiting = state.tasks.find((task) => task.status === 'verifying');
  const rooms = state.rooms.map((room) => {
    const isActive = active?.room === room;
    const isWaiting = waiting?.room === room;
    const text = isActive ? `${role === 'supervisor' ? `${escapeHtml(active.technician)} · ` : ''}Verified access ${clock(active.verifiedAt)}` : isWaiting ? 'NFC tapped · verification pending' : role === 'technician' ? 'No access details' : 'No verified access';
    return `<div class="room ${isActive ? 'active' : 'dim'}"><h3>${escapeHtml(room)}</h3>${isActive ? '<div class="person" aria-hidden="true">✓</div>' : ''}<p>${text}</p></div>`;
  }).join('');
  return `<section class="card"><div class="card-header"><div><h2>Server-room overview</h2><p class="sub">Three-room demo floor plan</p></div><span class="badge ${active ? 'green' : waiting ? 'yellow' : ''}">${active ? 'Access verified' : waiting ? 'Waiting for verification' : 'No verified access'}</span></div><div class="floor" aria-label="Server-room map">${rooms}</div><div class="corridor">Service corridor</div><div class="legend"><span>Verified room access</span><span>No verified access</span></div><p class="muted tiny">A simulated tap starts verification. The room lights only after verification succeeds; this does not prove continued physical presence.</p></section>`;
}

function technicianTasks() {
  if (!state.tasks.length) return `<div class="empty"><strong>No work orders assigned.</strong><br>Ask your supervisor to create one.</div>`;
  return state.tasks.slice().reverse().map((task) => {
    const canWork = task.status === 'verified';
    const canTap = ['assigned', 'rejected'].includes(task.status) && task.room === 'Server Room B';
    const statusDetail = task.status === 'verifying' ? 'NFC tap received. Waiting for the verification result.' :
      task.status === 'verified' ? `Verification finished at ${clock(task.verifiedAt)}. Room access is active.` :
      task.status === 'rejected' ? 'Verification failed. Access remains locked; try the NFC tap again.' :
      task.room !== 'Server Room B' ? 'This demo has one NFC reader, assigned to Server Room B.' :
      'Task assigned. Tap the NFC card to request access.';
    return `<article class="task"><div class="task-top"><div><h3>${escapeHtml(task.title)}</h3><div class="task-meta"><span>${escapeHtml(task.id)}</span><span>${escapeHtml(task.room)}</span><span>${escapeHtml(task.asset)}</span></div></div><span class="badge ${statusTone[task.status]}">${statusLabel[task.status]}</span></div><p>${escapeHtml(task.instructions)}</p><p class="tiny muted">Due ${escapeHtml(task.due.replace('T', ' '))} · ${escapeHtml(statusDetail)}</p><div class="checklist" aria-label="Maintenance checklist">${task.checklist.map((item, index) => `<label class="checkline"><input type="checkbox" data-check-index="${index}" data-id="${escapeHtml(task.id)}" ${item.done ? 'checked' : ''} ${canWork ? '' : 'disabled'}><span>${escapeHtml(item.label)}</span></label>`).join('')}</div><div class="task-actions">${canTap ? `<button class="btn primary compact" data-action="tap" data-id="${escapeHtml(task.id)}">Simulate NFC card tap</button>` : ''}<button class="btn compact" data-action="complete" data-id="${escapeHtml(task.id)}" ${canWork && task.checklist.every((item) => item.done) ? '' : 'disabled'}>Complete task</button></div></article>`;
  }).join('');
}

function supervisorTasks() {
  if (!state.tasks.length) return `<div class="empty">No work orders yet. Use Assign task to create one.</div>`;
  return state.tasks.slice().reverse().map((task) => `<article class="task"><div class="task-top"><div><h3>${escapeHtml(task.title)}</h3><div class="task-meta"><span>${escapeHtml(task.id)}</span><span>${escapeHtml(task.technician)}</span><span>${escapeHtml(task.room)}</span><span>${escapeHtml(task.asset)}</span></div></div><span class="badge ${statusTone[task.status]}">${statusLabel[task.status]}</span></div><p>${escapeHtml(task.instructions)}</p><div class="task-actions">${['assigned', 'verifying', 'verified'].includes(task.status) ? `<button class="btn danger compact" data-action="revoke" data-id="${escapeHtml(task.id)}">Revoke assignment/access</button>` : ''}</div></article>`).join('');
}

function supervisorSide() {
  const verified = state.tasks.filter((task) => ['verified', 'completed'].includes(task.status)).slice().reverse().slice(0, 3);
  return `<aside class="stack"><section class="card"><div class="card-header"><div><h2>Recent verifications</h2><p class="sub">Room access granted after NFC verification</p></div></div>${verified.length ? `<div class="list">${verified.map((task) => `<div class="task"><strong>${escapeHtml(task.id)}</strong> · ${escapeHtml(task.room)}<br><span class="muted tiny">${escapeHtml(task.technician)} · verified ${clock(task.verifiedAt)}</span></div>`).join('')}</div>` : '<div class="empty">No verified access yet. A technician NFC tap starts verification.</div>'}</section><section class="card"><div class="card-header"><div><h2>Security event log</h2><p class="sub">Live local demo events</p></div><span class="badge green">● Live</span></div><div class="log" role="log" aria-label="Security event log">${state.events.map((event) => `<div class="event ${escapeHtml(event.kind)}"><time>${clock(event.time)}</time><strong>${escapeHtml(event.text)}</strong></div>`).join('')}</div></section></aside>`;
}

function modal() {
  return `<dialog id="assign-dialog" aria-labelledby="modal-title"><div class="modal-inner"><div class="modal-head"><h2 id="modal-title">Assign task</h2><button type="button" class="icon-btn" id="close-dialog" aria-label="Close dialog">×</button></div><form id="assign-form"><div class="field"><label for="technician">Technician</label><select id="technician" name="technician"><option>Amir H.</option></select></div><div class="field"><label for="room">Server room</label><select id="room" name="room"><option>Server Room A</option><option selected>Server Room B</option><option>Server Room C</option></select></div><div class="field"><label for="asset">Rack or asset ID</label><input id="asset" name="asset" required maxlength="60" placeholder="Rack B-04"></div><div class="field"><label for="title">Task title</label><input id="title" name="title" required maxlength="100" placeholder="Inspect network switch"></div><div class="field"><label for="instructions">Instructions</label><textarea id="instructions" name="instructions" required maxlength="500" placeholder="What should the technician inspect and record?"></textarea></div><div class="field"><label for="due">Due date and time</label><input id="due" name="due" type="datetime-local" required></div><p class="hint">The task appears immediately for the technician. Room access stays locked until an NFC tap passes verification. The demo reader is assigned to Server Room B only.</p><p id="form-error" class="feedback error" role="alert" hidden></p><div class="modal-actions"><button type="button" class="btn" id="cancel-dialog">Cancel</button><button type="submit" class="btn primary">Create assignment</button></div></form></div></dialog>`;
}

function render() {
  if (role === 'launcher') return launcher();
  if (loading && !state) return app.innerHTML = shell(`<div class="topline"><div><p class="eyebrow">PermitProof</p><h1>Loading dashboard</h1></div></div><div class="layout"><div class="skeleton"></div><div class="skeleton"></div></div>`);
  if (failed && !state) return app.innerHTML = shell(`<div class="topline"><div><p class="eyebrow">PermitProof</p><h1>Dashboard unavailable</h1></div></div><div class="feedback error">Could not load the local dashboard. Check that the server is running.</div><button class="btn" id="retry">Retry</button>`);
  const admin = role === 'supervisor';
  const heading = admin ? 'Site overview' : 'My maintenance work';
  const lead = admin ? 'Server-room permissions, check-ins, and events' : 'Your assigned server-room work and access status';
  const body = `<div class="topline"><div><p class="eyebrow">${admin ? 'Supervisor control' : 'Technician workspace'}</p><h1>${heading}</h1><p class="sub">${lead}</p></div>${admin ? '<div class="actions"><button class="btn primary" id="open-dialog">+ Assign task</button></div>' : ''}</div>${feedback ? `<div class="feedback ${feedback.error ? 'error' : ''}" role="status">${escapeHtml(feedback.text)}</div>` : ''}<div class="layout ${admin ? 'admin' : ''}"><div class="stack">${roomMap()}${admin ? `<section class="card"><div class="card-header"><div><h2>Work orders</h2><p class="sub">Assignments reach the technician immediately</p></div></div><div class="list">${supervisorTasks()}</div></section>` : ''}</div>${admin ? supervisorSide() : `<section class="card"><div class="card-header"><div><h2>My work orders</h2><p class="sub">Checklist unlocks only after NFC verification succeeds</p></div></div><div class="list">${technicianTasks()}</div></section>`}</div>${admin ? modal() : ''}`;
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
    feedback = { text: action === 'tap' ? 'NFC tap received. Both dashboards are waiting for simulated verification.' : 'Change saved. Both role views will update automatically.', error: false };
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
    feedback = { text: 'Assignment created and sent to the technician. No second approval is needed.', error: false };
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
