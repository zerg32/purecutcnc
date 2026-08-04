---
status: proposed
authoritative-for: trochoidal roughing strategy for Edge Route Inside and Edge Route Outside operations
last-verified: 2026-08-03
---

# Trochoidal Edge Routing Design

## Goal

Add trochoidal movement as a roughing strategy for the existing **Edge Route
Inside** and **Edge Route Outside** operations. The strategy follows the same
closed design boundary and respects the same inside/outside waste-side semantics
as the existing contour strategy, but clears a wider channel with overlapping
orbital movement to reduce and control tool engagement.

This is not a new operation kind. It does not change Pocket, derive centerpaths
from filled regions, or add open-path slotting. It controls load through bounded
advance per loop; it is not an exact stock-aware constant-engagement solver.

## User Model

Edge Route Inside and Edge Route Outside gain a **Strategy** control:

```text
Strategy: Contour | Trochoidal
```

When Trochoidal is selected for a rough operation, show:

- trochoidal cut width;
- advance per loop as a percentage of tool diameter and a physical distance;
- feed, plunge feed, RPM, and stepdown;
- plunge or orbital-helix entry and entry angle;
- stock to leave; and
- climb or conventional cut direction.

Pass behavior is explicit:

- Rough + Contour preserves the current behavior.
- Rough + Trochoidal clears a waste-side channel with orbital movement.
- Finish always uses the existing contour strategy.
- A Rough + Finish pair creates a trochoidal rough operation followed by a
  conventional contour finish operation when Trochoidal was selected.

The finish operation is responsible for removing radial stock and producing the
final boundary. Trochoidal roughing does not silently append a finishing contour.

## Data Model

Do not add a new `OperationKind`. Add optional Edge-specific fields to
`Operation`:

```ts
edgeStrategy?: 'contour' | 'trochoidal'
trochoidalCutWidth?: number
```

Reuse existing fields:

- `stepover` as advance per loop divided by tool diameter;
- `stepdown` for depth per level;
- `stockToLeaveRadial` for material retained at the design boundary;
- `feed`, `plungeFeed`, and `rpm`;
- `entryStrategy` and `entryRampAngle` for plunge or orbital-helix entry;
- `cutDirection`; and
- `machiningOrder` for multiple targets.

`edgeStrategy` defaults to `contour`. Existing projects therefore retain
byte-for-byte toolpath behavior when the new fields are absent.

Suggested defaults for a newly selected Trochoidal strategy are:

- cut width: `1.5 * tool diameter`;
- advance per loop: `0.1 * tool diameter`;
- orbital ramp enabled; and
- a conservative ramp angle.

The UI must not overwrite an explicitly edited cut width or advance when the
tool changes. Tool-derived values are defaults only.

## Waste-Side Geometry

Let:

```text
D = tool diameter
W = trochoidal cut width
S = radial stock to leave
R = (W - D) / 2
A = internal guide safety allowance
guideOffset = S + W / 2 + A
```

`W` is the requested channel width. The tool-center orbit has radius `R` around
a guide contour offset by `guideOffset` from the design boundary. The current
implementation uses `A = 0.01 * D` so tessellated corner and frame motion leaves
a small roughing allowance rather than risking the retained wall.

At the boundary-facing extreme, the cutter envelope stops at `S + A`. At the
waste-facing extreme, it reaches `S + W + A`. Thus no orbital movement crosses
the retained boundary when the guide and orbit are valid; a finish pass removes
the safety allowance.

For a 6 mm cutter and a 10 mm cut width with no stock to leave:

```text
R = 2 mm
guideOffset = 5.04 mm
cleared channel = 0.04 mm through 10.04 mm into the waste side
```

### Edge Route Outside

Offset the guide outward by `guideOffset`. The complete cutter sweep must remain
outside the retained feature and must respect other additive/model obstacles.

### Edge Route Inside

Offset the guide inward by `guideOffset`. The complete cutter sweep must remain
inside the subtract region. If the region or an inside corner cannot contain the
requested channel, generation fails safely instead of reducing the width or
crossing the boundary.

## Guide And Orbit Construction

The existing Edge resolvers remain authoritative for targets, Z bands, feature
roles, regions, and inside/outside selection. Trochoidal generation branches
after target resolution and before ordinary contour emission.

For each resolved boundary:

1. Construct the signed guide offset at `guideOffset` with Clipper scaling.
2. Reject collapsed, missing, disconnected, or unexpectedly split guides.
3. Flatten the guide with the shared arc and Bezier tolerances.
4. Build a cumulative arc-length representation.
5. Evaluate guide position, tangent, and normal at any path distance.
6. Select a seam on a smooth, low-curvature section.
7. Advance an integer number of trochoidal revolutions around the closed guide.
8. Subdivide moves by chord-error and angular limits.

The conceptual cutter-center path is:

```text
toolPosition =
  guidePosition(s)
  + R * (
      cos(phase) * tangent(s)
      + direction * sin(phase) * normal(s)
    )
```

Calculate the loop spacing as:

```text
requestedAdvance = stepover * D
loopCount = ceil(guideLength / requestedAdvance)
actualAdvance = guideLength / loopCount
```

Using an integer loop count makes position, phase, tangent, and Z meet at the
closed seam. Continue through the entry overlap before retracting so the seam
does not leave an uncut ridge.

The generated path uses ordinary `ToolpathMove` segments. Preview, simulation,
linear optimization, clamp handling, and all postprocessors continue to consume
the same toolpath representation. Stationary circular entry motion may be
recovered as G2/G3 by export arc fitting; the advancing trochoid may remain G1.

## Entry At Each Depth

Each depth level starts on the waste side at the selected guide seam:

1. Position at the guide center while clear of retained material.
2. If ramp entry is enabled, descend while expanding into a stationary orbit no
   larger than `R`.
3. Complete a stationary clearing orbit to establish an entry cavity.
4. Enter the advancing trochoidal path with continuous position and phase.
5. Complete the closed guide and entry-overlap section.
6. Retract or transition according to the existing safe-link rules.

If ramping is disabled, plunge at the guide center with `plungeFeed`. The UI
must warn that this requires a center-cutting tool or a pre-cleared entry. No
entry motion may cross the retained boundary or leave the requested channel.

## Curves And Corners

- Circles produce a concentric offset guide and a periodic trochoidal path.
- Rounded rectangles follow offset straight sections and rounded corners.
- Smooth arcs and Beziers use continuous tangents after shared flattening.
- The frame must be transported continuously through sampled curves and
  inflection points.
- Trochoidal roughing uses a smooth waste-side guide even when the ordinary
  contour strategy uses a miter join. The conventional finish operation remains
  responsible for the exact final contour.
- Tight inside geometry is rejected when offset topology collapses or the
  orbital sweep cannot remain in the allowed channel.

An initial local curvature gate is:

```text
localGuideRadius > R + geometryTolerance
```

This gate is not sufficient by itself. Independent swept-cutter containment
tests must establish the final tolerance and catch topology or frame failures.

## Direction Semantics

The existing `cutDirection` field remains the user control. The generator maps
climb/conventional selection to orbit orientation using both operation side and
path winding. This mapping must be tested after project Y-down coordinates are
transformed to machine Y-up coordinates.

Because a trochoidal loop interacts with both sides of the cleared channel,
documentation must describe the setting as controlling the boundary-facing
engagement direction rather than claiming every part of every loop is purely
climb or conventional.

## Existing Edge Features

### Regions, Obstacles, And Clamps

Clamp checks apply to the complete trochoidal move stream. Region masks and
additive/model obstacles currently reject Trochoidal generation with no motion,
because post-generation clipping would break orbital continuity and could plunge
into uncleared material. Future clipping support requires a validated re-entry
cavity for every retained fragment.

### Tabs

Trochoidal Edge roughing supports tabs by preserving the entire cutter-expanded
tab volume across the boundary-facing channel. Tabs must never be silently
ignored.

fragments outside the cutter-expanded tab footprint. At each tab the tool must
finish the current fragment, retract to safe Z, rapid across the tab, descend
vertically only through air to the feature top, and establish a new stationary
helical entry cavity at a validated setback point before advancing along the
next fragment. It must not plunge straight into uncleared material after a tab.
Each affected depth-level guide is split into ordered open fragments outside the
cutter-expanded tab footprint. At each tab the tool finishes the current
fragment, retracts to safe Z, rapids across the tab, descends vertically only
through air to the feature top, and establishes a new stationary helical entry
cavity at a validated setback point before advancing along the next fragment.
It does not plunge straight into uncleared material after a tab.
fragments outside the cutter-expanded tab footprint. At each tab the tool must
finish the current fragment, retract to safe Z, rapid across the tab, descend
vertically only through air to the feature top, and establish a new stationary
helical entry cavity at a validated setback point before advancing along the
next fragment. It must not plunge straight into uncleared material after a tab.

Tabs need not span the full contour or material thickness. Their XY footprint
removes only the intersecting portion of the guide, including the cutter and
orbit-radius expansion; unaffected portions remain machinable fragments. Depth
levels at or above `tab.z_top` may use the uninterrupted guide. Once a level is
below `tab.z_top`, that tab remains a protected obstacle for every deeper level.
A standard vertical endmill must not pass underneath a tab even when the tool
tip is below `tab.z_bottom`, because the cutter body would still intersect the
preserved tab volume. The first stepdown that crosses `tab.z_top` therefore
switches to fragmented generation and uses the same retract, rapid, and helical
re-entry sequence as subsequent protected levels.

Tabbed Trochoidal generation therefore requires Helix entry. A Plunge entry
selection, a fragment too short for the entry cavity, or any re-entry whose
swept cutter intersects the tab, retained boundary, or another protected volume
must fail closed with a structured warning and no operation motion. The extra
retractions, rapids, entry helices, and fragment moves count against the shared
operation move budget.

### Rest Machining

Creating a rest operation from a Trochoidal Edge operation is deferred until the
rest-region model can represent the actual swept channel. The UI must disable
that action with an explanation rather than treating the guide as an ordinary
single contour.

## Tool-Load Controls

The primary control is **Advance per loop**, shown as both a percentage of tool
diameter and a physical distance. Smaller values increase overlap and generally
reduce engagement; larger values reduce machining time but increase load.

The engine enforces:

- `W > D` by a unit-scaled geometry tolerance;
- `0 < stepover <= 1`;
- a conservative recommended advance range in the UI;
- finite positive feed, plunge feed, RPM, and stepdown;
- hard sampling, move-count, and loop-count budgets;
- reduced entry feed where required; and
- no full-width waste-side linking after the entry cavity is established.

Exact engagement-angle control against evolving stock is deferred. The UI and
documentation must use terms such as **controlled engagement** or **reduced tool
load**, not **constant engagement**.

## Validation And Warnings

Add structured warnings for:

- Trochoidal selected on a non-Edge operation;
- Trochoidal selected on a Finish pass;
- cut width not greater than tool diameter;
- invalid advance or stepdown;
- missing, collapsed, split, or degenerate guide;
- requested inside channel not fitting the region;
- local curvature too tight for the orbit;
- swept cutter crossing the retained boundary;
- obstacle or Region clipping breaking safe continuity;
- tabbed paths using Plunge entry or lacking a safe helical re-entry cavity;
- sampling or loop budget exceeded;
- non-ramping entry requiring a center-cutting tool; and
- no generated motion.

Unsafe or unsupported geometry produces no motion.

## Implementation Areas

### Engine

1. Add a focused `src/engine/toolpaths/trochoidalEdge.ts` module for guide
   validation, frame sampling, orbital entry, and closed-loop emission.
2. Keep `edge.ts` responsible for shared target resolution, Z levels, side
   selection, and dispatch between Contour and Trochoidal strategies.
3. Reuse Clipper scaling and existing Edge offset helpers rather than adding a
   second polygon-offset implementation.
4. Apply clamp processing at the established pipeline boundary; fail closed for
   Region and obstacle clipping, and fragment tabbed guides before generation.
5. Export pure geometry helpers only when tests or another engine consumer need
   them.

### Store And Persistence

Update operation defaults, normalization, unit conversion, duplication, and
toolpath cache comparison. `trochoidalCutWidth` converts between millimetres and
inches; `edgeStrategy` and `stepover` are dimensionless.

Likely files include:

- `src/types/project.ts`;
- `src/store/helpers/operationDefaults.ts`;
- `src/store/helpers/normalize.ts`;
- `src/utils/units.ts`;
- `src/app/useToolpathGeneration.ts`; and
- affected operation comparison and migration tests.

No project-format bump is expected because both fields are optional and the
operation kinds remain unchanged.

### CAM Interface

Update Edge Inside/Outside properties in `CAMPanel.tsx` with progressive
disclosure for Trochoidal controls. Pair creation must copy Trochoidal only to
the rough operation and leave the finish operation on Contour.

Update operation descriptions, parameter references, booklet fields, English,
German, and Chinese catalogs, and the rendered reference example. The operation
booklet must report strategy, cut width, orbit radius, requested/actual advance,
and entry mode.

## Testing

### Geometry Fixtures

- Edge Outside around a circle;
- Edge Inside around a circular opening;
- outside and inside rounded rectangles;
- mixed line/arc and Bezier boundaries;
- multiple target contours;
- multiple depth levels;
- climb and conventional direction;
- radial stock to leave;
- millimetre/inch conversion; and
- deterministic output.

### Safety And Coverage

- Independently rasterize the intended waste-side channel from `S` through
  `S + W`.
- Independently rasterize the swept cutter from generated moves.
- Assert the rough channel is covered within documented tolerance.
- Assert no cutter sweep crosses the retained boundary or radial stock.
- Assert decreasing advance increases overlap and loop count.
- Assert post-entry cuts overlap previously cleared material by a required
  minimum.
- Assert closed seams have no discontinuity or uncut ridge.
- Assert tight inside corners and collapsed offsets fail safely.
- Assert obstacles, Region masks, clamps, and tabs cannot create an unsafe
  direct link.
- Assert partial-span tabs remove only local guide intervals, levels above a
  partial-height tab remain continuous, and every level below `tab.z_top`
  preserves the tab without attempting an underpass.
- Assert sampling and move budgets remain bounded on large imported profiles.

### Compatibility And Integration

- Existing Edge operations without `edgeStrategy` produce unchanged moves.
- Finish operations always use Contour.
- Rough + Finish pair creation assigns strategies correctly.
- Save/load, duplication, undo/redo, and cache invalidation preserve fields.
- Preview, simulation, operation booklet, and parsed exported G-code agree.
- An end-to-end test selects Trochoidal on a rounded Edge operation, edits width
  and advance, and confirms the rendered path updates.

## Acceptance Criteria

- Edge Route Inside and Edge Route Outside offer Contour and Trochoidal roughing
  strategies.
- Circular and rounded-corner boundaries produce continuous closed trochoidal
  paths on the selected waste side.
- Cut width, radial stock, and depth match requested values within documented
  tolerance.
- No generated cutter sweep crosses the retained design boundary.
- Loop advance visibly and measurably controls overlap.
- Rough + Finish pairing uses Trochoidal roughing and conventional contour
  finishing.
- Invalid geometry produces a warning and no unsafe motion.
- Existing Edge and Pocket behavior remains unchanged unless Trochoidal is
  explicitly selected.
- Preview, simulation, saved project data, booklet, and exported G-code agree.

## Deferred Work

- open-centerpath trochoidal slotting;
- Pocket integration or arbitrary adaptive clearing;
- stock-aware exact engagement-angle control;
- automatic changes to retained design corners;
- rest machining from a trochoidal swept channel.
