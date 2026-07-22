package api

import (
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
