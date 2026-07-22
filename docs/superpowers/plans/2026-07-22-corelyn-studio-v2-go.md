# CorelynStudio v2 — Go/Electron/SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert CorelynStudio into a self-contained Ubuntu AppImage — Go backend, Electron shell, SQLite storage — preserving the existing JSON mission contract exactly, validated entirely against a rosbridge-protocol mock robot.

**Architecture:** Electron main spawns a Go daemon (`corelyn-studiod`) as a sidecar on an OS-assigned free port. The daemon serves the existing HTTP+WS contract, persists to SQLite, and owns the rosbridge WebSocket to the robot. A second Go binary (`corelyn-mockbot`) implements the rosbridge protocol plus an AMR simulator with fault injection, so every failure mode is testable with no hardware.

**Tech Stack:** Go 1.26, `modernc.org/sqlite` (pure Go, no cgo), `nhooyr.io/websocket`, `golang.org/x/crypto/argon2`, Electron 33, React 19, Vite 8, Playwright (Electron driver), electron-builder → AppImage.

**Spec:** `docs/superpowers/specs/2026-07-22-corelyn-studio-v2-go-design.md`

## Global Constraints

- **Contract is frozen.** `GET /api/health` → `{"status":"ok"}`. `POST /api/deploy` accepts a mission spec or `{"mission_id":"__cancel__","command":"cancel"}`, errors as `{"detail":"..."}`. `WS /ws/mission/status` pushes `{"node_id","status"}`. No field may be renamed, added as required, or removed.
- **`spec_version` stays `"1.0.0"`.** Any change to the mission spec shape is out of scope for this plan.
- **No cgo.** Every Go dependency must build with `CGO_ENABLED=0`. This is what keeps AppImage cross-compilation trivial; `mattn/go-sqlite3` is therefore banned.
- **Daemon binds `127.0.0.1` only.** Never `0.0.0.0`.
- **SQLite lives under `app.getPath('userData')`.** The AppImage mount is read-only.
- **`internal/sim` is imported only by `cmd/corelyn-mockbot`.** Simulation code must not be reachable from the daemon binary.
- **Topological sort must not error on cycles.** It appends unvisited nodes in array order. See Task A1.
- **Go errors wrap with `%w`**; check with `errors.Is`/`errors.As`. Per the `golang-error-handling` skill.
- **Tests are table-driven** per the `golang-testing` skill.
- Node positions serialize as **rounded integers**.

---

## File Structure

```
shared/
  nodes.json                    24 node defs + 6 categories — Go and JS both read this
  testdata/*.json               golden mission-spec fixtures

backend/
  go.mod
  cmd/corelyn-studiod/main.go   daemon entrypoint
  cmd/corelyn-mockbot/main.go   simulator entrypoint
  internal/nodes/nodes.go       embeds shared/nodes.json, param validation
  internal/mission/spec.go      spec types + JSON round-trip
  internal/mission/sort.go      topological sort (port of missionSpec.js)
  internal/mission/validate.go  graph validation
  internal/store/store.go       SQLite open/migrate
  internal/store/migrations/    embedded .sql, forward-only
  internal/store/queries.go     typed accessors
  internal/auth/auth.go         argon2id + sessions
  internal/rosbridge/client.go  rosbridge v2 WS client
  internal/api/server.go        routing, middleware
  internal/api/health.go        GET /api/health
  internal/api/deploy.go        POST /api/deploy
  internal/api/status_ws.go     WS /ws/mission/status hub
  internal/api/auth_http.go     login/logout/session
  internal/api/programs.go      programs + versions
  internal/sim/amr.go           kinematics + battery (mockbot only)
  internal/sim/faults.go        fault injection

electron/
  main.cjs                      + sidecar lifecycle
  sidecar.cjs                   spawn, health-wait, teardown
  preload.cjs                   + exposes apiPort

src/
  api/client.js                 typed client for the daemon
  shell/ canvas/ palette/ inspector/ mission/ log/    (Task D2 split)

tests/e2e/                      Playwright Electron specs
docs/design/                    Stitch bake-off output
```

---

## Model Tiering

Each task is annotated **[haiku]**, **[sonnet]**, or **[opus]**. Dispatch the named tier.

- **haiku** — mechanical, fully specified, no judgement: migrations, struct definitions, boilerplate handlers, file moves.
- **sonnet** — the default for implementation.
- **opus** — contract preservation, safety interlocks, and the design bake-off, where a plausible-but-wrong answer is expensive and hard to detect.

---

## Track A — Foundation (blocks everything)

### Task A1: Capture golden contract fixtures **[opus]**

The single most important task in the plan. These fixtures are the only thing standing between "we ported it" and "we ported it correctly." They must be captured from the **current** code before anything is touched.

**Files:**
- Create: `shared/testdata/gen_fixtures.mjs`
- Create: `shared/testdata/*.json` (generated)

**Interfaces:**
- Produces: fixture JSON files consumed by Task B1's round-trip test.

- [ ] **Step 1: Write the generator**

Import the *real* `generateMissionSpec` from `src/ros/missionSpec.js` and the real `NODE_DEFS` from `src/App.jsx`. Do not reimplement either — the point is to capture what today's code actually does.

`NODE_DEFS` is not exported. Extract it by reading `src/App.jsx`, slicing the `const NODE_DEFS = [` … `];` literal (lines 50–86), and `eval`-ing that slice in the generator. This is deliberate: it guarantees the fixture reflects the shipped array rather than a hand-copied one.

Graphs to capture, one file each:
| File | Graph |
|---|---|
| `empty.json` | no nodes, no connections |
| `single_start.json` | one `start` node |
| `linear_chain.json` | start → move_forward → rotate_left → end |
| `branch.json` | `check_battery` fanning to two branches via `ok` and `low` ports |
| `cycle.json` | A → B → C → A, plus a disconnected D |
| `all_node_types.json` | one of each of the 24 types, unconnected |

`mission_id` and `created_at` are nondeterministic. The generator must stub `Date.now`, `Math.random`, and `Date.prototype.toISOString` to fixed values before calling, so fixtures are byte-stable and diffable.

- [ ] **Step 2: Generate and eyeball**

Run: `node shared/testdata/gen_fixtures.mjs`
Expected: 6 files written.

Verify by hand in `cycle.json` that `topological_order` contains **all four** node IDs — the three-cycle members appended after the reachable ones. If it errored or dropped nodes, the generator is wrong, not the source.

- [ ] **Step 3: Assert stability**

Run the generator twice, `git diff` must be empty. Byte-unstable fixtures are useless as a regression gate.

- [ ] **Step 4: Commit**

```bash
git add shared/testdata/
git commit -m "test: capture golden mission-spec fixtures from v1 implementation"
```

---

### Task A2: Extract `shared/nodes.json` **[sonnet]**

**Files:**
- Create: `shared/nodes.json`
- Modify: `src/App.jsx:50-105` — replace the literals with an import

**Interfaces:**
- Produces: `{ categories: [...], nodes: [...] }`. Each node: `type`, `label`, `category`, `icon`, `color`, `ports[]`, `params{}`. Each param: `label`, `type` (`number`|`text`|`select`|`boolean`), `default`, optional `options[]`.

- [ ] **Step 1: Extract mechanically**

Move `NODE_DEFS` (24 entries), `CATEGORY_ORDER`, and `CATEGORY_META` into `shared/nodes.json`. Preserve key order and every value exactly — this file must produce identical output through `generateMissionSpec`.

- [ ] **Step 2: Import in JS**

```js
import nodeData from "../shared/nodes.json";
const NODE_DEFS = nodeData.nodes;
const CATEGORY_ORDER = nodeData.categories.map(c => c.id);
const CATEGORY_META = Object.fromEntries(nodeData.categories.map(c => [c.id, { label: c.label, color: c.color }]));
```

Vite resolves JSON imports natively — no loader config needed. Confirm `vite.config.js` does not restrict `fs.allow` in a way that blocks `../shared`; if it does, add the repo root.

- [ ] **Step 3: Prove nothing changed**

Re-run `node shared/testdata/gen_fixtures.mjs`. `git diff shared/testdata/` **must be empty.** A non-empty diff means the extraction altered a value — fix the JSON, do not re-baseline the fixtures.

- [ ] **Step 4: Commit**

```bash
git add shared/nodes.json src/App.jsx
git commit -m "refactor: extract node definitions to shared/nodes.json"
```

---

## Track B — Go backend

### Task B1: Module scaffold, mission types, topological sort **[opus]**

**Files:**
- Create: `backend/go.mod`, `backend/internal/mission/spec.go`, `sort.go`, `spec_test.go`, `sort_test.go`
- Create: `backend/internal/nodes/nodes.go`, `nodes_test.go`

**Interfaces:**
- Produces:
  ```go
  type Spec struct {
      MissionID         string            `json:"mission_id"`
      SpecVersion       string            `json:"spec_version"`
      CreatedAt         string            `json:"created_at"`
      RobotRequirements RobotRequirements `json:"robot_requirements"`
      TopologicalOrder  []string          `json:"topological_order"`
      Nodes             []Node            `json:"nodes"`
      Connections       []Connection      `json:"connections"`
  }
  func TopologicalSort(nodes []Node, conns []Connection) []string
  func (s *Spec) Validate(defs *nodes.Defs) []ValidationError
  func nodes.Load() (*Defs, error)   // //go:embed ../../../shared/nodes.json
  ```

- [ ] **Step 1: Write the failing round-trip test**

```go
func TestGoldenFixturesRoundTrip(t *testing.T) {
    files, err := filepath.Glob("../../../shared/testdata/*.json")
    if err != nil || len(files) == 0 {
        t.Fatalf("no fixtures found: %v", err)
    }
    for _, f := range files {
        t.Run(filepath.Base(f), func(t *testing.T) {
            original, err := os.ReadFile(f)
            if err != nil { t.Fatal(err) }

            var spec mission.Spec
            if err := json.Unmarshal(original, &spec); err != nil {
                t.Fatalf("unmarshal: %v", err)
            }
            got, err := json.Marshal(&spec)
            if err != nil { t.Fatal(err) }

            // Compare semantically — key order and whitespace are not contract.
            var a, b any
            _ = json.Unmarshal(original, &a)
            _ = json.Unmarshal(got, &b)
            if !reflect.DeepEqual(a, b) {
                t.Errorf("round-trip altered the spec\n orig: %s\n  got: %s", original, got)
            }
        })
    }
}
```

`params` must be `map[string]any` — params are heterogeneous per node type and a typed struct would silently drop unknown keys, which is exactly the drift this test exists to catch.

- [ ] **Step 2: Run it, watch it fail**

Run: `cd backend && go test ./internal/mission/ -run TestGoldenFixturesRoundTrip -v`
Expected: FAIL — package doesn't exist yet.

- [ ] **Step 3: Implement `Spec` and friends**

Define the structs to match §4.4 of the spec exactly. `Position` uses `int` for `x`/`y` (values are pre-rounded by the JS side).

- [ ] **Step 4: Port the topological sort — preserving the cycle quirk**

```go
// TopologicalSort orders nodes by dependency using Kahn's algorithm.
//
// On a cycle it deliberately does NOT error: unvisited nodes are appended in
// their original array order. This mirrors missionSpec.js:27 and is asserted by
// the cycle.json golden fixture. Graph validation is a separate concern — the
// serializer stays permissive. Do not "fix" this.
func TopologicalSort(nodes []Node, conns []Connection) []string {
    adj := make(map[string][]string, len(nodes))
    inDeg := make(map[string]int, len(nodes))
    for _, n := range nodes {
        adj[n.ID] = nil
        inDeg[n.ID] = 0
    }
    for _, c := range conns {
        if _, ok := adj[c.ToNode]; !ok { continue } // matches JS guard
        adj[c.FromNode] = append(adj[c.FromNode], c.ToNode)
        inDeg[c.ToNode]++
    }

    queue := make([]string, 0, len(nodes))
    for _, n := range nodes {          // array order, not map order — determinism
        if inDeg[n.ID] == 0 { queue = append(queue, n.ID) }
    }

    order := make([]string, 0, len(nodes))
    seen := make(map[string]bool, len(nodes))
    for len(queue) > 0 {
        id := queue[0]
        queue = queue[1:]
        order = append(order, id)
        seen[id] = true
        for _, nb := range adj[id] {
            inDeg[nb]--
            if inDeg[nb] == 0 { queue = append(queue, nb) }
        }
    }
    for _, n := range nodes {
        if !seen[n.ID] { order = append(order, n.ID) }
    }
    return order
}
```

Iterating `nodes` rather than the maps is load-bearing: Go randomizes map iteration, and the JS original walks the array. Without this the output is nondeterministic and the fixture test flakes.

- [ ] **Step 5: Table-driven sort test**

Cases: empty; single; linear chain; diamond; pure cycle (asserts all IDs present); cycle plus disconnected node; connection referencing an unknown `to_node` (must be skipped, not panic).

- [ ] **Step 6: Node defs loader**

`//go:embed` the shared JSON; parse into `Defs` with lookup by type; expose `ValidateParams(nodeType string, params map[string]any) []ValidationError` checking presence and type against the schema.

- [ ] **Step 7: All green**

Run: `cd backend && go test ./... -v`
Expected: PASS, including all 6 fixtures.

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat(backend): mission spec types and contract-preserving topological sort"
```

---

### Task B2: SQLite store and migrations **[haiku]**

**Files:**
- Create: `backend/internal/store/store.go`, `queries.go`, `store_test.go`
- Create: `backend/internal/store/migrations/001_init.sql`

**Interfaces:**
- Produces: `store.Open(path string) (*Store, error)` (runs migrations), `(*Store) Close() error`, plus typed accessors added by later tasks.

- [ ] **Step 1: Write `001_init.sql`**

Eight tables per spec §6: `users`, `sessions`, `robots`, `programs`, `program_versions`, `mission_runs`, `node_events`, `audit_log`. Foreign keys declared. Indexes on `sessions.token`, `node_events.mission_run_id`, `audit_log.at`.

- [ ] **Step 2: Write the failing test**

```go
func TestOpenCreatesSchema(t *testing.T) {
    dir := t.TempDir()
    s, err := store.Open(filepath.Join(dir, "test.db"))
    if err != nil { t.Fatal(err) }
    defer s.Close()

    want := []string{"users","sessions","robots","programs","program_versions","mission_runs","node_events","audit_log"}
    for _, table := range want {
        var n int
        err := s.DB().QueryRow(
            `SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, table,
        ).Scan(&n)
        if err != nil || n != 1 {
            t.Errorf("table %q: count=%d err=%v", table, n, err)
        }
    }
}

func TestOpenIsIdempotent(t *testing.T) {
    p := filepath.Join(t.TempDir(), "test.db")
    for i := 0; i < 3; i++ {
        s, err := store.Open(p)
        if err != nil { t.Fatalf("open %d: %v", i, err) }
        s.Close()
    }
}
```

- [ ] **Step 3: Run, expect FAIL**

Run: `cd backend && go test ./internal/store/ -v`

- [ ] **Step 4: Implement**

`//go:embed migrations/*.sql`, applied in lexical order inside a transaction, tracked in a `schema_migrations` table. Enable `PRAGMA foreign_keys=ON` and `PRAGMA journal_mode=WAL` on open.

- [ ] **Step 5: Green, then commit**

```bash
cd backend && go test ./internal/store/ -v
git add backend/internal/store/ && git commit -m "feat(backend): SQLite store with embedded migrations"
```

---

### Task B3: HTTP API — health, deploy, status WebSocket **[sonnet]**

**Files:**
- Create: `backend/internal/api/server.go`, `health.go`, `deploy.go`, `status_ws.go`, and `*_test.go`
- Create: `backend/cmd/corelyn-studiod/main.go`

**Interfaces:**
- Consumes: `mission.Spec`, `store.Store`, `nodes.Defs` from B1/B2.
- Produces: `api.New(deps Deps) *api.Server`; `(*Server) Broadcast(nodeID, status string)` used by B4.

- [ ] **Step 1: Write contract tests first**

```go
func TestHealth(t *testing.T) {
    srv := newTestServer(t)
    rec := httptest.NewRecorder()
    srv.ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))

    if rec.Code != 200 { t.Fatalf("status = %d", rec.Code) }
    var got map[string]string
    json.Unmarshal(rec.Body.Bytes(), &got)
    if got["status"] != "ok" {
        t.Errorf(`body = %q, want {"status":"ok"}`, rec.Body.String())
    }
}

func TestDeployCancelEnvelope(t *testing.T) {
    srv := newTestServer(t)
    body := `{"mission_id":"__cancel__","command":"cancel"}`
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    srv.ServeHTTP(rec, req)
    if rec.Code != 200 { t.Fatalf("cancel rejected: %d %s", rec.Code, rec.Body) }
}

func TestDeployErrorUsesDetailKey(t *testing.T) {
    srv := newTestServer(t)
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(`{"nope":`))
    srv.ServeHTTP(rec, req)
    if rec.Code < 400 { t.Fatal("malformed body should fail") }
    var got map[string]any
    json.Unmarshal(rec.Body.Bytes(), &got)
    if _, ok := got["detail"]; !ok {
        t.Errorf(`error body = %s, want a "detail" key`, rec.Body.String())
    }
}
```

The `detail` test matters more than it looks: `src/App.jsx:926` reads `.detail` and shows it to the operator. Any other key renders "Deploy failed" with no reason.

- [ ] **Step 2: Run, expect FAIL. Step 3: Implement handlers.**

Deploy logic: parse body → if `mission_id == "__cancel__"` cancel the active run and return 200 → else validate against `nodes.Defs`, reject with 400 + `detail` naming the offending node and field → persist a `program_versions` row → create a `mission_runs` row → hand to the rosbridge client → 200.

Reject with an explicit `detail` when a mission is already running (spec §10.1 "Deploy sent to a robot mid-mission → blocked with explicit reason, not queued silently").

- [ ] **Step 4: WebSocket hub**

`/ws/mission/status`. Hub holds a `map[*conn]struct{}` behind a mutex; `Broadcast` marshals `{"node_id","status"}` and writes to every client, dropping any that errors. Per-client send buffer of 64; on overflow close that client rather than blocking the hub — a stalled UI must never wedge mission execution.

Test with a real `httptest.NewServer` and a real WS client: connect, broadcast, assert the exact JSON arrives.

- [ ] **Step 5: `main.go`**

Flags: `--port` (required), `--db` (required), `--rosbridge` (URL, optional). Bind `127.0.0.1:<port>`. Graceful shutdown on SIGINT/SIGTERM **and on stdin EOF** — the latter is how an orphaned sidecar dies when Electron is killed hard.

- [ ] **Step 6: Green, then commit**

```bash
cd backend && go test ./... -v
git add backend/ && git commit -m "feat(backend): HTTP API and mission status WebSocket"
```

---

### Task B4: rosbridge client **[sonnet]**

**Files:**
- Create: `backend/internal/rosbridge/client.go`, `client_test.go`

**Interfaces:**
- Produces:
  ```go
  func New(url string) *Client
  func (c *Client) Connect(ctx context.Context) error   // reconnects with backoff
  func (c *Client) Publish(topic, msgType string, msg any) error
  func (c *Client) Subscribe(topic, msgType string, fn func(json.RawMessage)) error
  func (c *Client) State() ConnState                    // Disconnected|Connecting|Connected
  ```

- [ ] **Step 1: Test against a fake rosbridge server**

Stand up an `httptest` WS server that records received op frames. Assert the client emits rosbridge v2 framing:

```json
{"op":"advertise","topic":"/mission/deploy","type":"std_msgs/String"}
{"op":"publish","topic":"/mission/deploy","msg":{"data":"<stringified spec>"}}
{"op":"subscribe","topic":"/mission/status","type":"std_msgs/String"}
```

The mission spec is **stringified into `msg.data`**, not nested as an object — `std_msgs/String` has exactly one field. Getting this wrong is invisible until hardware day.

- [ ] **Step 2: Reconnect test**

Kill the server mid-session; assert the client retries with exponential backoff (250ms → 4s cap) and `State()` reports `Disconnected` within 1s, per spec §10.1.

- [ ] **Step 3: Implement. Step 4: Wire into deploy**

Publish on `/mission/deploy`; subscribe `/mission/status`, unwrap `msg.data`, parse `{node_id,status}`, persist to `node_events`, and `Broadcast` to WS clients unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/rosbridge/ && git commit -m "feat(backend): rosbridge v2 websocket client"
```

---

### Task B5: `corelyn-mockbot` **[sonnet]**

**Files:**
- Create: `backend/cmd/corelyn-mockbot/main.go`
- Create: `backend/internal/sim/amr.go`, `faults.go`, `amr_test.go`

- [ ] **Step 1: rosbridge server side**

Accept WS connections; handle `advertise`, `unadvertise`, `subscribe`, `unsubscribe`, `publish`. Maintain per-topic subscriber sets. Implement against the published rosbridge v2 protocol, **not** against our client — implementing it against our own client would make both wrong together.

- [ ] **Step 2: Mission execution**

On `/mission/deploy`: parse `msg.data`, walk `topological_order`, publish `running` then `done` per node on `/mission/status`, finishing with `{"node_id":"__mission__","status":"complete"}`.

Per-node duration: `wait_delay` honours `duration_ms`; motion nodes use `distance ÷ linear_velocity` seconds; everything else 800ms. A `--speed` multiplier keeps tests fast.

- [ ] **Step 3: AMR simulation**

Integrate pose from motion nodes, drain battery over time and distance, expose speed. Unit-test the kinematics directly — a 1m move at 0.5 m/s advances x by 1.0 (±1e-6) and takes 2s of simulated time.

- [ ] **Step 4: Fault injection**

`POST /_fault` on the mockbot's own control port:

| Body | Effect |
|---|---|
| `{"fault":"disconnect"}` | close all WS connections immediately |
| `{"fault":"estop"}` | publish `__mission__`/`estop`, halt, refuse deploys until `{"fault":"clear"}` |
| `{"fault":"node_error","node_id":"x"}` | publish `error` for that node, abort the run |
| `{"fault":"battery","pct":5}` | force battery level |
| `{"fault":"stall"}` | stop publishing without closing the socket |
| `{"fault":"clear"}` | reset to healthy |

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/corelyn-mockbot backend/internal/sim && git commit -m "feat(mockbot): rosbridge-protocol AMR simulator with fault injection"
```

---

### Task B6: Daemon↔mockbot integration + fault matrix **[opus]**

**Files:**
- Create: `backend/internal/api/integration_test.go`

- [ ] **Step 1: Happy path**

Start mockbot on a free port, start the daemon pointed at it, connect a WS client to `/ws/mission/status`, POST `linear_chain.json`, and assert the **exact ordered** stream: `running`/`done` per node in `topological_order`, then `__mission__`/`complete`. Assert `node_events` rows match.

- [ ] **Step 2: One test per spec §8.1 fault**

Each asserts the *defined behaviour*, not merely that an error happened:

| Fault | Assertion |
|---|---|
| disconnect | daemon reports disconnected < 1s; reconnects; run marked interrupted |
| estop | run halts; subsequent deploy returns 4xx with `detail`; succeeds after clear |
| node_error | `error` for the named node; run result `fault`; the failed node ID is recorded |
| battery | run auto-pauses; alert emitted |
| deploy mid-mission | 4xx with `detail`, first run unaffected |
| stall | connection stays open, no spurious `complete` |

- [ ] **Step 3: Run and commit**

```bash
cd backend && go test ./internal/api/ -run TestIntegration -v
git add backend/internal/api/integration_test.go && git commit -m "test(backend): daemon/mockbot integration and fault matrix"
```

---

### Task B7: Auth **[sonnet]**

**Files:**
- Create: `backend/internal/auth/auth.go`, `auth_test.go`, `backend/internal/api/auth_http.go`

**Interfaces:**
- Produces: `HashPassword(string) (string, error)`, `VerifyPassword(hash, pw string) bool`, `IssueSession(userID int64, ttl time.Duration) (string, error)`, `VerifySession(token string) (*Session, error)`.

Per the `golang-security` skill:
- argon2id, 64MB memory / 3 iterations / 4 parallelism, 16-byte random salt, encoded params in the stored hash.
- `VerifyPassword` uses `subtle.ConstantTimeCompare`.
- Session tokens: 32 bytes from `crypto/rand`, base64url. **Never** `math/rand`.
- Failed login returns the same message and similar timing whether the email exists or not.

- [ ] **Step 1: Tests** — round-trip hash/verify; wrong password fails; two hashes of the same password differ (salted); expired session rejected; tampered token rejected.
- [ ] **Step 2: Implement. Step 3: Endpoints** — `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`. Each writes an `audit_log` row.
- [ ] **Step 4: Commit** — `git commit -m "feat(backend): local auth with argon2id and sessions"`

---

### Task B8: Programs, versions, audit **[haiku]**

**Files:** `backend/internal/api/programs.go`, `programs_test.go`

Endpoints: `GET/POST /api/programs`, `GET /api/programs/{id}/versions`, `GET /api/versions/{id}`. Every deploy already writes a version row in B3 — this exposes them for the Version History UI. Every mutating call writes `audit_log` with actor, action, target.

- [ ] Tests → implement → commit as `feat(backend): program storage, version history, audit log`.

---

## Track C — Electron

### Task C1: Sidecar lifecycle **[sonnet]**

**Files:**
- Create: `electron/sidecar.cjs`
- Modify: `electron/main.cjs`, `electron/preload.cjs:1-14`

**Interfaces:**
- Produces: `startSidecar() → Promise<{port, stop}>`; renderer reads `window.corelyn.apiPort`.

- [ ] **Step 1: Implement `sidecar.cjs`**

Free port: bind `net.createServer()` to `127.0.0.1:0`, read `.address().port`, close, use it. Small race window, acceptable for loopback.

Binary path: `app.isPackaged ? path.join(process.resourcesPath, 'bin', 'corelyn-studiod') : path.join(__dirname, '..', 'backend', 'corelyn-studiod')`.

DB path: `path.join(app.getPath('userData'), 'corelyn.db')` — **never** beside the binary; the AppImage mount is read-only.

Spawn with `stdio: ['pipe','pipe','pipe']` so closing stdin kills the daemon. Poll `/api/health` every 100ms up to 10s; reject on timeout. Kill on `before-quit`, `window-all-closed`, and `process.on('exit')`.

- [ ] **Step 2: Wire `main.cjs`** — await `startSidecar()` before `createWindow()`; on failure show a dialog naming the reason rather than a blank window.

- [ ] **Step 3: Expose the port**

```js
// preload.cjs
contextBridge.exposeInMainWorld('corelyn', {
  apiPort: process.argv.find(a => a.startsWith('--api-port='))?.split('=')[1],
});
```

Pass via `additionalArguments` in `webPreferences`. Keep `contextIsolation: true` and `sandbox: true` as they are today.

- [ ] **Step 4: Manual verification** — `npm run electron:dev`, confirm the app opens and the health indicator reads online. Confirm the daemon process exits when the app is quit **and** when Electron is `kill -9`'d.

- [ ] **Step 5: Commit** — `feat(electron): spawn Go daemon as a managed sidecar`

---

### Task C2: AppImage packaging **[sonnet]**

**Files:** `package.json` build block, `backend/Makefile`

- [ ] **Step 1:** `Makefile` cross-compiles both binaries: `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build`.
- [ ] **Step 2:** electron-builder `linux.target: ["AppImage"]`, `extraResources` mapping `backend/dist/corelyn-studiod` → `bin/`.
- [ ] **Step 3:** Build, then verify on a clean Ubuntu container that the AppImage runs, writes its DB under `~/.config`, and needs no system packages.
- [ ] **Step 4:** Commit — `build: package Go sidecar into Linux AppImage`

---

### Task C3: Playwright E2E **[sonnet]**

**Files:** `tests/e2e/mission.spec.js`, `playwright.config.js`

Per the `playwright-best-practices` skill's Electron section: launch via `_electron.launch()`, use web-first assertions, no fixed sleeps.

- [ ] Specs: app launches and sidecar reports healthy; deploy against mockbot advances node states on the canvas; killing the mockbot surfaces the disconnected state.
- [ ] Commit — `test(e2e): Playwright Electron coverage for deploy and disconnect`

---

## Track D — Frontend

### Task D1: API client; delete roslib and the browser simulator **[sonnet]**

**Files:**
- Create: `src/api/client.js`
- Modify: `src/App.jsx` (lines 12–39, 917–985, 1146–1203), `package.json`
- Delete: `src/ros/rosBridge.jsx`

- [ ] **Step 1:** `src/api/client.js` — base URL from `window.corelyn.apiPort`, falling back to `http://localhost:8000` for browser-only `npm run dev`. Exposes `health()`, `deploy(spec)`, `cancel()`, `connectStatus(onMessage)`.
- [ ] **Step 2:** Replace the scattered `fetch` calls with the client.
- [ ] **Step 3:** Delete the in-browser demo simulator (`src/App.jsx:937-969`). DEMO MODE is now "daemon connected to mockbot" per spec §3.3, so the run path is identical in both modes.
- [ ] **Step 4:** Delete `src/ros/rosBridge.jsx`; remove `roslib` from `package.json`; `npm install`.
- [ ] **Step 5:** Verify against the running daemon + mockbot, then commit — `refactor(ui): route all robot traffic through the Go daemon`

---

### Task D2: Split `App.jsx` — zero visual change **[sonnet]**

**Files:** create `src/shell/`, `src/canvas/`, `src/palette/`, `src/inspector/`, `src/mission/`, `src/log/`; shrink `src/App.jsx`.

**This task changes no behaviour and no pixels.** It is a pure move.

- [ ] **Step 1: Baseline** — Playwright screenshots of every panel state, committed as the reference.
- [ ] **Step 2: Extract one module at a time**, running the E2E suite after each. Order: log → palette → inspector → mission control → canvas → shell. Canvas last: it holds the most shared state.
- [ ] **Step 3: Gate** — screenshots pixel-identical to the Step 1 baseline; E2E suite unchanged and passing. Any diff means the refactor changed something — find it, don't re-baseline.
- [ ] **Step 4: Commit** — `refactor(ui): split App.jsx into focused modules`

---

### Task D3: Schema-driven inspector **[sonnet]**

The inspector currently hardcodes fields per node type. With `shared/nodes.json` it can render from the schema, which is PRD §8.1.3.

- [ ] Render each param by its declared `type`: `number` → numeric input, `text` → text, `select` → dropdown from `options`, `boolean` → toggle. Unknown types render read-only rather than vanishing.
- [ ] Test: selecting each of the 24 node types renders exactly the params declared in `nodes.json`.
- [ ] Commit — `feat(ui): schema-driven node inspector`

---

## Track E — Design bake-off (parallel; independent of A–D)

Stitch is driven over HTTPS at `https://stitch.googleapis.com/mcp` with header `X-Goog-Api-Key`, JSON-RPC `tools/call`. The MCP tool wrapper fails to load in-session because the tool list is ~324 KB, so use `curl`.

### Task E1: Design system from the reference **[sonnet]**

- [ ] `create_project` titled "CorelynStudio v2 — Engineering".
- [ ] `create_design_system` capturing the reference's language: near-black canvas with a dotted grid, elevated panels, restrained accent per node category (the six category colors already in `nodes.json`), compact type, tight control heights.
- [ ] Save the returned tokens to `docs/design/design-system.json`.

### Task E2: Track 1 — screenshot-derived **[sonnet]**

- [ ] `generate_screen_from_text` for: main editor, node inspector open, deploy modal, login, version history.
- [ ] Layout follows the reference: top command bar (`connect · Validate · Stop · Run · Deploy · mission.json · Platform C100/C500/C1000 · Tools`), `Projects | Blocks` tabbed left palette with search, dotted dark canvas, floating bottom bar (filename, Undo/Redo, zoom, fullscreen), right-edge view switcher — the switcher reserves the slot for the future Monitor panel.
- [ ] Export to `docs/design/track1/`.

### Task E3: Track 2 — open exploration **[sonnet]**

- [ ] Same five screens, reference used as taste input only; Stitch proposes layout freely.
- [ ] Export to `docs/design/track2/`.

### Task E4: Bake-off **[opus]**

- [ ] Write `docs/design/BAKEOFF.md` comparing the tracks on: operator task-time for authoring a mission, information density at 200 nodes, discoverability of E-Stop and Deploy, fit with the existing mental model (retraining cost, PRD §10.5), and extensibility to the Monitor panel.
- [ ] Give a recommendation with reasoning. **Do not apply either design** — the team picks. Task D4 (applying the winner) is deliberately not in this plan; it gets written once a track is chosen.

---

## Execution Order

```
A1 ──> A2 ──> B1 ──> B2 ──> B3 ──> B4 ──> B5 ──> B6 ──> B7 ──> B8
                              │                    │
                              └──> C1 ──> C2 ──> C3
                                    │
                                    └──> D1 ──> D2 ──> D3

E1 ──> E2, E3 (parallel) ──> E4          [independent of everything above]
```

A1 gates all of B — fixtures must be captured before code moves. E runs from the start.

---

## Definition of Done

1. `cd backend && go test ./...` green, including all 6 golden fixtures.
2. Every fault in spec §8.1 has a passing test asserting its defined behaviour.
3. `npm run electron:dev` starts the sidecar; a mission deploys against mockbot and completes with node states advancing on the canvas.
4. AppImage runs on a stock Ubuntu **desktop**; DB under `userData`. See the
   note below — "no external dependencies" as originally written is not
   achievable by any Electron app.
5. D2 screenshots pixel-identical to the pre-refactor baseline.
6. Deploy, cancel, login, logout each attributable to a user in `audit_log`.
7. Both design tracks delivered as complete screens; `BAKEOFF.md` written with a recommendation.

### Note on DoD 4 — what was actually verified

Checked against `ubuntu:24.04` (amd64, under emulation on an Apple Silicon
host), against `release/linux-unpacked/` from the Task C2 build.

**Holds.** The Go sidecar is fully static — `resources/bin/corelyn-studiod`
runs on a bare `ubuntu:24.04` with nothing installed. That is the half of the
bundle this project controls, and `CGO_ENABLED=0` is what buys it.

**Does not hold as written.** The Electron binary needs 27 shared libraries the
minimal image lacks: `libgtk-3`, `libnss3`, `libX11` and six other X libs,
`libasound`, `libcups`, `libdrm`, `libgbm`, `libatk`, `libpango`, `libcairo`,
`libdbus`, `libexpat`, `libxkbcommon`. Every one is stock GTK3/X11/NSS/ALSA
desktop stack; Electron does not bundle GTK, so no Electron AppImage is free of
these. A `ubuntu:24.04` container is a server base, not a desktop — a machine
that could display the app has all 27 already. The criterion should read
"stock Ubuntu desktop", which is the real deployment target.

**Not verifiable here.** An actual GUI launch, for two reasons. There is no
display in the container; and the AppImage cannot execute under Apple Silicon
emulation at all — type-2 AppImages set ELF ABI version to 65 (`0x41`, the
`AI\x02` magic) and Rosetta refuses a non-zero ABI version where the Linux
kernel ignores it. `Exec format error` there is a host artifact, not a defect
in the image. This last step needs a real x86-64 Linux machine or a CI runner.
