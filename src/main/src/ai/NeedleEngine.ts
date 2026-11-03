import { Worker } from 'worker_threads';
import path from 'path';
import { existsSync } from 'fs';
import type { AiCall } from '../../../common/types/pluginApi';
import type { ToolDefinition } from './protocol';
import { aiError, isObject, jsonValue } from './schema';
import { AiModel, modelFile } from './model';

export interface EnginePrediction {
  calls: AiCall[];
  suppressedCalls: (AiCall & { reason?: string })[];
  confidence: number | null;
  reasoning: string | null;
}

export interface AiEngine {
  loadModel(model: AiModel, signal?: AbortSignal): Promise<void>;
  init(tools: ToolDefinition[], extraction?: boolean): Promise<void>;
  complete(
    text: string,
    maxNewTokens: number,
    reasoning?: boolean,
    toolFilterThreshold?: number | null,
  ): Promise<EnginePrediction>;
  embed(text: string): Promise<number[]>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** All native calls occur in this one host, including loading and tool indexing. */
export class NeedleEngine implements AiEngine {
  private readonly worker: Worker;

  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private sequence = 0;

  private failure?: Error;

  private toolsetKey?: string;

  readonly ready: Promise<void>;

  constructor(
    directory: string,
    private readonly cacheDirectory: string,
    linked: boolean,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.pending.set(0, { resolve: () => resolve(), reject });
    });
    this.worker = new Worker(path.join(directory, 'runtime.cjs'), {
      workerData: { directory, linked },
      env: { ...process.env, NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1' },
    });
    this.worker.on('message', (message: unknown) => {
      if (!isObject(message) || typeof message.id !== 'number') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok === true) pending.resolve(message.value);
      else {
        const code = [
          'AI_MODEL',
          'AI_UNSUPPORTED_PLATFORM',
          'AI_UNSUPPORTED_FEATURE',
          'AI_INVALID_INPUT',
          'AI_INVALID_OUTPUT',
        ].includes(String(message.code))
          ? String(message.code)
          : 'AI_ENGINE';
        pending.reject(
          aiError(
            code,
            typeof message.error === 'string'
              ? message.error
              : 'Native engine failed.',
          ),
        );
      }
      if (!this.pending.size) this.worker.unref();
    });
    this.worker.on('error', (error) => this.fail(error));
    this.worker.on('exit', () =>
      this.fail(aiError('AI_ENGINE', 'Native inference host exited.')),
    );
  }

  async loadModel(model: AiModel, signal?: AbortSignal): Promise<void> {
    this.toolsetKey = undefined;
    const file = await modelFile(this.cacheDirectory, signal, model);
    signal?.throwIfAborted();
    await this.request({ kind: 'load', file, variant: model.variant });
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private request(operation: Record<string, unknown>): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    this.worker.ref();
    this.sequence += 1;
    const id = this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...operation, id });
    });
  }

  async init(tools: ToolDefinition[], extraction = false): Promise<void> {
    const key = JSON.stringify([tools, extraction]);
    if (this.toolsetKey === key) return;
    await this.request({ kind: 'init', tools, extraction });
    this.toolsetKey = key;
  }

  async complete(
    text: string,
    maxNewTokens: number,
    reasoning = false,
    toolFilterThreshold: number | null = null,
  ): Promise<EnginePrediction> {
    const raw = await this.request({
      kind: 'complete',
      text,
      maxNewTokens,
      reasoning,
      toolFilterThreshold,
    });
    if (
      !isObject(raw) ||
      !Array.isArray(raw.calls) ||
      !Array.isArray(raw.suppressedCalls)
    )
      throw aiError('AI_INVALID_OUTPUT', 'Invalid inference response.');
    const parse = (value: unknown): AiCall => {
      if (
        !isObject(value) ||
        typeof value.name !== 'string' ||
        !isObject(value.arguments)
      )
        throw aiError('AI_INVALID_OUTPUT', 'Invalid model tool call.');
      const args = jsonValue(value.arguments);
      if (!isObject(args))
        throw aiError('AI_INVALID_OUTPUT', 'Invalid model arguments.');
      return { name: value.name, arguments: args };
    };
    return {
      calls: raw.calls.map(parse),
      suppressedCalls: raw.suppressedCalls.map(parse),
      confidence:
        typeof raw.confidence === 'number' &&
        Number.isFinite(raw.confidence) &&
        raw.confidence >= 0 &&
        raw.confidence <= 1
          ? raw.confidence
          : null,
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : null,
    };
  }

  async embed(text: string): Promise<number[]> {
    const values = await this.request({ kind: 'embed', text });
    if (
      !Array.isArray(values) ||
      !values.length ||
      !values.every(
        (value) => typeof value === 'number' && Number.isFinite(value),
      )
    )
      throw aiError(
        'AI_INVALID_OUTPUT',
        'The model returned invalid embeddings.',
      );
    return values;
  }

  async reset(): Promise<void> {
    await this.request({ kind: 'reset' });
  }

  async close(): Promise<void> {
    this.fail(aiError('AI_CANCELLED', 'Inference host closed.'));
    this.worker.unref();
    await this.worker.terminate();
  }
}

export async function loadNeedle(
  cacheDirectory: string,
  linked: boolean,
  signal?: AbortSignal,
): Promise<AiEngine> {
  process.env.NEEDLE_TELEMETRY = '0';
  process.env.DO_NOT_TRACK = '1';
  if (
    !['arm64', 'x64'].includes(process.arch) ||
    (linked && process.platform === 'android' && process.arch !== 'arm64')
  )
    throw aiError(
      'AI_UNSUPPORTED_PLATFORM',
      'Local inference is unavailable on this architecture.',
    );
  const candidates = [
    path.join(__dirname, 'needle'),
    path.join(process.resourcesPath ?? __dirname, 'assets', 'needle'),
    path.join(process.cwd(), 'assets', 'needle'),
  ];
  const directory = candidates.find(
    (candidate) =>
      existsSync(path.join(candidate, 'runtime.cjs')) &&
      (linked ||
        existsSync(
          path.join(
            candidate,
            `${process.platform}-${process.arch}`,
            'needle.node',
          ),
        )),
  );
  if (!directory)
    throw aiError(
      'AI_UNSUPPORTED_PLATFORM',
      `Local inference is not packaged for ${process.platform}-${process.arch}. Run the native build for this target.`,
    );
  signal?.throwIfAborted();
  const engine = new NeedleEngine(directory, cacheDirectory, linked);
  try {
    await engine.ready;
    signal?.throwIfAborted();
    return engine;
  } catch (error) {
    await engine.close();
    throw error;
  }
}
