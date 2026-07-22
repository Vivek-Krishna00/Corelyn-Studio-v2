// Command corelyn-mockbot is a standalone rosbridge-protocol AMR simulator
// with fault injection, used for development, demos, and CI in place of real
// hardware. It speaks the same rosbridge v2 protocol a real robot's
// rosbridge_suite would, implemented against the published spec — not
// against internal/rosbridge — so both sides are validated independently.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"corelynstudio/backend/internal/sim"
)

func main() {
	if err := run(); err != nil {
		slog.Error("corelyn-mockbot exited", "error", err)
		os.Exit(1)
	}
}

func run() error {
	port := flag.Int("port", 0, "port to bind on 127.0.0.1 (required); serves the rosbridge WS at / and fault control at /_fault")
	speed := flag.Float64("speed", 1.0, "simulated-time multiplier; higher runs missions faster")
	flag.Parse()

	if *port == 0 {
		return fmt.Errorf("--port is required")
	}

	amr := sim.NewAMR()
	faults := &sim.Faults{}

	var exec *executor
	ros := newRosServer(func(specJSON string) { exec.deploy(specJSON) })
	exec = newExecutor(ros, amr, faults, *speed)

	mux := http.NewServeMux()
	mux.HandleFunc("/", ros.handleWS)
	mux.HandleFunc("POST /_fault", newFaultHandler(ros, amr, faults))

	// Loopback only, matching the daemon (spec "Daemon binds 127.0.0.1 only").
	httpSrv := &http.Server{
		Addr:    fmt.Sprintf("127.0.0.1:%d", *port),
		Handler: mux,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		slog.Info("corelyn-mockbot listening", "addr", httpSrv.Addr, "speed", *speed)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		slog.Info("shutting down", "reason", "signal")
	case err := <-errCh:
		return fmt.Errorf("serve: %w", err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return httpSrv.Shutdown(shutdownCtx)
}

// faultRequest is the body of POST /_fault (spec §8.1).
type faultRequest struct {
	Fault  string  `json:"fault"`
	NodeID string  `json:"node_id,omitempty"`
	Pct    float64 `json:"pct,omitempty"`
}

func newFaultHandler(ros *rosServer, amr *sim.AMR, faults *sim.Faults) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req faultRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, fmt.Sprintf(`{"detail":"malformed fault request: %s"}`, err), http.StatusBadRequest)
			return
		}

		switch req.Fault {
		case "disconnect":
			ros.closeAll()
		case "estop":
			faults.SetEstop(true)
			ros.publish(r.Context(), topicStatus, statusMsg{NodeID: "__mission__", Status: "estop"})
		case "node_error":
			faults.SetNodeError(req.NodeID)
		case "battery":
			amr.SetBattery(req.Pct)
		case "stall":
			faults.SetStalled(true)
		case "clear":
			faults.Clear()
		default:
			http.Error(w, fmt.Sprintf(`{"detail":"unknown fault %q"}`, req.Fault), http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}
