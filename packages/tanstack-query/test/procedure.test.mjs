import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/query-core'
import { z } from 'zod'
import { userHttp } from '../../../test/user-http.mjs'
import {
  createSdkBuilder,
  createSdk,
  createProcedure,
  createHttpTransport,
} from 'light-sdk-builder'
import { tanstackQuery, withTanStack } from '../dist/index.js'

function setup() {
  const calls = []
  const request = userHttp(
    async (req) => {
      calls.push(req)
      return Response.json({
        page: Number(new URL(req.url).searchParams.get('page') ?? '1'),
        ready: true,
      })
    },
    () => ({ baseUrl: 'https://sdk.invalid', headers: { 'X-Team': 7 } }),
  )
  const p = createProcedure(request, { keyContext: () => [{ team: 7 }] })
  const core = {
    get: p.path('users').query(({ path, http }) => http(path)),
    list: p
      .path('users')
      .input(z.object({ q: z.string() }))
      .query(({ input, path, http }) => http(path, { params: input })),
    update: p
      .path(z.object({ id: z.number() }), (path) => ['users', path.id])
      .input(z.object({ name: z.string() }))
      .mutation(({ input, path, http }) => http(path, { method: 'POST', body: input })),
    pages: p.path('pages').infiniteQuery(
      ({ page, path, http }) => http(path, { params: { page } }),
      (page) => (page.page < 2 ? page.page + 1 : undefined),
    ),
  }
  return {
    core,
    api: createSdk({ routes: () => core, transport: request, plugins: [tanstackQuery()] }),
    calls,
  }
}

test('one SDK plugin registration enriches every agnostic procedure and retains plain methods', async () => {
  const { core, api } = setup()
  assert.equal('queryOptions' in core.get, false)
  assert.deepEqual(
    Object.keys(api.get).sort(),
    ['baseKey', 'query', 'queryKey', 'queryOptions'].sort(),
  )
  assert.deepEqual(
    Object.keys(api.pages).sort(),
    ['baseKey', 'queryKey', 'queryOptions', 'queryPage'].sort(),
  )
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  try {
    const options = api.list.queryOptions({ input: { q: 'Ada' } }, { staleTime: Infinity })
    assert.deepEqual(options.queryKey, ['users', { q: 'Ada' }, { team: 7 }])
    assert.equal((await client.fetchQuery(options)).ready, true)
    const initial = await client.fetchInfiniteQuery(api.pages.queryOptions())
    assert.equal(initial.pages[0].page, 1)
    assert.deepEqual(api.pages.queryKey(), ['pages', {}, { team: 7 }, 'infinite'])
  } finally {
    client.clear()
  }
})

test('path mutations retain variables, options callbacks and metadata', async () => {
  const { api, calls } = setup()
  const onSuccess = () => undefined,
    meta = { invalidates: [['users']] }
  const options = api.update.mutationOptions({ path: { id: 9 } }, { onSuccess, meta })
  assert.equal(options.onSuccess, onSuccess)
  assert.equal(options.meta, meta)
  await options.mutationFn({ name: 'Ada' })
  assert.equal(calls[0].url, 'https://sdk.invalid/users/9')
  assert.deepEqual(await calls[0].json(), { name: 'Ada' })
})

test('auth binding preserves cache on token rotation and isolates obsolete session completion', async () => {
  const { bindAuthToQueryClient } = await import('../dist/index.js')
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  let snapshot = { initialized: false, version: 0 },
    listeners = new Set(),
    resolve
  const auth = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const notify = (next) => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const unsubscribe = bindAuthToQueryClient(client, auth)
  try {
    client.setQueryData(['cached'], { ready: true })
    notify({ initialized: true, version: 0 })
    assert.deepEqual(client.getQueryData(['cached']), { ready: true })
    notify({ initialized: true, version: 0, revision: 'rotated' })
    assert.deepEqual(client.getQueryData(['cached']), { ready: true })
    const pending = client.fetchQuery({
      queryKey: ['pending'],
      queryFn: ({ signal }) => {
        void signal
        return new Promise((done) => {
          resolve = done
        })
      },
    })
    const rejected = assert.rejects(pending)
    notify({ initialized: true, version: 1 })
    assert.equal(client.getQueryCache().getAll().length, 0)
    resolve({ oldSession: true })
    await rejected
    assert.equal(client.getQueryData(['pending']), undefined)
  } finally {
    unsubscribe()
    client.clear()
  }
  assert.equal(listeners.size, 0)
})

test('the same facade adapts core HTTP endpoints and preserves unwrapped errors', async () => {
  const { endpoint, createClient, HttpError } = await import('light-sdk-builder')
  let status = 200
  const bound = endpoint({
    name: 'ready',
    method: 'GET',
    path: '/ready',
    responses: { 200: z.object({ ready: z.boolean() }), 404: z.object({ ready: z.boolean() }) },
  }).bind(
    createClient({
      baseUrl: 'https://sdk.invalid',
      fetch: async () => Response.json({ ready: status === 200 }, { status }),
    }),
  )
  const sdk = withTanStack({ bound })
  assert.equal(
    (await sdk.bound.queryOptions(undefined).queryFn({ signal: new AbortController().signal }))
      .ready,
    true,
  )
  assert.equal((await sdk.bound.mutationOptions().mutationFn(undefined)).ready, true)
  status = 404
  await assert.rejects(
    sdk.bound.queryOptions(undefined).queryFn({ signal: new AbortController().signal }),
    (error) => error instanceof HttpError,
  )
})

test('reusable definitions bind before plugins and keep separate instance caches', async () => {
  const builder = createSdkBuilder({ keyContext: ({ http }) => [http.owner] })
  const routes = { get: builder.procedure.path('users').query(({ http }) => http.read()) }
  const first = { owner: 'a', read: async () => 'a' }
  const second = { owner: 'b', read: async () => 'b' }
  const plain = builder.create({ http: first, routes })
  const a = builder.create({ http: first, routes, plugins: [tanstackQuery()] })
  const b = builder.create({ http: second, routes, plugins: [tanstackQuery()] })
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  try {
    assert.equal('queryOptions' in plain.get, false)
    assert.equal('queryOptions' in routes.get, false)
    assert.deepEqual(
      await Promise.all([
        client.fetchQuery(a.get.queryOptions()),
        client.fetchQuery(b.get.queryOptions()),
      ]),
      ['a', 'b'],
    )
    assert.equal(await plain.get.query(), 'a')
  } finally {
    client.clear()
  }
})

test('a base key filter reaches every input and scope of its path, never longer paths', () => {
  const request = userHttp(async () => Response.json({}))
  const scoped = (team) => createProcedure(request, { keyContext: () => [{ team }] })
  const route = (p) => ({
    search: p
      .path('users')
      .input(z.object({ q: z.string() }))
      .query(async () => null),
    me: p.path('users', 'me').query(async () => null),
  })
  const [seven, nine] = [route(scoped(7)), route(scoped(9))]
  const client = new QueryClient()
  for (const [key, data] of [
    [seven.search.queryKey({ input: { q: 'a' } }), 'a7'],
    [nine.search.queryKey({ input: { q: 'b' } }), 'b9'],
    [seven.me.queryKey(), 'me'],
  ])
    client.setQueryData(key, data)
  const matched = (queryKey) =>
    client
      .getQueryCache()
      .findAll({ queryKey })
      .map((query) => query.state.data)
      .sort()
  assert.deepEqual(matched(seven.search.baseKey()), ['a7', 'b9'])
  assert.deepEqual(matched(seven.search.baseKey({ input: { q: 'a' } })), ['a7'])
  assert.deepEqual(matched(seven.me.baseKey()), ['me'])
  client.clear()
})
