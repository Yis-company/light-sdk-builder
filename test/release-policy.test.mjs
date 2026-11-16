import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  trustedReleaseEvent,
  verifiedCheck,
  validateReleasePlan,
  verifyRegistryVersion,
} from '../scripts/release-policy.mjs'

const repository = 'Yis-company/light-sdk-builder'
const sha = 'a'.repeat(40)
const run = {
  event: 'push',
  head_branch: 'main',
  head_sha: sha,
  head_repository: { full_name: repository },
  conclusion: 'success',
}
const jobs = [22, 24, 26].map((node) => ({
  name: `package (${node})`,
  status: 'completed',
  conclusion: 'success',
}))

test('only trusted main pushes or main dispatches may enter the release job', () => {
  assert(trustedReleaseEvent('workflow_run', { workflow_run: run }, repository, 'refs/heads/main'))
  assert(trustedReleaseEvent('workflow_dispatch', {}, repository, 'refs/heads/main'))
  for (const change of [
    { event: 'pull_request' },
    { head_branch: 'feature' },
    { conclusion: 'failure' },
    { head_repository: { full_name: 'fork/sdk' } },
  ])
    assert.equal(
      trustedReleaseEvent(
        'workflow_run',
        { workflow_run: { ...run, ...change } },
        repository,
        'refs/heads/main',
      ),
      false,
    )
  assert.equal(
    trustedReleaseEvent('workflow_dispatch', {}, repository, 'refs/heads/feature'),
    false,
  )
  assert.equal(trustedReleaseEvent('pull_request', {}, repository, 'refs/heads/main'), false)
})

test('the exact source SHA and every Node matrix job must be successful', () => {
  assert(verifiedCheck(run, jobs, repository, sha))
  assert.equal(verifiedCheck(run, jobs, repository, 'b'.repeat(40)), false)
  assert.equal(verifiedCheck(run, jobs.slice(0, 2), repository, sha), false)
  for (const conclusion of ['failure', 'skipped', 'cancelled'])
    assert.equal(
      verifiedCheck(run, [...jobs.slice(0, 2), { ...jobs[2], conclusion }], repository, sha),
      false,
    )
  assert.equal(verifiedCheck({ ...run, event: 'pull_request' }, jobs, repository, sha), false)
})

const manifest = { name: 'light-sdk-builder', version: '0.1.0-beta.4' }
const entry = {
  kind: 'publish',
  ...manifest,
  access: 'public',
  tag: 'beta',
  tarball: { path: 'packages/core.tgz' },
}
const plan = (entry) => ({ version: 1, plan: [[entry]] })
test('release validation accepts beta archives and already-published tag recovery', () => {
  assert.deepEqual(validateReleasePlan(plan(entry), [manifest], '/release'), [entry])
  assert.deepEqual(
    validateReleasePlan(plan({ kind: 'tag-only', ...manifest }), [manifest], '/release'),
    [{ kind: 'tag-only', ...manifest }],
  )
  assert.deepEqual(validateReleasePlan({ version: 1, plan: [] }, [manifest], '/release'), [])
})

test('stable versions, foreign packages and archive escapes cannot be published', () => {
  for (const change of [
    { name: 'other' },
    { version: '0.1.0-beta.5' },
    { access: 'restricted' },
    { tag: 'next' },
    { kind: 'unknown' },
    { tarball: { path: '../outside.tgz' } },
    { tarball: { path: '/outside.tgz' } },
  ])
    assert.throws(() => validateReleasePlan(plan({ ...entry, ...change }), [manifest], '/release'))
  const stable = { ...manifest, version: '1.0.0' }
  assert.throws(() => validateReleasePlan(plan({ ...entry, ...stable }), [stable], '/release'))
  assert.throws(() =>
    validateReleasePlan({ version: 1, plan: [[entry, entry]] }, [manifest], '/release'),
  )
  assert.throws(() => validateReleasePlan({ version: 2, plan: [[entry]] }, [manifest], '/release'))
})

test('npm metadata accepts object and single-record array formats but requires matching beta provenance', () => {
  const metadata = {
    ...manifest,
    'dist-tags': { beta: manifest.version },
    dist: {
      attestations: {
        url: 'https://registry.npmjs.org/attestations',
        provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
      },
    },
  }
  assert.equal(verifyRegistryVersion(metadata, manifest.name, manifest.version), metadata)
  assert.equal(verifyRegistryVersion([metadata], manifest.name, manifest.version), metadata)
  for (const invalid of [
    [],
    [metadata, metadata],
    { ...metadata, name: 'other' },
    { ...metadata, version: '0.1.0-beta.5' },
    { ...metadata, 'dist-tags': { beta: '0.1.0-beta.3' } },
    { ...metadata, dist: {} },
  ])
    assert.throws(() => verifyRegistryVersion(invalid, manifest.name, manifest.version))
})
