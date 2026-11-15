import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { createProcedure, createHttpTransport } from '../dist/index.js'
import { isResponseError } from 'up-fetch'
import { userHttp } from '../../../test/user-http.mjs'

const identity = {
  '~standard': { version: 1, vendor: 'identity', validate: (value) => ({ value }) },
}
function transport(fetcher) {
  return userHttp(fetcher, () => ({
    baseUrl: 'https://sdk.invalid',
    headers: { 'App-Source': 'test' },
  }))
}

test('core procedures perform validated direct calls without query-library options', async () => {
  const seen = []
  const p = createProcedure(
    transport(async (request) => {
      seen.push(request)
      return Response.json({ ready: true })
    }),
  )
  const get = p
    .path(z.object({ id: z.number().transform(String) }), (params) => ['users', params.id])
    .input(z.object({ count: z.string().transform(Number) }))
    .query(({ path, input, http }) => http(path, { params: input, schema: identity }))
  assert.equal('queryOptions' in get, false)
  assert.deepEqual(await get.query({ path: { id: 7 }, input: { count: '2' } }), { ready: true })
  assert.equal(seen[0].url, 'https://sdk.invalid/users/7?count=2')
  assert.deepEqual(get.queryKey({ path: { id: 7 }, input: { count: '2' } }), [
    'users',
    7,
    { count: '2' },
  ])
})

test('user context owns headers, input shaping and explicit matching cache identity', async () => {
  const seen = []
  const p = createProcedure(
    transport(async (request) => {
      seen.push(request)
      return Response.json({ ready: true })
    }),
    { keyContext: () => [{ team: 7 }] },
  )
  const get = p
    .path('users')
    .input(z.object({ team: z.number().optional(), q: z.string() }))
    .context({
      resolve: ({ input, http }) => {
        const { team, ...remaining } = input
        return {
          input: remaining,
          teamId: team,
          http: (path, init) => {
            const headers = new Headers(init?.headers)
            headers.set('X-Team', String(team))
            return http(path, { ...init, headers })
          },
        }
      },
      keyContext: ({ input }) => [{ team: input.team ?? 7 }],
    })
    .query(({ input, teamId, path, http }) => {
      assert.deepEqual(input, { q: 'Ada' })
      assert.equal(teamId, 9)
      return http(path, { headers: { 'x-team': 5 }, params: input })
    })
  const args = { input: { team: 9, q: 'Ada' } }
  assert.deepEqual(get.queryKey(args), ['users', args.input, { team: 9 }])
  assert.deepEqual(get.baseKey(args), ['users', args.input])
  await get.query(args)
  assert.equal(seen[0].headers.get('X-Team'), '9')
  assert.equal(seen[0].url, 'https://sdk.invalid/users?q=Ada')
  assert.equal(seen[0].headers.get('App-Source'), 'test')
})

test('transport keeps multipart bodies, binary parsing and typed response errors', async () => {
  let mode = 'upload',
    upload
  const request = transport(async (req) => {
    if (mode === 'upload') {
      upload = await req.formData()
      return new Response(null, { status: 204 })
    }
    if (mode === 'download')
      return new Response('report', { headers: { 'content-type': 'application/octet-stream' } })
    return Response.json({ message: 'Invalid', errors: { name: ['Required'] } }, { status: 422 })
  })
  const p = createProcedure(request)
  const file = new File(['content'], 'document.txt')
  const uploadProcedure = p
    .path('documents')
    .input(identity)
    .mutation(({ input, path, http }) => {
      const body = new FormData()
      body.append('file', input.file)
      return http(path, { method: 'POST', body })
    })
  await uploadProcedure.mutate({ input: { file } })
  assert.equal(upload.get('file').name, 'document.txt')
  assert.equal(await upload.get('file').text(), 'content')
  mode = 'download'
  const download = p
    .path('report')
    .query(({ path, http }) => http(path, { parseResponse: (response) => response.blob() }))
  assert.equal(await (await download.query()).text(), 'report')
  mode = 'error'
  await assert.rejects(
    download.query(),
    (error) =>
      isResponseError(error) && error.status === 422 && error.data.errors.name[0] === 'Required',
  )
})

test('procedure cancellation reaches HTTP and abort during validation prevents execution', async () => {
  let signal,
    calls = 0,
    release
  const p = createProcedure(
    transport(async (request) => {
      calls++
      signal = request.signal
      return Response.json({ ready: true })
    }),
  )
  const get = p.path('users').query(({ path, http }) => http(path))
  const controller = new AbortController()
  await get.query(undefined, { signal: controller.signal })
  assert.equal(signal.aborted, false)
  controller.abort('done')
  assert.equal(signal.aborted, true)
  const asyncInput = {
    '~standard': {
      version: 1,
      vendor: 'async',
      validate: async (value) => {
        await new Promise((resolve) => {
          release = resolve
        })
        return { value }
      },
    },
  }
  const delayed = p
    .path('users')
    .input(asyncInput)
    .query(({ path, http }) => http(path))
  const aborted = new AbortController()
  const result = delayed.query({ input: {} }, { signal: aborted.signal })
  aborted.abort('cancelled')
  release()
  await assert.rejects(result, (error) => error === 'cancelled')
  assert.equal(calls, 1)
})

test('structural path transforms can declare raw key segments independently from parsed request segments', async () => {
  const p = createProcedure(transport(async (request) => Response.json({ url: request.url })))
  const schema = z.string().transform((id) => ({ id }))
  const get = p
    .path(
      schema,
      (value) => ['users', value.id],
      (raw) => ['users', raw],
    )
    .query(({ path, http }) => http(path))
  assert.deepEqual(get.queryKey({ path: '7' }), ['users', '7'])
  assert.deepEqual(await get.query({ path: '7' }), { url: 'https://sdk.invalid/users/7' })
  const missingRawBuilder = p.path(schema, (value) => ['users', value.id]).query(async () => null)
  assert.throws(() => missingRawBuilder.queryKey({ path: '7' }), /raw key builder/)
})

test('user context can choose a different client without changing the shared transport', async () => {
  const requests = []
  const first = async (url, init) => {
    requests.push(new Headers(init?.headers).get('X-Custom'))
    return Response.json({ ready: true })
  }
  const p = createProcedure(createHttpTransport(first))
  const custom = p
    .path('users')
    .context({
      resolve: ({ http }) => ({
        http: (url, init) => http(url, { ...init, headers: { 'X-Custom': 'chosen' } }),
      }),
      keyContext: () => ['chosen'],
    })
    .query(({ http }) => http('https://sdk.invalid'))
  const plain = p.path('users').query(({ http }) => http('https://sdk.invalid'))
  await custom.query()
  await plain.query()
  assert.deepEqual(requests, ['chosen', null])
  assert.deepEqual(custom.queryKey(), ['users', 'chosen'])
  assert.deepEqual(plain.queryKey(), ['users'])
})

test('plain fetch remains a fetch client with native responses and explicit cancellation', async () => {
  const send = async (_url, init) => {
    init.signal.throwIfAborted()
    return Response.json({ ready: true })
  }
  const get = createProcedure(createHttpTransport(send))
    .path('plain')
    .query(({ http, signal }) => http('https://sdk.invalid', { signal }))
  const controller = new AbortController()
  const response = await get.query(undefined, { signal: controller.signal })
  assert(response instanceof Response)
  assert.deepEqual(await response.json(), { ready: true })
  controller.abort('cancelled')
  await assert.rejects(
    get.query(undefined, { signal: controller.signal }),
    (error) => error === 'cancelled',
  )
})

test('an object HTTP client keeps its methods, results and original errors', async () => {
  const error = new Error('custom failure')
  const client = {
    get: async (path) => {
      if (path === '/failure') throw error
      return { path }
    },
  }
  const p = createProcedure(createHttpTransport(client))
  assert.deepEqual(
    await p
      .path('users')
      .query(({ http, path }) => http.get(path))
      .query(),
    { path: '/users' },
  )
  await assert.rejects(
    p
      .path('failure')
      .query(({ http, path }) => http.get(path))
      .query(),
    (caught) => caught === error,
  )
})

test('context layers compose once while raw keys stay synchronous', async () => {
  let calls = 0
  const p = createProcedure(createHttpTransport({ get: async () => 'done' }))
  const get = p
    .path('context')
    .context({
      resolve: () => {
        calls++
        return { tag: 'application' }
      },
    })
    .input(z.object({ value: z.string().transform(Number) }))
    .context({
      resolve: async ({ tag, input }) => {
        calls++
        return { label: `${tag}:${input.value}` }
      },
      keyContext: ({ input }) => [input.value],
    })
    .query(async ({ label, tag, input, http }) => ({
      label,
      tag,
      value: input.value,
      result: await http.get(),
    }))
  assert.deepEqual(get.queryKey({ input: { value: '2' } }), ['context', { value: '2' }, '2'])
  assert.equal(calls, 0)
  assert.deepEqual(await get.query({ input: { value: '2' } }), {
    label: 'application:2',
    tag: 'application',
    value: 2,
    result: 'done',
  })
  assert.equal(calls, 2)
})
