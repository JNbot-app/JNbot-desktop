import type {
  MinecraftServerPluginProject,
  MinecraftServerPluginSearchPage,
  MinecraftServerPluginVersion,
} from '../../../../common/minecraftServers';
import modrinthApi from '../minecraft/launcher/ModrinthApiClient';

export interface ModrinthFile {
  filename: string;
  url: string;
  primary: boolean;
  hashes: { sha1?: string; sha512?: string };
}

export interface ModrinthDependency {
  project_id?: string;
  version_id?: string;
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  version_type: 'release' | 'beta' | 'alpha';
  date_published: string;
  game_versions: string[];
  loaders: string[];
  dependencies: ModrinthDependency[];
  files: ModrinthFile[];
}

interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  icon_url?: string | null;
  downloads: number;
  team?: string;
  client_side: string;
  server_side: string;
}

export default class ModrinthCatalog {
  async search(
    minecraftVersion: string,
    query = '',
    offset = 0,
    limit = 20,
  ): Promise<MinecraftServerPluginSearchPage> {
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const facets = JSON.stringify([
      ['project_type:mod'],
      ['categories:fabric'],
      [`versions:${minecraftVersion}`],
      ['server_side:required', 'server_side:optional'],
      ['client_side:unsupported', 'client_side:optional'],
    ]);
    const data = await modrinthApi.get<{
      hits?: Array<Record<string, any>>;
      offset?: number;
      limit?: number;
      total_hits?: number;
    }>('/search', {
      query: query.trim() || undefined,
      facets,
      index: query.trim() ? 'relevance' : 'downloads',
      offset: safeOffset,
      limit: safeLimit,
    });
    return {
      hits: (data.hits ?? []).map((hit) => ({
        projectId: String(hit.project_id),
        slug: String(hit.slug),
        name: String(hit.title),
        description: String(hit.description ?? ''),
        iconUrl: typeof hit.icon_url === 'string' ? hit.icon_url : undefined,
        author: String(hit.author ?? ''),
        downloads: Number(hit.downloads ?? 0),
        versions: Array.isArray(hit.versions) ? hit.versions.map(String) : [],
      })),
      offset: Number(data.offset ?? safeOffset),
      limit: Number(data.limit ?? safeLimit),
      total: Number(data.total_hits ?? 0),
    };
  }

  async getRawProject(projectId: string): Promise<ModrinthProject> {
    return modrinthApi.get(`/project/${encodeURIComponent(projectId)}`);
  }

  async getVersions(
    projectId: string,
    minecraftVersion: string,
  ): Promise<ModrinthVersion[]> {
    const versions = await modrinthApi.get<ModrinthVersion[]>(
      `/project/${encodeURIComponent(projectId)}/version`,
      {
        game_versions: JSON.stringify([minecraftVersion]),
        loaders: JSON.stringify(['fabric']),
        include_changelog: false,
      },
    );
    return versions.filter(
      (version) =>
        version.game_versions.includes(minecraftVersion) &&
        version.loaders.includes('fabric') &&
        version.files.length > 0,
    );
  }

  async getVersion(versionId: string): Promise<ModrinthVersion> {
    return modrinthApi.get(`/version/${encodeURIComponent(versionId)}`);
  }

  async getProject(
    projectId: string,
    minecraftVersion: string,
  ): Promise<MinecraftServerPluginProject> {
    const [project, versions] = await Promise.all([
      this.getRawProject(projectId),
      this.getVersions(projectId, minecraftVersion),
    ]);
    this.assertServerCompatible(project);
    return {
      projectId: project.id,
      slug: project.slug,
      name: project.title,
      description: project.description,
      body: project.body,
      iconUrl: project.icon_url ?? undefined,
      downloads: project.downloads,
      versions: versions.map(toPublicVersion),
    };
  }

  async resolveVersion(
    projectId: string,
    minecraftVersion: string,
    requestedVersionId?: string,
  ): Promise<ModrinthVersion> {
    this.assertServerCompatible(await this.getRawProject(projectId));
    if (requestedVersionId) {
      const requested = await this.getVersion(requestedVersionId);
      if (
        requested.project_id !== projectId ||
        !requested.game_versions.includes(minecraftVersion) ||
        !requested.loaders.includes('fabric')
      ) {
        throw new Error(
          `Plugin version ${requestedVersionId} is not compatible with Fabric ${minecraftVersion}`,
        );
      }
      return requested;
    }
    const versions = await this.getVersions(projectId, minecraftVersion);
    const selected =
      versions.find((version) => version.version_type === 'release') ??
      versions[0];
    if (!selected)
      throw new Error(
        `No Fabric ${minecraftVersion} version is available for this plugin`,
      );
    return selected;
  }

  assertServerCompatible(project: ModrinthProject): void {
    if (
      !['required', 'optional'].includes(project.server_side) ||
      !['unsupported', 'optional'].includes(project.client_side)
    )
      throw new Error(
        `${project.title} requires a client installation and cannot be used as a server-only plugin`,
      );
  }
}

const toPublicVersion = (
  version: ModrinthVersion,
): MinecraftServerPluginVersion => ({
  id: version.id,
  projectId: version.project_id,
  name: version.name,
  versionNumber: version.version_number,
  versionType: version.version_type,
  publishedAt: version.date_published,
  dependencies: version.dependencies.map((dependency) => ({
    projectId: dependency.project_id,
    versionId: dependency.version_id,
    type: dependency.dependency_type,
  })),
});
