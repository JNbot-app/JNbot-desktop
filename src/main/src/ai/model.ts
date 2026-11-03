import fs from 'fs/promises';
import path from 'path';
import https from 'https';
import { createHash, randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { aiError } from './schema';
import descriptor from '../../../../native/needle/model.json';

export type AiModelVariant = 'main' | 'flash';
export interface AiModel {
  id: string;
  cacheId: string;
  variant: AiModelVariant;
  url: string;
  sha256?: string;
  builtIn: boolean;
}

export function resolveModel(
  modelUrl?: unknown,
  variant: unknown = 'main',
): AiModel {
  if (variant !== 'main' && variant !== 'flash')
    throw aiError('AI_INVALID_INPUT', 'model must be main or flash.');
  if (modelUrl !== undefined && typeof modelUrl !== 'string')
    throw aiError('AI_INVALID_INPUT', 'modelUrl must be an HTTPS URL.');
  const configured =
    variant === 'main'
      ? descriptor.mainUrl
      : descriptor.flashUrl || descriptor.mainUrl;
  const sha256 =
    (variant === 'main'
      ? descriptor.mainSha256
      : descriptor.flashSha256 || descriptor.mainSha256) || undefined;
  const supplied = typeof modelUrl === 'string' ? modelUrl.trim() : '';
  if (!supplied || supplied === configured) {
    return {
      id: `${descriptor.id}-${variant}`,
      cacheId: `${descriptor.id}-${variant}`,
      variant,
      url: configured,
      sha256,
      builtIn: true,
    };
  }
  let url: URL;
  try {
    url = new URL(supplied);
  } catch {
    throw aiError('AI_INVALID_INPUT', 'modelUrl must be an HTTPS URL.');
  }
  if (url.protocol !== 'https:')
    throw aiError('AI_INVALID_INPUT', 'modelUrl must be an HTTPS URL.');
  url.hash = '';
  if (configured && url.href === configured)
    return resolveModel(undefined, variant);
  const key = createHash('sha256')
    .update(`${descriptor.engineRevision}\n${url.href}`)
    .digest('hex');
  return {
    id: `jnbot-custom-${key}-${variant}`,
    cacheId: `jnbot-custom-${key}`,
    variant,
    url: url.href,
    builtIn: false,
  };
}

export const defaultModel = resolveModel();

function download(
  url: string,
  destination: string,
  modelId: string,
  signal?: AbortSignal,
  redirects = 0,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://') || redirects > 5) {
      reject(aiError('AI_DOWNLOAD', 'Invalid model download redirect.'));
      return;
    }
    const request = https.get(url, { signal }, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        try {
          download(
            new URL(response.headers.location, url).href,
            destination,
            modelId,
            signal,
            redirects + 1,
          )
            .then(resolve)
            .catch(reject);
        } catch (error) {
          reject(error);
        }
      } else if (response.statusCode !== 200) {
        response.resume();
        reject(
          aiError(
            'AI_DOWNLOAD',
            `Model download returned HTTP ${response.statusCode}.`,
          ),
        );
      } else {
        const hash = createHash('sha256');
        const totalBytes = Number(response.headers['content-length']) || null;
        let receivedBytes = 0;
        let lastLog = Date.now();
        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          hash.update(chunk);
          if (Date.now() - lastLog < 5_000) return;
          lastLog = Date.now();
          console.info('[AI] Model download progress', {
            modelId,
            receivedBytes,
            totalBytes,
          });
        });
        pipeline(response, createWriteStream(destination, { flags: 'wx' }), {
          signal,
        })
          .then(() => resolve(hash.digest('hex')))
          .catch(reject);
      }
    });
    request.setTimeout(120_000, () =>
      request.destroy(aiError('AI_DOWNLOAD', 'Model download stalled.')),
    );
    request.on('error', reject);
  });
}

export async function modelFile(
  directory: string,
  signal?: AbortSignal,
  model: AiModel = defaultModel,
): Promise<string> {
  signal?.throwIfAborted();
  const destination = path.join(directory, model.cacheId, 'model.cact');
  const candidates = [{ file: destination, sha256: model.sha256 }];
  if (model.builtIn && model.variant === 'flash')
    candidates.push({
      file: path.join(directory, `${descriptor.id}-main`, 'model.cact'),
      sha256: descriptor.mainSha256 || undefined,
    });
  for (const { file, sha256 } of candidates) {
    try {
      await fs.access(file);
      // The digest recorded at download time marks files replaced by a newer release.
      if (
        !sha256 ||
        (await fs.readFile(`${file}.sha256`, 'utf8').catch(() => '')) === sha256
      )
        return file;
    } catch {
      /* Not installed. */
    }
  }
  if (!model.url)
    throw aiError(
      'AI_MODEL',
      'The model download URL has not been configured for this release.',
    );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const started = Date.now();
  console.info('[AI] Downloading model', { modelId: model.id });
  try {
    const digest = await download(model.url, temporary, model.id, signal);
    signal?.throwIfAborted();
    if (model.sha256 && digest !== model.sha256)
      throw new Error('Downloaded model failed its checksum.');
    // Replacing in place keeps a single installed version.
    await fs.rename(temporary, destination);
    if (model.sha256) await fs.writeFile(`${destination}.sha256`, digest);
    console.info('[AI] Model download complete', {
      modelId: model.id,
      elapsedMs: Date.now() - started,
    });
    return destination;
  } catch (error) {
    console.warn('[AI] Model download failed', {
      modelId: model.id,
      cancelled: signal?.aborted ?? false,
    });
    signal?.throwIfAborted();
    throw aiError(
      'AI_DOWNLOAD',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
