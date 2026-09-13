import type { DsnAccountErrorCode } from './protocol.ts'

export class DsnAccountError extends Error {
  readonly name: string = 'DsnAccountError'

  constructor(
    readonly code: DsnAccountErrorCode,
    message: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export function errorCodeOf(error: unknown): DsnAccountErrorCode {
  return error instanceof DsnAccountError ? error.code : 'DSN_ACCOUNT_UNAVAILABLE'
}

export function safeErrorMessage(error: unknown, fallback = 'CQAI Club 服务暂时不可用'): string {
  if (error instanceof DsnAccountError) return error.message
  if (error instanceof Error && error.message.length > 0) return error.message
  return fallback
}
