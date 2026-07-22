// Package api serves the frozen HTTP+WS contract: GET /api/health,
// POST /api/deploy, and WS /ws/mission/status. See spec §4.
package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"sync"

	"corelynstudio/backend/internal/auth"
	"corelynstudio/backend/internal/nodes"
	"corelynstudio/backend/internal/rosbridge"
	"corelynstudio/backend/internal/store"
)

// Topics the daemon speaks on. The mission spec is stringified into the
// std_msgs/String "data" field — that type has exactly one field, so it is
// never nested as an object (spec §4.5).
const (
	topicDeploy = "/mission/deploy"
	topicStatus = "/mission/status"
	msgTypeStr  = "std_msgs/String"
)

// Deps are the server's collaborators, all produced by earlier tasks.
type Deps struct {
	Store *store.Store
	Defs  *nodes.Defs
	Ros   *rosbridge.Client // nil in unit tests that don't need a robot
}

// Server routes the daemon's HTTP and WebSocket surface.
type Server struct {
	deps Deps
	mux  *http.ServeMux
	hub  *hub
	auth *auth.Auth

	mu       sync.Mutex
	active   *activeRun // nil when no mission is currently deployed
	estopped bool       // latched by __mission__/estop, cleared by __mission__/ready
	rosUp    bool       // last observed rosbridge connection state
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
	s := &Server{deps: deps, hub: newHub(), auth: auth.New(deps.Store)}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("POST /api/deploy", s.handleDeploy)
	mux.HandleFunc("/ws/mission/status", s.handleStatusWS)
	mux.HandleFunc("POST /api/auth/signup", s.handleSignup)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/session", s.handleSession)
	mux.HandleFunc("GET /api/programs", s.handleGetPrograms)
	mux.HandleFunc("POST /api/programs", s.handleCreateProgram)
	mux.HandleFunc("GET /api/programs/{id}/versions", s.handleGetProgramVersions)
	mux.HandleFunc("GET /api/versions/{id}", s.handleGetVersion)
	s.mux = mux

	if deps.Ros != nil {
		deps.Ros.OnState = s.onRosState
		// Registered before Connect: the subscription is queued and sent on
		// every (re)connect, so no status event is missed after a drop.
		_ = deps.Ros.Subscribe(topicStatus, msgTypeStr, s.onRosStatus)
	}

	return s
}

// allowedBrowserOrigin reports whether a browser at this Origin may call the
// API. The packaged renderer loads over file:// and sends no usable Origin;
// `npm run dev` and `npm run electron:dev` serve it from the Vite port while
// the daemon answers on its own, which is cross-origin and needs saying so
// explicitly. Same policy as the status WebSocket — see statusWSOrigins.
func allowedBrowserOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// ServeHTTP satisfies http.Handler so main.go can hand the Server straight
// to http.Server, and applies the CORS policy on the way through.
//
// Without this, every request the renderer makes under `npm run electron:dev`
// fails: a JSON body makes the request preflighted, and an OPTIONS the mux
// does not route is a 405 the browser reports as "Failed to fetch".
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" && allowedBrowserOrigin(origin) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Add("Vary", "Origin")
		h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		h.Set("Access-Control-Max-Age", "600")
	}

	// Answer the preflight whether or not the origin was allowed — a bare 204
	// with no Allow-Origin header is what a refusal looks like to a browser,
	// and it is clearer than a 405 about an OPTIONS route that does not exist.
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	s.mux.ServeHTTP(w, r)
}

// runResultFor maps a status event to the mission_runs result it terminates
// the active run with, or "" if the run continues. This is the single place
// the fault matrix (spec §8.1) is turned into persisted state, so the operator
// can tell afterwards how a run ended.
func runResultFor(nodeID, status string) string {
	if nodeID == "__mission__" {
		switch status {
		case "complete", "cancelled", "paused":
			return status
		case "estop":
			return "estop"
		case "disconnected":
			return "interrupted"
		}
		return ""
	}
	if status == "error" {
		return "fault"
	}
	return ""
}

// Broadcast records a node-status event against the active run and pushes it
// to every connected status-WS client. It is the one entry point for status
// coming back from the robot, so run bookkeeping cannot be skipped by a caller.
//
// Terminal events (see runResultFor) close the run, freeing the server to
// accept the next deploy — that is the recovery path for every recoverable
// fault. E-Stop additionally latches: it blocks deploys until the robot
// reports __mission__/ready.
func (s *Server) Broadcast(nodeID, status string) {
	result := runResultFor(nodeID, status)

	s.mu.Lock()
	if nodeID == "__mission__" {
		switch status {
		case "estop":
			s.estopped = true
		case "ready":
			s.estopped = false
		}
	}
	run := s.active
	if result != "" {
		s.active = nil
	}
	s.mu.Unlock()

	if run != nil && s.deps.Store != nil {
		if err := s.deps.Store.RecordNodeEvent(run.missionRunID, nodeID, status); err != nil {
			slog.Error("record node event", "error", err)
		}
		if result != "" {
			if err := s.deps.Store.EndMissionRun(run.missionRunID, result); err != nil {
				slog.Error("end mission run", "error", err)
			}
		}
	}

	s.hub.broadcast(nodeID, status)
}

// onRosStatus unwraps a std_msgs/String frame from /mission/status into the
// {node_id,status} pair the frontend contract expects.
func (s *Server) onRosStatus(raw json.RawMessage) {
	var wrapper struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		slog.Warn("malformed status frame from robot", "error", err)
		return
	}
	var msg statusMsg
	if err := json.Unmarshal([]byte(wrapper.Data), &msg); err != nil {
		slog.Warn("malformed status payload from robot", "error", err, "data", wrapper.Data)
		return
	}
	s.Broadcast(msg.NodeID, msg.Status)
}

// onRosState turns a lost robot link into an operator-visible event within the
// 1s budget in spec §8.1, and closes the interrupted run. Only a
// Connected→Disconnected transition counts: a daemon that has never connected
// must not spam the UI while the client is still backing off.
func (s *Server) onRosState(st rosbridge.ConnState) {
	s.mu.Lock()
	wasUp := s.rosUp
	s.rosUp = st == rosbridge.Connected
	s.mu.Unlock()

	if wasUp && st != rosbridge.Connected {
		s.Broadcast("__mission__", "disconnected")
	}
}

// robotState reports the rosbridge link state for GET /api/health: "none"
// when the daemon was started with no rosbridge URL, otherwise "connected" or
// "disconnected" per the latest onRosState callback.
func (s *Server) robotState() string {
	if s.deps.Ros == nil {
		return "none"
	}
	s.mu.Lock()
	up := s.rosUp
	s.mu.Unlock()
	if up {
		return "connected"
	}
	return "disconnected"
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
