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

import { buildFrontend } from '@backstage/cli-module-build/dist/lib/buildFrontend.cjs.js';

import chokidar from 'chokidar';
import chalk from 'chalk';
import { OptionValues } from 'commander';
import * as fs from 'fs-extra';
import http from 'node:http';
import path from 'node:path';

import { paths } from '../../lib/paths';
import { Task } from '../../lib/tasks';
import type { ExportResult } from './performExport';
import { performExport } from './performExport';

const DEFAULT_PORT = 7708;
const DEBOUNCE_MS = 300;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export type RebuildStrategy = 'fast' | 'full';

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function classifyChange(changedPath: string): RebuildStrategy {
  const normalized = changedPath.replaceAll('\\', '/');
  const basename = path.basename(normalized);

  if (basename === 'package.json' || basename === 'yarn.lock') {
    return 'full';
  }

  if (
    basename === 'config.d.ts' ||
    basename.endsWith('.config.ts') ||
    basename.endsWith('.config.js')
  ) {
    return 'full';
  }

  if (normalized.includes('/src/') || normalized.startsWith('src/')) {
    return 'fast';
  }

  return 'full';
}

function isTruthyCiEnv(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function resolvePort(opts: OptionValues): number {
  const port = Number(opts.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid port ${opts.port}. Expected an integer between 1 and 65535.`,
    );
  }
  return port;
}

export function createStaticServer(rootDir: string, port: number): http.Server {
  return http
    .createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(
          (req.url ?? '/').split('?')[0].split('#')[0],
        );
        const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
        const filePath = path.join(
          rootDir,
          safePath === '/' || safePath === path.sep ? 'index.html' : safePath,
        );

        if (!filePath.startsWith(rootDir)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        if (!(await fs.pathExists(filePath))) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
        });
        fs.createReadStream(filePath).pipe(res);
      } catch (error) {
        res.writeHead(500);
        res.end(`Server error: ${error}`);
      }
    })
    .listen(port);
}

async function syncDistIntoBundle(targetPath: string): Promise<void> {
  const pluginDist = path.join(paths.targetDir, 'dist');
  const bundleDist = path.join(targetPath, 'dist');
  await fs.remove(bundleDist);
  await fs.copy(pluginDist, bundleDist);
}

async function rebuildFrontendFastPath(targetPath: string): Promise<void> {
  const previousCi = process.env.CI;
  const unsetCiForMfBuild = isTruthyCiEnv(previousCi);
  if (unsetCiForMfBuild) {
    process.env.CI = 'false';
  }

  try {
    Task.log(
      `${chalk.cyan('[watch]')} Running module federation build (fast path)...`,
    );
    await buildFrontend({
      targetDir: paths.targetDir,
      configPaths: [],
      writeStats: false,
      isModuleFederationRemote: true,
    });
  } finally {
    if (unsetCiForMfBuild) {
      if (previousCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = previousCi;
      }
    }
  }

  await syncDistIntoBundle(targetPath);
  Task.log(
    `${chalk.cyan('[watch]')} Copied ${chalk.cyan('dist/')} into bundle (${chalk.cyan(path.join(targetPath, 'dist'))})`,
  );
}

async function rebuildPlugin(
  opts: OptionValues,
  exportResult: ExportResult,
  strategy: RebuildStrategy,
): Promise<void> {
  const isBackend =
    exportResult.role === 'backend-plugin' ||
    exportResult.role === 'backend-plugin-module';
  const isFrontend =
    exportResult.role === 'frontend-plugin' ||
    exportResult.role === 'frontend-plugin-module';

  const useFastPath =
    strategy === 'fast' && isFrontend && opts.generateModuleFederationAssets;

  const mode = useFastPath ? 'fast path' : 'full export';
  const startedAt = Date.now();
  Task.log(`${chalk.cyan('[watch]')} Rebuild started (${mode})...`);

  if (useFastPath) {
    await rebuildFrontendFastPath(exportResult.targetPath);
  } else {
    const rebuildOpts: OptionValues = {
      ...opts,
      clean: true,
      dev: false,
      watch: false,
    };

    if (isBackend) {
      rebuildOpts.install = false;
    }

    await performExport(rebuildOpts);
  }

  const elapsedMs = Date.now() - startedAt;
  Task.log(
    `${chalk.green('[watch]')} Rebuild complete in ${chalk.cyan(formatDuration(elapsedMs))} (${mode})`,
  );
  Task.log(
    chalk.yellow(
      '[watch] Manual RHDH restart is required for backend plugins and when frontend module exports change.',
    ),
  );
}

export async function startDevWatch(
  opts: OptionValues,
  exportResult: ExportResult,
): Promise<never> {
  const port = resolvePort(opts);
  const srcDir = paths.resolveTarget('src');
  const packageJson = paths.resolveTarget('package.json');
  const watchPaths = [srcDir, packageJson];

  const configTs = paths.resolveTarget('config.d.ts');
  if (await fs.pathExists(configTs)) {
    watchPaths.push(configTs);
  }

  const server = createStaticServer(exportResult.targetPath, port);
  let debounceTimer: NodeJS.Timeout | undefined;
  let rebuildInProgress = false;
  let pendingRebuild: { strategy: RebuildStrategy } | undefined;

  const scheduleRebuild = (changedPath: string) => {
    const strategy = classifyChange(changedPath);

    pendingRebuild = {
      strategy:
        pendingRebuild?.strategy === 'full' || strategy === 'full'
          ? 'full'
          : 'fast',
    };

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      void (async () => {
        if (rebuildInProgress) {
          return;
        }

        const current = pendingRebuild;
        pendingRebuild = undefined;
        if (!current) {
          return;
        }

        rebuildInProgress = true;
        try {
          Task.log(
            `${chalk.cyan(
              '[watch]',
            )} Change detected in ${chalk.cyan(changedPath)}`,
          );
          await rebuildPlugin(opts, exportResult, current.strategy);
        } catch (error) {
          Task.log(
            `${chalk.red(
              '[watch]',
            )} Rebuild failed: ${error instanceof Error ? error.message : error}`,
          );
        } finally {
          rebuildInProgress = false;
          if (pendingRebuild) {
            const nextPath = changedPath;
            scheduleRebuild(nextPath);
          }
        }
      })();
    }, DEBOUNCE_MS);
  };

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  const shutdown = async (signal: string) => {
    Task.log(`${chalk.cyan('[watch]')} Shutting down (${signal})...`);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    await watcher.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  watcher.on('all', (_event, changedPath) => {
    if (changedPath) {
      scheduleRebuild(changedPath);
    }
  });

  const assetUrl = `http://localhost:${port}`;
  Task.log(
    `${chalk.green('[watch]')} Serving dynamic plugin assets at ${chalk.cyan(assetUrl)}`,
  );
  Task.log(
    `${chalk.cyan(
      '[watch]',
    )} Watching: ${watchPaths.map(p => chalk.cyan(p)).join(', ')}`,
  );

  return new Promise(() => {});
}
