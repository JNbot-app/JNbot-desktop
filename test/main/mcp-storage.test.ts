import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import McpStorage from '../../src/main/src/functions/mcp/McpStorage';

describe('MCP storage', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jnbot-mcp-storage-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('creates the relay identity lazily in one local file', () => {
    const storage = new McpStorage(directory);
    const configurationPath = path.join(directory, 'config.json');

    expect(
      JSON.parse(fs.readFileSync(configurationPath, 'utf8')),
    ).not.toHaveProperty('relayIdentity');
    expect(fs.existsSync(path.join(directory, 'secrets.bin'))).toBe(false);

    const identity = storage.getOrCreateRelayIdentity();
    expect(identity.privateKey).toContain('PRIVATE KEY');
    expect(
      JSON.parse(fs.readFileSync(configurationPath, 'utf8')),
    ).toMatchObject({ relayIdentity: identity });
  });

  test('keeps the installation and relay identities across restarts', () => {
    const first = new McpStorage(directory);
    const installationId = first.installationId;
    const relayIdentity = first.getOrCreateRelayIdentity();

    const second = new McpStorage(directory);

    expect(second.installationId).toBe(installationId);
    expect(second.getOrCreateRelayIdentity()).toEqual(relayIdentity);
  });
});
