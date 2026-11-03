import { ResolvedVersion } from '@xmcl/core';
import {
  FabricLoaderArtifact,
  ForgeVersion,
  LabyModManifest,
  QuiltLoaderArtifact,
} from '@xmcl/installer';
import { TaskRunner } from '../TaskRunner';
import { MinecraftLauncherTypes } from '../../../../../common/CommonEnums';
import { ModInfo,ModpackInfo } from '../../../types';

export type MinecraftVersionOptions = {
  launcher: number; // Flags, see MinecraftLauncherTypes.d.ts
  minecraftRoot: string;
  taskRunner?: TaskRunner;
};

export type OptifineLoaderArtifact = {
  version: string;
  editionRelease: string; // e.g. HD_U_G9
};

export type LabyModArtifact = LabyModManifest & { mcVersion: string };

export type ForgeLoaderArtifact = ForgeVersion;

export type VersionData = {
  id: string;
  version: string;
  data:
    | FabricLoaderArtifact
    | OptifineLoaderArtifact
    | QuiltLoaderArtifact
    | ForgeLoaderArtifact
    | LabyModArtifact
    | null;
  mcVersion: ResolvedVersion;
};

export type VersionInfo = {
  id: string;
  type: string;
  launcherType: MinecraftLauncherTypes;
  name: string;
  releaseDate?: string;
};


export type ModSettings = {
  mods: {
    [mcVersion: string]: {
      [modId: string]: ModInfo
    };
  };
  modpacks: {
    [mcVersion: string]: {
      [modpackId: string]: ModpackInfo
    };
  };
  active: {
    [mcVersion: string]: {mods: string[], modPacks: string[]} // active 
  }
};

export interface ModpackIndex {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  files: ModFile[];
  dependencies: ModpackDependencies;
}

export interface ModFile {
  path: string;
  hashes: {
    sha1: string;
    sha512: string;
  };
  env: {
    client: string;
    server: string;
  };
  downloads: string[];
  fileSize: number;
}

export interface ModpackDependencies {
  "fabric-loader": string;
  minecraft: string;
}



