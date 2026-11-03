import EventEmitter from 'node:events';
import type { CliSeverity, OutputEvent } from './types';
import type { ConsoleLogEntry } from '../../common/mobileClientContract';
import { logText } from '../../common/logText';
import snapshotLog, { logLine } from '../../main/src/workers/compiler/serializer';

const MAX_EVENTS = 500;

export class OutputRouter extends EventEmitter {
  private readonly events: OutputEvent[] = [];
  private restoreConsole?: () => void;

  install(): void {
    if (this.restoreConsole) return;
    const original = {
      debug: console.debug,
      info: console.info,
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    const redirect = (severity: CliSeverity, source: string, values: unknown[]) => {
      const message = logLine(snapshotLog(values));
      if (message.startsWith('Total account worth:')) return;
      const first = values.find((value) => value instanceof Error);
      this.push({
        timestamp: Date.now(),
        severity,
        source,
        message,
        ...(first instanceof Error && first.stack
          ? { stack: logLine(snapshotLog([first.stack])) }
          : {}),
      });
    };
    console.debug = (...values: unknown[]) => redirect('debug', 'console', values);
    console.info = (...values: unknown[]) => redirect('info', 'console', values);
    console.log = (...values: unknown[]) => redirect('info', 'console', values);
    console.warn = (...values: unknown[]) => redirect('warn', 'console', values);
    console.error = (...values: unknown[]) => redirect('error', 'console', values);
    this.restoreConsole = () => Object.assign(console, original);
  }

  restore(): void {
    this.restoreConsole?.();
    this.restoreConsole = undefined;
  }

  push(event: OutputEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.emit('event', event);
  }

  pushScriptLog(log: ConsoleLogEntry): void {
    const [message, status, scriptName, scriptId, timestamp] = log;
    const severity = (['info', 'warn', 'error', 'success'][status] ?? 'info') as CliSeverity;
    this.push({
      timestamp,
      severity,
      source: scriptName ? `script:${scriptName}` : `script:${scriptId}`,
      message: logText(message),
    });
  }

  list(): readonly OutputEvent[] {
    return this.events;
  }
}

export function redact(value: unknown): string {
  return String(value)
    .replace(/((?:[?&]|\b)(?:token|shareKey|password)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]');
}
