import { createProfileActionPlugin } from './createProfileActionPlugin';
import type { ProfileScript } from '../../../../common/profileScripts';

/**
 * Thin wrapper kept for backwards compatibility with `StepProfileUi`.
 * The actual creation logic lives in `createProfileActionPlugin` so it
 * can be shared with other single-action wizard steps (e.g. the bot
 * extension step).
 */
export async function createProfileUiPlugin(
  name: string,
  description: string,
): Promise<{ script: ProfileScript; pluginId: string } | { error: string }> {
  return createProfileActionPlugin('profileUi', name, description);
}
