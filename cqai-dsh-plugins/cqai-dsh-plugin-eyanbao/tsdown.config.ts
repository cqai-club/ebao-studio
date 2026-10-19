import type { UserConfig } from 'tsdown'

const id = 'cqai-dsh-plugin-eyanbao'

export default [
  {
    entry: { index: 'src/index.ts', protocol: 'src/protocol.ts' },
    platform: 'node',
    format: 'esm',
    target: 'es2024',
    outDir: 'lib',
    dts: false,
    clean: true,
    fixedExtension: false,
    deps: { neverBundle: [/^@deepseek-ai\//, 'docx'] },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    outDir: 'lib',
    dts: false,
    clean: false,
    loader: { '.svg': 'dataurl' },
    deps: {
      alwaysBundle: ['lucide-react'],
      neverBundle: [
        'react',
        'react/jsx-runtime',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-client-ui-layout',
        '@deepseek-ai/dsh-client-ui-primitives',
        '@deepseek-ai/dsh-client-ui-renderer',
        '@deepseek-ai/dsh-client-ui-sidebar',
        '@deepseek-ai/dsh-client-ui-slots',
      ],
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
] satisfies UserConfig[]
