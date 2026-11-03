import McpOperations from '../../src/main/src/functions/mcp/McpOperations';

const target = { profileKey: 'jartexnetwork', account: 'BotOne' };

describe('MCP operations', () => {
  test('deduplicates concurrent logical writes and executes once', async () => {
    const operations = new McpOperations();
    const execute = jest.fn(async () => ({ joined: true }));
    const first = operations.create({
      clientId: 'client', tool: 'join_bot', target, args: {}, summary: 'join', requiresApproval: false, execute,
    });
    const second = operations.create({
      clientId: 'client', tool: 'join_bot', target, args: {}, summary: 'join', requiresApproval: false, execute,
    });
    expect(second.operationId).toBe(first.operationId);
    expect(second.deduplicated).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(operations.get('client', first.operationId)).toMatchObject({ status: 'succeeded', result: { joined: true } });
  });

  test('approval executes the exact operation once', async () => {
    const operations = new McpOperations();
    const execute = jest.fn(async () => ({ sent: true }));
    const operation = operations.create({
      clientId: 'client', tool: 'send_bot_chat', target, args: { message: 'hi' }, summary: 'chat', requiresApproval: true, execute,
    });
    expect(operation.status).toBe('awaiting_approval');
    operations.approve(operation.operationId, execute);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(() => operations.approve(operation.operationId, execute)).toThrow('no longer awaiting approval');
  });

  test('keeps operations private to their client and cancels on revocation', () => {
    const operations = new McpOperations();
    const operation = operations.create({
      clientId: 'client-a', tool: 'run_bot_script', target, args: {}, summary: 'script', requiresApproval: true, execute: async () => ({}),
    });
    expect(operations.get('client-b', operation.operationId)).toBeUndefined();
    operations.cancelClient('client-a');
    expect(operations.get('client-a', operation.operationId)).toMatchObject({ status: 'cancelled' });
  });
});
