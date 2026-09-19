# PermitProof — Industrial IoT Permit & Access Verification

PermitProof provides a fail-safe, cryptographic dual-factor verification system for industrial plant maintenance workflows. It enforces physical proximity via NFC card badges (Factor 1) alongside time-bound, out-of-band email OTPs (Factor 2) before unlocking field procedure checklists or room access.

The frontend is built with **React 19 + TypeScript** bundled via **Vite**, adhering strictly to the 6-token color and typography architecture defined in [`DESIGN.md`](./DESIGN.md) and the security standards defined in [`AGENTS.md`](./AGENTS.md).

---

## 🚀 How to Run and View in Your Browser

### Option 1: Standard Multi-Port Run (Recommended)

Since the frontend is already compiled into `public/dist/`, you can launch the backend server immediately:

```bash
# In the project root (permitproof/)
npm start
```

Once the server is running, open your browser to any of the role dashboards:

| Dashboard | Browser URL | Description |
|---|---|---|
| **Station Launcher** | [`http://localhost:1500`](http://localhost:1500) *(or port 1503 if 1500 is occupied)* | Central access portal linking to all roles |
| **Technician Handheld** | [`http://localhost:1501`](http://localhost:1501) or [`http://localhost:1501/technician`](http://localhost:1501/technician) | NFC card tap, 2FA OTP verification, and procedure checklists |
| **Supervisor Console** | [`http://localhost:1502`](http://localhost:1502) or [`http://localhost:1502/supervisor`](http://localhost:1502/supervisor) | Dispatch new permits, revoke authorization, view live audit log |

> [!TIP]
> Whenever you make modifications to the React code in `frontend/src/`, recompile the bundle using:
> ```bash
> npm run build
> ```

---

### Option 2: Frontend Development with Hot Module Replacement (HMR)

If you are developing the React application and want instant hot-reloading:

1. **Start the backend API server** in one terminal:
   ```bash
   npm start
   ```

2. **Start the Vite dev server** in a second terminal:
   ```bash
   cd frontend
   npm run dev
   ```

3. Open **[`http://localhost:3000`](http://localhost:3000)** in your browser. All `/api/*` requests are automatically proxied to the backend.

---

### Option 3: Single-Port Hosted Deployment (Port 8080)

For containerized or single-port environments (e.g. Docker, cloud staging):

```bash
PORT=8080 npm start
```

Access the endpoints:
- **Supervisor Console**: [`http://localhost:8080/`](http://localhost:8080/) or [`http://localhost:8080/supervisor`](http://localhost:8080/supervisor)
- **Technician Handheld**: [`http://localhost:8080/technician`](http://localhost:8080/technician)
- **Health Check**: [`http://localhost:8080/health`](http://localhost:8080/health)

---

## 🔐 Two-Factor Verification Workflow

1. **Permit Dispatch**: The supervisor dispatches a work order via the Supervisor Console ([`http://localhost:1502`](http://localhost:1502)). The job appears on the technician terminal with status `ASSIGNED`.
2. **Factor 1 (Physical NFC Badge)**: On the Technician Handheld ([`http://localhost:1501`](http://localhost:1501)), click **"SIMULATE NFC TAP"**. The system checks room location and initiates an out-of-band email OTP.
3. **Factor 2 (Out-of-Band OTP)**: Check the simulated dispatch notification on screen, enter the 6-digit passcode into the OTP input field, and click **"VERIFY OTP"**.
4. **Procedure Checklist**: Once verified, the checklist unlocks. Complete all items and submit findings to commit the record to the tamper-evident audit stream.
5. **Supervisor Control**: The supervisor can revoke authorization at any time using the **"REVOKE PERMIT"** button.

---

## 🧪 Testing and Verification

Run the automated test suite covering 2FA OTP flow, IDOR prevention, supervisor-only audit clearance, and SPA serving:

```bash
npm test
```

Build the Docker container:

```bash
docker build -t permitproof .
```

---

## 🌐 FastAPI Linux VM Backend Integration

The React frontend uses relative API endpoints (`/api/state`, `/api/action`, `/api/audit-log`). When pointing the frontend to the Linux VM FastAPI backend:
- In production: Serve the `public/dist/` build files directly through FastAPI (`StaticFiles`) or via Nginx reverse proxy.
- In development: Adjust the Vite proxy target in `frontend/vite.config.ts` to your Linux VM IP address.
