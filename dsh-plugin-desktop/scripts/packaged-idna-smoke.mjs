/** Verify the archived dependency graph can resolve tr46's npm punycode/ dependency. */
import { createRequire } from 'node:module'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) throw new Error('packaged-idna-smoke: expected the packaged application root')
const require = createRequire(join(root, 'package.json'))
const tr46 = require.resolve('tr46')
const fromTr46 = createRequire(tr46)
const punycode = fromTr46.resolve('punycode/')
if (!punycode.includes('app.asar')) throw new Error(`packaged-idna-smoke: punycode/ did not resolve from the archive: ${punycode}`)
if (fromTr46('punycode/').version === undefined) throw new Error('packaged-idna-smoke: invalid punycode package')
const ascii = require('tr46').toASCII('例子.测试')
if (ascii !== 'xn--fsqu00a.xn--0zwm56d') throw new Error(`packaged-idna-smoke: IDNA conversion returned ${String(ascii)}`)
console.log(`Packaged tr46 resolved punycode/ from ${punycode}`)
