# PermitProof

PermitProof is a *public interaction prototype* for server-room maintenance workflows. Supervisor-created work orders appear immediately in the technician view. A simulated NFC tap changes the task to **Waiting for verification** on both dashboards. After a short simulated verification delay, the task becomes **Verification done**, room access lights up, and the technician checklist unlocks. No second supervisor approval is required.

## Run

Use Node.js 18 or newer. Run `npm start` with no install step. The local launcher is at `http://localhost:1500`, the technician view at port 1501, and the supervisor view at port 1502. If port 1500 is occupied, the launcher uses port 1503.

For a single-port deployment, set `PORT=8080` and run `npm start`. The supervisor dashboard opens at `/`, the technician view is at `/technician/`, and the health endpoint is at `/health`.

Run `npm test` for workflow and HTTP route checks. Build the container with `docker build -t permitproof .`.

## Demo limits

There is no authentication, real NFC verification, Raspberry Pi connection, or live occupancy proof. The timed verification result is only a UI simulation; replace it with an authenticated result from the real verifier before any actual access decision. All visitors to one running instance share the same in-memory demo state, which resets on restart. Do not enter real operational data or use this prototype to control access.
