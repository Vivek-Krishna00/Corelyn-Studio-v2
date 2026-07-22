// Package nodes loads the shared node-type definitions and validates mission
// node params against them.
package nodes

import (
	"encoding/json"
	"fmt"
	"slices"

	"corelynstudio/shared"
)

// Defs is the parsed contents of shared/nodes.json.
type Defs struct {
	Categories []Category `json:"categories"`
	Nodes      []Def      `json:"nodes"`

	byType map[string]*Def
}

// Category is a palette grouping with its display metadata.
type Category struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Color string `json:"color"`
}

// Def is a single node type.
type Def struct {
	Type     string           `json:"type"`
	Label    string           `json:"label"`
	Category string           `json:"category"`
	Icon     string           `json:"icon"`
	Color    string           `json:"color"`
	Ports    []Port           `json:"ports"`
	Params   map[string]Param `json:"params"`
}

// Port is a connection point on a node.
type Port struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Side  string `json:"side"`
}

// Param declares one editable field of a node type.
type Param struct {
	Label   string   `json:"label"`
	Type    string   `json:"type"` // number | text | select | boolean
	Options []string `json:"options,omitempty"`
	Default any      `json:"default"`
}

// ValidationError names one thing wrong with a mission, in terms the operator
// can act on. It is surfaced verbatim in the API's "detail" field.
type ValidationError struct {
	NodeID  string `json:"node_id,omitempty"`
	Field   string `json:"field,omitempty"`
	Message string `json:"message"`
}

func (e ValidationError) Error() string {
	switch {
	case e.NodeID != "" && e.Field != "":
		return fmt.Sprintf("node %s: %s: %s", e.NodeID, e.Field, e.Message)
	case e.NodeID != "":
		return fmt.Sprintf("node %s: %s", e.NodeID, e.Message)
	case e.Field != "":
		return fmt.Sprintf("%s: %s", e.Field, e.Message)
	}
	return e.Message
}

// Load parses the embedded shared/nodes.json.
func Load() (*Defs, error) {
	var d Defs
	if err := json.Unmarshal(shared.NodesJSON, &d); err != nil {
		return nil, fmt.Errorf("parse shared/nodes.json: %w", err)
	}
	d.byType = make(map[string]*Def, len(d.Nodes))
	for i := range d.Nodes {
		d.byType[d.Nodes[i].Type] = &d.Nodes[i]
	}
	return &d, nil
}

// Get returns the definition for a node type.
func (d *Defs) Get(nodeType string) (*Def, bool) {
	def, ok := d.byType[nodeType]
	return def, ok
}

// ValidateParams checks that every param the node type declares is present and
// carries the declared type. Params are decoded from JSON, so numbers arrive as
// float64.
//
// Undeclared extra keys are not an error: the serializer is permissive by
// design (spec §4.4) and rejecting them would break older stored specs.
func (d *Defs) ValidateParams(nodeType string, params map[string]any) []ValidationError {
	def, ok := d.Get(nodeType)
	if !ok {
		return []ValidationError{{Message: fmt.Sprintf("unknown node type %q", nodeType)}}
	}

	var errs []ValidationError
	// Iterate the definition's own param order via a stable sort of names so
	// the error list does not shuffle between runs (Go randomises map order).
	names := make([]string, 0, len(def.Params))
	for name := range def.Params {
		names = append(names, name)
	}
	slices.Sort(names)

	for _, name := range names {
		p := def.Params[name]
		v, present := params[name]
		if !present {
			errs = append(errs, ValidationError{Field: name, Message: "missing required param"})
			continue
		}
		if err := p.check(v); err != "" {
			errs = append(errs, ValidationError{Field: name, Message: err})
		}
	}
	return errs
}

// check returns "" when v satisfies the param's declared type.
func (p Param) check(v any) string {
	switch p.Type {
	case "number":
		if _, ok := v.(float64); !ok {
			return fmt.Sprintf("expected a number, got %T", v)
		}
	case "text":
		if _, ok := v.(string); !ok {
			return fmt.Sprintf("expected text, got %T", v)
		}
	case "boolean":
		if _, ok := v.(bool); !ok {
			return fmt.Sprintf("expected a boolean, got %T", v)
		}
	case "select":
		s, ok := v.(string)
		if !ok {
			return fmt.Sprintf("expected one of %v, got %T", p.Options, v)
		}
		if !slices.Contains(p.Options, s) {
			return fmt.Sprintf("%q is not one of %v", s, p.Options)
		}
	default:
		// ponytail: unknown declared types pass. nodes.json is ours; a typo
		// there should not brick deploys. Tighten if the schema grows a
		// validated type we cannot check here.
	}
	return ""
}
