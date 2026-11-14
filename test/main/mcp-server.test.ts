import McpManager, {
  asStructuredContent,
} from '../../src/main/src/functions/mcp/McpManager';
import * as z from 'zod/v4';
import {
  getPluginSchema,
  inspectWorldSchema,
  jnbotContextSchema,
  savePluginSchema,
} from '../../src/main/src/functions/mcp/McpTools';
import { McpBotBridge } from '../../src/main/src/functions/mcp/McpBotBridge';

describe('MCP tool catalog', () => {
  test('wraps array tool results as valid structured content', () => {
    const profiles = [{ profileKey: 'jartexnetwork' }];
    expect(asStructuredContent(profiles)).toEqual({ result: profiles });
    expect(asStructuredContent({ profiles })).toEqual({ profiles });
  });

  test('exposes a small explicit catalog and filters denied packs', () => {
    const manager = Object.create(McpManager.prototype) as any;
    const client = {
      permissions: { mcp: { observe: 'allow', control: 'ask', code: 'deny', plugins: 'deny' } },
    };
    const names = manager.tools(client).map((tool: any) => tool.name);
    expect(names).toEqual([
      'get_jnbot_context', 'get_bot_state', 'wait_for_event', 'inspect_world', 'get_operation',
      'join_bot', 'leave_bot', 'send_bot_chat', 'move_bot', 'interact_with_world', 'manage_inventory',
      'get_run', 'get_jnbot_reference',
    ]);
    expect(names).toHaveLength(13);
    expect(names).not.toContain('wait_for_approval');
    expect(names).not.toContain('describe_jnbot_operations');
    expect(names).not.toContain('run_bot_script');
  });

  test('keeps the fully enabled catalog at twenty tools or fewer', () => {
    const manager = Object.create(McpManager.prototype) as any;
    const client = {
      permissions: { mcp: { observe: 'allow', control: 'allow', code: 'allow', plugins: 'allow' } },
    };
    expect(manager.tools(client)).toHaveLength(20);
  });

  test('advertises complete flat mode schemas for inspectors', () => {
    for (const schema of [getPluginSchema, savePluginSchema, inspectWorldSchema]) {
      const json = z.toJSONSchema(schema) as any;
      expect(json.oneOf).toBeUndefined();
      expect(Object.keys(json.properties)).toEqual(expect.arrayContaining(['mode']));
    }
    const save = z.toJSONSchema(savePluginSchema) as any;
    expect(save.properties).toEqual(expect.objectContaining({
      name: expect.any(Object),
      source: expect.any(Object),
      optionSchema: expect.any(Object),
      profileKey: expect.any(Object),
      values: expect.any(Object),
    }));
    expect(save.properties.optionSchema.description).toContain('native array');
  });

  test('advertises profile-scoped stored-account search without adding a tool', () => {
    const json = z.toJSONSchema(jnbotContextSchema) as any;
    expect(json.properties.accountQuery.description).toContain('stored account names');
    expect(jnbotContextSchema.safeParse({ accountQuery: 'Zola' }).success).toBe(false);
    expect(jnbotContextSchema.parse({ profileKey: 'jartex', accountQuery: ' Zola ' }))
      .toEqual({ profileKey: 'jartex', accountQuery: 'Zola' });
  });

  test('only fetches optional state payloads when requested', async () => {
    const manager = Object.create(McpManager.prototype) as any;
    manager.assertProfile = jest.fn();
    manager.publicValue = (value: unknown) => value;
    manager.withReadTimeout = <T>(value: Promise<T>) => value;
    manager.botBridge = {
      state: jest.fn().mockResolvedValue({ health: 20 }),
      chat: jest.fn().mockResolvedValue({ entries: [] }),
      inventory: jest.fn().mockResolvedValue({ items: [] }),
      players: jest.fn().mockResolvedValue({ entries: [{ username: 'Alex', ping: 1, gamemode: 0 }], total: 1, truncated: false }),
    };

    await expect(manager.readState({}, { profileKey: 'jartex', account: 'BotOne' })).resolves.toEqual({ state: { health: 20 } });
    expect(manager.botBridge.players).not.toHaveBeenCalled();

    await expect(manager.readState({}, { profileKey: 'jartex', account: 'BotOne' }, ['players'])).resolves.toMatchObject({
      players: { entries: [{ username: 'Alex' }], total: 1, truncated: false },
    });
  });

  test('returns account counts but never every stored alt in context', () => {
    const runtime = {
      profileId: 1,
      profileKey: 'jartex',
      activeBots: { toArray: () => [{ botId: 1, origin: 'mcp', username: 'BotOne', status: 'connected', version: '1.8.9' }] },
      activeScripts: { toObject: () => ({}) },
    };
    const bridge = new McpBotBridge({
      getRuntimeSummaries: () => [{ profileKey: 'jartex', bots: 1, scripts: 0 }],
      getRuntimeByKey: () => runtime,
      getRuntime: () => runtime,
      settings: { getAltsWithDataForProfile: () => [{ username: 'AltOne' }, { username: 'Zola' }, { username: 'ZolaTwo' }] },
    } as any);

    expect(bridge.context(['jartex'])).toEqual([expect.objectContaining({
      profileKey: 'jartex',
      accountCount: 3,
      bots: [expect.objectContaining({ target: { profileKey: 'jartex', account: 'BotOne' } })],
    })]);
    expect(bridge.context(['jartex'])[0]).not.toHaveProperty('accounts');
    expect(bridge.context(['jartex'], 'zola')[0]).toMatchObject({
      accountMatches: {
        query: 'zola',
        accounts: [{ account: 'Zola' }, { account: 'ZolaTwo' }],
        total: 2,
        truncated: false,
      },
    });
  });

  test('a failed bot action rejects only for its caller', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const bridge = new McpBotBridge({} as any) as any;
      const target = { profileId: 1, botId: 1 };
      await expect(
        bridge.serialized(target, () => Promise.reject(new Error('timed out'))),
      ).rejects.toThrow('timed out');
      await expect(bridge.serialized(target, async () => 'next')).resolves.toBe('next');
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('uses stable public bot targets', () => {
    const manager = Object.create(McpManager.prototype) as any;
    expect(manager.target({ profileKey: 'jartexnetwork', account: 'BotOne' })).toEqual({ profileKey: 'jartexnetwork', account: 'BotOne' });
  });

  test('returns complete generated reference sections', () => {
    const manager = Object.create(McpManager.prototype) as any;
    const reference = manager.getReference('mcServerApi');
    expect(reference.section).toBe('mcServerApi');
    expect(reference.content).toContain('interface IMcServer');
    expect(reference.content).toContain('apiCapabilities()');
    expect(reference.content).not.toContain('interface ScriptAPI');
    expect(() => manager.getReference('unknown')).toThrow('Unknown JNbot reference section');
  });

  test('allows global plugin source saves without inventing a profile target', () => {
    const manager = Object.create(McpManager.prototype) as any;
    const operation = { operationId: 'operation', status: 'queued' };
    manager.operations = { create: jest.fn().mockReturnValue(operation) };
    manager.record = jest.fn();
    manager.emitActivity = jest.fn();
    const client = {
      id: 'client',
      permissions: { profiles: ['jartexnetwork'], mcp: { plugins: 'allow' } },
    };

    expect(manager.submit(client, 'save_plugin', 'plugins', undefined, {
      mode: 'source', name: 'Example', source: 'main();', scriptType: 'script',
    }, async () => ({ pluginId: 'example' }))).toBe(operation);
    expect(manager.operations.create).toHaveBeenCalledWith(expect.objectContaining({
      target: undefined,
      tool: 'save_plugin',
    }));
  });

  test('tests the modern stateless endpoint with the required accept header', async () => {
    const manager = Object.create(McpManager.prototype) as any;
    manager.endpoint = 'http://127.0.0.1:3000/mcp';
    manager.relayConnected = false;
    manager.clientById = () => ({ id: 'client', token: 'test-token' });
    manager.touchClient = jest.fn();
    manager.emitActivity = jest.fn();
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: { supportedVersions: ['2026-07-28'], _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'JNbot MCP' } } } }),
    } as any);

    await expect(manager.testClient('client')).resolves.toMatchObject({
      ok: true,
      protocolVersion: '2026-07-28',
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'server/discover',
      }),
    }));
    fetchMock.mockRestore();
  });

  test('falls back to the legacy handshake when modern discovery is unavailable', async () => {
    const manager = Object.create(McpManager.prototype) as any;
    manager.endpoint = 'http://127.0.0.1:3000/mcp';
    manager.relayConnected = false;
    manager.clientById = () => ({ id: 'client', token: 'test-token' });
    manager.touchClient = jest.fn();
    manager.emitActivity = jest.fn();
    const fetchMock = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '{}' } as any)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'event: message\ndata: {"result":{"protocolVersion":"2025-11-25","serverInfo":{"name":"JNbot MCP"}}}\n\n' } as any);

    await expect(manager.testClient('client')).resolves.toMatchObject({
      ok: true,
      protocolVersion: '2025-11-25',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].body).toContain('"initialize"');
    fetchMock.mockRestore();
  });
});
