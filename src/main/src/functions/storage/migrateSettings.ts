import fs from './portableFs';
import path from 'path';
import { migrateLegacyTriggers } from '../../../../common/triggers';
import type {
  Alt,
  ServerAltInfo,
  SettingsObj,
  SharedSettings,
} from '../../types';

interface MigrateOpts {
  legacyPath: string;
  sharedPath: string;
  serverDir: string;
  appSettingsPath: string;
}

const SETTINGS_VERSION = 3;
const SHARED_VERSION = 3;
export const PREDEFINED_SERVERS = ['jartexnetwork', 'pikanetwork'] as const;
type PredefinedServer = (typeof PREDEFINED_SERVERS)[number];

/**
 * One-shot migration from the old monolithic settings.json to:
 *   - shared.json                (alts, devices, launcherOptions)
 *   - serverSettings/<id>.json   (scripts, altTags, reminders, triggers)
 *
 * Seeding the predefined jartex/pika profiles into `installedServers` is NOT
 * done here — that lives in Settings (it owns appSettings), where it can tell a
 * returning user from a brand-new one and seed exactly once. See
 * `Settings_`'s constructor.
 *
 * Safe to call on every boot.
 */
export function migrateLegacySettings(opts: MigrateOpts): boolean {
  const { legacyPath, sharedPath, serverDir, appSettingsPath } = opts;

  // Nothing to migrate.
  if (!fs.existsSync(legacyPath)) return false;

  // Shared file already exists → migration was already done (defensive — the
  // legacy file should have been renamed). Don't clobber.
  if (fs.existsSync(sharedPath)) {
    backupLegacyFile(legacyPath);
    return false;
  }

  let legacy: any;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  } catch (err) {
    console.error('migrateLegacySettings: cannot parse legacy settings', err);
    return false;
  }

  console.info('Migrating legacy settings.json → shared.json + per-server files');

  const currentServer = readCurrentServer(appSettingsPath) ?? PREDEFINED_SERVERS[0];

  // altData[serverId][username] = ServerAltInfo
  const altData: Record<PredefinedServer, Record<string, ServerAltInfo>> = {
    jartexnetwork: {},
    pikanetwork: {},
  };

  const legacyAlts: any[] = Array.isArray(legacy.alts) ? legacy.alts : [];
  const sharedAlts: Alt[] = legacyAlts.map((alt) => {
    const username: string = alt?.username ?? '';
    for (const id of PREDEFINED_SERVERS) {
      const slot = alt?.[id];
      if (slot && typeof slot === 'object') {
        altData[id][username] = {
          premium: alt?.premium ?? false,
          password: slot.password,
          gkits: slot.gkits ?? {},
          ranks: slot.ranks ?? {},
        };
      }
    }
    return {
      username,
      UID: alt?.UID ?? null,
      email: alt?.email,
    };
  });

  // ── shared.json ──────────────────────────────────────────────────────────
  const shared: SharedSettings = {
    alts: sharedAlts,
    devices: Array.isArray(legacy.devices) ? legacy.devices : [],
    pluginMetadata: {},
    launcherOptions: legacy.launcherOptions,
    version: SHARED_VERSION,
  };
  try {
    fs.mkdirSync(path.dirname(sharedPath), { recursive: true });
    fs.writeFileSync(sharedPath, JSON.stringify(shared), 'utf8');

    // ── serverSettings/<id>.json ─────────────────────────────────────────────
    fs.mkdirSync(serverDir, { recursive: true });

    // Reminders + triggers were global before — assign them to the current
    // server only (per design decision).
    const legacyReminders = Array.isArray(legacy.reminders) ? legacy.reminders : [];
    const legacyTriggers = migrateLegacyTriggers(legacy.triggers);

    for (const id of PREDEFINED_SERVERS) {
      const settings: SettingsObj = {
        scripts: (legacy.scripts && legacy.scripts[id]) || {},
        altTags:
          (legacy.altTags && Array.isArray(legacy.altTags[id]) && legacy.altTags[id]) ||
          [],
        reminders: id === currentServer ? legacyReminders : [],
        triggers: id === currentServer ? legacyTriggers : [],
        altData: altData[id],
        version: SETTINGS_VERSION,
      };

      fs.writeFileSync(
        path.join(serverDir, `${id}.json`),
        JSON.stringify(settings),
        'utf8',
      );
    }

    backupLegacyFile(legacyPath);
    return true;
  } catch (err) {
    console.error('migrateLegacySettings: failed to write migrated files', err);
    return false;
  }
}

function backupLegacyFile(legacyPath: string) {
  const backup = legacyPath + '.bak';
  try {
    fs.renameSync(legacyPath, backup);
    console.info(`Legacy settings backed up to ${backup}`);
  } catch (err) {
    console.warn('Could not rename legacy settings file:', err);
  }
}

/**
 * Best-effort lookup of the user's last-active server so we know which
 * per-server file to write reminders/triggers into.
 */
function readCurrentServer(appSettingsPath: string): string | undefined {
  if (!fs.existsSync(appSettingsPath)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(appSettingsPath, 'utf8'));
    return typeof data?.server === 'string' ? data.server : undefined;
  } catch {
    return undefined;
  }
}
