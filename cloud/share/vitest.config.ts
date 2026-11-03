import path from 'node:path';
import {
  defineWorkersConfig,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => ({
  test: {
    setupFiles: ['./test/setup.ts'],
    poolOptions: {
      workers: {
        // Isolated storage trips over R2/D1 SQLite WAL files; tests use fresh keys instead.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          compatibilityDate: '2025-09-06',
          bindings: {
            TEST_MIGRATIONS: await readD1Migrations(
              path.join(__dirname, 'migrations'),
            ),
          },
        },
      },
    },
  },
}));
