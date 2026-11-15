import { createHttpTransport, createProcedure } from 'light-sdk-builder'
import { up } from 'up-fetch'
import { z } from 'zod'

const native = createProcedure(createHttpTransport(fetch))
  .path('native')
  .query(({ http, signal }) => http('https://fixture.invalid', { signal }))
const response: Promise<Response> = native.query()
const chosen = up(fetch, () => ({ baseUrl: 'https://fixture.invalid' }))
const parsed = createProcedure(createHttpTransport(chosen))
  .path('users')
  .query(({ http, path }) => http(path, { schema: z.object({ name: z.string() }) }))
const user: Promise<{ name: string }> = parsed.query()
const custom = { get: async (_url: string) => ({ count: 7 }) }
const counted = createProcedure(createHttpTransport(custom))
  .path('count')
  .query(({ http, path }) => http.get(path))
const count: Promise<{ count: number }> = counted.query()
const contextual = createProcedure(createHttpTransport(custom))
  .path('count')
  .input(z.object({ account: z.number(), value: z.string().transform(Number) }))
  .context({
    resolve: ({ input }) => {
      const { account, ...remaining } = input
      return { input: remaining, account }
    },
    keyContext: ({ input }) => [input.account],
  })
  .query(async ({ account, input, http }) => {
    const a: number = account
    const n: number = input.value
    // @ts-expect-error the application context deliberately removed this field
    input.account
    return { a, n, count: (await http.get('/count')).count }
  })
void [response, user, count, contextual]
