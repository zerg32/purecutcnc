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

import { newProject, type Project, type Tab } from '../types/project'
import { useProjectStore } from './projectStore'
import { emptySelection, sanitizeSelection } from './slices/selectionSlice'
import type { SelectionState } from './types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function tab(id: string, visible = true): Tab {
  return {
    id,
    name: id,
    x: 0,
    y: 0,
    w: 10,
    h: 5,
    z_top: 3,
    z_bottom: 0,
    visible,
  }
}

function projectWithTabs(tabs: Tab[]): Project {
  return { ...newProject(), tabs }
}

function resetStore(tabs: Tab[]): void {
  useProjectStore.setState({
    project: projectWithTabs(tabs),
    selection: emptySelection(),
    sketchEditSession: null,
    pendingMove: null,
    pendingTransform: null,
    pendingOffset: null,
    pendingShapeAction: null,
    history: { past: [], future: [], transactionStart: null },
  })
}

let passed = 0
let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed += 1
    console.log(`   PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`   FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

test('selectTab toggles additive selection and keeps the last tab primary', () => {
  resetStore([tab('tab-1'), tab('tab-2')])
  const store = useProjectStore.getState()

  store.selectTab('tab-1')
  store.selectTab('tab-2', true)
  let selection = useProjectStore.getState().selection
  assert(selection.selectedTabIds.join(',') === 'tab-1,tab-2', 'both tabs should be selected')
  assert(selection.selectedNode?.type === 'tab' && selection.selectedNode.tabId === 'tab-2', 'last selected tab should be primary')

  store.selectTab('tab-2', true)
  selection = useProjectStore.getState().selection
  assert(selection.selectedTabIds.join(',') === 'tab-1', 'toggling the primary should remove it')
  assert(selection.selectedNode?.type === 'tab' && selection.selectedNode.tabId === 'tab-1', 'last remaining tab should become primary')

  store.selectTab('tab-1', true)
  selection = useProjectStore.getState().selection
  assert(selection.selectedTabIds.length === 0, 'toggling the final tab should empty tab selection')
  assert(selection.selectedNode === null, 'empty tab selection should have no primary node')
})

test('selectAllTabs selects visible tabs only and uses the last visible tab as primary', () => {
  resetStore([tab('tab-1'), tab('tab-hidden', false), tab('tab-2')])
  useProjectStore.getState().selectAllTabs()

  const selection = useProjectStore.getState().selection
  assert(selection.selectedTabIds.join(',') === 'tab-1,tab-2', 'hidden tabs should not be selected')
  assert(selection.selectedNode?.type === 'tab' && selection.selectedNode.tabId === 'tab-2', 'last visible tab should be primary')

  resetStore([tab('tab-hidden', false)])
  useProjectStore.getState().selectAllTabs()
  assert(useProjectStore.getState().selection.selectedNode?.type === 'tabs_root', 'empty visible selection should select the tabs root')
})

test('sanitizeSelection removes stale tab IDs and repairs the primary tab', () => {
  const project = projectWithTabs([tab('tab-1')])
  const selection = sanitizeSelection(project, {
    ...emptySelection(),
    selectedTabIds: ['tab-1', 'deleted-tab'],
    selectedNode: { type: 'tab', tabId: 'deleted-tab' },
  })

  assert(selection.selectedTabIds.join(',') === 'tab-1', 'stale tab IDs should be filtered')
  assert(selection.selectedNode?.type === 'tab' && selection.selectedNode.tabId === 'tab-1', 'remaining tab should become primary')

  const empty = sanitizeSelection(projectWithTabs([]), selection)
  assert(empty.selectedTabIds.length === 0 && empty.selectedNode === null, 'deleting the final selected tab should clear selection')
})

test('sanitizeSelection accepts a runtime selection without selectedTabIds', () => {
  const legacySelection = {
    ...emptySelection(),
    selectedTabIds: undefined,
  } as unknown as SelectionState

  const selection = sanitizeSelection(projectWithTabs([tab('tab-1')]), legacySelection)
  assert(selection.selectedTabIds.length === 0, 'missing runtime tab selection should normalize to empty')
})

test('non-tab selection clears selectedTabIds', () => {
  resetStore([tab('tab-1'), tab('tab-2')])
  const store = useProjectStore.getState()
  store.selectTab('tab-1')
  store.selectTab('tab-2', true)
  store.selectConstructionRoot()

  const selection = useProjectStore.getState().selection
  assert(selection.selectedTabIds.length === 0, 'construction-root selection should clear tabs')
  assert(selection.selectedNode?.type === 'construction_root', 'construction root should be primary')
})

test('selectFolderFeatures clears stale selectedTabIds', () => {
  resetStore([tab('tab-1')])
  const folderId = useProjectStore.getState().addFeatureFolder()
  useProjectStore.getState().addRectFeature('Rect', 0, 0, 10, 10, 1)
  const featureId = useProjectStore.getState().selection.selectedFeatureId
  assert(featureId !== null, 'created feature should be selected')
  useProjectStore.getState().assignFeaturesToFolder([featureId], folderId)
  useProjectStore.setState((state) => ({
    selection: {
      ...state.selection,
      selectedTabIds: ['tab-1'],
      selectedNode: { type: 'tab', tabId: 'tab-1' },
    },
  }))

  useProjectStore.getState().selectFolderFeatures(folderId)
  const selection = useProjectStore.getState().selection
  assert(selection.selectedTabIds.length === 0, 'folder feature selection should clear stale tabs')
  assert(selection.selectedFeatureIds.join(',') === featureId, 'folder features should be selected')
})

test('placing a new tab selects only the created tab', () => {
  resetStore([tab('tab-1')])
  const store = useProjectStore.getState()
  store.selectTab('tab-1')
  store.startAddTabPlacement()
  store.setPendingAddAnchor({ x: 0, y: 0 })
  store.placePendingAddAt({ x: 10, y: 5 })

  const state = useProjectStore.getState()
  const createdId = state.project.tabs.at(-1)?.id
  assert(createdId !== undefined && createdId !== 'tab-1', 'a new tab should be created')
  assert(state.selection.selectedTabIds.join(',') === createdId, 'only the new tab should remain selected')
  assert(state.selection.selectedNode?.type === 'tab' && state.selection.selectedNode.tabId === createdId, 'new tab should be primary')
})

test('enterTabEdit selects exactly the edited tab', () => {
  resetStore([tab('tab-1'), tab('tab-2')])
  const store = useProjectStore.getState()
  store.selectTab('tab-1')
  store.selectTab('tab-2', true)
  store.enterTabEdit('tab-1')

  const state = useProjectStore.getState()
  assert(state.selection.selectedTabIds.join(',') === 'tab-1', 'edit should retain only the edited tab')
  assert(state.selection.selectedNode?.type === 'tab' && state.selection.selectedNode.tabId === 'tab-1', 'edited tab should be primary')
  assert(state.selection.mode === 'sketch_edit', 'tab edit should enter sketch-edit mode')
})

test('startMoveTab carries the selected tab set into the pending move', () => {
  resetStore([tab('tab-1'), tab('tab-2')])
  const store = useProjectStore.getState()
  store.selectTab('tab-1')
  store.selectTab('tab-2', true)
  store.startMoveTab('tab-2')

  const state = useProjectStore.getState()
  assert(state.pendingMove?.entityIds.join(',') === 'tab-1,tab-2', 'pending move should include all selected tabs')
  assert(state.selection.selectedTabIds.join(',') === 'tab-1,tab-2', 'move start should preserve coherent tab selection')
})

test('completing a tab copy selects all created tabs with the last copy primary', () => {
  resetStore([tab('tab-1'), tab('tab-2')])
  const store = useProjectStore.getState()
  store.selectTab('tab-1')
  store.selectTab('tab-2', true)
  store.startCopyTab('tab-2')
  store.setPendingMoveFrom({ x: 0, y: 0 })
  store.completePendingMove({ x: 20, y: 0 })

  const state = useProjectStore.getState()
  assert(state.project.tabs.length === 4, 'copy should create one tab per selected source')
  assert(state.selection.selectedTabIds.length === 2, 'all created tabs should be selected')
  assert(state.selection.selectedTabIds.every((id) => id !== 'tab-1' && id !== 'tab-2'), 'source tabs should not remain selected')
  assert(
    state.selection.selectedNode?.type === 'tab' &&
      state.selection.selectedNode.tabId === state.selection.selectedTabIds.at(-1),
    'last created tab should be primary',
  )
})

test('bulk tab resize preserves centers and records one undo step', () => {
  resetStore([tab('tab-1'), { ...tab('tab-2'), x: 20, y: 10 }])
  useProjectStore.getState().updateTabs([
    { id: 'tab-1', patch: { x: 2.5, y: 0, w: 5, h: 5 } },
    { id: 'tab-2', patch: { x: 22.5, y: 10, w: 5, h: 5 } },
  ])

  const state = useProjectStore.getState()
  assert(state.project.tabs[0].x + state.project.tabs[0].w / 2 === 5, 'first center X should be preserved')
  assert(state.project.tabs[0].y + state.project.tabs[0].h / 2 === 2.5, 'first center Y should be preserved')
  assert(state.project.tabs[1].x + state.project.tabs[1].w / 2 === 25, 'second center X should be preserved')
  assert(state.project.tabs[1].y + state.project.tabs[1].h / 2 === 12.5, 'second center Y should be preserved')
  assert(state.history.past.length === 1, 'bulk update should create one undo entry')
})

test('bulk delete is atomic and keeps the remaining selected tab primary', () => {
  resetStore([tab('tab-1'), tab('tab-2'), tab('tab-3')])
  const store = useProjectStore.getState()
  store.selectAllTabs()
  store.deleteTabs(['tab-1', 'tab-3'])

  const state = useProjectStore.getState()
  assert(state.project.tabs.map((entry) => entry.id).join(',') === 'tab-2', 'only the undeleted tab should remain')
  assert(state.selection.selectedTabIds.join(',') === 'tab-2', 'remaining selected tab should stay selected')
  assert(state.selection.selectedNode?.type === 'tab' && state.selection.selectedNode.tabId === 'tab-2', 'remaining tab should be primary')
  assert(state.history.past.length === 1, 'bulk delete should create one undo entry')
})

console.log(`\ntabSelection: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
