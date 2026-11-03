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

export class WebPlatformAdapter implements PlatformAdapter {
  public readonly platform = 'web' as const;

  async openFile(options: OpenFileOptions = {}): Promise<OpenFileResult> {
    if (typeof window === 'undefined') {
      return { canceled: true, files: [] };
    }

    if ('showOpenFilePicker' in window) {
      try {
        const types = options.filters?.map((f) => ({
          description: f.name,
          accept: {
            'application/json': f.extensions.map((ext) => '.' + ext.replace(/^\./, '')),
          },
        }));

        const handles = await (window as any).showOpenFilePicker({
          multiple: options.multiple ?? false,
          types,
        });

        const files = await Promise.all(
          handles.map(async (handle: any) => {
            const file = await handle.getFile();
            const content = await file.text();
            return {
              name: file.name,
              content,
              size: file.size,
            };
          }),
        );

        return { canceled: false, files };
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return { canceled: true, files: [] };
        }
        console.error('[WebPlatformAdapter] showOpenFilePicker error:', err);
      }
    }

    // Fallback: input element
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = options.multiple ?? false;
      if (options.filters && options.filters.length > 0) {
        input.accept = options.filters
          .flatMap((f) => f.extensions.map((ext) => '.' + ext.replace(/^\./, '')))
          .join(',');
      }

      input.onchange = async () => {
        if (!input.files || input.files.length === 0) {
          resolve({ canceled: true, files: [] });
          return;
        }

        const files = await Promise.all(
          Array.from(input.files).map(async (file) => {
            const content = await file.text();
            return {
              name: file.name,
              content,
              size: file.size,
            };
          }),
        );

        resolve({ canceled: false, files });
      };

      input.oncancel = () => resolve({ canceled: true, files: [] });
      input.click();
    });
  }

  async saveFile(options: SaveFileOptions): Promise<SaveFileResult> {
    if (typeof window === 'undefined') {
      return { canceled: true };
    }

    if ('showSaveFilePicker' in window) {
      try {
        const types = options.filters?.map((f) => ({
          description: f.name,
          accept: {
            'application/json': f.extensions.map((ext) => '.' + ext.replace(/^\./, '')),
          },
        }));

        const handle = await (window as any).showSaveFilePicker({
          suggestedName: options.defaultName,
          types,
        });

        const writable = await handle.createWritable();
        await writable.write(options.content);
        await writable.close();

        return { canceled: false };
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          return { canceled: true };
        }
        console.error('[WebPlatformAdapter] showSaveFilePicker error:', err);
      }
    }

    // Fallback: dynamic anchor download
    try {
      const blob = new Blob([options.content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = options.defaultName || 'download.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { canceled: false };
    } catch (err) {
      console.error('[WebPlatformAdapter] saveFile fallback error:', err);
      return { canceled: true };
    }
  }

  async selectDirectory(_options?: SelectDirectoryOptions): Promise<SelectDirectoryResult> {
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker();
        return { canceled: false, path: handle.name };
      } catch (err: any) {
        if (err?.name === 'AbortError') return { canceled: true };
        console.error('[WebPlatformAdapter] showDirectoryPicker error:', err);
      }
    }
    return { canceled: true };
  }

  async confirmPrompt(options: ConfirmPromptOptions): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    return window.confirm(options.title + "\n\n" + options.message);
  }

  async openExternal(url: string): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  }
}
