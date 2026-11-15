# light-sdk-builder-tanstack-query

## 0.1.0-beta.3

### Minor Changes

- Keep HTTP clients and application policy user-owned. Replace createTransport with createHttpTransport, upFetch callback fields with http, scope policies with generic context resolvers, and allScopesKey with baseKey. Native up-fetch helpers must be imported directly from up-fetch. Rename React hook factories to createUseSdk and createUseTanStackSdk.

### Patch Changes

- Updated dependencies
  - light-sdk-builder@0.1.0-beta.3
  - light-sdk-builder-react@0.1.0-beta.2

## 0.1.0-beta.2

### Minor Changes

- Initialize agnostic route factories with createSdk and register typed plugins once per consuming SDK. Add the TanStack plugin and optional React hook/provider entry, preserve plain infinite-page calls, and allow React context bindings without auth.

### Patch Changes

- Updated dependencies
  - light-sdk-builder@0.1.0-beta.2
  - light-sdk-builder-react@0.1.0-beta.1

## 0.1.0-beta.1

### Minor Changes

- Connect user-owned authentication to SDK requests, with shared recovery, bounded replay and session isolation. Add generic procedure authoring, optional React bindings, and TanStack procedure/cache adapters.

### Patch Changes

- Updated dependencies
  - light-sdk-builder@0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- Introduce the schema-neutral SDK core and separate optional TanStack Query adapter as beta packages.

### Patch Changes

- Updated dependencies
  - light-sdk-builder@0.1.0-beta.0
