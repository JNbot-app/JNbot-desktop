import { toRunnableJs } from '../../src/main/src/functions/transpile';

describe('toRunnableJs transpilation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns non-TypeScript code untouched', async () => {
    const jsCode = 'const x = 10;\nconsole.log(x);';
    expect(await toRunnableJs(jsCode, 'js' as any)).toBe(jsCode);
    expect(await toRunnableJs(jsCode, undefined)).toBe(jsCode);
    expect(await toRunnableJs('{"valid": "json"}', 'json' as any)).toBe('{"valid": "json"}');
  });

  it('returns empty or falsy code untouched', async () => {
    expect(await toRunnableJs('', 'ts')).toBe('');
    expect(await toRunnableJs(null as any, 'ts')).toBeNull();
  });

  describe('with JNBOT_MOBILE_RUNTIME=true (using bundled typescript)', () => {
    beforeEach(() => {
      process.env.JNBOT_MOBILE_RUNTIME = 'true';
    });

    it('strips TypeScript annotations and transforms into CommonJS', async () => {
      const tsCode = `
        interface User {
          name: string;
          age: number;
        }
        export const greet = (user: User): string => {
          return "Hello, " + user.name;
        };
      `;

      const result = await toRunnableJs(tsCode, 'ts');
      expect(typeof result).toBe('string');
      // Type annotations should be stripped
      expect(result).not.toContain('interface User');
      expect(result).not.toContain(': User');
      expect(result).not.toContain(': string');
      // CommonJS export should be generated
      expect(result).toContain('exports.greet');
    });

    it('rewrites ES module imports into CommonJS requires', async () => {
      const tsCode = `
        import path from 'path';
        export const getPath = () => path.join('a', 'b');
      `;

      const result = await toRunnableJs(tsCode, 'ts');
      expect(result).not.toContain("import path from 'path'");
      expect(result).toContain("require");
      expect(result).toContain("exports.getPath");
    });

    it('handles generic classes and enums', async () => {
      const tsCode = `
        enum Direction { UP, DOWN }
        class Box<T> {
          constructor(public value: T) {}
        }
        export const d = Direction.UP;
      `;

      const result = await toRunnableJs(tsCode, 'ts');
      expect(result).toContain('Direction');
      expect(result).toContain('Box');
      expect(result).not.toContain('<T>');
    });
  });
});
