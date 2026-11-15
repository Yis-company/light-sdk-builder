/** Type slots let plugins describe their result for the actual route tree, without framework types in core. */
export interface SdkPlugin {
  readonly input: unknown
  readonly output: unknown
  setup(routes: this['input']): this['output']
}
export type SdkPlugins = readonly [] | readonly [SdkPlugin, ...SdkPlugin[]]
export type ApplySdkPlugins<
  Routes,
  Plugins extends readonly SdkPlugin[],
> = Plugins extends readonly [
  infer First extends SdkPlugin,
  ...infer Rest extends readonly SdkPlugin[],
]
  ? ApplySdkPlugins<(First & { readonly input: Routes })['output'], Rest>
  : Routes

/** Plugin type slots are compile-time only; setup is the entire runtime contract. */
export function defineSdkPlugin<Plugin extends SdkPlugin>(setup: Plugin['setup']): Plugin {
  return { setup } as Plugin
}

/** Create routes once, then apply only the explicitly registered plugins, in order. */
export function createSdk<Transport, Routes, const Plugins extends SdkPlugins = readonly []>({
  routes,
  transport,
  plugins,
}: {
  routes: (transport: Transport) => Routes
  transport: Transport
  plugins?: Plugins
}): ApplySdkPlugins<Routes, Plugins> {
  let sdk: unknown = routes(transport)
  for (const plugin of plugins ?? []) sdk = plugin.setup(sdk)
  return sdk as ApplySdkPlugins<Routes, Plugins>
}
