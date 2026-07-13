# NerdEditor Dashboard Redesign Design

## Goal

Update the existing Corelyn Studio dashboard/editor UI so it feels closer to NerdEditor's node editor while keeping the backend and mission data model unchanged.

## Scope

This is a frontend-only redesign of the logged-in editor screen. The work covers the node palette, build canvas, node cards, minimap, and related responsive styling. It does not change authentication, backend API calls, ROS bridge behavior, mission export shape, deploy behavior, or the `flow.nodes` / `flow.connections` data contract.

## Existing Project Context

The app is a compact React 19 + Vite + Electron project. The main editor lives in `src/App.jsx` as `RobotHMI`. Styling is split between inline styles in `src/App.jsx`, responsive layout rules in `src/App.css`, and minimal global sizing in `src/index.css`.

The node editor is custom DOM/SVG, not React Flow. Nodes are absolutely positioned `<div>` elements. Connections are SVG Bezier paths derived from `flow.connections`. Pan and zoom are managed through local `pan` and `zoom` state. The block catalog is `NODE_DEFS`, grouped by `CATEGORY_ORDER` and `CATEGORY_META`.

## Design Direction

Keep the current custom editor implementation and enhance it visually and behaviorally. This avoids a dependency migration and preserves the mission generation contract already used by the backend.

The final editor should have:

- A floating left block palette that overlays the canvas instead of reserving layout width on desktop.
- Collapsible block groups for `Flow`, `Motion`, `Navigation`, `AGV / AMR`, `Control`, and `Sensing`.
- Block buttons inside each group that can be dragged or clicked.
- Click-to-create behavior that immediately adds a node near the center of the visible canvas.
- A dark dotted canvas with stronger NerdEditor-like depth and contrast.
- Node cards with clearer headers, colored accents, visible connection affordances, and tighter proportions.
- A bottom-right minimap showing node rectangles and the current viewport.
- Existing zoom controls and right properties panel preserved, with layout adjusted so overlays do not collide.

## Architecture

The implementation will keep state centralized in `RobotHMI` and introduce small local helper functions/components inside `src/App.jsx` rather than creating a broad component architecture. This fits the current app style and keeps the UI change focused.

The most important extraction is node creation. The existing `onDrop` logic will be converted into a shared helper that accepts a node type and canvas position. Drag/drop and palette click will both use that helper.

The palette rendering should be shared between mobile and desktop branches to avoid duplicating grouped/collapsible behavior. The desktop shell will be styled as a floating overlay. The mobile shell will continue behaving as a drawer.

The minimap will be a custom overlay component inside `RobotHMI`. It will compute a simple world bounding box from `flow.nodes`, derive scale factors, draw colored rectangles for each node, and draw a viewport rectangle based on `pan`, `zoom`, and the canvas dimensions.

## Components And State

### Palette State

Add `expandedCategories` state near the existing UI state in `RobotHMI`. It should default to `motion` and `navigation` open, with `flow`, `agv_amr`, `control`, and `sensing` collapsed.

Add `toggleCategory(category)` to expand or collapse each category.

### Shared Palette Renderer

Introduce a shared render helper or local component, likely named `NodePalette`, that receives:

- `expandedCategories`
- `onToggleCategory`
- `onPaletteDragStart`
- `onAddNode`
- `isMobile`

Each category header should show a chevron, colored category icon/accent, category label, and block count. Each block should render as a compact button with a color dot/icon and label. The block button should support both `draggable` and `onClick`.

### Node Creation Helper

Add a helper such as `createNodeFromType(type, position)` or `addNodeToCanvas(type, position)`.

Responsibilities:

- Find the node definition with `getNodeDef(type)`.
- Build default params from `def.params`.
- Create the node with shape `{ id, type, x, y, params, status: "idle" }`.
- Dispatch `ADD_NODE`.
- Select the new node.
- Set `rightTab` to `props`.
- Log and toast the add event.

For click-to-create, calculate the visible canvas center:

- Use `canvasRef.current.getBoundingClientRect()`.
- Convert the screen center through `toCanvas`.
- Offset by `NODE_W / 2` and `NODE_H / 2`.
- Add a small stagger based on node count to avoid perfect overlap on repeated clicks.

For drag/drop, use the pointer drop location as today.

### Floating Sidebar

On desktop, `.left-sidebar` should be positioned absolute within `.workspace-layout`, with a width of `292px`, `top: 16px`, `left: 16px`, high z-index, rounded border, dark translucent background, and a shadow. The canvas should keep full width behind it.

On mobile, `.left-sidebar` should remain a fixed drawer with backdrop and should not use the desktop floating offset.

### Canvas And Nodes

The canvas stays a custom DOM/SVG surface. Visual changes should be scoped to:

- `canvas-bg` inline background and related CSS.
- Node card inline styles.
- Connection line stroke/dash/glow styles.
- Optional rendered port handles if they can be added without changing connection semantics.

The interaction model remains:

- Drag nodes to move.
- Tap nodes to connect in mobile-friendly flow.
- Existing delete, keyboard shortcuts, zoom, pan, and export behavior remain intact.

### Minimap

Add a bottom-right minimap overlay on the canvas.

Behavior:

- Hidden when there are no nodes.
- Shows a framed dark panel with tiny colored rectangles for nodes.
- Shows current viewport rectangle.
- Uses existing `NODE_W`, `NODE_H`, `flow.nodes`, `pan`, `zoom`, and canvas size.
- Does not become the source of truth for pan/zoom in this iteration.

The minimap should not require a new dependency.

## Data Flow

Palette click:

1. User clicks a block button.
2. Handler computes the current viewport center in canvas coordinates.
3. Shared node creation helper builds default params and dispatches `ADD_NODE`.
4. New node becomes selected and properties tab becomes active.
5. Toast/log confirm the action.

Palette drag/drop:

1. User drags a block button.
2. `onPaletteDragStart` stores `nodeType`.
3. Drop handler reads `nodeType`, converts pointer position to canvas coordinates, and calls the shared node creation helper.

Minimap:

1. Reads `flow.nodes`, `pan`, `zoom`, and canvas dimensions.
2. Computes world bounds with padding.
3. Maps node rectangles into minimap coordinates.
4. Maps visible viewport into the same minimap coordinates.

## Error Handling

If a palette action receives an unknown type, it should do nothing except optionally show an error toast. This mirrors the existing defensive behavior in import/drop code.

If the canvas ref or dimensions are unavailable during click-to-create, fall back to a stable position such as `{ x: 220, y: 160 }` with the same default params.

If minimap bounds cannot be computed because there are no nodes, show a minimal empty minimap shell or hide the minimap.

## Responsive Behavior

Desktop:

- Floating sidebar overlays the canvas.
- Canvas fills the full available workspace.
- Right panel continues to open on the right.
- Minimap sits bottom-right above the canvas and should not overlap the right panel when it is open.

Mobile:

- Sidebar remains a drawer.
- Palette groups are still collapsible.
- Click-to-create should add the node and then close the mobile sidebar so the user sees the result.
- Minimap is hidden below `1024px` wide so it does not compete with node editing and zoom controls.

## Testing And Verification

Run:

```bash
npm run build
```

Manual verification:

- Desktop sidebar visually floats over the canvas.
- Category headers expand and collapse.
- Clicking `Motion` and `Navigation` sub-blocks immediately creates nodes on the canvas.
- Drag/drop still creates nodes.
- New nodes preserve the existing mission data shape.
- Node selection and right properties panel still work.
- Pan, zoom, delete, export, deploy modal, and run controls still work.
- Minimap appears with node rectangles and viewport frame.
- Mobile drawer still opens, collapses categories, and creates nodes without layout breakage.

## Implementation Notes

No new runtime dependency is planned. The primary files are:

- `src/App.jsx`
- `src/App.css`

`src/ros/missionSpec.js` should not change unless a regression is found in mission serialization. Backend code should not change.

## Current Repository Limitation

The current folder is not a Git repository, so this design document cannot be committed from this workspace. If the project is reopened from a Git checkout, the design doc should be committed before implementation continues.
