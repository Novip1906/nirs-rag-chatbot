import type { AdminPartialLimits } from '~/api';

/**
 * Builds the `PartialLimits` body for `POST /limit-requests/:id/approve`. Leaving the
 * field blank must omit the key entirely (the server merges partial limits field by
 * field) rather than send a stray `0`, which would silently zero out the limit.
 */
export function buildApproveLimitsPayload(costValue: string): AdminPartialLimits {
  if (costValue === '') {
    return {};
  }
  return { dailyCostUsd: Number(costValue) };
}
