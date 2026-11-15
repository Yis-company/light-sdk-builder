import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'

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
