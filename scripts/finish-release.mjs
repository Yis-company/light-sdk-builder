import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readReleasePlan, retryUntilVisible, verifyRegistryVersion } from './release-policy.mjs'

const entries = await readReleasePlan(process.cwd(), resolve('artifacts/release'))
const releases = JSON.parse(process.env.RELEASE_PACKAGES ?? '[]')
assert(Array.isArray(releases), 'Invalid publication output')
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
for (const { name, version } of releases) {
  const entry = entries.find((entry) => entry.name === name && entry.version === version)
  assert(entry, 'Publication output must match the verified plan')
  // Changesets may plan later betas for latest. Keep the documented @beta install target current too.
  await retryUntilVisible(() => {
    if (entry.tag !== 'beta')
      run('npm', [
        'dist-tag',
        'add',
        `${name}@${version}`,
        'beta',
        '--registry=https://registry.npmjs.org',
      ])
    verifyRegistryVersion(
      JSON.parse(
        run('npm', [
          'view',
          `${name}@${version}`,
          '--json',
          '--registry=https://registry.npmjs.org',
        ]),
      ),
      name,
      version,
    )
  })
  let archive
  if (entry.kind === 'publish') archive = resolve('artifacts/release', entry.tarball.path)
  else {
    const folder = await mkdtemp(join(tmpdir(), 'sdk-published-archive-'))
    const packed = JSON.parse(
      run('npm', [
        'pack',
        `${name}@${version}`,
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        folder,
        '--registry=https://registry.npmjs.org',
      ]),
    )
    archive = resolve(folder, packed[0].filename)
  }
  run('gh', ['release', 'upload', `${name}@${version}`, archive, '--clobber'])
  console.log(`Verified ${name}@${version}, beta tag, provenance and GitHub archive`)
}
