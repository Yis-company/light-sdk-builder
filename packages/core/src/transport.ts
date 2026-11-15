import type { CallOptions } from './operation.js'

/** The application supplies its HTTP client. Core does not prescribe its call signature or parser. */
export type HttpTransport<Http> = {
  readonly http: Http
  forRequest: (options: CallOptions) => Http
}
export type HttpTransportOptions<Http> = {
  /** Optionally bind request options (such as cancellation) using the supplied client's own API. */
  bind?: (http: Http, options: CallOptions) => Http
}

/** Use fetch, up-fetch, an object client, or any application-owned HTTP implementation. */
export function createHttpTransport<Http>(
  http: Http,
  options: HttpTransportOptions<Http> = {},
): HttpTransport<Http> {
  return {
    http,
    forRequest: (request) => (options.bind ? options.bind(http, request) : http),
  }
}
