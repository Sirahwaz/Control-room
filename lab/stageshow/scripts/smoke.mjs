import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const root = new URL('../dist/', import.meta.url)
const html = await readFile(new URL('index.html', root), 'utf8')
assert.match(html, /<div id="root"><\/div>/, 'built page exposes the React mount point')

const assets = await readdir(new URL('assets/', root))
const bundles = await Promise.all(assets.filter((name) => name.endsWith('.js')).map((name) => readFile(new URL(join('assets/', name), root), 'utf8')))
const bundle = bundles.join('\n')
for (const phrase of ['ILLUSTRATIVE DEMO', 'Evidence review workflow', 'NO NETWORK', 'Review prepared']) {
  assert.ok(bundle.includes(phrase), `built application includes expected demo content: ${phrase}`)
}
console.log('StageShow build smoke: PASS')
