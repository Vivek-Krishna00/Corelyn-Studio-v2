# Responsive UI — design spec

Date: 2026-07-22. Approved by user in session.

## Goal
Corelyn Studio's editor shell adapts to any window size down to 700×550 (half-screen laptop). Today the top bar clips (telemetry/Settings pushed out) below ~1400px, panels are fixed-width, and Electron enforces a 1024×680 floor.

## Approach
CSS-first: media queries + fluid widths in `App.css`, reusing the app's existing `matchMedia` hook pattern for the two behavioral changes (drawer mode, overflow menu). No layout-measuring JS, no new dependencies.

## Breakpoints
- **≥1200px** — layout exactly as today.
- **1000–1199px (compact)** — brand tagline ("PROGRAM | DEPLOY | DOMINATE") hidden; Clear/Export/Import become icon-only with `title` tooltips; telemetry (BATT/VEL/CONNS) compacts (smaller padding/font).
- **<1000px (narrow)** — Run, Stop, Deploy remain visible buttons. Clear, Export, Import, CHAIN, and all telemetry move into a `⋯` overflow menu (button next to Settings; simple dropdown, closes on click-away/Esc). Both side panels auto-close and become overlay drawers over the canvas with a dim backdrop: palette slides from the left (new toggle button in the top bar), NODE/CTL/LOG panel slides from the right (existing chevron). Only one drawer open at a time.

## Panels
- Docked palette width becomes `clamp(240px, 22vw, 320px)` (was fixed ~320px).
- Right panel keeps its current docked collapse behavior ≥1000px.
- The existing half-built `mobileRightOpen` path (matchMedia 1023px) is finished and aligned to the 1000px breakpoint.

## Window floor
`electron/main.cjs`: `minWidth: 700, minHeight: 550` (was 1024×680).

## Canvas & floating UI
Canvas already flexes. Zoom pill and minimap get safe margins so they never overlap or leave the viewport at small sizes.

## Modals & auth pages
Deploy modal and Settings panel: `max-width: min(current, calc(100vw - 32px))`, `max-height: calc(100vh - 32px)` with internal scroll. Login/Signup already center; reduce vertical padding under 700px height so the form and submit button fit without clipping.

## Testing
- New `tests/e2e/responsive.spec.js`: launch Electron at 700×550 and ~980×700; assert no horizontal clipping in the top bar (all controls reachable incl. via overflow menu), drawers open/close over the canvas, deploy modal fully visible.
- All existing e2e tests stay green. The 7 visual baselines (1440×872) are regenerated only if rendering at that size actually changes.

## Out of scope
Phone-size (<700px) support; touch gestures; canvas content reflow; changes to node card sizing.

## Accepted deviations
- **Palette clamp upper bound**: shipped as `clamp(240px, 22vw, 292px)`, not the `320px` this spec originally called for. 292px is the palette's actual pre-existing fixed width, and pinning the clamp's ceiling to it keeps the 1440×872 visual baselines byte-identical instead of widening the docked palette (and forcing a baseline regeneration) for no functional gain.
- **Deploy modal `maxHeight`**: kept at `85vh` rather than switching to `calc(100vh - 32px)`. `85vh` already fits fully within 700×550 with its existing internal scroll, and — unlike `calc(100vh - 32px)` — it provably preserves rendering at large window sizes, since it's the value already in production there.
