# CorelynStudio

Desktop mission authoring for Corelyn Robotics ROS 2 platforms. Operators build
a mission as a node graph, deploy it to an AMR, and watch node states advance on
the canvas as the robot executes.

Electron shell, React canvas, Go daemon, SQLite. Runs on macOS, Windows, and
Linux; the Linux AppImage is the deployment target.

---

## How it fits together

```
  ┌─────────────────────────────────────────┐
  │ Electron                                │
  │  ┌───────────────┐                      │
  │  │ React (src/)  │  HTTP + WS           │
  │  │  canvas       │ ───────────┐         │
  │  └───────────────┘            │         │
  │                               ▼         │
  │  ┌──────────────────────────────────┐   │
  │  │ corelyn-studiod (Go sidecar)     │   │
  │  │  ephemeral port on 127.0.0.1     │   │
  │  └──────────────────────────────────┘   │
  └───────────────┬──────────────┬──────────┘
                  │              │
             rosbridge v2      SQLite
                  │         (userData/corelyn.db)
                  ▼
        robot  ·or·  corelyn-mockbot
```

**The renderer never talks to a robot.** Every deploy, cancel, and status
message goes through the daemon, which owns the rosbridge connection, the
database, and the one-mission-at-a-time rule. That is what makes DEMO MODE
honest: pointing the daemon at `corelyn-mockbot` instead of a robot exercises
the identical execution path, rather than a second simulator living in the
browser.

The daemon binds an OS-assigned port on loopback only. Electron passes it to the
renderer through `preload.cjs`, so nothing is hardcoded and two copies can run
side by side.

### Node types are defined once

`shared/nodes.json` holds all 24 node types — Flow (2), Motion (6), Navigation
(3), AGV/AMR (6), Control (4), Sensing (3). The React palette and inspector
render from it, and the Go daemon validates deployed missions against it. Adding
a node type is a change to that file, not to either side.

---

## Running it

**Requirements:** Node 20+, Go 1.26+. Linux also needs the GTK/X11/NSS/ALSA
libraries any Electron app needs — a desktop install already has them.

```bash
npm ci
make -C backend dev      # builds corelyn-studiod and corelyn-mockbot
npm run electron:dev
```

`make -C backend dev` is not optional on a fresh clone. The binaries are
gitignored build artefacts, and Electron shows a dialog naming the missing
sidecar rather than an empty window if they are absent.

On first launch the app has no accounts. The signup form claims the install —
that first account becomes admin, and signup then closes. There is no invite
flow yet, so further accounts are a manual `users` insert.

### With a simulated robot

```bash
./backend/corelyn-mockbot -port 9090          # in one shell
CORELYN_ROSBRIDGE_URL=ws://127.0.0.1:9090 npm run electron:dev
```

Without `CORELYN_ROSBRIDGE_URL` the daemon serves its API with no robot
attached: the app runs, but a deploy has nowhere to go. The mockbot speaks real
rosbridge v2 and injects faults through `POST /_fault` — E-Stop, a stalled
robot, and a nominated node failing — so most of the fault matrix in the spec
is testable without hardware. For a link drop, kill the mockbot process; the
daemon turns that into `__mission__/disconnected` within a second.

### Browser only

`npm run dev` serves the UI at :5173 with no Electron and no preload, so the API
client falls back to `http://localhost:8000`. Start the daemon by hand:

```bash
./backend/corelyn-studiod -port 8000 -db /tmp/corelyn.db -rosbridge ws://127.0.0.1:9090
```

The daemon exits when its stdin closes — that is how an orphaned sidecar dies
when Electron is killed hard — so run it in a shell that keeps stdin open.

---

## Tests

```bash
cd backend && go test ./...   # daemon, store, auth, rosbridge, mission sort, mockbot integration
npm run test:e2e              # 19 Playwright tests against real Electron + daemon + mockbot
npm run lint
```

`test:e2e` rebuilds the Go binaries first. It launches `backend/corelyn-studiod`
directly, so a backend change without a rebuild silently tests the previous
daemon.

Seven of the nineteen are pixel baselines guarding the module split — see
`tests/e2e/visual.spec.js`. Snapshots are per-platform and the committed set was
taken on macOS; a first run on Linux or Windows writes its own and fails by
design. Commit those rather than deleting the darwin set.

CI (`.github/workflows/ci.yml`) runs the Go tests, the Playwright suite under
`xvfb`, and a native AppImage build plus `scripts/verify-appimage.sh`, all on
`ubuntu-22.04`. Two things to expect from it:

- **The first `e2e` run fails.** No Linux snapshots exist yet. Download the
  `playwright-snapshots` artifact and commit the `-linux.png` files.
- **`eslint` is advisory and currently red.** It reports the count without
  blocking; making it a gate is a decision for whenever the backlog is cleared.

Baselines generated under `xvfb` are software-rendered. They will not match a
run from a real desktop session on the same machine — the tolerances exist
because of GPU blur and antialiasing, which `xvfb` does not do.

The baselines tolerate 25 differing pixels at a colour distance of 0.02. Neither
number is taste: GPU backdrop-filter blur lands ±1 per channel between runs, and
a one-pixel change to a node's border radius dirties 181 pixels. The budget sits
well below anything a real change produces.

---

## Building

```bash
npm run electron:build:mac      # dmg
npm run electron:build:win      # nsis
make -C backend linux && npm run electron:build:linux   # AppImage
```

The Linux build needs `make -C backend linux` first — that cross-compiles the
sidecar to `backend/dist/`, which `extraResources` copies into the bundle.
`CGO_ENABLED=0` keeps it fully static, so the daemon half of the AppImage needs
nothing installed.

Verify a Linux build on the machine it targets:

```bash
./scripts/verify-appimage.sh
```

Ubuntu 22.04 does not ship `libfuse2`, which type-2 AppImages need to mount
themselves. Install it, or run the image with `--appimage-extract-and-run`.

---

## Layout

```
src/
  canvas/      geometry, node cards, minimap
  palette/     categorised block list
  inspector/   schema-driven param editor
  mission/     run/stop/deploy controls, deploy modal
  shell/       top bar, settings, editor preferences
  log/         system log feed
  api/         the only place the renderer talks to the daemon
  App.jsx      canvas interaction — pan, zoom, marquee, drag, connect

electron/      main process, preload, sidecar lifecycle
backend/
  cmd/corelyn-studiod    the daemon Electron spawns
  cmd/corelyn-mockbot    rosbridge AMR simulator with fault injection
  internal/api           HTTP + status WebSocket
  internal/rosbridge     WebSocket client to the robot
  internal/store         SQLite and migrations
  internal/mission       spec types and topological sort
  internal/auth          argon2id hashing, sessions
shared/nodes.json        node vocabulary, read by both sides
```

`docs/superpowers/specs/` holds the design spec, `docs/superpowers/plans/` the
implementation plan and its definition of done. `docs/design/BAKEOFF.md` is the
v2 redesign comparison — a recommendation, not something applied.

---

## Known gaps

- **Deploy and cancel are allowed without a session.** They are attributed in
  `audit_log` when one is present and recorded with a null user when it is not,
  so an expired token can never be what stops an operator stopping a robot. PRD
  §16 asks for 100% attribution; closing that means requiring auth on those two
  routes.
- **Roles are recorded, not enforced.** Every account can do everything.
- **An AppImage GUI launch has not been verified on real hardware.** The sidecar
  is confirmed static against a bare `ubuntu:22.04`; the Electron half needs a
  desktop session to check.
- **`App.jsx` reports 15 React Compiler memoization warnings.** Pre-existing
  `useCallback`/`useMemo` whose declared dependencies do not match the inferred
  ones. They surfaced when the file shrank enough for the compiler to attempt
  it; fixing them changes when things re-run, so they were left alone.
