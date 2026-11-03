import { bootElectron, cleanupUserData, freshUserData } from './helpers';

afterAll(cleanupUserData);

test('storage status and Local selection work without opening the runtime or a Dropbox connection', async () => {
  bootElectron(freshUserData());
  const { createProgram } = require('../../src/cli/v2/commands');
  const results: any[] = [];
  const session = { runtime: {}, onResult: (result: unknown) => results.push(result), onOutput: () => undefined };
  await createProgram(session).parseAsync(['node', 'jnbot', 'storage', 'status']);
  expect(results[0]).toMatchObject({ ok: true, data: { mode: 'local', connected: false } });
  await createProgram(session).parseAsync(['node', 'jnbot', 'storage', 'select', 'local']);
  expect(results[1].ok).toBe(true);
  await createProgram(session).parseAsync(['node', 'jnbot', 'storage', 'disconnect']);
  expect(results[2].data.connected).toBe(false);
});
