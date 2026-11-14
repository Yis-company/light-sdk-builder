import type { StandardSchemaV1 } from '@standard-schema/spec'
import { createOperation, validateSchema, type CallOptions } from './operation.js'

type Scalar = string | number | boolean | null | undefined
export type Query = Readonly<Record<string, Scalar | ReadonlyArray<Scalar>>>
export type RequestInput = {
  params?: Readonly<Record<string, string | number>>
  query?: Query
  body?: unknown
}
type InputSchema = StandardSchemaV1<unknown, RequestInput>
type Responses = Readonly<Record<number, StandardSchemaV1>>
type Input<S> = S extends StandardSchemaV1 ? StandardSchemaV1.InferInput<S> : void
type Output<S> = S extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<S> : RequestInput
type PathKey<P extends string> = P extends `${infer Head}/${infer Tail}`
  ? PathKey<Head> | PathKey<Tail>
  : P extends `:${infer Key}`
    ? Key
    : never
type CheckPath<P extends string, S> = string extends P
  ? unknown
  : [PathKey<P>] extends [never]
    ? unknown
    : Output<S> extends { params: Record<PathKey<P>, string | number> }
      ? unknown
      : { readonly missingPathParameters: PathKey<P> }
export type EndpointResult<R extends Responses> = {
  [Status in keyof R & number]: {
    status: Status
    ok: `${Status}` extends `2${string}` ? true : false
    data: StandardSchemaV1.InferOutput<R[Status]>
  }
}[keyof R & number]
export type HttpResult = { status: number; ok: boolean; data: unknown }
export type Success<T extends HttpResult> = Extract<T, { ok: true }>['data']
export type Failure<T extends HttpResult> = Extract<T, { ok: false }>
export type CacheKey = readonly unknown[]
export type Callable<T> = { call: (options?: CallOptions) => Promise<T> }
export type Queryable<I, T> = {
  key: (input: I) => CacheKey
  call: (input: I, options?: CallOptions) => Promise<T>
}
export type ClientOptions = {
  baseUrl: string
  namespace?: string
  fetch?: typeof fetch
  headers?: HeadersInit
  scope?: { key: CacheKey; headers?: HeadersInit }
}
export type Client = {
  readonly baseUrl: string
  readonly namespace: string
  readonly fetch: typeof fetch
  readonly headers: ReadonlyArray<readonly [string, string]>
  readonly scopeKey: CacheKey
}

export class RequestError extends Error {
  readonly name = 'RequestError'
}
export class UnexpectedStatusError extends Error {
  readonly name = 'UnexpectedStatusError'
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Undeclared HTTP status: ${status}`)
  }
}
export class ResponseDecodeError extends Error {
  readonly name = 'ResponseDecodeError'
}
export class HttpError<T extends HttpResult = HttpResult> extends Error {
  readonly name = 'HttpError'
  constructor(readonly result: T) {
    super(`HTTP ${result.status}`)
  }
}
export function unwrap<T extends HttpResult>(result: T): Success<T> {
  if (!result.ok) throw new HttpError(result)
  // Success is selected by the same status discriminator that built the result.
  return result.data as Success<T>
}

// Reject non-JSON values before serialization can invoke toJSON or discard data.
// The raw query adapter captures this snapshot once, and copies it for each invocation.
export function captureInput<I>(value: I): I {
  const active = new WeakSet<object>()
  const copy = (item: unknown, root = false): unknown => {
    if (item === undefined && root) return undefined
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0))
        throw new RequestError(
          'Use finite JSON numbers other than -0; transform the value or use prepare()',
        )
      return item
    }
    if (!item || typeof item !== 'object') {
      throw new RequestError('Use plain JSON inputs; omit undefined fields or use prepare()')
    }
    const array = Array.isArray(item)
    if (
      !array &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      throw new RequestError('Use plain JSON objects; transform dates or use prepare()')
    }
    if (Object.getOwnPropertySymbols(item).length || active.has(item)) {
      throw new RequestError('JSON inputs cannot contain symbols or cycles')
    }
    active.add(item)
    const result = array
      ? Array.from(item, (child) => copy(child))
      : Object.fromEntries(Object.entries(item).map(([name, child]) => [name, copy(child)]))
    active.delete(item)
    return result
  }
  // Unsupported values throw above; copying supported JSON preserves the input type and values.
  return copy(value, true) as I
}

function freeze(value: unknown): unknown {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
function key(...parts: unknown[]): CacheKey {
  return Object.freeze(parts.map((part) => freeze(captureInput(part))))
}

/** Scope headers and key context are captured together. Authentication headers never enter generated keys. */
export function createClient(options: ClientOptions): Client {
  const url = new URL(options.baseUrl)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new RequestError('baseUrl must be an HTTP(S) URL without credentials, query, or fragment')
  }
  const headers = new Headers(options.headers)
  for (const [name, value] of new Headers(options.scope?.headers)) headers.set(name, value)
  return Object.freeze({
    baseUrl: url.href.replace(/\/+$/, ''),
    namespace: options.namespace ?? url.href.replace(/\/+$/, ''),
    fetch: options.fetch ?? globalThis.fetch,
    headers: Object.freeze([...headers].map((entry) => Object.freeze(entry))),
    scopeKey: key(...(options.scope?.key ?? [])),
  })
}

export function serializeQuery(query: Query = {}): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === null || item === undefined) continue
      if (!['string', 'number', 'boolean'].includes(typeof item))
        throw new RequestError('Query values must be primitives or arrays of primitives')
      if (typeof item === 'number' && !Number.isFinite(item))
        throw new RequestError('Query numbers must be finite')
      params.append(name, String(item))
    }
  }
  return params.toString()
}

type EndpointConfig<P extends string, S, R> = {
  name: string
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'
  path: P
  input?: S
  responses: R
}
/** Define the wire contract once; SDK authors choose their own public object/module structure. */
export function endpoint<
  const P extends string,
  S extends InputSchema | undefined = undefined,
  const R extends Responses = Responses,
>(config: EndpointConfig<P, S, R> & CheckPath<P, S>) {
  const { name, method, path: template, input: inputSchema } = config
  const responses = Object.freeze({ ...config.responses })
  if (!name || !template.startsWith('/') || template.startsWith('//') || /[?#]/.test(template)) {
    throw new RequestError('Endpoints need a name and a relative path without query or fragment')
  }
  const statuses = Object.keys(responses)
  if (
    !statuses.length ||
    statuses.some(
      (status) => !/^\d{3}$/.test(status) || Number(status) < 100 || Number(status) > 599,
    )
  ) {
    throw new RequestError('responses must declare HTTP status codes')
  }
  return {
    bind(client: Client) {
      const resolve = async (input: Input<S>) => {
        const request: RequestInput = inputSchema ? await validateSchema(inputSchema, input) : {}
        const path = template
          .split('/')
          .map((segment) => {
            if (!segment.startsWith(':')) return segment
            const value = request.params?.[segment.slice(1)]
            if (
              value === undefined ||
              value === '' ||
              (typeof value === 'number' && !Number.isFinite(value)) ||
              value === '.' ||
              value === '..'
            ) {
              throw new RequestError(`Invalid or missing path parameter: ${segment}`)
            }
            return encodeURIComponent(String(value))
          })
          .join('/')
        const query = serializeQuery(request.query)
        const url = client.baseUrl + path + (query ? `?${query}` : '')
        const body =
          request.body === undefined ? undefined : JSON.stringify(captureInput(request.body))
        if ((method === 'GET' || method === 'HEAD') && body !== undefined)
          throw new RequestError(`${method} requests cannot have a body`)
        const headers = new Headers(client.headers.map((entry) => [entry[0], entry[1]]))
        if (!headers.has('Accept')) headers.set('Accept', 'application/json')
        if (body !== undefined && !headers.has('Content-Type'))
          headers.set('Content-Type', 'application/json')
        return {
          url,
          body,
          headers,
          key: key(client.namespace, name, ...client.scopeKey, 'prepared', {
            method: method,
            url,
            body: body ?? null,
          }),
        }
      }
      const operation = createOperation({
        resolve,
        execute: async (request, options): Promise<EndpointResult<R>> => {
          const init: RequestInit = { method: method, headers: new Headers(request.headers) }
          if (request.body !== undefined) init.body = request.body
          if (options.signal !== undefined) init.signal = options.signal
          const fetch = client.fetch
          const response = await fetch(request.url, init)
          const schema = responses[response.status]
          if (!schema) {
            const text = await response.text()
            let body: unknown = text
            try {
              body = JSON.parse(text)
            } catch {
              /* Non-JSON error bodies remain readable. */
            }
            throw new UnexpectedStatusError(response.status, body)
          }
          let payload: unknown
          if (response.status !== 204 && response.status !== 205 && method !== 'HEAD') {
            try {
              payload = await response.json()
            } catch (cause) {
              options.signal?.throwIfAborted()
              if (cause instanceof SyntaxError) {
                throw new ResponseDecodeError('Expected a JSON response', { cause })
              }
              throw cause
            }
          }
          const data = await validateSchema(schema, payload, 'response')
          options.signal?.throwIfAborted()
          // The selected schema and status are the same pair represented by EndpointResult<R>.
          return { status: response.status, ok: response.ok, data } as EndpointResult<R>
        },
      })
      return {
        key: (input: Input<S>) =>
          key(client.namespace, name, ...client.scopeKey, 'input', {
            method: method,
            baseUrl: client.baseUrl,
            path: template,
            input: input === undefined ? ['void'] : ['value', captureInput(input)],
          }),
        call: operation.call,
        prepare: async (input: Input<S>, options?: CallOptions) => {
          const prepared = await operation.prepare(input, options)
          return { key: prepared.context.key, call: prepared.call }
        },
      }
    },
  }
}
