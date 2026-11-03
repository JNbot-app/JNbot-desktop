import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { JNDATA_PROXY_BASE, UPDATER_RAW_BASE } from '../../updaterHosts';

/**
 * The JNbot client mod is hosted on the `jnbot-mods` branch of JNbot-updater
 * (published by scripts/publishMods.mjs). Its manifest lists, per Minecraft
 * version, the latest mod build plus the libraries it needs.
 */
export type ModArtifact = {
  filename: string;
  url: string;
  hashes: Record<string, string>;
  destination: string;
};

export type JnbotModEntry = {
  version: string;
  filename: string;
  sha1: string;
  libraries: ModArtifact[];
};

type JnbotModManifest = { versions: Record<string, JnbotModEntry> };

const BRANCH = 'jnbot-mods';
const MANIFEST_TTL = 10 * 60 * 1000;
const FETCH_TIMEOUT = 8000;

/** `npm run build:mods` output, used instead of the published jar in development. */
const DEV_LIBS_DIR = path.join(
  process.cwd(),
  'minecraft-mods',
  'jnbot-fabric',
  'build',
  'libs',
);
const isDev = process.env.NODE_ENV === 'development';

function findDevJar(mcVersion: string): string | null {
  if (!isDev) return null;
  try {
    const name = fs
      .readdirSync(DEV_LIBS_DIR)
      .find((file) => file.endsWith(`+${mcVersion}.jar`));
    return name ? path.join(DEV_LIBS_DIR, name) : null;
  } catch {
    return null;
  }
}

const modsDir = () => path.join(app.getPath('userData'), 'minecraft-mods');
const manifestCachePath = () => path.join(modsDir(), 'manifest.json');

let manifest: JnbotModManifest | null = null;
let fetchedAt = 0;
let pending: Promise<JnbotModManifest> | null = null;

/** Proxy first, raw GitHub as fallback. */
const sources = (relPath: string) => [
  `${JNDATA_PROXY_BASE}/mods/${relPath}`,
  `${UPDATER_RAW_BASE}/refs/heads/${BRANCH}/${relPath}`,
];

async function fetchFirst(relPath: string): Promise<Response> {
  for (const url of sources(relPath)) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    }).catch((err) => {
      console.warn(`[JnbotMods] fetch failed: ${url} — ${err?.message ?? err}`);
      return null;
    });
    if (res?.ok) return res;
    if (res) console.warn(`[JnbotMods] ${url} responded ${res.status}`);
  }
  throw new Error(`Could not download ${relPath}`);
}

function readCachedManifest(): JnbotModManifest {
  try {
    return JSON.parse(fs.readFileSync(manifestCachePath(), 'utf8'));
  } catch {
    return { versions: {} };
  }
}

async function refreshManifest(): Promise<JnbotModManifest> {
  try {
    const remote: JnbotModManifest = await (
      await fetchFirst('manifest.json')
    ).json();
    if (!remote?.versions) throw new Error('Invalid JNbot mod manifest');
    manifest = remote;
    fetchedAt = Date.now();
    await fsp.mkdir(modsDir(), { recursive: true });
    await fsp.writeFile(manifestCachePath(), JSON.stringify(remote));
  } catch (err) {
    // Offline: keep whatever we have (memory or last cached copy).
    console.warn('[JnbotMods] using cached manifest:', err);
    manifest ??= readCachedManifest();
  }
  return manifest;
}

/** Latest manifest, refetched at most every MANIFEST_TTL. */
export function getJnbotModManifest(): Promise<JnbotModManifest> {
  if (manifest && Date.now() - fetchedAt < MANIFEST_TTL)
    return Promise.resolve(manifest);
  pending ??= refreshManifest().finally(() => {
    pending = null;
  });
  return pending;
}

/** Sync check against the last known manifest (refreshes it in the background). */
export function isJnbotModAvailable(mcVersion: string): boolean {
  manifest ??= readCachedManifest();
  void getJnbotModManifest();
  return mcVersion in manifest.versions || !!findDevJar(mcVersion);
}

const sha1 = (bytes: Uint8Array) =>
  crypto.createHash('sha1').update(bytes).digest('hex');

/** Downloads (or reuses) the latest JNbot mod jar for a Minecraft version. */
export async function installJnbotMod(
  mcVersion: string,
): Promise<{ entry: JnbotModEntry; jarPath: string }> {
  const entry = (await getJnbotModManifest()).versions[mcVersion];
  const devJar = findDevJar(mcVersion);
  if (devJar) {
    // Libraries (Fabric API) still come from the published manifest.
    console.log(`[JnbotMods] using local dev build ${devJar}`);
    return {
      entry: {
        version: 'dev',
        sha1: '',
        libraries: [],
        ...entry,
        filename: path.basename(devJar),
      },
      jarPath: devJar,
    };
  }
  if (!entry)
    throw new Error(`JNbot client is not available for Minecraft ${mcVersion}`);

  const jarPath = path.join(modsDir(), mcVersion, entry.filename);
  const existing = await fsp.readFile(jarPath).catch(() => null);
  if (existing && sha1(existing) === entry.sha1) return { entry, jarPath };

  const bytes = new Uint8Array(
    await (await fetchFirst(`${mcVersion}/${entry.filename}`)).arrayBuffer(),
  );
  if (sha1(bytes) !== entry.sha1)
    throw new Error(`JNbot mod ${entry.filename} failed hash verification`);
  await fsp.mkdir(path.dirname(jarPath), { recursive: true });
  await fsp.writeFile(jarPath, bytes);
  return { entry, jarPath };
}
