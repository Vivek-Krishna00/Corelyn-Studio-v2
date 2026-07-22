package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"corelynstudio/backend/internal/auth"
)

// sessionTTL is how long an issued session token stays valid.
const sessionTTL = 24 * time.Hour

// loginRequest is the POST /api/auth/login body.
type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// invalidCredentialsMsg is returned verbatim whether the email doesn't exist
// or the password is wrong — per the golang-security skill, the two cases
// must be indistinguishable to a caller.
const invalidCredentialsMsg = "invalid email or password"

// dummyHash is verified against on an unknown-email login so that branch
// costs roughly the same argon2id work as the real one, keeping response
// timing similar either way (best-effort — this is not a hard real-time
// guarantee, just enough to defeat a casual timing probe).
var dummyHash, _ = auth.HashPassword("")

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "malformed JSON body: "+err.Error())
		return
	}

	userID, hash, _, err := s.deps.Store.UserByEmail(req.Email)
	if err != nil {
		auth.VerifyPassword(dummyHash, req.Password) // burn comparable time
		s.deps.Store.InsertAuditLog(nil, "login_failed", req.Email)
		writeError(w, http.StatusUnauthorized, invalidCredentialsMsg)
		return
	}

	if !auth.VerifyPassword(hash, req.Password) {
		s.deps.Store.InsertAuditLog(&userID, "login_failed", req.Email)
		writeError(w, http.StatusUnauthorized, invalidCredentialsMsg)
		return
	}

	token, err := s.auth.IssueSession(userID, sessionTTL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "issue session: "+err.Error())
		return
	}
	s.deps.Store.InsertAuditLog(&userID, "login", req.Email)

	writeJSON(w, http.StatusOK, map[string]string{
		"token":      token,
		"expires_at": time.Now().UTC().Add(sessionTTL).Format(time.RFC3339),
	})
}

// bearerToken extracts the token from "Authorization: Bearer <token>".
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return ""
	}
	return strings.TrimPrefix(h, prefix)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token != "" {
		if sess, err := s.auth.VerifySession(token); err == nil {
			s.deps.Store.InsertAuditLog(&sess.UserID, "logout", "")
		}
		// Deleting an unknown/expired token is not an error — logout is
		// idempotent, same as cancelActive for deploys.
		s.deps.Store.DeleteSession(token)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "logged_out"})
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
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

	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":    sess.UserID,
		"expires_at": sess.ExpiresAt.Format(time.RFC3339),
	})
}
