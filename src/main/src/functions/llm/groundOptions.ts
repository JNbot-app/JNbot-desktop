import type { LlmOptionsResult } from '../../../../common/llm';
import { isSensitivePluginOption, type PluginOption, type PluginOptionChoice } from '../../../../common/pluginOptions';

type Choices = (option: PluginOption) => PluginOptionChoice[] | undefined;

/** Free-form selects accept values that are not in their list. */
const freeForm = (option: PluginOption) => 'freeSolo' in option && Boolean(option.freeSolo);

const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Options the AI must not set: secrets, and ones only a person can capture. */
const settable = (option: PluginOption) =>
  !isSensitivePluginOption(option) && option.type !== 'keybind' && option.type !== 'activeBotSelect';

/** A compact schema for the prompt: current values and the valid choices in this profile. */
export function describeOptions(options: PluginOption[], current: Record<string, unknown>, choices: Choices) {
  return options.filter(settable).map((option) => {
    const valid = choices(option);
    return {
      id: option.id,
      label: option.label,
      type: option.type,
      ...(option.tooltip ? { help: option.tooltip } : {}),
      ...('multiple' in option && option.multiple ? { multiple: true } : {}),
      ...(option.type === 'slider' ? { min: option.min, max: option.max, step: option.step } : {}),
      ...(option.type === 'input' && option.inputType === 'number' ? { number: true } : {}),
      ...(option.type === 'list' ? { fields: option.fields.map(({ key, label, type }) => ({ key, label, type })) } : {}),
      ...(valid ? { choices: valid.map(({ label, value }) => (label === value ? value : { label, value })) } : {}),
      ...(freeForm(option) ? { freeForm: true } : {}),
      current: current[option.id] ?? null,
    };
  });
}

/**
 * The choice the AI meant: exact value or label, else the only choice that
 * contains (or is contained in) it, so "factions" finds "factionsImmortal".
 */
export function matchChoice(value: unknown, choices: PluginOptionChoice[]): PluginOptionChoice | string {
  const wanted = normalize(value);
  if (!wanted) return 'empty value';
  const exact = choices.find((choice) => normalize(choice.value) === wanted || normalize(choice.label) === wanted);
  if (exact) return exact;
  const close = choices.filter((choice) =>
    [choice.value, choice.label].some((text) => {
      const name = normalize(text);
      return name.includes(wanted) || wanted.includes(name);
    }),
  );
  if (close.length === 1) return close[0];
  if (close.length > 1) return `could be ${close.map(({ label }) => label).join(', ')}`;
  return choices.length ? 'not one of the choices' : 'no choices available in this profile';
}

/** Turn a suggested value into a valid one for the option, or a reason it isn't. */
function coerce(option: PluginOption, value: unknown, valid?: PluginOptionChoice[]): { value: unknown } | string {
  const many = option.type === 'multiSelect' || option.type === 'altsSelect' || option.type === 'tagsSelect' ||
    (('multiple' in option) && Boolean(option.multiple));
  if (option.type === 'altRange') {
    if (!Array.isArray(value)) return 'expected a range';
    const ends = value.slice(0, 2).map((end) => (end == null ? null : matchChoice(end, valid ?? [])));
    const problem = ends.find((end) => typeof end === 'string');
    if (problem) return problem as string;
    return { value: [0, 1].map((index) => (ends[index] as PluginOptionChoice | null)?.value ?? null) };
  }
  if (valid) {
    const items = many ? (Array.isArray(value) ? value : [value]) : [value];
    // Known names snap to their choice; free-form options keep new values as typed.
    const matched = items.map((item) => {
      const match = matchChoice(item, valid);
      if (typeof match !== 'string') return match;
      const typed = String(item ?? '').trim();
      return freeForm(option) && typed ? { label: typed, value: typed } : match;
    });
    const problem = matched.find((match) => typeof match === 'string');
    if (problem) return `${problem}`;
    const values = (matched as PluginOptionChoice[]).map((match) => match.value);
    return { value: many ? [...new Set(values)] : values[0] };
  }
  switch (option.type) {
    case 'switch':
      return { value: value === true || /^(true|on|yes|1)$/i.test(String(value)) };
    case 'slider': {
      const number = Number(value);
      if (!Number.isFinite(number)) return 'not a number';
      const stepped = Math.round((number - option.min) / option.step) * option.step + option.min;
      return { value: Math.min(option.max, Math.max(option.min, Number(stepped.toFixed(6)))) };
    }
    case 'input':
      if (option.inputType !== 'number') return { value: String(value ?? '') };
      return Number.isFinite(Number(value)) ? { value: Number(value) } : 'not a number';
    case 'list':
      return Array.isArray(value) ? { value } : 'expected a list';
    case 'coordinate':
      return value && typeof value === 'object' ? { value } : 'expected coordinates';
    default:
      return { value };
  }
}

const show = (value: unknown, valid?: PluginOptionChoice[]): unknown => {
  if (Array.isArray(value)) return value.map((item) => show(item, valid));
  return valid?.find((choice) => choice.value === value)?.label ?? value;
};

/** Keep only valid, actual changes, and say what was left out and why. */
export function groundOptionValues(
  options: PluginOption[],
  suggested: Record<string, unknown>,
  current: Record<string, unknown>,
  choices: Choices,
): Omit<LlmOptionsResult, 'summary'> {
  const result: Omit<LlmOptionsResult, 'summary'> = { values: {}, changes: [], skipped: [] };
  for (const [id, value] of Object.entries(suggested)) {
    const option = options.find((candidate) => candidate.id === id);
    if (!option) continue;
    if (!settable(option)) {
      result.skipped.push({ label: option.label, value, reason: 'set this one yourself' });
      continue;
    }
    const valid = choices(option);
    const coerced = coerce(option, value, valid);
    if (typeof coerced === 'string') {
      result.skipped.push({ label: option.label, value, reason: coerced });
      continue;
    }
    if (JSON.stringify(coerced.value) === JSON.stringify(current[id] ?? null)) continue;
    result.values[id] = coerced.value;
    result.changes.push({ id, label: option.label, from: show(current[id] ?? null, valid), to: show(coerced.value, valid) });
  }
  return result;
}
