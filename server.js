const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ROOMS = ['Server Room A', 'Server Room B', 'Server Room C'];
const TECHNICIAN = 'Amir H.';
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

function createStore({ verificationDelayMs = 4000 } = {}) {
  let version = 1;
  let eventSeq = 1002;
  let tasks = [{
    id: 'WO-1042',
    technician: TECHNICIAN,
    room: 'Server Room B',
    asset: 'Rack B-04',
    title: 'Inspect air handling unit',
    instructions: 'Check filter differential pressure and record telemetry.',
    due: '2026-09-20T12:00',
    status: 'assigned',
    deviceId: 'rpi5-station-01',
    keyId: 'ed25519-pk-8f12',
    hardwareLed: 'YELLOW',
    leaseSeconds: 30,
    checklist: [
      { label: 'Check filter differential pressure', done: false },
      { label: 'Sample environmental sensors', done: false },
      { label: 'Submit maintenance telemetry notes', done: false },
    ],
    checkInAt: null,
    verifiedAt: null,
    leaseExpiresAt: null,
    tapAttempt: null,
  }];
  let events = [{
    id: randomUUID(),
    code: 'EVT-1001',
    time: new Date().toISOString(),
    kind: 'info',
    text: 'PermitProof pipeline online. WO-1042 assigned to technician.',
  }];

  function log(kind, text) {
    const code = `EVT-${eventSeq++}`;
    events.unshift({ id: randomUUID(), code, time: new Date().toISOString(), kind, text });
    events = events.slice(0, 100);
    version += 1;
  }
  function snapshot(role) {
    if (role === 'technician') {
      return {
        version, role, technician: TECHNICIAN, rooms: ROOMS,
        tasks: tasks.filter((task) => task.technician === TECHNICIAN),
      };
    }
    return { version, role, technician: TECHNICIAN, rooms: ROOMS, tasks, events };
  }
  function act(role, action, input) {
    if (action === 'create') {
      if (role !== 'supervisor') throw Object.assign(new Error('Supervisor action only'), { status: 403 });
      const title = clean(input.title, 100);
      const asset = clean(input.asset, 60);
      const instructions = clean(input.instructions, 500);
      const due = clean(input.due, 40);
      const room = input.room;
      if (!title || !asset || !instructions || !due || !ROOMS.includes(room)) throw Object.assign(new Error('Complete all task fields'), { status: 400 });
      const id = `WO-${String(Date.now()).slice(-7)}`;
      tasks.push({
        id,
        technician: TECHNICIAN,
        room,
        asset,
        title,
        instructions,
        due,
        status: 'assigned',
        deviceId: 'rpi5-station-01',
        keyId: 'ed25519-pk-8f12',
        hardwareLed: 'YELLOW',
        leaseSeconds: 30,
        checklist: [
          { label: 'Inspect assigned asset equipment', done: false },
          { label: 'Record telemetry findings', done: false },
          { label: 'Submit maintenance evidence notes', done: false },
        ],
        checkInAt: null,
        verifiedAt: null,
        leaseExpiresAt: null,
        tapAttempt: null,
      });
      log('task', `${id} assigned to ${TECHNICIAN} for ${room} (${asset}). Sent to technician.`);
      return snapshot(role);
    }
    const task = tasks.find((item) => item.id === input.id);
    if (!task) throw Object.assign(new Error('Work order not found'), { status: 404 });
    if (action === 'tap') {
      if (role !== 'technician') throw Object.assign(new Error('Technician action only'), { status: 403 });
      if (task.room !== 'Server Room B') throw Object.assign(new Error('The demo NFC reader is assigned to Server Room B only'), { status: 409 });
      if (!['assigned', 'rejected'].includes(task.status)) throw Object.assign(new Error('This task cannot start a new NFC verification'), { status: 409 });
      task.status = 'verifying';
      task.hardwareLed = 'YELLOW';
      task.checkInAt = new Date().toISOString();
      task.verifiedAt = null;
      task.leaseExpiresAt = null;
      task.tapAttempt = randomUUID();
      const attempt = task.tapAttempt;
      log('checkin', `Simulated NFC scan: ${task.technician}, ${task.room}, ${task.id}. Awaiting authorization lease.`);
      const timer = setTimeout(() => resolveVerification(task.id, true, attempt), verificationDelayMs);
      timer.unref?.();
    } else if (action === 'revoke') {
      supervisorOnly(role);
      if (!['assigned', 'verifying', 'verified'].includes(task.status)) throw Object.assign(new Error('This work order is already closed'), { status: 409 });
      task.status = 'revoked';
      task.hardwareLed = 'RED';
      task.leaseExpiresAt = null;
      log('warning', `${task.id} authorization revoked by supervisor. Hardware LED: RED.`);
    } else if (action === 'checklist') {
      if (role !== 'technician') throw Object.assign(new Error('Technician action only'), { status: 403 });
      if (task.technician !== TECHNICIAN || task.status !== 'verified') throw Object.assign(new Error('Wait for successful NFC verification before updating the checklist'), { status: 409 });
      const index = Number(input.index);
      if (!Number.isInteger(index) || index < 0 || index >= task.checklist.length) throw Object.assign(new Error('Invalid checklist item'), { status: 400 });
      task.checklist[index].done = !task.checklist[index].done;
      log('task', `${task.id}: ${task.checklist[index].label} ${task.checklist[index].done ? 'completed' : 'reopened'}.`);
    } else if (action === 'complete') {
      if (role !== 'technician') throw Object.assign(new Error('Technician action only'), { status: 403 });
      if (task.technician !== TECHNICIAN || task.status !== 'verified') throw Object.assign(new Error('Wait for successful NFC verification before completing the task'), { status: 409 });
      if (!task.checklist.every((item) => item.done)) throw Object.assign(new Error('Complete the checklist first'), { status: 409 });
      task.status = 'completed';
      task.hardwareLed = 'YELLOW';
      log('approved', `${task.id} maintenance completed by ${task.technician}. Committed to audit trail.`);
    } else {
      throw Object.assign(new Error('Unknown action'), { status: 400 });
    }
    return snapshot(role);
  }
  function resolveVerification(id, passed, attempt) {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.status !== 'verifying' || (attempt && task.tapAttempt !== attempt)) return false;
    task.status = passed ? 'verified' : 'rejected';
    task.verifiedAt = passed ? new Date().toISOString() : null;
    task.leaseExpiresAt = passed ? new Date(Date.now() + 30000).toISOString() : null;
    task.hardwareLed = passed ? 'GREEN' : 'RED';
    log(passed ? 'approved' : 'warning', `${task.id} authorization ${passed ? 'granted: 30s lease active (LED: GREEN)' : 'denied: signature failure (LED: RED)'}.`);
    return true;
  }
  return { snapshot, act, resolveVerification };
}

function clean(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}
function supervisorOnly(role) {
  if (role !== 'supervisor') throw Object.assign(new Error('Supervisor action only'), { status: 403 });
}
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function createServer(port, store) {
  const localRole = port === 1501 ? 'technician' : port === 1502 ? 'supervisor' : 'launcher';
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (port === 8080 && url.pathname === '/health') return sendJson(res, 200, { status: 'ok' });
    const role = port === 8080
      ? url.pathname.startsWith('/technician/') ? 'technician' : 'supervisor'
      : localRole;
    const assetPath = port === 8080 ? url.pathname.replace(/^\/(technician|supervisor)(?=\/)/, '') : url.pathname;
    const routePath = port === 8080 ? assetPath : url.pathname;
    if (routePath === '/api/state' && req.method === 'GET') {
      if (role === 'launcher') return sendJson(res, 403, { error: 'Open a role dashboard' });
      return sendJson(res, 200, store.snapshot(role));
    }
    if (routePath === '/api/action' && req.method === 'POST') {
      if (role === 'launcher') return sendJson(res, 403, { error: 'Open a role dashboard' });
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 32768) req.destroy();
      });
      req.on('end', () => {
        try {
          const { action, ...input } = JSON.parse(body);
          sendJson(res, 200, store.act(role, action, input));
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.message || 'Invalid request' });
        }
      });
      return;
    }
    if (req.method !== 'GET' || !STATIC[assetPath]) return sendJson(res, 404, { error: 'Not found' });
    const [file, type] = STATIC[assetPath];
    const content = fs.readFileSync(path.join(__dirname, 'public', file));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  });
}

if (require.main === module) {
  const store = createStore();
  const hosted = process.env.PORT === '8080';
  for (const port of hosted ? [8080] : [1500, 1501, 1502, 1503]) {
    const server = createServer(port, store);
    server.on('error', (error) => {
      if (port === 1500 && error.code === 'EADDRINUSE') {
        console.warn('Port 1500 is occupied by another app. PermitProof launcher remains available on 1503.');
      } else {
        console.error(`Cannot start port ${port}: ${error.message}`);
        process.exitCode = 1;
      }
    });
    server.listen(port, hosted ? '0.0.0.0' : '127.0.0.1', () => console.log(`PermitProof listening on ${port}`));
  }
}

module.exports = { createStore, createServer };
