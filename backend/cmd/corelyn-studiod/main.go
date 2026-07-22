// Command corelyn-studiod is the CorelynStudio daemon: it serves the HTTP+WS
// contract described in spec §4 and persists to SQLite. Electron spawns it as
// a sidecar on an OS-assigned free port.
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"corelynstudio/backend/internal/api"
	"corelynstudio/backend/internal/nodes"
	"corelynstudio/backend/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("corelyn-studiod exited", "error", err)
		os.Exit(1)
	}
}

func run() error {
	port := flag.Int("port", 0, "port to bind on 127.0.0.1 (required)")
	dbPath := flag.String("db", "", "path to the SQLite database file (required)")
	_ = flag.String("rosbridge", "", "rosbridge WebSocket URL (optional; wired up in Task B4)")
	flag.Parse()

	if *port == 0 {
		return fmt.Errorf("--port is required")
	}
	if *dbPath == "" {
		return fmt.Errorf("--db is required")
	}

	defs, err := nodes.Load()
	if err != nil {
		return fmt.Errorf("load node definitions: %w", err)
	}

	st, err := store.Open(*dbPath)
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer st.Close()

	srv := api.New(api.Deps{Store: st, Defs: defs})

	// Daemon binds 127.0.0.1 only — never 0.0.0.0.
	httpSrv := &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", *port),
		Handler: srv,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// An orphaned sidecar must die when Electron is killed hard: Electron
	// closes our stdin, so EOF on it is as much a shutdown signal as
	// SIGINT/SIGTERM.
	stdinEOF := make(chan struct{})
	go func() {
		defer close(stdinEOF)
		io.Copy(io.Discard, bufio.NewReader(os.Stdin))
	}()

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", httpSrv.Addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		slog.Info("shutting down", "reason", "signal")
	case <-stdinEOF:
		slog.Info("shutting down", "reason", "stdin closed")
	case err := <-errCh:
		return fmt.Errorf("serve: %w", err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return httpSrv.Shutdown(shutdownCtx)
}
