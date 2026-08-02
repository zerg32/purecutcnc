/**
 * Deep diagnostic: round-tab obstacle polygon shape and segment intersection
 *
 * Run: npx tsx scripts/diag-round-tabs-2.ts
 */
import ClipperLib from 'clipper-lib'
import { newProject, defaultTool, rectProfile, circleProfile, sampleProfilePoints } from '../src/types/project'
import type { Point, Tab, Tool, Project } from '../src/types/project'
import {
  DEFAULT_CLIPPER_SCALE, fromClipperPath, normalizeWinding, toClipperPath,
} from '../src/engine/toolpaths/geometry'

function offsetObstaclePoints(points: Point[], delta: number): Point[] {
  if (!(delta > 1e-9) || points.length < 3) return points
  const offset = new ClipperLib.ClipperOffset()
  offset.AddPaths(
    [toClipperPath(normalizeWinding(points, false), DEFAULT_CLIPPER_SCALE)],
    ClipperLib.JoinType.jtMiter,
    ClipperLib.EndType.etClosedPolygon,
  )
  const solution = new ClipperLib.Paths()
  offset.Execute(solution, delta * DEFAULT_CLIPPER_SCALE)
  const expanded = (solution as unknown as {X:number;Y:number}[][])[0]
  return expanded ? fromClipperPath(expanded, DEFAULT_CLIPPER_SCALE) : points
}

function sampleRoundTab(tab: Tab): Point[] {
  const cx = tab.x + tab.w / 2
  const cy = tab.y + tab.h / 2
  const r = Math.min(tab.w, tab.h) / 2
  return sampleProfilePoints(circleProfile(cx, cy, r))
}

function sampleRectTab(tab: Tab): Point[] {
  return sampleProfilePoints(rectProfile(tab.x, tab.y, tab.w, tab.h))
}

function pointInPolygon(x: number, y: number, polygon: Point[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function segmentIntersectionT(
  x0: number, y0: number, x1: number, y1: number,
  a0: Point, a1: Point,
): number | null {
  const rX = x1 - x0, rY = y1 - y0
  const sX = a1.x - a0.x, sY = a1.y - a0.y
  const denominator = rX * sY - rY * sX
  if (Math.abs(denominator) < 1e-9) return null
  const qpx = a0.x - x0, qpy = a0.y - y0
  const t = (qpx * sY - qpy * sX) / denominator
  const u = (qpx * rY - qpy * rX) / denominator
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null
  return Math.max(0, Math.min(1, t))
}

function clipSegmentPolygon2D(
  x0: number, y0: number, x1: number, y1: number,
  polygon: Point[],
): [number, number] | null {
  if (polygon.length < 3) return null
  const ts = new Set<number>([0, 1])
  for (let index = 0; index < polygon.length; index += 1) {
    const a0 = polygon[index]
    const a1 = polygon[(index + 1) % polygon.length]
    const t = segmentIntersectionT(x0, y0, x1, y1, a0, a1)
    if (t !== null) ts.add(Number(t.toFixed(9)))
  }
  const values = Array.from(ts).sort((a, b) => a - b)
  let minInside: number | null = null
  let maxInside: number | null = null
  for (let i = 0; i < values.length - 1; i++) {
    const start = values[i], end = values[i + 1]
    if (end - start <= 1e-9) continue
    const mid = (start + end) / 2
    const midX = x0 + (x1 - x0) * mid, midY = y0 + (y1 - y0) * mid
    if (!pointInPolygon(midX, midY, polygon)) continue
    minInside = minInside === null ? start : Math.min(minInside, start)
    maxInside = maxInside === null ? end : Math.max(maxInside, end)
  }
  return minInside !== null && maxInside !== null ? [minInside, maxInside] : null
}

function isConvex(polygon: Point[]): boolean {
  if (polygon.length < 3) return false
  let sign: number | null = null
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const c = polygon[(i + 2) % polygon.length]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-9) continue
    const crossSign = Math.sign(cross)
    if (sign === null) sign = crossSign
    else if (crossSign !== sign) return false
  }
  return true
}

function checkSelfIntersection(polygon: Point[]): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const a0 = polygon[i], a1 = polygon[(i + 1) % polygon.length]
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue
      const b0 = polygon[j], b1 = polygon[(j + 1) % polygon.length]
      const t = segmentIntersectionT(a0.x, a0.y, a1.x, a1.y, b0, b1)
      if (t !== null && t > 1e-9 && t < 1 - 1e-9) return true
    }
  }
  return false
}

function testTab(name: string, tab: Tab, toolRadius: number): void {
  console.log(`\n=== ${name} ===`)
  console.log(`  Tab: x=${tab.x}, y=${tab.y}, w=${tab.w}, h=${tab.h}, shape=${tab.shape}`)
  console.log(`  Tool radius: ${toolRadius}`)

  const raw = tab.shape === 'round' ? sampleRoundTab(tab) : sampleRectTab(tab)
  console.log(`  Raw points: ${raw.length}`)
  console.log(`  first: (${raw[0].x.toFixed(4)}, ${raw[0].y.toFixed(4)})`)
  console.log(`  last:  (${raw[raw.length - 1].x.toFixed(4)}, ${raw[raw.length - 1].y.toFixed(4)})`)

  // Check winding after ensureClosedPath + normalizeWinding
  const nw = normalizeWinding(raw, false)
  console.log(`  After normalizeWinding: ${nw.length} points`)
  console.log(`  nw first: (${nw[0].x.toFixed(4)}, ${nw[0].y.toFixed(4)})`)
  console.log(`  nw last:  (${nw[nw.length - 1].x.toFixed(4)}, ${nw[nw.length - 1].y.toFixed(4)})`)

  const expanded = offsetObstaclePoints(raw, toolRadius)
  console.log(`  Expanded points: ${expanded.length}`)
  console.log(`  Expanded convex: ${isConvex(expanded)}`)
  console.log(`  Expanded self-intersecting: ${checkSelfIntersection(expanded)}`)

  // Test intersection at multiple angles
  const cx = tab.x + tab.w / 2
  const cy = tab.y + tab.h / 2
  const testRadius = Math.max(tab.w, tab.h) * 2

  for (const angleDeg of [0, 30, 45, 60, 80, 90]) {
    const angleRad = (angleDeg * Math.PI) / 180
    // Cut path through center of tab at this angle
    const x0 = cx - Math.cos(angleRad) * testRadius
    const y0 = cy - Math.sin(angleRad) * testRadius
    const x1 = cx + Math.cos(angleRad) * testRadius
    const y1 = cy + Math.sin(angleRad) * testRadius

    const result = clipSegmentPolygon2D(x0, y0, x1, y1, expanded)
    if (result) {
      const [tEntry, tExit] = result
      const segLen = Math.hypot(x1 - x0, y1 - y0)
      const entryX = x0 + tEntry * (x1 - x0), entryY = y0 + tEntry * (y1 - y0)
      const exitX = x0 + tExit * (x1 - x0), exitY = y0 + tExit * (y1 - y0)
      const insideLen = Math.hypot(exitX - entryX, exitY - entryY)
      console.log(`  Angle ${angleDeg}°: t=[${tEntry.toFixed(4)}, ${tExit.toFixed(4)}], inside_len=${insideLen.toFixed(4)}`)
    } else {
      console.log(`  Angle ${angleDeg}°: NO INTERSECTION`)
    }
  }
}

// ── Test cases ──
const toolRadius = 3

// 1. Round tab, moderate size
testTab('Round tab 16x16', { id: 't1', name: 'T1', x: 35, y: 8, w: 16, h: 16, z_top: 16, z_bottom: 10, shape: 'round', visible: true }, toolRadius)

// 2. Round tab, small 
testTab('Round tab 8x8', { id: 't2', name: 'T2', x: 35, y: 8, w: 8, h: 8, z_top: 16, z_bottom: 10, shape: 'round', visible: true }, toolRadius)

// 3. Round tab, narrow
testTab('Round tab 20x6', { id: 't3', name: 'T3', x: 35, y: 8, w: 20, h: 6, z_top: 16, z_bottom: 10, shape: 'round', visible: true }, toolRadius)

// 4. Rect tab for comparison
testTab('Rect tab 16x16', { id: 't4', name: 'T4', x: 35, y: 8, w: 16, h: 16, z_top: 16, z_bottom: 10, shape: 'rect', visible: true }, toolRadius)

// 5. Round tab with large offset (big tool, small tab)
testTab('Round tab 10x10 + R6 tool', { id: 't5', name: 'T5', x: 35, y: 8, w: 10, h: 10, z_top: 16, z_bottom: 10, shape: 'round', visible: true }, 6)

console.log(`\nDone.`)
