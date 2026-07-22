package rosbridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

// recordedFrame is the shape every rosbridge v2 op frame decodes into for
// assertions; fields not present in a given op are simply zero.
type recordedFrame struct {
	Op    string          `json:"op"`
	Topic string          `json:"topic"`
	Type  string          `json:"type"`
	Msg   json.RawMessage `json:"msg"`
}

// fakeRosbridgeServer records every frame the client sends, and can push
// frames back down to the client for Subscribe-side tests.
type fakeRosbridgeServer struct {
	*httptest.Server

	mu     sync.Mutex
	frames []recordedFrame
	conn   *websocket.Conn
}

func newFakeRosbridgeServer(t *testing.T) *fakeRosbridgeServer {
	t.Helper()
	f := &fakeRosbridgeServer{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()

		f.mu.Lock()
		f.conn = conn
		f.mu.Unlock()

		ctx := r.Context()
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			var frame recordedFrame
			if err := json.Unmarshal(data, &frame); err != nil {
				continue
			}
			f.mu.Lock()
			f.frames = append(f.frames, frame)
			f.mu.Unlock()
		}
	}))
	t.Cleanup(f.Server.Close)
	return f
}

func (f *fakeRosbridgeServer) recordedFrames() []recordedFrame {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]recordedFrame, len(f.frames))
	copy(out, f.frames)
	return out
}

func (f *fakeRosbridgeServer) wsURL() string {
	return "ws" + strings.TrimPrefix(f.Server.URL, "http")
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		if cond() {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("condition not met within %s", timeout)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestClientEmitsRosbridgeV2Framing(t *testing.T) {
	srv := newFakeRosbridgeServer(t)

	c := New(srv.wsURL())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Connect(ctx)

	waitFor(t, time.Second, func() bool { return c.State() == Connected })

	if err := c.Publish("/mission/deploy", "std_msgs/String", map[string]string{"data": "<stringified spec>"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if err := c.Subscribe("/mission/status", "std_msgs/String", func(json.RawMessage) {}); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	var frames []recordedFrame
	waitFor(t, time.Second, func() bool {
		frames = srv.recordedFrames()
		return len(frames) >= 3
	})

	if got := frames[0]; got.Op != "advertise" || got.Topic != "/mission/deploy" || got.Type != "std_msgs/String" {
		t.Errorf("frame[0] = %+v, want advertise /mission/deploy std_msgs/String", got)
	}
	if got := frames[1]; got.Op != "publish" || got.Topic != "/mission/deploy" {
		t.Errorf("frame[1] = %+v, want publish /mission/deploy", got)
	}
	var payload struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(frames[1].Msg, &payload); err != nil || payload.Data != "<stringified spec>" {
		t.Errorf("frame[1].msg = %s, want {\"data\":\"<stringified spec>\"} (stringified, not nested)", frames[1].Msg)
	}
	if got := frames[2]; got.Op != "subscribe" || got.Topic != "/mission/status" || got.Type != "std_msgs/String" {
		t.Errorf("frame[2] = %+v, want subscribe /mission/status std_msgs/String", got)
	}
}

func TestClientReconnectsWithBackoffAfterDrop(t *testing.T) {
	srv := newFakeRosbridgeServer(t)

	c := New(srv.wsURL())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Connect(ctx)

	waitFor(t, time.Second, func() bool { return c.State() == Connected })

	// Kill the connection mid-session (not the listener: httptest.Server.Close
	// doesn't force-close already-hijacked WebSocket conns, so the client
	// would never observe a drop). CloseNow on the server-side conn is what
	// "the server died" looks like from the client's read loop.
	srv.mu.Lock()
	conn := srv.conn
	srv.mu.Unlock()
	if conn == nil {
		t.Fatal("server never captured a connection")
	}
	conn.CloseNow()

	waitFor(t, time.Second, func() bool { return c.State() == Disconnected })
}

func TestNextBackoffDoublesAndCaps(t *testing.T) {
	tests := []struct {
		cur  time.Duration
		want time.Duration
	}{
		{0, 250 * time.Millisecond},
		{250 * time.Millisecond, 500 * time.Millisecond},
		{500 * time.Millisecond, time.Second},
		{time.Second, 2 * time.Second},
		{2 * time.Second, 4 * time.Second},
		{4 * time.Second, 4 * time.Second}, // capped
	}
	for _, tt := range tests {
		if got := nextBackoff(tt.cur); got != tt.want {
			t.Errorf("nextBackoff(%s) = %s, want %s", tt.cur, got, tt.want)
		}
	}
}

func TestSubscribeDeliversUnwrappedMsg(t *testing.T) {
	srv := newFakeRosbridgeServer(t)

	c := New(srv.wsURL())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Connect(ctx)

	waitFor(t, time.Second, func() bool { return c.State() == Connected })

	received := make(chan json.RawMessage, 1)
	if err := c.Subscribe("/mission/status", "std_msgs/String", func(msg json.RawMessage) {
		received <- msg
	}); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}

	waitFor(t, time.Second, func() bool { return len(srv.recordedFrames()) >= 1 })

	srv.mu.Lock()
	conn := srv.conn
	srv.mu.Unlock()
	frame := `{"op":"publish","topic":"/mission/status","msg":{"data":"{\"node_id\":\"n1\",\"status\":\"running\"}"}}`
	if err := conn.Write(ctx, websocket.MessageText, []byte(frame)); err != nil {
		t.Fatalf("server write: %v", err)
	}

	select {
	case msg := <-received:
		var payload struct {
			Data string `json:"data"`
		}
		if err := json.Unmarshal(msg, &payload); err != nil {
			t.Fatalf("unmarshal msg: %v", err)
		}
		if payload.Data != `{"node_id":"n1","status":"running"}` {
			t.Errorf("payload.Data = %q, want the stringified status JSON", payload.Data)
		}
	case <-time.After(time.Second):
		t.Fatal("subscription callback never fired")
	}
}
