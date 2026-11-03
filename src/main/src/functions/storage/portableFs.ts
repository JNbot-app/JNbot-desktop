import fs from 'fs';
import path from 'path';
import { createFsFromVolume, Volume } from 'memfs';
import { isPortableFile } from './portablePaths';

let memoryRoot: string | undefined;
let memoryFs: typeof fs | undefined;
let onChange: ((file: string) => void) | undefined;

const isMemoryPath = (value: unknown): value is string =>
  typeof value === 'string' && !!memoryRoot &&
  (value === memoryRoot || value.startsWith(`${memoryRoot}${path.sep}`));

function changed(file: string): void {
  if (!isMemoryPath(file) || !memoryRoot) return;
  if (isPortableFile(path.relative(memoryRoot, file).replaceAll('\\', '/'))) onChange?.(file);
}

function filesUnder(file: string): string[] {
  if (!memoryFs?.existsSync(file)) return [];
  if (!memoryFs.statSync(file).isDirectory()) return [file];
  return memoryFs.readdirSync(file, { withFileTypes: true }).flatMap((entry) =>
    filesUnder(path.join(file, entry.name)));
}

/** Virtual filesystem for portable data. Device-only paths always use native fs. */
export function activatePortableMemory(root: string, files: Map<string, Buffer>): void {
  memoryRoot = path.resolve(root);
  memoryFs = createFsFromVolume(new Volume()) as unknown as typeof fs;
  memoryFs.mkdirSync(memoryRoot, { recursive: true });
  for (const [relative, bytes] of files) {
    if (!isPortableFile(relative)) throw new Error('Invalid portable file path.');
    const file = path.join(memoryRoot, relative);
    memoryFs.mkdirSync(path.dirname(file), { recursive: true });
    memoryFs.writeFileSync(file, bytes);
  }
}

export function clearPortableMemory(): void {
  onChange = undefined;
  memoryFs = undefined;
  memoryRoot = undefined;
}

export function isPortableMemoryActive(): boolean {
  return !!memoryFs;
}

export function setPortableMutationHandler(handler?: (file: string) => void): void {
  onChange = handler;
}

export function portableMemoryFiles(): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  if (!memoryRoot || !memoryFs) return result;
  for (const file of filesUnder(memoryRoot)) {
    const relative = path.relative(memoryRoot, file).replaceAll('\\', '/');
    if (isPortableFile(relative)) result.set(relative, Buffer.from(memoryFs.readFileSync(file)));
  }
  return result;
}

const routed = new Set([
  'chmodSync', 'existsSync', 'mkdirSync', 'mkdtempSync', 'readFile', 'readFileSync',
  'readdirSync', 'renameSync', 'rmSync', 'statSync', 'lstatSync', 'unlinkSync',
  'writeFile', 'writeFileSync',
]);

const portableFs = new Proxy(fs, {
  get(target, property) {
    if (typeof property !== 'string' || !routed.has(property)) return Reflect.get(target, property);
    return (...args: any[]) => {
      const source = args[0];
      const implementation = isMemoryPath(source) ? memoryFs : target;
      if (!implementation) throw new Error('Portable storage is not ready.');
      if (property === 'renameSync' && isMemoryPath(source) !== isMemoryPath(args[1]))
        throw new Error('Cannot move data between portable and device storage.');
      const previous = isMemoryPath(source) && ['renameSync', 'rmSync'].includes(property)
        ? filesUnder(source) : [];
      if (property === 'renameSync' && isMemoryPath(args[1])) previous.push(...filesUnder(args[1]));
      if (property === 'writeFile' && isMemoryPath(source)) {
        const callback = args[args.length - 1];
        args[args.length - 1] = (error: Error | null) => {
          if (!error) changed(source);
          callback(error);
        };
      }
      const result = (implementation as any)[property](...args);
      if (isMemoryPath(source)) {
        if (['writeFileSync', 'unlinkSync'].includes(property)) changed(source);
        if (property === 'renameSync') {
          previous.forEach(changed);
          filesUnder(args[1]).forEach(changed);
        }
        if (property === 'rmSync') previous.forEach(changed);
      }
      return result;
    };
  },
}) as typeof fs;

export default portableFs;
