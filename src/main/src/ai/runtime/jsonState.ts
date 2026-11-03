import Ajv from 'ajv';
import type { AiSchema } from '../../../../common/types/pluginApi';
import { aiError } from '../schema';

// Public schemas use the supported AiSchema subset. Unions are internal tool alternatives.
export interface Shape extends Omit<AiSchema, 'type' | 'properties' | 'items'> {
  type?: AiSchema['type'];
  properties?: Record<string, Shape>;
  items?: Shape | false;
  const?: string;
  oneOf?: Shape[];
  anyOf?: Shape[];
}
export type Schema = Shape | false;
type Frame = { schema: Shape; stage: string } & (
  | { kind: 'object'; value: Record<string, unknown>; key?: string }
  | { kind: 'array'; value: unknown[] }
);
const invalid = () =>
  aiError('AI_INVALID_OUTPUT', 'No schema-valid model continuation.');
function variants(schema: Schema): Shape[] {
  return schema === false ? [] : schema.oneOf ?? schema.anyOf ?? [schema];
}
function permits(schema: Schema, kind: string): boolean {
  return variants(schema).some(
    (s) =>
      s.type === undefined ||
      s.type === kind ||
      (kind === 'number' && s.type === 'integer'),
  );
}
const encodings = new Map<string, { bytes: Buffer; unicode: boolean }[][]>();
function stringMatches(raw: Buffer, choices: string[]): boolean {
  if (!raw.includes(92))
    return choices.some((value) =>
      Buffer.from(value).subarray(0, raw.length).equals(raw),
    );
  for (const choice of choices) {
    let forms = encodings.get(choice);
    if (!forms) {
      forms = Array.from(choice).map((char) => {
        const code = Array.from(
          { length: char.length },
          (_, i) => `\\u${char.charCodeAt(i).toString(16).padStart(4, '0')}`,
        ).join('');
        const result = [{ bytes: Buffer.from(code), unicode: true }];
        const escaped = JSON.stringify(char).slice(1, -1);
        if (escaped !== char)
          result.push({ bytes: Buffer.from(escaped), unicode: false });
        if (char === '/')
          result.push({ bytes: Buffer.from('\\/'), unicode: false });
        if ((char.codePointAt(0) ?? 0) >= 32 && char !== '"' && char !== '\\')
          result.push({ bytes: Buffer.from(char), unicode: false });
        return result;
      });
      if (encodings.size >= 512) encodings.clear();
      encodings.set(choice, forms);
    }
    let positions = new Set([0]);
    for (const alternatives of forms) {
      const following = new Set<number>();
      for (const position of positions)
        for (const form of alternatives) {
          const suffix = raw.subarray(position);
          let fragment = suffix.subarray(0, form.bytes.length);
          if (form.unicode)
            fragment = Buffer.from(fragment.toString().toLowerCase());
          if (form.bytes.subarray(0, fragment.length).equals(fragment)) {
            if (suffix.length <= form.bytes.length) return true;
            following.add(position + form.bytes.length);
          }
        }
      positions = following;
      if (!positions.size) break;
    }
    if (positions.has(raw.length)) return true;
  }
  return false;
}
export default class JsonState {
  private stack: Frame[] = [];

  private mode: 'string' | 'number' | 'literal' | undefined;

  private raw = Buffer.alloc(0);

  private escape = false;

  private unicode = 0;

  private utf8Remaining = 0;

  private utf8Min = 0x80;

  private utf8Max = 0xbf;

  private scalar: Schema = {};

  private stringKey = false;

  private space = false;

  done = false;

  value: unknown;

  private readonly schema: Schema;

  private readonly checks: Map<string, Ajv.ValidateFunction>;

  private readonly validator: Ajv.Ajv;

  constructor(
    schema: Schema,
    checks: Map<string, Ajv.ValidateFunction>,
    validator: Ajv.Ajv,
  ) {
    this.schema = schema;
    this.checks = checks;
    this.validator = validator;
  }

  clone(): JsonState {
    const next = new JsonState(this.schema, this.checks, this.validator);
    next.stack = this.stack.map(
      (frame): Frame =>
        frame.kind === 'array'
          ? { ...frame, value: structuredClone(frame.value) }
          : { ...frame, value: structuredClone(frame.value) },
    );
    next.mode = this.mode;
    next.raw = this.raw;
    next.escape = this.escape;
    next.unicode = this.unicode;
    next.utf8Remaining = this.utf8Remaining;
    next.utf8Min = this.utf8Min;
    next.utf8Max = this.utf8Max;
    next.scalar = this.scalar;
    next.stringKey = this.stringKey;
    next.space = this.space;
    next.done = this.done;
    next.value = this.value;
    return next;
  }

  private check(value: unknown, schema: Schema): void {
    let validate = this.checks.get(JSON.stringify(schema));
    if (!validate) {
      validate = this.validator.compile(schema);
      this.checks.set(JSON.stringify(schema), validate);
    }
    if (!validate(value)) throw invalid();
  }

  private static effective(frame: Frame): Shape[] {
    const options = variants(frame.schema);
    if (frame.kind === 'object' && Object.hasOwn(frame.value, 'name')) {
      const selected = options.filter(
        (s) =>
          s.properties?.name?.const === undefined ||
          s.properties.name.const === frame.value.name,
      );
      if (selected.length) return selected;
    }
    return options;
  }

  private static keys(frame: Frame): string[] | undefined {
    const options = JsonState.effective(frame);
    if (
      frame.kind !== 'object' ||
      options.some((s) => s.additionalProperties !== false)
    )
      return undefined;
    return [
      ...new Set(options.flatMap((s) => Object.keys(s.properties ?? {}))),
    ].filter((key) => !Object.hasOwn(frame.value, key));
  }

  private expected(): Schema {
    const frame = this.stack[this.stack.length - 1];
    if (!frame) return this.schema;
    const candidates = JsonState.effective(frame)
      .map((s) =>
        frame.kind === 'array'
          ? s.items ?? {}
          : s.properties?.[frame.key ?? ''] ??
            (s.additionalProperties === false ? false : {}),
      )
      .filter((s): s is Shape => s !== false);
    if (!candidates.length) throw invalid();
    return candidates.length === 1 ? candidates[0] : { anyOf: candidates };
  }

  private emit(value: unknown, schema: Schema): void {
    this.check(value, schema);
    const frame = this.stack[this.stack.length - 1];
    if (!frame) {
      this.value = value;
      this.done = true;
      return;
    }
    if (frame.kind === 'array') frame.value.push(value);
    else {
      if (frame.key === undefined) throw invalid();
      Object.defineProperty(frame.value, frame.key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    frame.stage = 'delimiter';
  }

  private close(): void {
    const frame = this.stack.pop();
    if (!frame) throw invalid();
    this.emit(frame.value, frame.schema);
  }

  private startString(key: boolean, schema: Schema = {}): void {
    this.mode = 'string';
    this.raw = Buffer.alloc(0);
    this.escape = false;
    this.unicode = 0;
    this.utf8Remaining = 0;
    this.utf8Min = 0x80;
    this.utf8Max = 0xbf;
    this.stringKey = key;
    this.scalar = schema;
  }

  feed(bytes: Buffer): void {
    for (const byte of bytes) this.byte(byte);
  }

  // Validate each byte without the ICU-dependent TextDecoder fatal option.
  private utf8Byte(byte: number): void {
    if (this.utf8Remaining) {
      if (byte < this.utf8Min || byte > this.utf8Max) throw invalid();
      this.utf8Remaining -= 1;
      this.utf8Min = 0x80;
      this.utf8Max = 0xbf;
    } else if (byte <= 0x7f) {
      return;
    } else if (byte >= 0xc2 && byte <= 0xdf) {
      this.utf8Remaining = 1;
    } else if (byte >= 0xe0 && byte <= 0xef) {
      this.utf8Remaining = 2;
      this.utf8Min = byte === 0xe0 ? 0xa0 : 0x80;
      this.utf8Max = byte === 0xed ? 0x9f : 0xbf;
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      this.utf8Remaining = 3;
      this.utf8Min = byte === 0xf0 ? 0x90 : 0x80;
      this.utf8Max = byte === 0xf4 ? 0x8f : 0xbf;
    } else throw invalid();
  }

  private byte(byte: number): void {
    if (this.mode === 'string') {
      this.space = false;
      if (byte < 32) throw invalid();
      this.utf8Byte(byte);
      if (byte === 34 && !this.escape && !this.unicode) {
        const encoded = this.raw.toString('utf8').replace(/^\uFEFF/, '');
        const value: unknown = JSON.parse(`"${encoded}"`);
        if (typeof value !== 'string') throw invalid();
        this.mode = undefined;
        if (this.stringKey) {
          const frame = this.stack[this.stack.length - 1];
          if (
            !frame ||
            frame.kind !== 'object' ||
            Object.hasOwn(frame.value, value)
          )
            throw invalid();
          frame.key = value;
          frame.stage = 'colon';
          this.expected();
        } else this.emit(value, this.scalar);
        return;
      }
      if (this.unicode) {
        if (!'0123456789abcdefABCDEF'.includes(String.fromCharCode(byte)))
          throw invalid();
        this.unicode -= 1;
      } else if (this.escape) {
        if (!'"\\/bfnrtu'.includes(String.fromCharCode(byte))) throw invalid();
        this.unicode = byte === 117 ? 4 : 0;
        this.escape = false;
      } else this.escape = byte === 92;
      this.raw = Buffer.concat([this.raw, Buffer.from([byte])]);
      if (this.stringKey) {
        const frame = this.stack[this.stack.length - 1];
        const keys = JsonState.keys(frame);
        if (keys && !stringMatches(this.raw, keys)) throw invalid();
      } else {
        const options = variants(this.scalar);
        if (options.every((s) => s.enum || s.const !== undefined)) {
          const values = options
            .flatMap((s) => s.enum ?? [s.const])
            .filter((s): s is string => typeof s === 'string');
          if (!stringMatches(this.raw, values)) throw invalid();
        }
      }
      return;
    }
    if (this.mode === 'number') {
      this.space = false;
      const integer = variants(this.scalar).every((s) => s.type === 'integer');
      if (
        (integer ? '0123456789' : '0123456789.eE+-').includes(
          String.fromCharCode(byte),
        )
      ) {
        this.raw = Buffer.concat([this.raw, Buffer.from([byte])]);
        const value = this.raw.toString();
        if (
          value !== '-' &&
          !(
            integer
              ? /^-?(?:0|[1-9][0-9]*)$/
              : /^-?(?:0|[1-9][0-9]*)(?:(?:\.[0-9]+)?(?:[eE][+-]?[0-9]*)?|\.[0-9]*)$/
          ).test(value)
        )
          throw invalid();
        return;
      }
      const value: unknown = JSON.parse(this.raw.toString());
      this.mode = undefined;
      this.emit(value, this.scalar);
      this.byte(byte);
      return;
    }
    if (this.mode === 'literal') {
      this.space = false;
      this.raw = Buffer.concat([this.raw, Buffer.from([byte])]);
      const raw = this.raw.toString();
      const targets = ['true', 'false', 'null'].filter((s) =>
        s.startsWith(raw),
      );
      if (!targets.length) throw invalid();
      if (targets.includes(raw)) {
        this.mode = undefined;
        this.emit(JSON.parse(raw), this.scalar);
      }
      return;
    }
    if ([32, 13, 10, 9].includes(byte)) {
      if (byte !== 32 || this.space) throw invalid();
      this.space = true;
      return;
    }
    this.space = false;
    if (this.done) throw invalid();
    const frame = this.stack[this.stack.length - 1];
    if (frame) {
      if (frame.stage === 'colon') {
        if (byte !== 58) throw invalid();
        frame.stage = 'value';
        return;
      }
      if (frame.stage === 'delimiter') {
        if (byte === (frame.kind === 'object' ? 125 : 93)) {
          this.close();
          return;
        }
        if (
          byte !== 44 ||
          (frame.kind === 'object' && JsonState.keys(frame)?.length === 0)
        )
          throw invalid();
        frame.stage = frame.kind === 'object' ? 'key' : 'value';
        return;
      }
      if (frame.stage === 'key' || frame.stage === 'key_or_end') {
        if (byte === 125 && frame.stage === 'key_or_end') this.close();
        else if (byte === 34 && JsonState.keys(frame)?.length !== 0)
          this.startString(true);
        else throw invalid();
        return;
      }
      if (frame.stage === 'value_or_end' && byte === 93) {
        this.close();
        return;
      }
    }
    const schema = this.expected();
    if (byte === 123 || byte === 91) {
      const kind = byte === 123 ? 'object' : 'array';
      if (!permits(schema, kind) || schema === false) throw invalid();
      if (kind === 'object')
        this.stack.push({ schema, kind, value: {}, stage: 'key_or_end' });
      else this.stack.push({ schema, kind, value: [], stage: 'value_or_end' });
    } else if (byte === 34) {
      if (!permits(schema, 'string')) throw invalid();
      this.startString(false, schema);
    } else if ('-0123456789'.includes(String.fromCharCode(byte))) {
      if (!permits(schema, 'number')) throw invalid();
      this.mode = 'number';
      this.raw = Buffer.from([byte]);
      this.scalar = schema;
    } else if ('tfn'.includes(String.fromCharCode(byte))) {
      if (!permits(schema, byte === 110 ? 'null' : 'boolean')) throw invalid();
      this.mode = 'literal';
      this.raw = Buffer.from([byte]);
      this.scalar = schema;
    } else throw invalid();
  }
}
