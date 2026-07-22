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
