// Package auth handles password hashing and session issue/verification for
// local email/password login (spec §6, Task B7). Roles are recorded but not
// yet enforced — see spec line 27.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"

	"corelynstudio/backend/internal/store"
)

// argon2id parameters per the golang-security skill: 64MB memory, 3
// iterations, 4-way parallelism, 16-byte random salt.
const (
	argonMemoryKiB = 64 * 1024
	argonTime      = 3
	argonThreads   = 4
	argonKeyLen    = 32
	saltLen        = 16
	tokenLen       = 32 // bytes of crypto/rand entropy per session token
)

// ErrSessionNotFound covers both "no such token" and "expired token" — the
// caller (an HTTP 401) treats them identically, so the distinction isn't
// worth a second sentinel.
var ErrSessionNotFound = errors.New("session not found or expired")

// Session is a verified, unexpired session.
type Session struct {
	UserID    int64
	Token     string
	ExpiresAt time.Time
}

// Auth issues and verifies sessions against the sessions table.
type Auth struct {
	store *store.Store
}

// New builds an Auth backed by st.
func New(st *store.Store) *Auth {
	return &Auth{store: st}
}

// HashPassword derives an argon2id hash and encodes it PHC-string style
// ($argon2id$v=..$m=..,t=..,p=..$salt$hash) with a fresh random salt, so the
// parameters travel with the hash and VerifyPassword doesn't need to guess
// what HashPassword used.
func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	encoded := fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemoryKiB, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)
	return encoded, nil
}

// VerifyPassword reports whether pw matches the encoded hash. It re-derives
// the hash using the salt and parameters embedded in hash itself, so a future
// change to HashPassword's defaults doesn't break verification of existing
// hashes, and compares in constant time so a match can't be inferred from
// comparison timing.
func VerifyPassword(hash, pw string) bool {
	parts := strings.Split(hash, "$")
	// "" "argon2id" "v=19" "m=..,t=..,p=.." salt hash
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false
	}
	var memory, iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(pw), salt, iterations, memory, threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// IssueSession creates and persists a new session token for userID, valid
// for ttl.
func (a *Auth) IssueSession(userID int64, ttl time.Duration) (string, error) {
	buf := make([]byte, tokenLen)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(buf)

	if err := a.store.CreateSession(token, userID, time.Now().UTC().Add(ttl)); err != nil {
		return "", fmt.Errorf("issue session: %w", err)
	}
	return token, nil
}

// VerifySession looks up token and returns its Session if it exists and has
// not expired. A tampered token simply doesn't match any row, so it fails
// the same way an unknown one does — no separate signature check is needed
// because the token itself is the unguessable secret (32 bytes of
// crypto/rand), not a self-describing structure.
func (a *Auth) VerifySession(token string) (*Session, error) {
	userID, expiresAt, err := a.store.SessionByToken(token)
	if err != nil {
		return nil, ErrSessionNotFound
	}
	if time.Now().UTC().After(expiresAt) {
		return nil, ErrSessionNotFound
	}
	return &Session{UserID: userID, Token: token, ExpiresAt: expiresAt}, nil
}
