import {
  createProcedure,
  createSdk,
  createHttpTransport,
  defineSdkPlugin,
  type SdkPlugin,
} from 'light-sdk-builder'
import { tanstackQuery } from 'light-sdk-builder-tanstack-query'
import {
  createUseTanStackSdk,
  QueryClientProvider,
  useQuery,
  useMutation,
} from 'light-sdk-builder-tanstack-query/react'
import { createSdkContext } from 'light-sdk-builder-react/context'
import { z } from 'zod'

const routes = (transport: ReturnType<typeof createHttpTransport<typeof fetch>>) => {
  const p = createProcedure(transport)
  return {
    list: p
      .path('users')
      .input(z.object({ q: z.string() }))
      .query(async ({ input }) => ({ name: input.q })),
    update: p
      .path('users')
      .input(z.object({ name: z.string() }))
      .mutation(async ({ input }) => input),
    pages: p.path('pages').infiniteQuery(
      async ({ page }) => ({ page }),
      (last) => (last.page < 2 ? last.page + 1 : undefined),
    ),
  }
}
const transport = createHttpTransport(fetch)
const backend = createSdk({ routes, transport })
const direct: Promise<{ name: string }> = backend.list.query({ input: { q: 'Ada' } })
// @ts-expect-error no plugin methods in a core SDK
backend.list.queryOptions({ input: { q: 'Ada' } })
interface LabelPlugin extends SdkPlugin {
  readonly output: this['input'] & { label: string }
}
const label = defineSdkPlugin<LabelPlugin>((sdk) => Object.assign({}, sdk, { label: 'users' }))
const frontend = createSdk({ routes, transport, plugins: [tanstackQuery(), label] })
const text: string = frontend.label
const result = useQuery(
  frontend.list.queryOptions({ input: { q: 'Ada' } }, { select: (data) => data.name }),
)
const name: string | undefined = result.data
useMutation(
  frontend.update.mutationOptions({
    onSuccess: (data) => {
      const value: string = data.name
      void value
    },
  }),
)
const page: Promise<{ page: number }> = frontend.pages.queryPage(undefined, 1)
const context = createSdkContext<typeof transport>()
const useApi = createUseTanStackSdk(context.useSdk, routes)
const HookResult = useApi
void [direct, text, name, page, HookResult, QueryClientProvider]
