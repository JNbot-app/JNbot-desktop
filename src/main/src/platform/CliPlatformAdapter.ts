import { writeFile } from 'fs/promises';
import path from 'path';
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

export class CliPlatformAdapter implements PlatformAdapter {
  public readonly platform = 'cli' as const;

  async openFile(_options?: OpenFileOptions): Promise<OpenFileResult> {
    // In CLI mode, if explicit file paths are not supplied, return canceled.
    return { canceled: true, files: [] };
  }

  async saveFile(options: SaveFileOptions): Promise<SaveFileResult> {
    const filename = options.defaultName || 'backup.json';
    const targetPath = path.resolve(process.cwd(), filename);
    try {
      await writeFile(targetPath, options.content, 'utf8');
      console.log('[CLI] Saved file to:', targetPath);
      return { canceled: false, path: targetPath };
    } catch (err) {
      console.error('[CLI] saveFile error:', err);
      return { canceled: true };
    }
  }

  async selectDirectory(options?: SelectDirectoryOptions): Promise<SelectDirectoryResult> {
    return { canceled: false, path: options?.defaultPath || process.cwd() };
  }

  async confirmPrompt(options: ConfirmPromptOptions): Promise<boolean> {
    console.log('[CLI Prompt] ' + options.title + ': ' + options.message);
    return true;
  }

  async openExternal(url: string): Promise<boolean> {
    console.log('[CLI] External URL:', url);
    return true;
  }
}
