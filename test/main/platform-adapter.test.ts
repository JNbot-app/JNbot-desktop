import { DesktopPlatformAdapter } from '../../src/main/src/platform/DesktopPlatformAdapter';
import showDialog from '../../src/main/src/functions/actions/dialog';

jest.mock('../../src/main/src/functions/actions/dialog', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('DesktopPlatformAdapter confirmPrompt', () => {
  let adapter: DesktopPlatformAdapter;
  const mockedShowDialog = showDialog as jest.MockedFunction<typeof showDialog>;

  beforeEach(() => {
    adapter = new DesktopPlatformAdapter();
    mockedShowDialog.mockReset();
  });

  it('returns true when user confirms the prompt', async () => {
    mockedShowDialog.mockResolvedValue('Approve transfer');

    const result = await adapter.confirmPrompt({
      title: 'Approve instance transfer?',
      message: 'My Phone requested an instance transfer.',
      confirmLabel: 'Approve transfer',
      cancelLabel: 'Deny',
      type: 'warning',
    });

    expect(result).toBe(true);
    expect(mockedShowDialog).toHaveBeenCalledWith({
      title: 'Approve instance transfer?',
      body: 'My Phone requested an instance transfer.',
      buttons: [
        { label: 'Deny', type: 'default' },
        { label: 'Approve transfer', type: 'primary', danger: true },
      ],
    });
  });

  it('returns false when user cancels or denies the prompt', async () => {
    mockedShowDialog.mockResolvedValue('Deny');

    const result = await adapter.confirmPrompt({
      title: 'Approve instance transfer?',
      message: 'My Phone requested an instance transfer.',
      confirmLabel: 'Approve transfer',
      cancelLabel: 'Deny',
      type: 'warning',
    });

    expect(result).toBe(false);
  });

  it('returns false when dialog is dismissed with null or error', async () => {
    mockedShowDialog.mockResolvedValue(null as any);

    const result = await adapter.confirmPrompt({
      title: 'Test prompt',
      message: 'Testing dismissal',
    });

    expect(result).toBe(false);
    expect(mockedShowDialog).toHaveBeenCalledWith({
      title: 'Test prompt',
      body: 'Testing dismissal',
      buttons: [
        { label: 'Cancel', type: 'default' },
        { label: 'Confirm', type: 'primary', danger: false },
      ],
    });
  });

  it('handles showDialog rejection gracefully and returns false', async () => {
    mockedShowDialog.mockRejectedValue(new Error('IPC failed'));

    const result = await adapter.confirmPrompt({
      title: 'Test prompt',
      message: 'Testing failure',
    });

    expect(result).toBe(false);
  });
});
