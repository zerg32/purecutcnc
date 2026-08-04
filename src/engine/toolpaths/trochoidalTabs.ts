/**
 * Copyright 2026 Franja (Frank) Povazanj
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import ClipperLib from 'clipper-lib'
import type { Point, Project, Tab } from '../../types/project'
import { DEFAULT_CLIPPER_SCALE, toClipperPath } from './geometry'
import type { ClipperPath } from './types'

const GEOMETRY_EPSILON = 1e-9

const pointInPolygon = (ClipperLib.Clipper as unknown as {
  PointInPolygon(point: { X: number; Y: number }, path: ClipperPath): number
}).PointInPolygon

export interface TrochoidalTabPaths {
  guideForbidden: ClipperPath[]
  cutterForbidden: ClipperPath[]
  invalidTabs: Array<{ tab: Tab; guideForbidden: ClipperPath[] }>
}

export interface SplitTrochoidalGuide {
  fragments: Point[][]
  clipped: boolean
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= GEOMETRY_EPSILON
    && Math.abs(a.y - b.y) <= GEOMETRY_EPSILON
}

function expandedTabPaths(tabs: Tab[], expansion: number): ClipperPath[] {
  const paths = tabs
    .map((tab) => toClipperPath([
      { x: tab.x, y: tab.y },
      { x: tab.x + tab.w, y: tab.y },
      { x: tab.x + tab.w, y: tab.y + tab.h },
      { x: tab.x, y: tab.y + tab.h },
    ], DEFAULT_CLIPPER_SCALE))
  if (paths.length === 0) return []

  const offset = new ClipperLib.ClipperOffset()
  offset.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const solution = new ClipperLib.Paths()
  offset.Execute(solution, expansion * DEFAULT_CLIPPER_SCALE)
  return solution as ClipperPath[]
}

export function buildTrochoidalTabPaths(
  project: Project,
  z: number,
  guideExpansion: number,
  cutterExpansion: number,
): TrochoidalTabPaths {
  const activeTabs = project.tabs.filter((tab) => (
    z < Math.max(tab.z_top, tab.z_bottom) - GEOMETRY_EPSILON
  ))
  return {
    guideForbidden: expandedTabPaths(activeTabs, guideExpansion),
    cutterForbidden: expandedTabPaths(activeTabs, cutterExpansion),
    invalidTabs: activeTabs
      .filter((tab) => !(tab.z_top > tab.z_bottom))
      .map((tab) => ({ tab, guideForbidden: expandedTabPaths([tab], guideExpansion) })),
  }
}

export function relevantTrochoidalTabTopLevels(
  project: Project,
  contour: Point[],
  topZ: number,
  bottomZ: number,
  guideExpansion: number,
): number[] {
  const descending = bottomZ < topZ
  const minZ = Math.min(topZ, bottomZ)
  const maxZ = Math.max(topZ, bottomZ)
  const levels = project.tabs
    .filter((tab) => tab.z_top > tab.z_bottom)
    .filter((tab) => tab.z_top > minZ + GEOMETRY_EPSILON && tab.z_top < maxZ - GEOMETRY_EPSILON)
    .filter((tab) => splitClosedTrochoidalGuide(
      contour,
      expandedTabPaths([tab], guideExpansion),
    ).clipped)
    .map((tab) => tab.z_top)
  return [...new Set(levels)].sort((left, right) => descending ? right - left : left - right)
}

function segmentIntersectionT(from: Point, to: Point, a: Point, b: Point): number | null {
  const rx = to.x - from.x
  const ry = to.y - from.y
  const sx = b.x - a.x
  const sy = b.y - a.y
  const denominator = rx * sy - ry * sx
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return null

  const qx = a.x - from.x
  const qy = a.y - from.y
  const t = (qx * sy - qy * sx) / denominator
  const u = (qx * ry - qy * rx) / denominator
  if (t < -GEOMETRY_EPSILON || t > 1 + GEOMETRY_EPSILON
    || u < -GEOMETRY_EPSILON || u > 1 + GEOMETRY_EPSILON) return null
  return Math.max(0, Math.min(1, t))
}

function pointAt(from: Point, to: Point, t: number): Point {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  }
}

function pointOutsidePaths(point: Point, paths: ClipperPath[]): boolean {
  const scaled = {
    X: Math.round(point.x * DEFAULT_CLIPPER_SCALE),
    Y: Math.round(point.y * DEFAULT_CLIPPER_SCALE),
  }
  return paths.every((path) => pointInPolygon(scaled, path) === 0)
}

export function splitClosedTrochoidalGuide(
  contour: Point[],
  forbiddenPaths: ClipperPath[],
): SplitTrochoidalGuide {
  if (forbiddenPaths.length === 0) return { fragments: [contour], clipped: false }

  const points = contour.length > 1 && samePoint(contour[0], contour[contour.length - 1])
    ? contour.slice(0, -1)
    : contour
  if (points.length < 3) return { fragments: [], clipped: true }

  const fragments: Point[][] = []
  let current: Point[] = []
  let clipped = false
  const flush = () => {
    if (current.length >= 2) fragments.push(current)
    current = []
  }

  for (let index = 0; index < points.length; index += 1) {
    const from = points[index]
    const to = points[(index + 1) % points.length]
    const breakpoints = new Set<number>([0, 1])
    for (const path of forbiddenPaths) {
      for (let edgeIndex = 0; edgeIndex < path.length; edgeIndex += 1) {
        const a = { x: path[edgeIndex].X / DEFAULT_CLIPPER_SCALE, y: path[edgeIndex].Y / DEFAULT_CLIPPER_SCALE }
        const bPoint = path[(edgeIndex + 1) % path.length]
        const b = { x: bPoint.X / DEFAULT_CLIPPER_SCALE, y: bPoint.Y / DEFAULT_CLIPPER_SCALE }
        const t = segmentIntersectionT(from, to, a, b)
        if (t !== null) breakpoints.add(Number(t.toFixed(12)))
      }
    }

    const sorted = [...breakpoints].sort((left, right) => left - right)
    for (let intervalIndex = 0; intervalIndex < sorted.length - 1; intervalIndex += 1) {
      const start = sorted[intervalIndex]
      const end = sorted[intervalIndex + 1]
      if (end - start <= GEOMETRY_EPSILON) continue
      const startPoint = pointAt(from, to, start)
      const endPoint = pointAt(from, to, end)
      if (!pointOutsidePaths(pointAt(from, to, (start + end) / 2), forbiddenPaths)) {
        clipped = true
        flush()
        continue
      }
      if (current.length === 0 || !samePoint(current[current.length - 1], startPoint)) {
        flush()
        current = [startPoint]
      }
      current.push(endPoint)
    }
  }
  flush()

  if (!clipped) return { fragments: [contour], clipped: false }
  if (fragments.length > 1 && samePoint(fragments[fragments.length - 1].at(-1)!, fragments[0][0])) {
    fragments[0] = [...fragments[fragments.length - 1], ...fragments[0].slice(1)]
    fragments.pop()
  }
  return { fragments, clipped: true }
}
