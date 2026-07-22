// The node vocabulary, derived once from shared/nodes.json — the same file the
// Go daemon validates against, so the palette and the backend cannot drift.
import nodeData from "../shared/nodes.json";

export const NODE_DEFS = nodeData.nodes;
export const CATEGORY_ORDER = nodeData.categories.map(c => c.id);
export const CATEGORY_META = Object.fromEntries(
  nodeData.categories.map(c => [c.id, { label: c.label, color: c.color }]),
);

export function getNodeDef(type) {
  return NODE_DEFS.find(n => n.type === type);
}

export function buildDefaultParams(def) {
  const defaultParams = {};
  if (def?.params) {
    Object.entries(def.params).forEach(([key, spec]) => {
      defaultParams[key] = spec.default;
    });
  }
  return defaultParams;
}
