import type { ILimits, PartialLimits } from '@librechat/data-schemas';

const LIMIT_KEYS: Array<keyof ILimits> = ['dailyCostUsd'];

export type LimitsValidation = { ok: true; limits: PartialLimits } | { ok: false; error: string };

function isLimitKey(key: string): key is keyof ILimits {
  return (LIMIT_KEYS as string[]).includes(key);
}

/**
 * Validates a partial limits payload from an HTTP request body. Every field must be
 * either `null` (no limit) or a finite, non-negative number. Unknown keys are rejected
 * rather than silently dropped, so a typo doesn't quietly fail to apply. Does not accept
 * `value` being `null` itself — callers that treat a bare `null` as "clear the whole
 * override" must branch on that before calling this.
 */
export function validatePartialLimits(value: unknown): LimitsValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'limits must be an object' };
  }

  const limits: PartialLimits = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isLimitKey(key)) {
      return { ok: false, error: `Unknown limit field: ${key}` };
    }

    if (raw === null) {
      limits[key] = null;
      continue;
    }

    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      return { ok: false, error: `${key} must be null or a non-negative finite number` };
    }

    limits[key] = raw;
  }

  return { ok: true, limits };
}
