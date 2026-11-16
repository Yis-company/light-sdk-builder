# Beta releases

Changesets v3 releases five public packages in lockstep: core, TanStack Query, auth, React bindings and the opt-in lint plugin. A `fixed` group in `.changeset/config.json` gives them one shared version, so any release bumps all five. The workspace root remains `private: true` and is never published. The first public beta used per-package versions (core/TanStack `0.1.0-beta.4`, React `0.1.0-beta.2`, auth/lint `0.1.0-beta.0`); the packages share versions from `0.1.0-beta.5`. Do not reset package versions or repeat the original bootstrap.

## Record and version changes

Run `bun run changeset` for consumer-visible package changes. Commit the selected packages and release notes. `.changeset/pre.json` keeps the repository in `beta` mode. `bun run version-packages` updates versions, changelogs, internal peer/dev ranges and `bun.lock`.

The **Version packages** workflow runs on GitHub-hosted Ubuntu after a push to `main`, or through manual dispatch. Changesets creates/updates a draft version PR when changesets are pending. Its scoped token can write contents and PRs; the workflow explicitly dispatches Check for token-generated commits. Review and merge that PR only after its Node 22/24/26 matrix passes. The version workflow cannot publish npm packages.

Core is a peer and local development dependency of the TanStack package. Published manifests use ordinary semver ranges, never `workspace:`. All enabled releases remain below 1.0 and use a `-beta.N` version.

## Verification and exact artifacts

Routine PR/main CI always checks npm-packed archives, including between releases:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run format:check
bun run check
bun run test:release
bun run test:package
bunx playwright install chromium
bun run test:browser
```

Fresh npm/Bun consumers check declarations, optional dependencies, reusable SDK definitions, HTTP/error identity and installed ESLint/Oxlint integration. Runtime archives contain compiled JS/declarations, README, LICENSE and NOTICE. The lint plugin ships its standalone JS source without runtime dependencies.

The publishing job uses Changesets' actual artifacts:

```sh
bun run build
bun run release:pack
node scripts/release-policy.mjs
bun run release:check
bun run test:browser
```

`release:pack` queries npm and packs only unpublished versions. `release:check` tests the archives listed in `artifacts/release/publish-plan.json`, installing unchanged dependencies from their exact registry versions. A tag-only recovery plan contains no new archives and skips the consumer/browser artifact checks. Routine CI still runs between releases.

## Hosted publication

**Publish beta packages** runs after a successful Check push on `main`, or by manual dispatch on `main`. It rejects fork/PR triggers and requires the public repository's current main SHA plus successful Node 22/24/26 jobs. Publication is serialized; stale main runs skip publishing.

The job builds, packs, validates and tests before `changesets/action/publish@v2.1.2` runs `bun run release:publish`. That command uses `changeset publish --from-pack-dir artifacts/release`, so it publishes the exact tested tarballs, not a second pack. Npm provenance is enabled. The Changesets action pushes package tags and creates GitHub prereleases from changelogs. The finishing step verifies npm versions, the `beta` tag and provenance, then attaches each verified archive to its GitHub release.

Changesets may plan later betas for `latest` when only prereleases exist. The finishing step also advances `beta`, preserving documented `package@beta` installs. First publication can establish `latest` too. Inspect actual dist-tags after publishing; a beta version is not a stable release.

Already-published versions are skipped by Changesets. A partial failure must be investigated, then the same main release may be rerun; do not bump versions simply to retry authentication or metadata operations. Published versions are immutable.

## npm authentication

The first publication needs an npm account authorized to create/publish the five unscoped package names. Supply a granular publishing token with the needed package permissions and bypass 2FA through the secure credential flow. Store it only as the repository Actions secret `NPM_TOKEN`. No token belongs in Git, logs or a committed `.npmrc`.

The hosted publication job has `id-token: write` and npm 12.2.0, ready for npm trusted publishing. After the packages exist, configure each package's trusted publisher to **Yis-company/light-sdk-builder**, workflow **release.yml**, GitHub Actions. Enable npm dist-tag access as well, since later betas may need the finishing step to advance the beta tag. Verify OIDC publishing before removing the bootstrap secret or disallowing token access. No trusted publisher is assumed to exist merely because the workflow has an OIDC permission.

Use manual **Publish beta packages** dispatch after configuration changes or to retry a verified main release. GitHub Packages is a different registry and is not required for public npm installs.

## Acceptance and rollback

Verify all five registry versions, beta tags, provenance and GitHub release assets. Install the published versions in fresh npm/Bun consumers and refresh Platform's exact registry dependencies. The Platform spike remains a draft; publishing the SDK does not authorize deploying Platform.

A known Bun/up-fetch multipart serialization limitation is independent of SDK binding; document it and use a suitable client/runtime for uploads. Mocked HTTP compatibility checks are not live backend acceptance.

Consumers can pin a prior known-good npm version. Correct a faulty beta with a new Changeset/version; changing a dist-tag does not change existing installations. Keep prior archives for rollback. A stable release requires a separate policy decision and changes to the beta-only publish guard.

References: [Changesets automation](https://changesets.dev/guide/automating), [Changesets prereleases](https://changesets.dev/guide/prereleases), [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
