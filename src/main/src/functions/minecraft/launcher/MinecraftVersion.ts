import {
  DEFAULT_META_URL_FABRIC,
  DEFAULT_META_URL_QUILT,
  FabricLoaderArtifact,
  getForgeVersionList,
  getLabyModManifest,
  getLoaderArtifactListFor,
  getQuiltLoaderVersionsByMinecraft,
  getVersionList,
  installVersion,
  JavaRuntimeTargetType,
  MinecraftVersionList,
  QuiltLoaderArtifact,
} from '@xmcl/installer';
import MinecraftInstaller, { JavaRuntime } from './MinecraftInstaller';
import {
  checksum,
  launch,
  LaunchOption,
  MinecraftFolder,
  ResolvedVersion,
  Version,
} from '@xmcl/core';
import {
  ForgeLoaderArtifact,
  LabyModArtifact,
  MinecraftVersionOptions,
  OptifineLoaderArtifact,
  VersionData,
  VersionInfo,
} from './MinecraftLauncherTypes';
import path from 'node:path';

import { ChildProcess } from 'node:child_process';
import { MinecraftLauncherTypes } from '../../../../../common/CommonEnums';

const OPTIFINE_DOWNLOAD_URL = 'https://optifine.net/downloads';
// Define a type map for loader types to their corresponding artifact types
type LoaderArtifactMap = {
  [MinecraftLauncherTypes.VANILLA]: ResolvedVersion;
  [MinecraftLauncherTypes.FABRIC]: FabricLoaderArtifact;
  [MinecraftLauncherTypes.JNBOT_CLIENT]: FabricLoaderArtifact;
  [MinecraftLauncherTypes.OPTIFINE]: OptifineLoaderArtifact;
  [MinecraftLauncherTypes.QUILT]: QuiltLoaderArtifact;
  [MinecraftLauncherTypes.FORGE]: ForgeLoaderArtifact;
  [MinecraftLauncherTypes.LABYMOD]: LabyModArtifact;
};

class MinecraftVersion {
  public version: VersionData;
  private static versionListCache: MinecraftVersionList;
  private mods = new Set<string>();
  constructor(
    version: VersionData,
    private options: MinecraftVersionOptions,
  ) {
    this.version = version;
  }

  // Single generic signature
  static async from<T extends keyof LoaderArtifactMap>(
    rawVersion: LoaderArtifactMap[T],
    options: MinecraftVersionOptions,
    loader: T = MinecraftLauncherTypes.VANILLA as T,
    mcVersionId?: string,
  ): Promise<MinecraftVersion> {
    // Helper function to create MinecraftVersion with a modded loader
    const createModdedVersion = async (mcVersionString: string) => {
      const mcVersion = await MinecraftVersion.getLatestVanillaVersion(
        mcVersionString,
        options.minecraftRoot,
      );

      return new MinecraftVersion(
        {
          id: mcVersion.id,
          version: mcVersionString,
          data: rawVersion as Exclude<LoaderArtifactMap[T], ResolvedVersion>,
          mcVersion: mcVersion,
        },
        options,
      );
    };

    switch (loader) {
      case MinecraftLauncherTypes.JNBOT_CLIENT:
      case MinecraftLauncherTypes.FABRIC:
        // Unobfuscated releases (26.1+) report intermediary "0.0.0".
        return createModdedVersion(
          mcVersionId ?? (rawVersion as FabricLoaderArtifact).intermediary.version,
        );
      case MinecraftLauncherTypes.OPTIFINE:
        return createModdedVersion(
          (rawVersion as OptifineLoaderArtifact).version,
        );
      case MinecraftLauncherTypes.QUILT:
        return createModdedVersion(
          mcVersionId ?? (rawVersion as QuiltLoaderArtifact).intermediary.version,
        );
      case MinecraftLauncherTypes.FORGE:
        return createModdedVersion(
          (rawVersion as ForgeLoaderArtifact).mcversion,
        );
      case MinecraftLauncherTypes.LABYMOD:
        return createModdedVersion((rawVersion as LabyModArtifact).mcVersion);
      case MinecraftLauncherTypes.VANILLA:
        const v = rawVersion as ResolvedVersion;
        return new MinecraftVersion(
          {
            id: v.id,
            version: v.id,
            data: null,
            mcVersion: v,
          },
          options,
        );
      default:
        throw new Error('Version ' + loader + ' is not supported yet');
    }
  }
  static async fromUrl(
    url: string,
    options: MinecraftVersionOptions,
  ): Promise<MinecraftVersion> {
    const version = await MinecraftInstaller.GET<ResolvedVersion>(url);
    return MinecraftVersion.from(
      version,
      options,
      MinecraftLauncherTypes.VANILLA,
    );
  }

  private static async getLatestFabricVersion(
    mcVersion: string,
  ): Promise<FabricLoaderArtifact> {
    const fabricVersions = await getLoaderArtifactListFor(mcVersion);
    if (!fabricVersions || fabricVersions.length === 0) {
      throw new Error(`No Fabric loader found for Minecraft ${mcVersion}`);
    }
    return fabricVersions[0];
  }

  private static async getLastestQuiltVersion(
    mcVersion: string,
  ): Promise<QuiltLoaderArtifact> {
    const quiltVersions = await getQuiltLoaderVersionsByMinecraft({
      minecraftVersion: mcVersion,
    });
    if (!quiltVersions || quiltVersions.length === 0) {
      throw new Error(`No Quilt loader found for Minecraft ${mcVersion}`);
    }
    return quiltVersions[0];
  }

  private static async getLatestForgeVersion(
    mcVersion: string,
  ): Promise<ForgeLoaderArtifact> {
    const forgeVersion = (await getForgeVersionList({ minecraft: mcVersion }))
      .versions[0];
    if (!forgeVersion) {
      throw new Error(`No Forge loader found for Minecraft ${mcVersion}`);
    }
    return forgeVersion;
  }

  private static async getLatestLabyModVersion(
    mcVersion: string,
  ): Promise<LabyModArtifact> {
    // We need the full manifest to download the version, therefore we return the full manifest here
    const labyModManifest = await getLabyModManifest();
    return { ...labyModManifest, mcVersion };
  }

  public static async getLabyModVersionList(): Promise<VersionInfo[]> {
    const labyModManifest = await getLabyModManifest();

    return labyModManifest.minecraftVersions
      .filter((v) => v.type === 'release')
      .map((v) => ({
        id: v.version,
        type: v.type,
        launcherType: MinecraftLauncherTypes.LABYMOD,
        name: v.version,
      }));
  }
  public static async getForgeVersionList(): Promise<VersionInfo[]> {
    const forgeVersions = await MinecraftInstaller.GET<{
      result: [{ [mcVersion: string]: string[] }];
    }>('https://mc-versions-api.net/api/forge');

    return Object.keys(forgeVersions.result[0] ?? {})
      .filter((e) => e[0] === '1' && Number(e.split('.')[1]) > 6)
      .map((v) => ({
        id: v,
        type: 'release',
        launcherType: MinecraftLauncherTypes.FORGE,
        name: v,
      }));
  }

  public static async getOptifineVersionList(): Promise<VersionInfo[]> {
    const optifineHtml = await MinecraftInstaller.GET<string>(
      OPTIFINE_DOWNLOAD_URL,
    );
    const versionMatches = Array.from(
      optifineHtml.matchAll(/<h2>Minecraft (\d+\.\d+\.\d+)<\/h2>/g),
    );
    const versions: VersionInfo[] = versionMatches.map((match) => ({
      id: match[1],
      type: 'release',
      launcherType: MinecraftLauncherTypes.OPTIFINE,
      name: match[1],
    }));
    return versions;
  }

  public static async getFabricVersionList(): Promise<VersionInfo[]> {
    const versions = await MinecraftInstaller.GET<
      { version: string; stable: boolean }[]
    >(DEFAULT_META_URL_FABRIC + '/v2/versions/game');

    return versions
      .filter((v) => v.stable)
      .map((v) => ({
        id: v.version,
        type: 'release',
        launcherType: MinecraftLauncherTypes.FABRIC,
        name: v.version,
      }));
  }

  public static async getQuiltVersionList(): Promise<VersionInfo[]> {
    const versions = await MinecraftInstaller.GET<
      { version: string; stable: boolean }[]
    >(DEFAULT_META_URL_QUILT + '/v3/versions/game');

    return versions
      .filter((v) => v.stable)
      .map((v) => ({
        id: v.version,
        type: 'release',
        launcherType: MinecraftLauncherTypes.QUILT,
        name: v.version,
      }));
  }

  public static async getVersionList() {
    if (!this.versionListCache) {
      this.versionListCache = await getVersionList();
      // Remove old (pre-1.6) versions
      this.versionListCache.versions = this.versionListCache.versions.filter(
        (v) => {
          const match = v.id.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
          if (!match || v.id.startsWith('b')) return false;
          const major = Number(match[1]);
          return major >= 1 && !(major === 1 && Number(match[2]) <= 6);
        },
      );
    }
    return this.versionListCache;
  }

  public static async getAllVersions(): Promise<VersionInfo[]> {
    const versions = await this.getVersionList();
    return versions.versions.map((v) => ({
      id: v.id,
      type: v.type,
      launcherType: MinecraftLauncherTypes.VANILLA,
      name: v.id,
      releaseDate: v.releaseTime,
    }));
  }

  private static async getLatestVanillaVersion(
    mcVersion: string,
    minecraftRoot: string,
  ): Promise<ResolvedVersion> {
    const cachedVersion = await Version.parse(minecraftRoot, mcVersion).catch(
      () => null,
    );
    if (cachedVersion) {
      const expectedSha1 = cachedVersion.downloads.client?.sha1;
      const actualSha1: unknown = expectedSha1
        ? await checksum(
            MinecraftFolder.from(minecraftRoot).getVersionJar(
              cachedVersion.minecraftVersion,
            ),
            'sha1',
          ).catch(() => null)
        : null;
      if (!expectedSha1 || actualSha1 === expectedSha1) return cachedVersion;
    }

    const versions = await MinecraftVersion.getVersionList();
    const version = versions.versions.find((v) => v.id === mcVersion);
    if (!version) {
      throw new Error(`No vanilla version found for Minecraft ${mcVersion}`);
    }
    return installVersion(version, minecraftRoot);
  }

  private static async getLastestOptifineVersion(
    mcVersion: string,
  ): Promise<OptifineLoaderArtifact> {
    const optifineHtml = await MinecraftInstaller.GET<string>(
      'https://optifine.net/downloads',
    );
    const matchedVersion = optifineHtml
      .split('<h2>Minecraft ')
      .map((v) => {
        let version = v.match(/^(\d\.\d+(\.\d+)?)/)?.[0];
        if (!version) return null;
        if (version.split('.').length === 2) version += '.0';

        const optifineRelease = v.match(
          /<td class='colFile'>OptiFine ([A-Za-z0-9 ]+)<\/td>/,
        )?.[1];
        if (!optifineRelease) return null;

        return {
          version: version,
          editionRelease: optifineRelease.replaceAll(' ', '_'),
        } satisfies OptifineLoaderArtifact;
      })
      .find((e) => e && e.version === mcVersion);

    if (!matchedVersion) {
      throw new Error(`No Optifine version found for Minecraft ${mcVersion}`);
    }
    return matchedVersion;
  }

  static async fromVersionId(
    mcVersion: string,
    options: MinecraftVersionOptions,
  ): Promise<MinecraftVersion> {
    let version:
      | ResolvedVersion
      | FabricLoaderArtifact
      | OptifineLoaderArtifact
      | QuiltLoaderArtifact
      | ForgeLoaderArtifact
      | LabyModArtifact;
    switch (options.launcher) {
      case MinecraftLauncherTypes.FABRIC:
      case MinecraftLauncherTypes.JNBOT_CLIENT:
        version = await MinecraftVersion.getLatestFabricVersion(mcVersion);
        break;
      case MinecraftLauncherTypes.OPTIFINE:
        version = await MinecraftVersion.getLastestOptifineVersion(mcVersion);
        break;
      case MinecraftLauncherTypes.QUILT:
        version = await MinecraftVersion.getLastestQuiltVersion(mcVersion);
        break;
      case MinecraftLauncherTypes.FORGE:
        version = await MinecraftVersion.getLatestForgeVersion(mcVersion);
        break;
      case MinecraftLauncherTypes.LABYMOD:
        version = await MinecraftVersion.getLatestLabyModVersion(mcVersion);
        break;
      default:
        version = await MinecraftVersion.getLatestVanillaVersion(
          mcVersion,
          options.minecraftRoot,
        );
    }
    return MinecraftVersion.from(version, options, options.launcher, mcVersion);
  }

  async install(): Promise<string> {
    switch (this.options.launcher) {
      case MinecraftLauncherTypes.JNBOT_CLIENT:
        const versionId = await MinecraftInstaller.installFabricVersion(
          this.version,
          this.options.minecraftRoot,
          this.options.taskRunner,
        );
        const jnbotModsPaths = await MinecraftInstaller.installJNbotClientMods(
          this.version.version,
          this.options.minecraftRoot,
        );
        this.mods = new Set<string>([...this.mods, ...jnbotModsPaths]);
        return versionId;
      case MinecraftLauncherTypes.FABRIC:
        const fabricVersionId = await MinecraftInstaller.installFabricVersion(
          this.version,
          this.options.minecraftRoot,
          this.options.taskRunner,
        );
        const fabricModPaths = await MinecraftInstaller.installFabricMod(
          this.version.version,
          this.options.minecraftRoot,
        );
        this.mods = new Set<string>([...this.mods, ...fabricModPaths]);
        return fabricVersionId;
      case MinecraftLauncherTypes.OPTIFINE:
        return MinecraftInstaller.installOptifine(
          this.version,
          this.options.minecraftRoot,
        );
      case MinecraftLauncherTypes.QUILT:
        return MinecraftInstaller.installQuiltVersion(
          this.version,
          this.options.minecraftRoot,
          this.options.taskRunner,
        );
      case MinecraftLauncherTypes.FORGE:
        return MinecraftInstaller.installForgeVersion(
          this.version,
          this.options.minecraftRoot,
          this.options.taskRunner,
        );
      case MinecraftLauncherTypes.LABYMOD:
        return MinecraftInstaller.installLabyModVersion(
          this.version,
          this.options.minecraftRoot,
          this.options.taskRunner,
        );
      default:
        return MinecraftInstaller.installVanillaVersion(
          this.version,
          this.options.minecraftRoot,
          this.options.taskRunner,
        );
    }
  }

  public getJavaPath(): Promise<JavaRuntime> {
    return MinecraftInstaller.ensureJavaRuntime(
      this.options.minecraftRoot,
      this.version.mcVersion.javaVersion?.component ||
        JavaRuntimeTargetType.Legacy,
      this.options.taskRunner,
    );
  }

  private supportsQuickPlay(versionId: string): boolean {
    // Quick Play was added in Minecraft 1.13 (snapshot 18w43c).
    // For safety, enable for 1.13+ only.
    const match = versionId.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) return false;

    const major = Number(match[1]);
    const minor = Number(match[2]);

    if (Number.isNaN(major) || Number.isNaN(minor)) return false;

    if (major > 1) return true;
    if (major === 1 && minor >= 13) return true;
    return false;
  }



  private async updateJVMArgs(existingArgs: string[]): Promise<string[]> {
    if (this.mods.size > 0) {
      const mods = Array.from(this.mods).join(path.delimiter);
      switch (this.options.launcher) {
        case MinecraftLauncherTypes.FABRIC:
        case MinecraftLauncherTypes.JNBOT_CLIENT:
          existingArgs.push('-Dfabric.addMods=' + mods);
          break;
        case MinecraftLauncherTypes.QUILT:
          existingArgs.push('-Dfabric.addMods=' + mods);
          break;
        case MinecraftLauncherTypes.FORGE:
          await MinecraftInstaller.createSymbolicModFolder(this.options.minecraftRoot,Array.from(this.mods))
          break;
        default:
          console.info(
            'Mods not supported for launcher type ',
            this.options.launcher,
          );
          break;
      }
    }

    existingArgs.push("-Dminecraft.api.auth.host=https://nope.invalid");
    existingArgs.push("-Dminecraft.api.account.host=https://nope.invalid");
    existingArgs.push("-Dminecraft.api.session.host=https://nope.invalid");
    existingArgs.push("-Dminecraft.api.services.host=https://nope.invalid");

    return existingArgs;
  }

  addMods(mods: string[]) {
    mods.forEach((mod) => this.mods.add(mod));
  }

  async launch(
    options: Omit<
      LaunchOption,
      | 'gamePath'
      | 'resourcePath'
      | 'javaPath'
      | 'version'
      | 'launcherName'
      | 'gameName'
      | 'versionName'
      | 'launcherBrand'
    >,
  ): Promise<ChildProcess> {
    console.info('Preparing to launch Minecraft version:', this.version.id);
    const { javaPath, useRosetta } = await this.getJavaPath();
    console.info('Using Java runtime at:', javaPath);
    const versionId = await this.install();
    console.info('Using Minecraft version ID:', versionId);

    options.extraJVMArgs = await this.updateJVMArgs(options.extraJVMArgs ?? []);
    if (
      options.quickPlayMultiplayer &&
      !this.supportsQuickPlay(this.version.version)
    ) {
      delete options.quickPlayMultiplayer;
    }
    console.info('Launching Minecraft version:', versionId);
    console.info('Java Path:', javaPath, 'Use Rosetta:', useRosetta);
    return launch({
      ...options,
      gamePath: this.options.minecraftRoot,
      resourcePath: this.options.minecraftRoot,
      javaPath,
      version: versionId,
      launcherName: 'JNbot',
      gameName: 'Minecraft - JNbot',
      versionName: this.version.id + '(JNbot)',
      launcherBrand: 'jnbot',
      prependCommand: useRosetta ? ['arch', '-x86_64'] : undefined,
    });
  }

  get modPath(): string {
    return path.join(this.options.minecraftRoot, 'mods');
  }
}

export default MinecraftVersion;
