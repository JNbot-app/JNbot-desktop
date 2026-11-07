import type { LlmAPI, LlmAskOptions, LlmChat, LlmChatOptions } from 'common/types/pluginApi';
import {
  parseLlmJson,
  runLlmAgent,
  type LlmMessage,
  type LlmRequest,
  type LlmResponse,
} from '../../../../common/llm';
import workerScript from './workerScript';

const complete = (request: LlmRequest) =>
  workerScript.sendAsync<LlmResponse>('LLM_COMPLETE', request, { timeoutMs: 180_000 });

/** Run one exchange; `messages` gets the reply (and any tool calls) appended. */
function converse(messages: LlmMessage[], options: LlmAskOptions = {}) {
  const tools = options.tools ?? [];
  return runLlmAgent(
    complete,
    {
      system: options.system,
      messages,
      maxTokens: options.maxTokens,
      tools: tools.map(({ name, description, parameters }) => ({
        name,
        description,
        parameters: (parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      })),
    },
    async (call) => {
      const tool = tools.find(({ name }) => name === call.name);
      if (!tool) throw new Error(`Unknown tool ${call.name}`);
      return tool.run(call.input as any);
    },
  );
}

/** Drop the oldest exchanges, always restarting at a user message. */
function trim(messages: LlmMessage[], memory: number) {
  while (messages.length > memory) {
    messages.shift();
    while (messages.length && messages[0].role !== 'user') messages.shift();
  }
}

/** `script.llm`: the AI provider the user set up in Settings. */
export function createLlmApi(networkAllowed: boolean): LlmAPI {
  const guard = () => {
    if (!networkAllowed)
      throw new Error('AI-authored plugins are not allowed to use script.llm.');
  };
  return {
    async isAvailable() {
      const status = await workerScript.sendAsync<{ configured: boolean }>('LLM_STATUS');
      return networkAllowed && status.configured;
    },
    ask(prompt, options) {
      guard();
      return converse([{ role: 'user', content: prompt }], options);
    },
    async askJson(prompt, options) {
      guard();
      const system = `${options?.system ?? ''}\nReply with only valid JSON, no other text.`.trim();
      return parseLlmJson(await converse([{ role: 'user', content: prompt }], { ...options, system }));
    },
    createChat(options: LlmChatOptions = {}): LlmChat {
      guard();
      const messages: LlmMessage[] = [];
      const memory = Math.max(2, options.memory ?? 20);
      let queue = Promise.resolve('');
      return {
        get history() {
          return messages.flatMap((message) =>
            message.role !== 'tool' && message.content
              ? [{ role: message.role, content: message.content }]
              : [],
          );
        },
        send(text: string) {
          // One reply at a time, so the conversation stays in order.
          queue = queue.catch(() => '').then(async () => {
            const before = messages.length;
            messages.push({ role: 'user', content: text });
            try {
              const reply = await converse(messages, options);
              trim(messages, memory);
              return reply;
            } catch (error) {
              messages.length = before; // forget the failed exchange
              throw error;
            }
          });
          return queue;
        },
        clear() {
          messages.length = 0;
        },
      };
    },
  };
}
