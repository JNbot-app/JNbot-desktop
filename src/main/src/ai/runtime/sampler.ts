import { aiError } from '../schema';
import JsonState from './jsonState';
import type PreparedGrammar from './grammar';

const invalid = () =>
  aiError('AI_INVALID_OUTPUT', 'No schema-valid model continuation.');
type Mode = 'before' | 'json' | 'closed' | 'done';
export default class Sampler {
  private json: JsonState;

  private transitions = new Map<
    number,
    { state: JsonState; mode: Mode } | null
  >();

  mode: Mode = 'before';

  constructor(private readonly prepared: PreparedGrammar) {
    this.json = new JsonState(
      prepared.schema,
      prepared.checks,
      prepared.validator,
    );
  }

  get value(): unknown {
    return this.json.value;
  }

  private transition(token: number): { state: JsonState; mode: Mode } | null {
    const saved = this.transitions.get(token);
    if (saved !== undefined) return saved;
    const { tokenizer } = this.prepared;
    let state = this.json;
    const { mode } = this;
    let result: { state: JsonState; mode: Mode } | null = null;
    if (token === tokenizer.eos || token === tokenizer.id('<|im_end|>')) {
      if (mode === 'closed') result = { state, mode: 'done' };
    } else if (mode === 'before') {
      if (token === tokenizer.id('<tool_call>'))
        result = { state, mode: 'json' };
      else if (
        token !== tokenizer.id('</tool_call>') &&
        ![1, 2].includes(tokenizer.types[token])
      )
        result = { state, mode };
    } else if (mode !== 'closed' && mode !== 'done') {
      if (token === tokenizer.id('</tool_call>')) {
        if (state.done) result = { state, mode: 'closed' };
      } else if (
        token !== tokenizer.id('<tool_call>') &&
        ![1, 2].includes(tokenizer.types[token])
      ) {
        state = state.clone();
        try {
          state.feed(tokenizer.bytes[token]);
          result = { state, mode };
        } catch {
          /* This token cannot complete the schema. */
        }
      }
    }
    this.transitions.set(token, result);
    return result;
  }

  /** Whether the token is a schema-valid continuation of the current state. */
  allows(token: number): boolean {
    return this.transition(token) !== null;
  }

  select(logits: Float32Array): number {
    if (
      logits.length !== this.prepared.tokenizer.pieces.length ||
      !logits.every(Number.isFinite)
    )
      throw invalid();
    let best = 0;
    for (let i = 1; i < logits.length; i += 1)
      if (logits[i] > logits[best]) best = i;
    if (this.transition(best)) return best;
    // Usually the best valid token is in the top 32. Avoid sorting the full vocabulary.
    const top: number[] = [];
    const before = (a: number, b: number) =>
      logits[a] > logits[b] || (logits[a] === logits[b] && a < b);
    for (let token = 0; token < logits.length; token += 1) {
      if (top.length < 32 || before(token, top[31])) {
        let low = 0;
        let high = top.length;
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          if (before(token, top[mid])) high = mid;
          else low = mid + 1;
        }
        top.splice(low, 0, token);
        if (top.length > 32) top.pop();
      }
    }
    for (const token of top)
      if (token !== best && this.transition(token)) return token;
    const seen = new Set(top);
    const order = Array.from({ length: logits.length }, (_, i) => i).sort(
      (a, b) => logits[b] - logits[a] || a - b,
    );
    for (const token of order)
      if (!seen.has(token) && this.transition(token)) return token;
    throw invalid();
  }

  advance(token: number): void {
    const next = this.transition(token);
    if (!next) throw invalid();
    this.json = next.state;
    this.mode = next.mode;
    this.transitions.clear();
  }
}
