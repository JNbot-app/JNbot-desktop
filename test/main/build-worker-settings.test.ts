import { buildWorkerSettings } from '../../src/main/src/functions/buildWorkerSettings';

describe('buildWorkerSettings', () => {
  it('combines profile settings with shared devices and launcher options', () => {
    const mockSettings: any = {
      bootstrapProfileKey: 'jartexnetwork',
      getProfileSettings: jest.fn((key: string) => ({
        scripts: { scriptA: { enabled: true } },
        reminders: [{ id: 'rem-1' }],
        profileKey: key,
      })),
      getAltsWithDataForProfile: jest.fn(() => [
        { username: 'Alt1', data: { premium: true } },
      ]),
      shared: {
        devices: [{ id: 'dev-1', name: 'Phone' }],
        launcherOptions: { memory: 2048 },
      },
    };

    const result = buildWorkerSettings(mockSettings);

    expect(mockSettings.getProfileSettings).toHaveBeenCalledWith('jartexnetwork');
    expect(mockSettings.getAltsWithDataForProfile).toHaveBeenCalledWith('jartexnetwork');
    expect(result.devices).toEqual([{ id: 'dev-1', name: 'Phone' }]);
    expect(result.launcherOptions).toEqual({ memory: 2048 });
    expect(result.alts).toEqual([{ username: 'Alt1', data: { premium: true } }]);
    expect((result as any).scripts).toEqual({ scriptA: { enabled: true } });
  });

  it('uses explicitly provided profileKey instead of bootstrapProfileKey', () => {
    const mockSettings: any = {
      bootstrapProfileKey: 'jartexnetwork',
      getProfileSettings: jest.fn((key: string) => ({ profileKey: key })),
      getAltsWithDataForProfile: jest.fn(() => []),
      shared: { devices: [], launcherOptions: {} },
    };

    const result = buildWorkerSettings(mockSettings, 'custom-profile');
    expect(mockSettings.getProfileSettings).toHaveBeenCalledWith('custom-profile');
    expect(mockSettings.getAltsWithDataForProfile).toHaveBeenCalledWith('custom-profile');
    expect((result as any).profileKey).toBe('custom-profile');
  });
});
