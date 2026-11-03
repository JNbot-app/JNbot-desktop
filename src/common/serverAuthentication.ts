import type { JNdataDataSection } from '../main/src/types';

export type AccountAuthenticationInput = {
  premium?: boolean;
  password?: string;
};

/** Missing metadata is intentionally offline to preserve existing profiles. */
export function isOnlineMode(
  profile: Pick<JNdataDataSection, 'onlineMode'> | null | undefined,
): boolean {
  return profile?.onlineMode === true;
}

export function accountAuthenticationError(
  account: AccountAuthenticationInput,
  onlineMode: boolean,
): string | null {
  const premium = account.premium === true;
  const password = account.password?.trim() ?? '';

  if (onlineMode && !premium)
    return 'Premium servers only accept premium accounts.';
  if (password && password.length > 45)
    return 'Use no more than 45 characters for the server password.';
  return null;
}
