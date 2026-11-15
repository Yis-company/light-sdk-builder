import { createAuthBridge, type AuthSource } from 'light-sdk-builder-auth'
import { createSdkContext, useAuthBridge, useAuthSnapshot } from 'light-sdk-builder-react'
import { createTransport, createProcedure } from 'light-sdk-builder'
import { withTanStack } from 'light-sdk-builder-tanstack-query'

const source: AuthSource = {
  getRequestContext: async () => ({
    sessionKey: 'opaque-session',
    revision: 1,
    credentials: 'include',
    headers: { 'X-CSRF': 'csrf' },
  }),
  recover: async ({ response, request, sessionKey, revision }) => {
    const status: number = response.status
    const key: string | number | null = sessionKey
    const version: string | number = revision
    const method: string = request.method
    return status === 401 && key !== null && version !== '' && method !== ''
  },
  subscribe: (changed) => {
    changed()
    return () => {}
  },
}
const bridge = createAuthBridge(source)
const transport = createTransport(bridge.fetch)
const sdk = {
  ping: createProcedure(transport)
    .path('ping')
    .query(({ upFetch }) => upFetch('/ping')),
}
const enhanced = withTanStack(sdk)
void enhanced.ping.queryOptions()
const { Provider, useSdk } = createSdkContext<typeof sdk>()
void Provider
function useApplicationSdk() {
  const auth = useAuthBridge(source)
  const version: number = useAuthSnapshot(auth).version
  void version
  return useSdk()
}
void useApplicationSdk
