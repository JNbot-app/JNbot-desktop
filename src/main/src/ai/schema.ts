import Ajv from 'ajv';
import type {
  AiJson,
  AiSchema,
  AiTool,
  AiError,
} from '../../../common/types/pluginApi';

export function aiError(code: string, message: string): Error & AiError {
  return Object.assign(new Error(message), { code });
}

export function errorInfo(error: unknown): AiError {
  return {
    code:
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'AI_ENGINE',
    message: error instanceof Error ? error.message : String(error),
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reject lossy JSON conversion, including undefined properties and non-finite numbers. */
export function jsonValue(value: unknown): AiJson {
  const ancestors = new Set<object>();
  function visit(input: unknown): AiJson {
    if (
      input === null ||
      typeof input === 'string' ||
      typeof input === 'boolean'
    )
      return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || input === null || ancestors.has(input))
      throw aiError('AI_INVALID_INPUT', 'Expected a serializable JSON value.');
    ancestors.add(input);
    try {
      if (Array.isArray(input)) return Array.from(input, visit);
      const prototype = Object.getPrototypeOf(input);
      if (
        prototype !== null &&
        (Object.prototype.toString.call(input) !== '[object Object]' ||
          prototype.constructor?.name !== 'Object')
      )
        throw aiError('AI_INVALID_INPUT', 'Expected a plain JSON object.');
      if (Object.getOwnPropertySymbols(input).length)
        throw aiError(
          'AI_INVALID_INPUT',
          'JSON objects cannot contain symbol keys.',
        );
      return Object.fromEntries(
        Object.entries(input).map(([key, item]) => [key, visit(item)]),
      );
    } finally {
      ancestors.delete(input);
    }
  }
  return visit(value);
}

const validator = new Ajv({ allErrors: true, jsonPointers: true });
const keywords = new Set([
  'type',
  'description',
  'title',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
]);
const types = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

export function compileSchema(schema: unknown): (value: unknown) => void {
  const copy = jsonValue(schema);
  function check(node: AiJson, path: string): void {
    if (
      !isObject(node) ||
      typeof node.type !== 'string' ||
      !types.has(node.type)
    )
      throw aiError(
        'AI_INVALID_SCHEMA',
        `${path}: a supported schema type is required.`,
      );
    for (const key of Object.keys(node)) {
      if (!keywords.has(key))
        throw aiError(
          'AI_INVALID_SCHEMA',
          `${path}/${key}: unsupported keyword.`,
        );
      const applicability: Record<string, string[]> = {
        properties: ['object'],
        required: ['object'],
        additionalProperties: ['object'],
        items: ['array'],
        minItems: ['array'],
        maxItems: ['array'],
        uniqueItems: ['array'],
        minLength: ['string'],
        maxLength: ['string'],
        pattern: ['string'],
        minimum: ['number', 'integer'],
        maximum: ['number', 'integer'],
        exclusiveMinimum: ['number', 'integer'],
        exclusiveMaximum: ['number', 'integer'],
        multipleOf: ['number', 'integer'],
      };
      if (applicability[key] && !applicability[key].includes(node.type))
        throw aiError(
          'AI_INVALID_SCHEMA',
          `${path}/${key}: keyword does not apply to ${node.type}.`,
        );
    }
    if ('properties' in node) {
      if (!isObject(node.properties))
        throw aiError(
          'AI_INVALID_SCHEMA',
          `${path}/properties: expected an object.`,
        );
      for (const [key, child] of Object.entries(node.properties))
        check(jsonValue(child), `${path}/properties/${key}`);
    }
    if ('items' in node) check(jsonValue(node.items), `${path}/items`);
    if (
      'additionalProperties' in node &&
      typeof node.additionalProperties !== 'boolean'
    )
      throw aiError(
        'AI_INVALID_SCHEMA',
        `${path}/additionalProperties: expected a boolean.`,
      );
  }
  check(copy, '$');
  if (!isObject(copy) || copy.type !== 'object')
    throw aiError('AI_INVALID_SCHEMA', 'The root schema must be an object.');
  try {
    const validate = validator.compile(copy);
    validator.removeSchema(copy);
    return (value: unknown): void => {
      jsonValue(value);
      if (!validate(value))
        throw aiError(
          'AI_INVALID_OUTPUT',
          validator.errorsText(validate.errors),
        );
    };
  } catch (error) {
    throw aiError('AI_INVALID_SCHEMA', errorInfo(error).message);
  }
}

export interface RegisteredTool {
  definition: Omit<AiTool, 'handler'>;
  handler: AiTool['handler'];
  validate: (value: unknown) => void;
}

export function registerTools(tools: AiTool[]): Map<string, RegisteredTool> {
  if (!Array.isArray(tools))
    throw aiError('AI_INVALID_INPUT', 'tools must be an array.');
  const registered = new Map<string, RegisteredTool>();
  for (const tool of tools) {
    if (
      !tool ||
      typeof tool.name !== 'string' ||
      !tool.name.trim() ||
      typeof tool.description !== 'string'
    )
      throw aiError(
        'AI_INVALID_INPUT',
        'Tools need a non-empty name and a description.',
      );
    if (tool.handler !== undefined && typeof tool.handler !== 'function')
      throw aiError('AI_INVALID_INPUT', `Invalid handler for ${tool.name}.`);
    if (registered.has(tool.name))
      throw aiError('AI_INVALID_INPUT', `Duplicate tool: ${tool.name}.`);
    const parameters = JSON.parse(
      JSON.stringify(jsonValue(tool.parameters)),
    ) as AiSchema;
    registered.set(tool.name, {
      definition: {
        name: tool.name,
        description: tool.description,
        parameters,
      },
      handler: tool.handler,
      validate: compileSchema(parameters),
    });
  }
  return registered;
}
