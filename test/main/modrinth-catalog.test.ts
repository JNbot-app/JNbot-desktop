import ModrinthCatalog from '../../src/main/src/functions/minecraftServer/ModrinthCatalog';
import modrinthApi from '../../src/main/src/functions/minecraft/launcher/ModrinthApiClient';

jest.mock('../../src/main/src/functions/minecraft/launcher/ModrinthApiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

describe('ModrinthCatalog', () => {
  let catalog: ModrinthCatalog;
  const mockedApi = modrinthApi as jest.Mocked<typeof modrinthApi>;

  beforeEach(() => {
    catalog = new ModrinthCatalog();
    jest.clearAllMocks();
  });

  describe('assertServerCompatible', () => {
    it('passes for projects with valid server and client side tags', () => {
      expect(() =>
        catalog.assertServerCompatible({
          id: 'mod-1',
          title: 'Server Core',
          server_side: 'required',
          client_side: 'optional',
        } as any),
      ).not.toThrow();

      expect(() =>
        catalog.assertServerCompatible({
          id: 'mod-2',
          title: 'Server Util',
          server_side: 'optional',
          client_side: 'unsupported',
        } as any),
      ).not.toThrow();
    });

    it('throws when server_side is unsupported or missing', () => {
      expect(() =>
        catalog.assertServerCompatible({
          id: 'client-only-mod',
          title: 'HUD Mod',
          server_side: 'unsupported',
          client_side: 'required',
        } as any),
      ).toThrow(/requires a client installation and cannot be used as a server-only plugin/);
    });

    it('throws when client_side is required', () => {
      expect(() =>
        catalog.assertServerCompatible({
          id: 'mod-both',
          title: 'Voice Chat',
          server_side: 'required',
          client_side: 'required',
        } as any),
      ).toThrow(/requires a client installation/);
    });
  });

  describe('search', () => {
    it('normalizes offset and limit and parses search hits', async () => {
      mockedApi.get.mockResolvedValueOnce({
        hits: [
          {
            project_id: 'proj-1',
            slug: 'lithium',
            title: 'Lithium',
            description: 'Optimization mod',
            author: 'jellysquid',
            downloads: 5000000,
            versions: ['v1', 'v2'],
          },
        ],
        offset: 0,
        limit: 20,
        total_hits: 1,
      });

      const page = await catalog.search('1.20.4', 'lithium', -5, 200);

      expect(mockedApi.get).toHaveBeenCalledWith('/search', expect.objectContaining({
        query: 'lithium',
        offset: 0, // Clamped to min 0
        limit: 100, // Clamped to max 100
      }));

      expect(page.hits).toHaveLength(1);
      expect(page.hits[0].slug).toBe('lithium');
      expect(page.hits[0].downloads).toBe(5000000);
      expect(page.total).toBe(1);
    });
  });

  describe('resolveVersion', () => {
    const mockProject = {
      id: 'proj-1',
      title: 'Lithium',
      server_side: 'required',
      client_side: 'optional',
    };

    it('resolves requestedVersionId when compatible', async () => {
      mockedApi.get
        .mockResolvedValueOnce(mockProject) // getRawProject
        .mockResolvedValueOnce({
          id: 'ver-123',
          project_id: 'proj-1',
          game_versions: ['1.20.4'],
          loaders: ['fabric'],
        }); // getVersion

      const resolved = await catalog.resolveVersion('proj-1', '1.20.4', 'ver-123');
      expect(resolved.id).toBe('ver-123');
    });

    it('throws when requestedVersionId does not match minecraftVersion', async () => {
      mockedApi.get
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce({
          id: 'ver-123',
          project_id: 'proj-1',
          game_versions: ['1.19.2'],
          loaders: ['fabric'],
        });

      await expect(catalog.resolveVersion('proj-1', '1.20.4', 'ver-123')).rejects.toThrow(
        /is not compatible with Fabric 1.20.4/,
      );
    });

    it('selects release version by default over beta/alpha', async () => {
      mockedApi.get
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce([
          {
            id: 'ver-beta',
            version_type: 'beta',
            game_versions: ['1.20.4'],
            loaders: ['fabric'],
            files: [{ filename: 'b.jar' }],
          },
          {
            id: 'ver-release',
            version_type: 'release',
            game_versions: ['1.20.4'],
            loaders: ['fabric'],
            files: [{ filename: 'r.jar' }],
          },
        ]);

      const selected = await catalog.resolveVersion('proj-1', '1.20.4');
      expect(selected.id).toBe('ver-release');
    });

    it('throws when no matching version exists for minecraft version', async () => {
      mockedApi.get
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce([]); // No versions

      await expect(catalog.resolveVersion('proj-1', '1.20.4')).rejects.toThrow(
        'No Fabric 1.20.4 version is available for this plugin',
      );
    });
  });
});
