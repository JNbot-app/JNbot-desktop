import type { MacroCodeJavascript, MacroInfo } from '../../../types';
import {
  isRecipeDocument,
  type RecipeDocumentV3,
} from '../../../../../common/recipeV3';
import { runJS } from '../../compiler/jsRuntime';
import defaultActionRunner from '../../scripts/defaultActionRunner';
import RecipeCompiler from './RecipeCompiler';
import RecipeExecutionError from './RecipeExecutionError';
import RecipeRuntime from './RecipeRuntime';
import { resolvePluginOptions } from './resolvePluginOptions';
import { withPreset } from '../../../../../common/pluginPresets';
import { startBotAutomation } from '../automation';
import type { AutomationDocument } from '../../../../../common/automation';

type RunnerArgs = {
  components: unknown;
  macroInfo: MacroInfo;
  devMode: boolean;
  isMacro: boolean;
  optionOverrides?: Record<string, any>;
};

type JSCallOptions = {
  args?: any[];
  runAsAction?: boolean;
};

async function runner(args: RunnerArgs, callOptions?: JSCallOptions) {
  if (args.macroInfo.language === 'js' || args.macroInfo.language === 'ts') {
    return runJavascript(args, callOptions);
  } else if (args.macroInfo.language === 'recording') {
    return runRecording(args, callOptions);
  }
  if (!isRecipeDocument(args.components)) {
    throw new Error(
      'This plugin uses the retired component canvas. Convert or recreate it in the recipe editor.',
    );
  }
  return runRecipe(args.components, args.macroInfo, args.optionOverrides);
}

async function runRecording(args: RunnerArgs, callOptions?: JSCallOptions) {
  const scriptOptions = resolvePluginOptions(
    args.macroInfo,
    args.optionOverrides,
  );
  if (!callOptions?.runAsAction) {
    defaultActionRunner(
      args.macroInfo,
      args.components as AutomationDocument,
      scriptOptions,
      callOptions?.args,
    );
    return;
  }
  const bot = callOptions?.args?.[0];
  if (!bot) throw new Error('Bot instance is required to run a recording action.');
  const document = args.components as AutomationDocument;
  const spatialMode =
    (args.optionOverrides?.spatialMode as any) ||
    scriptOptions.spatialMode ||
    'absolute';
  const inputs = {
    ...scriptOptions,
    ...withPreset(args.optionOverrides ?? {}),
    ...(callOptions?.args?.[1] && typeof callOptions.args[1] === 'object'
      ? callOptions.args[1]
      : {}),
  };
  const session = startBotAutomation(bot, {
    document,
    options: { spatialMode, inputs, mode: inputs.playMode },
  });
  return await session.done;
}

async function runJavascript(args: RunnerArgs, callOptions?: JSCallOptions) {
  const scriptOptions = resolvePluginOptions(
    args.macroInfo,
    args.optionOverrides,
  );
  if (args.macroInfo.scriptType === 'action' && !callOptions?.runAsAction) {
    defaultActionRunner(
      args.macroInfo,
      args.components as MacroCodeJavascript,
      scriptOptions,
      callOptions?.args,
    );
    return;
  }
  if (args.macroInfo.scriptType === 'profileUi') {
    throw new Error('Profile UI cannot be executed.');
  }
  return runJS({
    code: (args.components as MacroCodeJavascript).code,
    scriptInfo: args.macroInfo,
    scriptOptions,
    args: callOptions?.args,
    runAsAction: callOptions?.runAsAction,
  });
}

async function runRecipe(
  document: RecipeDocumentV3,
  macroInfo: MacroInfo,
  optionOverrides?: Record<string, any>,
) {
  const program = new RecipeCompiler(document).compile();
  let activeStepId: string | undefined;
  const progress = setInterval(() => {
    if (!activeStepId) return;
    global.sendToClients('active-component', { componentId: activeStepId });
    activeStepId = undefined;
  }, 50);

  const runtime = new RecipeRuntime(program, {
    pluginInfo: macroInfo,
    pluginOptions: resolvePluginOptions(macroInfo, optionOverrides),
    onStep: (source) => {
      activeStepId = source.stepId;
    },
    onError: (error: RecipeExecutionError) => {
      const payload = {
        threadId: 0,
        component: { componentId: error.source.stepId },
        source: error.source,
        message: error.message,
      };
      global.sendToClients('component-error', payload);
      console.error('[Recipe error]:', payload);
    },
  });

  try {
    await runtime.run();
  } finally {
    clearInterval(progress);
    global.sendToClients('active-component', { componentId: undefined });
  }

  if (runtime.stopRequested) setImmediate(() => process.exit(0));
}

export default runner;
