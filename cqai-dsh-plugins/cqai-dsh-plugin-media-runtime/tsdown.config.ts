import type { UserConfig } from 'tsdown'
export default {entry: {index: 'src/index.ts'}, platform: 'node', format: 'esm', target: 'es2024', outDir: 'lib', dts: false, fixedExtension: false,
  deps: {neverBundle: ['@dataiku/uv', 'npm']}} satisfies UserConfig
