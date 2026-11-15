import { createSdk } from 'light-sdk-builder'
import { createSdkHook } from 'light-sdk-builder-react/context'
import { tanstackQuery } from './index.js'

/** One application-level hook configuration; route factories and backend SDKs remain agnostic. */
export function createTanStackHook<Transport extends object, Routes>(
  useTransport: () => Transport,
  routes: (transport: Transport) => Routes,
) {
  return createSdkHook(useTransport, (transport) =>
    createSdk({
      routes,
      transport,
      plugins: [tanstackQuery()],
    }),
  )
}

export {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useSuspenseQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query'
export { createSdkHook, createSdkContext } from 'light-sdk-builder-react/context'
