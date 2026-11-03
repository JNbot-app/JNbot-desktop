import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import { app } from 'electron';
import type {
  MinecraftServerPlugin,
  MinecraftServerPluginProject,
  MinecraftServerPluginSearchPage,
} from '../../../../common/minecraftServers';
import ModrinthCatalog, {
  type ModrinthFile,
  type ModrinthVersion,
} from './ModrinthCatalog';
import { normalizeModrinthError } from '../minecraft/launcher/ModrinthApiClient';

interface PluginServer {
  id: string;
  version: string;
  directory: string;
  running: boolean;
}

interface RootPlugin {
  projectId: string;
  versionId: string;
}

interface ManagedArtifact {
  projectId: string;
  versionId: string;
  name: string;
  description?: string;
  versionNumber: string;
  filename: string;
  url: string;
  hashes: { sha1?: string; sha512?: string };
  iconUrl?: string;
  root: boolean;
  dependencies: Array<{
    projectId: string;
    versionId: string;
    name: string;
  }>;
}

interface PluginManifest {
  version: 1;
  desiredRoots: RootPlugin[];
  desiredArtifacts: ManagedArtifact[];
  appliedRoots: RootPlugin[];
  appliedArtifacts: ManagedArtifact[];
}

const emptyManifest = (): PluginManifest => ({
  version: 1,
  desiredRoots: [],
  desiredArtifacts: [],
  appliedRoots: [],
  appliedArtifacts: [],
});
const FABRIC_API_PROJECT_ID = 'P7dR8mSH';

export default class MinecraftServerPluginManager {
  readonly catalog = new ModrinthCatalog();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly snapshots = new Map<string, PluginManifest>();
  private readonly cacheDirectory = path.join(
    app.getPath('userData'),
    'minecraft-mod-cache',
  );

  constructor(
    private readonly getServer: (id: string) => PluginServer,
    private readonly onChanged: (id: string) => void,
  ) {}

  private manifestPath(server: PluginServer) {
    return path.join(server.directory, '.jnbot', 'plugins.json');
  }

  private async load(server: PluginServer): Promise<PluginManifest> {
    const cached = this.snapshots.get(server.id);
    if (cached) return cached;
    const manifest = await fsp
      .readFile(this.manifestPath(server), 'utf8')
      .then((value) => JSON.parse(value) as PluginManifest)
      .catch(() => emptyManifest());
    const safe =
      manifest?.version === 1 &&
      Array.isArray(manifest.desiredRoots) &&
      Array.isArray(manifest.desiredArtifacts) &&
      Array.isArray(manifest.appliedRoots) &&
      Array.isArray(manifest.appliedArtifacts)
        ? manifest
        : emptyManifest();
    this.snapshots.set(server.id, safe);
    return safe;
  }

  private async save(server: PluginServer, manifest: PluginManifest) {
    const destination = this.manifestPath(server);
    await fsp.mkdir(path.dirname(destination), {
      recursive: true,
      mode: 0o700,
    });
    const partial = `${destination}.part`;
    await fsp.writeFile(partial, JSON.stringify(manifest, null, 2), 'utf8');
    await fsp.rename(partial, destination);
    this.snapshots.set(server.id, manifest);
  }

  private enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.queues.set(id, current);
    void current.then(
      () => {
        if (this.queues.get(id) === current) this.queues.delete(id);
      },
      () => {
        if (this.queues.get(id) === current) this.queues.delete(id);
      },
    );
    return current;
  }

  async state(
    id: string,
  ): Promise<{ pluginCount: number; restartRequired: boolean }> {
    const manifest = await this.load(this.getServer(id));
    return {
      pluginCount: manifest.desiredRoots.length,
      restartRequired: !sameRoots(manifest.desiredRoots, manifest.appliedRoots),
    };
  }

  stateSync(id: string): { pluginCount: number; restartRequired: boolean } {
    const manifest = this.snapshots.get(id);
    return manifest
      ? {
          pluginCount: manifest.desiredRoots.length,
          restartRequired: !sameRoots(
            manifest.desiredRoots,
            manifest.appliedRoots,
          ),
        }
      : { pluginCount: 0, restartRequired: false };
  }

  async list(id: string): Promise<MinecraftServerPlugin[]> {
    const manifest = await this.load(this.getServer(id));
    const desired = new Map(
      manifest.desiredArtifacts.map((artifact) => [
        artifact.projectId,
        artifact,
      ]),
    );
    const applied = new Map(
      manifest.appliedArtifacts.map((artifact) => [
        artifact.projectId,
        artifact,
      ]),
    );
    const plugins: MinecraftServerPlugin[] = [
      ...new Set([...desired.keys(), ...applied.keys()]),
    ].map((projectId) => {
      const wanted = desired.get(projectId);
      const current = applied.get(projectId);
      const artifact = wanted ?? current!;
      const pendingChange: MinecraftServerPlugin['pendingChange'] =
        !wanted && current
          ? 'remove'
          : wanted && !current
            ? 'install'
            : wanted?.versionId !== current?.versionId
              ? 'update'
              : undefined;
      return {
        projectId,
        versionId: artifact.versionId,
        name: artifact.name,
        description: artifact.description,
        versionNumber: artifact.versionNumber,
        filename: artifact.filename,
        iconUrl: artifact.iconUrl,
        installed: Boolean(current),
        dependency: !artifact.root,
        pendingChange,
        dependencies: artifact.dependencies,
      };
    });
    await Promise.all(
      plugins
        .filter(
          (plugin) => !plugin.dependency && plugin.pendingChange !== 'remove',
        )
        .map(async (plugin) => {
          const latest = await this.catalog
            .resolveVersion(plugin.projectId, this.getServer(id).version)
            .catch(() => undefined);
          if (latest && latest.id !== plugin.versionId) {
            plugin.updateVersionId = latest.id;
            plugin.updateVersionNumber = latest.version_number;
          }
        }),
    );
    return plugins;
  }

  search(
    id: string,
    query?: string,
    offset?: number,
    limit?: number,
  ): Promise<MinecraftServerPluginSearchPage> {
    const server = this.getServer(id);
    return this.catalog.search(server.version, query, offset, limit);
  }

  project(
    id: string,
    projectId: string,
  ): Promise<MinecraftServerPluginProject> {
    return this.catalog.getProject(projectId, this.getServer(id).version);
  }

  install(
    id: string,
    projectId: string,
    versionId?: string,
  ): Promise<MinecraftServerPlugin[]> {
    return this.enqueue(id, async () => {
      if (projectId === FABRIC_API_PROJECT_ID)
        throw new Error('Fabric API is managed automatically by JNbot');
      const server = this.getServer(id);
      const current = await this.load(server);
      const rootVersion = await this.catalog.resolveVersion(
        projectId,
        server.version,
        versionId,
      );
      const desiredRoots = [
        ...current.desiredRoots.filter((root) => root.projectId !== projectId),
        { projectId, versionId: rootVersion.id },
      ];
      const desiredArtifacts = await this.resolveGraph(
        server.version,
        desiredRoots,
      );
      await this.prepareArtifacts(desiredArtifacts);
      const next: PluginManifest = {
        ...current,
        desiredRoots,
        desiredArtifacts,
      };
      if (server.running) await this.save(server, next);
      else await this.apply(server, next);
      this.onChanged(id);
      return this.list(id);
    });
  }

  remove(id: string, projectId: string): Promise<MinecraftServerPlugin[]> {
    return this.enqueue(id, async () => {
      const server = this.getServer(id);
      const current = await this.load(server);
      const desiredRoots = current.desiredRoots.filter(
        (root) => root.projectId !== projectId,
      );
      if (desiredRoots.length === current.desiredRoots.length)
        throw new Error('Only directly installed plugins can be removed');
      const desiredArtifacts = await this.resolveGraph(
        server.version,
        desiredRoots,
      );
      await this.prepareArtifacts(desiredArtifacts);
      const next: PluginManifest = {
        ...current,
        desiredRoots,
        desiredArtifacts,
      };
      if (server.running) await this.save(server, next);
      else await this.apply(server, next);
      this.onChanged(id);
      return this.list(id);
    });
  }

  applyPending(id: string): Promise<void> {
    return this.enqueue(id, async () => {
      const server = this.getServer(id);
      if (server.running)
        throw new Error('Stop the Minecraft server before applying plugins');
      const manifest = await this.load(server);
      if (sameRoots(manifest.desiredRoots, manifest.appliedRoots)) return;
      await this.prepareArtifacts(manifest.desiredArtifacts);
      await this.apply(server, manifest);
      this.onChanged(id);
    });
  }

  forget(id: string) {
    this.snapshots.delete(id);
    this.queues.delete(id);
  }

  private async resolveGraph(
    minecraftVersion: string,
    roots: RootPlugin[],
  ): Promise<ManagedArtifact[]> {
    const resolved = new Map<string, ManagedArtifact>();
    const visiting = new Set<string>();
    const rootIds = new Set(roots.map((root) => root.projectId));

    const visit = async (
      version: ModrinthVersion,
    ): Promise<ManagedArtifact> => {
      const existing = resolved.get(version.project_id);
      if (existing) {
        if (existing.versionId !== version.id)
          throw new Error(
            `Conflicting versions are required for ${existing.name}`,
          );
        return existing;
      }
      if (visiting.has(version.id))
        throw new Error('A cyclic required plugin dependency was detected');
      visiting.add(version.id);
      if (
        !version.game_versions.includes(minecraftVersion) ||
        !version.loaders.includes('fabric')
      )
        throw new Error(
          `${version.name} is not compatible with Fabric ${minecraftVersion}`,
        );
      const project = await this.catalog.getRawProject(version.project_id);
      this.catalog.assertServerCompatible(project);
      const file = primaryJar(version.files);
      const artifact: ManagedArtifact = {
        projectId: version.project_id,
        versionId: version.id,
        name: project.title,
        description: project.description,
        versionNumber: version.version_number,
        filename: path.basename(file.filename),
        url: file.url,
        hashes: file.hashes,
        iconUrl: project.icon_url ?? undefined,
        root: rootIds.has(version.project_id),
        dependencies: [],
      };
      resolved.set(version.project_id, artifact);
      for (const dependency of version.dependencies) {
        if (dependency.dependency_type !== 'required') continue;
        let dependencyVersion: ModrinthVersion;
        if (dependency.version_id) {
          dependencyVersion = await this.catalog.getVersion(
            dependency.version_id,
          );
        } else if (dependency.project_id) {
          dependencyVersion = await this.catalog.resolveVersion(
            dependency.project_id,
            minecraftVersion,
          );
        } else {
          throw new Error(`${project.title} has an unresolved dependency`);
        }
        if (dependencyVersion.project_id === FABRIC_API_PROJECT_ID) continue;
        const child = await visit(dependencyVersion);
        artifact.dependencies.push({
          projectId: child.projectId,
          versionId: child.versionId,
          name: child.name,
        });
      }
      visiting.delete(version.id);
      return artifact;
    };

    for (const root of roots) {
      const version = await this.catalog.resolveVersion(
        root.projectId,
        minecraftVersion,
        root.versionId,
      );
      await visit(version);
    }
    for (const artifact of resolved.values())
      artifact.root = rootIds.has(artifact.projectId);
    return [...resolved.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async prepareArtifacts(artifacts: ManagedArtifact[]) {
    await fsp.mkdir(this.cacheDirectory, { recursive: true, mode: 0o700 });
    for (const artifact of artifacts) {
      const hash = artifact.hashes.sha512 ?? artifact.hashes.sha1;
      if (!hash)
        throw new Error(`${artifact.name} does not provide a file hash`);
      const cached = this.cachePath(artifact);
      if (await verifyFile(cached, artifact.hashes)) continue;
      const response = await axios
        .get<ArrayBuffer>(artifact.url, {
          responseType: 'arraybuffer',
          timeout: 120_000,
          headers: {
            'User-Agent': 'JNbot/1.0.0 (https://jnbot.netlify.app/)',
          },
        })
        .catch((error) => {
          throw normalizeModrinthError(error);
        });
      const partial = `${cached}.part-${crypto.randomUUID()}`;
      await fsp.writeFile(partial, Buffer.from(response.data), { mode: 0o600 });
      if (!(await verifyFile(partial, artifact.hashes))) {
        await fsp.unlink(partial).catch(() => undefined);
        throw new Error(`Hash verification failed for ${artifact.name}`);
      }
      await fsp.rename(partial, cached);
    }
  }

  private cachePath(artifact: ManagedArtifact) {
    const hash = artifact.hashes.sha512 ?? artifact.hashes.sha1!;
    return path.join(this.cacheDirectory, `${hash}.jar`);
  }

  private async apply(server: PluginServer, manifest: PluginManifest) {
    const modsDirectory = path.join(server.directory, 'mods');
    const staging = path.join(
      server.directory,
      '.jnbot',
      `apply-${crypto.randomUUID()}`,
    );
    const backupDirectory = path.join(staging, 'backup');
    await fsp.mkdir(modsDirectory, { recursive: true, mode: 0o700 });
    await fsp.mkdir(staging, { recursive: true, mode: 0o700 });
    const previouslyOwned = new Set(
      manifest.appliedArtifacts.map((artifact) => artifact.filename),
    );
    const installed = new Set<string>();
    const backups = new Map<string, string>();
    try {
      const desiredByFilename = new Map<string, string>();
      for (const artifact of manifest.desiredArtifacts) {
        const hash = artifact.hashes.sha512 ?? artifact.hashes.sha1!;
        const existingHash = desiredByFilename.get(artifact.filename);
        if (existingHash && existingHash !== hash)
          throw new Error(
            `Multiple plugins require different files named ${artifact.filename}`,
          );
        desiredByFilename.set(artifact.filename, hash);
        const destination = path.join(modsDirectory, artifact.filename);
        if (
          fs.existsSync(destination) &&
          !previouslyOwned.has(artifact.filename) &&
          !(await verifyFile(destination, artifact.hashes))
        ) {
          throw new Error(
            `${artifact.filename} already exists and is not managed by JNbot`,
          );
        }
        const staged = path.join(staging, artifact.filename);
        await fsp
          .link(this.cachePath(artifact), staged)
          .catch(() => fsp.copyFile(this.cachePath(artifact), staged));
      }
      await fsp.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
      for (const artifact of manifest.appliedArtifacts) {
        const destination = path.join(modsDirectory, artifact.filename);
        if (!fs.existsSync(destination)) continue;
        const backup = path.join(backupDirectory, artifact.filename);
        await fsp.rename(destination, backup);
        backups.set(destination, backup);
      }
      for (const artifact of manifest.desiredArtifacts) {
        const destination = path.join(modsDirectory, artifact.filename);
        if (!fs.existsSync(destination)) {
          await fsp.rename(path.join(staging, artifact.filename), destination);
          installed.add(destination);
        }
      }
      const applied: PluginManifest = {
        ...manifest,
        appliedRoots: manifest.desiredRoots.map((root) => ({ ...root })),
        appliedArtifacts: manifest.desiredArtifacts.map((artifact) => ({
          ...artifact,
          dependencies: artifact.dependencies.map((dependency) => ({
            ...dependency,
          })),
        })),
      };
      await this.save(server, applied);
    } catch (error) {
      for (const destination of installed)
        await fsp.unlink(destination).catch(() => undefined);
      for (const [destination, backup] of backups)
        await fsp.rename(backup, destination).catch(() => undefined);
      throw error;
    } finally {
      await fsp.rm(staging, { recursive: true, force: true });
    }
  }
}

const primaryJar = (files: ModrinthFile[]) => {
  const jars = files.filter((file) =>
    file.filename.toLowerCase().endsWith('.jar'),
  );
  const selected = jars.find((file) => file.primary) ?? jars[0];
  if (!selected) throw new Error('The selected plugin version has no JAR file');
  return selected;
};

const sameRoots = (left: RootPlugin[], right: RootPlugin[]) => {
  if (left.length !== right.length) return false;
  const expected = new Map(
    left.map((root) => [root.projectId, root.versionId]),
  );
  return right.every((root) => expected.get(root.projectId) === root.versionId);
};

const verifyFile = async (
  filePath: string,
  hashes: { sha1?: string; sha512?: string },
) => {
  const expected = (
    [
      ['sha512', hashes.sha512],
      ['sha1', hashes.sha1],
    ] as const
  ).filter((entry): entry is readonly ['sha512' | 'sha1', string] =>
    Boolean(entry[1]),
  );
  if (!expected.length) return false;
  try {
    const data = await fsp.readFile(filePath);
    return expected.every(
      ([algorithm, hash]) =>
        crypto.createHash(algorithm).update(data).digest('hex') === hash,
    );
  } catch {
    return false;
  }
};
