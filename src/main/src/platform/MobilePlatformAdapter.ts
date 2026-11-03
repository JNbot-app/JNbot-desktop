import type {
  ConfirmPromptOptions,
  OpenFileOptions,
  OpenFileResult,
  PlatformAdapter,
  SaveFileOptions,
  SaveFileResult,
  SelectDirectoryOptions,
  SelectDirectoryResult,
} from './PlatformAdapter';

export interface MobileBridgeDelegate {
  openFile(options?: OpenFileOptions): Promise<OpenFileResult>;
  saveFile(options: SaveFileOptions): Promise<SaveFileResult>;
  confirmPrompt(options: ConfirmPromptOptions): Promise<boolean>;
  openExternal?(url: string): Promise<boolean>;
}

export class MobilePlatformAdapter implements PlatformAdapter {
  public readonly platform = 'mobile' as const;
  private delegate: MobileBridgeDelegate | null = null;

  public setDelegate(delegate: MobileBridgeDelegate | null): void {
    this.delegate = delegate;
  }

  async openFile(options?: OpenFileOptions): Promise<OpenFileResult> {
    if (this.delegate) {
      return this.delegate.openFile(options);
    }
    return { canceled: true, files: [] };
  }

  async saveFile(options: SaveFileOptions): Promise<SaveFileResult> {
    if (this.delegate) {
      return this.delegate.saveFile(options);
    }
    return { canceled: true };
  }

  async selectDirectory(_options?: SelectDirectoryOptions): Promise<SelectDirectoryResult> {
    return { canceled: true };
  }

  async confirmPrompt(options: ConfirmPromptOptions): Promise<boolean> {
    if (this.delegate) {
      return this.delegate.confirmPrompt(options);
    }
    return false;
  }

  async openExternal(url: string): Promise<boolean> {
    if (this.delegate?.openExternal) {
      return this.delegate.openExternal(url);
    }
    return false;
  }
}
