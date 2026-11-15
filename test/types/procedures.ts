import { z } from 'zod'
import { useQuery, useMutation, useInfiniteQuery, QueryClient } from '@tanstack/react-query'
import { createProcedure, createTransport, type StandardSchemaV1 } from 'light-sdk-builder'
import { withTanStack } from 'light-sdk-builder-tanstack-query'

const p = createProcedure(createTransport(), {
  scope: (id) => ({ key: [id] }),
  scopeContextKey: 'teamId',
})
const core = {
  get: p
    .path('users')
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => ({ name: String(input.id) })),
  update: p
    .path(z.object({ id: z.number().transform(String) }), (path) => ['users', path.id])
    .input(
      z.object({
        name: z.string().transform((value) => value.length),
        team: z.number().optional(),
      }),
    )
    .scope('team')
    .mutation(async ({ input, teamId }) => ({ length: input.name, team: teamId })),
  pages: p.path('users').infiniteQuery(
    async ({ page }) => ({ page }),
    (last) => (last.page < 2 ? last.page + 1 : undefined),
  ),
}
const api = withTanStack(core)
const query = useQuery(api.get.queryOptions({ input: { id: 7 } }, { select: (data) => data.name }))
const selected: string | undefined = query.data
const options = api.get.queryOptions({ input: { id: 7 } })
const cached: { name: string } | undefined = new QueryClient().getQueryData(options.queryKey)
const mutation = useMutation(api.update.mutationOptions({ path: { id: 7 } }))
mutation.mutate({ name: 'Ada', team: 9 })
const direct = await core.update.mutate({ path: { id: 7 }, input: { name: 'Ada' } })
const size: number = direct.length
const team: number | undefined = direct.team
useInfiniteQuery(api.pages.queryOptions())
// @ts-expect-error Input transforms apply after the caller supplies the schema input.
mutation.mutate({ name: 3 })
// @ts-expect-error Plain core SDK does not require or expose TanStack options.
core.get.queryOptions({ input: { id: 7 } })
const asyncSchema: StandardSchemaV1<string, number> = {
  '~standard': {
    version: 1,
    vendor: 'async',
    validate: async (value) =>
      typeof value === 'string'
        ? { value: value.length }
        : { issues: [{ message: 'string required' }] },
  },
}
p.path('value')
  .input(asyncSchema)
  .query(async ({ input }) => {
    const n: number = input
    return n
  })
void [selected, cached, size, team]
p.path(
  z.string().transform((id) => ({ id })),
  (parsed) => ['users', parsed.id],
  (raw) => ['users', raw],
).query(async ({ path }) => path)
const http = (await import('light-sdk-builder'))
  .endpoint({
    name: 'http',
    method: 'GET',
    path: '/users',
    responses: { 200: z.object({ name: z.string() }), 404: z.object({ message: z.string() }) },
  })
  .bind((await import('light-sdk-builder')).createClient({ baseUrl: 'https://sdk.invalid' }))
const httpSdk = withTanStack({ http })
const httpQuery = useQuery(httpSdk.http.queryOptions(undefined, { select: (user) => user.name }))
const httpName: string | undefined = httpQuery.data
void httpName

const optimistic = api.update.mutationOptions(
  { path: { id: 7 } },
  {
    onError: (_error, _variables, context) => {
      void context
    },
    onMutate: async (_variables): Promise<{ previous: string }> => ({ previous: 'before' }),
    onSuccess: (_data, _variables, context) => {
      const previous = (context as { previous: string }).previous
      void previous
    },
  },
)
useMutation(optimistic)
useMutation({
  ...api.update.mutationOptions({ path: { id: 7 } }),
  onMutate: async (variables) => {
    const name: string = variables.name
    void name
  },
})
useMutation({
  ...api.update.mutationOptions({ path: { id: 7 } }, { meta: { source: 'test' } }),
  onMutate: async (variables) => ({ previous: variables.name }),
})

const typedOptimistic = api.update.mutationOptions(
  { path: { id: 7 } },
  {
    onMutate: async (variables) => ({ previous: variables.name }),
    onSuccess: (_data, _variables, context) => {
      const previous: string = context.previous
      void previous
    },
  },
)
useMutation(typedOptimistic)

const noPath = withTanStack({
  create: p
    .path('items')
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => input),
})
useMutation({
  ...noPath.create.mutationOptions(),
  onMutate: async (variables) => {
    void variables.name
  },
})
const noVariables = withTanStack({
  remove: p
    .path(z.object({ id: z.number() }), (path) => ['items', path.id])
    .mutation(async () => undefined),
})
useMutation({
  ...noVariables.remove.mutationOptions({ path: { id: 7 } }),
  onMutate: async () => undefined,
})

// Contextual typing must survive nesting inside the real hook, including callbacks before onMutate.
useMutation(
  api.update.mutationOptions(
    { path: { id: 7 } },
    {
      onError: (error) => {
        const e: Error = error
        void e
      },
      onSuccess: (data) => {
        const length: number = data.length
        void length
      },
    },
  ),
)
useMutation(
  noPath.create.mutationOptions({
    onError: (_error, _variables, context) => {
      void context
    },
    onMutate: async (_variables): Promise<{ previous: string }> => ({ previous: 'before' }),
    onSuccess: (_data, _variables, context) => {
      void context
    },
  }),
)
