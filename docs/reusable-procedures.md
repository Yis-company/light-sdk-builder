# Reusable procedure definitions

Create a typed authoring helper once. It stores schemas, callbacks and policy functions, with no runtime HTTP client:

```ts
// sdk-definition.ts
import { createSdkBuilder } from 'light-sdk-builder'

export const sdk = createSdkBuilder<typeof fetch>()
export const procedure = sdk.procedure
```

Route modules import that helper. A definition has no executable query/mutation methods until an SDK instance binds it:

```ts
// routes/users.ts
import { procedure } from '../sdk-definition.js'
import { z } from 'zod' // or another Standard Schema validator

export const users = procedure
  .path('users')
  .input(z.object({ search: z.string() }))
  .query(async ({ http, input, signal }) => {
    const url = new URL('https://example.com/users')
    url.searchParams.set('search', input.search)
    const response = await http(url, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  })

export const routes = { users }
```

Bind the same definitions in each runtime:

```ts
const backend = sdk.create({ http: fetch, routes })
await backend.users.query({ input: { search: 'Ada' } })

// Optional integration, registered once at initialization:
const frontend = sdk.create({ http: fetch, routes, plugins: [tanstackQuery()] })
// useQuery(frontend.users.queryOptions({ input: { search: 'Ada' } }))
```

Import `tanstackQuery` from `light-sdk-builder-tanstack-query` only where the integration is configured. Backend initialization needs no framework package. For React, import `createUseSdk` from `light-sdk-builder-react/context`. `createUseSdk(useHttp, http => sdk.create({ http, routes, plugins: [tanstackQuery()] }))` shares one SDK per client; use it outside route modules.

## Client choice and request defaults

The generic parameter is your actual client type. Raw fetch returns native Responses; up-fetch preserves its schema inference and native errors; an object client retains its methods. Import native up-fetch helpers directly from `up-fetch`. Core never installs up-fetch or translates a client's results/errors.

An application may supply policy functions once when declaring the builder:

```ts
const sdk = createSdkBuilder<MyHttp>({
  bind: (http, { signal }) => http.withDefaults({ signal }),
  keyContext: ({ http }) => [{ account: http.accountId }],
})
```

`bind` returns the same client type for one invocation; it does not run while binding the route tree or generating keys. Omit it when callbacks forward `signal` themselves. `keyContext` is synchronous and must contain only non-secret cache identity. Auth/session credentials remain in your client or optional auth bridge, never in shared definitions.

## Context and keys

`.context({ resolve, keyContext })` extends or replaces callback fields after input validation. Resolvers run in declaration order against the request-bound client. Replacing an existing input schema resets its context. Both bound and reusable procedures use this same engine.

A context key selector receives `(rawArgs, { http })`, where `http` is the SDK instance's original client, before per-request binding. It runs synchronously and separately from validation/context resolution. It replaces an earlier context selector and takes precedence over the builder default; include the complete required identity. Do not capture a client in a module-level selector:

```ts
.context({
  resolve: ({ input, http }) => requestForProject(http, input),
  keyContext: ({ input }, { http }) => [{ account: http.accountId, project: input.project }],
})
```

`queryKey` appends context to path/raw input; `baseKey` omits that context for broad invalidation. Infinite queries append `'infinite'`. Mutation keys include the builder's default identity and exclude mutation variables, matching the existing bound API.

## Ownership and cost

SDK creation walks the nested route tree once and creates instance-local callables. It performs no HTTP requests, schema validation or context resolution. Plugins run afterward; TanStack performs its own existing tree walk. Shared schemas/definitions are reused and never rebound in place. Concurrent server requests must receive their own clients/auth sources. Route trees must be acyclic.

Binding is O(N) in route-tree entries. At 10× routes, work remains linear; at 100×, measure initialization and declaration inference before changing the design. There is no global active client, implicit discovery or new cache.

Existing `createProcedure(createHttpTransport(http))`, endpoint clients and `createSdk({ routes: factory, transport })` remain supported. Migrate one route tree at a time. Optional [lint rules and agent guidance](lint.md) help keep definitions separate from runtime setup; they do not replace isolation tests.
