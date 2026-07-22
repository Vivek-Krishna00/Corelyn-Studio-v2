package api

import (
	"encoding/json"
	"net/http"
	"sync"

	"nhooyr.io/websocket"
)

// statusMsg is the wire shape pushed on /ws/mission/status (spec §4.3).
type statusMsg struct {
	NodeID string `json:"node_id"`
	Status string `json:"status"`
}

// clientSendBuffer bounds how far a client may lag before the hub drops it.
// A stalled UI must never wedge mission execution.
const clientSendBuffer = 64

type wsClient struct {
	send      chan statusMsg
	closeOnce sync.Once
}

func (c *wsClient) closeSend() {
	c.closeOnce.Do(func() { close(c.send) })
}

// hub fans a Broadcast out to every connected status-WS client.
type hub struct {
	mu      sync.Mutex
	clients map[*wsClient]struct{}
}

func newHub() *hub {
	return &hub{clients: make(map[*wsClient]struct{})}
}

func (h *hub) register() *wsClient {
	c := &wsClient{send: make(chan statusMsg, clientSendBuffer)}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	return c
}

func (h *hub) unregister(c *wsClient) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	c.closeSend()
}

func (h *hub) broadcast(nodeID, status string) {
	msg := statusMsg{NodeID: nodeID, Status: status}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c.send <- msg:
		default:
			// Buffer full: drop this client rather than block the hub.
			delete(h.clients, c)
			c.closeSend()
		}
	}
}

// statusWSOrigins are the Origins allowed to open the status stream, matched
// against the Origin header's host. The packaged renderer loads over file://,
// whose host is the empty string — the empty pattern is what admits it. The
// loopback entries admit `npm run dev`, which serves the UI from the Vite port
// while the daemon answers on its own. Everything else is still refused, so a
// page in the operator's browser cannot quietly tail mission status.
var statusWSOrigins = []string{"", "localhost:*", "127.0.0.1:*"}

func (s *Server) handleStatusWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: statusWSOrigins})
	if err != nil {
		return
	}
	defer conn.CloseNow()

	c := s.hub.register()
	defer s.hub.unregister(c)

	// The client never sends anything on this socket; CloseRead drains
	// control frames and cancels ctx the moment the client disconnects.
	ctx := conn.CloseRead(r.Context())

	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			b, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}
