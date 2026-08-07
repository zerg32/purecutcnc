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

import type { Point } from '../../types/project'
import { buildTrochoidalContour } from './trochoidalEdge'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function approx(left: number, right: number, epsilon = 1e-9): boolean {
  return Math.abs(left - right) <= epsilon
}

const rectangle: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

function testClosedPeriodicPath(): void {
  const result = buildTrochoidalContour(rectangle, {
    orbitRadius: 2,
    advance: 1,
    toolDiameter: 4,
    angularDirection: 1,
  })
  assert(result.error === undefined, `unexpected error ${result.error}`)
  assert(result.loopCount === 40, `expected 40 loops, got ${result.loopCount}`)
  assert(approx(result.actualAdvance, 1), `expected 1 mm actual advance, got ${result.actualAdvance}`)
  assert(result.entryCenter !== null, 'expected entry center')
  assert(result.points.length > result.loopCount * 36, 'expected entry orbit plus moving loops')
  assert(result.guideDistances.length === result.points.length, 'guide distances must align with points')
  assert(approx(result.guideLength, 40), `expected 40 mm guide length, got ${result.guideLength}`)
  assert(result.guideDistances.every((distance, index) => index === 0 || distance >= result.guideDistances[index - 1]), 'guide distances must be monotonic')

  const first = result.points[0]
  const last = result.points.at(-1)!
  assert(first.x === last.x && first.y === last.y, 'closed path must meet exactly at its seam')
  assert(approx(result.guideDistances.at(-1)!, result.guideLength), 'closed seam must use the full guide length')
  assert(result.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), 'all points must be finite')
}

function testOrbitRadiusAndDirection(): void {
  for (const angularDirection of [1, -1] as const) {
    const result = buildTrochoidalContour(rectangle, {
      orbitRadius: 2,
      advance: 2,
      toolDiameter: 4,
      angularDirection,
    })
    assert(result.entryCenter !== null, 'expected entry center')
    const first = result.points[0]
    const second = result.points[1]
    const firstRadius = { x: first.x - result.entryCenter.x, y: first.y - result.entryCenter.y }
    const secondRadius = { x: second.x - result.entryCenter.x, y: second.y - result.entryCenter.y }
    assert(approx(Math.hypot(firstRadius.x, firstRadius.y), 2), 'first point must use requested orbit radius')
    assert(approx(Math.hypot(secondRadius.x, secondRadius.y), 2), 'entry orbit must preserve requested radius')
    const cross = firstRadius.x * secondRadius.y - firstRadius.y * secondRadius.x
    assert(Math.sign(cross) === angularDirection, `expected angular direction ${angularDirection}, got cross ${cross}`)
  }
}

function testDeterminismAndSeam(): void {
  const options = { orbitRadius: 1.5, advance: 0.75, toolDiameter: 3, angularDirection: 1 as const }
  const first = buildTrochoidalContour(rectangle, options)
  const second = buildTrochoidalContour(rectangle, options)
  assert(JSON.stringify(first) === JSON.stringify(second), 'same guide and settings must produce identical output')

  const circle = Array.from({ length: 96 }, (_, index) => {
    const angle = 2 * Math.PI * index / 96
    return { x: 15 * Math.cos(angle), y: 15 * Math.sin(angle) }
  })
  const circular = buildTrochoidalContour(circle, { ...options, angularDirection: -1, advance: 0.7 })
  assert(circular.error === undefined, `unexpected circular-guide error ${circular.error}`)
  assert(approx(circular.points[0].x, circular.points.at(-1)!.x) && approx(circular.points[0].y, circular.points.at(-1)!.y), 'circular guide must close exactly')
  assert(circular.actualAdvance <= 0.7 + 1e-9, 'integer loop adjustment must not exceed requested advance')
}

function testInvalidInputsAndBudget(): void {
  const invalid = buildTrochoidalContour([{ x: 0, y: 0 }, { x: 1, y: 0 }], {
    orbitRadius: 1,
    advance: 1,
    toolDiameter: 2,
    angularDirection: 1,
  })
  assert(invalid.error === 'invalid-guide', `expected invalid-guide, got ${invalid.error}`)
  assert(invalid.guideDistances.length === 0, 'invalid guide must have no guide distances')
  assert(invalid.guideLength === 0, 'invalid guide must have zero guide length')

  const nonFinite = buildTrochoidalContour([...rectangle.slice(0, 3), { x: Infinity, y: 10 }], {
    orbitRadius: 1,
    advance: 1,
    toolDiameter: 2,
    angularDirection: 1,
  })
  assert(nonFinite.error === 'invalid-guide', `expected non-finite invalid-guide, got ${nonFinite.error}`)
  assert(nonFinite.guideDistances.length === 0, 'non-finite guide must have no guide distances')
  assert(Number.isFinite(nonFinite.guideLength) && nonFinite.guideLength === 0, 'non-finite guide must report finite zero length')

  const duplicateVertex = buildTrochoidalContour([...rectangle, rectangle[0]], {
    orbitRadius: 1,
    advance: 1,
    toolDiameter: 2,
    angularDirection: 1,
  })
  assert(duplicateVertex.error === undefined, 'repeated closing vertex must normalize')

  const budget = buildTrochoidalContour(rectangle, {
    orbitRadius: 2,
    advance: 0.0001,
    toolDiameter: 4,
    angularDirection: 1,
  })
  assert(budget.error === 'move-budget', `expected move-budget, got ${budget.error}`)
  assert(budget.points.length === 0, 'budget failure must not emit partial output')
  assert(budget.guideDistances.length === 0, 'budget failure must not emit partial guide distances')
  assert(approx(budget.guideLength, 40), 'budget failure may retain the valid guide length')
}

function testOpenGuideCompletesExitOrbit(): void {
  const result = buildTrochoidalContour([{ x: 0, y: 0 }, { x: 20, y: 0 }], {
    orbitRadius: 1,
    advance: 2,
    toolDiameter: 4,
    angularDirection: 1,
    closed: false,
  })
  assert(result.error === undefined, `unexpected open-guide error ${result.error}`)
  assert(approx(result.entryCenter?.x ?? -1, 0), 'open guide entry must stay at its first endpoint')
  assert(approx(result.points[0].x, 1), 'open guide must start on the entry orbit')
  assert(approx(result.points.at(-1)!.x, 21), 'open guide must finish on the exit orbit')
  assert(!approx(result.points[0].x, result.points.at(-1)!.x), 'open guide must not close across its gap')
  assert(result.guideDistances.length === result.points.length, 'open guide distances must align with points')
  assert(approx(result.guideLength, 20), `expected 20 mm guide length, got ${result.guideLength}`)

  const firstMovingIndex = result.guideDistances.findIndex((distance) => distance > 0)
  assert(firstMovingIndex > 0, 'moving samples must follow the stationary entry orbit')
  assert(result.guideDistances.slice(0, firstMovingIndex).every((distance) => distance === 0), 'entry orbit must remain at guide distance zero')
  assert(result.guideDistances.slice(firstMovingIndex).every((distance, index, distances) => index === 0 || distance >= distances[index - 1]), 'moving and exit distances must be monotonic')

  const firstExitIndex = result.guideDistances.findIndex((distance) => approx(distance, result.guideLength))
  assert(firstExitIndex >= firstMovingIndex, 'moving orbit must reach the guide length')
  assert(result.guideDistances.slice(firstExitIndex).every((distance) => approx(distance, result.guideLength)), 'exit orbit must remain at the guide length')
}

function testGuideBreakpoints(): void {
  const guide = [{ x: 0, y: 0 }, { x: 20, y: 0 }]
  const options = {
    orbitRadius: 1,
    advance: 2,
    toolDiameter: 4,
    angularDirection: -1 as const,
    closed: false,
  }
  const baseline = buildTrochoidalContour(guide, options)
  const breakpoint = 3.25
  const enriched = buildTrochoidalContour(guide, { ...options, guideBreakpoints: [breakpoint] })
  assert(enriched.error === undefined, `unexpected breakpoint error ${enriched.error}`)
  assert(enriched.loopCount === baseline.loopCount, 'breakpoints must not change loop count')
  assert(enriched.guideDistances.filter((distance) => distance === breakpoint).length === 1, 'breakpoint must be sampled exactly once')

  let enrichedIndex = 0
  for (let baselineIndex = 0; baselineIndex < baseline.points.length; baselineIndex += 1) {
    while (
      enrichedIndex < enriched.points.length
      && (
        enriched.guideDistances[enrichedIndex] !== baseline.guideDistances[baselineIndex]
        || enriched.points[enrichedIndex].x !== baseline.points[baselineIndex].x
        || enriched.points[enrichedIndex].y !== baseline.points[baselineIndex].y
      )
    ) enrichedIndex += 1
    assert(enrichedIndex < enriched.points.length, `baseline point ${baselineIndex} must remain unchanged`)
    enrichedIndex += 1
  }

  const breakpointIndex = enriched.guideDistances.indexOf(breakpoint)
  const phase = options.angularDirection * 2 * Math.PI * breakpoint / enriched.actualAdvance
  assert(approx(enriched.points[breakpointIndex].x, breakpoint + Math.cos(phase)), 'breakpoint X must use distance-derived orbit phase')
  assert(approx(enriched.points[breakpointIndex].y, Math.sin(phase)), 'breakpoint Y must preserve orbit direction and pitch')

  const noisy = buildTrochoidalContour(guide, {
    ...options,
    guideBreakpoints: [breakpoint, breakpoint, Number.NaN, Infinity, -1, 0, 20, 21],
  })
  assert(JSON.stringify(noisy) === JSON.stringify(enriched), 'invalid, duplicate, and endpoint breakpoints must be ignored')

  const budgetBaseline = buildTrochoidalContour(guide, { ...options, maxPoints: baseline.points.length })
  assert(budgetBaseline.error === undefined, 'baseline must fit its exact point budget')
  const budgetBreakpoint = buildTrochoidalContour(guide, {
    ...options,
    guideBreakpoints: [breakpoint],
    maxPoints: baseline.points.length,
  })
  assert(budgetBreakpoint.error === 'move-budget', 'inserted breakpoint must count against the point budget')
  assert(budgetBreakpoint.points.length === 0 && budgetBreakpoint.guideDistances.length === 0, 'breakpoint budget failure must be atomic')
}

testClosedPeriodicPath()
testOrbitRadiusAndDirection()
testDeterminismAndSeam()
testInvalidInputsAndBudget()
testOpenGuideCompletesExitOrbit()
testGuideBreakpoints()

console.log('trochoidal edge tests passed.')
