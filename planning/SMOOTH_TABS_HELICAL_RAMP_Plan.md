# Smooth Tabs, Helical Drilling & Ramp Entry

> **Status:** Implemented (uncommitted)
> **Scope:** Tab toolpath (gaussian Z), helical drill cycle, ramp entry strategies + wiring fix, zigzag ramp direction fix, post-processor fixes (Z axis, tool change approach, obstacle-clipper rapid drop, inter-level retract elimination)
> **Last updated:** 2026-06-30

---

## 1. Overview

Three independent CAM features:

- **Smooth tabs** — Replace the old circular-footprint round tab with a rectangular-footprint smooth tab whose Z follows a gaussian curve across the tab interval, producing a gradual ramp up and down instead of a step.
- **Helical drilling** — A `G2`/`G3` helical interpolation drill cycle that descends in a spiral, reducing axial load.
- **Ramp entry** — Optional zigzag or spiral ramp entry for pocket and edge operations, replacing straight vertical plunges.

All three are implemented, tested (tsc + 80 test files), and bundled (Vite). Changes are uncommitted on `main`.

---

## 2. Smooth Tabs

### 2.1 What changed

| File | Change |
|------|--------|
| `src/types/project.ts` | `Tab.shape` type: `'rect' \| 'round'` → `'rect' \| 'smooth'`; optional with `'smooth'` default |
| `src/engine/toolpaths/tabs.ts` | Added `shape` field to `PreservedObstacle`; `buildTabObstacles` uses `rectProfile` for both shapes (no more `circleProfile`); gaussian Z in `splitCutMoveAcrossTabsFrom` |
| `src/engine/csg.ts` | Removed `circleProfile` from `buildTabMesh` — smooth tabs use rectangular mesh |
| `src/components/canvas/scenePrimitives.ts` | Removed `circleProfile` from `drawTabFootprint` — smooth tabs render as rectangle |
| `src/store/helpers/normalize.ts` | Default `shape` changed from `'round'` to `'smooth'` |
| `src/store/slices/tabsSlice.ts` | Auto-placed tabs default to `shape: 'smooth'`; simplified naming to `"Tab N"` |
| `src/store/slices/pendingAddSlice.ts` | Manual "Add Tab" creates `shape: 'smooth'` |
| `src/components/feature-tree/PropertiesPanel.tsx` | Shape dropdown: `Rectangle` / `Smooth` |

### 2.2 Algorithm

Each horizontal cut segment is tested against tab obstacle polygons via `clipSegmentPolygon2D`. For each intersecting tab:

- **Rect tabs** (unchanged): raise Z to `zTop` across the full `[t_entry, t_exit]` interval — step behaviour.
- **Smooth tabs**: subdivide the interval into 20 sub-segments, each with Z computed from a gaussian:

  ```
  z = baseZ + amplitude · exp(−((t_local − 0.5) / 0.18)²)
  ```

  where `t_local` ∈ [0, 1] across the interval, `amplitude = zTop − baseZ`.

Within each sub-segment, Z and XY change in a single diagonal G1 move — no stair-stepping (no separate vertical lead_out followed by horizontal cut).

### 2.3 Backward compatibility

`shape` is optional (`Tab.shape?`). Projects without the field normalize to `'smooth'`.

---

## 3. Helical Drilling

### 3.1 What changed

| File | Change |
|------|--------|
| `src/types/project.ts` | `'helical'` added to `DrillType` union; `helixDiameter`, `helixPitch` on `Operation` |
| `src/engine/toolpaths/drilling.ts` | New `emitHelicalDrill` function; wired into `generateDrillingToolpath` |
| `src/components/cam/CAMPanel.tsx` | Helical in drill-type dropdown; helix diameter/pitch fields |

### 3.2 Algorithm

`emitHelicalDrill` generates `G1` segments along a helical path:

1. Rapid to safe-Z above hole centre
2. Rapid to retract height on hole centre
3. Rapid to helix start (hole centre + helix radius at angle 0)
4. 32 segments per revolution, descending at `helixPitch` per revolution
5. Minimum 1 revolution; additional revolutions to reach `bottomZ`
6. Final straight plunge if last helical segment doesn't reach `bottomZ`
7. Rapid retract to safe-Z

`helixDiameter` defaults to `tool.diameter` if not set; `helixPitch` defaults to `operation.stepdown`.

### 3.3 Backward compatibility

`helixDiameter`, `helixPitch` are optional; drill operations without them behave as before.

---

## 4. Ramp Entry

### 4.1 What changed

| File | Change |
|------|--------|
| `src/types/project.ts` | `rampEntry`, `rampAngle`, `rampType` on `Operation` |
| `src/engine/toolpaths/geometry.ts` | Shared `pushRampOrPlunge` and `retractToSafe`; zigzag + spiral strategies |
| `src/engine/toolpaths/edge.ts` | Delegates to shared `pushRampOrPlunge`; removed local `pushRapidAndPlunge`/`retractToSafe` |
| `src/engine/toolpaths/pocket.ts` | Delegates to shared `pushRampOrPlunge`; removed local `pushRapidAndPlunge`/`retractToSafe` |
| `src/components/cam/CAMPanel.tsx` | Ramp entry checkbox + angle + type fields for pocket/edge operations |

### 4.2 Wiring fix (2026-06-30)

The ramp entry feature was **dead code**: `pushRampOrPlunge` accepted `rampEntry`, `rampAngle`, `rampType` but no call site ever passed them. The UI stored settings on the `Operation` object and the helper function had the logic, but the intermediate call chain was missing.

**Fix**: Threaded ramp params through every intermediate function to the actual `pushRampOrPlunge` call:

| File(s) | Functions | What changed |
|---|---|---|
| `pocket.ts` | `transitionToCutEntry`, `cutClosedContours`, `cutOffsetRegionRecursive` | Added optional `rampEntry?`, `rampAngle?`, `rampType?` params; pass through to `pushRampOrPlunge` |
| `pocket.ts` | `generateRoughBandMoves` | Pass `operation.rampEntry` etc. at 3 call sites (lines ~934, ~947, ~973) |
| `pocket.ts` | `generateFinishBandMoves` | Pass `operation.rampEntry` etc. at 3 call sites (lines ~1048, ~1054, ~1063) |
| `edge.ts` | `transitionToCutEntry`, `appendContoursAtLevels` | Added optional ramp params; pass through to `pushRampOrPlunge` |
| `edge.ts` | `generateEdgeRouteToolpathSingle` | Pass `operation.rampEntry` etc. at 3 call sites (lines ~417, ~518, ~541) |

All ramp params are optional on every function. Callers in `surface.ts`, `finishSurface*.ts`, `vcarve.ts` etc. don't pass them and get `undefined` (no ramp, unchanged behaviour).

### 4.3 Ramp generation fixes (2026-06-30)

After the wiring fix, ramp entry still wasn't producing ramp moves. Two additional root causes:

#### 4.3.1 `xyDist=0` blocked all ramp types

**Problem**: `pushRampOrPlunge` required `xyDist > 0` to enter the ramp logic. The first entry of every operation has `from=null`, which sets `start=(toXY.x, toXY.y, safeZ)`, making `xyDist=0`. This blocked **all** ramps on the first level.

**Fix** (`geometry.ts:279`): Removed the blanket `xyDist > 0` gate. Spiral ramps have their own radius (`Math.max(xyDist * 0.3, 0.1)`) and work with zero XY travel. When `xyDist=0` the ramp type automatically falls back to spiral (since zigzag requires XY movement to create a slope).

#### 4.3.2 Same-XY shortcut bypassed `pushRampOrPlunge`

**Problem**: `transitionToCutEntry` in both `edge.ts` and `pocket.ts` had a shortcut: when the tool is already at the target XY (same contour start point across levels), it emitted a direct vertical plunge without calling `pushRampOrPlunge`. This bypassed the entire ramp logic on every subsequent level.

**Fix**: When `rampEntry` is enabled and the move is descending, the same-XY shortcut now falls through to `pushRampOrPlunge` instead of emitting a direct plunge. The tool retracts to safeZ then executes a spiral ramp down at the same XY position.

### 4.4 Algorithm

When `rampEntry` is enabled, `pushRampOrPlunge` replaces the vertical plunge with a sloped entry:

- **Zigzag**: linear interpolation between start XY and target XY while descending at `rampAngle`. Requires `xyDist > 0`.
- **Spiral**: circular interpolation around target point, tightening radius while descending. Works at any XY distance (falls back to when zigzag would produce no XY movement).

`rampAngle` default: 5°. `rampType` default: `'zigzag'`. When `xyDist=0`, spiral is used regardless of `rampType`.

### 4.5 Zigzag ramp direction fix (2026-06-30)

**Problem**: The zigzag ramp (same-XY case) emitted a G0 rapid perpendicular to the cut (+X), then a descending G1 back to the entry point — a nudge-and-return perpendicular to the intended cut direction. For a cut along the Y axis, this produced an unwanted 19.7 mm X excursion.

**Root cause**: `pushRampOrPlunge` handles the same-XY zigzag case by computing a perpendicular nudge direction (`perp` vector = `{1, 0}` when no prior XY direction exists). This is correct for true same-XY positioning but wrong for edge-routing ramp entry.

**Fix**: Replaced the localized 2-leg zigzag (first segment only) with a **segments-accumulating zigzag** that walks forward along the contour accumulating multiple segments until the required XY travel is reached, then retraces in reverse.

**Algorithm** (`appendContoursAtLevels` in `edge.ts`):
1. Rapid to entry point at previous Z (or safeZ for first entry)
2. Walk forward from `contour[0]`, accumulating full contour segments (partially splitting the last one), until total XY distance = `rampLen/2`
3. First zigzag leg: emit the accumulated path with Z descending from `entryZ` to `midZ` (`entryZ - zDrop/2`)
4. Second zigzag leg: retrace the same accumulated path in reverse, Z descending from `midZ` to `targetZ`
5. Full flat contour at target Z via `toClosedCutMoves`
6. If the half-leg XY distance < 0.5 mm, fall back to spiral ramp at the entry point

This works for any contour shape — circles (accumulates many tiny chords), rectangles (accumulates part of the first edge), complex polygons — because the ramp uses the actual contour path, with Z descending proportionally per unit of XY travel.

Sample G-code for a circle (many small chords along arc):
```
G1 X6.77 Y6.24 Z-0.28   ; forward along circle arc segments
G1 X6.85 Y6.16 Z-0.39   ;  (each small chord drops Z proportionally)
...                       ;  continuing until rampLen/2 reached
G1 X10.03 Y3.42 Z-2.30  ; mid-point of ramp
G1 X9.44 Y3.88 Z-2.50   ; retrace back in reverse order
...                       ;
G1 X6.57 Y6.44 Z-4.60   ; back at entry at full depth
G1 X6.77 Y6.24 Z-4.60   ; full flat contour at target Z
```

Sample G-code for a rectangle (partial first edge):
```
G1 X0 Y40 Z-2.50        ; forward along +Y edge (40mm = rampLen/2)
G1 X0 Y0 Z-5.00         ; back to entry
G1 X0 Y100 Z-5.00       ; full flat contour
G1 X100 Y100 Z-5.00
G1 X100 Y0 Z-5.00
G1 X0 Y0 Z-5.00
```

`pushRampOrPlunge` in `geometry.ts` is unchanged — it still handles the different-XY zigzag case and spiral ramps.

**Implementation**: `src/engine/toolpaths/edge.ts:274–360`

### 4.6 Inter-level retract elimination (2026-06-30)

**Problem**: `clipToolpathResultToObstaclesByLevel` in `regions.ts` filtered the toolpath to only `kind: 'cut'` moves, discarding transition moves between levels. The rebuild step then emitted full retract→rapid→plunge for every level transition, even when XY was unchanged and ramp entry was active.

**Fix** (`regions.ts:309-370`): Process all moves instead of cut-only. Non-cut moves (rapid, plunge) pass through unchanged; only cut moves that intersect an obstacle get clipped. This preserves the ramp transitions between levels.

### 4.7 Backward compatibility

All ramp fields are optional; operations without them use the original vertical plunge.

---

## 4a. Post-processor fixes (G-code output reliability)

### 4a.1 Missing G0 rapid after tool change

**Problem**: After a tool change that emitted raw G-code commands (probe sequence, Z retract to Z30), the post-processor's `state.currentPosition` still held the last tracked position from the previous operation. The first move of the next operation's `transitionToCutEntry` generated a no-op rapid (from safeZ to same safeZ), so the post-processor saw no Z change and emitted a direct `G1` from Z30 to cut depth at feed rate — a 34mm feed plunge through air + material.

**Fix** (`src/engine/gcode/postprocessor.ts:231-235`): Reset `state.currentPosition = null` after emitting tool change commands. The first move of the next operation now sees `current=null`, forcing a full `G0 Z<safeZ>` rapid + `G0 X Y` before any cut.

### 4a.2 Inter-layer retract not skipped for ramp entry

**Problem**: When `from` existed, XY differed, and the travel distance exceeded `maxLinkDistance`, both `transitionToCutEntry` functions (edge.ts, pocket.ts) called `retractToSafe` before `pushRampOrPlunge`. This emitted an unnecessary `G0 Z<safeZ>` between layers, even with ramp entry enabled. The tool retracted to safeZ, positioned XY, then plunged vertically back to the previous depth before ramping.

**Fix** (edge.ts:149, pocket.ts:262): When `rampEntry` is true and `from` exists, call `pushRampOrPlunge` directly with the current position instead of retracting first. The ramp starts from the previous cut depth — no wasteful Z5 retract.

### 4a.3 Obstacle clipper dropping nudge rapid

**Problem**: `clipToolpathResultToObstaclesByLevel` (regions.ts) filtered moves to only `kind: 'cut'`, discarding the initial ramp rapid that positions XY at the spiral/zigzag start. The subsequent `pushSafeTransition` with `current=null` emitted nothing when the cut's `from.z === safeZ`, so the nudge rapid was lost with no replacement — the first cut ran from an arbitrary XY.

**Fix** (`regions.ts:265-270`): When `current` is null, always emit a zero-length positioning `rapid` before the first cut so the post-processor generates `G0 Z + G0 XY` before the first G1 cut move.

### 4a.4 Z axis / origin mapping

**Problem**: Project `origin.z=0` told the code machine zero was at the bed, but G54 Z0 was actually at the stock surface (set by G38.2 probing). All safe-Z / retract / cut Z values were off by stock.thickness (12.5mm).

**Fix** (`455_drawer_bottom_2.camj`): Set `origin.z=12.5` (stock thickness) and `zAxis="Z"` (not `"-Z"`). `getOperationSafeZ` and `retractZ` are designed for `origin.z = stock.thickness` and produce correct machine-Z values: positive above stock, negative into stock.

---

## 5. Files Changed

```
src/types/project.ts                                Operation + Tab type changes
src/engine/toolpaths/geometry.ts                    pushRampOrPlunge, retractToSafe
src/engine/toolpaths/drilling.ts                    emitHelicalDrill
src/engine/toolpaths/edge.ts                        ramp entry wiring (signatures + call sites); segments-accumulating zigzag along contour
src/engine/toolpaths/pocket.ts                      ramp entry wiring (signatures + call sites)
src/engine/toolpaths/tabs.ts                        gaussian Z + diagonal moves
src/engine/gcode/postprocessor.ts                   state.currentPosition reset after tool change; feed-limited diagonal moves
src/engine/toolpaths/regions.ts                     clipToolpathResultToObstaclesByLevel preserves non-cut moves; pushSafeTransition emits positioning rapid when current=null
src/components/cam/CAMPanel.tsx                     ramp + helix UI
src/components/feature-tree/PropertiesPanel.tsx     shape dropdown
src/store/helpers/normalize.ts                      tab shape default
src/store/slices/tabsSlice.ts                       tab shape + naming
src/store/slices/pendingAddSlice.ts                 tab shape
build-dist.sh                                       convenience script: icon sprite → tsc → vite build
455_drawer_bottom_2.camj                            origin.z=12.5, zAxis="Z"
```

## 6. Suggested Issue Breakdown

### Option A: Single PR

One issue / one PR covering all three features.

**Issue title:** `feat: smooth tabs (gaussian Z), helical drilling, and ramp entry`

**Branch:** `feat/issue-XXX-smooth-tabs-helical-ramp`

**Body:** As above.

### Option B: Two PRs

1. **Issue:** `feat: smooth tab profile (gaussian Z)` — tab shape rename, circleProfile removal, gaussian Z algorithm, PropertiesPanel dropdown.
   **Branch:** `feat/issue-XXX-smooth-tab-profile`

2. **Issue:** `feat: helical drilling and ramp entry` — helical drill cycle, ramp entry strategies, CAMPanel UI.
   **Branch:** `feat/issue-YYY-helical-ramp`

Option A is simpler since all three landed in one pass and share no conflicts with other in-flight work.

## 7. Labels

`area:cam`, `area:tabs`, `area:operations`, `enhancement`

## 8. Testing

- `npm run build` — tsc + 80 test files + Vite bundle (passes; pre-existing lint errors unrelated)
- `npm test` — structural tests (80/80 pass)
- `npx vite build` — production bundle (passes with Node ≥20)
- Post-processor fix verified: first move after tool change emits `G0 Z<safeZ>` then `G0 X Y` before any `G1` cut
