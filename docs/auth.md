# User-owned auth

Define auth once in your application or auth library. Connect it to `createAuthBridge`, then inject `bridge.fetch` into a core client or `createHttpTransport`. Authenticate normally; the next SDK request reads current auth without passing tokens to each endpoint or rebuilding the SDK.

The auth source returns a non-secret logical session key, credential revision and optional headers/Fetch credentials. It can represent an API key, bearer token or HttpOnly cookie session. Separate refresh tokens, expiry scheduling, storage, logout, impersonation and navigation remain owned by your auth logic. The SDK never decodes JWT claims or assumes a refresh endpoint.

The optional recovery callback receives the failed request/session context. The bridge shares a pending callback for one credential revision, waits independently for each caller and replays a reusable request at most once. Delayed401s can reuse credentials that auth already rotated. Your recovery implementation must prevent stale results from overwriting a newer login; the SDK cannot undo side effects inside application callbacks.

For React, `useAuthBridge` connects your existing AuthProvider callbacks and subscribes to source changes. The same auth contract works in plain JavaScript and server code. A logical session change guards old responses and lets the TanStack adapter cancel/remove old cached queries. Rotation within one session does not rebuild routes or reset cache. Public requests use an unauthenticated transport.

See the [auth package](../packages/auth/README.md), [React package](../packages/react/README.md) and [TanStack guide](tanstack-query.md). The Platform worktree spike replaces its procedure/transport/provider plumbing with installed package archives while retaining Platform's AuthProvider and policy callbacks.
