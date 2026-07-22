package mission_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"corelynstudio/backend/internal/mission"
	"corelynstudio/backend/internal/nodes"
)

func TestGoldenFixturesRoundTrip(t *testing.T) {
	files, err := filepath.Glob("../../../shared/testdata/*.json")
	if err != nil || len(files) == 0 {
		t.Fatalf("no fixtures found: %v", err)
	}
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			original, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}

			var spec mission.Spec
			if err := json.Unmarshal(original, &spec); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			got, err := json.Marshal(&spec)
			if err != nil {
				t.Fatal(err)
			}

			// Compare semantically — key order and whitespace are not contract.
			var a, b any
			_ = json.Unmarshal(original, &a)
			_ = json.Unmarshal(got, &b)
			if !reflect.DeepEqual(a, b) {
				t.Errorf("round-trip altered the spec\n orig: %s\n  got: %s", original, got)
			}
		})
	}
}

func TestSpecValidate(t *testing.T) {
	defs, err := nodes.Load()
	if err != nil {
		t.Fatal(err)
	}

	fwd := func(id string) mission.Node {
		return mission.Node{
			ID: id, Type: "move_forward", Label: "Move Forward", Category: "motion",
			Params: map[string]any{"distance": 1.0, "linear_velocity": 0.5},
		}
	}

	tests := []struct {
		name string
		spec mission.Spec
		want []string
	}{
		{
			name: "valid",
			spec: mission.Spec{SpecVersion: "1.0.0", Nodes: []mission.Node{fwd("a"), fwd("b")},
				Connections: []mission.Connection{{ID: "c1", FromNode: "a", ToNode: "b"}}},
		},
		{
			name: "wrong spec_version",
			spec: mission.Spec{SpecVersion: "2.0.0"},
			want: []string{`spec_version: unsupported spec_version "2.0.0", want "1.0.0"`},
		},
		{
			name: "duplicate node id",
			spec: mission.Spec{SpecVersion: "1.0.0", Nodes: []mission.Node{fwd("a"), fwd("a")}},
			want: []string{"node a: duplicate node id"},
		},
		{
			name: "bad param names the node and the field",
			spec: mission.Spec{SpecVersion: "1.0.0", Nodes: []mission.Node{
				{ID: "a", Type: "move_forward", Params: map[string]any{"distance": 1.0}}}},
			want: []string{"node a: linear_velocity: missing required param"},
		},
		{
			name: "dangling connection",
			spec: mission.Spec{SpecVersion: "1.0.0", Nodes: []mission.Node{fwd("a")},
				Connections: []mission.Connection{{ID: "c1", FromNode: "a", ToNode: "ghost"}}},
			want: []string{"node ghost: to_node: connection c1 references an unknown node"},
		},
		{
			// A cycle is legal input: the serializer is permissive by design.
			name: "cycle is not a validation error",
			spec: mission.Spec{SpecVersion: "1.0.0", Nodes: []mission.Node{fwd("a"), fwd("b")},
				Connections: []mission.Connection{
					{ID: "c1", FromNode: "a", ToNode: "b"},
					{ID: "c2", FromNode: "b", ToNode: "a"},
				}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errs := tt.spec.Validate(defs)
			got := make([]string, len(errs))
			for i, e := range errs {
				got[i] = e.Error()
			}
			if !slices.Equal(got, tt.want) {
				t.Errorf("Validate() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

// TestGoldenFixturesValidate: every fixture must pass validation, cycle included.
func TestGoldenFixturesValidate(t *testing.T) {
	defs, err := nodes.Load()
	if err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob("../../../shared/testdata/*.json")
	if len(files) == 0 {
		t.Fatal("no fixtures found")
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
			if errs := spec.Validate(defs); len(errs) != 0 {
				t.Errorf("fixture rejected: %v", errs)
			}
		})
	}
}
