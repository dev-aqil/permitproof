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
const clock = (value) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'No tap recorded';

const statusLabel = {
  assigned: 'PENDING NFC TAP',
  verifying: 'NFC VERIFYING',
  verified: 'LEASE ACTIVE',
  rejected: 'VERIFICATION FAILED',
  completed: 'AUDIT COMMITTED',
  revoked: 'LEASE REVOKED',
};

const statusTone = {
  assigned: 'pending',
  verifying: 'pending',
  verified: 'verified',
  rejected: 'rejected',
  completed: 'verified',
  revoked: 'rejected',
};

function launcher() {
  app.innerHTML = `
    <main class="launcher">
      <div class="brand">Permit<span>Proof</span></div>
      <p class="eyebrow">Mission-Critical IoT Maintenance Authorization</p>
      <h1>Industrial Supervisory &amp; Technician Console</h1>
      <p>Cryptographically binding authenticated technicians, approved maintenance orders, physical assets, and real-time sensor telemetry into a tamper-evident audit ledger.</p>
      <div class="launchgrid">
        <a class="launchcard" href="${dashboardPath('technician')}">
          <div>
            <span class="eyebrow">Field Console</span>
            <h2>Technician Dashboard</h2>
            <p>Assigned work orders, simulated NFC asset scan, authorization lease verification, and maintenance checklist.</p>
          </div>
          <span class="link">Open Technician View →</span>
        </a>
        <a class="launchcard" href="${dashboardPath('supervisor')}">
          <div>
            <span class="eyebrow">Supervisory Console</span>
            <h2>Supervisor Dashboard</h2>
            <p>Dispatch maintenance orders, monitor IoT station telemetry, authorization leases, and cryptographic security events.</p>
          </div>
          <span class="link">Open Supervisor View →</span>
        </a>
      </div>
      <div class="notice">
        <strong>Operational Scope:</strong> PermitProof is a verified maintenance authorization engine and resilient IoT evidence pipeline. It provides workflow verification and audit trail generation only—not a machine safety interlock or door lock system.
      </div>
    </main>
  `;
}

function shell(body) {
  const roleName = role === 'supervisor' ? 'Supervisor' : 'Technician';
  return `
    <div class="shell">
      <aside class="rail">
        <div class="brand">Permit<span>Proof</span></div>
        <small class="micro-caption">${roleName} Supervisory View</small>
        <nav aria-label="Main navigation">
          <a class="navitem active" href="#overview">
            <span class="tech-code">▦</span> &nbsp; Telemetry Overview
          </a>
          <a class="navitem" href="${homePath}">
            <span class="tech-code">↗</span> &nbsp; Switch Console
          </a>
        </nav>
        <div class="rail-note">
          IoT Station: rpi5-station-01<br>
          Protocol: MQTT/TLS (mTLS)<br>
          Key: Ed25519 Verified<br>
          Lease Window: 30s Max
        </div>
      </aside>
      <main class="main" id="overview">
        ${body}
      </main>
    </div>
  `;
}

function roomMap() {
  const active = state.tasks.find((task) => task.status === 'verified');
  const waiting = state.tasks.find((task) => task.status === 'verifying');
  const rooms = state.rooms.map((room) => {
    const isActive = active?.room === room;
    const isWaiting = waiting?.room === room;
    const isStationB = room === 'Server Room B';
    const text = isActive
      ? `${role === 'supervisor' ? `${escapeHtml(active.technician)} · ` : ''}30s Lease Valid · ${clock(active.verifiedAt)}`
      : isWaiting
      ? 'Asset Scanned · Verification Pending'
      : isStationB
      ? 'Station 01 Standby · Ready for NFC Scan'
      : 'No Active Authorization Lease';

    return `
      <div class="room ${isActive ? 'active' : 'dim'}">
        <div class="room-head">
          <h3>${escapeHtml(room)}</h3>
          ${isActive ? '<div class="person" aria-label="Verified Station Active">✓</div>' : ''}
        </div>
        <p class="body-text">${text}</p>
        <span class="tech-code ${isActive ? 'verified' : 'muted'}">
          ${isStationB ? 'NFC-RDR-01 [ACTIVE]' : 'AUX-ZONE-MONITOR'}
        </span>
      </div>
    `;
  }).join('');

  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h3>Plant &amp; Facility Telemetry Map</h3>
          <p class="sub">3-Zone Industrial Station Layout</p>
        </div>
        <span class="badge ${active ? 'verified' : waiting ? 'pending' : ''}">
          <span class="dot"></span>
          ${active ? 'LEASE VERIFIED' : waiting ? 'VERIFYING' : 'STANDBY'}
        </span>
      </div>
      <div class="floor" aria-label="Server-room map">
        ${rooms}
      </div>
      <div class="corridor">STATION BUS: ZONE-01 ⟷ ZONE-02 (RPI5-NFC) ⟷ ZONE-03</div>
      <div class="legend">
        <span>Verified Active Authorization Lease</span>
        <span>Standby / Unverified Station</span>
      </div>
    </section>
  `;
}

function technicianTasks() {
  if (!state.tasks.length) return `<div class="empty"><strong>No work orders assigned.</strong><br>Awaiting dispatch from supervisory console.</div>`;
  return state.tasks.slice().reverse().map((task) => {
    const canWork = task.status === 'verified';
    const canTap = ['assigned', 'rejected'].includes(task.status) && task.room === 'Server Room B';
    const statusDetail = task.status === 'verifying'
      ? 'NFC asset tag scanned. Cryptographic verification in progress (LED: YELLOW)...'
      : task.status === 'verified'
      ? `Authorization lease active (LED: GREEN). Valid from ${clock(task.verifiedAt)} (30s window).`
      : task.status === 'rejected'
      ? 'Verification denied (LED: RED). Signature or tag validation failed. Retry asset scan.'
      : task.room !== 'Server Room B'
      ? 'Hardware reader bound to Server Room B station only.'
      : 'Work order ready. Scan registered asset NFC tag to obtain authorization lease.';

    return `
      <article class="task">
        <div class="task-top">
          <div>
            <h3>${escapeHtml(task.title)}</h3>
            <div class="task-meta">
              <span class="tech-code">${escapeHtml(task.id)}</span>
              <span class="tech-code muted">${escapeHtml(task.room)}</span>
              <span class="tech-code ${canWork ? 'verified' : 'muted'}">${escapeHtml(task.asset)}</span>
            </div>
          </div>
          <span class="badge ${statusTone[task.status]}">
            <span class="dot"></span>
            ${statusLabel[task.status]}
          </span>
        </div>
        <p class="body-text">${escapeHtml(task.instructions)}</p>
        <p class="micro-caption">Due: ${escapeHtml(task.due.replace('T', ' '))} · ${escapeHtml(statusDetail)}</p>
        <div class="checklist" aria-label="Maintenance checklist">
          ${task.checklist.map((item, index) => `
            <label class="checkline">
              <input type="checkbox" data-check-index="${index}" data-id="${escapeHtml(task.id)}" ${item.done ? 'checked' : ''} ${canWork ? '' : 'disabled'}>
              <span class="body-text">${escapeHtml(item.label)}</span>
            </label>
          `).join('')}
        </div>
        <div class="task-actions">
          ${canTap ? `<button class="btn primary compact" data-action="tap" data-id="${escapeHtml(task.id)}">Scan NFC Asset Tag</button>` : ''}
          <button class="btn compact" data-action="complete" data-id="${escapeHtml(task.id)}" ${canWork && task.checklist.every((item) => item.done) ? '' : 'disabled'}>Commit Maintenance Evidence</button>
        </div>
      </article>
    `;
  }).join('');
}

function supervisorTasks() {
  if (!state.tasks.length) return `<div class="empty">No work orders recorded. Use "+ Dispatch Order" to assign.</div>`;
  return state.tasks.slice().reverse().map((task) => `
    <article class="task">
      <div class="task-top">
        <div>
          <h3>${escapeHtml(task.title)}</h3>
          <div class="task-meta">
            <span class="tech-code">${escapeHtml(task.id)}</span>
            <span class="tech-code muted">${escapeHtml(task.technician)}</span>
            <span class="tech-code muted">${escapeHtml(task.room)}</span>
            <span class="tech-code ${task.status === 'verified' ? 'verified' : 'muted'}">${escapeHtml(task.asset)}</span>
          </div>
        </div>
        <span class="badge ${statusTone[task.status]}">
          <span class="dot"></span>
          ${statusLabel[task.status]}
        </span>
      </div>
      <p class="body-text">${escapeHtml(task.instructions)}</p>
      <div class="task-actions">
        ${['assigned', 'verifying', 'verified'].includes(task.status) ? `<button class="btn danger compact" data-action="revoke" data-id="${escapeHtml(task.id)}">Revoke Authorization Lease</button>` : ''}
      </div>
    </article>
  `).join('');
}

function supervisorSide() {
  const verified = state.tasks.filter((task) => ['verified', 'completed'].includes(task.status)).slice().reverse().slice(0, 3);
  return `
    <aside class="stack">
      <section class="card">
        <div class="card-header">
          <div>
            <h3>Active &amp; Recent Leases</h3>
            <p class="sub">Cryptographically verified authorizations</p>
          </div>
          <span class="tech-code muted">MAX-LEASE: 30s</span>
        </div>
        ${verified.length ? `
          <div class="list">
            ${verified.map((task) => `
              <div class="task">
                <div class="task-top">
                  <span class="tech-code ${task.status === 'verified' ? 'verified' : ''}">${escapeHtml(task.id)}</span>
                  <span class="micro-caption">${escapeHtml(task.room)}</span>
                </div>
                <p class="body-text">${escapeHtml(task.technician)} · Asset: <span class="tech-code">${escapeHtml(task.asset)}</span></p>
                <small class="micro-caption">Verified: ${clock(task.verifiedAt)}</small>
              </div>
            `).join('')}
          </div>
        ` : '<div class="empty">No verified leases active. Technician asset scan initiates cryptographic verification.</div>'}
      </section>
      <section class="card">
        <div class="card-header">
          <div>
            <h3>Security &amp; Telemetry Ledger</h3>
            <p class="sub">Immutable local event stream</p>
          </div>
          <span class="badge verified">
            <span class="dot"></span>
            LIVE STREAM
          </span>
        </div>
        <div class="log" role="log" aria-label="Security event log">
          ${state.events.map((event) => `
            <div class="event ${escapeHtml(event.kind)}">
              <span class="tech-code">${escapeHtml(event.code || 'EVT-' + event.id.slice(0, 4))}</span>
              <p>${escapeHtml(event.text)}</p>
              <time>${clock(event.time)}</time>
            </div>
          `).join('')}
        </div>
      </section>
    </aside>
  `;
}

function modal() {
  return `
    <dialog id="assign-dialog" aria-labelledby="modal-title">
      <div class="modal-inner">
        <div class="modal-head">
          <h2 id="modal-title">Dispatch Maintenance Order</h2>
          <button type="button" class="icon-btn" id="close-dialog" aria-label="Close dialog">×</button>
        </div>
        <form id="assign-form">
          <div class="field">
            <label for="technician">Authenticated Technician</label>
            <select id="technician" name="technician">
              <option>Amir H.</option>
            </select>
          </div>
          <div class="field">
            <label for="room">Facility Zone</label>
            <select id="room" name="room">
              <option>Server Room A</option>
              <option selected>Server Room B</option>
              <option>Server Room C</option>
            </select>
          </div>
          <div class="field">
            <label for="asset">Registered Physical Asset ID</label>
            <input id="asset" name="asset" required maxlength="60" placeholder="e.g. Rack B-04 / AST-B04-AHU">
          </div>
          <div class="field">
            <label for="title">Maintenance Scope Title</label>
            <input id="title" name="title" required maxlength="100" placeholder="e.g. Inspect air handling unit">
          </div>
          <div class="field">
            <label for="instructions">Operational Procedure &amp; Instructions</label>
            <textarea id="instructions" name="instructions" required maxlength="500" placeholder="Specify inspection criteria and required telemetry measurements..."></textarea>
          </div>
          <div class="field">
            <label for="due">Procedure Target Due Date &amp; Time</label>
            <input id="due" name="due" type="datetime-local" required>
          </div>
          <p class="hint">
            The work order synchronizes immediately with the technician console. Maintenance authorization remains locked until the asset NFC tag is scanned and verified via Ed25519 signature. Demo reader is anchored to Server Room B.
          </p>
          <p id="form-error" class="feedback error" role="alert" hidden></p>
          <div class="modal-actions">
            <button type="button" class="btn" id="cancel-dialog">Cancel</button>
            <button type="submit" class="btn primary">Dispatch Order</button>
          </div>
        </form>
      </div>
    </dialog>
  `;
}

function render() {
  if (role === 'launcher') return launcher();
  if (loading && !state) {
    app.innerHTML = shell(`
      <div class="topline">
        <div>
          <p class="eyebrow">PermitProof Industrial Telemetry</p>
          <h1>Connecting Station...</h1>
        </div>
      </div>
      <div class="layout">
        <div class="skeleton"></div>
        <div class="skeleton"></div>
      </div>
    `);
    return;
  }
  if (failed && !state) {
    app.innerHTML = shell(`
      <div class="topline">
        <div>
          <p class="eyebrow">PermitProof Industrial Telemetry</p>
          <h1>Station Offline</h1>
        </div>
      </div>
      <div class="feedback error">Could not establish link with local station server. Ensure node server is listening.</div>
      <button class="btn" id="retry">Retry Connection</button>
    `);
    return;
  }

  const admin = role === 'supervisor';
  const heading = admin ? 'Supervisory Control &amp; Telemetry' : 'Technician Field Terminal';
  const lead = admin
    ? 'Real-time permit authorization, IoT station telemetry, and cryptographically verified audit events'
    : 'Assigned maintenance procedures, NFC asset scan, and verified evidence recording';

  const body = `
    <div class="topline">
      <div>
        <p class="eyebrow">${admin ? 'SUPERVISORY TERMINAL' : 'TECHNICIAN WORKSPACE'}</p>
        <h1>${heading}</h1>
        <p class="sub">${lead}</p>
      </div>
      ${admin ? '<div class="actions"><button class="btn primary" id="open-dialog">+ Dispatch Order</button></div>' : ''}
    </div>
    ${feedback ? `<div class="feedback ${feedback.error ? 'error' : 'success'}" role="status">${escapeHtml(feedback.text)}</div>` : ''}
    <div class="layout ${admin ? 'admin' : ''}">
      <div class="stack">
        ${roomMap()}
        ${admin ? `
          <section class="card">
            <div class="card-header">
              <div>
                <h3>Dispatched Work Orders</h3>
                <p class="sub">Active permit ledger across facility zones</p>
              </div>
              <span class="tech-code muted">ORDERS: ${state.tasks.length}</span>
            </div>
            <div class="list">${supervisorTasks()}</div>
          </section>
        ` : ''}
      </div>
      ${admin ? supervisorSide() : `
        <section class="card">
          <div class="card-header">
            <div>
              <h3>Assigned Maintenance Orders</h3>
              <p class="sub">Procedure checklist unlocks following NFC asset verification</p>
            </div>
            <span class="tech-code muted">STATION: RPI5-01</span>
          </div>
          <div class="list">${technicianTasks()}</div>
        </section>
      `}
    </div>
    ${admin ? modal() : ''}
  `;

  app.innerHTML = shell(body);
}

async function fetchState(force = false) {
  if (role === 'launcher') return;
  if (!state) { loading = true; render(); }
  try {
    const response = await fetch(apiPath('state'), { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not synchronize state from local station');
    const next = await response.json();
    const dialogOpen = document.getElementById('assign-dialog')?.open;
    if (force || !state || next.version !== state.version) {
      state = next;
      if (!dialogOpen) render();
    }
    failed = false;
  } catch (error) {
    failed = true;
    feedback = { text: 'Station connection disrupted. Telemetry buffer retained.', error: true };
    render();
  } finally {
    loading = false;
  }
}

async function postAction(action, fields = {}) {
  try {
    const response = await fetch(apiPath('action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...fields }),
    });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error || 'Action rejected');
    state = next;
    feedback = {
      text: action === 'tap'
        ? 'NFC asset scan initiated. Awaiting cryptographic verification lease.'
        : 'Action committed to audit trail.',
      error: false,
    };
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
    const response = await fetch(apiPath('action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', ...Object.fromEntries(new FormData(form)) }),
    });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error || 'Could not dispatch order');
    state = next;
    feedback = { text: 'Maintenance order dispatched to technician. Awaiting NFC scan.', error: false };
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
  if (target.id === 'close-dialog' || target.id === 'cancel-dialog') {
    document.getElementById('assign-dialog').close();
    return render();
  }
  if (target.dataset.action) postAction(target.dataset.action, { id: target.dataset.id });
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-check-index]')) {
    postAction('checklist', { id: event.target.dataset.id, index: Number(event.target.dataset.checkIndex) });
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'assign-form') return;
  event.preventDefault();
  createTask(event.target);
});

if (role === 'launcher') launcher();
else {
  fetchState();
  setInterval(() => fetchState(), 2000);
}
