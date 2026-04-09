import { Prisma } from "@prisma/client";

const MAX_RETRIES = 3;

/**
 * Retry a function that may fail with a Prisma serialization error (P2034).
 * Used around `prisma.$transaction` with `isolationLevel: "Serializable"`.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isSerializationFailure =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
      if (!isSerializationFailure || attempt === MAX_RETRIES - 1) throw e;
    }
  }
  throw new Error("unreachable");
}
