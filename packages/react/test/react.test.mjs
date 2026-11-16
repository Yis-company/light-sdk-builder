import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createSdkContext, useAuthBridge } from '../dist/index.js'
test('SDK bindings retain caller-owned SDK identity under real React context', () => {
  const bindings = createSdkContext()
  const sdk = { users: { get: () => 42 } }
  let observed
  function Screen() {
    observed = bindings.useSdk()
    return createElement('p', null, observed.users.get())
  }
  assert.equal(
    renderToString(createElement(bindings.Provider, { sdk }, createElement(Screen))),
    '<p>42</p>',
  )
  assert.equal(observed, sdk)
})
test('SDK hook fails clearly outside its own provider', () => {
  const bindings = createSdkContext()
  function Screen() {
    bindings.useSdk()
    return null
  }
  assert.throws(() => renderToString(createElement(Screen)), /SDK Provider/)
})
test('React auth callbacks connect to the same framework-neutral request transport', async () => {
  let bridge,
    current = { sessionKey: null, revision: 0 }
  const sent = []
  function Screen() {
    bridge = useAuthBridge(
      { getRequestContext: () => current },
      {
        fetch: async (_u, init) => {
          sent.push(init.headers.get('X-Key'))
          return Response.json({ ok: true })
        },
      },
    )
    return null
  }
  renderToString(createElement(Screen))
  current = { sessionKey: 'signed-in', revision: 1, headers: { 'X-Key': 'opaque' } }
  assert.equal((await bridge.fetch('https://fixture.invalid')).status, 200)
  assert.deepEqual(sent, ['opaque'])
  bridge.dispose()
})
