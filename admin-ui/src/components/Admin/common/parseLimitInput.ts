import type { TranslationKeys } from '~/hooks/useLocalize';

export interface ParsedLimitInput {
  value: number | null;
  errorKey?: TranslationKeys;
}

/**
 * An empty field means `null`, never `0`. What that `null` goes on to mean depends on
 * where the field lives: inside a personal set it is "no ceiling", on a department it is
 * "take the global value". Zero is a placeholder in neither — it means "block every
 * request", so it must only ever reach the server when an admin typed it on purpose.
 *
 * Negative numbers are always rejected; fractional rubles are allowed — `min`/`step` on
 * the input are UX hints only and don't stop a value assembled programmatically, so this
 * is the actual gate. The server enforces the same rule independently; this is the client
 * half.
 */
export function parseLimitInput(raw: string): ParsedLimitInput {
  if (raw.trim() === '') {
    return { value: null };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return { value: null, errorKey: 'com_admin_limits_error_invalid' };
  }
  if (parsed < 0) {
    return { value: null, errorKey: 'com_admin_limits_error_negative' };
  }
  return { value: parsed };
}
