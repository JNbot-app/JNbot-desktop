import * as z from 'zod/v4';
import { McpInputError } from './mcp';

import type {
  AltRangeValue,
  ActiveBotFilter,
  PluginOptionType,
  PluginOptionBase,
  PluginOptionChoice,
  PluginListField,
  PluginOptionInput,
  PluginOptionSwitch,
  PluginOptionSelect,
  PluginOptionMultiSelect,
  PluginOptionSlider,
  PluginOptionGamemodeSelect,
  PluginOptionAltSelect,
  PluginOptionAltsSelect,
  PluginOptionTagsSelect,
  PluginOptionAltRange,
  PluginOptionList,
  PluginOptionCoordinate,
  PluginOptionKeybind,
  PluginOptionActiveBotSelect,
  PluginOption,
  PluginOptionSection,
  PluginOptionSchema,
} from './types/pluginOptions.d';

export type {
  AltRangeValue,
  ActiveBotFilter,
  PluginOptionType,
  PluginOptionBase,
  PluginOptionChoice,
  PluginListField,
  PluginOptionInput,
  PluginOptionSwitch,
  PluginOptionSelect,
  PluginOptionMultiSelect,
  PluginOptionSlider,
  PluginOptionGamemodeSelect,
  PluginOptionAltSelect,
  PluginOptionAltsSelect,
  PluginOptionTagsSelect,
  PluginOptionAltRange,
  PluginOptionList,
  PluginOptionCoordinate,
  PluginOptionKeybind,
  PluginOptionActiveBotSelect,
  PluginOption,
  PluginOptionSection,
  PluginOptionSchema,
};

export const PLUGIN_OPTION_TYPES = new Set<PluginOptionType>([
  'select', 'multiSelect', 'slider', 'input', 'gamemodeSelect', 'altSelect',
  'altsSelect', 'tagsSelect', 'altRange', 'switch', 'list', 'coordinate', 'keybind',
  'activeBotSelect',
]);

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const text = (max: number) => z.string().min(1).max(max);
const finiteNumber = z.number().finite();
const choice = z.object({ label: text(120), value: z.union([z.string(), finiteNumber]) }).strict();
const base = {
  id,
  label: text(120),
  tooltip: z.string().max(500).optional(),
  required: z.boolean().optional(),
  valueByFieldId: id.optional(),
  className: z.string().max(120).optional(),
};
const listField = z.discriminatedUnion('type', [
  z.object({ key: id, label: text(120), type: z.literal('input'), inputType: z.enum(['text', 'number', 'password']).optional(), placeholder: z.string().max(240).optional(), defaultValue: z.union([z.string(), finiteNumber]).optional() }).strict(),
  z.object({ key: id, label: text(120), type: z.literal('switch'), defaultValue: z.boolean().optional() }).strict(),
  z.object({ key: id, label: text(120), type: z.literal('slider'), min: finiteNumber, max: finiteNumber, step: finiteNumber.positive(), defaultValue: finiteNumber.optional() }).strict(),
  z.object({ key: id, label: text(120), type: z.literal('select'), options: z.array(choice).min(1).max(100), defaultValue: z.union([z.string(), finiteNumber]).optional() }).strict(),
  z.object({ key: id, label: text(120), type: z.literal('altSelect'), defaultValue: z.string().optional() }).strict(),
]);

const option = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('input'), inputType: z.enum(['text', 'number', 'password']).optional(), placeholder: z.string().max(240).optional(), defaultValue: z.union([z.string(), finiteNumber]).optional() }).strict(),
  z.object({ ...base, type: z.literal('switch'), defaultValue: z.boolean().optional(), labelChecked: z.string().max(120).optional(), labelUnchecked: z.string().max(120).optional() }).strict(),
  z.object({ ...base, type: z.literal('select'), options: z.array(choice).min(1).max(100), defaultValue: z.union([z.string(), finiteNumber]).optional(), clearable: z.boolean().optional(), freeSolo: z.boolean().optional() }).strict(),
  z.object({ ...base, type: z.literal('multiSelect'), options: z.array(text(160)).min(1).max(100), defaultValue: z.array(z.string()).max(100).optional(), freeSolo: z.boolean().optional() }).strict(),
  z.object({ ...base, type: z.literal('slider'), min: finiteNumber, max: finiteNumber, step: finiteNumber.positive(), marks: z.record(z.string(), z.string().max(120)).optional(), defaultValue: finiteNumber.optional() }).strict(),
  z.object({ ...base, type: z.literal('gamemodeSelect'), gamemodes: z.array(text(80)).min(1).max(100).optional(), multiple: z.boolean().optional(), defaultValue: z.union([z.string(), z.array(z.string()).max(100)]).optional() }).strict(),
  z.object({ ...base, type: z.literal('altSelect'), defaultValue: z.string().optional(), clearable: z.boolean().optional(), freeSolo: z.boolean().optional() }).strict(),
  z.object({ ...base, type: z.literal('altsSelect'), defaultValue: z.array(z.string()).max(100).optional() }).strict(),
  z.object({ ...base, type: z.literal('tagsSelect'), defaultValue: z.array(z.string()).max(100).optional() }).strict(),
  z.object({ ...base, type: z.literal('altRange'), defaultValue: z.tuple([z.string().nullable(), z.string().nullable()]).optional() }).strict(),
  z.object({ ...base, type: z.literal('list'), fields: z.array(listField).min(1).max(6), defaultValue: z.array(z.record(z.string(), z.unknown())).max(100).optional(), minItems: z.number().int().min(0).max(100).optional(), maxItems: z.number().int().min(1).max(100).optional(), addLabel: z.string().max(120).optional() }).strict(),
  z.object({ ...base, type: z.literal('coordinate'), defaultValue: z.object({ x: finiteNumber.optional(), y: finiteNumber.optional(), z: finiteNumber.optional(), dimension: z.enum(['overworld', 'nether', 'end']).optional() }).strict().optional(), withDimension: z.boolean().optional() }).strict(),
  z.object({ ...base, type: z.literal('keybind'), defaultValue: z.string().max(80).optional(), simple: z.boolean().optional() }).strict(),
  z.object({ ...base, type: z.literal('activeBotSelect'), botFilter: z.enum(['all', 'bots', 'minecraft']).optional(), filter: z.enum(['all', 'bots', 'minecraft']).optional(), multiple: z.boolean().optional(), clearable: z.boolean().optional(), freeSolo: z.boolean().optional(), defaultValue: z.array(z.string()).max(100).optional() }).strict(),
]);

export const pluginOptionSchemaInput = z.array(
  z.object({ name: text(100), options: z.array(option).max(100), collapsed: z.boolean().optional(), className: z.string().max(120).optional() }).strict(),
).max(20);

/**
 * Public MCP input: prefer the native array, but accept JSON text from clients
 * that cannot send nested arrays reliably. Detailed validation happens after
 * normalization so the caller receives a usable correction rather than a union
 * branch error.
 */
export const pluginOptionSchemaArgument = z.union([
  z.array(z.unknown()),
  z.string().max(256 * 1024),
]).describe('Plugin settings schema. Prefer a native array of { name, options } sections. A JSON-encoded array string is also accepted for compatibility.');

export function isSensitivePluginOption(option: { id: string; label: string; type: string; inputType?: string }): boolean {
  return option.type === 'input' && option.inputType === 'password' ||
    /password|token|secret|credential|api.?key/i.test(`${option.id} ${option.label}`);
}

function optionSchemaPath(path: PropertyKey[]) {
  return path.reduce<string>((result, part) =>
    typeof part === 'number' ? `${result}[${part}]` : `${result}.${String(part)}`,
  'optionSchema');
}

function optionSchemaHint(path: PropertyKey[]) {
  const key = String(path.at(-1) ?? '');
  if (key === 'type') return 'Use one supported type such as "input", "switch", "select", or "altSelect".';
  if (key === 'options') return 'Each section needs an options array; select options need non-empty { label, value } entries.';
  if (key === 'id') return 'Use a unique URL-safe id containing only letters, numbers, underscores, or hyphens.';
  if (key === 'name') return 'Each section needs a short name, for example "General".';
  return 'Use an array like [{ "name": "General", "options": [{ "id": "enabled", "label": "Enabled", "type": "switch" }] }].';
}

function parsePluginOptionSchema(value: unknown): PluginOptionSchema {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid JSON';
      throw new McpInputError(
        `optionSchema is a string, so it must contain a JSON array. JSON parsing failed: ${reason}`,
        {
          field: 'optionSchema',
          received: 'string that is not valid JSON',
          expected: 'a native array, or a JSON string representing an array of option sections',
          correction: 'Prefer sending a native array. If sending text, start with [ and end with ].',
        },
      );
    }
  }

  const result = pluginOptionSchemaInput.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 12).map((issue) => ({
      path: optionSchemaPath(issue.path),
      problem: issue.message,
      hint: optionSchemaHint(issue.path),
    }));
    throw new McpInputError(
      `optionSchema is invalid at ${issues.map((issue) => issue.path).join(', ')}.`,
      {
        field: 'optionSchema',
        received: Array.isArray(parsed) ? 'array with invalid section or option data' : typeof parsed,
        expected: 'an array of named sections, each containing a valid options array',
        issues,
        correction: 'Send optionSchema as a native array whenever possible; do not quote the whole array unless the client requires JSON text.',
      },
    );
  }
  return result.data as PluginOptionSchema;
}

export function validatePluginOptionSchema(value: unknown): PluginOptionSchema {
  const schema = parsePluginOptionSchema(value);
  const byId = new Map<string, { item: PluginOption; path: string }>();
  const invalidRule = (path: string, problem: string, hint: string): never => {
    throw new McpInputError(`optionSchema is invalid at ${path}: ${problem}`, {
      field: 'optionSchema',
      expected: 'a valid option schema',
      issues: [{ path, problem, hint }],
      correction: hint,
    });
  };
  for (const [sectionIndex, section] of schema.entries()) {
    for (const [optionIndex, item] of section.options.entries()) {
      const path = `optionSchema[${sectionIndex}].options[${optionIndex}]`;
      if (byId.has(item.id)) invalidRule(`${path}.id`, `option id "${item.id}" is duplicated.`, 'Give every option a unique id across all sections.');
      byId.set(item.id, { item, path });
      if (isSensitivePluginOption(item) && item.defaultValue !== undefined)
        invalidRule(`${path}.defaultValue`, `sensitive option "${item.id}" cannot have an AI-provided default value.`, 'Remove defaultValue from password, token, secret, credential, and API-key options.');
      if (item.type === 'slider' && (item.min >= item.max || item.defaultValue !== undefined && (item.defaultValue < item.min || item.defaultValue > item.max)))
        invalidRule(path, `slider "${item.id}" needs min < max and any defaultValue within that range.`, 'Set a positive step, use min lower than max, and keep defaultValue inside the range.');
      if (item.type === 'list') {
        const keys = new Set(item.fields?.map((field: PluginListField) => field.key));
        if (keys.size !== item.fields?.length) invalidRule(`${path}.fields`, `list option "${item.id}" has duplicate field keys.`, 'Give every list field a unique key.');
        if (item.minItems !== undefined && item.maxItems !== undefined && item.minItems > item.maxItems)
          invalidRule(path, `list option "${item.id}" has minItems greater than maxItems.`, 'Set minItems to a value less than or equal to maxItems.');
      }
    }
  }
  for (const { item, path } of byId.values()) {
    if (!item.valueByFieldId) continue;
    const parent = byId.get(item.valueByFieldId);
    if (!parent || parent.item.id === item.id || !['select', 'gamemodeSelect', 'altSelect', 'keybind'].includes(parent.item.type))
      invalidRule(`${path}.valueByFieldId`, `option "${item.id}" references an invalid controlling option.`, 'Reference a different select, gamemodeSelect, altSelect, or keybind option id.');
  }
  if (Buffer.byteLength(JSON.stringify(schema)) > 256 * 1024)
    invalidRule('optionSchema', 'the serialized schema exceeds 256 KiB.', 'Reduce the number of sections, options, and default values.');
  return schema;
}
