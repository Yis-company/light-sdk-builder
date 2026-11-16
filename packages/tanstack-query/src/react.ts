import { createSdk } from 'light-sdk-builder'
import { createUseSdk } from 'light-sdk-builder-react/context'
import { tanstackQuery } from './index.js'

/** One application-level hook configuration; route factories and backend SDKs remain agnostic. */
export function createUseTanStackSdk<Transport extends object, Routes>(
  useTransport: () => Transport,
  routes: (transport: Transport) => Routes,
) {
  return createUseSdk(useTransport, (transport) =>
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
export { createUseSdk, createSdkContext } from 'light-sdk-builder-react/context'
