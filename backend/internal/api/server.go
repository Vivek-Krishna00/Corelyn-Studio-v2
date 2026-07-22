// Package api serves the frozen HTTP+WS contract: GET /api/health,
// POST /api/deploy, and WS /ws/mission/status. See spec §4.
package api

import (
	"encoding/json"
	"net/http"
	"sync"

	"corelynstudio/backend/internal/nodes"
	"corelynstudio/backend/internal/store"
)

// Deps are the server's collaborators, all produced by earlier tasks.
type Deps struct {
	Store *store.Store
	Defs  *nodes.Defs
}

// Server routes the daemon's HTTP and WebSocket surface.
type Server struct {
	deps Deps
	mux  *http.ServeMux
	hub  *hub

	mu     sync.Mutex
	active *activeRun // nil when no mission is currently deployed
}

// activeRun tracks the one mission the daemon will execute at a time —
// deploying a second mission mid-run is rejected, not queued (spec §10.1).
type activeRun struct {
	missionID        string
	programVersionID int64
	missionRunID     int64
}

// New builds a Server. Routing uses the stdlib ServeMux method matching
// added in Go 1.22 — no router dependency needed for three routes.
func New(deps Deps) *Server {
	s := &Server{deps: deps, hub: newHub()}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("POST /api/deploy", s.handleDeploy)
	mux.HandleFunc("/ws/mission/status", s.handleStatusWS)
	s.mux = mux

	return s
}

// ServeHTTP satisfies http.Handler so main.go can hand the Server straight
// to http.Server.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// Broadcast pushes a node-status event to every connected status-WS client.
// Used by the rosbridge client (Task B4) to relay /mission/status messages.
//
// A "__mission__" event with status "complete" or "cancelled" ends the
// active run (spec §4.3), freeing the server to accept the next deploy.
func (s *Server) Broadcast(nodeID, status string) {
	if nodeID == "__mission__" && (status == "complete" || status == "cancelled") {
		s.mu.Lock()
		run := s.active
		s.active = nil
		s.mu.Unlock()
		if run != nil && s.deps.Store != nil {
			s.deps.Store.EndMissionRun(run.missionRunID, status)
		}
	}
	s.hub.broadcast(nodeID, status)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// writeError writes {"detail": msg} — the ONLY error-body shape the frontend
// understands (src/App.jsx reads .detail verbatim). Any other key renders a
// reasonless failure to the operator.
func writeError(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, map[string]string{"detail": detail})
}
