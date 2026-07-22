package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// createProgramRequest is the POST /api/programs body.
type createProgramRequest struct {
	Name     string `json:"name"`
	Platform string `json:"platform"`
}

func (s *Server) handleGetPrograms(w http.ResponseWriter, r *http.Request) {
	programs, err := s.deps.Store.GetPrograms()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch programs: "+err.Error())
		return
	}

	if programs == nil {
		programs = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, programs)
}

func (s *Server) handleCreateProgram(w http.ResponseWriter, r *http.Request) {
	// Verify authentication
	token := bearerToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	sess, err := s.auth.VerifySession(token)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	// Parse request body
	var req createProgramRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "malformed JSON body: "+err.Error())
		return
	}

	// Validate required fields
	if req.Name == "" || req.Platform == "" {
		writeError(w, http.StatusBadRequest, "name and platform are required")
		return
	}

	// Create the program with the creator's user ID
	// The EnsureDefaultProgram function creates a program without a creator,
	// so we need a different approach. Let me create a new function or directly insert.
	now := nowRFC3339ForStore()
	res, err := s.deps.Store.DB().Exec(
		`INSERT INTO programs (name, platform, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		req.Name, req.Platform, sess.UserID, now, now,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create program: "+err.Error())
		return
	}

	progID, err := res.LastInsertId()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get program ID: "+err.Error())
		return
	}

	// Write audit log
	_ = s.deps.Store.InsertAuditLog(&sess.UserID, "program_create", req.Name)

	// Fetch and return the created program
	prog, err := s.deps.Store.GetProgramByID(progID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch created program: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, prog)
}

func (s *Server) handleGetProgramVersions(w http.ResponseWriter, r *http.Request) {
	// Extract program ID from URL
	idStr := strings.TrimPrefix(r.URL.Path, "/api/programs/")
	idStr = strings.TrimSuffix(idStr, "/versions")

	progID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid program ID: "+err.Error())
		return
	}

	// Verify the program exists
	_, err = s.deps.Store.GetProgramByID(progID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "program not found")
		} else {
			writeError(w, http.StatusInternalServerError, "failed to fetch program: "+err.Error())
		}
		return
	}

	// Get versions
	versions, err := s.deps.Store.GetProgramVersions(progID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to fetch versions: "+err.Error())
		return
	}

	if versions == nil {
		versions = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, versions)
}

func (s *Server) handleGetVersion(w http.ResponseWriter, r *http.Request) {
	// Extract version ID from URL
	idStr := strings.TrimPrefix(r.URL.Path, "/api/versions/")

	versionID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid version ID: "+err.Error())
		return
	}

	// Get version
	version, err := s.deps.Store.GetProgramVersion(versionID)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "version not found")
		} else {
			writeError(w, http.StatusInternalServerError, "failed to fetch version: "+err.Error())
		}
		return
	}

	writeJSON(w, http.StatusOK, version)
}

// nowRFC3339ForStore returns the current time in RFC3339 format.
func nowRFC3339ForStore() string {
	return time.Now().UTC().Format(time.RFC3339)
}
