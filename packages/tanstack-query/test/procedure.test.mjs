import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/query-core'
import { z } from 'zod'
import { createProcedure, createTransport, scopeTransport } from 'light-sdk-builder'
import { withTanStack } from '../dist/index.js'

function setup() {
  const calls = []
  const request = scopeTransport(
    createTransport(
      async (req) => {
        calls.push(req)
        return Response.json({
          page: Number(new URL(req.url).searchParams.get('page') ?? '1'),
          ready: true,
        })
      },
      () => ({ baseUrl: 'https://sdk.invalid' }),
    ),
    { key: [{ team: 7 }], headers: { 'X-Team': 7 } },
  )
  const p = createProcedure(request)
  const core = {
    get: p.path('users').query(({ path, upFetch }) => upFetch(path)),
    list: p
      .path('users')
      .input(z.object({ q: z.string() }))
      .query(({ input, path, upFetch }) => upFetch(path, { params: input })),
    update: p
      .path(z.object({ id: z.number() }), (path) => ['users', path.id])
      .input(z.object({ name: z.string() }))
      .mutation(({ input, path, upFetch }) => upFetch(path, { method: 'POST', body: input })),
    pages: p.path('pages').infiniteQuery(
      ({ page, path, upFetch }) => upFetch(path, { params: { page } }),
      (page) => (page.page < 2 ? page.page + 1 : undefined),
    ),
  }
  return { core, api: withTanStack(core), calls }
}

test('a consumer adds TanStack after the core SDK is authored', async () => {
  const { core, api } = setup()
  assert.equal('queryOptions' in core.get, false)
  assert.deepEqual(
    Object.keys(api.get).sort(),
    ['allScopesKey', 'query', 'queryKey', 'queryOptions'].sort(),
  )
  assert.deepEqual(
    Object.keys(api.pages).sort(),
    ['allScopesKey', 'queryKey', 'queryOptions'].sort(),
  )
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  try {
    const options = api.list.queryOptions({ input: { q: 'Ada' } }, { staleTime: Infinity })
    assert.deepEqual(options.queryKey, ['users', { q: 'Ada' }, { team: 7 }])
    assert.equal((await client.fetchQuery(options)).ready, true)
    const initial = await client.fetchInfiniteQuery(api.pages.queryOptions())
    assert.equal(initial.pages[0].page, 1)
    assert.deepEqual(api.pages.queryKey(), ['pages', { team: 7 }, 'infinite'])
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
