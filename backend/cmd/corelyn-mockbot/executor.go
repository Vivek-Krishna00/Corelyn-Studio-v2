package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"corelynstudio/backend/internal/mission"
	"corelynstudio/backend/internal/sim"
)

const (
	topicDeploy = "/mission/deploy"
	topicStatus = "/mission/status"

	// defaultNodeDuration is used for every node type that isn't a
	// wait_delay or a motion node (spec §8 "everything else 800ms").
	defaultNodeDuration = 800 * time.Millisecond

	// lowBatteryPct is the auto-pause threshold (spec §8.1 "drain battery
	// below threshold → auto-pause, operator alert").
	//
	// ponytail: one flat threshold, no hysteresis. Add a resume threshold if
	// a real pack's voltage sag starts flapping the pause.
	lowBatteryPct = 20.0
)

// statusMsg mirrors the daemon's /ws/mission/status shape (spec §4.3) —
// mockbot publishes the same {node_id,status} pair over rosbridge.
type statusMsg struct {
	NodeID string `json:"node_id"`
	Status string `json:"status"`
}

// executor walks a mission's topological_order over rosbridge, one mission
// at a time, honouring injected faults as it goes.
type executor struct {
	ros    *rosServer
	amr    *sim.AMR
	faults *sim.Faults
	speed  float64 // multiplier: real_duration / speed

	mu      sync.Mutex
	running bool
}

func newExecutor(ros *rosServer, amr *sim.AMR, faults *sim.Faults, speed float64) *executor {
	if speed <= 0 {
		speed = 1
	}
	return &executor{ros: ros, amr: amr, faults: faults, speed: speed}
}

// deploy parses specJSON and runs it in a new goroutine. A mission already
// running, or E-Stop currently engaged, causes the deploy to be silently
// refused — matching spec §8.1 "refuse deploys until cleared" and the
// daemon's own "one active run" rule, which this mirrors defensively.
func (e *executor) deploy(specJSON string) {
	if e.faults.Estopped() {
		slog.Warn("mockbot: deploy refused, E-Stop engaged")
		return
	}

	e.mu.Lock()
	if e.running {
		e.mu.Unlock()
		slog.Warn("mockbot: deploy refused, mission already running")
		return
	}
	e.running = true
	e.mu.Unlock()

	var spec mission.Spec
	if err := json.Unmarshal([]byte(specJSON), &spec); err != nil {
		slog.Error("mockbot: malformed mission spec", "error", err)
		e.mu.Lock()
		e.running = false
		e.mu.Unlock()
		return
	}

	go e.run(spec)
}

func (e *executor) run(spec mission.Spec) {
	defer func() {
		e.mu.Lock()
		e.running = false
		e.mu.Unlock()
	}()

	ctx := context.Background()
	byID := make(map[string]mission.Node, len(spec.Nodes))
	for _, n := range spec.Nodes {
		byID[n.ID] = n
	}

	for _, id := range spec.TopologicalOrder {
		// The __mission__/estop event itself is published once by the
		// /_fault handler that engaged it (main.go) — here we just stop
		// advancing the mission.
		if e.faults.Estopped() {
			return
		}
		if e.pauseIfFlat(ctx) {
			return
		}

		n := byID[id]
		e.publish(ctx, id, "running")

		if !e.sleepUnlessHalted(e.nodeDuration(n)) {
			return
		}
		if e.faults.NodeErrorFor(id) {
			e.publish(ctx, id, "error")
			return
		}

		e.publish(ctx, id, "done")
	}

	// Draining flat on the last node must pause, not complete.
	if e.pauseIfFlat(ctx) {
		return
	}
	e.publish(ctx, "__mission__", "complete")
}

// waitIdle blocks until no mission is executing, or timeout elapses. The
// E-Stop control endpoint uses it so that a 200 means "the robot has actually
// stopped", not "the stop request was noted" — otherwise a caller that stops
// and immediately redeploys races the halt.
func (e *executor) waitIdle(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		e.mu.Lock()
		running := e.running
		e.mu.Unlock()
		if !running {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return false
}

// sleepUnlessHalted waits out a node's duration in slices, aborting the moment
// an E-Stop is engaged. A real E-Stop cuts motion immediately — it does not
// let the current move finish — and the daemon must be free to accept a new
// deploy as soon as the stop is cleared.
func (e *executor) sleepUnlessHalted(d time.Duration) bool {
	const slice = 20 * time.Millisecond
	deadline := time.Now().Add(d)
	for {
		if e.faults.Estopped() {
			return false
		}
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return true
		}
		time.Sleep(min(remaining, slice))
	}
}

// pauseIfFlat halts the mission when the battery is below threshold, alerting
// the operator first. It reports whether the run was paused. The run is not
// resumed automatically — the operator charges and redeploys.
func (e *executor) pauseIfFlat(ctx context.Context) bool {
	if e.amr.Battery() >= lowBatteryPct {
		return false
	}
	e.publish(ctx, "__mission__", "low_battery")
	e.publish(ctx, "__mission__", "paused")
	return true
}

// publish sends a status event over rosbridge, unless the "stall" fault is
// engaged — in which case the message is dropped without closing the
// socket, so the daemon sees a live-but-silent feed rather than a hard
// disconnect (spec §8.1 "distinguishing feed lost from still running but
// quiet").
func (e *executor) publish(ctx context.Context, nodeID, status string) {
	if e.faults.Stalled() {
		return
	}
	e.ros.publish(ctx, topicStatus, statusMsg{NodeID: nodeID, Status: status})
}

// nodeDuration derives how long a node takes, scaled by the --speed
// multiplier so tests don't wait on wall-clock robot time.
func (e *executor) nodeDuration(n mission.Node) time.Duration {
	var base time.Duration
	switch n.Type {
	case "wait_delay":
		base = time.Duration(paramFloat(n.Params, "duration_ms", 800)) * time.Millisecond
	case "move_forward":
		base = e.amr.Move(paramFloat(n.Params, "distance", 0), paramFloat(n.Params, "linear_velocity", 0))
	case "move_backward":
		base = e.amr.Move(-paramFloat(n.Params, "distance", 0), paramFloat(n.Params, "linear_velocity", 0))
	default:
		base = defaultNodeDuration
	}
	return time.Duration(float64(base) / e.speed)
}

// paramFloat reads a numeric param out of the heterogeneous params map,
// returning def if absent or not a number (JSON numbers decode as float64).
func paramFloat(params map[string]any, key string, def float64) float64 {
	v, ok := params[key]
	if !ok {
		return def
	}
	f, ok := v.(float64)
	if !ok {
		return def
	}
	return f
}
