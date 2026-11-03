module.exports = {
  overrides: [{
    files: ['src/main/src/ai/**/*.ts', 'test/main/local-ai*.test.ts'],
    extends: ['plugin:@typescript-eslint/recommended'],
    parserOptions: { project: null },
    rules: {
      'import/extensions': ['error', 'ignorePackages', { ts: 'never' }],
      'import/no-relative-packages': 'off',
      // These Node modules intentionally serialize native calls and await handlers.
      'no-restricted-syntax': 'off',
      'no-await-in-loop': 'off',
    },
  }, {
    files: ['assets/needle/runtime.cjs', 'native/needle/react-native.config.js', 'esbuild/copyNeedle.js'],
    parserOptions: { project: null },
  }],
  extends: 'erb',
  rules: {
    // A temporary hack related to IDE not resolving correct package.json
    'import/no-extraneous-dependencies': 'off',
    'import/no-unresolved': 'error',
    // Since React 17 and typescript 4.1 you can safely disable the rule
    'react/react-in-jsx-scope': 'off',
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: ['./src/renderer/tsconfig.json', './src/main/tsconfig.json', './tsconfig.tools.json', './cloud/mcp-relay/tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  settings: {
    'import/resolver': {
      // See https://github.com/benmosher/eslint-plugin-import/issues/1396#issuecomment-575727774 for line below
      node: {},
      typescript: {},
    },
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
  },
};
