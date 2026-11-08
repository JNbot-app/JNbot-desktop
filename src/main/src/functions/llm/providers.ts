import Anthropic from '@anthropic-ai/sdk';
import type {
  LlmCallOptions,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
} from '../../../../common/llm';

/** Claude models that accept the server-side refusal fallback. */
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;
/** Claude models with adaptive thinking, whose summarized reasoning we show live. */
const ADAPTIVE_THINKING = /^claude-(opus|sonnet|fable|haiku)-(4-[6-9]|[5-9])/;
/** Give up when a provider sends nothing for this long (it sometimes hangs). */
const IDLE_TIMEOUT_MS = 90_000;
/** Overloaded / rate limited: worth a quick retry. */
const RETRY_STATUSES = [429, 500, 503];
/** Long system prompts (the plugin reference) are cached between agent steps. */
const CACHE_MIN_CHARS = 4_000;

export const STOPPED = 'Stopped.';
const BUSY = 'The AI provider did not answer in time. It may be busy: try again, or pick another model in Settings.';

export const claudeClient = (apiKey: string, baseURL: string) =>
  // The SDK retries overloaded/rate-limited requests itself.
  new Anthropic({ apiKey, baseURL, timeout: 600_000, maxRetries: 2 });

export const bearer = (apiKey?: string): Record<string, string> =>
  apiKey ? { authorization: `Bearer ${apiKey}` } : {};

/**
 * An abort signal that fires when the caller stops, or when `touch()` was not
 * called for {@link IDLE_TIMEOUT_MS}.
 */
function idleSignal(parent?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, IDLE_TIMEOUT_MS);
  };
  const stop = () => controller.abort();
  parent?.addEventListener('abort', stop);
  touch();
  return {
    signal: controller.signal,
    touch,
    done: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', stop);
    },
    /** A readable error for an aborted request. */
    error: (error: unknown) =>
      controller.signal.aborted ? new Error(timedOut ? BUSY : STOPPED) : error,
  };
}

export async function completeClaude(
  request: LlmRequest,
  model: string,
  baseURL: string,
  apiKey: string,
  { onEvent, signal }: LlmCallOptions = {},
): Promise<LlmResponse> {
  const idle = idleSignal(signal);
  const system = request.system;
  try {
    const stream = claudeClient(apiKey, baseURL).beta.messages.stream(
      {
        model,
        max_tokens: request.maxTokens ?? 32_000,
        ...(system
          ? {
            system: system.length >= CACHE_MIN_CHARS
              ? [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }]
              : system,
          }
          : {}),
        messages: toClaudeMessages(request.messages),
        ...(ADAPTIVE_THINKING.test(model) ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const } } : {}),
        ...(request.tools?.length
          ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema,
            })),
          }
          : {}),
        ...(FALLBACK_MODELS.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: idle.signal },
    );
    stream.on('streamEvent', idle.touch);
    stream.on('text', (delta) => onEvent?.({ type: 'text', delta }));
    stream.on('thinking', (delta) => onEvent?.({ type: 'thinking', delta }));
    const response = await stream.finalMessage();
    if (response.stop_reason === 'max_tokens' && !response.content.some((block) => block.type === 'text' || block.type === 'tool_use'))
      throw new Error('The model used up its output limit while thinking, before it answered. Try again.');
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
  } catch (error) {
    throw idle.error(error);
  } finally {
    idle.done();
  }
}

/** fetch with a retry while the provider is busy; throws a readable error. */
export async function fetchOpenAi(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, init);
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

/** A tool call being streamed in pieces by an OpenAI-compatible provider. */
type OpenAiToolCall = { id: string; type: 'function'; function: { name: string; arguments: string }; [extra: string]: unknown };

export async function completeOpenAi(
  request: LlmRequest,
  model: string,
  baseUrl: string,
  apiKey: string | undefined,
  { onEvent, signal }: LlmCallOptions = {},
): Promise<LlmResponse> {
  const idle = idleSignal(signal);
  let text = '';
  let finish: string | undefined;
  const toolCalls: OpenAiToolCall[] = [];
  try {
    const response = await fetchOpenAi(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: idle.signal,
      headers: { 'content-type': 'application/json', ...bearer(apiKey) },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          ...request.messages.map(toOpenAiMessage),
        ],
        ...(request.tools?.length
          ? { tools: request.tools.map((tool) => ({ type: 'function', function: tool })) }
          : {}),
      }),
    });
    for await (const chunk of serverSentEvents(response, idle.touch)) {
      finish = chunk?.choices?.[0]?.finish_reason ?? finish;
      const delta = chunk?.choices?.[0]?.delta;
      if (!delta) continue;
      // OpenRouter and Ollama send `reasoning`, DeepSeek-style APIs `reasoning_content`.
      const thinking = delta.reasoning_content ?? delta.reasoning;
      if (typeof thinking === 'string' && thinking) onEvent?.({ type: 'thinking', delta: thinking });
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        onEvent?.({ type: 'text', delta: delta.content });
      }
      for (const part of delta.tool_calls ?? []) {
        const { index = toolCalls.length, function: fn, ...rest } = part;
        const call = (toolCalls[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
        // Keep provider extras such as Gemini's thought signature for the next turn.
        Object.assign(call, rest, { type: 'function' });
        call.function.name += fn?.name ?? '';
        call.function.arguments += fn?.arguments ?? '';
      }
    }
  } catch (error) {
    throw idle.error(error);
  } finally {
    idle.done();
  }
  const calls = toolCalls.filter(Boolean);
  if (finish === 'length' && !text.trim() && !calls.length)
    throw new Error('The model used up its output limit while thinking, before it answered. Try again, or pick another model in Settings.');
  return {
    text,
    toolCalls: calls.map((call, index): LlmToolCall => ({
      id: call.id || `call_${index}`,
      name: call.function.name,
      input: safeJson(call.function.arguments),
    })),
    raw: { role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) },
  };
}

/** The JSON payloads of an SSE response (`data: {...}` lines). */
async function* serverSentEvents(response: Response, onChunk: () => void) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    onChunk();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!data || data === '[DONE]') continue;
      const chunk = safeJson(data) as any;
      if (chunk.error) throw new Error(`AI request failed: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
      yield chunk;
    }
  }
}

const safeJson = (value: unknown): Record<string, unknown> => {
  try {
    return typeof value === 'string' ? JSON.parse(value) : {};
  } catch {
    return {};
  }
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
