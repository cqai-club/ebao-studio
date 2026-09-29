import { defineConfig } from 'tsdown'

const PACKAGE_NAME = 'cqai-dsh-plugin-cqai-club-theme'

export default defineConfig([
  {
    name: `${PACKAGE_NAME}/host`,
    entry: { index: 'src/index.ts' },
    format: 'esm',
    dts: true,
    clean: true,
    outDir: 'lib',
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    clean: false,
    sourcemap: true,
    dts: false,
    // The Client bundle runs through the DSH module loader, so keep wallpaper
    // bytes inside client.js instead of depending on a separate asset route.
    loader: { '.webp': 'dataurl' },
    external: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-settings-general',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-theme',
      'react',
      'react/jsx-runtime',
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
