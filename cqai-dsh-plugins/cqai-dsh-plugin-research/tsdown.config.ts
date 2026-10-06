import { defineConfig } from 'tsdown'

const PACKAGE_NAME = 'cqai-dsh-plugin-research'

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
    entry: { client: 'src/client/index.tsx' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    clean: false,
    sourcemap: true,
    dts: false,
    deps: {
      neverBundle: [
        'react',
        'react/jsx-runtime',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-client-ui-layout',
        '@deepseek-ai/dsh-client-ui-renderer',
        '@deepseek-ai/dsh-client-ui-sidebar',
        '@deepseek-ai/dsh-client-ui-slots',
      ],
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
