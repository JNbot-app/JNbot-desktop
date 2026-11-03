import { app } from 'electron';
import path from 'path';

let selectedRoot: string | undefined;
let rootLocked = false;

/** Select the portable data directory before constructing file owners. */
export function selectPortableRoot(root?: string): void {
  const next = root ? path.resolve(root) : undefined;
  if (rootLocked && next !== selectedRoot) {
    throw new Error('Portable storage root cannot change while file owners are open.');
  }
  selectedRoot = next;
}

/** Call only after all owners of the current portable files have closed. */
export function releasePortableRoot(): void {
  selectedRoot = undefined;
  rootLocked = false;
}

export function portableRoot(): string {
  return selectedRoot ?? app.getPath('userData');
}

export function portablePath(...parts: string[]): string {
  rootLocked = true;
  return path.join(portableRoot(), ...parts);
}

export function devicePath(...parts: string[]): string {
  return path.join(app.getPath('userData'), ...parts);
}

/** Only these owned files may be copied to or from the selected store. */
export function isPortableFile(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return false;
  if (['shared.json', 'appSettings', 'profiles.json', 'stats.json', 'plugin-security/provenance.json'].includes(normalized)) return true;
  if (/^serverSettings\/[^/]+\.json$/.test(normalized)) return true;
  if (/^profileScripts\/[^/_][^/]*\/[^/]+\.(info\.json|code\.jnc)$/.test(normalized)) return true;
  if (/^macros\/[^/]+\.(json|js|ts)$/.test(normalized) && !['macros/jnbot.d.ts', 'macros/jsconfig.json'].includes(normalized)) return true;
  return false;
}
