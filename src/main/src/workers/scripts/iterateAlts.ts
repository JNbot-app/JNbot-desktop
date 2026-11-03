import type { IterateAltsOptions } from 'common/types/pluginApi';
import type { AltWithData } from 'main/src/types';
import type { Bot } from '../workerTypes';
import BotSession from '../bot/BotSession';
import filterAlts from '../bot/utils/filterAlts';
import workerScript from '../lib/workerScript';
import { ScriptControl } from '../../../../common/CommonEnums';

export type IterateDirective = 'next' | 'previous' | 'retry';

type SessionControls = Pick<BotSession, 'pause' | 'resume' | 'close'>;
type Step<T> = { value: T };

const RUNNING = ScriptControl.PAUSE | ScriptControl.SKIP;

class AltCursor {
  private index = 0;
  private paused = false;
  private transitioning = false;
  private move: 'next' | 'previous' | null = null;
  private current: SessionControls | null = null;
  private waiters: Array<() => void> = [];
  private readonly disabled: boolean;
  private readonly unsubscribe: () => void;

  constructor(disabled: boolean) {
    this.disabled = disabled;
    this.unsubscribe = workerScript.onControl((control) =>
      this.handle(control),
    );
  }

  setIndex(index: number): void {
    this.index = index;
    this.render();
  }

  activate(current: SessionControls | null): boolean {
    if (this.move) {
      current?.close();
      return false;
    }
    this.current = current;
    this.transitioning = false;
    this.render();
    return true;
  }

  closeCurrent(): void {
    const current = this.current;
    this.current = null;
    current?.close();
  }

  transition(): void {
    this.transitioning = true;
    this.render();
  }

  async wait(): Promise<void> {
    if (!this.paused) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  take(fallback?: IterateDirective): IterateDirective {
    const move = this.move;
    this.move = null;
    if (move) return move;
    return fallback ?? 'next';
  }

  dispose(): void {
    this.unsubscribe();
    this.closeCurrent();
    this.release();
    workerScript.setControls(ScriptControl.NONE);
  }

  private handle(control: number): void {
    if (control === ScriptControl.RESUME) {
      if (!this.paused) return;
      this.paused = false;
      this.current?.resume();
      this.release();
      this.render();
      return;
    }

    if (this.transitioning) return;
    if (control === ScriptControl.PAUSE) {
      this.paused = true;
      this.current?.pause();
      this.render();
      return;
    }

    if (control === ScriptControl.PREVIOUS && this.index === 0) return;
    if (control !== ScriptControl.SKIP && control !== ScriptControl.PREVIOUS) {
      return;
    }

    this.move = control === ScriptControl.PREVIOUS ? 'previous' : 'next';
    this.paused = false;
    this.transition();
    this.closeCurrent();
    this.release();
  }

  private render(): void {
    if (this.disabled) {
      workerScript.setControls(ScriptControl.NONE);
      return;
    }
    if (this.paused) {
      workerScript.setControls(ScriptControl.RESUME);
      return;
    }
    if (this.transitioning) {
      workerScript.setControls(ScriptControl.NONE);
      return;
    }
    workerScript.setControls(
      RUNNING | (this.index > 0 ? ScriptControl.PREVIOUS : ScriptControl.NONE),
    );
  }

  private release(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

function nextIndex(
  index: number,
  directive: IterateDirective,
  length: number,
): number {
  if (directive === 'retry') return index;
  if (directive === 'previous') return Math.max(0, index - 1);
  return Math.min(length, index + 1);
}

async function* iterate<T>(
  alts: AltWithData[],
  scriptOptions: Record<string, any>,
  options: IterateAltsOptions,
  create: (alt: AltWithData, cursor: AltCursor) => Promise<Step<T> | null>,
): AsyncGenerator<T, void, IterateDirective | undefined> {
  const filtered =
    options.filter === false
      ? alts
      : filterAlts(alts, {
          ...scriptOptions,
          altFilter: options.altFilter ?? scriptOptions.altFilter,
        });

  if (alts.length > 0 && filtered.length === 0) {
    await workerScript.showSnackbarWithButtons({
      title: 'No alts to join with',
      body: 'It seems all your alts have been filtered out. You might want to disable some filter options in your settings.',
      buttons: [{ label: 'Got it', id: 'Got it' }],
    });
    workerScript.stop();
    return;
  }

  const cursor = new AltCursor(options.disableControls ?? false);
  try {
    const startIndex =
      typeof options.startCount === 'number'
        ? options.startCount
        : typeof workerScript.startCount === 'number'
          ? workerScript.startCount
          : 0;
    let index = Math.min(Math.max(0, startIndex), filtered.length);
    while (index < filtered.length) {
      cursor.setIndex(index);
      await cursor.wait();

      if (options.showProgress) {
        workerScript.setProgress({ current: index, total: filtered.length });
      }

      let directive: IterateDirective | undefined;
      try {
        const current = await create(filtered[index], cursor);
        if (current) {
          directive = yield current.value;
        }
      } finally {
        cursor.transition();
        cursor.closeCurrent();
      }
      index = nextIndex(index, cursor.take(directive), filtered.length);
    }
  } finally {
    cursor.dispose();
  }
}

export function iterateBots(
  alts: AltWithData[],
  scriptOptions: Record<string, any> = {},
  options: IterateAltsOptions = {},
): AsyncGenerator<Bot, void, IterateDirective | undefined> {
  const joinOptions = options.join ?? { login: true };
  return iterate(alts, scriptOptions, options, async (alt, cursor) => {
    const session = new BotSession({
      profile: { ...options.options, ...alt },
      joinOptions,
    });
    if (!cursor.activate(session)) return null;
    const bot = await session.open();
    if (!bot) return null;
    
    return { value: session.proxy ?? bot };
  });
}

export function iterateAlts(
  alts: AltWithData[],
  scriptOptions: Record<string, any> = {},
  options: IterateAltsOptions = {},
): AsyncGenerator<AltWithData, void, IterateDirective | undefined> {
  return iterate(alts, scriptOptions, options, async (alt, cursor) => {
    if (!cursor.activate(null)) return null;
    return { value: alt };
  });
}

export default iterateBots;
