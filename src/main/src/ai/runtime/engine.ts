import type { AiCall } from '../../../../common/types/pluginApi';
import type { EnginePrediction } from '../NeedleEngine';
import type { ToolDefinition } from '../protocol';
import { aiError, filterThreshold, isObject, jsonValue } from '../schema';
import { loadModel } from './model';
import Tokenizer from './tokenizer';
import prepareTools from './tools';
import PreparedGrammar from './grammar';
import ToolFilter, { pooled } from './toolFilter';
import { CallTracker, constrainedLogProbability, gateCalls } from './output';
import provenance from '../../../../../native/needle/vendor/provenance.json';

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

export default class InferenceRuntime {
  private readonly context: number;

  private readonly tokenizer: Tokenizer;

  private readonly logits: Float32Array;

  private prepared?: PreparedTools;

  private filtered?: PreparedTools;

  private prefixPrepared?: PreparedTools;

  private toolFilter?: ToolFilter;

  private extraction = false;

  constructor(
    private readonly binding: NativeBinding,
    file: string,
    readonly variant: 'main' | 'flash',
  ) {
    try {
      const model = loadModel(file, variant);
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
      if ('weights' in model) {
        if (binding.invoke('identity') !== provenance.encoderSourceSha256)
          throw aiError(
            'AI_MODEL',
            'Inference build differs from the supported model contract.',
          );
        binding.invoke('attach', model.weights);
        binding.invoke(
          'encoder',
          file,
          model.encoder.offset,
          model.encoderContext,
        );
      }
    } catch (error) {
      binding.invoke('close');
      throw error;
    }
  }

  private prepare(
    tools: ToolDefinition[],
    key: string,
    extraction: boolean,
    restore: (call: AiCall) => AiCall,
  ): PreparedTools {
    const system = extraction
      ? '<|im_start|>system\nExtract structured facts from the input.<|im_end|>\n'
      : '';
    const prefix = `${system}<|im_start|>user\n<tools>${JSON.stringify(tools)}</tools>\n`;
    const tokenized = this.tokenizer.preparePrefix(prefix);
    return {
      key,
      tools,
      tokens: [this.tokenizer.bos, ...tokenized.tokens],
      suffix: tokenized.append,
      grammar: new PreparedGrammar(tools, this.tokenizer),
      restore,
    };
  }

  init(tools: ToolDefinition[], extraction = false): void {
    const key = JSON.stringify([tools, extraction]);
    if (this.prepared?.key === key) return;
    const adapted = prepareTools(tools);
    const prepared = this.prepare(
      adapted.tools,
      key,
      extraction,
      adapted.restore,
    );
    this.binding.invoke('reset');
    this.binding.invoke('prefix', 0);
    this.prepared = prepared;
    this.extraction = extraction;
    this.filtered = undefined;
    this.prefixPrepared = undefined;
    this.toolFilter?.setTools(prepared.tools);
  }

  complete(
    text: string,
    maxNewTokens: number,
    reasoning = false,
    toolFilterThreshold: number | null = null,
  ): EnginePrediction {
    let { prepared } = this;
    if (!prepared) throw aiError('AI_ENGINE', 'Tools are not prepared.');
    const threshold = filterThreshold(toolFilterThreshold);
    const deferred = this.variant === 'main' && threshold !== undefined;
    this.binding.invoke('reset');
    try {
      if (deferred) {
        if (!this.toolFilter) {
          this.toolFilter = new ToolFilter();
          this.toolFilter.setTools(prepared.tools);
        }
        if (!prepared.tools.length)
          return {
            calls: [],
            suppressedCalls: [],
            confidence: null,
            reasoning: null,
          };
        this.toolFilter.prepare(this.binding);
        const query = pooled(
          this.binding.invoke(
            'encode',
            `task: search result | query: ${text}`,
            false,
            true,
          ),
        );
        const selected = this.toolFilter.select(query, threshold, this.binding);
        if (!selected.length)
          return {
            calls: [],
            suppressedCalls: [],
            confidence: null,
            reasoning: null,
          };
        const key = JSON.stringify(selected.map((tool) => tool.name));
        if (this.filtered?.key !== key)
          this.filtered = this.prepare(
            selected,
            key,
            this.extraction,
            prepared.restore,
          );
        prepared = this.filtered;
      }
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
      if (this.prefixPrepared && this.prefixPrepared !== prepared)
        this.binding.invoke('prefix', 0);
      this.binding.invoke('prefix', prepared.tokens.length);
      this.prefixPrepared = prepared;
      if (deferred) this.binding.invoke('prepare');
      else if (this.variant === 'main')
        this.binding.invoke(
          'encode',
          `task: search result | query: ${text}`,
          true,
        );
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
        return {
          calls: [],
          suppressedCalls: [],
          confidence: null,
          reasoning: null,
        };
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
      const head =
        this.variant === 'flash' ? this.binding.invoke('confidence') : null;
      const headConfidence = typeof head === 'number' ? head : null;
      // The per-call floor is calibrated for the main model only.
      const gated = gateCalls(calls, prepared.tools, text, {
        headConfidence,
        callProbabilities:
          this.variant === 'main' ? callProbabilities : undefined,
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

  embed(text: string): number[] {
    if (this.variant === 'flash')
      throw aiError(
        'AI_UNSUPPORTED_FEATURE',
        'The flash model does not support embeddings.',
      );
    const values = this.binding.invoke(
      'encode',
      `task: search result | query: ${text}`,
      false,
    );
    return Array.from(pooled(values));
  }

  reset(): void {
    this.binding.invoke('reset');
  }

  close(): void {
    this.prepared = undefined;
    this.filtered = undefined;
    this.prefixPrepared = undefined;
    this.toolFilter = undefined;
    this.binding.invoke('close');
  }

  stats(): unknown {
    return this.binding.invoke('stats');
  }
}
