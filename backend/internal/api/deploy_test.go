package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestDeployCancelEnvelope(t *testing.T) {
	srv := newTestServer(t)
	body := `{"mission_id":"__cancel__","command":"cancel"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	srv.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("cancel rejected: %d %s", rec.Code, rec.Body)
	}
}

func TestDeployErrorUsesDetailKey(t *testing.T) {
	srv := newTestServer(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(`{"nope":`))
	srv.ServeHTTP(rec, req)
	if rec.Code < 400 {
		t.Fatal("malformed body should fail")
	}
	var got map[string]any
	json.Unmarshal(rec.Body.Bytes(), &got)
	if _, ok := got["detail"]; !ok {
		t.Errorf(`error body = %s, want a "detail" key`, rec.Body.String())
	}
}

// validMissionBody loads a golden fixture so tests exercise the real
// validator path rather than a hand-rolled spec that could drift from the
// contract.
func validMissionBody(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("../../../shared/testdata/single_start.json")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestDeployValidMissionSucceedsAndPersists(t *testing.T) {
	srv := newTestServer(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(string(validMissionBody(t))))
	req.Header.Set("Content-Type", "application/json")
	srv.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("deploy rejected: %d %s", rec.Code, rec.Body)
	}

	var versions, runs int
	srv.deps.Store.DB().QueryRow(`SELECT count(*) FROM program_versions`).Scan(&versions)
	srv.deps.Store.DB().QueryRow(`SELECT count(*) FROM mission_runs`).Scan(&runs)
	if versions != 1 {
		t.Errorf("program_versions rows = %d, want 1", versions)
	}
	if runs != 1 {
		t.Errorf("mission_runs rows = %d, want 1", runs)
	}
}

// newTestServer never wires a rosbridge client. The daemon must not claim a
// mission was deployed when nothing will ever run it (spec §8.1 honesty).
func TestDeployWithNoRosbridgeReportsDeployedNoRobot(t *testing.T) {
	srv := newTestServer(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(string(validMissionBody(t))))
	req.Header.Set("Content-Type", "application/json")
	srv.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("deploy rejected: %d %s", rec.Code, rec.Body)
	}

	var got map[string]string
	json.Unmarshal(rec.Body.Bytes(), &got)
	if got["status"] != "deployed_no_robot" {
		t.Errorf(`status = %q, want "deployed_no_robot"`, got["status"])
	}
}

func TestDeployRejectsWhenMissionAlreadyRunning(t *testing.T) {
	srv := newTestServer(t)
	body := string(validMissionBody(t))

	rec1 := httptest.NewRecorder()
	srv.ServeHTTP(rec1, httptest.NewRequest("POST", "/api/deploy", strings.NewReader(body)))
	if rec1.Code != 200 {
		t.Fatalf("first deploy rejected: %d %s", rec1.Code, rec1.Body)
	}

	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, httptest.NewRequest("POST", "/api/deploy", strings.NewReader(body)))
	if rec2.Code < 400 {
		t.Fatalf("second deploy while mid-mission should be blocked, got %d", rec2.Code)
	}
	var got map[string]any
	json.Unmarshal(rec2.Body.Bytes(), &got)
	if _, ok := got["detail"]; !ok {
		t.Errorf(`error body = %s, want a "detail" key`, rec2.Body.String())
	}
}

func TestDeployValidationErrorNamesNodeAndField(t *testing.T) {
	srv := newTestServer(t)
	badSpec := `{
		"mission_id": "m1",
		"spec_version": "1.0.0",
		"created_at": "2026-07-22T00:00:00.000Z",
		"robot_requirements": {"min_battery_pct": 15, "required_capabilities": []},
		"topological_order": ["a"],
		"nodes": [{"id": "a", "type": "move_forward", "label": "Move Forward", "category": "motion", "params": {}, "position": {"x": 0, "y": 0}}],
		"connections": []
	}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(badSpec))
	srv.ServeHTTP(rec, req)
	if rec.Code < 400 {
		t.Fatalf("bad params should be rejected, got %d", rec.Code)
	}
	var got map[string]any
	json.Unmarshal(rec.Body.Bytes(), &got)
	detail, _ := got["detail"].(string)
	if !strings.Contains(detail, "a") || !strings.Contains(detail, "distance") {
		t.Errorf("detail = %q, want it to name node %q and field %q", detail, "a", "distance")
	}
}

// PRD §16 wants every control action attributable. Deploy and cancel are
// allowed without a session (see Server.actor), so what is asserted here is
// that the row is always written, and carries the user whenever one is known.
func TestDeployAndCancelAreAudited(t *testing.T) {
	srv := newTestServer(t)
	spec, err := os.ReadFile("../../../shared/testdata/single_start.json")
	if err != nil {
		t.Fatal(err)
	}

	userID := createTestUser(t, srv, "operator@example.com", "correct-horse")
	login := httptest.NewRecorder()
	srv.ServeHTTP(login, httptest.NewRequest("POST", "/api/auth/login",
		strings.NewReader(`{"email":"operator@example.com","password":"correct-horse"}`)))
	var session map[string]string
	json.Unmarshal(login.Body.Bytes(), &session)

	deploy := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(string(spec)))
	deploy.Header.Set("Authorization", "Bearer "+session["token"])
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, deploy)
	if rec.Code != 200 {
		t.Fatalf("deploy failed: %d %s", rec.Code, rec.Body)
	}

	cancel := httptest.NewRequest("POST", "/api/deploy",
		strings.NewReader(`{"mission_id":"__cancel__","command":"cancel"}`))
	cancel.Header.Set("Authorization", "Bearer "+session["token"])
	srv.ServeHTTP(httptest.NewRecorder(), cancel)

	for _, action := range []string{"deploy", "cancel"} {
		var n int
		err := srv.deps.Store.DB().QueryRow(
			`SELECT count(*) FROM audit_log WHERE action = ? AND user_id = ?`, action, userID).Scan(&n)
		if err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("audit_log rows for %s by user %d = %d, want 1", action, userID, n)
		}
	}
}

// An expired or missing token must not stop the robot being stopped. The
// action still happens and is still logged — with no actor against it.
func TestUnauthenticatedDeployIsLoggedWithoutAnActor(t *testing.T) {
	srv := newTestServer(t)
	spec, err := os.ReadFile("../../../shared/testdata/single_start.json")
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/deploy", strings.NewReader(string(spec)))
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	srv.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("deploy without a session was refused: %d %s", rec.Code, rec.Body)
	}

	var n int
	if err := srv.deps.Store.DB().QueryRow(
		`SELECT count(*) FROM audit_log WHERE action = 'deploy' AND user_id IS NULL`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("unattributed deploy rows = %d, want 1", n)
	}
}
