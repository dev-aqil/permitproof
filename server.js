const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const SHARED_DEVICE_KEY = 'permitproof-rpi5-shared-secret-2026';

// Seed users with 64-character SHA-256 card hashes (AGENTS.md §6.1, §8.1)
const CARD_ID_AMIR = 'NFC-CARD-AMIR-8821';
const CARD_HASH_AMIR = sha256(CARD_ID_AMIR);

const CARD_ID_ELENA = 'NFC-CARD-ELENA-9942';
const CARD_HASH_ELENA = sha256(CARD_ID_ELENA);

// Seed devices with 64-character SHA-256 device hashes (AGENTS.md §6.2, §8.2)
const DEVICE_ID_B = 'RPI5-STATION-B04';
const DEVICE_HASH_B = sha256(DEVICE_ID_B);

const DEVICE_ID_A = 'RPI5-STATION-A01';
const DEVICE_HASH_A = sha256(DEVICE_ID_A);

const USERS = [
  {
    card_hash: CARD_HASH_AMIR,
    full_name: 'Amir H.',
    email: 'amir.h@permitproof.local',
    role: 'technician',
  },
  {
    card_hash: CARD_HASH_ELENA,
    full_name: 'Elena R.',
    email: 'elena.r@permitproof.local',
    role: 'supervisor',
  },
];

const DEVICES = [
  { device_hash: DEVICE_HASH_B, room_id: 'Server Room B' },
  { device_hash: DEVICE_HASH_A, room_id: 'Server Room A' },
];

const ROOMS = ['Server Room A', 'Server Room B', 'Server Room C'];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveStaticFile(res, filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(content);
      return true;
    }
  } catch {}
  return false;
}

function createStore({ verificationDelayMs = 4000, rateLimitCooldownMs = 3000 } = {}) {
  let version = 1;
  let activeNonce = null;

  let tasks = [{
    id: 'WO-1042',
    job_id: 'WO-1042',
    timestamp: '2026-09-20T00:00:00Z',
    supervisor_id: CARD_HASH_ELENA,
    technician_id: CARD_HASH_AMIR,
    technician: 'Amir H.',
    room: 'Server Room B',
    room_id: 'Server Room B',
    asset: 'Rack B-04',
    title: 'Inspect air handling unit',
    instructions: 'Check filter differential pressure and inspect cooling coil operation.',
    due: '2026-09-20T12:00',
    status: 'assigned',
    is_complete: false,
    tasks: [
      'Check filter differential pressure',
      'Inspect cooling coil operation',
      'Submit maintenance findings',
    ],
    checklist: [
      { label: 'Check filter differential pressure', done: false },
      { label: 'Inspect cooling coil operation', done: false },
      { label: 'Submit maintenance findings', done: false },
    ],
    checkInAt: null,
    verifiedAt: null,
    tapAttempt: null,
  }];

  // JSON Audit Log entries strictly conforming to AGENTS.md §9
  let events = [{
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    time: new Date().toISOString(),
    device_ref: DEVICE_HASH_B,
    user_ref: CARD_HASH_ELENA,
    message: 'PermitProof engine online. Job WO-1042 assigned to technician.',
    text: 'PermitProof engine online. Job WO-1042 assigned to technician.',
    kind: 'info',
  }];

  // Authentication session state for NFC + Email OTP (AGENTS.md §4.2, §13)
  const authSession = {
    nfc_detected: false,
    otp_pending: false,
    otp_code: null, // Stored strictly in memory, never exposed in snapshot
    otp_expires_at: 0,
    otp_attempts_remaining: 3,
    authenticated: false,
    card_hash: null,
    device_hash: null,
    last_otp_sent_ms: 0,
    simulated_email_notice: null,
  };

  function log(kind, message, userRef = CARD_HASH_AMIR, deviceRef = DEVICE_HASH_B) {
    const timestamp = new Date().toISOString();
    events.unshift({
      id: crypto.randomUUID(),
      timestamp,
      time: timestamp,
      device_ref: deviceRef,
      user_ref: userRef,
      message,
      text: message,
      kind,
    });
    events = events.slice(0, 100);
    version += 1;
  }

  function issueNonce() {
    const nonce = crypto.randomBytes(16).toString('hex');
    activeNonce = {
      nonce,
      expiresAt: Date.now() + 10000, // 10-second timeout per AGENTS.md §7
    };
    log('info', 'Authentication challenge nonce issued');
    return { nonce, expires_in_sec: 10 };
  }

  function verifyHmacPackage({ PID, nonce, CID, HMAC }) {
    if (!activeNonce || activeNonce.nonce !== nonce) {
      log('warning', 'HMAC verification failed: unknown or missing nonce');
      throw Object.assign(new Error('Invalid or expired authentication nonce'), { status: 401 });
    }
    if (Date.now() > activeNonce.expiresAt) {
      log('warning', 'HMAC verification failed: challenge nonce expired');
      throw Object.assign(new Error('Authentication challenge timed out (10s limit)'), { status: 401 });
    }

    const expectedPID = sha256(DEVICE_ID_B + SHARED_DEVICE_KEY);
    if (!safeCompare(PID, expectedPID)) {
      log('warning', 'HMAC verification failed: invalid device PID');
      throw Object.assign(new Error('Device identity verification failed'), { status: 403 });
    }

    const user = USERS.find((u) => u.card_hash === CID && u.role === 'technician');
    if (!user) {
      log('warning', 'Authentication rejected: unregistered NFC card hash');
      throw Object.assign(new Error('Unregistered technician NFC card'), { status: 403 });
    }

    const payload = `${PID}:${nonce}:${CID}`;
    const expectedHMAC = crypto.createHmac('sha256', SHARED_DEVICE_KEY).update(payload).digest('hex');
    if (!safeCompare(HMAC, expectedHMAC)) {
      log('warning', 'HMAC verification failed: message authentication mismatch');
      throw Object.assign(new Error('HMAC signature verification failed'), { status: 403 });
    }

    // Whiteboard authentication passed -> generate and send email OTP (Factor 2)
    activeNonce = null;
    generateAndSendOtp(user);
    log('checkin', `NFC card detected. Authentication request processed for ${user.full_name}`);
    return { status: 'otp_sent', email_masked: maskEmail(user.email) };
  }

  function generateAndSendOtp(user) {
    const now = Date.now();
    if (rateLimitCooldownMs > 0 && now - authSession.last_otp_sent_ms < rateLimitCooldownMs) {
      throw Object.assign(new Error('Rate limit exceeded: please wait before requesting another OTP'), { status: 429 });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    authSession.nfc_detected = true;
    authSession.otp_pending = true;
    authSession.otp_code = otp;
    authSession.otp_expires_at = now + 5 * 60 * 1000; // 5 minutes
    authSession.otp_attempts_remaining = 3;
    authSession.card_hash = user.card_hash;
    authSession.device_hash = DEVICE_HASH_B;
    authSession.last_otp_sent_ms = now;
    authSession.authenticated = false;
    authSession.simulated_email_notice = `[SIMULATED EMAIL DISPATCH] Sent to ${user.email} (Valid for 5 min)`;

    log('info', `OTP sent to registered email address: ${maskEmail(user.email)}`, user.card_hash, DEVICE_HASH_B);
    return otp;
  }

  function verifyOtp(submittedOtp) {
    if (!authSession.otp_pending || !authSession.otp_code) {
      throw Object.assign(new Error('No pending OTP verification request. Tap NFC card first.'), { status: 400 });
    }
    if (Date.now() > authSession.otp_expires_at) {
      authSession.otp_pending = false;
      authSession.otp_code = null;
      log('warning', 'OTP verification failed: code expired');
      throw Object.assign(new Error('OTP expired. Please tap NFC card again to receive a fresh code.'), { status: 400 });
    }
    if (authSession.otp_attempts_remaining <= 0) {
      authSession.otp_pending = false;
      authSession.otp_code = null;
      log('warning', 'Authentication rejected: maximum OTP attempts exceeded');
      throw Object.assign(new Error('Maximum OTP verification attempts exceeded. Access locked.'), { status: 429 });
    }

    const isMatch = safeCompare(String(submittedOtp).trim(), authSession.otp_code);
    if (!isMatch) {
      authSession.otp_attempts_remaining -= 1;
      log('warning', `OTP verification failed: incorrect code (${authSession.otp_attempts_remaining} attempts remaining)`);
      if (authSession.otp_attempts_remaining <= 0) {
        authSession.otp_pending = false;
        authSession.otp_code = null;
        throw Object.assign(new Error('Incorrect OTP. Maximum attempts exceeded. Verification locked.'), { status: 403 });
      }
      throw Object.assign(new Error(`Incorrect OTP code. ${authSession.otp_attempts_remaining} attempts remaining.`), { status: 400 });
    }

    // Factor 2 success -> Activate session & authorize technician tasks
    authSession.authenticated = true;
    authSession.otp_pending = false;
    authSession.otp_code = null; // Invalidate OTP immediately upon use
    authSession.simulated_email_notice = null;

    const task = tasks.find((t) => t.technician_id === authSession.card_hash && t.status === 'verifying');
    if (task) {
      task.status = 'verified';
      task.verifiedAt = new Date().toISOString();
    }

    log('approved', 'OTP verification successful. Technician session activated.');
    log('info', 'Job accessed by authenticated technician');
    version += 1;
    return true;
  }

  function snapshot(role) {
    if (role === 'technician') {
      const user = USERS.find((u) => u.role === 'technician');
      return {
        version,
        role: 'technician',
        technician: user.full_name,
        technician_card_hash: user.card_hash,
        technician_email: user.email,
        rooms: ROOMS,
        devices: DEVICES,
        tasks: tasks.filter((t) => t.technician_id === user.card_hash),
        auth_state: {
          nfc_detected: authSession.nfc_detected,
          otp_pending: authSession.otp_pending,
          authenticated: authSession.authenticated,
          attempts_remaining: authSession.otp_attempts_remaining,
          email_masked: maskEmail(user.email),
          expires_in_sec: Math.max(0, Math.round((authSession.otp_expires_at - Date.now()) / 1000)),
          email_notice: authSession.simulated_email_notice,
        },
      };
    }

    const supervisor = USERS.find((u) => u.role === 'supervisor');
    return {
      version,
      role: 'supervisor',
      supervisor: supervisor.full_name,
      supervisor_card_hash: supervisor.card_hash,
      technician: USERS[0].full_name,
      rooms: ROOMS,
      devices: DEVICES,
      technicians: USERS.filter((u) => u.role === 'technician').map((u) => ({
        full_name: u.full_name,
        email: u.email,
        card_hash: u.card_hash,
      })),
      tasks,
      events,
      audit_log: events,
    };
  }

  function act(role, action, input) {
    if (action === 'create') {
      if (role !== 'supervisor') throw Object.assign(new Error('Supervisor action only'), { status: 403 });
      const title = clean(input.title, 100);
      const asset = clean(input.asset, 60);
      const instructions = clean(input.instructions, 500);
      const due = clean(input.due, 40);
      const room = input.room;
      if (!title || !asset || !instructions || !due || !ROOMS.includes(room)) {
        throw Object.assign(new Error('Complete all task fields'), { status: 400 });
      }

      const id = `WO-${String(Date.now()).slice(-7)}`;
      const technicianUser = USERS.find((u) => u.role === 'technician');
      const supervisorUser = USERS.find((u) => u.role === 'supervisor');

      const taskList = input.tasks && Array.isArray(input.tasks) && input.tasks.length > 0
        ? input.tasks.map((t) => clean(t, 120))
        : ['Inspect assigned asset equipment', 'Record operating parameters', 'Submit maintenance evidence'];

      tasks.push({
        id,
        job_id: id,
        timestamp: new Date().toISOString(),
        supervisor_id: supervisorUser.card_hash,
        technician_id: technicianUser.card_hash,
        technician: technicianUser.full_name,
        room,
        room_id: room,
        asset,
        title,
        instructions,
        due,
        status: 'assigned',
        is_complete: false,
        tasks: taskList,
        checklist: taskList.map((label) => ({ label, done: false })),
        checkInAt: null,
        verifiedAt: null,
        tapAttempt: null,
      });

      log('task', `${id} assigned to ${technicianUser.full_name} for ${room} (${asset}).`, supervisorUser.card_hash);
      return snapshot(role);
    }

    if (action === 'verify_otp') {
      if (role !== 'technician') throw Object.assign(new Error('Technician action only'), { status: 403 });
      verifyOtp(input.otp);
      return snapshot(role);
    }

    const task = tasks.find((item) => item.id === input.id);
    if (!task) throw Object.assign(new Error('Work order not found'), { status: 404 });

    // IDOR Protection: Technician can only interact with their assigned job (AGENTS.md §12)
    if (role === 'technician' && task.technician_id !== CARD_HASH_AMIR) {
      throw Object.assign(new Error('Forbidden: Access denied to unassigned job'), { status: 403 });
    }

    if (action === 'tap') {
      if (role !== 'technician') throw Object.assign(new Error('Technician action only'), { status: 403 });
      if (task.room !== 'Server Room B') throw Object.assign(new Error('The demo NFC reader is assigned to Server Room B only'), { status: 409 });
      if (!['assigned', 'rejected'].includes(task.status)) throw Object.assign(new Error('This task cannot start a new NFC verification'), { status: 409 });

      task.status = 'verifying';
      task.checkInAt = new Date().toISOString();
      task.verifiedAt = null;
      task.tapAttempt = crypto.randomUUID();
      const attempt = task.tapAttempt;

      const techUser = USERS.find((u) => u.card_hash === CARD_HASH_AMIR);
      log('checkin', `NFC card detected: ${task.technician} at ${task.asset} (${task.room})`, techUser.card_hash);
      generateAndSendOtp(techUser);

      if (verificationDelayMs > 0) {
        const timer = setTimeout(() => resolveVerification(task.id, true, attempt), verificationDelayMs);
        timer.unref?.();
      }
    } else if (action === 'revoke') {
      if (role !== 'supervisor') throw Object.assign(new Error('Supervisor action only'), { status: 403 });
      if (!['assigned', 'verifying', 'verified'].includes(task.status)) throw Object.assign(new Error('This work order is already closed'), { status: 409 });
      task.status = 'revoked';
      authSession.authenticated = false;
      log('warning', `${task.id} authorization revoked by supervisor.`);
    } else if (action === 'checklist') {
      if (role !== 'technician') throw Object.assign(new Error('Technician action only'), { status: 403 });
      if (task.technician !== USERS[0].full_name || task.status !== 'verified') {
        throw Object.assign(new Error('Wait for successful NFC verification before updating the checklist'), { status: 409 });
      }
      const index = Number(input.index);
      if (!Number.isInteger(index) || index < 0 || index >= task.checklist.length) {
        throw Object.assign(new Error('Invalid checklist item'), { status: 400 });
      }
      task.checklist[index].done = !task.checklist[index].done;
      log('task', `${task.id}: ${task.checklist[index].label} ${task.checklist[index].done ? 'completed' : 'reopened'}.`);
    } else if (action === 'complete') {
      if (role !== 'technician') throw Object.assign(new Error('Technician action only'), { status: 403 });
      if (task.technician !== USERS[0].full_name || task.status !== 'verified') {
        throw Object.assign(new Error('Wait for successful NFC verification before completing the task'), { status: 409 });
      }
      if (!task.checklist.every((item) => item.done)) {
        throw Object.assign(new Error('Complete the checklist first'), { status: 409 });
      }
      task.status = 'completed';
      task.is_complete = true;
      log('approved', `${task.id} completed by ${task.technician}. Committed to JSON audit log.`);
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
    authSession.authenticated = passed;
    authSession.otp_pending = false;
    log(passed ? 'approved' : 'warning', `${task.id} NFC verification ${passed ? 'passed; room access granted' : 'failed; room access denied'} (simulated).`);
    return true;
  }

  // Developer helper for verification/testing OTP
  function getDevOtp() {
    return authSession.otp_code;
  }

  return {
    snapshot,
    act,
    resolveVerification,
    issueNonce,
    verifyHmacPackage,
    verifyOtp,
    getDevOtp,
  };
}

function clean(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '***@permitproof.local';
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

function createServer(port, store) {
  const localRole = port === 1501 ? 'technician' : port === 1502 ? 'supervisor' : 'launcher';

  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (port === 8080 && url.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok' });
    }

    const role = port === 8080
      ? url.pathname.startsWith('/technician/') ? 'technician' : 'supervisor'
      : localRole;

    const assetPath = port === 8080
      ? url.pathname.replace(/^\/(technician|supervisor)(?=\/)/, '')
      : url.pathname;

    const routePath = port === 8080 ? assetPath : url.pathname;

    // Public / Station Whiteboard Protocol Endpoints (AGENTS.md §7)
    if (routePath === '/api/auth/nonce' && req.method === 'POST') {
      return sendJson(res, 200, store.issueNonce());
    }

    if (routePath === '/api/auth/verify-package' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 8192) req.destroy(); });
      req.on('end', () => {
        try {
          const input = JSON.parse(body);
          sendJson(res, 200, store.verifyHmacPackage(input));
        } catch (err) {
          sendJson(res, err.status || 400, { error: err.message || 'Invalid package' });
        }
      });
      return;
    }

    // Role state
    if (routePath === '/api/state' && req.method === 'GET') {
      if (role === 'launcher') return sendJson(res, 403, { error: 'Open a role dashboard' });
      return sendJson(res, 200, store.snapshot(role));
    }

    // Direct audit-log endpoint for supervisor / compliance
    if (routePath === '/api/audit-log' && req.method === 'GET') {
      if (role !== 'supervisor') return sendJson(res, 403, { error: 'Supervisor clearance required' });
      return sendJson(res, 200, store.snapshot('supervisor').events);
    }

    // Actions
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

    // Serve Static Assets & React SPA
    if (req.method === 'GET') {
      const cleanPath = assetPath.replace(/^\//, '');

      // 1. Direct assets from public/dist or public
      if (cleanPath) {
        const distFile = path.join(__dirname, 'public', 'dist', cleanPath);
        if (serveStaticFile(res, distFile)) return;

        const publicFile = path.join(__dirname, 'public', cleanPath);
        if (serveStaticFile(res, publicFile)) return;
      }

      // 2. React SPA index.html from dist
      const distIndex = path.join(__dirname, 'public', 'dist', 'index.html');
      if (serveStaticFile(res, distIndex)) return;

      // 3. Fallback to public/index.html
      const fallbackFile = path.join(__dirname, 'public', 'index.html');
      if (serveStaticFile(res, fallbackFile)) return;
    }

    sendJson(res, 404, { error: 'Not found' });
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

module.exports = {
  createStore,
  createServer,
  sha256,
  CARD_HASH_AMIR,
  CARD_HASH_ELENA,
  DEVICE_HASH_B,
  DEVICE_HASH_A,
  SHARED_DEVICE_KEY,
};
