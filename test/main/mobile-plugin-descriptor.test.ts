import ClientEvents from '../../src/main/src/functions/ClientEvents';

function createClientEvents(pluginSettings: Record<string, unknown> = {}) {
  const clientEvents = Object.create(ClientEvents.prototype) as ClientEvents;
  Object.assign(clientEvents, {
    accessControl: { assertProfileAction: jest.fn() },
    scriptHandler: {
      getRuntime: jest.fn(() => ({ profileKey: 'pikanetwork' })),
    },
    settings: {
      JNdata: { data: { pikanetwork: { gamemodes: ['SkyblockDream'] } } },
      getProfileSettings: jest.fn(() => ({
        altData: {},
        altTags: [],
        scripts: { collector: pluginSettings },
      })),
    },
  });
  return clientEvents;
}

describe('mobile plugin run descriptors', () => {
  it('serializes dependent multi-selects without static choices', async () => {
    const clientEvents = createClientEvents({
      gamemode: 'SkyblockDream',
      kits: { SkyblockDream: ['once kit'] },
    });
    const plugin = {
      pluginId: 'collector',
      name: 'Kit collector',
      config: [{
        name: 'Kits',
        options: [{
          id: 'kits',
          label: 'Choose your kits',
          type: 'multiSelect',
          valueByFieldId: 'gamemode',
          freeSolo: true,
        }],
      }],
    };

    await expect(clientEvents.profileAction(
      1,
      'RESOLVE_PLUGIN_RUN_DESCRIPTOR',
      { plugin },
    )).resolves.toMatchObject({
      sections: [{ options: [{ id: 'kits', options: [] }] }],
      values: { kits: { SkyblockDream: ['once kit'] } },
    });
  });
});
