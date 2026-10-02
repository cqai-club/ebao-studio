import type { UserConfig } from 'tsdown'
export default [{
  entry: {index: 'src/index.ts'},
  platform: 'node', format: 'esm', target: 'es2024', outDir: 'lib', dts: false, fixedExtension: false,
  deps: {neverBundle: ['@deepseek-ai/dsh-atomic-write', '@deepseek-ai/dsh-credentials']},
}, {
  entry: {contracts: 'src/contracts.ts', client: 'src/client.tsx'},
  platform: 'browser', format: 'esm', target: 'es2024', outDir: 'lib', dts: false, fixedExtension: false, clean: false,
  deps: {neverBundle: ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-primitives']},
}] satisfies UserConfig[]
