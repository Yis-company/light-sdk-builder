# TanStack Query

The adapter is a separate ESM package. Core also supports direct async calls; use this package when you want TanStack Query v5 options.

## Install and migrate

Publication of `0.1.0-beta.0` is pending. After publication:

```sh
npm install light-sdk-builder@beta light-sdk-builder-tanstack-query@beta @tanstack/query-core
# React consumers also need @tanstack/react-query and react.
```

Core and Query Core are peer dependencies. Install compatible versions once in the application so core error identity is shared. Match Query Core to the version required by your framework adapter to avoid duplicate TanStack types.

```ts
// Before: import { queryOptions } from 'light-sdk-builder/tanstack-query'
import { queryOptions } from 'light-sdk-builder-tanstack-query'
```

The option builders retain their signatures. Core imports remain `light-sdk-builder`. The examples below use the `sdk` from [Getting started](getting-started.md) and an application-owned `QueryClient`.

## Queries and mutations

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { mutationOptions, queryOptions } from 'light-sdk-builder-tanstack-query'

// Inside a React component/custom hook:
const queryClient = useQueryClient()
const query = useQuery(queryOptions(sdk.users.get, { params: { id: 7 } }))
const mutation = useMutation(
  mutationOptions(sdk.users.create, {
    onSuccess: (created) =>
      queryClient.invalidateQueries({
        queryKey: sdk.users.get.key({ params: { id: created.id } }),
      }),
  }),
)
mutation.mutate({ body: { name: 'Ada' } })
```

These builders also work with `QueryClient.fetchQuery` from `@tanstack/query-core`; the package has no React dependency. It returns TanStack options rather than creating a provider, QueryClient, or framework-specific hooks. Other framework adapters can consume those options where their types permit.

Successful endpoint results unwrap to data. Declared failures throw core's `HttpError`; validation, network errors, and abort reasons pass through. Callbacks and metadata pass through. Retries default to `false`; override them explicitly when appropriate. The application owns invalidation.

Query functions forward TanStack's `AbortSignal`. Mutations receive no automatic signal from TanStack; an explicit one can be supplied as the third argument:

```ts
const controller = new AbortController()
const options = mutationOptions(sdk.users.create, undefined, { signal: controller.signal })
```

## Raw and prepared keys

`queryOptions` is synchronous, suitable for hooks, and snapshots raw input once. Every execution receives a new copy of that snapshot. Raw inputs must be plain JSON; omit undefined fields and transform dates/classes before key creation. See [snapshot constraints](getting-started.md#authentication-scopes-and-snapshots).

Two raw values can produce different keys even when a schema transform would make their requests identical. For canonical keys, prepare explicitly in a loader or prefetch step:

```ts
import { preparedQueryOptions } from 'light-sdk-builder-tanstack-query'

const prepared = await sdk.users.get.prepare({ params: { id: 7 } })
await queryClient.fetchQuery(preparedQueryOptions(prepared))
```

Do not await `prepare` during client render. Preparation captures the canonical request and key; create a new scoped client after an organisation change. Keys include endpoint identity and scope, and exclude authentication headers.

## Pagination

`infiniteQueryOptions` supports cursor or numbered pages. Its `page` callback returns a prepared callable request, synchronously or asynchronously:

```ts
import { infiniteQueryOptions } from 'light-sdk-builder-tanstack-query'

const options = infiniteQueryOptions({
  key: sdk.users.list.key({ query: { limit: 20 } }),
  initialPageParam: 0,
  page: (offset) => sdk.users.list.prepare({ query: { limit: 20, offset } }),
  getNextPageParam: (lastPage) => lastPage.nextOffset,
})
```

Here `sdk.users.list` is an endpoint you define with a response containing `nextOffset`. Return `null` or `undefined` when there are no further pages. Finite and infinite keys are separated to avoid incompatible cached data.

## Add helpers to an existing core SDK

`withTanStack(coreSdk)` returns a facade with `queryOptions` and `mutationOptions` on procedure descriptors. Existing plain `query`/`mutate` methods remain available. Core endpoint bindings also gain query/mutation helpers. Infinite procedures already expose their explicit page/options contract. Apply the adapter once when constructing the SDK; React hooks remain normal TanStack hooks.

```ts
import { withTanStack, bindAuthToQueryClient } from 'light-sdk-builder-tanstack-query'

const api = withTanStack(coreSdk)
// useQuery(api.users.queryOptions({ input: { search: 'Ada' } }))
const disconnect = bindAuthToQueryClient(queryClient, authBridge)
// Call disconnect when the integration owner unmounts/disposes.
```

The optional auth binding cancels/removes query data on logical session changes. Credential revision changes preserve cache. Use one bridge per server request and a fresh QueryClient per server request. Mutation side effects, persisted caches and raw streams remain application-owned.
