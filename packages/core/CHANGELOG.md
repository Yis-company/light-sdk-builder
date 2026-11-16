# light-sdk-builder

## 0.1.0-beta.5

### Patch Changes

- 6a49845: Release all five packages together under one shared version.

## 0.1.0-beta.4

### Minor Changes

- Add createSdkBuilder for reusable client-free procedure definitions, with per-instance HTTP, context keys and plugin binding. Preserve existing bound APIs. Ship a separate opt-in ESLint/Oxlint plugin and repository agent skill for route authoring and migration.

## 0.1.0-beta.3

### Minor Changes

- Keep HTTP clients and application policy user-owned. Replace createTransport with createHttpTransport, upFetch callback fields with http, scope policies with generic context resolvers, and allScopesKey with baseKey. Native up-fetch helpers must be imported directly from up-fetch. Rename React hook factories to createUseSdk and createUseTanStackSdk.

## 0.1.0-beta.2

### Minor Changes

- Initialize agnostic route factories with createSdk and register typed plugins once per consuming SDK. Add the TanStack plugin and optional React hook/provider entry, preserve plain infinite-page calls, and allow React context bindings without auth.

## 0.1.0-beta.1

### Minor Changes

- Connect user-owned authentication to SDK requests, with shared recovery, bounded replay and session isolation. Add generic procedure authoring, optional React bindings, and TanStack procedure/cache adapters.

## 0.1.0-beta.0

### Minor Changes

- Introduce the schema-neutral SDK core and separate optional TanStack Query adapter as beta packages.
