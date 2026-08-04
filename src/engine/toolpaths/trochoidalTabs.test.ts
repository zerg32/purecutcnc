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

import { DEFAULT_CLIPPER_SCALE, toClipperPath } from './geometry'
import { splitClosedTrochoidalGuide } from './trochoidalTabs'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const square = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
]

function testLocalTabCreatesOneOpenFragment(): void {
  const forbidden = toClipperPath([
    { x: 8, y: -2 },
    { x: 12, y: -2 },
    { x: 12, y: 2 },
    { x: 8, y: 2 },
  ], DEFAULT_CLIPPER_SCALE)
  const result = splitClosedTrochoidalGuide(square, [forbidden])
  assert(result.clipped, 'intersecting tab must clip the guide')
  assert(result.fragments.length === 1, `expected one wrapped open fragment, got ${result.fragments.length}`)
  const fragment = result.fragments[0]
  assert(Math.abs(fragment[0].x - 12) < 1e-9, 'fragment must begin after the tab')
  assert(Math.abs(fragment.at(-1)!.x - 8) < 1e-9, 'fragment must end before the tab')
  assert(fragment.every((point) => point.y !== 0 || point.x <= 8 || point.x >= 12), 'fragment must not enter the tab')
}

function testUnrelatedTabKeepsClosedGuide(): void {
  const forbidden = toClipperPath([
    { x: 30, y: 30 },
    { x: 35, y: 30 },
    { x: 35, y: 35 },
    { x: 30, y: 35 },
  ], DEFAULT_CLIPPER_SCALE)
  const result = splitClosedTrochoidalGuide(square, [forbidden])
  assert(!result.clipped, 'unrelated tab must not clip the guide')
  assert(result.fragments.length === 1 && result.fragments[0] === square, 'unrelated tab must preserve the original guide')
}

testLocalTabCreatesOneOpenFragment()
testUnrelatedTabKeepsClosedGuide()
console.log('trochoidal tab tests passed.')
