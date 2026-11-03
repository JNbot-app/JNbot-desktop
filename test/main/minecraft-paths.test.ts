import path from 'path';
import {
  sanitizePathSegment,
  getMinecraftRoot,
  getMinecraftAuthDir,
  minecraftAuthHash,
  offlineUuid,
  getModsPath,
} from '../../src/main/src/functions/minecraft/minecraftPaths';

describe('minecraftPaths', () => {
  describe('sanitizePathSegment', () => {
    it('normalizes alphanumeric characters and collapses whitespace to underscores', () => {
      expect(sanitizePathSegment('Hello World')).toBe('Hello_World');
      expect(sanitizePathSegment('  multiple   spaces   around  ')).toBe('multiple_spaces_around');
      expect(sanitizePathSegment('valid-name_v1.0')).toBe('valid-name_v1.0');
    });

    it('replaces illegal path and filesystem characters with underscores', () => {
      expect(sanitizePathSegment('../../etc/passwd')).toBe('.._.._etc_passwd');
      expect(sanitizePathSegment('user:secret/file*name?test<foo>bar|baz"')).toBe(
        'user_secret_file_name_test_foo_bar_baz_',
      );
    });

    it('truncates segments exceeding 80 characters', () => {
      const longInput = 'a'.repeat(120);
      const sanitized = sanitizePathSegment(longInput);
      expect(sanitized.length).toBe(80);
      expect(sanitized).toBe('a'.repeat(80));
    });

    it('handles empty and whitespace-only strings', () => {
      expect(sanitizePathSegment('')).toBe('');
      expect(sanitizePathSegment('   ')).toBe('');
    });
  });

  describe('offlineUuid', () => {
    it('generates standard UUID v3 for Minecraft offline players', () => {
      const steveUuid = offlineUuid('Steve');
      expect(steveUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(steveUuid).toBe('5627dd98-e6be-3c21-b8a8-e92344183641');

      const alexUuid = offlineUuid('Alex');
      expect(alexUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(alexUuid).not.toBe(steveUuid);
    });

    it('is case-sensitive matching Mojang offline UUID behavior', () => {
      const lower = offlineUuid('steve');
      const upper = offlineUuid('Steve');
      expect(lower).not.toBe(upper);
    });

    it('handles special characters and numbers in usernames', () => {
      const uuid = offlineUuid('Player_123');
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe('minecraftAuthHash', () => {
    it('generates 6-character sha1 prefix matching prismarine-auth cache files', () => {
      const hash1 = minecraftAuthHash('PlayerOne');
      const hash2 = minecraftAuthHash('PlayerOne');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(6);
      expect(hash1).toMatch(/^[0-9a-f]{6}$/);

      const hashOther = minecraftAuthHash('PlayerTwo');
      expect(hashOther).not.toBe(hash1);
    });

    it('handles null, undefined, or empty username gracefully', () => {
      expect(minecraftAuthHash('')).toHaveLength(6);
      expect(minecraftAuthHash(undefined as any)).toHaveLength(6);
      expect(minecraftAuthHash(null as any)).toHaveLength(6);
    });
  });

  describe('directory path helpers', () => {
    it('getMinecraftRoot resolves correctly based on platform', () => {
      const userDir = '/fake/user/data';
      const root = getMinecraftRoot(userDir);
      if (process.platform === 'win32') {
        expect(root).toBe(path.join(userDir, '.minecraft'));
      } else {
        expect(root).toBe(path.join(userDir, 'minecraft'));
      }
    });

    it('getMinecraftAuthDir returns minecraft-auth subfolder', () => {
      expect(getMinecraftAuthDir('/data/user')).toBe(path.join('/data/user', 'minecraft-auth'));
    });

    it('getModsPath appends mods folder to game directory', () => {
      expect(getModsPath('/instances/instance_1')).toBe(path.join('/instances/instance_1', 'mods'));
    });
  });
});
