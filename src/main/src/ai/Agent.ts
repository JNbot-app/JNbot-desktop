import type AiClient from './AiClient';
import type {
  AiAgent,
  AiTool,
  AiPrediction,
  AiPredictOptions,
  AiRunOptions,
  AiRunResult,
} from '../../../common/types/pluginApi';
import {
  aiError,
  errorInfo,
  jsonValue,
  registerTools,
  RegisteredTool,
} from './schema';
import type { AiModel } from './model';
import { RequestScope, input, checkContext, inHandler } from './request';

function empty(revision: number, modelId: string): AiPrediction {
  return {
    status: 'no_match',
    calls: [],
    suppressedCalls: [],
    toolsetRevision: revision,
    modelId,
    confidence: null,
    reasoning: null,
  };
}

export default class Agent implements AiAgent {
  private tools: Map<string, RegisteredTool>;

  private revision = 0;

  private readonly lifetime = new AbortController();

  constructor(
    private readonly client: AiClient,
    tools: AiTool[],
    private readonly model: AiModel,
  ) {
    this.tools = registerTools(tools);
  }

  private check(): void {
    if (this.lifetime.signal.aborted)
      throw aiError('AI_DISPOSED', 'AI agent has been disposed.');
  }

  setTools(tools: AiTool[]): void {
    this.check();
    const next = registerTools(tools);
    this.tools = next;
    this.revision += 1;
  }

  addTool(tool: AiTool): void {
    this.check();
    for (const [name, entry] of registerTools([tool]))
      this.tools.set(name, entry);
    this.revision += 1;
  }

  removeTool(name: string): void {
    this.check();
    if (this.tools.delete(name)) this.revision += 1;
  }

  dispose(): void {
    this.lifetime.abort();
    this.tools.clear();
  }

  async predict(
    text: string,
    options: AiPredictOptions = {},
  ): Promise<AiPrediction> {
    this.check();
    checkContext();
    const maxNewTokens = input(text, options);
    const tools = new Map(this.tools);
    const { revision } = this;
    const scope = new RequestScope(options, this.lifetime.signal);
    try {
      scope.check();
      if (!tools.size) return empty(revision, this.model.id);
      const response = await this.client.send(
        {
          kind: 'predict',
          modelUrl: this.model.builtIn ? undefined : this.model.url,
          windowSize: this.model.windowSize,
          text,
          tools: [...tools.values()].map((tool) => tool.definition),
          revision,
          maxNewTokens,
          reasoning: options.reasoning ?? false,
          requestId: scope.id,
          deadline: scope.deadline,
        },
        scope,
      );
      if (response.kind !== 'prediction')
        throw aiError('AI_INVALID_OUTPUT', 'Expected a prediction response.');
      return response.prediction;
    } finally {
      await this.client.finish(scope);
    }
  }

  async run(text: string, options: AiRunOptions = {}): Promise<AiRunResult> {
    this.check();
    checkContext();
    const maxNewTokens = input(text, options);
    const tools = new Map(this.tools);
    const result: AiRunResult = {
      status: 'no_match',
      toolsetRevision: this.revision,
      modelId: this.model.id,
      steps: 0,
      results: [],
    };
    const scope = new RequestScope(options, this.lifetime.signal);
    try {
      scope.check();
      if (!tools.size) {
        result.prediction = empty(result.toolsetRevision, this.model.id);
        return result;
      }
      const response = await this.client.send(
        {
          kind: 'predict',
          modelUrl: this.model.builtIn ? undefined : this.model.url,
          windowSize: this.model.windowSize,
          text,
          tools: [...tools.values()].map((tool) => tool.definition),
          revision: result.toolsetRevision,
          maxNewTokens,
          reasoning: options.reasoning ?? false,
          requestId: scope.id,
          deadline: scope.deadline,
        },
        scope,
      );
      if (response.kind !== 'prediction')
        throw aiError('AI_INVALID_OUTPUT', 'Expected a prediction response.');
      result.steps = 1;
      result.prediction = response.prediction;
      result.modelId = response.prediction.modelId;
      if (!response.prediction.calls.length) {
        result.status =
          response.prediction.status === 'withheld' ? 'withheld' : 'no_match';
        return result;
      }
      for (const call of response.prediction.calls) {
        const tool = tools.get(call.name);
        if (!tool)
          throw aiError('AI_INVALID_OUTPUT', `Unknown tool: ${call.name}.`);
        tool.validate(call.arguments);
        if (!tool.handler)
          throw aiError('AI_MISSING_HANDLER', `No handler for ${call.name}.`);
      }
      for (const call of response.prediction.calls) {
        scope.check();
        const handler = tools.get(call.name)?.handler;
        if (!handler)
          throw aiError('AI_MISSING_HANDLER', `No handler for ${call.name}.`);
        try {
          const returned = await scope.wait(() =>
            inHandler(() => handler(structuredClone(call.arguments))),
          );
          result.results.push({
            ...call,
            value: jsonValue(returned === undefined ? null : returned),
          });
        } catch (error) {
          result.results.push({ ...call, error: errorInfo(error) });
          throw error;
        }
      }
      result.status = 'completed';
      return result;
    } catch (error) {
      result.error = errorInfo(error);
      result.status = ['AI_CANCELLED', 'AI_TIMEOUT'].includes(result.error.code)
        ? 'cancelled'
        : 'failed';
      return result;
    } finally {
      await this.client.finish(scope);
    }
  }
}
