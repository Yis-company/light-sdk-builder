import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  createAuthBridge,
  type AuthBridge,
  type AuthBridgeOptions,
  type AuthSnapshot,
  type AuthSource,
} from 'light-sdk-builder-auth'
const useCommitEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

/** Observe auth metadata, never credentials. Works with a framework-neutral bridge. */
export function useAuthSnapshot(bridge: AuthBridge): AuthSnapshot {
  return useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot)
}

/** Adapt React context callbacks to one stable bridge. No React hook is called by SDK request code. */
export function useAuthBridge(source: AuthSource, options: AuthBridgeOptions = {}): AuthBridge {
  const committed = useRef(source)
  const bridge = useMemo(
    () =>
      createAuthBridge(
        {
          getRequestContext: () => committed.current.getRequestContext(),
          recover: (failure) => committed.current.recover?.(failure) ?? Promise.resolve(false),
        },
        options,
      ),
    [options.fetch, options.shouldRecover],
  )
  useCommitEffect(() => {
    committed.current = source
    void bridge.sync().catch(() => {
      /* The application's auth UI and request caller own source errors. */
    })
  }, [bridge, source])
  useCommitEffect(
    () =>
      source.subscribe?.(() => {
        void bridge.notify().catch(() => {
          /* The next request surfaces the source error. */
        })
      }),
    [bridge, source],
  )
  // The hook owns only its subscription. Strict Mode can reconnect it; in-flight callers retain the bridge.
  return bridge
}
