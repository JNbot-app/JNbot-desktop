import showDialog from '../../src/main/src/functions/actions/dialog';
import { ipcMain } from 'electron';

describe('showDialog action', () => {

  afterEach(() => {
    (global as any).isCLI = undefined;
    (global as any).send = undefined;
    ipcMain.removeAllListeners('DIALOG');
  });

  it('throws assertion error when dialog title is missing', async () => {
    await expect(showDialog(null as any)).rejects.toThrow('Dialog title is required');
    await expect(showDialog({ title: '', body: 'text', buttons: [] })).rejects.toThrow(
      'Dialog title is required',
    );
  });

  it('in CLI mode, immediately returns the label of the first button', async () => {
    (global as any).isCLI = true;

    const res1 = await showDialog({
      title: 'Confirm',
      body: 'Are you sure?',
      buttons: [{ label: 'Yes' }, { label: 'No' }],
    });
    expect(res1).toBe('Yes');

    const resEmpty = await showDialog({
      title: 'Alert',
      body: 'No buttons',
      buttons: [],
    });
    expect(resEmpty).toBe('');
  });

  it('in desktop mode with global.send, sends DIALOG event and awaits IPC reply with matching ID', async () => {
    (global as any).isCLI = false;
    let sentPayload: any = null;
    (global as any).send = jest.fn((event: string, payload: any) => {
      sentPayload = payload;
    });

    const promise = showDialog({
      title: 'Choose Option',
      body: 'Please pick an action',
      buttons: [{ label: 'Option A' }, { label: 'Option B' }],
    });

    expect((global as any).send).toHaveBeenCalledWith('DIALOG', expect.objectContaining({
      title: 'Choose Option',
      id: expect.any(String),
    }));

    // Simulate IPC reply from renderer via electron mock helper
    (ipcMain as any).__emit('DIALOG', {}, { id: sentPayload.id, response: 'Option A' });

    const result = await promise;
    expect(result).toBe('Option A');
  });

  it('resolves with empty string if global.send is not a function in desktop mode', async () => {
    (global as any).isCLI = false;
    (global as any).send = undefined;

    const result = await showDialog({
      title: 'Alert',
      body: 'Testing without renderer send',
      buttons: [{ label: 'OK' }],
    });

    expect(result).toBe('');
  });
});
