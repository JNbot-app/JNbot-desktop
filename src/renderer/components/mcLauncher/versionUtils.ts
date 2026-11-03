import { MinecraftLauncherTypes } from "../../../common/CommonEnums";

export type MinecraftVersionType = 'release' | 'snapshot' | 'legacy';

export const SNAPSHOTS_GROUP_KEY = 'Snapshots';

export const inferVersionType = (id: string): MinecraftVersionType => {
  const lower = id.toLowerCase();
  if (
    lower.includes('snapshot') ||
    /\b\d{2}w\d{2}[a-z]\b/.test(lower) ||
    lower.includes('pre') ||
    lower.includes('rc')
  ) {
    return 'snapshot';
  }

  const parts = id.split('.');
  if (parts[0] === '1') {
    const minor = Number(parts[1] ?? '0');
    return minor > 0 && minor < 13 ? 'legacy' : 'release';
  }

  return 'release';
};

export const inferUpdateKey = (
  id: string,
  type: MinecraftVersionType,
): string => {
  if (type === 'snapshot') return SNAPSHOTS_GROUP_KEY;

  const match = id.match(/^(\d+)(?:\.(\d+))?/);
  if (match) {
    if (match[1] === '1' && match[2]) {
      return `${match[1]}.${match[2]}`;
    }
    return match[1];
  }
  return id;
};

const parseGroupKey = (key: string): { major: number; minor: number } | null => {
  const match = key.match(/^(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: match[2] !== undefined ? parseInt(match[2], 10) : 0,
  };
};

export const sortVersionGroupKey = (aKey: string, bKey: string): number => {
  if (aKey === bKey) return 0;
  if (aKey === SNAPSHOTS_GROUP_KEY) return 1;
  if (bKey === SNAPSHOTS_GROUP_KEY) return -1;

  const aParsed = parseGroupKey(aKey);
  const bParsed = parseGroupKey(bKey);
  if (!aParsed || !bParsed) return bKey.localeCompare(aKey);

  const aIsNew = aParsed.major > 1;
  const bIsNew = bParsed.major > 1;

  if (aIsNew && !bIsNew) return -1;
  if (!aIsNew && bIsNew) return 1;

  if (aIsNew && bIsNew) {
    if (aParsed.major !== bParsed.major) return bParsed.major - aParsed.major;
    return bParsed.minor - aParsed.minor;
  }

  if (aParsed.minor !== bParsed.minor) return bParsed.minor - aParsed.minor;
  return 0;
};

export const launcherLabel = (launcherType: MinecraftLauncherTypes): string => {
  switch (launcherType) {
    case MinecraftLauncherTypes.JNBOT_CLIENT:
      return 'JNbot Client';
    case MinecraftLauncherTypes.VANILLA:
      return 'Vanilla';
    case MinecraftLauncherTypes.OPTIFINE:
      return 'OptiFine';
    case MinecraftLauncherTypes.FABRIC:
      return 'Fabric';
    case MinecraftLauncherTypes.FORGE:
      return 'Forge';
    case MinecraftLauncherTypes.QUILT:
      return 'Quilt';
    case MinecraftLauncherTypes.LABYMOD:
      return 'LabyMod';
    case MinecraftLauncherTypes.LUNAR:
      return 'Lunar Client';
    default:
      return "";
  }
};


export const launcherToText = (launcherType: MinecraftLauncherTypes): string => {
  switch (launcherType) {
    case MinecraftLauncherTypes.JNBOT_CLIENT:
    case MinecraftLauncherTypes.FABRIC:
      return 'fabric';
    case MinecraftLauncherTypes.FORGE:
      return 'forge';
    case MinecraftLauncherTypes.QUILT:
      return 'quilt';
     default:
      return 'vanilla';
  }

}