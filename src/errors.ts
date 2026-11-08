export type CmapErrorCode =
  | "NOT_FOUND"
  | "UPSTREAM"
  | "VALIDATION"
  | "SYNC_REJECTED"
  | "NO_SNAPSHOT";

/** The single error type thrown by the library; `code` is stable, `message` is for humans. */
export class CmapError extends Error {
  readonly code: CmapErrorCode;

  constructor(code: CmapErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CmapError";
    this.code = code;
  }
}

export function isCmapError(error: unknown): error is CmapError {
  return error instanceof CmapError;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
