package store

import (
	"database/sql"
	"encoding/json"
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

// HasUsers reports whether any account exists. Signup is a first-run
// bootstrap and closes once this is true.
func (s *Store) HasUsers() (bool, error) {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return false, fmt.Errorf("count users: %w", err)
	}
	return n > 0, nil
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

// GetPrograms returns all programs.
func (s *Store) GetPrograms() ([]map[string]any, error) {
	rows, err := s.db.Query(
		`SELECT id, name, platform, created_by, created_at, updated_at FROM programs ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("query programs: %w", err)
	}
	defer rows.Close()

	var programs []map[string]any
	for rows.Next() {
		var id int64
		var name, platform string
		var createdBy *int64
		var createdAt, updatedAt string

		if err := rows.Scan(&id, &name, &platform, &createdBy, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan program: %w", err)
		}

		prog := map[string]any{
			"id":         id,
			"name":       name,
			"platform":   platform,
			"created_by": createdBy,
			"created_at": createdAt,
			"updated_at": updatedAt,
		}
		programs = append(programs, prog)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate programs: %w", err)
	}
	return programs, nil
}

// GetProgramByID returns a program by id, or an error if not found.
func (s *Store) GetProgramByID(id int64) (map[string]any, error) {
	var name, platform, createdAt, updatedAt string
	var createdBy *int64

	err := s.db.QueryRow(
		`SELECT id, name, platform, created_by, created_at, updated_at FROM programs WHERE id = ?`,
		id,
	).Scan(&id, &name, &platform, &createdBy, &createdAt, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("program %d not found", id)
		}
		return nil, fmt.Errorf("lookup program %d: %w", id, err)
	}

	return map[string]any{
		"id":         id,
		"name":       name,
		"platform":   platform,
		"created_by": createdBy,
		"created_at": createdAt,
		"updated_at": updatedAt,
	}, nil
}

// GetProgramVersions returns all versions for a program.
func (s *Store) GetProgramVersions(programID int64) ([]map[string]any, error) {
	rows, err := s.db.Query(
		`SELECT id, program_id, version, spec_json, author, created_at FROM program_versions WHERE program_id = ? ORDER BY version DESC`,
		programID,
	)
	if err != nil {
		return nil, fmt.Errorf("query program versions: %w", err)
	}
	defer rows.Close()

	var versions []map[string]any
	for rows.Next() {
		var id, pID, version int64
		var specJSON string
		var author *int64
		var createdAt string

		if err := rows.Scan(&id, &pID, &version, &specJSON, &author, &createdAt); err != nil {
			return nil, fmt.Errorf("scan program version: %w", err)
		}

		ver := map[string]any{
			"id":         id,
			"program_id": pID,
			"version":    version,
			"author":     author,
			"created_at": createdAt,
		}
		versions = append(versions, ver)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate versions: %w", err)
	}
	return versions, nil
}

// GetProgramVersion returns a specific program version.
func (s *Store) GetProgramVersion(versionID int64) (map[string]any, error) {
	var id, programID, version int64
	var specJSON string
	var author *int64
	var createdAt string

	err := s.db.QueryRow(
		`SELECT id, program_id, version, spec_json, author, created_at FROM program_versions WHERE id = ?`,
		versionID,
	).Scan(&id, &programID, &version, &specJSON, &author, &createdAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("program version %d not found", versionID)
		}
		return nil, fmt.Errorf("lookup program version %d: %w", versionID, err)
	}

	// Parse spec_json to return as an object, not a string
	var specObj any
	if err := json.Unmarshal([]byte(specJSON), &specObj); err != nil {
		return nil, fmt.Errorf("parse spec json: %w", err)
	}

	return map[string]any{
		"id":         id,
		"program_id": programID,
		"version":    version,
		"spec_json":  specObj,
		"author":     author,
		"created_at": createdAt,
	}, nil
}

// UpdateProgramTimestamp updates the updated_at field for a program.
func (s *Store) UpdateProgramTimestamp(programID int64) error {
	_, err := s.db.Exec(
		`UPDATE programs SET updated_at = ? WHERE id = ?`,
		nowRFC3339(), programID,
	)
	if err != nil {
		return fmt.Errorf("update program timestamp: %w", err)
	}
	return nil
}
