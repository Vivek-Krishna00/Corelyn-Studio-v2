// Package mission holds the wire format for a mission spec: the JSON emitted
// today by src/ros/missionSpec.js and stored in SQLite. The shape is frozen —
// see spec §4.4 and the golden fixtures in shared/testdata/.
package mission

import (
	"fmt"

	"corelynstudio/backend/internal/nodes"
)

// Spec is the canonical mission wire format. spec_version stays "1.0.0".
type Spec struct {
	MissionID         string            `json:"mission_id"`
	SpecVersion       string            `json:"spec_version"`
	CreatedAt         string            `json:"created_at"`
	RobotRequirements RobotRequirements `json:"robot_requirements"`
	TopologicalOrder  []string          `json:"topological_order"`
	Nodes             []Node            `json:"nodes"`
	Connections       []Connection      `json:"connections"`
}

// RobotRequirements is derived from the node types present in the graph.
type RobotRequirements struct {
	MinBatteryPct        int      `json:"min_battery_pct"`
	RequiredCapabilities []string `json:"required_capabilities"`
}

// Node is one placed node. Params are heterogeneous per node type, so they stay
// an untyped map: a struct would silently drop keys it does not know, which is
// exactly the drift the golden-fixture test exists to catch.
type Node struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Label    string         `json:"label"`
	Category string         `json:"category"`
	Params   map[string]any `json:"params"`
	Position Position       `json:"position"`
}

// Position is in canvas coordinates, pre-rounded to integers by the JS side.
type Position struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// Connection is a directed edge between two node ports.
type Connection struct {
	ID       string `json:"id"`
	FromNode string `json:"from_node"`
	FromPort string `json:"from_port"`
	ToNode   string `json:"to_node"`
	ToPort   string `json:"to_port"`
}

// ValidationError is re-exported so callers need only import mission.
type ValidationError = nodes.ValidationError

// Validate checks the spec against the shared node definitions. It returns
// every problem found rather than the first, so the operator gets one useful
// message instead of a game of whack-a-mole.
//
// Graph shape (cycles, orphans) is deliberately NOT checked here — the
// serializer is permissive, see TopologicalSort.
func (s *Spec) Validate(defs *nodes.Defs) []ValidationError {
	var errs []ValidationError

	if s.SpecVersion != "1.0.0" {
		errs = append(errs, ValidationError{
			Field:   "spec_version",
			Message: fmt.Sprintf("unsupported spec_version %q, want \"1.0.0\"", s.SpecVersion),
		})
	}

	seen := make(map[string]bool, len(s.Nodes))
	for _, n := range s.Nodes {
		if n.ID == "" {
			errs = append(errs, ValidationError{Field: "id", Message: "node has no id"})
			continue
		}
		if seen[n.ID] {
			errs = append(errs, ValidationError{NodeID: n.ID, Message: "duplicate node id"})
			continue
		}
		seen[n.ID] = true

		for _, e := range defs.ValidateParams(n.Type, n.Params) {
			e.NodeID = n.ID
			errs = append(errs, e)
		}
	}

	for _, c := range s.Connections {
		if !seen[c.FromNode] {
			errs = append(errs, ValidationError{
				NodeID:  c.FromNode,
				Field:   "from_node",
				Message: fmt.Sprintf("connection %s references an unknown node", c.ID),
			})
		}
		if !seen[c.ToNode] {
			errs = append(errs, ValidationError{
				NodeID:  c.ToNode,
				Field:   "to_node",
				Message: fmt.Sprintf("connection %s references an unknown node", c.ID),
			})
		}
	}
	return errs
}
