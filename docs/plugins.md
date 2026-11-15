# SDK initialization and plugins

Author reusable definitions with core only: declare `createSdkBuilder<Http>()`, export `sdk.procedure` routes, then bind them with `sdk.create({ http, routes, plugins })`. Explicit plugins run once in order after binding. Core imports no plugins and does no discovery or global registration. [Reusable authoring](reusable-procedures.md) is preferred for multi-module SDKs.

The existing route-factory API remains compatible:

```ts
import { createSdk } from 'light-sdk-builder'
import { routes } from './routes.js'

const backend = createSdk({ routes, transport })
await backend.users.list.query({ input: { search: 'Ada' } })
```

Enable TanStack in the consuming application's configuration:

```ts
import { createSdk } from 'light-sdk-builder'
import { tanstackQuery } from 'light-sdk-builder-tanstack-query'
import { routes } from './routes.js'

const frontend = createSdk({ routes, transport, plugins: [tanstackQuery()] })
const options = frontend.users.list.queryOptions({ input: { search: 'Ada' } })
```

The route factory contains no TanStack imports. The plugin adds query/mutation/infinite-query options and retains plain calls, including `queryPage`. A backend imports only core and its routes. Plugin configuration is local to each SDK, so enabling a plugin in one application does not affect another.

For React, import `createUseTanStackSdk`, query hooks and `QueryClientProvider` from `light-sdk-builder-tanstack-query/react`. Configure the SDK hook once with your transport hook and the same route factory. Alternatively, use its exported `createUseSdk` with an application factory that calls `createSdk` and registers plugins explicitly. This entry uses React bindings' `/context` subpath and needs no auth package. Auth integration remains optional.

## Reusable definitions

The preferred multi-module authoring flow uses `createSdkBuilder<Http>()`. Import its `procedure` helper in route modules, then register plugins with `sdk.create({ http, routes, plugins: [tanstackQuery()] })`. Binding produces a fresh callable tree before plugins run. The same definitions can back a core-only server SDK and a separate TanStack SDK; enabling a plugin in one instance does not modify definitions or another instance.

For React, use `createUseSdk(useHttp, http => sdk.create({ http, routes, plugins: [tanstackQuery()] }))`. The `createUseTanStackSdk` convenience factory also accepts an application factory that returns `sdk.create({ http, routes })`. See [reusable definitions](reusable-procedures.md) for client ownership, signal binding and key context. Existing route-factory registration above remains compatible.

## Other integrations

A plugin implements `setup(routes)`. `defineSdkPlugin` supplies its runtime object; `SdkPlugin` input/output type slots describe the result for the actual route tree. Core has no knowledge of TanStack or another framework's types.

```ts
import { defineSdkPlugin, type SdkPlugin } from 'light-sdk-builder'

interface LabelPlugin extends SdkPlugin {
  readonly output: this['input'] & { label: string }
}
const label = defineSdkPlugin<LabelPlugin>((sdk) => Object.assign({}, sdk, { label: 'Users' }))
```

Plugins are trusted synchronous initialization code. They should preserve existing route methods and avoid mutating shared definitions. Errors propagate immediately. Use a tuple (`as const` for a separately declared list) to retain plugin order and result typing. Initialization costs one route-factory call plus each plugin's work; TanStack walks the tree once and adds no HTTP calls. Ten times the routes means ten times the initialization work. At 100 times the route tree, cold initialization and TypeScript inference need measurement before adding complexity.
