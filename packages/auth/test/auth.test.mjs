import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuthBridge, AuthSessionChangedError } from '../dist/index.js'
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
function fixture(options = {}) {
  let value = { sessionKey: 'alice-1', revision: 1, headers: { Authorization: 'Bearer old' } },
    listener
  const source = {
    getRequestContext: () => value,
    subscribe: (fn) => {
      listener = fn
      return () => {
        listener = undefined
      }
    },
    ...options,
  }
  return {
    source,
    set: (next) => {
      value = next
      listener?.()
    },
    get: () => value,
  }
}
test('one connection observes login and current opaque/custom headers without rebuilding the bridge', async () => {
  const f = fixture()
  f.set({ sessionKey: null, revision: 0 })
  const headers = []
  const bridge = createAuthBridge(f.source, {
    fetch: async (_input, init) => {
      headers.push(new Headers(init.headers).get('x-api-key'))
      return Response.json({ ok: true })
    },
  })
  f.set({ sessionKey: 'session', revision: 1, headers: { 'x-api-key': 'opaque-first' } })
  await bridge.fetch('https://fixture.invalid')
  f.set({ sessionKey: 'session', revision: 2, headers: { 'x-api-key': 'opaque-second' } })
  await bridge.fetch('https://fixture.invalid')
  assert.deepEqual(headers, ['opaque-first', 'opaque-second'])
  bridge.dispose()
})
test('cookie auth needs no JS-readable token and preserves request/scoped headers', async () => {
  let init
  const bridge = createAuthBridge(
    {
      getRequestContext: () => ({
        sessionKey: 'cookie-session',
        revision: 1,
        credentials: 'include',
        headers: { 'X-CSRF': 'csrf' },
      }),
    },
    {
      fetch: async (_u, options) => {
        init = options
        return new Response(null, { status: 204 })
      },
    },
  )
  await bridge.fetch('https://fixture.invalid', { headers: { 'X-Organisation-Id': '7' } })
  assert.equal(init.credentials, 'include')
  assert.equal(init.headers.get('X-CSRF'), 'csrf')
  assert.equal(init.headers.get('X-Organisation-Id'), '7')
  assert.equal(init.headers.has('Authorization'), false)
  bridge.dispose()
})
for (const count of [100, 1000])
  test(`${count} concurrent 401s share one user recovery and each replay once`, async () => {
    const gate = deferred()
    let recoveries = 0,
      calls = 0
    const f = fixture({
      recover: async () => {
        recoveries++
        await gate.promise
        f.set({ sessionKey: 'alice-1', revision: 2, headers: { Authorization: 'Bearer new' } })
        return true
      },
    })
    const bridge = createAuthBridge(f.source, {
      fetch: async (_u, init) => {
        calls++
        return new Response(null, {
          status: new Headers(init.headers).get('Authorization') === 'Bearer new' ? 200 : 401,
        })
      },
    })
    const requests = Array.from({ length: count }, () => bridge.fetch('https://fixture.invalid'))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(recoveries, 1)
    gate.resolve()
    const result = await Promise.all(requests)
    assert(result.every((response) => response.status === 200))
    assert.equal(calls, count * 2)
    assert.equal(recoveries, 1)
    bridge.dispose()
  })
test('logout during recovery prevents credential resurrection and request replay', async () => {
  const gate = deferred()
  let calls = 0
  const f = fixture({ recover: () => gate.promise })
  const bridge = createAuthBridge(f.source, {
    fetch: async () => {
      calls++
      return new Response(null, { status: 401 })
    },
  })
  const request = bridge.fetch('https://fixture.invalid')
  await new Promise((resolve) => setImmediate(resolve))
  f.set({ sessionKey: null, revision: 0 })
  gate.resolve(true)
  await assert.rejects(request, AuthSessionChangedError)
  assert.equal(calls, 1)
  bridge.dispose()
})
test('a late successful response from an old account cannot reach the caller', async () => {
  const gate = deferred()
  const f = fixture()
  const bridge = createAuthBridge(f.source, { fetch: () => gate.promise })
  const request = bridge.fetch('https://fixture.invalid')
  await new Promise((resolve) => setImmediate(resolve))
  f.set({ sessionKey: 'bob-2', revision: 1 })
  gate.resolve(new Response(null, { status: 200 }))
  await assert.rejects(request, AuthSessionChangedError)
  bridge.dispose()
})
test('one aborted waiter does not cancel another caller’s recovery', async () => {
  const gate = deferred()
  let calls = 0,
    recoveries = 0
  const controller = new AbortController()
  const f = fixture({
    recover: async () => {
      recoveries++
      await gate.promise
      f.set({ sessionKey: 'alice-1', revision: 2, headers: { Authorization: 'Bearer new' } })
      return true
    },
  })
  const bridge = createAuthBridge(f.source, {
    fetch: async (_u, init) => {
      calls++
      return new Response(null, {
        status: init.headers.get('Authorization') === 'Bearer new' ? 200 : 401,
      })
    },
  })
  const a = bridge.fetch('https://fixture.invalid', { signal: controller.signal }),
    b = bridge.fetch('https://fixture.invalid')
  await new Promise((resolve) => setImmediate(resolve))
  const reason = new Error('cancel only A')
  controller.abort(reason)
  await assert.rejects(a, (e) => e === reason)
  gate.resolve()
  assert.equal((await b).status, 200)
  assert.equal(calls, 3)
  assert.equal(recoveries, 1)
  bridge.dispose()
})
test('a delayed 401 uses credentials already rotated by user auth without another recovery', async () => {
  const gate = deferred()
  let calls = 0,
    recoveries = 0
  const f = fixture({
    recover: async () => {
      recoveries++
      return false
    },
  })
  const bridge = createAuthBridge(f.source, {
    fetch: async () => (++calls === 1 ? gate.promise : new Response(null, { status: 200 })),
  })
  const request = bridge.fetch('https://fixture.invalid')
  await new Promise((resolve) => setImmediate(resolve))
  f.set({ sessionKey: 'alice-1', revision: 2, headers: { Authorization: 'Bearer new' } })
  gate.resolve(new Response(null, { status: 401 }))
  assert.equal((await request).status, 200)
  assert.equal(recoveries, 0)
  assert.equal(calls, 2)
  bridge.dispose()
})
test('JSON and multipart replay keep body and scope, and a second failure stops', async () => {
  for (const body of [
    JSON.stringify({ count: 1 }),
    (() => {
      const data = new FormData()
      data.append('file', new File(['file-bytes'], 'a.txt'))
      return data
    })(),
  ]) {
    const seen = []
    let recoveries = 0
    const f = fixture({
      recover: async () => {
        recoveries++
        f.set({ sessionKey: 'alice-1', revision: 2, headers: { Authorization: 'Bearer new' } })
        return true
      },
    })
    const bridge = createAuthBridge(f.source, {
      fetch: async (_u, init) => {
        seen.push({
          body: init.body,
          scope: init.headers.get('X-Organisation-Id'),
          auth: init.headers.get('Authorization'),
        })
        return new Response(null, { status: 401 })
      },
    })
    assert.equal(
      (
        await bridge.fetch('https://fixture.invalid', {
          method: 'POST',
          body,
          headers: { 'X-Organisation-Id': '7' },
        })
      ).status,
      401,
    )
    assert.equal(recoveries, 1)
    assert.equal(seen.length, 2)
    assert.equal(seen[1].scope, '7')
    assert.equal(seen[1].auth, 'Bearer new')
    if (typeof body === 'string') assert.equal(seen[0].body, seen[1].body)
    else assert.equal(await seen[1].body.get('file').text(), 'file-bytes')
    bridge.dispose()
  }
})
test('recovery false/errors preserve the original response or exception', async () => {
  const original = new Response('original', { status: 401 })
  const bridge = createAuthBridge(
    { getRequestContext: () => ({ sessionKey: 'a', revision: 1 }), recover: async () => false },
    { fetch: async () => original },
  )
  assert.equal(await bridge.fetch('https://fixture.invalid'), original)
  bridge.dispose()
  const error = new Error('provider unavailable')
  const broken = createAuthBridge(
    {
      getRequestContext: () => ({ sessionKey: 'a', revision: 1 }),
      recover: async () => {
        throw error
      },
    },
    { fetch: async () => new Response(null, { status: 401 }) },
  )
  await assert.rejects(broken.fetch('https://fixture.invalid'), (e) => e === error)
  broken.dispose()
})
test('async sources are supported; server bridges do not share sessions or recovery', async () => {
  const values = []
  const make = (name) =>
    createAuthBridge(
      {
        getRequestContext: async () => ({
          sessionKey: name,
          revision: 1,
          headers: { 'X-Session': name },
        }),
      },
      {
        fetch: async (_u, init) => {
          values.push(init.headers.get('X-Session'))
          return new Response(null, { status: 200 })
        },
      },
    )
  const a = make('a'),
    b = make('b')
  await Promise.all([a.fetch('https://fixture.invalid'), b.fetch('https://fixture.invalid')])
  assert.deepEqual(values.sort(), ['a', 'b'])
  a.dispose()
  b.dispose()
})
test('a session change while a response body is decoding rejects its old result', async () => {
  const gate = deferred()
  const f = fixture()
  const response = new Response()
  response.json = () => gate.promise
  const bridge = createAuthBridge(f.source, { fetch: async () => response })
  const received = await bridge.fetch('https://fixture.invalid')
  const parsed = received.json()
  f.set({ sessionKey: 'bob-2', revision: 1 })
  gate.resolve({ private: 'alice' })
  await assert.rejects(parsed, AuthSessionChangedError)
  bridge.dispose()
})
test('stream request bodies return the response without unsafe replay', async () => {
  let calls = 0,
    recovery = 0
  const bridge = createAuthBridge(
    {
      getRequestContext: () => ({ sessionKey: 'a', revision: 1 }),
      recover: async () => {
        recovery++
        return true
      },
    },
    {
      fetch: async () => {
        calls++
        return new Response(null, { status: 401 })
      },
    },
  )
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1]))
      controller.close()
    },
  })
  assert.equal(
    (await bridge.fetch('https://fixture.invalid', { method: 'POST', body })).status,
    401,
  )
  assert.equal(calls, 1)
  assert.equal(recovery, 0)
  bridge.dispose()
})
test('recovery may rotate a private refresh token without exposing it to SDK context', async () => {
  let privateRefresh = 'refresh-1'
  const f = fixture({
    recover: async () => {
      assert.equal(privateRefresh, 'refresh-1')
      privateRefresh = 'refresh-2'
      f.set({ sessionKey: 'alice-1', revision: 2, headers: { Authorization: 'Bearer new' } })
      return true
    },
  })
  const bridge = createAuthBridge(f.source, {
    fetch: async (_u, init) =>
      new Response(null, {
        status: init.headers.get('Authorization') === 'Bearer new' ? 200 : 401,
      }),
  })
  assert.equal((await bridge.fetch('https://fixture.invalid')).status, 200)
  assert.equal(privateRefresh, 'refresh-2')
  assert.doesNotMatch(JSON.stringify(bridge.getSnapshot()), /refresh-|Bearer/)
  bridge.dispose()
})
test('a notification between credential publication and dispatch cannot authorize an old session', async () => {
  const next = deferred()
  let changed,
    reads = 0
  const sent = []
  const source = {
    subscribe: (fn) => {
      changed = fn
      return () => {}
    },
    getRequestContext: () => {
      reads++
      if (reads === 1) {
        queueMicrotask(() => queueMicrotask(() => changed()))
        return { sessionKey: 'alice', revision: 1, headers: { 'X-Session': 'alice' } }
      }
      return next.promise
    },
  }
  const bridge = createAuthBridge(source, {
    fetch: async (_u, init) => {
      sent.push(init.headers.get('X-Session'))
      return new Response(null, { status: 200 })
    },
  })
  const request = bridge.fetch('https://fixture.invalid')
  const result = assert.rejects(request, AuthSessionChangedError)
  next.resolve({ sessionKey: 'bob', revision: 1, headers: { 'X-Session': 'bob' } })
  await result
  assert.deepEqual(sent, [])
  bridge.dispose()
})
test('bytes decoding is session-guarded when provided by the runtime', async () => {
  const gate = deferred(),
    f = fixture(),
    response = new Response()
  response.bytes = () => gate.promise
  const bridge = createAuthBridge(f.source, { fetch: async () => response })
  const received = await bridge.fetch('https://fixture.invalid'),
    parsed = received.bytes()
  f.set({ sessionKey: 'bob', revision: 1 })
  gate.resolve(new Uint8Array([1]))
  await assert.rejects(parsed, AuthSessionChangedError)
  bridge.dispose()
})
test('metadata reconciliation without an auth change does not abort an async request', async () => {
  const gate = deferred()
  let reading = false
  const bridge = createAuthBridge(
    {
      getRequestContext: async () => {
        reading = true
        await gate.promise
        return { sessionKey: 'a', revision: 1 }
      },
    },
    { fetch: async () => new Response(null, { status: 200 }) },
  )
  const request = bridge.fetch('https://fixture.invalid')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(reading, true)
  const sync = bridge.sync()
  gate.resolve()
  await sync
  assert.equal((await request).status, 200)
  bridge.dispose()
})
test('parallel calls after a pull-only source logs in use the new session', async () => {
  let context = { sessionKey: null, revision: 0 }
  const seen = []
  const bridge = createAuthBridge(
    { getRequestContext: async () => context },
    {
      fetch: async (_u, init) => {
        seen.push(init.headers.get('X-Session'))
        return new Response(null, { status: 200 })
      },
    },
  )
  await bridge.fetch('https://fixture.invalid')
  context = { sessionKey: 'alice', revision: 1, headers: { 'X-Session': 'alice' } }
  const results = await Promise.all(
    Array.from({ length: 100 }, () => bridge.fetch('https://fixture.invalid')),
  )
  assert(results.every((r) => r.status === 200))
  assert.deepEqual(seen.slice(1), Array(100).fill('alice'))
  bridge.dispose()
})
