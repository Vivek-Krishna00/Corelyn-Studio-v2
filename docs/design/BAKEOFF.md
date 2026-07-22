# Design Bake-off — CorelynStudio v2

Task E4. Two tracks, five screens each, judged on operator task-time,
information density at 200 nodes, E-Stop / Deploy safety, retraining cost
against the shipped v1, and extensibility to the Monitor panel.

**Neither design is applied here.** The team picks. Task D4 (apply the winner)
gets written once a track is chosen.

> **Resolution caveat.** The PNGs on disk are Stitch's 512×410 previews of
> 2560×2048 renders; the full-resolution design is the paired `.html`. Every
> judgement below about layout, geometry, adjacency, and colour is solid at
> preview scale. Judgements about fine typography — exact type sizes, tracking,
> hinting at 12px — are **provisional** and should be re-checked in the HTML
> before anything is committed to code. Where a claim depended on fine detail,
> the PNG region was cropped and upscaled, and the HTML source was read directly.

---

## Verdict

**Adopt Track 1. It is not close.**

Track 1 is the shipped v1 shell with its rough edges filed off — top command bar,
left categorised palette, right docked inspector, bottom-centre zoom pill — which
means it scores near-perfect on retraining cost, ships a working search box the
current palette only pretends to have, and puts a labelled Stop and a
confirmation-gated Deploy permanently in the operator's field of view instead of
burying the real E-Stop inside a panel tab as v1 does today. Track 2's premise —
full-bleed canvas, chrome in floating corner clusters — is the more interesting
idea and it fails on its own evidence: its floating Action Stack physically
occludes canvas content in its own version-history render, its icon-only category
dock replaces 24 labelled node names with six unlabelled colour swatches (two of
which, AGV/AMR `#d97706` and Control `#f59e0b`, are near-indistinguishable
ambers), it has no search anywhere, and on its main editor screen the Stop and
Deploy buttons — the two most dangerous controls in an industrial robot app — are
rendered as **unlabelled red and green blocks stacked ~4px apart**, which is the
exact opposite of what its own prompt asked for and is the worst mis-click
geometry either track produced. Track 2 does contribute four or five genuinely
better ideas that should be grafted onto Track 1; see §5.

---

## 1. What each track actually rendered

Both tracks: five screens, 2560×2048, PNG + HTML + manifest.

| | Track 1 | Track 2 |
|---|---|---|
| Project | `662528743987845366` | `6555571486361298299` |
| Shell paradigm | Docked: 44px top command bar, left tabbed palette, canvas fills remainder, floating bottom-centre pill, right-edge icon rail | Floating: full-bleed dotted canvas edge-to-edge, chrome in corner clusters (Action Stack TL, Status Badge TR, view switcher TC, utility cluster BR, category dock far-left) |
| Fonts in HTML | Public Sans + JetBrains Mono | Space Grotesk + IBM Plex Sans + JetBrains Mono |
| Token set | `docs/design/design-system.json` (Geist / Void Canvas `#111418` / Panel Charcoal `#17191c`) | **None committed.** Different palette (`#0c0f14` / `#181c22`), different type stack. Choosing Track 2 means discarding `design-system.json` and re-deriving tokens. |
| Nodes rendered on the busiest canvas | 6 | 5 (two clipped at the right edge) |

**Both tracks invented their node vocabulary.** Track 1 shows `Sequence`,
`Parallel`, `Drive To`, `Set Velocity`, `Get Waypoint`, `Branch`, `LIDAR_SCAN`,
`BUMP_DET`. Track 2 shows `Start Mission`, `Check Battery`, `Rotate CW`,
`Re-route`, `SEQUENCER`, `MOVE_TO_TARGET`. None of these are the 24 real types in
`shared/nodes.json`. Treat the palette contents in both as lorem ipsum, not as a
taxonomy proposal.

**Neither track renders all six categories on any screen.** Track 1's palette
shows four on `01` (Flow Control, Motion, Navigation, Control) and three on
`02`/`03`. **AGV/AMR never appears on any Track-1 screen** — which matters,
because that is where four of the five verbs in the standard mission live.

---

## 2. Screen by screen

### 2.1 Main editor — `01_main_editor`

**Track 1.** Command bar reads `CorelynStudio v2 | ● CONNECTED | ⊘ Validate |
[STOP] | ▷ Run | [DEPLOY] | mission.json | PLATFORM: C500 | Tools ⚙`. STOP is a
filled rose block with a label; DEPLOY is a filled green block with a label,
separated from `Run` by a real gap. Palette is left-docked with `PROJECTS |
BLOCKS` tabs, a live search input, and collapsible categories with colour dots
and mono IDs. Canvas holds six nodes in a left-to-right chain with **orthogonal
right-angle connectors** — `Check Battery` branches right then turns 90° down to
`End Mission`. Node cards: thin header with mono type ID and a kebab, bold label,
one param line (`DIST 30.0m`), category stripe on the left edge, small circular
ports. Bottom-centre floating pill: `mission.json`, undo/redo, zoom %,
fullscreen. Thin right-edge rail with two icon slots.

**Track 2.** Canvas is genuinely edge-to-edge and the chrome is small, which
looks good in a screenshot. Then the problems start.

- The Action Stack (top-left) renders `⊘ VALIDATE`, `▷ RUN`, a hairline divider,
  then **two unlabelled filled blocks** — a red one with a tiny square glyph and a
  green one with a cloud-upload glyph — the same size, ~4px apart, in the same
  pill. The divider that was supposed to isolate the dangerous pair instead sits
  *above* Stop, grouping Stop **with** Deploy. Verified by crop; see §3.3.
- The Category Dock is a pill hanging off the left edge holding six coloured
  circles with generic glyphs and **no labels**. Positions 4 and 5 (AGV/AMR amber
  `#d97706`, Control gold `#f59e0b`) are near-identical at any size.
- Only five nodes fit, and two of them are clipped by the right edge. Node cards
  are noticeably taller than Track 1's (header bar + label + two param lines +
  four corner ports). Connectors are **dashed**, and the routing uses enormous
  circular arcs — one arc on this screen has a radius roughly a sixth of the
  viewport.
- The dock and the Action Stack sit **on** the canvas, not beside it. Canvas
  content will pass permanently underneath them.

Track 2 bought edge-to-edge canvas width and spent it on node padding and arc
routing.

### 2.2 Node inspector — `02_node_inspector`

**Track 1.** Right-docked 320px inspector: category icon + `Move Forward` +
`BLOCK_ID: MOVE_FWD_02`, then `DISTANCE (M)` numeric, `DIRECTION` dropdown,
`OBSTACLE AVOIDANCE` toggle, `NODE LABEL` text, an `INTERNAL METADATA` block with
mono `CMD_MDE` / `VEL_REF` values, and a `RESET` / `APPLY` footer. Docked, so it
never covers the node it edits. This is v1's right panel with better typography.

Drift: on this screen the command bar's `Stop | Run | Deploy` are **contiguous
with no gaps at all**, contradicting `01` and the design system's explicit
"visually separated (extra gap, not just colour) so they can't be mis-clicked"
rule. Also `Deploy` here is a small green ghost button, not the filled block from
`01`.

**Track 2.** Bottom sheet, full width, ~35% of viewport height, rounded top,
drag handle. Header: Motion icon + `Move Forward` + `MOTION_PRIMARY.042`. Body
lays the four params **horizontally across one row** — distance, direction,
toggle, label — instead of a vertical stack. This is the best single idea in
either track: `shared/nodes.json` nodes carry up to 3 params, and a horizontal
grid fits them with zero scrolling, where v1's 270px vertical column scrolls.
The bottom-right utility cluster correctly stays above the sheet.

Cost: the sheet eats the bottom third of the graph. For a left-to-right chain
that is survivable; for a 200-node graph you are panning through, it is a third
of your working surface, and it is the third that Track 2 also puts its zoom
cluster in.

### 2.3 Deploy — `03_deploy_modal`

**Track 1.** Centred modal, scrim, canvas dimmed. `Deploy Mission` with a close
X. `MISSION CONFIGURATION`: `Filename: mission.json`, `Node Count: 12 ACTIVE`,
`Connections: 10 OK`. `TARGET PLATFORM` as three segments with C500 selected. A
rose-bordered warning: *"Mission execution starts immediately upon deployment.
Ensure the robot workspace is clear and safety interlocks are engaged."* Footer:
`Cancel` (ghost) and `DEPLOY TO C500` (filled green). This is correct ceremony
for an irreversible action — the target is restated in the button label.

Drift on this screen is the worst in Track 1: the top bar now shows a `CONNECT`
status pill **and** a separate `Connect` text button, `Validate` becomes a
blue-outlined button, and the whole `STOP / RUN / DEPLOY` cluster relocates from
centre-left to the far right of the bar. Bottom-left of the palette carries a
`Monitor` list item.

**Track 2.** A right-side drawer, ~30% width, full height, canvas dimmed behind a
plain scrim. Title `Deploy Mission`, `mission.json`, two stat tiles
(`NODES 42`, `LINKS 108`), platform segments, a red `CRITICAL:` warning block,
then a full-width green `DEPLOY TO ROBOT` button with **`Cancel and Return` as a
bare text link underneath it**. Three problems, in descending severity:

1. The reversible action is demoted to a text link while the irreversible one is
   the largest control on screen. Deploy dialogs should make Cancel at least as
   easy to hit as Deploy.
2. Between the platform selector and the warning sits a **decorative AI-generated
   photo of a robotic warehouse** (`<img src="https://lh3.googleusercontent.com/
   aida-public/…" class="w-full h-full object-cover opacity-60">`, ~35% of the
   drawer's height). Decoration inside a safety confirmation, and an external
   asset dependency. The design system bans exactly this.
3. The `DEPLOY` button in the Action Stack behind the scrim stays fully saturated
   green — no disabled state while its own drawer is open.

The drawer's one advantage over a modal is real: the graph stays visible and
un-shifted beside it, so an operator can check the mission while confirming.

### 2.4 Login — `04_login`

**Track 1.** Small centred card on the dotted canvas: logo mark,
`CorelynStudio`, `ENGINEERING CONSOLE`, `OPERATOR EMAIL`, `ACCESS KEY`, a blue
`Sign In`, `RESET SYSTEM CREDENTIALS`, a `● NODE READY` status dot and mono
`v2.4.0-stable`, plus small footer legalese. Correct, restrained, and slightly
under-designed — it reads as a dialog someone forgot to finish.

**Track 2.** Asymmetric 60/40 split. Left: `CorelynStudio` in Space Grotesk with
a rule and the tagline *"Mission authoring for autonomous fleets"*, plus a
`SYSTEM READY // DECK ALPHA` line pinned bottom-left. Right: slate panel,
`OPERATOR AUTHENTICATION` eyebrow, `EMAIL ADDRESS`, `ACCESS CODE` with a `FORGOT`
affordance, a steel `Sign In →`, then `RESTRICTED ACCESS SYSTEM / SECURE MISSION
OPERATOR CONSOLE`, and a footer bar with version, `Security`, `Status`.

**Track 2 wins this screen outright.** It is more assured, it carries the product
identity, and it is the one screen where zero density or safety risk attaches to
the choice.

### 2.5 Version history — `05_version_history`

**Track 1.** Left column: `VERSION HISTORY` header, search, rows of
`v1.0.4 / operator_admin / 2h ago / STABLE`, selected row carries a blue left
stripe. Right detail: `mission.json v1.0.4`, commit line, `Restore this version`,
three stat blocks (`NODE COUNT 142`, `CONNECTIONS 208`, `STATUS ● Stable
Deployment`), then a `STRUCTURAL DIFF SUMMARY` of four coloured rows
(`+2 nodes added to Navigation_Layer`, `-1 connection removed from
Control_Node_bk`, `Modified: Move_FWD_03 (Velocity: 0.5 → 0.8)`,
`Metadata refresh for Fleet_Manager_01`), and a filename/platform footer. The top
bar here has the *correct* safety treatment: hairline dividers isolating
`Stop | Run` and `Deploy`, all three greyed out because this is a read-only view.
Bottom-left of the shell shows `MONITOR PANEL` as a list item.

**Track 2.** Horizontal scrolling timeline of version chips across the top, one
selected with a blue underline, then a full-width detail region: `mission.json
v1.0.4`, three mono stats including `COMMIT HASH 6A7B1C3`, a
`RESTORE THIS VERSION` button, a `CHANGE SUMMARY` row of three big tiles
(`+2 Nodes added` / `-1 Connection removed` / `12 Parameters modified`), and a
`DETAILED DIFFS` list with per-row line references. A right rail carries
`METADATA` (branch, platform, verification) and a `PLATFORM VISUALIZATION`
panel. The view switcher has grown a third segment: `Editor | Monitor | History`.

The horizontal timeline reads better than a vertical list for a linear artifact,
and the three change-summary tiles are far more scannable than Track 1's diff
rows. **But this screen also contains the single most damaging finding in the
bake-off:** the floating Action Stack, anchored top-left, sits directly **on top
of the first version chip (`v1.0.5`)**, rendering it half-legible, and the
`DEPLOY` pill overlaps the `mission.json v1.0.4` detail header below it. Verified
by cropping the top-left 320×110 region and upscaling 4×. This is not a taste
call — the floating-chrome paradigm collided with content on the first screen
where content reached the top-left corner, and the generator did nothing about
it. At 200 nodes, that corner is not empty either.

---

## 3. Criterion by criterion

### 3.1 Time to author a standard mission — dock → pick up cargo → navigate → drop cargo → return to charge

Grounded in the real v1 (`src/App.jsx`), not a guess. Today: the palette
(`NodePalette`, line 1968) lists all 24 types in six collapsible categories with
labels; clicking a block adds it at canvas centre (`addNodeFromPalette`, 453) or
you can drag it (`onPaletteDragStart`, 2007). **The v1 search box is decorative —
it is a `div` with `aria-hidden="true"` and no input** (1980-1983). So authoring
is: expand category → click block, ×5, then wire and configure in the always-open
270px right panel.

The five verbs needed: `dock_at_station`, `pick_up_cargo`, `go_to_waypoint`,
`drop_cargo`, `go_charge` — four in AGV/AMR, one in Navigation.

**Track 1: parity to modest improvement.** Same palette structure, same click or
drag, same right-docked inspector — but the search input is real, which turns two
category expansions plus visual scanning into typing `dock`. `BLOCKS` is the
default tab, so the added `PROJECTS` tab costs nothing on the hot path. The
inspector is docked, so configuring a node never occludes the node.

**Track 2: regression.** There is no search anywhere in five screens. Node lookup
means recognising one of six unlabelled colour circles, then opening a flyout
that **was never rendered** — the prompt only asks Stitch to "imply the palette
flyout is available from there", and the delivered screens contain no flyout, no
node list, and no node labels of any kind. So the most important interaction in
the app is undesigned. Even granting a good flyout, the operator must memorise
that AGV/AMR is the fourth amber circle and Control is the fifth, near-identical
one, for the four-of-five verbs that live in AGV/AMR. Add the bottom sheet
covering the lower third of the canvas while configuring, and this is slower than
v1 — which the PRD success metric forbids.

### 3.2 Information density and legibility at ~200 nodes

**Neither track demonstrates this.** Track 1's busiest canvas has 6 nodes;
Track 2's has 5, two clipped. Track 1's own `05` cites `NODE COUNT 142 /
CONNECTIONS 208` in a stat block while showing zero nodes. The PRD §10.2 question
is unanswered by both, and should be answered before code is written.

What *can* be judged:

| | Track 1 | Track 2 |
|---|---|---|
| Node card height | Compact — header, label, one param line | Taller — header bar, label, two param lines, four corner ports |
| Category encoding | 2px left stripe, no fill, no glow | Left stripe plus a 2px full outline when selected |
| Connectors | Orthogonal right-angle routing | Dashed lines plus very large-radius circular arcs |
| Chrome vs canvas | Docked panels reserve their own space; nothing is ever hidden | Floating clusters overlay the canvas permanently |
| Canvas width | Reduced by fixed palette + inspector | Full bleed |

Track 1's token choices are right for scale: hairline borders
`rgba(255,255,255,0.08)`, grid dots at 28%, no glow, colour confined to a stripe.
Notably v1 today puts `boxShadow: 0 0 14px <color>55` on palette category dots
(line 1993); Track 1 drops glow entirely, which is the correct direction.

Track 2's full-bleed canvas is a real advantage that it then gives back three
ways: taller cards, arc routing that will overlap badly once graphs are dense,
and — decisively — chrome that occupies canvas coordinates. With a docked shell,
an operator can pan any node into clear view. With floating chrome, the top-left,
mid-left, and bottom-right of the viewport are permanently compromised, and
`05_version_history` proves the generator does not handle the collision.

Open against both: neither designs a **collapse-to-rail** state, and neither
retains v1's minimap (`CanvasMiniMap`, line 2027; `.canvas-minimap` at
`App.css:427`, 176×116 at `bottom:18px; right:18px`). At 200 nodes the minimap is
the primary navigation aid. Track 1's bottom-**centre** pill leaves that slot
free, matching v1 exactly. **Track 2's utility cluster is anchored bottom-right —
directly on top of v1's minimap.**

### 3.3 Discoverability and mis-click safety of E-Stop and Deploy

The safety criterion, and the one where the tracks separate hardest.

**Today's v1 is the baseline and it is bad.** `Run` / `Stop` / `Deploy` are in
the top toolbar (1334-1336), but the real destructive control — `⊗ EMERGENCY
STOP`, which zeroes speed and halts the mission (1232) — lives inside the right
panel's `CTL` tab. It is invisible unless that panel is open *and* that tab is
selected, and the panel can be collapsed to zero width (1724). For a machine that
moves, that is the wrong place. Both tracks improve on it. They do not improve
equally.

**Track 1.**
- `STOP` is a filled rose block with the word `STOP`, permanently in the command
  bar, never behind a tab.
- `DEPLOY` is a filled green block with the word `DEPLOY`, gapped away from
  `Run`.
- Deploy is gated by a modal that restates filename, node count, connection
  count, target platform, and an explicit warning that execution begins
  immediately, with `Cancel` as a real button and the target platform repeated in
  the confirm label.
- **Weakness:** gap discipline is inconsistent. `01` gaps before Deploy but keeps
  Stop and Run adjacent; `05` uses proper hairline dividers and disabled states —
  this is the correct treatment and should be the canonical one; `02` renders all
  three contiguous with no separation at all; `03` moves the whole cluster to the
  opposite end of the bar.

**Track 2.**
- On `01_main_editor`, Stop and Deploy are **unlabelled filled blocks**, same
  size, stacked ~4px apart, with the divider grouping them together rather than
  separating them. Recognition rests entirely on red vs green, which is precisely
  the discrimination roughly 8% of male operators cannot make reliably. In an
  industrial robot control app that is disqualifying on its own until fixed.
- On `03_deploy_modal` they gain `STOP` / `DEPLOY` labels — good — but remain
  directly adjacent with no divider between them.
- The deploy drawer demotes `Cancel and Return` to a text link beneath a
  full-width green `DEPLOY TO ROBOT` button.
- The drawer carries a decorative warehouse photograph.
- The Action Stack's `DEPLOY` stays live-green behind the deploy scrim.

Track 2's *stated* intent — larger buttons, physical separation — is correct and
better than Track 1's uniform 28px control height. The render inverted it.

**Open against both tracks:** v1 has two distinct concepts — stop the mission
(1335) and emergency-stop the robot (1232). Both tracks collapse them into one
`Stop`. That must be resolved before apply. An E-Stop must never carry a
confirmation dialog; a mission pause may.

### 3.4 Retraining cost against the v1 mental model (PRD §10.5)

Measured against what `src/App.jsx` and `src/App.css` actually do today.

| Concept | v1 today | Track 1 | Track 2 |
|---|---|---|---|
| Run / Stop / Deploy | Grouped centre toolbar in the 52px top bar (1331-1336) | Grouped cluster in the 44px top bar | Vertical floating stack, top-left corner |
| Block palette | Left, collapsible categories, labels + colour dots, click or drag (1968) | Left, collapsible categories, labels + dots, plus tabs and a *working* search | Six unlabelled colour circles on the left edge; flyout not designed |
| Palette search | Present but decorative, `aria-hidden` (1980) | Real 28px input | Absent |
| Inspector | Right panel, 270px, tabbed NODE/CTL/LOG (1724) | Right panel, 320px, docked | Bottom sheet, ~35% viewport height |
| Zoom / fit controls | Floating pill, **bottom-centre** (1646) | Floating pill, bottom-centre | Cluster, bottom-right |
| Minimap | Bottom-right, 176×116 (`App.css:427`) | Absent (slot free) | Absent (slot **taken** by the utility cluster) |
| Connection / status | Left of the top bar (1317-1326) | Left of the top bar | Badge, top-right |
| Emergency stop | Right panel → CTL tab (1232) | Top bar, merged into `Stop` | Action Stack, merged into `Stop` |
| View switching | — | Right-edge icon rail (additive) | Top-centre segmented control (additive) |

**Track 1 ≈ v1 + tabs + a rail + a working search.** Every spatial anchor an
operator has already internalised survives, including the bottom-centre zoom pill
at the exact same position. The only genuine relearn is the E-Stop moving — and
it moves *toward* visibility, which is the change you want to pay for.

**Track 2 moves every single anchor.** Palette, inspector, zoom, run controls,
status. There is no muscle memory left to carry over, and one move (utility
cluster onto the minimap slot) is an active collision. PRD §10.5 explicitly asks
to preserve familiar patterns; Track 2 is the opposite of that by construction.

### 3.5 Extensibility to the Monitor panel (camera, 2D LiDAR map, telemetry, alerts)

This one splits: Track 2 has the better **affordance**, Track 1 has the better
**container**.

**Track 1** reserves the Monitor slot — but in three different places across five
screens: a right-edge vertical rail on `01` and `02`, a bottom-left `Monitor`
list item under the palette on `03`, and a bottom-left `MONITOR PANEL` item on
`05`. The rail is the better of the two, because it makes Editor/Monitor a
peer-level view switch, matching the spec's framing of Monitor as a full-canvas
alternate view rather than a sidebar widget. A bottom-left list item implies a
minor tool. But the rail is **icon-only with no labels**, which is weak
discoverability for a view an operator visits rarely.

**Track 2's top-centre segmented `Editor | Monitor` is better** — labelled text,
canonical placement for a view switch, and `05` proves it scales by growing a
third segment (`History`) without disturbing anything. That inconsistency is
actually the useful evidence.

But Monitor's *content* is camera + occupancy map + telemetry + alerts feed —
four dense regions that want a panel grid with reserved space. Track 1's docked
shell already provides that; the palette region becomes an alerts feed, the
inspector region becomes telemetry, the canvas region becomes camera/map, and
nothing renegotiates. Track 2's floating clusters over a full-bleed surface would
put semi-transparent chrome on top of a bright camera feed and a white occupancy
map — the paradigm's one weakness at its worst.

---

## 4. Scorecard

Scored 1-5, criteria in the priority order given.

| # | Criterion | Track 1 | Track 2 | Note |
|---|---|---|---|---|
| 1 | Time to author a standard mission | **4** | 2 | T1 parity-plus (real search, docked inspector). T2 has no search and no designed palette flyout. |
| 2 | Density / legibility at ~200 nodes | **3** | 2 | Undemonstrated by both. T1's tokens and orthogonal routing scale; T2's taller cards, arc routing, and canvas-occupying chrome do not. |
| 3 | E-Stop / Deploy discoverability + mis-click safety | **4** | 2 | T1: labelled, always visible, real confirm; gap discipline drifts across screens. T2: unlabelled adjacent colour blocks, Cancel demoted to a link, decoration in the safety dialog. |
| 4 | Retraining cost vs v1 (PRD §10.5) | **5** | 1 | T1 preserves every anchor. T2 moves all of them and lands one on the minimap. |
| 5 | Monitor extensibility | 3 | **4** | T2's labelled top-centre segmented switcher is the better affordance (and proved it scales to 3). T1's docked shell is the better container. |
| | **Total** | **19 / 25** | **11 / 25** | |

---

## 5. Honest weaknesses of Track 1 — what the team is accepting

1. **Density at 200 nodes is asserted, never shown.** The design system claims
   "Density 9 … high information density at 200+ nodes"; the busiest render has
   six. Generate or hand-mock a 200-node canvas before committing to fixed panel
   widths. This is the largest open risk in the recommendation.
2. **Fixed left palette + fixed right inspector with no collapse state
   generated.** v1 already has both toggles (`sidebarOpen` 1382,
   `rightPanelOpen` 1724). If the redesign is applied literally, that is a
   regression. Add collapse-to-rail explicitly.
3. **The command bar is not the same bar twice.** Across four shell screens: `01`
   left-aligned cluster with a gap before Deploy; `02` contiguous
   `Stop|Run|Deploy` with no separation at all; `03` cluster relocated to the far
   right, `Connect` duplicated as both a pill and a button, `Validate` restyled;
   `05` dividers plus disabled states. Screen `05` has the correct treatment.
   Pick it, write it down, discard the others.
4. **No screen shows AGV/AMR.** Four of the five verbs in the standard mission
   live there. The palette was never rendered with all six categories, so its
   behaviour at 24 items across 6 groups is unverified.
5. **One `Stop`, two concepts.** Same open item as Track 2, and it is a safety
   decision, not a visual one.
6. **Monitor slot placed three different ways.** Pin the right-edge rail from
   `01` as canonical (or replace it per §6.1) and delete the bottom-left
   variants.
7. **No minimap.** Track 1 leaves the bottom-right slot free, so this is
   recoverable — but nobody drew it, so nobody has checked it against the new
   node card styling.
8. **Node cards show only one param line.** At a glance you cannot distinguish a
   configured node from a default one. `dock_at_station` has three params; only
   one is visible.
9. **Login is the weakest screen in either track** — a small centred card that
   reads unfinished. See the graft in §6.4.
10. **Typography drift:** the HTML uses Public Sans while `design-system.json`
    specifies Geist. Trivial, but it means the committed token file does not
    describe the committed screens. Fix one or the other.
11. **Right-edge rail is icon-only, unlabelled.** Same discoverability complaint
    Track 2 earns for its category dock, at smaller scale.

---

## 6. Hybrid — what to graft from Track 2

This is where Track 2 earns its generation cost. Ranked by value.

### 6.1 Replace the right-edge icon rail with Track 2's top-centre segmented switcher — **take this**
`Editor | Monitor` as labelled text segments, top-centre. It is more discoverable
than an unlabelled icon rail, it is the canonical control for peer-level views,
and Track 2's `05` demonstrates it absorbing a third segment (`History`) without
any layout change. Adopting it also settles Track 1's three-way Monitor
placement drift in one move, and frees the right edge entirely.

### 6.2 Horizontal param grid in the inspector — **take this**
Track 2's bottom sheet lays four params across one row. `shared/nodes.json` nodes
carry at most three params, so a **2-column grid inside Track 1's right dock**
fits every node type with no scrolling, versus v1's scrolling single column.
Keep Track 1's *placement* (docked right, never occludes the node); take Track
2's *arrangement*. Do not take the bottom sheet itself — it costs a third of the
canvas.

### 6.3 Size differential on Stop and Deploy — **take the intent, not the render**
Track 2's prompt is right that the two dangerous controls should be *visibly
larger* than Validate/Run, not merely differently coloured. Track 1 puts every
control at a uniform 28px. Graft: Stop and Deploy get a larger hit target than
the neutral actions, keep Track 1's placement, labels, and — critically —
`05`'s hairline divider isolating each of them. Explicitly do **not** copy Track
2's adjacency or its unlabelled icon buttons.

### 6.4 Asymmetric split login — **take it wholesale**
Track 2's 60/40 split is better than Track 1's centred card on every axis, it
carries the product identity, and being pre-auth it carries zero density and zero
safety risk. Restyle it in Track 1's tokens (Geist, Panel Charcoal `#17191c`,
Void Canvas `#111418`, Motion Blue primary) and ship it.

### 6.5 Version-history change-summary tiles — **take these**
Track 2's three big tiles (`+2 Nodes added` / `-1 Connection removed` /
`12 Parameters modified`) are scannable in a way Track 1's four coloured diff
rows are not. Also worth taking: the `COMMIT HASH` stat, and per-row line
references in the detailed diff. Keep Track 1's left-list / right-detail
structure — the horizontal timeline is prettier but scrolls horizontally, which
is worse once there are fifty versions, and it is the layout that collided with
the Action Stack.

### 6.6 Merged status badge — **consider**
Track 2 combines connection dot + `mission.json` + platform chip into one
top-right unit. Track 1 scatters those across the bar. Grouping them reads as
"what am I connected to, running what, on which platform" in a single glance.
Low cost, modest benefit.

### 6.7 Deploy as a right drawer instead of a centred modal — **consider, with conditions**
The drawer's advantage is real: the graph stays visible and un-shifted while you
confirm, which is worth something when the confirmation's job is "check this is
the mission you meant". If taken, it must keep Track 1's modal content and
button treatment: `Cancel` as a real button of comparable weight, no decorative
imagery, the target platform in the confirm label, and the Deploy control in the
main chrome disabled while the drawer is open. If those conditions feel like
work, keep the modal — Track 1's version is already correct.

### 6.8 Explicitly reject
- The icon-only category dock. Six unlabelled circles, two of them
  indistinguishable ambers, replacing 24 labelled node names.
- The floating-chrome-over-full-bleed-canvas paradigm. It occludes content, and
  `05_version_history` shows the collision happening.
- Dashed connectors and large-radius arc routing.
- The decorative warehouse image, the `PLATFORM VISUALIZATION` panel, and any
  external image asset.
- `Cancel` as a text link.
- Anchoring anything to bottom-right — that is the minimap's slot.

---

## 7. Open items to resolve before D4 applies anything

1. **`Stop` semantics.** One control or two? v1 has mission-stop and
   emergency-stop as separate things. Both tracks show one. An E-Stop must not
   have a confirmation dialog; a mission pause may. Decide, then design.
2. **200-node canvas.** Unanswered by both tracks. Mock it before committing to
   fixed palette and inspector widths, and add collapse-to-rail for both.
3. **Minimap.** Retain it, at bottom-right, and check it against the new node
   styling. Do not put anything else in that corner.
4. **Canonical command bar.** Adopt `05_version_history`'s treatment — dividers
   around Stop and around Deploy, explicit disabled states — and discard the
   `01` / `02` / `03` variants.
5. **Monitor placement.** Adopt §6.1 and delete every other Monitor affordance.
6. **PRD §10.5.** The PRD is not in this repo. Mental-model fit was assessed
   against the shipped `src/App.jsx` / `src/App.css` as the de-facto model.
   Confirm against the actual document; if §10.5 describes something the current
   build does not implement, re-check §3.4.
7. **Token file vs screens.** `design-system.json` says Geist; the HTML says
   Public Sans. Reconcile before either becomes code.
8. **Node vocabulary.** Both tracks invented node names. The palette must be
   rebuilt from `shared/nodes.json` — 24 types, 6 categories
   (motion 6, agv_amr 6, control 4, navigation 3, sensing 3, flow 2).

---

## 8. Evidence

All ten PNGs were read directly. Regions where the judgement depended on
geometry or adjacency were cropped and upscaled 4× before being read again:

| Crop | What it established |
|---|---|
| `track2/01` top-left 120×290 | Stop and Deploy are unlabelled filled blocks ~4px apart; divider sits above Stop; category dock circles are unlabelled with two near-identical ambers |
| `track2/03` top-left 120×290 | Stop/Deploy labelled here but still adjacent with no divider between them |
| `track2/05` top-left 320×110 | Action Stack occludes the `v1.0.5` version chip; `DEPLOY` pill overlaps the detail header; switcher has three segments |
| `track1/01`, `02`, `03`, `05` top bars | Command-bar composition differs on all four screens; `05` has the correct divider and disabled treatment |
| `track1/01` nodes 200×100 | Compact cards, one param line, orthogonal right-angle connectors |
| `track2/01` nodes 220×80 | Taller cards, four corner ports, dashed connectors, large-radius arcs |

HTML sources were read for: font stacks (`Public Sans` vs `Space Grotesk` /
`IBM Plex Sans`), and the external `<img>` in `track2/03_deploy_modal.html`
(`lh3.googleusercontent.com/aida-public/…`, `object-cover opacity-60`).

Repo evidence for retraining cost and density: `src/App.jsx` — top bar 1301-1407,
Run/Stop/Deploy 1334-1336, zoom pill 1646, minimap mount 1656, right panel
1702-1739, EMERGENCY STOP 1232, `NodePalette` 1968-2025 (decorative search at
1980, glow on category dots at 1993), `addNodeFromPalette` 453; `src/App.css` —
`.canvas-minimap` 427; `shared/nodes.json` — 6 categories, 24 node types;
`docs/design/design-system.json`; spec §10 and §14; plan Task E4.

No screens were generated for this task. E4 is read-and-judge. Nothing was
invented for either track.
