import { MacroCode, MacroInfo } from 'main/src/types';
import workerScript from '../lib/workerScript';
import runner from '../bot/plugin/runner';
import { iterateBots } from './iterateAlts';
import { AltWithData } from 'common/types/pluginApi';

async function defaultActionRunner(
  actionInfo: MacroInfo,
  code: MacroCode,
  scriptOptions: Record<string, any>,
  args?: any[],
) {
  if (actionInfo?.scriptType !== 'action' && actionInfo?.language !== 'recording') {
    throw new Error('No action provided');
  }

  if (
    actionInfo.language === 'recording' &&
    !scriptOptions.account &&
    !scriptOptions.alts
  ) {
    workerScript.optionError(
      { field: 'account', message: 'Please select an account to replay with' },
      actionInfo,
    );
    workerScript.stop();
    return;
  }

  let alts = workerScript.getAlts({ fullAlts: false });
  const optionsWithAccount = {
    ...scriptOptions,
    alts: scriptOptions.account || scriptOptions.alts,
  };

  if (typeof scriptOptions.chunkLoadLimit === "boolean" && scriptOptions.chunkLoadLimit) {
    scriptOptions.chunkLoadLimit = 1
  } else if (typeof scriptOptions.chunkLoadLimit !== "number"  || scriptOptions.chunkLoadLimit <= 0) {
    scriptOptions.chunkLoadLimit = null
  }

  if (typeof scriptOptions.alt === 'string') {
    const selectedAlt = alts.find((alt) => alt.username === scriptOptions.alt);
    alts = [
      selectedAlt || ({
        username: scriptOptions.alt,
        data: { gkits: {}, ranks: {} },
      } satisfies AltWithData),
    ];
  }

  // Let the iterator filter the alts and handle the control buttons, joining
  // and per-alt cleanup.
  for await (const bot of iterateBots(alts, optionsWithAccount, {
    filter: true,
    showProgress: true,
    join: {chunkLoadLimit: scriptOptions.chunkLoadLimit, login: true}
  })) {
    await runner(
      {
        macroInfo: actionInfo,
        components: code,
        devMode: false,
        isMacro: false,
      },
      {
        runAsAction: true,
        args: [bot, scriptOptions, args ?? []],
      },
    );
  }

  global.log('Finished running ' + actionInfo.name, 'success');
  workerScript.stop();
}

export default defaultActionRunner;

