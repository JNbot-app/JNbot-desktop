import { Authflow, Titles } from 'prismarine-auth';
import { app } from 'electron';
import fs from 'node:fs/promises';

import type { Alt, AltWithSession } from '../../types';
import type Settings_ from '../Settings';
import { getMinecraftAuthDir, minecraftAuthHash } from './minecraftPaths';

type MinecraftSession = {
  accessToken: string;
  uuid: string;
  name: string;
};

type MinecraftJavaProfile = {
  id: string;
  name: string;
  skins?: { url?: string }[];
};

export type LaunchSessionResult = {
  session: MinecraftSession;
  minecraftProfile?: MinecraftJavaProfile;
};

/**
 * Flow options shared by the launcher and the bot worker. These MUST match
 * what minecraft-protocol uses by default (see
 * node_modules/minecraft-protocol/src/client/microsoftAuth.js) so that a token
 * cached by one side is transparently reused by the other:
 *   flow: 'live', authTitle: MinecraftNintendoSwitch, deviceType: 'Nintendo'.
 * The 'live' flow uses the public Nintendo Switch title, so no Azure app /
 * client id is required.
 */
const AUTH_FLOW_OPTIONS = {
  flow: 'live',
  authTitle: Titles.MinecraftNintendoSwitch,
  deviceType: 'Nintendo',
} as const;

/** The single shared auth-cache directory (per-username inside). */
const authDir = (): string => getMinecraftAuthDir(app.getPath('userData'));

const pickSkinUrl = (profile?: MinecraftJavaProfile): string | undefined =>
  profile?.skins?.find((s) => s?.url)?.url;

/**
 * Delete every cached token file belonging to a single account. Called when a
 * premium alt is removed or logged out so its Microsoft/Minecraft auth doesn't linger.
 * Safe to call for accounts that were never logged in.
 */
export async function removeMinecraftAuth(username: string): Promise<void> {
  if (!username) return;
  const dir = authDir();
  const prefix = `${minecraftAuthHash(username)}_`;
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (
      typeof error === 'object' && error !== null &&
      'code' in error && error.code === 'ENOENT'
    )
      return; // no cache dir yet
    throw error;
  }
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix) && name.endsWith('-cache.json'))
      .map((name) =>
        fs.rm(`${dir}/${name}`, { force: true }),
      ),
  );
}

export default class MinecraftAccountService {
  /**
   * Resolve a usable Minecraft session for the given account, using the shared
   * prismarine-auth cache keyed by `username`.
   *
   * prismarine-auth silently refreshes from the cache when possible and only
   * triggers the device-code callback when interactive sign-in is required, so
   * this one method covers both "already logged in" and "needs login". The
   * device code is surfaced through the unified `MC_MICROSOFT_DEVICE_CODE`
   * event consumed by the global login modal.
   */
  async getSession(
    username: string,
    sendEvent?: (event: string, data?: unknown) => void,
  ): Promise<LaunchSessionResult> {
    const flow = new Authflow(
      username,
      authDir(),
      AUTH_FLOW_OPTIONS,
      (code) => {
        sendEvent?.('MC_MICROSOFT_DEVICE_CODE', {
          message: code.message,
          userCode: code.user_code,
          verificationUri: code.verification_uri,
          expiresIn: code.expires_in,
          username,
        });
      },
    );

    const { token, profile } = await flow.getMinecraftJavaToken({
      fetchProfile: true,
    });

    const mcProfile = profile as MinecraftJavaProfile | undefined;
    if (!token || !mcProfile?.id) {
      throw new Error(`Failed to obtain a Minecraft session for ${username}`);
    }

    return {
      session: {
        accessToken: token,
        uuid: mcProfile.id,
        name: mcProfile.name,
      },
      minecraftProfile: mcProfile,
    };
  }

  /** Resolve (logging in on demand) the launch session for an alt. */
  async getLaunchSessionForAlt(
    alt: Alt,
    sendEvent?: (event: string, data?: unknown) => void,
  ): Promise<LaunchSessionResult | null> {
    if (!alt?.username) return null;
    try {
      return await this.getSession(alt.username, sendEvent);
    } catch {
      return null;
    }
  }

  /**
   * Explicit Microsoft sign-in for a known account. Kept for IPC/API compat
   * (the launch/join paths normally resolve sessions via
   * `getLaunchSessionForAlt`). Returns the alt enriched with its session.
   */
  async loginWithMicrosoftDeviceCode(
    settings: Settings_,
    username?: string,
    sendEvent?: (event: string, data?: unknown) => void,
  ): Promise<AltWithSession> {
    if (!username) {
      throw new Error('A username is required to sign in with Microsoft');
    }
    const { session, minecraftProfile } = await this.getSession(
      username,
      sendEvent,
    );
    const alt = settings.shared.alts.find((a) => a.username === session.name);

    return {
      ...alt,
      username: session.name,
      UID: session.uuid,
      minecraftSession: {
        accessToken: session.accessToken,
        uuid: session.uuid,
        name: session.name,
        skinUrl: pickSkinUrl(minecraftProfile),
      },
    } as AltWithSession;
  }
}
