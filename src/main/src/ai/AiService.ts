import type { AiPrediction } from '../../../common/types/pluginApi';
import { AiEngine, EnginePrediction, loadNeedle } from './NeedleEngine';
import { resolveModel, AiModel } from './model';
import {
  aiError,
  compileSchema,
  isObject,
  RegisteredTool,
  registerTools,
} from './schema';
import type { AiRequest, AiResponse } from './protocol';
import scheduleDeadline from './deadline';

interface Job {
  owner: string;
  model: AiModel;
  request: Exclude<AiRequest, { kind: 'cancel' }>;
  tools: Map<string, RegisteredTool>;
  revision: number;
  controller: AbortController;
  cancelTimer: () => void;
  resolve: (response: AiResponse) => void;
  reject: (error: unknown) => void;
  work: Promise<unknown>;
  release?: Promise<void>;
}

/** One process-owned queue. Every inference request is independent. */
export class AiService {
  private engine?: AiEngine;

  private modelId?: string;

  private initialization?: Promise<AiEngine>;

  private readonly jobs = new Set<Job>();

  private readonly queue: Job[] = [];

  private active?: Job;

  private closed = false;

  private readonly initializationController = new AbortController();

  private readonly load: (signal?: AbortSignal) => Promise<AiEngine>;

  constructor(load: (signal?: AbortSignal) => Promise<AiEngine>) {
    this.load = load;
  }

  async request(
    owner: string,
    request: unknown,
    networkAllowed = true,
  ): Promise<AiResponse> {
    AiService.validate(request);
    if (request.kind === 'cancel') {
      this.cancel(owner, request.requestId);
      return { kind: 'ended' };
    }
    if (this.closed) throw aiError('AI_CANCELLED', 'AI service is closed.');
    const model = resolveModel(request.modelUrl, request.windowSize);
    if (!networkAllowed && !model.builtIn)
      throw aiError(
        'AI_INVALID_INPUT',
        'Custom AI models require external network access.',
      );
    const tools =
      request.kind === 'predict'
        ? registerTools(request.tools)
        : new Map<string, RegisteredTool>();
    if (request.kind === 'predict' && !tools.size) {
      return {
        kind: 'prediction',
        prediction: {
          status: 'no_match',
          calls: [],
          suppressedCalls: [],
          toolsetRevision: request.revision,
          modelId: model.id,
          reasoning: null,
          confidence: null,
        },
      };
    }
    if (request.kind === 'extract') compileSchema(request.schema);
    if (
      this.jobs.size &&
      [...this.jobs].some(
        (job) =>
          job.owner === owner && job.request.requestId === request.requestId,
      )
    )
      throw aiError('AI_INVALID_INPUT', 'Duplicate AI request ID.');
    return new Promise((resolve, reject) => {
      const job: Job = {
        owner,
        model,
        request,
        tools,
        revision: 'revision' in request ? request.revision : 0,
        controller: new AbortController(),
        resolve,
        reject,
        work: Promise.resolve(),
        cancelTimer: scheduleDeadline(request.deadline, () =>
          this.cancel(owner, request.requestId, 'AI_TIMEOUT'),
        ),
      };
      this.jobs.add(job);
      this.queue.push(job);
      this.pump();
    });
  }

  private static validate(request: unknown): asserts request is AiRequest {
    if (
      !isObject(request) ||
      typeof request.requestId !== 'string' ||
      !request.requestId ||
      typeof request.kind !== 'string' ||
      !['predict', 'extract', 'cancel'].includes(request.kind)
    )
      throw aiError('AI_INVALID_INPUT', 'Invalid AI operation.');
    if (request.kind === 'cancel') return;
    if (
      typeof request.deadline !== 'number' ||
      !Number.isFinite(request.deadline) ||
      request.deadline <= Date.now()
    )
      throw aiError('AI_TIMEOUT', 'AI request deadline exceeded.');
    if (typeof request.text !== 'string')
      throw aiError('AI_INVALID_INPUT', 'Expected text.');
    resolveModel(request.modelUrl, request.windowSize);
    if (
      request.reasoning !== undefined &&
      typeof request.reasoning !== 'boolean'
    )
      throw aiError('AI_INVALID_INPUT', 'reasoning must be a boolean.');
    if (
      typeof request.maxNewTokens !== 'number' ||
      !Number.isSafeInteger(request.maxNewTokens) ||
      request.maxNewTokens < 1 ||
      request.maxNewTokens > 2_147_483_647
    )
      throw aiError('AI_INVALID_INPUT', 'Invalid token budget.');
    if (request.kind === 'predict') {
      if (
        typeof request.revision !== 'number' ||
        !Number.isSafeInteger(request.revision) ||
        request.revision < 0 ||
        !Array.isArray(request.tools)
      )
        throw aiError('AI_INVALID_INPUT', 'Invalid toolset.');
      for (const tool of request.tools) {
        if (
          !isObject(tool) ||
          typeof tool.name !== 'string' ||
          !tool.name.trim() ||
          typeof tool.description !== 'string' ||
          'handler' in tool
        )
          throw aiError('AI_INVALID_INPUT', 'Invalid tool definition.');
        compileSchema(tool.parameters);
      }
    }
    if (request.kind === 'extract') compileSchema(request.schema);
  }

  private async getEngine(): Promise<AiEngine> {
    if (!this.initialization) {
      this.initialization = this.load(this.initializationController.signal)
        .then((engine) => {
          this.engine = engine;
          return engine;
        })
        .catch((error) => {
          this.initialization = undefined;
          throw error;
        });
    }
    return this.initialization;
  }

  private static check(job: Job): void {
    if (job.controller.signal.aborted) throw job.controller.signal.reason;
    if (Date.now() >= job.request.deadline)
      throw aiError('AI_TIMEOUT', 'AI request deadline exceeded.');
  }

  private static prediction(job: Job, raw: EnginePrediction): AiResponse {
    for (const call of raw.calls) {
      const tool: RegisteredTool | undefined = job.tools.get(call.name);
      if (!tool)
        throw aiError('AI_INVALID_OUTPUT', `Unknown tool: ${call.name}.`);
      tool.validate(call.arguments);
    }
    let status: AiPrediction['status'] = 'no_match';
    if (raw.suppressedCalls.length) status = 'withheld';
    if (raw.calls.length) status = 'calls';
    const prediction: AiPrediction = {
      status,
      calls: raw.calls,
      suppressedCalls: raw.suppressedCalls,
      confidence: raw.confidence,
      reasoning: raw.reasoning,
      modelId: job.model.id,
      toolsetRevision: job.revision,
    };
    return {
      kind: 'prediction',
      prediction,
    };
  }

  private pump(): void {
    if (this.active || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    if (job.controller.signal.aborted) {
      this.pump();
      return;
    }
    this.active = job;
    job.work = this.execute(job);
    job.work
      .then(
        (response) => job.resolve(response as AiResponse),
        (error) => {
          job.controller.abort(error);
          return job.reject(error);
        },
      )
      .finally(() => {
        this.release(job).catch(() => undefined);
      })
      .catch(() => undefined);
  }

  private async execute(job: Job): Promise<AiResponse> {
    AiService.check(job);
    const engine = await this.getEngine();
    AiService.check(job);
    if (this.modelId !== job.model.id) {
      this.modelId = undefined;
      await engine.loadModel(job.model, job.controller.signal);
      this.modelId = job.model.id;
      AiService.check(job);
    }
    const { request } = job;
    if (request.kind === 'extract') {
      const validate: ReturnType<typeof compileSchema> = compileSchema(
        request.schema,
      );
      await engine.init(
        [
          {
            name: 'extract',
            description: 'Extract a structured record from the supplied text',
            parameters: request.schema,
          },
        ],
        true,
      );
      const fields = Object.keys(request.schema.properties ?? {}).join(', ');
      const raw = await engine.complete(
        `Extract the ${fields || 'record'}: ${request.text}`,
        request.maxNewTokens,
        request.reasoning ?? false,
        job.model.windowSize,
      );
      AiService.check(job);
      if (raw.suppressedCalls.length)
        throw aiError(
          'AI_INVALID_OUTPUT',
          'Extraction was withheld by the model.',
        );
      if (!raw.calls.length) return { kind: 'extraction', value: null };
      if (raw.calls.length !== 1 || raw.calls[0].name !== 'extract')
        throw aiError('AI_INVALID_OUTPUT', 'Invalid extraction call.');
      validate(raw.calls[0].arguments);
      return { kind: 'extraction', value: raw.calls[0].arguments };
    }
    await engine.init([...job.tools.values()].map((tool) => tool.definition));
    const raw = await engine.complete(
      request.text,
      request.maxNewTokens,
      request.reasoning ?? false,
      job.model.windowSize,
    );
    AiService.check(job);
    return AiService.prediction(job, raw);
  }

  private release(job: Job): Promise<void> {
    if (job.release) return job.release;
    job.release = (async () => {
      await job.work.catch(() => undefined);
      try {
        if (this.engine && this.modelId) await this.engine.reset();
      } finally {
        job.cancelTimer();
        this.jobs.delete(job);
        if (this.active === job) this.active = undefined;
        this.pump();
      }
    })();
    return job.release;
  }

  cancel(owner: string, requestId?: string, code = 'AI_CANCELLED'): void {
    this.jobs.forEach((job) => {
      if (
        job.owner !== owner ||
        (requestId !== undefined && job.request.requestId !== requestId)
      )
        return;
      const error = aiError(
        code,
        code === 'AI_TIMEOUT'
          ? 'AI request deadline exceeded.'
          : 'AI request cancelled.',
      );
      job.controller.abort(error);
      job.reject(error);
      if (this.active === job) this.release(job).catch(() => undefined);
      else {
        job.cancelTimer();
        this.jobs.delete(job);
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.jobs) this.cancel(job.owner);
    this.initializationController.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (async () => {
      const engine =
        this.engine ?? (await this.initialization?.catch(() => undefined));
      if (engine) await engine.close();
      if (this.active) await this.release(this.active).catch(() => undefined);
    })();
    try {
      await Promise.race([
        cleanup,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3_000);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

let shared: AiService | undefined;
export function getAiService(): AiService {
  if (!shared) {
    shared = new AiService(async (signal) => {
      const { devicePath } = await import('../functions/storage/portablePaths');
      return loadNeedle(
        devicePath('ai'),
        Boolean(global.isMobileRuntime),
        signal,
      );
    });
    process.once('beforeExit', () => {
      shared?.close().catch(() => undefined);
    });
  }
  return shared;
}

export function cancelAiOwner(owner: string): void {
  shared?.cancel(owner);
}
export async function closeAiService(): Promise<void> {
  await shared?.close();
}
