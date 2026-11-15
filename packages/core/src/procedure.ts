import type { StandardSchemaV1 } from '@standard-schema/spec'
import { type CacheKey } from './endpoint.js'
import { type CallOptions } from './operation.js'
import {
  scopeTransport,
  withRequestSignal,
  type RequestTransport,
  type TransportScope,
} from './transport.js'

type Schema = StandardSchemaV1
type In<S> = S extends Schema ? StandardSchemaV1.InferInput<S> : never
type Out<S> = S extends Schema ? StandardSchemaV1.InferOutput<S> : never
export type PathSegments = readonly (string | number)[]
type Args<P, I> = ([P] extends [undefined] ? {} : { path: In<P> }) &
  ([I] extends [undefined] ? {} : { input: In<I> })
type CallArgs<P, I> = [P, I] extends [undefined, undefined] ? void : Args<P, I>
type PathArgs<P> = P extends Schema ? { path: In<P> } : void
export type ProcedureContext = { path: string; upFetch: RequestTransport; signal?: AbortSignal }
export type ProcedurePolicy<ContextKey extends string = 'scopeId'> = {
  scope?: (value: unknown) => TransportScope
  scopeContextKey?: ContextKey
}
export const procedureDefinition: unique symbol = Symbol('light-sdk-builder.procedure')

export type ProcedureDefinition<
  Kind extends 'query' | 'mutation' | 'infinite',
  A,
  O,
  V = void,
  P = void,
> = {
  kind: Kind
  hasArgs: boolean
  hasPath: boolean
  queryKey: (args: A) => CacheKey
  execute: (args: A, options?: CallOptions, page?: number) => Promise<O>
  variables: (path: P, input: V) => A
  getNextPageParam?: (page: O) => number | undefined
}
type Described<D> = { readonly [procedureDefinition]: D }
export type QueryProcedure<A, O> = {
  query: (args: A, options?: CallOptions) => Promise<O>
  queryKey: (args: A) => CacheKey
  allScopesKey: (args: A) => CacheKey
} & Described<ProcedureDefinition<'query', A, O>>
export type MutationProcedure<A, O, V, P> = {
  mutate: (args: A, options?: CallOptions) => Promise<O>
  queryKey: (args: P) => CacheKey
} & Described<ProcedureDefinition<'mutation', A, O, V, P>>
export type InfiniteProcedure<A, O> = {
  queryPage: (args: A, page: number, options?: CallOptions) => Promise<O>
  queryKey: (args: A) => CacheKey
  allScopesKey: (args: A) => CacheKey
} & Described<ProcedureDefinition<'infinite', A, O>>

type InputContext<I, Removed extends PropertyKey, ContextKey extends string> = [I] extends [
  undefined,
]
  ? {}
  : [Removed] extends [never]
    ? { input: Out<I> }
    : { input: Omit<Out<I>, Removed> } & Record<
        ContextKey,
        Removed extends keyof Out<I> ? Out<I>[Removed] : never
      >

type Builder<P, I, ContextKey extends string, Removed extends PropertyKey = never> = {
  query: <O>(
    fn: (context: ProcedureContext & InputContext<I, Removed, ContextKey>) => Promise<O>,
  ) => QueryProcedure<CallArgs<P, I>, O>
  mutation: <O>(
    fn: (context: ProcedureContext & InputContext<I, Removed, ContextKey>) => Promise<O>,
  ) => MutationProcedure<CallArgs<P, I>, O, [I] extends [undefined] ? void : In<I>, PathArgs<P>>
  infiniteQuery: <O>(
    fn: (
      context: ProcedureContext & InputContext<I, Removed, ContextKey> & { page: number },
    ) => Promise<O>,
    next: (page: O) => number | undefined,
  ) => InfiniteProcedure<CallArgs<P, I>, O>
  input: <S extends Schema>(schema: S) => Builder<P, S, ContextKey>
  scope: <K extends keyof Out<I>>(field: K) => Builder<P, I, ContextKey, K>
  key: (...segments: PathSegments) => Builder<P, I, ContextKey, Removed>
}

function described<T, D>(value: T, definition: D): T & Described<D> {
  return Object.defineProperty(value, procedureDefinition, { value: definition }) as T &
    Described<D>
}
async function validate<S extends Schema>(schema: S, input: unknown): Promise<Out<S>> {
  const result = await schema['~standard'].validate(input)
  if (result.issues)
    throw new Error(
      `Input validation failed: ${result.issues.map((issue) => issue.message).join(', ')}`,
    )
  return result.value as Out<S>
}

/** Author callable SDKs in core. Add query-library options later through an optional adapter. */
export function createProcedure<ContextKey extends string = 'scopeId'>(
  transport: RequestTransport,
  policy: ProcedurePolicy<ContextKey> = {},
) {
  function path(...segments: PathSegments): Builder<undefined, undefined, ContextKey>
  function path<S extends Schema>(
    schema: S,
    segments: (path: Out<S>) => PathSegments,
    rawKey?: (path: In<S>) => PathSegments,
  ): Builder<S, undefined, ContextKey>
  function path(first: string | number | Schema, second?: unknown, ...rest: unknown[]): unknown {
    const parameterized = typeof first === 'object' && first !== null && '~standard' in first
    const pathSchema = parameterized ? first : undefined
    const build = parameterized
      ? (second as (path: unknown) => PathSegments)
      : () =>
          [first, second, ...rest].filter(
            (segment): segment is string | number =>
              typeof segment === 'string' || typeof segment === 'number',
          )
    const rawKey =
      parameterized && typeof rest[0] === 'function'
        ? (rest[0] as (path: unknown) => PathSegments)
        : build
    return builder(pathSchema, undefined, build, undefined, undefined, rawKey)
  }
  function builder<
    P extends Schema | undefined,
    I extends Schema | undefined,
    Removed extends PropertyKey = never,
  >(
    pathSchema: P,
    inputSchema: I,
    build: (params: unknown) => PathSegments,
    keySegments?: PathSegments,
    scopeField?: Removed,
    rawKey: (params: unknown) => PathSegments = build,
  ): Builder<P, I, ContextKey, Removed> {
    type A = CallArgs<P, I>
    type V = [I] extends [undefined] ? void : In<I>
    type PA = PathArgs<P>
    const hasArgs = !!(pathSchema || inputSchema)
    const rawArgs = (args: A) => (args ?? {}) as { path?: unknown; input?: unknown }
    const checkedParts = (parts: PathSegments) => {
      if (
        parts.some(
          (part) =>
            typeof part !== 'string' && (typeof part !== 'number' || !Number.isFinite(part)),
        )
      )
        throw new Error(
          'Path/key builders must return strings or finite numbers; provide a raw key builder when a schema changes path shape',
        )
      return parts
    }
    const pathParts = (args: A) => checkedParts(keySegments ?? rawKey(rawArgs(args).path))
    const allScopesKey = (args: A): CacheKey =>
      inputSchema ? [...pathParts(args), rawArgs(args).input] : [...pathParts(args)]
    const selected = (input: unknown) => {
      const value =
        scopeField === undefined ? undefined : (input as Record<PropertyKey, unknown>)[scopeField]
      if (value === undefined) return transport
      if (!policy.scope) throw new Error('An input scope requires a scope policy')
      return scopeTransport(transport, policy.scope(value))
    }
    const key = (args: A): CacheKey => [
      ...allScopesKey(args),
      ...selected(inputSchema ? rawArgs(args).input : undefined).getQueryKeyContext(),
    ]
    const mutationKey = (args: PA): CacheKey => [
      ...checkedParts(
        keySegments ?? rawKey(pathSchema ? (args as { path: unknown }).path : undefined),
      ),
      ...transport.getQueryKeyContext(),
    ]
    const variables = (path: PA, input: V): A =>
      ({ ...(path ?? {}), ...(inputSchema ? { input } : {}) }) as A
    const make = <K extends 'query' | 'mutation' | 'infinite', O>(
      kind: K,
      fn: (
        context: ProcedureContext & InputContext<I, Removed, ContextKey> & { page: number },
      ) => Promise<O>,
      next?: (page: O) => number | undefined,
    ) => {
      const execute = async (args: A, options: CallOptions = {}, page = 1): Promise<O> => {
        options.signal?.throwIfAborted()
        const raw = rawArgs(args)
        const parsedPath = pathSchema ? await validate(pathSchema, raw.path) : undefined
        const input = inputSchema ? await validate(inputSchema, raw.input) : undefined
        options.signal?.throwIfAborted()
        const requestTransport = selected(input)
        const context: Record<PropertyKey, unknown> = {
          path: '/' + checkedParts(build(parsedPath)).join('/'),
          upFetch: withRequestSignal(requestTransport, options.signal),
        }
        if (kind === 'infinite') context.page = page
        if (options.signal !== undefined) context.signal = options.signal
        if (inputSchema) {
          if (scopeField === undefined) context.input = input
          else {
            const { [scopeField]: scopeValue, ...remaining } = input as Record<PropertyKey, unknown>
            context.input = remaining
            context[policy.scopeContextKey ?? 'scopeId'] = scopeValue
          }
        }
        const output = await fn(
          context as ProcedureContext & InputContext<I, Removed, ContextKey> & { page: number },
        )
        options.signal?.throwIfAborted()
        return output
      }
      const definition: ProcedureDefinition<K, A, O, V, PA> = {
        kind,
        hasArgs,
        hasPath: !!pathSchema,
        queryKey: key,
        execute,
        variables,
        ...(next ? { getNextPageParam: next } : {}),
      }
      if (kind === 'mutation')
        return described({ mutate: execute, queryKey: mutationKey }, definition)
      if (kind === 'infinite') {
        const queryKey = (args: A) => [...key(args), 'infinite']
        return described(
          {
            queryPage: (args: A, page: number, options?: CallOptions) =>
              execute(args, options, page),
            queryKey,
            allScopesKey,
          },
          { ...definition, queryKey },
        )
      }
      return described({ query: execute, queryKey: key, allScopesKey }, definition)
    }
    return {
      query: <O>(
        fn: (context: ProcedureContext & InputContext<I, Removed, ContextKey>) => Promise<O>,
      ) => make('query', fn),
      mutation: <O>(
        fn: (context: ProcedureContext & InputContext<I, Removed, ContextKey>) => Promise<O>,
      ) => make('mutation', fn),
      infiniteQuery: <O>(
        fn: (
          context: ProcedureContext & InputContext<I, Removed, ContextKey> & { page: number },
        ) => Promise<O>,
        next: (page: O) => number | undefined,
      ) => make('infinite', fn, next),
      input: <S extends Schema>(schema: S) =>
        builder(pathSchema, schema, build, keySegments, undefined, rawKey),
      scope: <K extends keyof Out<I>>(field: K) =>
        builder(pathSchema, inputSchema, build, keySegments, field, rawKey),
      key: (...segments: PathSegments) =>
        builder(pathSchema, inputSchema, build, segments, scopeField, rawKey),
    } as unknown as Builder<P, I, ContextKey, Removed>
  }
  return { path }
}
