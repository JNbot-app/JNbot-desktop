import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  approvalMessage,
  shareRequestMessage,
  type ShareListing,
  type ShareRecord,
  type ShareVisibility,
} from '../../../src/common/share';
import { sha256Hex } from '../src/auth';

const ORIGIN = 'https://share.test.workers.dev';
/** Private half of OFFICIAL_PUBLIC_KEYS in wrangler.test.jsonc. */
const REVIEWER_PKCS8 = 'MC4CAQAwBQYDK2VwBCIEIHtE00XzbP9wt22JrCRqizMJ_5fkSTQdYOJwlthQuEk4';
const REVIEWER_KEY = 'MCowBQYDK2VwAyEARd-8n5aswVoHg5HDMovW5rdnagl7gF5a26E0ir3Tb74';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

interface Publisher {
  publicKey: string;
  privateKey: CryptoKey;
}

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));

async function newPublisher(): Promise<Publisher> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return {
    publicKey: toBase64Url((await crypto.subtle.exportKey('spki', pair.publicKey)) as ArrayBuffer),
    privateKey: pair.privateKey,
  };
}

async function reviewerKey(): Promise<Publisher> {
  return {
    publicKey: REVIEWER_KEY,
    privateKey: await crypto.subtle.importKey('pkcs8', fromBase64Url(REVIEWER_PKCS8), { name: 'Ed25519' }, false, [
      'sign',
    ]),
  };
}

const sign = async (publisher: Publisher, message: string) =>
  toBase64Url(await crypto.subtle.sign('Ed25519', publisher.privateKey, new TextEncoder().encode(message)));

function listing(title = 'My plugin', name = 'Alice'): ShareListing {
  return {
    kind: 'plugin',
    title,
    description: 'Does things',
    items: [{ name: title, type: 'action' }],
    details: [],
    minAppVersion: '3.3.1',
    servers: [],
    publisherName: name,
  };
}

const gzip = async (text: string) =>
  new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());

async function upload(
  value: ShareListing,
  visibility: ShareVisibility = 'link',
  banner?: Uint8Array<ArrayBuffer>,
  content?: Uint8Array<ArrayBuffer>,
) {
  const form = new FormData();
  form.set('listing', JSON.stringify(value));
  form.set('visibility', visibility);
  form.set('content', new Blob([content ?? (await gzip(JSON.stringify({ title: value.title })))]));
  if (banner) form.set('banner', new Blob([banner]));
  const serialized = new Response(form);
  return {
    body: new Uint8Array(await serialized.arrayBuffer()),
    contentType: serialized.headers.get('content-type')!,
  };
}

async function signedFetch(
  publisher: Publisher,
  method: string,
  path: string,
  body: Uint8Array<ArrayBuffer> | string = '',
  contentType = 'application/json',
) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const message = shareRequestMessage(method, path, timestamp, nonce, await sha256Hex(bytes));
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    body: bytes.byteLength ? bytes : undefined,
    headers: {
      'content-type': contentType,
      'x-jnbot-key': publisher.publicKey,
      'x-jnbot-timestamp': String(timestamp),
      'x-jnbot-nonce': nonce,
      'x-jnbot-signature': await sign(publisher, message),
    },
  });
}

async function put(publisher: Publisher, path: string, value: ShareListing, visibility?: ShareVisibility, banner?: Uint8Array<ArrayBuffer>) {
  const { body, contentType } = await upload(value, visibility, banner);
  return signedFetch(publisher, 'PUT', path, body, contentType);
}

async function create(publisher: Publisher, value = listing(), visibility?: ShareVisibility, banner?: Uint8Array<ArrayBuffer>) {
  const response = await put(publisher, '/api/s', value, visibility, banner);
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; revision: string; url: string };
}

const record = async (id: string) => (await (await SELF.fetch(`${ORIGIN}/api/s/${id}`)).json()) as ShareRecord;

async function approve(reviewer: Publisher, id: string, revision: string) {
  const row = await env.DB.prepare('SELECT listing, content_sha256 FROM share_revisions WHERE share_id = ? AND revision = ?')
    .bind(id, revision)
    .first<{ listing: string; content_sha256: string }>();
  const approval = await sign(reviewer, approvalMessage(id, revision, await sha256Hex(row!.listing), row!.content_sha256));
  return signedFetch(reviewer, 'POST', `/api/s/${id}/review`, JSON.stringify({ revision, decision: 'approve', approval }));
}

const market = () => SELF.fetch(`${ORIGIN}/api/market`);

describe('share worker', () => {
  let alice: Publisher;
  let bob: Publisher;
  let reviewer: Publisher;
  beforeAll(async () => {
    alice = await newPublisher();
    bob = await newPublisher();
    reviewer = await reviewerKey();
  });

  it('creates a link and serves the listing, content and landing page', async () => {
    const created = await create(alice);
    expect(created.id).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(created.url).toBe(`${ORIGIN}/s/${created.id}`);

    const served = await record(created.id);
    expect(served.revision).toBe(created.revision);
    expect(JSON.parse(served.listing).title).toBe('My plugin');
    expect(served.visibility).toBe('link');

    const content = await SELF.fetch(`${ORIGIN}/api/s/${created.id}/content/${created.revision}`);
    expect(content.headers.get('cache-control')).toContain('immutable');
    const text = await new Response(content.body!.pipeThrough(new DecompressionStream('gzip'))).text();
    expect(JSON.parse(text).title).toBe('My plugin');

    const html = await (await SELF.fetch(`${ORIGIN}/s/${created.id}`)).text();
    expect(html).toContain(`jnbot://share/${created.id}`);
    expect(html).toContain('Shared by <strong>Alice</strong>');
  });

  it('escapes user text on the landing page', async () => {
    const created = await create(alice, listing('<script>alert(1)</script>'));
    const html = await (await SELF.fetch(`${ORIGIN}/s/${created.id}`)).text();
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('rejects bad signatures, bad listings and ungzipped content', async () => {
    const { body, contentType } = await upload(listing());
    const forged = await SELF.fetch(`${ORIGIN}/api/s`, {
      method: 'PUT',
      body,
      headers: {
        'content-type': contentType,
        'x-jnbot-key': alice.publicKey,
        'x-jnbot-timestamp': String(Date.now()),
        'x-jnbot-nonce': 'n',
        'x-jnbot-signature': 'AAAA',
      },
    });
    expect(forged.status).toBe(401);

    expect((await put(alice, '/api/s', { ...listing(), minAppVersion: 'latest' })).status).toBe(400);
    expect((await put(alice, '/api/s', { ...listing(), servers: ['Not An Id!'] })).status).toBe(400);

    const raw = await upload(listing(), 'link', undefined, new TextEncoder().encode('{}'));
    expect((await signedFetch(alice, 'PUT', '/api/s', raw.body, raw.contentType)).status).toBe(400);
  });

  it('serves sniffed banners and refuses SVG', async () => {
    const created = await create(alice, listing(), 'link', PNG);
    const banner = await SELF.fetch(`${ORIGIN}/api/s/${created.id}/banner/${created.revision}`);
    expect(banner.headers.get('content-type')).toBe('image/png');
    expect(banner.headers.get('content-security-policy')).toBe("default-src 'none'");

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await put(alice, '/api/s', listing(), 'link', svg)).status).toBe(400);
  });

  it('only lets the owner update a link, which switches at once', async () => {
    const created = await create(alice);
    const path = `/api/s/${created.id}`;
    expect((await put(bob, path, listing('Bob', 'Bob'))).status).toBe(403);

    const updated = await put(alice, path, listing('Renamed'));
    expect(updated.status).toBe(200);
    const { revision } = (await updated.json()) as { revision: string };
    expect(revision).not.toBe(created.revision);
    expect((await record(created.id)).revision).toBe(revision);

    const old = await SELF.fetch(`${ORIGIN}/api/s/${created.id}/content/${created.revision}`);
    expect(old.status).toBe(404);

    const lookup = await SELF.fetch(`${ORIGIN}/api/revisions`, {
      method: 'POST',
      body: JSON.stringify({ ids: [created.id, 'AAAAAAAAAA'] }),
    });
    expect(await lookup.json()).toEqual({
      [created.id]: {
        revision,
        minAppVersion: '3.3.1',
        status: 'none',
        visibility: 'link',
        note: null,
        pending: false,
        listed: false,
      },
      AAAAAAAAAA: null,
    });
  });

  it('lists public shares only after an official approval', async () => {
    const created = await create(alice, listing('Public'), 'public');
    expect((await record(created.id)).status).toBe('pending');
    const before = (await (await market()).json()) as { entries: ShareRecord[] };
    expect(before.entries.some((entry) => entry.id === created.id)).toBe(false);

    // Not a reviewer, and a reviewer request without a valid approval.
    expect((await approve(alice, created.id, created.revision)).status).toBe(403);
    const unsigned = await signedFetch(
      reviewer,
      'POST',
      `/api/s/${created.id}/review`,
      JSON.stringify({ revision: created.revision, decision: 'approve', approval: 'AAAA' }),
    );
    expect(unsigned.status).toBe(400);

    const queue = (await (await signedFetch(reviewer, 'GET', '/api/review')).json()) as { entries: ShareRecord[] };
    expect(queue.entries.some((entry) => entry.id === created.id)).toBe(true);

    expect((await approve(reviewer, created.id, created.revision)).status).toBe(200);
    const after = (await (await market()).json()) as { entries: ShareRecord[] };
    const entry = after.entries.find((item) => item.id === created.id);
    expect(entry?.approval).toBeTruthy();
    expect(entry?.status).toBe('live');
  });

  it('keeps the approved revision live while an update waits, then rejects it with a note', async () => {
    const created = await create(alice, listing('Live'), 'public');
    await approve(reviewer, created.id, created.revision);

    const updated = await put(alice, `/api/s/${created.id}`, listing('Live v2'), 'public');
    const { revision } = (await updated.json()) as { revision: string };
    const served = await record(created.id);
    expect(served.revision).toBe(created.revision);
    expect(served.status).toBe('pending');

    const noNote = await signedFetch(
      reviewer,
      'POST',
      `/api/s/${created.id}/review`,
      JSON.stringify({ revision, decision: 'reject' }),
    );
    expect(noNote.status).toBe(400);
    const rejected = await signedFetch(
      reviewer,
      'POST',
      `/api/s/${created.id}/review`,
      JSON.stringify({ revision, decision: 'reject', note: 'Please remove the webhook' }),
    );
    expect(rejected.status).toBe(200);
    const after = await record(created.id);
    expect(after).toMatchObject({ status: 'rejected', note: 'Please remove the webhook', revision: created.revision });
  });

  it('answers repeat catalog checks with 304 until the listed set changes', async () => {
    const first = await market();
    const etag = first.headers.get('etag')!;
    const repeat = await SELF.fetch(`${ORIGIN}/api/market`, { headers: { 'if-none-match': etag } });
    expect(repeat.status).toBe(304);

    const created = await create(alice, listing('Etag'), 'public');
    await approve(reviewer, created.id, created.revision);
    const changed = await SELF.fetch(`${ORIGIN}/api/market`, { headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
  });

  it('unlists back to a link and lets reviewers take shares down', async () => {
    const created = await create(alice, listing('Withdraw'), 'public');
    await approve(reviewer, created.id, created.revision);
    expect((await signedFetch(bob, 'POST', `/api/s/${created.id}/unlist`)).status).toBe(403);
    expect((await signedFetch(alice, 'POST', `/api/s/${created.id}/unlist`)).status).toBe(200);
    expect(await record(created.id)).toMatchObject({ visibility: 'link', status: 'none' });

    const other = await create(bob, listing('Bad', 'Bob'));
    expect((await signedFetch(reviewer, 'DELETE', `/api/s/${other.id}`)).status).toBe(200);
    expect((await SELF.fetch(`${ORIGIN}/s/${other.id}`)).status).toBe(404);
  });

  it('counts one report per key, only on listed shares', async () => {
    const link = await create(alice, listing('Unlisted'));
    const reason = JSON.stringify({ reason: 'Steals accounts' });
    expect((await signedFetch(bob, 'POST', `/api/s/${link.id}/report`, reason)).status).toBe(404);

    const created = await create(alice, listing('Reported'), 'public');
    await approve(reviewer, created.id, created.revision);
    await signedFetch(bob, 'POST', `/api/s/${created.id}/report`, reason);
    await signedFetch(bob, 'POST', `/api/s/${created.id}/report`, reason);
    const queue = (await (await signedFetch(reviewer, 'GET', '/api/review')).json()) as { entries: ShareRecord[] };
    expect(queue.entries.find((entry) => entry.id === created.id)).toMatchObject({
      reports: 1,
      reportReasons: ['Steals accounts'],
    });
  });

  it('counts installs', async () => {
    const created = await create(alice);
    const count = () => SELF.fetch(`${ORIGIN}/api/s/${created.id}/install`, { method: 'POST' });
    expect((await count()).status).toBe(204);
    expect((await count()).status).toBe(204);
    const installs = await env.DB.prepare('SELECT installs FROM shares WHERE id = ?').bind(created.id).first('installs');
    expect(installs).toBe(2);
    expect((await SELF.fetch(`${ORIGIN}/api/s/AAAAAAAAAA/install`, { method: 'POST' })).status).toBe(404);
  });

  it('deletes the share', async () => {
    const created = await create(alice);
    const path = `/api/s/${created.id}`;
    expect((await signedFetch(bob, 'DELETE', path)).status).toBe(403);
    expect((await signedFetch(alice, 'DELETE', path)).status).toBe(200);
    expect(await env.DB.prepare('SELECT revision FROM share_revisions WHERE share_id = ?').bind(created.id).first()).toBeNull();
    expect((await SELF.fetch(`${ORIGIN}/s/${created.id}`)).status).toBe(404);
  });

  it('enforces the per-owner quotas and size cap', async () => {
    const carol = await newPublisher();
    for (let index = 0; index < 5; index += 1) await create(carol, listing(`Pending ${index}`, 'Carol'), 'public');
    expect((await put(carol, '/api/s', listing('One more', 'Carol'), 'public')).status).toBe(409);

    await env.DB.batch(
      Array.from({ length: 45 }, (_, index) =>
        env.DB.prepare(
          `INSERT INTO shares (id, owner_key, owner_name, kind, visibility, status, latest_revision, created_at, updated_at)
           VALUES (?, ?, 'Carol', 'plugin', 'public', 'live', 'r', 0, 0)`,
        ).bind(`quota${String(index).padStart(5, '0')}`, carol.publicKey),
      ),
    );
    expect((await put(carol, '/api/s', listing('Full', 'Carol'))).status).toBe(409);

    const dave = await newPublisher();
    const listed = await create(dave, listing('Listed', 'Dave'), 'public');
    for (let index = 0; index < 10; index += 1) await create(dave, listing(`Link ${index}`, 'Dave'));
    expect((await put(dave, '/api/s', listing('Link 10', 'Dave'))).status).toBe(409);
    expect((await put(dave, `/api/s/${listed.id}`, listing('Listed', 'Dave'))).status).toBe(409);
    expect((await signedFetch(dave, 'POST', `/api/s/${listed.id}/unlist`)).status).toBe(409);
    expect((await put(dave, '/api/s', listing('Public', 'Dave'), 'public')).status).toBe(201);

    const huge = await upload(listing(), 'link', undefined, new Uint8Array([0x1f, 0x8b, ...new Uint8Array(1024 * 1024)]));
    expect((await signedFetch(alice, 'PUT', '/api/s', huge.body, huge.contentType)).status).toBe(413);
  });
});
