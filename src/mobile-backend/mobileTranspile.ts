import type { MacroLanguage } from '../main/src/types';

/** Mobile intentionally does not ship the TypeScript compiler. */
export async function toRunnableJs(code: string, language: MacroLanguage | undefined): Promise<string> {
  if (language !== 'ts' || !code) return code;
  throw new Error('TypeScript compilation is not supported in the mobile build. Please use the web or desktop build for TypeScript support.');
}

export default toRunnableJs;
