/**
 * Optional AI features: one provider-neutral message format and agent loop,
 * shared by the backend (Claude/OpenAI-compatible calls, MCP tools), the
 * plugin workers (`script.llm`) and the desktop + mobile UIs.
 */

export type LlmProviderId = 'anthropic' | 'gemini' | 'openai' | 'openrouter' | 'ollama';

export type LlmProvider = {
  id: LlmProviderId;
  label: string;
  /** `anthropic` uses the Anthropic SDK; the rest speak the OpenAI chat API. */
  format: 'anthropic' | 'openai';
  baseUrl: string;
  /** Where to get a key; undefined when none is needed. */
  keyUrl?: string;
  note?: string;
};

export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    format: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    format: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Has a free tier.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    format: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    format: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'One key for many models, some free.',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    format: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    note: 'Runs on your own computer, no key needed.',
  },
];

export const llmProvider = (id?: string) =>
  LLM_PROVIDERS.find((provider) => provider.id === id) ?? LLM_PROVIDERS[0];

/** Stored AI settings. The key never leaves the backend. */
export type LlmConfig = {
  provider: LlmProviderId;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
};

/** What the UIs see: no key. `configured` gates every AI button. */
export type LlmStatus = {
  configured: boolean;
  provider?: LlmProviderId;
  model?: string;
};

export type LlmToolCall = { id: string; name: string; input: Record<string, unknown> };

export type LlmMessage =
  | { role: 'user'; content: string }
  /** `raw` keeps provider-specific blocks (e.g. Claude's thinking) for the next turn. */
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[]; raw?: unknown }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type LlmToolSpec = {
  name: string;
  description: string;
  /** JSON Schema of the input object. */
  parameters: Record<string, unknown>;
};

export type LlmRequest = {
  system?: string;
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  maxTokens?: number;
};

export type LlmResponse = {
  text: string;
  toolCalls: LlmToolCall[];
  raw?: unknown;
};

/**
 * Live progress of one AI request, so the UI can show what it is doing
 * instead of a bare spinner.
 * - `status`: a new step started (e.g. "Reading the Bot API reference").
 * - `thinking` / `text`: streamed reasoning and answer text.
 * - `turn`: the model starts a new reply (after tool calls); the previous
 *   reply's text was intermediate.
 */
export type LlmStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'turn' };

/** Sent by the backend on {@link LLM_STREAM_EVENT} to the client that asked. */
export type LlmStreamMessage = LlmStreamEvent & { streamId: string };
export const LLM_STREAM_EVENT = 'LLM_STREAM';

/** Optional on every slow AI request: stream progress to the caller under this id. */
export type LlmStreamInput = { streamId?: string };

/** Not part of {@link LlmRequest}, which is sent between processes. */
export type LlmCallOptions = {
  onEvent?: (event: LlmStreamEvent) => void;
  signal?: AbortSignal;
};

export type LlmComplete = (request: LlmRequest, options?: LlmCallOptions) => Promise<LlmResponse>;

export type LlmAgentOptions = LlmCallOptions & {
  maxSteps?: number;
  /** A readable label for a tool call, shown as a progress step. */
  describeTool?: (call: LlmToolCall) => string;
};

/**
 * Call the model, run the tools it asks for, and repeat until it answers.
 * `messages` is extended in place so a caller can keep a conversation going.
 */
export async function runLlmAgent(
  complete: LlmComplete,
  request: LlmRequest,
  runTool: (call: LlmToolCall) => Promise<unknown>,
  { maxSteps = 12, describeTool, ...call }: LlmAgentOptions = {},
): Promise<string> {
  for (let step = 0; step < maxSteps; step++) {
    if (step) call.onEvent?.({ type: 'turn' });
    const response = await complete(request, call);
    request.messages.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
      raw: response.raw,
    });
    if (!response.toolCalls.length) return response.text;
    for (const toolCall of response.toolCalls) {
      call.signal?.throwIfAborted();
      call.onEvent?.({ type: 'status', text: describeTool?.(toolCall) ?? `Using ${toolCall.name}` });
      let content: string;
      try {
        content = JSON.stringify((await runTool(toolCall)) ?? null);
      } catch (error) {
        content = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
      request.messages.push({ role: 'tool', toolCallId: toolCall.id, name: toolCall.name, content });
    }
  }
  return 'I stopped because this took too many steps.';
}

/**
 * The body of the first ``` block in `text` whose language matches, or
 * undefined. With `partial`, an unclosed block (still streaming) counts too.
 */
export function codeBlock(text: string, languages: RegExp, partial = false): string | undefined {
  const fence = /```([\w-]*)[^\n]*\n/g;
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    const start = match.index + match[0].length;
    const end = text.indexOf('\n```', start - 1);
    if (languages.test(match[1])) {
      if (end >= 0) return text.slice(start, end);
      return partial ? text.slice(start) : undefined;
    }
    if (end < 0) return undefined;
    fence.lastIndex = end + 4;
  }
  return undefined;
}

export const JS_BLOCK = /^(js|javascript|ts|typescript)$/i;

/**
 * The editor's AI reply: a plugin (a ```js block plus a ```json block with
 * its details) or, for a question, just an answer.
 */
export type LlmPluginDraft = {
  source?: string;
  answer?: string;
  name?: string;
  description?: string;
  scriptType?: 'script' | 'action';
  optionSchema?: unknown;
};

/** Whether code is a whole plugin rather than an example snippet. */
export const isWholePlugin = (source: string) => /\bfunction\s+main\s*\(|require\(\s*['"]jnbot['"]\s*\)/.test(source);

/**
 * A reply as the user reads it: without the drafts the app uses itself
 * (```json details, whole plugins), also while they stream, but keeping
 * example snippets in an answer.
 */
export const llmAnswerText = (text: string) =>
  text
    .replace(/```([\w-]*)[^\n]*\n?([\s\S]*?)(```|$)/g, (block, language: string, body: string) =>
      /^json$/i.test(language) || (JS_BLOCK.test(language) && isWholePlugin(body)) ? '' : block)
    .trim();

/**
 * Read the editor's AI reply. `missing` means it described a plugin (gave
 * details) but left out the code, so the model should be asked again.
 */
export function parsePluginDraft(text: string): LlmPluginDraft | 'missing' {
  const source = codeBlock(text, JS_BLOCK);
  const details = codeBlock(text, /^json$/i);
  if (details && !source) return 'missing';
  if (!source || (!details && !isWholePlugin(source))) return { answer: text.trim() };
  return { ...(details ? parseLlmJson<Omit<LlmPluginDraft, 'source'>>(details) : {}), source };
}

/** Parse the JSON object or array in a model reply, tolerating ``` fences. */
export function parseLlmJson<T = unknown>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('The AI did not return JSON.');
  return JSON.parse(body.slice(start, end + 1)) as T;
}

/** AI calls can take minutes; requests for these use {@link LLM_TIMEOUT_MS}. */
export const LLM_SLOW_ACTIONS = new Set(['LLM_TEST', 'LLM_GENERATE', 'LLM_WRITE_PLUGIN', 'LLM_EXPLAIN_ERROR', 'LLM_ASK_SHARE']);
/** Stops the request streaming under `streamId`. */
export type LlmCancelInput = { streamId: string };

export type LlmExplainErrorInput = LlmStreamInput & { error: string; scriptName?: string };
export type LlmAskShareInput = LlmStreamInput & { question: string; title?: string; description?: string; content?: string };
export const LLM_TIMEOUT_MS = 300_000;
export const llmRequestOptions = (event: string) =>
  LLM_SLOW_ACTIONS.has(event) ? { timeoutMs: LLM_TIMEOUT_MS } : undefined;

/**
 * "Describe it" for one profile (a profile action, so each client uses its
 * own profile): a trigger, a chain, or values for a plugin's options.
 */
export type LlmGenerateInput = LlmStreamInput & {
  kind: 'trigger' | 'chain' | 'options';
  description: string;
  /** options: the plugin whose options to fill in. */
  pluginId?: string;
};

/** "Write with AI" in the code editor; `source` is the plugin to change. */
export type LlmWritePluginInput = LlmStreamInput & {
  description: string;
  source?: string;
  scriptType?: 'script' | 'action';
  /** The plugin's current options, kept when changing it. */
  optionSchema?: unknown;
};

/** "Describe the settings": the grounded changes, for the user to review. */
export type LlmOptionsResult = {
  values: Record<string, unknown>;
  changes: { id: string; label: string; from: unknown; to: unknown }[];
  /** Values the AI suggested that are not valid choices here. */
  skipped: { label: string; value: unknown; reason: string }[];
  summary?: string;
};

/** Which models to list: the form's unsaved provider/key, or the saved ones. */
export type LlmModelsInput = Pick<LlmConfig, 'provider' | 'apiKey' | 'baseUrl'>;
