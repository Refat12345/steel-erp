export class ServiceError extends Error {
  constructor(
    message: string,
    public code: "BAD_REQUEST" | "NOT_FOUND" | "FORBIDDEN" = "BAD_REQUEST",
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
