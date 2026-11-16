# light-sdk-builder-react

## 0.1.0-beta.6

### Patch Changes

- b1419cc: Rejected procedure input throws `ValidationError` (kind `input`) whose message names each field; `issuePath` is exported. Keys always end their path with an input slot (`{}` without input), so filters never match longer paths, and `baseKey()` without an input matches every input. Procedures returning `any` give `unknown`.
- Updated dependencies [b1419cc]
  - light-sdk-builder-auth@0.1.0-beta.6

## 0.1.0-beta.5

### Patch Changes

- 6a49845: Release all five packages together under one shared version.
- Updated dependencies [6a49845]
  - light-sdk-builder-auth@0.1.0-beta.5

## 0.1.0-beta.2

### Minor Changes

- Keep HTTP clients and application policy user-owned. Replace createTransport with createHttpTransport, upFetch callback fields with http, scope policies with generic context resolvers, and allScopesKey with baseKey. Native up-fetch helpers must be imported directly from up-fetch. Rename React hook factories to createUseSdk and createUseTanStackSdk.

## 0.1.0-beta.1

### Minor Changes

- Initialize agnostic route factories with createSdk and register typed plugins once per consuming SDK. Add the TanStack plugin and optional React hook/provider entry, preserve plain infinite-page calls, and allow React context bindings without auth.

## 0.1.0-beta.0

### Minor Changes

- Connect user-owned authentication to SDK requests, with shared recovery, bounded replay and session isolation. Add generic procedure authoring, optional React bindings, and TanStack procedure/cache adapters.

### Patch Changes

- Updated dependencies
  - light-sdk-builder-auth@0.1.0-beta.0
