import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
// eslint-disable-next-line import/extensions
import { loadModel } from '../src/main/src/ai/runtime/model';

async function exportFlash(): Promise<void> {
  const [source, destination] = process.argv.slice(2);
  if (
    !source ||
    !destination ||
    path.resolve(source) === path.resolve(destination)
  )
    throw new Error(
      'Usage: npm run export:flash -- source.cact destination.cact',
    );
  const { decoder } = loadModel(source, 'flash');
  await fs.promises.mkdir(path.dirname(path.resolve(destination)), {
    recursive: true,
  });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await pipeline(
      fs.createReadStream(source, {
        start: decoder.offset,
        end: decoder.offset + decoder.length - 1,
      }),
      fs.createWriteStream(temporary, { flags: 'wx' }),
    );
    await fs.promises.link(temporary, destination);
    process.stdout.write(`Exported flash model: ${destination}\n`);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
}
exportFlash().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
