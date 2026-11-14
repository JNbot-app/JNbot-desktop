import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  LLM_STREAM_EVENT,
  llmAnswerText,
  llmProvider,
  parseLlmJson,
  parsePluginDraft,
  runLlmAgent,
  type LlmCallOptions,
  type LlmConfig,
  type LlmGenerateInput,
  type LlmModelsInput,
  type LlmOptionsResult,
  type LlmRequest,
  type LlmResponse,
  type LlmStatus,
  type LlmStreamEvent,
  type LlmToolSpec,
  type LlmWritePluginInput,
} from '../../../../common/llm';
import type { Address } from '../../../../common/messaging';
import type { PluginOption } from '../../../../common/pluginOptions';
import { presetValues } from '../../../../common/pluginPresets';
import { TRIGGER_ACTION_TYPES, TRIGGER_EVENTS, newTrigger, triggerProblem, type Trigger } from '../../../../common/triggers';
import { backendMessaging } from '../../messaging';
import type ScriptHandler from '../ScriptHandler';
import type McpManager from '../mcp/McpManager';
import { MCP_INSTRUCTIONS } from '../mcp/McpManager';
import { pluginOptionChoices } from '../pluginOptionChoices';
import { describeOptions, groundOptionValues } from './groundOptions';
import { PLUGIN_TOOLS, describePluginTool, jsonSchema, pluginSystemPrompt } from './pluginContext';
import { STOPPED, bearer, claudeClient, completeClaude, completeOpenAi, fetchOpenAi } from './providers';

const TERMINAL = ['succeeded', 'failed', 'denied', 'cancelled'];
/** Listed models that can't chat (speech, images, embeddings...). */
const NON_CHAT_MODEL = /embed|tts|audio|image|imagen|veo|banana|lyria|whisper|dall-e|moderation|transcribe|translate|realtime|live|aqa|robotics|computer-use|research|antigravity/i;
/** Streamed text is batched so remote clients get a few messages a second, not one per token. */
const STREAM_FLUSH_MS = 60;
/** Asked of every "draft" feature, so the user reads a sentence while the JSON streams. */
const DRAFT_FORMAT = 'First write one short sentence saying what you made, then the JSON in one ```json block. Nothing else.';

/**
 * Sends one request's progress to the client that asked, batching text
 * deltas. A no-op when the client didn't ask for a stream.
 */
class LlmStream {
  readonly controller = new AbortController();
  private buffered: Extract<LlmStreamEvent, { delta: string }> | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly origin?: Address, private readonly streamId?: string) {}

  readonly options: LlmCallOptions = {
    signal: this.controller.signal,
    onEvent: (event) => {
      if (!this.origin || !this.streamId) return;
      if (event.type === 'text' || event.type === 'thinking') {
        if (this.buffered && this.buffered.type !== event.type) this.flush();
        this.buffered = this.buffered ? { ...this.buffered, delta: this.buffered.delta + event.delta } : event;
        this.timer ??= setTimeout(() => this.flush(), STREAM_FLUSH_MS);
        return;
      }
      this.flush();
      this.send(event);
    },
  };

  status(text: string) {
    this.options.onEvent!({ type: 'status', text });
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.buffered) this.send(this.buffered);
    this.buffered = null;
  }

  private send(event: LlmStreamEvent) {
    backendMessaging.messenger.send(LLM_STREAM_EVENT, this.origin!, { ...event, streamId: this.streamId });
  }
}

/**
 * The optional LLM integration. Users bring their own key (stored in a plain
 * file in userData); every AI feature in the UI is hidden until one is set.
 */
export class LlmService {
  private config: LlmConfig | null = null;
  private readonly running = new Map<string, AbortController>();
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
      for await (const model of claudeClient(apiKey!, baseUrl).models.list({ limit: 100 })) ids.push(model.id);
    } else {
      const response = await fetchOpenAi(`${baseUrl.replace(/\/$/, '')}/models`, { headers: bearer(apiKey), signal: AbortSignal.timeout(30_000) });
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

  /**
   * One model reply. Some models (often free ones) occasionally only reason
   * and send no answer; they get one nudge to answer.
   */
  async complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResponse> {
    const response = await this.call(request, options);
    if (response.text.trim() || response.toolCalls.length) return response;
    options?.onEvent?.({ type: 'status', text: 'Asking for the final answer' });
    options?.onEvent?.({ type: 'turn' });
    return this.call(
      { ...request, messages: [...request.messages, { role: 'user', content: 'You did not write an answer. Write your final answer now, in the requested format.' }] },
      options,
    );
  }

  private call(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResponse> {
    const config = this.config;
    if (!config?.model || !this.status().configured) throw new Error('Pick an AI provider and model in Settings first.');
    const provider = llmProvider(config.provider);
    const baseUrl = config.baseUrl || provider.baseUrl;
    return provider.format === 'anthropic'
      ? completeClaude(request, config.model, baseUrl, config.apiKey!, options)
      : completeOpenAi(request, config.model, baseUrl, config.apiKey, options);
  }

  async ask(system: string, prompt: string, options?: LlmCallOptions): Promise<string> {
    return (await this.complete({ system, messages: [{ role: 'user', content: prompt }] }, options)).text;
  }

  /** Stop the request streaming under `streamId`. */
  cancel(streamId: string) {
    this.running.get(streamId)?.abort();
  }

  /** Run one request, streaming its progress to `origin` when it gave a stream id. */
  private async streamed<T>(origin: Address | undefined, streamId: string | undefined, work: (stream: LlmStream) => Promise<T>) {
    const stream = new LlmStream(origin, streamId);
    if (streamId) this.running.set(streamId, stream.controller);
    try {
      return await work(stream);
    } catch (error) {
      throw stream.controller.signal.aborted ? new Error(STOPPED) : error;
    } finally {
      stream.flush();
      if (streamId) this.running.delete(streamId);
    }
  }

  // ---------------------------------------------------------------------------
  // Features
  // ---------------------------------------------------------------------------

  /**
   * Turn a description into a draft for one profile's editor; nothing is
   * saved here.
   */
  generate(input: LlmGenerateInput, profileId: number, origin?: Address): Promise<unknown> {
    return this.streamed(origin, input.streamId, (stream) => {
      if (input.kind === 'options') return this.generateOptions(input, profileId, stream);
      return input.kind === 'trigger' ? this.generateTrigger(input, profileId, stream) : this.generateChain(input, profileId, stream);
    });
  }

  private async actionsFor(profileId: number) {
    return (await this.scriptHandler.getUiActions(profileId)).map((action) => ({
      pluginId: action.pluginId,
      name: action.name,
      description: action.description,
      options: action.config?.flatMap((section) => section.options.map((option) => ({ id: option.id, type: option.type, label: option.label }))),
    }));
  }

  private async generateTrigger(input: LlmGenerateInput, profileId: number, stream: LlmStream) {
    stream.status('Drafting the trigger');
    const runtime = this.scriptHandler.getRuntime(profileId);
    const settings = this.scriptHandler.settings.getProfileSettings(runtime.profileKey);
    const actions = await this.actionsFor(profileId);
    const draft = parseLlmJson<Partial<Trigger>>(await this.ask(
      `You create JNbot triggers: "when <event> happens on <bots>, run <actions>". The JSON is one object shaped like {"name","event","filter","actions":[...],"alts":[],"tags":[],"cooldown"}. ${DRAFT_FORMAT}
Events: ${JSON.stringify(TRIGGER_EVENTS)}
Action types: ${JSON.stringify(TRIGGER_ACTION_TYPES)}. Shapes: {"type":"notification"}, {"type":"discord","webhook"}, {"type":"chat","message"}, {"type":"scriptAction","id":"<pluginId>"}, {"type":"log","directory"}. Messages may use {bot}, {player}, {message}, {reason}, {health}, {item}, {count}.
Available script actions: ${JSON.stringify(actions.map(({ pluginId, name }) => ({ pluginId, name })))}
Alt tags (use their id): ${JSON.stringify((settings.altTags ?? []).map((tag: any) => ({ id: tag.id, name: tag.name })))}`,
      input.description,
      stream.options,
    ));
    const trigger = newTrigger('', { ...draft, enabled: true });
    // A missing webhook or folder is fine: the user fills it in the editor.
    const problem = triggerProblem(trigger);
    if (problem && !/webhook|directory/i.test(problem)) throw new Error(problem);
    return trigger;
  }

  private async generateChain(input: LlmGenerateInput, profileId: number, stream: LlmStream) {
    stream.status('Drafting the chain');
    const actions = await this.actionsFor(profileId);
    return parseLlmJson(await this.ask(
      `You build JNbot chains: an ordered list of action steps that runs on every selected alt. The JSON is one object: {"name": string, "steps": [{"id": "1", "name": string, "scriptId": "<pluginId>", "options": {<optionId>: value}, "onSuccess"?: "next"|"nextAlt"|"retryAlt"|"stop"|"step:<id>", "onFail"?: same}]}. ${DRAFT_FORMAT}
Only use these actions: ${JSON.stringify(actions)}`,
      input.description,
      stream.options,
    ));
  }

  /** An installed plugin, or one that comes with the profile. */
  private async pluginInfo(profileId: number, pluginId: string) {
    const installed = this.scriptHandler.macros.readPluginInfo(pluginId);
    if (installed) return installed;
    const script = this.scriptHandler.dashboardScripts(profileId).find((candidate) => candidate.pluginId === pluginId) ??
      this.scriptHandler.findProfileScript(profileId, pluginId);
    return script ? (await this.scriptHandler.settings.profiles.scripts?.resolveInfo(script))?.info : undefined;
  }

  /**
   * Values for a plugin's options. The model sees the current values and the
   * real choices in this profile (gamemodes, alts, tags differ per profile),
   * and anything it suggests is matched to a valid choice before the user
   * reviews it.
   */
  private async generateOptions(input: LlmGenerateInput, profileId: number, stream: LlmStream): Promise<LlmOptionsResult> {
    const plugin = await this.pluginInfo(profileId, String(input.pluginId));
    if (!plugin) throw new Error('Plugin not found.');
    stream.status('Reading the current settings');
    const runtime = this.scriptHandler.getRuntime(profileId);
    const settings = this.scriptHandler.settings.getProfileSettings(runtime.profileKey);
    const profile = this.scriptHandler.settings.JNdata.data[runtime.profileKey];
    const options = (plugin.config ?? []).flatMap((section) => section.options) as PluginOption[];
    const current = presetValues(settings.scripts?.[plugin.pluginId]) as Record<string, unknown>;
    const choices = (option: PluginOption) => pluginOptionChoices(option, profile, settings);
    stream.status('Choosing values');
    const reply = await this.ask(
      `You change the settings of the JNbot plugin "${plugin.name}"${plugin.description ? ` (${plugin.description})` : ''}. The JSON is {"values": {<optionId>: <new value>}} with only the options the user wants changed. When an option lists "choices", use one of those exact values (an array of them when "multiple" or for multiSelect); only options marked "freeForm" also accept new values the user asks for, so add those as typed. Sliders must stay within min/max. ${DRAFT_FORMAT}
Options: ${JSON.stringify(describeOptions(options, current, choices))}`,
      input.description,
      stream.options,
    );
    const suggested = parseLlmJson<{ values?: Record<string, unknown> }>(reply).values ?? {};
    return { ...groundOptionValues(options, suggested, current, choices), summary: llmAnswerText(reply) };
  }

  /**
   * Write or change a plugin. The model gets the relevant API reference up
   * front, can look up more, and drafts that don't compile are sent back once.
   */
  writePlugin(input: LlmWritePluginInput, origin?: Address) {
    return this.streamed(origin, input.streamId, async (stream) => {
      const type = input.scriptType === 'action' ? 'an action (runs on one connected bot)' : 'a normal plugin (owns its bot lifecycle)';
      const request: LlmRequest = {
        system: pluginSystemPrompt(input.description, (section) => this.mcp.getReference(section).content, this.config?.provider === 'ollama'),
        messages: [{
          role: 'user',
          content: input.source
            ? `Change this plugin (${type}): ${input.description}\n\nCurrent source:\n\`\`\`js\n${input.source}\n\`\`\`${input.optionSchema ? `\n\nCurrent option schema:\n${JSON.stringify(input.optionSchema)}` : ''}`
            : `Write ${type}: ${input.description}`,
        }],
        tools: PLUGIN_TOOLS,
      };
      const plugins = () => this.scriptHandler.macros.toList();
      const runTool = async ({ name, input: args }: { name: string; input: Record<string, unknown> }) => {
        if (name === 'get_jnbot_reference') return this.mcp.getReference(String(args.section));
        if (name === 'list_plugins') return plugins().map(({ pluginId, name: pluginName, description, scriptType }) => ({ pluginId, name: pluginName, description, scriptType }));
        if (name === 'read_plugin') return this.mcp.pluginSource(String(args.pluginId)) ?? { error: 'No plugin with that id.' };
        throw new Error(`Unknown tool ${name}`);
      };
      const describeTool = (call: Parameters<typeof describePluginTool>[0]) =>
        describePluginTool(call, (id) => plugins().find((plugin) => plugin.pluginId === id)?.name);

      stream.status(input.source ? 'Reading your code' : 'Planning the plugin');
      for (let attempt = 0; attempt < 3; attempt++) {
        const draft = parsePluginDraft(await runLlmAgent((r, o) => this.complete(r, o), request, runTool, { ...stream.options, describeTool }));
        let problem: string;
        if (draft === 'missing') {
          problem = 'Your reply had no ```js block. Reply again with the complete plugin source in a ```js block, plus the ```json block.';
        } else {
          if (!draft.source) return draft;
          draft.scriptType ??= input.scriptType;
          stream.status('Checking that it compiles');
          const validation = await this.mcp.validatePlugin({ ...draft, source: draft.source });
          if (validation.valid) return draft;
          stream.status(`Fixing ${validation.errors.length === 1 ? 'a problem' : `${validation.errors.length} problems`}`);
          problem = `That plugin has problems. Fix them and reply in the same format, with the complete source:\n${validation.errors.join('\n')}`;
        }
        stream.options.onEvent!({ type: 'turn' });
        request.messages.push({ role: 'user', content: problem });
      }
      throw new Error('The AI could not write a working plugin. Try describing it differently.');
    });
  }

  explainError(input: { error: string; scriptName?: string; streamId?: string }, origin?: Address): Promise<string> {
    return this.streamed(origin, input.streamId, (stream) => {
      const plugin = this.scriptHandler.macros.toList().find(({ name }) => name === input.scriptName);
      const source = plugin ? this.mcp.pluginSource(plugin.pluginId) : undefined;
      stream.status(source ? `Reading ${plugin!.name}` : 'Reading the error');
      return this.ask(
        'You help JNbot users (a Minecraft bot app) understand plugin errors. In a few short sentences say what went wrong in plain everyday language, as if to someone who cannot code, then how to fix it, preferring fixes they can do in the app (settings, items, game state). Only show code if the fix truly needs a code change, and then only the changed lines. Use markdown.',
        `Error:\n${input.error.slice(0, 4_000)}${source ? `\n\nPlugin source:\n${source.slice(0, 30_000)}` : ''}`,
        stream.options,
      );
    });
  }

  /** Answer a question about a marketplace item from its description and code. */
  askAboutShare(input: { question: string; title?: string; description?: string; content?: string; streamId?: string }, origin?: Address): Promise<string> {
    return this.streamed(origin, input.streamId, (stream) => {
      stream.status('Reading the item');
      return this.ask(
        'You answer questions about an item on the JNbot marketplace (plugins, chains, triggers and profiles for a Minecraft bot app). Answer only from the item below; if it does not say, say so. The reader usually does not know how to code: explain in plain everyday language about what it does in the game and what it needs, never quote code, function or variable names, or technical terms unless the reader asked for them. Be short and use markdown.',
        `Item: ${input.title ?? ''}\n${input.description ?? ''}\n\nContent:\n${(input.content ?? '').slice(0, 40_000)}\n\nQuestion: ${input.question}`,
        stream.options,
      );
    });
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
    return runLlmAgent((r, o) => this.complete(r, o), request, async (call) => {
      const tool = tools.find(({ name }) => name === call.name);
      if (!tool) throw new Error(`Unknown tool ${call.name}`);
      return this.settle(client.id, await tool.handler(tool.schema.parse(call.input) as Record<string, unknown>, client));
    }, { maxSteps: 20 });
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

export default LlmService;
