import { useState, useRef, useCallback, useEffect, useReducer, useMemo } from "react";
import corelynLogo from "./assets/images/corelyn_logo.png";
import "./App.css";
import * as api from "./api/client";
import DeployModal from "./ros/DeployModal";
import { generateMissionSpec } from "./ros/missionSpec";
import CanvasMiniMap from "./canvas/CanvasMiniMap";
import NodeCard from "./canvas/NodeCard";
import DeployModalWrapper from "./mission/DeployModalWrapper";
import SettingsPanel from "./shell/SettingsPanel";
import TopBtn from "./shell/TopBtn";
import useBreakpoint, { COMPACT_MAX_WIDTH, NARROW_MAX_WIDTH } from "./shell/useBreakpoint";
import { CANVAS_TONES, DEFAULT_EDITOR_SETTINGS, GRID_DENSITIES, LIGHT_CANVAS_TONES, THEME_MODES, getSystemTheme, readEditorSettings } from "./shell/editorSettings";
import { MARQUEE_THRESHOLD, MAX_ZOOM, MIN_ZOOM, NODE_H, NODE_PLACE_GAP, NODE_W, clamp, findOpenNodePosition, getEstimatedNodeHeight, getNodePlacementRect, getPortPos, getSteppedConnectionPath, getTouchMetrics, normalizeRect, rectsIntersect } from "./canvas/geometry";
import NodeInspector from "./inspector/NodeInspector";
import MissionControl from "./mission/MissionControl";
import NodePalette from "./palette/NodePalette";
import SystemLog from "./log/SystemLog";
import { NODE_DEFS, buildDefaultParams, getNodeDef } from "./nodeDefs";
import LoginPage from "./LoginPage";
import SignupPage from "./SignupPage";

// ─── TYPES & CONSTANTS ───────────────────────────────────────────────────────

const DEFAULT_EXPANDED_CATEGORIES = {
  flow: false,
  motion: true,
  navigation: true,
  agv_amr: false,
  control: false,
  sensing: false,
};

function uid() { return Math.random().toString(36).slice(2, 9); }
function flowReducer(state, action) {
  switch (action.type) {
    case "ADD_NODE": return { ...state, nodes: [...state.nodes, action.node] };
    case "MOVE_NODE": return { ...state, nodes: state.nodes.map(n => n.id === action.id ? { ...n, x: action.x, y: action.y } : n) };
    case "DELETE_NODE": return { nodes: state.nodes.filter(n => n.id !== action.id), connections: state.connections.filter(c => c.fromNode !== action.id && c.toNode !== action.id) };
    case "DELETE_NODES": {
      const ids = new Set(action.ids);
      return {
        nodes: state.nodes.filter(n => !ids.has(n.id)),
        connections: state.connections.filter(c => !ids.has(c.fromNode) && !ids.has(c.toNode)),
      };
    }
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
  const [selectedIds, setSelectedIds] = useState([]);
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
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [marquee, setMarquee] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editorSettings, setEditorSettings] = useState(readEditorSettings);
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);

  const canvasRef = useRef(null);
  const importInputRef = useRef(null);
  const overflowMenuRef = useRef(null);
  const tapRef = useRef({ startX: 0, startY: 0, startTime: 0, nodeId: null });
  const touchGestureRef = useRef(null);
  const safariGestureRef = useRef(null);
  const { toasts, add: toast } = useToasts();
  const [amr, setAmr] = useAMRSim(missionRunning);

  const selectedNode = flow.nodes.find(n => n.id === selected);
  const selectedDef = selectedNode ? getNodeDef(selectedNode.type) : null;
  const themeMode = THEME_MODES[editorSettings.themeMode] ? editorSettings.themeMode : "dark";
  const resolvedTheme = themeMode === "system" ? systemTheme : themeMode;
  const canvasTones = resolvedTheme === "light" ? LIGHT_CANVAS_TONES : CANVAS_TONES;
  const canvasTone = canvasTones[editorSettings.canvasTone] || canvasTones.midnight;
  const gridDensity = GRID_DENSITIES[editorSettings.gridDensity] || GRID_DENSITIES.standard;
  const canvasBackgroundImage = editorSettings.showGrid
    ? `radial-gradient(circle at center, ${canvasTone.dot} 1.4px, transparent 1.8px),
                linear-gradient(${canvasTone.line} 1px, transparent 1px),
                linear-gradient(90deg, ${canvasTone.line} 1px, transparent 1px)`
    : "none";

  const updateEditorSetting = useCallback((key, value) => {
    setEditorSettings(settings => ({ ...settings, [key]: value }));
  }, []);

  function now() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
  }

  function addLog(msg, type = "") {
    setLogs(l => [{ time: now(), msg, type }, ...l.slice(0, 79)]);
  }

  useEffect(() => {
    try {
      window.localStorage.setItem("corelyn_editor_settings", JSON.stringify(editorSettings));
    } catch {
      // Preferences are optional; the editor still works if storage is unavailable.
    }
  }, [editorSettings]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const handleChange = () => setSystemTheme(media.matches ? "light" : "dark");
    handleChange();
    media.addEventListener?.("change", handleChange);
    return () => media.removeEventListener?.("change", handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

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
    const nodeHeight = getEstimatedNodeHeight(nodeType);
    const preferred = {
      x: canvasPoint.x - NODE_W / 2 + stagger,
      y: canvasPoint.y - nodeHeight / 2 + stagger,
    };
    const resolved = findOpenNodePosition(nodeType, preferred, flow.nodes);
    const newNode = {
      id: uid(),
      type: nodeType,
      x: resolved.x,
      y: resolved.y,
      params: defaultParams,
      status: "idle",
    };

    dispatch({ type: "ADD_NODE", node: newNode });
    setSelected(newNode.id);
    setSelectedIds([newNode.id]);
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
    addNodeToCanvas(nodeType, center, { closeMobile: isMobile });
  }

  // ── Mouse handlers ──
  const onMouseMove = useCallback((e) => {
    const pos = toCanvas(e.clientX, e.clientY);
    setMousePos(pos);
    if (marquee) {
      setMarquee(current => current ? { ...current, current: pos, currentClient: { x: e.clientX, y: e.clientY } } : null);
      return;
    }
    if (draggingNode) {
      dispatch({ type: "MOVE_NODE", id: draggingNode.id, x: pos.x - draggingNode.ox, y: pos.y - draggingNode.oy });
    }
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  }, [draggingNode, isPanning, marquee, panStart, toCanvas]);

  const onMouseUp = useCallback(() => {
    if (marquee) {
      const dx = marquee.currentClient.x - marquee.startClient.x;
      const dy = marquee.currentClient.y - marquee.startClient.y;
      const movedEnough = Math.hypot(dx, dy) >= MARQUEE_THRESHOLD;
      if (movedEnough) {
        const rect = normalizeRect(marquee.start, marquee.current);
        const ids = flow.nodes
          .filter(node => rectsIntersect(rect, getNodePlacementRect(node)))
          .map(node => node.id);
        setSelectedIds(ids);
        setSelected(ids[0] || null);
        setSelectedConn(null);
        if (ids.length === 1) {
          if (isMobile) setMobileRightOpen(true); else setRightPanelOpen(true);
        } else {
          setMobileRightOpen(false);
          setRightPanelOpen(false);
        }
      } else {
        setSelected(null);
        setSelectedIds([]);
        setSelectedConn(null);
      }
      setMarquee(null);
    }
    setDraggingNode(null);
    setIsPanning(false);
  }, [flow.nodes, isMobile, marquee]);

  const onCanvasMouseDown = useCallback((e) => {
    if (e.button === 1 || e.button === 0 && (e.altKey || spaceHeld)) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
    if (connecting) { setConnecting(null); return; }
    if (e.target === canvasRef.current || e.target.classList.contains("canvas-bg") || e.target.classList.contains("canvas-transform-layer")) {
      setSelectedConn(null);
      if (e.button === 0) {
        const start = toCanvas(e.clientX, e.clientY);
        setMarquee({
          start,
          current: start,
          startClient: { x: e.clientX, y: e.clientY },
          currentClient: { x: e.clientX, y: e.clientY },
        });
      } else {
        setSelected(null);
        setSelectedIds([]);
      }
      if (connectionState.isSelectingTarget) {
        setConnectionState({ sourceNodeId: null, isSelectingTarget: false });
      }
    }
  }, [pan, connecting, connectionState.isSelectingTarget, spaceHeld, toCanvas]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation?.();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.ctrlKey) {
      const factor = clamp(Math.exp(-e.deltaY * 0.01), 0.82, 1.18);
      const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const worldPoint = toCanvas(e.clientX, e.clientY);
      setPan({
        x: e.clientX - rect.left - worldPoint.x * newZoom,
        y: e.clientY - rect.top - worldPoint.y * newZoom,
      });
      setZoom(newZoom);
      return;
    }

    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 80 : 1;
    setPan(p => ({
      x: p.x - e.deltaX * unit,
      y: p.y - e.deltaY * unit,
    }));
  }, [toCanvas, zoom]);

  const onCanvasTouchStart = useCallback((e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const metrics = getTouchMetrics(e.touches);
    touchGestureRef.current = {
      worldCenter: toCanvas(metrics.center.x, metrics.center.y),
      startDistance: metrics.distance,
      startZoom: zoom,
    };
    setDraggingNode(null);
    setMarquee(null);
    setIsPanning(true);
  }, [toCanvas, zoom]);

  const onCanvasTouchMove = useCallback((e) => {
    const gesture = touchGestureRef.current;
    if (!gesture || e.touches.length !== 2) return;
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const metrics = getTouchMetrics(e.touches);
    const newZoom = clamp(gesture.startZoom * (metrics.distance / gesture.startDistance), MIN_ZOOM, MAX_ZOOM);
    setZoom(newZoom);
    setPan({
      x: metrics.center.x - rect.left - gesture.worldCenter.x * newZoom,
      y: metrics.center.y - rect.top - gesture.worldCenter.y * newZoom,
    });
  }, []);

  const onCanvasTouchEnd = useCallback((e) => {
    if (e.touches.length >= 2) return;
    touchGestureRef.current = null;
    setIsPanning(false);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    const element = canvasRef.current;
    if (!element) return;

    const handleWheel = (event) => {
      onWheel(event);
    };

    const getGesturePoint = (event, rect) => ({
      x: Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : rect.left + rect.width / 2,
      y: Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : rect.top + rect.height / 2,
    });

    const handleGestureStart = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const point = getGesturePoint(event, rect);
      safariGestureRef.current = {
        startZoom: zoom,
        worldCenter: toCanvas(point.x, point.y),
        point,
      };
    };

    const handleGestureChange = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const gesture = safariGestureRef.current;
      if (!gesture) return;
      const rect = element.getBoundingClientRect();
      const point = getGesturePoint(event, rect);
      const scale = typeof event.scale === "number" ? event.scale : 1;
      const newZoom = clamp(gesture.startZoom * scale, MIN_ZOOM, MAX_ZOOM);
      setZoom(newZoom);
      setPan({
        x: point.x - rect.left - gesture.worldCenter.x * newZoom,
        y: point.y - rect.top - gesture.worldCenter.y * newZoom,
      });
    };

    const handleGestureEnd = (event) => {
      event.preventDefault();
      event.stopPropagation();
      safariGestureRef.current = null;
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("gesturestart", handleGestureStart, { passive: false });
    element.addEventListener("gesturechange", handleGestureChange, { passive: false });
    element.addEventListener("gestureend", handleGestureEnd, { passive: false });

    return () => {
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("gesturestart", handleGestureStart);
      element.removeEventListener("gesturechange", handleGestureChange);
      element.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [isLoggedIn, onWheel, toCanvas, zoom]);

  useEffect(() => {
    if (!isLoggedIn) return;

    const isInsideCanvas = (target) => Boolean(canvasRef.current?.contains(target));
    const preventPagePinch = (event) => {
      if (!event.ctrlKey || isInsideCanvas(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const preventPageGesture = (event) => {
      if (isInsideCanvas(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("wheel", preventPagePinch, { passive: false, capture: true });
    window.addEventListener("gesturestart", preventPageGesture, { passive: false, capture: true });
    window.addEventListener("gesturechange", preventPageGesture, { passive: false, capture: true });
    window.addEventListener("gestureend", preventPageGesture, { passive: false, capture: true });

    return () => {
      window.removeEventListener("wheel", preventPagePinch, { capture: true });
      window.removeEventListener("gesturestart", preventPageGesture, { capture: true });
      window.removeEventListener("gesturechange", preventPageGesture, { capture: true });
      window.removeEventListener("gestureend", preventPageGesture, { capture: true });
    };
  }, [isLoggedIn]);

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
        const baseY = canvasRect ? canvasRect.height / 2 / zoom - pan.y / zoom : 200;
        const created = [];
        let count = 0;

        const occupied = [...flow.nodes];
        items.forEach((item, idx) => {
          const type = item.type || item.node;
          const def = getNodeDef(type);
          if (!def) { addLog(`✗ Unknown node type: "${type}"`, "error"); return; }
          const defaultParams = {};
          if (def.params) Object.entries(def.params).forEach(([k, v]) => { defaultParams[k] = v.default; });
          const newParams = item.params ? { ...defaultParams, ...item.params } : defaultParams;
          const col = idx % 4;
          const row = Math.floor(idx / 4);
          const estimatedHeight = getEstimatedNodeHeight(type);
          const preferred = {
            x: item.x != null ? item.x : baseX + col * (NODE_W + NODE_PLACE_GAP * 2),
            y: item.y != null ? item.y : baseY - estimatedHeight / 2 + row * (estimatedHeight + NODE_PLACE_GAP * 2),
          };
          const resolved = findOpenNodePosition(type, preferred, occupied);
          const newNode = { id: uid(), type, x: resolved.x, y: resolved.y, params: newParams, status: "idle" };
          dispatch({ type: "ADD_NODE", node: newNode });
          created.push(newNode);
          occupied.push(newNode);
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
  }, [flow.nodes, zoom, pan]);

  // ── Port interaction ──
  const onPortMouseDown = useCallback((e, nodeId, portId, side) => {
    e.stopPropagation();
    setSelectedIds([]);
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
    setSelectedIds([nodeId]);
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
    setSelectedIds([nodeId]);
    if (isMobile) setMobileRightOpen(true); else setRightPanelOpen(true);
    setRightTab("props");
  }, [isMobile]);

  // ── Mission execution → the daemon, which drives the robot (or the mockbot
  //    in DEMO MODE — same code path either way, spec §3.3) ──
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

    addLog("▶ Deploying mission to robot...", "success");
    toast("Deploying mission to robot...", "info");
    try {
      const res = await api.deploy(spec);
      if (res?.status === "deployed_no_robot") {
        addLog("Deploy accepted but no robot is connected — mission will not run.", "warn");
        toast("Deployed, but no robot is connected — the mission will not run.", "error");
        setMissionRunning(false);
      } else {
        addLog("✓ Mission deployed — robot executing", "success");
        toast("Robot executing mission", "success");
      }
    } catch (err) {
      addLog(`✗ Deploy failed: ${err.message}`, "error");
      toast(`Deploy failed: ${err.message}`, "error");
      setMissionRunning(false);
    }
  };

  const stopMission = () => {
    setMissionRunning(false);
    flow.nodes.forEach(n => dispatch({ type: "SET_STATUS", nodeId: n.id, status: "idle" }));
    addLog("■ Mission stopped", "warn");
    toast("Mission stopped", "error");
    api.cancel().catch(() => {});
  };

  // ── Keyboard ──
  useEffect(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    const down = (e) => {
      const isTyping = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isTyping) return;
        if (selectedConn) {
          dispatch({ type: "DELETE_CONN", id: selectedConn });
          setSelectedConn(null);
          toast("Connection deleted", "info");
          addLog("Connection removed via keyboard", "warn");
        } else if (selectedIds.length > 1) {
          dispatch({ type: "DELETE_NODES", ids: selectedIds });
          toast(`${selectedIds.length} nodes deleted`, "info");
          addLog(`${selectedIds.length} nodes deleted via area selection`, "warn");
          setSelectedIds([]);
          setSelected(null);
        } else if (selected) {
          const def = getNodeDef(flow.nodes.find(n => n.id === selected)?.type || "");
          dispatch({ type: "DELETE_NODE", id: selected });
          setSelected(null);
          setSelectedIds([]);
          toast(`"${def?.label || "Node"}" deleted`, "info");
          addLog(`Node deleted: ${def?.label || selected}`, "warn");
        }
      }
      if (e.key === "Escape") {
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        setConnecting(null);
        setSelected(null);
        setSelectedIds([]);
        setSelectedConn(null);
        setMarquee(null);
        if (connectionState.isSelectingTarget) {
          setConnectionState({ sourceNodeId: null, isSelectingTarget: false });
        }
      }
      if (e.key === "Shift") {
        setIsShiftHeld(true);
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping) return;
      // Canvas zoom shortcuts. Browser zoom chords are intentionally left alone.
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const f = 1.15;
        setZoom(z => { const nz = clamp(z * f, MIN_ZOOM, MAX_ZOOM); setPan(p => ({ x: cx * (1 - f) + p.x * f, y: cy * (1 - f) + p.y * f })); return nz; });
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        const f = 1 / 1.15;
        setZoom(z => { const nz = clamp(z * f, MIN_ZOOM, MAX_ZOOM); setPan(p => ({ x: cx * (1 - f) + p.x * f, y: cy * (1 - f) + p.y * f })); return nz; });
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
  }, [selected, selectedConn, selectedIds, flow.nodes, connectionState.isSelectingTarget, settingsOpen]);

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

  // Top bar's "compact" tier — Clear/Export/Import/Run/Stop/Deploy/CHAIN go
  // icon-only and the status pills abbreviate (needed for the row to actually
  // fit down to 1000px; App.css handles the rest of this tier via media query).
  const isCompact = useBreakpoint(COMPACT_MAX_WIDTH);
  // Top bar's "narrow" tier — Clear/Export/Import/CHAIN/telemetry collapse into the ⋯ overflow menu.
  const isNarrow = useBreakpoint(NARROW_MAX_WIDTH);

  // Overflow menu closes on outside click or Escape, same convention as the settings backdrop.
  useEffect(() => {
    if (!overflowMenuOpen) return;
    const closeOnEscape = (e) => { if (e.key === "Escape") setOverflowMenuOpen(false); };
    const closeOnOutsideClick = (e) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target)) setOverflowMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("mousedown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [overflowMenuOpen]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const element = canvasRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    window.addEventListener("resize", updateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, [isLoggedIn]);

  // ── Backend health check ──
  useEffect(() => {
    let mounted = true;
    const poll = () => {
      api.health()
        .then(data => { if (mounted) setBackendOnline(data.status === "ok"); })
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
  useEffect(() => api.connectStatus((data) => {
    dispatchRef.current({ type: "SET_STATUS", nodeId: data.node_id, status: data.status });

    if (data.node_id === "__mission__") {
      // Terminal events end the run. `disconnected` and `estop` are the fault
      // paths (spec §8.1) — the robot link is gone or latched, so the run is
      // over whether or not the operator asked for it.
      if (data.status === "complete" || data.status === "cancelled") {
        setMissionRunning(false);
        addLog(`✓ Mission ${data.status}`, "success");
        toast(`Mission ${data.status}`, "success");
      } else if (data.status === "disconnected") {
        setMissionRunning(false);
        addLog("✗ Robot link lost — mission interrupted", "error");
        toast("Robot disconnected", "error");
      } else if (data.status === "estop") {
        setMissionRunning(false);
        addLog("✗ E-Stop engaged on the robot", "error");
        toast("E-Stop engaged", "error");
      }
      return;
    }

    const node = flowsRef.current.nodes.find(n => n.id === data.node_id);
    if (node) {
      const def = getNodeDef(node.type);
      const icon = data.status === "running" ? "▶" : data.status === "done" ? "✓" : "✗";
      addLog(`${icon} ${def?.label || node.type}: ${data.status}`, data.status === "done" ? "success" : data.status === "error" ? "error" : "info");
    }
  }), []);

  // ── Top bar action handlers (shared between the toolbar row and the ⋯ overflow menu) ──
  const handleClearCanvas = () => { dispatch({ type: "CLEAR" }); setSelected(null); setSelectedIds([]); setMarquee(null); toast("Canvas cleared", "info"); };
  const handleExportMission = () => {
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
  };
  const handleImportClick = () => importInputRef.current?.click();
  const handleToggleChain = () => setChainMode(c => !c);
  const telemetryItems = [
    ["BATT", `${Math.round(amr.battery)}%`, battColor],
    ["VEL", `${amr.speed.toFixed(2)}m/s`, "#3b82f6"],
    ["CONNS", flow.connections.length, "#7c3aed"],
  ];

  // ── Right panel content (shared between mobile drawer and desktop sidebar) ──
  const renderRightPanelContent = () => (
    <>
      {rightTab === "props" && (
        <NodeInspector
          node={selectedNode}
          def={selectedDef}
          onParamChange={(key, value) => dispatch({ type: "UPDATE_PARAM", nodeId: selectedNode.id, key, value })}
          onDelete={() => { dispatch({ type: "DELETE_NODE", id: selected }); setSelected(null); setSelectedIds([]); toast("Node deleted", "info"); }}
        />
      )}

      {rightTab === "ctl" && (
        <MissionControl
          running={missionRunning}
          onRun={runMission}
          onStop={stopMission}
          onReset={() => { stopMission(); toast("Reset", "info"); }}
          onStep={() => addLog("Step executed", "info")}
          onEmergencyStop={() => { stopMission(); setAmr(s => ({ ...s, speed: 0 })); addLog("⚠ EMERGENCY STOP TRIGGERED", "error"); toast("E-STOP ACTIVATED", "error"); }}
          onJog={label => addLog(`Jog ${label}`, "")}
          onCalibrate={s => { addLog(`Calibrating ${s}...`, "info"); toast(`${s} calibration started`, "info"); }}
        />
      )}

      {rightTab === "log" && <SystemLog logs={logs} onClear={() => setLogs([])} />}
    </>
  );

  if (!isLoggedIn) {
    if (authPage === "signup") {
      return <SignupPage onSignup={() => setIsLoggedIn(true)} onSwitchToLogin={() => setAuthPage("login")} />;
    }
    return <LoginPage onLogin={() => setIsLoggedIn(true)} onSwitchToSignup={() => setAuthPage("signup")} />;
  }

  return (
    <div
      className={`app-shell ${editorSettings.compactPalette ? "palette-compact" : ""} ${editorSettings.animations ? "" : "motion-reduced"}`}
      data-theme={resolvedTheme}
      data-theme-mode={themeMode}
      style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "var(--app-bg)", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize: 14, color: "var(--text-main)", overflow: "hidden" }}
    >

      {/* ── TOPBAR ── */}
      <div className="topbar-row" style={{ display: "flex", alignItems: "center", height: 52, padding: "0 16px", background: "var(--topbar-bg)", borderBottom: "1px solid var(--border)", flexShrink: 0, zIndex: 100, gap: 10, boxShadow: "var(--shadow-subtle)" }}>
        {/* Logo */}
        <div className="topbar-logo" style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, minWidth: 230 }}>
          <img src={corelynLogo} alt="Corelyn" style={{ height: 40, width: "auto", display: "block" }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.015em" }}>
              <span style={{ color: "var(--brand-corelyn)" }}>Corelyn</span><span style={{ color: "var(--brand-robotics)" }}> Robotics</span>
            </div>
            <div className="topbar-tagline" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-soft)", letterSpacing: "0.12em", lineHeight: 1.4, whiteSpace: "nowrap" }}>PROGRAM | DEPLOY | DOMINATE</div>
          </div>
        </div>

        {!isNarrow && (
          <>
            <div style={{ width: 1, height: 28, background: "var(--border)", margin: "0 4px" }} />

            {/* Mission status pill */}
            <div className="topbar-status-pill" style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 14, color: "var(--text-soft)", whiteSpace: "nowrap", flexShrink: 0 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: missionRunning ? "#10b981" : "#3a3a3a", animation: missionRunning ? "pulse 1.4s infinite" : "none" }} />
              {missionRunning ? "RUNNING" : "IDLE"} · {flow.nodes.length}{isCompact ? "" : " NODES"}
            </div>

            {/* Backend status */}
            <div className="topbar-status-pill" style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: backendOnline ? "var(--panel-bg)" : "rgba(245,158,11,0.12)", border: `1px solid ${backendOnline ? "var(--border)" : "rgba(245,158,11,0.25)"}`, borderRadius: 6, fontSize: 14, color: backendOnline ? "#10b981" : "#d97706", fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap", flexShrink: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: backendOnline ? "#10b981" : "#d97706" }} />
              {isCompact ? (backendOnline ? "ONLINE" : "DEMO") : (backendOnline ? "API ONLINE" : "DEMO MODE")}
            </div>
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* Center toolbar - N8N style */}
        <div className="topbar-toolbar" style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 3, flexShrink: 0, whiteSpace: "nowrap" }}>
          <input ref={importInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
          {!isNarrow && (
            <>
              <TopBtn onClick={handleClearCanvas} title="Clear canvas">{isCompact ? "⊠" : "⊠ Clear"}</TopBtn>
              <div style={{ width: 1, height: 20, background: "var(--border)" }} />
            </>
          )}
          <TopBtn onClick={runMission} disabled={missionRunning} accent="#10b981" title="Run mission">{isCompact ? "▶" : (backendOnline ? "▶ Run" : "▶ Demo Run")}</TopBtn>
          <TopBtn onClick={stopMission} disabled={!missionRunning} accent="#dc2626" title="Stop">{isCompact ? "■" : "■ Stop"}</TopBtn>
          <TopBtn onClick={() => setDeployModalOpen(true)} disabled={flow.nodes.length === 0} accent="#8b5cf6" title="Deploy mission to robot">{isCompact ? "🚀" : "🚀 Deploy"}</TopBtn>
          {!isNarrow && (
            <>
              <TopBtn onClick={handleExportMission} disabled={flow.nodes.length === 0} accent="#0891b2" title="Export mission as JSON">{isCompact ? "⬇" : "⬇ Export"}</TopBtn>
              <div style={{ width: 1, height: 20, background: "var(--border)" }} />
              <TopBtn onClick={handleImportClick} accent="#8BA2AC" title="Import nodes from JSON">{isCompact ? "📥" : "📥 Import"}</TopBtn>
              <div style={{ width: 1, height: 20, background: "var(--border)" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {connectionState.isSelectingTarget && <span style={{ fontSize: 14, color: "#3b82f6", fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>TAP→</span>}
                <button onClick={handleToggleChain} title="Chain mode — auto-advance source after connection"
                  style={{ padding: "2px 6px", borderRadius: 4, border: chainMode ? "1px solid #3b82f6" : "1px solid var(--border)", background: chainMode ? "rgba(59,130,246,0.08)" : "transparent", color: chainMode ? "#3b82f6" : "var(--text-muted)", cursor: "pointer", fontSize: 14, fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "0.04em", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)", whiteSpace: "nowrap" }}>
                  {isCompact ? "⛓" : (chainMode ? "CHAIN ⛓" : "CHAIN")}
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Stats - desktop only */}
        {!isNarrow && (
          <div className="topbar-telemetry" style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {telemetryItems.map(([l, v, c]) => (
              <div key={l} className="topbar-telemetry-pill" style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 5, fontSize: 14, whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--text-muted)" }}>{l}</span>
                <span style={{ color: c, fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* Desktop sidebar toggle */}
        <button className="topbar-desktop-only" onClick={() => setSidebarOpen(s => !s)} style={{ padding: "5px 8px", background: "transparent", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-soft)", cursor: "pointer", fontSize: 14, transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--button-hover)"; e.currentTarget.style.color = "var(--text-main)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-soft)"; }}>
          {sidebarOpen ? "⟨" : "⟩"}
        </button>

        {/* Mobile menu toggles */}
        <div className="topbar-mobile-toggle" style={{ alignItems: "center", gap: 6 }}>
          <button onClick={() => setMobileSidebarOpen(s => !s)} style={{ padding: "6px 10px", background: mobileSidebarOpen ? "var(--button-hover)" : "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-soft)", cursor: "pointer", fontSize: 14, transition: "all 0.2s" }}>
            ☰
          </button>
          <button onClick={() => { if (selected) setMobileRightOpen(s => !s); }} style={{ padding: "6px 10px", background: mobileRightOpen ? "var(--button-hover)" : "transparent", border: "1px solid var(--border)", borderRadius: 6, color: selected ? "var(--text-soft)" : "var(--text-faint)", cursor: selected ? "pointer" : "default", fontSize: 14, transition: "all 0.2s" }}>
            ⚙
          </button>
        </div>

        {/* Narrow-width overflow menu — Clear/Export/Import/CHAIN/telemetry, next to Settings */}
        {isNarrow && (
          <div className="topbar-overflow" ref={overflowMenuRef}>
            <button
              className={`settings-tab-button ${overflowMenuOpen ? "settings-tab-button-active" : ""}`}
              onClick={() => setOverflowMenuOpen(o => !o)}
              title="More actions"
              type="button"
              aria-expanded={overflowMenuOpen}
            >
              <span aria-hidden="true">⋯</span>
            </button>
            {overflowMenuOpen && (
              <div className="topbar-overflow-menu">
                <div className="topbar-overflow-telemetry-item">
                  <span style={{ color: "var(--text-muted)" }}>MISSION</span>
                  <span style={{ color: "var(--text-soft)", fontWeight: 700 }}>{missionRunning ? "RUNNING" : "IDLE"} · {flow.nodes.length}</span>
                </div>
                <div className="topbar-overflow-telemetry-item">
                  <span style={{ color: "var(--text-muted)" }}>BACKEND</span>
                  <span style={{ color: backendOnline ? "#10b981" : "#d97706", fontWeight: 700 }}>{backendOnline ? "API ONLINE" : "DEMO MODE"}</span>
                </div>
                <div className="topbar-overflow-divider" />
                <TopBtn onClick={() => { handleClearCanvas(); setOverflowMenuOpen(false); }} title="Clear canvas">⊠ Clear</TopBtn>
                <TopBtn onClick={() => { handleExportMission(); setOverflowMenuOpen(false); }} disabled={flow.nodes.length === 0} accent="#0891b2" title="Export mission as JSON">⬇ Export</TopBtn>
                <TopBtn onClick={() => { handleImportClick(); setOverflowMenuOpen(false); }} accent="#8BA2AC" title="Import nodes from JSON">📥 Import</TopBtn>
                <button className="topbar-overflow-chain" onClick={() => { handleToggleChain(); setOverflowMenuOpen(false); }} title="Chain mode — auto-advance source after connection" style={{ padding: "2px 6px", borderRadius: 4, border: chainMode ? "1px solid #3b82f6" : "1px solid var(--border)", background: chainMode ? "rgba(59,130,246,0.08)" : "transparent", color: chainMode ? "#3b82f6" : "var(--text-muted)", cursor: "pointer", fontSize: 14, fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "0.04em", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)", whiteSpace: "nowrap" }}>
                  {chainMode ? "CHAIN ⛓" : "CHAIN"}
                </button>
                <div className="topbar-overflow-divider" />
                {telemetryItems.map(([l, v, c]) => (
                  <div key={l} className="topbar-overflow-telemetry-item">
                    <span style={{ color: "var(--text-muted)" }}>{l}</span>
                    <span style={{ color: c, fontWeight: 700 }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          className={`settings-tab-button ${settingsOpen ? "settings-tab-button-active" : ""}`}
          onClick={() => setSettingsOpen(true)}
          title="Open editor settings"
          type="button"
        >
          <span aria-hidden="true">⚙</span>
          <span>Settings</span>
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
            <div className="left-sidebar left-sidebar-floating">
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
          onTouchStart={onCanvasTouchStart}
          onTouchMove={onCanvasTouchMove}
          onTouchEnd={onCanvasTouchEnd}
          onTouchCancel={onCanvasTouchEnd}
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragOverCanvas(true); }}
          onDragLeave={() => setDragOverCanvas(false)}
          style={{
            flex: 1, position: "relative", overflow: "hidden",
            backgroundColor: canvasTone.background,
            backgroundImage: canvasBackgroundImage,
            backgroundSize: `${gridDensity.dot}px ${gridDensity.dot}px, ${gridDensity.line}px ${gridDensity.line}px, ${gridDensity.line}px ${gridDensity.line}px`,
            cursor: spaceHeld ? "grab" : isPanning ? "grabbing" : connecting ? "crosshair" : connectionState.isSelectingTarget ? "cell" : "default",
            outline: dragOverCanvas ? "2px dashed #3b82f6" : "none",
            outlineOffset: -2,
            touchAction: "none",
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <button
            className="right-panel-toggle"
            type="button"
            title={rightPanelOpen ? "Collapse node panel" : "Expand node panel"}
            aria-label={rightPanelOpen ? "Collapse node panel" : "Expand node panel"}
            aria-pressed={rightPanelOpen}
            onClick={() => setRightPanelOpen(open => !open)}
          >
            {rightPanelOpen ? "›" : "‹"}
          </button>

          {/* Transform group */}
          <div className="canvas-transform-layer" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: "0 0", position: "absolute", width: "100%", height: "100%" }}>

            {/* SVG connections */}
            <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
              {flow.connections.map(conn => {
                const fn = flow.nodes.find(n => n.id === conn.fromNode);
                const tn = flow.nodes.find(n => n.id === conn.toNode);
                if (!fn || !tn) return null;
                const from = getPortPos(fn, conn.fromPort, "out");
                const to = getPortPos(tn, conn.toPort, "in");
                const isActive = fn.status === "running";
                const isErr = ["fail","false","err","low","blocked"].includes(conn.fromPort);
                const isSel = selectedConn === conn.id;
                const isHov = hoveredConn === conn.id;
                const stroke = isSel ? "#38bdf8" : isHov ? "#67e8f9" : isErr ? "#f87171" : isActive ? "#2dd4bf" : "#5ab7c5";
                const midX = from.x + (to.x - from.x) * 0.58;
                const midY = (from.y + to.y) / 2;
                const d = getSteppedConnectionPath(from, to);
                return (
                  <g key={conn.id}>
                    {/* Invisible wide hit area */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={22}
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onMouseEnter={() => setHoveredConn(conn.id)}
                      onMouseLeave={() => setHoveredConn(null)}
                      onClick={e => { e.stopPropagation(); setSelectedConn(isSel ? null : conn.id); setSelected(null); setSelectedIds([]); }}
                    />
                    {/* Glow behind active */}
                    {isActive && <path className="connection-wire-glow" d={d} fill="none" stroke="#2dd4bf" strokeWidth={13} strokeDasharray="22 24" strokeLinecap="butt" opacity={0.16} />}
                    {/* Selected glow */}
                    {isSel && <path className="connection-wire-glow" d={d} fill="none" stroke="#38bdf8" strokeWidth={14} strokeDasharray="22 24" strokeLinecap="butt" opacity={0.2} />}
                    {/* Main visible wire */}
                    <path
                      className="connection-wire"
                      d={d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={isSel || isHov ? 9 : 8}
                      strokeDasharray="22 24"
                      strokeLinecap="butt"
                      strokeLinejoin="round"
                      style={{ pointerEvents: "none", transition: "stroke 0.2s cubic-bezier(0.4, 0, 0.2, 1), stroke-width 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
                    />
                    {/* Midpoint delete button — shown on hover or selected */}
                    {(isHov || isSel) && (
                      <g transform={`translate(${midX},${midY})`}
                        style={{ pointerEvents: "all", cursor: "pointer" }}
                        onClick={e => { e.stopPropagation(); dispatch({ type: "DELETE_CONN", id: conn.id }); setHoveredConn(null); setSelectedConn(null); toast("Connection deleted", "info"); addLog(`Connection removed`, "warn"); }}
                        onMouseEnter={() => setHoveredConn(conn.id)}
                        onMouseLeave={() => setHoveredConn(null)}
                      >
                        <circle r={10} fill="var(--panel-bg)" stroke="#dc2626" strokeWidth={1.5} style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.12))" }} />
                        <text x={0} y={4} textAnchor="middle" fontSize={12} fill="#dc2626" fontFamily="monospace" fontWeight="700">×</text>
                      </g>
                    )}
                  </g>
                );
              })}
              {connecting && (() => {
                const d = getSteppedConnectionPath({ x: connecting.x, y: connecting.y }, mousePos);
                return <path className="connection-wire connection-wire-preview" d={d} fill="none" stroke="#38bdf8" strokeWidth={8} strokeDasharray="22 24" strokeLinecap="butt" strokeLinejoin="round" opacity={0.85} style={{ transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }} />;
              })()}
            </svg>

            {/* Nodes */}
            {flow.nodes.map(node => {
              const def = getNodeDef(node.type);
              if (!def) return null;
              return (
                <NodeCard
                  key={node.id}
                  node={node}
                  def={def}
                  isSelected={selected === node.id || selectedIds.includes(node.id)}
                  isSource={connectionState.isSelectingTarget && connectionState.sourceNodeId === node.id}
                  isPickingTarget={connectionState.isSelectingTarget}
                  glow={editorSettings.nodeGlow}
                  onMouseDown={e => onNodeMouseDown(e, node.id)}
                  onDoubleClick={e => onNodeDoubleClick(e, node.id)}
                  onHoverChange={setHoveredNode}
                  onDelete={() => {
                    dispatch({ type: "DELETE_NODE", id: node.id });
                    setSelected(node.id === selected ? null : selected);
                    setSelectedIds(ids => ids.filter(id => id !== node.id));
                    addLog(`Node deleted: ${def.label}`, "warn");
                    toast(`"${def.label}" deleted`, "info");
                  }}
                />
              );
            })}

              {marquee && (() => {
                const rect = normalizeRect(marquee.start, marquee.current);
                return (
                  <div
                    className="selection-marquee"
                    style={{
                      left: rect.x,
                      top: rect.y,
                      width: rect.width,
                      height: rect.height,
                    }}
                  />
                );
              })()}
          </div>

          {/* Empty state */}
          {flow.nodes.length === 0 && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", textAlign: "center", pointerEvents: "none", userSelect: "none" }}>
              <div style={{ fontSize: 52, marginBottom: 12, opacity: 0.08, filter: "grayscale(1)" }}>⊙</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.02em" }}>Start building your mission</div>
              <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.7 }}>Drag nodes from the left panel<br />Connect outputs to inputs to create logic flows</div>
            </div>
          )}

          {/* Zoom controls - bottom center like N8N */}
          <div className="zoom-controls" style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 2, background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 3, boxShadow: "var(--shadow-subtle)" }}>
            {[["−", () => setZoom(z => Math.max(0.2, z / 1.15))], [`${Math.round(zoom * 100)}%`, () => { setZoom(1); setPan({ x: 0, y: 0 }); }], ["+", () => setZoom(z => Math.min(2.0, z * 1.15))], ["⊡", () => { setZoom(1); setPan({ x: 0, y: 0 }); }]].map(([label, fn]) => (
              <button key={label} onClick={fn} style={{ width: label === `${Math.round(zoom * 100)}%` ? 44 : 28, height: 28, borderRadius: 6, border: "none", background: "transparent", color: "var(--text-soft)", cursor: "pointer", fontSize: 14, fontFamily: "'Inter', sans-serif", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--button-hover)"; e.currentTarget.style.color = "var(--text-main)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-soft)"; }}>
                {label}
              </button>
            ))}
          </div>

          {editorSettings.showMinimap && (
            <CanvasMiniMap
              nodes={flow.nodes}
              selected={selected}
              selectedIds={selectedIds}
              pan={pan}
              zoom={zoom}
              canvasSize={canvasSize}
            />
          )}

          {/* Hint bar */}
          <div style={{ position: "absolute", bottom: 56, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 10, pointerEvents: "none" }}>
            {connectionState.isSelectingTarget && (
              <div style={{ padding: "4px 12px", background: "var(--panel-bg)", border: "1px solid #3b82f6", borderRadius: 20, fontSize: 14, color: "#3b82f6", fontWeight: 500, boxShadow: "var(--shadow-subtle)" }}>
                Tap a node to connect · ESC to cancel {chainMode && <span style={{ color: "var(--text-soft)" }}>· CHAIN ⛓</span>}
              </div>
            )}
            {connecting && (
              <div style={{ padding: "4px 12px", background: "var(--panel-bg)", border: "1px solid #3b82f6", borderRadius: 20, fontSize: 14, color: "#3b82f6", fontWeight: 500, boxShadow: "var(--shadow-subtle)" }}>
                Click an input port to connect · ESC to cancel
              </div>
            )}
            {selectedConn && !connecting && (
              <div style={{ padding: "4px 12px", background: "var(--panel-bg)", border: "1px solid #dc2626", borderRadius: 20, fontSize: 14, color: "#dc2626", fontWeight: 500, boxShadow: "var(--shadow-subtle)" }}>
                Connection selected · click × on wire or press Delete to remove
              </div>
            )}
            {selectedIds.length > 1 && !connecting && !selectedConn && (
              <div style={{ padding: "4px 12px", background: "var(--panel-bg)", border: "1px solid #3b82f6", borderRadius: 20, fontSize: 14, color: "var(--text-soft)", boxShadow: "var(--shadow-subtle)" }}>
                {selectedIds.length} nodes selected · press Delete to remove
              </div>
            )}
            {selected && selectedIds.length <= 1 && !connecting && !selectedConn && (
              <div style={{ padding: "4px 12px", background: "var(--panel-bg)", border: "1px solid var(--border)", borderRadius: 20, fontSize: 14, color: "var(--text-muted)", boxShadow: "var(--shadow-subtle)" }}>
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <span style={{ fontSize: 14, color: "var(--text-muted)", letterSpacing: "0.08em", fontWeight: 700 }}>
                {rightTab === "props" ? "NODE PROPERTIES" : rightTab === "ctl" ? "MISSION CONTROL" : "SYSTEM LOG"}
              </span>
              <button onClick={() => setMobileRightOpen(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>✕</button>
            </div>
            <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              {[["props", "NODE"], ["ctl", "CTL"], ["log", "LOG"]].map(([id, label]) => (
                <button key={id} onClick={() => setRightTab(id)} style={{ flex: 1, padding: "10px 0", fontSize: 14, fontWeight: 700, letterSpacing: "0.06em", fontFamily: "'Inter', sans-serif", border: "none", background: "transparent", cursor: "pointer", color: rightTab === id ? "#3b82f6" : "var(--text-muted)", borderBottom: `2px solid ${rightTab === id ? "#3b82f6" : "transparent"}`, transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}>
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
            <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0, visibility: rightPanelOpen ? "visible" : "hidden" }}>
              <button onClick={() => setRightPanelOpen(false)} style={{ padding: "10px 8px", fontSize: 14, fontWeight: 700, fontFamily: "'Inter', sans-serif", border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--text-main)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}>⟩</button>
              {[["props", "NODE"], ["ctl", "CTL"], ["log", "LOG"]].map(([id, label]) => (
                <button key={id} onClick={() => setRightTab(id)} style={{ flex: 1, padding: "10px 0", fontSize: 14, fontWeight: 700, letterSpacing: "0.06em", fontFamily: "'Inter', sans-serif", border: "none", background: "transparent", cursor: "pointer", color: rightTab === id ? "#3b82f6" : "var(--text-muted)", borderBottom: `2px solid ${rightTab === id ? "#3b82f6" : "transparent"}`, transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)" }}>
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
      <div className="toast-stack" style={{ position: "fixed", top: 62, right: 16, zIndex: 999, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "var(--panel-bg)", border: `1px solid ${t.type === "success" ? "#10b981" : t.type === "error" ? "#dc2626" : "#3b82f6"}`, borderRadius: 6, fontSize: 14, color: "var(--text-main)", boxShadow: "var(--shadow-raised)", animation: "slideIn 0.2s ease" }}>
            <span style={{ color: t.type === "success" ? "#10b981" : t.type === "error" ? "#dc2626" : "#3b82f6" }}>{t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}</span>
            {t.msg}
          </div>
        ))}
      </div>

      </div>

      {settingsOpen && (
        <SettingsPanel
          settings={editorSettings}
          resolvedTheme={resolvedTheme}
          onChange={updateEditorSetting}
          onClose={() => setSettingsOpen(false)}
          onReset={() => setEditorSettings(DEFAULT_EDITOR_SETTINGS)}
          onSave={() => {
            setSettingsOpen(false);
            toast("Editor preferences saved", "success");
          }}
          onSignOut={() => { api.logout(); setIsLoggedIn(false); }}
        />
      )}

      {/* Deploy Modal */}
      {deployModalOpen && (
        <DeployModalWrapper
          flow={flow}
          onClose={() => setDeployModalOpen(false)}
          onLog={addLog}
        />
      )}

    </div>
  );
}

