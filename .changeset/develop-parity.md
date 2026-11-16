---
'light-sdk-builder': patch
'light-sdk-builder-auth': patch
'light-sdk-builder-react': patch
'light-sdk-builder-tanstack-query': patch
'eslint-plugin-light-sdk-builder': patch
---

Rejected procedure input throws `ValidationError` (kind `input`) whose message names each field; `issuePath` is exported. Keys always end their path with an input slot (`{}` without input), so filters never match longer paths, and `baseKey()` without an input matches every input. Procedures returning `any` give `unknown`.
