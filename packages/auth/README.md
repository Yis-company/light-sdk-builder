# light-sdk-builder-auth

Connect user-owned auth once. The bridge reads current request credentials, shares a pending recovery callback per session/credential revision, and permits one request replay. It owns no login, refresh-token exchange, expiry timer, cookie storage or identity provider.

```ts
import { createAuthBridge } from 'light-sdk-builder-auth'
import { createHttpTransport } from 'light-sdk-builder'

const auth = createAuthBridge({
  getRequestContext: () => myAuth.requestContext(),
  recover: (failure) => myAuth.recover(failure),
  subscribe: (changed) => myAuth.subscribe(changed),
})
const transport = createHttpTransport(auth.fetch)
```

A context supplies `sessionKey`, `revision`, optional `headers` and Fetch `credentials`. Session/revision values must be non-secret. Change the session key on login/logout/account replacement; change revision when credentials rotate within a session. Tokens can be opaque, custom headers or browser-managed cookies. Separate refresh tokens stay private to your auth implementation. The getter may be asynchronous; it must return a consistent current context.

`recover` is optional. By default it runs after 401; configure `shouldRecover` for another backend contract. Return true to reread credentials and replay once, false to retain the response, or throw your original error. Recovery receives its owning session/revision and a cloned response. No per-waiter signal cancels another waiter's shared recovery. User auth must also guard its persistence and side effects against obsolete sessions.

`subscribe` is optional for pull-only plain calls. Provide notifications for prompt session/cache reaction. `getSnapshot`/`subscribe` expose stable metadata to integrations. `sync()` reconciles metadata without asserting an auth change; `notify()` reports a real source change. `dispose()` disconnects source listeners and invalidates bridge work. React bindings manage subscriptions separately, including Strict Mode reconnection.

Decoded JSON/text/blob/buffer/FormData/bytes responses reject after a session replacement. Raw response stream readers remain caller-managed. JSON/FormData/Blob and reusable bodies can replay; consumed Request bodies and ReadableStream requests do not replay. Explicit public requests use a separate unauthenticated transport. Create one bridge per server request; do not share credentials across requests.

Beta API. Node22+, Bun and Fetch browsers. No React dependency. Apache-2.0; see LICENSE/NOTICE.
