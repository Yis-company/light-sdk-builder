// Test application's chosen client, not an SDK transport implementation.
import { up } from 'up-fetch'
import { createHttpTransport } from 'light-sdk-builder'
export function userHttp(fetcher, defaults) {
  return createHttpTransport(up(fetcher, defaults), {
    bind: (http, { signal }) =>
      !signal
        ? http
        : (input, init, context) =>
            http(
              input,
              {
                ...init,
                signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
              },
              context,
            ),
  })
}
