import { SHARE_ORIGIN, shareStatusLabel, shareUrl } from '../../src/common/share';
import { cleanupUserData } from './helpers';
import { ShareWorld, type Device } from './shareWorld';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let world: ShareWorld;
let alice: Device;
let reviewer: Device;

beforeEach(() => {
  world = new ShareWorld();
  alice = world.device('Alice');
  reviewer = world.device('JNbot', { reviewer: true });
});
afterEach(() => world.close());
afterAll(cleanupUserData);

const listed = async (device: Device, id: string) => (await device.shares.marketplace(true)).some((entry) => entry.id === id);

async function publishPlugin(visibility: 'link' | 'public' = 'link', code = 'console.log("v1")') {
  await alice.writePlugin('autofarm', code, { description: 'Farms for you', scriptType: 'action' });
  return alice.shares.create({ kind: 'plugin', ref: 'autofarm', visibility });
}

describe('publishing a private link', () => {
  test('uploads a signed share that anyone with the link can read', async () => {
    const owned = await publishPlugin();
    expect(owned).toMatchObject({ kind: 'plugin', ref: 'autofarm', title: 'autofarm', visibility: 'link', status: 'none' });
    expect(alice.shares.state().owned[owned.id]).toEqual(owned);
    expect(alice.published.at(-1)?.owned[owned.id]).toEqual(owned);

    const stored = world.row('SELECT * FROM shares WHERE id = ?', owned.id)!;
    expect(stored).toMatchObject({ owner_name: 'Alice', visibility: 'link', live_revision: owned.revision });

    const response = await fetch(shareUrl(owned.id, SHARE_ORIGIN));
    expect(await response.text()).toContain('Shared by <strong>Alice</strong>');
  });

  test('sharing the same item twice keeps one share', async () => {
    const first = await publishPlugin();
    const second = await alice.shares.create({ kind: 'plugin', ref: 'autofarm' });
    expect(second.id).toBe(first.id);
    expect(world.row('SELECT COUNT(*) AS count FROM shares')!.count).toBe(1);
  });

  test('tells whether there are unpublished edits', async () => {
    const { id } = await publishPlugin();
    expect(await alice.shares.hasChanges(id)).toBe(false);

    await alice.writePlugin('autofarm', 'console.log("v2")', { description: 'Farms for you', scriptType: 'action' });
    expect(await alice.shares.hasChanges(id)).toBe(true);

    await alice.shares.update(id);
    expect(await alice.shares.hasChanges(id)).toBe(false);
  });

  test('reports a deleted local item, which can then only be deleted', async () => {
    const { id } = await publishPlugin();
    await alice.macros.delete('autofarm');
    alice.macros.invalidateLocalCache();
    expect(await alice.shares.hasChanges(id)).toBe('deleted');
    expect((await alice.shares.remove(id)).owned[id]).toBeUndefined();
  });

  test('an update replaces the link at once', async () => {
    const { id, revision } = await publishPlugin();
    await alice.writePlugin('autofarm', 'console.log("v2")');
    const updated = await alice.shares.update(id);
    expect(updated.revision).not.toBe(revision);
    expect(updated).toMatchObject({ status: 'none', pending: false });
    expect(world.row('SELECT live_revision FROM shares WHERE id = ?', id)!.live_revision).toBe(updated.revision);
    expect(world.row('SELECT COUNT(*) AS count FROM share_revisions WHERE share_id = ?', id)!.count).toBe(1);
  });

  test('deleting removes it from the server', async () => {
    const { id } = await publishPlugin();
    await alice.shares.remove(id);
    expect(world.row('SELECT id FROM shares WHERE id = ?', id)).toBeUndefined();
    await expect(alice.shares.update(id)).rejects.toThrow('Share not found.');
  });

  test('deleting a share that is already gone from the server still forgets it', async () => {
    const { id } = await publishPlugin();
    world.run('DELETE FROM shares WHERE id = ?', id);
    expect((await alice.shares.remove(id)).owned[id]).toBeUndefined();
  });

  test('shows the limit from the server when there are too many links', async () => {
    for (let index = 0; index < 10; index += 1) {
      await alice.writePlugin(`plugin${index}`, 'console.log(1)');
      await alice.shares.create({ kind: 'plugin', ref: `plugin${index}` });
    }
    await alice.writePlugin('onemore', 'console.log(1)');
    await expect(alice.shares.create({ kind: 'plugin', ref: 'onemore' })).rejects.toThrow('at most 10 private shares');
    expect(Object.keys(alice.shares.state().owned)).toHaveLength(10);
  });

  test('another publisher cannot touch it, whatever their app claims', async () => {
    const { id } = await publishPlugin();
    const mallory = world.device('Mallory');
    await mallory.writePlugin('autofarm', 'steal()');
    const forged = await mallory.shares.create({ kind: 'plugin', ref: 'autofarm' });
    (mallory.shares as any).file.owned[id] = { ...forged, id };
    await expect(mallory.shares.update(id)).rejects.toMatchObject({ status: 403 });
    await expect(mallory.shares.remove(id)).rejects.toMatchObject({ status: 403 });
    await expect(mallory.shares.setVisibility(id, 'public')).rejects.toMatchObject({ status: 403 });
  });

  test.each([
    ['name', { name: 'n'.repeat(150) }],
    ['description', { description: 'd'.repeat(2500) }],
  ])('a very long plugin %s can still be published', async (_field, info) => {
    await alice.writePlugin('longplugin', 'console.log(1)', info);
    const owned = await alice.shares.create({ kind: 'plugin', ref: 'longplugin' });
    expect(owned.id).toBeTruthy();
  });

  test('a very long profile name can still be published', async () => {
    const profile = alice.addProfile('longprofile', 'p'.repeat(150));
    const owned = await alice.shares.create({ kind: 'profile', ref: profile });
    expect(owned.title).toHaveLength(100);
  });

  test('a long trigger filter can still be published, and keeps working for the receiver', async () => {
    const profile = alice.addProfile('myserver');
    const filter = 'f'.repeat(600);
    alice.settings.updateProfileSettings(profile, {
      path: ['triggers'],
      value: [{ id: 'long', event: 'chat', enabled: true, filter, actions: [{ type: 'notification' }] }],
    });
    const { id } = await alice.shares.create({ kind: 'trigger', ref: 'long', profileKey: profile });

    const bob = world.device('Bob');
    const target = bob.addProfile('one');
    await bob.install(id, { profileKey: target });
    expect(bob.settings.getProfileSettings(target).triggers[0].filter).toBe(filter);
  });

  test('hosts data URI banners and links image URLs', async () => {
    await alice.writePlugin('hosted', 'console.log(1)', { banner: PNG });
    const hosted = await alice.shares.create({ kind: 'plugin', ref: 'hosted' });
    const banner = await fetch(`${SHARE_ORIGIN}/api/s/${hosted.id}/banner/${hosted.revision}`);
    expect(banner.headers.get('content-type')).toBe('image/png');

    await alice.writePlugin('linked', 'console.log(1)', { banner: 'https://example.com/banner.png' });
    const linked = await alice.shares.create({ kind: 'plugin', ref: 'linked' });
    const { listing } = world.row('SELECT listing FROM share_revisions WHERE share_id = ?', linked.id)!;
    expect(JSON.parse(listing).bannerUrl).toBe('https://example.com/banner.png');
  });
});

describe('publishing to the marketplace', () => {
  test('stays off the catalog until a reviewer approves it', async () => {
    const owned = await publishPlugin('public');
    expect(shareStatusLabel(owned).label).toBe('Pending review');
    expect(await listed(alice, owned.id)).toBe(false);

    const queue = await reviewer.shares.reviewQueue();
    expect(queue.find((entry) => entry.id === owned.id)).toMatchObject({ status: 'pending', publisher: { name: 'Alice' } });
    const preview = await reviewer.shares.preview({ link: owned.id, revision: owned.revision });
    expect(preview).toMatchObject({ reviewing: true, reviewed: false });
    expect(preview.plugins[0].code).toContain('v1');

    await reviewer.approve(owned.id);
    expect(await listed(alice, owned.id)).toBe(true);
    const { owned: mine } = await alice.refresh();
    expect(shareStatusLabel(mine[owned.id]).label).toBe('On marketplace');
  });

  test('only reviewers get to the review queue', async () => {
    await expect(alice.shares.reviewQueue()).rejects.toThrow('Only JNbot reviewers');
    await expect(alice.shares.review({ id: 'AAAAAAAAAA', revision: 'x', decision: 'approve' })).rejects.toThrow(
      'Only JNbot reviewers',
    );
  });

  test('a reviewer cannot approve a revision that was replaced after the queue loaded', async () => {
    const { id } = await publishPlugin('public');
    const [entry] = await reviewer.shares.reviewQueue();
    await alice.writePlugin('autofarm', 'console.log("sneaky")');
    await alice.shares.update(id);
    await expect(reviewer.shares.review({ id, revision: entry.revision, decision: 'approve' })).rejects.toThrow(
      'no longer waiting',
    );
    expect(await listed(alice, id)).toBe(false);
  });

  test('a link can go public, and is only listed after review', async () => {
    const { id } = await publishPlugin();
    const pending = await alice.shares.setVisibility(id, 'public');
    expect(pending).toMatchObject({ visibility: 'public', status: 'pending', pending: false });
    await reviewer.approve(id);
    expect(await listed(alice, id)).toBe(true);
  });

  test('the approved version stays live while updates wait for review', async () => {
    const { id, revision } = await publishPlugin('public');
    await reviewer.approve(id);
    await alice.refresh();

    await alice.writePlugin('autofarm', 'console.log("v2")');
    const first = await alice.shares.update(id);
    expect(shareStatusLabel(first).label).toBe('Update in review');
    expect((await alice.shares.marketplace(true)).find((entry) => entry.id === id)?.revision).toBe(revision);

    // A second fix while the first still waits replaces the waiting one.
    await alice.writePlugin('autofarm', 'console.log("v3")');
    const second = await alice.shares.update(id);
    expect(shareStatusLabel(second).label).toBe('Update in review');
    expect(world.row('SELECT COUNT(*) AS count FROM share_revisions WHERE share_id = ?', id)!.count).toBe(2);

    await reviewer.approve(id);
    expect((await alice.shares.marketplace(true)).find((entry) => entry.id === id)?.revision).toBe(second.revision);
    expect(world.row('SELECT COUNT(*) AS count FROM share_revisions WHERE share_id = ?', id)!.count).toBe(1);
    const { owned } = await alice.refresh();
    expect(owned[id]).toMatchObject({ status: 'live', pending: false });
  });

  test('a rejected submission shows the note until the next upload', async () => {
    const { id } = await publishPlugin('public');
    await reviewer.reject(id, 'Please remove the webhook');
    const { owned } = await alice.refresh();
    expect(owned[id]).toMatchObject({ status: 'rejected', note: 'Please remove the webhook' });
    expect(shareStatusLabel(owned[id]).label).toBe('Rejected');

    await alice.writePlugin('autofarm', 'console.log("fixed")');
    expect(await alice.shares.update(id)).toMatchObject({ status: 'pending', note: null });
  });

  test('a rejected update keeps the approved version listed, and a new try is still an update', async () => {
    const { id, revision } = await publishPlugin('public');
    await reviewer.approve(id);
    await alice.writePlugin('autofarm', 'console.log("v2")');
    await alice.shares.update(id);
    await reviewer.reject(id, 'Not this one');

    const { owned } = await alice.refresh();
    expect(shareStatusLabel(owned[id]).label).toBe('Update rejected');
    expect((await alice.shares.marketplace(true)).find((entry) => entry.id === id)?.revision).toBe(revision);

    await alice.writePlugin('autofarm', 'console.log("v3")');
    expect(shareStatusLabel(await alice.shares.update(id)).label).toBe('Update in review');
  });

  test('withdrawing goes back to a private link', async () => {
    const { id } = await publishPlugin('public');
    await reviewer.approve(id);
    expect(await listed(alice, id)).toBe(true);

    expect(await alice.shares.setVisibility(id, 'link')).toMatchObject({ visibility: 'link', status: 'none', pending: false });
    expect(await listed(alice, id)).toBe(false);
    expect(world.row('SELECT visibility FROM shares WHERE id = ?', id)!.visibility).toBe('link');
  });

  test('sees a takedown, and forgets shares a reviewer deleted', async () => {
    const taken = await publishPlugin('public');
    await reviewer.approve(taken.id);
    await reviewer.shares.report(taken.id, 'Steals accounts');
    await reviewer.reject(taken.id, 'Malware');
    expect(await listed(alice, taken.id)).toBe(false);
    expect((await alice.refresh()).owned[taken.id]).toMatchObject({ status: 'rejected', note: 'Malware' });

    world.run('DELETE FROM shares WHERE id = ?', taken.id);
    expect((await alice.refresh()).owned[taken.id]).toBeUndefined();
  });

  test('at most five submissions wait for review', async () => {
    for (let index = 0; index < 5; index += 1) {
      await alice.writePlugin(`plugin${index}`, 'console.log(1)');
      await alice.shares.create({ kind: 'plugin', ref: `plugin${index}`, visibility: 'public' });
    }
    await alice.writePlugin('onemore', 'console.log(1)');
    await expect(alice.shares.create({ kind: 'plugin', ref: 'onemore', visibility: 'public' })).rejects.toThrow(
      'at most 5 shares waiting',
    );
  });
});

describe('what a share contains', () => {
  const trigger = {
    id: 'mine',
    event: 'chat',
    enabled: true,
    filter: 'hello',
    alts: ['SecretAlt'],
    tags: ['private-tag'],
    actions: [
      { type: 'discord', webhook: 'https://discord.com/api/webhooks/secret' },
      { type: 'log', directory: '/Users/alice/logs' },
      { type: 'chat', message: 'hi' },
    ],
  };

  const envelopeOf = async (id: string) => {
    const { revision } = (world.row('SELECT latest_revision AS revision FROM shares WHERE id = ?', id) as { revision: string });
    const { gunzipSync } = require('zlib');
    const { content } = world.row('SELECT content FROM share_revisions WHERE share_id = ? AND revision = ?', id, revision)!;
    return gunzipSync(Buffer.from(content)).toString('utf8') as string;
  };

  test('a trigger leaves webhooks, folders, alts and tags at home', async () => {
    const profile = alice.addProfile('myserver');
    alice.settings.updateProfileSettings(profile, { path: ['triggers'], value: [trigger] });
    const { id } = await alice.shares.create({ kind: 'trigger', ref: 'mine', profileKey: profile });

    const envelope = await envelopeOf(id);
    for (const secret of ['discord.com/api', '/Users/alice', 'SecretAlt', 'private-tag']) {
      expect(envelope).not.toContain(secret);
    }
    const { listing } = world.row('SELECT listing FROM share_revisions WHERE share_id = ?', id)!;
    expect(JSON.parse(listing).stripped).toEqual(['Discord webhook', 'Log directory', 'Selected alts and tags']);
  });

  test('a chain bundles the plugins it runs, and leaves the alt range at home', async () => {
    const profile = alice.addProfile('myserver');
    await alice.writePlugin('step1', 'console.log("step")');
    alice.settings.updateProfileSettings(profile, [
      { path: ['scripts', 'chains', 'mychain'], value: { id: 'mychain', name: 'Daily', chains: [{ id: 1, name: 'Go', scriptId: 'step1' }] } },
      { path: ['scripts', 'mychain'], value: { name: 'Daily', altRange: [1, 5], withTags: ['private-tag'] } },
    ]);
    const { id } = await alice.shares.create({ kind: 'chain', ref: 'mychain', profileKey: profile });

    const envelope = JSON.parse(await envelopeOf(id));
    expect(envelope.plugins.map((item: any) => item.source.pluginId)).toEqual(['step1']);
    expect(JSON.stringify(envelope)).not.toContain('private-tag');
    expect(envelope.meta.stripped).toEqual(['Alt range, tags and ignored alts']);
  });

  test('a bundle holds every plugin of the folder', async () => {
    await alice.writePlugin('one', 'console.log(1)');
    await alice.writePlugin('two', 'console.log(2)');
    alice.settings.updateShared({ pluginMetadata: { one: { folder: 'Farm' }, two: { folder: 'Farm' } } }, true);
    const { id, title } = await alice.shares.create({ kind: 'bundle', ref: 'Farm' });
    expect(title).toBe('Farm');
    const envelope = JSON.parse(await envelopeOf(id));
    expect(envelope.plugins.map((item: any) => item.source.pluginId).sort()).toEqual(['one', 'two']);
  });

  test('a profile can be shared without its alts or settings', async () => {
    const profile = alice.addProfile('myserver', 'My server');
    alice.settings.updateProfileSettings(profile, { path: ['altTags'], value: [{ name: 'private-tag', alts: ['SecretAlt'] }] });
    const owned = await alice.shares.create({ kind: 'profile', ref: profile });
    expect(owned.title).toBe('My server');
    const envelope = await envelopeOf(owned.id);
    expect(envelope).not.toContain('SecretAlt');
    expect(await alice.shares.hasChanges(owned.id)).toBe(false);
  });

  test('shares for specific servers carry them into the listing', async () => {
    await alice.writePlugin('targeted', 'console.log(1)');
    const { id } = await alice.shares.create({ kind: 'plugin', ref: 'targeted', servers: ['jartexnetwork', 'Not An Id!'] });
    const { listing } = world.row('SELECT listing FROM share_revisions WHERE share_id = ?', id)!;
    expect(JSON.parse(listing).servers).toEqual(['jartexnetwork']);
  });

  test('official profiles carry their server id, others do not', async () => {
    reviewer.addProfile('jartexnetwork', 'Jartex');
    const official = await reviewer.shares.create({ kind: 'profile', ref: 'jartexnetwork' });
    alice.addProfile('myserver');
    const custom = await alice.shares.create({ kind: 'profile', ref: 'myserver' });
    const listing = (id: string) => JSON.parse(world.row('SELECT listing FROM share_revisions WHERE share_id = ?', id)!.listing);
    expect(listing(official.id).serverId).toBe('jartexnetwork');
    expect(listing(custom.id).serverId).toBeUndefined();
  });
});
