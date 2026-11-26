import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const repoRoot = process.cwd();
export const distNode = path.join(repoRoot, 'dist', 'node');

export function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ngx-locatorjs-${prefix}-`));
}

export function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Resolves once `child` prints `marker` on stdout; rejects if it exits first. */
export function waitForOutput(child, marker, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for "${marker}". Output:\n${output}`));
    }, timeoutMs);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(marker)) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(output);
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`process exited (${code}) before "${marker}". Output:\n${output}`));
    });
  });
}
