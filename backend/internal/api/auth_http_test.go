package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"corelynstudio/backend/internal/auth"
)

func createTestUser(t *testing.T, srv *Server, email, password string) int64 {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	id, err := srv.deps.Store.CreateUser(email, hash, "operator")
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestLoginSuccessIssuesSession(t *testing.T) {
	srv := newTestServer(t)
	createTestUser(t, srv, "operator@example.com", "correct-horse")

	body := `{"email":"operator@example.com","password":"correct-horse"}`
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(body)))

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	var got map[string]string
	json.Unmarshal(rec.Body.Bytes(), &got)
	if got["token"] == "" {
		t.Fatalf("no token in response: %s", rec.Body.String())
	}

	// The token round-trips through GET /api/auth/session.
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("GET", "/api/auth/session", nil)
	req2.Header.Set("Authorization", "Bearer "+got["token"])
	srv.ServeHTTP(rec2, req2)
	if rec2.Code != 200 {
		t.Fatalf("session status = %d, body = %s", rec2.Code, rec2.Body)
	}
}

func TestLoginWrongPasswordAndUnknownEmailMatch(t *testing.T) {
	srv := newTestServer(t)
	createTestUser(t, srv, "operator@example.com", "correct-horse")

	wrongPwBody := `{"email":"operator@example.com","password":"nope"}`
	recWrong := httptest.NewRecorder()
	srv.ServeHTTP(recWrong, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(wrongPwBody)))

	unknownBody := `{"email":"nobody@example.com","password":"nope"}`
	recUnknown := httptest.NewRecorder()
	srv.ServeHTTP(recUnknown, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(unknownBody)))

	if recWrong.Code != 401 || recUnknown.Code != 401 {
		t.Fatalf("status codes = %d, %d, want both 401", recWrong.Code, recUnknown.Code)
	}
	if recWrong.Body.String() != recUnknown.Body.String() {
		t.Errorf("wrong-password body %q != unknown-email body %q, want identical",
			recWrong.Body.String(), recUnknown.Body.String())
	}
}

func TestSessionRejectsMissingOrBadToken(t *testing.T) {
	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("GET", "/api/auth/session", nil))
	if rec.Code != 401 {
		t.Errorf("no token: status = %d, want 401", rec.Code)
	}

	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("GET", "/api/auth/session", nil)
	req2.Header.Set("Authorization", "Bearer not-a-real-token")
	srv.ServeHTTP(rec2, req2)
	if rec2.Code != 401 {
		t.Errorf("bad token: status = %d, want 401", rec2.Code)
	}
}

func TestLogoutInvalidatesSession(t *testing.T) {
	srv := newTestServer(t)
	createTestUser(t, srv, "operator@example.com", "correct-horse")

	loginRec := httptest.NewRecorder()
	body := `{"email":"operator@example.com","password":"correct-horse"}`
	srv.ServeHTTP(loginRec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(body)))
	var got map[string]string
	json.Unmarshal(loginRec.Body.Bytes(), &got)
	token := got["token"]

	logoutRec := httptest.NewRecorder()
	logoutReq := httptest.NewRequest("POST", "/api/auth/logout", nil)
	logoutReq.Header.Set("Authorization", "Bearer "+token)
	srv.ServeHTTP(logoutRec, logoutReq)
	if logoutRec.Code != 200 {
		t.Fatalf("logout status = %d", logoutRec.Code)
	}

	sessRec := httptest.NewRecorder()
	sessReq := httptest.NewRequest("GET", "/api/auth/session", nil)
	sessReq.Header.Set("Authorization", "Bearer "+token)
	srv.ServeHTTP(sessRec, sessReq)
	if sessRec.Code != 401 {
		t.Errorf("session after logout: status = %d, want 401", sessRec.Code)
	}
}

func TestLoginAndLogoutWriteAuditLog(t *testing.T) {
	srv := newTestServer(t)
	createTestUser(t, srv, "operator@example.com", "correct-horse")

	body := `{"email":"operator@example.com","password":"correct-horse"}`
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(body)))
	var got map[string]string
	json.Unmarshal(rec.Body.Bytes(), &got)

	logoutReq := httptest.NewRequest("POST", "/api/auth/logout", nil)
	logoutReq.Header.Set("Authorization", "Bearer "+got["token"])
	srv.ServeHTTP(httptest.NewRecorder(), logoutReq)

	var n int
	err := srv.deps.Store.DB().QueryRow(
		`SELECT count(*) FROM audit_log WHERE action IN ('login','logout')`,
	).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("audit_log rows for login+logout = %d, want 2", n)
	}
}
