# light-sdk-builder

Build a small typed SDK for an existing API, whatever language its backend uses.
Define HTTP contracts once, validate with any Standard Schema v1 validator, and call them with plain async functions. Add TanStack Query when your application needs it.

This Bun/Turborepo monorepo contains five ESM packages:

| Package                                                       | Purpose                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`light-sdk-builder`](packages/core)                          | HTTP endpoints, validation, errors, request preparation, and transport-neutral operations |
| [`light-sdk-builder-tanstack-query`](packages/tanstack-query) | Query, mutation, and infinite-query options for TanStack Query v5                         |
| [`light-sdk-builder-auth`](packages/auth)                     | User-owned auth sources, recovery and session isolation                                   |
| [`light-sdk-builder-react`](packages/react)                   | SDK context and React bindings for auth sources                                           |
| [`eslint-plugin-light-sdk-builder`](packages/eslint-plugin)   | Opt-in lint rules for reusable route authoring                                            |

Connect authentication once through an application-owned source. React bindings and TanStack Query are optional. See [Auth integration](docs/auth.md).

All five packages share one version, currently **`0.1.0-beta.5`**; install matching versions together. The API may change during beta. Supports Node 22+, Bun, browsers with Fetch/AbortController, and TypeScript 5.5+. Core requires neither React, up-fetch nor a validator implementation. Procedure callbacks accept native fetch, up-fetch or a custom HTTP client without changing the client's types or errors.

## Quickstart

Install the beta:

```sh
npm install light-sdk-builder@beta zod
```

```ts
import { createClient, endpoint } from 'light-sdk-builder'
import { z } from 'zod'

const getUser = endpoint({
  name: 'users.get',
  method: 'GET',
  path: '/users/:id',
  input: z.object({ params: z.object({ id: z.number() }) }),
  responses: {
    200: z.object({ id: z.number(), name: z.string() }),
    404: z.object({ message: z.string() }),
  },
})

const users = getUser.bind(createClient({ baseUrl: 'https://example.com/api' }))
const result = await users.call({ params: { id: 7 } })
if (result.status === 200) console.log(result.data.name)
if (result.status === 404) console.log(result.data.message)
```

Zod is one option. Valibot and custom synchronous or asynchronous Standard Schema v1 validators use the same interface.

## SDK composition

Declare `createSdkBuilder<Http>()` once and export routes built with `sdk.procedure`. Bind a runtime client with `sdk.create({ http, routes })`; add `plugins: [tanstackQuery()]` when needed. Shared definitions hold no client and work across independent SDK instances. [Reusable procedure authoring](docs/reusable-procedures.md). Existing bound procedures and route factories remain supported. The optional TanStack `/react` entry supplies a configured SDK hook, query hooks and provider exports. [Plugin setup](docs/plugins.md).

## Documentation

- [Reusable procedures](docs/reusable-procedures.md): define routes once and bind clients per SDK instance.
- [Opt-in lint and agent skill](docs/lint.md): ESLint/Oxlint setup and a repository-distributed authoring skill.
- [Getting started](docs/getting-started.md): contracts, validation, errors, cancellation, and existing SDK integration.
- [TanStack Query](docs/tanstack-query.md): installation, hooks, prepared keys, pagination, and import migration.
- [Releases](docs/releases.md): Changesets, beta versions, artifact checks, and publication gates.

The old preview import `light-sdk-builder/tanstack-query` moves to `light-sdk-builder-tanstack-query`. Core imports stay the same.

## Development

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run format:check
bun run test:package
bunx playwright install chromium
bun run test:browser
```

Turbo orders dependency builds before package tests and TypeScript consumer checks. Task caching is disabled. Package checks install actual npm-packed archives in fresh npm/Bun projects; browser checks use the installed core and React archives. Release rehearsals also test Changesets-produced archives.

To try the unpublished packages locally, run `bun run build` and `bun run test:package`, then install the `.tgz` files for the packages you use in `artifacts/` together. A core-only consumer needs only the core archive.

Use `bun run changeset` for package changes. Versions are independent; the repository root is private. See the [release guide](docs/releases.md) before changing versions or publishing.

Licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE).
