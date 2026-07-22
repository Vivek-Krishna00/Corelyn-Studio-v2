package store

import (
	"database/sql"
	"fmt"
	"time"
)

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// EnsureDefaultProgram returns the id of the program named name, creating it
// if it does not exist yet.
func (s *Store) EnsureDefaultProgram(name, platform string) (int64, error) {
	var id int64
	err := s.db.QueryRow(`SELECT id FROM programs WHERE name = ?`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, fmt.Errorf("lookup program %q: %w", name, err)
	}

	now := nowRFC3339()
	res, err := s.db.Exec(
		`INSERT INTO programs (name, platform, created_at, updated_at) VALUES (?, ?, ?, ?)`,
		name, platform, now, now,
	)
	if err != nil {
		return 0, fmt.Errorf("create program %q: %w", name, err)
	}
	return res.LastInsertId()
}

// SaveProgramVersion inserts the next version of specJSON under programID.
func (s *Store) SaveProgramVersion(programID int64, specJSON []byte) (int64, error) {
	var next int
	err := s.db.QueryRow(
		`SELECT COALESCE(MAX(version), 0) + 1 FROM program_versions WHERE program_id = ?`,
		programID,
	).Scan(&next)
	if err != nil {
		return 0, fmt.Errorf("compute next version for program %d: %w", programID, err)
	}

	res, err := s.db.Exec(
		`INSERT INTO program_versions (program_id, version, spec_json, created_at) VALUES (?, ?, ?, ?)`,
		programID, next, string(specJSON), nowRFC3339(),
	)
	if err != nil {
		return 0, fmt.Errorf("save program version for program %d: %w", programID, err)
	}
	return res.LastInsertId()
}

// StartMissionRun creates a mission_runs row for a freshly deployed version.
func (s *Store) StartMissionRun(programVersionID int64) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO mission_runs (program_version_id, started_at) VALUES (?, ?)`,
		programVersionID, nowRFC3339(),
	)
	if err != nil {
		return 0, fmt.Errorf("start mission run for version %d: %w", programVersionID, err)
	}
	return res.LastInsertId()
}

// RecordNodeEvent appends one {node_id,status} event to a run's history. This
// is what makes the System Log reconstructable after a restart, and what lets
// a fault name the node that failed once the run is over.
func (s *Store) RecordNodeEvent(runID int64, nodeID, status string) error {
	_, err := s.db.Exec(
		`INSERT INTO node_events (mission_run_id, node_id, status, at) VALUES (?, ?, ?, ?)`,
		runID, nodeID, status, nowRFC3339(),
	)
	if err != nil {
		return fmt.Errorf("record node event for run %d: %w", runID, err)
	}
	return nil
}

// EndMissionRun marks a run finished with the given result, e.g. "complete",
// "cancelled", or "error".
func (s *Store) EndMissionRun(runID int64, result string) error {
	_, err := s.db.Exec(
		`UPDATE mission_runs SET ended_at = ?, result = ? WHERE id = ?`,
		nowRFC3339(), result, runID,
	)
	if err != nil {
		return fmt.Errorf("end mission run %d: %w", runID, err)
	}
	return nil
}

// CreateUser inserts a user with an already-hashed password and returns its id.
func (s *Store) CreateUser(email, passwordHash, role string) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)`,
		email, passwordHash, role, nowRFC3339(),
	)
	if err != nil {
		return 0, fmt.Errorf("create user %q: %w", email, err)
	}
	return res.LastInsertId()
}

// UserByEmail returns the id, password hash, and role for email.
func (s *Store) UserByEmail(email string) (id int64, passwordHash, role string, err error) {
	err = s.db.QueryRow(
		`SELECT id, password_hash, role FROM users WHERE email = ?`, email,
	).Scan(&id, &passwordHash, &role)
	if err != nil {
		return 0, "", "", fmt.Errorf("lookup user %q: %w", email, err)
	}
	return id, passwordHash, role, nil
}

// CreateSession inserts a new session row.
func (s *Store) CreateSession(token string, userID int64, expiresAt time.Time) error {
	_, err := s.db.Exec(
		`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		token, userID, expiresAt.UTC().Format(time.RFC3339), nowRFC3339(),
	)
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

// SessionByToken returns the user id and expiry for token.
func (s *Store) SessionByToken(token string) (userID int64, expiresAt time.Time, err error) {
	var expStr string
	err = s.db.QueryRow(
		`SELECT user_id, expires_at FROM sessions WHERE token = ?`, token,
	).Scan(&userID, &expStr)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("lookup session: %w", err)
	}
	expiresAt, err = time.Parse(time.RFC3339, expStr)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("parse session expiry %q: %w", expStr, err)
	}
	return userID, expiresAt, nil
}

// DeleteSession removes a session row. Deleting a token that doesn't exist is
// not an error — logout is idempotent, same as cancelActive for deploys.
func (s *Store) DeleteSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

// InsertAuditLog appends one audit_log row. userID is nil for actions with no
// identified actor, e.g. a failed login against an unknown email.
func (s *Store) InsertAuditLog(userID *int64, action, target string) error {
	var uid any
	if userID != nil {
		uid = *userID
	}
	_, err := s.db.Exec(
		`INSERT INTO audit_log (user_id, action, target, at) VALUES (?, ?, ?, ?)`,
		uid, action, target, nowRFC3339(),
	)
	if err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}
