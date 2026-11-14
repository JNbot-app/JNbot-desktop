import fs from 'fs';
import { createHash } from 'crypto';
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
    if (
      section.offset % 64 ||
      section.offset < end ||
      section.length > offset - section.offset ||
      (name === 'needle' && section.format !== 'cact')
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
/** Reads the decoder section's bounds and tokenizer. The native engine maps the weights. */
export function loadModel(file: string) {
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
    return {
      decoder,
      tokenizer,
      context: header.readUInt32LE(13 * 4),
      vocab: header.readUInt32LE(6 * 4) || header.readUInt32LE(5 * 4),
    };
  } finally {
    fs.closeSync(fd);
  }
}
