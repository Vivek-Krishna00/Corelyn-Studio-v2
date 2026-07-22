package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"corelynstudio/backend/internal/mission"
)

// cancelEnvelope is the alternate shape POST /api/deploy accepts alongside a
// full mission.Spec (spec §4.2).
type cancelEnvelope struct {
	MissionID string `json:"mission_id"`
	Command   string `json:"command"`
}

// defaultProgramName is the singleton program that holds version history for
// specs deployed straight from the canvas. There is no "save as program"
// flow yet — that's Task B8 — so every deploy versions under this one row.
const defaultProgramName = "canvas"

// actor returns the user id behind a request, or nil when the caller sent no
// session. Deploy and cancel are allowed either way — a control action must
// not become impossible because a token expired — so an unattributed row is
// recorded rather than the action refused. That is a deliberate hole in PRD
// §16's "100% attribution"; closing it means requiring auth here.
func (s *Server) actor(r *http.Request) *int64 {
	token := bearerToken(r)
	if token == "" {
		return nil
	}
	sess, err := s.auth.VerifySession(token)
	if err != nil {
		return nil
	}
	return &sess.UserID
}

func (s *Server) handleDeploy(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "read request body: "+err.Error())
		return
	}

	var env cancelEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		writeError(w, http.StatusBadRequest, "malformed JSON body: "+err.Error())
		return
	}

	if env.MissionID == "__cancel__" && env.Command == "cancel" {
		s.cancelActive(w, s.actor(r))
		return
	}

	var spec mission.Spec
	if err := json.Unmarshal(body, &spec); err != nil {
		writeError(w, http.StatusBadRequest, "malformed mission spec: "+err.Error())
		return
	}

	if errs := spec.Validate(s.deps.Defs); len(errs) > 0 {
		msgs := make([]string, len(errs))
		for i, e := range errs {
			msgs[i] = e.Error()
		}
		writeError(w, http.StatusBadRequest, strings.Join(msgs, "; "))
		return
	}

	s.mu.Lock()
	if s.estopped {
		s.mu.Unlock()
		// Spec §8.1: Run/Deploy stay locked out until the E-Stop is
		// explicitly cleared on the robot.
		writeError(w, http.StatusConflict,
			"E-Stop is engaged; clear the E-Stop on the robot before deploying")
		return
	}
	if s.active != nil {
		running := s.active.missionID
		s.mu.Unlock()
		writeError(w, http.StatusConflict,
			"mission "+running+" is already running; cancel it before deploying a new one")
		return
	}
	s.mu.Unlock()

	programID, err := s.deps.Store.EnsureDefaultProgram(defaultProgramName, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "persist program: "+err.Error())
		return
	}
	versionID, err := s.deps.Store.SaveProgramVersion(programID, body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "persist program version: "+err.Error())
		return
	}
	runID, err := s.deps.Store.StartMissionRun(versionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "persist mission run: "+err.Error())
		return
	}

	// Mark the run active before publishing: status events can come back
	// before Publish returns, and they must find a run to attach to.
	s.mu.Lock()
	s.active = &activeRun{missionID: spec.MissionID, programVersionID: versionID, missionRunID: runID}
	s.mu.Unlock()

	// No rosbridge configured means nothing will ever run this mission — say
	// so, rather than reporting the same "deployed" a real robot link gets.
	// Nothing will ever publish a terminal status event either, so this run
	// must be closed out right here or it stays "active" forever, 409-ing
	// every deploy after it.
	if s.deps.Ros == nil {
		s.mu.Lock()
		s.active = nil
		s.mu.Unlock()
		s.deps.Store.EndMissionRun(runID, "no_robot")
		s.deps.Store.InsertAuditLog(s.actor(r), "deploy", spec.MissionID)
		writeJSON(w, http.StatusOK, map[string]string{"mission_id": spec.MissionID, "status": "deployed_no_robot"})
		return
	}

	// std_msgs/String has exactly one field, so the spec travels as a
	// string in msg.data rather than nested JSON (spec §4.5).
	if err := s.deps.Ros.Publish(topicDeploy, msgTypeStr, map[string]string{"data": string(body)}); err != nil {
		s.mu.Lock()
		s.active = nil
		s.mu.Unlock()
		s.deps.Store.EndMissionRun(runID, "error")
		writeError(w, http.StatusServiceUnavailable, "robot link unavailable: "+err.Error())
		return
	}

	s.deps.Store.InsertAuditLog(s.actor(r), "deploy", spec.MissionID)
	writeJSON(w, http.StatusOK, map[string]string{"mission_id": spec.MissionID, "status": "deployed"})
}

// cancelActive ends whatever mission is running. Cancelling with nothing
// active is not an error — the client sends the same envelope regardless of
// whether it believes a mission is running.
func (s *Server) cancelActive(w http.ResponseWriter, actor *int64) {
	s.mu.Lock()
	run := s.active
	s.active = nil
	s.mu.Unlock()

	if run != nil {
		if err := s.deps.Store.EndMissionRun(run.missionRunID, "cancelled"); err != nil {
			writeError(w, http.StatusInternalServerError, "persist cancellation: "+err.Error())
			return
		}
		s.deps.Store.InsertAuditLog(actor, "cancel", run.missionID)
		s.hub.broadcast("__mission__", "cancelled")
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}
