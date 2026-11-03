import type { InstructionSource } from './RecipeProgram';

export default class RecipeExecutionError extends Error {
  constructor(
    public readonly source: InstructionSource,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}
