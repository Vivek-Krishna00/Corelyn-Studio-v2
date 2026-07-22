package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"corelynstudio/backend/internal/auth"
)

func TestGetProgramsEmpty(t *testing.T) {
	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("GET", "/api/programs", nil))

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("programs count = %d, want 0", len(got))
	}
}

func TestPostProgramCreatesAndWritesAuditLog(t *testing.T) {
	srv := newTestServer(t)
	userID := createTestUser(t, srv, "creator@example.com", "password")

	body := `{"name":"My Program","platform":"C500"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/programs", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer dummy-token")
	srv.ServeHTTP(rec, req)

	// Should fail auth since we passed a dummy token
	if rec.Code != 401 {
		t.Fatalf("create program without valid session: status = %d, want 401", rec.Code)
	}

	// Now login and get a real token
	loginBody := `{"email":"creator@example.com","password":"password"}`
	loginRec := httptest.NewRecorder()
	srv.ServeHTTP(loginRec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(loginBody)))
	var loginGot map[string]string
	json.Unmarshal(loginRec.Body.Bytes(), &loginGot)
	token := loginGot["token"]

	// Create program with valid token
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("POST", "/api/programs", strings.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", "Bearer "+token)
	srv.ServeHTTP(rec2, req2)

	if rec2.Code != 200 {
		t.Fatalf("create program: status = %d, body = %s", rec2.Code, rec2.Body)
	}
	var got map[string]any
	json.Unmarshal(rec2.Body.Bytes(), &got)
	if got["id"] == nil || got["name"] != "My Program" || got["platform"] != "C500" {
		t.Errorf("response missing expected fields: %v", got)
	}

	// Verify audit log
	var n int
	err := srv.deps.Store.DB().QueryRow(
		`SELECT count(*) FROM audit_log WHERE user_id = ? AND action = 'program_create'`,
		userID,
	).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("audit_log rows for program_create = %d, want 1", n)
	}
}

func TestGetProgramVersionsEmpty(t *testing.T) {
	srv := newTestServer(t)
	userID := createTestUser(t, srv, "creator@example.com", "password")

	// Create a program first
	progID, err := srv.deps.Store.EnsureDefaultProgram("My Program", "C500")
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("GET", "/api/programs/1/versions", nil))

	if rec.Code != 200 {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("versions count = %d, want 0 for new program", len(got))
	}

	_ = userID
	_ = progID
}

func TestGetProgramVersionsAfterDeploy(t *testing.T) {
	srv := newTestServer(t)
	createTestUser(t, srv, "creator@example.com", "password")

	// Deploy a mission to create a version
	body := string(validMissionBody(t))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("deploy failed: %d %s", rec.Code, rec.Body)
	}

	// Get program 1's versions
	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, httptest.NewRequest("GET", "/api/programs/1/versions", nil))

	if rec2.Code != 200 {
		t.Fatalf("get versions: status = %d, body = %s", rec2.Code, rec2.Body)
	}
	var got []map[string]any
	json.Unmarshal(rec2.Body.Bytes(), &got)
	if len(got) != 1 {
		t.Errorf("versions count = %d, want 1", len(got))
	}
}

func TestGetVersionByID(t *testing.T) {
	srv := newTestServer(t)
	createTestUser(t, srv, "creator@example.com", "password")

	// Deploy to create a version
	body := string(validMissionBody(t))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.ServeHTTP(rec, req)

	// Get version 1
	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, httptest.NewRequest("GET", "/api/versions/1", nil))

	if rec2.Code != 200 {
		t.Fatalf("get version: status = %d, body = %s", rec2.Code, rec2.Body)
	}
	var got map[string]any
	json.Unmarshal(rec2.Body.Bytes(), &got)
	if got["id"] != 1.0 || got["version"] != 1.0 {
		t.Errorf("version response invalid: %v", got)
	}
}

func TestPostProgramErrorOnBadJSON(t *testing.T) {
	srv := newTestServer(t)
	hash, _ := auth.HashPassword("password")
	srv.deps.Store.CreateUser("user@example.com", hash, "operator")

	// Login
	loginBody := `{"email":"user@example.com","password":"password"}`
	loginRec := httptest.NewRecorder()
	srv.ServeHTTP(loginRec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(loginBody)))
	var loginGot map[string]string
	json.Unmarshal(loginRec.Body.Bytes(), &loginGot)
	token := loginGot["token"]

	// Bad JSON
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/programs", strings.NewReader(`{"name":`))
	req.Header.Set("Authorization", "Bearer "+token)
	srv.ServeHTTP(rec, req)

	if rec.Code < 400 {
		t.Errorf("malformed JSON should fail, got %d", rec.Code)
	}
	var got map[string]any
	json.Unmarshal(rec.Body.Bytes(), &got)
	if _, ok := got["detail"]; !ok {
		t.Errorf("error response should have detail key: %s", rec.Body)
	}
}
