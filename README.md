# light-sdk-builder

Build a small typed SDK for an API you do not control. The backend can use any language.

The core provides HTTP contracts, Standard Schema validation, and direct async calls. The optional TanStack Query adapter creates query and mutation options. Neither React nor a validator implementation is required by the core.

## Install

```sh
npm install light-sdk-builder
# Only when using the adapter:
npm install @tanstack/query-core
```

Version 0.1.0 is being prepared; npm publication is pending. A packed tarball can be installed with `npm install ./light-sdk-builder-0.1.0.tgz`.

Supported: Node 22+, Bun, browsers with Fetch/AbortController, TypeScript 5.5+, and TanStack Query Core 5.105+. Packages are ESM.

## Define an endpoint

Use any Standard Schema v1 validator. This example uses Zod; Valibot and custom asynchronous validators work through the same interface.

```ts
import { z } from 'zod'
import { createClient, endpoint } from 'light-sdk-builder'

const User = z.object({ id: z.number(), name: z.string() })
const getUser = endpoint({
  name: 'users.get',
  method: 'GET',
  path: '/users/:id',
  input: z.object({ params: z.object({ id: z.number() }) }),
  responses: {
    200: User,
    404: z.object({ message: z.string() }),
  },
})

const client = createClient({
  baseUrl: 'https://example.com/api',
  headers: { Authorization: `Bearer ${token}` },
  scope: { key: [{ workspace: 7 }], headers: { 'X-Workspace': '7' } },
})
const createUser = endpoint({
  name: 'users.create',
  method: 'POST',
  path: '/users',
  input: z.object({ body: z.object({ name: z.string() }) }),
  responses: { 201: User },
})
const sdk = { users: { get: getUser.bind(client), create: createUser.bind(client) } }
const result = await sdk.users.get.call({ params: { id: 7 } }, { signal })
if (result.status === 200) console.log(result.data.name)
if (result.status === 404) console.log(result.data.message)
```

Inputs use `{ params?, query?, body? }`. Path placeholders must exist in the schema's parsed output. Requests receive transformed values; callers provide the schema's input type. Scope headers and key context are captured when creating the client. Supply a new client when the scope changes. Inject `fetch` for custom authentication or transport behaviour.

Declare success and error response schemas by numeric HTTP status. Declared errors return a discriminated result. Input/response issues throw `ValidationError`; invalid JSON throws `ResponseDecodeError`; undeclared statuses throw `UnexpectedStatusError` with the received body. Network errors pass through unchanged. `unwrap(result)` returns successful data or throws `HttpError` containing the declared result.

## TanStack Query

```ts
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryOptions, mutationOptions } from 'light-sdk-builder/tanstack-query'

const query = useQuery(queryOptions(sdk.users.get, { params: { id: 7 } }))
// For an endpoint with an input body:
const mutation = useMutation(
  mutationOptions(sdk.users.create, {
    onSuccess: (created) =>
      queryClient.invalidateQueries({
        queryKey: sdk.users.get.key({ params: { id: created.id } }),
      }),
  }),
)
```

The adapter unwraps successful results and throws declared HTTP errors. Query cancellation forwards TanStack's AbortSignal. Mutation signals can be supplied as the third `mutationOptions` argument. Metadata and callbacks pass through. The host application owns its QueryClient, invalidation policy, and retries; adapter retries default to false.

`queryOptions` is synchronous and keys raw input. Inputs `" 7 "` and `7` can therefore occupy different cache entries even if validation produces the same request. For canonical keys in a loader or prefetch step:

```ts
import { preparedQueryOptions } from 'light-sdk-builder/tanstack-query'
const prepared = await sdk.users.get.prepare({ params: { id: 7 } })
await queryClient.fetchQuery(preparedQueryOptions(prepared))
```

Do not await `prepare` inside client render. Prepared requests capture body, headers, and canonical keys. Keys include namespace, base URL, endpoint identity, and explicit scope; authentication headers are excluded. Raw query options capture their input once. Cache inputs must be plain JSON: omit undefined fields, avoid negative zero/nonfinite numbers, and transform Date/class instances or use `prepare`. Each query execution receives its own captured-input copy. Keep credentials out of cached request inputs.

`infiniteQueryOptions({ key, initialPageParam, page, getNextPageParam })` supports cursor or numbered pagination. `page` returns a callable prepared request, synchronously or asynchronously. Finite and infinite queries have different keys.

## Existing SDKs

`createOperation({ resolve, execute })` provides a transport-neutral execution boundary. Existing SDKs can keep their request functions, callback results, errors, and query-key policy in an application-owned compatibility adapter. The core does not prescribe organisation headers or authentication refresh.

Query arrays use repeated parameters; null/undefined values are omitted. Nested query values need an input transform into strings. JSON bodies and empty 204/205/HEAD responses are supported. Automatic retries, auth orchestration, uploads, streams, and OpenAPI generation are outside 0.1.0.

## Development

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run typecheck
bun run typecheck:minimum
bun run test
bun run test:package
bunx playwright install chromium
bun run test:browser
```

The package check installs the actual tarball outside the checkout with npm and Bun, then checks core-only use and React Query runtime/types. `test/types/consumer.ts` verifies the public API with TypeScript 7 and 5.5.

Licensed under Apache-2.0. See LICENSE and NOTICE.
