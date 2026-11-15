import { createSdkBuilder } from 'light-sdk-builder'
import { tanstackQuery } from 'light-sdk-builder-tanstack-query'
import { up } from 'up-fetch'
import { z } from 'zod'

const builder = createSdkBuilder<ReturnType<typeof up<typeof fetch>>>({
  keyContext: ({ http }) => {
    void http
    return ['public']
  },
})
const users = builder.procedure
  .path('users')
  .input(z.object({ project: z.string().transform(Number), search: z.string() }))
  .context({
    keyContext: ({ input }, { http }) => {
      void http
      return [input.project]
    },
    resolve: ({ input }) => ({ input: { search: input.search }, project: input.project }),
  })
  .query(({ http, input, project, path, signal }) => {
    const id: number = project
    // @ts-expect-error removed by the request context
    input.project
    return http(path, { params: { ...input, id }, signal, schema: z.object({ name: z.string() }) })
  })
// @ts-expect-error a shared definition is not executable before binding
users.query({ input: { project: '7', search: 'Ada' } })
const routes = { users }
const plain = builder.create({ http: up(fetch), routes })
const result: Promise<{ name: string }> = plain.users.query({
  input: { project: '7', search: 'Ada' },
})
// @ts-expect-error no query framework without a plugin
plain.users.queryOptions({ input: { project: '7', search: 'Ada' } })
// @ts-expect-error incorrect client for this definition family
builder.create({ http: { get: async () => 'wrong' }, routes })
const query = builder.create({ http: up(fetch), routes, plugins: [tanstackQuery()] })
const options = query.users.queryOptions({ input: { project: '7', search: 'Ada' } })
const native = createSdkBuilder<typeof fetch>()
const raw = native.procedure
  .path('raw')
  .query(({ http, signal }) => http('https://fixture.invalid', { signal }))
// @ts-expect-error definitions requiring up-fetch cannot bind to a native-fetch builder
native.create({ http: fetch, routes: { users } })
const rawResult: Promise<Response> = native.create({ http: fetch, routes: { raw } }).raw.query()
void [result, options, rawResult]
