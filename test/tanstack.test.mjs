import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient, QueryObserver, InfiniteQueryObserver } from '@tanstack/query-core'
import { z } from 'zod'
import { createClient, endpoint, HttpError } from '../dist/index.js'
import {
  queryOptions,
  preparedQueryOptions,
  mutationOptions,
  infiniteQueryOptions,
} from '../dist/tanstack-query.js'
const result = z.object({ name: z.string() })
const input = z.object({
  params: z.object({ id: z.union([z.string(), z.number()]).transform((id) => String(id).trim()) }),
})
const definition = endpoint({
  name: 'users.get',
  method: 'GET',
  path: '/users/:id',
  input,
  responses: { 200: result, 404: z.object({ message: z.string() }) },
})
const queryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { gcTime: 0, retry: false },
      mutations: { gcTime: 0, retry: false },
    },
  })

test('raw and prepared options work with the actual QueryClient and preserve key/data typing conventions', async () => {
  let calls = 0
  const bound = definition.bind(
    createClient({
      baseUrl: 'https://api.example',
      fetch: async () => {
        calls++
        return Response.json({ name: 'Ada' })
      },
    }),
  )
  const client = queryClient()
  try {
    const options = queryOptions(bound, { params: { id: ' 1 ' } }, { staleTime: Infinity })
    assert.deepEqual(await client.fetchQuery(options), { name: 'Ada' })
    assert.deepEqual(client.getQueryData(options.queryKey), { name: 'Ada' })
    await client.fetchQuery(options)
    assert.equal(calls, 1)
    const a = preparedQueryOptions(await bound.prepare({ params: { id: ' 1 ' } }), {
      staleTime: Infinity,
    })
    const b = preparedQueryOptions(await bound.prepare({ params: { id: 1 } }), {
      staleTime: Infinity,
    })
    await client.fetchQuery(a)
    await client.fetchQuery(b)
    assert.equal(calls, 2)
  } finally {
    client.clear()
  }
})

test('query observer options support select and placeholder data', async () => {
  const bound = definition.bind(
    createClient({
      baseUrl: 'https://api.example',
      fetch: async () => Response.json({ name: 'Ada' }),
    }),
  )
  const client = queryClient()
  const observer = new QueryObserver(
    client,
    queryOptions(
      bound,
      { params: { id: 1 } },
      { select: (data) => data.name, placeholderData: { name: 'Loading' } },
    ),
  )
  try {
    assert.equal(observer.getCurrentResult().data, 'Loading')
    assert.equal((await observer.refetch()).data, 'Ada')
  } finally {
    observer.destroy()
    client.clear()
  }
})

test('query errors become HttpError with the validated declared response; cancellation is forwarded', async () => {
  const bound = definition.bind(
    createClient({
      baseUrl: 'https://api.example',
      fetch: async () => Response.json({ message: 'Missing' }, { status: 404 }),
    }),
  )
  const client = queryClient()
  try {
    await assert.rejects(
      client.fetchQuery(queryOptions(bound, { params: { id: 1 } })),
      (error) =>
        error instanceof HttpError &&
        error.result.status === 404 &&
        error.result.data.message === 'Missing',
    )
    let signal
    const slow = definition.bind(
      createClient({
        baseUrl: 'https://api.example',
        fetch: async (_url, init) => {
          signal = init.signal
          return new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          )
        },
      }),
    )
    const options = queryOptions(slow, { params: { id: 2 } })
    const pending = client.fetchQuery(options)
    while (!signal) await new Promise((resolve) => setImmediate(resolve))
    await client.cancelQueries({ queryKey: options.queryKey })
    await assert.rejects(pending)
    assert.equal(signal.aborted, true)
  } finally {
    client.clear()
  }
})

test('mutations preserve caller metadata/callbacks and never generate query entries', async () => {
  const bound = endpoint({
    name: 'users.create',
    method: 'POST',
    path: '/users',
    input: z.object({ body: result }),
    responses: { 201: result },
  }).bind(
    createClient({
      baseUrl: 'https://api.example',
      fetch: async () => Response.json({ name: 'Ada' }, { status: 201 }),
    }),
  )
  let observed
  const client = queryClient()
  try {
    const options = mutationOptions(bound, {
      meta: { invalidates: [['users']] },
      onSuccess: (data) => {
        observed = data.name
      },
    })
    const mutation = client.getMutationCache().build(client, options)
    assert.deepEqual(await mutation.execute({ body: { name: 'Ada' } }), { name: 'Ada' })
    assert.equal(observed, 'Ada')
    assert.deepEqual(mutation.meta, { invalidates: [['users']] })
    assert.equal(client.getQueryCache().getAll().length, 0)
  } finally {
    client.clear()
  }
})

for (const cursor of [false, true])
  test(`infinite queries support ${cursor ? 'string cursors' : 'numbered pages'} and stop at the end`, async () => {
    const client = queryClient()
    const seen = []
    const options = infiniteQueryOptions({
      key: ['users', { workspace: 7 }],
      initialPageParam: cursor ? undefined : 1,
      page: async (page) => ({
        call: async () => {
          seen.push(page)
          return {
            status: 200,
            ok: true,
            data: {
              items: [page],
              next: page === (cursor ? 'last' : 2) ? undefined : cursor ? 'last' : 2,
            },
          }
        },
      }),
      getNextPageParam: (page) => page.next,
    })
    const observer = new InfiniteQueryObserver(client, options)
    try {
      await observer.refetch()
      const next = await observer.fetchNextPage()
      assert.equal(next.data.pages.length, 2)
      assert.equal(next.hasNextPage, false)
      assert.deepEqual(seen, cursor ? [undefined, 'last'] : [1, 2])
      assert.equal(options.queryKey.at(-1), 'infinite')
    } finally {
      observer.destroy()
      client.clear()
    }
  })
