import { parentPort, workerData } from 'worker_threads';
import path from 'path';
import { createRequire } from 'module';
import { z } from 'zod';
import type { AiSchema } from '../../../../common/types/pluginApi';
import { aiError, compileSchema, errorInfo } from '../schema';
import InferenceRuntime, { nativeBinding } from './engine';

const data = z
  .object({ directory: z.string(), linked: z.boolean() })
  .parse(workerData);
const parameters = z.custom<AiSchema>((value) => {
  try {
    compileSchema(value);
    return true;
  } catch {
    return false;
  }
});
const request = z.discriminatedUnion('kind', [
  z.object({
    id: z.number().int(),
    kind: z.literal('load'),
    file: z.string(),
  }),
  z.object({
    id: z.number().int(),
    kind: z.literal('init'),
    tools: z.array(
      z.object({ name: z.string(), description: z.string(), parameters }),
    ),
    extraction: z.boolean(),
  }),
  z.object({
    id: z.number().int(),
    kind: z.literal('complete'),
    text: z.string(),
    maxNewTokens: z.number().int().positive(),
    reasoning: z.boolean().default(false),
    windowSize: z.number().int().positive(),
  }),
  z.object({ id: z.number().int(), kind: z.enum(['reset', 'close']) }),
]);
let runtime: InferenceRuntime | undefined;
try {
  const linked: unknown = Reflect.get(process, '_linkedBinding');
  // The packaged addon path is fixed; models only supply data.
  const requireNative = createRequire(path.join(data.directory, 'runtime.cjs'));
  const module: unknown =
    data.linked && typeof linked === 'function'
      ? linked('jnbot_needle')
      : requireNative(
          path.join(
            data.directory,
            `${process.platform}-${process.arch}`,
            'needle.node',
          ),
        );
  const binding = nativeBinding(module);
  parentPort?.postMessage({ id: 0, ok: true });
  parentPort?.on('message', (input: unknown) => {
    const parsed = request.safeParse(input);
    if (!parsed.success) return;
    const operation = parsed.data;
    try {
      let value: unknown;
      if (operation.kind === 'load') {
        runtime?.close();
        runtime = undefined;
        runtime = new InferenceRuntime(binding, operation.file);
      } else {
        if (!runtime) throw aiError('AI_MODEL', 'Model is not loaded.');
        switch (operation.kind) {
          case 'init':
            runtime.init(operation.tools, operation.extraction);
            break;
          case 'complete':
            value = runtime.complete(
              operation.text,
              operation.maxNewTokens,
              operation.reasoning,
              operation.windowSize,
            );
            break;
          case 'reset':
            runtime.reset();
            break;
          case 'close':
            runtime.close();
            runtime = undefined;
            break;
          default: {
            const exhaustive: never = operation;
            throw exhaustive;
          }
        }
      }
      parentPort?.postMessage({ id: operation.id, ok: true, value });
    } catch (error) {
      const info = errorInfo(error);
      if (
        operation.kind === 'load' &&
        !['AI_MODEL', 'AI_UNSUPPORTED_FEATURE'].includes(info.code)
      )
        info.message = 'Invalid model file or unsupported model format.';
      parentPort?.postMessage({
        id: operation.id,
        ok: false,
        code:
          operation.kind === 'load' && info.code !== 'AI_UNSUPPORTED_FEATURE'
            ? 'AI_MODEL'
            : info.code,
        error: info.message,
      });
    }
  });
} catch (error) {
  parentPort?.postMessage({
    id: 0,
    ok: false,
    code: 'AI_UNSUPPORTED_PLATFORM',
    error: errorInfo(error).message,
  });
}
