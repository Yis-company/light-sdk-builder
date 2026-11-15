import assert from 'node:assert/strict'
import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/** Prove that the shipped plugin works independently of the SDK and the repository's dependencies. */
export async function verifyLintPackage({ archive, fixture, run }) {
  for (const manager of ['npm', 'bun']) {
    const cwd = join(fixture, manager + '-lint')
    await mkdir(join(cwd, 'src/routes'), { recursive: true })
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify({
        name: 'sdk-lint-consumer',
        private: true,
        type: 'module',
        devDependencies: {
          'eslint-plugin-light-sdk-builder': archive,
          eslint: '10.15.0',
          '@typescript-eslint/parser': '8.72.2',
          typescript: '5.5.4',
          oxlint: '1.93.0',
        },
      }),
    )
    run(
      manager,
      manager === 'npm'
        ? ['install', '--ignore-scripts', '--no-audit', '--no-fund']
        : ['install', '--ignore-scripts'],
      cwd,
    )
    for (const optional of ['light-sdk-builder', 'react', '@tanstack/query-core', 'up-fetch'])
      await assert.rejects(access(join(cwd, 'node_modules', optional)))
    await writeFile(
      join(cwd, 'eslint.config.js'),
      `
import plugin from 'eslint-plugin-light-sdk-builder'
import parser from '@typescript-eslint/parser'
export default [{
 files: ['src/routes/**/*.ts'],
 languageOptions: { parser },
 plugins: { 'light-sdk-builder': plugin },
 rules: { 'light-sdk-builder/prefer-reusable-procedures': 'error', 'light-sdk-builder/no-framework-in-routes': 'error' }
}]
`,
    )
    await writeFile(
      join(cwd, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off' },
        jsPlugins: [{ name: 'light-sdk-builder', specifier: 'eslint-plugin-light-sdk-builder' }],
        overrides: [
          {
            files: ['src/routes/**/*.ts'],
            rules: {
              'light-sdk-builder/prefer-reusable-procedures': 'error',
              'light-sdk-builder/no-framework-in-routes': 'error',
            },
          },
        ],
      }),
    )
    await writeFile(
      join(cwd, 'src/routes/good.ts'),
      "import type { QueryClient } from '@tanstack/query-core'; export const routes = {}",
    )
    await writeFile(
      join(cwd, 'src/routes/bound.ts'),
      "import { createProcedure as build } from 'light-sdk-builder'; build(http)",
    )
    await writeFile(
      join(cwd, 'src/routes/framework.ts'),
      "export { tanstackQuery } from 'light-sdk-builder-tanstack-query'",
    )
    await writeFile(
      join(cwd, 'src/application.ts'),
      "import { createProcedure } from 'light-sdk-builder'; createProcedure(http)",
    )
    const eslint = spawnSync(
      process.execPath,
      ['node_modules/eslint/bin/eslint.js', '--format', 'json', 'src'],
      { cwd, encoding: 'utf8' },
    )
    assert.equal(eslint.status, 1, eslint.stdout + eslint.stderr)
    const errors = JSON.parse(eslint.stdout).flatMap((file) =>
      file.messages.filter((message) => message.severity === 2),
    )
    assert.deepEqual(errors.map((error) => error.ruleId).sort(), [
      'light-sdk-builder/no-framework-in-routes',
      'light-sdk-builder/prefer-reusable-procedures',
    ])
    const oxlint = spawnSync(
      process.execPath,
      ['node_modules/oxlint/bin/oxlint', '--format', 'json', 'src'],
      { cwd, encoding: 'utf8' },
    )
    assert.equal(oxlint.status, 1, oxlint.stdout + oxlint.stderr)
    const diagnostics = JSON.parse(oxlint.stdout).diagnostics
    assert.equal(diagnostics.length, 2, oxlint.stdout)
    assert(diagnostics.every((diagnostic) => diagnostic.filename.includes('src/routes/')))
    console.log(
      `${manager}: installed lint plugin passes ESLint/Oxlint, route scoping and type-only imports without SDK dependencies`,
    )
  }
}
