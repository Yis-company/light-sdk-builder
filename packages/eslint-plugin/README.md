# eslint-plugin-light-sdk-builder

Opt-in ESLint v9+ rules for reusable SDK route definitions. Plain ESM, no runtime dependencies and no automatic fixes.

```js
import lightSdkBuilder from 'eslint-plugin-light-sdk-builder'

export default [
  {
    files: ['src/routes/**/*.{js,mjs}'],
    plugins: { 'light-sdk-builder': lightSdkBuilder },
    rules: {
      'light-sdk-builder/prefer-reusable-procedures': 'error',
      'light-sdk-builder/no-framework-in-routes': 'error',
    },
  },
]
```

Use your existing TypeScript parser when linting TypeScript. The rules are disabled unless you configure them. Bound `createProcedure` remains supported outside the globs you select.

- `prefer-reusable-procedures`: prefer `sdk.procedure` definitions over imported `createProcedure` calls. Configure `modules` for application reexports.
- `no-framework-in-routes`: keep runtime React, TanStack and SDK framework-adapter imports out of routes. Configure `blockedModules` to replace the defaults. Type-only imports are allowed.

Checks are local to the file: they follow imported bindings and immutable aliases, but cannot trace arbitrary wrappers, CommonJS, cross-file reexports or captured clients.

See the [lint guide](https://github.com/Yis-company/light-sdk-builder/blob/main/docs/lint.md) for ESLint, Oxlint JS-plugin configuration, rule options and the optional repository-local agent skill.
