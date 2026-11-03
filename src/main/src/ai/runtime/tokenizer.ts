import { isUtf8 } from 'buffer';
import { aiError } from '../schema';

import MergeHeap from './mergeHeap';

export default class Tokenizer {
  readonly pieces: string[] = [];

  readonly types: number[] = [];

  readonly scores: number[] = [];

  readonly ids = new Map<string, number>();

  readonly bytes: Buffer[] = [];

  readonly bos: number;

  readonly eos: number;

  private readonly unknown: number;

  private readonly dummy: boolean;

  private readonly fallback: boolean;

  private readonly byteIds = new Map<number, number>();

  private readonly markers: RegExp | undefined;

  constructor(blob: Buffer) {
    const invalid = () => aiError('AI_MODEL', 'Invalid model tokenizer.');
    if (blob.length < 24) throw invalid();
    const count = blob.readUInt32LE(0);
    this.eos = blob.readUInt32LE(8);
    this.bos = blob.readUInt32LE(12);
    this.unknown = blob.readUInt32LE(16);
    this.dummy = blob[20] === 1;
    this.fallback = blob[21] === 1;
    if (
      !count ||
      count > 100000 ||
      Math.max(blob.readUInt32LE(4), this.eos, this.bos, this.unknown) >=
        count ||
      blob[20] > 1 ||
      blob[21] > 1
    )
      throw invalid();
    let at = 24;
    const markers: string[] = [];
    for (let i = 0; i < count; i += 1) {
      if (at + 7 > blob.length) throw invalid();
      const score = blob.readFloatLE(at);
      const kind = blob[at + 4];
      const size = blob.readUInt16LE(at + 5);
      at += 7;
      if (
        !Number.isFinite(score) ||
        kind > 4 ||
        !size ||
        at + size > blob.length
      )
        throw invalid();
      const encoded = blob.subarray(at, at + size);
      if (!isUtf8(encoded)) throw invalid();
      const piece = encoded.toString('utf8').replace(/^\uFEFF/, '');
      at += size;
      if (this.ids.has(piece)) throw invalid();
      this.pieces.push(piece);
      this.scores.push(score);
      this.types.push(kind);
      this.ids.set(piece, i);
      if (kind === 4) {
        if (!/^<0x[0-9A-Fa-f]{2}>$/.test(piece)) throw invalid();
        const byte = parseInt(piece.slice(3, 5), 16);
        this.byteIds.set(byte, i);
        this.bytes.push(Buffer.from([byte]));
      } else this.bytes.push(Buffer.from(piece.replaceAll('▁', ' ')));
      if (kind === 3) markers.push(piece);
    }
    if (at !== blob.length || (this.fallback && this.byteIds.size !== 256))
      throw invalid();
    if (markers.length)
      this.markers = new RegExp(
        markers
          .sort((a, b) => Array.from(b).length - Array.from(a).length)
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|'),
        'gu',
      );
  }

  id(piece: string): number {
    const id = this.ids.get(piece);
    if (id === undefined)
      throw aiError('AI_MODEL', 'Missing model control token.');
    return id;
  }

  private bpe(segment: string): number[] {
    const symbols = Array.from(segment);
    const size = symbols.length;
    const previous = symbols.map((_, i) => i - 1);
    const next = symbols.map((_, i) => (i + 1 < size ? i + 1 : -1));
    const versions = new Uint32Array(size);
    const heap = new MergeHeap();
    const offer = (left: number) => {
      if (left < 0 || !symbols[left]) return;
      const right = next[left];
      if (right < 0) return;
      const token = this.ids.get(symbols[left] + symbols[right]);
      if (token !== undefined)
        heap.push({
          score: this.scores[token],
          left,
          right,
          a: versions[left],
          b: versions[right],
        });
    };
    for (let i = 0; i < size; i += 1) offer(i);
    for (let pair = heap.pop(); pair; pair = heap.pop()) {
      const { left, right, a, b } = pair;
      if (
        !symbols[left] ||
        !symbols[right] ||
        next[left] !== right ||
        versions[left] !== a ||
        versions[right] !== b
      )
        // eslint-disable-next-line no-continue
        continue;
      symbols[left] += symbols[right];
      symbols[right] = '';
      versions[left] += 1;
      versions[right] += 1;
      next[left] = next[right];
      if (next[right] >= 0) previous[next[right]] = left;
      offer(previous[left]);
      offer(left);
    }
    const tokens: number[] = [];
    for (const piece of symbols) {
      // eslint-disable-next-line no-continue
      if (!piece) continue;
      const id = this.ids.get(piece);
      if (id !== undefined) tokens.push(id);
      else if (this.fallback)
        for (const byte of Buffer.from(piece)) {
          const token = this.byteIds.get(byte);
          if (token === undefined)
            throw aiError('AI_MODEL', 'Missing tokenizer byte.');
          tokens.push(token);
        }
      else tokens.push(this.unknown);
    }
    return tokens;
  }

  encode(text: string, dummy = this.dummy): number[] {
    if (!text) return [];
    const escaped = (dummy ? '▁' : '') + text.replaceAll(' ', '▁');
    const tokens: number[] = [];
    let position = 0;
    if (this.markers)
      for (const match of escaped.matchAll(this.markers)) {
        const start = match.index;
        tokens.push(
          ...this.bpe(escaped.slice(position, start)),
          this.id(match[0]),
        );
        position = start + match[0].length;
      }
    tokens.push(...this.bpe(escaped.slice(position)));
    return tokens;
  }

  preparePrefix(text: string): {
    tokens: number[];
    append: (suffix: string) => number[];
  } {
    // BPE merges cannot cross a user-defined control token. Cache through the
    // final control token and re-encode only its trailing segment with the query.
    let boundary = 0;
    if (this.markers)
      for (const match of text.replaceAll(' ', '▁').matchAll(this.markers))
        boundary = match.index + match[0].length;
    const tokens = boundary ? this.encode(text.slice(0, boundary)) : [];
    const tail = text.slice(boundary);
    return {
      tokens,
      append: (suffix) =>
        this.encode(tail + suffix, boundary ? false : this.dummy),
    };
  }

  decode(tokens: number[]): string {
    const chunks: Buffer[] = [];
    for (const id of tokens) {
      if (!Number.isInteger(id) || id < 0 || id >= this.pieces.length)
        throw aiError('AI_INVALID_OUTPUT', 'Invalid model token.');
      if (this.types[id] !== 1 && this.types[id] !== 2)
        chunks.push(this.bytes[id]);
    }
    const result = Buffer.concat(chunks).toString('utf8');
    return this.dummy && result.startsWith(' ') ? result.slice(1) : result;
  }
}
