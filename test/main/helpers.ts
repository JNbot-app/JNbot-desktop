import os from 'os';
import path from 'path';
import fs from 'fs';

const created: string[] = [];

/** A fresh, empty temp dir to use as a fake `userData` for one test. */
export function freshUserData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jnbot-test-'));
  created.push(dir);
  return dir;
}

/**
 * Reset the module registry, point the mocked electron at `dir`, and return
 * the fresh electron mock. Call this BEFORE requiring the module under test so
 * the module captures the right `userData` path and a clean ipc-handler map.
 */
export function bootElectron(dir: string): any {
  jest.resetModules();
  const electron = require('electron');
  electron.__setUserDataDir(dir);
  return electron;
}

/** Remove every temp dir created during the run. Call from afterAll. */
export function cleanupUserData(): void {
  for (const dir of created.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

export const fileExists = (p: string): boolean => fs.existsSync(p);
export const readJson = (p: string): any =>
  JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeRaw = (p: string, content: string): void => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
};
