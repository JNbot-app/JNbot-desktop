/**
 * End-to-end world for share tests: every `device()` is a real JNbot install
 * (own userData, publisher key, Settings, Macros and ShareService) and all of
 * them talk to the real Worker in `cloud/share`, running on the real
 * migrations through a small D1 shim. Only the network hop is replaced.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  defaultPluginAction,
  type ShareInstallInput,
  type SharePluginAction,
  type SharePreview,
  type ShareState,
} from '../../src/common/share';
import type ShareService from '../../src/main/src/functions/share/ShareService';
import { bootElectron, freshUserData } from './helpers';

const MIGRATIONS = path.join(__dirname, '../../cloud/share/migrations');
const functions = '../../src/main/src/functions';

/** The parts of D1 the Worker uses; a batch is one transaction, like on D1. */
function d1(database: any) {
  const statement = (sql: string, values: unknown[] = []) => ({
    sql,
    values,
    bind: (...next: unknown[]) => statement(sql, next),
    all: async () => ({ results: database.prepare(sql).all(...(values as [])) }),
    first: async (column?: string) => {
      const row = database.prepare(sql).get(...(values as [])) as Record<string, unknown> | undefined;
      if (!row) return null;
      return column ? row[column] : row;
    },
    run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...(values as [])).changes) } }),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Array<ReturnType<typeof statement>>) => {
      database.exec('BEGIN');
      try {
        for (const item of statements) await item.run();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export type Device = ReturnType<ShareWorld['device']>;

/** The decisions the review panel sends for a preview. */
export const decisionsFor = (preview: SharePreview, action?: SharePluginAction) =>
  preview.plugins.map((plugin) => ({
    ownerId: plugin.ownerId,
    pluginId: plugin.pluginId,
    revision: plugin.revision,
    action: action ?? defaultPluginAction(plugin),
    acceptUnverified: true,
  }));

export class ShareWorld {
  readonly database: any;

  /** `METHOD /path` of every request a device made. */
  readonly requests: string[] = [];

  private readonly official = crypto.generateKeyPairSync('ed25519');

  private readonly officialKey = this.official.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');

  private readonly inFlight = new Set<Promise<unknown>>();

  private readonly originalFetch = global.fetch;

  private clockOffset = 0;

  constructor() {
    const { DatabaseSync: Database } = require('node:sqlite');
    this.database = new Database(':memory:');
    for (const file of fs.readdirSync(MIGRATIONS).sort()) {
      this.database.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
    }
    const worker = require('../../cloud/share/src/index').default;
    const env = { DB: d1(this.database), OFFICIAL_PUBLIC_KEYS: this.officialKey };
    global.fetch = ((url: string, init?: RequestInit) => {
      const { pathname } = new URL(url);
      this.requests.push(`${init?.method ?? 'GET'} ${pathname}`);
      const response = worker.fetch(new Request(url, init), env) as Promise<Response>;
      this.inFlight.add(response);
      return response.finally(() => this.inFlight.delete(response));
    }) as typeof fetch;
    const now = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockImplementation(() => now() + this.clockOffset);
    (global as any).send = jest.fn();
    (global as any).broadcast = jest.fn();
    for (const level of ['log', 'info'] as const) jest.spyOn(console, level).mockImplementation(() => {});
  }

  close() {
    jest.restoreAllMocks();
    global.fetch = this.originalFetch;
    this.database.close();
  }

  /** Moves the clock of the devices and the Worker forward. */
  advance(ms: number) {
    this.clockOffset += ms;
  }

  /** Waits for background work: install counters and automatic updates. */
  async settled(...devices: Device[]) {
    await Promise.all(devices.map((device) => (device.shares as unknown as { updating?: Promise<void> }).updating));
    await Promise.all(this.inFlight);
  }

  /** One JNbot install. `dir` reopens an earlier device, as after a restart. */
  device(name: string, { reviewer = false, dir = freshUserData() } = {}) {
    if (reviewer) {
      fs.mkdirSync(path.join(dir, 'keys'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'keys', 'plugins.ed25519.private.pem'),
        this.official.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      );
    }
    bootElectron(dir);
    const signing = require(`${functions}/signing`);
    signing.OFFICIAL_ED25519_PUBLIC_KEYS.push(this.officialKey);
    const security = signing.pluginSecurity();
    if (!reviewer) security.setPublisherName(name);
    const Settings = require(`${functions}/Settings`).default;
    const Macros = require(`${functions}/Macros`).default;
    const ProfileTransfer = require(`${functions}/ProfileTransfer`).default;
    const Service = require(`${functions}/share/ShareService`).default;
    const ProfileScripts = require(`${functions}/ProfileScripts`).default;
    const settings = new Settings();
    const macros = new Macros({}, settings);
    settings.profiles.scripts = new ProfileScripts(macros);
    const published: ShareState[] = [];
    const shares: ShareService = new Service(
      { settings, macros, profileTransfer: new ProfileTransfer(settings) },
      (state: ShareState) => published.push(state),
    );

    const device = {
      name,
      dir,
      settings,
      macros,
      shares,
      security,
      /** Share state as the last `shares` broadcast reported it. */
      published,

      async writePlugin(pluginId: string, code: string, info: Record<string, unknown> = {}) {
        const result = await macros._importPlugin(
          macros.defaultPluginInfo({ pluginId, name: pluginId, language: 'js', ...info }),
          { code },
          'Overwrite',
          undefined,
          'allow-unverified',
        );
        expect(result.status).toBe('success');
        macros.invalidateLocalCache();
      },

      code: (pluginId: string): string | undefined => macros.readPlugin(pluginId)?.code,

      addProfile(id: string, name_ = id) {
        settings.profiles.upsert({
          id,
          predefined: false,
          createdAt: 1,
          updatedAt: 1,
          gamemodes: {},
          data: { id, name: name_, shortName: name_, defaultIp: 'play.example.com', defaultPort: 25565, gamemodes: [] },
        });
        return id;
      },

      /** Preview, then install the way the review panel does. */
      async install(link: string, input: Partial<ShareInstallInput> & { action?: SharePluginAction } = {}) {
        const { action, ...rest } = input;
        const preview = await shares.preview({ link, profileKey: input.profileKey });
        const result = await shares.install({ id: preview.id, decisions: decisionsFor(preview, action), ...rest });
        return { ...result, preview };
      },

      /** Approves the waiting revision of a share. */
      async approve(id: string) {
        const entry = (await shares.reviewQueue()).find((item) => item.id === id);
        await shares.review({ id, revision: entry!.revision, decision: 'approve' });
      },

      async reject(id: string, note: string) {
        const entry = (await shares.reviewQueue()).find((item) => item.id === id);
        await shares.review({ id, revision: entry!.revision, decision: 'reject', note });
      },

      /** Asks the server for the latest status, ignoring the daily throttle. */
      refresh() {
        world.advance(61 * 1000);
        return shares.checkUpdates(true);
      },
    };
    const world = this;
    return device;
  }

  /** A row of a table, for asserting what the Worker stored. */
  row(sql: string, ...values: Array<string | number>) {
    return this.database.prepare(sql).get(...values) as Record<string, any> | undefined;
  }

  run(sql: string, ...values: Array<string | number | Uint8Array>) {
    this.database.prepare(sql).run(...values);
  }
}
