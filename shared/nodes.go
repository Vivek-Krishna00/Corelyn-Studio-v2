// Package shared exposes the files that both the Go backend and the JS
// frontend read, so there is exactly one copy of each in the repo.
//
// It lives here rather than under backend/ because //go:embed cannot reference
// paths outside its own package directory, and the JS side imports
// ../shared/nodes.json by path. One file, two readers — spec §5, decision D8.
package shared

import _ "embed"

//go:embed nodes.json
var NodesJSON []byte
