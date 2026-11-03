import crypto from 'crypto';
import path from 'path';

export const sanitizePathSegment = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);

export const getMinecraftRoot = (userDataDir: string) =>{
  if (process.platform === "win32") {
    return path.join(userDataDir, '.minecraft');
  }
  return path.join(userDataDir, 'minecraft');
}

/**
 * Single shared directory holding every account's Minecraft auth tokens.
 * prismarine-auth keeps accounts separate inside this folder by prefixing
 * each cache file with a hash of the username, so one folder == per-username
 * storage. Both the launcher (MinecraftAccountService) and the bot worker
 * (`join.js` via mineflayer's `profilesFolder`) point here so they share a
 * single login per account.
 */
export const getMinecraftAuthDir = (userDataDir: string) =>
  path.join(userDataDir, 'minecraft-auth');

/**
 * Mirror of prismarine-auth's cache-file hashing (see
 * node_modules/prismarine-auth/src/common/Util.js). Used to locate/remove a
 * single account's cache files (`<hash>_<cacheName>-cache.json`).
 */
export const minecraftAuthHash = (username: string) =>
  crypto
    .createHash('sha1')
    .update(username ?? '', 'binary')
    .digest('hex')
    .substr(0, 6);

export type InstanceModLoader = 'vanilla' | 'fabric';

export const getModsPath = (gamePath: string) => path.join(gamePath, 'mods');

const md5 = (value: string) => crypto.createHash('md5').update(value, 'utf8').digest();

export const offlineUuid = (username: string) => {
  const hash = md5(`OfflinePlayer:${username}`);
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
