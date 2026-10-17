export type LimitWindow = 'daily';

export type LimitRequestStatus = 'pending' | 'approved' | 'rejected';

export interface UsageWindowLimits {
  costUsd: number | null;
}

export interface UsageWindow {
  costUsd: number;
  requests: number;
  limits: UsageWindowLimits;
}

/** Actual spend only, no threshold — there is no monthly limit to check it against. */
export interface UsageTotals {
  costUsd: number;
  requests: number;
}

export interface PendingLimitRequest {
  id: string;
  window: LimitWindow;
  createdAt: string;
}

export interface UsageMeResponse {
  daily: UsageWindow;
  monthly: UsageTotals;
  pendingRequests: PendingLimitRequest[];
}

export interface LimitRequestItem {
  id: string;
  userId: string;
  window: LimitWindow;
  comment?: string;
  status: LimitRequestStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/** `POST /api/office/usage/request-limit` wraps the created request in an envelope. */
export interface LimitRequestResponse {
  request: LimitRequestItem;
}

export interface RequestLimitBody {
  window: LimitWindow;
  comment?: string;
}
