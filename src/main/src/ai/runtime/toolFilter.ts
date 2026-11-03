import { types } from 'util';
import type { ToolDefinition } from '../protocol';
import { aiError } from '../schema';
import type { NativeBinding } from './engine';

export function pooled(value: unknown): Float32Array {
  if (
    !types.isFloat32Array(value) ||
    value.length !== 768 ||
    !value.every(Number.isFinite)
  )
    throw aiError('AI_INVALID_OUTPUT', 'Invalid embedding response.');
  return value;
}

/** Worker-local, lazy document index. No token features are retained for tools. */
export default class ToolFilter {
  private vectors = new Map<string, Float32Array>();

  private matrix?: Float32Array;

  private scores = new Float32Array(0);

  private texts: string[] = [];

  private tools: ToolDefinition[] = [];

  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
    const texts = tools.map(
      (tool) => `${tool.name.replace(/_/g, ' ')}\n${tool.description}`,
    );
    if (
      texts.length === this.texts.length &&
      texts.every((text, i) => text === this.texts[i])
    )
      return;
    const current = new Set(texts);
    for (const text of this.vectors.keys())
      if (!current.has(text)) this.vectors.delete(text);
    this.texts = texts;
    this.matrix = undefined;
  }

  prepare(binding: NativeBinding): void {
    if (this.matrix) return;
    const matrix = new Float32Array(this.texts.length * 768);
    this.texts.forEach((text, index) => {
      let vector = this.vectors.get(text);
      if (!vector) {
        vector = pooled(
          binding.invoke('encode', `title: none | text: ${text}`, false),
        );
        this.vectors.set(text, vector);
      }
      matrix.set(vector, index * 768);
    });
    // Cache views of the matrix, avoiding a second copy of every vector.
    this.texts.forEach((text, i) =>
      this.vectors.set(text, matrix.subarray(i * 768, (i + 1) * 768)),
    );
    this.matrix = matrix;
    this.scores = new Float32Array(this.tools.length);
  }

  select(
    query: Float32Array,
    threshold: number,
    binding: NativeBinding,
  ): ToolDefinition[] {
    const { matrix } = this;
    if (!matrix)
      throw aiError('AI_ENGINE', 'Tool embeddings are not prepared.');
    binding.invoke('similarity', matrix, query, this.scores);
    const selected: ToolDefinition[] = [];
    for (let i = 0; i < this.tools.length; i += 1) {
      if (this.scores[i] >= threshold) selected.push(this.tools[i]);
    }
    return selected;
  }
}
