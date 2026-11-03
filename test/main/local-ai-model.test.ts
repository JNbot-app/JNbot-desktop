import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import {
  defaultModel,
  modelFile,
  resolveModel,
} from '../../src/main/src/ai/model';

const mockGet = jest.fn();
jest.mock('https', () => ({
  get: (...args: unknown[]) => mockGet(...args),
}));

const downloadModel = resolveModel('https://example.com/model.cact');
let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jnbot-ai-model-'));
  mockGet.mockReset();
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

function respond(
  status = 200,
  body = 'model',
  location: string | undefined = undefined,
) {
  mockGet.mockImplementationOnce(
    (
      _url: string,
      options: { signal?: AbortSignal },
      callback: (response: IncomingMessage) => void,
    ) => {
      const request = Object.assign(new EventEmitter(), {
        setTimeout: jest.fn(),
      });
      const response = new IncomingMessage(new Socket());
      response.statusCode = status;
      response.headers = location ? { location } : {};
      queueMicrotask(() => {
        callback(response);
        response.push(body);
        if (body !== 'stall') response.push(null);
      });
      options.signal?.addEventListener(
        'abort',
        () => {
          response.destroy(new Error('aborted'));
          request.emit('error', new Error('aborted'));
        },
        { once: true },
      );
      return request;
    },
  );
}

test('blank and explicit default URLs preserve the default model', () => {
  for (const url of [undefined, '', ' \n ', defaultModel.url])
    expect(resolveModel(url)).toEqual(defaultModel);
});

test('custom IDs normalize URLs and preserve version query parameters', () => {
  const model = resolveModel(' HTTPS://Example.com/tuned.cact?v=1#download ');
  expect(model.url).toBe('https://example.com/tuned.cact?v=1');
  expect(model.id).toMatch(/^jnbot-custom-[a-f0-9]{64}-main$/);
  expect(resolveModel(model.url)).toEqual(model);
  expect(resolveModel('https://example.com/tuned.cact?v=2').id).not.toBe(
    model.id,
  );
});

test.each([
  null,
  42,
  {},
  'bad url',
  'http://example.com/model',
  'file:///model',
])('rejects invalid model URL %p', (url) => {
  expect(() => resolveModel(url)).toThrow(
    expect.objectContaining({ code: 'AI_INVALID_INPUT' }),
  );
});

test('downloads once and reuses the cached model offline', async () => {
  respond();
  const model = resolveModel('https://example.com/tuned.cact?version=1');
  const file = await modelFile(directory, undefined, model);
  expect(await fs.readFile(file, 'utf8')).toBe('model');
  expect(mockGet).toHaveBeenCalledWith(
    model.url,
    expect.anything(),
    expect.any(Function),
  );
  expect(await modelFile(directory, undefined, model)).toBe(file);
  expect(mockGet).toHaveBeenCalledTimes(1);
  expect(await fs.readdir(path.dirname(file))).toEqual(['model.cact']);
});

test('downloads log start, throttled progress and completion without the URL', async () => {
  respond();
  jest
    .spyOn(Date, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValue(6_000);
  await modelFile(directory, undefined, downloadModel);
  expect(console.info).toHaveBeenCalledWith('[AI] Downloading model', {
    modelId: downloadModel.id,
  });
  expect(console.info).toHaveBeenCalledWith('[AI] Model download progress', {
    modelId: downloadModel.id,
    receivedBytes: 5,
    totalBytes: null,
  });
  expect(console.info).toHaveBeenCalledWith('[AI] Model download complete', {
    modelId: downloadModel.id,
    elapsedMs: 6_000,
  });
  expect(JSON.stringify(jest.mocked(console.info).mock.calls)).not.toContain(
    downloadModel.url,
  );
});

test('follows HTTPS redirects and refuses a downgrade', async () => {
  respond(302, '', '/download');
  respond();
  await modelFile(directory, undefined, downloadModel);
  expect(mockGet.mock.calls[1][0]).toBe(
    new URL('/download', downloadModel.url).href,
  );
  await fs.rm(path.join(directory, downloadModel.cacheId, 'model.cact'));
  respond(302, '', 'http://example.com/model');
  await expect(
    modelFile(directory, undefined, downloadModel),
  ).rejects.toMatchObject({
    code: 'AI_DOWNLOAD',
  });
  expect(console.warn).toHaveBeenCalledWith('[AI] Model download failed', {
    modelId: downloadModel.id,
    cancelled: false,
  });
  expect(await fs.readdir(path.join(directory, downloadModel.cacheId))).toEqual(
    [],
  );
});

test('failed downloads can retry without partial files', async () => {
  respond(404);
  await expect(
    modelFile(directory, undefined, downloadModel),
  ).rejects.toMatchObject({
    code: 'AI_DOWNLOAD',
  });
  expect(await fs.readdir(path.join(directory, downloadModel.cacheId))).toEqual(
    [],
  );
  respond();
  await expect(modelFile(directory, undefined, downloadModel)).resolves.toBe(
    path.join(directory, downloadModel.cacheId, 'model.cact'),
  );
});

test('cancelling a response stream removes the partial download', async () => {
  respond(200, 'stall');
  const controller = new AbortController();
  const pending = modelFile(directory, controller.signal, downloadModel);
  const rejection = pending.catch((error: unknown) => error);
  while (!mockGet.mock.calls.length)
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  controller.abort(
    Object.assign(new Error('cancelled'), { code: 'AI_CANCELLED' }),
  );
  expect(await rejection).toMatchObject({ code: 'AI_CANCELLED' });
  expect(await fs.readdir(path.join(directory, downloadModel.cacheId))).toEqual(
    [],
  );
});

test('flash prefers its own file, then a compatible installed main file without downloading', async () => {
  const file = path.join(directory, defaultModel.cacheId, 'model.cact');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'main');
  await fs.writeFile(`${file}.sha256`, defaultModel.sha256!);
  const flash = resolveModel(undefined, 'flash');
  expect(await modelFile(directory, undefined, flash)).toBe(file);
  const flashFile = path.join(directory, flash.cacheId, 'model.cact');
  await fs.mkdir(path.dirname(flashFile));
  await fs.writeFile(flashFile, 'flash');
  await fs.writeFile(`${flashFile}.sha256`, flash.sha256!);
  expect(await modelFile(directory, undefined, flash)).toBe(flashFile);
  expect(mockGet).not.toHaveBeenCalled();
});
test('a flash install cannot satisfy main and unconfigured releases fail without downloads', async () => {
  const flash = resolveModel(undefined, 'flash');
  const file = path.join(directory, flash.cacheId, 'model.cact');
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, 'flash');
  await expect(
    modelFile(directory, undefined, { ...defaultModel, url: '' }),
  ).rejects.toMatchObject({
    code: 'AI_MODEL',
  });
  expect(await fs.readFile(file, 'utf8')).toBe('flash');
  expect(mockGet).not.toHaveBeenCalled();
});
