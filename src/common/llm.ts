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

export type LlmComplete = (request: LlmRequest) => Promise<LlmResponse>;

/**
 * Call the model, run the tools it asks for, and repeat until it answers.
 * `messages` is extended in place so a caller can keep a conversation going.
 */
export async function runLlmAgent(
  complete: LlmComplete,
  request: LlmRequest,
  runTool: (call: LlmToolCall) => Promise<unknown>,
  maxSteps = 12,
): Promise<string> {
  for (let step = 0; step < maxSteps; step++) {
    const response = await complete(request);
    request.messages.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
      raw: response.raw,
    });
    if (!response.toolCalls.length) return response.text;
    for (const call of response.toolCalls) {
      let content: string;
      try {
        content = JSON.stringify((await runTool(call)) ?? null);
      } catch (error) {
        content = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
      request.messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
    }
  }
  return 'I stopped because this took too many steps.';
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
export const LLM_TIMEOUT_MS = 300_000;
export const llmRequestOptions = (event: string) =>
  LLM_SLOW_ACTIONS.has(event) ? { timeoutMs: LLM_TIMEOUT_MS } : undefined;

/**
 * "Describe it" for one profile (a profile action, so each client uses its
 * own profile): a trigger, a chain, or values for a plugin's options.
 */
export type LlmGenerateInput = {
  kind: 'trigger' | 'chain' | 'options';
  description: string;
  /** options: the plugin whose options to fill in. */
  pluginId?: string;
};

/** "Write with AI" in the code editor; `source` is the plugin to change. */
export type LlmWritePluginInput = { description: string; source?: string };

/** Which models to list: the form's unsaved provider/key, or the saved ones. */
export type LlmModelsInput = Pick<LlmConfig, 'provider' | 'apiKey' | 'baseUrl'>;
