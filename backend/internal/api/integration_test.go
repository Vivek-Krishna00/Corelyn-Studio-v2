package api

// Daemon <-> mockbot integration and the spec §8.1 fault matrix.
//
// These tests are the entire substitute for hardware validation, so each one
// asserts the *defined* behaviour — the observable system state and the
// recovery path — not merely that something errored. They run the real
// corelyn-mockbot binary in a separate process and talk to it over a real
// WebSocket, so the rosbridge framing on both sides is exercised for real.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"nhooyr.io/websocket"

	"corelynstudio/backend/internal/nodes"
	"corelynstudio/backend/internal/rosbridge"
	"corelynstudio/backend/internal/store"
)

const fixtureDir = "../../../shared/testdata"

// ---------------------------------------------------------------- mockbot ---

var (
	buildOnce  sync.Once
	mockbotBin string
	buildErr   error
)

// buildMockbot compiles cmd/corelyn-mockbot once per test binary. It is built
// rather than imported on purpose: internal/sim must stay unreachable from the
// daemon, and running it out-of-process is what makes this an integration test
// instead of a wiring test.
func buildMockbot(t *testing.T) string {
	t.Helper()
	buildOnce.Do(func() {
		dir, err := os.MkdirTemp("", "corelyn-mockbot-build")
		if err != nil {
			buildErr = err
			return
		}
		mockbotBin = filepath.Join(dir, "corelyn-mockbot")
		cmd := exec.Command("go", "build", "-o", mockbotBin, "corelynstudio/backend/cmd/corelyn-mockbot")
		cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
		if out, err := cmd.CombinedOutput(); err != nil {
			buildErr = fmt.Errorf("build mockbot: %w\n%s", err, out)
		}
	})
	if buildErr != nil {
		t.Fatal(buildErr)
	}
	return mockbotBin
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

type mockbot struct {
	httpURL string
	wsURL   string
}

// startMockbot launches a fresh mockbot process per test, so injected fault
// state can never leak between tests.
func startMockbot(t *testing.T, speed float64) *mockbot {
	t.Helper()
	bin := buildMockbot(t)
	port := freePort(t)

	cmd := exec.Command(bin,
		"--port", strconv.Itoa(port),
		"--speed", strconv.FormatFloat(speed, 'f', -1, 64),
	)
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("start mockbot: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})

	m := &mockbot{
		httpURL: fmt.Sprintf("http://127.0.0.1:%d", port),
		wsURL:   fmt.Sprintf("ws://127.0.0.1:%d", port),
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Post(m.httpURL+"/_fault", "application/json",
			strings.NewReader(`{"fault":"clear"}`))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return m
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("mockbot never became ready")
	return nil
}

func (m *mockbot) fault(t *testing.T, body string) {
	t.Helper()
	resp, err := http.Post(m.httpURL+"/_fault", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("inject fault %s: %v", body, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("inject fault %s: status %d body %s", body, resp.StatusCode, b)
	}
}

// ----------------------------------------------------------------- daemon ---

type daemon struct {
	http  *httptest.Server
	srv   *Server
	store *store.Store
	ros   *rosbridge.Client
}

// startDaemon wires the real daemon stack — store, node defs, rosbridge
// client, HTTP server — at the given rosbridge URL and waits until it is
// actually connected.
func startDaemon(t *testing.T, rosURL string) *daemon {
	t.Helper()

	defs, err := nodes.Load()
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	ros := rosbridge.New(rosURL)
	srv := New(Deps{Store: st, Defs: defs, Ros: ros})

	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = ros.Connect(ctx)
	}()
	// Connect dispatches status and state callbacks synchronously, so waiting
	// for it to return is what guarantees no Broadcast is still in flight when
	// the store closes below (cleanups run LIFO, so this one runs first).
	t.Cleanup(func() {
		cancel()
		wg.Wait()
	})

	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)

	d := &daemon{http: ts, srv: srv, store: st, ros: ros}
	waitUntil(t, 5*time.Second, func() bool { return ros.State() == rosbridge.Connected },
		"rosbridge client never reached Connected")
	return d
}

func (d *daemon) deploy(t *testing.T, body []byte) (int, map[string]any) {
	t.Helper()
	resp, err := http.Post(d.http.URL+"/api/deploy", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST /api/deploy: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

// health hits GET /api/health on the running daemon.
func (d *daemon) health(t *testing.T) map[string]string {
	t.Helper()
	resp, err := http.Get(d.http.URL + "/api/health")
	if err != nil {
		t.Fatalf("GET /api/health: %v", err)
	}
	defer resp.Body.Close()
	var got map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	return got
}

// nodeEvents returns every persisted node event in insertion order.
func (d *daemon) nodeEvents(t *testing.T) []statusMsg {
	t.Helper()
	rows, err := d.store.DB().Query(`SELECT node_id, status FROM node_events ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []statusMsg
	for rows.Next() {
		var m statusMsg
		if err := rows.Scan(&m.NodeID, &m.Status); err != nil {
			t.Fatal(err)
		}
		got = append(got, m)
	}
	return got
}

// runResults returns the result column of every mission run, in id order.
// A run that has not ended yet reads as "<open>".
func (d *daemon) runResults(t *testing.T) []string {
	t.Helper()
	rows, err := d.store.DB().Query(`SELECT COALESCE(result, '<open>') FROM mission_runs ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			t.Fatal(err)
		}
		got = append(got, r)
	}
	return got
}

// ------------------------------------------------------------ status feed ---

// statusStream is a real WS client on /ws/mission/status — the same surface
// the renderer consumes.
type statusStream struct {
	msgs chan statusMsg
}

func dialStatus(t *testing.T, d *daemon) *statusStream {
	t.Helper()
	url := "ws" + strings.TrimPrefix(d.http.URL, "http") + "/ws/mission/status"

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatalf("dial status ws: %v", err)
	}
	t.Cleanup(func() { conn.CloseNow() })

	s := &statusStream{msgs: make(chan statusMsg, 256)}
	go func() {
		defer close(s.msgs)
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			var m statusMsg
			if json.Unmarshal(data, &m) == nil {
				s.msgs <- m
			}
		}
	}()
	return s
}

func (s *statusStream) next(t *testing.T, within time.Duration) statusMsg {
	t.Helper()
	select {
	case m, ok := <-s.msgs:
		if !ok {
			t.Fatal("status stream closed")
		}
		return m
	case <-time.After(within):
		t.Fatalf("timed out after %s waiting for a status event", within)
	}
	return statusMsg{}
}

// expect asserts the exact ordered sequence of events, with nothing between.
func (s *statusStream) expect(t *testing.T, within time.Duration, want ...statusMsg) {
	t.Helper()
	for i, w := range want {
		if got := s.next(t, within); got != w {
			t.Fatalf("event %d = %+v, want %+v", i, got, w)
		}
	}
}

// await drains events until want arrives, failing if any forbidden event shows
// up first or the window expires.
func (s *statusStream) await(t *testing.T, within time.Duration, want statusMsg, forbidden ...statusMsg) {
	t.Helper()
	deadline := time.After(within)
	for {
		select {
		case m, ok := <-s.msgs:
			if !ok {
				t.Fatal("status stream closed")
			}
			for _, f := range forbidden {
				if m == f {
					t.Fatalf("received forbidden event %+v while waiting for %+v", f, want)
				}
			}
			if m == want {
				return
			}
		case <-deadline:
			t.Fatalf("timed out after %s waiting for %+v", within, want)
		}
	}
}

// expectSilence asserts nothing at all arrives for d.
func (s *statusStream) expectSilence(t *testing.T, d time.Duration) {
	t.Helper()
	select {
	case m, ok := <-s.msgs:
		if !ok {
			t.Fatal("status stream closed during the silence window")
		}
		t.Fatalf("unexpected status event during the silence window: %+v", m)
	case <-time.After(d):
	}
}

func waitUntil(t *testing.T, within time.Duration, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("%s (within %s)", msg, within)
}

func loadFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(fixtureDir, name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// linearChainStream is the exact ordered event sequence linear_chain.json must
// produce: running/done per node in topological_order, then the mission event.
var linearChainStream = []statusMsg{
	{NodeID: "n_start", Status: "running"}, {NodeID: "n_start", Status: "done"},
	{NodeID: "n_fwd", Status: "running"}, {NodeID: "n_fwd", Status: "done"},
	{NodeID: "n_rot", Status: "running"}, {NodeID: "n_rot", Status: "done"},
	{NodeID: "n_end", Status: "running"}, {NodeID: "n_end", Status: "done"},
	{NodeID: "__mission__", Status: "complete"},
}

// ------------------------------------------------------------- happy path ---

func TestIntegrationHappyPath(t *testing.T) {
	mb := startMockbot(t, 20)
	d := startDaemon(t, mb.wsURL)
	feed := dialStatus(t, d)

	spec := loadFixture(t, "linear_chain.json")
	if code, body := d.deploy(t, spec); code != http.StatusOK {
		t.Fatalf("deploy = %d %v", code, body)
	}

	feed.expect(t, 5*time.Second, linearChainStream...)

	// Every broadcast event must also have landed in node_events.
	got := d.nodeEvents(t)
	if len(got) != len(linearChainStream) {
		t.Fatalf("node_events = %+v, want %+v", got, linearChainStream)
	}
	for i, want := range linearChainStream {
		if got[i] != want {
			t.Fatalf("node_events[%d] = %+v, want %+v", i, got[i], want)
		}
	}

	if results := d.runResults(t); len(results) != 1 || results[0] != "complete" {
		t.Errorf("mission_runs results = %v, want [complete]", results)
	}

	// Recovery path: the run is over, so the next deploy is accepted.
	if code, body := d.deploy(t, spec); code != http.StatusOK {
		t.Fatalf("redeploy after completion = %d %v", code, body)
	}
}

// A deploy with a live rosbridge link must say so honestly — "deployed", not
// the no-robot variant a nil Ros would report.
func TestIntegrationDeployWithRobotReportsDeployed(t *testing.T) {
	mb := startMockbot(t, 20)
	d := startDaemon(t, mb.wsURL)

	code, body := d.deploy(t, loadFixture(t, "linear_chain.json"))
	if code != http.StatusOK {
		t.Fatalf("deploy = %d %v", code, body)
	}
	if body["status"] != "deployed" {
		t.Fatalf("status = %v, want %q", body["status"], "deployed")
	}
}

// Health must reflect the rosbridge link the server actually has, not just
// whether one was configured.
func TestIntegrationHealthReportsRobotConnected(t *testing.T) {
	mb := startMockbot(t, 20)
	d := startDaemon(t, mb.wsURL)

	got := d.health(t)
	if got["robot"] != "connected" {
		t.Fatalf("health robot = %q, want %q", got["robot"], "connected")
	}
}

func TestIntegrationHealthReportsRobotDisconnectedAfterLinkDrop(t *testing.T) {
	mb := startMockbot(t, 1)
	d := startDaemon(t, mb.wsURL)

	mb.fault(t, `{"fault":"disconnect"}`)
	waitUntil(t, time.Second, func() bool { return d.ros.State() != rosbridge.Connected },
		"rosbridge client did not report a dropped connection within 1s")

	got := d.health(t)
	if got["robot"] != "disconnected" {
		t.Fatalf("health robot = %q, want %q", got["robot"], "disconnected")
	}
}

// ------------------------------------------------------- §8.1 fault matrix ---

// Drop the WebSocket mid-mission: the daemon must report disconnected inside
// 1s, surface it to the UI, mark the run interrupted, and reconnect on its own.
func TestIntegrationFaultDisconnect(t *testing.T) {
	mb := startMockbot(t, 1)
	d := startDaemon(t, mb.wsURL)
	feed := dialStatus(t, d)

	if code, body := d.deploy(t, loadFixture(t, "linear_chain.json")); code != http.StatusOK {
		t.Fatalf("deploy = %d %v", code, body)
	}
	feed.expect(t, 2*time.Second, statusMsg{NodeID: "n_start", Status: "running"})

	mb.fault(t, `{"fault":"disconnect"}`)

	// Defined behaviour 1: disconnected state observable within 1s.
	waitUntil(t, time.Second, func() bool { return d.ros.State() != rosbridge.Connected },
		"rosbridge client did not report a dropped connection within 1s")

	// Defined behaviour 2: the UI is told, rather than left waiting forever.
	feed.await(t, time.Second, statusMsg{NodeID: "__mission__", Status: "disconnected"},
		statusMsg{NodeID: "__mission__", Status: "complete"})

	// Defined behaviour 3: the run is closed as interrupted, not left open.
	waitUntil(t, 2*time.Second, func() bool {
		r := d.runResults(t)
		return len(r) == 1 && r[0] == "interrupted"
	}, fmt.Sprintf("mission run not marked interrupted, got %v", d.runResults(t)))

	// Defined behaviour 4: recovery is automatic — reconnect with backoff.
	waitUntil(t, 10*time.Second, func() bool { return d.ros.State() == rosbridge.Connected },
		"rosbridge client never reconnected")
}

// E-Stop: the run halts, further deploys are refused with an explicit reason,
// and only an explicit clear re-enables them.
func TestIntegrationFaultEstop(t *testing.T) {
	mb := startMockbot(t, 1)
	d := startDaemon(t, mb.wsURL)
	feed := dialStatus(t, d)

	spec := loadFixture(t, "linear_chain.json")
	if code, body := d.deploy(t, spec); code != http.StatusOK {
		t.Fatalf("deploy = %d %v", code, body)
	}
	feed.expect(t, 2*time.Second, statusMsg{NodeID: "n_start", Status: "running"})

	mb.fault(t, `{"fault":"estop"}`)

	// Defined behaviour 1: FAULT state reaches the UI and halts the run.
	feed.await(t, 2*time.Second, statusMsg{NodeID: "__mission__", Status: "estop"},
		statusMsg{NodeID: "__mission__", Status: "complete"})
	waitUntil(t, 2*time.Second, func() bool {
		r := d.runResults(t)
		return len(r) == 1 && r[0] == "estop"
	}, fmt.Sprintf("mission run not marked estop, got %v", d.runResults(t)))

	// Defined behaviour 2: Run/Deploy locked out, with a reason the operator
	// can read (src/App.jsx renders .detail verbatim).
	code, body := d.deploy(t, spec)
	if code < 400 || code >= 500 {
		t.Fatalf("deploy under E-Stop = %d %v, want 4xx", code, body)
	}
	detail, _ := body["detail"].(string)
	if !strings.Contains(strings.ToLower(detail), "stop") {
		t.Fatalf("E-Stop rejection detail = %q, want it to name the E-Stop", detail)
	}
	if runs := d.runResults(t); len(runs) != 1 {
		t.Fatalf("refused deploy still created a run: %v", runs)
	}

	// Defined behaviour 3: only an explicit clear unlocks it.
	mb.fault(t, `{"fault":"clear"}`)
	feed.await(t, 2*time.Second, statusMsg{NodeID: "__mission__", Status: "ready"})

	if code, body := d.deploy(t, spec); code != http.StatusOK {
		t.Fatalf("deploy after E-Stop clear = %d %v, want 200", code, body)
	}
	// And the robot really does pick the work up again — accepting the deploy
	// but never moving would look identical at the HTTP layer.
	feed.await(t, 5*time.Second, statusMsg{NodeID: "n_start", Status: "running"})
}

// A failing node produces a FAULT sub-state naming the node, ends the run as a
// fault, and stays recoverable by redeploying.
func TestIntegrationFaultNodeError(t *testing.T) {
	mb := startMockbot(t, 20)
	d := startDaemon(t, mb.wsURL)
	feed := dialStatus(t, d)

	mb.fault(t, `{"fault":"node_error","node_id":"n_rot"}`)

	spec := loadFixture(t, "linear_chain.json")
	if code, body := d.deploy(t, spec); code != http.StatusOK {
		t.Fatalf("deploy = %d %v", code, body)
	}

	// Defined behaviour 1: error is reported for the named node, and the run
	// aborts rather than completing.
	feed.await(t, 5*time.Second, statusMsg{NodeID: "n_rot", Status: "error"},
		statusMsg{NodeID: "__mission__", Status: "complete"},
		statusMsg{NodeID: "n_rot", Status: "done"})

	// Defined behaviour 2: run result is a fault and the failed node id is
	// recorded, so the UI can name it after a restart.
	waitUntil(t, 2*time.Second, func() bool {
		r := d.runResults(t)
		return len(r) == 1 && r[0] == "fault"
	}, fmt.Sprintf("mission run not marked fault, got %v", d.runResults(t)))

	var recorded bool
	for _, e := range d.nodeEvents(t) {
		if e.NodeID == "n_rot" && e.Status == "error" {
			recorded = true
		}
		if e.NodeID == "n_end" {
			t.Fatalf("mission continued past the failed node: %+v", d.nodeEvents(t))
		}
	}
	if !recorded {
		t.Fatalf("failed node not recorded in node_events: %+v", d.nodeEvents(t))
	}

	// Defined behaviour 3: recoverable — a fresh deploy is accepted.
	if code, body := d.deploy(t, spec); code != http.StatusOK {
		t.Fatalf("redeploy after fault = %d %v", code, body)
	}
}

// Battery below threshold auto-pauses the run and alerts the operator, rather
// than silently driving on.
func TestIntegrationFaultBattery(t *testing.T) {
	mb := startMockbot(t, 4)
	d := startDaemon(t, mb.wsURL)
	feed := dialStatus(t, d)

	if code, body := d.deploy(t, loadFixture(t, "linear_chain.json")); code != http.StatusOK {
		t.Fatalf("deploy = %d %v", code, body)
	}
	feed.expect(t, 2*time.Second, statusMsg{NodeID: "n_start", Status: "running"})

	mb.fault(t, `{"fault":"battery","pct":5}`)

	// Defined behaviour 1: operator alert, then an automatic pause — and never
	// a completion.
	complete := statusMsg{NodeID: "__mission__", Status: "complete"}
	feed.await(t, 5*time.Second, statusMsg{NodeID: "__mission__", Status: "low_battery"}, complete)
	feed.await(t, 5*time.Second, statusMsg{NodeID: "__mission__", Status: "paused"}, complete)

	// Defined behaviour 2: the run is recorded as paused, not complete.
	waitUntil(t, 2*time.Second, func() bool {
		r := d.runResults(t)
		return len(r) == 1 && r[0] == "paused"
	}, fmt.Sprintf("mission run not marked paused, got %v", d.runResults(t)))

	// Defined behaviour 3: no phantom completion turns up afterwards.
	feed.expectSilence(t, 500*time.Millisecond)
}

// A deploy arriving mid-mission is rejected server-side with an explicit
// reason, and the running mission is untouched.
func TestIntegrationFaultDeployMidMission(t *testing.T) {
	mb := startMockbot(t, 4)
	d := startDaemon(t, mb.wsURL)
	feed := dialStatus(t, d)

	spec := loadFixture(t, "linear_chain.json")
	if code, body := d.deploy(t, spec); code != http.StatusOK {
		t.Fatalf("first deploy = %d %v", code, body)
	}
	feed.expect(t, 2*time.Second, statusMsg{NodeID: "n_start", Status: "running"})

	// Defined behaviour 1: rejected with a reason, not queued silently.
	code, body := d.deploy(t, spec)
	if code < 400 || code >= 500 {
		t.Fatalf("mid-mission deploy = %d %v, want 4xx", code, body)
	}
	if detail, _ := body["detail"].(string); detail == "" {
		t.Fatalf("mid-mission rejection body = %v, want a non-empty detail", body)
	}

	// Defined behaviour 2: the first mission is unaffected and still completes.
	feed.await(t, 10*time.Second, statusMsg{NodeID: "__mission__", Status: "complete"})

	if runs := d.runResults(t); len(runs) != 1 || runs[0] != "complete" {
		t.Fatalf("mission_runs = %v, want exactly one complete run", runs)
	}
}

// A stalled status feed must stay distinguishable from a lost one: the socket
// is still up, the run is still open, and no completion is invented.
func TestIntegrationFaultStall(t *testing.T) {
	mb := startMockbot(t, 1)
	d := startDaemon(t, mb.wsURL)
	feed := dialStatus(t, d)

	if code, body := d.deploy(t, loadFixture(t, "linear_chain.json")); code != http.StatusOK {
		t.Fatalf("deploy = %d %v", code, body)
	}
	feed.expect(t, 2*time.Second, statusMsg{NodeID: "n_start", Status: "running"})

	mb.fault(t, `{"fault":"stall"}`)

	// Defined behaviour 1: the feed goes quiet — no events, and crucially no
	// spurious completion — for longer than a node normally takes (800ms).
	feed.expectSilence(t, 1500*time.Millisecond)

	// Defined behaviour 2: "quiet" is not "lost" — the connection is still up,
	// so the UI must not be shown a disconnected state.
	if got := d.ros.State(); got != rosbridge.Connected {
		t.Fatalf("rosbridge state during stall = %v, want Connected", got)
	}

	// Defined behaviour 3: the run stays open rather than being closed out.
	if runs := d.runResults(t); len(runs) != 1 || runs[0] != "<open>" {
		t.Fatalf("mission_runs during stall = %v, want one still-open run", runs)
	}
}
