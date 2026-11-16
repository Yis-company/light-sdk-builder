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
  const localeKeys = []
  for (const locale of ['en-US', 'cs-CZ']) {
    const context = await browser.newContext({ locale })
    try {
      const page = await context.newPage()
      const errors = [],
        network = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (/^https?:/.test(request.url())) network.push(request.url())
      })
      // Intercept every HTTP request: exercise native fetch without contacting a live API.
      await page.route(/^https?:/, (route) =>
        route.fulfill({
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ name: 'Ada' }),
        }),
      )
      await page.goto(pathToFileURL(join(fixture, 'browser.html')).href)
      const result = await page.evaluate(() => window.sdkSmoke)
      const expected = { status: 200, ok: true, data: { name: 'Ada' } }
      assert.deepEqual(result.value, expected)
      assert.deepEqual(result.nativeDefault, expected)
      assert.deepEqual(result.nativeInjected, expected)
      assert.equal(result.requests.length, 2)
      assert.equal(result.requests[0].url, 'https://fixture.invalid/api/users/a%2Fb')
      assert(result.requests.every((request) => request.workspace === '7'))
      assert.equal(result.cancelled, true)
      assert.deepEqual(errors, [])
      assert.deepEqual(network, [
        'https://fixture.invalid/api/native',
        'https://fixture.invalid/api/native',
      ])
      localeKeys.push(result.localeKey)
    } finally {
      await context.close()
    }
  }
  assert.deepEqual(localeKeys[0], localeKeys[1], 'Prepared keys must match across browser locales')
  const reactFixture = join(report.fixture, 'npm-adapter')
  await writeFile(
    join(reactFixture, 'react-browser-fixture.mjs'),
    await readFile(join(root, 'test/react-browser-fixture.mjs')),
  )
  const reactBuild = spawnSync(
    'bun',
    ['build', 'react-browser-fixture.mjs', '--target=browser', '--outfile=react-browser.js'],
    { cwd: reactFixture, encoding: 'utf8' },
  )
  assert.equal(reactBuild.status, 0, reactBuild.stdout + reactBuild.stderr)
  const reactBundle = await readFile(join(reactFixture, 'react-browser.js'), 'utf8')
  await writeFile(
    join(reactFixture, 'react.html'),
    `<!doctype html><html><div id="root"></div><script>${reactBundle.replaceAll('</script', '<\\/script')}</script></html>`,
  )
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(pathToFileURL(join(reactFixture, 'react.html')).href)
  await page.waitForFunction(() => window.reactAuth?.snapshot.sessionKey === 'a')
  await page.evaluate(() => window.reactAuth.switchSource())
  await page.waitForFunction(
    () =>
      window.reactAuth.snapshot.sessionKey === 'b' &&
      window.reactAuth.listenersA.size === 0 &&
      window.reactAuth.listenersB.size === 1,
  )
  await page.evaluate(() => window.reactAuth.changeB())
  await page.waitForFunction(() => window.reactAuth.snapshot.sessionKey === 'c')
  await page.evaluate(() => window.reactAuth.async())
  await page.waitForFunction(() => window.reactAuth.asyncMode)
  await page.evaluate(() => {
    window.authRead = window.reactAuth.bridge.fetch('https://fixture.invalid').then(
      (r) => r.status,
      (e) => e.name,
    )
  })
  await page.evaluate(() => window.reactAuth.rerender())
  await page.waitForFunction(() => window.reactAuth.render > 0)
  await page.evaluate(() => window.reactAuth.release())
  assert.equal(await page.evaluate(() => window.authRead), 200)
  assert.deepEqual(errors, [])
  await page.close()
  console.log(
    'Installed React bindings passed StrictMode source switching and inline-source async reads',
  )
  console.log(
    'Installed core passed native/default fetch, cross-locale keys, scoped requests and cancellation without TanStack or live HTTP',
  )
} finally {
  await browser.close()
}
