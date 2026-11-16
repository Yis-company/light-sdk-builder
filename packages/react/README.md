# light-sdk-builder-react

Optional React bindings. Authentication logic stays in your auth system; SDK request code never invokes React hooks.

`createSdkContext<SDK>()` provides a Provider accepting `sdk` and a `useSdk()` hook. `createUseSdk(useClient, createSdk)` shares one SDK per client across hook consumers, avoiding repeated construction of route schemas. `useAuthBridge(source, options)` adapts committed React callbacks to a stable framework-neutral auth bridge. `useAuthSnapshot(bridge)` observes non-secret metadata through React's external-store API.

Pass your existing auth context through `AuthSource` getters, optional recovery and subscription. Ordinary React rerenders reconcile metadata without cancelling valid asynchronous credential reads. Switching source instances rebinds subscriptions, even when they share a prototype method. Source notification events invalidate stale pending reads. The hook cleans up its subscriptions on unmount; in-flight callers retain their bridge. Explicitly created non-React bridges have a `dispose` method for their owner.

TanStack remains a separate package. Wire `bindAuthToQueryClient(queryClient, bridge)` to remove old-session query data on logical session changes; credential rotation preserves cache. Scope/client changes should create a new scoped transport. Server clients and auth sources are request-local.

Beta API. React19.3.1+, TypeScript5.5+, ESM. Core/TanStack are not imported by these React bindings. Apache-2.0; see LICENSE/NOTICE.

For SDK context and hook sharing without authentication, import from `light-sdk-builder-react/context`; this entry requires only React. Auth hooks are available from `/auth` or the backward-compatible main entry and require `light-sdk-builder-auth`.
