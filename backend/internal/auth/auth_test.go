package auth_test

import (
	"path/filepath"
	"testing"
	"time"

	"corelynstudio/backend/internal/auth"
	"corelynstudio/backend/internal/store"
)

func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestHashPasswordVerifyRoundTrip(t *testing.T) {
	hash, err := auth.HashPassword("correct-horse-battery-staple")
	if err != nil {
		t.Fatal(err)
	}
	if !auth.VerifyPassword(hash, "correct-horse-battery-staple") {
		t.Error("VerifyPassword() = false for the correct password, want true")
	}
}

func TestVerifyPasswordWrongPassword(t *testing.T) {
	hash, err := auth.HashPassword("correct-horse-battery-staple")
	if err != nil {
		t.Fatal(err)
	}
	if auth.VerifyPassword(hash, "wrong-password") {
		t.Error("VerifyPassword() = true for a wrong password, want false")
	}
}

func TestHashPasswordSaltsDiffer(t *testing.T) {
	h1, err := auth.HashPassword("same-password")
	if err != nil {
		t.Fatal(err)
	}
	h2, err := auth.HashPassword("same-password")
	if err != nil {
		t.Fatal(err)
	}
	if h1 == h2 {
		t.Error("two hashes of the same password are identical, want distinct salts")
	}
	// Both must still verify independently.
	if !auth.VerifyPassword(h1, "same-password") || !auth.VerifyPassword(h2, "same-password") {
		t.Error("one of the two independently-salted hashes failed to verify")
	}
}

func TestIssueAndVerifySession(t *testing.T) {
	st := newTestStore(t)
	userID, err := st.CreateUser("operator@example.com", "irrelevant-hash", "operator")
	if err != nil {
		t.Fatal(err)
	}
	a := auth.New(st)

	token, err := a.IssueSession(userID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if token == "" {
		t.Fatal("IssueSession() returned an empty token")
	}

	sess, err := a.VerifySession(token)
	if err != nil {
		t.Fatalf("VerifySession() error = %v, want nil", err)
	}
	if sess.UserID != userID {
		t.Errorf("sess.UserID = %d, want %d", sess.UserID, userID)
	}
}

func TestVerifySessionExpired(t *testing.T) {
	st := newTestStore(t)
	userID, err := st.CreateUser("operator@example.com", "irrelevant-hash", "operator")
	if err != nil {
		t.Fatal(err)
	}
	a := auth.New(st)

	// A negative TTL puts expires_at in the past, so the session is already
	// expired the moment it's issued — no need to sleep in the test.
	token, err := a.IssueSession(userID, -time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := a.VerifySession(token); err == nil {
		t.Error("VerifySession() error = nil for an expired session, want an error")
	}
}

func TestVerifySessionTamperedToken(t *testing.T) {
	st := newTestStore(t)
	userID, err := st.CreateUser("operator@example.com", "irrelevant-hash", "operator")
	if err != nil {
		t.Fatal(err)
	}
	a := auth.New(st)

	token, err := a.IssueSession(userID, time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	tampered := token[:len(token)-1] + "x"
	if tampered == token {
		t.Fatal("tampering did not change the token; test fixture is broken")
	}
	if _, err := a.VerifySession(tampered); err == nil {
		t.Error("VerifySession() error = nil for a tampered token, want an error")
	}
}
