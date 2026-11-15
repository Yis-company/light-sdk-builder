import assert from 'node:assert/strict'
import { appendFile, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const releasePackages = ['core', 'auth', 'react', 'tanstack-query', 'eslint-plugin']
const packageChecks = ['package (22)', 'package (24)', 'package (26)']

export function trustedReleaseEvent(eventName, payload, repository, ref) {
  if (eventName === 'workflow_dispatch') return ref === 'refs/heads/main'
  const run = payload.workflow_run
  return (
    eventName === 'workflow_run' &&
    run?.event === 'push' &&
    run.head_branch === 'main' &&
    run.head_repository?.full_name === repository &&
    run.conclusion === 'success'
  )
}

export function verifiedCheck(run, jobs, repository, sha) {
  return (
    run?.head_sha === sha &&
    run.head_branch === 'main' &&
    run.head_repository?.full_name === repository &&
    ['push', 'workflow_dispatch'].includes(run.event) &&
    run.conclusion === 'success' &&
    packageChecks.every((name) =>
      jobs.some(
        (job) => job.name === name && job.status === 'completed' && job.conclusion === 'success',
      ),
    )
  )
}

export function validateReleasePlan(plan, manifests, folder) {
  assert.equal(plan.version, 1, 'Unsupported Changesets publish plan')
  assert(Array.isArray(plan.plan) && plan.plan.every(Array.isArray), 'Invalid publish plan')
  const packages = new Map(manifests.map((manifest) => [manifest.name, manifest]))
  const seen = new Set()
  return plan.plan.flat().map((entry) => {
    const manifest = packages.get(entry.name)
    assert(manifest && !manifest.private, `Unexpected public package: ${entry.name}`)
    assert(!seen.has(entry.name), `Duplicate release: ${entry.name}`)
    seen.add(entry.name)
    assert.equal(entry.version, manifest.version, `Version mismatch: ${entry.name}`)
    assert(/^0\.\d+\.\d+-beta\.\d+$/.test(entry.version), 'Only pre-1.0 beta releases are enabled')
    assert(['publish', 'tag-only'].includes(entry.kind), 'Unknown release operation')
    if (entry.kind === 'publish') {
      assert.equal(entry.access, 'public')
      assert(['beta', 'latest'].includes(entry.tag), 'Unexpected npm dist-tag')
      assert.equal(typeof entry.tarball?.path, 'string')
      const archive = resolve(folder, entry.tarball.path)
      const inside = relative(resolve(folder), archive)
      assert(
        inside && !inside.startsWith('..') && !isAbsolute(inside) && archive.endsWith('.tgz'),
        'Archive must stay inside the release directory',
      )
    }
    return entry
  })
}

export function verifyRegistryVersion(value, name, version) {
  const records = Array.isArray(value) ? value : [value]
  assert.equal(records.length, 1, 'An exact npm version must resolve to one record')
  const registry = records[0]
  assert.equal(registry.name, name)
  assert.equal(registry.version, version)
  assert.equal(registry['dist-tags']?.beta, version, 'The beta tag must resolve to this release')
  assert(
    registry.dist?.attestations?.url && registry.dist.attestations.provenance,
    'npm publication must include provenance attestations',
  )
  return registry
}

export async function readReleasePlan(root, folder) {
  const manifests = await Promise.all(
    releasePackages.map(async (directory) =>
      JSON.parse(await readFile(resolve(root, 'packages', directory, 'package.json'), 'utf8')),
    ),
  )
  const plan = JSON.parse(await readFile(resolve(folder, 'publish-plan.json'), 'utf8'))
  return validateReleasePlan(plan, manifests, folder)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const entries = await readReleasePlan(process.cwd(), resolve('artifacts/release'))
  const count = entries.filter((entry) => entry.kind === 'publish').length
  console.log(
    `${count} public beta archives to verify; ${entries.length - count} existing-version tags to recover`,
  )
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `has-archives=${count > 0}\n`)
}
