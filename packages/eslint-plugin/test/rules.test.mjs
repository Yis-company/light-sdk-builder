import { describe, it } from 'node:test'
import { RuleTester } from 'eslint'
import parser from '@typescript-eslint/parser'
import plugin from '../src/index.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parser },
})
const bound = { messageId: 'bound' }
const framework = { messageId: 'framework' }

tester.run('prefer-reusable-procedures', plugin.rules['prefer-reusable-procedures'], {
  valid: [
    `import { createSdkBuilder } from 'light-sdk-builder'; const sdk = createSdkBuilder(); export const users = sdk.procedure.path('users').query(({ http }) => http('users'));`,
    `import { createProcedure } from 'another-library'; createProcedure(http);`,
    `function createProcedure() {} createProcedure(http);`,
    `const sdk = { createProcedure() {} }; sdk.createProcedure(http);`,
    `import { createProcedure } from 'light-sdk-builder'; function route(createProcedure) { return createProcedure(http) }`,
    `import * as sdk from 'light-sdk-builder'; function route(sdk) { return sdk.createProcedure(http) }`,
    `import * as sdk from 'light-sdk-builder'; { const sdk = other; sdk.createProcedure(http) }`,
    `import type { createProcedure } from 'light-sdk-builder'; type Factory = typeof createProcedure;`,
    `import { type createProcedure } from 'light-sdk-builder'; type Factory = typeof createProcedure;`,
    `import * as sdk from 'light-sdk-builder'; sdk.procedure.path('users');`,
    `import { createProcedure } from 'light-sdk-builder'; let alias = other; alias(http);`,
    {
      code: `import { createProcedure } from 'light-sdk-builder'; createProcedure(http)`,
      options: [{ modules: ['@app/sdk'] }],
    },
    `import * as sdk from 'light-sdk-builder'; const { createOther: createProcedure } = sdk; createProcedure(http);`,
    `import * as sdk from 'light-sdk-builder'; const { [property]: createProcedure } = sdk; createProcedure(http);`,
    `import * as sdk from 'light-sdk-builder'; const a = sdk; function route(a) { a.createProcedure(http) }`,
    `const a = b; const b = a; a(http);`,
  ],
  invalid: [
    {
      code: `import { createProcedure } from 'light-sdk-builder'; export const users = createProcedure(http).path('users');`,
      errors: [bound],
    },
    {
      code: `import { createProcedure as make } from 'light-sdk-builder'; make(http);`,
      errors: [bound],
    },
    {
      code: `import * as sdk from 'light-sdk-builder'; sdk.createProcedure(http);`,
      errors: [bound],
    },
    {
      code: `import * as sdk from 'light-sdk-builder'; sdk['createProcedure'](http);`,
      errors: [bound],
    },
    {
      code: `import { createProcedure } from 'light-sdk-builder'; const make = createProcedure; make(http);`,
      errors: [bound],
    },
    {
      code: `import * as sdk from 'light-sdk-builder'; const lib = sdk; const make = lib.createProcedure; make(http);`,
      errors: [bound],
    },
    {
      code: `import * as sdk from 'light-sdk-builder'; const { createProcedure: make } = sdk; make(http);`,
      errors: [bound],
    },
    {
      code: `import { createProcedure as make } from '@app/sdk'; make(http);`,
      options: [{ modules: ['@app/sdk'] }],
      errors: [bound],
    },
    {
      code: `import * as sdk from '@app/sdk'; sdk.createProcedure(http);`,
      options: [{ modules: ['@app/sdk'] }],
      errors: [bound],
    },
    {
      code: `import { createProcedure } from 'light-sdk-builder'; export const users = () => { const p = createProcedure(http); return p.path('users').query(() => createProcedure(http).query(run)); };`,
      errors: [bound, bound],
    },
    {
      code: `import { createProcedure } from 'light-sdk-builder'; const make = createProcedure as typeof createProcedure; make(http);`,
      errors: [bound],
    },
    {
      code: `import { createProcedure } from 'light-sdk-builder'; function route() { return createProcedure(http); }`,
      errors: [bound],
    },
  ],
})

tester.run('no-framework-in-routes', plugin.rules['no-framework-in-routes'], {
  valid: [
    `import { createSdkBuilder } from 'light-sdk-builder';`,
    `import type * as React from 'react';`,
    `import type { QueryClient } from '@tanstack/query-core';`,
    `import { type QueryClient, type QueryKey } from '@tanstack/query-core';`,
    `export type { QueryClient } from '@tanstack/query-core';`,
    `export { type QueryClient } from '@tanstack/query-core';`,
    `export type * from 'react';`,
    `type ReactNode = import('react').ReactNode;`,
    `const load = (name) => import(name);`,
    `import x from 'reactive';`,
    `import x from 'light-sdk-builder-reactive';`,
    { code: `import x from 'react';`, options: [{ blockedModules: ['@app/ui'] }] },
    { code: `import x from '@app/utils';`, options: [{ blockedModules: ['@app/ui'] }] },
  ],
  invalid: [
    { code: `import React from 'react';`, errors: [framework] },
    { code: `import * as React from 'react';`, errors: [framework] },
    { code: `import { jsx } from 'react/jsx-runtime';`, errors: [framework] },
    { code: `import { createUseSdk } from 'light-sdk-builder-react';`, errors: [framework] },
    {
      code: `import { tanstackQuery } from 'light-sdk-builder-tanstack-query';`,
      errors: [framework],
    },
    {
      code: `import { type QueryKey, QueryClient } from '@tanstack/query-core';`,
      errors: [framework],
    },
    {
      code: `export { type QueryKey, QueryClient } from '@tanstack/query-core';`,
      errors: [framework],
    },
    { code: `export * from '@tanstack/react-query';`, errors: [framework] },
    { code: `export * as sdkReact from 'light-sdk-builder-react';`, errors: [framework] },
    {
      code: `export { createUseSdk as useSdk } from 'light-sdk-builder-react';`,
      errors: [framework],
    },
    { code: `import 'react-dom/client';`, errors: [framework] },
    { code: `import {} from 'react';`, errors: [framework] },
    { code: `const react = await import('react');`, errors: [framework] },
    { code: `const load = () => import('@tanstack/react-query');`, errors: [framework] },
    {
      code: `import * as ui from '@app/ui/components';`,
      options: [{ blockedModules: ['@app/ui'] }],
      errors: [framework],
    },
    {
      code: `export * from '@app/react';`,
      options: [{ blockedModules: ['@app/*'] }],
      errors: [framework],
    },
  ],
})
