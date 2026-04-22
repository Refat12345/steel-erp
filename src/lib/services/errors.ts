export type ServiceErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT";

export class ServiceError extends Error {
  constructor(
    message: string,
    public code: ServiceErrorCode = "BAD_REQUEST",
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
