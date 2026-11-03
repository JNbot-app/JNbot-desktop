import {
  randomSecret,
  roomIdFromHostKey,
  encodeMinecraftInvite,
  decodeMinecraftInvite,
  validateInvite,
  secretsEqual,
} from '../../src/main/src/functions/minecraftServer/invite';
import {
  MINECRAFT_SERVER_INVITE_PREFIX,
  type MinecraftServerInvite,
} from '../../src/common/minecraftServers';

describe('minecraftInvite', () => {
  const sampleInvite: MinecraftServerInvite = {
    v: 1,
    r: 'room-12345678901234567890123456789012',
    k: 'secret-key-1234567890123456789012345',
    n: 'My Survival Server',
    m: '1.20.4',
  };

  describe('randomSecret & roomIdFromHostKey', () => {
    it('generates non-empty base64url random secrets', () => {
      const secret1 = randomSecret();
      const secret2 = randomSecret();
      expect(typeof secret1).toBe('string');
      expect(secret1.length).toBeGreaterThan(40);
      expect(secret1).not.toBe(secret2);
      expect(secret1).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('creates deterministic base64url roomId from hostKey', () => {
      const key = 'my-host-unique-key-123';
      const id1 = roomIdFromHostKey(key);
      const id2 = roomIdFromHostKey(key);
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(roomIdFromHostKey('other-key')).not.toBe(id1);
    });
  });

  describe('secretsEqual', () => {
    it('returns true for matching secrets', () => {
      expect(secretsEqual('secret1234567890', 'secret1234567890')).toBe(true);
    });

    it('returns false for mismatched secrets of same length', () => {
      expect(secretsEqual('secret1234567890', 'secret1234567899')).toBe(false);
    });

    it('returns false for secrets of different lengths without throwing', () => {
      expect(secretsEqual('short', 'much-longer-secret-token')).toBe(false);
      expect(secretsEqual('', 'non-empty')).toBe(false);
      expect(secretsEqual('a', 'b')).toBe(false);
    });
  });

  describe('validateInvite', () => {
    it('passes for a valid invite', () => {
      expect(() => validateInvite(sampleInvite)).not.toThrow();
    });

    it('rejects unsupported version', () => {
      expect(() => validateInvite({ ...sampleInvite, v: 2 as any })).toThrow('Invalid invite version');
      expect(() => validateInvite({ ...sampleInvite, v: 0 as any })).toThrow('Invalid invite version');
    });

    it('rejects invalid or unsafe tokens for room r or key k', () => {
      // Too short (< 32 chars)
      expect(() => validateInvite({ ...sampleInvite, r: 'too-short' })).toThrow(
        'Invalid invite credentials',
      );
      // Too long (> 128 chars)
      expect(() => validateInvite({ ...sampleInvite, k: 'a'.repeat(129) })).toThrow(
        'Invalid invite credentials',
      );
      // Illegal characters (e.g. spaces, special chars)
      expect(() => validateInvite({ ...sampleInvite, r: 'has special char * ' + 'a'.repeat(30) })).toThrow(
        'Invalid invite credentials',
      );
      expect(() => validateInvite({ ...sampleInvite, k: 'has+plus/slash==' + 'a'.repeat(30) })).toThrow(
        'Invalid invite credentials',
      );
    });

    it('rejects invalid server name n', () => {
      expect(() => validateInvite({ ...sampleInvite, n: '' })).toThrow('Invalid invite name');
      expect(() => validateInvite({ ...sampleInvite, n: '   ' })).toThrow('Invalid invite name');
      expect(() => validateInvite({ ...sampleInvite, n: 'a'.repeat(81) })).toThrow('Invalid invite name');
      expect(() => validateInvite({ ...sampleInvite, n: 123 as any })).toThrow('Invalid invite name');
    });

    it('rejects invalid Minecraft version m', () => {
      expect(() => validateInvite({ ...sampleInvite, m: '' })).toThrow('Invalid Minecraft version');
      expect(() => validateInvite({ ...sampleInvite, m: '   ' })).toThrow('Invalid Minecraft version');
      expect(() => validateInvite({ ...sampleInvite, m: 'x'.repeat(65) })).toThrow('Invalid Minecraft version');
      expect(() => validateInvite({ ...sampleInvite, m: null as any })).toThrow('Invalid Minecraft version');
    });
  });

  describe('encodeMinecraftInvite & decodeMinecraftInvite', () => {
    it('encodes with jnbot-mc:// prefix and decodes accurately', () => {
      const encoded = encodeMinecraftInvite(sampleInvite);
      expect(encoded.startsWith(MINECRAFT_SERVER_INVITE_PREFIX)).toBe(true);

      const decoded = decodeMinecraftInvite(encoded);
      expect(decoded).toEqual(sampleInvite);
    });

    it('trims leading/trailing whitespace on decode', () => {
      const encoded = `  \n  ${encodeMinecraftInvite(sampleInvite)}  \t `;
      expect(decodeMinecraftInvite(encoded)).toEqual(sampleInvite);
    });

    it('rejects invite missing prefix', () => {
      expect(() => decodeMinecraftInvite('https://example.com/invite')).toThrow(
        'Invalid JNbot Minecraft invite',
      );
    });

    it('rejects invite exceeding 2048 characters', () => {
      const huge = `${MINECRAFT_SERVER_INVITE_PREFIX}${'a'.repeat(2050)}`;
      expect(() => decodeMinecraftInvite(huge)).toThrow('Invalid JNbot Minecraft invite');
    });

    it('rejects malformed base64url or corrupted JSON payload', () => {
      const malformed = `${MINECRAFT_SERVER_INVITE_PREFIX}%%%not_valid_json%%%`;
      expect(() => decodeMinecraftInvite(malformed)).toThrow('Invalid JNbot Minecraft invite');
    });

    it('propagates specific validation errors from decode', () => {
      const invalidVersion = { ...sampleInvite, v: 99 };
      const raw = `${MINECRAFT_SERVER_INVITE_PREFIX}${Buffer.from(JSON.stringify(invalidVersion)).toString('base64url')}`;
      expect(() => decodeMinecraftInvite(raw)).toThrow('Invalid invite version');
    });
  });
});
