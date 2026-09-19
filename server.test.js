const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, createServer } = require('./server');

test('assignment reaches technician immediately, then NFC waits for verification', () => {
  const store = createStore();
  const id = store.snapshot('technician').tasks[0].id;
  assert.equal(store.snapshot('technician').events, undefined);
  assert.equal(store.snapshot('technician').tasks[0].status, 'assigned');
  store.act('technician', 'tap', { id });
  assert.equal(store.snapshot('technician').tasks[0].status, 'verifying');
  assert.ok(store.snapshot('supervisor').events.some((e) => e.kind === 'checkin'));
  store.resolveVerification(id, true);
  assert.equal(store.snapshot('technician').tasks[0].status, 'verified');
});

test('only technician can initiate NFC tap; work is locked before verification', () => {
  const store = createStore();
  const id = store.snapshot('technician').tasks[0].id;
  assert.throws(() => store.act('supervisor', 'tap', { id }), { status: 403 });
  assert.throws(() => store.act('technician', 'complete', { id }), { status: 409 });
  assert.throws(() => store.act('technician', 'checklist', { id, index: 0 }), { status: 409 });
  store.act('technician', 'tap', { id });
  assert.throws(() => store.act('technician', 'checklist', { id, index: 0 }), { status: 409 });
});

test('task completion needs successful verification and all checklist items', () => {
  const store = createStore();
  const id = store.snapshot('technician').tasks[0].id;
  store.act('technician', 'tap', { id });
  assert.throws(() => store.act('technician', 'complete', { id }), { status: 409 });
  store.resolveVerification(id, true);
  assert.throws(() => store.act('technician', 'complete', { id }), { status: 409 });
  for (const index of [0, 1, 2]) store.act('technician', 'checklist', { id, index });
  store.act('technician', 'complete', { id });
  assert.equal(store.snapshot('supervisor').tasks[0].status, 'completed');
});

test('one demo reader cannot check in a different room', () => {
  const store = createStore();
  store.act('supervisor', 'create', { title: 'Inspect switch', asset: 'Rack A-01', instructions: 'Record status.', due: '2026-09-20T12:00', room: 'Server Room A' });
  const id = store.snapshot('supervisor').tasks.at(-1).id;
  assert.equal(store.snapshot('technician').tasks.at(-1).status, 'assigned');
  assert.throws(() => store.act('technician', 'tap', { id }), { status: 409 });
});

test('failed verification never grants access and can be retried with cooldown override', () => {
  const store = createStore({ rateLimitCooldownMs: 0 });
  const id = store.snapshot('technician').tasks[0].id;
  store.act('technician', 'tap', { id });
  store.resolveVerification(id, false);
  assert.equal(store.snapshot('technician').tasks[0].status, 'rejected');
  assert.throws(() => store.act('technician', 'checklist', { id, index: 0 }), { status: 409 });
  store.act('technician', 'tap', { id });
  assert.equal(store.snapshot('technician').tasks[0].status, 'verifying');
});

test('2FA OTP verification authenticates technician session', () => {
  const store = createStore();
  const id = store.snapshot('technician').tasks[0].id;
  store.act('technician', 'tap', { id });
  const otp = store.getDevOtp();
  assert.ok(otp && otp.length === 6);
  assert.equal(store.snapshot('technician').auth_state.otp_pending, true);

  // Incorrect OTP decreases attempts
  assert.throws(() => store.act('technician', 'verify_otp', { otp: '000000' }), { status: 400 });
  assert.equal(store.snapshot('technician').auth_state.attempts_remaining, 2);

  // Correct OTP authenticates
  store.act('technician', 'verify_otp', { otp });
  assert.equal(store.snapshot('technician').auth_state.authenticated, true);
  assert.equal(store.snapshot('technician').auth_state.otp_pending, false);
});

test('IDOR protection denies technician access to foreign task', () => {
  const store = createStore();
  // Attempting action on non-existent or unassigned task throws 404 or 403
  assert.throws(() => store.act('technician', 'tap', { id: 'WO-UNKNOWN' }), { status: 404 });
});

test('automatic simulated verification advances after a short delay', async () => {
  const store = createStore({ verificationDelayMs: 10 });
  const id = store.snapshot('technician').tasks[0].id;
  store.act('technician', 'tap', { id });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(store.snapshot('technician').tasks[0].status, 'verified');
});

test('HTTP port role controls returned data and actions', async (t) => {
  const server = createServer(1501, createStore());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.role, 'technician');
  assert.equal(state.events, undefined);
  const forbidden = await fetch(`${base}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke', id: 'WO-1042' }) });
  assert.equal(forbidden.status, 403);
});

test('audit log endpoint requires supervisor clearance', async (t) => {
  const techServer = createServer(1501, createStore());
  await new Promise((resolve) => techServer.listen(0, '127.0.0.1', resolve));
  t.after(() => techServer.close());
  const techBase = `http://127.0.0.1:${techServer.address().port}`;
  const techRes = await fetch(`${techBase}/api/audit-log`);
  assert.equal(techRes.status, 403);

  const supServer = createServer(1502, createStore());
  await new Promise((resolve) => supServer.listen(0, '127.0.0.1', resolve));
  t.after(() => supServer.close());
  const supBase = `http://127.0.0.1:${supServer.address().port}`;
  const supRes = await fetch(`${supBase}/api/audit-log`);
  assert.equal(supRes.status, 200);
  const events = await supRes.json();
  assert.ok(Array.isArray(events));
});

test('hosted single-port routes serve both demo roles, SPA, and health', async (t) => {
  const server = createServer(8080, createStore());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await (await fetch(`${base}/technician/api/state`)).json()).role, 'technician');
  assert.equal((await (await fetch(`${base}/supervisor/api/state`)).json()).role, 'supervisor');
  assert.equal((await (await fetch(`${base}/api/state`)).json()).role, 'supervisor');
  assert.equal((await fetch(`${base}/technician/`)).status, 200);
  assert.equal((await fetch(`${base}/supervisor`)).status, 200);
});
