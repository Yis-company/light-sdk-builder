import assert from 'node:assert/strict'
import { QueryClient } from '@tanstack/query-core'
import { createProcedure, createSdk, createTransport } from 'light-sdk-builder'
import { tanstackQuery } from 'light-sdk-builder-tanstack-query'

const transport = createTransport(
  async () => Response.json({ ready: true }),
  () => ({ baseUrl: 'https://fixture.invalid' }),
)
const routes = (client) => ({
  ping: createProcedure(client)
    .path('ping')
    .query(({ path, upFetch }) => upFetch(path)),
})
const sdk = createSdk({ routes, transport, plugins: [tanstackQuery()] })
const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
try {
  assert.deepEqual(await client.fetchQuery(sdk.ping.queryOptions()), { ready: true })
  assert.deepEqual(await sdk.ping.query(), { ready: true })
} finally {
  client.clear()
}
