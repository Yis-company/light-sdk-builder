# light-sdk-builder-auth

## 0.1.0-beta.6

### Patch Changes

- b1419cc: Rejected procedure input throws `ValidationError` (kind `input`) whose message names each field; `issuePath` is exported. Keys always end their path with an input slot (`{}` without input), so filters never match longer paths, and `baseKey()` without an input matches every input. Procedures returning `any` give `unknown`.

## 0.1.0-beta.5

### Patch Changes

- 6a49845: Release all five packages together under one shared version.

## 0.1.0-beta.0

### Minor Changes

- Connect user-owned authentication to SDK requests, with shared recovery, bounded replay and session isolation. Add generic procedure authoring, optional React bindings, and TanStack procedure/cache adapters.
