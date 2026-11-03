import { getPlatform, Platform, ResolvedVersion, Version } from '@xmcl/core';
import {
  FabricLoaderArtifact,
  installDependencies,
  installDependenciesTask,
  installFabric,
  installJavaRuntimeTask,
  installQuiltVersion,
  QuiltLoaderArtifact,
  installForge,
  installLaby4Mod,
  generateOptifineVersion,
  JavaRuntimeManifest,
  JavaRuntimes,
  AnyEntry,
  DEFAULT_RUNTIME_ALL_URL,
} from '@xmcl/installer';
import axios from 'axios';
import { ForgeLoaderArtifact, LabyModArtifact, OptifineLoaderArtifact, VersionData } from './MinecraftLauncherTypes';
import fs from 'node:fs/promises';
import { TaskRunner } from '../TaskRunner';
import { unpackLZMA } from './util/lzmaUnpack';
import { installJnbotMod } from './JnbotMods';
import path from 'node:path';
import { Dirent } from 'node:fs';
import crypto from 'crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const RUNTIME_MARKER = '.jnbot-installed';

export interface JavaRuntime {
  javaPath: string;
  useRosetta: boolean;
}

class MinecraftInstaller {
  private static fetchCache = {} as Record<string, any>;
  static readonly VERSION_MANIFEST_URL =
    'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

  static async GET<T extends any>(url: string): Promise<T> {
    if (MinecraftInstaller.fetchCache[url]) {
      return MinecraftInstaller.fetchCache[url] as T;
    }
    const response = await axios.get(url);
    if (response.status !== 200) {
      throw new Error(
        `[MinecraftInstaller] Failed to fetch HTTP ${response.status}, URL: ${url}`,
      );
    }
    MinecraftInstaller.fetchCache[url] = response.data;
    return response.data as T;
  }

  private static async runInstallDependencies(
    version: ResolvedVersion,
    taskRunner?: TaskRunner,
  ): Promise<ResolvedVersion> {
    if (taskRunner) {
      const task = installDependenciesTask(version, { prevalidSizeOnly: true });
      return await taskRunner.run(task, 'MC_INSTALL_PROGRESS');
    }
    return await installDependencies(version, { prevalidSizeOnly: true });
  }

  static async installLabyModVersion(
    version: VersionData,
    minecraftRoot: string,
    taskRunner?: TaskRunner,
  ) {
    const data = version.data as LabyModArtifact;

    const tag = data.minecraftVersions.find((v) => v.version === version.version);
    if (!tag) {
      throw new Error(
        `LabyMod version ${version.version} not found in LabyMod artifact data.`,
      );
    }

    const versionId = await installLaby4Mod(data, tag.tag, minecraftRoot);
    const parsedVersion = await Version.parse(minecraftRoot, versionId);
    await this.runInstallDependencies(parsedVersion, taskRunner);
    return versionId;
  }

  static async installFabricVersion(
    version: VersionData,
    minecraftRoot: string,
    taskRunner?: TaskRunner,
  ): Promise<string> {
    const versionId = await installFabric({
      minecraft: minecraftRoot,
      version: (version.data as FabricLoaderArtifact).loader.version,
      minecraftVersion: version.version,
      side: 'client',
    });
    const parsedVersion = await Version.parse(minecraftRoot, versionId);
    await this.runInstallDependencies(parsedVersion, taskRunner);
    return versionId;
  }

  static async installQuiltVersion(
    version: VersionData,
    minecraftRoot: string,
    taskRunner?: TaskRunner,
  ): Promise<string> {
    const versionId = await installQuiltVersion({
      minecraft: minecraftRoot,
      version: (version.data as QuiltLoaderArtifact).loader.version,
      minecraftVersion: version.version,
      side: 'client',
    });
    const parsedVersion = await Version.parse(minecraftRoot, versionId);
    await this.runInstallDependencies(parsedVersion, taskRunner);
    return versionId;
  }

  static async installVanillaVersion(
    version: VersionData,
    minecraftRoot: string,
    taskRunner?: TaskRunner,
  ): Promise<string> {
    const versionJsonPath = path.join(
      minecraftRoot,
      'versions',
      version.version,
      `${version.version}.json`,
    );
    try {
      await fs.access(versionJsonPath);
    } catch {
      await fs.mkdir(path.dirname(versionJsonPath), { recursive: true });
      await fs.writeFile(versionJsonPath, JSON.stringify(version.mcVersion));
    }

    await this.runInstallDependencies(version.mcVersion, taskRunner);
    return version.version;
  }

  public static async installOptifine(
    version: VersionData,
    minecraftRoot: string,
  ): Promise<string> {
    const modDir = path.join(minecraftRoot, 'versions');
    const jarPaths = await this.readVersionDir(modDir);
    const optifineFolderName = jarPaths.find(
      (f) =>
        f.toLowerCase().startsWith('optifine') && f.includes(version.version),
    );

    const optifineData = version.data as OptifineLoaderArtifact;
    if (!optifineFolderName) {
      const versionId = 'Optifine ' + optifineData.version;
      generateOptifineVersion(optifineData.editionRelease, version.version);
      return versionId;
    }
    return optifineFolderName;
  }

  public static async installForgeVersion(
    version: VersionData,
    minecraftRoot: string,
    taskRunner?: TaskRunner,
  ): Promise<string> {
    const data = version.data as ForgeLoaderArtifact;

    const versionId = await installForge(
      {
        mcversion: version.version,
        version: data.version,
      },
      minecraftRoot,
      { side: 'client' },
    );
    const parsedVersion = await Version.parse(minecraftRoot, versionId);
    await this.runInstallDependencies(parsedVersion, taskRunner);
    return versionId;
  }

  private static readonly runtimeJobs = new Map<string, Promise<JavaRuntime>>();
  private static readonly verifiedJava = new Set<string>();

  static getJavaExecutablePath(jreBundlePath: string) {
    switch (os.platform()) {
      case 'win32':
        return path.join(jreBundlePath, 'bin', 'javaw.exe');
      case 'darwin':
        return path.join(
          jreBundlePath,
          'jre.bundle',
          'Contents',
          'Home',
          'bin',
          'java',
        );
      case 'linux':
        return path.join(jreBundlePath, 'bin', 'java');
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }

  /** Mojang's runtime platform keys, native first, then the emulated fallback. */
  private static getRuntimeKeys(platform: Platform): (keyof JavaRuntimes)[] {
    const { name, arch } = platform;
    const is32 = arch === 'ia32' || arch === 'x86' || arch === 'x32';
    if (name === 'osx')
      return arch === 'arm64' ? ['mac-os-arm64', 'mac-os'] : ['mac-os'];
    if (name === 'windows') {
      if (arch === 'arm64') return ['windows-arm64', 'windows-x64'];
      return [is32 ? 'windows-x86' : 'windows-x64'];
    }
    if (name === 'linux') return [is32 ? 'linux-i386' : 'linux'];
    throw new Error(`Unsupported platform: ${name}`);
  }

  /**
   * Returns a working Java runtime for `component`, installing or repairing it
   * when needed. Uses Mojang's folder layout so official launcher installs are reused.
   */
  static ensureJavaRuntime(
    minecraftRoot: string,
    component: string,
    taskRunner?: TaskRunner,
  ): Promise<JavaRuntime> {
    const key = path.join(minecraftRoot, component);
    let job = MinecraftInstaller.runtimeJobs.get(key);
    if (!job) {
      job = MinecraftInstaller.resolveJavaRuntime(
        minecraftRoot,
        component,
        taskRunner,
      ).finally(() => MinecraftInstaller.runtimeJobs.delete(key));
      MinecraftInstaller.runtimeJobs.set(key, job);
    }
    return job;
  }

  private static async resolveJavaRuntime(
    minecraftRoot: string,
    component: string,
    taskRunner?: TaskRunner,
  ): Promise<JavaRuntime> {
    const platform = getPlatform();
    const keys = MinecraftInstaller.getRuntimeKeys(platform);
    const runtimeDir = (key: string) =>
      path.join(minecraftRoot, 'runtime', component, key);

    let key: keyof JavaRuntimes | undefined;
    for (const candidate of keys) {
      if (await MinecraftInstaller.isRuntimeInstalled(runtimeDir(candidate), component)) {
        key = candidate;
        break;
      }
    }
    const installed = !!key;
    if (!key) {
      const index = await MinecraftInstaller.GET<JavaRuntimes>(DEFAULT_RUNTIME_ALL_URL);
      key = keys.find((k) => index[k]?.[component]?.length);
      if (!key)
        throw new Error(`Mojang provides no Java runtime "${component}" for ${keys[0]}`);
    }

    const runtime: JavaRuntime = {
      javaPath: MinecraftInstaller.getJavaExecutablePath(
        path.join(runtimeDir(key), component),
      ),
      useRosetta: platform.name === 'osx' && key !== keys[0],
    };
    if (runtime.useRosetta) await MinecraftInstaller.assertRosetta();

    if (!installed)
      await MinecraftInstaller.installRuntime(runtimeDir(key), component, key, taskRunner);

    let error = await MinecraftInstaller.probeJava(runtime);
    if (error) {
      console.warn(`[MinecraftInstaller] Java runtime broken (${error}), reinstalling...`);
      await MinecraftInstaller.installRuntime(runtimeDir(key), component, key, taskRunner);
      error = await MinecraftInstaller.probeJava(runtime);
      if (error)
        throw new Error(`Java runtime at ${runtime.javaPath} does not start: ${error}`);
    }
    return runtime;
  }

  /** Our marker, or the official launcher's `<component>.sha1`, is written only after a complete install. */
  private static async isRuntimeInstalled(dir: string, component: string) {
    for (const marker of [RUNTIME_MARKER, `${component}.sha1`]) {
      if (await fs.access(path.join(dir, marker)).then(() => true, () => false))
        return true;
    }
    return false;
  }

  private static async assertRosetta() {
    try {
      await execFileAsync('/usr/bin/arch', ['-x86_64', '/usr/bin/true']);
    } catch {
      throw new Error(
        'This Minecraft version needs Rosetta 2. Install it by running "softwareupdate --install-rosetta" in Terminal, then try again.',
      );
    }
  }

  /** Runs `java -version`; returns an error message, or null when Java starts. */
  private static async probeJava({ javaPath, useRosetta }: JavaRuntime) {
    if (MinecraftInstaller.verifiedJava.has(javaPath)) return null;
    // javaw.exe never writes to the console, java.exe next to it does.
    const probePath = javaPath.replace(/javaw\.exe$/i, 'java.exe');
    const [cmd, args] = useRosetta
      ? ['/usr/bin/arch', ['-x86_64', probePath, '-version']]
      : [probePath, ['-version']];
    try {
      await execFileAsync(cmd, args, { timeout: 60_000 });
      MinecraftInstaller.verifiedJava.add(javaPath);
      return null;
    } catch (error: any) {
      return String(error?.stderr || error?.message || error).trim();
    }
  }

  private static async installRuntime(
    dir: string,
    component: string,
    key: keyof JavaRuntimes,
    taskRunner?: TaskRunner,
  ) {
    const index = await MinecraftInstaller.GET<JavaRuntimes>(DEFAULT_RUNTIME_ALL_URL);
    const target = index[key]?.[component]?.[0];
    if (!target)
      throw new Error(`Mojang provides no Java runtime "${component}" for ${key}`);
    const { files } = await MinecraftInstaller.GET<{
      files: Record<string, AnyEntry>;
    }>(target.manifest.url);
    const manifest: JavaRuntimeManifest = {
      files,
      target: component,
      version: target.version,
    };

    // Start clean so a broken or partial install can't survive.
    await fs.rm(dir, { recursive: true, force: true });
    const destination = path.join(dir, component);

    for (let attempt = 1; ; attempt++) {
      const task = installJavaRuntimeTask({ destination, manifest, lzma: unpackLZMA });
      try {
        if (taskRunner) await taskRunner.run(task, 'MC_INSTALL_PROGRESS');
        else await task.startAndWait();
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
        console.warn(`[MinecraftInstaller] Java runtime download failed, retrying (${attempt})`, error);
      }
    }

    // xmcl ignores executable flags and creates links the wrong way round.
    await Promise.all(
      Object.entries(files).map(async ([file, entry]) => {
        const dest = path.join(destination, file);
        if (entry.type === 'file' && entry.executable && process.platform !== 'win32') {
          await fs.chmod(dest, 0o755);
        } else if (entry.type === 'link') {
          await fs.rm(dest, { force: true });
          await fs.symlink(entry.target, dest).catch(() => {});
        }
      }),
    );
    await fs.writeFile(path.join(dir, RUNTIME_MARKER), target.version.name);
  }

  private static async readDir(
    dirPath: string,
    fileOnly = true,
  ): Promise<string[]> {
    // if folder doesn't exist -> make it
    await fs.mkdir(dirPath, { recursive: true }).catch(() => {});
    let entries: Dirent[] = await fs
      .readdir(dirPath, { withFileTypes: true })
      .catch(() => []);
    return entries
      .filter((e) => (fileOnly ? e.isFile() : e.isDirectory()))
      .map((e) => e.name);
  }

  private static async readVersionDir(versionDir: string): Promise<string[]> {
    const versions: Dirent[] = [];
    try {
      versions.push(...(await fs.readdir(versionDir, { withFileTypes: true })));
    } catch {
      // ignore
    }

    const folderNames = versions
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    return folderNames;
  }

  public static async installFabricMod(
    minecraftVersion: string,
    minecraftRoot: string,
  ) {
    const fabricFolder = path.join(
      minecraftRoot,
      'libraries',
      'net',
      'fabricmc',
      'fabric-api',
      minecraftVersion,
    );
    const files = await MinecraftInstaller.readDir(fabricFolder, true);
    if (files.length !== 0) {
      return path.join(fabricFolder, files[0]);
    }

    const url = `https://api.modrinth.com/v2/project/fabric-api/version?game_versions=${encodeURIComponent('["' + minecraftVersion + '"]')}&loaders=${encodeURIComponent('["fabric"]')}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'JNbot (fabric-api installer)',
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch Fabric API metadata (${response.status})`,
      );
    }

    const versions = await response.json();

    if (versions.length === 0) {
      throw new Error(
        `No Fabric API versions found for Minecraft ${minecraftVersion}`,
      );
    }

    const latestVersion = versions[0];
    const jarFile = latestVersion.files[0];
    if (!jarFile) {
      throw new Error(
        `No Fabric API jar found for Minecraft ${minecraftVersion}`,
      );
    }

    return await MinecraftInstaller.installModFromArtifact({
      artifact: jarFile,
      destination: fabricFolder,
    });
  }

  private static async installModFromArtifact(options: {
    artifact: { filename: string; url: string; hashes: Record<string, string> };
    destination: string;
    compareHash?: boolean;
  }): Promise<string> {
    const outputFile = path.join(
      options.destination,
      options.artifact.filename,
    );
    if (options.compareHash && options.artifact.hashes?.sha1) {
      const existingFileBuffer = await fs
        .readFile(outputFile)
        .catch(() => null);
      if (existingFileBuffer) {
        const hashSum = crypto.createHash('sha1');
        hashSum.update(new Uint8Array(existingFileBuffer));
        const existingFileHash = hashSum.digest('hex');
        if (existingFileHash === options.artifact.hashes.sha1) {
          console.info(
            `[MinecraftInstaller] Fabric mod ${options.artifact.filename} already installed and verified.`,
          );
          return outputFile;
        } else {
          console.info(
            `[MinecraftInstaller] Fabric mod ${options.artifact.filename} hash mismatch, re-downloading.`,
          );
        }
      }
    }

    const jarRes = await fetch(options.artifact.url, {
      headers: { 'User-Agent': 'JNbot (fabric-api installer)' },
    });
    if (!jarRes.ok) {
      throw new Error(`Failed to download Fabric API (${jarRes.status})`);
    }
    const bytes = new Uint8Array(await jarRes.arrayBuffer());
    
    await fs.mkdir(options.destination, { recursive: true });
    await fs.writeFile(outputFile, bytes);
    return outputFile;
  }

  public static async getJNbotMod(mcVersion: string) {
    const { jarPath } = await installJnbotMod(mcVersion);
    return { name: path.basename(jarPath), modJarPath: jarPath };
  }

  /** Links JNbot-managed mods into `<root>/mods`, keeping the user's own jars. */
  public static async createSymbolicModFolder(minecraftRoot: string, modPaths: string[]) {
    const modsDir = path.join(minecraftRoot, 'mods');
    const indexPath = path.join(modsDir, '.jnbot-mods.json');
    await fs.mkdir(modsDir, { recursive: true });

    // Only remove what a previous launch placed here.
    const previous: string[] = await fs
      .readFile(indexPath, 'utf8')
      .then(JSON.parse, () => []);
    await Promise.all(
      previous.map((name) =>
        fs.rm(path.join(modsDir, path.basename(name)), { force: true }),
      ),
    );

    const placed = modPaths.map((mod) => path.basename(mod));
    await Promise.all(
      modPaths.map(async (mod, i) => {
        const linkPath = path.join(modsDir, placed[i]);
        await fs.rm(linkPath, { force: true });
        if (os.platform() !== 'win32') return fs.symlink(mod, linkPath);
        // Hardlinks need no admin rights but fail across drives; copy then.
        await fs.link(mod, linkPath).catch(() => fs.copyFile(mod, linkPath));
      }),
    );
    await fs.writeFile(indexPath, JSON.stringify(placed));
    return modsDir;
  }

  public static async installJNbotClientMods(
    mcVersion: string,
    minecraftRoot: string,
  ): Promise<string[]> {
    const { entry, jarPath } = await installJnbotMod(mcVersion);
    const libraryPaths = await Promise.all(
      entry.libraries.map((lib) =>
        MinecraftInstaller.installModFromArtifact({
          artifact: lib,
          destination: path.join(minecraftRoot, lib.destination),
          compareHash: true,
        }),
      ),
    );
    return [jarPath, ...libraryPaths];
  }
}

export default MinecraftInstaller;
