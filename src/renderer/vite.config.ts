import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import buildSecrets from '../../esbuild/buildSecrets';

// react-virtualized 9.22.5 exports a removed Flow type from onScroll.js.
// Apply the same narrow transform in dev dependency optimization and builds.
const reactVirtualizedFix = {
  name: 'react-virtualized-flow-export',
  transform: {
    filter: {
      id: /react-virtualized[/\\]dist[/\\]es[/\\]WindowScroller[/\\]utils[/\\]onScroll\.js$/,
    },
    handler(code: string) {
      return code.replace(
        /import\s*\{\s*bpfrpt_proptype_WindowScroller\s*\}\s*from\s*["']\.\.\/WindowScroller\.js["'];?/,
        '',
      );
    },
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), reactVirtualizedFix],
  root: __dirname,
  // output
  build: {
    outDir: '../../release/app/dist/renderer',
    emptyOutDir: false,
    rolldownOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        chunkFileNames: 'assets/chunks/[name]-[hash].js',
        entryFileNames: 'assets/entries/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: {
      renderer: path.resolve(__dirname, '.'),
      main: path.resolve(__dirname, '../main'),
      common: path.resolve(__dirname, '../common'),
    },
  },
  define: {
    // By default, Vite doesn't include shims for NodeJS/
    // necessary for segment analytics lib to work
    global: {},
    process: { env: {} },
    'process.type': '"renderer"',
    __SENTRY_DIAGNOSTICS_ENABLED__: JSON.stringify(
      process.env.SENTRY_DIAGNOSTICS === 'true',
    ),
    __REACT_SCAN_ENABLED__: JSON.stringify(process.env.REACT_SCAN === 'true'),
    ...buildSecrets,
  },
  optimizeDeps: {
    rolldownOptions: { plugins: [reactVirtualizedFix] },
  },
  server: {
    port: 1212,
    strictPort: true,
    open: false,
  },
});
