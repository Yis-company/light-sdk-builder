# Beta releases

The repository root is private. `light-sdk-builder` and `light-sdk-builder-tanstack-query` are public packages with independent versions. Both start at **`0.1.0-beta.0`**; no `1.0` release or npm publication is authorized by this setup.

## Recording changes

```sh
bun run changeset
```

Select affected packages and describe the consumer-visible change. Beta mode is recorded in `.changeset/pre.json`. The initial unpublished packages were bootstrapped at `0.0.0`; a minor changeset in beta mode produces `0.1.0-beta.0`. Do not repeat that bootstrap after publication.

For subsequent versions:

```sh
bun run version-packages
```

Review package versions, changelogs, plugin peer/dev ranges, and `bun.lock`. Core is a plugin peer plus a local development dependency. Published manifests use ordinary semver ranges, never `workspace:`. Check that the planned versions stay below `1.0.0`.

The version workflow creates or updates a version PR with scoped contents, pull-request, and actions write permissions. It explicitly dispatches Check for the generated head, since token-created commits may not trigger normal PR workflows. Confirm the Node 22/24/26 matrix is green for that exact head before merging. The workflow does not publish packages.

## Verify artifacts

Routine CI always uses per-package `npm pack`, including between releases when a version is already published:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test:package
bunx playwright install chromium
bun run test:browser
```

The installed-package checks use fresh npm/Bun projects, compile public declarations, exercise core-only and React Query consumers, and check that core is shared and `HttpError` identity holds. Package contents must include compiled code, declarations, LICENSE, NOTICE, and README without workspace-only dependency values.

Before a release, rehearse the actual Changesets artifacts too:

```sh
bun run release:pack
bun run release:check
```

`release:pack` runs `changeset pack --out-dir artifacts/release`. This consults npm and packs only unpublished versions. The verifier reads the generated publish plan and tests only its listed archives. If only one package changes, it installs the unchanged package from the registry at its exact version. `release:check` runs the same installed-consumer checks against that output. Inspect the publish plan and artifact manifests, including public access and dependency ranges.

Changesets packs with npm. Testing a Bun-only archive does not prove the package Changesets will publish. Eventual publication must send the tested archives with `changeset publish --from-pack-dir artifacts/release`; artifact mode rejects `--tag`.

## Publication gates

Publishing remains a separate, explicit decision. Confirm:

- npm package names and owner access for both packages.
- repository visibility, intended source visibility, and license/notice contents.
- supported credentials and publishing runner; npm trusted publishing currently does not support self-hosted runners.
- actual npm dist-tags and the Changesets publish plan for every beta.
- installed archive checks and refreshed Platform core compatibility.

A first unpublished prerelease is planned for the `beta` tag by Changesets. Later prereleases may be planned for `latest` while only beta versions exist. Inspect actual registry state and planned tags every time; do not assume beta versions always stay off `latest` or that artifact mode can override the tag. Do not exit prerelease mode without a separate stable-release decision.

## Rollback

Published npm versions are immutable. Preserve the previous known-good version and archive. Consumers can pin or reinstall that exact version; Platform can restore its previous vendored core archive and lockfile together. A maintainer can correct dist-tags after reviewing registry state, but that does not change already-installed versions. Fix a bad beta with a new Changeset and beta version.

References: [Changesets prereleases](https://changesets.dev/guide/prereleases), [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
