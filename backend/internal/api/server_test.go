package api

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"corelynstudio/backend/internal/nodes"
	"corelynstudio/backend/internal/store"
)

// newTestServer builds a Server backed by a scratch SQLite db and the real
// shared/nodes.json definitions.
func newTestServer(t *testing.T) *Server {
	t.Helper()

	defs, err := nodes.Load()
	if err != nil {
		t.Fatal(err)
	}

	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })

	return New(Deps{Store: st, Defs: defs})
}

// Under `npm run electron:dev` the renderer is served from the Vite port while
// the daemon answers on its own, so every call it makes is cross-origin. A
// JSON body makes those calls preflighted, and before this policy existed the
// OPTIONS hit a route the mux does not have — a 405 the browser surfaces as
// "Failed to fetch". The packaged build loads over file:// and was unaffected,
// which is why the E2E suite never saw it.
func TestCORSAllowsTheDevRendererAndRefusesOthers(t *testing.T) {
	srv := newTestServer(t)

	for _, tc := range []struct {
		origin string
		allow  bool
	}{
		{"http://localhost:5173", true}, // npm run dev / electron:dev
		{"http://127.0.0.1:5173", true}, // same, other spelling
		{"http://localhost:8000", true}, // browser pointed at the daemon directly
		{"https://evil.example", false}, // a page in the operator's browser
	} {
		req := httptest.NewRequest("OPTIONS", "/api/auth/signup", nil)
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("Access-Control-Request-Method", "POST")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Errorf("origin %q: preflight status = %d, want 204", tc.origin, rec.Code)
		}
		got := rec.Header().Get("Access-Control-Allow-Origin")
		if tc.allow && got != tc.origin {
			t.Errorf("origin %q: Allow-Origin = %q, want it echoed back", tc.origin, got)
		}
		if !tc.allow && got != "" {
			t.Errorf("origin %q: Allow-Origin = %q, want none", tc.origin, got)
		}
	}
}
