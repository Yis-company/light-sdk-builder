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
await mkdir(join(root, 'artifacts'), { recursive: true })
const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', 'artifacts'], root))
const tarball = resolve(root, 'artifacts', packed.filename)
assert(packed.files.some((file) => file.path === 'dist/index.js'))
assert(packed.files.some((file) => file.path === 'dist/index.d.ts'))
assert(packed.files.some((file) => file.path === 'dist/tanstack-query.d.ts'))
assert(
  packed.files.every((file) => !file.path.startsWith('src/') && !file.path.startsWith('test/')),
)
const fixture = await mkdtemp(join(tmpdir(), 'light-sdk-builder-package-'))
const coreSmoke = `
import assert from 'node:assert/strict'
import { endpoint, createClient } from 'light-sdk-builder'
const schema = { '~standard': { version: 1, vendor: 'fixture', validate: value => ({ value }) } }
const api = endpoint({ name: 'ping', method: 'GET', path: '/ping', responses: { 200: schema } })
const result = await api.bind(createClient({ baseUrl: 'https://fixture.invalid', fetch: async () => Response.json({ ready: true }) })).call()
assert.equal(result.data.ready, true)
console.log('Installed core works without TanStack, React, or a validator implementation')
`
for (const manager of ['npm', 'bun']) {
  const cwd = join(fixture, manager)
  await mkdir(cwd)
  await writeFile(
    join(cwd, 'package.json'),
    JSON.stringify({
      name: `sdk-${manager}-fixture`,
      private: true,
      type: 'module',
      dependencies: { 'light-sdk-builder': `file:${tarball}` },
    }),
  )
  run(
    manager,
    manager === 'npm'
      ? ['install', '--ignore-scripts', '--omit=peer', '--no-audit', '--no-fund']
      : ['install', '--ignore-scripts'],
    cwd,
  )
  await assert.rejects(access(join(cwd, 'node_modules/@tanstack/query-core')))
  await assert.rejects(access(join(cwd, 'node_modules/react')))
  await writeFile(join(cwd, 'smoke.mjs'), coreSmoke)
  console.log(run(manager === 'npm' ? process.execPath : 'bun', ['smoke.mjs'], cwd).trim())
}
const consumers = join(fixture, 'consumers')
await mkdir(consumers)
await writeFile(
  join(consumers, 'package.json'),
  JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      'light-sdk-builder': `file:${tarball}`,
      '@tanstack/react-query': '5.105.0',
      react: '19.3.1',
      '@types/react': '19.3.0',
      typescript: '5.5.4',
      zod: '4.6.7',
      valibot: '1.5.0',
    },
  }),
)
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumers)
const types = (await readFile(join(root, 'test/types/consumer.ts'), 'utf8'))
  .replaceAll('../../dist/index.js', 'light-sdk-builder')
  .replaceAll('../../dist/tanstack-query.js', 'light-sdk-builder/tanstack-query')
await writeFile(join(consumers, 'consumer.ts'), types)
await writeFile(
  join(consumers, 'tsconfig.json'),
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
    include: ['consumer.ts'],
  }),
)
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], consumers)
await writeFile(
  join(consumers, 'runtime.mjs'),
  `
import assert from 'node:assert/strict'
import { QueryClient } from '@tanstack/react-query'
import { endpoint, createClient } from 'light-sdk-builder'
import { queryOptions } from 'light-sdk-builder/tanstack-query'
import { z } from 'zod'
const bound = endpoint({ name: 'ping', method: 'GET', path: '/ping', responses: { 200: z.object({ ready: z.boolean() }) } }).bind(createClient({ baseUrl: 'https://fixture.invalid', fetch: async () => Response.json({ ready: true }) }))
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
try { assert.equal((await client.fetchQuery(queryOptions(bound, undefined))).ready, true) } finally { client.clear() }
`,
)
run(process.execPath, ['runtime.mjs'], consumers)
const report = {
  tarball,
  unpackedBytes: packed.unpackedSize,
  fixture,
  checks: [
    'npm core-only install',
    'Bun core-only install',
    'published declaration consumer on TypeScript 5.5',
    'installed React Query runtime',
  ],
}
await writeFile(join(root, 'artifacts/package-check.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
