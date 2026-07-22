package nodes_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"corelynstudio/backend/internal/nodes"
)

func load(t *testing.T) *nodes.Defs {
	t.Helper()
	d, err := nodes.Load()
	if err != nil {
		t.Fatalf("Load(): %v", err)
	}
	return d
}

func TestLoad(t *testing.T) {
	d := load(t)

	if len(d.Nodes) != 24 {
		t.Errorf("got %d node types, want 24", len(d.Nodes))
	}
	if len(d.Categories) != 6 {
		t.Errorf("got %d categories, want 6", len(d.Categories))
	}

	catIDs := make([]string, len(d.Categories))
	for i, c := range d.Categories {
		catIDs[i] = c.ID
	}
	for _, n := range d.Nodes {
		if n.Type == "" || n.Label == "" {
			t.Errorf("node %+v is missing type or label", n)
		}
		if !slices.Contains(catIDs, n.Category) {
			t.Errorf("node %q has category %q, not in %v", n.Type, n.Category, catIDs)
		}
		if len(n.Ports) == 0 {
			t.Errorf("node %q has no ports", n.Type)
		}
		for name, p := range n.Params {
			switch p.Type {
			case "number", "text", "boolean":
			case "select":
				if len(p.Options) == 0 {
					t.Errorf("node %q param %q is a select with no options", n.Type, name)
				}
			default:
				t.Errorf("node %q param %q has unknown type %q", n.Type, name, p.Type)
			}
			if p.Default == nil {
				t.Errorf("node %q param %q has no default", n.Type, name)
			}
		}
		if _, ok := d.Get(n.Type); !ok {
			t.Errorf("Get(%q) missed a type that Load returned", n.Type)
		}
	}
}

func TestDefaultsValidate(t *testing.T) {
	d := load(t)
	for _, n := range d.Nodes {
		t.Run(n.Type, func(t *testing.T) {
			params := make(map[string]any, len(n.Params))
			for name, p := range n.Params {
				params[name] = p.Default
			}
			if errs := d.ValidateParams(n.Type, params); len(errs) != 0 {
				t.Errorf("declared defaults rejected: %v", errs)
			}
		})
	}
}

func TestValidateParams(t *testing.T) {
	d := load(t)

	// move_forward: distance (number), linear_velocity (number)
	// end:          terminate_status (select), trigger_callback_hook (text)
	// wait_delay:   duration_ms (number), non_blocking_execution (boolean)
	tests := []struct {
		name     string
		nodeType string
		params   map[string]any
		want     []string // expected ValidationError.Error() strings, in order
	}{
		{
			name:     "happy path",
			nodeType: "move_forward",
			params:   map[string]any{"distance": 1.0, "linear_velocity": 0.5},
		},
		{
			name:     "unknown node type",
			nodeType: "teleport",
			params:   map[string]any{},
			want:     []string{`unknown node type "teleport"`},
		},
		{
			name:     "missing param",
			nodeType: "move_forward",
			params:   map[string]any{"distance": 1.0},
			want:     []string{"linear_velocity: missing required param"},
		},
		{
			name:     "nil params reports every field",
			nodeType: "move_forward",
			params:   nil,
			want: []string{
				"distance: missing required param",
				"linear_velocity: missing required param",
			},
		},
		{
			name:     "number given a string",
			nodeType: "move_forward",
			params:   map[string]any{"distance": "1", "linear_velocity": 0.5},
			want:     []string{"distance: expected a number, got string"},
		},
		{
			name:     "boolean given a number",
			nodeType: "wait_delay",
			params:   map[string]any{"duration_ms": 2000.0, "non_blocking_execution": 1.0},
			want:     []string{"non_blocking_execution: expected a boolean, got float64"},
		},
		{
			name:     "text given a bool",
			nodeType: "end",
			params:   map[string]any{"terminate_status": "success", "trigger_callback_hook": true},
			want:     []string{"trigger_callback_hook: expected text, got bool"},
		},
		{
			name:     "select outside its options",
			nodeType: "end",
			params:   map[string]any{"terminate_status": "explode", "trigger_callback_hook": "/x"},
			want:     []string{`terminate_status: "explode" is not one of [success idle emergency_stop]`},
		},
		{
			name:     "undeclared extra params are permitted",
			nodeType: "move_forward",
			params:   map[string]any{"distance": 1.0, "linear_velocity": 0.5, "vibes": "good"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			errs := d.ValidateParams(tt.nodeType, tt.params)
			got := make([]string, len(errs))
			for i, e := range errs {
				got[i] = e.Error()
			}
			if !slices.Equal(got, tt.want) {
				t.Errorf("ValidateParams() = %#v, want %#v", got, tt.want)
			}
		})
	}
}

// TestFixturesValidate ties the two halves together: every golden fixture must
// still validate against the shared definitions.
func TestFixturesValidate(t *testing.T) {
	d := load(t)
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
			var spec struct {
				Nodes []struct {
					ID     string         `json:"id"`
					Type   string         `json:"type"`
					Params map[string]any `json:"params"`
				} `json:"nodes"`
			}
			if err := json.Unmarshal(raw, &spec); err != nil {
				t.Fatal(err)
			}
			for _, n := range spec.Nodes {
				if errs := d.ValidateParams(n.Type, n.Params); len(errs) != 0 {
					t.Errorf("node %s (%s): %v", n.ID, n.Type, errs)
				}
			}
		})
	}
}
