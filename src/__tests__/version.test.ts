/// <reference types="jest" />

import { readFileSync } from 'fs';
import { join } from 'path';
import { VERSION } from '../version';

/**
 * The server reports VERSION to MCP clients in the initialize handshake, and
 * it is baked in at build time (the mcpb bundle strips package.json, so it
 * cannot be read at runtime). That makes drift possible, so pin it here:
 * `make version-sync` keeps these in step, and this test fails the build if
 * a release ever forgets to run it. This is not a hypothetical — the server
 * shipped as 0.2.0 while package.json said 0.5.0.
 */
function readJson(relPath: string): { version: string } {
  return JSON.parse(readFileSync(join(__dirname, '..', '..', relPath), 'utf8'));
}

describe('version consistency', () => {
  it('matches package.json', () => {
    expect(VERSION).toBe(readJson('package.json').version);
  });

  it.each(['server.json', 'manifest.json', 'mcpb/manifest.json'])(
    'matches %s',
    (manifest) => {
      expect(readJson(manifest).version).toBe(readJson('package.json').version);
    },
  );
});
