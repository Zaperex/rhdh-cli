/*
 * Copyright 2023 The Backstage Authors
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

import chalk from 'chalk';
import { OptionValues } from 'commander';

import { Task } from '../../lib/tasks';
import { applyDevOptions } from './dev';
import { performExport } from './performExport';
import { formatDuration, startDevWatch } from './watch';

export async function command(opts: OptionValues): Promise<void> {
  if (opts.watch) {
    opts.generateScalprumAssets = false;
  }

  const exportStartedAt = Date.now();
  const exportResult = await performExport(opts);

  if (opts.watch) {
    Task.log(
      `${chalk.green('[watch]')} Initial export complete in ${chalk.cyan(formatDuration(Date.now() - exportStartedAt))}`,
    );
    await startDevWatch(opts, exportResult);
  } else if (opts.dev) {
    await applyDevOptions(
      opts,
      exportResult.rawPkg.name,
      exportResult.roleInfo,
      exportResult.targetPath,
    );
  }
}
