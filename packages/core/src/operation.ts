import type { StandardSchemaV1 } from '@standard-schema/spec'

export type CallOptions = { signal?: AbortSignal }
export type OperationConfig<A, C, O> = {
  resolve: (args: A, options: CallOptions) => Promise<C>
  execute: (context: C, options: CallOptions) => Promise<O>
}

/** Transport-neutral execution. Callback return values and thrown errors pass through unchanged. */
export function createOperation<A, C, O>(config: OperationConfig<A, C, O>) {
  const { resolve, execute: run } = config
  const execute = async (context: C, options: CallOptions = {}) => {
    options.signal?.throwIfAborted()
    return run(context, options)
  }
  const prepare = async (args: A, options: CallOptions = {}) => {
    options.signal?.throwIfAborted()
    const context = await resolve(args, options)
    options.signal?.throwIfAborted()
    return { context, call: (callOptions: CallOptions = {}) => execute(context, callOptions) }
  }
  return {
    prepare,
    call: async (args: A, options: CallOptions = {}) =>
      (await prepare(args, options)).call(options),
  }
}

/** The field an issue is about, such as `drops.0.reference`; empty for the value itself. */
export const issuePath = (issue: StandardSchemaV1.Issue): string =>
  (issue.path ?? [])
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.')

/** A schema rejected input (no request was sent) or a response. */
export class ValidationError extends Error {
  readonly name = 'ValidationError'
  constructor(
    readonly kind: 'input' | 'response',
    readonly issues: ReadonlyArray<StandardSchemaV1.Issue>,
  ) {
    super(
      `${kind === 'input' ? 'Input' : 'Response'} validation failed: ${issues
        .map((issue) => [issuePath(issue), issue.message].filter(Boolean).join(': '))
        .join(', ')}`,
    )
  }
}

/** The schema's parsed output can differ from the value accepted by the caller. */
export async function validateSchema<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  kind: 'input' | 'response' = 'input',
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema['~standard'].validate(value)
  if (result.issues) throw new ValidationError(kind, result.issues)
  return result.value
}
