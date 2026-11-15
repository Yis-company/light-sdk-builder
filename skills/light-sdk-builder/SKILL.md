---
name: light-sdk-builder
description: Author or migrate SDK routes with light-sdk-builder reusable procedure definitions, application-owned HTTP clients, Standard Schema validation and optional framework plugins. Use when working on a light-sdk-builder integration.
---

# Reusable SDK routes

Keep route definitions reusable across runtime instances. The application chooses its HTTP client, validator, authentication source and framework integration. Preserve those choices; do not introduce up-fetch, Zod, React or TanStack Query unless the application needs them.

## Authoring boundary

Create one typed builder in a shared authoring module:

```ts
import { createSdkBuilder } from 'light-sdk-builder'
import { bind, keyContext, type Http } from './http.js'

export const sdk = createSdkBuilder<Http>({ bind, keyContext })
export const procedure = sdk.procedure
```

`Http`, `bind` and `keyContext` above belong to the application:

- `bind(http, callOptions)` may adapt cancellation and other per-call options to the selected client's API. Omit it if callbacks already pass the signal correctly.
- Builder `keyContext({ http })` returns synchronous, non-secret cache identity for that instance, such as account and organisation IDs. Omit it when no additional identity is needed. Never put tokens or authorization headers in keys.

Export static procedure definitions and a static nested route tree. For a fetch-like application client:

```ts
import { procedure } from './sdk-definition.js'

export const users = procedure
  .path('users')
  .query(({ http, path, signal }) => http(path, { signal }))
export const routes = { users }
```

Raw fetch needs an absolute URL; resolve the API base URL in application code. For an object client, call its own methods in the callback instead. Callbacks receive the client bound for that SDK instance. Do not close over a runtime client or read a global active client from shared definitions.

Bind at each runtime's composition boundary:

```ts
const api = sdk.create({ http, routes })
```

Optional plugins belong there too, for example `sdk.create({ http, routes, plugins: [tanstackQuery()] })` with `tanstackQuery` imported from `light-sdk-builder-tanstack-query`. Keep framework imports outside route modules. Core-only and backend integrations need no framework plugin.

## Validation and request context

Use the application's Standard Schema validator with `.input(schema)` or schema-based `.path(...)`. Preserve the difference between raw caller arguments and parsed input.

`.context({ resolve, keyContext })` is for request context:

- `resolve` receives parsed input, the resolved path, signal and the request-bound HTTP client. It may return extra context asynchronously. Keep auth, tenant and organisation policy in application code.
- Its optional synchronous `keyContext(rawArgs, { http })` receives raw caller arguments and the instance client. It supplies the context identity used by keys; it is separate from asynchronous resolution. If supplied, it takes precedence over the builder's key selector, so include the full required non-secret identity.

Forward cancellation to the transport. Preserve existing native errors, upload/download behavior, request headers and auth recovery. Authentication state and refresh coordination remain application-owned; no module-global token or active-client singleton is needed.

## Migration and React

Move per-route client factories to exported `sdk.procedure` definitions, then bind the complete route tree once per runtime with `sdk.create`. Existing bound `createProcedure` stays available for low-level use; migrate only the intended route boundary. Avoid changing URLs, schemas, request bodies or cache identity while moving ownership.

For hooks, use `createUseSdk(useClient, http => sdk.create({ http, routes, plugins: [tanstackQuery()] }))` from `light-sdk-builder-react/context` outside route modules when those integrations were chosen. Keep `useClient` identity stable for the lifetime of its runtime. A supplied SDK provider is another supported composition option.

Verify behavior with two concurrent clients sharing the same definitions: requests, credentials, keys and cancellation must stay isolated. Check the application's selected validator and framework paths as applicable. Opt-in route lint can flag bound authoring and runtime framework imports; it cannot prove cross-file client isolation.
