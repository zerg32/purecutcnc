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

/**
 * Regression tests for obstacle/region clipping transitions (issue #467):
 * an operation whose cut path starts with no established machine position
 * must emit a zero-length positioning rapid before the first plunge, so the
 * plunge stays vertical instead of traveling diagonally from the previous
 * operation's end at plunge feed.
 *
 * Run with: npx tsx src/engine/toolpaths/regions.test.ts
 */

import { newProject } from '../../types/project'
import type { ToolpathMove, ToolpathResult } from './types'
import { clipToolpathResultToObstaclesByLevel } from './regions'
import { getOperationSafeZ } from './geometry'

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function pt(x: number, y: number, z: number) {
  return { x, y, z }
}

function result(overrides?: Partial<ToolpathResult>): ToolpathResult {
  return {
    operationId: 'op-1',
    moves: [],
    warnings: [],
    bounds: null,
    ...overrides,
  }
}

function testOperationStartEmitsPositioningRapid() {
  console.log('Testing operation-start transition emits positioning rapid...')

  const project = newProject('test', 'mm')
  const safeZ = getOperationSafeZ(project)
  const cut: ToolpathMove = { kind: 'cut', from: pt(10, 10, -2), to: pt(20, 10, -2) }

  const clipped = clipToolpathResultToObstaclesByLevel(
    project,
    result({ moves: [cut] }),
    () => null,
  )

  assert(clipped.moves.length === 4, `expected rapid + plunge + cut + retract, got ${clipped.moves.length} moves`)
  assert(clipped.moves[0].kind === 'rapid', 'first move is a rapid')
  assert(
    clipped.moves[0].from.x === 10 && clipped.moves[0].from.y === 10,
    'rapid positioned at cut start XY',
  )
  assert(clipped.moves[0].from.z === safeZ, `rapid at safe Z ${safeZ}`)
  assert(
    clipped.moves[0].to.x === clipped.moves[0].from.x
      && clipped.moves[0].to.y === clipped.moves[0].from.y
      && clipped.moves[0].to.z === clipped.moves[0].from.z,
    'rapid is zero-length (positioning marker)',
  )
  assert(clipped.moves[1].kind === 'plunge', 'second move is a plunge')
  assert(
    clipped.moves[1].from.z === safeZ && clipped.moves[1].to.z === -2,
    'plunge is vertical safe Z → cut depth',
  )
  assert(clipped.moves[2].kind === 'cut' && clipped.moves[2].to.x === 20, 'cut preserved')
  assert(clipped.moves[3].kind === 'rapid' && clipped.moves[3].to.z === safeZ, 'tail retract preserved')

  console.log('Operation-start transition emits positioning rapid: PASSED')
}

function testLaterTransitionsKeepRealRapids() {
  console.log('Testing mid-path transitions keep real (non-zero) rapids...')

  const project = newProject('test', 'mm')
  const safeZ = getOperationSafeZ(project)
  const moves: ToolpathMove[] = [
    { kind: 'cut', from: pt(10, 10, -2), to: pt(20, 10, -2) },
    { kind: 'cut', from: pt(40, 40, -3), to: pt(50, 40, -3) },
  ]

  const clipped = clipToolpathResultToObstaclesByLevel(
    project,
    result({ moves }),
    () => null,
  )

  assert(clipped.moves.length === 8, `expected 4 moves per transition + retract, got ${clipped.moves.length}`)
  assert(clipped.moves[0].kind === 'rapid', 'first move is positioning rapid')
  assert(clipped.moves[1].kind === 'plunge', 'first plunge intact')
  assert(clipped.moves[2].kind === 'cut', 'first cut intact')

  const lift = clipped.moves[3]
  assert(lift.kind === 'rapid', `move 4 is a rapid, got ${lift.kind}`)
  assert(lift.from.x === 20 && lift.from.y === 10 && lift.to.z === safeZ, 'lift rapid retracts to safe Z')
  const link = clipped.moves[4]
  assert(link.kind === 'rapid', `move 5 is a rapid, got ${link.kind}`)
  assert(
    link.from.z === safeZ && link.to.z === safeZ,
    'link rapid at safe Z',
  )
  assert(
    Math.abs(link.from.x - link.to.x) > 1e-9 || Math.abs(link.from.y - link.to.y) > 1e-9,
    'link rapid is non-zero (travels between positions)',
  )
  assert(link.to.x === 40 && link.to.y === 40, 'link rapid lands on second cut start XY')
  assert(clipped.moves[5].kind === 'plunge', 'second plunge intact')
  assert(clipped.moves[6].kind === 'cut' && clipped.moves[6].to.x === 50, 'second cut preserved')
  assert(clipped.moves[7].kind === 'rapid' && clipped.moves[7].to.z === safeZ, 'tail retract intact')

  console.log('Mid-path transitions keep real rapids: PASSED')
}

try {
  testOperationStartEmitsPositioningRapid()
  testLaterTransitionsKeepRealRapids()
  console.log('\nAll regions tests PASSED.')
} catch (e) {
  console.error(e)
  throw e
}
