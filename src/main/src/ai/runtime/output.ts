import type { AiCall, AiSchema } from '../../../../common/types/pluginApi';
import type { ToolDefinition } from '../protocol';
import { isObject } from '../schema';

/**
 * A call whose mean grammar-constrained token probability falls below this is withheld.
 * Calibrated on the main model (jnbot-model-deployment.cact, SHA 99d78c3b…) with memory
 * on: it drops 2% of right calls and about a quarter of wrong ones. Recalibrate for
 * another model; the flash model keeps its confidence head instead.
 */
export const CALL_PROBABILITY_FLOOR = 0.965;

export interface TokenFilter {
  allows(token: number): boolean;
}

/**
 * Log-probability of the chosen token renormalised over the grammar-valid tokens.
 * The constrained value lies between the full-vocabulary value and 0, so a near-certain
 * token skips the grammar checks. Otherwise only candidates within `window` logits of
 * the chosen token are checked; the rest change the result by at most topK * e^-window.
 */
export function constrainedLogProbability(
  logits: Float32Array,
  token: number,
  full: number,
  filter: TokenFilter,
  topK = 32,
  window = 12,
  certain = -1e-4,
): number {
  if (full > certain) return full;
  const floor = logits[token] - window;
  let close: number[] = [];
  for (let i = 0; i < logits.length; i += 1)
    if (i !== token && logits[i] >= floor) close.push(i);
  if (close.length > topK)
    close = close.sort((a, b) => logits[b] - logits[a]).slice(0, topK);
  const allowed = [token, ...close.filter((t) => filter.allows(t))];
  let maximum = -Infinity;
  for (const t of allowed) maximum = Math.max(maximum, logits[t]);
  let total = 0;
  for (const t of allowed) total += Math.exp(logits[t] - maximum);
  return logits[token] - maximum - Math.log(total);
}

/** Maps generated JSON bytes to the index of the call (array item) they belong to. */
export class CallTracker {
  private depth = 0;

  private inString = false;

  private escape = false;

  private call = -1;

  feed(data: Uint8Array): Set<number> {
    const touched = new Set<number>();
    for (const byte of data) {
      if (this.inString) {
        if (this.escape) this.escape = false;
        else if (byte === 0x5c) this.escape = true;
        else if (byte === 0x22) this.inString = false;
      } else if (byte === 0x22) this.inString = true;
      else if (byte === 0x7b || byte === 0x5b) {
        this.depth += 1;
        if (byte === 0x7b && this.depth === 2) this.call += 1;
      } else if (byte === 0x7d || byte === 0x5d) {
        // A closing bracket still belongs to the call it closes.
        if (this.depth >= 2) touched.add(this.call);
        this.depth -= 1;
      }
      if (this.depth >= 2 && byte !== 0x7d && byte !== 0x5d)
        touched.add(this.call);
    }
    return touched;
  }
}

// Grounding rules, ported from needle/cpu/output.py: values must come from the request.
const NUMBER =
  /(?<![\p{L}\p{N}_.,])(?:[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d+(?:\.\d+)?)(?!\d)/u;
const QUANTITY =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|half|quarter)\b/i;
const POLAR: Record<string, string[]> = {
  open: ['open', 'unlock', 'unlatch'],
  close: ['close', 'shut', 'lock'],
  on: ['on', 'enable', 'activate', 'start', 'brighten', 'dim'],
  off: ['off', 'disable', 'deactivate', 'stop'],
  forward: ['forward', 'forwards', 'ahead'],
  backward: ['backward', 'backwards', 'back'],
  left: ['left', 'counterclockwise'],
  right: ['right', 'clockwise'],
};
const SEMANTIC = /classif|sentiment|detect|categor|analy[sz]/i;
const TEMPORAL = /date|time|check_in|check_out/;
const ACTIONS = new Set(
  'move rotate open close lock unlock send delete create start stop play pause buy sell equip attack mine'.split(
    ' ',
  ),
);

function polar(value: string): string[] | undefined {
  return Object.hasOwn(POLAR, value) ? POLAR[value] : undefined;
}

function normalized(text: unknown): string {
  return (
    String(text)
      .replaceAll('_', ' ')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.join(' ') ?? ''
  );
}

function mentioned(value: unknown, source: string): boolean {
  const word = normalized(value);
  return word !== '' && ` ${normalized(source)} `.includes(` ${word} `);
}

function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    isObject(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : item,
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface GateOptions {
  /** Mean constrained token probability per call, aligned with the calls. */
  callProbabilities?: number[];
  /** The archive's confidence head score, when the model has one. */
  headConfidence?: number | null;
}

export interface GatedCalls {
  calls: AiCall[];
  suppressedCalls: (AiCall & { reason?: string })[];
}

/**
 * Withhold calls with unsupported required values, negated requests and low confidence;
 * drop unsupported optional values and duplicates. Withheld calls stay reviewable.
 * Calls and tools use the normalised (snake_case) names the model generated.
 */
export function gateCalls(
  calls: AiCall[],
  tools: ToolDefinition[],
  query: string,
  options: GateOptions = {},
): GatedCalls {
  const { callProbabilities, headConfidence } = options;
  const schemas = new Map(tools.map((tool) => [tool.name, tool.parameters]));
  const hasQuantity = NUMBER.test(query) || QUANTITY.test(query);
  const result: GatedCalls = { calls: [], suppressedCalls: [] };
  const seen = new Set<string>();
  calls.forEach((original, index) => {
    const call = structuredClone(original);
    const semantic = SEMANTIC.test(call.name);
    let ungrounded = false;
    const walk = (value: unknown, node: AiSchema | undefined): void => {
      if (!node) return;
      if (Array.isArray(value)) {
        for (const item of value) walk(item, node.items);
        return;
      }
      if (!isObject(value)) return;
      for (const key of Object.keys(value)) {
        const child = node.properties?.[key];
        const item = value[key];
        let unsupported = false;
        if (child && typeof item === 'number') unsupported = !hasQuantity;
        else if (child && typeof item === 'string' && !semantic)
          unsupported = child.enum
            ? !(polar(item) ?? [item]).some((word) => mentioned(word, query))
            : !TEMPORAL.test(key) && !mentioned(item, query);
        if (unsupported) {
          if (node.required?.includes(key)) ungrounded = true;
          else delete value[key];
        } else if (Array.isArray(item) || isObject(item)) walk(item, child);
      }
    };
    walk(call.arguments, schemas.get(call.name));
    // A negated action is withheld: "don't sell", "never send it".
    const verb = call.name.split('_')[0];
    const verbs = new Set<string>(
      ACTIONS.has(verb) ||
      (call.name.includes('_') && !['get', 'set'].includes(verb))
        ? [verb]
        : [],
    );
    for (const item of Object.values(call.arguments))
      if (typeof item === 'string')
        polar(item)?.forEach((word) => verbs.add(word));
    const negated = [...verbs].some((word) =>
      new RegExp(
        `\\b(?:do\\s+not|don['’]t|never|must\\s+not)\\s+(?:\\w+\\s+){0,2}${escapeRegExp(word)}\\b`,
        'i',
      ).test(query),
    );
    const unsure =
      (typeof headConfidence === 'number' && headConfidence < 0.1) ||
      (callProbabilities !== undefined &&
        callProbabilities[index] < CALL_PROBABILITY_FLOOR);
    let reason: string | undefined;
    if (ungrounded) reason = 'ungrounded';
    else if (negated) reason = 'negated';
    else if (unsure) reason = 'low_confidence';
    if (reason) result.suppressedCalls.push({ ...call, reason });
    else if (!seen.has(sortedJson(call))) {
      seen.add(sortedJson(call));
      result.calls.push(call);
    }
  });
  return result;
}
