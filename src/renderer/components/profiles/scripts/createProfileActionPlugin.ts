import type { MacroInfo, MacroScriptType } from '../../../../main/src/types';
import type { ProfileScript } from '../../../../common/profileScripts';

const newId = () =>
  `pa_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Create a new local plugin (JS) of the given `scriptType` via the
 * existing CREATE_MACRO IPC and return a `ProfileScript` that
 * references it. Used by the wizard's "Create new" button on action
 * picker steps so the user never has to leave the wizard to set up a
 * fresh single-action plugin (profile UI, bot extension, …).
 */
export async function createProfileActionPlugin(
  scriptType: MacroScriptType,
  name: string,
  description: string,
): Promise<{ script: ProfileScript; pluginId: string } | { error: string }> {
  const response: MacroInfo | { status?: string; message?: string } =
    await window.ipcRenderer.get('CREATE_MACRO', {
      name,
      description,
      language: 'js',
      scriptType,
    });

  if (!response || (response as any).status === 'error') {
    return { error: (response as any)?.message ?? 'Failed to create plugin' };
  }

  const pluginId = (response as MacroInfo).pluginId;
  return {
    pluginId,
    script: {
      id: newId(),
      pluginId,
      source: { kind: 'plugin', pluginId },
    },
  };
}
