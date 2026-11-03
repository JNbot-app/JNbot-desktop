import ProfileUiRunner from '../../src/main/src/functions/ProfileUiRunner';

function createRunner() {
  const settings = {
    shared: { alts: [] },
    stats: { stats: { alts: {} } },
    JNdata: { data: {}, servers: {} },
    getProfileSettings: () => ({ altData: {} }),
  };
  const runner = new ProfileUiRunner(settings as never, {} as never);
  return (code: string) =>
    (runner as any).runCode(code, 'js', 'jartexnetwork', 'Steve');
}

describe('ProfileUiRunner sandbox', () => {
  jest.setTimeout(20000);
  const run = createRunner();

  test('builds a profile from the args', async () => {
    const result = await run(`
      async function main(args) {
        console.log('hello', { n: 1 });
        return new ProfileBuilder().player({ username: args.username }).build();
      }
    `);
    expect(result).toMatchObject({
      ok: true,
      json: { player: { username: 'Steve' } },
      logs: [{ level: 'log', text: 'hello {"n":1}' }],
    });
  });

  test.each([
    ['global constructor', 'this.constructor.constructor'],
    ['args constructor', 'args.constructor.constructor'],
    ['fetch constructor', 'args.fetch.constructor'],
    ['console constructor', 'console.log.constructor'],
  ])('cannot reach the host Function via the %s', async (_label, path) => {
    const result = await run(`
      async function main(args) {
        return ${path}('return typeof process')();
      }
    `);
    expect(result).toMatchObject({ ok: false, reason: 'error' });
    expect(result.error).toMatch(/Code generation from strings disallowed/);
  });

  test('does not expose the host bridge', async () => {
    const result = await run(`
      async function main(args) {
        return new ProfileBuilder().player({ username: typeof __host }).build();
      }
    `);
    expect(result).toMatchObject({ ok: true, json: { player: { username: 'undefined' } } });
  });

  test('delivers fetch results back into the sandbox', async () => {
    const result = await run(`
      async function main(args) {
        let message = '';
        try { await args.fetch('file:///etc/passwd'); } catch (e) { message = e.message; }
        return new ProfileBuilder().player({ username: message }).build();
      }
    `);
    expect(result).toMatchObject({
      ok: true,
      json: { player: { username: 'only http/https URLs are allowed' } },
    });
  });

  test('stops an infinite loop after an await', async () => {
    const result = await run(`
      async function main() {
        await null;
        while (true) {}
      }
    `);
    expect(result).toMatchObject({ ok: false, reason: 'error' });
    expect(result.error).toMatch(/timed out/);
  });
});
