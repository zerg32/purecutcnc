# Tab Multi-Select & Bulk Update Plan

## Goal

Add multi-select support for tabs (Ctrl/Cmd+click on canvas or tree) plus a "Select All Tabs" button on the Tabs root row. When multiple tabs are selected, the PropertiesPanel shows bulk-editable fields (Size, Z Top, Z Bottom, Shape) that update all selected tabs at once.

## Approach

Follow the existing feature multi-select pattern: add `selectedTabIds: string[]` to `SelectionState`, add `selectAllTabs()` and `updateTabs(ids, patch)` actions, update the UI for additive selection and bulk editing.

---

## Phase 1: Store types & state

### `src/store/types.ts`

1. Add `selectedTabIds: string[]` to `SelectionState` (after `selectedFeatureIds`)
2. Add `selectAllTabs: () => void` to `ProjectStore` interface (near `selectTabsRoot`)
3. Add `updateTabs: (ids: string[], patch: Partial<Tab>) => void` to `ProjectStore` interface (near `updateTab`)
4. Change `selectTab` signature to `(id: string, additive?: boolean) => void`

### `src/store/slices/selectionSlice.ts`

5. Add `'selectAllTabs'` to `SelectionSlice` Pick type
6. Add `selectedTabIds: []` to `emptySelection()`
7. Update `selectTab(id, additive=false)`:
   - `additive=false`: set `selectedTabIds: [id]`, `selectedNode: { type: 'tab', tabId: id }`, clear `selectedFeatureIds`
   - `additive=true`: toggle id in `selectedTabIds`, update `selectedNode` to last remaining, clear `selectedFeatureIds`
8. Add `selectAllTabs()`: sets `selectedTabIds` to all visible tab IDs, `selectedNode` to last tab, clears feature selection
9. Update `selectTabsRoot()`: add `selectedTabIds: []`
10. Update `sanitizeSelection()`: filter `selectedTabIds` to valid tab IDs, derive primary `selectedNode` from last valid id

### `src/store/slices/tabsSlice.ts`

11. Add `updateTabs` to `TabsSlice` Pick type
12. Implement `updateTabs(ids, patch)`: map over tabs, apply patch to matched IDs
13. Update `deleteTab`: also clear the deleted tab from `selectedTabIds`
14. Update `autoPlaceTabsForOperation`: set `selectedTabIds: []` in selection

---

## Phase 2: Feature tree UI

### `src/components/feature-tree/FeatureTree.tsx`

15. Add `onSelectAllTabs?: () => void` prop to `TreeRowProps`
16. Add "Select All Tabs" button (dashed-square icon) to the Tabs root TreeRow (after the "+" add button)
17. Wire `onSelectAllTabs` in the Tabs root TreeRow call site
18. Update tab TreeRow `onClick` to support additive selection: `selectTab(tab.id, event.metaKey || event.ctrlKey || event.shiftKey)`
19. Update tab TreeRow `isSelected` to check `selection.selectedTabIds.includes(tab.id)`
20. Update tab TreeRow `onContextMenu` to ensure the right-clicked tab is in `selectedTabIds` before opening context menu

---

## Phase 3: PropertiesPanel bulk editing

### `src/components/feature-tree/PropertiesPanel.tsx`

21. Derive `allSelectedTabs` from `selection.selectedTabIds`
22. Add new branch: `if (selectedTabIds.length > 1)` — shows:
    - Selection count: `"N Tabs"` (disabled input)
    - Size field: common value or "Mixed values" → update all tabs preserving center
    - Z Top: common value or "Mixed values" → `updateTabs(ids, { z_top: next })`
    - Z Bottom: common value or "Mixed values" → `updateTabs(ids, { z_bottom: next })`
    - Shape: common value or "Mixed" → `updateTabs(ids, { shape: value })`
    - "Delete Selected" button
23. Update single-tab branch to derive `selectedTab` from `selectedTabIds[0]` when exactly one is selected

---

## Phase 4: Canvas interaction

### `src/components/canvas/usePointerGestures.ts` / `useClickPlacement.ts`

24. Update tab hit-test branches to pass additive modifier to `selectTab`

### `src/components/canvas/SketchCanvas.tsx`

25. Update tab rendering to check `selection.selectedTabIds.includes(tab.id)` for the `selected` flag

### `src/components/canvas/useCanvasContextMenu.ts`

26. Update tab right-click handler: if the tab isn't already in `selectedTabIds`, select it exclusively first

---

## Phase 5: Verification

27. Run `npm run build` to verify no type errors or lint failures
28. Run `npm test` to verify structural tests pass

---

## Files to modify

| File | Changes |
|------|---------|
| `src/store/types.ts` | Add `selectedTabIds` to SelectionState; add `selectAllTabs`, `updateTabs` actions; update `selectTab` signature |
| `src/store/slices/selectionSlice.ts` | Add `selectAllTabs`; update `selectTab` for additive; update `emptySelection`, `sanitizeSelection` |
| `src/store/slices/tabsSlice.ts` | Add `updateTabs`; update `deleteTab`, `autoPlaceTabsForOperation` |
| `src/components/feature-tree/FeatureTree.tsx` | Add `onSelectAllTabs` prop; wire additive clicks; add "Select All" button; update `isSelected` |
| `src/components/feature-tree/PropertiesPanel.tsx` | Add multi-tab bulk editing branch; derive `allSelectedTabs` |
| `src/components/canvas/SketchCanvas.tsx` | Update tab selected check to use `selectedTabIds` |
| `src/components/canvas/usePointerGestures.ts` | Pass additive modifier on tab selection |
| `src/components/canvas/useClickPlacement.ts` | Pass additive modifier on tab selection |
| `src/components/canvas/useCanvasContextMenu.ts` | Ensure right-click selects tab exclusively if not in multi-set |

## Risks

- **Selection state consistency**: `selectedTabIds` must stay in sync with `selectedNode`. If a tab is deleted, it must be removed from `selectedTabIds` too — `sanitizeSelection` handles this.
- **Size field**: The size editor currently sets both `w` and `h` to the same value and recenters. For bulk edit, each tab's center must be preserved independently — this requires mapping over each tab individually rather than a single patch.
