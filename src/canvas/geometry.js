// Pure geometry for the canvas: node sizing and placement, port anchors,
// marquee rectangles, pinch metrics, and connection routing. No React, no
// state — everything here is a function of its arguments.
import { getNodeDef } from "../nodeDefs";

export const NODE_W = 236;
export const NODE_H = 72;
export const NODE_PLACE_GAP = 28;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.0;
export const MARQUEE_THRESHOLD = 6;

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

export function normalizeRect(start, current) {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return {
    x,
    y,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

export function getTouchMetrics(touches) {
  const [first, second] = touches;
  const center = {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
  const dx = second.clientX - first.clientX;
  const dy = second.clientY - first.clientY;
  return { center, distance: Math.max(1, Math.hypot(dx, dy)) };
}

export function portY(idx, total, h) {
  const spacing = h / (total + 1);
  return spacing * (idx + 1);
}

export function getPortPos(node, portId, side) {
  const def = getNodeDef(node.type);
  if (!def) return { x: node.x, y: node.y };
  const ports = def.ports.filter(p => p.side === side);
  const idx = ports.findIndex(p => p.id === portId);
  return {
    x: side === "in" ? node.x : node.x + NODE_W,
    y: node.y + portY(idx, ports.length, NODE_H),
  };
}

export function getEstimatedNodeHeight(typeOrNode) {
  const type = typeof typeOrNode === "string" ? typeOrNode : typeOrNode?.type;
  const def = getNodeDef(type);
  const paramCount = def?.params ? Object.keys(def.params).length : 0;
  return Math.max(NODE_H, 74 + Math.max(paramCount, 1) * 28);
}

export function getNodePlacementRect(node, gap = 0) {
  return {
    x: node.x - gap,
    y: node.y - gap,
    width: NODE_W + gap * 2,
    height: getEstimatedNodeHeight(node) + gap * 2,
  };
}

export function findOpenNodePosition(type, preferred, nodes) {
  const candidate = { type, x: preferred.x, y: preferred.y };
  const overlaps = (next) => nodes.some(node =>
    rectsIntersect(getNodePlacementRect(next, NODE_PLACE_GAP), getNodePlacementRect(node, NODE_PLACE_GAP)),
  );

  if (!overlaps(candidate)) return { x: candidate.x, y: candidate.y };

  const stepX = NODE_W + NODE_PLACE_GAP * 2;
  const stepY = getEstimatedNodeHeight(type) + NODE_PLACE_GAP * 2;
  for (let ring = 1; ring <= 8; ring++) {
    for (let row = -ring; row <= ring; row++) {
      for (let col = -ring; col <= ring; col++) {
        if (Math.max(Math.abs(row), Math.abs(col)) !== ring) continue;
        const next = {
          type,
          x: preferred.x + col * stepX,
          y: preferred.y + row * stepY,
        };
        if (!overlaps(next)) return { x: next.x, y: next.y };
      }
    }
  }

  return {
    x: preferred.x + (nodes.length % 5) * stepX,
    y: preferred.y + Math.floor(nodes.length / 5) * stepY,
  };
}

export function getSteppedConnectionPath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) < 2) return `M${from.x} ${from.y} H${to.x}`;

  const dirX = dx >= 0 ? 1 : -1;
  const dirY = dy >= 0 ? 1 : -1;
  const elbowX = from.x + dx * 0.58;
  const radius = Math.min(18, Math.abs(dx) / 4, Math.abs(dy) / 2);

  if (radius < 2) {
    return `M${from.x} ${from.y} H${elbowX} V${to.y} H${to.x}`;
  }

  return [
    `M${from.x} ${from.y}`,
    `H${elbowX - dirX * radius}`,
    `Q${elbowX} ${from.y} ${elbowX} ${from.y + dirY * radius}`,
    `V${to.y - dirY * radius}`,
    `Q${elbowX} ${to.y} ${elbowX + dirX * radius} ${to.y}`,
    `H${to.x}`,
  ].join(" ");
}

// ─── REDUCER ──────────────────────────────────────────────────────────────────
