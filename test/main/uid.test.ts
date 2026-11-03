import path from 'path';
import fs from 'fs';
import { freshUserData, cleanupUserData } from './helpers';

describe('generateUID', () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = freshUserData();
    process.env = { ...originalEnv };
    process.env.JNBOT_USER_DATA = tmpDir;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  afterAll(() => {
    cleanupUserData();
  });

  it('generates a 64-character fallback UID starting with C in CLI mode', () => {
    process.env.CLI_MODE = 'true';
    jest.resetModules();

    const generateUID = require('../../src/main/UID').default;
    const uid = generateUID();

    expect(typeof uid).toBe('string');
    expect(uid.length).toBe(64);
    expect(uid.startsWith('C')).toBe(true);
    expect(uid).toMatch(/^C[a-z0-9]{63}$/);
  });

  it('persists fallback UID to disk at jnbot/uid.txt', () => {
    process.env.CLI_MODE = 'true';
    jest.resetModules();

    const generateUID = require('../../src/main/UID').default;
    const uid = generateUID();

    const filePath = path.join(tmpDir, 'jnbot', 'uid.txt');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toBe(uid);
  });

  it('reads existing UID from disk on subsequent boots instead of regenerating', () => {
    process.env.CLI_MODE = 'true';
    const filePath = path.join(tmpDir, 'jnbot', 'uid.txt');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const existingUID = 'Cexisting1234567890abcdefghijklmnopqrstuvwxyz1234567890abcdefghij';
    fs.writeFileSync(filePath, existingUID, 'utf8');

    jest.resetModules();
    const generateUID = require('../../src/main/UID').default;
    const uid = generateUID();

    expect(uid).toBe(existingUID);
  });

  it('returns cached UID on repeated calls in same process', () => {
    process.env.CLI_MODE = 'true';
    jest.resetModules();

    const generateUID = require('../../src/main/UID').default;
    const first = generateUID();
    const second = generateUID();
    expect(first).toBe(second);
  });

  it('throws helpful error if UID file is empty', () => {
    process.env.CLI_MODE = 'true';
    const filePath = path.join(tmpDir, 'jnbot', 'uid.txt');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', 'utf8'); // empty file

    jest.resetModules();
    const generateUID = require('../../src/main/UID').default;
    expect(() => generateUID()).toThrow(/Could not generate uid/);
  });

  it('falls back to generateFallbackUID when machineIdSync throws', () => {
    delete process.env.CLI_MODE;
    jest.resetModules();

    jest.doMock('node-machine-id', () => ({
      machineIdSync: () => {
        throw new Error('Access denied');
      },
    }));

    const generateUID = require('../../src/main/UID').default;
    const uid = generateUID();

    expect(uid.startsWith('C')).toBe(true);
    expect(uid.length).toBe(64);
  });
});
