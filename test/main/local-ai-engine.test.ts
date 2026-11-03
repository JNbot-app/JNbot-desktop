import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { NeedleEngine } from '../../src/main/src/ai/NeedleEngine';
import { defaultModel, resolveModel } from '../../src/main/src/ai/model';

const mockMessages: Record<string, unknown>[] = [];
let mockRejectLoad = false;
jest.mock('worker_threads', () => {
  const { EventEmitter } = jest.requireActual('events');
  return {
    Worker: class extends EventEmitter {
      constructor() {
        super();
        queueMicrotask(() => this.emit('message', { id: 0, ok: true }));
      }

      postMessage(message: Record<string, unknown>) {
        mockMessages.push(message);
        const failed = message.kind === 'load' && mockRejectLoad;
        queueMicrotask(() =>
          this.emit('message', {
            id: message.id,
            ok: !failed,
            code: 'AI_MODEL',
            error: 'invalid model',
          }),
        );
      }

      ref() {
        return this;
      }

      unref() {
        return this;
      }

      async terminate() {
        this.removeAllListeners();
        return 0;
      }
    },
  };
});

test('native loads select variants, preserve cached files on errors and reuse tool preparation', async () => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'jnbot-ai-engine-'));
  const custom = resolveModel('https://example.com/custom.cact');
  mockRejectLoad = false;
  mockMessages.length = 0;
  const engine = new NeedleEngine('/packaged/needle', cache, false);
  try {
    await engine.ready;
    expect(mockMessages).toEqual([]);
    for (const model of [defaultModel, custom]) {
      const directory = path.join(cache, model.cacheId);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'model.cact'), 'cached');
      // Without the digest marker a built-in model counts as stale and is downloaded.
      if (model.sha256)
        await fs.writeFile(path.join(directory, 'model.cact.sha256'), model.sha256);
      await engine.loadModel(model);
    }
    expect(mockMessages).toEqual(
      [defaultModel, custom].map((model) =>
        expect.objectContaining({
          kind: 'load',
          file: path.join(cache, model.cacheId, 'model.cact'),
          variant: model.variant,
        }),
      ),
    );
    await engine.init([]);
    await engine.init([]);
    expect(
      mockMessages.filter((message) => message.kind === 'init'),
    ).toHaveLength(1);
    await engine.loadModel(resolveModel(custom.url, 'flash'));
    expect(mockMessages.at(-1)).toEqual(
      expect.objectContaining({
        kind: 'load',
        variant: 'flash',
        file: path.join(cache, custom.cacheId, 'model.cact'),
      }),
    );
    await engine.init([]);
    expect(
      mockMessages.filter((message) => message.kind === 'init'),
    ).toHaveLength(2);
    mockRejectLoad = true;
    await expect(engine.loadModel(custom)).rejects.toMatchObject({
      code: 'AI_MODEL',
    });
    await expect(
      fs.access(path.join(cache, custom.cacheId, 'model.cact')),
    ).resolves.toBeUndefined();
    mockRejectLoad = false;
    await engine.loadModel(defaultModel);
    await expect(
      fs.access(path.join(cache, defaultModel.cacheId, 'model.cact')),
    ).resolves.toBeUndefined();
  } finally {
    await engine.close();
    await fs.rm(cache, { recursive: true, force: true });
  }
});
