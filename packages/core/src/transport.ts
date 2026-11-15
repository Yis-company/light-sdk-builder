import { up, type FetcherOptions } from 'up-fetch'
import { captureInput, type CacheKey } from './endpoint.js'

export {
  up,
  isJsonifiable,
  isResponseError,
  isValidationError,
  isResponseValidationError,
  ResponseError,
  ResponseValidationError,
} from 'up-fetch'
export type { FetcherOptions } from 'up-fetch'

export type RequestTransportCall = ReturnType<typeof up<typeof fetch>>
export type TransportHeaders = FetcherOptions<typeof fetch, never, unknown, unknown>['headers']
export type TransportScope = { key: CacheKey; headers?: TransportHeaders }
export type RequestTransport = RequestTransportCall & {
  getQueryKeyContext: () => CacheKey
  unscoped: RequestTransportCall
}

const entries = (headers: TransportHeaders) =>
  headers instanceof Headers || Array.isArray(headers)
    ? [...new Headers(headers)]
    : Object.entries(headers ?? {})

/** Scope replaces an earlier scope and owns its declared headers, including explicit clearing. */
export function scopeTransport(
  transport: RequestTransportCall | RequestTransport,
  scope: TransportScope,
): RequestTransport {
  const unscoped = 'unscoped' in transport ? transport.unscoped : transport
  const headers = entries(scope.headers)
  const owned = new Set(headers.map(([name]) => name.toLowerCase()))
  const context = captureInput(scope.key)
  const scoped: RequestTransportCall = (input, options, ctx) =>
    unscoped(
      input,
      {
        ...options,
        headers: {
          ...Object.fromEntries(
            entries(options?.headers).filter(([name]) => !owned.has(name.toLowerCase())),
          ),
          ...Object.fromEntries(headers),
        },
      },
      ctx,
    )
  return Object.assign(scoped, { getQueryKeyContext: () => captureInput(context), unscoped })
}

/** Existing APIs retain up-fetch's schema parsing, response errors, JSON, multipart and binary modes. */
export function createTransport(
  fetcher: typeof fetch = globalThis.fetch,
  defaults?: Parameters<typeof up<typeof fetch>>[1],
): RequestTransport {
  return scopeTransport(up(fetcher, defaults), { key: [] })
}

/** Bind cancellation to a single procedure invocation rather than shared mutable client state. */
export function withRequestSignal(
  transport: RequestTransport,
  signal?: AbortSignal,
): RequestTransport {
  if (!signal) return transport
  const bind =
    (call: RequestTransportCall): RequestTransportCall =>
    (input, options, ctx) =>
      call(
        input,
        {
          ...options,
          signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal,
        },
        ctx,
      )
  return Object.assign(bind(transport), {
    getQueryKeyContext: transport.getQueryKeyContext,
    unscoped: bind(transport.unscoped),
  })
}
