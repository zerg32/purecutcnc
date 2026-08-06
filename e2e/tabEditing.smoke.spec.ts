/**
 * Copyright 2026 Franja (Frank) Povazanj
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from './fixtures'
import { getProject } from './helpers'
import { seedTabEditingProject } from './tabEditing.helpers'

interface TabSnapshot {
  id: string
  x: number
  y: number
  w: number
  h: number
  shape?: string
}

test('single-tab size and shape controls preserve the tab center', async ({ app, ui }) => {
  await seedTabEditingProject(app.page)
  await ui.tabEditing.rowByName(app.page, 'Tab One').click()

  await expect(ui.tabEditing.shapeField(app.page).locator('.ui-select__label')).toHaveText('Smooth')
  await ui.tabEditing.shapeField(app.page).locator('.ui-select__trigger').click()
  await app.page.getByRole('option', { name: 'Rectangle', exact: true }).click()
  await ui.tabEditing.sizeInput(app.page).fill('8')
  await ui.tabEditing.sizeInput(app.page).blur()

  const project = await getProject(app.page)
  const changed = (project.tabs as TabSnapshot[]).find((tab) => tab.id === 'tab-1')!
  expect(changed.shape).toBe('rect')
  expect(changed.w).toBe(8)
  expect(changed.h).toBe(8)
  expect(changed.x + changed.w / 2).toBe(13)
  expect(changed.y + changed.h / 2).toBe(13)
})

test('tree modifier selection exposes atomic bulk tab editing', async ({ app, ui }) => {
  await seedTabEditingProject(app.page)
  await ui.tabEditing.rowByName(app.page, 'Tab One').click()
  await ui.tabEditing.rowByName(app.page, 'Tab Two').click({ modifiers: ['Control'] })

  await expect(ui.tabEditing.selectionCount(app.page)).toHaveValue('2 tabs selected')
  await ui.tabEditing.sizeInput(app.page).fill('12')
  await ui.tabEditing.sizeInput(app.page).blur()

  let project = await getProject(app.page)
  expect((project.tabs as TabSnapshot[]).map((tab) => [tab.w, tab.h])).toEqual([[12, 12], [12, 12]])

  await ui.tabEditing.deleteSelected(app.page).click()
  project = await getProject(app.page)
  expect(project.tabs).toEqual([])
})
