# Getting started

`light-sdk-builder` describes an existing HTTP API. The backend can use any language. The application supplies authentication and a Standard Schema v1 validator; core handles request construction, validation, and typed results.

The first `0.1.0-beta.0` release is pending. After publication, install core plus your validator:

```sh
npm install light-sdk-builder@beta zod
```

## Contracts and plain async calls

```ts
import { createClient, endpoint } from 'light-sdk-builder'
import { z } from 'zod'

const User = z.object({ id: z.number(), name: z.string() })
const getUser = endpoint({
  name: 'users.get',
  method: 'GET',
  path: '/users/:id',
  input: z.object({ params: z.object({ id: z.number() }) }),
  responses: { 200: User, 404: z.object({ message: z.string() }) },
})
const createUser = endpoint({
  name: 'users.create',
  method: 'POST',
  path: '/users',
  input: z.object({ body: z.object({ name: z.string() }) }),
  responses: { 201: User },
})
const client = createClient({ baseUrl: 'https://example.com/api' })
const sdk = { users: { get: getUser.bind(client), create: createUser.bind(client) } }

const result = await sdk.users.get.call({ params: { id: 7 } })
if (result.status === 200) console.log(result.data.name)
if (result.status === 404) console.log(result.data.message)
await sdk.users.create.call({ body: { name: 'Ada' } })
```

Inputs use `{ params?, query?, body? }`. Schema transforms run before request construction. Callers supply the schema's input type; path placeholders must exist as nonempty strings or numbers in its parsed output. Query arrays become repeated parameters; null and undefined query values are omitted. Transform nested query objects into strings yourself. Bodies are JSON; 204, 205, and HEAD responses are empty.

## Validators

Any Standard Schema v1 implementation works, including asynchronous validators. For example, a Valibot response schema can replace `User`:

```ts
import * as v from 'valibot'
const User = v.object({ id: v.number(), name: v.string() })
```

A custom implementation needs no validator library:

```ts
import { validateSchema, type StandardSchemaV1 } from 'light-sdk-builder'

const nonempty: StandardSchemaV1<string, string> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate: async (value) =>
      typeof value === 'string' && value.length > 0
        ? { value }
        : { issues: [{ message: 'Expected a nonempty string' }] },
  },
}
const name = await validateSchema(nonempty, 'Ada')
```

`validateSchema` returns parsed output and throws `ValidationError` on reported issues. For a validator without Standard Schema support, write a small adapter that returns `{ value }` or `{ issues }`.

## Errors and cancellation

| Situation                                  | Behavior                                                  |
| ------------------------------------------ | --------------------------------------------------------- |
| Declared HTTP status, including 4xx/5xx    | Returns `{ status, ok, data }` with validated data        |
| `unwrap(result)` for a declared failure    | Throws `HttpError` with `.result`                         |
| Invalid input or response schema           | Throws `ValidationError` with `.kind` and `.issues`       |
| Invalid request path, query, or client URL | Throws `RequestError`                                     |
| Malformed JSON response                    | Throws `ResponseDecodeError` with its cause               |
| Undeclared HTTP status                     | Throws `UnexpectedStatusError` with `.status` and `.body` |
| Fetch/network failure or cancellation      | Preserves the original error or abort reason              |

```ts
const controller = new AbortController()
const request = sdk.users.get.call({ params: { id: 7 } }, { signal: controller.signal })
controller.abort()
await request // rejects with the abort reason
```

Core forwards the signal to fetch and checks cancellation around preparation. Custom transports must honor the supplied signal during their own work. There are no automatic retries.

## Authentication, scopes, and snapshots

```ts
const client = createClient({
  baseUrl: 'https://example.com/api',
  headers: { Authorization: `Bearer ${token}` },
  scope: { key: [{ workspace: 7 }], headers: { 'X-Workspace': '7' } },
})
```

Client creation snapshots headers and scope keys. Create a new client when credentials or workspace changes. Scope keys separate caches; authentication headers never enter generated keys. Keep credentials out of input and scope keys. Supply `fetch` for application-owned refresh or transport behavior.

`bound.key(input)` uses raw input. `await bound.prepare(input)` validates first and captures the request plus a canonical key. Its `.call({ signal })` can execute later. Keys include namespace, base URL, endpoint identity, and scope.

`captureInput(value)` is the public snapshot helper for adapters. It copies plain JSON objects/arrays and permits root `undefined` for an endpoint without input. It rejects nested undefined, sparse arrays, cycles, symbols, class/Date instances, negative zero, and nonfinite numbers. Transform such values before generating raw keys, or use `prepare` to derive a request from validated output.

## Existing SDKs and compatibility

`createOperation` separates resolving a request from executing it, without prescribing HTTP or a query-key format:

```ts
import { createOperation } from 'light-sdk-builder'

const operation = createOperation({
  resolve: async (id: number) => ({ url: `/users/${id}` }),
  execute: async (request, { signal }) => existingClient.get(request.url, { signal }),
})
const user = await operation.call(7)
```

An application-owned compatibility adapter can retain its fluent procedure builder, request functions, callbacks, errors, and invalidation policy while replacing only the execution boundary. Existing Platform routes use this approach. Core keeps its import path; the former preview TanStack subpath moves to the [separate plugin](tanstack-query.md).

Uploads, streams, OpenAPI generation, and authentication orchestration are outside this beta's scope.
