import type { AiCall } from '../../../../common/types/pluginApi';
import type { EnginePrediction } from '../NeedleEngine';
import type { ToolDefinition } from '../protocol';
import { aiError, isObject, jsonValue } from '../schema';
import { loadModel } from './model';
import Tokenizer from './tokenizer';
import prepareTools from './tools';
import PreparedGrammar from './grammar';
import { CallTracker, constrainedLogProbability, gateCalls } from './output';

export interface NativeBinding {
  invoke(operation: string, ...args: unknown[]): unknown;
}
export function nativeBinding(value: unknown): NativeBinding {
  if (!isObject(value) || typeof value.invoke !== 'function')
    throw aiError('AI_ENGINE', 'Invalid native inference binding.');
  const { invoke } = value;
  return { invoke: (operation, ...args) => invoke(operation, ...args) };
}
interface PreparedTools {
  key: string;
  tools: ToolDefinition[];
  tokens: number[];
  suffix: (text: string) => number[];
  grammar: PreparedGrammar;
  restore: (call: AiCall) => AiCall;
}

const NO_PREDICTION: EnginePrediction = {
  calls: [],
  suppressedCalls: [],
  confidence: null,
  reasoning: null,
};

export default class InferenceRuntime {
  private readonly context: number;

  private readonly tokenizer: Tokenizer;

  private readonly logits: Float32Array;

  private prepared?: PreparedTools;

  private windowSize?: number;

  constructor(
    private readonly binding: NativeBinding,
    file: string,
  ) {
    try {
      const model = loadModel(file);
      this.context = model.context;
      this.tokenizer = new Tokenizer(model.tokenizer);
      if (
        !model.context ||
        model.context > 1_000_000 ||
        model.vocab !== this.tokenizer.pieces.length
      )
        throw aiError('AI_MODEL', 'Unsupported model dimensions.');
      this.logits = new Float32Array(model.vocab);
      binding.invoke('load', file, model.decoder.offset, model.decoder.length);
    } catch (error) {
      binding.invoke('close');
      throw error;
    }
  }

  /** Changing the window rebuilds the KV cache, which also drops the cached tool prefix. */
  private setWindow(size: number): void {
    if (size === this.windowSize) return;
    if (!Number.isSafeInteger(size) || size < 1 || size > this.context)
      throw aiError(
        'AI_INVALID_INPUT',
        `windowSize must be an integer from 1 to ${this.context}.`,
      );
    this.binding.invoke('window', size);
    this.windowSize = size;
  }

  /**
   * Prepares the prompt prefix for a toolset. The native engine keeps the state after
   * these tokens, so later requests with the same tools skip their prefill.
   */
  init(tools: ToolDefinition[], extraction = false): void {
    const key = JSON.stringify([tools, extraction]);
    if (this.prepared?.key === key) return;
    const adapted = prepareTools(tools);
    const system = extraction
      ? '<|im_start|>system\nExtract structured facts from the input.<|im_end|>\n'
      : '';
    const prefix = `${system}<|im_start|>user\n<tools>${JSON.stringify(adapted.tools)}</tools>\n`;
    const tokenized = this.tokenizer.preparePrefix(prefix);
    const prepared: PreparedTools = {
      key,
      tools: adapted.tools,
      tokens: [this.tokenizer.bos, ...tokenized.tokens],
      suffix: tokenized.append,
      grammar: new PreparedGrammar(adapted.tools, this.tokenizer),
      restore: adapted.restore,
    };
    this.binding.invoke('reset');
    this.binding.invoke('prefix', prepared.tokens.length);
    this.prepared = prepared;
  }

  complete(
    text: string,
    maxNewTokens: number,
    reasoning: boolean,
    windowSize: number,
  ): EnginePrediction {
    const { prepared } = this;
    if (!prepared) throw aiError('AI_ENGINE', 'Tools are not prepared.');
    this.setWindow(windowSize);
    this.binding.invoke('reset');
    try {
      const ids = Int32Array.from([
        ...prepared.tokens,
        ...prepared.suffix(`${text}<|im_end|>\n<|im_start|>assistant\n`),
      ]);
      if (ids.length + maxNewTokens > this.context)
        throw aiError(
          'AI_INVALID_INPUT',
          'Input and generation budget exceed the model context limit.',
        );
      const generated: number[] = [];
      const tracker = new CallTracker();
      const callLogProbabilities: number[][] = [];
      const sampler = prepared.grammar.sampler();
      this.binding.invoke('eval', ids, this.logits);
      const single = new Int32Array(1);
      for (let step = 0; step < maxNewTokens; step += 1) {
        const token =
          step === 0
            ? this.tokenizer.id(reasoning ? '<think>' : '<tool_call>')
            : sampler.select(this.logits);
        if (
          sampler.mode === 'json' &&
          token !== this.tokenizer.id('</tool_call>')
        ) {
          let maximum = -Infinity;
          for (const value of this.logits) maximum = Math.max(maximum, value);
          let total = 0;
          for (const value of this.logits) total += Math.exp(value - maximum);
          const logProbability = constrainedLogProbability(
            this.logits,
            token,
            this.logits[token] - maximum - Math.log(total),
            sampler,
          );
          for (const index of tracker.feed(this.tokenizer.bytes[token]))
            (callLogProbabilities[index] ??= []).push(logProbability);
        }
        sampler.advance(token);
        generated.push(token);
        if (sampler.mode === 'done' || sampler.mode === 'closed') {
          single[0] = token;
          this.binding.invoke('eval', single, this.logits);
          break;
        }
        if (step + 1 < maxNewTokens) {
          single[0] = token;
          this.binding.invoke('eval', single, this.logits);
        }
      }
      if (sampler.mode !== 'done' && sampler.mode !== 'closed')
        return NO_PREDICTION;
      const values = jsonValue(sampler.value);
      if (!Array.isArray(values))
        throw aiError('AI_INVALID_OUTPUT', 'Invalid model response.');
      const calls = values.map((entry): AiCall => {
        if (
          !isObject(entry) ||
          typeof entry.name !== 'string' ||
          !isObject(entry.arguments)
        )
          throw aiError('AI_INVALID_OUTPUT', 'Invalid model call.');
        return { name: entry.name, arguments: entry.arguments };
      });
      const callProbabilities = calls.map((_, index) => {
        const scores = callLogProbabilities[index] ?? [0];
        return Math.exp(scores.reduce((a, b) => a + b, 0) / scores.length);
      });
      const head = this.binding.invoke('confidence');
      const headConfidence = typeof head === 'number' ? head : null;
      const gated = gateCalls(calls, prepared.tools, text, {
        headConfidence,
        callProbabilities,
      });
      const { restore } = prepared;
      return {
        calls: gated.calls.map(restore),
        suppressedCalls: gated.suppressedCalls.map(({ reason, ...call }) => ({
          ...restore(call),
          reason,
        })),
        confidence:
          headConfidence === null
            ? null
            : Math.min(headConfidence, ...callProbabilities),
        reasoning: reasoning
          ? /<think>(.*?)<\/think>/s
              .exec(this.tokenizer.decode(generated))?.[1]
              ?.trim() ?? ''
          : null,
      };
    } finally {
      this.binding.invoke('reset');
    }
  }

  reset(): void {
    this.binding.invoke('reset');
  }

  close(): void {
    this.prepared = undefined;
    this.windowSize = undefined;
    this.binding.invoke('close');
  }

  stats(): unknown {
    return this.binding.invoke('stats');
  }
}
