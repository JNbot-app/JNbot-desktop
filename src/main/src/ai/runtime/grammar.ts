import Ajv from 'ajv';
import type { ToolDefinition } from '../protocol';
import Tokenizer from './tokenizer';
import type { Shape } from './jsonState';
import Sampler from './sampler';

export default class PreparedGrammar {
  readonly schema: Shape;

  readonly checks = new Map<string, Ajv.ValidateFunction>();

  readonly validator = new Ajv({ allErrors: false });

  constructor(
    tools: ToolDefinition[],
    readonly tokenizer: Tokenizer,
  ) {
    this.schema = {
      type: 'array',
      items: tools.length
        ? {
            oneOf: tools.map((tool) => ({
              type: 'object',
              properties: {
                name: { const: tool.name },
                arguments: tool.parameters,
              },
              required: ['name', 'arguments'],
              additionalProperties: false,
            })),
          }
        : false,
    };
    this.checks.set(
      JSON.stringify(this.schema),
      this.validator.compile(this.schema),
    );
  }

  sampler(): Sampler {
    return new Sampler(this);
  }
}
