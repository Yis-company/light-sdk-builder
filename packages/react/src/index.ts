import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  createAuthBridge,
  type AuthBridge,
  type AuthBridgeOptions,
  type AuthSnapshot,
  type AuthSource,
} from 'light-sdk-builder-auth'
const useCommitEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

/** Keep SDK access independent from any particular authentication provider or query library. */
export function createSdkContext<SDK>() {
  const Context = createContext<{ sdk: SDK } | undefined>(undefined)
  function Provider({ sdk, children }: { sdk: SDK; children?: ReactNode }) {
    const value = useMemo(() => ({ sdk }), [sdk])
    return createElement(Context.Provider, { value }, children)
  }
  function useSdk(): SDK {
    const value = useContext(Context)
    if (!value) throw new Error('useSdk must be used inside its SDK Provider')
    return value.sdk
  }
  return { Provider, useSdk }
}

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

/** One SDK per client, shared by hook consumers rather than rebuilding every route in every component. */
export function createSdkHook<Client extends object, SDK>(
  useClient: () => Client,
  create: (client: Client) => SDK,
) {
  const instances = new WeakMap<Client, SDK>()
  return function useSdk(): SDK {
    const client = useClient()
    let sdk = instances.get(client)
    if (sdk === undefined) {
      sdk = create(client)
      instances.set(client, sdk)
    }
    return sdk
  }
}
