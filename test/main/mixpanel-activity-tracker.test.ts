import MixpanelActivityTracker from '../../src/main/src/functions/MixpanelActivityTracker';
import { setPlatform } from '../../src/main/src/platform';
import { MobilePlatformAdapter } from '../../src/main/src/platform/MobilePlatformAdapter';

describe('MixpanelActivityTracker', () => {
  afterEach(() => setPlatform(null));

  test('tracks a successful join without a persistent or account identifier', async () => {
    setPlatform(new MobilePlatformAdapter());
    const request = jest.fn(async () => ({ ok: true }));
    const tracker = new MixpanelActivityTracker(request as any);

    await tracker.addActivity({
      server: 'play.example.com',
      scriptId: 'plugin-123',
      scriptName: 'Example plugin',
    });

    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://api-eu.mixpanel.com/track?ip=0');
    const payload = JSON.parse(String(options.body));
    expect(payload).toEqual([
      {
        event: 'Bot Joined',
        properties: expect.objectContaining({
          token: '6840fd0cbddaa319394ff6ee80079862',
          $insert_id: expect.any(String),
          distinct_id: expect.any(String),
          server: 'play.example.com',
          script_id: 'plugin-123',
          script_name: 'Example plugin',
          platform: 'mobile',
        }),
      },
    ]);
    expect(payload[0].properties.distinct_id).toBe(
      payload[0].properties.$insert_id,
    );
    expect(payload[0].properties).not.toHaveProperty('bot_username');
  });

  test('does not send failed analytics into the join flow', async () => {
    const request = jest.fn(async () => {
      throw new Error('offline');
    });
    const tracker = new MixpanelActivityTracker(request as any);

    await expect(
      tracker.addActivity({ server: 'play.example.com' }),
    ).resolves.toBeUndefined();

    expect(request).toHaveBeenCalledTimes(1);
  });
});
