import fs from 'fs';
import { createHash } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { z } from 'zod';
import { aiError } from '../schema';

const positive = z.number().int().positive().safe();
const sectionSchema = z.object({
  offset: z.number().int().nonnegative().safe(),
  length: positive,
  format: z.enum(['cact', 'gguf', 'safetensors']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Section = z.infer<typeof sectionSchema>;
const indexSchema = z.object({
  format: z.literal('needle-model-bundle'),
  version: z.literal(1),
  manifest: z.record(z.string(), z.unknown()),
  sections: z.record(z.string(), sectionSchema),
});
const tensorSchema = z.object({
  dtype: z.literal('F32'),
  shape: z.array(positive),
  data_offsets: z.tuple([z.number().int().nonnegative().safe(), positive]),
});
const manifestSchema = z
  .object({
    format: z.literal('needle-representation-fusion'),
    version: z.literal(1),
    architecture_id: z.enum([
      'needle-representation-fusion-v3',
      'needle-representation-fusion-v4',
    ]),
    source_policy: z.object({
      policy: z.literal('query-only'),
      prompt_name: z.literal('SearchQuery'),
      revision: z.literal('42b021b4dc42be573f1e1463528532fc8294c650'),
    }),
    precision: z.object({
      needle: z.literal('CQ4'),
      activations: z.literal('A8'),
      text_kv: z.literal('KV8'),
      adapter: z.literal('FP32'),
      memory: z.literal('FP32'),
    }),
    math: z.object({
      projection_orientation: z.literal('input_output'),
      normalization_epsilon: z.literal(1e-6),
      position_rule: z.literal('sin_cos_interleaved_10000'),
      key_normalization: z.literal('per_site_zcrmsnorm'),
      accumulation: z.literal('fp32_pairwise_block8'),
      positions: z.literal('rounded_fp32_constants'),
    }),
    archive: z.object({
      group: z.literal(128),
      bits: z.literal(4),
      window: positive,
      codebook_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    tensor_order: z.array(z.string()),
    tensor_shapes: z.record(z.string(), z.array(positive)),
    assets: z.record(
      z.string(),
      z.object({ section: z.string(), sha256: z.string() }),
    ),
    run: z
      .object({
        architecture_id: z.string(),
        arm: z.literal('fusion'),
        source: z
          .object({
            context: positive.max(8192),
            revision: z.string(),
            model_sha256: z.string(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export function read(file: number, offset: number, length: number): Buffer {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0
  )
    throw aiError('AI_MODEL', 'Invalid model section.');
  const buffer = Buffer.alloc(length);
  let count = 0;
  while (count < length) {
    const size = fs.readSync(
      file,
      buffer,
      count,
      length - count,
      offset + count,
    );
    if (!size) throw aiError('AI_MODEL', 'Truncated model section.');
    count += size;
  }
  return buffer;
}
export function uint64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw aiError('AI_MODEL', 'Model offset exceeds supported bounds.');
  return Number(value);
}
function digest(file: number, section: Section): string {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(Math.min(section.length, 1024 * 1024));
  for (let start = 0; start < section.length; ) {
    const count = fs.readSync(
      file,
      buffer,
      0,
      Math.min(buffer.length, section.length - start),
      section.offset + start,
    );
    if (!count) throw aiError('AI_MODEL', 'Truncated model payload.');
    hash.update(buffer.subarray(0, count));
    start += count;
  }
  return hash.digest('hex');
}
export function bundle(file: number): {
  sections: Record<string, Section>;
  manifest?: Record<string, unknown>;
} {
  const { size } = fs.fstatSync(file);
  if (size < 196) throw aiError('AI_MODEL', 'Invalid model file.');
  const footer = read(file, size - 64, 64);
  if (footer.subarray(0, 8).toString() !== 'NDLBNDL1')
    return {
      sections: {
        needle: { offset: 0, length: size, format: 'cact', sha256: '' },
      },
    };
  const offset = uint64(footer, 16);
  const length = uint64(footer, 24);
  if (
    footer.readUInt32LE(8) !== 1 ||
    footer.readUInt32LE(12) !== 0 ||
    length < 1 ||
    length > 64 * 1024 * 1024 ||
    offset + length !== size - 64
  )
    throw aiError('AI_MODEL', 'Invalid model bundle index.');
  const bytes = read(file, offset, length);
  if (!createHash('sha256').update(bytes).digest().equals(footer.subarray(32)))
    throw aiError(
      'AI_MODEL',
      'Model bundle index differs from its fingerprint.',
    );
  const index = indexSchema.parse(JSON.parse(bytes.toString('utf8')));
  let end = 0;
  for (const [name, section] of Object.entries(index.sections).sort(
    (a, b) => a[1].offset - b[1].offset,
  )) {
    let format = 'safetensors';
    if (name === 'needle' || name === 'base') format = 'cact';
    else if (name === 'gemma') format = 'gguf';
    if (
      section.offset % 64 ||
      section.offset < end ||
      section.length > offset - section.offset ||
      section.format !== format
    )
      throw aiError(
        'AI_MODEL',
        'Invalid model bundle section bounds or format.',
      );
    end = section.offset + section.length;
  }
  if (index.sections.needle?.offset !== 0)
    throw aiError('AI_MODEL', 'Missing deployed model section.');
  return index;
}
const baseShapes: Record<string, number[]> = {
  'representation/token_projection/kernel': [512, 128],
  'representation/global_projection/kernel': [768, 128],
  'representation/token_norm/scale': [128],
  'representation/token_norm/bias': [128],
  'representation/global_norm/scale': [128],
  'representation/global_norm/bias': [128],
  'representation/global_type': [128],
  'representation/memory_k/kernel': [3, 128, 96],
  'representation/memory_v/kernel': [3, 128, 128],
  'representation/memory_gate': [3, 12],
};
export function loadModel(file: string, variant: 'main' | 'flash') {
  const fd = fs.openSync(file, 'r');
  try {
    const model = bundle(fd);
    const decoder = model.sections.needle;
    const header = read(fd, decoder.offset, 196);
    if (header.readUInt32LE(0) !== 0x05e12a84)
      throw aiError('AI_MODEL', 'Unsupported model archive.');
    const records = header.readUInt32LE(4);
    const codebook = header.readUInt32LE(8);
    if (
      !records ||
      records > 100000 ||
      codebook !== 28 ||
      308 + records * 44 > decoder.length
    )
      throw aiError('AI_MODEL', 'Invalid model tensor directory.');
    const directory = read(fd, decoder.offset + 308, records * 44);
    let tokenizer: Buffer | undefined;
    let end = 308 + records * 44;
    for (let i = 0; i < records; i += 1) {
      const record = directory.subarray(i * 44, (i + 1) * 44);
      const start = uint64(record, 20);
      const count = uint64(record, 28);
      if (
        start % 64 ||
        start < end ||
        count < 1 ||
        count > decoder.length - start
      )
        throw aiError('AI_MODEL', 'Invalid model tensor bounds.');
      end = start + count;
      if (record[0] === 4) {
        if (tokenizer || count > 16 * 1024 * 1024)
          throw aiError('AI_MODEL', 'Invalid model tokenizer.');
        tokenizer = read(fd, decoder.offset + start, count);
      }
    }
    if (!tokenizer) throw aiError('AI_MODEL', 'Missing model tokenizer.');
    if (decoder.sha256 && digest(fd, decoder) !== decoder.sha256)
      throw aiError('AI_MODEL', 'Model payload fingerprint differs.');
    const result = {
      decoder,
      tokenizer,
      context: header.readUInt32LE(13 * 4),
      vocab: header.readUInt32LE(6 * 4) || header.readUInt32LE(5 * 4),
    };
    if (variant === 'flash') return { ...result, variant };
    if (
      !model.manifest ||
      !model.sections.gemma ||
      !model.sections.representation
    )
      throw aiError(
        'AI_UNSUPPORTED_FEATURE',
        'This model file does not support the main variant. Select flash or use a full model file.',
      );
    const manifest = manifestSchema.parse(model.manifest);
    if (
      header.readUInt32LE(4 * 4) !== 8 ||
      header.readUInt32LE(3 * 4) !== manifest.archive.window ||
      createHash('sha256')
        .update(read(fd, decoder.offset + 196, 112))
        .digest('hex') !== manifest.archive.codebook_sha256
    )
      throw aiError('AI_MODEL', 'Model quantization contract differs.');
    for (let i = 0; i < records; i += 1)
      if (
        directory[i * 44] === 3 &&
        (directory.readUInt32LE(i * 44 + 36) !== 128 ||
          directory.readUInt32LE(i * 44 + 40) !== 4)
      )
        throw aiError('AI_MODEL', 'Unsupported model quantization.');
    const shapes = { ...baseShapes };
    if (manifest.architecture_id === 'needle-representation-fusion-v4')
      Object.assign(shapes, {
        'representation/memory_gate': [3, 4],
        'representation/reader_q/kernel': [3, 768, 192],
        'representation/reader_q_norm/scale': [3, 48],
        'representation/reader_out/kernel': [3, 256, 768],
      });
    if (
      !isDeepStrictEqual(manifest.tensor_order, Object.keys(shapes)) ||
      !isDeepStrictEqual(manifest.tensor_shapes, shapes)
    )
      throw aiError('AI_MODEL', 'Unsupported model representation geometry.');
    for (const name of ['needle', 'representation', 'gemma']) {
      const section = model.sections[name];
      const asset = manifest.assets[name];
      if (
        !asset ||
        asset.section !== name ||
        asset.sha256 !== section.sha256 ||
        (name !== 'needle' && digest(fd, section) !== section.sha256)
      )
        throw aiError('AI_MODEL', 'Model section fingerprint differs.');
    }
    if (
      manifest.run.architecture_id !== manifest.architecture_id ||
      manifest.run.source.revision !== manifest.source_policy.revision ||
      manifest.run.source.model_sha256 !== model.sections.gemma.sha256
    )
      throw aiError('AI_MODEL', 'Model source contract differs.');
    const adapter = model.sections.representation;
    const bytes = uint64(read(fd, adapter.offset, 8), 0);
    if (bytes > 16 * 1024 * 1024 || bytes + 8 > adapter.length)
      throw aiError('AI_MODEL', 'Invalid adapter header.');
    const tensors = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(read(fd, adapter.offset + 8, bytes).toString()));
    const { __metadata__: metadataValue } = tensors;
    const metadata = z.record(z.string(), z.string()).parse(metadataValue);
    if (
      metadata.format_version !== '1' ||
      !isDeepStrictEqual(JSON.parse(metadata.config), {
        architecture_id: manifest.architecture_id,
      }) ||
      !isDeepStrictEqual(JSON.parse(metadata.run), manifest.run)
    )
      throw aiError('AI_MODEL', 'Model adapter pairing differs.');
    const weights = new Float32Array(
      Object.values(shapes).reduce(
        (total, shape) => total + shape.reduce((n, d) => n * d, 1),
        0,
      ),
    );
    let at = 0;
    const ranges: [number, number][] = [];
    for (const [name, shape] of Object.entries(shapes)) {
      const tensor = tensorSchema.parse(tensors[name]);
      const [start, endOffset] = tensor.data_offsets;
      const length = shape.reduce((n, d) => n * d, 1);
      if (
        !isDeepStrictEqual(tensor.shape, shape) ||
        endOffset - start !== length * 4 ||
        endOffset > adapter.length - bytes - 8 ||
        ranges.some(([a, b]) => start < b && endOffset > a)
      )
        throw aiError('AI_MODEL', 'Invalid adapter tensor.');
      ranges.push([start, endOffset]);
      const values = read(fd, adapter.offset + 8 + bytes + start, length * 4);
      for (let i = 0; i < length; i += 1) {
        weights[at] = values.readFloatLE(i * 4);
        at += 1;
      }
    }
    if (!weights.every(Number.isFinite))
      throw aiError('AI_MODEL', 'Invalid model adapter values.');
    return {
      ...result,
      variant,
      weights,
      encoder: model.sections.gemma,
      encoderContext: manifest.run.source.context,
    };
  } finally {
    fs.closeSync(fd);
  }
}
