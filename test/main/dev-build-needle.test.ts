import path from 'path';
import fs from 'fs';
import vm from 'vm';

test('development startup refreshes the inference worker before reporting ready', async () => {
  const directory = path.resolve('esbuild');
  const copyNeedle = jest.fn();
  const ready = jest.fn();
  const watch = jest.fn(async () => undefined);
  // eslint-disable-next-line no-unused-vars
  let onEnd: ((result: { errors: unknown[] }) => void) | undefined;
  const context = jest.fn(
    async (options: {
      plugins: {
        setup?: (build: {
          onEnd(callback: NonNullable<typeof onEnd>): void;
        }) => void;
      }[];
    }) => {
      options.plugins.forEach((plugin) => {
        plugin.setup?.({
          onEnd: (callback: typeof onEnd) => {
            onEnd = callback;
          },
        });
      });
      return { watch };
    },
  );
  const modules: Record<string, unknown> = {
    esbuild: { context },
    'esbuild-plugin-copy': {},
    'esbuild-plugin-progress': () => ({}),
    fs,
    path,
    './copyEsbuildWasm': jest.fn(),
    './copyWasmParser': jest.fn(),
    './copyNeedle': copyNeedle,
  };
  await vm.runInNewContext(
    fs.readFileSync(path.join(directory, 'esbuild.config.main.js'), 'utf8'),
    {
      require: (name: string) => modules[name],
      __dirname: directory,
      console: { info: () => ready(copyNeedle.mock.calls.length) },
      process: {
        exit: () => {
          throw new Error('Build failed');
        },
      },
    },
  );
  await Promise.resolve();
  expect(watch).toHaveBeenCalled();
  expect(onEnd).toBeDefined();
  onEnd?.({ errors: [] });
  expect(copyNeedle).toHaveBeenCalledWith(
    path.resolve('release/app/dist/main'),
  );
  expect(ready).toHaveBeenCalledWith(1);
  onEnd?.({ errors: [] });
  expect(copyNeedle).toHaveBeenCalledTimes(1);
});
