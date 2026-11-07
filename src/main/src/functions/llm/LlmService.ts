import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import * as z from 'zod/v4';
import {
  llmProvider,
  parseLlmJson,
  runLlmAgent,
  type LlmConfig,
  type LlmGenerateInput,
  type LlmMessage,
  type LlmModelsInput,
  type LlmRequest,
  type LlmResponse,
  type LlmStatus,
  type LlmToolSpec,
  type LlmWritePluginInput,
} from '../../../../common/llm';
import { PLUGIN_AUTHORING_GUIDE } from '../../../../common/pluginAuthoringGuideSource';
import { JNBOT_REFERENCE_SECTION_IDS } from '../../../../common/pluginMcpReferenceSource';
import { TRIGGER_ACTION_TYPES, TRIGGER_EVENTS, newTrigger, triggerProblem, type Trigger } from '../../../../common/triggers';
import type ScriptHandler from '../ScriptHandler';
import type McpManager from '../mcp/McpManager';
import { MCP_INSTRUCTIONS } from '../mcp/McpManager';

/** Claude models that accept the server-side refusal fallback. */
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;
const TERMINAL = ['succeeded', 'failed', 'denied', 'cancelled'];
/** One model call. Busy providers sometimes hold a request without answering. */
const REQUEST_TIMEOUT_MS = 90_000;
/** Overloaded / rate limited: worth a quick retry. */
const RETRY_STATUSES = [429, 500, 503];
/** Listed models that can't chat (speech, images, embeddings...). */
const NON_CHAT_MODEL = /embed|tts|audio|image|imagen|veo|banana|lyria|whisper|dall-e|moderation|transcribe|translate|realtime|live|aqa|robotics|computer-use|research|antigravity/i;

/**
 * The optional LLM integration. Users bring their own key (stored in a plain
 * file in userData); every AI feature in the UI is hidden until one is set.
 */
export class LlmService {
  private config: LlmConfig | null = null;
  private readonly file = path.join(app.getPath('userData'), 'ai.json');

  constructor(
    private readonly scriptHandler: ScriptHandler,
    private readonly mcp: McpManager,
  ) {
    try {
      this.config = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.config = null;
    }
  }

  status(): LlmStatus {
    const config = this.config;
    const provider = config && llmProvider(config.provider);
    return {
      configured: Boolean(config?.model && (config.apiKey || !provider?.keyUrl)),
      provider: config?.provider,
      model: config?.model,
    };
  }

  /** Save settings; an omitted key keeps the stored one. `null` removes everything. */
  setConfig(input: LlmConfig | null): LlmStatus {
    if (!input) {
      this.config = null;
      fs.rmSync(this.file, { force: true });
    } else {
      const apiKey = input.apiKey || this.savedKey(input.provider);
      this.config = { provider: input.provider, model: input.model?.trim() || undefined, baseUrl: input.baseUrl?.trim() || undefined, apiKey: apiKey?.trim() || undefined };
      fs.writeFileSync(this.file, JSON.stringify(this.config), { mode: 0o600 });
    }
    this.scriptHandler.windowHandler.sendToAll('LLM_STATUS', this.status());
    return this.status();
  }

  async test(): Promise<string> {
    return this.ask('Reply with one short friendly sentence confirming you work.', 'Hello!');
  }

  /** The provider's current chat models, so the list never goes stale. */
  async models(input: LlmModelsInput): Promise<string[]> {
    const provider = llmProvider(input.provider);
    const apiKey = input.apiKey || this.savedKey(input.provider);
    const baseUrl = input.baseUrl || provider.baseUrl;
    if (provider.keyUrl && !apiKey) return [];
    let ids: string[];
    if (provider.format === 'anthropic') {
      ids = [];
      for await (const model of this.claude(apiKey!, baseUrl).models.list({ limit: 100 })) ids.push(model.id);
    } else {
      const response = await this.fetchOpenAi(`${baseUrl.replace(/\/$/, '')}/models`, { headers: bearer(apiKey) });
      ids = ((await response.json()).data ?? []).map((model: { id: string }) => model.id.replace(/^models\//, ''));
    }
    return ids.filter((id) => !NON_CHAT_MODEL.test(id));
  }

  private savedKey(provider: string) {
    return provider === this.config?.provider ? this.config.apiKey : undefined;
  }

  // ---------------------------------------------------------------------------
  // Model calls
  // ---------------------------------------------------------------------------

  complete(request: LlmRequest): Promise<LlmResponse> {
    const config = this.config;
    if (!config?.model || !this.status().configured) throw new Error('Pick an AI provider and model in Settings first.');
    const provider = llmProvider(config.provider);
    const model = config.model;
    const baseUrl = config.baseUrl || provider.baseUrl;
    return provider.format === 'anthropic'
      ? this.completeClaude(request, model, baseUrl, config.apiKey!)
      : this.completeOpenAi(request, model, baseUrl, config.apiKey);
  }

  async ask(system: string, prompt: string): Promise<string> {
    return (await this.complete({ system, messages: [{ role: 'user', content: prompt }] })).text;
  }

  private async completeClaude(request: LlmRequest, model: string, baseURL: string, apiKey: string): Promise<LlmResponse> {
    const client = this.claude(apiKey, baseURL);
    const fallback = FALLBACK_MODELS.test(model);
    const response = await client.beta.messages.create({
      model,
      max_tokens: request.maxTokens ?? 16_000,
      ...(request.system ? { system: request.system } : {}),
      messages: toClaudeMessages(request.messages),
      ...(request.tools?.length
        ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema,
          })),
        }
        : {}),
      ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    if (response.stop_reason === 'refusal') {
      return { text: 'The AI declined to help with this request.', toolCalls: [] };
    }
    return {
      text: response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n'),
      toolCalls: response.content.flatMap((block) =>
        block.type === 'tool_use'
          ? [{ id: block.id, name: block.name, input: block.input as Record<string, unknown> }]
          : [],
      ),
      raw: response.content,
    };
  }

  private claude(apiKey: string, baseURL: string) {
    // The SDK retries overloaded/rate-limited requests itself.
    return new Anthropic({ apiKey, baseURL, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
  }

  /** fetch with a timeout and a retry while the provider is busy; throws a readable error. */
  private async fetchOpenAi(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (error) {
        if ((error as Error).name !== 'TimeoutError') throw error;
        throw new Error('The AI provider did not answer in time. It may be busy: try again, or pick another model in Settings.');
      }
      if (response.ok) return response;
      if (attempt < 2 && RETRY_STATUSES.includes(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
        continue;
      }
      const body = await response.json().catch(() => null) as any;
      const detail = body?.error?.message ?? (Array.isArray(body) ? body[0]?.error?.message : undefined);
      throw new Error(`AI request failed (${response.status})${detail ? `: ${detail}` : ''}`);
    }
  }

  private async completeOpenAi(request: LlmRequest, model: string, baseUrl: string, apiKey?: string): Promise<LlmResponse> {
    const response = await this.fetchOpenAi(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer(apiKey) },
      body: JSON.stringify({
        model,
        messages: [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          ...request.messages.map(toOpenAiMessage),
        ],
        ...(request.tools?.length
          ? { tools: request.tools.map((tool) => ({ type: 'function', function: tool })) }
          : {}),
      }),
    });
    const body = await response.json() as any;
    const message = body?.choices?.[0]?.message ?? {};
    return {
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls: (message.tool_calls ?? []).map((call: any) => ({
        id: call.id,
        name: call.function?.name,
        input: safeJson(call.function?.arguments),
      })),
      raw: message,
    };
  }

  // ---------------------------------------------------------------------------
  // Features
  // ---------------------------------------------------------------------------

  /**
   * Turn a description into a draft for one profile's editor; nothing is
   * saved here.
   */
  async generate(input: LlmGenerateInput, profileId: number): Promise<unknown> {
    if (input.kind === 'options') return this.generateOptions(input);
    const runtime = this.scriptHandler.getRuntime(profileId);
    const actions = (await this.scriptHandler.getUiActions(profileId)).map((action) => ({
      pluginId: action.pluginId,
      name: action.name,
      description: action.description,
      options: action.config?.flatMap((section) => section.options.map((option) => ({ id: option.id, type: option.type, label: option.label }))),
    }));

    if (input.kind === 'trigger') {
      const settings = this.scriptHandler.settings.getProfileSettings(runtime.profileKey);
      const draft = parseLlmJson<Partial<Trigger>>(await this.ask(
        `You create JNbot triggers: "when <event> happens on <bots>, run <actions>". Reply with only one JSON object shaped like {"name","event","filter","actions":[...],"alts":[],"tags":[],"cooldown"}.
Events: ${JSON.stringify(TRIGGER_EVENTS)}
Action types: ${JSON.stringify(TRIGGER_ACTION_TYPES)}. Shapes: {"type":"notification"}, {"type":"discord","webhook"}, {"type":"chat","message"}, {"type":"scriptAction","id":"<pluginId>"}, {"type":"log","directory"}. Messages may use {bot}, {player}, {message}, {reason}, {health}, {item}, {count}.
Available script actions: ${JSON.stringify(actions.map(({ pluginId, name }) => ({ pluginId, name })))}
Alt tags (use their id): ${JSON.stringify((settings.altTags ?? []).map((tag: any) => ({ id: tag.id, name: tag.name })))}`,
        input.description,
      ));
      const trigger = newTrigger('', { ...draft, enabled: true });
      // A missing webhook or folder is fine: the user fills it in the editor.
      const problem = triggerProblem(trigger);
      if (problem && !/webhook|directory/i.test(problem)) throw new Error(problem);
      return trigger;
    }

    return parseLlmJson(await this.ask(
      `You build JNbot chains: an ordered list of action steps that runs on every selected alt. Reply with only one JSON object: {"name": string, "steps": [{"id": "1", "name": string, "scriptId": "<pluginId>", "options": {<optionId>: value}, "onSuccess"?: "next"|"nextAlt"|"retryAlt"|"stop"|"step:<id>", "onFail"?: same}]}.
Only use these actions: ${JSON.stringify(actions)}`,
      input.description,
    ));
  }

  private async generateOptions(input: LlmGenerateInput) {
    const plugin = this.scriptHandler.macros.readPluginInfo(String(input.pluginId));
    if (!plugin) throw new Error('Plugin not found.');
    const result = parseLlmJson<{ values?: Record<string, unknown> }>(await this.ask(
      `You change the settings of the JNbot plugin "${plugin.name}". Reply with only {"values": {<optionId>: <new value>}} containing just the options the user wants changed, using the option types from this schema: ${JSON.stringify(plugin.config ?? [])}`,
      input.description,
    ));
    const known = new Set((plugin.config ?? []).flatMap((section) => section.options.map((option) => option.id)));
    return Object.fromEntries(Object.entries(result.values ?? {}).filter(([key]) => known.has(key)));
  }

  /** Write or change a plugin; drafts that don't compile are fixed once. */
  async writePlugin(input: LlmWritePluginInput) {
    const request: LlmRequest = {
      system: `You write JNbot plugins in JavaScript. Follow this guide exactly:\n\n${PLUGIN_AUTHORING_GUIDE}\n\nUse get_jnbot_reference for any API you are unsure of; never invent APIs. Add options for behaviour a user may want to adjust. When done, reply with only one JSON object: {"name": string, "description": string, "scriptType": "script"|"action", "source": string, "optionSchema": [...]}.`,
      messages: [{
        role: 'user',
        content: input.source
          ? `Change this plugin: ${input.description}\n\nCurrent source:\n${input.source}`
          : input.description,
      }],
      tools: [{
        name: 'get_jnbot_reference',
        description: 'Read one section of the JNbot API reference.',
        parameters: z.toJSONSchema(z.object({ section: z.enum(JNBOT_REFERENCE_SECTION_IDS) })),
      }],
    };
    const runTool = async (call: { input: Record<string, unknown> }) => this.mcp.getReference(String(call.input.section));
    for (let attempt = 0; attempt < 2; attempt++) {
      const draft = parseLlmJson<{ source: string; scriptType?: 'script' | 'action'; optionSchema?: unknown }>(
        await runLlmAgent((r) => this.complete(r), request, runTool),
      );
      const validation = await this.mcp.validatePlugin(draft);
      if (validation.valid) return draft;
      request.messages.push({ role: 'user', content: `That plugin has problems, fix them and reply with the full JSON again:\n${validation.errors.join('\n')}` });
    }
    throw new Error('The AI could not write a working plugin. Try describing it differently.');
  }

  async explainError(input: { error: string; scriptName?: string }): Promise<string> {
    const plugin = this.scriptHandler.macros.toList().find(({ name }) => name === input.scriptName);
    const source = plugin ? this.mcp.pluginSource(plugin.pluginId) : undefined;
    return this.ask(
      'You help JNbot users (a Minecraft bot app) understand plugin errors. In a few short sentences say what went wrong in plain language, then how to fix it. If the fix is a code change, show only the changed lines. Use markdown.',
      `Error:\n${input.error.slice(0, 4_000)}${source ? `\n\nPlugin source:\n${source.slice(0, 30_000)}` : ''}`,
    );
  }

  /** Answer a question about a marketplace item from its description and code. */
  async askAboutShare(input: { question: string; title?: string; description?: string; content?: string }): Promise<string> {
    return this.ask(
      'You answer questions about an item on the JNbot marketplace (plugins, chains, triggers and profiles for a Minecraft bot app). Answer only from the item below; if it does not say, say so. Be short and use markdown.',
      `Item: ${input.title ?? ''}\n${input.description ?? ''}\n\nContent:\n${(input.content ?? '').slice(0, 40_000)}\n\nQuestion: ${input.question}`,
    );
  }

  /**
   * Let the model act on one profile through the MCP tools (no approvals, no
   * raw code). Used by the Discord bot's /ask command.
   */
  async agent(input: { profileKey: string; prompt: string; caller: string; via: string }): Promise<string> {
    const client = this.mcp.internalClient(`ai:${input.via}:${input.profileKey}`, `JNbot AI (${input.via})`, input.profileKey);
    const tools = this.mcp.tools(client);
    const request: LlmRequest = {
      system: `${MCP_INSTRUCTIONS}\n\nYou are JNbot's assistant, asked by ${input.caller} through ${input.via}. Only use profileKey "${input.profileKey}". Write operations finish before you get their result. Answer briefly (under 1500 characters) and say what you did.`,
      messages: [{ role: 'user', content: input.prompt }],
      tools: tools.map((tool): LlmToolSpec => ({
        name: tool.name,
        description: tool.description,
        parameters: jsonSchema(tool.schema),
      })),
    };
    return runLlmAgent((r) => this.complete(r), request, async (call) => {
      const tool = tools.find(({ name }) => name === call.name);
      if (!tool) throw new Error(`Unknown tool ${call.name}`);
      return this.settle(client.id, await tool.handler(tool.schema.parse(call.input) as Record<string, unknown>, client));
    }, 20);
  }

  /** Wait for an MCP write operation to finish so the model sees its result. */
  private async settle(clientId: string, result: unknown) {
    const operationId = (result as { operationId?: string } | null)?.operationId;
    if (!operationId) return result;
    for (let waited = 0; waited < 60_000; waited += 300) {
      const operation = this.mcp.getOperations().get(clientId, operationId);
      if (!operation || TERMINAL.includes(operation.status)) return operation;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return this.mcp.getOperations().get(clientId, operationId);
  }
}

const bearer = (apiKey?: string): Record<string, string> =>
  apiKey ? { authorization: `Bearer ${apiKey}` } : {};

const safeJson = (value: unknown): Record<string, unknown> => {
  try {
    return typeof value === 'string' ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

const jsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  return rest;
};

function toClaudeMessages(messages: LlmMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const result: Anthropic.Beta.BetaMessageParam[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      result.push({ role: 'assistant', content: (message.raw as Anthropic.Beta.BetaContentBlockParam[]) ?? message.content });
    } else if (message.role === 'user') {
      result.push({ role: 'user', content: message.content });
    } else {
      // All results of one turn go back in a single user message.
      const block: Anthropic.Beta.BetaToolResultBlockParam = { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content };
      const last = result.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else result.push({ role: 'user', content: [block] });
    }
  }
  return result;
}

function toOpenAiMessage(message: LlmMessage) {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.role === 'user') return message;
  return message.raw ?? { role: 'assistant', content: message.content };
}

export default LlmService;
