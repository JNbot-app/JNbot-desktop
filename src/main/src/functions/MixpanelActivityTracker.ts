import { randomUUID } from 'node:crypto';
import { getPlatform } from '../platform';

const MIXPANEL_PROJECT_TOKEN = '6840fd0cbddaa319394ff6ee80079862';
const MIXPANEL_TRACK_URL = 'https://api-eu.mixpanel.com/track?ip=0';

export type BotJoinActivity = {
  server: string;
  scriptId?: string;
  scriptName?: string;
};

type Fetch = typeof globalThis.fetch;

/** Sends successful bot joins to the EU Mixpanel project without delaying joins. */
export default class MixpanelActivityTracker {
  private readonly request: Fetch;

  constructor(request: Fetch = fetch) {
    this.request = request;
  }

  async addActivity(activity: BotJoinActivity): Promise<void> {
    const server = activity.server?.trim();
    if (!server) return;

    try {
      const eventId = randomUUID();
      const response = await this.request(MIXPANEL_TRACK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([
          {
            event: 'Bot Joined',
            properties: {
              token: MIXPANEL_PROJECT_TOKEN,
              distinct_id: eventId,
              $insert_id: eventId,
              server,
              script_id: activity.scriptId,
              script_name: activity.scriptName,
              platform: getPlatform().platform,
            },
          },
        ]),
      });
      if (!response.ok) throw new Error('Mixpanel rejected the event');
    } catch (error) {
      // Analytics must never make a bot join fail.
      if (process.env.NODE_ENV === 'development')
        console.warn('Could not record bot join in Mixpanel', error);
    }
  }
}
