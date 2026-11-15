import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { createSdkBuilder } from '../dist/index.js'

test('one reusable route tree binds independent HTTP clients and cache identities', async () => {
  let calls = 0
  const builder = createSdkBuilder({ keyContext: ({ http }) => [{ account: http.account }] })
  const users = builder.procedure.path('users').query(({ http, path }) => http.get(path))
  const routes = { users, nested: { same: users } }
  const client = (account) => ({
    account,
    get: async (path) => {
      calls++
      return { account, path }
    },
  })
  const first = builder.create({ http: client('first'), routes })
  const second = builder.create({ http: client('second'), routes })
  assert.equal(calls, 0)
  assert.equal('query' in users, false, 'Definitions have no execution methods before binding')
  assert.notEqual(first.users, second.users)
  assert.deepEqual(
    await Promise.all([first.users.query(), second.users.query(), first.nested.same.query()]),
    [
      { account: 'first', path: '/users' },
      { account: 'second', path: '/users' },
      { account: 'first', path: '/users' },
    ],
  )
  assert.deepEqual(first.users.queryKey(), ['users', { account: 'first' }])
  assert.deepEqual(second.users.queryKey(), ['users', { account: 'second' }])
  assert.deepEqual(first.users.baseKey(), ['users'])
  assert.equal(calls, 3)
})

test('context resolution uses parsed input and its key selector reads the bound client and raw input', async () => {
  const builder = createSdkBuilder({ keyContext: ({ http }) => [http.account] })
  const get = builder.procedure
    .path('users')
    .input(z.object({ project: z.string().transform(Number), search: z.string() }))
    .context({
      resolve: ({ input, http }) => ({
        input: { search: input.search },
        project: input.project,
        account: http.account,
      }),
      keyContext: ({ input }, { http }) => [http.account, input.project],
    })
    .context({ resolve: ({ project }) => ({ label: `project-${project}` }) })
    .query(async ({ account, input, project, label }) => ({ account, input, project, label }))
  const a = builder.create({ http: { account: 'a' }, routes: { get } })
  const b = builder.create({ http: { account: 'b' }, routes: { get } })
  const args = { input: { project: '9', search: 'Ada' } }
  assert.deepEqual(a.get.queryKey(args), ['users', args.input, 'a', '9'])
  assert.deepEqual(b.get.queryKey(args), ['users', args.input, 'b', '9'])
  assert.deepEqual(await a.get.query(args), {
    account: 'a',
    input: { search: 'Ada' },
    project: 9,
    label: 'project-9',
  })
})

test('mutations, path validation and infinite page calls use the same reusable engine', async () => {
  const builder = createSdkBuilder({ keyContext: ({ http }) => [http.account] })
  const error = new Error('native client error')
  const routes = {
    update: builder.procedure
      .path(z.object({ id: z.number() }), ({ id }) => ['users', id])
      .input(z.object({ value: z.string() }))
      .mutation(({ http, path, input }) => http.send(path, input)),
    list: builder.procedure.path('users').infiniteQuery(
      async ({ page, http }) => ({ account: http.account, page }),
      (result) => (result.page < 2 ? result.page + 1 : undefined),
    ),
  }
  const api = builder.create({
    http: {
      account: 'a',
      send: async () => {
        throw error
      },
    },
    routes,
  })
  await assert.rejects(
    api.update.mutate({ path: { id: 7 }, input: { value: 'x' } }),
    (caught) => caught === error,
  )
  assert.deepEqual(api.update.queryKey({ path: { id: 7 } }), ['users', 7, 'a'])
  assert.deepEqual(await api.list.queryPage(undefined, 2), { account: 'a', page: 2 })
  assert.deepEqual(api.list.queryKey(), ['users', 'a', 'infinite'])
})

test('a bound request signal cannot cancel another SDK instance', async () => {
  const pending = []
  const builder = createSdkBuilder({
    bind: (http, { signal }) => ({ ...http, send: () => http.send(signal) }),
  })
  const get = builder.procedure.path('users').query(({ http }) => http.send())
  const client = (account) => ({
    send: (signal) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        pending.push(() => resolve(account))
      }),
  })
  const a = builder.create({ http: client('a'), routes: { get } })
  const b = builder.create({ http: client('b'), routes: { get } })
  const cancelled = new AbortController()
  const active = new AbortController()
  const first = a.get.query(undefined, { signal: cancelled.signal })
  const second = b.get.query(undefined, { signal: active.signal })
  const rejected = assert.rejects(first, (caught) => caught === 'cancel a')
  cancelled.abort('cancel a')
  await rejected
  assert.equal(active.signal.aborted, false)
  pending[1]()
  assert.equal(await second, 'b')
})

test('native fetch responses remain native after reusable binding', async () => {
  const builder = createSdkBuilder()
  const get = builder.procedure
    .path('users')
    .query(({ http, signal }) => http('https://fixture.invalid/users', { signal }))
  const response = Response.json({ ready: true })
  const api = builder.create({ http: async () => response, routes: { get } })
  assert.equal(await api.get.query(), response)
})

test('cyclic route trees fail during binding without making requests', () => {
  const builder = createSdkBuilder()
  const routes = {}
  routes.self = routes
  assert.throws(() => builder.create({ http: fetch, routes }), /must not contain cycles/)
})
