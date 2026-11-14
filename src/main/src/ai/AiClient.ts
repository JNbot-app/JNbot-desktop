import type {
  AiAPI,
  AiAgent,
  AiTool,
  AiPredictOptions,
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

  private model(options: AiModelOptions): AiModel {
    const model = resolveModel(options.modelUrl, options.windowSize);
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
      windowSize: model.windowSize,
      text,
      schema: captured,
      maxNewTokens,
      reasoning: options.reasoning ?? false,
      requestId: scope.id,
      deadline: scope.deadline,
    }));
    if (response.kind !== 'extraction')
      throw aiError('AI_INVALID_OUTPUT', 'Expected an extraction response.');
    if (response.value !== null) validate(response.value);
    return response.value;
  }

  private async once(
    options: AiPredictOptions,
    request: (scope: RequestScope) => AiRequest,
  ): Promise<AiResponse> {
    checkContext();
    const scope = new RequestScope(options);
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
