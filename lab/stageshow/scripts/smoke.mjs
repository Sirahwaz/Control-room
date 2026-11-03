import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const root = new URL('../../../', import.meta.url)
const html = await readFile(new URL('stageshow-preview.html', root), 'utf8')
const javascript = await readFile(new URL('stageshow-preview.js', root), 'utf8')
const stylesheet = await readFile(new URL('stageshow-preview.css', root), 'utf8')
assert.match(html, /<div id="root"><\\/div>/, 'root Pages entry exposes the React mount point')
for (const phrase of ['ILLUSTRATIVE DEMO', 'Evidence review workflow', 'NO NETWORK', 'Review prepared']) {
  assert.ok(javascript.includes(phrase), `built application includes expected demo content: ${phrase}`)
}
assert.ok(stylesheet.includes('.scene'), 'the responsive demo stylesheet is emitted at the Pages root')
console.log('StageShow root Pages smoke: PASS')
