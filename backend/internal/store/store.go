// Package store handles SQLite access with embedded migrations.
package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Store wraps a database connection and handles migrations.
type Store struct {
	db *sql.DB
}

// Open opens or creates the SQLite database at the given path and runs migrations.
func Open(path string) (*Store, error) {
	// Open or create the database
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Enable foreign keys and WAL mode
	if _, err := db.Exec("PRAGMA foreign_keys=ON"); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("set journal mode: %w", err)
	}

	// Create the schema_migrations table if it doesn't exist
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		)
	`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create migrations table: %w", err)
	}

	// Run migrations
	s := &Store{db: db}
	if err := s.runMigrations(); err != nil {
		db.Close()
		return nil, err
	}

	return s, nil
}

// runMigrations applies all migration files in lexical order.
func (s *Store) runMigrations() error {
	// List all migration files
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations directory: %w", err)
	}

	// Sort by filename to ensure deterministic order
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	// Apply each migration
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		version := entry.Name()
		sqlBytes, err := migrationsFS.ReadFile("migrations/" + version)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", version, err)
		}

		// Check if migration has already been applied
		var alreadyApplied bool
		err = s.db.QueryRow(
			"SELECT 1 FROM schema_migrations WHERE version = ?",
			version,
		).Scan(&alreadyApplied)
		if err == nil {
			// Migration already applied
			continue
		}
		if err != sql.ErrNoRows {
			return fmt.Errorf("check migration status %s: %w", version, err)
		}

		// Apply the migration in a transaction
		tx, err := s.db.BeginTx(context.Background(), nil)
		if err != nil {
			return fmt.Errorf("begin transaction for %s: %w", version, err)
		}

		if _, err := tx.Exec(string(sqlBytes)); err != nil {
			tx.Rollback()
			return fmt.Errorf("execute migration %s: %w", version, err)
		}

		if _, err := tx.Exec(
			"INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))",
			version,
		); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %s: %w", version, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", version, err)
		}
	}

	return nil
}

// DB returns the underlying database connection for direct access.
func (s *Store) DB() *sql.DB {
	return s.db
}

// Close closes the database connection.
func (s *Store) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}
