import Script from '../../src/main/src/functions/Script';

describe('Script restart', () => {
  test('stops the current worker before starting its replacement', async () => {
    const script = Object.create(Script.prototype) as Script & {
      stop: jest.Mock<Promise<void>, []>;
      run: jest.Mock<Promise<void>, []>;
    };
    script.worker = {} as never;
    script.stop = jest.fn(async () => undefined);
    script.run = jest.fn(async () => undefined);

    await script.restart();

    expect(script.stop).toHaveBeenCalledTimes(1);
    expect(script.run).toHaveBeenCalledTimes(1);
    expect(script.stop.mock.invocationCallOrder[0]).toBeLessThan(
      script.run.mock.invocationCallOrder[0],
    );
  });
});
