import { z } from 'zod'
import * as v from 'valibot'
import { QueryClient, useQuery, useMutation, useInfiniteQuery } from '@tanstack/react-query'
import {
  endpoint,
  createClient,
  createOperation,
  validateSchema,
  type StandardSchemaV1,
} from '../../dist/index.js'
import {
  queryOptions,
  preparedQueryOptions,
  mutationOptions,
  infiniteQueryOptions,
} from '../../dist/tanstack-query.js'
const user = z.object({ name: z.string() })
const read = endpoint({
  name: 'users.get',
  method: 'GET',
  path: '/users/:id',
  input: z.object({ params: z.object({ id: z.number().transform(String) }) }),
  responses: { 200: user, 404: z.object({ message: z.string() }) },
})
const bound = read.bind(createClient({ baseUrl: 'https://example.test' }))
const response = await bound.call({ params: { id: 7 } })
const text: string = response.status === 200 ? response.data.name : response.data.message
const parsed = await validateSchema(z.string().transform(Number), '7')
const numeric: number = parsed
const options = queryOptions(bound, { params: { id: 7 } })
const cached = new QueryClient().getQueryData(options.queryKey)
const cachedUser: { name: string } | undefined = cached
const query = useQuery(queryOptions(bound, { params: { id: 7 } }, { select: (data) => data.name }))
const selected: string | undefined = query.data
useQuery(preparedQueryOptions(await bound.prepare({ params: { id: 7 } })))
const create = endpoint({
  name: 'users.create',
  method: 'POST',
  path: '/users',
  input: z.object({ body: user }),
  responses: { 201: user },
}).bind(createClient({ baseUrl: 'https://example.test' }))
const mutation = useMutation(
  mutationOptions(create, {
    onMutate: (input) => ({ before: input.body.name }),
    onSuccess: (data, _input, context) => {
      const previous: string | undefined = context?.before
      return [data.name, previous]
    },
  }),
)
mutation.mutate({ body: { name: 'Ada' } })
const valibot = endpoint({
  name: 'v',
  method: 'GET',
  path: '/v',
  responses: { 200: v.object({ count: v.number() }) },
})
const valibotValue: number = (
  await valibot.bind(createClient({ baseUrl: 'https://example.test' })).call()
).data.count
useInfiniteQuery(
  infiniteQueryOptions({
    key: ['pages'],
    initialPageParam: 1,
    page: (page) => ({
      call: async () => ({ status: 200 as const, ok: true as const, data: { page } }),
    }),
    getNextPageParam: (last) => (last.page < 2 ? last.page + 1 : undefined),
  }),
)
// Expected compile failures guard the public SDK contract, rather than private implementation details.
// @ts-expect-error Every path placeholder must be supplied by parsed input.
endpoint({
  name: 'bad',
  method: 'GET',
  path: '/users/:id',
  input: z.object({ query: z.object({ id: z.number() }) }),
  responses: { 200: user },
})
// @ts-expect-error A parameterized route requires a matching input schema.
endpoint({ name: 'bad', method: 'GET', path: '/users/:id', responses: { 200: user } })
// @ts-expect-error Callers provide schema input, not transformed output.
bound.call({ params: { id: '7' } })
if (response.status === 404) {
  // @ts-expect-error An error response does not have the successful payload.
  response.data.name
}
const custom: StandardSchemaV1<{ id: number }, { id: string }> = {
  '~standard': {
    version: 1,
    vendor: 'custom',
    validate: (value) => ({ value: { id: String((value as { id: number }).id) } }),
  },
}
const customOutput: string = (await validateSchema(custom, { id: 1 })).id
const identity = createOperation({
  resolve: async (value: number) => String(value),
  execute: async (value) => value.length,
})
const length: number = await identity.call(1)
void [text, numeric, cachedUser, selected, valibotValue, customOutput, length]
