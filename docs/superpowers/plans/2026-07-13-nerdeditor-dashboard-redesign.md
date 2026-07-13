# NerdEditor Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Corelyn Studio dashboard/editor feel like NerdEditor's node editor with a floating collapsible block palette, click-to-create nodes, polished dark canvas styling, and a minimap.

**Architecture:** Keep the existing custom React DOM/SVG editor and preserve the `flow.nodes` / `flow.connections` data model. Add small helper functions and local components inside `src/App.jsx`, with responsive shell styling in `src/App.css`.

**Tech Stack:** React 19, Vite 8, Electron 33, custom DOM/SVG node editor, CSS media queries.

## Global Constraints

- Frontend-only redesign of the logged-in editor screen.
- Do not change authentication, backend API calls, ROS bridge behavior, mission export shape, deploy behavior, or the `flow.nodes` / `flow.connections` data contract.
- No new runtime dependency is planned.
- Primary files are `src/App.jsx` and `src/App.css`.
- `src/ros/missionSpec.js` should not change unless a regression is found in mission serialization.
- Backend code should not change.
- Desktop `.left-sidebar` is absolute within `.workspace-layout`, width `292px`, `top: 16px`, `left: 16px`.
- `expandedCategories` defaults to `motion` and `navigation` open, with `flow`, `agv_amr`, `control`, and `sensing` collapsed.
- Minimap is hidden when there are no nodes.
- Minimap is hidden below `1024px` wide.

---

### Task 1: Shared Palette And Click-To-Create

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `NODE_DEFS`, `CATEGORY_ORDER`, `CATEGORY_META`, `NODE_W`, `NODE_H`, `uid()`, `getNodeDef()`, `flowReducer`, `toCanvas()`, `canvasRef`, `dispatch`, `toast`, `addLog`.
- Produces: `DEFAULT_EXPANDED_CATEGORIES`, `buildDefaultParams(def)`, `expandedCategories`, `toggleCategory(category)`, `addNodeToCanvas(nodeType, canvasPoint, options)`, `addNodeFromPalette(nodeType)`, `NodePalette`.

- [ ] **Step 1: Add category expansion defaults and default-param helper**

Add this after `CATEGORY_META`:

```jsx
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
```

- [ ] **Step 2: Add palette expansion state**

Inside `RobotHMI`, near the other UI state, add:

```jsx
const [expandedCategories, setExpandedCategories] = useState(DEFAULT_EXPANDED_CATEGORIES);
```

Add this handler near the existing canvas/palette handlers:

```jsx
const toggleCategory = useCallback((category) => {
  setExpandedCategories(current => ({
    ...current,
    [category]: !current[category],
  }));
}, []);
```

- [ ] **Step 3: Extract node creation**

Add this plain helper inside `RobotHMI`, after `toCanvas`:

```jsx
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
```

- [ ] **Step 4: Add click-to-create handler**

Add this inside `RobotHMI`:

```jsx
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
```

- [ ] **Step 5: Update drag/drop to reuse the helper**

Replace the body of `onDrop` node creation with:

```jsx
const nodeType = e.dataTransfer.getData("nodeType");
if (!nodeType) return;
const pos = toCanvas(e.clientX, e.clientY);
addNodeToCanvas(nodeType, pos);
```

Keep `e.preventDefault()`, `setDragOverCanvas(false)`, and the callback dependency on `toCanvas`.

- [ ] **Step 6: Replace duplicated mobile and desktop palette markup**

Create a local `NodePalette` component after `DeployModalWrapper`:

```jsx
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
```

Replace both existing sidebar category maps with `NodePalette`, passing:

```jsx
<NodePalette
  expandedCategories={expandedCategories}
  onToggleCategory={toggleCategory}
  onPaletteDragStart={onPaletteDragStart}
  onAddNode={addNodeFromPalette}
  onClose={() => setMobileSidebarOpen(false)}
  isMobile={isMobile}
/>
```

- [ ] **Step 7: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/App.jsx docs/superpowers/plans/2026-07-13-nerdeditor-dashboard-redesign.md
git commit -m "feat: add collapsible block palette behavior"
```

---

### Task 2: Floating NerdEditor-Like Shell And Canvas Styling

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `NodePalette`, `.workspace-layout`, `.left-sidebar`, `.canvas-bg`, `.zoom-controls`, `.node-touch-target`.
- Produces: `.left-sidebar-floating`, `.palette-*` classes, improved canvas background and node card visuals.

- [ ] **Step 1: Update desktop sidebar shell**

In the desktop sidebar branch, change:

```jsx
<div className="left-sidebar" style={{ width: 260 }}>
```

to:

```jsx
<div className="left-sidebar left-sidebar-floating">
```

In the mobile branch, keep:

```jsx
<div className="left-sidebar">
```

- [ ] **Step 2: Make desktop canvas fill behind the floating palette**

Ensure the canvas remains the flex child after the sidebar JSX. Because the desktop sidebar is absolute, the canvas should keep:

```jsx
flex: 1,
position: "relative",
overflow: "hidden",
```

- [ ] **Step 3: Replace the canvas background style**

In the `.canvas-bg` inline style, set:

```jsx
background: "#111418",
backgroundImage:
  `radial-gradient(circle at center, rgba(161,174,187,0.28) 1.4px, transparent 1.8px),
   linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
   linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)`,
backgroundSize: "48px 48px, 24px 24px, 24px 24px",
```

- [ ] **Step 4: Add palette and floating shell CSS**

Append these rules to `src/App.css`:

```css
.palette-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

.palette-eyebrow {
  color: #7A929C;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.palette-title {
  color: #f2f7f8;
  font-size: 18px;
  font-weight: 750;
  line-height: 1.2;
}

.palette-close {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
  color: #A0B4BE;
  cursor: pointer;
}

.palette-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 14px 10px;
  padding: 8px 10px;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 7px;
  background: rgba(10,14,18,0.78);
  color: #7A929C;
  font-size: 12px;
}

.palette-groups {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px 14px;
}

.palette-group {
  margin-bottom: 6px;
}

.palette-group-trigger {
  width: 100%;
  display: grid;
  grid-template-columns: 18px 14px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #D7E2E7;
  cursor: pointer;
  font-family: inherit;
}

.palette-group-trigger:hover {
  background: rgba(255,255,255,0.06);
}

.palette-chevron {
  color: #A0B4BE;
  font-size: 18px;
  transform: rotate(0deg);
  transition: transform 0.16s ease;
}

.palette-chevron-open {
  transform: rotate(90deg);
}

.palette-category-dot,
.palette-block-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}

.palette-category-label {
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 650;
}

.palette-category-count {
  min-width: 20px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255,255,255,0.07);
  color: #8BA2AC;
  font-size: 10px;
  font-weight: 700;
}

.palette-block-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  padding: 4px 6px 8px 40px;
}

.palette-block {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 7px 8px;
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 6px;
  background: rgba(255,255,255,0.035);
  color: #C9D3D8;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
}

.palette-block:hover {
  border-color: rgba(52,211,153,0.36);
  background: rgba(52,211,153,0.08);
  transform: translateY(-1px);
}

.palette-block-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Update responsive sidebar CSS**

In `@media (min-width: 1024px)`, replace the current `.left-sidebar` desktop rule with:

```css
.left-sidebar-floating {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 60;
  width: 292px;
  max-height: calc(100% - 32px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  background: rgba(18,22,27,0.92);
  box-shadow: 0 22px 50px rgba(0,0,0,0.35);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
```

Keep the mobile `.left-sidebar` drawer rule intact.

- [ ] **Step 6: Tighten node card visual styles**

In the node card inline style, use:

```jsx
background: isSel ? "rgba(24,31,39,0.96)" : "rgba(18,24,31,0.92)",
backdropFilter: "blur(12px)",
WebkitBackdropFilter: "blur(12px)",
borderRadius: 14,
boxShadow: isSel
  ? "0 0 0 3px rgba(56,189,248,0.22), 0 18px 40px rgba(0,0,0,0.26)"
  : node.status === "running"
    ? "0 0 0 3px rgba(16,185,129,0.16), 0 18px 40px rgba(0,0,0,0.24)"
    : "0 14px 34px rgba(0,0,0,0.22)",
```

Keep the existing interaction handlers and node model untouched.

- [ ] **Step 7: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/App.jsx src/App.css
git commit -m "style: float palette over node canvas"
```

---

### Task 3: Custom Canvas Minimap

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `flow.nodes`, `selected`, `NODE_W`, `NODE_H`, `getNodeDef()`, `pan`, `zoom`, `canvasRef`.
- Produces: `canvasSize`, `CanvasMiniMap`, `.canvas-minimap`.

- [ ] **Step 1: Track canvas dimensions**

Inside `RobotHMI`, add:

```jsx
const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
```

Add this effect after the responsive breakpoint listener:

```jsx
useEffect(() => {
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
}, []);
```

- [ ] **Step 2: Add minimap component**

Add this component after `NodePalette`:

```jsx
function CanvasMiniMap({ nodes, selected, pan, zoom, canvasSize }) {
  if (!nodes.length || canvasSize.width <= 0 || canvasSize.height <= 0) return null;

  const width = 168;
  const height = 108;
  const viewport = {
    x: -pan.x / zoom,
    y: -pan.y / zoom,
    width: canvasSize.width / zoom,
    height: canvasSize.height / zoom,
  };

  const pad = 160;
  const minX = Math.min(...nodes.map(node => node.x), viewport.x) - pad;
  const minY = Math.min(...nodes.map(node => node.y), viewport.y) - pad;
  const maxX = Math.max(...nodes.map(node => node.x + NODE_W), viewport.x + viewport.width) + pad;
  const maxY = Math.max(...nodes.map(node => node.y + NODE_H), viewport.y + viewport.height) + pad;
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const scale = Math.min(width / worldW, height / worldH);
  const offsetX = (width - worldW * scale) / 2;
  const offsetY = (height - worldH * scale) / 2;

  const mapRect = (rect) => ({
    x: offsetX + (rect.x - minX) * scale,
    y: offsetY + (rect.y - minY) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  });

  const viewportRect = mapRect(viewport);

  return (
    <div className="canvas-minimap" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
        <rect x="0" y="0" width={width} height={height} rx="12" fill="rgba(7,10,14,0.92)" />
        {nodes.map(node => {
          const def = getNodeDef(node.type);
          const rect = mapRect({ x: node.x, y: node.y, width: NODE_W, height: NODE_H });
          return (
            <rect
              key={node.id}
              x={rect.x}
              y={rect.y}
              width={Math.max(5, rect.width)}
              height={Math.max(4, rect.height)}
              rx="2"
              fill={def?.color || "#3b82f6"}
              opacity={selected === node.id ? "1" : "0.78"}
            />
          );
        })}
        <rect
          x={viewportRect.x}
          y={viewportRect.y}
          width={viewportRect.width}
          height={viewportRect.height}
          rx="4"
          fill="rgba(56,189,248,0.08)"
          stroke="#38bdf8"
          strokeWidth="1.4"
        />
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Render minimap in the canvas**

Inside the canvas `<div>`, after the zoom controls and before the hint bar, add:

```jsx
<CanvasMiniMap
  nodes={flow.nodes}
  selected={selected}
  pan={pan}
  zoom={zoom}
  canvasSize={canvasSize}
/>
```

- [ ] **Step 4: Add minimap CSS**

Append to `src/App.css`:

```css
.canvas-minimap {
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 45;
  width: 176px;
  height: 116px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  background: rgba(8,12,16,0.78);
  box-shadow: 0 18px 38px rgba(0,0,0,0.32);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  pointer-events: none;
}

@media (max-width: 1023px) {
  .canvas-minimap {
    display: none;
  }
}
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/App.jsx src/App.css
git commit -m "feat: add canvas minimap"
```

---

### Task 4: Verification And Final Polish

**Files:**
- Modify if needed: `src/App.jsx`
- Modify if needed: `src/App.css`

**Interfaces:**
- Consumes: Tasks 1-3 complete.
- Produces: build-verified NerdEditor-like dashboard UI.

- [ ] **Step 1: Run production build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Start local dev server**

Run:

```bash
npm run dev
```

Expected: Vite reports a local URL, usually `http://localhost:5173/`.

- [ ] **Step 3: Manual desktop checks**

In the browser:

- Log in or use the app's current auth flow.
- Confirm the left block palette floats over the build canvas.
- Confirm `Motion` and `Navigation` start expanded.
- Confirm other groups start collapsed.
- Expand and collapse at least two groups.
- Click `Move Forward`; confirm a node appears immediately on the canvas.
- Click `Go to Waypoint`; confirm a second node appears with a stagger and becomes selected.
- Drag a block from the palette; confirm drop still creates a node at the pointer.
- Pan and zoom the canvas; confirm existing controls still work.
- Confirm the minimap appears when nodes exist and updates while panning/zooming.
- Select/delete a node; confirm existing behavior still works.

- [ ] **Step 4: Manual mobile-size checks**

Use browser responsive mode below `1024px`:

- Confirm the sidebar opens as a drawer, not as a floating desktop palette.
- Confirm group collapse behavior still works.
- Click a block and confirm the drawer closes and the node appears.
- Confirm the minimap is hidden.

- [ ] **Step 5: Fix any visual overlap**

If the minimap overlaps the zoom controls or right panel on desktop, adjust `.canvas-minimap` `right` or `bottom` values in `src/App.css`. Use:

```css
.canvas-minimap {
  right: 22px;
  bottom: 76px;
}
```

only if overlap is observed.

- [ ] **Step 6: Commit polish changes**

If changes were needed, run:

```bash
git add src/App.jsx src/App.css
git commit -m "fix: polish node editor layout"
```

If no changes were needed, do not create an empty commit.
