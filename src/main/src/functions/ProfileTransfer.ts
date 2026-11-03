import crypto from 'node:crypto';
import generateUID from '../../UID';
import type { SyncedProfilePackage } from '../../../common/mobileClientContract';
import { splitAppSettings } from '../../../common/appSettingsSchema';
import {
  profileFromJNdata,
  type CustomProfile,
} from '../../../common/profiles';
import type {
  AltWithData,
  AppSettings,
  SettingsObj,
} from '../types';
import type Settings_ from './Settings';

export type PortableProfilePackage = SyncedProfilePackage<
  CustomProfile,
  SettingsObj,
  Partial<AppSettings>,
  AltWithData[]
>;

export type InstalledProfileCopy = {
  ownerId: string;
  sourceProfileKey: string;
  profileKey: string;
  revision: string;
};

/** Owns conversion between live profiles and deterministic local copies. */
export default class ProfileTransfer {
  constructor(private readonly settings: Settings_) {}

  /** Self-contained copy of a custom or built-in profile, scripts inlined. */
  async portableProfile(profileKey: string): Promise<CustomProfile> {
    const active = this.settings.getProfile(profileKey);
    if (!active) throw new Error(`Unknown profile: ${profileKey}`);
    const stored = this.settings.profiles.get(profileKey);
    const baseProfile = stored
      ? structuredClone(stored)
      : profileFromJNdata(
          this.settings.JNdata,
          profileKey,
          profileKey,
          active.data.name,
        );
    return this.settings.profiles.buildExportPayload(baseProfile);
  }

  async export(profileKey: string): Promise<PortableProfilePackage> {
    const profile = await this.portableProfile(profileKey);
    const { profile: appSettings } = splitAppSettings(
      this.settings.getProfileAppSettings(profileKey),
    );
    return {
      version: 1,
      source: { ownerId: generateUID(), profileKey },
      revision: crypto.randomUUID(),
      exportedAt: Date.now(),
      profile,
      settings: structuredClone(this.settings.getProfileSettings(profileKey)),
      appSettings,
      alts: structuredClone(
        this.settings.getAltsWithDataForProfile(profileKey),
      ),
    };
  }

  async import(packages: PortableProfilePackage[]) {
    const installed: InstalledProfileCopy[] = [];
    const failed: Array<{ ownerId?: string; profileKey?: string; error: string }> = [];
    for (const item of packages) {
      try {
        installed.push(await this.install(item));
      } catch (error) {
        failed.push({
          ownerId: item?.source?.ownerId,
          profileKey: item?.source?.profileKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { installed, failed };
  }

  private async install(item: PortableProfilePackage): Promise<InstalledProfileCopy> {
    this.validate(item);
    const profileKey = this.localProfileKey(item.source.ownerId, item.source.profileKey);
    const existing = this.settings.profiles.get(profileKey);
    if (existing?.remoteSource?.revision !== item.revision) {
      const incoming: CustomProfile = {
        ...structuredClone(item.profile),
        id: profileKey,
        sourceProfileId: undefined,
        data: { ...structuredClone(item.profile.data), id: profileKey },
        remoteSource: {
          ownerId: item.source.ownerId,
          profileKey: item.source.profileKey,
          revision: item.revision,
        },
      };
      const profile = await this.settings.profiles.materializeSyncedProfile(
        incoming,
      );
      this.settings.profiles.upsert(profile);
      this.settings.replaceProfileSettings(profileKey, item.settings);
      this.settings.replaceProfileAppSettings(profileKey, item.appSettings);
      this.settings.setAltsForProfile(profileKey, item.alts);
    }
    return {
      ownerId: item.source.ownerId,
      sourceProfileKey: item.source.profileKey,
      profileKey,
      revision: item.revision,
    };
  }

  private localProfileKey(ownerId: string, profileKey: string): string {
    return `remote-${crypto
      .createHash('sha256')
      .update(`${ownerId}\0${profileKey}`)
      .digest('hex')
      .slice(0, 32)}`;
  }

  private validate(item: PortableProfilePackage): void {
    if (
      item?.version !== 1 ||
      typeof item.source?.ownerId !== 'string' ||
      !item.source.ownerId ||
      typeof item.source?.profileKey !== 'string' ||
      !item.source.profileKey ||
      typeof item.revision !== 'string' ||
      !item.profile?.data ||
      !item.settings ||
      !Array.isArray(item.alts)
    ) {
      throw new TypeError('Invalid synced profile package.');
    }
  }
}
