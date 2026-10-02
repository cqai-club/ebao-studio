import type { UserConfig } from 'tsdown'
const id = 'cqai-dsh-plugin-talkcraft'
export default [
  { entry: { index: 'src/index.ts' }, platform: 'node', format: 'esm', target: 'es2024', outDir: 'lib', dts: false, clean: false, fixedExtension: false,
    deps: { neverBundle: [/^@deepseek-ai\//, 'cqai-dsh-plugin-media-runtime', 'cqai-dsh-media-settings'] } },
  { entry: { client: 'src/client/index.tsx' }, platform: 'browser', format: 'cjs', target: 'es2022', outDir: 'lib', dts: false, clean: false,
    loader: { '.svg': 'dataurl' },
    deps: { alwaysBundle: [/^cqai-dsh-media-settings(?:\/.*)?$/], neverBundle: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives'] },
    define: { 'process.env.NODE_ENV': '"production"' },
    outputOptions: { entryFileNames: 'client.js', banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`, intro: 'var module = { exports: {} }; var exports = module.exports;', footer: 'return module.exports; } });' }
  }
] satisfies UserConfig[]
