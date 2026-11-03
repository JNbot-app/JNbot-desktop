import type {
  AiCall,
  AiJson,
  AiSchema,
} from '../../../../common/types/pluginApi';
import type { ToolDefinition } from '../protocol';
import { aiError, isObject } from '../schema';

type Aliases = {
  properties: Map<string, { name: string; child: Aliases }>;
  items?: Aliases;
};
function snake(name: string): string {
  // Internal aliases use ASCII so mobile runtimes need no Unicode regex support.
  // The alias maps restore the original tool and property names after inference.
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}
function unique(name: string, used: Set<string>, index: number): string {
  let key = snake(name) || `jn_field_${index}`;
  while (used.has(key)) key += '_';
  used.add(key);
  return key;
}
function normalize(schema: AiSchema): { schema: AiSchema; aliases: Aliases } {
  const result = structuredClone(schema);
  const aliases: Aliases = { properties: new Map() };
  if (schema.properties) {
    const used = new Set<string>();
    const names = new Map<string, string>();
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, child], i) => {
        const key = unique(name, used, i);
        const nested = normalize(child);
        names.set(name, key);
        aliases.properties.set(key, { name, child: nested.aliases });
        return [key, nested.schema];
      }),
    );
    if (schema.required)
      result.required = schema.required.map((name) => names.get(name) ?? name);
  }
  // Training prompts always close objects; the grammar then also rejects invented keys.
  if (
    (schema.properties || schema.type === 'object') &&
    schema.additionalProperties === undefined
  )
    result.additionalProperties = false;
  if (schema.items) {
    const item = normalize(schema.items);
    result.items = item.schema;
    aliases.items = item.aliases;
  }
  return { schema: result, aliases };
}
function restoreJson(value: unknown, aliases: Aliases): AiJson {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  )
    return value;
  if (Array.isArray(value))
    return value.map((item) => restoreJson(item, aliases.items ?? aliases));
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const alias = aliases.properties.get(key);
        return [
          alias?.name ?? key,
          restoreJson(item, alias?.child ?? { properties: new Map() }),
        ];
      }),
    );
  throw aiError('AI_INVALID_OUTPUT', 'Invalid model arguments.');
}
export default function prepareTools(tools: ToolDefinition[]) {
  const aliases = new Map<string, { name: string; arguments: Aliases }>();
  const used = new Set<string>();
  const normalized = tools.map((tool, i) => {
    const name = unique(tool.name, used, i);
    const parameters = normalize(tool.parameters);
    aliases.set(name, { name: tool.name, arguments: parameters.aliases });
    return {
      name,
      description: tool.description,
      parameters: parameters.schema,
    };
  });
  return {
    tools: normalized,
    restore(call: AiCall): AiCall {
      const alias = aliases.get(call.name);
      if (!alias) throw aiError('AI_INVALID_OUTPUT', 'Unknown model tool.');
      const args = restoreJson(call.arguments, alias.arguments);
      if (!isObject(args))
        throw aiError('AI_INVALID_OUTPUT', 'Invalid model arguments.');
      return { name: alias.name, arguments: args };
    },
  };
}
