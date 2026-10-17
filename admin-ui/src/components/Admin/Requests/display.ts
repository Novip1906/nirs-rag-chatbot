import type { LimitRequestStatus } from '~/api';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { formatUsd } from '~/components/Admin/utils/format';

export const STATUS_LABEL_KEY: Record<LimitRequestStatus, TranslationKeys> = {
  pending: 'com_admin_requests_status_pending',
  approved: 'com_admin_requests_status_approved',
  rejected: 'com_admin_requests_status_rejected',
};

export const STATUS_VARIANT: Record<LimitRequestStatus, 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

export const UNKNOWN_LIMIT = '—';

/**
 * Requests raised before limit snapshots existed carry no values at all, so an absent
 * number means "not recorded" rather than "unlimited" — both render as a dash.
 */
export function formatLimit(value: number | null | undefined): string {
  return value == null ? UNKNOWN_LIMIT : formatUsd(value);
}

export function formatLimitChange(
  before: number | null | undefined,
  after: number | null | undefined,
): string {
  if (after == null) {
    return formatLimit(before);
  }
  return `${formatLimit(before)} → ${formatLimit(after)}`;
}
