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

`queryOptions` is synchronous, suitable for hooks, and snapshots raw input once. Every execution receives a new copy of that snapshot. Raw inputs must be plain JSON; omit undefined fields and transform dates/classes before key creation. See [snapshot constraints](getting-started.md#authentication-context-and-snapshots).

Two raw values can produce different keys even when a schema transform would make their requests identical. For canonical keys, prepare explicitly in a loader or prefetch step:

```ts
import { preparedQueryOptions } from 'light-sdk-builder-tanstack-query'

const prepared = await sdk.users.get.prepare({ params: { id: 7 } })
await queryClient.fetchQuery(preparedQueryOptions(prepared))
```

Do not await `prepare` during client render. Preparation captures the canonical request and key; create a new client after application context changes. Keys include endpoint identity and key context, and exclude authentication headers.

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

## Register once at SDK initialization

With reusable definitions, use `sdk.create({ http, routes, plugins: [tanstackQuery()] })`. Definitions import only the configured core procedure helper; binding and adapter setup happen once per SDK instance. See [reusable procedures](reusable-procedures.md). Existing route factories remain supported:

Route factories import core only. Enable the plugin in the consuming application:

```ts
import { createSdk } from 'light-sdk-builder'
import { tanstackQuery, bindAuthToQueryClient } from 'light-sdk-builder-tanstack-query'

const api = createSdk({ routes, transport, plugins: [tanstackQuery()] })
// useQuery(api.users.queryOptions({ input: { search: 'Ada' } }))
const disconnect = bindAuthToQueryClient(queryClient, authBridge)
```

Query, mutation and infinite-query helpers are added to the SDK; direct methods remain available. Backend initialization omits plugins and returns only the core features. `withTanStack` remains a compatibility helper for older beta consumers; new applications register `tanstackQuery()` instead of wrapping routes.

## React setup

```ts
import {
  createUseTanStackSdk,
  useQuery,
  QueryClient,
  QueryClientProvider,
} from 'light-sdk-builder-tanstack-query/react'

export const useApi = createUseTanStackSdk(useTransport, routes)
// Inside a component under QueryClientProvider:
// const query = useQuery(useApi().users.queryOptions({ input: { search: 'Ada' } }))
```

The hook shares one SDK per transport and registers TanStack automatically. `createUseSdk` and `createSdkContext` are also exported for custom application composition. Pass your QueryClient to `QueryClientProvider`; its cache defaults and invalidation policy remain yours. The optional React entry requires React, React Query and `light-sdk-builder-react`, and loads no auth package. Query Core usage through the main entry needs none of these React dependencies.

The optional auth binding cancels/removes query data on logical session changes. Credential revision changes preserve cache. Disconnect on disposal. Server auth bridges and QueryClients remain request-local. Mutation side effects, persisted caches and raw streams remain application-owned. See [SDK plugins](plugins.md).
