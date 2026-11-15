import { createHttpTransport, type HttpTransportOptions } from './transport.js'
import {
  createProcedureTemplates,
  procedureTemplate,
  type ProcedureOptions,
  type ProcedureFactory,
  type ProcedureTemplate,
} from './procedure.js'
import { createSdk, type ApplySdkPlugins, type SdkPlugins } from './sdk.js'

export type ProcedureRoutes<Http> = {
  readonly [procedureTemplate]?: never
  readonly [name: string]: ProcedureTemplate<Http, unknown> | ProcedureRoutes<Http>
}
export type BoundRoutes<Routes> =
  Routes extends ProcedureTemplate<infer _Http, infer Bound>
    ? Bound
    : { [Key in keyof Routes]: BoundRoutes<Routes[Key]> }
export type SdkBuilderOptions<Http> = HttpTransportOptions<Http> & ProcedureOptions<Http>

export type SdkCreateOptions<Http, Routes, Plugins> = {
  http: Http
  routes: Routes
  plugins?: Plugins
}
export type SdkBuilder<Http> = {
  procedure: ProcedureFactory<Http, true>
  create: <
    const Routes extends ProcedureRoutes<Http>,
    const Plugins extends SdkPlugins = readonly [],
  >(
    options: SdkCreateOptions<Http, Routes, Plugins>,
  ) => ApplySdkPlugins<BoundRoutes<Routes>, Plugins>
}

/** Definitions hold schemas and callbacks; every create call binds a separate client and plugin set. */
export function createSdkBuilder<Http>(options: SdkBuilderOptions<Http> = {}): SdkBuilder<Http> {
  const { bind, keyContext } = options
  function create<
    const Routes extends ProcedureRoutes<Http>,
    const Plugins extends SdkPlugins = readonly [],
  >({
    http,
    routes,
    plugins,
  }: {
    http: Http
    routes: Routes
    plugins?: Plugins
  }): ApplySdkPlugins<BoundRoutes<Routes>, Plugins> {
    const transport = createHttpTransport(http, bind ? { bind } : {})
    const policy: ProcedureOptions<Http> = keyContext ? { keyContext } : {}
    const ancestors = new Set<object>()
    function bindRoutes(tree: ProcedureRoutes<Http> | ProcedureTemplate<Http, unknown>): unknown {
      if (procedureTemplate in tree) return tree[procedureTemplate](transport, policy)
      if (ancestors.has(tree)) throw new Error('SDK route definitions must not contain cycles')
      ancestors.add(tree)
      const bound = Object.fromEntries(
        Object.entries(tree).map(([name, child]) => [name, bindRoutes(child)]),
      )
      ancestors.delete(tree)
      return bound
    }
    // The binding walk preserves every route name and replaces each template with its typed bound methods.
    const bound = bindRoutes(routes) as BoundRoutes<Routes>
    return createSdk({ routes: () => bound, transport, ...(plugins ? { plugins } : {}) })
  }
  return { procedure: createProcedureTemplates<Http>(), create }
}
