import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  PluginSecurityStore,
  canonicalJson,
  exportablePluginInfo,
  pluginContentDigest,
  publisherFingerprint,
} from '../../src/main/src/functions/signing';
import type { MacroInfo } from '../../src/main/src/types';

const info: MacroInfo = {
  name: 'Signed plugin',
  description: 'test',
  pluginId: 'signedplugin',
  editedAt: null,
  createdAt: 1,
  public: false,
  language: 'js',
  scriptType: 'script',
  config: [],
};
const code = { code: 'module.exports = 1;' };

describe('plugin signing v2', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jnbot-signing-'));
  });

  test('canonical JSON ignores object insertion order', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  test('does not create an identity while reading its summary', () => {
    const store = new PluginSecurityStore(directory, []);

    expect(store.getIdentitySummary()).toEqual({ configured: false });
    expect(fs.existsSync(path.join(directory, 'publisher-identity.json'))).toBe(
      false,
    );
  });

  test('stores one password-free identity file and verifies its bundles', () => {
    const store = new PluginSecurityStore(directory);
    store.setPublisherName('Test Publisher');

    const bundle = store.sign(info, code);
    const result = store.verify(bundle);
    expect(result.status).toBe('trusted');
    expect(result.publisherName).toBe('Test Publisher');
    expect(result.fingerprint).toBe(
      publisherFingerprint(bundle.signature.publicKey),
    );
    const identity = fs.readFileSync(
      path.join(directory, 'publisher-identity.json'),
      'utf8',
    );
    expect(identity).toContain('PRIVATE KEY');
    expect(fs.existsSync(path.join(directory, 'identity-secret.bin'))).toBe(
      false,
    );
  });

  test.each(['name', 'pluginId', 'scriptType', 'config'] as const)(
    'rejects signed metadata tampering: %s',
    (field) => {
      const store = new PluginSecurityStore(directory);
      store.setPublisherName('Test Publisher');
      const bundle = store.sign(info, code);
      const changed = JSON.parse(JSON.stringify(bundle));
      (changed.info as any)[field] =
        field === 'config' ? [{ changed: true }] : `changed-${field}`;
      expect(store.verify(changed).status).toBe('invalid');
    },
  );

  test('rejects code tampering and publisher-name spoofing', () => {
    const store = new PluginSecurityStore(directory);
    store.setPublisherName('Test Publisher');
    const bundle = store.sign(info, code);
    expect(store.verify({ ...bundle, code: { code: 'changed' } }).status).toBe(
      'invalid',
    );
    expect(
      store.verify({
        ...bundle,
        signature: { ...bundle.signature, publisherName: 'Spoofed' },
      }).status,
    ).toBe('invalid');
  });

  test('signs share envelopes and rejects tampered or re-attributed ones', () => {
    const store = new PluginSecurityStore(directory);
    store.setPublisherName('Test Publisher');
    const envelope = { kind: 'plugin', meta: { title: 'Shared' }, plugins: [] };
    const signature = store.signValue(envelope);

    expect(store.verifyValue(envelope, signature)).toMatchObject({
      status: 'trusted',
      publisherName: 'Test Publisher',
    });
    expect(
      store.verifyValue({ ...envelope, meta: { title: 'Changed' } }, signature).status,
    ).toBe('invalid');
    expect(
      store.verifyValue(envelope, { ...signature, publisherName: 'Someone else' }).status,
    ).toBe('invalid');
    expect(store.isOwnPublicKey(signature.publicKey)).toBe(true);
  });

  test('a different key with the same name remains unknown', () => {
    const publisher = new PluginSecurityStore(
      path.join(directory, 'publisher'),
      [],
    );
    publisher.setPublisherName('Community Publisher');
    const bundle = publisher.sign(info, code);
    const recipient = new PluginSecurityStore(
      path.join(directory, 'recipient'),
      [],
    );

    const unknown = recipient.verify(bundle);
    expect(unknown.status).toBe('valid-untrusted');
    recipient.trustPublisher(unknown);
    expect(recipient.verify(bundle).status).toBe('trusted');

    const reloaded = new PluginSecurityStore(
      path.join(directory, 'recipient'),
      [],
    );
    expect(reloaded.verify(bundle).status).toBe('trusted');
    reloaded.removeTrustedPublisher(unknown.fingerprint!);
    expect(reloaded.verify(bundle).status).toBe('valid-untrusted');
  });

  test('downgrades removed publisher trust to an accepted revision', () => {
    const publisher = new PluginSecurityStore(
      path.join(directory, 'publisher'),
      [],
    );
    publisher.setPublisherName('Community Publisher');
    const bundle = publisher.sign(info, code);
    const recipient = new PluginSecurityStore(
      path.join(directory, 'recipient'),
      [],
    );
    const verification = recipient.verify(bundle);
    recipient.trustPublisher(verification);
    recipient.setProvenance(info.pluginId, {
      status: 'trusted',
      fingerprint: verification.fingerprint,
      publisherName: verification.publisherName,
      signature: verification.signature,
      contentDigest: pluginContentDigest(info, code),
      installedAt: 1,
    });

    recipient.removeTrustedPublisher(verification.fingerprint!);

    expect(recipient.getProvenance(info.pluginId)?.status).toBe('accepted-once');
  });

  test('packages without security metadata remain explicitly unsigned', () => {
    const store = new PluginSecurityStore(directory);
    expect(
      store.verify({ info: exportablePluginInfo(info), code }).status,
    ).toBe('unsigned');
  });

  test('a configured official key is trusted without user approval', () => {
    const publisher = new PluginSecurityStore(
      path.join(directory, 'official'),
      [],
    );
    publisher.setPublisherName('JNbot Official');
    const bundle = publisher.sign(info, code);
    const recipient = new PluginSecurityStore(
      path.join(directory, 'recipient'),
      [bundle.signature.publicKey],
    );

    expect(recipient.verify(bundle).status).toBe('trusted');
    expect(recipient.listTrustedPublishers()).toEqual([
      expect.objectContaining({
        publicKey: bundle.signature.publicKey,
        localLabel: 'JNbot Official',
        builtIn: true,
      }),
    ]);
  });

  test('AI provenance is excluded from portable plugin metadata', () => {
    const portable = exportablePluginInfo({
      ...info,
      security: {
        status: 'local',
        contentDigest: 'digest',
        installedAt: 1,
        ai: {
          sourceHash: 'hash',
          clientId: 'client',
          networkAllowed: false,
        },
      },
    });
    expect(portable).not.toHaveProperty('security');
    expect(portable).not.toHaveProperty('ai');
  });

  test('editing trusted code clears the stale signature', () => {
    const store = new PluginSecurityStore(directory);
    store.setPublisherName('Test Publisher');
    const bundle = store.sign(info, code);
    store.setProvenance(info.pluginId, {
      status: 'trusted',
      fingerprint: publisherFingerprint(bundle.signature.publicKey),
      publisherName: bundle.signature.publisherName,
      signature: bundle.signature,
      contentDigest: 'original-digest',
      installedAt: 1,
    });

    store.markModified(info.pluginId, info, { code: 'module.exports = 2;' });

    const provenance = store.getProvenance(info.pluginId);
    expect(provenance).toMatchObject({ status: 'modified' });
    expect(provenance).not.toHaveProperty('signature');
  });

  test('preserves a matching publisher signature when exporting installed content', () => {
    const publisher = new PluginSecurityStore(
      path.join(directory, 'publisher'),
      [],
    );
    publisher.setPublisherName('Marketplace creator');
    const original = publisher.sign(info, code);
    const exporter = new PluginSecurityStore(
      path.join(directory, 'exporter'),
      [],
    );
    exporter.setPublisherName('Exporter');
    exporter.setProvenance(info.pluginId, {
      status: 'accepted-once',
      fingerprint: publisherFingerprint(original.signature.publicKey),
      publisherName: original.signature.publisherName,
      signature: original.signature,
      contentDigest: pluginContentDigest(info, code),
      installedAt: 1,
    });

    const exported = exporter.bundleForExport(info, code);

    expect(exported.signature).toEqual(original.signature);
  });

  test('signs changed installed content with the local identity', () => {
    const publisher = new PluginSecurityStore(
      path.join(directory, 'publisher'),
      [],
    );
    publisher.setPublisherName('Marketplace creator');
    const original = publisher.sign(info, code);
    const exporter = new PluginSecurityStore(
      path.join(directory, 'exporter'),
      [],
    );
    exporter.setPublisherName('Exporter');
    exporter.setProvenance(info.pluginId, {
      status: 'accepted-once',
      fingerprint: publisherFingerprint(original.signature.publicKey),
      publisherName: original.signature.publisherName,
      signature: original.signature,
      contentDigest: pluginContentDigest(info, code),
      installedAt: 1,
    });

    const exported = exporter.bundleForExport(info, { code: 'module.exports = 2;' });

    expect(exported.signature).not.toEqual(original.signature);
    expect(exported.signature.publisherName).toBe('Exporter');
  });

  test('malformed Ed25519 keys fail closed', () => {
    const store = new PluginSecurityStore(directory);
    const { publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const invalid = {
      format: 'jnbot-plugin',
      version: 2,
      info,
      code,
      signature: {
        algorithm: 'ed25519',
        publicKey: publicKey
          .export({ type: 'spki', format: 'der' })
          .toString('base64url'),
        publisherName: 'Wrong key',
        signedAt: new Date().toISOString(),
        value: 'invalid',
      },
    };
    expect(store.verify(invalid).status).toBe('invalid');
  });
});
