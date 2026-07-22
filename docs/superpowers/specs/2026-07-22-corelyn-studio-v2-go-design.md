# CorelynStudio v2 — Go Backend / Electron Shell / SQLite

**Date:** 2026-07-22
**Status:** Approved design, ready for implementation planning
**Scope:** Engineering app — Program & Config panel only, plus a mock robot
**Source PRD:** `CorelynStudio_v2_PRD (1).html` (July 2026, Draft v1.0)

---

## 1. Purpose

Convert CorelynStudio from a React + Electron app talking to a phantom Python
service into a self-contained Ubuntu application: **Go backend, Electron UI
shell, SQLite storage**, shipped as a single AppImage.

The existing JSON mission/telemetry contract is preserved exactly. No robot
hardware is available for validation, so a rosbridge-protocol robot simulator is
a first-class deliverable rather than a test fixture.

### In scope

- Go daemon serving the existing HTTP + WebSocket contract
- SQLite persistence: users, programs, versions, mission runs, audit trail
- Go rosbridge client — the daemon, not the browser, owns robot transport
- `corelyn-mockbot`: standalone rosbridge-protocol AMR simulator with fault injection
- Electron sidecar process model, packaged to AppImage
- Local email/password auth against SQLite; roles recorded but not yet enforced
- Frontend refactor of `src/App.jsx` in place, then a redesign chosen by bake-off

### Out of scope (deferred to later specs)

- Monitor panel: camera stream, 2D LiDAR/occupancy map, telemetry panel, trip playback
- RBAC enforcement across the four PRD §5 roles
- Google OAuth
- Fleet orchestration, multi-tenant cloud, mobile clients (PRD §4 non-goals)

---

## 2. Decisions

Each of these was chosen explicitly during design. Recorded here so the reasoning
survives.

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Scope = Program & Config + mock robot | Smallest slice that proves the Go/SQLite/Electron stack end to end. Camera and LiDAR are exactly the parts that cannot be validated without hardware. |
| D2 | Go owns the rosbridge connection; renderer speaks only to Go | PRD §10.3 "never trust the client". Makes E-Stop and mode interlocks a server-side guarantee. |
| D3 | Local accounts in SQLite, roles stubbed | Works air-gapped, which PRD §14 flags as an unresolved risk for hospital/industrial sites. Role column exists from day one so enforcement is a check, not a migration. |
| D4 | Two UI design tracks, then pick | Team liked the NerdEditor screenshot; open exploration may beat it. Stitch generates real screens for both, so the comparison is of designs rather than descriptions. |
| D5 | Mockbot speaks real rosbridge protocol | The rosbridge layer is the code most likely to be wrong and the least observable. Exercising it over a real socket from day one means hardware day is a URL change. |
| D6 | Electron spawns Go sidecar on an OS-assigned free port | Self-contained AppImage, zero install steps (PRD §10.4 Phase C). No collisions when two instances run. |
| D7 | Refactor `App.jsx` in place first, then restyle | Two passes, but each is independently verifiable: the refactor must not change a single pixel, the restyle must not change behaviour. Different risk profiles. |
| D8 | `shared/nodes.json` as single source of truth for node definitions | Removes a class of drift bug with no codegen step. |
| D9 | Mockbot is a separate binary, not a daemon flag | A daemon flag would short-circuit the rosbridge client in-process and leave it untested. |
| D10 | `roslib` removed from the renderer entirely | Follows from D2. `src/ros/rosBridge.jsx` is deleted, not ported. |

---

## 3. Architecture

```
CorelynStudio.AppImage
│
├── Electron main  (electron/main.cjs)
│     ├── spawns corelyn-studiod on an OS-assigned free port
│     ├── passes the port to the renderer through preload
│     └── terminates the child on quit / crash
│
├── Renderer  (React + Vite)
│     └── http + ws to 127.0.0.1:<port>   — no roslib, no direct robot access
│
└── corelyn-studiod  (Go)
      ├── HTTP API + WebSocket hub
      ├── SQLite  (modernc.org/sqlite — pure Go, no cgo)
      └── rosbridge WebSocket client
            ├──> real robot's rosbridge_suite       (live mode)
            └──> corelyn-mockbot                    (demo mode)
```

`corelyn-mockbot` is built and shipped alongside for development, demos, and CI.

### 3.1 Sidecar lifecycle

1. Electron main asks the OS for a free port by binding `127.0.0.1:0`, then releases it.
2. It spawns `corelyn-studiod --port <n> --db <userData>/corelyn.db`.
3. It waits for `GET /api/health` to return `{"status":"ok"}` before creating the window.
4. The port is exposed to the renderer via `contextBridge` in `preload.cjs`.
5. On `window-all-closed`, `before-quit`, and on main-process crash, the child is
   killed. The daemon also self-terminates if its stdin closes, so an orphan
   cannot survive a hard kill of Electron.

The daemon binds to `127.0.0.1` only. It is never reachable off-host.

### 3.2 AppImage constraints

Two constraints that are cheap now and expensive later:

- **The AppImage mount is read-only.** The SQLite file must live under
  `app.getPath('userData')`, never beside the binary.
- **`extraResources` must preserve the exec bit.** electron-builder does this,
  but the packaged path differs between dev and production and must be resolved
  through `process.resourcesPath` when packaged.

### 3.3 DEMO MODE, redefined

Today `backendOnline === false` means "no backend, simulate the mission inside
the browser" (`src/App.jsx:937`). That path is a second implementation of mission
execution that shares no code with the real one.

Under the new model the backend is always up — it is a sidecar. DEMO MODE now
means **the daemon is connected to `corelyn-mockbot` instead of a robot.** The
badge and the operator-facing behaviour are unchanged, but the demo path now
runs the identical daemon, rosbridge client, and execution code as live. The
in-browser simulator is deleted.

---

## 4. Preserved contract

These three surfaces are consumed by code that already exists and must remain
byte-compatible.

### 4.1 `GET /api/health`

Response `{"status":"ok"}`. Polled every 10 s (`src/App.jsx:1147`) with a 3 s
timeout; drives the DEMO/LIVE indicator.

### 4.2 `POST /api/deploy`

Accepts either a full mission spec (§4.4) or the cancel envelope:

```json
{ "mission_id": "__cancel__", "command": "cancel" }
```

Non-2xx responses carry `{"detail": "<human-readable reason>"}` — the frontend
reads `.detail` and shows it verbatim (`src/App.jsx:926`).

### 4.3 `WS /ws/mission/status`

Server pushes `{"node_id": "...", "status": "..."}`.

- `status` ∈ `running` | `done` | `error` for node IDs
- `node_id: "__mission__"` with `status` ∈ `complete` | `cancelled` ends the run
- Messages missing either field are ignored by the client (`src/App.jsx:1180`)
- The client reconnects after 3 s on close, indefinitely

### 4.4 Mission spec

Emitted today by `generateMissionSpec()` (`src/ros/missionSpec.js:36`). This is
the canonical wire format and the shape stored in SQLite.

```json
{
  "mission_id": "mission_<epoch_ms>_<rand4>",
  "spec_version": "1.0.0",
  "created_at": "<ISO-8601>",
  "robot_requirements": {
    "min_battery_pct": 15,
    "required_capabilities": ["linear_motion", "navigation"]
  },
  "topological_order": ["<node_id>", "..."],
  "nodes": [
    {
      "id": "<node_id>",
      "type": "move_forward",
      "label": "Move Forward",
      "category": "motion",
      "params": { "distance": 1.0, "linear_velocity": 0.5 },
      "position": { "x": 712, "y": 269 }
    }
  ],
  "connections": [
    { "id": "...", "from_node": "...", "from_port": "out",
      "to_node": "...", "to_port": "in" }
  ]
}
```

**Behaviours that must be reproduced exactly, not "improved":**

- `topological_order` uses Kahn's algorithm. **On a cycle it does not error** —
  it appends the unvisited nodes in array order (`missionSpec.js:27`). Graph
  validation is a separate concern layered on top; the serializer stays
  permissive.
- `position` coordinates are rounded to integers.
- `required_capabilities` is derived from a fixed node-type → capability map
  (`missionSpec.js:69`); unmapped types contribute `basic_execution`.

### 4.5 rosbridge topics

| Topic | Direction | Type | Payload |
|---|---|---|---|
| `/mission/deploy` | daemon → robot | `std_msgs/String` | `data` = mission spec JSON, stringified |
| `/mission/status` | robot → daemon | `std_msgs/String` | `data` = `{node_id, status}` JSON, stringified |

The daemon relays `/mission/status` to connected `/ws/mission/status` clients
unchanged, and persists each event to `node_events`.

---

## 5. Shared definitions

`shared/nodes.json` becomes the single source of truth for the 24 node types
currently hardcoded at `src/App.jsx:50`, plus the six categories and their
display metadata.

- Go: `//go:embed shared/nodes.json`, parsed at startup into the validator
- JS: `import nodeDefs from '../shared/nodes.json'`

No codegen and no build step. One file, two readers. Without this, the palette
and the server-side validator drift silently, and a param renamed in one place
produces a mission the daemon rejects for reasons the UI cannot explain.

The file carries, per node type: `type`, `label`, `category`, `icon`, `color`,
`ports[]`, and `params{}` with each param's `label`, `type`
(`number`|`text`|`select`|`boolean`), `default`, and `options[]` where
applicable.

---

## 6. Data model

`modernc.org/sqlite` — pure Go, no cgo, so cross-compiling the AppImage stays
trivial. Migrations are embedded, forward-only, and applied at startup.

| Table | Purpose |
|---|---|
| `users` | id, email, password_hash (argon2id), role, created_at |
| `sessions` | token, user_id, expires_at, created_at |
| `robots` | id, name, platform (C100/C500/C1000), rosbridge_url, is_mock |
| `programs` | id, name, platform, created_by, created_at, updated_at |
| `program_versions` | id, program_id, version, spec_json, author, created_at |
| `mission_runs` | id, program_version_id, robot_id, started_by, started_at, ended_at, result |
| `node_events` | id, mission_run_id, node_id, status, at |
| `audit_log` | id, user_id, action, target, detail_json, at |

Notes:

- Every Deploy writes a `program_versions` row — this is PRD §8.1.5 version
  history, and it makes rollback a read rather than a feature.
- `node_events` persists the status stream, which makes the System Log
  reconstructable after a restart and gives the future Monitor panel its trip
  replay source for free.
- `audit_log` records actor, action, and target for every deploy, cancel, login,
  and logout from day one. PRD §16 asks for 100% attribution of control actions;
  retrofitting an audit trail is far harder than writing to it from the start.
- `robots` exists even though v2 supervises one robot at a time — it holds
  `rosbridge_url`, and PRD §8.3 wants the picker to not require a re-cut later.

---

## 7. Go package layout

```
backend/
  cmd/corelyn-studiod/main.go     daemon entrypoint, flag parsing, wiring
  cmd/corelyn-mockbot/main.go     simulator entrypoint
  internal/api/                   HTTP handlers, WebSocket hub
  internal/auth/                  argon2id hashing, session issue/verify
  internal/store/                 SQLite access, embedded migrations
  internal/mission/               spec types, validation, topological sort
  internal/nodes/                 loads shared/nodes.json, param validation
  internal/rosbridge/             WebSocket client, op framing
  internal/sim/                   AMR kinematics + battery model
shared/
  nodes.json                      node definitions (Go + JS both read this)
  testdata/                       golden mission-spec fixtures
```

`internal/sim` is imported only by `cmd/corelyn-mockbot`. Keeping it out of the
daemon guarantees simulation code cannot execute in a live deployment.

---

## 8. Mock robot

`corelyn-mockbot` implements enough of the rosbridge v2 protocol to be
indistinguishable from `rosbridge_suite` for this application's purposes:
`advertise`, `unadvertise`, `subscribe`, `unsubscribe`, `publish`, and `call_service`
op framing over a WebSocket.

On receiving a mission on `/mission/deploy` it walks `topological_order`,
publishing `running` then `done` per node on `/mission/status`, with per-node
duration derived from that node's params (`wait_delay` honours `duration_ms`;
motion nodes derive duration from distance ÷ velocity). It integrates a simple
pose and drains a battery model so telemetry is plausible rather than constant.

### 8.1 Fault injection

Flags and a control endpoint to force each PRD §10.1 failure mode on demand:

| Fault | Exercises |
|---|---|
| Drop the WebSocket mid-mission | Reconnect with backoff; UI disconnected state within 1 s |
| Fire E-Stop | FAULT state; Run/Deploy locked out until explicitly cleared |
| Fail a specified node | Defined FAULT sub-state naming the failed node; recoverable via Reset |
| Drain battery below threshold | Auto-pause, operator alert |
| Accept deploy while mid-mission | Server-side rejection with an explicit reason, not a silent queue |
| Stall the status stream | Distinguishing "feed lost" from "still running but quiet" |

This is the only mechanism by which the exception matrix gets tested before
hardware exists, which is why it is specified here rather than left to the test
suite.

---

## 9. Testing strategy

No hardware means the test suite is the only safety net. Four layers:

**Contract (highest value).** Capture the exact JSON that today's
`generateMissionSpec()` emits for a set of representative graphs — empty, single
node, linear chain, branch, cycle, all 24 node types — and commit them to
`shared/testdata/`. Assert the Go parser round-trips each unchanged. This turns
"preserve the backend behaviour" into a test that fails loudly, including for the
cycle-handling quirk in §4.4 that a reimplementation would naturally "fix".

**Unit.** Table-driven over spec validation, topological sort, capability
extraction, param type-checking, and auth token lifecycle. Per `golang-testing`.

**Integration.** Daemon + mockbot over a real socket: deploy a mission, assert
the complete status stream arrives in order and lands in `node_events`.

**End-to-end.** Playwright's Electron driver: launch the packaged app, confirm
the sidecar starts, deploy a mission, watch node states advance on the canvas.

**Fault matrix.** Each row of §8.1 gets a test asserting the defined UI state and
recovery path, not merely that an error occurred.

---

## 10. Frontend work

Per D7, in two separable passes.

### Pass 1 — refactor in place, zero visual change

`src/App.jsx` is 2140 lines holding the palette, canvas, inspector, mission
control, and log inline. Split along the boundaries already implicit in the file:

```
src/
  shell/        top bar, panel layout, routing
  canvas/       node rendering, connections, pan/zoom, marquee, gestures
  palette/      categorised searchable node list
  inspector/    schema-driven param editor (currently hardcoded per type)
  mission/      run/stop/deploy controls, CTL tab
  log/          system log feed
  api/          typed client for the Go daemon (replaces scattered fetch calls)
```

Acceptance: screenshots before and after are pixel-identical, and the Playwright
suite passes unchanged. Behaviour changes are out of bounds in this pass.

Also in this pass: delete `src/ros/rosBridge.jsx` and the `roslib` dependency
(D10), delete the in-browser mission simulator (§3.3), and replace
`DEFAULT_API_URL = "http://localhost:8000"` with the port injected via preload.

The schema-driven inspector is called out as an explicit target — PRD §8.1.3
requires it, and it falls out naturally once `shared/nodes.json` exists.

### Pass 2 — redesign bake-off

Two tracks generated with the Stitch MCP, both as complete screens:

- **Track 1 — screenshot-derived.** Adopts the NerdEditor layout the team liked:
  top command bar, `Projects | Blocks` tabbed left palette with search, dotted
  dark canvas, floating bottom bar (filename, Undo/Redo, zoom, fullscreen),
  right-edge view switcher. Verbs map to this domain: `connect / Validate / Stop /
  Run / Deploy / mission.json / Platform selector / Tools`. The right-edge
  switcher reserves the slot for the future Monitor panel.
- **Track 2 — open exploration.** Screenshot as taste reference only; Stitch
  proposes layout freely.

Both produce a Stitch design system and token set. The team picks one; the
winner is applied to the Pass-1 module structure. Losing track is discarded, not
merged.

---

## 11. Sequencing

Two independent tracks run in parallel — design work does not block on the
backend and vice versa.

| | Backend track | Design track |
|---|---|---|
| **A** | Contract capture, golden fixtures, `shared/nodes.json` extraction | Stitch design system + tokens from screenshot |
| **B** | Go daemon: health/deploy/ws + SQLite + mission types | Track 1 screens |
| **C** | rosbridge client + mockbot + fault injection | Track 2 screens |
| **D** | Electron sidecar + AppImage packaging | **Bake-off — team picks** |
| **E** | Auth + programs/versions endpoints | — |
| **F** | Frontend Pass 1 (refactor, zero visual change) | — |
| **G** | Frontend Pass 2 (apply winning design) | |

A is a hard prerequisite for everything — the golden fixtures must be captured
from the current code before that code is touched.

---

## 12. Success criteria

1. Golden contract fixtures round-trip through Go unchanged, cycle quirk included.
2. `npm run electron:dev` starts the sidecar, and a mission deploys and completes
   against `corelyn-mockbot` with node states advancing on the canvas.
3. Every fault in §8.1 produces its defined UI state and recovery path — no
   silent failures, no undefined states (PRD §10.1).
4. Deploy, cancel, login, and logout are each attributable to a specific user in
   `audit_log` (PRD §16).
5. The AppImage runs on a clean Ubuntu machine with no dependencies beyond the
   AppImage runtime, and stores its database under `userData` (PRD §10.4 Phase C).
6. Frontend Pass 1 is pixel-identical to today.
7. Both design tracks are presented as complete screens; one is chosen and applied.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Contract drifts during the port and nobody notices until hardware day | Golden fixtures captured in step A, before any code moves |
| Mockbot diverges from real `rosbridge_suite` behaviour | Implement against the published rosbridge v2 protocol spec, not against our own client |
| Sidecar orphaned when Electron crashes | Daemon self-terminates on stdin close, in addition to explicit kill |
| AppImage read-only mount breaks SQLite writes | Database path resolved through `app.getPath('userData')`; asserted in the E2E test on the packaged build |
| Pass-1 refactor silently changes behaviour | Pixel-identical screenshots plus unchanged Playwright suite as the acceptance gate |
| Bake-off stalls on indecision | Both tracks delivered as complete screens, not sketches, so the comparison is concrete |

---

## 14. Deferred, with the reasons

- **Monitor panel** — camera and LiDAR are the two things that cannot be
  validated without a robot. Building them blind risks discarding the work.
- **RBAC enforcement** — the audit trail and role column land now; enforcement is
  a check added later against data that already exists.
- **Google OAuth** — PRD §14 has not resolved whether target sites are
  air-gapped. Local accounts work either way.
- **Camera transport decision** (compressed-image-over-rosbridge vs WebRTC) —
  PRD §12 spike, needs real network measurements.
