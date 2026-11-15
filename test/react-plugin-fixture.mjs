import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createProcedure, createSdk, createHttpTransport } from 'light-sdk-builder'
import { createSdkContext } from 'light-sdk-builder-react/context'
import {
  createUseTanStackSdk,
  QueryClient,
  QueryClientProvider,
} from 'light-sdk-builder-tanstack-query/react'

const transport = createHttpTransport(async () => Response.json({ ready: true }))
let builds = 0
const routes = (client) => {
  builds++
  return {
    ping: createProcedure(client)
      .path('ping')
      .query(async ({ path, http, signal }) =>
        (await http(new URL(path, 'https://fixture.invalid'), { signal })).json(),
      ),
  }
}
const backend = createSdk({ routes, transport })
assert.equal('queryOptions' in backend.ping, false)
assert.deepEqual(await backend.ping.query(), { ready: true })
const context = createSdkContext()
const useApi = createUseTanStackSdk(context.useSdk, routes)
const observed = []
function Screen() {
  observed.push(useApi())
  return createElement('p', null, 'ready')
}
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
try {
  renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        context.Provider,
        { sdk: transport },
        createElement(Screen),
        createElement(Screen),
      ),
    ),
  )
  assert.equal(observed[0], observed[1])
  assert.equal(builds, 2, 'One backend SDK and one shared React SDK')
  assert.deepEqual(await client.fetchQuery(observed[0].ping.queryOptions()), { ready: true })
} finally {
  client.clear()
}
