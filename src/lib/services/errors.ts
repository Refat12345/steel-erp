export type ServiceErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT";

/** Interpolation values for next-intl message params. */
export type ServiceErrorParams = Record<
  string,
  string | number | boolean | Date | null | undefined
>;

/**
 * Domain error carrying a stable i18n messageKey (+ optional params).
 * Translation happens at the API/middleware boundary — never store
 * localized prose in `message`. `Error.message` mirrors `messageKey`
 * so existing `toThrow("key")` / `err.message` checks keep working.
 */
export class ServiceError extends Error {
  public readonly messageKey: string;
  public readonly params?: ServiceErrorParams;

  constructor(
    messageKey: string,
    public code: ServiceErrorCode = "BAD_REQUEST",
    params?: ServiceErrorParams,
  ) {
    super(messageKey);
    this.name = "ServiceError";
    this.messageKey = messageKey;
    this.params = params;
  }
}

/** Structured weight-bound failure (see weight-bounds.ts). */
export type MessageKeyError = {
  messageKey: string;
  params?: ServiceErrorParams;
};

export function toServiceError(
  err: MessageKeyError,
  code: ServiceErrorCode = "BAD_REQUEST",
): ServiceError {
  return new ServiceError(err.messageKey, code, err.params);
}
