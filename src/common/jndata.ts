import type { JNdata } from '../main/src/types';
import minecraftVersions from './minecraftVersions.json';

/**
 * JNdata shipped with the app: only the supported Minecraft versions. Servers
 * are installed profiles, merged in by `mergeProfilesIntoJNdata`.
 */
export const STATIC_JNDATA: JNdata = {
  version: 1,
  serverList: [],
  servers: {},
  data: {},
  ...minecraftVersions,
};
