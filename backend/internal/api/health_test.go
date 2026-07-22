package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHealth(t *testing.T) {
	srv := newTestServer(t)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))

	if rec.Code != 200 {
		t.Fatalf("status = %d", rec.Code)
	}
	var got map[string]string
	json.Unmarshal(rec.Body.Bytes(), &got)
	if got["status"] != "ok" {
		t.Errorf(`body = %q, want {"status":"ok"}`, rec.Body.String())
	}
}

// newTestServer never wires a rosbridge client, so health must report "none"
// rather than guessing at a link that was never configured.
func TestHealthReportsRobotNoneWithNoRosbridge(t *testing.T) {
	srv := newTestServer(t)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("GET", "/api/health", nil))

	var got map[string]string
	json.Unmarshal(rec.Body.Bytes(), &got)
	if got["robot"] != "none" {
		t.Errorf(`robot = %q, want "none"`, got["robot"])
	}
}
