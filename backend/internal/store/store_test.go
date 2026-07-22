package store

import (
	"path/filepath"
	"testing"
)

func TestOpenCreatesSchema(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	want := []string{"users", "sessions", "robots", "programs", "program_versions", "mission_runs", "node_events", "audit_log"}
	for _, table := range want {
		var n int
		err := s.DB().QueryRow(
			`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, table,
		).Scan(&n)
		if err != nil || n != 1 {
			t.Errorf("table %q: count=%d err=%v", table, n, err)
		}
	}
}

func TestOpenIsIdempotent(t *testing.T) {
	p := filepath.Join(t.TempDir(), "test.db")
	for i := 0; i < 3; i++ {
		s, err := Open(p)
		if err != nil {
			t.Fatalf("open %d: %v", i, err)
		}
		s.Close()
	}
}
