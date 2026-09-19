# AGENTS.md — PermitProof Development & Maintenance Agent Guide

This document defines the current system architecture, workflow, data model, security boundaries, and implementation rules for AI agents working on the **PermitProof** repository.

> **Source of truth:** This guide reflects the latest project information supplied by the PermitProof team, including the current NFC + email OTP workflow and the accompanying system-design whiteboard.
>
> **Important:** Do not reintroduce sensors, buttons, or authentication mechanisms that have been removed from the current design.

---

## 1. Project Overview

**Project:** PermitProof

**MVP Goal:** Build a functional proof-of-concept for cryptographically verifiable maintenance authorization and audit logging across a physical NFC station, a backend server, and a web dashboard.

### Core purpose

PermitProof links:

1. A technician's registered **NFC ID card**
2. A technician's assigned **maintenance job**
3. The physical **asset/station**
4. The local **Raspberry Pi/device**
5. Supervisor authorization
6. A cryptographically verifiable authentication record

The system is primarily an **authorization and audit system**. It is not a physical safety interlock and must not be implemented as an automated door/unlock controller.

---

# 2. Hardware & Sensing Boundary

## NFC-only sensing

The physical station **strictly uses NFC sensing**.

### Hardware

- Raspberry Pi 5
- PN532 NFC reader
- NFC ID cards/tags

### Explicitly excluded sensors

Do **not** implement, reference, or add dependencies for:

- DHT22
  - Temperature
  - Humidity
  - Environmental context
- PIR
  - Motion
  - Nearby activity
- Push buttons
  - Manual sensor events
  - Button-triggered workflows

The physical interaction relevant to technician authentication is the **NFC card tap**.

---

# 3. User Roles

## Supervisor

The supervisor:

- Creates/assigns maintenance jobs.
- Selects or identifies the technician responsible for the job.
- Defines the required tasks.
- Can view relevant job and audit information according to their permissions.

## Technician

The technician:

- Receives an assigned maintenance job.
- Goes to the relevant physical station/asset.
- Taps their registered NFC ID card.
- Completes the second authentication factor using an OTP sent to their registered email.
- Performs the assigned maintenance task.
- Has access only to jobs/resources authorized for their account.

---

# 4. Authentication & Authorization Workflow

## 4.1 Job Assignment

The normal workflow begins when a supervisor creates/assigns a maintenance job.

```text
Supervisor
    ↓
Create / Assign Job
    ↓
Technician receives assigned job
    ↓
Technician goes to physical asset/station
```

A job contains:

- Job ID
- Timestamp
- Supervisor reference
- Technician reference
- Array of assigned tasks
- Completion status

---

## 4.2 Two-Factor Authentication

PermitProof uses **two factors** for technician authentication at the physical station.

### Factor 1 — NFC card

The technician taps their registered NFC ID card on the PN532 reader.

```text
Technician
    ↓
Tap NFC ID Card
    ↓
PN532
    ↓
Raspberry Pi
```

The system reads the card identifier and uses its SHA-256 representation for backend identification.

### Factor 2 — Email OTP

After a valid NFC authentication request:

1. The backend identifies the associated technician.
2. The backend sends a short-lived **OTP to the technician's registered email address**.
3. The technician enters the OTP through the web dashboard.
4. The backend verifies the OTP.
5. A successful verification activates the technician's authorized session/access.

```text
NFC Card Tap
    ↓
Backend validates card
    ↓
Email OTP generated
    ↓
OTP sent to registered email
    ↓
Technician enters OTP
    ↓
Backend verifies OTP
    ↓
Authentication successful
```

### Important

Do not replace the email OTP with:

- A push button
- A second NFC tap
- A DHT22/PIR event
- A generic client-side confirmation

The current second factor is **email OTP**.

---

# 5. Identity Provider

User authentication and identity management use:

**Authentik**

Official project site:

https://goauthentik.io/

Authentik is responsible for user identity/authentication infrastructure and role-based access control where applicable.

Expected roles include:

- `supervisor`
- `technician`

The application must still enforce authorization at the backend/API level. Do not rely solely on frontend role checks.

---

# 6. Cryptographic Identity Model

PermitProof uses hashed identifiers to avoid storing raw card/device identifiers as database identity keys.

## 6.1 Card Identifier

The raw NFC card ID must not be stored as the database identity key.

```text
card_id
   ↓
SHA-256
   ↓
64-character hexadecimal hash
```

This hash is used as the user's identity/index in the relevant table.

## 6.2 Device Identifier

The raw device ID must not be stored as the database identity key.

```text
device_id
   ↓
SHA-256
   ↓
64-character hexadecimal hash
```

This hash is used as the device table's identity/index.

### Hashing requirement

- Algorithm: **SHA-256**
- Output: **64-character hexadecimal string**
- Never use raw card IDs or raw device IDs as database lookup keys.
- Hash identifiers before performing database lookups.

> The database is **not limited to only two columns**. The two identifiers that must be represented as SHA-256 hashes are the **card ID** and **device ID**. Other application data such as user names, emails, roles, room IDs, and jobs are also stored as specified below.

---

# 7. Whiteboard Authentication Protocol

The physical authentication flow includes a challenge/response mechanism between the station/device and the VM/server.

## High-level sequence

```text
NFC Card
    ↓
Read Card ID
    ↓
Device has required key
    ↓
Open authentication request
    ↓
VM / Server sends nonce
    ↓
Device creates authentication package
    ↓
Send package to VM
    ↓
VM verifies HMAC
    ↓
Approve / Reject
```

## Authentication package

The whiteboard specifies a JSON-style package containing values conceptually equivalent to:

```json
{
  "PID": "Hash(device_ID + key)",
  "nonce": "received_nonce",
  "CID": "Hash(card_ID)",
  "HMAC": "HMAC(PID, nonce, CID, key)"
}
```

### Meaning

- `PID` — device-related hashed identity value
- `nonce` — server-generated challenge
- `CID` — hashed NFC card identifier
- `HMAC` — message authentication code generated using the shared secret key

The exact cryptographic implementation must be kept consistent between the Raspberry Pi agent and the verification service.

## Replay protection

The nonce exists to make each authentication request unique and to prevent captured authentication messages from being reused.

The whiteboard specifies an approximately **10-second timeout** for the relevant challenge/authentication exchange.

Do not confuse this with the email OTP's validity period. They are separate mechanisms.

---

# 8. Database Architecture

The current application data model consists of:

- `users`
- `devices`
- `jobs`

The project notes specify SHA-256 hashed identifiers as the relevant table indexes.

## 8.1 Users Table

### Index / primary identity

```text
SHA-256(card_id)
```

Exactly **64 hexadecimal characters**.

### Fields

```text
card_hash       64-character SHA-256 string
full_name       string
email           string
role            string
```

Example roles:

```text
technician
supervisor
```

The user's email is used for the email OTP flow.

---

## 8.2 Devices Table

### Index / primary identity

```text
SHA-256(device_id)
```

Exactly **64 hexadecimal characters**.

### Fields

```text
device_hash    64-character SHA-256 string
room_id        string
```

The device hash represents the local Raspberry Pi/device identity.

---

## 8.3 Jobs Table

### Fields

```text
job_id          unique job identifier
timestamp       job creation/assignment timestamp
supervisor_id   reference to supervisor in users
technician_id   reference to technician in users
tasks           array of strings
is_complete     boolean
```

### Tasks

`tasks` is an array of strings.

Example:

```json
[
  "Inspect equipment",
  "Perform maintenance",
  "Verify operation"
]
```

The backend should serialize/deserialize this field consistently with the selected database implementation.

---

# 9. Audit JSON Log

In addition to the relational database, the system maintains a JSON-based log of system activity.

Each log entry contains:

```json
{
  "timestamp": "2026-09-20T00:12:00Z",
  "device_ref": "64_character_sha256_device_hash",
  "user_ref": "64_character_sha256_card_hash",
  "message": "NFC authentication request processed"
}
```

## Required fields

| Field | Purpose |
|---|---|
| `timestamp` | Time the event occurred |
| `device_ref` | Hash/reference of the device that sent the message |
| `user_ref` | Hash/reference of the user/card that initiated the event |
| `message` | Human-readable description of the event |

### Example events

```text
NFC card detected
NFC authentication request received
Nonce issued
OTP sent
OTP verification successful
OTP verification failed
Authentication rejected
HMAC verification failed
Job accessed
Job completed
```

Do not place raw card IDs or raw device IDs into the JSON audit log.

---

# 10. Technology Stack

The current frontend and backend stack is:

| Component | Technology | Purpose |
|---|---|---|
| **Frontend** | React + TypeScript | Web dashboards, job views, authentication/OTP interface, and user-facing workflows |
| **Identity Provider** | Authentik | User authentication, identity management, and RBAC |
| **Backend** | FastAPI (Python) | API endpoints, authentication/authorization logic, OTP handling, job management, HMAC verification, and audit logging |
| **Database** | SQLite + SQLAlchemy | Primary application datastore for users, devices, and jobs |
| **Hardware** | Raspberry Pi 5 + PN532 NFC Reader | Physical NFC sensing/authentication station |
| **Logging** | JSON File / Stream | Structured audit and interaction logging |
| **Hashing** | SHA-256 | Hashing of NFC card IDs and device IDs |
| **Cryptographic Verification** | HMAC + nonce | Device/message authentication and replay protection |

### Frontend

The frontend uses:

- **React**
- **TypeScript**

Frontend responsibilities include:

- Supervisor dashboard
- Technician dashboard
- Job creation and assignment interfaces
- Job/task views
- NFC authentication status
- Email OTP entry and verification
- Authentication/session state
- Audit-log viewing where permitted

The frontend must **not** contain secrets, shared cryptographic keys, database credentials, or OTP-generation logic.

### Backend

The backend uses:

- **FastAPI**
- **Python**
- **SQLAlchemy**
- **SQLite**

The backend is the authoritative enforcement layer for authentication, authorization, job access, OTP verification, cryptographic verification, and database operations.

### Identity

The identity provider is:

- **Authentik**

Official project site:

https://goauthentik.io/

### Hardware

The physical station uses:

- **Raspberry Pi 5**
- **PN532 NFC reader**
- **NFC ID cards/tags**

No DHT22, PIR, push-button, or other environmental/motion sensors are part of the current MVP.

### Database

The current database technology is:

- **SQLite**
- **SQLAlchemy**

The database stores the application data described in Section 8.

### Logging

System audit events are recorded using structured **JSON logs** as described in Section 9.

### Cryptography

The system uses:

- **SHA-256** for card/device identifier hashing
- **HMAC** for message authentication/integrity
- **Nonce** values for replay protection

---

# 21. Server / Infrastructure Architecture

The whiteboard shows the following major infrastructure components:

```text
                    ┌──────────────────────┐
                    │       SERVER         │
                    │                      │
                    │  ┌───────┐           │
                    │  │  DB   │           │
                    │  └───┬───┘           │
                    │      ↕                │
                    │  ┌───────┐            │
                    │  │  API  │            │
                    │  └───┬───┘            │
                    │      ↕                │
                    │  ┌───────┐            │
                    │  │  VM   │            │
                    │  └───┬───┘            │
                    │      │                │
                    │  ┌───────┐            │
                    │  │  FE   │            │
                    │  └───────┘            │
                    └──────────────────────┘
                            ↕
                    Raspberry Pi / Station
                            ↕
                         PN532
                            ↕
                       NFC Card
```

The exact implementation/deployment relationship between the frontend, API, and VM should be treated as an implementation detail unless explicitly defined elsewhere in the repository.

---

# 21. Frontend Dashboard Requirements

The frontend should reflect the actual PermitProof workflow rather than inventing physical sensor controls.

## Recommended dashboard areas

### Supervisor Dashboard

Display:

- Assigned/created jobs
- Job ID
- Technician
- Assignment timestamp
- Task list
- Completion status
- Relevant audit events
- Device/room association where applicable

Possible actions:

```text
Create Job
Assign Technician
View Job
View Audit Log
```

### Technician Dashboard

Display:

- Assigned jobs
- Job details
- Task checklist
- Authentication status
- OTP verification interface
- Completion status

Authentication UI:

```text
┌─────────────────────────────┐
│ Technician Authentication   │
├─────────────────────────────┤
│ NFC Card: ✓ Detected        │
│                             │
│ OTP sent to registered      │
│ email address               │
│                             │
│ Enter OTP: [______]         │
│                             │
│        [ Verify ]            │
└─────────────────────────────┘
```

Do not create UI controls for:

- Temperature
- Humidity
- Motion
- Environmental monitoring
- Push-button events
- Unrelated sensor telemetry

The dashboard should focus on **jobs, authentication, authorization, devices, and audit records**.

---

# 21. Security Requirements

Agents implementing code must consider the following security concerns.

## SQL Injection (SQLi)

- Never concatenate user-controlled values into SQL statements.
- Use the project's ORM/query parameterization mechanisms.
- Validate and constrain inputs.

## Insecure Direct Object References (IDOR)

Every object access must be authorized server-side.

For example:

```text
Technician A
    ↓
GET /jobs/{job_id}
    ↓
Backend checks:
    Is this job assigned to Technician A?
    ↓
Allow / Deny
```

Never assume that knowing a `job_id` grants access to the job.

## Rate Limiting

Rate-limit security-sensitive endpoints, especially:

- NFC authentication requests
- Email OTP generation
- OTP verification
- Login/authentication endpoints
- Public API endpoints where appropriate

OTP verification must also limit repeated incorrect attempts.

## OWASP Top 10

Use the **OWASP Top 10 (2025)** as a baseline security reference:

https://top10.owasp.org/2025/

At minimum, review implementations for:

- Broken access control
- Cryptographic failures
- Injection
- Authentication failures
- Security misconfiguration
- Vulnerable/outdated components
- Identification/authentication failures
- Logging and monitoring weaknesses

---

# 21. OTP Security

The email OTP is a security-sensitive credential.

Implementation requirements:

- Generate OTPs using a cryptographically secure random source.
- Store only what is necessary to verify the OTP securely.
- Apply a short expiration window.
- Invalidate the OTP after successful use.
- Limit failed verification attempts.
- Rate-limit OTP generation and verification.
- Do not expose the OTP in frontend source code, API responses, logs, or error messages.
- Send the OTP only to the user's registered email address.

The OTP expiration period should be defined centrally by the backend rather than hard-coded into frontend behavior.

---

# 21. API / Backend Rules

The FastAPI backend is the authoritative enforcement layer.

Backend responsibilities include:

- User/job authorization
- NFC authentication processing
- Device identification
- OTP generation and verification
- Job access control
- Job completion updates
- Audit logging
- HMAC verification
- Database operations
- Rate limiting
- Input validation

Never treat frontend validation as sufficient authorization.

---

# 21. Data Handling Rules

### Never store or expose raw identifiers unnecessarily

Avoid storing or returning:

```text
Raw NFC Card ID
Raw Device ID
```

Use:

```text
SHA-256(card_id)
SHA-256(device_id)
```

### Never put secrets into frontend code

Do not expose:

- Shared cryptographic keys
- Backend secrets
- OTP generation secrets
- Database credentials
- Authentik client secrets

### Logging

Logs should contain references/hashes rather than raw identity values.

Do not log:

- OTP values
- Shared private keys
- Raw card IDs
- Raw device IDs
- Database credentials

---

# 21. Implementation Boundaries

Agents must not introduce functionality outside the agreed MVP without explicit project approval.

### Do not add

- DHT22
- PIR
- Push buttons
- Environmental telemetry
- Temperature/humidity monitoring
- Motion monitoring
- Unrelated IoT sensors
- Physical door-lock functionality
- Automated safety interlocks

### Do not replace

- NFC as the physical first authentication factor
- Email OTP as the second authentication factor
- SHA-256 hashed card/device identity references
- Authentik as the identity provider

---

# 21. Terminology

Use these names consistently throughout the codebase and UI:

| Term | Meaning |
|---|---|
| **SV / Server** | Backend/server infrastructure |
| **RPi** | Raspberry Pi 5 station |
| **PN532** | NFC reader |
| **NFC Card** | Technician's physical ID card |
| **VM** | Virtual machine handling the relevant verification/backend process |
| **PID** | Device-related hashed identity value in the authentication package |
| **CID** | SHA-256 hashed card identifier |
| **Nonce** | Server-generated authentication challenge |
| **HMAC** | Message authentication code used to verify authenticity/integrity |
| **OTP** | Email-based second authentication factor |
| **Job** | Assigned maintenance task |
| **Device** | Registered Raspberry Pi/station |
| **Room ID** | Physical room/location associated with a device |

---

# 21. Agent Checklist

Before implementing or modifying a feature, verify:

### Authentication
- [ ] NFC is the first factor.
- [ ] Email OTP is the second factor.
- [ ] Authentik remains the identity provider.
- [ ] OTPs are rate-limited and expire.
- [ ] OTPs are never exposed in logs/responses.

### Hardware
- [ ] Only PN532/NFC sensing is required.
- [ ] No DHT22 dependency.
- [ ] No PIR dependency.
- [ ] No push-button dependency.

### Identity
- [ ] Card IDs are represented using SHA-256 hashes.
- [ ] Device IDs are represented using SHA-256 hashes.
- [ ] Hashes are exactly 64 hexadecimal characters.
- [ ] Raw identifiers are not unnecessarily stored or logged.

### Authorization
- [ ] Backend enforces role/object-level authorization.
- [ ] Technicians can only access their assigned jobs.
- [ ] Supervisor-only operations are protected server-side.
- [ ] Never trust frontend-only access checks.

### Database
- [ ] `users` contains name, email, role, and card hash.
- [ ] `devices` contains device hash and room ID.
- [ ] `jobs` contains job ID, timestamp, supervisor reference, technician reference, tasks, and completion status.

### Audit Log
- [ ] Log contains timestamp.
- [ ] Log contains device reference.
- [ ] Log contains user reference.
- [ ] Log contains event message.
- [ ] Raw credentials/secrets are never logged.

### Security
- [ ] SQLi defenses are present.
- [ ] IDOR defenses are present.
- [ ] Rate limiting is present on security-sensitive endpoints.
- [ ] OWASP Top 10 (2025) considerations are applied.

---

# 21. Current MVP Flow — Quick Reference

```text
                    SUPERVISOR
                        │
                        │ Assign Job
                        ▼
                  ┌─────────────┐
                  │    SERVER   │
                  └──────┬──────┘
                         │
                  Job assigned
                         │
                         ▼
                    TECHNICIAN
                         │
                         │ Goes to station
                         ▼
                   ┌───────────┐
                   │   PN532   │
                   │ NFC Reader│
                   └─────┬─────┘
                         │
                    NFC Card Tap
                         │
                         ▼
                    RASPBERRY PI
                         │
                         │ Authentication request
                         ▼
                  ┌─────────────┐
                  │ SERVER / VM │
                  └──────┬──────┘
                         │
                  Validate card
                         │
                  Generate OTP
                         │
                         ▼
                Technician's Email
                         │
                     Enter OTP
                         │
                         ▼
                  ┌─────────────┐
                  │   SERVER    │
                  │ Verify OTP  │
                  └──────┬──────┘
                         │
                    Authenticated
                         │
                         ▼
                  Technician can
                  access assigned job
                         │
                         ▼
                    Complete Tasks
                         │
                         ▼
                    JSON Audit Log
```

---

## 21. Important Design Distinction

There are **two different cryptographic/verification concepts** in the current design:

1. **NFC + email OTP** — the technician's two-factor authentication workflow.
2. **Nonce + HMAC + hashed identifiers** — the cryptographic device/message verification mechanism shown on the system-design whiteboard.

Agents should not collapse these into a single mechanism. They serve different purposes within the system.

