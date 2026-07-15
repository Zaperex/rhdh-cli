/*
 * Copyright 2024 The Backstage Authors
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

import { classifyChange, formatDuration } from './watch';

describe('formatDuration', () => {
  it('formats sub-second durations in milliseconds', () => {
    expect(formatDuration(842)).toBe('842ms');
  });

  it('formats longer durations in seconds', () => {
    expect(formatDuration(1234)).toBe('1.23s');
  });
});

describe('classifyChange', () => {
  it('classifies source file changes as fast rebuilds', () => {
    expect(classifyChange('src/index.ts')).toBe('fast');
    expect(classifyChange('plugins/foo/src/components/Card.tsx')).toBe('fast');
  });

  it('classifies package manifest changes as full rebuilds', () => {
    expect(classifyChange('package.json')).toBe('full');
    expect(classifyChange('plugins/foo/package.json')).toBe('full');
    expect(classifyChange('yarn.lock')).toBe('full');
  });

  it('classifies config schema changes as full rebuilds', () => {
    expect(classifyChange('config.d.ts')).toBe('full');
    expect(classifyChange('src/plugin.config.ts')).toBe('full');
  });

  it('classifies unknown paths as full rebuilds', () => {
    expect(classifyChange('README.md')).toBe('full');
    expect(classifyChange('dist/index.js')).toBe('full');
  });
});
