/**
 * Diagnostic: full G-code comparison of round vs rect tabs
 * including diagonal cut paths.
 *
 * Run: npx tsx scripts/diag-round-tabs-3.ts
 */
import { newProject, defaultTool, rectProfile, circleProfile } from '../src/types/project'
import type { Point, Tab, Tool, Operation, SketchFeature } from '../src/types/project'
import { generateEdgeRouteToolpath } from '../src/engine/toolpaths/edge'
import { applyTabsToEdgeRoute } from '../src/engine/toolpaths/tabs'
import { generateFinishSurfaceToolpath } from '../src/engine/toolpaths/finishSurface'
import { runPostProcessor } from '../src/engine/gcode/postprocessor'
import { validateMachineDefinition } from '../src/engine/gcode/types'
import type { MachineDefinition } from '../src/engine/gcode/types'

function testMachineDefinition(): MachineDefinition {
  return validateMachineDefinition({
    id: 'test', name: 'Test', description: 'Test controller', builtin: false,
    fileExtension: 'nc',
    coordinateSystem: { xAxis: 'X', yAxis: 'Y', zAxis: 'Z' },
    numberFormat: { decimalPlaces: { mm: 3, inch: 4 }, trailingZeros: false, leadingZero: true },
    units: { mmCommand: 'G21', inchCommand: 'G20' },
    program: { header: ['; {programName}'], footer: [], commentPrefix: ';', commentSuffix: '', lineNumbers: false, lineNumberIncrement: 10 },
    workCoordinates: { selectCommand: null },
    motion: { rapidCommand: 'G0', linearCommand: 'G1', cwArcCommand: 'G2', ccwArcCommand: 'G3', arcFormat: 'ij', modalMotion: true },
    feedSpeed: { feedCommand: 'F', rpmCommand: 'S', spindleOnCW: 'M3', spindleOnCCW: 'M4', spindleOff: 'M5', inlineWithMotion: true, modalFeedSpeed: true },
    toolChange: { commands: ['M0 ; Tool change: {toolName}'], stopSpindleFirst: true, pauseAfterChange: false, pauseCommand: 'M0' },
    cannedCycles: null, coolant: null,
    stop: { programEndCommand: 'M30' },
  })
}

function makeTool(id = 't1', diam = 6): Tool {
  return { ...defaultTool('mm', 1), id, name: `${diam}mm endmill`, diameter: diam, defaultStepdown: 3, defaultStepover: 0.4 }
}

function makeBaseOp(toolRef: string, kind: 'edge_route_outside' | 'finish_surface'): Operation {
  return {
    id: 'op1', name: 'Op', kind, pass: 'rough', enabled: true, showToolpath: true, debugToolpath: false,
    target: { source: 'features', featureIds: ['f1'] }, toolRef,
    stepdown: 3, stepover: 0.4, feed: 800, plungeFeed: 300, rpm: 18000,
    pocketPattern: 'offset', pocketAngle: 0, stockToLeaveRadial: 0, stockToLeaveAxial: 0,
    finishWalls: true, finishFloor: true, carveDepth: 2, maxCarveDepth: 2, cutDirection: 'conventional', machiningOrder: 'level_first',
  }
}

function makeRectFeature(id: string, x: number, y: number, w: number, h: number, zTop: number, zBottom: number): SketchFeature {
  return { id, name: id, kind: 'rect', folderId: null, sketch: { profile: rectProfile(x, y, w, h), origin: { x: 0, y: 0 }, orientationAngle: 0, dimensions: [], constraints: [] }, operation: 'add', z_top: zTop, z_bottom: zBottom, visible: true, locked: false }
}

function analyzeLeads(moves: {kind: string; from: Point & {z: number}; to: Point & {z: number}}[]): void {
  let issues = 0
  for (const move of moves) {
    if (move.kind !== 'lead_in' && move.kind !== 'lead_out') continue
    const dxy = Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y)
    const dz = Math.abs(move.to.z - move.from.z)
    if (dxy > 0.001 && dz > 0.001) {
      console.log(`  ⚠ DIAGONAL lead: ${move.kind} (${move.from.x.toFixed(4)},${move.from.y.toFixed(4)},${move.from.z.toFixed(3)})→(${move.to.x.toFixed(4)},${move.to.y.toFixed(4)},${move.to.z.toFixed(3)}) dxy=${dxy.toFixed(4)} dz=${dz.toFixed(3)}`)
      issues++
    }
  }
  if (issues === 0) console.log('  ✓ All lead moves are pure vertical')
}

function runTest(name: string, tab: Tab): void {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`TEST: ${name} (shape=${tab.shape})`)
  console.log(`${'='.repeat(60)}`)
  console.log(`Tab: x=${tab.x} y=${tab.y} w=${tab.w} h=${tab.h} zTop=${tab.z_top} zBottom=${tab.z_bottom}`)

  // Edge route test
  const project1 = newProject('Test', 'mm')
  project1.stock.thickness = 18
  project1.meta.operationClearanceZ = 5
  project1.features = [makeRectFeature('f1', 20, 20, 60, 40, 18, 0)]
  const tool = makeTool()
  project1.tools = [tool]
  project1.tabs = [{ ...tab }]

  const raw1 = generateEdgeRouteToolpath(project1, makeBaseOp(tool.id, 'edge_route_outside'))
  const tab1 = applyTabsToEdgeRoute(project1, makeBaseOp(tool.id, 'edge_route_outside'), raw1)
  console.log(`  Edge route: ${tab1.moves.length} moves, ${tab1.moves.filter(m => m.kind === 'lead_in' || m.kind === 'lead_out').length} leads`)
  analyzeLeads(tab1.moves)
}

// Test 1: Round tab on top edge (horizontal cut) — this should work
runTest('Round tab on top edge', { id: 't1', name: 'R1', x: 35, y: 8, w: 16, h: 16, z_top: 16, z_bottom: 10, shape: 'round', visible: true })

// Test 2: Rect tab on top edge — reference
runTest('Rect tab on top edge', { id: 't2', name: 'Rect1', x: 35, y: 8, w: 16, h: 16, z_top: 16, z_bottom: 10, shape: 'rect', visible: true })

// Test 3: Round tab on corner (cut goes around corner, intersecting tab tangentially)
// Place tab overlapping the top-right corner of the rectangle path
runTest('Round tab on corner', { id: 't3', name: 'R2', x: 70, y: 8, w: 20, h: 20, z_top: 16, z_bottom: 10, shape: 'round', visible: true })

// Test 4: Round tab, small, tight to edge
runTest('Round tab small tight', { id: 't4', name: 'R3', x: 40, y: 14, w: 8, h: 8, z_top: 16, z_bottom: 10, shape: 'round', visible: true })

// Test 5: Tab that barely intersects the cut path
runTest('Round tab grazing', { id: 't5', name: 'R4', x: 43, y: 24, w: 6, h: 6, z_top: 16, z_bottom: 10, shape: 'round', visible: true })

// Test 6: Diagonal feature with round tab — cut at 45°
const project6 = newProject('DiagTest', 'mm')
project6.stock.thickness = 18
project6.meta.operationClearanceZ = 5
// A rotated feature would give diagonal edges — let's use a polygon
const diagProfile = {
  start: { x: 30, y: 20 },
  segments: [
    { type: 'line' as const, to: { x: 80, y: 20 } },
    { type: 'line' as const, to: { x: 80, y: 60 } },
    { type: 'line' as const, to: { x: 30, y: 60 } },
    { type: 'line' as const, to: { x: 30, y: 20 } },
  ],
  closed: true,
}
project6.features = [{ id: 'f1', name: 'Rect', kind: 'polygon', folderId: null, sketch: { profile: diagProfile, origin: { x: 0, y: 0 }, orientationAngle: 15, dimensions: [], constraints: [] }, operation: 'add', z_top: 18, z_bottom: 0, visible: true, locked: false }]
const tool6 = makeTool()
project6.tools = [tool6]
project6.tabs = [{ id: 't6', name: 'R-Diag', x: 50, y: 30, w: 16, h: 16, z_top: 16, z_bottom: 10, shape: 'round', visible: true }]
const raw6 = generateEdgeRouteToolpath(project6, makeBaseOp(tool6.id, 'edge_route_outside'))
const tab6 = applyTabsToEdgeRoute(project6, makeBaseOp(tool6.id, 'edge_route_outside'), raw6)
console.log(`\n${'='.repeat(60)}`)
console.log(`TEST: Round tab on rotated feature`)
console.log(`${'='.repeat(60)}`)
console.log(`  Edge route: ${tab6.moves.length} moves, ${tab6.moves.filter(m => m.kind === 'lead_in' || m.kind === 'lead_out').length} leads`)
analyzeLeads(tab6.moves)

// Show any cutting move near the tab to understand the geometry
for (const move of tab6.moves) {
  const nearTab = (move.from.x >= 40 && move.from.x <= 70 && move.from.y >= 20 && move.from.y <= 50)
    || (move.to.x >= 40 && move.to.x <= 70 && move.to.y >= 20 && move.to.y <= 50)
  if (nearTab || move.kind === 'lead_in' || move.kind === 'lead_out') {
    console.log(`  ${move.kind.padEnd(10)} (${move.from.x.toFixed(2)},${move.from.y.toFixed(2)},${move.from.z.toFixed(1)})→(${move.to.x.toFixed(2)},${move.to.y.toFixed(2)},${move.to.z.toFixed(1)})`)
  }
}

console.log(`\nDone.`)
