import { useState, useRef, useCallback, useEffect, useReducer } from "react";
import corelynLogo from "./assets/images/corelyn_logo.png";
import "./App.css";
import { ROSProvider, useROS } from "./ros/rosBridge";
import DeployModal from "./ros/DeployModal";
import { generateMissionSpec } from "./ros/missionSpec";
import LoginPage from "./LoginPage";
import SignupPage from "./SignupPage";

// ─── ENV ────────────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000";

// ─── TYPES & CONSTANTS ───────────────────────────────────────────────────────

const NODE_W = 236;
const NODE_H = 72;

const NODE_DEFS = [
  // ── FLOW ──
  { type: "start", label: "Start", category: "flow", icon: "▶️", color: "#10b981", ports: [{ id: "out", label: "OUT", side: "out" }], params: { workflow_id: { label: "Workflow ID", type: "text", default: "mission_001" }, initial_pose_estimate: { label: "Initial Pose (x,y,θ)", type: "text", default: "0.0,0.0,0.0" } } },
  { type: "end", label: "End", category: "flow", icon: "🛑", color: "#10b981", ports: [{ id: "in", label: "IN", side: "in" }], params: { terminate_status: { label: "Terminate Status", type: "select", options: ["success", "idle", "emergency_stop"], default: "success" }, trigger_callback_hook: { label: "Callback Hook", type: "text", default: "/mission/complete" } } },

  // ── MOTION ──
  { type: "move_forward", label: "Move Forward", category: "motion", icon: "⬆️", color: "#3b82f6", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { distance: { label: "Distance (m)", type: "number", default: 1.0 }, linear_velocity: { label: "Linear Velocity (m/s)", type: "number", default: 0.5 } } },
  { type: "move_backward", label: "Move Backward", category: "motion", icon: "⬇️", color: "#3b82f6", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { distance: { label: "Distance (m)", type: "number", default: 0.5 }, linear_velocity: { label: "Linear Velocity (m/s)", type: "number", default: 0.3 } } },
  { type: "rotate_left", label: "Rotate Left", category: "motion", icon: "🔄", color: "#3b82f6", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { angular_velocity: { label: "Angular Velocity (rad/s)", type: "number", default: 0.5 }, direction: { label: "Direction", type: "select", options: ["CCW", "CW"], default: "CCW" } } },
  { type: "rotate_right", label: "Rotate Right", category: "motion", icon: "🔄", color: "#3b82f6", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { angular_velocity: { label: "Angular Velocity (rad/s)", type: "number", default: 0.5 }, direction: { label: "Direction", type: "select", options: ["CW", "CCW"], default: "CW" } } },
  { type: "set_speed", label: "Set Speed", category: "motion", icon: "⚡", color: "#3b82f6", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { max_linear_velocity: { label: "Max Linear Vel (m/s)", type: "number", default: 1.0 }, max_angular_velocity: { label: "Max Angular Vel (rad/s)", type: "number", default: 1.5 } } },
  { type: "stop", label: "Stop", category: "motion", icon: "🛑", color: "#3b82f6", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { brake_type: { label: "Brake Type", type: "select", options: ["controlled", "emergency"], default: "controlled" }, deceleration_rate: { label: "Deceleration (m/s²)", type: "number", default: 0.5 } } },

  // ── NAVIGATION ──
  { type: "go_to_waypoint", label: "Go to Waypoint", category: "navigation", icon: "📍", color: "#8b5cf6", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { waypoint_id: { label: "Waypoint ID", type: "text", default: "WP-01" }, coordinates_xy: { label: "Coordinates (x,y)", type: "text", default: "10.5,20.3" } } },
  { type: "return_to_home", label: "Return to Home", category: "navigation", icon: "🏠", color: "#8b5cf6", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { home_station_id: { label: "Home Station ID", type: "text", default: "home_01" }, route_preference: { label: "Route Preference", type: "select", options: ["shortest", "safest"], default: "shortest" } } },
  { type: "set_home_station", label: "Set Home Station", category: "navigation", icon: "📌", color: "#8b5cf6", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { current_gps_coordinates: { label: "2D Map Coordinates", type: "text", default: "47.6062,-122.3321" }, map_layer_id: { label: "Map Layer ID", type: "text", default: "floor_1" }, save_current_pose_as_home: { label: "Save Current Pose", type: "boolean", default: true } } },

  // ── AGV / AMR ──
  { type: "dock_at_station", label: "Dock at Station", category: "agv_amr", icon: "⚓", color: "#d97706", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { station_id: { label: "Station ID", type: "text", default: "dock_A" }, charging_contacts_engage: { label: "Charge Contacts Engage", type: "boolean", default: true }, alignment_precision_mm: { label: "Alignment Precision (mm)", type: "number", default: 5 } } },
  { type: "undock", label: "Undock", category: "agv_amr", icon: "🚀", color: "#d97706", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { exit_clearance_distance: { label: "Exit Clearance (m)", type: "number", default: 0.5 }, reverse_speed: { label: "Reverse Speed (m/s)", type: "number", default: 0.15 }, post_undock_pose_check: { label: "Post-Undock Pose Check", type: "boolean", default: true } } },
  { type: "wait_at_station", label: "Wait at Station", category: "agv_amr", icon: "⏳", color: "#d97706", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { station_id: { label: "Station ID", type: "text", default: "dock_A" }, wait_duration: { label: "Wait Duration (s)", type: "number", default: 10 }, release_condition: { label: "Release Condition", type: "select", options: ["timer", "payload_sensor", "manual_trigger"], default: "timer" } } },
  { type: "pick_up_cargo", label: "Pick Up Cargo", category: "agv_amr", icon: "📦", color: "#d97706", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { actuator_mechanism: { label: "Actuator Mechanism", type: "select", options: ["lift_fork", "conveyor", "tow_hook"], default: "lift_fork" }, load_weight_sensor_threshold: { label: "Weight Threshold (kg)", type: "number", default: 50.0 }, clamp_force_pct: { label: "Clamp Force (%)", type: "number", default: 75 } } },
  { type: "drop_cargo", label: "Drop Cargo", category: "agv_amr", icon: "📤", color: "#d97706", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { offload_direction: { label: "Offload Direction", type: "select", options: ["forward", "reverse", "side"], default: "forward" }, validation_sensor_check: { label: "Validation Sensor Check", type: "boolean", default: true }, clearance_timeout_ms: { label: "Clearance Timeout (ms)", type: "number", default: 5000 } } },
  { type: "go_charge", label: "Go Charge", category: "agv_amr", icon: "🔋", color: "#d97706", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { battery_station_target_id: { label: "Charge Station ID", type: "text", default: "charger_01" }, threshold_trigger_pct: { label: "Battery Threshold (%)", type: "number", default: 20 }, fast_charge_override: { label: "Fast Charge Override", type: "boolean", default: false } } },

  // ── CONTROL ──
  { type: "loop_start", label: "Loop Start", category: "control", icon: "🔄", color: "#f59e0b", ports: [{ id: "in", label: "IN", side: "in" }, { id: "body", label: "BODY", side: "out" }, { id: "done", label: "DONE", side: "out" }], params: { loop_count: { label: "Loop Count", type: "number", default: 3 }, break_on_error: { label: "Break on Error", type: "boolean", default: false }, evaluation_condition_string: { label: "Condition Expression", type: "text", default: "iteration < count" } } },
  { type: "loop_end", label: "Loop End", category: "control", icon: "↩️", color: "#f59e0b", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { target_loop_start_id: { label: "Target Loop Start ID", type: "text", default: "" }, nested_level: { label: "Nested Level", type: "number", default: 1 } } },
  { type: "wait_delay", label: "Wait / Delay", category: "control", icon: "⏱️", color: "#f59e0b", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { duration_ms: { label: "Duration (ms)", type: "number", default: 2000 }, non_blocking_execution: { label: "Non-Blocking", type: "boolean", default: false } } },
  { type: "emit_event", label: "Emit Event", category: "control", icon: "📣", color: "#f59e0b", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { event_topic: { label: "Event Topic", type: "text", default: "/robot/status" }, payload_json: { label: "Payload (JSON)", type: "text", default: '{"status":"complete"}' }, broadcast_severity: { label: "Broadcast Severity", type: "select", options: ["info", "warning", "critical"], default: "info" } } },

  // ── SENSING ──
  { type: "check_battery", label: "Check Battery", category: "sensing", icon: "🔋", color: "#e11d48", ports: [{ id: "in", label: "IN", side: "in" }, { id: "ok", label: "OK", side: "out" }, { id: "low", label: "LOW", side: "out" }], params: { alert_voltage_threshold: { label: "Alert Voltage Threshold", type: "number", default: 24.0 }, low_battery_routing_action: { label: "Low Battery Action", type: "select", options: ["go_to_charge", "halt_pipeline"], default: "go_to_charge" }, telemetry_interval_ms: { label: "Telemetry Interval (ms)", type: "number", default: 1000 } } },
  { type: "detect_obstacle", label: "Detect Obstacle", category: "sensing", icon: "📡", color: "#e11d48", ports: [{ id: "in", label: "IN", side: "in" }, { id: "clear", label: "CLEAR", side: "out" }, { id: "blocked", label: "BLOCKED", side: "out" }], params: { sensor_input_source: { label: "Sensor Source", type: "select", options: ["LiDAR", "DepthCamera", "Ultrasonic"], default: "LiDAR" }, detection_range_meters: { label: "Detection Range (m)", type: "number", default: 2.0 }, field_of_view_deg: { label: "Field of View (°)", type: "number", default: 270 } } },
  { type: "read_position", label: "Read Position", category: "sensing", icon: "📍", color: "#e11d48", ports: [{ id: "in", label: "IN", side: "in" }, { id: "out", label: "OUT", side: "out" }], params: { localization_source: { label: "Localization Source", type: "select", options: ["AMCL", "SLAM", "GPS", "Odometry"], default: "AMCL" }, publish_to_dashboard: { label: "Publish to Dashboard", type: "boolean", default: true }, accuracy_threshold_mm: { label: "Accuracy Threshold (mm)", type: "number", default: 50 } } },
];

const CATEGORY_ORDER = ["flow", "motion", "navigation", "agv_amr", "control", "sensing"];
const CATEGORY_META = {
  flow: { label: "Flow", color: "#10b981" },
  motion: { label: "Motion", color: "#3b82f6" },
  navigation: { label: "Navigation", color: "#8b5cf6" },
  agv_amr: { label: "AGV / AMR", color: "#d97706" },
  control: { label: "Control", color: "#f59e0b" },
  sensing: { label: "Sensing", color: "#e11d48" },
};

const DEFAULT_EXPANDED_CATEGORIES = {
  flow: false,
  motion: true,
  navigation: true,
  agv_amr: false,
  control: false,
  sensing: false,
};

function buildDefaultParams(def) {
  const defaultParams = {};
  if (def?.params) {
    Object.entries(def.params).forEach(([key, spec]) => {
      defaultParams[key] = spec.default;
    });
  }
  return defaultParams;
}

function uid() { return Math.random().toString(36).slice(2, 9); }
function getNodeDef(type) { return NODE_DEFS.find(n => n.type === type); }

function portY(idx, total, h) {
  const spacing = h / (total + 1);
  return spacing * (idx + 1);
}

function getPortPos(node, portId, side) {
  const def = getNodeDef(node.type);
  if (!def) return { x: node.x, y: node.y };
  const ports = def.ports.filter(p => p.side === side);
  const idx = ports.findIndex(p => p.id === portId);
  return {
    x: side === "in" ? node.x : node.x + NODE_W,
    y: node.y + portY(idx, ports.length, NODE_H),
  };
}

// ─── REDUCER ──────────────────────────────────────────────────────────────────

function flowReducer(state, action) {
  switch (action.type) {
    case "ADD_NODE": return { ...state, nodes: [...state.nodes, action.node] };
    case "MOVE_NODE": return { ...state, nodes: state.nodes.map(n => n.id === action.id ? { ...n, x: action.x, y: action.y } : n) };
    case "DELETE_NODE": return { nodes: state.nodes.filter(n => n.id !== action.id), connections: state.connections.filter(c => c.fromNode !== action.id && c.toNode !== action.id) };
    case "ADD_CONN": return { ...state, connections: [...state.connections, action.conn] };
    case "DELETE_CONN": return { ...state, connections: state.connections.filter(c => c.id !== action.id) };
    case "UPDATE_PARAM": return { ...state, nodes: state.nodes.map(n => n.id === action.nodeId ? { ...n, params: { ...n.params, [action.key]: action.value } } : n) };
    case "SET_STATUS": return { ...state, nodes: state.nodes.map(n => n.id === action.nodeId ? { ...n, status: action.status } : n) };
    case "CLEAR": return { nodes: [], connections: [] };
    case "SET_ALL": return action.state;
    default: return state;
  }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = "info") => {
    const id = uid();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);
  return { toasts, add };
}

// ─── AMR SIMULATION ───────────────────────────────────────────────────────────

const SIM_GRID_SIZE = 10;

function useAMRSim(isRunning) {
  const [amr, setAmr] = useState({ x: 5, y: 5, heading: 0, path: [], battery: 85, speed: 0 });
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setAmr(s => {
        const newBatt = Math.max(0, s.battery - (isRunning ? 0.04 : 0.005));
        if (!isRunning) return { ...s, battery: newBatt, speed: 0 };
        const jx = (Math.random() - 0.5) * 0.15;
        const jy = (Math.random() - 0.5) * 0.15;
        const nx = Math.max(0.3, Math.min(SIM_GRID_SIZE - 0.3, s.x + jx));
        const ny = Math.max(0.3, Math.min(SIM_GRID_SIZE - 0.3, s.y + jy));
        const newPath = [...s.path, { x: s.x, y: s.y }].slice(-60);
        return { ...s, x: nx, y: ny, heading: (s.heading + (Math.random() - 0.5) * 5 + 360) % 360, battery: newBatt, speed: 0.3 + Math.random() * 0.5, path: newPath };
      });
    }, 300);
    return () => clearInterval(timerRef.current);
  }, [isRunning]);

  return [amr, setAmr];
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function RobotHMI() {
  const [flow, dispatch] = useReducer(flowReducer, { nodes: [], connections: [] });
  const [selected, setSelected] = useState(null);
  const [rightTab, setRightTab] = useState("props");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggingNode, setDraggingNode] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [missionRunning, setMissionRunning] = useState(false);
  const [logs, setLogs] = useState([{ time: now(), msg: "System initialized. Canvas ready.", type: "info" }]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [dragOverCanvas, setDragOverCanvas] = useState(false);
  const [hoveredConn, setHoveredConn] = useState(null);
  const [selectedConn, setSelectedConn] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authPage, setAuthPage] = useState("login");
  const [connectionState, setConnectionState] = useState({ sourceNodeId: null, isSelectingTarget: false });
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);
  const [chainMode, setChainMode] = useState(false);
  const [isShiftHeld, setIsShiftHeld] = useState(false);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState(DEFAULT_EXPANDED_CATEGORIES);

  const canvasRef = useRef(null);
  const importInputRef = useRef(null);
  const tapRef = useRef({ startX: 0, startY: 0, startTime: 0, nodeId: null });
  const { toasts, add: toast } = useToasts();
  const [amr, setAmr] = useAMRSim(missionRunning);

  const selectedNode = flow.nodes.find(n => n.id === selected);
  const selectedDef = selectedNode ? getNodeDef(selectedNode.type) : null;

  function now() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
  }

  function addLog(msg, type = "") {
    setLogs(l => [{ time: now(), msg, type }, ...l.slice(0, 79)]);
  }

  const toCanvas = useCallback((cx, cy) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (cx - rect.left - pan.x) / zoom, y: (cy - rect.top - pan.y) / zoom };
  }, [pan, zoom]);

  function addNodeToCanvas(nodeType, canvasPoint, options = {}) {
    const def = getNodeDef(nodeType);
    if (!def) {
      toast("Unknown block type", "error");
      return null;
    }

    const defaultParams = buildDefaultParams(def);
    const stagger = options.stagger ?? 0;
    const newNode = {
      id: uid(),
      type: nodeType,
      x: canvasPoint.x - NODE_W / 2 + stagger,
      y: canvasPoint.y - NODE_H / 2 + stagger,
      params: defaultParams,
      status: "idle",
    };

    dispatch({ type: "ADD_NODE", node: newNode });
    setSelected(newNode.id);
    setRightTab("props");
    addLog(`Node added: ${def.label}`, "info");
    toast(`"${def.label}" added to canvas`, "success");

    if (options.closeMobile) {
      setMobileSidebarOpen(false);
    }

    return newNode;
  }

  function getVisibleCanvasCenter() {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 220, y: 160 };
    return toCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function addNodeFromPalette(nodeType) {
    const center = getVisibleCanvasCenter();
    const stagger = (flow.nodes.length % 6) * 24;
    addNodeToCanvas(nodeType, center, { stagger, closeMobile: isMobile });
  }

  // ── Mouse handlers ──
  const onMouseMove = useCallback((e) => {
    const pos = toCanvas(e.clientX, e.clientY);
    setMousePos(pos);
    if (draggingNode) {
      dispatch({ type: "MOVE_NODE", id: draggingNode.id, x: pos.x - draggingNode.ox, y: pos.y - draggingNode.oy });
    }
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  }, [draggingNode, isPanning, panStart, toCanvas]);

  const onMouseUp = useCallback(() => {
    setDraggingNode(null);
    setIsPanning(false);
  }, []);

  const onCanvasMouseDown = useCallback((e) => {
    if (e.button === 1 || e.button === 0 && (e.altKey || spaceHeld)) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
    if (connecting) { setConnecting(null); return; }
    if (e.target === canvasRef.current || e.target.classList.contains("canvas-bg")) {
      setSelected(null);
      setSelectedConn(null);
      if (connectionState.isSelectingTarget) {
        setConnectionState({ sourceNodeId: null, isSelectingTarget: false });
      }
    }
  }, [pan, connecting, connectionState.isSelectingTarget, spaceHeld]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newZoom = Math.min(2.0, Math.max(0.2, zoom * factor));
    setPan(p => ({
      x: cx * (1 - factor) + p.x * factor,
      y: cy * (1 - factor) + p.y * factor,
    }));
    setZoom(newZoom);
  }, [zoom]);

  // ── Drag from palette ──
  const onPaletteDragStart = useCallback((e, type) => {
    e.dataTransfer.setData("nodeType", type);
  }, []);

  const toggleCategory = useCallback((category) => {
    setExpandedCategories(current => ({
      ...current,
      [category]: !current[category],
    }));
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOverCanvas(false);
    const nodeType = e.dataTransfer.getData("nodeType");
    if (!nodeType) return;
    const pos = toCanvas(e.clientX, e.clientY);
    addNodeToCanvas(nodeType, pos);
  }, [toCanvas]);

  // ── Import nodes from JSON file ──
  const handleImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        let items = [];

        if (Array.isArray(data)) {
          items = data;
        } else if (data.steps && Array.isArray(data.steps)) {
          items = data.steps;
        } else if (data.nodes && Array.isArray(data.nodes)) {
          items = data.nodes.map(n => ({ type: n.type, params: n.params, x: n.position?.x, y: n.position?.y }));
        } else {
          items = [data];
        }

        if (items.length === 0) { toast("No nodes found in file", "error"); return; }
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        const baseX = canvasRect ? (canvasRect.width / 2 - NODE_W / 2) / zoom - pan.x / zoom : 200;
        const baseY = canvasRect ? (canvasRect.height / 2 - NODE_H / 2) / zoom - pan.y / zoom : 200;
        const created = [];
        let count = 0;

        items.forEach((item, idx) => {
          const type = item.type || item.node;
          const def = getNodeDef(type);
          if (!def) { addLog(`✗ Unknown node type: "${type}"`, "error"); return; }
          const defaultParams = {};
          if (def.params) Object.entries(def.params).forEach(([k, v]) => { defaultParams[k] = v.default; });
          const newParams = item.params ? { ...defaultParams, ...item.params } : defaultParams;
          const col = idx % 4;
          const row = Math.floor(idx / 4);
          const x = item.x != null ? item.x : baseX + col * (NODE_W + 30);
          const y = item.y != null ? item.y : baseY + row * (NODE_H + 20);
          const newNode = { id: uid(), type, x, y, params: newParams, status: "idle" };
          dispatch({ type: "ADD_NODE", node: newNode });
          created.push(newNode);
          count++;
        });

        // Auto-connect nodes sequentially (out port → in port)
        for (let i = 1; i < created.length; i++) {
          const src = created[i - 1];
          const tgt = created[i];
          const srcDef = getNodeDef(src.type);
          const tgtDef = getNodeDef(tgt.type);
          if (srcDef && tgtDef) {
            const outPorts = srcDef.ports.filter(p => p.side === "out");
            const inPorts = tgtDef.ports.filter(p => p.side === "in");
            if (outPorts.length > 0 && inPorts.length > 0) {
              dispatch({ type: "ADD_CONN", conn: { id: uid(), fromNode: src.id, fromPort: outPorts[0].id, toNode: tgt.id, toPort: inPorts[0].id } });
            }
          }
        }

        if (count > 0) {
          toast(`${count} node${count > 1 ? "s" : ""} imported with connections`, "success");
          addLog(`📥 Imported ${count} node${count > 1 ? "s" : ""} from ${file.name}`, "info");
        }
      } catch (err) {
        toast("Invalid JSON file", "error");
        addLog(`✗ Import failed: ${err.message}`, "error");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [zoom, pan]);

  // ── Port interaction ──
  const onPortMouseDown = useCallback((e, nodeId, portId, side) => {
    e.stopPropagation();
    if (side === "out") {
      const node = flow.nodes.find(n => n.id === nodeId);
      if (!node) return;
      const pos = getPortPos(node, portId, "out");
      setConnecting({ fromNode: nodeId, fromPort: portId, x: pos.x, y: pos.y });
    } else if (connecting) {
      if (connecting.fromNode === nodeId) { setConnecting(null); return; }
      const exists = flow.connections.some(c => c.fromNode === connecting.fromNode && c.fromPort === connecting.fromPort && c.toNode === nodeId && c.toPort === portId);
      if (!exists) {
        dispatch({ type: "ADD_CONN", conn: { id: uid(), fromNode: connecting.fromNode, fromPort: connecting.fromPort, toNode: nodeId, toPort: portId } });
        addLog(`Connection: ${getNodeDef(connecting.fromNode.type)?.label || connecting.fromNode} → ${getNodeDef(nodeId)?.label || nodeId}`, "success");
        toast("Connection created", "success");
      }
      setConnecting(null);
    }
  }, [connecting, flow.nodes, flow.connections]);

  const onNodeMouseDown = useCallback((e, nodeId) => {
    const el = e.target;
    if (el.classList.contains("port") || el.classList.contains("node-del") || el.tagName === "INPUT" || el.tagName === "SELECT") return;
    e.stopPropagation();
    tapRef.current = { startX: e.clientX, startY: e.clientY, startTime: Date.now(), nodeId };
    setSelected(nodeId);
    if (isMobile) setMobileRightOpen(true); else setRightPanelOpen(true);
    if (connectionState.isSelectingTarget) return;
    const node = flow.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const pos = toCanvas(e.clientX, e.clientY);
    setDraggingNode({ id: nodeId, ox: pos.x - node.x, oy: pos.y - node.y });
  }, [flow.nodes, toCanvas, connectionState.isSelectingTarget, isMobile]);

  const onNodeTap = useCallback((e, nodeId) => {
    const el = e.target;
    if (el.classList.contains("port") || el.classList.contains("node-del") || el.tagName === "INPUT" || el.tagName === "SELECT") return;
    if (!connectionState.isSelectingTarget) {
      setConnectionState({ sourceNodeId: nodeId, isSelectingTarget: true });
    } else if (connectionState.sourceNodeId !== nodeId) {
      const src = flow.nodes.find(n => n.id === connectionState.sourceNodeId);
      const tgt = flow.nodes.find(n => n.id === nodeId);
      if (src && tgt) {
        const srcDef = getNodeDef(src.type);
        const tgtDef = getNodeDef(tgt.type);
        if (srcDef && tgtDef) {
          const outPorts = srcDef.ports.filter(p => p.side === "out");
          const inPorts = tgtDef.ports.filter(p => p.side === "in");
          if (outPorts.length > 0 && inPorts.length > 0) {
            const fromPort = outPorts[0].id;
            const toPort = inPorts[0].id;
            const exists = flow.connections.some(c => c.fromNode === connectionState.sourceNodeId && c.fromPort === fromPort && c.toNode === nodeId && c.toPort === toPort);
            if (!exists) {
              dispatch({ type: "ADD_CONN", conn: { id: uid(), fromNode: connectionState.sourceNodeId, fromPort, toNode: nodeId, toPort } });
              addLog(`Connection: ${srcDef.label} → ${tgtDef.label}`, "success");
              toast("Connection created", "success");
            }
          }
        }
      }
      if (chainMode || isShiftHeld) {
        setConnectionState({ sourceNodeId: nodeId, isSelectingTarget: true });
      } else {
        setConnectionState({ sourceNodeId: null, isSelectingTarget: false });
      }
    }
  }, [connectionState, flow.nodes, flow.connections, chainMode, isShiftHeld]);

  const onNodeDoubleClick = useCallback((e, nodeId) => {
    e.stopPropagation();
    setSelected(nodeId);
    if (isMobile) setMobileRightOpen(true); else setRightPanelOpen(true);
    setRightTab("props");
  }, [isMobile]);

  // ── Mission execution → remote robot via rosbridge ──
  const demoCancelRef = useRef(false);

  const runMission = async () => {
    if (flow.nodes.length === 0) { toast("Add nodes to the canvas first", "error"); return; }
    if (missionRunning) return;

    const spec = generateMissionSpec({ nodes: flow.nodes, connections: flow.connections }, NODE_DEFS);
    const order = spec.topological_order;
    addLog(`▶ Execution order: ${order.map(id => {
      const n = flow.nodes.find(x => x.id === id);
      return n ? getNodeDef(n.type)?.label || n.type : id;
    }).join(" → ")}`, "success");

    flow.nodes.forEach(n => dispatch({ type: "SET_STATUS", nodeId: n.id, status: "idle" }));
    setMissionRunning(true);

    if (backendOnline) {
      addLog("▶ Deploying mission to robot...", "success");
      toast("Deploying mission to robot...", "info");
      try {
        const res = await fetch(`${API_URL}/api/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(spec),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Deploy failed");
        addLog("✓ Mission deployed — robot executing", "success");
        toast("Robot executing mission", "success");
      } catch (err) {
        addLog(`✗ Deploy failed: ${err.message}`, "error");
        toast(`Deploy failed: ${err.message}`, "error");
        setMissionRunning(false);
      }
      return;
    }

    // ── Demo mode: simulate nodes locally ──
    addLog("▶ Demo mode — simulating mission locally", "info");
    toast("Demo: simulating mission...", "info");
    demoCancelRef.current = false;

    for (let i = 0; i < order.length; i++) {
      if (demoCancelRef.current) break;
      const nodeId = order[i];
      const node = flow.nodes.find(n => n.id === nodeId);
      const def = node && getNodeDef(node.type);
      dispatch({ type: "SET_STATUS", nodeId, status: "running" });
      addLog(`▶ ${def?.label || nodeId}: executing...`, "info");

      await new Promise(resolve => {
        const dur = def?.type === "wait_delay"
          ? Math.min(parseInt(String(node?.params?.duration_ms)) || 2000, 5000)
          : 1500;
        const check = setInterval(() => {
          if (demoCancelRef.current) { clearInterval(check); resolve(); return; }
        }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, dur);
      });

      if (demoCancelRef.current) break;
      dispatch({ type: "SET_STATUS", nodeId, status: "done" });
      addLog(`✓ ${def?.label || nodeId}: done`, "success");
    }

    if (!demoCancelRef.current) {
      addLog("✓ Demo mission complete", "success");
      toast("Demo mission complete", "success");
    }
    setMissionRunning(false);
  };

  const stopMission = () => {
    demoCancelRef.current = true;
    setMissionRunning(false);
    flow.nodes.forEach(n => dispatch({ type: "SET_STATUS", nodeId: n.id, status: "idle" }));
    addLog("■ Mission stopped", "warn");
    toast("Mission stopped", "error");
    if (backendOnline) {
      fetch(`${API_URL}/api/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission_id: "__cancel__", command: "cancel" }),
      }).catch(() => {});
    }
  };

  // ── Keyboard ──
  useEffect(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    const down = (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "SELECT") return;
        if (selectedConn) {
          dispatch({ type: "DELETE_CONN", id: selectedConn });
          setSelectedConn(null);
          toast("Connection deleted", "info");
          addLog("Connection removed via keyboard", "warn");
        } else if (selected) {
          const def = getNodeDef(flow.nodes.find(n => n.id === selected)?.type || "");
          dispatch({ type: "DELETE_NODE", id: selected });
          setSelected(null);
          toast(`"${def?.label || "Node"}" deleted`, "info");
          addLog(`Node deleted: ${def?.label || selected}`, "warn");
        }
      }
      if (e.key === "Escape") {
        setConnecting(null);
        setSelected(null);
        setSelectedConn(null);
        if (connectionState.isSelectingTarget) {
          setConnectionState({ sourceNodeId: null, isSelectingTarget: false });
        }
      }
      if (e.key === "Shift") {
        setIsShiftHeld(true);
      }
      // Zoom shortcuts
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const f = 1.15;
        setZoom(z => { const nz = Math.min(2.0, z * f); setPan(p => ({ x: cx * (1 - f) + p.x * f, y: cy * (1 - f) + p.y * f })); return nz; });
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        const f = 1 / 1.15;
        setZoom(z => { const nz = Math.max(0.2, z * f); setPan(p => ({ x: cx * (1 - f) + p.x * f, y: cy * (1 - f) + p.y * f })); return nz; });
      }
      if (e.key === "0") {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
        toast("Zoom reset", "info");
      }
      if (e.key === "1") {
        e.preventDefault();
        if (flow.nodes.length === 0) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        if (!canvasRect) return;
        const minX = Math.min(...flow.nodes.map(n => n.x));
        const minY = Math.min(...flow.nodes.map(n => n.y));
        const maxX = Math.max(...flow.nodes.map(n => n.x + 236));
        const maxY = Math.max(...flow.nodes.map(n => n.y + 72));
        const pad = 60;
        const fitZoom = Math.min(canvasRect.width / (maxX - minX + pad * 2), canvasRect.height / (maxY - minY + pad * 2), 1.5);
        setZoom(fitZoom);
        setPan({ x: (canvasRect.width - (maxX + minX) * fitZoom) / 2 + pad * fitZoom, y: (canvasRect.height - (maxY + minY) * fitZoom) / 2 + pad * fitZoom });
        toast("Zoom to fit", "info");
      }
      // Space for panning
      if (e.key === " " && e.target === document.body) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e) => {
      if (e.key === "Shift") {
        setIsShiftHeld(false);
      }
      if (e.key === " ") {
        setSpaceHeld(false);
        setIsPanning(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [selected, selectedConn, flow.nodes, connectionState.isSelectingTarget]);

  // ── Tap detection via pointer thresholds (separates drag from tap) ──
  const onNodeTapRef = useRef(onNodeTap);
  onNodeTapRef.current = onNodeTap;
  useEffect(() => {
    const h = (e) => {
      const t = tapRef.current;
      if (!t.nodeId) return;
      const dx = e.clientX - t.startX;
      const dy = e.clientY - t.startY;
      const dt = Date.now() - t.startTime;
      if (Math.sqrt(dx * dx + dy * dy) < 5 && dt < 250) {
        onNodeTapRef.current(e, t.nodeId);
      }
      tapRef.current = { startX: 0, startY: 0, startTime: 0, nodeId: null };
    };
    window.addEventListener("mouseup", h);
    window.addEventListener("touchend", h);
    return () => { window.removeEventListener("mouseup", h); window.removeEventListener("touchend", h); };
  }, []);

  const battColor = amr.battery > 50 ? "#10b981" : amr.battery > 20 ? "#d97706" : "#dc2626";

  // ── Responsive breakpoint listener ──
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    const handler = (e) => {
      setIsMobile(e.matches);
      if (e.matches) {
        setSidebarOpen(false);
        setRightPanelOpen(false);
      } else {
        setMobileSidebarOpen(false);
        setMobileRightOpen(false);
      }
    };
    mql.addEventListener("change", handler);
    handler(mql);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // ── Backend health check ──
  useEffect(() => {
    let mounted = true;
    const poll = () => {
      fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(3000) })
        .then(r => r.json()).then(d => { if (mounted) setBackendOnline(d.status === "ok"); })
        .catch(() => { if (mounted) setBackendOnline(false); });
    };
    poll();
    const iv = setInterval(poll, 10000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  // ── Real-time mission status via WebSocket ──
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const flowsRef = useRef(flow);
  flowsRef.current = flow;
  useEffect(() => {
    let ws = null;
    let mounted = true;
    const connect = () => {
      if (!mounted || !API_URL) return;
      ws = new WebSocket(`${WS_URL}/ws/mission/status`);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!data.node_id || !data.status) return;
          dispatchRef.current({ type: "SET_STATUS", nodeId: data.node_id, status: data.status });
          if (data.node_id === "__mission__") {
            if (data.status === "complete" || data.status === "cancelled") {
              setMissionRunning(false);
              addLog(`✓ Mission ${data.status}`, "success");
              toast(`Mission ${data.status}`, "success");
            }
            return;
          }
          const node = flowsRef.current.nodes.find(n => n.id === data.node_id);
          if (node) {
            const def = getNodeDef(node.type);
            const icon = data.status === "running" ? "▶" : data.status === "done" ? "✓" : "✗";
            addLog(`${icon} ${def?.label || node.type}: ${data.status}`, data.status === "done" ? "success" : data.status === "error" ? "error" : "info");
          }
        } catch (_) {}
      };
      ws.onclose = () => { setTimeout(connect, 3000); };
      ws.onerror = () => { ws?.close(); };
    };
    connect();
    return () => { mounted = false; ws?.close(); };
  }, []);

  // ── Right panel content (shared between mobile drawer and desktop sidebar) ──
  const renderRightPanelContent = () => (
    <>
      {rightTab === "props" && (
        <div>
          {!selectedNode ? (
            <div style={{ textAlign: "center", padding: "30px 10px", color: "#7A929C" }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>⊙</div>
              <div style={{ fontSize: 11, lineHeight: 1.6 }}>Select a node on the canvas to edit its properties</div>
            </div>
          ) : selectedDef && (
            <>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 20, background: `${selectedDef.color}10`, border: `1px solid ${selectedDef.color}20`, fontSize: 10, color: selectedDef.color, fontWeight: 700, marginBottom: 12 }}>
                {selectedDef.icon} {selectedDef.label}
              </div>
              {selectedDef.params && Object.keys(selectedDef.params).length > 0 ? (
                Object.entries(selectedDef.params).map(([k, spec]) => (
                  <div key={k} style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, letterSpacing: "0.08em", color: "#A0B4BE", textTransform: "uppercase", display: "block", marginBottom: 5, fontWeight: 700 }}>{spec.label}</label>
                    {spec.type === "select" ? (
                      <select value={String(selectedNode.params[k] ?? spec.default)} onChange={e => dispatch({ type: "UPDATE_PARAM", nodeId: selectedNode.id, key: k, value: e.target.value })}
                        style={{ width: "100%", padding: "6px 8px", background: "#161616", border: "1px solid #2c2c2c", borderRadius: 6, color: "#f2f2f2", fontSize: 11, fontFamily: "'Inter', sans-serif", outline: "none" }}>
                        {spec.options?.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : spec.type === "boolean" ? (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <input type="checkbox" checked={Boolean(selectedNode.params[k] ?? spec.default)} onChange={e => dispatch({ type: "UPDATE_PARAM", nodeId: selectedNode.id, key: k, value: e.target.checked })} style={{ accentColor: "#3b82f6" }} />
                        <span style={{ fontSize: 11, color: "#8BA2AC" }}>Enabled</span>
                      </label>
                    ) : (
                      <input type={spec.type === "number" ? "number" : "text"} value={String(selectedNode.params[k] ?? spec.default)} onChange={e => dispatch({ type: "UPDATE_PARAM", nodeId: selectedNode.id, key: k, value: spec.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value })} step="0.1"
                        style={{ width: "100%", padding: "6px 8px", background: "#161616", border: "1px solid #2c2c2c", borderRadius: 6, color: "#f2f2f2", fontSize: 11, fontFamily: "'Inter', sans-serif", outline: "none", boxSizing: "border-box" }} />
                    )}
                  </div>
                ))
              ) : <div style={{ fontSize: 10, color: "#7A929C", padding: "6px 0" }}>No configurable parameters</div>}

              <div style={{ height: 1, background: "#2c2c2c", margin: "10px 0" }} />
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 9, letterSpacing: "0.08em", color: "#A0B4BE", display: "block", marginBottom: 5, fontWeight: 700 }}>ROS TOPIC</label>
                <div style={{ padding: "5px 8px", background: "#161616", border: "1px solid #2c2c2c", borderRadius: 5, fontSize: 10, color: "#0891b2" }}>/robot/{selectedDef.type}</div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 9, letterSpacing: "0.08em", color: "#A0B4BE", display: "block", marginBottom: 5, fontWeight: 700 }}>NODE ID</label>
                <div style={{ padding: "5px 8px", background: "#161616", border: "1px solid #2c2c2c", borderRadius: 5, fontSize: 9, color: "#7A929C" }}>{selectedNode.id}</div>
              </div>
              <button onClick={() => { dispatch({ type: "DELETE_NODE", id: selected }); setSelected(null); toast("Node deleted", "info"); }}
                style={{ width: "100%", padding: "8px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 6, color: "#dc2626", cursor: "pointer", fontSize: 11, fontFamily: "'Inter', sans-serif", fontWeight: 600, letterSpacing: "0.03em", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#dc2626"; e.currentTarget.style.color = "white"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.08)"; e.currentTarget.style.color = "#dc2626"; }}>
                ⊠ Delete Node
              </button>
            </>
          )}
        </div>
      )}

      {rightTab === "ctl" && (
        <div>
          <Section title="Mission Control">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
              {[["▶", "Run", "#10b981", runMission, missionRunning], ["⏸", "Pause", "#d97706", stopMission, !missionRunning], ["↺", "Reset", "#A0B4BE", () => { stopMission(); toast("Reset", "info"); }, false], ["⇥", "Step", "#0891b2", () => addLog("Step executed", "info"), false]].map(([icon, label, color, fn, dis]) => (
                <button key={label} onClick={fn} disabled={dis} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 6px", borderRadius: 7, border: "1px solid #2c2c2c", background: "#1e1e1e", cursor: dis ? "not-allowed" : "pointer", opacity: dis ? 0.4 : 1, transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)", fontFamily: "'Inter', sans-serif" }}
                  onMouseEnter={e => { if (!dis) e.currentTarget.style.borderColor = color; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#2c2c2c"; e.currentTarget.style.boxShadow = "none"; }}>
                  <span style={{ fontSize: 18, color }}>{icon}</span>
                  <span style={{ fontSize: 9, color: "#A0B4BE", letterSpacing: "0.06em" }}>{label.toUpperCase()}</span>
                </button>
              ))}
            </div>
            <button onClick={() => { stopMission(); setAmr(s => ({ ...s, speed: 0 })); addLog("⚠ EMERGENCY STOP TRIGGERED", "error"); toast("E-STOP ACTIVATED", "error"); }}
              style={{ width: "100%", padding: 12, borderRadius: 7, border: "2px solid #dc2626", background: "rgba(220,38,38,0.06)", color: "#dc2626", fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 12, letterSpacing: "0.1em", cursor: "pointer", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "#dc2626"; e.currentTarget.style.color = "white"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.06)"; e.currentTarget.style.color = "#dc2626"; }}>
              ⊗ EMERGENCY STOP
            </button>
          </Section>

          <Section title="Manual Jog">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[["▲", "FWD"], ["▼", "REV"], ["◄", "LEFT"], ["►", "RIGHT"]].map(([icon, label]) => (
                <button key={label} onMouseDown={() => addLog(`Jog ${label}`, "")}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px", borderRadius: 7, border: "1px solid #2c2c2c", background: "#1e1e1e", cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#3b82f6"; e.currentTarget.style.background = "#161616"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#2c2c2c"; e.currentTarget.style.background = "#1e1e1e"; e.currentTarget.style.boxShadow = "none"; }}>
                  <span style={{ fontSize: 16, color: "#3b82f6" }}>{icon}</span>
                  <span style={{ fontSize: 9, color: "#A0B4BE", letterSpacing: "0.06em" }}>{label}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Calibration">
            {["IMU", "LiDAR", "Encoders", "Load Cell"].map(s => (
              <button key={s} onClick={() => { addLog(`Calibrating ${s}...`, "info"); toast(`${s} calibration started`, "info"); }}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #2c2c2c", background: "#1e1e1e", cursor: "pointer", marginBottom: 5, fontFamily: "'Inter', sans-serif", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#0891b2"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#2c2c2c"; e.currentTarget.style.boxShadow = "none"; }}>
                <span style={{ fontSize: 10, color: "#8BA2AC" }}>{s}</span>
                <span style={{ fontSize: 9, color: "#0891b2", fontWeight: 700 }}>CALIBRATE →</span>
              </button>
            ))}
          </Section>
        </div>
      )}

      {rightTab === "log" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 9, letterSpacing: "0.08em", color: "#A0B4BE", fontWeight: 700 }}>SYSTEM LOG</span>
            <button onClick={() => setLogs([])} style={{ padding: "2px 7px", background: "transparent", border: "1px solid #2c2c2c", borderRadius: 4, color: "#A0B4BE", cursor: "pointer", fontSize: 9, fontFamily: "'Inter', sans-serif" }}>CLEAR</button>
          </div>
          {logs.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 7, padding: "4px 0", borderBottom: "1px solid #262626" }}>
              <span style={{ fontSize: 9, color: "#3a3a3a", flexShrink: 0 }}>{l.time}</span>
              <span style={{ fontSize: 9, color: l.type === "success" ? "#10b981" : l.type === "error" ? "#dc2626" : l.type === "warn" ? "#d97706" : l.type === "info" ? "#3b82f6" : "#8BA2AC", lineHeight: 1.5 }}>{l.msg}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (!isLoggedIn) {
    if (authPage === "signup") {
      return <SignupPage onSignup={() => setIsLoggedIn(true)} onSwitchToLogin={() => setAuthPage("login")} />;
    }
    return <LoginPage onLogin={() => setIsLoggedIn(true)} onSwitchToSignup={() => setAuthPage("signup")} />;
  }

  return (
    <ROSProvider>
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "#161616", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#f2f2f2", overflow: "hidden" }}>

      {/* ── TOPBAR ── */}
      <div style={{ display: "flex", alignItems: "center", height: 52, padding: "0 16px", background: "#161616", borderBottom: "1px solid #2c2c2c", flexShrink: 0, zIndex: 100, gap: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={corelynLogo} alt="Corelyn" style={{ height: 40, width: "auto", display: "block" }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.015em" }}>
              <span style={{ color: "#C9D3D8" }}>Corelyn</span><span style={{ color: "#8BA2AC" }}> Robotics</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#A0B4BE", letterSpacing: "0.12em", lineHeight: 1.4 }}>PROGRAM | DEPLOY | DOMINATE</div>
          </div>
        </div>

        <div style={{ width: 1, height: 28, background: "#2c2c2c", margin: "0 4px" }} />

        {/* Mission status pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "#161616", border: "1px solid #2c2c2c", borderRadius: 6, fontSize: 10, color: "#A0B4BE" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: missionRunning ? "#10b981" : "#3a3a3a", animation: missionRunning ? "pulse 1.4s infinite" : "none" }} />
          {missionRunning ? "RUNNING" : "IDLE"} · {flow.nodes.length} NODES
        </div>

        {/* Backend status */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: backendOnline ? "#161616" : "rgba(245,158,11,0.12)", border: `1px solid ${backendOnline ? "#2c2c2c" : "rgba(245,158,11,0.25)"}`, borderRadius: 6, fontSize: 9, color: backendOnline ? "#10b981" : "#d97706", fontWeight: 600, letterSpacing: "0.04em" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: backendOnline ? "#10b981" : "#d97706" }} />
          {backendOnline ? "API ONLINE" : "DEMO MODE"}
        </div>

        <div style={{ flex: 1 }} />

        {/* Center toolbar - N8N style */}
        <div className="topbar-desktop-only" style={{ display: "flex", alignItems: "center", gap: 4, background: "#161616", border: "1px solid #2c2c2c", borderRadius: 8, padding: 3 }}>
          <TopBtn onClick={() => { dispatch({ type: "CLEAR" }); setSelected(null); toast("Canvas cleared", "info"); }} title="Clear canvas">⊠ Clear</TopBtn>
          <div style={{ width: 1, height: 20, background: "#2c2c2c" }} />
          <TopBtn onClick={runMission} disabled={missionRunning} accent="#10b981" title="Run mission">{backendOnline ? "▶ Run" : "▶ Demo Run"}</TopBtn>
          <TopBtn onClick={stopMission} disabled={!missionRunning} accent="#dc2626" title="Stop">■ Stop</TopBtn>
          <TopBtn onClick={() => setDeployModalOpen(true)} disabled={flow.nodes.length === 0} accent="#8b5cf6" title="Deploy mission to robot">🚀 Deploy</TopBtn>
          <TopBtn onClick={() => {
            if (flow.nodes.length === 0) { toast("Add nodes before exporting", "error"); return; }
            const spec = generateMissionSpec({ nodes: flow.nodes, connections: flow.connections }, NODE_DEFS);
            const steps = spec.topological_order.map((nodeId, i) => {
              const node = flow.nodes.find(n => n.id === nodeId);
              const def = getNodeDef(node?.type);
              return { step: i + 1, type: node?.type || "unknown", label: def?.label || node?.type || "unknown", params: node?.params || {} };
            });
            const output = { mission: "Corelyn Robotics Mission", exported_at: new Date().toISOString(), total_steps: steps.length, steps };
            const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `mission_export_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast(`${steps.length} steps exported`, "success");
            addLog(`📋 Exported ${steps.length} step-by-step instructions`, "info");
          }} disabled={flow.nodes.length === 0} accent="#0891b2" title="Export mission as JSON">⬇ Export</TopBtn>
          <div style={{ width: 1, height: 20, background: "#2c2c2c" }} />
          <input ref={importInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
          <TopBtn onClick={() => importInputRef.current?.click()} accent="#8BA2AC" title="Import nodes from JSON">📥 Import</TopBtn>
          <div style={{ width: 1, height: 20, background: "#2c2c2c" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {connectionState.isSelectingTarget && <span style={{ fontSize: 9, color: "#3b82f6", fontWeight: 600, letterSpacing: "0.04em" }}>TAP→</span>}
            <button onClick={() => setChainMode(c => !c)} title="Chain mode — auto-advance source after connection"
              style={{ padding: "2px 6px", borderRadius: 4, border: chainMode ? "1px solid #3b82f6" : "1px solid #2c2c2c", background: chainMode ? "rgba(59,130,246,0.08)" : "transparent", color: chainMode ? "#3b82f6" : "#7A929C", cursor: "pointer", fontSize: 9, fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "0.04em", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}>
              {chainMode ? "CHAIN ⛓" : "CHAIN"}
            </button>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Stats - desktop only */}
        <div className="topbar-stats-desktop" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {[["BATT", `${Math.round(amr.battery)}%`, battColor], ["VEL", `${amr.speed.toFixed(2)}m/s`, "#3b82f6"], ["CONNS", flow.connections.length, "#7c3aed"]].map(([l, v, c]) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", background: "#161616", border: "1px solid #2c2c2c", borderRadius: 5, fontSize: 10 }}>
              <span style={{ color: "#7A929C" }}>{l}</span>
              <span style={{ color: c, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Desktop sidebar toggle */}
        <button className="topbar-desktop-only" onClick={() => setSidebarOpen(s => !s)} style={{ padding: "5px 8px", background: "transparent", border: "1px solid #2c2c2c", borderRadius: 5, color: "#A0B4BE", cursor: "pointer", fontSize: 12, transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
          onMouseEnter={e => { e.currentTarget.style.background = "#262626"; e.currentTarget.style.color = "#f2f2f2"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#A0B4BE"; }}>
          {sidebarOpen ? "⟨" : "⟩"}
        </button>

        {/* Mobile menu toggles */}
        <div className="topbar-mobile-toggle" style={{ alignItems: "center", gap: 6 }}>
          <button onClick={() => setMobileSidebarOpen(s => !s)} style={{ padding: "6px 10px", background: mobileSidebarOpen ? "#262626" : "transparent", border: "1px solid #2c2c2c", borderRadius: 6, color: "#A0B4BE", cursor: "pointer", fontSize: 13, transition: "all 0.2s" }}>
            ☰
          </button>
          <button onClick={() => { if (selected) setMobileRightOpen(s => !s); }} style={{ padding: "6px 10px", background: mobileRightOpen ? "#262626" : "transparent", border: "1px solid #2c2c2c", borderRadius: 6, color: selected ? "#A0B4BE" : "#3a3a3a", cursor: selected ? "pointer" : "default", fontSize: 13, transition: "all 0.2s" }}>
            ⚙
          </button>
        </div>

        <button onClick={() => setIsLoggedIn(false)} style={{ padding: "5px 8px", background: "transparent", border: "1px solid #2c2c2c", borderRadius: 5, color: "#7A929C", cursor: "pointer", fontSize: 11, fontFamily: "'Inter', sans-serif", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
          onMouseEnter={e => { e.currentTarget.style.background = "#262626"; e.currentTarget.style.color = "#f2f2f2"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#7A929C"; }}
          title="Sign out">
          ⎋
        </button>
      </div>

      <div className="workspace-layout" style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── MOBILE DRAWER BACKDROP ── */}
        {isMobile && (mobileSidebarOpen || mobileRightOpen) && (
          <div className="drawer-backdrop" onClick={() => { setMobileSidebarOpen(false); setMobileRightOpen(false); }} />
        )}

        {/* ── LEFT SIDEBAR (N8N node panel) ── */}
        {isMobile ? (
          mobileSidebarOpen && (
            <div className="left-sidebar">
              <NodePalette
                expandedCategories={expandedCategories}
                onToggleCategory={toggleCategory}
                onPaletteDragStart={onPaletteDragStart}
                onAddNode={addNodeFromPalette}
                onClose={() => setMobileSidebarOpen(false)}
                isMobile={isMobile}
              />
            </div>
          )
        ) : (
          sidebarOpen && (
            <div className="left-sidebar">
              <NodePalette
                expandedCategories={expandedCategories}
                onToggleCategory={toggleCategory}
                onPaletteDragStart={onPaletteDragStart}
                onAddNode={addNodeFromPalette}
                onClose={() => setMobileSidebarOpen(false)}
                isMobile={isMobile}
              />
            </div>
          )
        )}

        {/* ── CANVAS ── */}
        <div
          ref={canvasRef}
          className="canvas-bg"
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseDown={onCanvasMouseDown}
          onWheel={onWheel}
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragOverCanvas(true); }}
          onDragLeave={() => setDragOverCanvas(false)}
          style={{
            flex: 1, position: "relative", overflow: "hidden",
            background: "#141414",
            backgroundImage:
`radial-gradient(circle at 0 0, rgba(255,255,255,0.16) 2px, transparent 2px),
                linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)`,
            backgroundSize: "20px 20px, 20px 20px, 20px 20px",
            cursor: spaceHeld ? "grab" : isPanning ? "grabbing" : connecting ? "crosshair" : connectionState.isSelectingTarget ? "cell" : "default",
            outline: dragOverCanvas ? "2px dashed #3b82f6" : "none",
            outlineOffset: -2,
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {/* Transform group */}
          <div style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: "0 0", position: "absolute", width: "100%", height: "100%" }}>

            {/* SVG connections */}
            <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
              <defs>
                <marker id="arr" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#7A929C" /></marker>
                <marker id="arr-on" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#10b981" /></marker>
                <marker id="arr-err" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#dc2626" /></marker>
                <marker id="arr-sel" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#3b82f6" /></marker>
                <marker id="arr-hov" markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#60a5fa" /></marker>
              </defs>
              {flow.connections.map(conn => {
                const fn = flow.nodes.find(n => n.id === conn.fromNode);
                const tn = flow.nodes.find(n => n.id === conn.toNode);
                if (!fn || !tn) return null;
                const from = getPortPos(fn, conn.fromPort, "out");
                const to = getPortPos(tn, conn.toPort, "in");
                const cx = (from.x + to.x) / 2;
                const isActive = fn.status === "running";
                const isErr = ["fail","false","err","low","blocked"].includes(conn.fromPort);
                const isSel = selectedConn === conn.id;
                const isHov = hoveredConn === conn.id;
                const stroke = isSel ? "#3b82f6" : isHov ? "#60a5fa" : isErr ? "#dc2626" : isActive ? "#10b981" : "#7A929C";
                const mkr = isSel ? "url(#arr-sel)" : isHov ? "url(#arr-hov)" : isErr ? "url(#arr-err)" : isActive ? "url(#arr-on)" : "url(#arr)";
                const midX = cx;
                const midY = (from.y + to.y) / 2;
                const d = `M${from.x} ${from.y} C${cx} ${from.y} ${cx} ${to.y} ${to.x} ${to.y}`;
                return (
                  <g key={conn.id}>
                    {/* Invisible wide hit area */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={16}
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onMouseEnter={() => setHoveredConn(conn.id)}
                      onMouseLeave={() => setHoveredConn(null)}
                      onClick={e => { e.stopPropagation(); setSelectedConn(isSel ? null : conn.id); setSelected(null); }}
                    />
                    {/* Glow behind active */}
                    {isActive && <path d={d} fill="none" stroke="#10b981" strokeWidth={6} opacity={0.12} />}
                    {/* Selected glow */}
                    {isSel && <path d={d} fill="none" stroke="#3b82f6" strokeWidth={6} opacity={0.15} />}
                    {/* Main visible wire */}
                    <path d={d} fill="none" stroke={stroke} strokeWidth={isSel ? 2.5 : isHov ? 2 : isActive ? 2.5 : 1.5} markerEnd={mkr}
                      style={{ pointerEvents: "none", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
                    />
                    {/* Midpoint delete button — shown on hover or selected */}
                    {(isHov || isSel) && (
                      <g transform={`translate(${midX},${midY})`}
                        style={{ pointerEvents: "all", cursor: "pointer" }}
                        onClick={e => { e.stopPropagation(); dispatch({ type: "DELETE_CONN", id: conn.id }); setHoveredConn(null); setSelectedConn(null); toast("Connection deleted", "info"); addLog(`Connection removed`, "warn"); }}
                        onMouseEnter={() => setHoveredConn(conn.id)}
                        onMouseLeave={() => setHoveredConn(null)}
                      >
                        <circle r={10} fill="#1e1e1e" stroke="#dc2626" strokeWidth={1.5} style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.12))" }} />
                        <text x={0} y={4} textAnchor="middle" fontSize={12} fill="#dc2626" fontFamily="monospace" fontWeight="700">×</text>
                      </g>
                    )}
                  </g>
                );
              })}
              {connecting && (() => {
                const cx = (connecting.x + mousePos.x) / 2;
                return <path d={`M${connecting.x} ${connecting.y} C${cx} ${connecting.y} ${cx} ${mousePos.y} ${mousePos.x} ${mousePos.y}`} fill="none" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 3" opacity={0.85} style={{ transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }} />;
              })()}
            </svg>

            {/* Nodes */}
            {flow.nodes.map(node => {
              const def = getNodeDef(node.type);
              if (!def) return null;
              const isSel = selected === node.id;
              const isSource = connectionState.isSelectingTarget && connectionState.sourceNodeId === node.id;
              const statusBorder = isSource ? `2px solid #3b82f6` : node.status === "running" ? `2px solid #10b981` : node.status === "done" ? `1px solid ${def.color}55` : node.status === "error" ? `2px solid #dc2626` : isSel ? `2px solid #3b82f6` : `1px solid #2c2c2c`;

              return (
                <div
                  key={node.id}
                  className="node-touch-target"
                  onMouseDown={e => onNodeMouseDown(e, node.id)}
                  onDoubleClick={e => onNodeDoubleClick(e, node.id)}
                  style={{
                    position: "absolute", left: node.x, top: node.y, width: NODE_W, height: "auto",
                    background: isSel ? "rgba(32,32,32,0.88)" : "rgba(26,26,26,0.78)",
                    backdropFilter: "blur(4px)",
                    WebkitBackdropFilter: "blur(4px)",
                    border: statusBorder,
                    borderRadius: 10,
                    boxShadow: isSel ? "0 0 0 3px rgba(59,130,246,0.25),0 4px 12px rgba(0,0,0,0.06)" : node.status === "running" ? "0 0 0 3px rgba(16,185,129,0.15),0 4px 12px rgba(0,0,0,0.06)" : "0 1px 4px rgba(0,0,0,0.04)",
                    cursor: connectionState.isSelectingTarget && !isSource ? "pointer" : "grab",
                    userSelect: "none",
                    overflow: "visible",
                    animation: isSource ? "pulse-border 1.5s ease-in-out infinite" : "none",
                    transform: connectionState.isSelectingTarget && !isSource && hoveredNode === node.id ? "scale(1.05)" : "scale(1)",
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    fontFamily: "'Inter', system-ui, sans-serif",
                  }}
                  onMouseEnter={e => { if (!isSel && node.status !== "running") e.currentTarget.style.borderColor = "#3a3a3a"; setHoveredNode(node.id); }}
                  onMouseLeave={e => { if (!isSel && node.status !== "running") e.currentTarget.style.borderColor = "#2c2c2c"; setHoveredNode(null); }}
                >
                  {/* ── Header: emoji + label + status badge + delete ── */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: `${def.color}15`, border: `1px solid ${def.color}25`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                      {def.icon}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#f2f2f2", flex: 1, lineHeight: 1.3 }}>{def.label}</span>
                    {node.status === "running" && <span style={{ fontSize: 8, padding: "1px 5px", background: "#10b98112", color: "#10b981", borderRadius: 3, border: "1px solid #10b98130", fontWeight: 700, flexShrink: 0 }}>RUN</span>}
                    {node.status === "done" && <span style={{ fontSize: 8, padding: "1px 5px", background: "#3b82f615", color: "#3b82f6", borderRadius: 3, border: "1px solid #3b82f630", fontWeight: 700, flexShrink: 0 }}>✓</span>}
                    <button
                      className="node-del"
                      title="Delete node"
                      onClick={e => { e.stopPropagation(); dispatch({ type: "DELETE_NODE", id: node.id }); setSelected(null); addLog(`Node deleted: ${def.label}`, "warn"); toast(`"${def.label}" deleted`, "info"); }}
                      style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 4, color: "#dc2626", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0, flexShrink: 0, transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#dc2626"; e.currentTarget.style.color = "#1e1e1e"; e.currentTarget.style.transform = "scale(1.15)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.08)"; e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.transform = "scale(1)"; }}
                    >×</button>
                  </div>

                  {/* ── Body: inline params ── */}
                  <div style={{ padding: "10px 14px 8px" }}>
                    {def.params && Object.entries(def.params).map(([k, spec]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "2px 0", lineHeight: 1.6 }}>
                        <span style={{ fontSize: 11, color: "#A0B4BE", fontWeight: 500, flexShrink: 0 }}>{spec.label}</span>
                        <span style={{ fontSize: 11, color: "#f2f2f2", fontWeight: 600, textAlign: "right", maxWidth: "55%", wordBreak: "break-word" }}>{String(node.params[k] ?? spec.default)}</span>
                      </div>
                    ))}
                  </div>

                  {/* ── Status progress bar ── */}
                  <div style={{ height: 3, background: "rgba(0,0,0,0.04)", borderRadius: "0 0 9px 9px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: node.status === "running" ? "70%" : node.status === "done" ? "100%" : "0%", background: node.status === "running" ? "#10b981" : node.status === "done" ? def.color : "transparent", transition: "width 0.5s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Empty state */}
          {flow.nodes.length === 0 && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none", userSelect: "none" }}>
              <div style={{ fontSize: 52, marginBottom: 12, opacity: 0.08, filter: "grayscale(1)" }}>⊙</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#7A929C", marginBottom: 6, letterSpacing: "0.02em" }}>Start building your mission</div>
              <div style={{ fontSize: 11, color: "#7A929C", lineHeight: 1.7 }}>Drag nodes from the left panel<br />Connect outputs to inputs to create logic flows</div>
            </div>
          )}

          {/* Zoom controls - bottom center like N8N */}
          <div className="zoom-controls" style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 2, background: "#1e1e1e", border: "1px solid #2c2c2c", borderRadius: 8, padding: 3, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            {[["−", () => setZoom(z => Math.max(0.2, z / 1.15))], [`${Math.round(zoom * 100)}%`, () => { setZoom(1); setPan({ x: 0, y: 0 }); }], ["+", () => setZoom(z => Math.min(2.0, z * 1.15))], ["⊡", () => { setZoom(1); setPan({ x: 0, y: 0 }); }]].map(([label, fn]) => (
              <button key={label} onClick={fn} style={{ width: label === `${Math.round(zoom * 100)}%` ? 44 : 28, height: 28, borderRadius: 6, border: "none", background: "transparent", color: "#A0B4BE", cursor: "pointer", fontSize: label === "⊡" ? 14 : 12, fontFamily: "'Inter', sans-serif", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#262626"; e.currentTarget.style.color = "#f2f2f2"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#A0B4BE"; }}>
                {label}
              </button>
            ))}
          </div>

          {/* Hint bar */}
          <div style={{ position: "absolute", bottom: 56, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 10, pointerEvents: "none" }}>
            {connectionState.isSelectingTarget && (
              <div style={{ padding: "4px 12px", background: "#1e1e1e", border: "1px solid #3b82f6", borderRadius: 20, fontSize: 11, color: "#3b82f6", fontWeight: 500, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                Tap a node to connect · ESC to cancel {chainMode && <span style={{ color: "#A0B4BE" }}>· CHAIN ⛓</span>}
              </div>
            )}
            {connecting && (
              <div style={{ padding: "4px 12px", background: "#1e1e1e", border: "1px solid #3b82f6", borderRadius: 20, fontSize: 11, color: "#3b82f6", fontWeight: 500, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                Click an input port to connect · ESC to cancel
              </div>
            )}
            {selectedConn && !connecting && (
              <div style={{ padding: "4px 12px", background: "#1e1e1e", border: "1px solid #dc2626", borderRadius: 20, fontSize: 11, color: "#dc2626", fontWeight: 500, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                Connection selected · click × on wire or press Delete to remove
              </div>
            )}
            {selected && !connecting && !selectedConn && (
              <div style={{ padding: "4px 12px", background: "#1e1e1e", border: "1px solid #2c2c2c", borderRadius: 20, fontSize: 11, color: "#7A929C", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                Press Delete to remove node
              </div>
            )}
          </div>

          {/* Drop zone indicator */}
          {dragOverCanvas && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(59,130,246,0.12)", pointerEvents: "none", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }} />
          )}
        </div>

        {/* ── RIGHT PANEL ── */}
        {isMobile ? (
          <div className={`right-panel ${mobileRightOpen ? "" : "right-panel-closed"}`} style={{ width: mobileRightOpen ? 300 : 0 }}>
            {/* Mobile close header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid #2c2c2c", flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: "#7A929C", letterSpacing: "0.08em", fontWeight: 700 }}>
                {rightTab === "props" ? "NODE PROPERTIES" : rightTab === "ctl" ? "MISSION CONTROL" : "SYSTEM LOG"}
              </span>
              <button onClick={() => setMobileRightOpen(false)} style={{ background: "none", border: "none", color: "#7A929C", cursor: "pointer", fontSize: 16, padding: "2px 6px" }}>✕</button>
            </div>
            <div style={{ display: "flex", borderBottom: "1px solid #2c2c2c", flexShrink: 0 }}>
              {[["props", "NODE"], ["ctl", "CTL"], ["log", "LOG"]].map(([id, label]) => (
                <button key={id} onClick={() => setRightTab(id)} style={{ flex: 1, padding: "10px 0", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", fontFamily: "'Inter', sans-serif", border: "none", background: "transparent", cursor: "pointer", color: rightTab === id ? "#3b82f6" : "#7A929C", borderBottom: `2px solid ${rightTab === id ? "#3b82f6" : "transparent"}`, transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
              {renderRightPanelContent()}
            </div>
          </div>
        ) : (
          <div className="right-panel" style={{ width: rightPanelOpen ? 270 : 0, opacity: rightPanelOpen ? 1 : 0 }}>
            <div style={{ display: "flex", borderBottom: "1px solid #2c2c2c", flexShrink: 0, visibility: rightPanelOpen ? "visible" : "hidden" }}>
              <button onClick={() => setRightPanelOpen(false)} style={{ padding: "10px 8px", fontSize: 10, fontWeight: 700, fontFamily: "'Inter', sans-serif", border: "none", background: "transparent", cursor: "pointer", color: "#7A929C", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
                onMouseEnter={e => { e.currentTarget.style.color = "#f2f2f2"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#7A929C"; }}>⟩</button>
              {[["props", "NODE"], ["ctl", "CTL"], ["log", "LOG"]].map(([id, label]) => (
                <button key={id} onClick={() => setRightTab(id)} style={{ flex: 1, padding: "10px 0", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", fontFamily: "'Inter', sans-serif", border: "none", background: "transparent", cursor: "pointer", color: rightTab === id ? "#3b82f6" : "#7A929C", borderBottom: `2px solid ${rightTab === id ? "#3b82f6" : "transparent"}`, transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 14, visibility: rightPanelOpen ? "visible" : "hidden" }}>
              {renderRightPanelContent()}
            </div>
          </div>
        )}

      {/* ── TOASTS ── */}
      <div style={{ position: "fixed", top: 62, right: 16, zIndex: 999, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#1e1e1e", border: `1px solid ${t.type === "success" ? "#10b981" : t.type === "error" ? "#dc2626" : "#3b82f6"}`, borderRadius: 6, fontSize: 11, color: "#f2f2f2", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", animation: "slideIn 0.2s ease" }}>
            <span style={{ color: t.type === "success" ? "#10b981" : t.type === "error" ? "#dc2626" : "#3b82f6" }}>{t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}</span>
            {t.msg}
          </div>
        ))}
      </div>

      </div>

      {/* Deploy Modal */}
      {deployModalOpen && (
        <DeployModalWrapper
          flow={flow}
          onClose={() => setDeployModalOpen(false)}
        />
      )}

    </div>
    </ROSProvider>
  );
}

function TopBtn({ children, onClick, disabled, accent, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "transparent", color: disabled ? "#3a3a3a" : accent || "#A0B4BE", cursor: disabled ? "not-allowed" : "pointer", fontSize: 11, fontFamily: "'Inter', sans-serif", fontWeight: 600, letterSpacing: "0.02em", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)", opacity: disabled ? 0.4 : 1 }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = "#262626"; e.currentTarget.style.color = accent || "#f2f2f2"; } }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = disabled ? "#3a3a3a" : accent || "#A0B4BE"; }}>
      {children}
    </button>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.08em", color: "#A0B4BE", fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>{title}</div>
      {children}
    </div>
  );
}

function DeployModalWrapper({ flow, onClose }) {
  const { connected } = useROS();
  const [apiOnline, setApiOnline] = useState(false);
  const mission = useMemo(() => generateMissionSpec(flow, NODE_DEFS), [flow]);

  useEffect(() => {
    fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.json()).then(d => setApiOnline(d.status === "ok"))
      .catch(() => setApiOnline(false));
  }, []);

  const handleDeploy = useCallback(async (spec) => {
    const res = await fetch(`${API_URL}/api/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || "Deploy failed");
    }
    return res.json();
  }, []);

  const handleDemoDeploy = useCallback(async (spec) => {
    // Just close modal — the canvas Run button will handle demo mode
    return { ok: true, demo: true };
  }, []);

  return (
    <DeployModal
      mission={mission}
      rosConnected={apiOnline}
      onClose={onClose}
      onDeploy={handleDeploy}
      onDemoDeploy={handleDemoDeploy}
    />
  );
}

function NodePalette({ expandedCategories, onToggleCategory, onPaletteDragStart, onAddNode, onClose, isMobile }) {
  return (
    <>
      <div className="palette-header">
        <div>
          <div className="palette-eyebrow">System Blocks</div>
          <div className="palette-title">Blocks</div>
        </div>
        {isMobile && (
          <button className="palette-close" onClick={onClose} aria-label="Close blocks panel">x</button>
        )}
      </div>
      <div className="palette-search" aria-hidden="true">
        <span>⌕</span>
        <span>Search Blocks</span>
      </div>
      <div className="palette-groups">
        {CATEGORY_ORDER.map(category => {
          const meta = CATEGORY_META[category];
          const items = NODE_DEFS.filter(node => node.category === category);
          const isOpen = Boolean(expandedCategories[category]);
          return (
            <div className="palette-group" key={category}>
              <button className="palette-group-trigger" onClick={() => onToggleCategory(category)} type="button">
                <span className={`palette-chevron ${isOpen ? "palette-chevron-open" : ""}`}>›</span>
                <span className="palette-category-dot" style={{ background: meta.color, boxShadow: `0 0 14px ${meta.color}55` }} />
                <span className="palette-category-label">{meta.label}</span>
                <span className="palette-category-count">{items.length}</span>
              </button>
              {isOpen && (
                <div className="palette-block-list">
                  {items.map(def => (
                    <button
                      key={def.type}
                      className="palette-block"
                      draggable
                      onDragStart={event => onPaletteDragStart(event, def.type)}
                      onClick={() => onAddNode(def.type)}
                      type="button"
                    >
                      <span className="palette-block-dot" style={{ background: def.color }} />
                      <span className="palette-block-label">{def.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
