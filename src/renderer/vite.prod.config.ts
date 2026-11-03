import { defineConfig, mergeConfig } from 'vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import viteImagemin from 'vite-plugin-imagemin';
import developmentConfig from './vite.config';

export default defineConfig(async () => {
  const { viteStaticCopy } = await import('vite-plugin-static-copy');

  return mergeConfig(developmentConfig, {
    plugins: [
      sentryVitePlugin({
        org: 'usserwout',
        project: 'jnbot-react',
        authToken: process.env.SENTRY_AUTH_TOKEN,
        disable: !process.env.SENTRY_AUTH_TOKEN,
      }),
      viteStaticCopy({
        targets: [
          { src: 'assets/_redirects', dest: '.', rename: { stripBase: true } },
          { src: 'assets/favicon.ico', dest: '.', rename: { stripBase: true } },
        ],
      }),
      viteImagemin({
        gifsicle: { optimizationLevel: 7, interlaced: false },
        optipng: { optimizationLevel: 7 },
        mozjpeg: { quality: 80 },
        pngquant: { quality: [0.8, 0.9], speed: 4 },
        svgo: {
          plugins: [
            { name: 'removeViewBox' },
            { name: 'removeEmptyAttrs', active: false },
          ],
        },
      }),
    ],
    build: {
      chunkSizeWarningLimit: 1000,
      minify: 'oxc',
      rolldownOptions: {
        treeshake: {
          manualPureFunctions: ['console.log', 'console.info', 'console.debug'],
        },
      },
      cssCodeSplit: true,
      sourcemap: false,
      assetsInlineLimit: 4096,
    },
    define: {
      __REACT_SCAN_ENABLED__: 'false',
    },
  });
});
