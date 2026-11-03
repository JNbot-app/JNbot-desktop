export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenFileOptions {
  title?: string;
  filters?: FileFilter[];
  multiple?: boolean;
}

export interface SelectedFile {
  name: string;
  content: string;
  path?: string;
  size?: number;
}

export interface OpenFileResult {
  canceled: boolean;
  files: SelectedFile[];
}

export interface SaveFileOptions {
  title?: string;
  defaultName?: string;
  filters?: FileFilter[];
  content: string;
}

export interface SaveFileResult {
  canceled: boolean;
  path?: string;
}

export interface SelectDirectoryOptions {
  title?: string;
  defaultPath?: string;
}

export interface SelectDirectoryResult {
  canceled: boolean;
  path?: string;
}

export interface ConfirmPromptOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: 'info' | 'warning' | 'error';
}

export interface PlatformAdapter {
  readonly platform: 'desktop' | 'mobile' | 'web' | 'cli';
  openFile(options?: OpenFileOptions): Promise<OpenFileResult>;
  saveFile(options: SaveFileOptions): Promise<SaveFileResult>;
  selectDirectory(options?: SelectDirectoryOptions): Promise<SelectDirectoryResult>;
  confirmPrompt(options: ConfirmPromptOptions): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
}
