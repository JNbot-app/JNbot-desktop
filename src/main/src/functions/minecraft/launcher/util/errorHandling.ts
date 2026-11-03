

import type { Dirent } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import type { MinecraftCrashInfo } from '../../../../types';

export const ensureDir = async (dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true });
};

export const safeString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

export const readFileTail = async (
  filePath: string,
  maxBytes: number,
): Promise<string> => {
  const stat = await fs.stat(filePath);
  const size = stat.size;
  const start = Math.max(0, size - maxBytes);

  const handle = await fs.open(filePath, 'r');
  try {
    const length = size - start;
    const buffer = new Uint8Array(length);
    await handle.read(buffer, 0, length, start);
    return Buffer.from(buffer).toString('utf8');
  } finally {
    await handle.close();
  }
};

export const findNewestFile = async (
  dirPath: string,
  predicate: (name: string) => boolean,
): Promise<string | null> => {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter(predicate);

  if (candidates.length === 0) return null;

  const stats = await Promise.all(
    candidates.map(async (name) => {
      const fullPath = path.join(dirPath, name);
      try {
        const stat = await fs.stat(fullPath);
        return { fullPath, mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    }),
  );

  const newest = stats
    .filter(Boolean)
    .sort((a, b) => (b!.mtimeMs ?? 0) - (a!.mtimeMs ?? 0))[0];
  
  return newest?.fullPath ?? null;
};

export const collectCrashInfo = async (params: {
  bridgeInstanceId: string;
  username: string;
  version: string;
  instancePath: string;
  code?: number | null;
  signal?: string | null;
  error?: unknown;
  stdoutTail?: string;
  stderrTail?: string;
}): Promise<MinecraftCrashInfo> => {
  const crashInfo: MinecraftCrashInfo = {
    bridgeInstanceId: params.bridgeInstanceId,
    username: params.username,
    version: params.version,
    instancePath: params.instancePath,
    code: params.code,
    signal: params.signal,
    error: params.error ? safeString(params.error) : undefined,
    stdoutTail: params.stdoutTail,
    stderrTail: params.stderrTail,
  };

  const latestLogPath = path.join(params.instancePath, 'logs', 'latest.log');
  try {
    await fs.access(latestLogPath);
    crashInfo.latestLogPath = latestLogPath;
    crashInfo.latestLogTail = await readFileTail(latestLogPath, 256 * 1024);
  } catch {}

  const crashReportsDir = path.join(params.instancePath, 'crash-reports');
  const crashReportPath = await findNewestFile(crashReportsDir, (name) =>
    name.toLowerCase().endsWith('.txt'),
  );
  if (crashReportPath) {
    crashInfo.crashReportPath = crashReportPath;
    try {
      crashInfo.crashReportTail = await readFileTail(
        crashReportPath,
        256 * 1024,
      );
    } catch {}
  }

  const hsErrPath = await findNewestFile(
    params.instancePath,
    (name) =>
      name.toLowerCase().startsWith('hs_err_pid') &&
      name.toLowerCase().endsWith('.log'),
  );
  if (hsErrPath) {
    crashInfo.hsErrPath = hsErrPath;
    try {
      crashInfo.hsErrTail = await readFileTail(hsErrPath, 256 * 1024);
    } catch {}
  }

  return crashInfo;
};
