import type {
  AiAPI,
  AiAgent,
  AiTool,
  AiPredictOptions,
  AiRequestOptions,
  AiJsonObject,
  AiSchema,
  AiModelOptions,
} from '../../../common/types/pluginApi';
import { aiError, compileSchema } from './schema';
import type { AiOperation, AiRequest, AiResponse } from './protocol';
import Agent from './Agent';
import { RequestScope, input, checkContext } from './request';
import { resolveModel, AiModel } from './model';

export default class AiClient implements AiAPI {
  private readonly operation: AiOperation;

  constructor(
    operation: AiOperation,
    private readonly networkAllowed = true,
  ) {
    this.operation = operation;
  }

  private model(options: AiModelOptions, embeddings = false): AiModel {
    const model = resolveModel(options.modelUrl, options.model);
    if (embeddings && model.variant === 'flash')
      throw aiError(
        'AI_UNSUPPORTED_FEATURE',
        'The flash model does not support embeddings.',
      );
    if (!this.networkAllowed && !model.builtIn)
      throw aiError(
        'AI_INVALID_INPUT',
        'Custom AI models require external network access.',
      );
    return model;
  }

  createAgent(options: AiModelOptions & { tools?: AiTool[] } = {}): AiAgent {
    return new Agent(this, options.tools ?? [], this.model(options));
  }

  async extract(
    text: string,
    schema: AiSchema,
    options: AiPredictOptions & AiModelOptions = {},
  ): Promise<AiJsonObject | null> {
    const maxNewTokens = input(text, options);
    const model = this.model(options);
    const validate: ReturnType<typeof compileSchema> = compileSchema(schema);
    const captured = structuredClone(schema);
    const response = await this.once(options, (scope) => ({
      kind: 'extract',
      modelUrl: model.builtIn ? undefined : model.url,
      model: model.variant,
      text,
      schema: captured,
      maxNewTokens,
      reasoning: options.reasoning ?? false,
      toolFilterThreshold: options.toolFilterThreshold,
      requestId: scope.id,
      deadline: scope.deadline,
    }));
    if (response.kind !== 'extraction')
      throw aiError('AI_INVALID_OUTPUT', 'Expected an extraction response.');
    if (response.value !== null) validate(response.value);
    return response.value;
  }

  async embed(
    text: string,
    options: AiRequestOptions & AiModelOptions = {},
    lifetime: AbortSignal | undefined = undefined,
  ): Promise<{ modelId: string; values: number[] }> {
    input(text, options);
    const model = this.model(options, true);
    const response = await this.once(
      options,
      (scope) => ({
        kind: 'embed',
        modelUrl: model.builtIn ? undefined : model.url,
        model: model.variant,
        text,
        requestId: scope.id,
        deadline: scope.deadline,
      }),
      lifetime,
    );
    if (response.kind !== 'embedding')
      throw aiError('AI_INVALID_OUTPUT', 'Expected an embedding response.');
    return { modelId: response.modelId, values: response.values };
  }

  private async once(
    options: AiRequestOptions,
    request: (scope: RequestScope) => AiRequest,
    lifetime?: AbortSignal,
  ): Promise<AiResponse> {
    checkContext();
    const scope = new RequestScope(options, lifetime);
    try {
      return await this.send(request(scope), scope);
    } finally {
      await this.finish(scope);
    }
  }

  send(request: AiRequest, scope: RequestScope): Promise<AiResponse> {
    return scope.wait(() => this.operation(request));
  }

  async finish(scope: RequestScope): Promise<void> {
    scope.close();
    try {
      await this.operation({ kind: 'cancel', requestId: scope.id });
    } catch {
      /* Caller cleanup also cancels outstanding backend work. */
    }
  }
}
