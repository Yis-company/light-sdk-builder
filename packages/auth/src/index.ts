/** Authentication belongs to the application. These values describe one request's auth context. */
export type RequestAuth = {
  sessionKey: string | number | null
  revision: string | number
  headers?: HeadersInit
  credentials?: RequestCredentials
}
export type AuthFailure = {
  response: Response
  sessionKey: RequestAuth['sessionKey']
  revision: RequestAuth['revision']
  request: { url: string; method: string }
}
export type AuthSource = {
  getRequestContext: () => RequestAuth | Promise<RequestAuth>
  recover?: (failure: AuthFailure) => Promise<boolean>
  subscribe?: (changed: () => void) => () => void
}
export type AuthSnapshot = Readonly<{
  initialized: boolean
  sessionKey: RequestAuth['sessionKey']
  revision: RequestAuth['revision']
  /** Changes only when a logical login session changes, never for credential rotation alone. */
  version: number
}>
export class AuthSessionChangedError extends Error {
  readonly name = 'AuthSessionChangedError'
  constructor() {
    super('The request belongs to an obsolete authentication session')
  }
}
export type AuthBridge = {
  fetch: typeof fetch
  getSnapshot: () => AuthSnapshot
  subscribe: (changed: () => void) => () => void
  /** For hosts such as React context that forward changes instead of providing source.subscribe. */
  sync: () => Promise<void>
  /** Report a real source event; invalidates pending reads before reconciling metadata. */
  notify: () => Promise<void>
  dispose: () => void
}
export type AuthBridgeOptions = {
  fetch?: typeof fetch
  shouldRecover?: (response: Response) => boolean
}

function wait<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  signal?.throwIfAborted()
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Connect once; credentials are read at dispatch. The application owns all login/refresh/storage policy. */
export function createAuthBridge(source: AuthSource, options: AuthBridgeOptions = {}): AuthBridge {
  const send = options.fetch ?? globalThis.fetch
  const shouldRecover = options.shouldRecover ?? ((response) => response.status === 401)
  const listeners = new Set<() => void>()
  let snapshot: AuthSnapshot = Object.freeze({
    initialized: false,
    sessionKey: null,
    revision: 0,
    version: 0,
  })
  const contextEpoch: unique symbol = Symbol('auth context notification')
  type CapturedAuth = RequestAuth & { readonly [contextEpoch]: number }
  let notification = 0,
    readSequence = 0,
    publishedRead = 0,
    disposed = false
  let pending:
    | {
        sessionKey: RequestAuth['sessionKey']
        revision: RequestAuth['revision']
        promise: Promise<boolean>
      }
    | undefined
  const sameSession = (a: RequestAuth, b: RequestAuth) => Object.is(a.sessionKey, b.sessionKey)
  let publishedEpoch = 0
  const sameContext = (
    a: Pick<RequestAuth, 'sessionKey' | 'revision'>,
    b: Pick<RequestAuth, 'sessionKey' | 'revision'>,
  ) => sameSession(a, b) && Object.is(a.revision, b.revision)
  const publish = (context: RequestAuth, sequence: number, epoch: number): CapturedAuth => {
    if (disposed || (sequence < publishedRead && !sameContext(context, snapshot)))
      throw new AuthSessionChangedError()
    const changedSession = snapshot.initialized && !sameSession(snapshot, context)
    // Reconciliation itself is not an auth event. Only an actual session transition advances ownership.
    const ownEpoch = changedSession && epoch === publishedEpoch ? ++notification : epoch
    const captured = Object.defineProperty(context, contextEpoch, {
      value: ownEpoch,
    }) as CapturedAuth
    if (sequence < publishedRead) return captured
    publishedRead = sequence
    publishedEpoch = ownEpoch
    if (snapshot.initialized && sameContext(snapshot, context)) return captured
    snapshot = Object.freeze({
      initialized: true,
      sessionKey: context.sessionKey,
      revision: context.revision,
      version: snapshot.version + Number(changedSession),
    })
    for (const changed of listeners) changed()
    return captured
  }
  const read = async (signal?: AbortSignal | null): Promise<CapturedAuth> => {
    if (disposed) throw new Error('Auth bridge is disposed')
    let epoch = notification
    const sequence = ++readSequence
    let context = await wait(
      Promise.resolve().then(() => source.getRequestContext()),
      signal,
    )
    if (epoch !== notification) {
      epoch = notification
      const current = await wait(
        Promise.resolve().then(() => source.getRequestContext()),
        signal,
      )
      if (epoch !== notification || !sameContext(context, current))
        throw new AuthSessionChangedError()
      context = current
    }
    if (disposed) throw new AuthSessionChangedError()
    return publish({ ...context, headers: new Headers(context.headers) }, sequence, epoch)
  }
  const sync = async () => {
    await read()
  }
  const notify = async () => {
    notification++
    await read()
  }
  const stop = source.subscribe?.(() => {
    void notify().catch(() => {
      /* Request reads surface source errors. */
    })
  })
  const assertOwner = async (owner: RequestAuth, epoch: number, signal?: AbortSignal | null) => {
    signal?.throwIfAborted()
    // Push sources avoid another credential read on the ordinary request path.
    const current =
      source.subscribe && epoch === notification
        ? { sessionKey: snapshot.sessionKey, revision: snapshot.revision }
        : await read(signal)
    if (disposed || !sameSession(owner, current)) throw new AuthSessionChangedError()
    return current
  }
  const guardResponse = (
    response: Response,
    owner: RequestAuth,
    epoch: number,
    signal?: AbortSignal | null,
  ): Response => {
    // Fetch can finish before a slow response body. Guard decoded results as well as headers.
    for (const method of ['json', 'text', 'blob', 'arrayBuffer', 'formData'] as const) {
      const parse = response[method].bind(response)
      Object.defineProperty(response, method, {
        configurable: true,
        value: async () => {
          const value = await parse()
          await assertOwner(owner, epoch, signal)
          return value
        },
      })
    }
    const bytes = (response as Response & { bytes?: () => Promise<Uint8Array> }).bytes
    if (bytes)
      Object.defineProperty(response, 'bytes', {
        configurable: true,
        value: async () => {
          const value = await bytes.call(response)
          await assertOwner(owner, epoch, signal)
          return value
        },
      })
    const clone = response.clone.bind(response)
    Object.defineProperty(response, 'clone', {
      configurable: true,
      value: () => guardResponse(clone(), owner, epoch, signal),
    })
    return response
  }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined
    const signal = init?.signal ?? request?.signal
    signal?.throwIfAborted()
    const headers = new Headers(init?.headers ?? request?.headers)
    let body = init?.body
    if (body instanceof FormData) {
      const captured = new FormData()
      for (const [name, value] of body) captured.append(name, value)
      body = captured
    } else if (body instanceof URLSearchParams) body = new URLSearchParams(body)
    else if (body instanceof ArrayBuffer) body = body.slice(0)
    else if (ArrayBuffer.isView(body))
      body = new Uint8Array(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
    // A consumed Request body or stream cannot be replayed safely. SDK JSON/FormData bodies are reusable.
    const replayable =
      !(body instanceof ReadableStream) && !(request?.body && init?.body === undefined)
    const base: RequestInit = { ...init, headers }
    if (body !== undefined) base.body = body
    const owner = await read(signal)
    const epoch = owner[contextEpoch]
    const dispatch = async (context: CapturedAuth) => {
      signal?.throwIfAborted()
      if (disposed || context[contextEpoch] !== notification) throw new AuthSessionChangedError()
      const currentHeaders = new Headers(headers)
      for (const [name, value] of new Headers(context.headers)) currentHeaders.set(name, value)
      const next = { ...base, headers: currentHeaders }
      if (context.credentials !== undefined) next.credentials = context.credentials
      return send(input, next)
    }
    const response = await dispatch(owner)
    let current = await assertOwner(owner, epoch, signal)
    if (!shouldRecover(response) || !source.recover || !replayable)
      return guardResponse(response, owner, epoch, signal)
    if (Object.is(current.revision, owner.revision)) {
      if (
        !pending ||
        !Object.is(pending.sessionKey, owner.sessionKey) ||
        !Object.is(pending.revision, owner.revision)
      ) {
        const recovery = {
          sessionKey: owner.sessionKey,
          revision: owner.revision,
          promise: Promise.resolve().then(async () => {
            const latest = await read()
            if (!sameSession(owner, latest)) throw new AuthSessionChangedError()
            if (!Object.is(latest.revision, owner.revision)) return true
            return source.recover!({
              response: response.clone(),
              sessionKey: owner.sessionKey,
              revision: owner.revision,
              request: {
                url: request?.url ?? String(input),
                method: init?.method ?? request?.method ?? 'GET',
              },
            })
          }),
        }
        pending = recovery
        void recovery.promise
          .finally(() => {
            if (pending === recovery) pending = undefined
          })
          .catch(() => {})
      }
      const recovered = await wait(pending.promise, signal)
      current = await assertOwner(owner, -1, signal)
      if (!recovered) return guardResponse(response, owner, epoch, signal)
    }
    // Always reread after recovery/rotation: stale headers must not escape through a captured snapshot.
    const credentials = await read(signal)
    if (!sameSession(owner, credentials)) throw new AuthSessionChangedError()
    const replayEpoch = credentials[contextEpoch]
    const replay = await dispatch(credentials)
    await assertOwner(owner, replayEpoch, signal)
    return guardResponse(replay, owner, replayEpoch, signal) // One replay only. User policy handles a second failure.
  }
  return {
    fetch,
    getSnapshot: () => snapshot,
    subscribe: (changed) => {
      listeners.add(changed)
      return () => {
        listeners.delete(changed)
      }
    },
    sync,
    notify,
    dispose: () => {
      disposed = true
      notification++
      stop?.()
      listeners.clear()
    },
  }
}
