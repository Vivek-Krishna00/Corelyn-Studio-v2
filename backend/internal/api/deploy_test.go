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
