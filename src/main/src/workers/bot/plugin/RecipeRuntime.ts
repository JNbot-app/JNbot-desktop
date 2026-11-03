import type { MacroInfo } from '../../../types';
import { runJS } from '../../compiler/jsRuntime';
import type { Bot } from '../../workerTypes';
import { getRecipeActionHandler } from './RecipeActions';
import { getRecipeCollectionItems } from './RecipeCollections';
import { getRuntimeEvent, readEventValues } from './RecipeEvents';
import type {
  CompiledEventRecipe,
  InstructionSource,
  RecipeInstruction,
  RecipeProgram,
} from './RecipeProgram';
import RecipeExecutionContext from './RecipeExecutionContext';
import RecipeExecutionError from './RecipeExecutionError';
import {
  matchesCondition,
  matchesConditions,
  resolveValue,
  type ValueScope,
} from './RecipeValues';

type RuntimeHooks = {
  onStep?: (source: InstructionSource) => void;
  onError?: (error: RecipeExecutionError) => void;
};

type RuntimeOptions = RuntimeHooks & {
  pluginOptions?: Record<string, any>;
  pluginInfo: MacroInfo;
};

class ReturnFromRecipe extends Error {}

export default class RecipeRuntime {
  private readonly remembered = new Map<string, any>();
  private readonly cleanups = new Set<() => void>();
  private readonly eventRegistrations = new Map<Bot, Map<string, () => void>>();
  private readonly enabledEventIds: Set<string>;
  private readonly options: Record<string, any>;
  private activeListeners = 0;
  private activeEventRuns = 0;
  private operationCount = 0;
  private stopped = false;
  private resolveIdle?: () => void;

  constructor(
    private readonly program: RecipeProgram,
    private readonly runtimeOptions: RuntimeOptions,
  ) {
    this.options = runtimeOptions.pluginOptions ?? {};
    this.enabledEventIds = new Set(
      program.events
        .filter((event) => event.enabled)
        .map((event) => event.recipeId),
    );
  }

  public get stopRequested() {
    return this.stopped;
  }

  public async run(): Promise<void> {
    try {
      await this.executeRecipe(this.program.onRun, this.context());
      while (
        !this.stopped &&
        (this.activeListeners > 0 || this.activeEventRuns > 0)
      )
        await new Promise<void>((resolve) => {
          this.resolveIdle = resolve;
        });
    } catch (error) {
      this.report(error);
      this.stop();
    }
  }

  public stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.dispose();
    const resolve = this.resolveIdle;
    this.resolveIdle = undefined;
    resolve?.();
  }

  public registerEvents(bot: Bot) {
    if (this.eventRegistrations.has(bot)) return;
    const registrations = new Map<string, () => void>();
    this.eventRegistrations.set(bot, registrations);
    const cleanup = () => {
      [...registrations.values()].forEach((remove) => remove());
      this.eventRegistrations.delete(bot);
      bot.removeListener('end', cleanup);
      this.cleanups.delete(cleanup);
    };
    bot.once('end', cleanup);
    this.cleanups.add(cleanup);
    this.enabledEventIds.forEach((recipeId) =>
      this.enableEventForBot(bot, recipeId),
    );
  }

  private enableEvent(recipeId: string) {
    const event = this.program.events.find(
      (item) => item.recipeId === recipeId,
    );
    if (!event) throw new Error('The selected event recipe no longer exists.');
    this.enabledEventIds.add(recipeId);
    this.eventRegistrations.forEach((_registrations, bot) =>
      this.enableEventForBot(bot, recipeId),
    );
  }

  private disableEvent(recipeId: string) {
    this.enabledEventIds.delete(recipeId);
    this.eventRegistrations.forEach((registrations) =>
      registrations.get(recipeId)?.(),
    );
  }

  private enableEventForBot(bot: Bot, recipeId: string) {
    const registrations = this.eventRegistrations.get(bot);
    if (!registrations || registrations.has(recipeId)) return;
    const event = this.program.events.find(
      (item) => item.recipeId === recipeId,
    );
    if (!event) return;
    const remove = this.registerEvent(bot, event, () =>
      registrations.delete(recipeId),
    );
    registrations.set(recipeId, remove);
  }

  private registerEvent(
    bot: Bot,
    event: CompiledEventRecipe,
    onRemove: () => void,
  ) {
    const runtimeEvent = getRuntimeEvent(event.eventId);
    let queue = Promise.resolve();
    let active = true;

    const run = (args: any[]) => async () => {
      try {
        if (this.stopped || !this.enabledEventIds.has(event.recipeId)) return;
        const context = this.context(
          bot,
          readEventValues(event.eventId, args, bot),
        );
        await this.executeRecipe(event.instructions, context);
      } catch (error) {
        this.report(error);
      } finally {
        this.activeEventRuns--;
        this.finishWhenIdle();
      }
    };

    const handler = (...args: any[]) => {
      if (!active || this.stopped) return;
      this.activeEventRuns++;
      if (event.mode === 'once') remove();
      if (event.concurrency === 'parallel') void run(args)();
      else {
        const task = run(args);
        queue = queue.then(task, task);
      }
    };

    const remove = () => {
      if (!active) return;
      active = false;
      (bot as any).removeListener(runtimeEvent, handler);
      this.activeListeners--;
      onRemove();
      this.finishWhenIdle();
    };

    (bot as any).on(runtimeEvent, handler);
    this.activeListeners++;
    return remove;
  }

  private async executeBlock(
    instructions: RecipeInstruction[],
    context: RecipeExecutionContext,
  ) {
    for (const instruction of instructions) {
      if (this.stopped) return;
      this.runtimeOptions.onStep?.(instruction.source);
      try {
        await this.execute(instruction, context);
      } catch (error) {
        if (error instanceof ReturnFromRecipe) throw error;
        if (error instanceof RecipeExecutionError) throw error;
        throw new RecipeExecutionError(instruction.source, error);
      }
      await this.checkpoint();
    }
  }

  private async execute(
    instruction: RecipeInstruction,
    context: RecipeExecutionContext,
  ): Promise<void> {
    switch (instruction.type) {
      case 'action': {
        const inputs = Object.fromEntries(
          Object.entries(instruction.inputs).map(([id, value]) => [
            id,
            resolveValue(value, this.valueScope(context)),
          ]),
        );
        const result = await getRecipeActionHandler(instruction.actionId)(
          {
            getBot: () => context.getBot(),
            setBot: (bot) => context.setBot(bot),
          },
          inputs,
        );
        Object.entries(instruction.outputs).forEach(([outputId, key]) => {
          context.outputs.set(key, result?.[outputId]);
        });
        return;
      }
      case 'remember':
        this.remembered.set(
          instruction.key,
          resolveValue(instruction.value, this.valueScope(context)),
        );
        return;
      case 'if': {
        const matches = matchesConditions(
          instruction.match,
          instruction.conditions,
          this.valueScope(context),
        );
        await this.executeBlock(
          matches ? instruction.then : instruction.otherwise,
          context,
        );
        return;
      }
      case 'repeat': {
        const count = Math.max(
          0,
          Math.floor(
            Number(resolveValue(instruction.count, this.valueScope(context))),
          ),
        );
        if (!Number.isFinite(count))
          throw new Error('Repeat count must be a number.');
        for (let index = 0; index < count && !this.stopped; index++) {
          context.loops.set(instruction.loopKey, index);
          await this.executeBlock(instruction.body, context);
          await this.checkpoint();
        }
        context.loops.delete(instruction.loopKey);
        return;
      }
      case 'while':
        while (
          !this.stopped &&
          matchesCondition(instruction.condition, this.valueScope(context))
        ) {
          await this.executeBlock(instruction.body, context);
          await this.checkpoint();
        }
        return;
      case 'forEach': {
        const items = getRecipeCollectionItems(instruction.collectionId, {
          bot: context.bot,
          pluginOptions: this.options,
          usePluginFilters: instruction.usePluginFilters,
          showProgress: instruction.showProgress,
          showControls: instruction.showControls,
        });
        const previousBot = context.bot;
        try {
          for await (const item of items) {
            if (this.stopped) break;
            context.loops.set(instruction.loopKey, item.value);
            if (item.bot) context.setBot(item.bot);
            await this.executeBlock(instruction.body, context);
            await this.checkpoint();
          }
        } finally {
          context.loops.delete(instruction.loopKey);
          context.restoreBot(previousBot);
        }
        return;
      }
      case 'parallel':
        await Promise.all(
          instruction.branches.map((branch) =>
            this.executeBlock(branch, context.fork()),
          ),
        );
        return;
      case 'waitForEvent': {
        const values = await this.waitForEvent(
          context.getBot(),
          instruction.eventId,
        );
        Object.entries(instruction.outputs).forEach(([outputId, key]) => {
          context.outputs.set(key, values[outputId]);
        });
        return;
      }
      case 'call':
        await this.executeRecipe(instruction.body, context);
        Object.entries(instruction.outputs).forEach(([key, value]) => {
          context.outputs.set(
            key,
            resolveValue(value, this.valueScope(context)),
          );
        });
        return;
      case 'enableEvent':
        this.enableEvent(instruction.recipeId);
        return;
      case 'developerCode':
        await this.runDeveloperCode(instruction.code, context);
        return;
      case 'stop':
        this.stop();
        return;
      case 'return':
        if (instruction.scope === 'event')
          this.disableEvent(instruction.source.recipeId);
        throw new ReturnFromRecipe();
    }
  }

  private async executeRecipe(
    instructions: RecipeInstruction[],
    context: RecipeExecutionContext,
  ) {
    try {
      await this.executeBlock(instructions, context);
    } catch (error) {
      if (!(error instanceof ReturnFromRecipe)) throw error;
    }
  }

  private valueScope(context: RecipeExecutionContext): ValueScope {
    return {
      outputs: context.outputs,
      remembered: this.remembered,
      loops: context.loops,
      trigger: context.trigger,
      options: this.options,
      bot: context.bot,
    };
  }

  private delay(milliseconds: number) {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }

  private waitForEvent(bot: Bot, eventId: string) {
    const event = getRuntimeEvent(eventId);
    return new Promise<Record<string, any>>((resolve) => {
      const handler = (...args: any[]) => {
        remove();
        resolve(readEventValues(eventId, args, bot));
      };
      const remove = () => {
        (bot as any).removeListener(event, handler);
        this.cleanups.delete(cancel);
      };
      const cancel = () => {
        remove();
        resolve({});
      };
      (bot as any).once(event, handler);
      this.cleanups.add(cancel);
    });
  }

  private async checkpoint() {
    if (++this.operationCount % 1000 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  private finishWhenIdle() {
    if (this.activeListeners === 0 && this.activeEventRuns === 0) {
      const resolve = this.resolveIdle;
      this.resolveIdle = undefined;
      resolve?.();
    }
  }

  private runDeveloperCode(code: string, context: RecipeExecutionContext) {
    if (!code.trim()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.cleanups.delete(finish);
        resolve();
      };
      this.cleanups.add(finish);
      runJS({
        code,
        scriptInfo: this.runtimeOptions.pluginInfo,
        scriptOptions: this.options,
        extraGlobals: {
          exit: finish,
          context: {
            get: (key: string) => this.remembered.get(key),
            set: (key: string, value: any) => this.remembered.set(key, value),
            getBot: () => context.getBot(),
          },
        },
      }).catch((error) => {
        this.cleanups.delete(finish);
        reject(error);
      });
    });
  }

  private report(error: unknown) {
    const runtimeError =
      error instanceof RecipeExecutionError
        ? error
        : new RecipeExecutionError(
            { recipeId: '', stepId: '', callPath: [] },
            error,
          );
    this.runtimeOptions.onError?.(runtimeError);
  }

  private dispose() {
    [...this.cleanups].forEach((cleanup) => cleanup());
    this.cleanups.clear();
    this.eventRegistrations.clear();
    this.activeListeners = 0;
  }

  private context(bot: Bot | null = null, trigger: Record<string, any> = {}) {
    return new RecipeExecutionContext(
      (joinedBot) => this.registerEvents(joinedBot),
      bot,
      trigger,
    );
  }
}
