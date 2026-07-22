package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

func TestStatusWSBroadcastReachesClient(t *testing.T) {
	srv := newTestServer(t)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsURL := "ws" + ts.URL[len("http"):] + "/ws/mission/status"
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()

	// Give the server a moment to register the client before broadcasting —
	// there is no ack, so this is an inherent race in an async hub.
	time.Sleep(50 * time.Millisecond)
	srv.Broadcast("n1", "running")

	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["node_id"] != "n1" || got["status"] != "running" {
		t.Errorf("got %v, want {node_id: n1, status: running}", got)
	}
}

func TestStatusWSSlowClientDroppedNotBlocked(t *testing.T) {
	srv := newTestServer(t)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsURL := "ws" + ts.URL[len("http"):] + "/ws/mission/status"
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()

	time.Sleep(50 * time.Millisecond)

	// Never read: flood past the per-client buffer and confirm the hub does
	// not block on a stalled client.
	done := make(chan struct{})
	go func() {
		for i := 0; i < 200; i++ {
			srv.Broadcast("n1", "running")
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("Broadcast blocked on a slow client")
	}
}

// The packaged renderer loads over file://, so its handshake carries an Origin
// the default same-host check refuses. Before statusWSOrigins existed, every
// status frame in the Electron app was dropped at the handshake with a 403.
func TestStatusWSOriginPolicy(t *testing.T) {
	srv := newTestServer(t)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	wsURL := "ws" + ts.URL[len("http"):] + "/ws/mission/status"

	for _, tc := range []struct {
		origin string
		accept bool
	}{
		{"file://", true},               // packaged renderer
		{"http://localhost:5173", true}, // npm run dev
		{"http://127.0.0.1:5173", true}, // ditto, other spelling
		{"https://evil.example", false}, // a page in the operator's browser
	} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		conn, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
			HTTPHeader: map[string][]string{"Origin": {tc.origin}},
		})
		if err == nil {
			conn.CloseNow()
		}
		if tc.accept && err != nil {
			t.Errorf("origin %q: want accepted, got %v", tc.origin, err)
		}
		if !tc.accept && err == nil {
			t.Errorf("origin %q: want refused, got accepted", tc.origin)
		}
		cancel()
	}
}
