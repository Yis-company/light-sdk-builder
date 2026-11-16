const stringArray = { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true }

function propertyName(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name
  if (node.computed && node.property.type === 'Literal') return node.property.value
}

function unwrap(node) {
  while (
    node &&
    ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ChainExpression'].includes(
      node.type,
    )
  ) {
    node = node.expression
  }
  return node
}

const preferReusableProcedures = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer reusable procedure definitions in selected route files.' },
    schema: [{ type: 'object', properties: { modules: stringArray }, additionalProperties: false }],
    messages: {
      bound:
        'Define routes with sdk.procedure from createSdkBuilder; bind the HTTP client once with sdk.create outside route definitions.',
    },
  },
  create(context) {
    const modules = new Set(context.options[0]?.modules ?? ['light-sdk-builder'])
    const sourceCode = context.sourceCode

    // Resolve lexical bindings, never identifier spelling alone. Immutable local aliases
    // are followed; mutable bindings and cross-module reexports are deliberately not inferred.
    function origin(expression, seen = new Set()) {
      const node = unwrap(expression)
      if (!node) return
      if (node.type === 'MemberExpression') {
        if (propertyName(node) === 'createProcedure' && origin(node.object, seen) === 'namespace')
          return 'procedure'
        return
      }
      if (node.type !== 'Identifier') return
      let scope = sourceCode.getScope(node)
      let variable
      while (scope && !variable) {
        variable = scope.set.get(node.name)
        scope = scope.upper
      }
      if (!variable || seen.has(variable)) return
      seen.add(variable)
      if (variable.defs.length !== 1) return
      const definition = variable.defs[0]
      if (definition.type === 'ImportBinding') {
        const declaration = definition.parent
        const specifier = definition.node
        if (
          !modules.has(declaration.source.value) ||
          declaration.importKind === 'type' ||
          specifier.importKind === 'type'
        )
          return
        if (specifier.type === 'ImportNamespaceSpecifier') return 'namespace'
        if (
          specifier.type === 'ImportSpecifier' &&
          (specifier.imported.name ?? specifier.imported.value) === 'createProcedure'
        )
          return 'procedure'
      }
      if (definition.type === 'Variable' && definition.parent.kind === 'const') {
        const declarator = definition.node
        if (declarator.id.type === 'Identifier') return origin(declarator.init, seen)
        if (
          declarator.id.type === 'ObjectPattern' &&
          origin(declarator.init, seen) === 'namespace'
        ) {
          const property = declarator.id.properties.find(
            (item) => item.type === 'Property' && item.value === definition.name,
          )
          const name =
            property &&
            (property.computed ? property.key.value : (property.key.name ?? property.key.value))
          if (name === 'createProcedure') return 'procedure'
        }
      }
    }
    return {
      CallExpression(node) {
        if (origin(node.callee) === 'procedure') context.report({ node, messageId: 'bound' })
      },
    }
  },
}

const defaultBlockedModules = [
  'light-sdk-builder-react',
  'light-sdk-builder-tanstack-query',
  'react',
  'react-dom',
  '@tanstack/*',
]

const noFrameworkInRoutes = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep runtime framework imports out of selected route files.' },
    schema: [
      { type: 'object', properties: { blockedModules: stringArray }, additionalProperties: false },
    ],
    messages: {
      framework:
        'Keep runtime import "{{module}}" outside reusable route definitions; add framework plugins when creating the SDK instance.',
    },
  },
  create(context) {
    const blocked = context.options[0]?.blockedModules ?? defaultBlockedModules
    function check(node, source) {
      const value = source?.value
      if (typeof value !== 'string') return
      const matches = blocked.some((module) =>
        module.endsWith('/*')
          ? value.startsWith(module.slice(0, -1))
          : value === module || value.startsWith(`${module}/`),
      )
      if (matches) context.report({ node, messageId: 'framework', data: { module: value } })
    }
    function declaration(node) {
      if (node.importKind === 'type' || node.exportKind === 'type') return
      if (
        node.specifiers?.length &&
        node.specifiers.every(
          (specifier) => specifier.importKind === 'type' || specifier.exportKind === 'type',
        )
      )
        return
      check(node, node.source)
    }
    return {
      ImportDeclaration: declaration,
      ExportNamedDeclaration: declaration,
      ExportAllDeclaration: declaration,
      ImportExpression(node) {
        check(node, node.source)
      },
      CallExpression(node) {
        if (node.callee.type === 'Import') check(node, node.arguments[0])
      },
    }
  },
}

const plugin = {
  meta: { name: 'eslint-plugin-light-sdk-builder' },
  rules: {
    'prefer-reusable-procedures': preferReusableProcedures,
    'no-framework-in-routes': noFrameworkInRoutes,
  },
}

export default plugin
