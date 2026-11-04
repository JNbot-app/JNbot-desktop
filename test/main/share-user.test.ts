import { gunzipSync, gzipSync } from 'zlib';
import { createHash } from 'crypto';
import {
  MARKET_REFRESH_INTERVAL,
  SHARE_UPDATE_CHECK_INTERVAL,
  previewBlocked,
  previewNeedsCheck,
  shareDeepLink,
  shareInstallKey,
  shareUpdateAvailable,
  shareUrl,
} from '../../src/common/share';
import { cleanupUserData } from './helpers';
import { ShareWorld, decisionsFor, type Device } from './shareWorld';

let world: ShareWorld;
let alice: Device;
let bob: Device;
let reviewer: Device;

beforeEach(() => {
  world = new ShareWorld();
  alice = world.device('Alice');
  bob = world.device('Bob');
  reviewer = world.device('JNbot', { reviewer: true });
});
afterEach(() => world.close());
afterAll(cleanupUserData);

const installs = (id: string) => world.row('SELECT installs FROM shares WHERE id = ?', id)!.installs;

async function publish(visibility: 'link' | 'public' = 'link', code = 'console.log("v1")') {
  await alice.writePlugin('autofarm', code, { description: 'Farms for you', scriptType: 'action' });
  const owned = await alice.shares.create({ kind: 'plugin', ref: 'autofarm', visibility });
  if (visibility === 'public') await reviewer.approve(owned.id);
  return owned;
}

/** Publishes a new version; marketplace ones get approved too. */
async function publishUpdate(id: string, code: string) {
  await alice.writePlugin('autofarm', code, { description: 'Farms for you', scriptType: 'action' });
  const owned = await alice.shares.update(id);
  if (owned.visibility === 'public') await reviewer.approve(id);
  return owned;
}

const installedOn = (device: Device, id: string) => device.shares.state().installed[id];

describe('opening a share link', () => {
  test.each([
    ['a web link', (id: string) => shareUrl(id)],
    ['a web link with a slash', (id: string) => `${shareUrl(id)}/`],
    ['a deep link', (id: string) => shareDeepLink(id)],
    ['a bare id with spaces', (id: string) => `  ${id}\n`],
  ])('previews from %s', async (_name, link) => {
    const { id } = await publish();
    const preview = await bob.shares.preview(link(id));
    expect(preview).toMatchObject({
      id,
      kind: 'plugin',
      visibility: 'link',
      reviewed: false,
      canInstall: true,
      publisher: { name: 'Alice', trusted: false, own: false, official: false },
      plugins: [{ pluginId: 'autofarm', state: 'new', verification: 'valid-untrusted', code: 'console.log("v1")' }],
    });
    expect(preview.installed).toBeUndefined();
  });

  test('refuses things that are not share links', async () => {
    await expect(bob.shares.preview('https://example.com/nope')).rejects.toThrow('not a valid JNbot share link');
    await expect(bob.shares.preview('')).rejects.toThrow('not a valid JNbot share link');
  });

  test('says when the share is gone', async () => {
    await expect(bob.shares.preview('AAAAAAAAAA')).rejects.toMatchObject({ status: 404, message: 'Share not found' });
  });

  test('an unknown publisher needs a closer look; once trusted it does not', async () => {
    const { id } = await publish();
    expect(previewNeedsCheck(await bob.shares.preview(id))).toBe(true);
    const { preview } = await bob.install(id, { trustPublisher: true });
    expect(preview.publisher.trusted).toBe(false);
    expect((await bob.shares.preview(id)).publisher.trusted).toBe(true);
  });
});

describe('installing', () => {
  test('a plugin lands in the library and counts one install', async () => {
    const { id, revision } = await publish();
    const { localRef, state } = await bob.install(id);
    await world.settled(bob);

    expect(localRef).toBe('autofarm');
    expect(bob.code('autofarm')).toBe('console.log("v1")');
    expect(state.installed[id]).toMatchObject({ kind: 'plugin', revision, ownerName: 'Alice', listed: false });
    expect(installs(id)).toBe(1);
  });

  test('installing the same revision again changes nothing', async () => {
    const { id } = await publish();
    await bob.install(id);
    await bob.install(id);
    await world.settled(bob);
    expect(installs(id)).toBe(1);
    expect(Object.keys(bob.shares.state().installed)).toEqual([id]);
  });

  test('the publisher cannot install their own share', async () => {
    const { id } = await publish();
    const preview = await alice.shares.preview(id);
    expect(preview.publisher.own).toBe(true);
    await expect(alice.shares.install({ id, decisions: [] })).rejects.toThrow('You published this');
  });

  test('forgets the install once the plugin is removed, so it can be installed again', async () => {
    const { id } = await publish();
    await bob.install(id);
    await bob.macros.delete('autofarm');
    bob.macros.invalidateLocalCache();
    expect(installedOn(bob, id)).toBeUndefined();

    await bob.install(id);
    await world.settled(bob);
    expect(bob.code('autofarm')).toBe('console.log("v1")');
    expect(installs(id)).toBe(2);
  });

  test('a plugin that was not installed is not reported as installed', async () => {
    const { id } = await publish();
    await bob.shares.preview(id);
    await expect(bob.shares.install({ id, decisions: [] })).rejects.toThrow();
    await world.settled(bob);
    expect(bob.macros.findPlugin('autofarm')).toBeFalsy();
    expect(installs(id)).toBe(0);
  });

  test('replacing overwrites your plugin, and later updates stay on that same plugin', async () => {
    const { id } = await publish();
    await bob.writePlugin('autofarm', 'console.log("mine")');
    const { preview, localRef } = await bob.install(id, { action: 'replace' });
    expect(preview.plugins[0].state).toBe('conflict');
    expect(localRef).toBe('autofarm');
    expect(bob.code('autofarm')).toBe('console.log("v1")');

    await publishUpdate(id, 'console.log("v2")');
    await bob.shares.checkShare(id);
    expect((await bob.install(id)).localRef).toBe('autofarm');
    expect(bob.code('autofarm')).toBe('console.log("v2")');
  });

  test('skipping the only plugin of a share installs nothing', async () => {
    const { id } = await publish();
    await bob.writePlugin('autofarm', 'console.log("mine")');
    await expect(bob.install(id, { action: 'skip' })).rejects.toThrow();
    expect(bob.code('autofarm')).toBe('console.log("mine")');
    expect(installedOn(bob, id)).toBeUndefined();
  });

  test('needs the app version it was published from', async () => {
    const { id } = await publish();
    jest.spyOn(bob.shares as any, 'appVersion', 'get').mockReturnValue('0.0.1');
    const preview = await bob.shares.preview(id);
    expect(preview.canInstall).toBe(false);
    expect(previewBlocked(preview)).toBe(true);
    await expect(bob.shares.install({ id, decisions: decisionsFor(preview) })).rejects.toThrow('Update JNbot to install it');
    expect(bob.macros.findPlugin('autofarm')).toBeFalsy();
  });

  test('a bundle installs into its folder, and updates there even when you renamed it', async () => {
    await alice.writePlugin('one', 'console.log(1)');
    await alice.writePlugin('two', 'console.log(2)');
    alice.settings.updateShared({ pluginMetadata: { one: { folder: 'Farm' }, two: { folder: 'Farm' } } }, true);
    const { id } = await alice.shares.create({ kind: 'bundle', ref: 'Farm' });

    expect((await bob.install(id)).localRef).toBe('Farm');
    expect(bob.settings.shared.pluginMetadata).toMatchObject({ one: { folder: 'Farm' }, two: { folder: 'Farm' } });

    await alice.writePlugin('two', 'console.log("two v2")');
    await alice.writePlugin('three', 'console.log(3)');
    alice.settings.updateShared({ pluginMetadata: { ...alice.settings.shared.pluginMetadata, three: { folder: 'Farm' } } }, true);
    await alice.shares.update(id);
    await bob.shares.checkShare(id);
    await bob.install(id);
    expect(bob.code('two')).toBe('console.log("two v2")');
    expect(bob.settings.shared.pluginMetadata.three.folder).toBe('Farm');
  });

  test('already having the exact plugin counts as installed', async () => {
    const { id } = await publish();
    await bob.install(id);
    (bob.shares as any).file.installed = {};
    const { preview, state } = await bob.install(id);
    expect(preview.plugins[0].state).toBe('identical');
    expect(state.installed[id].localRef).toBe('autofarm');
  });

  test('two bundles with the same folder name both keep getting updates', async () => {
    const carol = world.device('Carol');
    const bundleFrom = async (device: Device, pluginId: string) => {
      await device.writePlugin(pluginId, 'console.log(1)');
      device.settings.updateShared({ pluginMetadata: { [pluginId]: { folder: 'Farm' } } }, true);
      return device.shares.create({ kind: 'bundle', ref: 'Farm' });
    };
    const first = await bundleFrom(alice, 'one');
    const second = await bundleFrom(carol, 'two');
    await bob.install(first.id);
    const { state } = await bob.install(second.id);
    expect(Object.keys(state.installed).sort()).toEqual([first.id, second.id].sort());
  });

  test('skipping a conflict in a bundle leaves your own plugin where it is', async () => {
    await alice.writePlugin('one', 'console.log(1)');
    await alice.writePlugin('two', 'console.log(2)');
    alice.settings.updateShared({ pluginMetadata: { one: { folder: 'Farm' }, two: { folder: 'Farm' } } }, true);
    const { id } = await alice.shares.create({ kind: 'bundle', ref: 'Farm' });

    await bob.writePlugin('two', 'console.log("mine")');
    bob.settings.updateShared({ pluginMetadata: { two: { folder: 'Mine' } } }, true);
    const preview = await bob.shares.preview(id);
    await bob.shares.install({
      id,
      decisions: decisionsFor(preview).map((item) => (item.pluginId === 'two' ? { ...item, action: 'skip' } : item)),
    });
    expect(bob.code('two')).toBe('console.log("mine")');
    expect(bob.settings.shared.pluginMetadata.two.folder).toBe('Mine');
    expect(bob.settings.shared.pluginMetadata.one.folder).toBe('Farm');
  });
});

describe('chains', () => {
  async function publishChain(servers: string[] = []) {
    const source = alice.addProfile('alicesserver');
    await alice.writePlugin('step1', 'console.log("step")');
    alice.settings.updateProfileSettings(source, [
      {
        path: ['scripts', 'chains', 'mychain'],
        value: { id: 'mychain', name: 'Daily', chains: [{ id: 1, name: 'Go', scriptId: 'step1' }] },
      },
      { path: ['scripts', 'mychain'], value: { name: 'Daily', altRange: [1, 5] } },
    ]);
    return { source, ...(await alice.shares.create({ kind: 'chain', ref: 'mychain', profileKey: source, servers })) };
  }

  test('installs per profile, with the plugin it needs and without the alt range', async () => {
    const { id } = await publishChain();
    const [first, second] = [bob.addProfile('one'), bob.addProfile('two')];

    const one = await bob.install(id, { profileKey: first });
    const two = await bob.install(id, { profileKey: second });
    await world.settled(bob);

    expect(bob.code('step1')).toBe('console.log("step")');
    expect(Object.keys(bob.shares.state().installed).sort()).toEqual(
      [shareInstallKey(id, 'chain', first), shareInstallKey(id, 'chain', second)].sort(),
    );
    expect(one.localRef).not.toBe(two.localRef);
    const { scripts } = bob.settings.getProfileSettings(first);
    expect(scripts.chains[one.localRef]).toMatchObject({ name: 'Daily', chains: [{ scriptId: 'step1' }] });
    expect(scripts[one.localRef].altRange).toBeUndefined();
    expect(installs(id)).toBe(2);
  });

  test('needs a profile', async () => {
    const { id } = await publishChain();
    await expect(bob.install(id)).rejects.toThrow('A profile is required');
  });

  test('only goes on the servers it was made for', async () => {
    const { id } = await publishChain(['jartexnetwork']);
    const profile = bob.addProfile('other');
    await expect(bob.install(id, { profileKey: profile })).rejects.toThrow('made for jartexnetwork');
  });

  test('updates in every profile keep your own options', async () => {
    const { id, source } = await publishChain();
    const profile = bob.addProfile('one');
    const { localRef } = await bob.install(id, { profileKey: profile });
    bob.settings.updateProfileSettings(profile, { path: ['scripts', localRef, 'altRange'], value: [2, 9] });

    alice.settings.updateProfileSettings(source, {
      path: ['scripts', 'chains', 'mychain', 'chains'],
      value: [{ id: 1, name: 'Go', scriptId: 'step1' }, { id: 2, name: 'Again', scriptId: 'step1' }],
    });
    await alice.shares.update(id);
    await bob.shares.checkShare(id);
    const updated = await bob.install(id, { profileKey: profile });

    expect(updated.localRef).toBe(localRef);
    const { scripts } = bob.settings.getProfileSettings(profile);
    expect(scripts.chains[localRef].chains).toHaveLength(2);
    expect(scripts[localRef].altRange).toEqual([2, 9]);
  });
});

describe('triggers', () => {
  const rule = (message: string) => ({
    id: 'rule',
    event: 'chat',
    enabled: true,
    filter: 'hello',
    actions: [{ type: 'discord', webhook: 'https://discord.com/api/webhooks/secret' }, { type: 'chat', message }],
  });

  async function publishTrigger() {
    const source = alice.addProfile('alicesserver');
    alice.settings.updateProfileSettings(source, { path: ['triggers'], value: [rule('hi')] });
    return { source, ...(await alice.shares.create({ kind: 'trigger', ref: 'rule', profileKey: source })) };
  }

  test('arrives switched on, as the preview says', async () => {
    const { id } = await publishTrigger();
    const profile = bob.addProfile('one');
    const { preview, localRef } = await bob.install(id, { profileKey: profile });

    expect(preview.details[0].rows).toContainEqual({ label: 'Runs on', value: 'All bots — on as soon as it is installed' });
    const [installed] = bob.settings.getProfileSettings(profile).triggers;
    expect(installed).toMatchObject({ id: localRef, enabled: true, actions: [{ type: 'discord', webhook: '' }, { message: 'hi' }] });
  });

  test('an update keeps your webhook, alts and whether it is on', async () => {
    const { id, source } = await publishTrigger();
    const profile = bob.addProfile('one');
    const { localRef } = await bob.install(id, { profileKey: profile });
    const [mine] = bob.settings.getProfileSettings(profile).triggers;
    bob.settings.updateProfileSettings(profile, {
      path: ['triggers'],
      value: [{ ...mine, enabled: false, alts: ['bob'], actions: [{ type: 'discord', webhook: 'https://bobs/hook' }, mine.actions[1]] }],
    });

    alice.settings.updateProfileSettings(source, { path: ['triggers'], value: [rule('hello there')] });
    await alice.shares.update(id);
    await bob.shares.checkShare(id);
    await bob.install(id, { profileKey: profile });

    const { triggers } = bob.settings.getProfileSettings(profile);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      id: localRef,
      enabled: false,
      alts: ['bob'],
      actions: [{ webhook: 'https://bobs/hook' }, { message: 'hello there' }],
    });
  });
});

describe('profiles', () => {
  test('a shared profile installs as a normal, editable one', async () => {
    const source = alice.addProfile('alicesserver', 'Alice SMP');
    const { id } = await alice.shares.create({ kind: 'profile', ref: source });
    const { localRef, preview } = await bob.install(id);
    expect(preview.details[0].rows).toContainEqual({ label: 'Name', value: 'Alice SMP' });
    expect(bob.settings.profiles.get(localRef)).toMatchObject({ share: { id, official: false }, data: { name: 'Alice SMP' } });
  });

  test('an update keeps the id, so your settings stay attached', async () => {
    const source = alice.addProfile('alicesserver', 'Alice SMP');
    const { id } = await alice.shares.create({ kind: 'profile', ref: source });
    const { localRef } = await bob.install(id);
    bob.settings.updateProfileSettings(localRef, { path: ['altTags'], value: [{ name: 'mine', alts: [] }] });

    alice.addProfile(source, 'Alice SMP 2');
    await alice.shares.update(id);
    await bob.shares.checkShare(id);
    const updated = await bob.install(id);

    expect(updated.localRef).toBe(localRef);
    expect(bob.settings.profiles.get(localRef).data.name).toBe('Alice SMP 2');
    expect(bob.settings.getProfileSettings(localRef).altTags).toEqual([{ name: 'mine', alts: [] }]);
  });

  test('an official profile installs under its server id and is read-only', async () => {
    reviewer.addProfile('jartexnetwork', 'Jartex');
    const { id } = await reviewer.shares.create({ kind: 'profile', ref: 'jartexnetwork', visibility: 'public' });
    await reviewer.approve(id);
    const { localRef } = await bob.install(id);
    expect(localRef).toBe('jartexnetwork');
    expect(bob.settings.profiles.get(localRef).share).toEqual({ id, official: true });
  });

  test('a stranger cannot replace a profile you already have by reusing its id', async () => {
    bob.addProfile('jartexnetwork', 'My Jartex');
    alice.addProfile('jartexnetwork', 'Evil Jartex');
    const { id } = await alice.shares.create({ kind: 'profile', ref: 'jartexnetwork' });

    const { localRef } = await bob.install(id);
    expect(localRef).not.toBe('jartexnetwork');
    expect(bob.settings.profiles.get('jartexnetwork').data.name).toBe('My Jartex');
  });
});

describe('updating from a private link', () => {
  test('shows the update, and only installs it when asked', async () => {
    const { id, revision } = await publish();
    await bob.install(id);
    const next = await publishUpdate(id, 'console.log("v2")');

    const { installed } = await bob.refresh();
    await world.settled(bob);
    expect(installed[id]).toMatchObject({ revision, latestRevision: next.revision, listed: false });
    expect(shareUpdateAvailable(installed[id], bob.shares.state().appVersion)).toBe(true);
    expect(bob.code('autofarm')).toBe('console.log("v1")');

    const { preview, state } = await bob.install(id);
    await world.settled(bob);
    expect(preview.installed?.revision).toBe(revision);
    expect(bob.code('autofarm')).toBe('console.log("v2")');
    expect(state.installed[id].revision).toBe(next.revision);
    expect(installs(id)).toBe(1);
  });

  test('checks for updates at most twice a day, unless you open a share page', async () => {
    const { id } = await publish();
    await bob.install(id);
    await world.settled(bob);
    const lookups = () => world.requests.filter((request) => request === 'POST /api/revisions').length;

    await bob.shares.checkUpdates();
    expect(lookups()).toBe(1);
    await bob.shares.checkUpdates();
    expect(lookups()).toBe(1);
    await bob.shares.checkUpdates(true);
    expect(lookups()).toBe(1);

    world.advance(61 * 1000);
    await bob.shares.checkUpdates(true);
    expect(lookups()).toBe(2);
    await bob.shares.checkUpdates();
    expect(lookups()).toBe(2);

    world.advance(SHARE_UPDATE_CHECK_INTERVAL + 1);
    await bob.shares.checkUpdates();
    expect(lookups()).toBe(3);
  });

  test('does not offer an update this app is too old for', async () => {
    const { id } = await publish();
    await bob.install(id);
    await publishUpdate(id, 'console.log("v2")');
    world.run(`UPDATE share_revisions SET min_app_version = '99.0.0' WHERE share_id = ?`, id);
    const { installed, appVersion } = await bob.refresh();
    expect(shareUpdateAvailable(installed[id], appVersion)).toBe(false);
  });

  test('a deleted share keeps your copy and offers nothing', async () => {
    const { id } = await publish();
    await bob.install(id);
    await alice.shares.remove(id);

    const { installed, appVersion } = await bob.refresh();
    expect(installed[id].latestRevision).toBeNull();
    expect(shareUpdateAvailable(installed[id], appVersion)).toBe(false);
    expect(bob.code('autofarm')).toBe('console.log("v1")');
  });

  test('a new owner cannot take over an install', async () => {
    const { id } = await publish();
    await bob.install(id);

    // The server (or whoever owns it) hands the id to another key.
    const mallory = world.device('Mallory');
    await mallory.writePlugin('autofarm', 'steal()');
    const forged = await mallory.shares.create({ kind: 'plugin', ref: 'autofarm' });
    const stolen = world.row('SELECT * FROM share_revisions WHERE share_id = ?', forged.id)!;
    world.run('DELETE FROM share_revisions WHERE share_id = ?', forged.id);
    world.run('DELETE FROM shares WHERE id = ?', forged.id);
    world.run('DELETE FROM share_revisions WHERE share_id = ?', id);
    world.run(
      `INSERT INTO share_revisions (share_id, revision, listing, min_app_version, content, content_sha256, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      id,
      stolen.revision,
      stolen.listing,
      stolen.min_app_version,
      stolen.content,
      stolen.content_sha256,
      stolen.size,
    );
    world.run(
      `UPDATE shares SET owner_key = ?, owner_name = 'Mallory', live_revision = ?, latest_revision = ? WHERE id = ?`,
      mallory.security.signMessage('key').publicKey,
      stolen.revision,
      stolen.revision,
      id,
    );

    const preview = await bob.shares.preview(id);
    expect(preview.ownerChanged).toBe(true);
    expect(previewBlocked(preview)).toBe(true);
    await expect(bob.shares.install({ id, decisions: decisionsFor(preview) })).rejects.toThrow('different publisher');
    expect(bob.code('autofarm')).toBe('console.log("v1")');
  });
});

describe('the marketplace', () => {
  const entry = async (device: Device, id: string) => (await device.shares.marketplace(true)).find((item) => item.id === id);

  test('lists approved shares, ready to install without downloading the record again', async () => {
    const { id, revision } = await publish('public');
    const listed = await bob.shares.marketplace();
    expect(listed).toEqual([
      expect.objectContaining({
        id,
        revision,
        kind: 'plugin',
        canInstall: true,
        listing: expect.objectContaining({ title: 'autofarm', description: 'Farms for you' }),
        publisher: expect.objectContaining({ name: 'Alice', official: false }),
      }),
    ]);

    world.requests.length = 0;
    const { state, preview } = await bob.install(id);
    await world.settled(bob);
    expect(preview).toMatchObject({ reviewed: true, status: 'live' });
    expect(state.installed[id].listed).toBe(true);
    expect(world.requests).toEqual([`GET /api/s/${id}/content/${revision}`, `POST /api/s/${id}/install`]);
  });

  test('asks the server once per interval and revalidates with an ETag, also after a restart', async () => {
    await publish('public');
    world.requests.length = 0;
    await bob.shares.marketplace();
    await bob.shares.marketplace();
    expect(world.requests).toEqual(['GET /api/market']);

    world.advance(MARKET_REFRESH_INTERVAL + 1);
    expect(await bob.shares.marketplace()).toHaveLength(1);
    expect(world.requests).toHaveLength(2);

    const etag = world.row(`SELECT value FROM meta WHERE key = 'market_version'`)!.value;
    bob.shares['marketStore'].save();
    const restarted = world.device('Bob', { dir: bob.dir });
    const fetchSpy = jest.spyOn(global, 'fetch');
    const entries = await restarted.shares.marketplace();
    expect(entries).toHaveLength(1);
    expect((fetchSpy.mock.calls[0][1]?.headers as Record<string, string>)['if-none-match']).toBe(`"m${etag}"`);
  });

  test('leaves out entries without a valid official approval', async () => {
    const { id, revision } = await publish('public');
    const second = world.device('Mallory');
    await second.writePlugin('fake', 'steal()');
    const fake = await second.shares.create({ kind: 'plugin', ref: 'fake', visibility: 'public' });
    // A compromised Worker lists it, reusing the approval of another share.
    const { approval } = world.row('SELECT approval FROM share_revisions WHERE share_id = ?', id)!;
    world.run('UPDATE share_revisions SET approval = ? WHERE share_id = ?', approval, fake.id);
    world.run(`UPDATE shares SET status = 'live', live_revision = ? WHERE id = ?`, fake.revision, fake.id);

    const ids = (await bob.shares.marketplace(true)).map((item) => item.id);
    expect(ids).toEqual([id]);
    expect((await bob.shares.preview(fake.id)).reviewed).toBe(false);
    expect(revision).toBeTruthy();
  });

  test('an approved update installs itself', async () => {
    const { id } = await publish('public');
    await bob.install(id);
    const next = await publishUpdate(id, 'console.log("v2")');

    await bob.refresh();
    await world.settled(bob);
    expect(bob.code('autofarm')).toBe('console.log("v2")');
    expect(installedOn(bob, id)).toMatchObject({ revision: next.revision, latestRevision: next.revision, listed: true });
    expect(installs(id)).toBe(1);
  });

  test('opening the catalog is enough to get an approved update', async () => {
    const { id } = await publish('public');
    await bob.shares.marketplace();
    await bob.install(id);
    await publishUpdate(id, 'console.log("v2")');

    await bob.shares.marketplace(true);
    await world.settled(bob);
    expect(bob.code('autofarm')).toBe('console.log("v2")');
  });

  test('an update waiting for review never reaches users', async () => {
    const { id, revision } = await publish('public');
    await bob.install(id);
    await alice.writePlugin('autofarm', 'console.log("unreviewed")');
    await alice.shares.update(id);

    await bob.refresh();
    await bob.shares.marketplace(true);
    await world.settled(bob);
    expect(bob.code('autofarm')).toBe('console.log("v1")');
    expect(installedOn(bob, id).revision).toBe(revision);
    expect((await bob.shares.preview(id)).revision).toBe(revision);
  });

  test('automatic updates can be turned off', async () => {
    const { id } = await publish('public');
    await bob.install(id);
    await publishUpdate(id, 'console.log("v2")');
    bob.settings.setSharedAppSetting('autoUpdateShares', false);

    const { installed, appVersion } = await bob.refresh();
    await world.settled(bob);
    expect(bob.code('autofarm')).toBe('console.log("v1")');
    expect(shareUpdateAvailable(installed[id], appVersion)).toBe(true);
  });

  test('never overwrites a plugin that is not from this share', async () => {
    const { id } = await publish('public');
    await bob.install(id);
    await publishUpdate(id, 'console.log("v2")');
    bob.security.setProvenance('autofarm', { ...bob.security.getProvenance('autofarm'), importSource: undefined });

    await bob.refresh();
    await world.settled(bob);
    expect(bob.code('autofarm')).toBe('console.log("v1")');
  });

  test('does not auto-update a share that lost its approval', async () => {
    const { id } = await publish('public');
    await bob.install(id);
    await publishUpdate(id, 'console.log("v2")');
    world.run('UPDATE share_revisions SET approval = NULL WHERE share_id = ?', id);

    await bob.refresh();
    await world.settled(bob);
    expect(bob.code('autofarm')).toBe('console.log("v1")');
  });

  test('a withdrawn share stops updating by itself', async () => {
    const { id } = await publish('public');
    await bob.install(id);
    await alice.shares.setVisibility(id, 'link');
    await publishUpdate(id, 'console.log("v2")');

    const { installed } = await bob.refresh();
    await world.settled(bob);
    expect(installed[id].listed).toBe(false);
    expect(bob.code('autofarm')).toBe('console.log("v1")');
  });

  test('a takedown also closes the link, and leaves installed copies alone', async () => {
    const { id } = await publish('public');
    await bob.install(id);
    await reviewer.shares.report(id, 'Steals accounts');
    await reviewer.reject(id, 'Malware');

    expect(await entry(bob, id)).toBeUndefined();
    const carol = world.device('Carol');
    await expect(carol.shares.preview(id)).rejects.toMatchObject({ status: 404 });
    expect((await fetch(shareUrl(id))).status).toBe(404);

    const { installed, appVersion } = await bob.refresh();
    expect(installed[id].listed).toBe(false);
    expect(shareUpdateAvailable(installed[id], appVersion)).toBe(false);
    expect(bob.code('autofarm')).toBe('console.log("v1")');
  });

  test('a withdrawn takedown is a plain private link without a review badge', async () => {
    const { id } = await publish('public');
    await reviewer.shares.report(id, 'Steals accounts');
    await reviewer.reject(id, 'Malware');
    await alice.shares.setVisibility(id, 'link');
    expect(await bob.shares.preview(id)).toMatchObject({ reviewed: false, visibility: 'link' });
  });

  test('a new publisher name waits for review like everything else', async () => {
    const { id } = await publish('public');
    alice.security.setPublisherName('JNbot Team');
    await alice.writePlugin('autofarm', 'console.log("v2")');
    await alice.shares.update(id);
    expect((await entry(bob, id))?.publisher.name).toBe('Alice');

    await reviewer.approve(id);
    expect((await entry(bob, id))?.publisher.name).toBe('JNbot Team');
  });

  test('an installed profile checks for its update when it first loads', async () => {
    const source = alice.addProfile('alicesserver', 'Alice SMP');
    const { id } = await alice.shares.create({ kind: 'profile', ref: source, visibility: 'public' });
    await reviewer.approve(id);
    const { localRef } = await bob.install(id);
    await world.settled(bob);

    alice.addProfile(source, 'Alice SMP 2');
    await alice.shares.update(id);
    await reviewer.approve(id);
    world.advance(MARKET_REFRESH_INTERVAL + 1);
    await bob.shares.checkProfile(localRef);
    await world.settled(bob);
    expect(bob.settings.profiles.get(localRef).data.name).toBe('Alice SMP 2');

    world.requests.length = 0;
    await bob.shares.checkProfile(localRef);
    expect(world.requests).toEqual([]);
  });

  test('follows the catalog when a cached entry was replaced in the meantime', async () => {
    const { id } = await publish('public');
    await bob.shares.marketplace();
    const next = await publishUpdate(id, 'console.log("v2")');

    const preview = await bob.shares.preview(id);
    expect(preview.revision).toBe(next.revision);
    expect(preview.plugins[0].code).toContain('v2');
  });

  test('reports reach the review queue, once per person, and can be dismissed', async () => {
    const { id, revision } = await publish('public');
    await bob.shares.report(id, 'Steals accounts');
    await bob.shares.report(id, 'Steals accounts');

    const [reported] = await reviewer.shares.reviewQueue();
    expect(reported).toMatchObject({ id, reports: 1, reportReasons: ['Steals accounts'] });
    expect(await reviewer.shares.review({ id, revision, decision: 'dismiss-reports' })).toEqual([]);
    expect(await entry(bob, id)).toBeTruthy();
  });

  test('a private link cannot be reported', async () => {
    const { id } = await publish();
    await expect(bob.shares.report(id, 'Bad')).rejects.toMatchObject({ status: 404 });
  });

});

describe('migrating old profiles to the marketplace', () => {
  async function publishOfficial() {
    reviewer.addProfile('jartexnetwork', 'Jartex');
    const { id } = await reviewer.shares.create({ kind: 'profile', ref: 'jartexnetwork', visibility: 'public' });
    await reviewer.approve(id);
    return id;
  }

  test('an old local copy turns into the official profile and keeps its settings', async () => {
    const id = await publishOfficial();
    bob.addProfile('jartexnetwork', 'Old copy');
    bob.settings.updateProfileSettings('jartexnetwork', { path: ['altTags'], value: [{ name: 'mine', alts: [] }] });
    await bob.shares.adoptOfficialProfiles();

    expect(bob.settings.profiles.get('jartexnetwork')).toMatchObject({ share: { id, official: true }, data: { name: 'Jartex' } });
    expect(bob.settings.profiles.list).toHaveLength(1);
    expect(bob.settings.getProfileSettings('jartexnetwork').altTags).toEqual([{ name: 'mine', alts: [] }]);
    expect(installedOn(bob, id)).toMatchObject({ kind: 'profile', localRef: 'jartexnetwork', listed: true });
  });

  test('a server from the old server list comes back under its id', async () => {
    const id = await publishOfficial();
    bob.settings.setLegacyServers(['jartexnetwork', 'pikanetwork']);
    await bob.shares.adoptOfficialProfiles();

    expect(bob.settings.profiles.get('jartexnetwork').share).toEqual({ id, official: true });
    // No official share yet, so it waits for a later start.
    expect(bob.settings.legacyServers).toEqual(['pikanetwork']);
  });

  test('a converted profile keeps following official updates under the same id', async () => {
    const id = await publishOfficial();
    bob.addProfile('jartexnetwork', 'Old copy');
    await bob.shares.adoptOfficialProfiles();
    await world.settled(bob);

    reviewer.addProfile('jartexnetwork', 'Jartex 2');
    await reviewer.shares.update(id);
    await reviewer.approve(id);
    await bob.refresh();
    await world.settled(bob);
    expect(bob.settings.profiles.get('jartexnetwork')).toMatchObject({ share: { id, official: true }, data: { name: 'Jartex 2' } });
    expect(bob.settings.profiles.list).toHaveLength(1);
  });

  test('later starts neither ask again nor install again', async () => {
    await publishOfficial();
    bob.addProfile('jartexnetwork', 'Old copy');
    bob.addProfile('mylocalserver', 'Mine');
    await bob.shares.adoptOfficialProfiles();
    await world.settled(bob);

    world.requests.length = 0;
    await bob.shares.adoptOfficialProfiles();
    expect(world.requests).toEqual([]);
    expect(bob.settings.profiles.get('mylocalserver').share).toBeUndefined();
  });

  test('an app too old for the official profile tries again after updating', async () => {
    await publishOfficial();
    bob.settings.setLegacyServers(['jartexnetwork']);
    jest.spyOn(bob.shares as any, 'appVersion', 'get').mockReturnValue('0.0.1');
    await bob.shares.adoptOfficialProfiles();
    expect(bob.settings.legacyServers).toEqual(['jartexnetwork']);

    bob.settings.appSettingsStorage.save();
    const updated = world.device('Bob', { dir: bob.dir });
    await updated.shares.adoptOfficialProfiles();
    expect(updated.settings.legacyServers).toEqual([]);
    expect(updated.settings.profiles.get('jartexnetwork')).toBeTruthy();
  });

  test('only official profiles convert: a public share with the same id does not', async () => {
    alice.addProfile('jartexnetwork', 'Evil Jartex');
    const { id } = await alice.shares.create({ kind: 'profile', ref: 'jartexnetwork', visibility: 'public' });
    await reviewer.approve(id);

    bob.addProfile('jartexnetwork', 'My Jartex');
    await bob.shares.adoptOfficialProfiles();
    expect(bob.settings.profiles.get('jartexnetwork')).toMatchObject({ data: { name: 'My Jartex' } });
    expect(bob.settings.profiles.get('jartexnetwork').share).toBeUndefined();
  });

  test('a maintainer keeps editing the official profile they published', async () => {
    await publishOfficial();
    await reviewer.shares.adoptOfficialProfiles();
    expect(reviewer.settings.profiles.get('jartexnetwork').share).toBeUndefined();
  });
});

describe('plugins inside chains and triggers', () => {
  const trigger = (pluginId: string) => ({
    id: 'rule',
    event: 'chat',
    enabled: true,
    actions: [{ type: 'scriptAction', id: pluginId }],
  });

  /** A trigger running the plugin `kitclaim`, which only exists inside the official profile. */
  async function shareProfilePluginTrigger() {
    await reviewer.writePlugin('kitclaim', 'console.log("official")', { scriptType: 'action' });
    reviewer.addProfile('jartexnetwork', 'Jartex');
    reviewer.settings.profiles.upsert({
      ...reviewer.settings.profiles.get('jartexnetwork'),
      scripts: [{ id: 'kitclaim', pluginId: 'kitclaim', source: { kind: 'plugin', pluginId: 'kitclaim' } }],
    });
    const official = await reviewer.shares.create({ kind: 'profile', ref: 'jartexnetwork', visibility: 'public' });
    await reviewer.approve(official.id);

    await alice.install(official.id);
    expect(alice.macros.findPlugin('kitclaim')).toBeFalsy();
    alice.settings.updateProfileSettings('jartexnetwork', { path: ['triggers'], value: [trigger('kitclaim')] });
    const { id } = await alice.shares.create({ kind: 'trigger', ref: 'rule', profileKey: 'jartexnetwork' });
    return { id, officialId: official.id };
  }

  const pluginIds = (id: string) => {
    const { content } = world.row('SELECT content FROM share_revisions WHERE share_id = ?', id)!;
    return JSON.parse(gunzipSync(Buffer.from(content)).toString('utf8')).plugins.map((item: any) => item.source.pluginId);
  };

  test('a profile plugin always travels with the share', async () => {
    const { id } = await shareProfilePluginTrigger();
    expect(pluginIds(id)).toEqual(['kitclaim']);
    expect(await alice.shares.hasChanges(id)).toBe(false);
  });

  test('on a profile that has the plugin, nothing gets added', async () => {
    const { id, officialId } = await shareProfilePluginTrigger();
    await bob.install(officialId);
    const scripts = bob.settings.profiles.get('jartexnetwork').scripts;

    const { preview } = await bob.install(id, { profileKey: 'jartexnetwork' });
    expect(preview.plugins).toEqual([]);
    expect(bob.macros.findPlugin('kitclaim')).toBeFalsy();
    expect(bob.settings.profiles.get('jartexnetwork').scripts).toEqual(scripts);
    expect(bob.settings.getProfileSettings('jartexnetwork').triggers[0].actions).toEqual([{ type: 'scriptAction', id: 'kitclaim' }]);
  });

  test('on a profile without it, the profile plugin installs as a normal plugin', async () => {
    const { id } = await shareProfilePluginTrigger();
    const profile = bob.addProfile('other');

    const { preview } = await bob.install(id, { profileKey: profile });
    expect(preview.plugins).toEqual([expect.objectContaining({ pluginId: 'kitclaim', state: 'new', verification: 'trusted' })]);
    expect(bob.code('kitclaim')).toBe('console.log("official")');
    expect(bob.settings.profiles.get(profile).scripts ?? []).toEqual([]);
    expect(bob.settings.getProfileSettings(profile).triggers[0].actions).toEqual([{ type: 'scriptAction', id: 'kitclaim' }]);
  });

  test('your own plugin with the same id is never overwritten or offered as an update', async () => {
    const { id } = await shareProfilePluginTrigger();
    await bob.writePlugin('kitclaim', 'console.log("mine")');
    const profile = bob.addProfile('other');

    const { preview } = await bob.install(id, { profileKey: profile });
    expect(preview.plugins).toEqual([]);
    expect(bob.code('kitclaim')).toBe('console.log("mine")');
  });

  test('a plugin you already got from elsewhere is left alone too', async () => {
    const { id: pluginShare } = await publish();
    await bob.install(pluginShare);

    const carol = world.device('Carol');
    await carol.writePlugin('autofarm', 'console.log("carols")');
    const source = carol.addProfile('carols');
    carol.settings.updateProfileSettings(source, { path: ['triggers'], value: [trigger('autofarm')] });
    const { id } = await carol.shares.create({ kind: 'trigger', ref: 'rule', profileKey: source });

    const { preview } = await bob.install(id, { profileKey: bob.addProfile('one') });
    expect(preview.plugins).toEqual([]);
    expect(bob.code('autofarm')).toBe('console.log("v1")');
  });

  test('installing into a second profile does not install the plugin again', async () => {
    await alice.writePlugin('autofarm', 'console.log("v1")');
    const source = alice.addProfile('alices');
    alice.settings.updateProfileSettings(source, { path: ['triggers'], value: [trigger('autofarm')] });
    const { id } = await alice.shares.create({ kind: 'trigger', ref: 'rule', profileKey: source });

    await bob.install(id, { profileKey: bob.addProfile('one') });
    const { preview } = await bob.install(id, { profileKey: bob.addProfile('two') });
    expect(preview.plugins).toEqual([]);
  });

  describe('updates', () => {
    async function publishChain(visibility: 'link' | 'public' = 'link') {
      const source = alice.addProfile('alices');
      await alice.writePlugin('step1', 'console.log("v1")');
      alice.settings.updateProfileSettings(source, [
        {
          path: ['scripts', 'chains', 'mychain'],
          value: { id: 'mychain', name: 'Daily', chains: [{ id: 1, name: 'Go', scriptId: 'step1' }] },
        },
        { path: ['scripts', 'mychain'], value: { name: 'Daily' } },
      ]);
      const owned = await alice.shares.create({ kind: 'chain', ref: 'mychain', profileKey: source, visibility });
      if (visibility === 'public') await reviewer.approve(owned.id);
      return { ...owned, source };
    }

    async function publishPluginFix(id: string, visibility: 'link' | 'public' = 'link') {
      await alice.writePlugin('step1', 'console.log("fixed")');
      await alice.shares.update(id);
      if (visibility === 'public') await reviewer.approve(id);
    }

    test('shows a newer plugin, and keeps yours unless you pick Update', async () => {
      const { id } = await publishChain();
      const profile = bob.addProfile('one');
      await bob.install(id, { profileKey: profile });
      await publishPluginFix(id);
      await bob.shares.checkShare(id);

      const preview = await bob.shares.preview({ link: id, profileKey: profile });
      expect(preview.plugins).toEqual([expect.objectContaining({ pluginId: 'step1', state: 'update' })]);
      expect(previewNeedsCheck(preview)).toBe(true);

      await bob.shares.install({ id, profileKey: profile, decisions: decisionsFor(preview) });
      expect(bob.code('step1')).toBe('console.log("v1")');
    });

    test('Update installs the newer plugin', async () => {
      const { id } = await publishChain();
      const profile = bob.addProfile('one');
      await bob.install(id, { profileKey: profile });
      await publishPluginFix(id);
      await bob.shares.checkShare(id);

      await bob.install(id, { profileKey: profile, action: 'replace' });
      expect(bob.code('step1')).toBe('console.log("fixed")');
      expect((await bob.shares.preview({ link: id, profileKey: profile })).plugins).toEqual([]);
    });

    test('an update from someone else than where you got the plugin is not offered', async () => {
      const { id } = await publishChain();
      await bob.writePlugin('step1', 'console.log("mine")');
      await bob.install(id, { profileKey: bob.addProfile('one') });
      await publishPluginFix(id);

      const { plugins } = await bob.shares.preview({ link: id, profileKey: 'one' });
      expect(plugins).toEqual([]);
    });

    test('with a plugin update a marketplace chain waits for you, instead of updating around it', async () => {
      const { id } = await publishChain('public');
      const profile = bob.addProfile('one');
      const { state } = await bob.install(id, { profileKey: profile });
      const key = shareInstallKey(id, 'chain', profile);
      await publishPluginFix(id, 'public');

      const { installed, appVersion } = await bob.refresh();
      await world.settled(bob);
      expect(installed[key].revision).toBe(state.installed[key].revision);
      expect(shareUpdateAvailable(installed[key], appVersion)).toBe(true);
      expect(bob.code('step1')).toBe('console.log("v1")');
    });

    test('a marketplace chain whose plugins did not change updates by itself', async () => {
      const { id, source } = await publishChain('public');
      const profile = bob.addProfile('one');
      const { localRef } = await bob.install(id, { profileKey: profile });
      alice.settings.updateProfileSettings(source, { path: ['scripts', 'mychain', 'name'], value: 'Daily 2' });
      await alice.shares.update(id);
      await reviewer.approve(id);

      await bob.refresh();
      await world.settled(bob);
      expect(bob.settings.getProfileSettings(profile).scripts.chains[localRef].name).toBe('Daily 2');
    });
  });
});

describe('tampering', () => {
  const unpack = (content: Uint8Array) => JSON.parse(gunzipSync(Buffer.from(content)).toString('utf8'));
  const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

  /** Rewrites the stored envelope like a compromised server would, keeping the hashes right. */
  function rewrite(id: string, change: (envelope: any) => void) {
    const { content, revision } = world.row('SELECT content, revision FROM share_revisions WHERE share_id = ?', id)!;
    const envelope = unpack(content);
    change(envelope);
    const packed = gzipSync(JSON.stringify(envelope));
    world.run(
      'UPDATE share_revisions SET content = ?, content_sha256 = ? WHERE share_id = ? AND revision = ?',
      packed,
      sha(packed),
      id,
      revision,
    );
  }

  const refused = async (id: string, message: string) => {
    await expect(bob.shares.preview(id)).rejects.toThrow(message);
    expect(bob.macros.findPlugin('autofarm')).toBeFalsy();
  };

  test('refuses content that does not match the record', async () => {
    const { id } = await publish();
    world.run(`UPDATE share_revisions SET content_sha256 = 'nope' WHERE share_id = ?`, id);
    await refused(id, 'could not be verified');
  });

  test('refuses a changed payload', async () => {
    const { id } = await publish();
    rewrite(id, (envelope) => {
      envelope.plugins[0].bundle.code.code = 'steal()';
    });
    await refused(id, 'modified after it was signed');
  });

  test('refuses a listing that claims another version or target than the signed content', async () => {
    const { id } = await publish();
    const { listing } = world.row('SELECT listing FROM share_revisions WHERE share_id = ?', id)!;
    world.run('UPDATE share_revisions SET listing = ? WHERE share_id = ?', JSON.stringify({ ...JSON.parse(listing), servers: ['x'] }), id);
    await refused(id, 'modified after it was signed');
  });

  test('refuses content signed by someone else than the owner', async () => {
    const { id } = await publish();
    world.run(`UPDATE shares SET owner_key = 'someone-else' WHERE id = ?`, id);
    await refused(id, 'modified after it was signed');
  });

  test('refuses content from a newer format', async () => {
    const { id } = await publish();
    rewrite(id, (envelope) => {
      envelope.version = 3;
    });
    await refused(id, 'format this JNbot version does not support');
  });

  test('refuses damaged content', async () => {
    const { id } = await publish();
    const garbage = Buffer.from([0x1f, 0x8b, 1, 2, 3]);
    world.run('UPDATE share_revisions SET content = ?, content_sha256 = ? WHERE share_id = ?', garbage, sha(garbage), id);
    await refused(id, 'damaged');
  });
});
