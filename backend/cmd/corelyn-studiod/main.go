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
	"corelynstudio/backend/internal/rosbridge"
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
	rosURL := flag.String("rosbridge", "", "rosbridge WebSocket URL, e.g. ws://127.0.0.1:9090 (optional)")
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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// The daemon, not the renderer, owns the robot link (spec D2). With no
	// --rosbridge URL the API still serves; deploys simply have nowhere to go.
	var ros *rosbridge.Client
	if *rosURL != "" {
		ros = rosbridge.New(*rosURL)
	}

	srv := api.New(api.Deps{Store: st, Defs: defs, Ros: ros})

	if ros != nil {
		go func() {
			// Connect reconnects with backoff internally and only returns
			// once ctx is cancelled.
			if err := ros.Connect(ctx); err != nil && ctx.Err() == nil {
				slog.Error("rosbridge connect", "error", err)
			}
		}()
	}

	// Daemon binds 127.0.0.1 only — never 0.0.0.0.
	httpSrv := &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", *port),
		Handler: srv,
	}

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
