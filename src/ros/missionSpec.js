const NODE_DEFS_REF = typeof NODE_DEFS !== "undefined" ? NODE_DEFS : [];

export function getNodeDef(type, defs) {
  return (defs || NODE_DEFS_REF).find(n => n.type === type);
}

export function topologicalSort(nodes, connections) {
  const adj = {};
  const inDeg = {};
  nodes.forEach(n => { adj[n.id] = []; inDeg[n.id] = 0; });
  connections.forEach(c => {
    if (adj[c.toNode]) {
      adj[c.fromNode].push(c.toNode);
      inDeg[c.toNode] = (inDeg[c.toNode] || 0) + 1;
    }
  });
  const queue = nodes.filter(n => (inDeg[n.id] || 0) === 0).map(n => n.id);
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    (adj[id] || []).forEach(nei => {
      inDeg[nei]--;
      if (inDeg[nei] === 0) queue.push(nei);
    });
  }
  if (order.length !== nodes.length) {
    const remaining = nodes.filter(n => !order.includes(n.id)).map(n => n.id);
    remaining.forEach(id => {
      order.push(id);
    });
  }
  return order;
}

export function generateMissionSpec(flow, defs) {
  const order = topologicalSort(flow.nodes, flow.connections);
  return {
    mission_id: `mission_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    spec_version: "1.0.0",
    created_at: new Date().toISOString(),
    robot_requirements: {
      min_battery_pct: 15,
      required_capabilities: extractCapabilities(flow.nodes, defs),
    },
    topological_order: order,
    nodes: flow.nodes.map(n => {
      const def = getNodeDef(n.type, defs);
      return {
        id: n.id,
        type: n.type,
        label: def?.label || n.type,
        category: def?.category || "unknown",
        params: n.params || {},
        position: { x: Math.round(n.x), y: Math.round(n.y) },
      };
    }),
    connections: flow.connections.map(c => ({
      id: c.id,
      from_node: c.fromNode,
      from_port: c.fromPort,
      to_node: c.toNode,
      to_port: c.toPort,
    })),
  };
}

function extractCapabilities(nodes, defs) {
  const capMap = {
    move_forward: "linear_motion",
    move_backward: "linear_motion",
    rotate_left: "angular_motion",
    rotate_right: "angular_motion",
    set_speed: "speed_control",
    go_to_waypoint: "navigation",
    return_to_home: "navigation",
    set_home_station: "navigation",
    dock_at_station: "docking",
    undock: "docking",
    pick_up_cargo: "payload_handling",
    drop_cargo: "payload_handling",
    go_charge: "charging",
    check_battery: "sensor_battery",
    detect_obstacle: "sensor_obstacle",
    read_position: "sensor_localization",
  };
  const types = [...new Set(nodes.map(n => n.type))];
  const deps = {};
  types.forEach(t => {
    const cap = capMap[t] || "basic_execution";
    deps[cap] = true;
  });
  return Object.keys(deps);
}
