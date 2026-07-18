/**
 * Translate a Zod issue message that is a bare `validation.*` key (e.g.
 * "contractNumberRequired") into localized text via `useTranslations("validation")`.
 *
 * Legacy/unmigrated validators may still return raw Arabic prose directly as
 * the message — those fall through unchanged since they will never match a
 * key in the `validation` catalog.
 */
export interface ValidationTranslator {
  (key: string): string;
  has?: (key: string) => boolean;
}

export function translateValidationMessage(
  t: ValidationTranslator,
  message: string | undefined,
): string {
  if (!message) return "";
  const key = message.startsWith("validation.")
    ? message.slice("validation.".length)
    : message;

  if (typeof t.has === "function" && !t.has(key)) return message;

  try {
    return t(key);
  } catch {
    return message;
  }
}
