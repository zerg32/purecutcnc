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

import type { Page } from '@playwright/test'
import { newProject } from '../src/types/project'
import { seedProject } from './helpers'

export async function seedTabEditingProject(page: Page): Promise<void> {
  const project = newProject('Tab Editing E2E Fixture', 'mm')
  project.tabs = [
    { id: 'tab-1', name: 'Tab One', x: 10, y: 10, w: 6, h: 6, z_top: 3, z_bottom: 0, shape: 'smooth', visible: true },
    { id: 'tab-2', name: 'Tab Two', x: 30, y: 20, w: 10, h: 10, z_top: 3, z_bottom: 0, shape: 'smooth', visible: true },
  ]
  await seedProject(page, JSON.stringify(project))
}
