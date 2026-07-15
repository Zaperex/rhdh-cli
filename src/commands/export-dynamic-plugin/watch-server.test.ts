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

import fs from 'fs-extra';
import http from 'http';
import os from 'os';
import path from 'path';

import { createStaticServer } from './watch';

describe('createStaticServer', () => {
  let tmpDir: string;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rhdh-cli-watch-'));
    await fs.outputFile(
      path.join(tmpDir, 'dist', 'remoteEntry.js'),
      'console.log("remote");',
    );

    server = createStaticServer(tmpDir, 0);
    await new Promise<void>(resolve => {
      server.on('listening', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve test server port');
    }
    port = address.port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
    await fs.remove(tmpDir);
  });

  it('serves bundled assets', async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/dist/remoteEntry.js`,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('remote');
  });

  it('returns 404 for missing assets', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/missing.js`);
    expect(response.status).toBe(404);
  });
});
