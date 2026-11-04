import { Command } from 'commander';
import { DEFAULT_REMOTE_PERMISSIONS } from '../../common/clientPermissions';
import packageJson from '../../../release/app/package.json';
import {
  actions,
  addAlt,
  createRemoteDevice,
  deleteAlt,
  exportProfile,
  fail,
  getBotChat,
  getBotInventory,
  getBotState,
  importPlugins,
  importProfile,
  installMarketplaceProfile,
  joinBot,
  listAlts,
  listCooldowns,
  listMarketplaceProfiles,
  ok,
  pluginOptions,
  remoteAccessUrl,
  remoteDevices,
  removeCooldown,
  resetCooldown,
  runPlugin,
  runScript,
  sendBotChat,
  setPluginOption,
  setScriptCooldown,
  settingGet,
  settingSet,
  startRemote,
  toggleCooldownAutoStart,
  useProfile,
} from './actions';
import { OutputRouter, redact } from './output';
import { createCliRuntime } from './runtime';
import type { CliResult, CliRuntime } from './types';
import { pluginSecurity } from '../../main/src/functions/signing';
import { createCliStorageModeService } from '../../main/src/functions/storage/StorageModeService';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';

type Options = { json?: boolean; quiet?: boolean; verbose?: boolean; color?: boolean };

const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => undefined); // The URL remains printed for manual opening.
  child.unref();
}

function canPrintQr(qrCode: string, precedingLines: number): boolean {
  const columns = process.stdout.columns;
  const rows = process.stdout.rows;
  if (!columns || !rows) return false;

  const qrLines = qrCode.split('\n');
  const qrWidth = Math.max(
    ...qrLines.map((line) => line.replace(ANSI_ESCAPE, '').length),
  );
  return columns >= qrWidth && rows >= precedingLines + qrLines.length + 1;
}

export interface EmbeddedCommandSession {
  runtime: CliRuntime;
  onResult(result: CliResult): void;
  onOutput(text: string): void;
}

function print(result: CliResult, options: Options): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.ok) {
    if (!options.quiet && result.data !== undefined) {
      if (
        typeof result.data === 'object' &&
        result.data !== null &&
        ('mobileQr' in result.data || 'qr' in result.data)
      ) {
        const data = result.data as Record<string, any>;
        const lines: string[] = [];
        lines.push('Remote Access:');
        if (data.device || data.name) lines.push(`  Device:     ${data.device ?? data.name}`);
        if (data.room) lines.push(`  Room:       ${data.room}`);
        if (data.mobileUrl) lines.push(`  Mobile URL: ${data.mobileUrl}`);
        if (data.url) lines.push(`  Web URL:    ${data.url}`);
        const qrCode = data.mobileQr || data.qr;
        if (qrCode) {
          lines.push('');
          lines.push('Mobile QR Code (scan with JNbot Mobile or camera):');
          if (canPrintQr(qrCode, lines.length)) {
            lines.push(qrCode);
          } else {
            const qrWidth = qrCode
              .split('\n')[0]
              .replace(ANSI_ESCAPE, '').length;
            const qrHeight = qrCode.split('\n').length;
            lines.push(
              `QR omitted: it needs at least ${qrWidth} columns and ${qrHeight + lines.length + 1} rows to scan reliably.`,
            );
          }
        }
        process.stdout.write(`${lines.join('\n')}\n`);
        return;
      }
      process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
    }
  } else {
    process.stderr.write(`Error: ${redact(result.error ?? 'Operation failed')}\n`);
  }
}

async function withRuntime(
  options: Options,
  callback: (runtime: CliRuntime) => Promise<CliResult>,
): Promise<void> {
  const output = new OutputRouter();
  const headless = !process.stdin.isTTY || !process.stdout.isTTY;
  if (headless) {
    output.on('event', (event) => {
      if (event.severity === 'debug' && !options.verbose) return;
      process.stderr.write(`${new Date(event.timestamp).toISOString()} ${event.severity.toUpperCase()} ${redact(event.message)}\n`);
    });
  }
  output.install();
  let runtime: CliRuntime | undefined;
  try {
    runtime = await createCliRuntime();
    const result = await callback(runtime);
    print(result, options);
    if (!result.ok) process.exitCode = result.code ?? 1;
  } catch (error) {
    print({ ok: false, error: error instanceof Error ? (error.stack || error.message) : String(error) }, options);
    process.exitCode = 1;
  } finally {
    await runtime?.close();
    output.restore();
  }
}

async function foreground(
  options: Options,
  callback: (runtime: CliRuntime) => Promise<CliResult>,
): Promise<void> {
  const output = new OutputRouter();
  output.on('event', (event) => {
    if (event.severity === 'debug' && !options.verbose) return;
    process.stderr.write(`${new Date(event.timestamp).toISOString()} ${event.severity.toUpperCase()} ${redact(event.message)}\n`);
  });
  output.install();
  const runtime = await createCliRuntime();
  const keepAlive = setInterval(() => undefined, 60_000);
  const seenLogs = new WeakSet<object>();
  for (const log of runtime.handler.getBootstrapRuntime().consoleHandler.getAllLogs())
    seenLogs.add(log);
  const logStream = setInterval(() => {
    for (const log of runtime.handler.getBootstrapRuntime().consoleHandler.getAllLogs()) {
      if (seenLogs.has(log)) continue;
      seenLogs.add(log);
      output.pushScriptLog(log);
    }
  }, 250);
  let closing = false;
  const close = async (code = 0) => {
    if (closing) return;
    closing = true;
    await runtime.close();
    clearInterval(keepAlive);
    clearInterval(logStream);
    output.restore();
    process.exitCode = code;
  };
  process.once('SIGINT', () => void close(130));
  process.once('SIGTERM', () => void close(130));
  try {
    const result = await callback(runtime);
    print(result, options);
    if (!result.ok) return close(result.code ?? 1);
    await new Promise<void>(() => undefined);
  } catch (error) {
    print({ ok: false, error: error instanceof Error ? (error.stack || error.message) : String(error) }, options);
    await close(1);
  }
}

export function createProgram(session?: EmbeddedCommandSession): Command {
  const program = new Command();
  program
    .name('jnbot')
    .description('JNbot terminal dashboard and automation CLI')
    .version(packageJson.version)
    .option('--json', 'write a machine-readable result to stdout')
    .option('--no-color', 'disable terminal colors')
    .option('--quiet', 'hide successful human output')
    .option('--verbose', 'include debug logs');
  const globalOptions = (): Options => program.opts() as Options;
  const run = (callback: (runtime: CliRuntime) => Promise<CliResult>) => {
    if (!session) return withRuntime(globalOptions(), callback);
    return callback(session.runtime)
      .then(session.onResult)
      .catch((error) => session.onResult({ ok: false, error: error instanceof Error ? (error.stack || error.message) : String(error) }));
  };
  const runForeground = (callback: (runtime: CliRuntime) => Promise<CliResult>) =>
    session ? run(callback) : foreground(globalOptions(), callback);
  const runStorage = async (callback: () => Promise<CliResult>): Promise<void> => {
    try {
      const result = await callback();
      if (session) session.onResult(result);
      else print(result, globalOptions());
      if (!session && !result.ok) process.exitCode = result.code ?? 1;
    } catch (error) {
      const result = fail(error instanceof Error ? error.message : 'Storage operation failed.');
      if (session) session.onResult(result);
      else {
        print(result, globalOptions());
        process.exitCode = 1;
      }
    }
  };
  if (session) program.configureOutput({
    writeOut: session.onOutput,
    writeErr: session.onOutput,
  });

  program.command('status').description('Show the active profile and runtime status').action(() =>
    run((runtime) => actions.snapshot.execute(runtime)));

  program.command('serve')
    .description('Run JNbot headlessly until interrupted')
    .option('--profile <id>', 'select a profile for this session')
    .option('--remote-access', 'start remote access')
    .action(async (options) => runForeground(async (runtime) => {
      if (options.profile) {
        const selected = await useProfile(runtime, options.profile);
        if (!selected.ok) return selected;
      }
      return options.remoteAccess ? startRemote(runtime) : ok({ status: 'running' });
    }));

  const profile = program.command('profile').description('Manage profiles');
  profile.command('current').action(() => run(async (runtime) =>
    ok({ profile: runtime.handler.getBootstrapRuntime().profileKey })));
  profile.command('list').action(() => run((runtime) => actions.profiles.execute(runtime)));
  profile.command('marketplace').description('List available marketplace profiles').action(() =>
    run((runtime) => listMarketplaceProfiles(runtime)));
  profile.command('install <id>').description('Install a profile from the marketplace').action((id) =>
    run((runtime) => installMarketplaceProfile(runtime, id)));
  profile.command('use <id>').action((id) => run((runtime) => useProfile(runtime, id)));
  profile.command('import <file>').option('--trust-unverified', 'allow unverified profile scripts').action((file, options) =>
    run((runtime) => importProfile(runtime, file, Boolean(options.trustUnverified))));
  profile.command('export <id> <file>').action((id, file) =>
    run((runtime) => exportProfile(runtime, id, file)));

  const settings = program.command('settings').description('Read or update the active profile settings');
  settings.command('get [path]').action((settingPathOrCommand) => {
    const settingPath = typeof settingPathOrCommand === 'string' ? settingPathOrCommand : undefined;
    return run((runtime) => settingGet(runtime, settingPath));
  });
  settings.command('set <path> <jsonValue>').action((settingPath, value) => run((runtime) => settingSet(runtime, settingPath, value)));

  const script = program.command('script').description('Run built-in scripts');
  script.command('list').action(() => run((runtime) => actions.scripts.execute(runtime)));
  script.command('run <name>').option('--options <json>', 'script options as JSON').action((name, options) =>
    runForeground((runtime) => runScript(runtime, name, options.options)));

  const plugin = program.command('plugin').description('Manage plugins');
  plugin.command('list').action(() => run((runtime) => actions.plugins.execute(runtime)));
  plugin.command('run <idOrName>').action((idOrName) => runForeground((runtime) => runPlugin(runtime, idOrName)));
  plugin.command('options <idOrName>').description('Show saved plugin options').action((idOrName) =>
    run(async (runtime) => pluginOptions(runtime, idOrName)));
  plugin.command('options-set <idOrName> <option> <jsonValue>').description('Update one plugin option').action((idOrName, option, value) =>
    run(async (runtime) => setPluginOption(runtime, idOrName, option, value)));
  plugin.command('import <files...>')
    .option('--overwrite', 'replace existing plugins')
    .option('--keep-both', 'keep an existing plugin and import another copy')
    .option('--trust-unverified', 'allow an unsigned plugin')
    .action((files, options) => run((runtime) => importPlugins(runtime, files, options)));
  plugin.command('export <id> <file>').action((id, file) => run(async (runtime) => {
    try {
      runtime.handler.macros.exportToPath(id, file);
      return ok({ file });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'PUBLISHER_NAME_REQUIRED') {
        throw error;
      }
      return fail(
        'A publisher name is needed to sign exported content. Run `jnbot publisher set <name>` first.',
        2,
      );
    }
  }));

  const publisher = program.command('publisher').description('Manage the local publisher identity');
  publisher.command('set <name>').action((name) => run(async () =>
    ok(pluginSecurity().setPublisherName(name))));

  const bot = program.command('bot').description('Manage active bot sessions');
  bot.command('join <username>').option('--version <version>', 'Minecraft protocol version').action((username, options) =>
    runForeground((runtime) => joinBot(runtime, username, options.version)));
  bot.command('list').action(() => run(async (runtime) =>
    ok(Object.values(runtime.handler.getBootstrapRuntime().activeBots.bots).map((b) => b.toObject()))));
  bot.command('status [idOrName]').action((idOrName) => run(async (runtime) => getBotState(runtime, idOrName ?? 0)));
  bot.command('chat [idOrName] [message]').action((idOrName, message) => run(async (runtime) => {
    if (message) return sendBotChat(runtime, idOrName ?? 0, message);
    return getBotChat(runtime, idOrName ?? 0);
  }));
  bot.command('inventory [idOrName]').action((idOrName) => run(async (runtime) => getBotInventory(runtime, idOrName ?? 0)));

  const alt = program.command('alt').description('Manage alts in the active profile');
  alt.command('list').action(() => run(async (runtime) => listAlts(runtime)));
  alt.command('add <username>')
    .option('--premium', 'mark the alt as premium')
    .option('--email <email>', 'set the account email')
    .option('--password <password>', 'set the server password for cracked accounts')
    .action((username, options) => run(async (runtime) => addAlt(runtime, username, options)));
  alt.command('remove <username>').requiredOption('--yes', 'confirm removal from this profile').action((username) =>
    run(async (runtime) => deleteAlt(runtime, username)));

  const cooldown = program.command('cooldown').description('Manage recurring script execution intervals and cooldowns');
  cooldown.command('list').action(() => run(async (runtime) => listCooldowns(runtime)));
  cooldown.command('add <pluginId> <interval>')
    .description('Add a cooldown (interval in ms or format like 5m, 1h)')
    .option('--no-auto-start', 'do not automatically run the script when ready')
    .action((pluginId, interval, options) => run(async (runtime) => {
      let ms = Number(interval);
      if (isNaN(ms)) {
        const match = /^(\d+)(s|m|h|d)?$/i.exec(interval.trim());
        if (match) {
          const num = parseInt(match[1], 10);
          const unit = (match[2] || 'm').toLowerCase();
          ms = unit === 's' ? num * 1000 : unit === 'h' ? num * 3600000 : unit === 'd' ? num * 86400000 : num * 60000;
        } else {
          return fail('Invalid interval format. Use e.g. 5m, 1h, or milliseconds.', 2);
        }
      }
      return setScriptCooldown(runtime, pluginId, ms, options.autoStart !== false);
    }));
  cooldown.command('remove <idOrPluginId>').action((id) => run(async (runtime) => removeCooldown(runtime, id)));
  cooldown.command('toggle <idOrPluginId>').action((id) => run(async (runtime) => toggleCooldownAutoStart(runtime, id)));
  cooldown.command('reset <idOrPluginId>').action((id) => run(async (runtime) => resetCooldown(runtime, id)));

  const data = program.command('data').description('Export or restore all JNbot data');
  data.command('export <file>').action((file) => run(async (runtime) => {
    await runtime.handler.getCloudStorage().exportToPath(file);
    return ok({ file });
  }));
  data.command('import <file>').requiredOption('--yes', 'confirm replacing local JNbot data').action((file) => run(async (runtime) => {
    await runtime.handler.getCloudStorage().importFromPath(file);
    return ok({ file });
  }));

  const cloud = program.command('cloud').description('Manage encrypted JNbot Cloud backups');
  cloud.command('status').action(() => run(async (runtime) => {
    const storage = runtime.handler.getCloudStorage();
    return ok({ used: await storage.hasCloudData(), userId: storage.getUserId() });
  }));
  cloud.command('upload').option('--share-key <key>', 'use a supplied share key').action((options) => run(async (runtime) => ok(await runtime.handler.getCloudStorage().upload({ shareKey: options.shareKey }))));
  cloud.command('import').requiredOption('--user <id>', 'source user id').requiredOption('--share-key <key>', 'source share key').requiredOption('--yes', 'confirm replacing local JNbot data').action((options) => run(async (runtime) => {
    await runtime.handler.getCloudStorage().importSharedFromUser({ userId: options.user, shareKey: options.shareKey });
    return ok({ userId: options.user });
  }));
  cloud.command('delete').requiredOption('--yes', 'confirm deleting the cloud backup').action(() => run(async (runtime) => {
    await runtime.handler.getCloudStorage().deleteCloudData();
    return ok({ deleted: true });
  }));

  const storage = program.command('storage').description('Choose Local or Dropbox data storage');
  storage.command('status').action(() => runStorage(async () => ok(await createCliStorageModeService().status())));
  storage.command('login').option('--no-browser', 'show the authorization URL without opening a browser').action((options) => runStorage(async () => {
    const service = createCliStorageModeService();
    const { url, verifier } = service.beginLogin();
    if (session) throw new Error('Run Dropbox login in a terminal.');
    process.stdout.write(`Open this Dropbox authorization URL:\n${url}\n`);
    if (options.browser && process.stdin.isTTY) openBrowser(url);
    const input = createInterface({ input: process.stdin, output: process.stderr });
    let code: string;
    try {
      code = await input.question('Paste the Dropbox authorization code: ');
    } finally {
      input.close();
    }
    if (!code.trim()) return fail('Dropbox login was cancelled.');
    const result = await service.completeLogin(code, verifier);
    return ok({ ...result, next: 'Run `jnbot storage select dropbox --account <id>` to use this account.' });
  }));
  storage.command('select <mode>').option('--account <id>', 'Dropbox account ID from storage status').action((mode, options) => runStorage(async () => {
    if (mode !== 'local' && mode !== 'dropbox') return fail('Choose local or dropbox.', 2);
    await createCliStorageModeService().select(mode, options.account);
    return ok({ mode, next: 'Restart JNbot to open the selected store.' });
  }));
  storage.command('disconnect').option('--account <id>', 'Dropbox account ID from storage status').action((options) => runStorage(async () => {
    const service = createCliStorageModeService();
    await service.disconnect(options.account);
    return ok(await service.status());
  }));
  storage.command('transfer').description('Copy the active store over the inactive one (Device to Dropbox, or Dropbox to Device)').option('--account <id>', 'Dropbox account ID from storage status').action((options) => runStorage(async () => ok(await createCliStorageModeService().transfer(options.account))));
  storage.command('flush').action(() => run(async () => ok(await createCliStorageModeService().flush())));
  storage.command('reload').action(() => run(async () => ok({ refreshed: true, note: 'The selected store was loaded when this command started.' })));

  const remote = program.command('remote').description('Manage browser and mobile remote access');
  remote.command('start').option('--profile <id>', 'select a profile for this session').option('--device <id>', 'print an access link for this device').action((options) => runForeground(async (runtime) => {
    if (options.profile) {
      const selected = await useProfile(runtime, options.profile);
      if (!selected.ok) return selected;
    }
    return startRemote(runtime, options.device);
  }));
  remote.command('qr [id]').description('Show mobile QR code and access link for a device').action((id) => run(async (runtime) => {
    const devices = Object.values(runtime.handler.deviceHandler.getDevices());
    const targetId = id || devices[0]?.id;
    if (!targetId) return fail('No remote access device found. Create one with `jnbot remote devices add <name>`.', 2);
    return remoteAccessUrl(runtime, targetId);
  }));
  remote.command('url [id]').description('Show access links for a device').action((id) => run(async (runtime) => {
    const devices = Object.values(runtime.handler.deviceHandler.getDevices());
    const targetId = id || devices[0]?.id;
    if (!targetId) return fail('No remote access device found. Create one with `jnbot remote devices add <name>`.', 2);
    return remoteAccessUrl(runtime, targetId);
  }));
  const devices = remote.command('devices').description('Manage remote access devices');
  devices.command('list').action(() => run(remoteDevices));
  devices.command('add <name>').option('--profile <ids...>', 'grant profile access').action((name, options) => run(async (runtime) => {
    if (!options.profile) return createRemoteDevice(runtime, name);
    const device = runtime.handler.deviceHandler.createDevice(name, { profiles: options.profile, permissionMask: DEFAULT_REMOTE_PERMISSIONS, mcp: { tools: [] } } as never);
    return ok({ id: device.id, name: device.name });
  }));
  devices.command('remove <id>').requiredOption('--yes', 'confirm removal').action((id) => run(async (runtime) => {
    runtime.handler.deviceHandler.removeDevice(id);
    return ok({ id });
  }));
  devices.command('rotate-token <id>').requiredOption('--yes', 'confirm token rotation').action((id) => run(async (runtime) => {
    const token = runtime.handler.deviceHandler.rotateToken(id);
    return token ? ok({ id, token }) : fail(`Device "${id}" was not found.`, 2);
  }));

  program.action(async () => {
    if (session) {
      session.onOutput(program.helpInformation());
      return;
    }
    const options = globalOptions();
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      print({ ok: false, error: 'Interactive mode requires a TTY. Run `jnbot --help` for commands.', code: 2 }, options);
      process.exitCode = 2;
      return;
    }
    const output = new OutputRouter();
    output.install();
    let runtime: CliRuntime | undefined;
    try {
      runtime = await createCliRuntime();
      const { startTui } = await import('./ui');
      await startTui(runtime, output);
    } catch (error) {
      if (error instanceof Error) {
        process.stderr.write(`Error: ${error.stack || error.message}\n`);
      } else {
        process.stderr.write(`Error: ${String(error)}\n`);
      }
      process.exitCode = 1;
    } finally {
      await runtime?.close();
      output.restore();
    }
  });

  return program;
}
