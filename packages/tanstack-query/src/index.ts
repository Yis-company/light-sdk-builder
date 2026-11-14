import type {
  DataTag,
  InfiniteData,
  InfiniteQueryObserverOptions,
  MutationObserverOptions,
  QueryFunctionContext,
  QueryKey,
  QueryObserverOptions,
} from '@tanstack/query-core'
import {
  unwrap,
  captureInput,
  type CacheKey,
  type Callable,
  type CallOptions,
  type HttpResult,
  type Queryable,
  type Success,
} from 'light-sdk-builder'

export type QueryOverrides<T, Selected> = Omit<
  QueryObserverOptions<T, Error, Selected, T, QueryKey>,
  'queryKey' | 'queryFn' | 'initialData'
>
export type BuiltQueryOptions<T, Selected = T> = QueryObserverOptions<
  T,
  Error,
  Selected,
  T,
  QueryKey
> & {
  queryKey: DataTag<QueryKey, T, Error>
  queryFn: (context: QueryFunctionContext<QueryKey>) => Promise<T>
}
/** Synchronous options for hooks. Keys retain raw input; validation runs when the query executes. */
export function queryOptions<I, T extends HttpResult, Selected = Success<T>>(
  bound: Queryable<I, T>,
  input: I,
  options?: QueryOverrides<Success<T>, Selected>,
): BuiltQueryOptions<Success<T>, Selected> {
  const captured = captureInput(input)
  return {
    retry: false as const,
    ...options,
    queryKey: bound.key(captured) as DataTag<QueryKey, Success<T>, Error>,
    queryFn: async ({ signal }: QueryFunctionContext<QueryKey>) =>
      unwrap(await bound.call(captureInput(captured), { signal })),
  }
}
/** For loaders/prefetch: the caller explicitly awaits validation before creating canonical options. */
export function preparedQueryOptions<T extends HttpResult, Selected = Success<T>>(
  prepared: Callable<T> & { key: CacheKey },
  options?: QueryOverrides<Success<T>, Selected>,
): BuiltQueryOptions<Success<T>, Selected> {
  return {
    retry: false as const,
    ...options,
    queryKey: prepared.key as DataTag<QueryKey, Success<T>, Error>,
    queryFn: async ({ signal }: QueryFunctionContext<QueryKey>) =>
      unwrap(await prepared.call({ signal })),
  }
}
/** Mutations receive no automatic AbortSignal from TanStack; explicit call options remain available. */
export function mutationOptions<I, T extends HttpResult, Context = unknown>(
  bound: Pick<Queryable<I, T>, 'call'>,
  options?: Omit<MutationObserverOptions<Success<T>, Error, I, Context>, 'mutationFn'>,
  callOptions?: CallOptions,
): MutationObserverOptions<Success<T>, Error, I, Context> & {
  mutationFn: (input: I) => Promise<Success<T>>
} {
  return {
    retry: false as const,
    ...options,
    mutationFn: async (input: I) => unwrap(await bound.call(input, callOptions)),
  }
}

type Pages<T extends HttpResult, Page> = InfiniteData<Success<T>, Page>
type InfiniteConfig<T extends HttpResult, Page> = {
  key: CacheKey
  initialPageParam: Page
  page: (page: Page) => Callable<T> | Promise<Callable<T>>
  getNextPageParam: (
    lastPage: Success<T>,
    allPages: Success<T>[],
    lastPageParam: Page,
    allPageParams: Page[],
  ) => Page | null | undefined
}
type InfiniteOverrides<T extends HttpResult, Page> = Omit<
  InfiniteQueryObserverOptions<Success<T>, Error, Pages<T, Page>, QueryKey, Page>,
  'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam' | 'initialData'
>
export type BuiltInfiniteOptions<T extends HttpResult, Page> = InfiniteQueryObserverOptions<
  Success<T>,
  Error,
  Pages<T, Page>,
  QueryKey,
  Page
> & {
  queryKey: DataTag<QueryKey, Pages<T, Page>, Error>
  initialPageParam: Page
  getNextPageParam: InfiniteConfig<T, Page>['getNextPageParam']
  queryFn: (context: QueryFunctionContext<QueryKey, Page>) => Promise<Success<T>>
}
/** Page parameters are caller-owned, so cursors and page numbers use the same adapter. */
export function infiniteQueryOptions<T extends HttpResult, Page>(
  config: InfiniteConfig<T, Page>,
  options?: InfiniteOverrides<T, Page>,
): BuiltInfiniteOptions<T, Page> {
  const queryKey: QueryKey = [...config.key, 'infinite']
  return {
    retry: false as const,
    ...options,
    queryKey: queryKey as DataTag<QueryKey, Pages<T, Page>, Error>,
    initialPageParam: config.initialPageParam,
    getNextPageParam: config.getNextPageParam,
    queryFn: async ({ signal, pageParam }: QueryFunctionContext<QueryKey, Page>) =>
      unwrap(await (await config.page(pageParam as Page)).call({ signal })),
  }
}
