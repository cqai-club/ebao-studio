import { defineConfig } from 'tsdown'

const PACKAGE_NAME = 'cqai-dsh-plugin-quicknav'

export default defineConfig([
  {
    name: `${PACKAGE_NAME}/host`,
    entry: { index: 'src/index.ts' },
    format: 'esm',
    dts: true,
    clean: true,
    outDir: 'lib',
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    external: [/^@deepseek-ai\//, /^dsh-better-sidebar/],
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.tsx' },
    tsconfig: 'tsconfig.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    clean: false,
    sourcemap: true,
    dts: false,
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-renderer',
      'dsh-better-sidebar',
      'dsh-better-sidebar/client/service',
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
