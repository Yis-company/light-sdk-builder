---
'light-sdk-builder': minor
'light-sdk-builder-react': minor
'light-sdk-builder-tanstack-query': minor
---

Keep HTTP clients and application policy user-owned. Replace createTransport with createHttpTransport, upFetch callback fields with http, scope policies with generic context resolvers, and allScopesKey with baseKey. Native up-fetch helpers must be imported directly from up-fetch. Rename React hook factories to createUseSdk and createUseTanStackSdk.
