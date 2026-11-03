import fs from './portableFs';
import nodePath from 'path';
import { portableFileChanged } from './PortableWrites';

interface Options<T> {
  beforeSave?: (o: T) => T;
  afterRead?: (o: T) => T;
  validate?: (o: T) => boolean;
}

class StorageModule<T> {
  storage: T;
  readonly path: string;
  readonly isNewUser: boolean;
  private closed = false;
  private needsSave = false;
  private timeout?: NodeJS.Timeout;
  private readonly options: Options<T>;

  constructor(
    storagePath: string,
    defaultStorage: () => T,
    options: Options<T> = {},
  ) {
    this.path = storagePath;
    this.options = options;
    this.isNewUser = !fs.existsSync(storagePath);
    if (this.isNewUser) {
      try {
        fs.mkdirSync(nodePath.dirname(storagePath), { recursive: true });
        fs.writeFileSync(storagePath, JSON.stringify(defaultStorage()), 'utf8');
        portableFileChanged(storagePath);
      } catch (err) {
        console.error('Failed to initialize storage file:', err);
      }
    }
    try {
      this.storage = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
    } catch (err) {
      this.storage = defaultStorage();
      console.error('Your storage file is corrupted', err);
    }

    if (options.validate && !options.validate(this.storage)) {
      this.storage = defaultStorage();
    }

    if (options.afterRead) this.storage = options.afterRead(this.storage);
  }

  save(): void {
    if (this.closed) return;

    if (this.options.validate && !this.options.validate(this.storage)) {
      console.error('Invalid file: ', this.storage);
    }
    const save = this.options.beforeSave
      ? this.options.beforeSave(this.storage)
      : this.storage;
    this.needsSave = false;
    if (save == null) return console.error('Invalid file: ', save);

    try {
      const content = JSON.stringify(save);
      fs.writeFileSync(this.path, content, 'utf8');
      portableFileChanged(this.path);
    } catch (err) {
      console.error('Error saving file: ', err);
      console.log('File content: ', save);
    }
  }

  get(): T {
    return this.storage;
  }

  set(obj: T) {
    this.storage = obj;
    this.requestSave();
  }

  requestSave(delay = 5000): void {
    if (this.closed) return;
    this.needsSave = true;
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.save(), delay);
  }

  close(): void {
    if (this.closed) return;

    clearTimeout(this.timeout);
    this.timeout = undefined;
    if (this.needsSave) this.save();
    this.closed = true;
  }
}

export default StorageModule;
