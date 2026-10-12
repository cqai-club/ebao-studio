import type { UserConfig } from 'tsdown'
import { dirname, resolve } from 'node:path'
const id = 'cqai-dsh-plugin-publisher'
export default [
  {
    entry: {index: 'src/index.ts'},
    platform: 'node',
    format: 'esm',
    target: 'es2024',
    outDir: 'lib',
    dts: false,
    clean: false,
    fixedExtension: false,
    loader: { '.md': 'text' },
    plugins: [{
      name: 'publisher-skill-markdown',
      resolveId(source, importer) {
        if (importer && source.endsWith('.md?raw')) return resolve(dirname(importer), source.slice(0, -4))
      },
    }],
    deps: {neverBundle: [/^@deepseek-ai\//]},
  },
  {
    entry: {client: 'src/client/index.tsx'},
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    outDir: 'lib',
    dts: false,
    clean: false,
    loader: { '.svg': 'dataurl' },
    deps: {
      neverBundle: [
        'react',
        'react/jsx-runtime',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-client-ui-primitives',
        '@deepseek-ai/dsh-client-ui-slots',
      ],
      // DSH's browser module table only provides platform packages. Its loader
      // cannot resolve markdown-it (or its transitive dependencies) at runtime.
      alwaysBundle: ['markdown-it'],
    },
    define: {'process.env.NODE_ENV': '"production"'},
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
] satisfies UserConfig[]
