import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSdk, defineSdkPlugin } from '../dist/index.js'

test('core initializes agnostic routes once and calls them without plugins', async () => {
  const transport = { read: async () => ({ ready: true }) }
  let builds = 0
  const sdk = createSdk({
    transport,
    routes: (client) => {
      builds++
      return { ping: { query: () => client.read() } }
    },
  })
  assert.deepEqual(await sdk.ping.query(), { ready: true })
  assert.equal(builds, 1)
  assert.equal('queryOptions' in sdk.ping, false)
})

test('plugins compose in registration order without mutating the authored routes', () => {
  const routes = { ping: () => 42 }
  const visits = []
  const first = defineSdkPlugin((sdk) => {
    visits.push('first')
    return { ...sdk, label: 'SDK' }
  })
  const second = defineSdkPlugin((sdk) => {
    visits.push(sdk.label)
    return { ...sdk, describe: () => sdk.label }
  })
  const sdk = createSdk({ routes: () => routes, transport: undefined, plugins: [first, second] })
  assert.deepEqual(visits, ['first', 'SDK'])
  assert.equal(sdk.ping(), 42)
  assert.equal(sdk.describe(), 'SDK')
  assert.deepEqual(Object.keys(routes), ['ping'])
})

test('a failed plugin retains the original error and does not run subsequent plugins', () => {
  const error = new Error('Plugin configuration failed')
  const failing = defineSdkPlugin(() => {
    throw error
  })
  const unreachable = defineSdkPlugin(() => {
    assert.fail('must not initialize after failure')
  })
  assert.throws(
    () => createSdk({ routes: () => ({}), transport: undefined, plugins: [failing, unreachable] }),
    (caught) => caught === error,
  )
})
