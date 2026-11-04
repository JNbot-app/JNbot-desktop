/**
 * Two test "projects":
 *
 *  - renderer  → jsdom, for React component tests (the existing App.test.tsx).
 *  - main      → node,  for main-process logic (settings/profiles/alts) and the
 *                script-run harness. These import real main-process modules, so
 *                they need a node environment and a mocked `electron`
 *                (see __mocks__/electron.ts).
 *
 * ts-jest runs in `isolatedModules` (transpile-only) mode on purpose: the
 * project tsconfig is intentionally loose / has pre-existing type errors, and
 * here we want to test *runtime behaviour*, not typecheck. Type-stripping only.
 */

const assetMock = {
  '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
    '<rootDir>/__mocks__/fileMock.js',
  '\\.(css|less|sass|scss)$': 'identity-obj-proxy',
};

// baseUrl in tsconfig is ./src, so bare specifiers like `common/x` and
// `renderer/x` resolve from there. Mirror that for Jest.
const aliasMock = {
  '^common/(.*)$': '<rootDir>/src/common/$1',
  '^renderer/(.*)$': '<rootDir>/src/renderer/$1',
  '^main/(.*)$': '<rootDir>/src/main/$1',
  // @ant-design/icons' CommonJS build requires this ESM-only path.
  '^@ant-design/colors/es/(.*)$': '@ant-design/colors/lib/$1',
};

const tsJest = {
  '\\.(ts|tsx|js|jsx)$': [
    'ts-jest',
    {
      isolatedModules: true,
      diagnostics: false,
      // Tests run under the system Node (currently 14.x), which predates
      // logical-assignment (`??=`). Downlevel to ES2019 so transpiled source
      // never emits syntax the test runtime can't parse.
      tsconfig: { target: 'ES2019' },
    },
  ],
};

const moduleFileExtensions = ['ts', 'tsx', 'js', 'jsx', 'json'];

module.exports = {
  testTimeout: 20000,
  // jsdom + antd suites are memory-heavy; one worker per core thrashes and is slower.
  maxWorkers: '50%',
  projects: [
    {
      displayName: 'renderer',
      testEnvironment: 'jsdom',
      setupFilesAfterEnv: ['<rootDir>/src/renderer/setupTests.ts'],
      testMatch: [
        '<rootDir>/src/__tests__/**/*.test.{ts,tsx}',
        '<rootDir>/src/renderer/**/*.test.{ts,tsx}',
      ],
      transform: tsJest,
      moduleNameMapper: { ...aliasMock, ...assetMock },
      moduleFileExtensions,
      moduleDirectories: ['node_modules', 'release/app/node_modules'],
    },
    {
      displayName: 'main',
      testEnvironment: 'node',
      setupFilesAfterEnv: ['<rootDir>/test/main/setupTests.ts'],
      testMatch: ['<rootDir>/test/main/**/*.test.ts'],
      transform: tsJest,
      moduleNameMapper: { ...aliasMock, ...assetMock },
      moduleFileExtensions,
      moduleDirectories: ['node_modules', 'release/app/node_modules'],
    },
  ],
  testPathIgnorePatterns: ['release/app/dist'],
  // The repo has two package.json files (root + release/app) which trip
  // jest-haste-map's name-collision check. We never resolve modules via haste,
  // so ignore the nested one from the haste map.
  modulePathIgnorePatterns: ['<rootDir>/release/app/package.json'],
};
