# light-sdk-builder

A small ESM SDK builder for existing HTTP APIs. Define endpoints with typed input and status-specific responses, validate through Standard Schema v1, and call them without a framework.

**Beta; publication pending.** After publication:

```sh
npm install light-sdk-builder@beta
```

```ts
import { createClient, endpoint, unwrap } from 'light-sdk-builder'
import { z } from 'zod' // npm install zod, or use another Standard Schema validator

const ping = endpoint({
  name: 'ping',
  method: 'GET',
  path: '/ping',
  responses: { 200: z.object({ ready: z.boolean() }) },
}).bind(createClient({ baseUrl: 'https://example.com/api' }))

const data = unwrap(await ping.call())
```

Supports Node 22+, Bun, browsers with Fetch/AbortController, and TypeScript 5.5+. React and TanStack are optional separate dependencies of consumers using an adapter. A validator implementation is supplied by the application.

For callback-based APIs, `createProcedure(createTransport(fetch))` supplies typed path/input builders, scope policies and plain async methods. Inject an auth bridge fetch function to connect existing auth logic.

Exports include `createProcedure`, `createTransport`, `scopeTransport`, `endpoint`, `createClient`, `createOperation`, `validateSchema`, `serializeQuery`, `captureInput`, `unwrap`, error classes, and their public types. `captureInput` copies plain JSON inputs and rejects values whose JSON representation would lose information; adapters can use it to preserve request snapshots.

- [Getting started and API behavior](https://github.com/Yis-company/light-sdk-builder/blob/main/docs/getting-started.md)
- [Optional TanStack Query package](https://github.com/Yis-company/light-sdk-builder/blob/main/docs/tanstack-query.md)
- [Repository and development](https://github.com/Yis-company/light-sdk-builder)

Apache-2.0. See LICENSE and NOTICE.
