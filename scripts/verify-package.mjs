import { verifyLintPackage } from './verify-lint-package.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = fileURLToPath(new URL('..', import.meta.url))
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
const args = process.argv.slice(2)
assert(
  args.length === 0 ||
    (args.length === 1 && args[0] === '--registry') ||
    (args.length === 2 && args[0] === '--pack-dir'),
  'Usage: verify-package.mjs [--pack-dir directory | --registry]',
)
const registry = args[0] === '--registry'
const releaseDir = args[0] === '--pack-dir' ? resolve(root, args[1]) : undefined
const artifacts = join(root, 'artifacts')
await mkdir(artifacts, { recursive: true })
const packages = await Promise.all(
  ['core', 'auth', 'react', 'tanstack-query', 'eslint-plugin'].map(async (directory) => ({
    directory: join(root, 'packages', directory),
    manifest: JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8')),
  })),
)
const packed = new Map()
if (releaseDir) {
  const publishPlan = JSON.parse(await readFile(join(releaseDir, 'publish-plan.json'), 'utf8'))
  assert.equal(publishPlan.version, 1)
  for (const release of publishPlan.plan.flat().filter((release) => release.kind === 'publish')) {
    assert.equal(release.access, 'public')
    const archive = resolve(releaseDir, release.tarball.path)
    const manifest = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json'], root))
    assert.equal(manifest.name, release.name)
    assert.equal(manifest.version, release.version)
    assert(
      packages.some((pkg) => pkg.manifest.name === manifest.name),
      `Unexpected release archive: ${manifest.name}`,
    )
    assert(!packed.has(manifest.name), `Duplicate release archive: ${manifest.name}`)
    packed.set(manifest.name, archive)
  }
  assert(
    packed.size > 0,
    'No release archives; Changesets skips versions already on npm. Use test:package for routine CI.',
  )
} else if (!registry) {
  for (const pkg of packages) {
    const result = JSON.parse(
      run(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', artifacts],
        pkg.directory,
      ),
    )
    const [entry] = Array.isArray(result) ? result : Object.values(result)
    packed.set(pkg.manifest.name, join(artifacts, entry.filename))
  }
}
const dependencies = {}
for (const { manifest: local } of packages) {
  const archive = packed.get(local.name)
  dependencies[local.name] = archive ? `file:${archive}` : local.version
  if (!archive) continue // Unchanged release dependencies are installed from the registry at their exact version.
  const manifest = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json'], root))
  assert.equal(manifest.version, local.version)
  assert.equal(manifest.publishConfig.access, 'public')
  assert(
    !JSON.stringify(manifest).includes('workspace:'),
    'Published manifests must use npm-compatible ranges',
  )
  if (local.name === 'eslint-plugin-light-sdk-builder') {
    assert.equal(manifest.exports['.'], './src/index.js')
    assert.deepEqual(
      manifest.dependencies ?? {},
      {},
      'Lint must not introduce runtime dependencies',
    )
    assert.deepEqual(
      manifest.peerDependencies ?? {},
      {},
      'Installing lint must not force SDK or framework dependencies',
    )
    const files = run('tar', ['-tzf', archive], root).trim().split('\n')
    for (const path of ['src/index.js', 'LICENSE', 'NOTICE', 'README.md'])
      assert(files.includes(`package/${path}`))
    assert(files.every((file) => !file.startsWith('package/test/')))
    assert.equal(manifest.license, 'Apache-2.0')
    continue
  }
  assert.equal(manifest.exports['.'].types, './dist/index.d.ts')
  assert.equal(manifest.exports['.'].import, './dist/index.js')
  const files = run('tar', ['-tzf', archive], root).trim().split('\n')
  for (const path of ['dist/index.js', 'dist/index.d.ts', 'LICENSE', 'NOTICE', 'README.md']) {
    assert(files.includes(`package/${path}`), `${local.name}: missing ${path}`)
  }
  assert(files.every((file) => !/^package\/(src|test)\//.test(file)))
  assert.equal(manifest.license, 'Apache-2.0')
}
const fixture = await mkdtemp(join(tmpdir(), 'light-sdk-builder-package-'))
const coreSmoke = `
import assert from 'node:assert/strict'
import { endpoint, createClient, createSdk } from 'light-sdk-builder'
const schema = { '~standard': { version: 1, vendor: 'fixture', validate: value => ({ value }) } }
const api = endpoint({ name: 'ping', method: 'GET', path: '/ping', responses: { 200: schema } })
const result = await api.bind(createClient({ baseUrl: 'https://fixture.invalid', fetch: async () => Response.json({ ready: true }) })).call()
assert.equal(result.data.ready, true)
const sdk = createSdk({ routes: client => ({ ping: api.bind(client) }), transport: createClient({ baseUrl: 'https://fixture.invalid', fetch: async () => Response.json({ ready: true }) }) })
assert.equal((await sdk.ping.call()).data.ready, true)
assert.equal('queryOptions' in sdk.ping, false)
`
const adapterSmoke = `
import assert from 'node:assert/strict'
import { QueryClient } from '@tanstack/react-query'
import { endpoint, createClient, HttpError } from 'light-sdk-builder'
import { queryOptions } from 'light-sdk-builder-tanstack-query'
import { z } from 'zod'
const schema = z.object({ ready: z.boolean() })
const api = endpoint({ name: 'ping', method: 'GET', path: '/ping', responses: { 200: schema, 404: schema } })
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
try {
  const success = api.bind(createClient({ baseUrl: 'https://fixture.invalid', fetch: async () => Response.json({ ready: true }) }))
  assert.equal((await client.fetchQuery(queryOptions(success, undefined))).ready, true)
  const failure = api.bind(createClient({ baseUrl: 'https://fixture.invalid', fetch: async () => Response.json({ ready: false }, { status: 404 }) }))
  await assert.rejects(client.fetchQuery(queryOptions(failure, undefined)), error => error instanceof HttpError && error.result.status === 404)
} finally { client.clear() }
`
const types = await readFile(join(root, 'test/types/consumer.ts'), 'utf8')
const readme = await readFile(join(root, 'README.md'), 'utf8')
const quickstart = readme.match(/```ts\n([\s\S]*?)```/)[1]
for (const manager of ['npm', 'bun']) {
  for (const adapter of [false, true]) {
    const cwd = join(fixture, manager + (adapter ? '-adapter' : ''))
    await mkdir(cwd)
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify({
        name: `sdk-${manager}-${adapter ? 'adapter' : 'core'}-fixture`,
        private: true,
        type: 'module',
        dependencies: adapter
          ? {
              ...dependencies,
              '@tanstack/query-core': '5.105.0',
              '@tanstack/react-query': '5.105.0',
              react: '19.3.1',
              'react-dom': '19.3.1',
              '@types/react': '19.3.0',
              typescript: '5.5.4',
              zod: '4.6.7',
              valibot: '1.5.0',
              'up-fetch': '2.6.1',
            }
          : { 'light-sdk-builder': dependencies['light-sdk-builder'] },
      }),
    )
    run(
      manager,
      manager === 'npm'
        ? ['install', '--ignore-scripts', '--no-audit', '--no-fund']
        : ['install', '--ignore-scripts'],
      cwd,
    )
    if (adapter) {
      await writeFile(
        join(cwd, 'resolve-core.mjs'),
        `
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const consumerCore = import.meta.resolve('light-sdk-builder')
const adapterCore = import.meta.resolve('light-sdk-builder', import.meta.resolve('light-sdk-builder-tanstack-query'))
const consumerAuth = import.meta.resolve('light-sdk-builder-auth')
const reactAuth = import.meta.resolve('light-sdk-builder-auth', import.meta.resolve('light-sdk-builder-react'))
assert.equal(realpathSync(fileURLToPath(reactAuth)), realpathSync(fileURLToPath(consumerAuth)), 'React and consumer must resolve one auth copy')
assert.equal(realpathSync(fileURLToPath(adapterCore)), realpathSync(fileURLToPath(consumerCore)), 'Adapter and consumer must resolve one core copy')
`,
      )
      run(process.execPath, ['--experimental-import-meta-resolve', 'resolve-core.mjs'], cwd)
      await writeFile(join(cwd, 'consumer.ts'), types)
      await writeFile(join(cwd, 'quickstart.ts'), quickstart)
      for (const name of ['auth.ts', 'procedures.ts', 'sdk.ts', 'http-client.ts', 'reusable.ts'])
        await writeFile(join(cwd, name), await readFile(join(root, 'test/types', name)))
      await writeFile(
        join(cwd, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            skipLibCheck: true,
            types: [],
          },
          include: ['*.ts'],
        }),
      )
      run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], cwd)
    } else {
      await assert.rejects(access(join(cwd, 'node_modules/@tanstack/query-core')))
      await assert.rejects(access(join(cwd, 'node_modules/react')))
      await assert.rejects(access(join(cwd, 'node_modules/up-fetch')))
    }
    await writeFile(join(cwd, 'smoke.mjs'), adapter ? adapterSmoke : coreSmoke)
    run(manager === 'npm' ? process.execPath : 'bun', ['smoke.mjs'], cwd)
    console.log(
      `${manager}: ${adapter ? 'adapter types, QueryClient, one core and HttpError identity' : 'core without TanStack/React/up-fetch'} passed`,
    )
  }
}
for (const manager of ['npm', 'bun']) {
  const cwd = join(fixture, manager + '-query-core')
  await mkdir(cwd)
  await writeFile(
    join(cwd, 'package.json'),
    JSON.stringify({
      name: 'sdk-query-core-fixture',
      private: true,
      type: 'module',
      dependencies: {
        'light-sdk-builder': dependencies['light-sdk-builder'],
        'light-sdk-builder-tanstack-query': dependencies['light-sdk-builder-tanstack-query'],
        '@tanstack/query-core': '5.105.0',
      },
    }),
  )
  run(
    manager,
    manager === 'npm'
      ? ['install', '--ignore-scripts', '--no-audit', '--no-fund']
      : ['install', '--ignore-scripts'],
    cwd,
  )
  for (const optional of ['react', 'light-sdk-builder-react', 'light-sdk-builder-auth', 'up-fetch'])
    await assert.rejects(access(join(cwd, 'node_modules', optional)))
  await writeFile(
    join(cwd, 'query.mjs'),
    await readFile(join(root, 'test/query-core-plugin-fixture.mjs')),
  )
  run(manager === 'npm' ? process.execPath : 'bun', ['query.mjs'], cwd)
  console.log(`${manager}: TanStack plugin with Query Core alone passed`)
}
for (const manager of ['npm', 'bun']) {
  const cwd = join(fixture, manager + '-react')
  await mkdir(cwd)
  await writeFile(
    join(cwd, 'package.json'),
    JSON.stringify({
      name: 'sdk-react-fixture',
      private: true,
      type: 'module',
      dependencies: {
        'light-sdk-builder': dependencies['light-sdk-builder'],
        'light-sdk-builder-react': dependencies['light-sdk-builder-react'],
        'light-sdk-builder-tanstack-query': dependencies['light-sdk-builder-tanstack-query'],
        '@tanstack/query-core': '5.105.0',
        '@tanstack/react-query': '5.105.0',
        react: '19.3.1',
        'react-dom': '19.3.1',
      },
    }),
  )
  run(
    manager,
    manager === 'npm'
      ? ['install', '--ignore-scripts', '--no-audit', '--no-fund']
      : ['install', '--ignore-scripts'],
    cwd,
  )
  await assert.rejects(access(join(cwd, 'node_modules/light-sdk-builder-auth')))
  await assert.rejects(access(join(cwd, 'node_modules/up-fetch')))
  await writeFile(
    join(cwd, 'react.mjs'),
    await readFile(join(root, 'test/react-plugin-fixture.mjs')),
  )
  run(manager === 'npm' ? process.execPath : 'bun', ['react.mjs'], cwd)
  console.log(`${manager}: configured TanStack React hook/provider without auth passed`)
}
await verifyLintPackage({ archive: dependencies['eslint-plugin-light-sdk-builder'], fixture, run })
const report = {
  archives: Object.fromEntries(packed),
  dependencies,
  fixture,
  mode: registry ? 'registry' : releaseDir ? 'release' : 'ci',
}
await writeFile(join(artifacts, 'package-check.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
