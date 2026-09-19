# AGENTS.md — PermitProof Development & Maintenance Agent Guide

This document defines the system constraints, architecture rules, security boundaries, and operational contexts for AI agents working on the **PermitProof** codebase.

---

## 1. System Overview & Product Boundary

PermitProof is a **verified maintenance authorization engine and resilient IoT evidence pipeline**. 

* **Goal:** Cryptographically bind an authenticated technician, an approved maintenance job, a registered physical asset, and real-time sensory readings into a non-repudiable audit record.
* **Architecture:** Raspberry Pi 5 device station (NFC + Sensors + LEDs) $\leftrightarrow$ Mutual-TLS MQTT / HTTPS $\leftrightarrow$ FastAPI backend + PostgreSQL running inside a Linux VM.
* **Product Boundary:** Maintenance workflow verification and audit trail generation **ONLY**. It is NOT a machine safety interlock, door lock system, or proof of repair physical execution.

---

## 2. Core System Rules & Constraints

### Hardware & Local Operations
1. **Logic Voltages:** Raspberry Pi GPIO operates at **3.3V logic**. Always enforce safety checks for level-shifting (LCDs, Buzzers).
2. **Local Storage:** The Pi uses a **bounded, durable file queue** for offline persistence. Do NOT introduce a local database (e.g., SQLite) on the Pi endpoint.
3. **Hardware State:** Hardware indicators (LEDs/Buzzers) are local indicators, not safety interlocks. Always handle stale software states explicitly during agent startup/shutdown.

### Security & Cryptography
1. **Zero-Trust Keys:** Never trust a public key provided inside an incoming payload envelope as its own proof of identity. Validate public keys against the PostgreSQL registry.
2. **Secret Management:** Private keys (Ed25519, TLS, CA) must **never** be placed in source control, log outputs, telemetry streams, or container images.
3. **NFC Policy:** NFC scans **select assets only**; they never grant permissions directly. Tag possession is not proof of technician presence or approval.
4. **Network Exposure:** Only ports `443` (HTTPS), `8883` (MQTT/TLS), and restricted `22` (SSH) are allowed externally. Port `1883` (unencrypted MQTT) must remain explicitly disabled.

---

## 3. Technology Stack Reference

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Device OS** | 64-bit Raspberry Pi OS | Hardware & systemd process management |
| **Device Agent** | Python 3.11+ | Hardware IO, Ed25519 signing, local queue |
| **Messaging** | Mosquitto + Paho MQTT | Authenticated mTLS bidirectional messaging |
| **Backend** | FastAPI + Verification Worker | Work orders, passkeys, verification, ingestion |
| **Database** | PostgreSQL + SQLAlchemy | Persistent ledger, users, devices, audit trail |
| **Frontend** | React + TypeScript | Supervisor dashboard and job state machine |
| **Reverse Proxy** | Nginx (HTTPS) | Web routing and SSL termination |
| **Authentication** | Passkeys / WebAuthn | Human authentication (Technician & Supervisor) |

---

## 4. Key Workflows & Logic Specs

### A. Authorization Leases & Timing
* **Environmental Sampling:** Every 5 seconds.
* **Heartbeat Interval:** Every 10 seconds.
* **Authorization Lease Duration:** Maximum 30 seconds.
* **Countdown Rule:** Pi uses a monotonic countdown validated against server expiry. Reconnections do not restart a full 30-second lease without fresh server validation.
* **Offline Fallback:** If connection fails or lease expires, active permits auto-suspend and LEDs switch to **Yellow (Degraded)**.

### B. Hardware LED State Matrix
* **Green:** Active, valid authorization lease.
* **Yellow:** Degraded state, waiting, offline buffering, or suspended lease.
* **Red:** Fault, local denial, or signature mismatch.
* **Blue Pulse:** Confirmed receipt commit from PostgreSQL.

### C. Message Schema Envelopes
All device payloads must follow a canonical envelope structure:
```json
{
  "event_id": "UUIDv4",
  "device_id": "string",
  "key_id": "string",
  "asset_id": "string",
  "session_id": "string",
  "boot_id": "string",
  "sequence_number": 12345,
  "observed_at_ms": 1773915524000,
  "clock_status": "synced",
  "schema_version": "1.0",
  "event_type": "telemetry",
  "payload": {},
  "signature": "Ed25519_signature_hex"
}
```

---

## 5. Instructions for Coding & Modifications

When writing code or generating scripts for this repository, agents must adhere to the following guidelines:

* **Database Queries:** Always use parameterized queries via SQLAlchemy migrations. Never construct raw SQL strings with string concatenation.
* **Replay Protection:** Use explicit PostgreSQL uniqueness constraints on `(device_id, event_id)` and transactional deduplication rather than application-level "check-then-insert" logic.
* **Error Handling:** When connection to PostgreSQL or MQTT fails, never send false storage receipts to the device agent.
* **Code Isolation:** Keep the Ingestion Worker (write-only evidence/receipts) strictly separated from the Workflow Service (role/permission management).

---

## 6. Testing & Acceptance Commands

Agents making structural changes should verify functionality against these guidelines:

1. **Replay Rejection:** Ensure resent duplicate payloads return existing receipts without creating secondary database rows.
2. **Signature Tampering:** Verify modified payloads trigger an immediate security rejection and log entry.
3. **Queue Replay:** Test offline file queue flushing to confirm telemetry arrives in order with retained `observed_at_ms` and new `received_at_ms`.