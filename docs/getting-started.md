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

## Authentication, context, and snapshots

```ts
const client = createClient({
  baseUrl: 'https://example.com/api',
  headers: { Authorization: `Bearer ${token}`, 'X-Workspace': '7' },
  keyContext: [{ workspace: 7 }],
})
```

Client creation snapshots headers and key context. Create a new client when credentials or workspace changes. Explicit context keys separate caches; authentication headers never enter generated keys. Keep credentials out of input and context keys. Supply `fetch` for application-owned refresh or transport behavior.

`bound.key(input)` uses raw input. `await bound.prepare(input)` validates first and captures the request plus a canonical key. Its `.call({ signal })` can execute later. Keys include namespace, base URL, endpoint identity, and key context.

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

The contract-based endpoint client handles JSON. Procedure callbacks can use their chosen client for uploads, downloads or streams. OpenAPI generation and authentication orchestration remain outside core.

## Procedures for an existing API

Use a procedure when you already have parsing/error conventions or need arbitrary request composition. Its callback returns the original result or error; a Standard Schema validator is optional.

```ts
import { createProcedure, createHttpTransport } from 'light-sdk-builder'
import { z } from 'zod'

const procedure = createProcedure(createHttpTransport(fetch))
const routes = {
  users: procedure
    .path('users')
    .input(z.object({ search: z.string() }))
    .query(async ({ input, http, signal }) => {
      const url = new URL('https://example.com/users')
      url.searchParams.set('search', input.search)
      const response = await http(url, { signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }),
}
await routes.users.query({ input: { search: 'Ada' } })
```

`createHttpTransport` retains your client's exact type. The callback decides how to parse responses and handle errors. To use up-fetch instead, install it explicitly and import its helpers directly:

```ts
import { up, isResponseError } from 'up-fetch'

const http = up(fetch, () => ({ baseUrl: 'https://example.com' }))
const procedure = createProcedure(createHttpTransport(http))
const users = procedure.path('users').query(({ http }) => http('/users'))
```

Core does not install or reexport up-fetch. A custom client object works too: `createHttpTransport(myClient)` makes that same object available as `http`. `createHttpTransport(auth.fetch)` connects a user-owned [auth source](auth.md).

## Application request context

Use `.context` to resolve arbitrary application data or select a different client after validation. Core has no organisation, tenancy or scope policy:

```ts
const users = procedure
  .path('users')
  .input(z.object({ project: z.string(), search: z.string() }))
  .context({
    resolve: async ({ input }) => ({
      http: await clientForProject(input.project),
      input: { search: input.search },
    }),
    keyContext: ({ input }) => [{ project: input.project }],
  })
  .query(({ input, http, signal }) => http('/users', { params: input, signal }))
```

Context resolvers compose in declaration order. Their fields extend or replace callback fields, including `http` and `input`. Replacing an existing input schema resets its context; add context after the schema it uses. `keyContext` is synchronous and reads raw caller arguments. Provide a non-secret identity whenever context changes the result; headers and resolved context never enter keys automatically. A later selector replaces the earlier selector. Constructor `createProcedure(transport, { keyContext })` supplies a default identity. Mutation keys use that default, excluding mutation variables.

`queryKey(args)` appends key context to the path/input key. `baseKey(args)` omits it, for invalidation across application contexts. Infinite queries append `'infinite'` to their full key. Keys follow raw input; schema transforms apply only when the request executes.

Calls check cancellation before/after validation, context resolution and execution. Forward the callback's `signal` to your client to cancel in-flight work. If the chosen client supports per-request defaults, bind them once:

```ts
const transport = createHttpTransport(myClient, {
  bind: (http, { signal }) => http.withDefaults({ signal }),
})
```

The binder returns the same client type and runs for each execution. Core does not assume a client's options shape, rewrite its errors, or add retries. Path schemas, custom keys, mutations and pagination use the same builder; frameworks stay in optional plugins.
