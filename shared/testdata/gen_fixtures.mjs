#!/usr/bin/env node
// Golden mission-spec fixtures, captured from the v1 JS implementation.
//
// These files are the contract. They are generated from the REAL
// generateMissionSpec (src/ros/missionSpec.js) and the REAL NODE_DEFS array
// (src/App.jsx) — nothing here reimplements either. Regenerating must be a
// no-op diff; a non-empty `git diff shared/testdata/` means behaviour changed.
//
// Run: node shared/testdata/gen_fixtures.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

// ── the real NODE_DEFS ──────────────────────────────────────────────────────
// Not exported by App.jsx, so slice the literal out of the source and eval it.
// Deliberate: guarantees the fixtures reflect the shipped array, not a copy.
const APP_SRC = readFileSync(path.join(REPO, "src", "App.jsx"), "utf8");
const DECL = "const NODE_DEFS = [";
const start = APP_SRC.indexOf(DECL);
if (start < 0) throw new Error("NODE_DEFS literal not found in src/App.jsx");
const end = APP_SRC.indexOf("\n];", start);
if (end < 0) throw new Error("NODE_DEFS literal is unterminated in src/App.jsx");
const NODE_DEFS = new Function(`${APP_SRC.slice(start, end + 3)}\nreturn NODE_DEFS;`)();

// ── the real serializer ─────────────────────────────────────────────────────
const { generateMissionSpec } = await import(
  path.join(REPO, "src", "ros", "missionSpec.js")
);

// ── determinism ─────────────────────────────────────────────────────────────
// mission_id and created_at are time/random derived. Pin them so fixtures are
// byte-stable and therefore diffable as a regression gate.
Date.now = () => 1750000000000;
Math.random = () => 0.123456789; // -> base36 slice "4fzz"
Date.prototype.toISOString = () => "2026-07-22T00:00:00.000Z";

// ── graph builders ──────────────────────────────────────────────────────────
const defOf = type => {
  const d = NODE_DEFS.find(n => n.type === type);
  if (!d) throw new Error(`unknown node type: ${type}`);
  return d;
};

// Mirrors how the editor seeds a freshly dropped node: every declared param at
// its declared default.
const defaults = type =>
  Object.fromEntries(
    Object.entries(defOf(type).params).map(([k, p]) => [k, p.default]),
  );

const node = (id, type, x, y) => ({ id, type, x, y, params: defaults(type), status: "idle" });
const conn = (from, fromPort, to, toPort) => ({
  id: `c_${from}_${fromPort}__${to}_${toPort}`,
  fromNode: from,
  fromPort,
  toNode: to,
  toPort,
});

const GRAPHS = {
  "empty.json": { nodes: [], connections: [] },

  "single_start.json": {
    nodes: [node("n_start", "start", 120, 80)],
    connections: [],
  },

  // Fractional coordinates on purpose: locks in Math.round on position.
  "linear_chain.json": {
    nodes: [
      node("n_start", "start", 100.4, 60.5),
      node("n_fwd", "move_forward", 400.6, 60.49),
      node("n_rot", "rotate_left", 700.5, 60.51),
      node("n_end", "end", 1000, 61),
    ],
    connections: [
      conn("n_start", "out", "n_fwd", "in"),
      conn("n_fwd", "out", "n_rot", "in"),
      conn("n_rot", "out", "n_end", "in"),
    ],
  },

  // check_battery fans out on `ok` / `low`; both branches merge into one end,
  // so `n_end` has in-degree 2.
  "branch.json": {
    nodes: [
      node("n_start", "start", 100, 200),
      node("n_batt", "check_battery", 400, 200),
      node("n_fwd", "move_forward", 720, 100),
      node("n_charge", "go_charge", 720, 320),
      node("n_end", "end", 1040, 200),
    ],
    connections: [
      conn("n_start", "out", "n_batt", "in"),
      conn("n_batt", "ok", "n_fwd", "in"),
      conn("n_batt", "low", "n_charge", "in"),
      conn("n_fwd", "out", "n_end", "in"),
      conn("n_charge", "out", "n_end", "in"),
    ],
  },

  // A -> B -> C -> A, plus disconnected D. topologicalSort must NOT error:
  // every node id has to survive into topological_order.
  "cycle.json": {
    nodes: [
      node("n_a", "move_forward", 100, 100),
      node("n_b", "rotate_left", 400, 100),
      node("n_c", "rotate_right", 700, 100),
      node("n_d", "wait_delay", 400, 400),
    ],
    connections: [
      conn("n_a", "out", "n_b", "in"),
      conn("n_b", "out", "n_c", "in"),
      conn("n_c", "out", "n_a", "in"),
    ],
  },

  "all_node_types.json": {
    nodes: NODE_DEFS.map((d, i) =>
      node(`n_${d.type}`, d.type, (i % 4) * 300, Math.floor(i / 4) * 140),
    ),
    connections: [],
  },
};

// ── write ───────────────────────────────────────────────────────────────────
mkdirSync(HERE, { recursive: true });
const written = [];
for (const [file, flow] of Object.entries(GRAPHS)) {
  const spec = generateMissionSpec(flow, NODE_DEFS);
  writeFileSync(path.join(HERE, file), JSON.stringify(spec, null, 2) + "\n");
  written.push({ file, spec, flow });
}

// ── self-check ──────────────────────────────────────────────────────────────
// The cheapest thing that fails loudly if the capture is wrong.
const assert = (ok, msg) => { if (!ok) { console.error(`FAIL: ${msg}`); process.exitCode = 1; } };

assert(written.length === 6, `expected 6 fixtures, wrote ${written.length}`);
assert(NODE_DEFS.length === 24, `expected 24 node defs, got ${NODE_DEFS.length}`);

for (const { file, spec, flow } of written) {
  assert(spec.spec_version === "1.0.0", `${file}: spec_version = ${spec.spec_version}`);
  assert(
    spec.topological_order.length === flow.nodes.length,
    `${file}: topological_order dropped nodes (${spec.topological_order.length} of ${flow.nodes.length})`,
  );
  for (const n of flow.nodes) {
    assert(spec.topological_order.includes(n.id), `${file}: ${n.id} missing from topological_order`);
    }
  for (const n of spec.nodes) {
    assert(Number.isInteger(n.position.x) && Number.isInteger(n.position.y),
      `${file}: ${n.id} position not rounded to integers`);
  }
}

const cycle = written.find(w => w.file === "cycle.json").spec;
assert(cycle.topological_order.length === 4, `cycle.json: expected 4 ids, got ${cycle.topological_order.length}`);
assert(written.find(w => w.file === "all_node_types.json").spec.nodes.length === 24,
  "all_node_types.json: expected 24 nodes");

console.log(`wrote ${written.length} fixtures to shared/testdata/`);
console.log(`cycle.json topological_order: ${JSON.stringify(cycle.topological_order)}`);
