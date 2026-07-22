package sim

import "sync"

// Faults holds the mockbot's injectable fault state, mutated by POST /_fault
// and read by the mission executor. The zero value is the healthy state.
// Safe for concurrent use.
type Faults struct {
	mu          sync.Mutex
	estopped    bool
	nodeErrorID string
	stalled     bool
}

// SetEstop arms or clears the E-Stop. While set, the executor halts the
// active run and refuses to start new ones.
func (f *Faults) SetEstop(v bool) {
	f.mu.Lock()
	f.estopped = v
	f.mu.Unlock()
}

// Estopped reports whether E-Stop is currently engaged.
func (f *Faults) Estopped() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.estopped
}

// SetNodeError arms a one-shot failure for the given node id. Pass "" to
// disarm without firing.
func (f *Faults) SetNodeError(nodeID string) {
	f.mu.Lock()
	f.nodeErrorID = nodeID
	f.mu.Unlock()
}

// NodeErrorFor reports whether nodeID is currently armed to fail, and
// disarms it — one-shot, so the fault fires exactly once even if the mission
// visits the node again in a retry.
func (f *Faults) NodeErrorFor(nodeID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.nodeErrorID != "" && f.nodeErrorID == nodeID {
		f.nodeErrorID = ""
		return true
	}
	return false
}

// SetStalled arms or clears the "stall" fault: while set, the executor stops
// publishing status without closing the connection.
func (f *Faults) SetStalled(v bool) {
	f.mu.Lock()
	f.stalled = v
	f.mu.Unlock()
}

// Stalled reports whether the status feed is currently stalled.
func (f *Faults) Stalled() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.stalled
}

// Clear resets every fault to the healthy state.
func (f *Faults) Clear() {
	f.mu.Lock()
	f.estopped = false
	f.nodeErrorID = ""
	f.stalled = false
	f.mu.Unlock()
}
