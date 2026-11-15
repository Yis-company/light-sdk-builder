# light-sdk-builder-tanstack-query

TanStack Query v5 options for `light-sdk-builder` endpoints. Works with Query Core and its framework adapters; React is not required by this package.

**Beta; publication pending.** After publication:

```sh
npm install light-sdk-builder@beta light-sdk-builder-tanstack-query@beta @tanstack/query-core
# For React applications, also install @tanstack/react-query and react.
```

```ts
import { QueryClient } from '@tanstack/query-core'
import { queryOptions } from 'light-sdk-builder-tanstack-query'

// users.get is an endpoint bound to your application's client.
const client = new QueryClient()
const user = await client.fetchQuery(queryOptions(users.get, { params: { id: 7 } }))
```

Exports `queryOptions`, `preparedQueryOptions`, `mutationOptions`, `infiniteQueryOptions`, and option types. Successful responses unwrap to data; declared HTTP failures throw core's `HttpError`. Core and TanStack Query Core are peer dependencies, so the application owns their versions and QueryClient.

Requires Node 22+ or a browser/Bun Fetch runtime, TypeScript 5.5+, and TanStack Query Core 5.105+. Replace the preview import `light-sdk-builder/tanstack-query` with `light-sdk-builder-tanstack-query`.

- [Usage, cancellation, keys, and pagination](https://github.com/Yis-company/light-sdk-builder/blob/main/docs/tanstack-query.md)
- [Core package](https://github.com/Yis-company/light-sdk-builder/tree/main/packages/core)
- [Repository and development](https://github.com/Yis-company/light-sdk-builder)

Apache-2.0. See LICENSE and NOTICE.

`withTanStack(coreSdk)` adds options to core procedure descriptors and endpoint bindings. `bindAuthToQueryClient(queryClient, authBridge)` isolates query caches across logical sessions while preserving them during credential rotation. Auth and React bindings remain separate optional packages.
