import { ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MinecraftLauncherTypes } from '../../../../../common/CommonEnums';
import type { VersionInfo } from './MinecraftLauncherTypes';
import {
  DISCOVERY_PATH,
  PLACEHOLDER_TOKEN_SUFFIX,
  startLunarIpcServer,
} from './LunarIpc';

/**
 * Launches an existing Lunar Client install (~/.lunarclient, set up by the
 * official launcher) with a JNbot account.
 *
 * Lunar's account manager reads settings/game/accounts.json at startup and
 * only accepts `Xbox` accounts whose token is a JWT. All alts of the profile
 * are written there so they can be switched in-game; cracked alts get an
 * unsigned placeholder JWT (offline servers never verify it), premium alts
 * without a session get an expired one so Lunar asks us (over IPC) to refresh
 * them once selected. The user's own file is restored on exit.
 */

export type LunarSession = { name: string; uuid: string; accessToken?: string };
export type LunarAccount = LunarSession & { premium: boolean };

const lunarDir = path.join(os.homedir(), '.lunarclient');
const multiverDir = path.join(lunarDir, 'offline', 'multiver');
const accountsFile = path.join(lunarDir, 'settings', 'game', 'accounts.json');
const accountsBackup = `${accountsFile}.jnbot-backup`;
const MAPPINGS_JAR = /^lunar-platform-mappings-v(.+)\.jar$/;

let running: ChildProcess | null = null;

const firstDir = (dir: string) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .find((d) => d.isDirectory())?.name;

/** Versions the official launcher has already downloaded. */
export async function getLunarVersions(): Promise<VersionInfo[]> {
  const files = await fs.promises.readdir(multiverDir).catch(() => []);
  return files
    .map((f) => MAPPINGS_JAR.exec(f)?.[1].replace(/_/g, '.'))
    .filter((v): v is string => !!v)
    .map((id) => ({
      id,
      name: `Lunar Client ${id}`,
      launcherType: MinecraftLauncherTypes.LUNAR,
      type: 'release',
    }));
}

const findJava = () => {
  const jreDir = path.join(lunarDir, 'jre');
  const hash = firstDir(jreDir);
  const dist = hash && firstDir(path.join(jreDir, hash));
  if (!dist) throw new Error('Lunar Client JRE not found, launch Lunar once from its own launcher');
  const home = path.join(jreDir, hash, dist);
  const java = ['Contents/Home/bin/java', 'bin/javaw.exe', 'bin/java']
    .map((p) => path.join(home, p))
    .find((p) => fs.existsSync(p));
  if (!java) throw new Error(`No java binary in ${home}`);
  return java;
};

/** Minecraft access tokens are JWTs; Lunar refreshes once `exp` has passed. */
const tokenExpiry = (token: string) => {
  try {
    const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    if (typeof exp === 'number') return new Date(exp * 1000).toISOString();
  } catch {
    // not a JWT
  }
  return new Date(Date.now() + 23 * 3600_000).toISOString();
};

// Lunar decodes JWT parts with the standard (not url-safe) Base64 decoder.
const b64 = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64').replace(/=+$/, '');

/** Unsigned placeholder JWT, valid for `ttl` seconds (negative = already expired). */
const placeholderToken = (account: LunarAccount, ttl: number) => {
  const iat = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    sub: account.uuid,
    name: account.name,
    iat,
    exp: iat + ttl,
  })}${PLACEHOLDER_TOKEN_SUFFIX}`;
};

const accountId = (account: LunarSession) =>
  account.uuid.replace(/-/g, '').toLowerCase();

function writeLunarAccounts(list: LunarAccount[], activeId: string) {
  const entries = list.map((account) => {
    const id = accountId(account);
    const accessToken =
      account.accessToken ?? placeholderToken(account, account.premium ? -60 : 24 * 3600);
    return [
      id,
      {
        accessToken,
        accessTokenExpiresAt: tokenExpiry(accessToken),
        eligibleForMigration: false,
        hasMultipleProfiles: false,
        legacy: false,
        persistent: true,
        userProperites: [],
        localId: id,
        minecraftProfile: { id, name: account.name },
        remoteId: id,
        type: 'Xbox',
        username: account.name,
        // Must be non-null for the account to become active; refreshing
        // goes through our IPC server, never through this token.
        refreshToken: 'jnbot',
      },
    ];
  });
  const accounts = {
    activeAccountLocalId: activeId,
    accounts: Object.fromEntries(entries),
  };

  fs.mkdirSync(path.dirname(accountsFile), { recursive: true });
  // Keep the user's original file so no JNbot token is left behind after exit.
  // A leftover backup is the original from a run that didn't restore.
  if (!fs.existsSync(accountsBackup)) {
    if (fs.existsSync(accountsFile)) fs.copyFileSync(accountsFile, accountsBackup);
    else fs.writeFileSync(accountsBackup, '{"accounts":{}}');
  }
  if (fs.existsSync(accountsFile)) fs.chmodSync(accountsFile, 0o644);
  fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
}

const restoreAccounts = () => {
  try {
    if (fs.existsSync(accountsBackup)) fs.renameSync(accountsBackup, accountsFile);
  } catch (err) {
    console.error('Failed to restore Lunar accounts.json', err);
  }
};

export async function launchLunarClient(options: {
  version: string;
  gameDir: string;
  /** The alt to launch with (has an access token when premium). */
  session: LunarSession;
  /** Other alts to offer in Lunar's account switcher. */
  accounts?: LunarAccount[];
  /** Fresh session for a premium alt. */
  getSession?: (name: string) => Promise<LunarSession>;
  maxMemoryMB?: number;
  server?: string;
  jvmArgs?: string[];
  log: (message: string) => void;
}): Promise<ChildProcess> {
  // Only one at a time: accounts.json is shared and each client is memory heavy.
  if (running && running.exitCode === null)
    throw new Error('A Lunar Client is already running, close it first');

  const { version, gameDir, session } = options;
  const files = fs.readdirSync(multiverDir);
  const jars = files.filter((f) => {
    if (!f.endsWith('.jar')) return false;
    const mappings = MAPPINGS_JAR.exec(f)?.[1];
    return !mappings || mappings.replace(/_/g, '.') === version;
  });
  if (!jars.some((j) => MAPPINGS_JAR.test(j)))
    throw new Error(`Lunar Client ${version} is not installed`);

  const assetIndex = fs
    .readdirSync(path.join(lunarDir, 'shared', 'assets', 'indexes'))
    .map((f) => path.basename(f, '.json'))
    .sort((a, b) => Number(b) - Number(a))[0];
  const uiDir = path.join(lunarDir, 'ui', firstDir(path.join(lunarDir, 'ui')) ?? '');
  const modsDir = path.join(lunarDir, 'profiles', version.split('.')[0], 'mods');
  const natives = path.join(multiverDir, 'natives');

  // Keyed by account id; the launched alt wins over a profile alt with the same name.
  const accounts = new Map<string, LunarAccount>();
  for (const account of [
    { ...session, premium: !!session.accessToken },
    ...(options.accounts ?? []),
  ]) {
    if (![...accounts.values()].some((a) => a.name === account.name))
      accounts.set(accountId(account), account);
  }
  let activeId = accountId(session);
  const write = () => writeLunarAccounts([...accounts.values()], activeId);

  write();
  const ipc = await startLunarIpcServer({
    log: options.log,
    writeAccount: async (uuid) => {
      const id = uuid && accounts.has(uuid) ? uuid : activeId;
      const account = accounts.get(id)!;
      if (account.premium && options.getSession)
        account.accessToken = (await options.getSession(account.name)).accessToken;
      activeId = id;
      write();
    },
  });
  fs.mkdirSync(gameDir, { recursive: true });

  const jvmArgs = [
    ...(process.platform === 'darwin' ? ['-XstartOnFirstThread'] : []),
    '--add-modules', 'jdk.naming.dns',
    '--add-exports', 'jdk.naming.dns/com.sun.jndi.dns=java.naming',
    '--add-opens', 'java.base/java.io=ALL-UNNAMED',
    '--add-exports', 'java.base/jdk.internal.misc=ALL-UNNAMED',
    '--enable-native-access=ALL-UNNAMED',
    '-Dlog4j2.formatMsgNoLookups=true',
    '-XX:+UseZGC',
    `-Xmx${options.maxMemoryMB ?? 3072}m`,
    `-Djava.library.path=${natives}`,
    `-Dichor.fabric.localModPath=${modsDir}`,
    '-Dichor.fabricLoaderVersion=0.19.5',
    `-Dichor.logsFile=${path.join(gameDir, 'ichor-boot.log')}`,
    '-Dichor.usingIsolatedProfiles=true',
    `-Dminecraft.api.discovery.host=http://127.0.0.1:${ipc.port}${DISCOVERY_PATH}`,
    ...(options.jvmArgs ?? []),
  ];
  const gameArgs = [
    '--version', version,
    '--username', session.name,
    '--uuid', session.uuid,
    '--accessToken', session.accessToken || '0',
    '--userType', session.accessToken ? 'msa' : 'legacy',
    '--userProperties', '{}',
    '--assetIndex', assetIndex,
    '--gameDir', gameDir,
    '--assetsDir', path.join(lunarDir, 'shared', 'assets'),
    '--texturesDir', path.join(lunarDir, 'textures'),
    '--uiDir', uiDir,
    '--webosrDir', natives,
    '--workingDirectory', '.',
    '--classpathDir', multiverDir,
    '--ichorClassPath', jars.join(','),
    '--ipcPort', String(ipc.port),
    '--launchId', randomUUID(), // required to build the IPC handshake
    ...(options.server ? ['--quickPlayMultiplayer', options.server] : []),
  ];

  const proc = spawn(
    findJava(),
    [
      ...jvmArgs,
      '-cp', jars.map((j) => path.join(multiverDir, j)).join(path.delimiter),
      'com.moonsworth.lunar.genesis.Genesis',
      ...gameArgs,
    ],
    { cwd: gameDir },
  );
  running = proc;
  const cleanup = () => {
    if (running === proc) running = null;
    ipc.close();
    restoreAccounts();
  };
  proc.once('exit', cleanup);
  proc.once('error', cleanup);
  return proc;
}
