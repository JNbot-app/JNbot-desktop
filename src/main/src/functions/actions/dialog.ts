import assert from 'assert';
import { ipcMain } from 'electron';

interface Button {
  label: string;
  type?: 'link' | 'text' | 'default' | 'primary' | 'dashed';
  danger?: boolean;
}

interface DialogArgs {
  title: string;
  body: string;
  buttons: Button[];
}

async function showDialog(dialog: DialogArgs): Promise<string> {
  assert(dialog?.title, 'Dialog title is required');
  if ((global as { isCLI?: boolean }).isCLI) {
    return dialog.buttons?.[0]?.label ?? '';
  }
  return new Promise((resolve) => {
    const id = Math.random().toString(36).substring(2, 15);

    const handler = (_: unknown, data: { id: string; response: string }) => {
      if (data?.id === id) {
        ipcMain?.removeListener?.('DIALOG', handler);
        resolve(data.response);
      }
    };

    ipcMain?.on?.('DIALOG', handler);

    if (typeof global.send === 'function') {
      global.send('DIALOG', {
        ...dialog,
        id,
      });
    } else {
      ipcMain?.removeListener?.('DIALOG', handler);
      resolve('');
    }
  });
}

export default showDialog;