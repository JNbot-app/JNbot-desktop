import ProfileTransfer, {
  type PortableProfilePackage,
} from '../../src/main/src/functions/ProfileTransfer';

const packageFor = (
  ownerId: string,
  profileKey = 'jartexnetwork',
  revision = 'revision-1',
): PortableProfilePackage =>
  ({
    version: 1,
    source: { ownerId, profileKey },
    revision,
    exportedAt: 1,
    profile: {
      id: profileKey,
      predefined: false,
      createdAt: 1,
      updatedAt: 1,
      data: { id: profileKey, name: 'Jartex' },
      gamemodes: {},
    },
    settings: { scripts: {}, altData: {}, altTags: [], reminders: [], triggers: {}, pluginData: {}, version: 2 },
    appSettings: {},
    alts: [],
  }) as PortableProfilePackage;

function settings(existingRevision?: string) {
  const profiles = {
    get: jest.fn(() => existingRevision
      ? { remoteSource: { revision: existingRevision } }
      : undefined),
    materializeSyncedProfile: jest.fn(async (profile) => profile),
    upsert: jest.fn(),
  };
  return {
    profiles,
    replaceProfileSettings: jest.fn(),
    replaceProfileAppSettings: jest.fn(),
    setAltsForProfile: jest.fn(),
  } as any;
}

describe('ProfileTransfer imports', () => {
  test('same profile key from different owners receives different local keys', async () => {
    const target = settings('revision-1');
    const result = await new ProfileTransfer(target).import([
      packageFor('owner-a'),
      packageFor('owner-b'),
    ]);

    expect(result.failed).toEqual([]);
    expect(result.installed[0].profileKey).not.toBe(result.installed[1].profileKey);
    expect(result.installed[0].profileKey).toMatch(/^remote-[a-f0-9]{32}$/);
  });

  test('does not overwrite offline changes until a new revision arrives', async () => {
    const target = settings('revision-1');
    await new ProfileTransfer(target).import([packageFor('owner-a')]);

    expect(target.profiles.materializeSyncedProfile).not.toHaveBeenCalled();
    expect(target.replaceProfileSettings).not.toHaveBeenCalled();
  });

  test('a new revision replaces every profile-owned data slice', async () => {
    const target = settings('older');
    const item = packageFor('owner-a');
    const result = await new ProfileTransfer(target).import([item]);
    const key = result.installed[0].profileKey;

    expect(target.profiles.upsert).toHaveBeenCalledTimes(1);
    expect(target.replaceProfileSettings).toHaveBeenCalledWith(key, item.settings);
    expect(target.replaceProfileAppSettings).toHaveBeenCalledWith(key, item.appSettings);
    expect(target.setAltsForProfile).toHaveBeenCalledWith(key, item.alts);
  });

  test('one invalid cache entry does not block valid copies', async () => {
    const target = settings('revision-1');
    const result = await new ProfileTransfer(target).import([
      { ...packageFor('owner-a'), alts: null } as never,
      packageFor('owner-b'),
    ]);

    expect(result.failed).toHaveLength(1);
    expect(result.installed).toHaveLength(1);
  });
});
