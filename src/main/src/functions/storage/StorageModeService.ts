import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { DROPBOX_APP_KEY, DropboxHttp } from './DropboxHttp';
import { devicePath, isPortableFile, selectPortableRoot } from './portablePaths';
import { PROFILES_VERSION } from '../../../../common/profiles';
import { PortableWrites, portableWrites, setPortableWrites, type WriteStatus } from './PortableWrites';
import { activatePortableMemory, clearPortableMemory, portableMemoryFiles } from './portableFs';

export type StorageMode = 'local' | 'dropbox';
export type DropboxCredentials = { refreshToken: string; accountId: string; email?: string; name?: string };
export type DropboxAccounts = { accounts: DropboxCredentials[] };
export type DropboxAccount = { id: string; email?: string; name?: string };
export type TransferResult = { direction: 'toDropbox' | 'toDevice'; written: number; removed: number };
export type StorageStatus = { mode: StorageMode; connected: boolean; account?: DropboxAccount; accounts: DropboxAccount[]; writes?: WriteStatus; startupState: 'idle' | 'loading' | 'ready' | 'error'; startupError?: string };

export function parseDropboxAccounts(value: unknown): DropboxAccounts {
  const entries = Array.isArray((value as DropboxAccounts)?.accounts) ? (value as DropboxAccounts).accounts : [value];
  if (!entries.every((entry) => entry && typeof entry.refreshToken === 'string' && typeof entry.accountId === 'string'))
    throw new Error('Dropbox credentials are invalid.');
  return { accounts: entries };
}

export interface DropboxCredentialStore {
  read(): Promise<DropboxAccounts>;
  write(credentials: DropboxAccounts): Promise<void>;
}

/** Local credential store for CLI and desktop. Mobile injects its own store. */
export class FileDropboxCredentialStore implements DropboxCredentialStore {
  constructor(private readonly file: string) {}

  async read(): Promise<DropboxAccounts> {
    try {
      return parseDropboxAccounts(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { accounts: [] };
      throw error;
    }
  }

  async write(credentials: DropboxAccounts): Promise<void> {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(credentials), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

}

export class StorageModeService {
  private readonly configPath: string;
  private readonly memoryRoot: string;
  private readonly deviceRoot: string;
  private startupState: StorageStatus['startupState'] = 'idle';
  private startupError?: string;

  constructor(private readonly api: DropboxHttp, private readonly credentialStore: DropboxCredentialStore, deviceRoot = devicePath(), private readonly onWriteStatus?: (status: WriteStatus) => void) {
    this.deviceRoot = deviceRoot;
    this.configPath = path.join(deviceRoot, 'storage-mode.json');
    // This is a virtual path used by memfs; it is never created on disk.
    this.memoryRoot = path.join(deviceRoot, '.dropbox-memory');
  }

  async status(): Promise<StorageStatus> {
    const { accounts } = await this.credentialStore.read();
    const selected = this.selectedAccount(accounts);
    const publicAccount = (value: DropboxCredentials): DropboxAccount => ({ id: value.accountId, email: value.email, name: value.name });
    return {
      mode: this.mode(),
      connected: accounts.length > 0,
      account: selected ? publicAccount(selected) : undefined,
      accounts: accounts.map(publicAccount),
      startupState: this.startupState,
      startupError: this.startupError,
      ...(this.mode() === 'dropbox' ? { writes: portableWrites()?.status() } : {}),
    };
  }

  mode(): StorageMode {
    return this.config().mode;
  }

  private config(): { mode: StorageMode; accountId?: string } {
    try {
      const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as { mode?: unknown; accountId?: unknown };
      if (data.mode === 'local' || data.mode === 'dropbox')
        return { mode: data.mode, accountId: typeof data.accountId === 'string' ? data.accountId : undefined };
      throw new Error('Storage mode configuration is invalid.');
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { mode: 'local' };
      throw error;
    }
  }

  private selectedAccount(accounts: DropboxCredentials[], id = this.config().accountId): DropboxCredentials | undefined {
    return id ? accounts.find((account) => account.accountId === id) : accounts[0];
  }

  beginLogin(): { url: string; verifier: string } {
    return this.api.beginLogin();
  }

  async completeLogin(code: string, verifier: string): Promise<StorageStatus> {
    const refreshToken = await this.api.exchangeCode(code.trim(), verifier);
    const accessToken = await this.api.accessToken(refreshToken);
    const account = await this.api.account(accessToken);
    if (!account.account_id) throw new Error('Dropbox account identity was unavailable.');
    const credentials = await this.credentialStore.read();
    const next = {
      refreshToken,
      accountId: account.account_id,
      email: account.email,
      name: account.name?.display_name,
    };
    const existing = credentials.accounts.findIndex((item) => item.accountId === next.accountId);
    const accounts = [...credentials.accounts];
    if (existing === -1) accounts.push(next);
    else accounts[existing] = next;
    await this.credentialStore.write({ accounts });
    return this.status();
  }

  async select(mode: StorageMode, accountId?: string): Promise<void> {
    const selectedId = accountId ?? this.config().accountId;
    if (mode === 'dropbox') {
      const account = this.selectedAccount((await this.credentialStore.read()).accounts, selectedId);
      if (!account) throw new Error('Select a connected Dropbox account.');
      await this.readFresh(account);
      this.write(this.configPath, { mode, accountId: account.accountId });
      return;
    }
    this.write(this.configPath, { mode, accountId: selectedId });
  }

  async disconnect(accountId?: string): Promise<void> {
    // Disconnect this installation only; never delete its App Folder data.
    const { accounts } = await this.credentialStore.read();
    const target = accountId ?? this.selectedAccount(accounts)?.accountId;
    if (!target) return;
    if (this.mode() === 'dropbox' && this.selectedAccount(accounts)?.accountId === target)
      throw new Error('Switch to Local or another Dropbox account before disconnecting this account.');
    const remaining = accounts.filter((account) => account.accountId !== target);
    await this.credentialStore.write({ accounts: remaining });
    if (this.config().accountId === target)
      this.write(this.configPath, { mode: 'local', accountId: remaining[0]?.accountId });
  }

  /**
   * Copy one store over the other. Only the inactive store is ever overwritten:
   * with Device active this pushes to Dropbox, with Dropbox active it pulls to the device.
   */
  async transfer(accountId?: string): Promise<TransferResult> {
    const toDropbox = this.mode() === 'local';
    const credentials = this.selectedAccount((await this.credentialStore.read()).accounts, accountId ?? this.config().accountId);
    if (!credentials) throw new Error('Select a connected Dropbox account.');
    const remote = await this.readFresh(credentials);
    const local = this.deviceFiles();
    const [source, target] = toDropbox ? [local, remote] : [remote, local];
    for (const [name, bytes] of source) this.validateFile(name, bytes);
    const changed = [...source].filter(([name, bytes]) => !target.get(name)?.equals(bytes));
    const removed = [...target.keys()].filter((name) => !source.has(name));
    if (toDropbox) {
      const token = await this.api.accessToken(credentials.refreshToken);
      for (const [name, bytes] of changed) await this.api.upload(token, name, bytes);
      for (const name of removed) await this.api.delete(token, name);
    } else {
      for (const [name, bytes] of changed) this.writeBytes(path.join(this.deviceRoot, name), bytes);
      for (const name of removed) fs.rmSync(path.join(this.deviceRoot, name), { force: true });
    }
    return { direction: toDropbox ? 'toDropbox' : 'toDevice', written: changed.length, removed: removed.length };
  }

  private deviceFiles(): Map<string, Buffer> {
    const result = new Map<string, Buffer>();
    const walk = (relative: string) => {
      const file = path.join(this.deviceRoot, relative);
      if (!fs.existsSync(file)) return;
      if (fs.statSync(file).isDirectory()) fs.readdirSync(file).forEach((child) => walk(`${relative}/${child}`));
      else if (isPortableFile(relative)) result.set(relative, fs.readFileSync(file));
    };
    ['shared.json', 'appSettings', 'profiles.json', 'stats.json', 'plugin-security', 'serverSettings', 'profileScripts', 'macros'].forEach(walk);
    return result;
  }

  private writeBytes(file: string, bytes: Buffer): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, file);
  }

  /** Download before any Settings or other portable file owner constructs. */
  async prepareStartup(): Promise<string | undefined> {
    this.startupState = 'loading';
    this.startupError = undefined;
    try {
      setPortableWrites();
      clearPortableMemory();
      if (this.mode() === 'local') {
        selectPortableRoot();
        this.startupState = 'ready';
        return undefined;
      }
      const files = await this.readFresh();
      const sessionAccountId = this.selectedAccount((await this.credentialStore.read()).accounts)?.accountId;
      if (!sessionAccountId) throw new Error('Dropbox is disconnected.');
      activatePortableMemory(this.memoryRoot, files);
      selectPortableRoot(this.memoryRoot);
      setPortableWrites(new PortableWrites(this.api, async () => {
        const credentials = (await this.credentialStore.read()).accounts.find((account) => account.accountId === sessionAccountId);
        if (!credentials) throw new Error('Dropbox is disconnected.');
        return this.api.accessToken(credentials.refreshToken);
      }, 5000, this.onWriteStatus));
      this.startupState = 'ready';
      return this.memoryRoot;
    } catch (error) {
      this.startupState = 'error';
      this.startupError = error instanceof Error ? error.message : 'Dropbox startup failed.';
      throw error;
    }
  }

  async flush(): Promise<WriteStatus | undefined> {
    return portableWrites()?.flush();
  }

  async close(): Promise<WriteStatus | undefined> {
    try {
      return await this.flush();
    } finally {
      setPortableWrites();
      clearPortableMemory();
    }
  }

  /** Compare a fresh Dropbox read with this session after pending writes finish. */
  async refreshNeeded(): Promise<boolean> {
    if (this.mode() !== 'dropbox') return false;
    const before = portableMemoryFiles();
    const after = await this.readFresh();
    return before.size !== after.size || [...after].some(([name, bytes]) => !before.get(name)?.equals(bytes));
  }

  private async readFresh(credentials?: DropboxCredentials): Promise<Map<string, Buffer>> {
    credentials ??= this.selectedAccount((await this.credentialStore.read()).accounts);
    if (!credentials) throw new Error('Dropbox is not connected. Run `jnbot storage login`, or select Local.');
    try {
      const token = await this.api.accessToken(credentials.refreshToken);
      const archive = await this.api.downloadZip(token);
      const result = new Map<string, Buffer>();
      if (!archive) return result;
      for (const entry of new AdmZip(archive).getEntries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName;
        const relative = name.toLowerCase().startsWith('jnbot/') ? name.slice('JNbot/'.length) : name;
        // Older builds uploaded recordings. Leave those remote copies untouched.
        if (/^recordings\/[^/]+\.(json|log)$/.test(relative)) continue;
        if (!isPortableFile(relative)) throw new Error('Dropbox contains an unsupported JNbot file. Update JNbot before opening it.');
        const bytes = entry.getData();
        this.validateFile(relative, bytes);
        result.set(relative, bytes);
      }
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Dropbox read failed.';
      throw new Error(`${reason} Retry the command, or run \`jnbot storage select local\`.`, { cause: error });
    }
  }

  private validateFile(relative: string, bytes: Buffer): void {
    if (!relative.endsWith('.json') && relative !== 'appSettings') return;
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      if (relative === 'shared.json' && typeof parsed.version === 'number' && parsed.version > 3) throw new Error();
      if (relative === 'shared.json' && (!Array.isArray(parsed.alts) || !Array.isArray(parsed.devices))) throw new Error();
      if (relative === 'profiles.json' && !Array.isArray(parsed.profiles)) throw new Error();
      if (relative === 'profiles.json' && typeof parsed.version === 'number' && parsed.version > PROFILES_VERSION) throw new Error();
      if (relative.startsWith('serverSettings/') && typeof parsed.version === 'number' && parsed.version > 3) throw new Error();
      if (relative === 'stats.json' && (!parsed.alts || !parsed.scripts)) throw new Error();
    } catch {
      throw new Error('Dropbox contains invalid or incompatible JNbot data. Update JNbot before opening it.');
    }
  }

  private write(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
}

export function createCliStorageModeService(): StorageModeService {
  return new StorageModeService(
    new DropboxHttp(DROPBOX_APP_KEY),
    new FileDropboxCredentialStore(devicePath('dropbox-credentials.json')),
  );
}
