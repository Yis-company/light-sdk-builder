import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { createProcedure, createTransport, scopeTransport, isResponseError } from '../dist/index.js'

const identity = {
  '~standard': { version: 1, vendor: 'identity', validate: (value) => ({ value }) },
}
function transport(fetcher) {
  return createTransport(fetcher, () => ({
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
    .query(({ path, input, upFetch }) => upFetch(path, { params: input, schema: identity }))
  assert.equal('queryOptions' in get, false)
  assert.deepEqual(await get.query({ path: { id: 7 }, input: { count: '2' } }), { ready: true })
  assert.equal(seen[0].url, 'https://sdk.invalid/users/7?count=2')
  assert.deepEqual(get.queryKey({ path: { id: 7 }, input: { count: '2' } }), [
    'users',
    7,
    { count: '2' },
  ])
})

test('generic input scope owns request headers and matching keys while removing policy fields', async () => {
  const seen = []
  const scoped = scopeTransport(
    transport(async (request) => {
      seen.push(request)
      return Response.json({ ready: true })
    }),
    { key: [{ team: 7 }], headers: { 'X-Team': 7 } },
  )
  const p = createProcedure(scoped, {
    scope: (id) => ({ key: [{ team: id }], headers: { 'X-Team': id } }),
    scopeContextKey: 'teamId',
  })
  const get = p
    .path('users')
    .input(z.object({ team: z.number().optional(), q: z.string() }))
    .scope('team')
    .query(({ input, teamId, path, upFetch }) => {
      assert.deepEqual(input, { q: 'Ada' })
      assert.equal(teamId, 9)
      return upFetch(path, { headers: { 'x-team': 5 }, params: input })
    })
  const args = { input: { team: 9, q: 'Ada' } }
  assert.deepEqual(get.queryKey(args), ['users', args.input, { team: 9 }])
  assert.deepEqual(get.allScopesKey(args), ['users', args.input])
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
    .mutation(({ input, path, upFetch }) => {
      const body = new FormData()
      body.append('file', input.file)
      return upFetch(path, { method: 'POST', body })
    })
  await uploadProcedure.mutate({ input: { file } })
  assert.equal(upload.get('file').name, 'document.txt')
  assert.equal(await upload.get('file').text(), 'content')
  mode = 'download'
  const download = p
    .path('report')
    .query(({ path, upFetch }) => upFetch(path, { parseResponse: (response) => response.blob() }))
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
  const get = p.path('users').query(({ path, upFetch }) => upFetch(path))
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
    .query(({ path, upFetch }) => upFetch(path))
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
    .query(({ path, upFetch }) => upFetch(path))
  assert.deepEqual(get.queryKey({ path: '7' }), ['users', '7'])
  assert.deepEqual(await get.query({ path: '7' }), { url: 'https://sdk.invalid/users/7' })
  const missingRawBuilder = p.path(schema, (value) => ['users', value.id]).query(async () => null)
  assert.throws(() => missingRawBuilder.queryKey({ path: '7' }), /raw key builder/)
})

test('clearing a scope removes inherited and request scope headers', async () => {
  let headers
  const base = createTransport(
    async (request) => {
      headers = request.headers
      return Response.json({ ready: true })
    },
    () => ({ baseUrl: 'https://sdk.invalid', headers: { 'X-Team': 7 } }),
  )
  const single = scopeTransport(base, { key: [{ team: 9 }], headers: { 'X-Team': 9 } })
  const all = scopeTransport(single, { key: [], headers: { 'X-Team': undefined } })
  await all('/users', { headers: { 'x-team': 5 } })
  assert.equal(headers.get('X-Team'), null)
  assert.deepEqual(all.getQueryKeyContext(), [])
})
