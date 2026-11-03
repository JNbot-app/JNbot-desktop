import {
  canonicalCodeBytes,
  checksumOfCode,
  obfuscateCode,
  deobfuscateCode,
  obfuscateCodeToBase64,
  deobfuscateCodeFromBase64,
  inflatePluginPayload,
} from '../../src/main/src/functions/scriptObfuscate';

describe('scriptObfuscate', () => {
  describe('canonicalCodeBytes & checksumOfCode', () => {
    it('serializes primitives and objects to UTF-8 JSON bytes', () => {
      const obj = { hello: 'world', count: 42 };
      const bytes = canonicalCodeBytes(obj);
      expect(Buffer.isBuffer(bytes)).toBe(true);
      expect(JSON.parse(bytes.toString('utf8'))).toEqual(obj);
    });

    it('generates consistent SHA-256 hex checksums', () => {
      const codeA = { script: 'test', version: 1 };
      const checksumA1 = checksumOfCode(codeA);
      const checksumA2 = checksumOfCode(codeA);
      expect(checksumA1).toBe(checksumA2);
      expect(checksumA1).toMatch(/^[0-9a-f]{64}$/);

      const codeB = { script: 'test', version: 2 };
      expect(checksumOfCode(codeB)).not.toBe(checksumA1);
    });

    it('handles unicode, arrays, and empty values', () => {
      expect(checksumOfCode('')).toMatch(/^[0-9a-f]{64}$/);
      expect(checksumOfCode(null)).toMatch(/^[0-9a-f]{64}$/);
      expect(checksumOfCode([1, 2, '🚀'])).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('obfuscateCode & deobfuscateCode', () => {
    it('round-trips objects, arrays, and strings accurately', () => {
      const sampleObjects = [
        { code: 'console.log("hello");', enabled: true },
        ['step1', 'step2', { nested: 123 }],
        'simple string payload',
        123456,
        true,
        null,
      ];

      for (const item of sampleObjects) {
        const obfuscated = obfuscateCode(item);
        expect(Buffer.isBuffer(obfuscated)).toBe(true);
        expect(obfuscated.toString('utf8')).not.toContain('console.log');
        const restored = deobfuscateCode(obfuscated);
        expect(restored).toEqual(item);
      }
    });

    it('throws when deobfuscating corrupted or truncated buffers', () => {
      const valid = obfuscateCode({ secret: 'password' });
      const truncated = valid.subarray(0, Math.floor(valid.length / 2));
      expect(() => deobfuscateCode(truncated)).toThrow();

      const corrupted = Buffer.from(valid);
      corrupted[0] ^= 0xff;
      corrupted[1] ^= 0xaa;
      expect(() => deobfuscateCode(corrupted)).toThrow();

      expect(() => deobfuscateCode(Buffer.alloc(0))).toThrow();
    });

    it('handles large payloads cleanly', () => {
      const largeScript = {
        code: 'const x = 1;\n'.repeat(5000),
        metadata: { tags: Array.from({ length: 500 }, (_, i) => `tag_${i}`) },
      };
      const obf = obfuscateCode(largeScript);
      const deobf = deobfuscateCode(obf);
      expect(deobf).toEqual(largeScript);
    });
  });

  describe('obfuscateCodeToBase64 & deobfuscateCodeFromBase64', () => {
    it('round-trips through base64 transport strings', () => {
      const payload = { action: 'run', args: ['--fast', '--debug'] };
      const b64 = obfuscateCodeToBase64(payload);
      expect(typeof b64).toBe('string');
      expect(b64.length).toBeGreaterThan(0);

      const restored = deobfuscateCodeFromBase64(b64);
      expect(restored).toEqual(payload);
    });

    it('throws on invalid base64 or garbage strings', () => {
      expect(() => deobfuscateCodeFromBase64('not_valid_base64_gzip_xor')).toThrow();
      expect(() => deobfuscateCodeFromBase64('')).toThrow();
    });
  });

  describe('inflatePluginPayload', () => {
    it('decodes codeObf into code when code is undefined', () => {
      const codeObj = { main: 'export default () => {}' };
      const b64 = obfuscateCodeToBase64(codeObj);
      const raw = {
        id: 'my-plugin',
        version: '1.0.0',
        codeObf: b64,
      };

      const inflated = inflatePluginPayload(raw);
      expect(inflated).toEqual({
        id: 'my-plugin',
        version: '1.0.0',
        code: codeObj,
      });
      expect((inflated as any).codeObf).toBeUndefined();
    });

    it('leaves plain payloads untouched when code is already present', () => {
      const raw = {
        id: 'my-plugin',
        code: { main: 'code' },
      };
      expect(inflatePluginPayload(raw)).toBe(raw);
    });

    it('leaves raw untouched if codeObf is present but code is also defined', () => {
      const raw = {
        id: 'my-plugin',
        code: { main: 'existing' },
        codeObf: 'some_base64',
      };
      expect(inflatePluginPayload(raw)).toBe(raw);
    });

    it('handles primitives, null, and undefined safely', () => {
      expect(inflatePluginPayload(null)).toBeNull();
      expect(inflatePluginPayload(undefined)).toBeUndefined();
      expect(inflatePluginPayload('string')).toBe('string');
      expect(inflatePluginPayload(42)).toBe(42);
      expect(inflatePluginPayload({})).toEqual({});
    });
  });
});
