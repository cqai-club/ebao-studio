import { defineConfig } from 'tsdown'

const name = '@cqaiclub/dsh-plugin-extension'

export default defineConfig([
  {
    name: 'club-extension/host',
    entry: { index: 'src/index.ts' },
    format: 'esm',
    dts: true,
    clean: true,
    outDir: 'lib',
    deps: { neverBundle: [/^@deepseek-ai\//, /^@modelcontextprotocol\//] },
  },
  {
    name: 'club-extension/client',
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    clean: false,
    sourcemap: true,
    dts: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom', /^@deepseek-ai\//] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
