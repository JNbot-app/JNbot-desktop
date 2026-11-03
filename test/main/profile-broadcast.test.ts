import { makeEmptyProfile } from '../../src/common/profiles';
import { bootElectron, cleanupUserData, freshUserData } from './helpers';

afterAll(cleanupUserData);

describe('profile changes made in main', () => {
  test('reach the local window, not only remote devices', () => {
    bootElectron(freshUserData());
    const send = jest.fn();
    (global as any).send = send;
    (global as any).broadcast = jest.fn();
    const Settings = require('../../src/main/src/functions/Settings').default;
    const settings = new Settings();

    // A share install upserts the profile from main, like this.
    settings.profiles.upsert(makeEmptyProfile('installed'));

    const pushed = (channel: string) =>
      send.mock.calls.filter(([name]) => name === channel).map(([, data]) => data);
    expect(pushed('JNdata').at(-1).serverList).toEqual(['installed']);
    expect(pushed('profiles').at(-1).map((p: { id: string }) => p.id)).toEqual(['installed']);
  });
});
