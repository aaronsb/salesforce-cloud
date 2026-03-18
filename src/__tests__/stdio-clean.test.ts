/// <reference types="jest" />

import { spawn } from 'child_process';
import { resolve } from 'path';

/**
 * Verify the MCP server doesn't emit non-JSON-RPC output on stdout at startup.
 *
 * MCP uses stdio transport — anything on stdout that isn't a valid JSON-RPC
 * message breaks the protocol. This test catches libraries (like dotenv v17)
 * that log banners to stdout on import.
 */
describe('stdio transport cleanliness', () => {
  it('should not emit non-JSON-RPC data on stdout at startup', (done) => {
    const serverPath = resolve(__dirname, '../../build/index.js');
    const child = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Don't connect to real Salesforce
        SF_CLIENT_ID: 'test-stdio-check',
        SF_CLIENT_SECRET: 'test-stdio-check',
      },
    });

    let stdout = '';
    let timedOut = false;

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // Give the server 2 seconds to start and emit any rogue output,
    // then kill it and check what came out on stdout.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 2000);

    child.on('close', () => {
      clearTimeout(timer);

      // The server should emit nothing on stdout until it receives
      // a JSON-RPC request. Any output here is a protocol violation.
      if (stdout.length > 0) {
        // If there IS output, it must be valid JSON-RPC (starts with {)
        const lines = stdout.trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            expect(parsed).toHaveProperty('jsonrpc', '2.0');
          } catch {
            // Non-JSON on stdout = test failure
            expect(`Non-JSON-RPC output on stdout: ${line}`).toBeNull();
          }
        }
      }

      done();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      // spawn failure is fine — we're testing stdout, not connectivity
      done();
    });
  }, 10000);
});
