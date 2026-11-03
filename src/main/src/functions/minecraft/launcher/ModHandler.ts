import path from 'node:path';
import StorageModule from '../../storage/Storage';
import { ModFile, ModpackIndex, ModSettings } from './MinecraftLauncherTypes';
import fs from 'fs/promises';
import AdmZip from 'adm-zip';
import Modrinth from './Modrinth';
import { ModpackInfo, ModInfo, ModList } from '../../../types';

class ModHandler {
  public readonly modDirectoryPath: string;
  public readonly modPackPath: string;

  private readonly modSettings: StorageModule<ModSettings>;

  constructor(public minecraftRoot: string) {
    this.modDirectoryPath = path.join(minecraftRoot, 'libraries/jnbot/mods');
    this.modPackPath = path.join(minecraftRoot, 'libraries/jnbot/modpacks');

    this.modSettings = new StorageModule<ModSettings>(
      path.join(this.minecraftRoot, 'libraries/jnbot/modSettings.json'),
      this.generateModSettings.bind(this),
    );
  }

  public activateMod(modId: string, mcVersion: string) {
    this.settings.active[mcVersion] ??= { mods: [], modPacks: [] };
    if (!this.isModActive(modId, mcVersion)) {
      this.settings.active[mcVersion].mods.push(modId);
      this.saveSettings(mcVersion);
    } else {
      console.log('Mod already active');
    }
  }

  public activateModPack(modPackId: string, mcVersion: string) {
    this.settings.active[mcVersion] ??= { mods: [], modPacks: [] };
    if (!this.isModPackActive(modPackId, mcVersion)) {
      this.settings.active[mcVersion].modPacks.push(modPackId);
      this.saveSettings(mcVersion);
    } else {
      console.log('Modpack already active');
    }
  }

  public deactivateMod(modId: string, mcVersion: string) {
    this.settings.active[mcVersion] ??= { mods: [], modPacks: [] };
    const matchingModIds = new Set([modId]);
    for (const [id, mod] of Object.entries(this.settings.mods[mcVersion] || {})) {
      if (id === modId || mod.projectId === modId) {
        matchingModIds.add(id);
        if (mod.projectId) matchingModIds.add(mod.projectId);
      }
    }
    this.settings.active[mcVersion].mods = this.settings.active[
      mcVersion
    ].mods.filter((id) => !matchingModIds.has(id));
  }

  public deactivateModPack(modPackId: string, mcVersion: string) {
    this.settings.active[mcVersion] ??= { mods: [], modPacks: [] };
    const matchingModPackIds = new Set([modPackId]);
    for (const [id, pack] of Object.entries(this.settings.modpacks[mcVersion] || {})) {
      if (id === modPackId || pack.projectId === modPackId) {
        matchingModPackIds.add(id);
        if (pack.projectId) matchingModPackIds.add(pack.projectId);
      }
    }
    this.settings.active[mcVersion].modPacks = this.settings.active[
      mcVersion
    ].modPacks.filter((id) => !matchingModPackIds.has(id));
  }

  public isModActive(modId: string, mcVersion: string): boolean {
    this.settings.active[mcVersion] ??= { mods: [], modPacks: [] };
    return this.settings.active[mcVersion].mods.includes(modId);
  }

  public isModPackActive(modPackId: string, mcVersion: string): boolean {
    this.settings.active[mcVersion] ??= { mods: [], modPacks: [] };
    return this.settings.active[mcVersion].modPacks.includes(modPackId);
  }

  public async loadMod(modId: string, mcVersion: string): Promise<ModInfo> {
    const modInfo = await this.modIdToModInfo(modId, mcVersion);
    await this.installMod(modInfo);
    return modInfo;
  }

  public async loadModPack(
    modPackId: string,
    mcVersion: string,
  ): Promise<{ modpackInfo: ModpackInfo; modInfoList: ModInfo[] }> {
    const modpackInfo = await this.modpackIdToModInfo(modPackId, mcVersion);
    const modInfoList = await this.installModPack(modpackInfo);
    return {
      modpackInfo: modpackInfo,
      modInfoList: modInfoList,
    };
  }

  public async loadAllActiveMods(mcVersion: string): Promise<string[]> {
    const active = this.settings.active[mcVersion] ?? {
      mods: [],
      modPacks: [],
    };

    let activeMods = new Set<string>();
    let [loadedMods, loadedModPacks] = await Promise.all([
      Promise.all(active.mods.map((m) => this.loadMod(m, mcVersion))),
      Promise.all(active.modPacks.map((mp) => this.loadModPack(mp, mcVersion))),
    ]); // ensure all mods are installed

    loadedMods.forEach((mod) => activeMods.add(mod.file.filename));
    loadedModPacks.forEach((modPack) => {
      modPack.modInfoList.forEach((mod) => activeMods.add(mod.file.filename));
    });

    // for (const modPackId of active.modPacks) {
    //   const modPack = this.settings.modpacks[modPackId];
    //   if (modPack) {
    //     const mods = await this.getModsFromModPack(modPackId, mcVersion);
    //     mods.forEach((mod) => activeMods.add(mod.path));
    //   }
    // }

    return Array.from(activeMods).map((modFile) =>
      path.join(this.modDirectoryPath, mcVersion, modFile),
    );
  }

  private async readModPackIndexFile(
    modPackId: string,
    version: string,
  ): Promise<ModpackIndex | null> {
    const modpack = this.settings.modpacks[version]?.[modPackId];
    if (!modpack) return null;
    const modPackIndexFile = path.join(
      this.modPackPath,
      version,
      modpack.id,
      'modrinth.index.json',
    );
    const content = await fs
      .readFile(modPackIndexFile, 'utf-8')
      .catch(() => null);
    if (!content) return null;
    return JSON.parse(content);
  }

  public async getModsFromModPack(
    modPackId: string,
    version: string,
  ): Promise<ModFile[]> {
    const indexFile = await this.readModPackIndexFile(modPackId, version);
    if (!indexFile) return [];
    indexFile.files.forEach((file) => {
      file.path = path.basename(file.path);
    });
    return indexFile.files;
  }

  public async installMod(modInfo: ModInfo) {
    const destination = path.join(
      this.modDirectoryPath,
      modInfo.mcVersion,
      modInfo.file.filename,
    );

    if (await fs.stat(destination).catch(() => false)) return; // already installed

    const response = await fetch(modInfo.file.url);
    const buffer = await response.arrayBuffer();

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, new Uint8Array(buffer));

    return modInfo;
  }

  private async installModpackConfigs(
    sourceConfigPath: string,
    destinationConfigPath: string,
  ) {
    const files = await fs.readdir(sourceConfigPath, { withFileTypes: true });
    let promisses = [];
    for (const file of files) {
      if (file.isDirectory()) {
        await fs.mkdir(path.join(destinationConfigPath, file.name), {
          recursive: true,
        });
        promisses.push(
          this.installModpackConfigs(
            path.join(sourceConfigPath, file.name),
            path.join(destinationConfigPath, file.name),
          ),
        );
      } else {
        const sourcePath = path.join(sourceConfigPath, file.name);
        const destPath = path.join(destinationConfigPath, file.name);
        if (await fs.stat(destPath).catch(() => false)) continue; // don't overwrite existing config files
        promisses.push(fs.copyFile(sourcePath, destPath).catch(() => null));
      }
    }
    await Promise.all(promisses);
  }

  private async installMrpack(url: string, destination: string) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();

    const zip = new AdmZip(Buffer.from(buffer));
    zip.extractAllTo(destination, true);

    if (await fs.stat(path.join(destination, 'config')).catch(() => false)) {
      await fs.mkdir(path.join(this.minecraftRoot, 'config'), {
        recursive: true,
      });

      await this.installModpackConfigs(
        path.join(destination, 'config'),
        path.join(this.minecraftRoot, 'config'),
      );
    }
  }

  public async installModPack(modpackInfo: ModpackInfo) {
    const destination = path.join(
      this.modPackPath,
      modpackInfo.mcVersion,
      modpackInfo.id,
    );
    // Check if directory exists
    if (!(await fs.stat(destination).catch(() => false))) {
      await this.installMrpack(modpackInfo.file.url, destination);
    }

    const mods = await this.getModsFromModPack(
      modpackInfo.id,
      modpackInfo.mcVersion,
    );

    const installPromisses = mods.map(async (mod) => {
      const modInfo = await this.modFileToModInfo(mod, modpackInfo.mcVersion);
      await this.installMod(modInfo);
      return modInfo;
    });
    const result = await Promise.all(installPromisses);
    this.addMod(modpackInfo);
    return result;
  }

  private addMod(modInfo: ModInfo) {
    this.settings.mods[modInfo.mcVersion] ??= {};
    this.settings.mods[modInfo.mcVersion][modInfo.id] = modInfo;
    this.saveSettings(modInfo.mcVersion);
  }

  private addModPack(modpackInfo: ModpackInfo) {
    this.settings.modpacks[modpackInfo.mcVersion] ??= {};
    this.settings.modpacks[modpackInfo.mcVersion][modpackInfo.id] = modpackInfo;
    this.saveSettings(modpackInfo.mcVersion);
  }

  public async addModPackByProjectId(projectId: string, mcVersion: string, loader: string) {
    const modpack = await this.modpackProjectIdToModInfo(
      projectId,
      mcVersion,
      loader,
    ).catch(() => null);
    if (modpack) {
      this.activateModPack(modpack.id, mcVersion);
    } else {
      console.warn('Failed to add modpack with project id ', projectId);
    }
  }

  public async removeModPackByProjectId(projectId: string, mcVersion: string, loader: string) {
    const installed = Object.values(this.settings.modpacks[mcVersion] || {}).find(
      (m) => m.projectId === projectId || m.id === projectId,
    );
    if (installed) {
      await this.removeModPack(installed.id, mcVersion);
      return;
    }
    const client = await Modrinth.fromProjectId(projectId, mcVersion, [loader]).catch(() => null);
    if (client) {
      const modpack = client.toModPackInfo();
      await this.removeModPack(modpack.id, mcVersion);
    } else {
      console.warn('Failed to remove modpack with project id ', projectId);
    }
  }

  public async addModByProjectId(projectId: string, mcVersion: string, loader: string) {
    const modInfo = await this.modProjectIdToModInfo(
      projectId,
      mcVersion,
      loader,
    ).catch(() => null);
    if (modInfo) {
      this.activateMod(modInfo.id, mcVersion);
    } else {
      console.warn('Failed to add mod with project id ', projectId);
    }
  }

  public async removeModByProjectId(projectId: string, mcVersion: string, loader: string) {
    const installed = Object.values(this.settings.mods[mcVersion] || {}).find(
      (m) => m.projectId === projectId || m.id === projectId,
    );
    if (installed) {
      await this.removeMod(installed.id, mcVersion);
      return;
    }
    const client = await Modrinth.fromProjectId(projectId, mcVersion, [loader]).catch(() => null);
    if (client) {
      const modInfo = client.toModInfo();
      await this.removeMod(modInfo.id, mcVersion);
    } else {
      console.warn('Failed to remove mod with project id ', projectId);
    }
  }

  public async addModById(modId: string, mcVersion: string) {
    const modInfo = await this.modIdToModInfo(modId, mcVersion).catch(
      () => null,
    );
    if (modInfo) {
      this.activateMod(modId, mcVersion);
    } else {
      console.warn('Failed to add mod with id ', modId);
    }
  }

  public async addModPackById(modPackId: string, mcVersion: string) {
    const modpack = await this.modpackIdToModInfo(modPackId, mcVersion).catch(
      () => null,
    );
    if (modpack) {
      this.activateModPack(modPackId, mcVersion);
    } else {
      console.warn('Failed to add modpack with id ', modPackId);
    }
  }

  public async removeMod(modId: string, mcVersion: string) {
    this.settings.mods[mcVersion] ??= {};
    this.deactivateMod(modId, mcVersion);
    if (this.settings.mods[mcVersion][modId]) {
      await fs
        .unlink(
          path.join(
            this.modDirectoryPath,
            mcVersion,
            this.settings.mods[mcVersion][modId].file.filename,
          ),
        )
        .catch(() => null);
      delete this.settings.mods[mcVersion][modId];
    }
    this.saveSettings(mcVersion);
  }

  public async removeModPack(modPackId: string, mcVersion: string) {
    this.settings.modpacks[mcVersion] ??= {};
    this.deactivateModPack(modPackId, mcVersion);
    if (this.settings.modpacks[mcVersion][modPackId]) {
      await fs
        .rm(path.join(this.modPackPath, mcVersion, modPackId), {
          recursive: true,
          force: true,
        })
        .catch(() => null);

      delete this.settings.modpacks[mcVersion][modPackId];
    }
    this.saveSettings(mcVersion);
  }

  private generateModSettings(): ModSettings {
    return {
      active: {},
      modpacks: {},
      mods: {},
    };
  }

  public async modpackIdToModInfo(
    modPackId: string,
    mcVersion: string,
  ): Promise<ModpackInfo> {
    if (this.settings.modpacks[mcVersion]?.[modPackId]) {
      return this.settings.modpacks[mcVersion][modPackId];
    }

    const client = await Modrinth.fromProjectVersion(modPackId, mcVersion);
    if (!client)
      throw new Error('Failed to fetch modrinth version data for modpack file');

    const modpackInfo = client.toModPackInfo();

    this.addModPack(modpackInfo);
    return modpackInfo;
  }

  public async modpackProjectIdToModInfo(
    projectId: string,
    mcVersion: string,
    loader: string
  ): Promise<ModpackInfo> {
    const client = await Modrinth.fromProjectId(projectId, mcVersion, [loader]);
    if (!client)
      throw new Error('Failed to fetch modrinth version data for modpack file');

    const modpackInfo = client.toModPackInfo();

    this.addModPack(modpackInfo);
    return modpackInfo;
  }

  public async modProjectIdToModInfo(
    projectId: string,
    mcVersion: string,
    loader: string,
  ): Promise<ModInfo> {
    const client = await Modrinth.fromProjectId(projectId, mcVersion, [loader]);
    if (!client)
      throw new Error('Failed to fetch modrinth version data for modpack file');
    const modInfo = client.toModInfo();
    this.addMod(modInfo);
    return modInfo;
  }

  public async modIdToModInfo(
    modId: string,
    mcVersion: string,
  ): Promise<ModInfo> {
    if (this.settings.mods[mcVersion]?.[modId]) {
      return this.settings.mods[mcVersion][modId];
    }

    const client = await Modrinth.fromProjectVersion(modId, mcVersion);
    if (!client)
      throw new Error('Failed to fetch modrinth version data for modpack file');
    const modInfo = client.toModInfo();
    this.addMod(modInfo);
    return modInfo;
  }

  private async modFileToModInfo(
    modFile: ModFile,
    mcVersion: string,
  ): Promise<ModInfo> {
    const downloadURL = modFile.downloads.find((url) =>
      url.includes('cdn.modrinth.com'),
    );
    if (!downloadURL)
      throw new Error('No valid download URL found for modpack file');
    const modId = downloadURL.match(/versions\/([a-zA-Z0-9_-]+)\//)?.[1];
    if (!modId) throw new Error('No valid version ID found in download URL');
    return this.modIdToModInfo(modId, mcVersion);
  }

  public getModList(mcVersion: string): ModList {
    const mods = Object.values(this.settings.mods[mcVersion] || {});
    const modpacks = Object.values(this.settings.modpacks[mcVersion] || {});
    const activeMods = this.settings.active[mcVersion]?.mods || [];
    const activeModPacks = this.settings.active[mcVersion]?.modPacks || [];
    return { mods, modpacks, activeMods, activeModPacks, mcVersion };
  }

  get settings() {
    return this.modSettings.get();
  }

  private saveSettings(mcVersion?: string) {
    this.modSettings.requestSave();
    if (mcVersion) {
      global.send('LAUNCHER_MODS', this.getModList(mcVersion));
    }
  }
}

export default ModHandler;
