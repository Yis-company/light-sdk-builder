# Route definition lint

`eslint-plugin-light-sdk-builder` provides two opt-in rules for reusable route files. It has no runtime dependencies on ESLint, a TypeScript parser, core, React or TanStack Query. Install it as a development dependency alongside your linter. The plugin uses the ESLint v9+ API.

Choose the route glob for your application. Keep SDK creation, framework hooks and framework plugins outside it; existing low-level `createProcedure` usage elsewhere remains supported. No rule changes code automatically or chooses which client owns a request.

## ESLint flat config

For TypeScript files, use your existing compatible TypeScript parser. For example, with `@typescript-eslint/parser` installed:

```js
// eslint.config.js
import tsParser from '@typescript-eslint/parser'
import lightSdkBuilder from 'eslint-plugin-light-sdk-builder'

export default [
  {
    files: ['src/routes/**/*.{ts,tsx,js,mjs}'],
    languageOptions: { parser: tsParser },
    plugins: { 'light-sdk-builder': lightSdkBuilder },
    rules: {
      'light-sdk-builder/prefer-reusable-procedures': 'error',
      'light-sdk-builder/no-framework-in-routes': 'error',
    },
  },
]
```

## Oxlint JS plugins

Use the same namespace with [Oxlint's JS plugin configuration](https://oxc.rs/docs/guide/usage/linter/js-plugins). JS plugins are currently an alpha Oxlint feature; verify against the version you install.

```json
{
  "jsPlugins": [
    {
      "name": "light-sdk-builder",
      "specifier": "eslint-plugin-light-sdk-builder"
    }
  ],
  "overrides": [
    {
      "files": ["src/routes/**/*.{ts,tsx,js,mjs}"],
      "rules": {
        "light-sdk-builder/prefer-reusable-procedures": "error",
        "light-sdk-builder/no-framework-in-routes": "error"
      }
    }
  ]
}
```

## Rules and configuration

`prefer-reusable-procedures` reports calls to `createProcedure` imported from `light-sdk-builder`, including renamed imports, namespace members and immutable local aliases. It resolves lexical bindings, so unrelated functions and shadowed names are allowed. Calls inside callbacks are checked too. Use `sdk.procedure` from one `createSdkBuilder<Http>({ bind, keyContext })` definition, export a static route tree, then bind it with `sdk.create({ http, routes, plugins })` at the runtime boundary.

For application helpers that reexport `createProcedure`, add their exact import specifiers. The `modules` array replaces the default:

```js
'light-sdk-builder/prefer-reusable-procedures': ['error', {
  modules: ['light-sdk-builder', '@app/sdk/procedure'],
}]
```

`no-framework-in-routes` reports runtime imports, reexports and string-literal dynamic imports from `light-sdk-builder-react`, `light-sdk-builder-tanstack-query`, `react`, `react-dom` and `@tanstack/*`. Namespace and side-effect imports count. Entirely type-only imports/reexports are allowed; a mixed import with any runtime specifier is reported. Empty imports still load a module and are reported.

`blockedModules` replaces that default list. Each entry matches the named package and its subpaths; a trailing `/*` matches that prefix:

```js
'light-sdk-builder/no-framework-in-routes': ['error', {
  blockedModules: [
    'light-sdk-builder-react',
    'light-sdk-builder-tanstack-query',
    'react',
    'react-dom',
    '@tanstack/*',
    '@app/ui',
  ],
}]
```

These checks inspect the current file's AST. They do not follow arbitrary wrappers, renamed cross-file reexports, path aliases you have not configured, mutable assignments, computed dynamic module names or CommonJS `require`. They cannot prove that callbacks never capture an HTTP client, or that an allowed imported helper is framework-free. Review client ownership and instance isolation separately.

## Optional agent skill

The repository includes `skills/light-sdk-builder/SKILL.md` for SDK authoring and migrations. It leaves HTTP client, validator and framework choices with the application. To make it available in a consuming repository, copy that folder into a repository-local skill directory supported by your agent, for example:

```sh
mkdir -p .agents/skills
cp -R /path/to/light-sdk-builder/skills/light-sdk-builder .agents/skills/light-sdk-builder
```

This is optional and does not install anything into personal or global skill directories.
