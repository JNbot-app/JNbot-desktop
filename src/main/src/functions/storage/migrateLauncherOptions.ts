import fs from './portableFs';
import path from 'path';

/** Extract legacy launcher settings without replacing a device's existing choice. */
export function migrateLauncherOptions(sharedPath: string, devicePath: string): void {
  if (!fs.existsSync(sharedPath)) return;
  let shared: Record<string, unknown>;
  try {
    shared = JSON.parse(fs.readFileSync(sharedPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return; // The shared store reports corrupt files through its existing path.
  }
  if (!Object.hasOwn(shared, 'launcherOptions')) return;

  if (!fs.existsSync(devicePath)) {
    fs.mkdirSync(path.dirname(devicePath), { recursive: true });
    fs.writeFileSync(devicePath, JSON.stringify(shared.launcherOptions), 'utf8');
  }
  delete shared.launcherOptions;
  fs.writeFileSync(sharedPath, JSON.stringify(shared), 'utf8');
}
