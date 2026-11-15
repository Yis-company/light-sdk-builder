import type {
  DataTag,
  InfiniteData,
  InfiniteQueryObserverOptions,
  MutationObserverOptions,
  QueryFunctionContext,
  QueryKey,
  QueryClient,
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

import { procedureDefinition, type ProcedureDefinition } from 'light-sdk-builder'

type ProcedureQueryOptions<A, O> = [A] extends [void]
  ? <Selected = O>(options?: QueryOverrides<O, Selected>) => BuiltQueryOptions<O, Selected>
  : <Selected = O>(args: A, options?: QueryOverrides<O, Selected>) => BuiltQueryOptions<O, Selected>
type ProcedureMutationInput<V, O, Context> = Omit<
  MutationObserverOptions<O, Error, V, NoInfer<Awaited<Context>>>,
  'mutationFn' | 'onMutate'
> & {
  onMutate: (
    ...args: Parameters<NonNullable<MutationObserverOptions<O, Error, V, unknown>['onMutate']>>
  ) => Context
}
type ProcedureMutationDefaults<V, O> = Omit<
  MutationObserverOptions<O, Error, V, unknown>,
  'mutationFn' | 'onMutate'
>
type ProcedureMutationFn<V, O> = { mutationFn: (input: V) => Promise<O> }
type ProcedureMutationOptions<P, V, O> = [P] extends [void]
  ? {
      <Context>(
        options: ProcedureMutationInput<V, O, Context>,
      ): MutationObserverOptions<O, Error, V, NoInfer<Awaited<Context>>> & ProcedureMutationFn<V, O>
      (
        options?: ProcedureMutationDefaults<V, O>,
      ): ProcedureMutationDefaults<V, O> & ProcedureMutationFn<V, O>
    }
  : {
      <Context>(
        path: P,
        options: ProcedureMutationInput<V, O, Context>,
      ): MutationObserverOptions<O, Error, V, NoInfer<Awaited<Context>>> & ProcedureMutationFn<V, O>
      (
        path: P,
        options?: ProcedureMutationDefaults<V, O>,
      ): ProcedureMutationDefaults<V, O> & ProcedureMutationFn<V, O>
    }
export type ProcedureInfiniteOptions<O> = InfiniteQueryObserverOptions<
  O,
  Error,
  InfiniteData<O, number>,
  QueryKey,
  number
> & {
  queryKey: DataTag<QueryKey, InfiniteData<O, number>, Error>
  queryFn: (context: QueryFunctionContext<QueryKey, number>) => Promise<O>
  initialPageParam: number
}
type ProcedureInfiniteOverrides<O> = Omit<
  ProcedureInfiniteOptions<O>,
  'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
>
type ProcedurePageOptions<A, O> = [A] extends [void]
  ? (options?: ProcedureInfiniteOverrides<O>) => ProcedureInfiniteOptions<O>
  : (args: A, options?: ProcedureInfiniteOverrides<O>) => ProcedureInfiniteOptions<O>

type EndpointOptions<I, R extends HttpResult> = {
  queryOptions: <Selected = Success<R>>(
    input: I,
    options?: QueryOverrides<Success<R>, Selected>,
  ) => BuiltQueryOptions<Success<R>, Selected>
  mutationOptions: <Context = unknown>(
    options?: Omit<MutationObserverOptions<Success<R>, Error, I, Context>, 'mutationFn'>,
    callOptions?: CallOptions,
  ) => MutationObserverOptions<Success<R>, Error, I, Context> & {
    mutationFn: (input: I) => Promise<Success<R>>
  }
}

/** Add options to a core-authored router without introducing TanStack into its authoring package. */
export type WithTanStack<T> = T extends {
  [procedureDefinition]: ProcedureDefinition<infer Kind, infer A, infer O, infer V, infer P>
}
  ? Kind extends 'mutation'
    ? Omit<T, typeof procedureDefinition> & { mutationOptions: ProcedureMutationOptions<P, V, O> }
    : Kind extends 'infinite'
      ? Omit<T, typeof procedureDefinition | 'queryPage'> & {
          queryOptions: ProcedurePageOptions<A, O>
        }
      : Omit<T, typeof procedureDefinition> & { queryOptions: ProcedureQueryOptions<A, O> }
  : T extends Queryable<infer I, infer R>
    ? [R] extends [HttpResult]
      ? T & EndpointOptions<I, R>
      : T
    : T extends (...args: never[]) => unknown
      ? T
      : T extends object
        ? { [K in keyof T]: WithTanStack<T[K]> }
        : T

type RuntimeDefinition = ProcedureDefinition<
  'query' | 'mutation' | 'infinite',
  unknown,
  unknown,
  unknown,
  unknown
>
export function withTanStack<T>(router: T): WithTanStack<T> {
  if (!router || typeof router !== 'object') return router as WithTanStack<T>
  if (procedureDefinition in router) {
    const definition = router[procedureDefinition] as RuntimeDefinition
    if (definition.kind === 'mutation') {
      return {
        ...router,
        mutationOptions: (first?: unknown, second?: Record<string, unknown>) => {
          const path = definition.hasPath ? first : undefined
          const options = definition.hasPath
            ? second
            : (first as Record<string, unknown> | undefined)
          return {
            mutationFn: (input: unknown) => definition.execute(definition.variables(path, input)),
            ...options,
          }
        },
      } as WithTanStack<T>
    }
    const { queryPage: _page, ...methods } = router as Record<string, unknown>
    return {
      ...methods,
      queryOptions: (first?: unknown, second?: Record<string, unknown>) => {
        const args = definition.hasArgs ? first : undefined
        const options = definition.hasArgs ? second : (first as Record<string, unknown> | undefined)
        const queryKey = definition.queryKey(args)
        if (definition.kind === 'infinite') {
          return {
            initialPageParam: 1,
            getNextPageParam: definition.getNextPageParam,
            queryKey,
            queryFn: ({ signal, pageParam }: QueryFunctionContext<QueryKey, number>) =>
              definition.execute(args, { signal }, pageParam),
            ...options,
          }
        }
        return {
          queryKey,
          queryFn: ({ signal }: QueryFunctionContext<QueryKey>) =>
            definition.execute(args, { signal }),
          ...options,
        }
      },
    } as WithTanStack<T>
  }
  if (
    'call' in router &&
    typeof router.call === 'function' &&
    'key' in router &&
    typeof router.key === 'function'
  ) {
    const endpoint = router as unknown as Queryable<
      unknown,
      { status: number; ok: true; data: unknown } | { status: number; ok: false; data: unknown }
    >
    return {
      ...router,
      queryOptions: (input: unknown, options?: QueryOverrides<unknown, unknown>) =>
        queryOptions(endpoint, input, options),
      mutationOptions: (
        options?: Omit<MutationObserverOptions<unknown, Error, unknown, unknown>, 'mutationFn'>,
        callOptions?: CallOptions,
      ) => mutationOptions(endpoint, options, callOptions),
    } as WithTanStack<T>
  }
  return Object.fromEntries(
    Object.entries(router).map(([key, value]) => [key, withTanStack(value)]),
  ) as WithTanStack<T>
}

/** Observe logical session changes. Credential rotation within one session preserves usable cache. */
export function bindAuthToQueryClient(
  queryClient: Pick<QueryClient, 'cancelQueries' | 'removeQueries'>,
  auth: {
    getSnapshot: () => { initialized: boolean; version: number }
    subscribe: (listener: () => void) => () => void
  },
): () => void {
  const initial = auth.getSnapshot()
  let version = initial.initialized ? initial.version : undefined
  return auth.subscribe(() => {
    const next = auth.getSnapshot()
    if (!next.initialized) return
    if (version === undefined) {
      version = next.version
      return
    }
    if (next.version === version) return
    version = next.version
    void queryClient.cancelQueries()
    queryClient.removeQueries()
  })
}
