import type {
  Project,
  ProjectVersion,
  SearchProjectOptions,
  SearchResult,
} from '@xmcl/modrinth';
import { ModInfo, ModpackInfo } from '../../../types';
import modrinthApi from './ModrinthApiClient';

class Modrinth {
  public projectVersion: ProjectVersion;
  public project: Project;
  public mcVersion: string;

  constructor(options: {
    projectVersion: ProjectVersion;
    mcVersion: string;
    project: Project;
  }) {
    this.projectVersion = options.projectVersion;
    this.mcVersion = options.mcVersion;
    this.project = options.project;
  }

  static async fromProjectId(
    projectId: string,
    minecraftVersion: string,
    loaders?: string[],
  ) {
    const [projectVersions, project] = await Promise.all([
      modrinthApi.get<ProjectVersion[]>(
        `/project/${encodeURIComponent(projectId)}/version`,
        {
          game_versions: JSON.stringify([minecraftVersion]),
          loaders: loaders ? JSON.stringify(loaders) : undefined,
        },
      ),
      modrinthApi.get<Project>(`/project/${encodeURIComponent(projectId)}`),
    ]);

    if (!projectVersions || projectVersions.length === 0) return null;

    return new Modrinth({
      projectVersion: projectVersions[0],
      mcVersion: minecraftVersion,
      project,
    });
  }

  static async fromProjectVersion(
    projectVersion: string,
    minecraftVersion: string,
  ) {
    const version = await modrinthApi.get<ProjectVersion>(
      `/version/${encodeURIComponent(projectVersion)}`,
    );
    if (!version) return null;
    const project = await modrinthApi.get<Project>(
      `/project/${encodeURIComponent(version.project_id)}`,
    );

    return new Modrinth({
      projectVersion: version,
      mcVersion: minecraftVersion,
      project,
    });
  }

  static async fromProjectVersionAndProjectId(
    projectVersion: string,
    projectId: string,
    minecraftVersion: string,
  ) {
    const [version, project] = await Promise.all([
      modrinthApi.get<ProjectVersion>(
        `/version/${encodeURIComponent(projectVersion)}`,
      ),
      modrinthApi.get<Project>(`/project/${encodeURIComponent(projectId)}`),
    ]);

    if (!version) return null;

    return new Modrinth({
      projectVersion: version,
      mcVersion: minecraftVersion,
      project,
    });
  }

  toModInfo(): ModInfo {
    const file = this.projectVersion.files[0];
    if (!file) {
      throw new Error('No files found for this mod version');
    }

    return {
      id: this.projectVersion.id,
      name: this.project.title,
      versionNumber: this.projectVersion.version_number,
      mcVersion: this.mcVersion,
      file: {
        filename: file.filename,
        id: file.hashes.sha1,
        url: file.url,
      },
      projectId: this.project.id,
      iconUrl: this.project.icon_url,
    };
  }

  toModPackInfo(): ModpackInfo {
    const modInfo = this.toModInfo();
    return {
      ...modInfo,
      indexFile: modInfo.file.filename.replace(/\.mrpack$/i, ''),
    };
  }

  static getProject(projectId: string) {
    return modrinthApi.get<Project>(
      `/project/${encodeURIComponent(projectId)}`,
    );
  }

  static queryMods(searchOptions: SearchProjectOptions) {
    return modrinthApi.get<SearchResult>('/search', searchOptions);
  }
}

export default Modrinth;
