import path from 'path';
import { mapProfileScripts, type CustomProfile } from '../../../common/profiles';
import type { ProfileScript, ProfileScriptSource } from '../../../common/profileScripts';
import { portableRoot } from './storage/portablePaths';

const dataRoot = portableRoot;

/** Store only paths owned by the portable profileScripts directory. */
export function portableScriptPath(filePath: string): string {
  let relative = path.isAbsolute(filePath)
    ? path.relative(dataRoot(), filePath)
    : filePath;
  // Older backups carry the previous installation's absolute data root.
  // Rebase only its known profileScripts suffix; never read the old path.
  if (path.isAbsolute(filePath) && relative.startsWith('..')) {
    const suffix = filePath.match(/[\\/]profileScripts[\\/](.+)$/);
    if (suffix) relative = `profileScripts/${suffix[1]}`;
  }
  const parts = relative.split(/[\\/]/);
  if (parts.length < 3 || parts[0] !== 'profileScripts' ||
      parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Profile script path escapes the data root');
  }
  return parts.join('/');
}

export function resolveScriptPath(filePath: string): string {
  return path.join(dataRoot(), portableScriptPath(filePath));
}

export function portableProfile(profile: CustomProfile): CustomProfile {
  const convert = <T extends ProfileScript>(script: T): T => {
    let source: ProfileScriptSource = script.source;
    if (source.kind === 'bundled') {
      source = {
        kind: 'bundled',
        infoPath: portableScriptPath(source.infoPath),
        codePath: portableScriptPath(source.codePath),
      };
    } else if (source.kind === 'url') {
      source = { kind: 'url', url: source.url, infoPath: '' };
    }
    return { ...script, source };
  };
  return mapProfileScripts(profile, convert);
}
