package mission

// TopologicalSort orders nodes by dependency using Kahn's algorithm.
//
// On a cycle it deliberately does NOT error: unvisited nodes are appended in
// their original array order. This mirrors missionSpec.js:27 and is asserted by
// the cycle.json golden fixture. Graph validation is a separate concern — the
// serializer stays permissive. Do not "fix" this.
//
// Every loop walks the nodes/conns slices rather than the maps: Go randomises
// map iteration and the JS original walks arrays, so iterating a map here would
// make the output nondeterministic and flake the fixture test.
func TopologicalSort(nodes []Node, conns []Connection) []string {
	adj := make(map[string][]string, len(nodes))
	inDeg := make(map[string]int, len(nodes))
	for _, n := range nodes {
		adj[n.ID] = nil
		inDeg[n.ID] = 0
	}
	for _, c := range conns {
		if _, ok := adj[c.ToNode]; !ok {
			continue // matches the JS guard: unknown to_node edges are dropped
		}
		adj[c.FromNode] = append(adj[c.FromNode], c.ToNode)
		inDeg[c.ToNode]++
	}

	queue := make([]string, 0, len(nodes))
	for _, n := range nodes { // array order, not map order — determinism
		if inDeg[n.ID] == 0 {
			queue = append(queue, n.ID)
		}
	}

	order := make([]string, 0, len(nodes))
	seen := make(map[string]bool, len(nodes))
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		order = append(order, id)
		seen[id] = true
		for _, nb := range adj[id] {
			inDeg[nb]--
			if inDeg[nb] == 0 {
				queue = append(queue, nb)
			}
		}
	}
	for _, n := range nodes {
		if !seen[n.ID] {
			order = append(order, n.ID)
		}
	}
	return order
}
