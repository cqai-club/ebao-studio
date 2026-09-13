import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: true,
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
  noExternal: (source: string) => (
    source === 'react'
      || source === 'react/jsx-runtime'
      || source === 'react-dom'
      || source === '@deepseek-ai/dsh-client-ui-primitives'
      ? undefined
      : true
  ),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@cqaiclub/dsn-account", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
