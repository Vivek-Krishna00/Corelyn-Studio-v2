package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"nhooyr.io/websocket"
)

// rosFrame is the wire shape of one rosbridge v2 op frame, wide enough to
// cover the ops this mockbot handles (advertise, unadvertise, subscribe,
// unsubscribe, publish). Unknown ops are ignored — real rosbridge servers do
// the same for ops/fields they don't recognise.
//
// https://github.com/RobotWebTools/rosbridge_suite/blob/ros1/ROSBRIDGE_PROTOCOL.md
type rosFrame struct {
	Op    string          `json:"op"`
	Topic string          `json:"topic,omitempty"`
	Type  string          `json:"type,omitempty"`
	Msg   json.RawMessage `json:"msg,omitempty"`
}

// stringMsg is the std_msgs/String payload shape: exactly one field.
type stringMsg struct {
	Data string `json:"data"`
}

// rosConn is one connected rosbridge client (in practice, the daemon).
type rosConn struct {
	conn *websocket.Conn
	mu   sync.Mutex // serializes writes; websocket.Conn is not write-safe for concurrent writers
}

func (c *rosConn) send(ctx context.Context, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.Write(ctx, websocket.MessageText, b)
}

// rosServer implements enough of the rosbridge v2 protocol to be
// indistinguishable from rosbridge_suite for this application: advertise,
// unadvertise, subscribe, unsubscribe, and publish op framing over a
// WebSocket, with per-topic subscriber sets.
type rosServer struct {
	onDeploy func(specJSON string)

	mu   sync.Mutex
	subs map[string]map[*rosConn]struct{} // topic -> subscribers
}

func newRosServer(onDeploy func(specJSON string)) *rosServer {
	return &rosServer{
		onDeploy: onDeploy,
		subs:     make(map[string]map[*rosConn]struct{}),
	}
}

// publish sends a publish frame carrying a stringified payload to every
// subscriber of topic. Matches spec §4.5: std_msgs/String, data stringified.
func (s *rosServer) publish(ctx context.Context, topic string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	frame := rosFrame{Op: "publish", Topic: topic}
	msg, _ := json.Marshal(stringMsg{Data: string(data)})
	frame.Msg = msg

	s.mu.Lock()
	recipients := make([]*rosConn, 0, len(s.subs[topic]))
	for c := range s.subs[topic] {
		recipients = append(recipients, c)
	}
	s.mu.Unlock()

	for _, c := range recipients {
		_ = c.send(ctx, frame)
	}
}

// closeAll immediately drops every connected client — used by the
// "disconnect" fault.
func (s *rosServer) closeAll() {
	s.mu.Lock()
	seen := make(map[*rosConn]struct{})
	for _, set := range s.subs {
		for c := range set {
			seen[c] = struct{}{}
		}
	}
	s.mu.Unlock()
	for c := range seen {
		c.conn.Close(websocket.StatusNormalClosure, "fault: disconnect")
	}
}

func (s *rosServer) subscribe(c *rosConn, topic string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.subs[topic] == nil {
		s.subs[topic] = make(map[*rosConn]struct{})
	}
	s.subs[topic][c] = struct{}{}
}

func (s *rosServer) unsubscribe(c *rosConn, topic string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.subs[topic], c)
}

func (s *rosServer) dropConn(c *rosConn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for topic, set := range s.subs {
		delete(set, c)
		if len(set) == 0 {
			delete(s.subs, topic)
		}
	}
}

func (s *rosServer) handleWS(w http.ResponseWriter, r *http.Request) {
	wsConn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer wsConn.CloseNow()

	c := &rosConn{conn: wsConn}
	defer s.dropConn(c)

	ctx := r.Context()
	for {
		_, data, err := wsConn.Read(ctx)
		if err != nil {
			return
		}
		var frame rosFrame
		if err := json.Unmarshal(data, &frame); err != nil {
			continue
		}

		switch frame.Op {
		case "advertise":
			// Bookkeeping only: this mockbot doesn't need to know a topic's
			// declared type to relay it.
		case "unadvertise":
		case "subscribe":
			s.subscribe(c, frame.Topic)
		case "unsubscribe":
			s.unsubscribe(c, frame.Topic)
		case "publish":
			s.handlePublish(frame)
		default:
			slog.Debug("mockbot: ignoring unhandled op", "op", frame.Op)
		}
	}
}

func (s *rosServer) handlePublish(frame rosFrame) {
	if frame.Topic != topicDeploy {
		return
	}
	var m stringMsg
	if err := json.Unmarshal(frame.Msg, &m); err != nil {
		slog.Warn("mockbot: malformed publish on deploy topic", "error", err)
		return
	}
	if s.onDeploy != nil {
		s.onDeploy(m.Data)
	}
}
