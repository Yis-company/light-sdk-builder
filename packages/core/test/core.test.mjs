import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import * as v from 'valibot'
import {
  createClient,
  createOperation,
  endpoint,
  HttpError,
  RequestError,
  UnexpectedStatusError,
  ResponseDecodeError,
  ValidationError,
  validateSchema,
  unwrap,
} from '../dist/index.js'

const user = z.object({ id: z.string(), name: z.string() })
const problem = z.object({ message: z.string() })
const input = z.object({
  params: z.object({ id: z.union([z.string(), z.number()]).transform((id) => String(id).trim()) }),
  query: z
    .object({ tags: z.array(z.string()).optional(), active: z.boolean().optional() })
    .optional(),
})
const get = endpoint({
  name: 'users.get',
  method: 'GET',
  path: '/users/:id',
  input,
  responses: { 200: user, 404: problem },
})
function fixture(payload = { id: '1', name: 'Ada' }, status = 200, options = {}) {
  const requests = []
  const client = createClient({
    baseUrl: 'https://api.example/v1/',
    ...options,
    fetch: async (url, init) => {
      requests.push({ url, ...init, headers: Object.fromEntries(init.headers) })
      return status === 204 ? new Response(null, { status }) : Response.json(payload, { status })
    },
  })
  return { requests, client }
}

test('validates transformed input and encodes path/query values at the wire boundary', async () => {
  const f = fixture()
  const result = await get
    .bind(f.client)
    .call({ params: { id: ' a/b ?# ' }, query: { tags: ['staff', 'a&b'], active: false } })
  assert.equal(result.status, 200)
  assert.equal(result.data.name, 'Ada')
  assert.equal(
    f.requests[0].url,
    'https://api.example/v1/users/a%2Fb%20%3F%23?active=false&tags=staff&tags=a%26b',
  )
})

test('raw keys remain synchronous; prepared keys canonicalize transformed input', async () => {
  const bound = get.bind(fixture().client)
  const a = { params: { id: ' 1 ' } },
    b = { params: { id: 1 } }
  assert.notDeepEqual(bound.key(a), bound.key(b))
  assert.deepEqual((await bound.prepare(a)).key, (await bound.prepare(b)).key)
})

test('canonical query URLs use code-unit order regardless of input insertion order', async () => {
  const f = fixture()
  const bound = endpoint({
    name: 'users.query',
    method: 'GET',
    path: '/users',
    input: z.object({ query: z.record(z.string(), z.string()) }),
    responses: { 200: user },
  }).bind(f.client)
  const first = await bound.prepare({ query: { a: '1', B: '2', ch: '3', h: '4' } })
  const second = await bound.prepare({ query: { h: '4', ch: '3', B: '2', a: '1' } })
  assert.deepEqual(first.key, second.key)
  await first.call()
  assert.equal(f.requests[0].url, 'https://api.example/v1/users?B=2&a=1&ch=3&h=4')
})

test('empty path parameters stop before HTTP while zero remains a valid item ID', async () => {
  const f = fixture()
  const remove = endpoint({
    name: 'users.remove',
    method: 'DELETE',
    path: '/users/:id',
    input,
    responses: { 200: user },
  }).bind(f.client)
  for (const id of ['', '   ']) {
    await assert.rejects(remove.call({ params: { id } }), RequestError)
  }
  assert.equal(f.requests.length, 0)
  await remove.call({ params: { id: 0 } })
  assert.equal(f.requests[0].url, 'https://api.example/v1/users/0')
})

test('captured headers, scope, body and keys cannot drift after preparation', async () => {
  const scope = { key: [{ workspace: 7 }], headers: { 'X-Workspace': '7' } }
  const headers = { Authorization: 'Bearer fixture-secret' }
  const f = fixture({ id: '1', name: 'Ada' }, 200, { scope, headers })
  const post = endpoint({
    name: 'users.create',
    method: 'POST',
    path: '/users',
    input: z.object({ body: z.object({ name: z.string() }) }),
    responses: { 200: user },
  }).bind(f.client)
  const args = { body: { name: 'Ada' } }
  const rawKey = post.key(args)
  const prepared = await post.prepare(args)
  args.body.name = 'Mina'
  scope.key[0].workspace = 9
  scope.headers['X-Workspace'] = '9'
  headers.Authorization = 'changed'
  await prepared.call()
  assert.equal(f.requests[0].headers['x-workspace'], '7')
  assert.equal(f.requests[0].headers.authorization, 'Bearer fixture-secret')
  assert.equal(f.requests[0].body, JSON.stringify({ name: 'Ada' }))
  assert.match(JSON.stringify(rawKey), /Ada/)
  assert.doesNotMatch(JSON.stringify(rawKey), /fixture-secret/)
  assert.throws(() => {
    rawKey[2].workspace = 10
  }, TypeError)
})

test('different base URLs and scopes never share raw keys', () => {
  const args = { params: { id: 1 } }
  const a = get
    .bind(fixture(undefined, 200, { namespace: 'shared', scope: { key: [7] } }).client)
    .key(args)
  const b = get
    .bind(fixture(undefined, 200, { namespace: 'shared', scope: { key: [9] } }).client)
    .key(args)
  const c = get
    .bind(
      createClient({ baseUrl: 'https://other.example', namespace: 'shared', scope: { key: [7] } }),
    )
    .key(args)
  assert.notDeepEqual(a, b)
  assert.notDeepEqual(a, c)
})

test('declared HTTP errors return validated discriminated results', async () => {
  const result = await get
    .bind(fixture({ message: 'Missing' }, 404).client)
    .call({ params: { id: 1 } })
  assert.deepEqual(result, { status: 404, ok: false, data: { message: 'Missing' } })
  assert.throws(
    () => unwrap(result),
    (error) => error instanceof HttpError && error.result === result,
  )
})

test('schema issues retain their paths and stop invalid requests', async () => {
  const f = fixture()
  await assert.rejects(
    get.bind(f.client).call({ params: { id: {} } }),
    (error) =>
      error instanceof ValidationError &&
      error.kind === 'input' &&
      error.issues[0].path[0] === 'params',
  )
  assert.equal(f.requests.length, 0)
  await assert.rejects(
    get.bind(fixture({ id: 1, name: null }).client).call({ params: { id: 1 } }),
    (error) => error instanceof ValidationError && error.kind === 'response',
  )
})

test('unexpected statuses preserve JSON and text error bodies', async () => {
  await assert.rejects(
    get.bind(fixture({ message: 'Unavailable' }, 503).client).call({ params: { id: 1 } }),
    (error) =>
      error instanceof UnexpectedStatusError &&
      error.status === 503 &&
      error.body.message === 'Unavailable',
  )
  const bound = get.bind(
    createClient({
      baseUrl: 'https://api.example',
      fetch: async () => new Response('Unavailable', { status: 503 }),
    }),
  )
  await assert.rejects(
    bound.call({ params: { id: 1 } }),
    (error) => error instanceof UnexpectedStatusError && error.body === 'Unavailable',
  )
})

test('malformed successful JSON reports a decode error', async () => {
  const f = createClient({
    baseUrl: 'https://api.example',
    fetch: async () => new Response('not-json'),
  })
  await assert.rejects(get.bind(f).call({ params: { id: 1 } }), ResponseDecodeError)
})

for (const [kind, abort, reason] of [
  ['network failure', false, new TypeError('Body connection dropped')],
  ['default abort', true, undefined],
  ['custom abort', true, new SyntaxError('Caller cancellation reason')],
]) {
  test(`body-read ${kind} preserves the original error`, async () => {
    const reading = Promise.withResolvers()
    let body
    const stream = new ReadableStream(
      {
        start(controller) {
          body = controller
        },
        pull() {
          reading.resolve()
        },
      },
      { highWaterMark: 0 },
    )
    const response = new Response(stream)
    const client = createClient({ baseUrl: 'https://api.example', fetch: async () => response })
    const controller = new AbortController()
    const pending = get.bind(client).call({ params: { id: 1 } }, { signal: controller.signal })
    await reading.promise
    if (abort) controller.abort(reason)
    const failure = abort ? controller.signal.reason : reason
    body.error(failure)
    await assert.rejects(pending, (error) => error === failure)
  })
}

test('bodyless endpoints support omitted input and empty 204 responses', async () => {
  const remove = endpoint({
    name: 'users.clear',
    method: 'DELETE',
    path: '/users',
    responses: { 204: z.void() },
  })
  assert.deepEqual(await remove.bind(fixture(undefined, 204).client).call(), {
    status: 204,
    ok: true,
    data: undefined,
  })
})

test('Valibot and custom asynchronous Standard Schema validators work without adapters', async () => {
  const valibot = endpoint({
    name: 'users.valibot',
    method: 'GET',
    path: '/users',
    responses: { 200: v.object({ id: v.string(), name: v.string() }) },
  })
  assert.equal((await valibot.bind(fixture().client).call()).data.name, 'Ada')
  const custom = {
    '~standard': {
      version: 1,
      vendor: 'custom',
      validate: async (value) => ({ value: { ...value, async: true } }),
    },
  }
  assert.deepEqual(await validateSchema(custom, { id: '1' }), { id: '1', async: true })
})

test('abort during asynchronous input validation prevents transport execution', async () => {
  let release
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  const slow = {
    '~standard': {
      version: 1,
      vendor: 'async',
      validate: async (value) => {
        await waiting
        return { value }
      },
    },
  }
  const route = endpoint({
    name: 'slow',
    method: 'GET',
    path: '/users',
    input: slow,
    responses: { 200: user },
  })
  const f = fixture(),
    controller = new AbortController()
  const result = route.bind(f.client).call({}, { signal: controller.signal })
  controller.abort()
  release()
  await assert.rejects(result, (error) => error.name === 'AbortError')
  assert.equal(f.requests.length, 0)
})

test('an in-flight AbortSignal reaches custom fetch; requests never retry themselves', async () => {
  let received
  const f = createClient({
    baseUrl: 'https://api.example',
    fetch: async (_url, init) => {
      received = init.signal
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }),
      )
    },
  })
  const controller = new AbortController()
  const result = get.bind(f).call({ params: { id: 1 } }, { signal: controller.signal })
  while (!received) await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(result, (error) => error.name === 'AbortError')
  assert.equal(received, controller.signal)
  let calls = 0
  const failure = new TypeError('Network failed')
  const network = get.bind(
    createClient({
      baseUrl: 'https://api.example',
      fetch: async () => {
        calls++
        throw failure
      },
    }),
  )
  await assert.rejects(network.call({ params: { id: 1 } }), (error) => error === failure)
  assert.equal(calls, 1)
})

test('callback operations preserve legacy result and error identity', async () => {
  const result = { legacy: true },
    failure = new Error('Existing transport error')
  const operation = createOperation({
    resolve: async (value) => value,
    execute: async (value) => {
      if (value) throw failure
      return result
    },
  })
  assert.equal(await operation.call(false), result)
  assert.equal(await (await operation.prepare(false)).call(), result)
  await assert.rejects(operation.call(true), (error) => error === failure)
})

test('rejects unsupported query values and traversal path parameters before HTTP', async () => {
  const loose = endpoint({
    name: 'loose',
    method: 'GET',
    path: '/users/:id',
    input: z.object({
      params: z.object({ id: z.string() }),
      query: z.record(z.string(), z.unknown()).optional(),
    }),
    responses: { 200: user },
  })
  const f = fixture()
  await assert.rejects(loose.bind(f.client).call({ params: { id: '..' } }), RequestError)
  await assert.rejects(
    loose.bind(f.client).call({ params: { id: '1' }, query: { filter: { active: true } } }),
    RequestError,
  )
  assert.equal(f.requests.length, 0)
})

test('rejects non-JSON cache/body values instead of creating lossy cache identities', () => {
  const bound = get.bind(fixture().client)
  assert.throws(() => bound.key({ params: { id: 1 }, query: new Map() }), RequestError)
  assert.throws(() => bound.key({ params: { id: 1 }, query: { value: Infinity } }), RequestError)
})

test('endpoint definitions capture configuration before callers can mutate it', async () => {
  const config = {
    name: 'stable',
    method: 'POST',
    path: '/original',
    input: z.object({ body: z.object({ value: z.number() }) }),
    responses: { 200: user },
  }
  const f = fixture()
  const bound = endpoint(config).bind(f.client)
  const prepared = await bound.prepare({ body: { value: 1 } })
  config.method = 'PATCH'
  config.path = '/changed'
  config.name = 'changed'
  config.responses[200] = z.never()
  await prepared.call()
  assert.equal(f.requests[0].method, 'POST')
  await bound.call({ body: { value: 2 } })
  assert.equal(f.requests[1].url, 'https://api.example/v1/original')
  assert.equal(bound.key({ body: { value: 2 } })[1], 'stable')
})

test('raw keys reject undefined fields and sparse values instead of silently aliasing JSON inputs', () => {
  const bound = get.bind(fixture().client)
  assert.throws(() => bound.key({ params: { id: 1 }, query: { active: undefined } }), RequestError)
  assert.throws(() => bound.key({ params: { id: 1 }, query: { tags: [undefined] } }), RequestError)
  const ping = endpoint({
    name: 'ping',
    method: 'GET',
    path: '/ping',
    responses: { 200: user },
  }).bind(fixture().client)
  assert.notDeepEqual(ping.key(undefined), ping.key(null))
})

test('prepared calls report cancellation as a rejected Promise', async () => {
  const operation = createOperation({
    resolve: async (value) => value,
    execute: async (value) => value,
  })
  const prepared = await operation.prepare(1)
  let pending
  assert.doesNotThrow(() => {
    pending = prepared.call({ signal: AbortSignal.abort() })
  })
  await assert.rejects(pending, (error) => error.name === 'AbortError')
})
