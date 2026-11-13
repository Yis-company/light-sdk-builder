import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
const root = fileURLToPath(new URL('..', import.meta.url))
const report = JSON.parse(await readFile(join(root, 'artifacts/package-check.json'), 'utf8'))
const fixture = join(report.fixture, 'npm')
await writeFile(
  join(fixture, 'browser-fixture.mjs'),
  await readFile(join(root, 'test/browser-fixture.mjs')),
)
const build = spawnSync(
  'bun',
  ['build', 'browser-fixture.mjs', '--target=browser', '--outfile=browser.js'],
  { cwd: fixture, encoding: 'utf8' },
)
assert.equal(build.status, 0, build.stdout + build.stderr)
const bundle = await readFile(join(fixture, 'browser.js'), 'utf8')
await writeFile(
  join(fixture, 'browser.html'),
  `<!doctype html><html><title>SDK installed-package check</title><script>${bundle.replaceAll('</script', '<\\/script')}</script></html>`,
)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = [],
    network = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url())
  })
  await page.goto(pathToFileURL(join(fixture, 'browser.html')).href)
  const result = await page.evaluate(() => window.sdkSmoke)
  assert.deepEqual(result.value, { status: 200, ok: true, data: { name: 'Ada' } })
  assert.equal(result.requests.length, 2)
  assert.equal(result.requests[0].url, 'https://fixture.invalid/api/users/a%2Fb')
  assert(result.requests.every((request) => request.workspace === '7'))
  assert.equal(result.cancelled, true)
  assert.deepEqual(errors, [])
  assert.deepEqual(network, [])
  console.log(
    'Installed core passed actual browser requests, scoped headers, encoding, preparation, and cancellation without TanStack or live HTTP',
  )
} finally {
  await browser.close()
}
