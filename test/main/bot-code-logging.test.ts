const runBotCode = require('../../src/main/src/workers/bot/extensions/runBotCode');

test('bot Code tab publishes a bounded preview', async () => {
  const publish = jest.fn();
  const bot = {
    entities: Object.fromEntries(
      Array.from({ length: 50_000 }, (_, id) => [`entity${id}`, { id }]),
    ),
    messenger: { publish },
  };

  await runBotCode({ code: 'console.log(bot)', bot });

  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0]).toBe('codeLogs');
  expect(Buffer.byteLength(publish.mock.calls[0][1])).toBeLessThanOrEqual(
    8 * 1024,
  );
  expect(publish.mock.calls[0][1]).toContain('truncated');
});
