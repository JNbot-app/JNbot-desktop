import { dialog } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { openWebUrl } from '../../util';
import showDialog from '../functions/actions/dialog';
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

export class DesktopPlatformAdapter implements PlatformAdapter {
  public readonly platform = 'desktop' as const;

  async openFile(options: OpenFileOptions = {}): Promise<OpenFileResult> {
    try {
      const properties: Array<'openFile' | 'multiSelections'> = ['openFile'];
      if (options.multiple) properties.push('multiSelections');

      const result = await dialog.showOpenDialog({
        title: options.title,
        filters: options.filters,
        properties,
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true, files: [] };
      }

      const files = await Promise.all(
        result.filePaths.map(async (filePath) => {
          const content = await readFile(filePath, 'utf8');
          const name = path.basename(filePath);
          return {
            name,
            content,
            path: filePath,
          };
        }),
      );

      return { canceled: false, files };
    } catch (err) {
      console.error('[DesktopPlatformAdapter] openFile error:', err);
      return { canceled: true, files: [] };
    }
  }

  async saveFile(options: SaveFileOptions): Promise<SaveFileResult> {
    try {
      const result = await dialog.showSaveDialog({
        title: options.title,
        defaultPath: options.defaultName,
        filters: options.filters,
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      await writeFile(result.filePath, options.content, 'utf8');
      return { canceled: false, path: result.filePath };
    } catch (err) {
      console.error('[DesktopPlatformAdapter] saveFile error:', err);
      return { canceled: true };
    }
  }

  async selectDirectory(options: SelectDirectoryOptions = {}): Promise<SelectDirectoryResult> {
    try {
      const result = await dialog.showOpenDialog({
        title: options.title,
        defaultPath: options.defaultPath,
        properties: ['openDirectory'],
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }

      return { canceled: false, path: result.filePaths[0] };
    } catch (err) {
      console.error('[DesktopPlatformAdapter] selectDirectory error:', err);
      return { canceled: true };
    }
  }

  async confirmPrompt(options: ConfirmPromptOptions): Promise<boolean> {
    try {
      const confirmLabel = options.confirmLabel ?? 'Confirm';
      const cancelLabel = options.cancelLabel ?? 'Cancel';
      const isDanger = options.type === 'warning' || options.type === 'error';
      const response = await showDialog({
        title: options.title,
        body: options.message,
        buttons: [
          {
            label: cancelLabel,
            type: 'default',
          },
          {
            label: confirmLabel,
            type: 'primary',
            danger: isDanger,
          },
        ],
      });
      return response === confirmLabel;
    } catch (err) {
      console.error('[DesktopPlatformAdapter] confirmPrompt error:', err);
      return false;
    }
  }

  openExternal(url: string): Promise<boolean> {
    return openWebUrl(url);
  }
}
