import { workerData } from 'worker_threads';
import workerScript from '../lib/workerScript';
import { runJS } from './jsRuntime';
import { resolvePluginOptions } from '../bot/plugin/resolvePluginOptions';
import { withPreset } from '../../../../common/pluginPresets';
import { startBotAutomation } from '../bot/automation';
import type { AutomationDocument } from '../../../../common/automation';
import type { MacroInfo, MacroCode } from '../../types';
import type { Bot } from '../workerTypes';
import type { RunContext } from './scriptRuntime';

type ScriptActionData = {
  id: string;
  actionName: string;
  code: MacroCode;
  info: MacroInfo;
  error?: string | boolean;
};

type ActionRequest = {
  name?: string;
  id?: string;
  /** The bot the action runs against — handed to `main` as its first argument. */
  bot?: Bot;
  /** Extra positional args, handed to `main` as its third argument. */
  args?: any[];
  /** Overrides for the action's plugin options. */
  optionOverrides?: Record<string, unknown>;
  /** The chain this run belongs to and patches for the machines it creates. */
  context?: RunContext;
};

const cache: Record<string, ScriptActionData> = {};

function fetchActionData(
  actionName: string,
  isName: boolean,
  id: string,
): Promise<ScriptActionData> {
  if (actionName in cache) return Promise.resolve(cache[actionName]);

  return new Promise((resolve, reject) => {
    function handler(data: ScriptActionData) {
      // Ignore responses for other in-flight requests — main echoes back the
      // request's id + actionName on both success and error, so a failure of
      // one concurrent action must not reject the others.
      if (!data || data.id !== id || data.actionName !== actionName) return;
      unsubscribe();
      if (data.error) {
        const reason = typeof data.error === 'string' ? `: ${data.error}` : '';
        return reject(new Error(`Script action "${actionName}" is not available${reason}`));
      }
      cache[actionName] = data;
      resolve(data);
    }

    const unsubscribe = workerScript.onMessage('SCRIPT_ACTION_DATA', handler);
    global.send('SCRIPT_ACTION_DATA', { id, actionName, isName });
  });
}

async function scriptActionRunner({ name, bot, args = [], id, optionOverrides = {}, context }: ActionRequest): Promise<any> {
  if (!name && !id) throw new Error('scriptActionRunner: name or id is required');

  const actionId = workerData.id + Math.random().toString(36).substring(7);
  const action = await fetchActionData((name ?? id)!, !!name, actionId);

  // Same calling convention as defaultActionRunner: `main(bot, settings, args)`,
  // with the action's settings parsed & validated against its config.
  const settings = resolvePluginOptions(action.info, optionOverrides);
  const explicitOptions = withPreset(optionOverrides);

  global.send('SCRIPT_ACTION_START', { actionId, name: action.info.name });
  try {
    if (action.info.language === 'recording') {
      if (!bot) throw new Error('Bot instance is required to run a recording action.');
      const document = action.code as unknown as AutomationDocument;
      const spatialMode =
        (optionOverrides.spatialMode as any) || settings.spatialMode || 'absolute';
      const inputs = {
        ...settings,
        ...explicitOptions,
        ...(args?.[0] && typeof args[0] === 'object' ? args[0] : {}),
      };
      const session = startBotAutomation(bot, {
        document,
        options: { spatialMode, inputs, mode: inputs.playMode },
      });
      return await session.done;
    }

    if (action.info.language !== 'js') {
      throw new Error(
        `scriptActionRunner: only JS and recording script-actions are supported (got "${action.info.language}")`,
      );
    }

    const options = { ...settings, ...explicitOptions };
    // Awaited so SCRIPT_ACTION_DONE only fires once the action has finished.
    return await runJS({
      code: (action.code as any).code ?? (action.code as any),
      scriptInfo: action.info,
      // Also as `script.settings`, like a plugin started on its own.
      scriptOptions: options,
      args: [bot, options, args],
      runAsAction: true,
      context,
    });
  } finally {
    global.send('SCRIPT_ACTION_DONE', { actionId });
  }
}

export = scriptActionRunner;

