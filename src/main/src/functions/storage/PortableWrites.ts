import path from 'path';
import { isPortableFile, portableRoot } from './portablePaths';
import fs, { setPortableMutationHandler } from './portableFs';

export type WriteStatus = {
  saving: boolean;
  lastSavedAt?: number;
  lastError?: string;
};
type Remote = {
  upload(token: string, relative: string, bytes: Buffer): Promise<void>;
  delete(token: string, relative: string): Promise<void>;
};

let active: PortableWrites | undefined;

/** Called only after an owned file write, rename, or delete completes. */
export function portableFileChanged(file: string): void {
  active?.changed(file);
}

export function portableWrites(): PortableWrites | undefined {
  return active;
}
export function setPortableWrites(writes?: PortableWrites): void {
  active?.close();
  active = writes;
  setPortableMutationHandler(writes ? (file) => writes.changed(file) : undefined);
}

export class PortableWrites {
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly changedDuring = new Set<string>();
  private readonly failures = new Map<string, string>();
  private uploadChain: Promise<void> = Promise.resolve();
  private state: WriteStatus = { saving: false };

  constructor(
    private readonly remote: Remote,
    private readonly token: () => Promise<string>,
    private readonly delay = 5000,
    private readonly onStatus?: (status: WriteStatus) => void,
  ) {}

  status(): WriteStatus {
    return { ...this.state };
  }

  changed(file: string): void {
    const relative = path.relative(portableRoot(), file).replaceAll('\\', '/');
    if (!isPortableFile(relative)) return;
    const old = this.pending.get(relative);
    if (old) clearTimeout(old);
    this.pending.set(
      relative,
      setTimeout(() => {
        this.pending.delete(relative);
        this.send(relative);
      }, this.delay),
    );
  }

  private send(relative: string): void {
    if (this.running.has(relative)) {
      this.changedDuring.add(relative);
      return;
    }
    // Dropbox can rate limit concurrent writes to the same account/folder.
    const task = this.uploadChain.then(() => this.upload(relative));
    this.uploadChain = task;
    this.running.set(relative, task);
    this.emit({ saving: true });
    void task.finally(() => {
      this.running.delete(relative);
      this.emit({ saving: this.running.size > 0 });
      if (this.changedDuring.delete(relative))
        this.changed(path.join(portableRoot(), relative));
    });
  }

  private async upload(relative: string): Promise<void> {
    try {
      const token = await this.token();
      const file = path.join(portableRoot(), relative);
      if (fs.existsSync(file)) {
        if (fs.lstatSync(file).isSymbolicLink())
          throw new Error('Portable file is a symbolic link.');
        await this.remote.upload(token, relative, Buffer.from(fs.readFileSync(file)));
      } else await this.remote.delete(token, relative);
      this.failures.delete(relative);
      this.emit({
        lastSavedAt: Date.now(),
        lastError: [...this.failures.values()][0],
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Dropbox save failed.';
      const failure = `Dropbox save failed: ${message}`;
      const alreadyReported = [...this.failures.values()].includes(failure);
      this.failures.set(relative, failure);
      this.emit({ lastError: [...this.failures.values()][0] });
      if (!alreadyReported) console.error(`[Dropbox] ${failure}`);
    }
  }

  /** Send all scheduled writes and await uploads already in flight. */
  async flush(): Promise<WriteStatus> {
    while (this.pending.size || this.running.size || this.changedDuring.size) {
      const queued = [...this.pending.keys()];
      for (const timer of this.pending.values()) clearTimeout(timer);
      this.pending.clear();
      queued.forEach((relative) => this.send(relative));
      if (this.running.size) await Promise.all([...this.running.values()]);
    }
    return this.status();
  }

  close(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  private emit(change: Partial<WriteStatus>): void {
    this.state = { ...this.state, ...change };
    this.onStatus?.(this.status());
  }
}
