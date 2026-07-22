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

		n := byID[id]
		e.publish(ctx, id, "running")

		d := e.nodeDuration(n)
		time.Sleep(d)

		if e.faults.Estopped() {
			return
		}
		if e.faults.NodeErrorFor(id) {
			e.publish(ctx, id, "error")
			return
		}

		e.publish(ctx, id, "done")
	}

	e.publish(ctx, "__mission__", "complete")
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
