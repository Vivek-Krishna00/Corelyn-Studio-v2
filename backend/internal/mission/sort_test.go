package mission_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"corelynstudio/backend/internal/mission"
)

func nodesOf(ids ...string) []mission.Node {
	out := make([]mission.Node, len(ids))
	for i, id := range ids {
		out[i] = mission.Node{ID: id}
	}
	return out
}

func edge(from, to string) mission.Connection {
	return mission.Connection{ID: "c_" + from + "_" + to, FromNode: from, FromPort: "out", ToNode: to, ToPort: "in"}
}

func TestTopologicalSort(t *testing.T) {
	tests := []struct {
		name  string
		nodes []mission.Node
		conns []mission.Connection
		want  []string
	}{
		{
			name:  "empty",
			nodes: nil,
			conns: nil,
			want:  []string{},
		},
		{
			name:  "single node",
			nodes: nodesOf("a"),
			want:  []string{"a"},
		},
		{
			name:  "linear chain",
			nodes: nodesOf("a", "b", "c"),
			conns: []mission.Connection{edge("a", "b"), edge("b", "c")},
			want:  []string{"a", "b", "c"},
		},
		{
			name:  "linear chain declared out of order",
			nodes: nodesOf("c", "b", "a"),
			conns: []mission.Connection{edge("a", "b"), edge("b", "c")},
			want:  []string{"a", "b", "c"},
		},
		{
			name:  "diamond",
			nodes: nodesOf("a", "b", "c", "d"),
			conns: []mission.Connection{edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")},
			want:  []string{"a", "b", "c", "d"},
		},
		{
			// The quirk: a pure cycle has no zero-in-degree node, so Kahn's
			// queue starts empty and every node is appended in array order.
			name:  "pure cycle keeps every node in array order",
			nodes: nodesOf("a", "b", "c"),
			conns: []mission.Connection{edge("a", "b"), edge("b", "c"), edge("c", "a")},
			want:  []string{"a", "b", "c"},
		},
		{
			name:  "cycle plus disconnected node",
			nodes: nodesOf("a", "b", "c", "d"),
			conns: []mission.Connection{edge("a", "b"), edge("b", "c"), edge("c", "a")},
			want:  []string{"d", "a", "b", "c"},
		},
		{
			name:  "connection to an unknown node is skipped",
			nodes: nodesOf("a", "b"),
			conns: []mission.Connection{edge("a", "ghost"), edge("a", "b")},
			want:  []string{"a", "b"},
		},
		{
			name:  "connection from an unknown node still counts against its target",
			nodes: nodesOf("a", "b"),
			conns: []mission.Connection{edge("ghost", "b"), edge("a", "b")},
			want:  []string{"a", "b"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mission.TopologicalSort(tt.nodes, tt.conns)
			if !slices.Equal(got, tt.want) {
				t.Errorf("TopologicalSort() = %v, want %v", got, tt.want)
			}
			if len(got) != len(tt.nodes) {
				t.Errorf("dropped nodes: got %d ids for %d nodes", len(got), len(tt.nodes))
			}
		})
	}
}

// TestTopologicalSortMatchesFixtures is the real regression gate: the Go sort
// must reproduce, id for id, the order that the shipped JS emitted.
func TestTopologicalSortMatchesFixtures(t *testing.T) {
	files, err := filepath.Glob("../../../shared/testdata/*.json")
	if err != nil || len(files) == 0 {
		t.Fatalf("no fixtures found: %v", err)
	}
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			raw, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
			var spec mission.Spec
			if err := json.Unmarshal(raw, &spec); err != nil {
				t.Fatal(err)
			}
			got := mission.TopologicalSort(spec.Nodes, spec.Connections)
			if !slices.Equal(got, spec.TopologicalOrder) {
				t.Errorf("order = %v, want %v", got, spec.TopologicalOrder)
			}
		})
	}
}

// TestTopologicalSortIsDeterministic guards the array-order iteration: with map
// iteration the cycle fixture would shuffle between runs.
func TestTopologicalSortIsDeterministic(t *testing.T) {
	n := nodesOf("a", "b", "c", "d", "e", "f", "g", "h")
	c := []mission.Connection{edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("d", "e")}
	want := mission.TopologicalSort(n, c)
	for i := range 200 {
		if got := mission.TopologicalSort(n, c); !slices.Equal(got, want) {
			t.Fatalf("run %d differs: %v != %v", i, got, want)
		}
	}
}
