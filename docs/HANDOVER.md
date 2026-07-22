# Handover — state as of 2026-07-23

For any agent or developer picking this repo up. Read README.md first for architecture; this file covers current branch state, recent work, and open threads.

## Repo in one paragraph
Corelyn Studio: Electron shell (`electron/`) spawns a Go daemon (`backend/`, binary `corelyn-studiod`) on an ephemeral loopback port; the React 19 renderer (`src/`, Vite) talks HTTP/WS to the daemon only; the daemon owns the rosbridge link to a robot or to `corelyn-mockbot` (fake robot, same protocol). SQLite via the daemon. E2E = Playwright driving the real Electron app (`tests/e2e/`, 23 tests incl. 7 pixel baselines at 1440×872, darwin only). Go suite covers all `internal/` packages (race-clean).

## Branch state
`feature/nerdeditor-dashboard-redesign` — NOT pushed. Two completed, review-approved features sit on it beyond origin:

### 1. No-robot deploy honesty (9cd6160..3f3aecb)
- `POST /api/deploy` → `"status":"deployed_no_robot"` when daemon has no rosbridge configured; the run row is closed (`result:"no_robot"`) and `s.active` cleared so redeploys aren't blocked.
- `GET /api/health` → `{"status":"ok","robot":"none"|"connected"|"disconnected"}` (live link state).
- Both frontend deploy paths (modal + toolbar Run) show an amber warning + system-log line + toast instead of claiming success; button label is "Deploy via ROS" only when `robot=="connected"`.
- Exact contract strings are asserted byte-for-byte by `tests/e2e/chain.spec.js` — change them in ALL places (deploy.go, DeployModal.jsx, App.jsx runMission, chain.spec.js) or tests fail.
- Robot-configured-but-link-down deploys fail hard with 503 (pre-existing, verified honest).

### 2. Responsive UI (23e55e0..08cd470)
- Spec + accepted deviations: `docs/superpowers/specs/2026-07-22-responsive-ui-design.md`.
- Breakpoints via `src/shell/useBreakpoint.js`: `isCompact` <1200px (labels drop to icons, tagline hidden, telemetry compacts), `isNarrow` <1000px (⋯ overflow menu holds Clear/Export/Import/CHAIN/telemetry; Run/Stop/Deploy stay; both side panels become overlay drawers, one-at-a-time, backdrop closes, `inert` when closed).
- Electron floor 700×550 (`electron/main.cjs`).
- z-index scheme (commented in code): backdrop 200 < topbar/chevron 250 < drawers 300 < overflow menu 400 < modal 500 < settings 850.
- HARD CONSTRAINT honored throughout: 1440×872 visual baselines were never regenerated — everything is gated behind media queries / boolean flags false at that size. Keep it that way or knowingly regen baselines.
- `tests/e2e/responsive.spec.js` pins 700×550, ~980, 1100 (compact no-clip), and 1440 layouts.

## How to verify anything
```bash
cd backend && go test ./... -count=1        # Go suite (add -race for the full check)
make -C backend dev                          # rebuild daemon+mockbot (REQUIRED after backend changes — Playwright uses these binaries)
npx vite build && npx playwright test        # full e2e, 23 tests
npm run lint                                 # KNOWN RED: 49 errors/6 warnings baseline (hooks strictness + dead imports). CI treats as advisory. Do not add new ones.
```
Run with fake robot: `./backend/corelyn-mockbot -port 9090` then `CORELYN_ROSBRIDGE_URL=ws://127.0.0.1:9090 npm run electron:dev`.

## Open threads (known, deliberately not done)
Security (from a full-repo audit, all confirmed real):
- Deploy/cancel and program/version read endpoints require NO auth — any local process can command the robot or read mission specs. Biggest known gap.
- CORS + WS origins admit any `localhost:*` page. No CSP in the renderer.

Product/UX follow-ups:
- Deploy button shows "Deploy (no robot)" both when robot is disconnected and when never configured; also reads that way when the daemon itself is offline — a three-way label ("Backend offline") was recommended.
- Legacy 1023/1024px CSS tier (minimap hidden, mobile paddings) should migrate to the 999/1000 breakpoint next time baselines are regenerated — crossing 999→1024 currently shows two visual steps.
- Signup collects a `name` field that is silently discarded (no backend column). Google/LinkedIn auth buttons are decorative. Session token is memory-only; `GET /api/auth/session` exists but is never called → reload logs you out.
- chainMode button style object duplicated in toolbar + overflow menu (extract when touched a third time).

Test gaps that remain: param editing → deployed spec, mission save/load, CTL pause/stop actions, rosbridge reconnect (drop is covered, recovery isn't), logout.

## Process artifacts
- `.superpowers/sdd/progress.md` — task ledger for the two features (git-ignored scratch; commits named there are the source of truth).
- Review diffs in `.superpowers/sdd/review-*.diff` (scratch, regenerable).

## Sibling repo
`~/Desktop/corelyn-web` — separate repo for the download website + Dokploy/Mongo/Redis deployment stack. Its own `CLAUDE.md` is the spec/handover there. Only coupling to this repo: install scripts fetch binaries from this repo's future GitHub Releases. Never edit that repo from sessions here or vice versa.
