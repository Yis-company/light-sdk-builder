import type { StandardSchemaV1 } from '@standard-schema/spec'
import { type CacheKey } from './endpoint.js'
import { type CallOptions } from './operation.js'
import type { HttpTransport } from './transport.js'

type Schema = StandardSchemaV1
type In<S> = S extends Schema ? StandardSchemaV1.InferInput<S> : never
type Out<S> = S extends Schema ? StandardSchemaV1.InferOutput<S> : never
export type PathSegments = readonly (string | number)[]
type Args<P, I> = ([P] extends [undefined] ? {} : { path: In<P> }) &
  ([I] extends [undefined] ? {} : { input: In<I> })
type CallArgs<P, I> = [P, I] extends [undefined, undefined] ? void : Args<P, I>
type PathArgs<P> = P extends Schema ? { path: In<P> } : void
export type ProcedureContext<Http = unknown> = { path: string; http: Http; signal?: AbortSignal }
export type ProcedureOptions = { keyContext?: () => CacheKey }
type Merge<Base, Extra> = Omit<Base, keyof Extra> & Extra
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
  baseKey: (args: A) => CacheKey
} & Described<ProcedureDefinition<'query', A, O>>
export type MutationProcedure<A, O, V, P> = {
  mutate: (args: A, options?: CallOptions) => Promise<O>
  queryKey: (args: P) => CacheKey
} & Described<ProcedureDefinition<'mutation', A, O, V, P>>
export type InfiniteProcedure<A, O> = {
  queryPage: (args: A, page: number, options?: CallOptions) => Promise<O>
  queryKey: (args: A) => CacheKey
  baseKey: (args: A) => CacheKey
} & Described<ProcedureDefinition<'infinite', A, O>>

type InputContext<I> = [I] extends [undefined] ? {} : { input: Out<I> }
type Context<Http, I, Extra> = Merge<ProcedureContext<Http> & InputContext<I>, Extra>
export type RequestContextConfig<Base, Args, Extra extends object> = {
  resolve: (context: Base) => Extra | Promise<Extra>
  /** Synchronous, non-secret cache identity from raw caller arguments; never inferred from headers. */
  keyContext?: (args: Args) => CacheKey
}
type Builder<Http, P, I, Extra extends object = {}> = {
  query: <O>(
    fn: (context: Context<Http, I, Extra>) => Promise<O>,
  ) => QueryProcedure<CallArgs<P, I>, O>
  mutation: <O>(
    fn: (context: Context<Http, I, Extra>) => Promise<O>,
  ) => MutationProcedure<CallArgs<P, I>, O, [I] extends [undefined] ? void : In<I>, PathArgs<P>>
  infiniteQuery: <O>(
    fn: (context: Context<Http, I, Extra> & { page: number }) => Promise<O>,
    next: (page: O) => number | undefined,
  ) => InfiniteProcedure<CallArgs<P, I>, O>
  input: <S extends Schema>(schema: S) => Builder<Http, P, S, [I] extends [undefined] ? Extra : {}>
  context: <Added extends object>(
    config: RequestContextConfig<Context<Http, I, Extra>, CallArgs<P, I>, Added>,
  ) => Builder<Http, P, I, Merge<Extra, Added>>
  key: (...segments: PathSegments) => Builder<Http, P, I, Extra>
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
export function createProcedure<Http>(
  transport: HttpTransport<Http>,
  options: ProcedureOptions = {},
) {
  function path(...segments: PathSegments): Builder<Http, undefined, undefined>
  function path<S extends Schema>(
    schema: S,
    segments: (path: Out<S>) => PathSegments,
    rawKey?: (path: In<S>) => PathSegments,
  ): Builder<Http, S, undefined>
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
    Extra extends object = {},
  >(
    pathSchema: P,
    inputSchema: I,
    build: (params: unknown) => PathSegments,
    keySegments?: PathSegments,
    requestContext?: RequestContextConfig<
      ProcedureContext<Http> & InputContext<I>,
      CallArgs<P, I>,
      Extra
    >,
    rawKey: (params: unknown) => PathSegments = build,
  ): Builder<Http, P, I, Extra> {
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
    const baseKey = (args: A): CacheKey =>
      inputSchema ? [...pathParts(args), rawArgs(args).input] : [...pathParts(args)]
    const keyContext = (args: A): CacheKey =>
      requestContext?.keyContext?.(args) ?? options.keyContext?.() ?? []
    const key = (args: A): CacheKey => [...baseKey(args), ...keyContext(args)]
    const mutationKey = (args: PA): CacheKey => [
      ...checkedParts(
        keySegments ?? rawKey(pathSchema ? (args as { path: unknown }).path : undefined),
      ),
      ...(options.keyContext?.() ?? []),
    ]
    const variables = (path: PA, input: V): A =>
      ({ ...(path ?? {}), ...(inputSchema ? { input } : {}) }) as A
    const make = <K extends 'query' | 'mutation' | 'infinite', O>(
      kind: K,
      fn: (context: Context<Http, I, Extra> & { page: number }) => Promise<O>,
      next?: (page: O) => number | undefined,
    ) => {
      const execute = async (args: A, callOptions: CallOptions = {}, page = 1): Promise<O> => {
        callOptions.signal?.throwIfAborted()
        const raw = rawArgs(args)
        const parsedPath = pathSchema ? await validate(pathSchema, raw.path) : undefined
        const input = inputSchema ? await validate(inputSchema, raw.input) : undefined
        callOptions.signal?.throwIfAborted()
        const base = {
          path: '/' + checkedParts(build(parsedPath)).join('/'),
          http: transport.forRequest(callOptions),
          ...(callOptions.signal ? { signal: callOptions.signal } : {}),
          ...(inputSchema ? { input } : {}),
        } as ProcedureContext<Http> & InputContext<I>
        const extra = requestContext ? await requestContext.resolve(base) : {}
        callOptions.signal?.throwIfAborted()
        const context = { ...base, ...extra, ...(kind === 'infinite' ? { page } : {}) }
        const output = await fn(context as unknown as Context<Http, I, Extra> & { page: number })
        callOptions.signal?.throwIfAborted()
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
            baseKey,
          },
          { ...definition, queryKey },
        )
      }
      return described({ query: execute, queryKey: key, baseKey }, definition)
    }
    return {
      query: <O>(fn: (context: Context<Http, I, Extra>) => Promise<O>) => make('query', fn),
      mutation: <O>(fn: (context: Context<Http, I, Extra>) => Promise<O>) => make('mutation', fn),
      infiniteQuery: <O>(
        fn: (context: Context<Http, I, Extra> & { page: number }) => Promise<O>,
        next: (page: O) => number | undefined,
      ) => make('infinite', fn, next),
      input: <S extends Schema>(schema: S) =>
        builder(
          pathSchema,
          schema,
          build,
          keySegments,
          inputSchema
            ? undefined
            : (requestContext as unknown as RequestContextConfig<
                ProcedureContext<Http> & InputContext<S>,
                CallArgs<P, S>,
                Extra
              >),
          rawKey,
        ),
      context: <Added extends object>(
        config: RequestContextConfig<Context<Http, I, Extra>, A, Added>,
      ) =>
        builder(
          pathSchema,
          inputSchema,
          build,
          keySegments,
          {
            resolve: async (base) => {
              const previous = requestContext ? await requestContext.resolve(base) : {}
              return {
                ...previous,
                ...(await config.resolve({ ...base, ...previous } as unknown as Context<
                  Http,
                  I,
                  Extra
                >)),
              } as Merge<Extra, Added>
            },
            ...(config.keyContext || requestContext?.keyContext
              ? { keyContext: config.keyContext ?? requestContext!.keyContext! }
              : {}),
          },
          rawKey,
        ),
      key: (...segments: PathSegments) =>
        builder(pathSchema, inputSchema, build, segments, requestContext, rawKey),
    } as unknown as Builder<Http, P, I, Extra>
  }
  return { path }
}
