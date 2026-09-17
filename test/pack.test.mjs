import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * A tarball missing `dist/` installs cleanly and then loads no nodes at all,
 * so the packed file list is pinned here rather than read off a publish.
 */

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const REQUIRED = [
  'package.json',
  'README.md',
  'LICENSE.md',
  'dist/icons/qrsalt.svg',
  'dist/icons/qrsalt.dark.svg',
  'dist/nodes/QrSalt/QrSalt.node.json',
  'dist/nodes/QrSalt/QrSaltTrigger.node.json',
  ...pkg.n8n.nodes,
  ...pkg.n8n.credentials,
]

function packedFiles() {
  const args = ['pack', '--dry-run', '--json', '--ignore-scripts']
  const out = execFileSync('npm', args, {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    // `npm.cmd` only runs through a shell.
    shell: process.platform === 'win32',
  })
  return JSON.parse(out)[0].files.map((file) => file.path.replace(/\\/g, '/'))
}

let packed = null
try {
  packed = packedFiles()
} catch {}

test('the tarball carries every file n8n loads', { skip: packed ? false : 'npm pack unavailable' }, () => {
  for (const path of REQUIRED) {
    assert.ok(packed.includes(path), `${path} is missing from the tarball`)
  }
})

test('packing builds first', () => {
  assert.match(pkg.scripts.prepack, /\bbuild\b/)
})
