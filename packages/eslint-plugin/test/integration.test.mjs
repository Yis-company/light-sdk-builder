import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ESLint } from 'eslint'
import plugin from '../src/index.js'

const rules = {
  'light-sdk-builder/prefer-reusable-procedures': 'error',
  'light-sdk-builder/no-framework-in-routes': 'error',
}
const invalid = `import { createProcedure as make } from 'light-sdk-builder';
import * as sdk from 'light-sdk-builder';
import * as React from 'react';
make(http); sdk.createProcedure(http);
function local(make) { return make(http) }`

// Exercise the user's flat-config boundary as well as the individual rules.
test('ESLint flat config checks only the selected route glob', async () => {
  const linter = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['src/routes/**/*.js'],
        plugins: { 'light-sdk-builder': plugin },
        rules,
      },
    ],
  })
  const [route] = await linter.lintText(invalid, { filePath: 'src/routes/users.js' })
  assert.deepEqual(route.messages.map((message) => message.ruleId).sort(), [
    'light-sdk-builder/no-framework-in-routes',
    'light-sdk-builder/prefer-reusable-procedures',
    'light-sdk-builder/prefer-reusable-procedures',
  ])
  const [runtime] = await linter.lintText(invalid, { filePath: 'src/runtime.js' })
  assert.equal(runtime.errorCount, 0)
})

test('Oxlint loads the ESM JS plugin and scopes its rules to routes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'light-sdk-lint-'))
  try {
    mkdirSync(join(directory, 'src/routes'), { recursive: true })
    writeFileSync(
      join(directory, 'src/routes/users.ts'),
      `${invalid}\nimport type { QueryClient } from '@tanstack/query-core';`,
    )
    writeFileSync(join(directory, 'src/runtime.ts'), invalid)
    writeFileSync(
      join(directory, '.oxlintrc.json'),
      JSON.stringify({
        plugins: [],
        categories: { correctness: 'off' },
        jsPlugins: [
          {
            name: 'light-sdk-builder',
            specifier: fileURLToPath(new URL('../src/index.js', import.meta.url)),
          },
        ],
        overrides: [{ files: ['src/routes/**/*.ts'], rules }],
      }),
    )
    const require = createRequire(import.meta.url)
    const binary = join(dirname(require.resolve('oxlint/package.json')), 'bin/oxlint')
    const result = spawnSync(process.execPath, [binary, '--format', 'json', 'src'], {
      cwd: directory,
      encoding: 'utf8',
    })
    assert.equal(result.status, 1, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.diagnostics.length, 3, result.stdout)
    assert.ok(
      report.diagnostics.every((diagnostic) => diagnostic.filename.endsWith('src/routes/users.ts')),
      result.stdout,
    )
    assert.equal(
      report.diagnostics.filter((diagnostic) =>
        diagnostic.code.includes('prefer-reusable-procedures'),
      ).length,
      2,
    )
    assert.equal(
      report.diagnostics.filter((diagnostic) => diagnostic.code.includes('no-framework-in-routes'))
        .length,
      1,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
