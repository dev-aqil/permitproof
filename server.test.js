const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, createServer } = require('./server');

test('supervisor changes appear in technician view without exposing admin events', () => {
  const store = createStore();
  const id = store.snapshot('technician').tasks[0].id;
  assert.equal(store.snapshot('technician').events, undefined);
  store.act('supervisor', 'approve', { id });
  assert.equal(store.snapshot('technician').tasks[0].status, 'approved');
  store.act('supervisor', 'checkin', { id });
  assert.equal(store.snapshot('technician').tasks[0].status, 'checked_in');
  assert.equal(store.snapshot('supervisor').events[0].kind, 'checkin');
});

test('technician cannot approve or bypass check-in', () => {
  const store = createStore();
  const id = store.snapshot('technician').tasks[0].id;
  assert.throws(() => store.act('technician', 'approve', { id }), { status: 403 });
  assert.throws(() => store.act('technician', 'complete', { id }), { status: 409 });
  assert.throws(() => store.act('technician', 'checklist', { id, index: 0 }), { status: 409 });
});

test('task completion needs approval, check-in, and all checklist items', () => {
  const store = createStore();
  const id = store.snapshot('technician').tasks[0].id;
  store.act('supervisor', 'approve', { id });
  store.act('supervisor', 'checkin', { id });
  assert.throws(() => store.act('technician', 'complete', { id }), { status: 409 });
  for (const index of [0, 1, 2]) store.act('technician', 'checklist', { id, index });
  store.act('technician', 'complete', { id });
  assert.equal(store.snapshot('supervisor').tasks[0].status, 'completed');
});

test('one demo reader cannot check in a different room', () => {
  const store = createStore();
  store.act('supervisor', 'create', { title: 'Inspect switch', asset: 'Rack A-01', instructions: 'Record status.', due: '2026-09-20T12:00', room: 'Server Room A' });
  const id = store.snapshot('supervisor').tasks.at(-1).id;
  store.act('supervisor', 'approve', { id });
  assert.throws(() => store.act('supervisor', 'checkin', { id }), { status: 409 });
});

test('HTTP port role controls returned data and actions', async (t) => {
  const server = createServer(1501, createStore());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.role, 'technician');
  assert.equal(state.events, undefined);
  const forbidden = await fetch(`${base}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', id: 'WO-1042' }) });
  assert.equal(forbidden.status, 403);
});

test('hosted single-port routes serve both demo roles and health', async (t) => {
  const server = createServer(8080, createStore());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await (await fetch(`${base}/technician/api/state`)).json()).role, 'technician');
  assert.equal((await (await fetch(`${base}/supervisor/api/state`)).json()).role, 'supervisor');
  assert.equal((await (await fetch(`${base}/api/state`)).json()).role, 'supervisor');
  assert.equal((await fetch(`${base}/technician/`)).status, 200);
});
